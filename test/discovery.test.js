import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const packageInfo = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const packageLock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
const serverCard = JSON.parse(await readFile(new URL("../server.json", import.meta.url), "utf8"));
const llms = await readFile(new URL("../llms.txt", import.meta.url), "utf8");

test("keeps public MCP discovery metadata consistent", () => {
  assert.equal(serverCard.$schema, "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json");
  assert.equal(serverCard.name, packageInfo.mcpName);
  assert.equal(serverCard.version, packageInfo.version);
  assert.equal(packageLock.version, packageInfo.version);
  assert.equal(packageLock.packages[""].version, packageInfo.version);
  assert.equal(packageInfo.private, true, "custom native installation must not be published to npm accidentally");
  assert.match(serverCard.name, /^io\.github\.edulelis\/[a-z0-9._-]+$/);
  assert.ok(serverCard.description.length <= 100, "Registry descriptions are limited to 100 characters");
  assert.equal(serverCard.repository.url, "https://github.com/edulelis/moonlight-desktop-mcp");
  assert.equal(serverCard.repository.source, "github");
  assert.match(serverCard.websiteUrl, /^https:\/\/github\.com\/edulelis\/moonlight-desktop-mcp\/blob\/main\/docs\/INSTALL\.md$/);
  assert.equal(serverCard.packages, undefined, "custom native installation must not advertise an npm package");
  assert.equal(serverCard.remotes, undefined, "local stdio server must not advertise a hosted endpoint");
  assert.ok(packageInfo.files.includes("server.json"));
  assert.ok(packageInfo.files.includes("llms.txt"));
});

test("publishes a concise LLM documentation map", () => {
  assert.match(llms, /^# Moonlight Desktop MCP/m);
  assert.match(llms, /^> A local stdio Model Context Protocol server/m);
  for (const path of [
    "README.md",
    "docs/INSTALL.md",
    "docs/USE.md",
    "docs/TOOLS.md",
    "docs/AGENT-GUIDE.md",
    "AGENTS.md",
  ]) {
    assert.match(llms, new RegExp(`raw\\.githubusercontent\\.com/edulelis/moonlight-desktop-mcp/main/${path.replaceAll(".", "\\.")}`));
  }
  assert.match(llms, /rather than npm or npx/i);
});
