import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("advertises the Desktop-first visual computer-use contract", async (t) => {
  const client = new Client({ name: "moonlight-mcp-contract-test", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: ["src/index.js"], cwd: process.cwd() });
  await client.connect(transport);
  t.after(async () => client.close());

  const instructions = client.getInstructions();
  assert.ok(instructions, "server instructions must be advertised during initialization");
  assert.match(instructions, /paired remote desktop/i);
  assert.match(instructions, /not the invoker's local OS/i);
  assert.match(instructions, /live session with a current frame/i);
  assert.match(instructions, /let the user complete account sign-in/i);
  assert.match(instructions, /license activation/i);
  assert.match(instructions, /terms or EULA acceptance/i);
  assert.match(instructions, /Wake-on-LAN/i);

  const result = await client.listTools();
  const tools = new Map(result.tools.map((tool) => [tool.name, tool]));
  for (const required of ["runtime_status", "profiles_list", "profile_wol_configure", "host_wake", "session_preflight", "session_start", "screen_capture", "screen_find_text", "screen_wait_for_text", "session_mouse_click_at", "session_hotkey", "session_stop"]) {
    assert.ok(tools.has(required), `${required} must be advertised`);
  }
  assert.match(tools.get("session_start").description, /Desktop/i);
  assert.match(tools.get("session_start").description, /Wake-on-LAN/i);
  assert.match(tools.get("host_wake").description, /magic packet/i);
  assert.match(tools.get("provider_app_start").description, /explicit/i);
  assert.equal(tools.get("runtime_status").annotations.readOnlyHint, true);
});
