#!/usr/bin/env node
// Synthetic controller-side capture benchmark. No host, profile store, or network access.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { DESKTOP_APP_ID, SessionManager, ppmToRgb, rgbToPng } from "../src/session.js";

const PRESETS = { "720p": [1280, 720], "1080p": [1920, 1080], "4k": [3840, 2160] };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function parseArguments(args) {
  const options = { iterations: 3, sizes: Object.keys(PRESETS), output: null };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (!["--iterations", "--sizes", "--output"].includes(argument)) throw new Error(`Unknown argument: ${argument}`);
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    if (argument === "--iterations") options.iterations = Number(value);
    if (argument === "--sizes") options.sizes = value.split(",");
    if (argument === "--output") options.output = value;
  }
  if (!Number.isInteger(options.iterations) || options.iterations < 1 || options.iterations > 50) throw new Error("--iterations must be an integer from 1 through 50.");
  options.sizes = options.sizes.map((label) => {
    const dimensions = PRESETS[label.toLowerCase()] ?? (/^\d+x\d+$/.test(label) ? label.split("x").map(Number) : null);
    if (!dimensions || dimensions.some((value) => !Number.isSafeInteger(value) || value < 1) || dimensions[0] > 8192 || dimensions[1] > 4320 || dimensions[0] * dimensions[1] > 3840 * 2160) throw new Error(`Invalid size: ${label}. Use 720p, 1080p, 4k, or WIDTHxHEIGHT (at most 4K pixels).`);
    return { label, width: dimensions[0], height: dimensions[1] };
  });
  return options;
}

export function createRgbFixture(width, height, kind) {
  const pixels = Buffer.allocUnsafe(width * height * 3);
  let random = 0x243f6a88;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 3;
      if (kind === "high_entropy") {
        // Fixed-seed xorshift32, intentionally poorly compressible and reproducible.
        for (let channel = 0; channel < 3; channel++) {
          random ^= random << 13;
          random ^= random >>> 17;
          random ^= random << 5;
          pixels[offset + channel] = random & 0xff;
        }
      } else if (kind === "desktop_like") {
        const sidebar = x < width / 5;
        const title = y < height / 12;
        const panel = x > width / 4 && x < width * 0.94 && y > height / 6 && y < height * 0.9;
        const text = panel && y % 24 >= 8 && y % 24 < 11 && x % 120 < 90;
        const color = title ? [38, 45, 59] : sidebar ? [53, 65, 82] : text ? [80, 87, 98] : panel ? [248, 249, 252] : [226, 230, 237];
        pixels[offset] = color[0]; pixels[offset + 1] = color[1]; pixels[offset + 2] = color[2];
      } else throw new Error(`Unknown fixture kind: ${kind}`);
    }
  }
  return { width, height, pixels };
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function rounded(value) { return Math.round(value * 1000) / 1000; }

async function sample(operation) {
  // Sample timer lateness throughout the operation, including the final blocking
  // portion. This is a local responsiveness proxy, not a UI/network latency.
  let maximumTimerLateness = 0;
  let expected = performance.now() + 2;
  const timer = setInterval(() => {
    const now = performance.now();
    maximumTimerLateness = Math.max(maximumTimerLateness, now - expected);
    expected = now + 2;
  }, 2);
  await pause(3);
  maximumTimerLateness = 0;
  expected = performance.now() + 2;
  const cpuBefore = process.cpuUsage();
  const before = performance.now();
  let result;
  let elapsed;
  let cpu;
  try {
    result = await operation();
    elapsed = performance.now() - before;
    cpu = process.cpuUsage(cpuBefore);
    await pause(3);
  } finally { clearInterval(timer); }
  return { elapsed, cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000, encodedBytes: result?.png?.length ?? 0, timerLatenessMs: Math.max(0, maximumTimerLateness) };
}

async function measure(iterations, prepare, operation) {
  const samples = [];
  for (let index = 0; index < iterations; index++) {
    await prepare(index);
    samples.push(await sample(operation));
  }
  return {
    iterations,
    wallMs: { median: rounded(percentile(samples.map((entry) => entry.elapsed), 0.5)), p95: rounded(percentile(samples.map((entry) => entry.elapsed), 0.95)) },
    cpuUserMs: { total: rounded(samples.reduce((sum, entry) => sum + entry.cpuUserMs, 0)), median: rounded(percentile(samples.map((entry) => entry.cpuUserMs), 0.5)) },
    cpuSystemMs: { total: rounded(samples.reduce((sum, entry) => sum + entry.cpuSystemMs, 0)), median: rounded(percentile(samples.map((entry) => entry.cpuSystemMs), 0.5)) },
    encodedBytes: { median: percentile(samples.map((entry) => entry.encodedBytes), 0.5), max: Math.max(...samples.map((entry) => entry.encodedBytes)) },
    eventLoopTimerLatenessMs: { median: rounded(percentile(samples.map((entry) => entry.timerLatenessMs), 0.5)), max: rounded(Math.max(...samples.map((entry) => entry.timerLatenessMs))) },
  };
}

