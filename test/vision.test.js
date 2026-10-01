import test from "node:test";
import assert from "node:assert/strict";

import { cropRgb, diffRgb, findTemplate } from "../src/vision.js";

function frame(width, height, fill = 0) {
  return { width, height, pixels: Buffer.alloc(width * height * 3, fill) };
}

function setPixel(image, x, y, red, green, blue) {
  const offset = (y * image.width + x) * 3;
  image.pixels[offset] = red;
  image.pixels[offset + 1] = green;
  image.pixels[offset + 2] = blue;
}

test("crops RGB captures in capture-space coordinates", () => {
  const image = frame(4, 3);
  setPixel(image, 2, 1, 10, 20, 30);
  const crop = cropRgb(image, { x: 1, y: 1, width: 2, height: 2 });
  assert.deepEqual({ x: crop.x, y: crop.y, width: crop.width, height: crop.height }, { x: 1, y: 1, width: 2, height: 2 });
  assert.deepEqual([...crop.pixels.subarray(3, 6)], [10, 20, 30]);
});

test("diffs material regions while ignoring tiny deltas", () => {
  const before = frame(6, 5, 100);
  const after = frame(6, 5, 100);
  setPixel(after, 2, 3, 180, 100, 100);
  setPixel(after, 3, 3, 180, 100, 100);
  const result = diffRgb(before, after, { pixelThreshold: 32 });
  assert.equal(result.changedPixels, 2);
  assert.equal(result.changedPixelFraction, 2 / 30);
  assert.deepEqual(result.boundingBox, { x: 2, y: 3, width: 2, height: 1 });
});

test("finds a retained template with capture-space coordinates", () => {
  const image = frame(20, 14, 15);
  const x = 11;
  const y = 7;
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 4; column++) setPixel(image, x + column, y + row, 30 + column * 40, 50 + row * 50, 210 - column * 20);
  }
  const template = cropRgb(image, { x, y, width: 4, height: 3 });
  const match = findTemplate(image, template, { scanStep: 2, maximumSamples: 36 });
  assert.equal(match.x, x);
  assert.equal(match.y, y);
  assert.equal(match.width, 4);
  assert.equal(match.height, 3);
  assert.equal(match.score, 1);
});
