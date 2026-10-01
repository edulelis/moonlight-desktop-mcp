import test from "node:test";
import assert from "node:assert/strict";

import { applicationCacheDirectory, applicationDataDirectory, defaultBridgePath, defaultMoonlightCoreDirectory, nativeBridgeFilename } from "../src/paths.js";

test("uses platform-appropriate local state and cache directories", () => {
  assert.equal(applicationDataDirectory({ platform: "darwin", environment: {}, home: "/Users/ada" }), "/Users/ada/Library/Application Support/Moonlight Desktop MCP");
  assert.equal(applicationDataDirectory({ platform: "linux", environment: {}, home: "/home/ada" }), "/home/ada/.local/state/moonlight-desktop-mcp");
  assert.equal(applicationCacheDirectory({ platform: "linux", environment: {}, home: "/home/ada" }), "/home/ada/.cache/moonlight-desktop-mcp");
  assert.match(applicationDataDirectory({ platform: "win32", environment: { LOCALAPPDATA: "C:\\Users\\Ada\\AppData\\Local" }, home: "C:\\Users\\Ada" }), /Moonlight Desktop MCP$/);
});

test("allows explicit Moonlight core and selects a Windows bridge filename", () => {
  assert.equal(defaultMoonlightCoreDirectory({ environment: { MOONLIGHT_CORE_DIR: "/opt/core" }, home: "/home/ada" }), "/opt/core");
  assert.equal(nativeBridgeFilename("win32"), "moonlight-session-bridge.exe");
  assert.equal(defaultBridgePath({ platform: "win32", rootDirectory: "/project" }), "/project/native/build/moonlight-session-bridge.exe");
});
