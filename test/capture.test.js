import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as zlib from "node:zlib";

import { DESKTOP_APP_ID, SessionManager, isNearlyBlackFrame, rgbToPngAsync } from "../src/session.js";

const SMALL_RGB = {
  width: 3,
  height: 2,
  pixels: Buffer.from([10, 13, 32, 0, 255, 1, 255, 0, 0, 8, 16, 24, 30, 40, 50, 254, 253, 252]),
};

async function fakeDesktop(t, { rgb = SMALL_RGB, sequence = 7, captureProtocol = 1 } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "moonlight-capture-test-"));
  await fs.chmod(directory, 0o700);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const framePath = path.join(directory, "fixture.ppm");
  await fs.writeFile(framePath, Buffer.concat([
    Buffer.from("P6\n" + rgb.width + " " + rgb.height + "\n255\n"), rgb.pixels,
  ]), { mode: 0o600 });
  const manager = new SessionManager({ rootDirectory: directory, bridgePath: path.join(directory, "no-native-bridge") });
  const commands = [];
  const session = {
    id: "fake-session", profileId: "fake-profile",
    profile: { id: "fake-profile", deviceName: "Deterministic fixture", host: { address: "invalid.example", port: 1 } },
    appId: DESKTOP_APP_ID, appName: "Desktop", state: "active",
    width: rgb.width, height: rgb.height, fps: 30, bitrate: 20_000,
    directory, framePath, frameSequence: sequence, frameCapturedAt: new Date().toISOString(),
    waiters: [], launched: false, stopping: false,
    snapshots: new Map(), snapshotOrder: [], latestSnapshotId: null, templates: new Map(),
    captureProtocol: null, captureRequestId: 0, captureInFlight: null,
    capturePerformance: { captures: 0, pngEncodes: 0, pngCacheHits: 0 }, inputSequence: -1,
  };
  let onCapture;
  const emit = (event) => manager.handleBridgeEvent(session, event);
  const ack = (requestId, overrides = {}) => emit({
    type: "capture", requestId, sequence: session.frameSequence,
    width: rgb.width, height: rgb.height, ageMs: 0, conversionMs: 0.25, publishMs: 0.5, ...overrides,
  });
  session.child = {
    exitCode: 0,
    stdin: {
      writable: true,
      write(command) {
        const value = command.trim();
        commands.push(value);
        const match = /^capture (\d+)$/.exec(value);
        if (match) {
          const requestId = Number(match[1]);
          if (onCapture) onCapture(requestId);
          else ack(requestId);
        }
        return true;
      },
    },
  };
  manager.sessions.set(session.id, session);
  emit({ type: "capabilities", captureProtocol });
  emit({ type: "frame", sequence, width: rgb.width, height: rgb.height });
  return {
    manager, session, commands, rgb, ack, emit,
    setCaptureHandler(handler) { onCapture = handler; },
    captures() { return commands.filter((command) => command.startsWith("capture ")); },
    frame(nextSequence, dimensions = rgb) {
      emit({ type: "frame", sequence: nextSequence, width: dimensions.width, height: dimensions.height });
    },
  };
}

function checksum(buffer) {
  if (zlib.crc32) return zlib.crc32(buffer);
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function decodePng(png) {
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const chunks = [];
  let width;
  let height;
  let offset = 8;
  let ended = false;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    assert.equal(data.length, length);
    assert.equal(png.readUInt32BE(offset + 8 + length), checksum(png.subarray(offset + 4, offset + 8 + length)), type + " CRC");
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8);
      assert.equal(data[9], 2);
      assert.deepEqual([...data.subarray(10)], [0, 0, 0]);
    }
    if (type === "IDAT") chunks.push(data);
    if (type === "IEND") ended = true;
    offset += 12 + length;
  }
  assert.equal(offset, png.length);
  assert.ok(ended);
  const stride = width * 3;
  const filtered = zlib.inflateSync(Buffer.concat(chunks));
  assert.equal(filtered.length, (stride + 1) * height);
  const pixels = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row++) {
    const filter = filtered[row * (stride + 1)];
    for (let column = 0; column < stride; column++) {
      const target = row * stride + column;
      const a = column >= 3 ? pixels[target - 3] : 0;
      const b = row > 0 ? pixels[target - stride] : 0;
      const c = row > 0 && column >= 3 ? pixels[target - stride - 3] : 0;
      let predictor;
      if (filter === 0) predictor = 0;
      else if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = Math.floor((a + b) / 2);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else assert.fail("Unknown PNG row filter " + filter);
      pixels[target] = (filtered[row * (stride + 1) + column + 1] + predictor) & 0xff;
    }
  }
  return { width, height, pixels };
}

