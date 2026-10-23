import test from "node:test";
import assert from "node:assert/strict";

import { ImageWorkQueue, imageWorkQueue } from "../src/image-work.js";
import { DESKTOP_APP_ID, SessionManager, rgbToPngAsync } from "../src/session.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function idleState(queue, concurrency = 2, maxPending = 2) {
  assert.deepEqual(queue.state, { active: 0, pending: 0, concurrency, maxPending });
}

function busy(error) {
  assert.equal(error.code, "IMAGE_WORK_BUSY");
  return true;
}

async function occupyImageWorkers(t) {
  idleState(imageWorkQueue);
  const gates = [deferred(), deferred()];
  const started = [deferred(), deferred()];
  const tasks = gates.map((gate, index) => imageWorkQueue.run(async () => {
    started[index].resolve();
    await gate.promise;
  }));
  const release = async () => {
    gates.forEach((gate) => gate.resolve());
    await Promise.allSettled(tasks);
  };
  t.after(release);
  await Promise.all(started.map((entry) => entry.promise));
  assert.equal(imageWorkQueue.state.active, 2);
  return { release };
}

function fakeImageSession() {
  const manager = new SessionManager({ bridgePath: "/test-only/no-native-bridge", rootDirectory: "/test-only/no-session-directory" });
  const session = {
    id: "image-only-session", profileId: "image-only-profile",
    profile: { id: "image-only-profile", deviceName: "Image fixture", host: { address: "invalid.example", port: 1 } },
    appId: DESKTOP_APP_ID, appName: "Desktop", state: "active",
    width: 4, height: 3, fps: 30, bitrate: 20_000,
    frameSequence: 1, frameCapturedAt: new Date().toISOString(),
    waiters: [], child: null, launched: false, stopping: false,
    snapshots: new Map(), snapshotOrder: [], latestSnapshotId: null, templates: new Map(),
    capturePerformance: { captures: 0, pngEncodes: 0, pngCacheHits: 0 },
  };
  manager.sessions.set(session.id, session);
  const snapshot = manager.rememberSnapshot(session, {
    width: session.width, height: session.height,
    pixels: Buffer.from(Array.from({ length: session.width * session.height * 3 }, (_, index) => index)),
  }, session);
  return { manager, session, snapshot };
}

test("image work bounds active and pending jobs and starts admitted work in FIFO order", async (t) => {
  const queue = new ImageWorkQueue({ concurrency: 2, maxPending: 2 });
  idleState(queue);
  const gates = [deferred(), deferred(), deferred(), deferred()];
  const started = [];
  let active = 0;
  let maximumActive = 0;
  const jobs = gates.map((gate, index) => queue.run(async () => {
    started.push(index);
    active++;
    maximumActive = Math.max(maximumActive, active);
    try { return await gate.promise; }
    finally { active--; }
  }));
  t.after(async () => {
    gates.forEach((gate) => gate.resolve());
    await Promise.allSettled(jobs);
  });
  let excessRan = false;
  await assert.rejects(queue.run(() => { excessRan = true; }), busy);
  assert.equal(excessRan, false);
  assert.deepEqual(started, [0, 1]);
  assert.deepEqual(queue.state, { active: 2, pending: 2, concurrency: 2, maxPending: 2 });
  gates[1].resolve("second");
  assert.equal(await jobs[1], "second");
  await new Promise(setImmediate);
  assert.deepEqual(started, [0, 1, 2]);
  gates[0].resolve("first");
  assert.equal(await jobs[0], "first");
  await new Promise(setImmediate);
  assert.deepEqual(started, [0, 1, 2, 3]);
  gates[2].resolve("third");
  gates[3].resolve("fourth");
  assert.deepEqual(await Promise.all(jobs), ["first", "second", "third", "fourth"]);
  assert.equal(maximumActive, 2);
  idleState(queue);
});

test("synchronous throws and asynchronous failures release capacity for queued jobs and later recovery", async () => {
  const queue = new ImageWorkQueue({ concurrency: 1, maxPending: 1 });
  const synchronous = new Error("fixture synchronous failure");
  const asynchronous = new Error("fixture asynchronous failure");
  const first = queue.run(() => { throw synchronous; });
  const follower = queue.run(() => "after synchronous failure");
  await assert.rejects(first, (error) => error === synchronous);
  assert.equal(await follower, "after synchronous failure");
  const second = queue.run(async () => { throw asynchronous; });
  const next = queue.run(() => "after asynchronous failure");
  await assert.rejects(second, (error) => error === asynchronous);
  assert.equal(await next, "after asynchronous failure");
  idleState(queue, 1, 1);
});

