// Local operator harness for the prototype's Desktop path. It deliberately
// uses the same SessionManager as the MCP tools so visual computer-use can be
// exercised from a persistent terminal session.
import { promises as fs } from "node:fs";

import { ProfileStore } from "../src/store.js";
import { DESKTOP_APP_ID, SessionManager } from "../src/session.js";

const [profile] = await new ProfileStore().readAll();
if (!profile) throw new Error("No paired Moonlight MCP profile is available.");

const manager = new SessionManager();
let sessionId;
let queue = Promise.resolve();

async function execute(raw) {
  const [command, ...parts] = raw.trim().split(" ");
  if (!command) return;

  if (command === "capture") {
    const image = await manager.capture(sessionId);
    const output = "data/desktop-current.png";
    await fs.writeFile(output, image.png, { mode: 0o600 });
    console.log(JSON.stringify({ command, width: image.width, height: image.height, frameSequence: image.frameSequence, output }));
    return;
  }
  if (command === "mouse") {
    const [x, y] = parts.map(Number);
    const session = manager.status(sessionId);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= session.width || y >= session.height) {
      throw new Error("Mouse coordinates are outside the current Desktop frame.");
    }
    manager.send(sessionId, `mouse ${x} ${y} ${session.width} ${session.height}`);
    console.log(JSON.stringify({ command, x, y }));
    return;
  }
  if (command === "click") {
    const button = parts[0] || "left";
    if (!["left", "middle", "right"].includes(button)) throw new Error("Click button must be left, middle, or right.");
    manager.send(sessionId, `button ${button} down`);
    await new Promise((resolve) => setTimeout(resolve, 40));
    manager.send(sessionId, `button ${button} up`);
    console.log(JSON.stringify({ command, button }));
    return;
  }
  if (command === "drag") {
    const [startX, startY, endX, endY, durationMs = 500] = parts.map(Number);
    const session = manager.status(sessionId);
    if (![startX, startY, endX, endY, durationMs].every(Number.isInteger) || durationMs < 50 || durationMs > 5_000 ||
      startX < 0 || startY < 0 || endX < 0 || endY < 0 || startX >= session.width || endX >= session.width || startY >= session.height || endY >= session.height) {
      throw new Error("Drag coordinates or duration are invalid for the current Desktop frame.");
    }
    const steps = Math.min(60, Math.max(2, Math.ceil(durationMs / 30)));
    manager.send(sessionId, `mouse ${startX} ${startY} ${session.width} ${session.height}`);
    await new Promise((resolve) => setTimeout(resolve, 30));
    manager.send(sessionId, "button left down");
    await new Promise((resolve) => setTimeout(resolve, 50));
    try {
      for (let step = 1; step <= steps; step++) {
        const ratio = step / steps;
        manager.send(sessionId, `mouse ${Math.round(startX + (endX - startX) * ratio)} ${Math.round(startY + (endY - startY) * ratio)} ${session.width} ${session.height}`);
        if (step < steps) await new Promise((resolve) => setTimeout(resolve, durationMs / steps));
      }
    } finally {
      manager.send(sessionId, "button left up");
    }
    console.log(JSON.stringify({ command, startX, startY, endX, endY, durationMs }));
    return;
  }
  if (command === "key") {
    const virtualKey = Number(parts[0]);
    const modifiers = Number(parts[1] || 0);
    if (!Number.isInteger(virtualKey) || virtualKey < 0 || virtualKey > 65535) throw new Error("Key must be a Windows virtual-key code.");
    if (!Number.isInteger(modifiers) || modifiers < 0 || modifiers > 31) throw new Error("Modifiers must be a Moonlight modifier bitmask.");
    manager.send(sessionId, `key ${virtualKey} down ${modifiers}`);
    manager.send(sessionId, `key ${virtualKey} up ${modifiers}`);
    console.log(JSON.stringify({ command, virtualKey, modifiers }));
    return;
  }
  if (command === "shortcut") {
    const virtualKeys = parts.map(Number);
    if (virtualKeys.length < 2 || virtualKeys.length > 5 || !virtualKeys.every((key) => Number.isInteger(key) && key >= 0 && key <= 65535)) {
      throw new Error("Shortcut needs two to five Windows virtual-key codes.");
    }
    for (const virtualKey of virtualKeys) {
      manager.send(sessionId, `key ${virtualKey} down 0`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    for (const virtualKey of [...virtualKeys].reverse()) {
      manager.send(sessionId, `key ${virtualKey} up 0`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    console.log(JSON.stringify({ command, virtualKeys }));
    return;
  }
  if (command === "type") {
    const text = raw.slice("type ".length);
    if (!text) throw new Error("Text input cannot be empty.");
    manager.send(sessionId, `text ${Buffer.from(text, "utf8").toString("hex")}`);
    console.log(JSON.stringify({ command, byteLength: Buffer.byteLength(text, "utf8") }));
    return;
  }
  if (command === "scroll") {
    const amount = Number(parts[0]);
    if (!Number.isInteger(amount) || amount < -32768 || amount > 32767) throw new Error("Scroll amount must fit a signed 16-bit integer.");
    manager.send(sessionId, `scroll ${amount}`);
    console.log(JSON.stringify({ command, amount }));
    return;
  }
  if (command === "stop") {
    await manager.stop(sessionId);
    console.log(JSON.stringify({ command, stopped: true }));
    process.exit(0);
  }
  throw new Error(`Unknown command '${command}'.`);
}

process.stdin.setEncoding("utf8");
let pending = "";
process.stdin.on("data", (chunk) => {
  pending += chunk;
  let newline;
  while ((newline = pending.indexOf("\n")) !== -1) {
    const line = pending.slice(0, newline);
    pending = pending.slice(newline + 1);
    queue = queue.then(() => execute(line)).catch((error) => console.error(error.message));
  }
});
process.on("SIGTERM", async () => {
  if (sessionId) await manager.stop(sessionId).catch(() => {});
  process.exit(0);
});

const started = await manager.start(profile, { appId: DESKTOP_APP_ID, appName: "Desktop" });
sessionId = started.sessionId;
console.log(JSON.stringify({ ready: true, app: "Desktop", sessionId, state: started.state, width: started.width, height: started.height }));
setInterval(() => {}, 60_000);