test("parallel capture coalesces native publication and PNG encoding, including unchanged pixels on a newer frame", async (t) => {
  const f = await fakeDesktop(t);
  const captures = await Promise.all(Array.from({ length: 12 }, () => f.manager.capture(f.session.id)));
  assert.equal(f.captures().length, 1);
  assert.equal(f.session.capturePerformance.captures, 1);
  assert.equal(f.session.capturePerformance.pngEncodes, 1);
  for (const capture of captures) {
    assert.equal(capture.snapshotId, captures[0].snapshotId);
    assert.strictEqual(capture.png, captures[0].png);
    assert.deepEqual(capture.pixels, f.rgb.pixels);
  }
  f.frame(8);
  const next = await f.manager.capture(f.session.id);
  assert.equal(f.captures().length, 2);
  assert.equal(next.frameSequence, 8);
  assert.notEqual(next.snapshotId, captures[0].snapshotId);
  assert.strictEqual(next.png, captures[0].png);
  assert.equal(f.session.capturePerformance.pngEncodes, 1);
  assert.ok(f.session.capturePerformance.pngCacheHits >= 12);
});

test("raw captureSnapshot coalesces file publication without encoding a PNG", async (t) => {
  const f = await fakeDesktop(t);
  const snapshots = await Promise.all(Array.from({ length: 8 }, () => f.manager.captureSnapshot(f.session.id)));
  assert.equal(f.captures().length, 1);
  for (const snapshot of snapshots) {
    assert.strictEqual(snapshot, snapshots[0]);
    assert.deepEqual(snapshot.pixels, f.rgb.pixels);
    assert.equal(snapshot.png, undefined);
  }
  assert.equal(f.session.capturePerformance.pngEncodes, 0);
  assert.equal(f.session.encodedFrame, undefined);
});

test("capture metadata stays tied to its acknowledgement when a frame event arrives during the asynchronous pixel read", async (t) => {
  const f = await fakeDesktop(t);
  f.setCaptureHandler((requestId) => {
    f.ack(requestId, { sequence: 7, ageMs: 25 });
    // The first microtask runs before requestFrame resumes its acknowledged
    // wait; the second runs after fs.readFile has started and before its I/O.
    queueMicrotask(() => queueMicrotask(() => f.frame(8, { width: 99, height: 77 })));
  });
  const before = Date.now();
  const capture = await f.manager.capture(f.session.id);
  assert.equal(f.session.frameSequence, 8);
  assert.equal(f.session.width, 99);
  assert.equal(capture.frameSequence, 7);
  assert.equal(capture.width, f.rgb.width);
  assert.equal(capture.height, f.rgb.height);
  assert.ok(Number.isFinite(Date.parse(capture.frameCapturedAt)));
  assert.ok(Date.parse(capture.frameCapturedAt) >= before - 25);
  assert.ok(Date.parse(capture.frameCapturedAt) <= Date.now() - 25);
  assert.deepEqual(decodePng(capture.png), f.rgb);
});

test("stale or invalid native capture replies fail without retaining a snapshot, then a later capture recovers", async (t) => {
  const f = await fakeDesktop(t);
  for (const invalid of [{ ageMs: 501 }, { ageMs: -1 }, { sequence: 0 }, { sequence: 7.5 }]) {
    f.setCaptureHandler((requestId) => f.ack(requestId, invalid));
    await assert.rejects(f.manager.captureSnapshot(f.session.id, 500), /stale or invalid capture/i);
    assert.equal(f.session.captureInFlight, null);
    assert.equal(f.session.snapshots.size, 0);
  }
  f.session.inputSequence = 6;
  f.setCaptureHandler((requestId) => f.ack(requestId, { sequence: 6 }));
  await assert.rejects(f.manager.captureSnapshot(f.session.id), /stale or invalid capture/i);
  f.setCaptureHandler(null);
  const snapshot = await f.manager.captureSnapshot(f.session.id);
  assert.equal(snapshot.frameSequence, 7);
  assert.equal(f.session.capturePerformance.captures, 1);
});

