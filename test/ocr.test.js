import test from "node:test";
import assert from "node:assert/strict";

import { extractTextLayout } from "../src/ocr.js";

test("converts OCR block coordinates into capture-space text results", () => {
  const layout = extractTextLayout([{
    paragraphs: [{
      lines: [{
        text: "Save file\n",
        confidence: 92.4,
        bbox: { x0: 4, y0: 8, x1: 80, y1: 24 },
        words: [{ text: "Save", confidence: 96.1, bbox: { x0: 4, y0: 8, x1: 35, y1: 24 } }],
      }],
    }],
  }], { offsetX: 100, offsetY: 50, minConfidence: 80 });
  assert.deepEqual(layout.lines, [{ text: "Save file", confidence: 92, x: 104, y: 58, width: 76, height: 16 }]);
  assert.deepEqual(layout.words, [{ text: "Save", confidence: 96, x: 104, y: 58, width: 31, height: 16 }]);
});
