// Deterministic visual helpers for Desktop frames. These operate on the same
// RGB capture-space pixels that Moonlight mouse input uses, so returned
// coordinates can be passed straight back to the session input tools.

function integer(value, name) {
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer.`);
  return value;
}

export function normalizeRegion(frame, region = {}) {
  const x = region.x ?? 0;
  const y = region.y ?? 0;
  const width = region.width ?? frame.width;
  const height = region.height ?? frame.height;
  for (const [name, value] of Object.entries({ x, y, width, height })) integer(value, `Region ${name}`);
  if (x < 0 || y < 0 || width < 1 || height < 1 || x + width > frame.width || y + height > frame.height) {
    throw new Error(`Region ${x},${y} ${width}x${height} is outside the ${frame.width}x${frame.height} capture.`);
  }
  return { x, y, width, height };
}

export function cropRgb(frame, region) {
  const bounds = normalizeRegion(frame, region);
  const pixels = Buffer.allocUnsafe(bounds.width * bounds.height * 3);
  for (let row = 0; row < bounds.height; row++) {
    const source = ((bounds.y + row) * frame.width + bounds.x) * 3;
    frame.pixels.copy(pixels, row * bounds.width * 3, source, source + bounds.width * 3);
  }
  return { ...bounds, pixels };
}

export function diffRgb(baseline, current, { pixelThreshold = 32 } = {}) {
  if (!Number.isInteger(pixelThreshold) || pixelThreshold < 0 || pixelThreshold > 255) {
    throw new Error("pixelThreshold must be an integer from 0 through 255.");
  }
  if (baseline.width !== current.width || baseline.height !== current.height) {
    return {
      changed: true,
      changedPixels: current.width * current.height,
      totalPixels: current.width * current.height,
      changedPixelFraction: 1,
      meanDelta: 255,
      boundingBox: { x: 0, y: 0, width: current.width, height: current.height },
      reason: "frame_dimensions_changed",
    };
  }

  const totalPixels = current.width * current.height;
  let changedPixels = 0;
  let deltaSum = 0;
  let minimumX = current.width;
  let minimumY = current.height;
  let maximumX = -1;
  let maximumY = -1;
  for (let pixel = 0, offset = 0; pixel < totalPixels; pixel++, offset += 3) {
    const delta = Math.max(
      Math.abs(baseline.pixels[offset] - current.pixels[offset]),
      Math.abs(baseline.pixels[offset + 1] - current.pixels[offset + 1]),
      Math.abs(baseline.pixels[offset + 2] - current.pixels[offset + 2]),
    );
    deltaSum += delta;
    if (delta <= pixelThreshold) continue;
    changedPixels++;
    const x = pixel % current.width;
    const y = Math.floor(pixel / current.width);
    minimumX = Math.min(minimumX, x);
    minimumY = Math.min(minimumY, y);
    maximumX = Math.max(maximumX, x);
    maximumY = Math.max(maximumY, y);
  }
  return {
    changed: changedPixels > 0,
    changedPixels,
    totalPixels,
    changedPixelFraction: changedPixels / totalPixels,
    meanDelta: deltaSum / totalPixels,
    boundingBox: maximumX < 0 ? null : {
      x: minimumX,
      y: minimumY,
      width: maximumX - minimumX + 1,
      height: maximumY - minimumY + 1,
    },
  };
}

function templateSamplePoints(template, maximumSamples) {
  const targetSide = Math.max(1, Math.floor(Math.sqrt(maximumSamples)));
  const stepX = Math.max(1, Math.ceil(template.width / targetSide));
  const stepY = Math.max(1, Math.ceil(template.height / targetSide));
  const samples = [];
  for (let y = Math.floor(stepY / 2); y < template.height; y += stepY) {
    for (let x = Math.floor(stepX / 2); x < template.width; x += stepX) samples.push({ x, y });
  }
  if (samples.length === 0) samples.push({ x: 0, y: 0 });
  return samples;
}

function templateScore(frame, template, x, y, samples) {
  let difference = 0;
  for (const sample of samples) {
    const frameOffset = ((y + sample.y) * frame.width + x + sample.x) * 3;
    const templateOffset = (sample.y * template.width + sample.x) * 3;
    difference += Math.max(
      Math.abs(frame.pixels[frameOffset] - template.pixels[templateOffset]),
      Math.abs(frame.pixels[frameOffset + 1] - template.pixels[templateOffset + 1]),
      Math.abs(frame.pixels[frameOffset + 2] - template.pixels[templateOffset + 2]),
    );
  }
  return 1 - difference / (samples.length * 255);
}

export function findTemplate(frame, template, { searchRegion, scanStep = 4, maximumSamples = 144 } = {}) {
  if (!Number.isInteger(scanStep) || scanStep < 1 || scanStep > 32) throw new Error("scanStep must be an integer from 1 through 32.");
  if (!Number.isInteger(maximumSamples) || maximumSamples < 9 || maximumSamples > 2_500) throw new Error("maximumSamples must be an integer from 9 through 2500.");
  if (template.width < 2 || template.height < 2 || template.width > frame.width || template.height > frame.height) {
    throw new Error("Template dimensions do not fit the current capture.");
  }
  const region = normalizeRegion(frame, searchRegion);
  const maximumX = region.x + region.width - template.width;
  const maximumY = region.y + region.height - template.height;
  if (maximumX < region.x || maximumY < region.y) return null;
  const samples = templateSamplePoints(template, maximumSamples);
  let best = { score: -1, x: region.x, y: region.y };
  for (let y = region.y; y <= maximumY; y += scanStep) {
    for (let x = region.x; x <= maximumX; x += scanStep) {
      const score = templateScore(frame, template, x, y, samples);
      if (score > best.score) best = { score, x, y };
    }
  }
  // Recover pixel precision near the strongest coarse candidate.
  const startX = Math.max(region.x, best.x - scanStep + 1);
  const endX = Math.min(maximumX, best.x + scanStep - 1);
  const startY = Math.max(region.y, best.y - scanStep + 1);
  const endY = Math.min(maximumY, best.y + scanStep - 1);
  for (let y = startY; y <= endY; y++) {
    for (let x = startX; x <= endX; x++) {
      const score = templateScore(frame, template, x, y, samples);
      if (score > best.score) best = { score, x, y };
    }
  }
  return { ...best, width: template.width, height: template.height, samples: samples.length };
}