test("a reply to an earlier capture request cannot satisfy the current request", async (t) => {
  const f = await fakeDesktop(t);
  f.setCaptureHandler((requestId) => {
    f.ack(requestId - 1, { sequence: 99, width: 1, height: 1 });
    queueMicrotask(() => f.ack(requestId));
  });
  const snapshot = await f.manager.captureSnapshot(f.session.id);
  assert.equal(snapshot.frameSequence, 7);
  assert.equal(snapshot.width, f.rgb.width);
  assert.equal(f.captures().length, 1);
});

test("incompatible native binaries are refused before sending capture commands", async (t) => {
  for (const captureProtocol of [null, 0, 2]) {
    const f = await fakeDesktop(t, { captureProtocol });
    await assert.rejects(f.manager.capture(f.session.id), /does not support on-demand capture.*rebuild/i);
    assert.deepEqual(f.commands, []);
    assert.equal(f.session.snapshots.size, 0);
  }
});

test("dimension mismatch, native errors, and terminal events reject capture without poisoning the next request", async (t) => {
  for (const mode of ["dimension-mismatch", "capture-error", "terminal-event", "terminal-during-read"]) {
    await t.test(mode, async (t) => {
      const f = await fakeDesktop(t);
      f.setCaptureHandler((requestId) => {
        if (mode === "dimension-mismatch") f.ack(requestId, { width: f.rgb.width + 1 });
        else if (mode === "capture-error") f.emit({ type: "capture_error", requestId, detail: "fixture publication failed" });
        else if (mode === "terminal-event") f.emit({ type: "stage_failed", detail: "fixture transport ended" });
        else {
          f.ack(requestId);
          queueMicrotask(() => queueMicrotask(() => f.emit({ type: "stage_failed", detail: "fixture transport ended during read" })));
        }
      });
      const expected = mode === "dimension-mismatch" ? /dimensions.*pixels/i
        : mode === "capture-error" ? /capture failed.*fixture publication failed/i
        : /ended during capture|ended during capture.*stage_failed|transport ended during capture/i;
      await assert.rejects(f.manager.captureSnapshot(f.session.id), expected);
      assert.equal(f.session.captureInFlight, null);
      assert.equal(f.session.snapshots.size, 0);
      f.emit({ type: "connected" });
      f.frame(8);
      f.setCaptureHandler(null);
      assert.equal((await f.manager.captureSnapshot(f.session.id)).frameSequence, 8);
      assert.equal(f.session.capturePerformance.captures, 1);
    });
  }
});

test("capture after input waits for a newer frame rather than reusing pre-input pixels", async (t) => {
  const f = await fakeDesktop(t);
  const before = await f.manager.captureSnapshot(f.session.id);
  f.manager.send(f.session.id, "key 65 down");
  assert.equal(f.session.inputSequence, before.frameSequence);
  const pending = f.manager.captureSnapshot(f.session.id);
  assert.equal(f.captures().length, 1);
  f.frame(before.frameSequence);
  await new Promise(setImmediate);
  assert.equal(f.captures().length, 1);
  assert.equal(f.commands.includes("frame"), false, "a fresh decoder does not need an IDR request while awaiting input effects");
  f.frame(before.frameSequence + 1);
  const after = await pending;
  assert.equal(after.frameSequence, before.frameSequence + 1);
  assert.notEqual(after.id, before.id);
  assert.equal(f.captures().length, 2);
});

test("snapshot retention bounds both frame count and RGB byte storage", async (t) => {
  const f = await fakeDesktop(t);
  for (let sequence = 1; sequence <= 13; sequence++) {
    f.manager.rememberSnapshot(f.session, f.rgb, { frameSequence: sequence, frameCapturedAt: new Date().toISOString() });
  }
  assert.equal(f.session.snapshots.size, 12);
  assert.equal(f.session.snapshotBytes, 12 * f.rgb.pixels.length);
  assert.equal([...f.session.snapshots.values()].some((snapshot) => snapshot.frameSequence === 1), false);
  f.session.snapshots.clear();
  f.session.snapshotOrder = [];
  f.session.latestSnapshotId = null;
  f.session.snapshotBytes = 0;
  const width = 4096, height = 2048;
  for (let sequence = 1; sequence <= 5; sequence++) {
    f.manager.rememberSnapshot(f.session, { width, height, pixels: Buffer.alloc(width * height * 3, sequence) }, {
      frameSequence: sequence, frameCapturedAt: new Date().toISOString(),
    });
  }
  const retained = [...f.session.snapshots.values()];
  assert.equal(retained.length, 4);
  assert.equal(f.session.snapshotBytes, 96 * 1024 * 1024);
  assert.equal(retained.reduce((total, snapshot) => total + snapshot.pixels.length, 0), f.session.snapshotBytes);
  assert.equal(retained.some((snapshot) => snapshot.frameSequence === 1), false);
  assert.equal(f.manager.getSnapshot(f.session.id).frameSequence, 5);
});

