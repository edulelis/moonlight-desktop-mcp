import test from "node:test";
import assert from "node:assert/strict";

import { resolveHotkey, resolveVirtualKey } from "../src/keys.js";

test("resolves named Windows virtual keys", () => {
  assert.deepEqual(resolveVirtualKey("escape"), { key: "ESCAPE", virtualKey: 27 });
  assert.deepEqual(resolveVirtualKey("F12"), { key: "F12", virtualKey: 123 });
  assert.deepEqual(resolveVirtualKey("z"), { key: "Z", virtualKey: 90 });
});

test("resolves named Windows hotkeys in press order", () => {
  assert.deepEqual(resolveHotkey("z", ["CTRL", "SHIFT"]), { key: "Z", virtualKeys: [17, 16, 90] });
  assert.throws(() => resolveHotkey("X", ["ENTER"]), /not a shortcut modifier/);
});
