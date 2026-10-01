import test from "node:test";
import assert from "node:assert/strict";

import { APOLLO_PERMISSIONS, decodePermissions, preflightAccess } from "../src/permissions.js";

const bit = (key) => APOLLO_PERMISSIONS.find((permission) => permission.key === key).bit;

test("computer-use preflight names only the missing Apollo toggles", () => {
  const defaultMask = bit("list_apps") | bit("view_streams");
  const preflight = preflightAccess(defaultMask, "computer_use", {
    apolloWebUrl: "https://win-302:47990",
    deviceName: "Moonlight MCP Prototype",
  });

  assert.equal(preflight.ready, false);
  assert.deepEqual(preflight.missingPermissions.map(({ key }) => key), ["launch_apps", "mouse", "keyboard"]);
  assert.match(preflight.userAction.message, /Launch Apps, Mouse Input, Keyboard Input/);
});

test("computer-use can be ready without optional file-transfer permissions", () => {
  const computerUseMask = ["list_apps", "view_streams", "launch_apps", "mouse", "keyboard"]
    .reduce((mask, key) => mask | bit(key), 0);
  const preflight = preflightAccess(computerUseMask, "computer_use");
  const decoded = decodePermissions(computerUseMask);

  assert.equal(preflight.ready, true);
  assert.deepEqual(preflight.missingPermissions, []);
  assert.ok(decoded.notGranted.some(({ key }) => key === "file_upload"));
});