test("asynchronous PNG encoding preserves exact RGB pixels and valid chunk checksums", async () => {
  const image = await rgbToPngAsync(SMALL_RGB);
  assert.deepEqual(decodePng(image.png), SMALL_RGB);
});

test("asynchronous PNG compression lets a queued timer run before encoding completes", async () => {
  const width = 2048, height = 1024;
  const pixels = Buffer.allocUnsafe(width * height * 3);
  let random = 0x243f6a88;
  for (let index = 0; index < pixels.length; index++) {
    random ^= random << 13;
    random ^= random >>> 17;
    random ^= random << 5;
    pixels[index] = random & 0xff;
  }
  let complete = false;
  const timer = new Promise((resolve) => setTimeout(() => resolve(complete), 0));
  const encoding = rgbToPngAsync({ width, height, pixels }).then((image) => {
    complete = true;
    return image;
  });
  assert.equal(await timer, false, "PNG compression must yield to timers instead of synchronously deflating");
  const image = await encoding;
  assert.ok(image.png.length > pixels.length / 2);
});

test("capture age includes delayed acknowledgement delivery rather than resetting at receipt", async (t) => {
  const f = await fakeDesktop(t);
  const requestedAt = Date.now();
  let clock = requestedAt;
  t.mock.method(Date, "now", () => clock);
  f.setCaptureHandler((requestId) => {
    clock += 501;
    f.ack(requestId, { ageMs: 0 });
  });
  await assert.rejects(f.manager.captureSnapshot(f.session.id, 500), /stale or invalid capture/i);
  assert.equal(f.session.snapshots.size, 0);
  assert.equal(f.session.captureInFlight, null);
  clock = requestedAt;
  f.setCaptureHandler((requestId) => {
    clock += 100;
    f.ack(requestId, { ageMs: 25 });
  });
  const snapshot = await f.manager.captureSnapshot(f.session.id, 500);
  assert.equal(snapshot.frameCapturedAt, new Date(requestedAt - 25).toISOString());
});

test("capture expires when asynchronous pixel reading crosses its age bound", async (t) => {
  const f = await fakeDesktop(t);
  let clock = Date.now();
  t.mock.method(Date, "now", () => clock);
  f.setCaptureHandler((requestId) => {
    f.ack(requestId);
    queueMicrotask(() => queueMicrotask(() => { clock += 501; }));
  });
  await assert.rejects(f.manager.captureSnapshot(f.session.id, 500), /capture expired while reading/i);
  assert.equal(f.session.snapshots.size, 0);
  assert.equal(f.session.captureInFlight, null);
});

test("session stop immediately rejects visual-change and baseline waits", async (t) => {
  for (const kind of ["visual-change", "baseline"]) {
    await t.test(kind, async (t) => {
      const f = await fakeDesktop(t);
      const snapshot = await f.manager.captureSnapshot(f.session.id);
      const waiting = kind === "visual-change"
        ? f.manager.waitForVisualChange(f.session.id, { baselineSnapshotId: snapshot.id })
        : f.manager.waitForVisualBaseline(f.session);
      assert.equal(f.session.waiters.length, 1);
      const rejected = assert.rejects(waiting, kind === "visual-change"
        ? /transport ended while waiting.*stopping/i
        : /transport ended before its visual baseline.*stopping/i);
      await f.manager.stop(f.session.id, { cancelRemote: false, keepRecord: true });
      await rejected;
      assert.equal(f.session.waiters.length, 0);
      assert.equal(f.session.state, "ended");
      assert.equal(f.captures().length, 1);
    });
  }
});

