import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("advertises the Desktop-first visual computer-use contract", async (t) => {
  const client = new Client({ name: "moonlight-mcp-contract-test", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: ["src/index.js"], cwd: process.cwd() });
  await client.connect(transport);
  t.after(async () => client.close());

  const result = await client.listTools();
  const tools = new Map(result.tools.map((tool) => [tool.name, tool]));
  for (const required of ["runtime_status", "session_start", "screen_capture", "screen_find_text", "screen_wait_for_text", "session_mouse_click_at", "session_hotkey", "session_stop"]) {
    assert.ok(tools.has(required), `${required} must be advertised`);
  }
  assert.match(tools.get("session_start").description, /Desktop/i);
  assert.match(tools.get("provider_app_start").description, /explicit/i);
  assert.equal(tools.get("runtime_status").annotations.readOnlyHint, true);
});
