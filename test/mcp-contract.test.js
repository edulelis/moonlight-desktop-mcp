import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("advertises the Desktop-first visual computer-use contract", async (t) => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "moonlight-mcp-contract-"));
  const client = new Client({ name: "moonlight-mcp-contract-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/index.js"],
    cwd: process.cwd(),
    env: { ...getDefaultEnvironment(), MOONLIGHT_MCP_DATA_DIR: dataDirectory },
  });
  await client.connect(transport);
  t.after(async () => {
    await client.close();
    await rm(dataDirectory, { recursive: true, force: true });
  });

  const instructions = client.getInstructions();
  assert.ok(instructions, "server instructions must be advertised during initialization");
  assert.match(instructions, /paired remote desktop/i);
  assert.match(instructions, /not the invoker's local OS/i);
  assert.match(instructions, /live session with a current frame/i);
  assert.match(instructions, /let the user complete account sign-in/i);
  assert.match(instructions, /license activation/i);
  assert.match(instructions, /terms or EULA acceptance/i);
  assert.match(instructions, /Wake-on-LAN/i);
  assert.match(instructions, /dedicated headless Moonlight remote-desktop channel/i);
  assert.match(instructions, /do not fall back to generic GUI computer use/i);

  const result = await client.listTools();
  const tools = new Map(result.tools.map((tool) => [tool.name, tool]));
  for (const required of ["runtime_status", "desktop_channel_status", "profiles_list", "profile_wol_configure", "host_wake", "session_preflight", "session_start", "screen_capture", "screen_find_text", "screen_wait_for_text", "session_mouse_click_at", "session_hotkey", "session_stop"]) {
    assert.ok(tools.has(required), `${required} must be advertised`);
  }
  assert.match(tools.get("desktop_channel_status").description, /not a fallback/i);
  assert.match(tools.get("session_start").description, /Desktop/i);
  assert.match(tools.get("session_start").description, /Wake-on-LAN/i);
  assert.match(tools.get("session_start").description, /1920x1080/i);
  assert.equal(tools.get("session_start").inputSchema.properties.stream_profile.default, "full_hd");
  assert.deepEqual(tools.get("session_start").inputSchema.properties.stream_profile.enum, ["full_hd", "low_bandwidth"]);
  assert.match(tools.get("host_wake").description, /magic packet/i);
  assert.match(tools.get("provider_app_start").description, /explicit/i);
  assert.equal(tools.get("runtime_status").annotations.readOnlyHint, true);

  const channelResult = await client.callTool({ name: "desktop_channel_status", arguments: {} });
  const channelStatus = JSON.parse(channelResult.content[0].text);
  assert.equal(channelStatus.channel.kind, "headless_moonlight_desktop");
  assert.equal(channelStatus.channel.inputTarget, "remote_desktop");
  assert.equal(channelStatus.channel.localGuiFallback, "refuse");
  assert.equal(channelStatus.channel.genericGuiComputerUseFallback, "refuse");
  assert.deepEqual(channelStatus.pairedTargets, []);
  assert.ok(Array.isArray(channelStatus.activeSessions));
  assert.ok(Array.isArray(channelStatus.transportSessions));
  assert.equal(channelStatus.readiness.activeTransportSessionCount, channelStatus.transportSessions.length);
  assert.equal(typeof channelStatus.readiness.launchPreparationInProgress, "boolean");
});