test("aborting queued work removes it immediately, preserves FIFO, and never runs its operation", async (t) => {
  const queue = new ImageWorkQueue({ concurrency: 1, maxPending: 2 });
  const gate = deferred();
  const started = deferred();
  const active = queue.run(async () => { started.resolve(); return gate.promise; });
  t.after(async () => { gate.resolve(); await active; });
  await started.promise;
  const controller = new AbortController();
  const reason = new Error("fixture queued cancellation");
  let canceledRan = false;
  const canceled = queue.run(() => { canceledRan = true; }, { signal: controller.signal });
  const order = [];
  const survivor = queue.run(() => { order.push("survivor"); return "survivor"; });
  const canceledResult = assert.rejects(canceled, (error) => error === reason);
  controller.abort(reason);
  await canceledResult;
  assert.equal(canceledRan, false);
  assert.deepEqual(queue.state, { active: 1, pending: 1, concurrency: 1, maxPending: 2 });
  const replacement = queue.run(() => { order.push("replacement"); return "replacement"; });
  gate.resolve();
  await active;
  assert.deepEqual(await Promise.all([survivor, replacement]), ["survivor", "replacement"]);
  assert.deepEqual(order, ["survivor", "replacement"]);
  assert.equal(canceledRan, false);
  idleState(queue, 1, 2);
});

test("an already aborted job never takes capacity or invokes its operation", async () => {
  const queue = new ImageWorkQueue();
  const controller = new AbortController();
  const reason = new Error("fixture pre-cancellation");
  controller.abort(reason);
  let ran = false;
  await assert.rejects(queue.run(() => { ran = true; }, { signal: controller.signal }), (error) => error === reason);
  assert.equal(ran, false);
  idleState(queue);
});

test("active cancellation retains its slot until the operation settles and then rejects with the abort reason", async (t) => {
  const queue = new ImageWorkQueue({ concurrency: 1, maxPending: 1 });
  const gate = deferred();
  const started = deferred();
  const controller = new AbortController();
  const reason = new Error("fixture active cancellation");
  let operationSettled = false;
  let resultSettled = false;
  const active = queue.run(async () => {
    started.resolve();
    await gate.promise;
    operationSettled = true;
    return "discard this result";
  }, { signal: controller.signal });
  const outcome = active.then(
    (value) => { resultSettled = true; return { value }; },
    (error) => { resultSettled = true; return { error }; },
  );
  t.after(async () => { gate.resolve(); await outcome; });
  await started.promise;
  let followerRan = false;
  const follower = queue.run(() => {
    assert.equal(operationSettled, true);
    followerRan = true;
    return "next";
  });
  controller.abort(reason);
  await new Promise(setImmediate);
  assert.equal(resultSettled, false);
  assert.equal(followerRan, false);
  assert.deepEqual(queue.state, { active: 1, pending: 1, concurrency: 1, maxPending: 1 });
  await assert.rejects(queue.run(() => assert.fail("excess job must not run")), busy);
  gate.resolve();
  assert.strictEqual((await outcome).error, reason);
  assert.equal(await follower, "next");
  idleState(queue, 1, 1);
});

