import test from "node:test";
import assert from "node:assert/strict";

import { hostUrls, normalizeHost, parseGameStreamXml } from "../src/host.js";

test("normalizes Apollo's default GameStream endpoint", () => {
  assert.deepEqual(normalizeHost("192.168.15.4"), { address: "192.168.15.4", port: 47989 });
  assert.deepEqual(normalizeHost("https://win-302.local:48089"), { address: "win-302.local", port: 48089 });
});

test("derives Apollo's web UI URL from the GameStream HTTP port", () => {
  assert.equal(hostUrls({ address: "192.168.15.4", port: 47989 }).web, "https://192.168.15.4:47990");
});

test("rejects paths and credentials in a host argument", () => {
  assert.throws(() => normalizeHost("https://user:pass@host.example"));
  assert.throws(() => normalizeHost("host.example/serverinfo"));
});

test("parses a GameStream serverinfo response", () => {
  const root = parseGameStreamXml('<?xml version="1.0"?><root status_code="200"><hostname>WIN-302</hostname></root>');
  assert.equal(root.hostname, "WIN-302");
});
