import test from "node:test";
import assert from "node:assert/strict";

import { ppmToPng } from "../src/session.js";

test("converts an RGB PPM frame to a PNG image", () => {
  const ppm = Buffer.concat([
    Buffer.from("P6\n2 1\n255\n"),
    Buffer.from([255, 0, 0, 0, 255, 0]),
  ]);
  const image = ppmToPng(ppm);

  assert.equal(image.width, 2);
  assert.equal(image.height, 1);
  assert.equal(image.png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
});