test("eight parallel 1080p PNG factories admit two active and two queued jobs before allocation", async () => {
  idleState(imageWorkQueue);
  const started = [];
  const firstTwoStarted = deferred();
  const factoryStates = [];
  const jobs = Array.from({ length: 8 }, (_, index) => rgbToPngAsync(() => {
    started.push(index);
    factoryStates.push(imageWorkQueue.state);
    if (started.length === 2) firstTwoStarted.resolve();
    return { width: 1920, height: 1080, pixels: Buffer.alloc(1920 * 1080 * 3, index * 17) };
  }));
  const outcomes = Promise.allSettled(jobs);
  await firstTwoStarted.promise;
  assert.deepEqual(started, [0, 1]);
  assert.deepEqual(imageWorkQueue.state, { active: 2, pending: 2, concurrency: 2, maxPending: 2 });
  const results = await outcomes;
  const completed = results.filter((entry) => entry.status === "fulfilled");
  const rejected = results.filter((entry) => entry.status === "rejected");
  assert.equal(completed.length, 4);
  assert.equal(rejected.length, 4);
  for (const entry of rejected) busy(entry.reason);
  assert.deepEqual(started, [0, 1, 2, 3]);
  assert.ok(factoryStates.every((state) => state.active <= 2 && state.pending <= 2));
  assert.equal(Math.max(...factoryStates.map((state) => state.active)), 2);
  for (const { value } of completed) {
    assert.equal(value.width, 1920);
    assert.equal(value.height, 1080);
    assert.equal(value.png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  }
  idleState(imageWorkQueue);
});

test("canceling a queued PNG factory prevents factory execution and frees its pending slot", async (t) => {
  const workers = await occupyImageWorkers(t);
  const controller = new AbortController();
  const reason = new Error("fixture queued PNG cancellation");
  let allocations = 0;
  const canceled = rgbToPngAsync(() => {
    allocations++;
    return { width: 1920, height: 1080, pixels: Buffer.alloc(1920 * 1080 * 3) };
  }, { signal: controller.signal });
  try {
    assert.equal(imageWorkQueue.state.pending, 1);
    assert.equal(allocations, 0);
    const rejected = assert.rejects(canceled, (error) => error === reason);
    controller.abort(reason);
    await rejected;
    assert.equal(imageWorkQueue.state.pending, 0);
    assert.equal(allocations, 0);
  } finally { await workers.release(); }
  idleState(imageWorkQueue);
});

test("stopping a session cancels its queued crop before reading bounds or allocating pixels", async (t) => {
  const workers = await occupyImageWorkers(t);
  const f = fakeImageSession();
  const signal = f.manager.imageSignal(f.session.id);
  assert.strictEqual(f.manager.imageSignal(f.session.id), signal);
  assert.equal(signal.aborted, false);
  let boundsReads = 0;
  let pixelsReads = 0;
  const originalPixels = f.snapshot.pixels;
  Object.defineProperty(f.snapshot, "pixels", { get() { pixelsReads++; return originalPixels; } });
  const region = {
    x: 0, y: 0, height: 2,
    get width() { boundsReads++; return 2; },
  };
  const crop = f.manager.cropPng(f.session.id, f.snapshot.id, region);
  try {
    assert.equal(imageWorkQueue.state.pending, 1);
    assert.equal(boundsReads, 0);
    assert.equal(pixelsReads, 0);
    const rejected = assert.rejects(crop, (error) => error === signal.reason);
    await f.manager.stop(f.session.id, { cancelRemote: false, keepRecord: true });
    await rejected;
    assert.equal(signal.aborted, true);
    assert.equal(imageWorkQueue.state.pending, 0);
    assert.equal(boundsReads, 0);
    assert.equal(pixelsReads, 0);
    assert.equal(f.session.state, "ended");
  } finally { await workers.release(); }
  idleState(imageWorkQueue);
});

test("a new session can encode a crop after prior canceled work has drained", async () => {
  idleState(imageWorkQueue);
  const f = fakeImageSession();
  const image = await f.manager.cropPng(f.session.id, f.snapshot.id, { x: 1, y: 1, width: 2, height: 2 });
  assert.equal(image.width, 2);
  assert.equal(image.height, 2);
  assert.equal(image.png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(image.png.readUInt32BE(16), 2);
  assert.equal(image.png.readUInt32BE(20), 2);
  idleState(imageWorkQueue);
});

test("falsy thrown and rejected reasons remain failures and release the worker slot", async () => {
  const queue = new ImageWorkQueue({ concurrency: 1, maxPending: 1 });
  for (const reason of [undefined, null, false, 0, ""]) {
    for (const operation of [() => { throw reason; }, () => Promise.reject(reason)]) {
      const failed = queue.run(operation);
      const follower = queue.run(() => "recovered");
      const [failure, recovery] = await Promise.allSettled([failed, follower]);
      assert.equal(failure.status, "rejected");
      assert.strictEqual(failure.reason, reason);
      assert.deepEqual(recovery, { status: "fulfilled", value: "recovered" });
      idleState(queue, 1, 1);
    }
  }
});