function fakeSession(framePath, width, height) {
  return {
    id: "synthetic-session", profileId: "synthetic-profile", profile: { id: "synthetic-profile", deviceName: "Synthetic fixture only", host: { address: "invalid.example", port: 1 } },
    appId: DESKTOP_APP_ID, appName: "Synthetic Desktop", state: "active", width, height, fps: 30, bitrate: 20_000,
    framePath, frameSequence: 1, frameCapturedAt: new Date().toISOString(), snapshots: new Map(), snapshotOrder: [], templates: new Map(), latestSnapshotId: null, waiters: [],
  };
}

export async function runBenchmark(options) {
  const started = performance.now();
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "moonlight-capture-benchmark-"));
  const results = [];
  const manager = new SessionManager({ rootDirectory: temporary, bridgePath: path.join(temporary, "not-a-bridge") });
  // Fail immediately if a regression tries to leave the synthetic harness.
  manager.send = () => { throw new Error("Synthetic benchmark must not request a native frame."); };
  manager.waitFor = () => { throw new Error("Synthetic benchmark must not wait for a native frame."); };
  if (typeof manager.requestFrame === "function") {
    // Newer bridges use a request/ack frame protocol instead of unsolicited
    // frame events. Retain the same synthetic PPM read/parse cost on both sides
    // of the comparison while bypassing only the absent native process.
    manager.requestFrame = async (session) => ({
      rgb: ppmToRgb(await fs.readFile(session.framePath)),
      frameSequence: session.frameSequence,
      frameCapturedAt: session.frameCapturedAt,
    });
  }
  try {
    for (const size of options.sizes) {
      for (const fixture of ["desktop_like", "high_entropy"]) {
        const rgb = createRgbFixture(size.width, size.height, fixture);
        const header = Buffer.from(`P6\n${rgb.width} ${rgb.height}\n255\n`);
        const framePath = path.join(temporary, "fixture.ppm");
        const session = fakeSession(framePath, rgb.width, rgb.height);
        manager.sessions.set(session.id, session);
        let revision = 0;
        const publish = async () => {
          rgb.pixels[0] = revision++ & 0xff;
          await fs.writeFile(framePath, Buffer.concat([header, rgb.pixels]), { mode: 0o600 });
          session.frameSequence++;
          session.frameCapturedAt = new Date().toISOString();
        };
        const details = { size: size.label, width: size.width, height: size.height, fixture };
        await rgbToPng(rgb); // JIT/library warmup, outside samples.
        results.push({ ...details, operation: "rgbToPng", ...await measure(options.iterations, () => {}, () => rgbToPng(rgb)) });
        await publish();
        results.push({ ...details, operation: "capture_fresh_frame", ...await measure(options.iterations, publish, () => manager.capture(session.id, 60_000)) });
        await manager.capture(session.id, 60_000); // Prime same-frame caches outside samples.
        results.push({ ...details, operation: "capture_same_frame", ...await measure(options.iterations, () => {}, () => manager.capture(session.id, 60_000)) });
        if (typeof manager.captureSnapshot === "function") {
          results.push({ ...details, operation: "captureSnapshot_fresh_frame", ...await measure(options.iterations, publish, () => manager.captureSnapshot(session.id, 60_000)) });
          results.push({ ...details, operation: "captureSnapshot_same_frame", ...await measure(options.iterations, () => {}, () => manager.captureSnapshot(session.id, 60_000)) });
        }
        manager.sessions.delete(session.id);
      }
    }
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
  return {
    schemaVersion: 1, benchmark: "synthetic_controller_capture", runtime: { node: process.version, platform: process.platform, architecture: process.arch, cpuModel: os.cpus()[0]?.model, logicalCpus: os.cpus().length },
    capabilities: { captureSnapshot: typeof manager.captureSnapshot === "function" },
    elapsedMs: rounded(performance.now() - started), iterations: options.iterations,
    methodology: {
      fixtures: "Generated deterministic RGB desktop-like blocks/text bars and fixed-seed high-entropy noise; no real screenshots or private state.",
      freshFrame: "One pixel changes per revision; fixture generation and PPM publication excluded from measured phase. SessionManager read/copy/encode work included.",
      sameFrame: "One warmed session frame repeatedly captured; retained cache is allowed.",
      timing: "Wall median and nearest-rank p95; process CPU user/system; timer lateness sampled every 2ms as an event-loop blocking proxy. Small default sample count is exploratory.",
      exclusions: "No Apollo, H.264 decode, native frame publication, network, MCP JSON/base64 serialization, AI reasoning, or token billing. Not an end-to-end desktop benchmark.",
    }, results,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const report = JSON.stringify(await runBenchmark(options), null, 2) + "\n";
    if (options.output) await fs.writeFile(options.output, report, { mode: 0o600 });
    process.stdout.write(report);
  } catch (error) { process.stderr.write(`Capture benchmark failed: ${error.message}\n`); process.exitCode = 1; }
}
