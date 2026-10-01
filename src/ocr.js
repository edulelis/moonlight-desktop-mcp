import { createWorker } from "tesseract.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import { applicationDataDirectory } from "./paths.js";

const cachePath = path.join(applicationDataDirectory(), "ocr-cache");
const workers = new Map();
const queues = new Map();

function validLanguage(language) {
  if (typeof language !== "string" || !/^[a-z0-9_+]{2,64}$/i.test(language)) {
    throw new Error("language must be a Tesseract language code such as 'eng', 'por', or 'eng+por'.");
  }
  return language;
}

async function workerFor(language) {
  const key = validLanguage(language);
  if (!workers.has(key)) {
    await fs.mkdir(cachePath, { recursive: true, mode: 0o700 });
    await fs.chmod(cachePath, 0o700);
    workers.set(key, createWorker(key, 1, { cachePath, logger: () => {} }));
  }
  return workers.get(key);
}

function bounds(bbox, offsetX, offsetY) {
  return {
    x: Math.round(bbox.x0 + offsetX),
    y: Math.round(bbox.y0 + offsetY),
    width: Math.round(bbox.x1 - bbox.x0),
    height: Math.round(bbox.y1 - bbox.y0),
  };
}

export function extractTextLayout(blocks, { offsetX = 0, offsetY = 0, minConfidence = 0 } = {}) {
  const lines = [];
  const words = [];
  for (const block of blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        const lineText = line.text?.trim();
        if (lineText && line.confidence >= minConfidence) {
          lines.push({ text: lineText, confidence: Math.round(line.confidence), ...bounds(line.bbox, offsetX, offsetY) });
        }
        for (const word of line.words ?? []) {
          const wordText = word.text?.trim();
          if (wordText && word.confidence >= minConfidence) {
            words.push({ text: wordText, confidence: Math.round(word.confidence), ...bounds(word.bbox, offsetX, offsetY) });
          }
        }
      }
    }
  }
  return { lines, words };
}

export async function recognizePng(png, { language = "eng", offsetX = 0, offsetY = 0, minConfidence = 0 } = {}) {
  if (!Buffer.isBuffer(png)) throw new Error("OCR input must be a PNG buffer.");
  if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 100) throw new Error("minConfidence must be from 0 through 100.");
  const key = validLanguage(language);
  const previous = queues.get(key) ?? Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    const worker = await workerFor(key);
    const { data } = await worker.recognize(png, {}, { blocks: true });
    return {
      text: data.text.trim(),
      ...extractTextLayout(data.blocks, { offsetX, offsetY, minConfidence }),
    };
  });
  queues.set(key, task);
  try {
    return await task;
  } finally {
    if (queues.get(key) === task) queues.delete(key);
  }
}