test("failed capture and IDR writes remove their event waiters and allow the next capture", async (t) => {
  for (const kind of ["capture", "idr"]) {
    await t.test(kind, async (t) => {
      const f = await fakeDesktop(t);
      if (kind === "idr") f.session.frameCapturedAt = new Date(0).toISOString();
      const write = f.session.child.stdin.write;
      f.session.child.stdin.write = () => { throw new Error("fixture stdin unavailable"); };
      await assert.rejects(f.manager.captureSnapshot(f.session.id), /fixture stdin unavailable/i);
      assert.equal(f.session.waiters.length, 0);
      assert.equal(f.session.captureInFlight, null);
      assert.equal(f.session.snapshots.size, 0);
      f.session.child.stdin.write = write;
      f.frame(8);
      assert.equal((await f.manager.captureSnapshot(f.session.id)).frameSequence, 8);
      assert.equal(f.session.waiters.length, 0);
    });
  }
});

function blackStartupFixture() {
  const width = 64, height = 64;
  const pixels = Buffer.alloc(width * height * 3);
  // A small cursor on a black startup surface must not establish readiness.
  for (let pixel = 0; pixel < 4; pixel++) pixels.fill(255, pixel * 3, pixel * 3 + 3);
  return { width, height, pixels };
}

function darkUiFixture() {
  const width = 64, height = 64;
  const pixels = Buffer.alloc(width * height * 3, 8);
  // Low luminance UI text remains visible against a dark application surface.
  for (let pixel = 0; pixel < 64; pixel++) pixels.fill(24, pixel * 3, pixel * 3 + 3);
  return { width, height, pixels };
}

async function mockedBaseline(t, rgb) {
  const f = await fakeDesktop(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let clock = 0;
  let sequence = f.session.frameSequence;
  let captures = 0;
  t.mock.method(Date, "now", () => clock);
  t.mock.method(f.manager, "waitFor", async (_session, predicate) => {
    const event = { type: "frame", sequence: ++sequence, width: rgb.width, height: rgb.height };
    assert.ok(predicate(event));
    return event;
  });
  t.mock.method(f.manager, "captureSnapshot", async () => {
    captures++;
    clock += 1_000;
    return { ...rgb, frameSequence: sequence, frameCapturedAt: new Date(clock).toISOString() };
  });
  let finished = false;
  const waiting = f.manager.waitForVisualBaseline(f.session).then((snapshot) => {
    finished = true;
    return snapshot;
  });
  for (let attempt = 0; attempt < 24 && !finished; attempt++) {
    await new Promise(setImmediate);
    t.mock.timers.tick(100);
  }
  const snapshot = await waiting;
  return { session: f.session, captures, snapshot };
}

test("nearly black detection rejects startup black and cursor surfaces while accepting visible dark UI", () => {
  assert.equal(isNearlyBlackFrame({ pixels: Buffer.alloc(0) }), true);
  assert.equal(isNearlyBlackFrame({ pixels: Buffer.alloc(64 * 64 * 3) }), true);
  assert.equal(isNearlyBlackFrame({ pixels: Buffer.alloc(64 * 64 * 3, 16) }), true);
  assert.equal(isNearlyBlackFrame(blackStartupFixture()), true);
  assert.equal(isNearlyBlackFrame(darkUiFixture()), false);
  assert.equal(isNearlyBlackFrame({ pixels: Buffer.alloc(64 * 64 * 3, 20) }), false);
});

test("a quiet black startup surface never becomes a stable visual baseline", async (t) => {
  const rgb = blackStartupFixture();
  const result = await mockedBaseline(t, rgb);
  assert.equal(result.captures, 24, "quiet black frames must exhaust the bounded readiness sampling");
  assert.equal(result.session.visualBaselineStable, false);
  assert.equal(result.session.lastEvent, "visual_baseline_unstable");
  assert.strictEqual(result.snapshot.pixels, rgb.pixels);
});

test("quiet visible dark UI can establish a stable visual baseline", async (t) => {
  const rgb = darkUiFixture();
  const result = await mockedBaseline(t, rgb);
  assert.equal(result.captures, 3);
  assert.equal(result.session.visualBaselineStable, true);
  assert.equal(result.session.lastEvent, "visual_baseline_ready");
  assert.strictEqual(result.snapshot.pixels, rgb.pixels);
});
