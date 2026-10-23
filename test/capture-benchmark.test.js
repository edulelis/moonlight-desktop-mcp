import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { createRgbFixture, parseArguments, runBenchmark } from "../scripts/benchmark-capture.js";

test("benchmark fixtures are deterministic, sized, and differ by image structure", () => {
  for (const kind of ["desktop_like", "high_entropy"]) {
    const first = createRgbFixture(32, 24, kind);
    assert.equal(first.pixels.length, 32 * 24 * 3);
    assert.deepEqual(first, createRgbFixture(32, 24, kind));
  }
  assert.notDeepEqual(createRgbFixture(32, 24, "desktop_like").pixels, createRgbFixture(32, 24, "high_entropy").pixels);
});

test("benchmark CLI validates bounds and supports presets and small custom fixtures", () => {
  const options = parseArguments(["--sizes", "720p,32x24", "--iterations", "2"]);
  assert.equal(options.iterations, 2);
  assert.deepEqual(options.sizes.map(({ width, height }) => [width, height]), [[1280, 720], [32, 24]]);
  for (const args of [["--iterations", "0"], ["--iterations", "1.1"], ["--sizes", "9000x9000"], ["--sizes", "0x24"], ["--unknown"], ["--sizes"]]) assert.throws(() => parseArguments(args));
});

test("synthetic capture harness exercises fresh and repeated frames without a bridge", async () => {
  const report = await runBenchmark(parseArguments(["--sizes", "32x24", "--iterations", "2"]));
  assert.equal(report.benchmark, "synthetic_controller_capture");
  for (const fixture of ["desktop_like", "high_entropy"]) {
    for (const operation of ["rgbToPng", "capture_fresh_frame", "capture_same_frame"]) {
      const row = report.results.find((entry) => entry.fixture === fixture && entry.operation === operation);
      assert.ok(row, `${fixture}/${operation}`);
      assert.equal(row.iterations, 2);
      assert.ok(row.encodedBytes.median > 8);
      assert.ok(row.wallMs.median >= 0);
      assert.ok(row.cpuUserMs.total >= 0);
      assert.ok(row.eventLoopTimerLatenessMs.max >= 0);
    }
  }
});

test("benchmark command emits a complete JSON report", () => {
  const child = spawnSync(process.execPath, ["scripts/benchmark-capture.js", "--sizes", "16x12", "--iterations", "1"], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  const report = JSON.parse(child.stdout);
  assert.equal(report.results.filter((row) => row.operation === "capture_same_frame").length, 2);
  assert.match(report.methodology.exclusions, /token billing/);
});
