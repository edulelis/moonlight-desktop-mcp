# Moonlight Desktop MCP

Moonlight Desktop MCP is a local stdio MCP server that gives an LLM visual,
desktop-first control of a paired Apollo or Sunshine Windows host through the
Moonlight/GameStream protocol. It receives decoded desktop frames locally,
performs local OCR/template/diff analysis, and sends encrypted Moonlight mouse
and keyboard input back over the same session.

It is designed for requests such as “open Valheim”, “close Steam normally”, or
“increase the Windows master volume by 10%”. The agent sees and operates the
desktop like a remote user; it does not use the Windows registry, shell,
process list, or a separately installed Windows agent.

## What it provides

- Standard Apollo PIN pairing with a dedicated `Moonlight MCP` identity.
- A headless Moonlight Desktop stream, screenshot capture, local OCR, visual
  templates, material-change detection, and text/change waiting.
- Reliable mouse movement, click, drag, scroll, typing, named keys, and
  hotkeys, all in screenshot coordinate space.
- Permission preflight and a clear “stream already in use” error. It never
  takes over another Moonlight client’s session.
- Desktop-first agent guidance: Apollo provider-app launch is available only
  for an explicit user request.
- A portable build/setup/doctor flow for macOS, Linux, and Windows clients.

The Windows machine runs Apollo/Sunshine only. The MCP, native bridge, OCR
cache, and paired-client identity live on the computer invoking the MCP.

## Quick start

Install the platform prerequisites listed in [the installation guide](docs/INSTALL.md),
then from this project directory run:

```sh
npm ci
npm run setup:native
npm run build:native
npm run doctor -- --strict
```

Register the local server with your MCP client. For Codex on macOS/Linux:

```sh
codex mcp add moonlight-desktop \
  --env "MOONLIGHT_MCP_DATA_DIR=$HOME/.local/state/moonlight-desktop-mcp" \
  -- "$(command -v node)" "$(pwd)/src/index.js"
```

The full macOS, Linux, and PowerShell instructions are in
[docs/INSTALL.md](docs/INSTALL.md). A transport-neutral configuration example
is in [examples/mcp-config.json](examples/mcp-config.json).

## Pair once, then use the Desktop

1. Ask the MCP for `host_status` and `pairing_begin` using the Apollo
   GameStream endpoint, usually `HOST:47989`.
2. Open the returned `apolloWebUrl` from the invoker’s LAN-connected browser
   and enter the one-time PIN returned by `pairing_begin`.
3. Poll `pairing_status`. When it returns a profile, call
   `session_preflight` for `computer_use`.
4. If Apollo reports missing permissions, enable only the named toggles in
   Apollo’s web UI. The MCP tells the user exactly which ones are missing and
   never changes host permissions itself.
5. Start `session_start`, capture the Desktop, interact through visible UI,
   visually verify the result, and call `session_stop`.

The expected agent behavior, including confirmation boundaries and animated
UI handling, is documented in [docs/AGENT-GUIDE.md](docs/AGENT-GUIDE.md).

## Version and update path

Check the installed MCP and native-bridge readiness:

```sh
npm run doctor -- --json
```

Ask an active MCP directly with the read-only `runtime_status` tool. To check
for dependency changes without modifying anything:

```sh
npm run check:updates
# Optional, source checkout only: compare Git HEAD with origin without fetching or pulling.
npm run check:updates -- --remote
```

Review the report before updating. The safe update sequence is:

```sh
git pull --ff-only
npm ci
npm run setup:native
npm run build:native
npm test
```

Never delete `MOONLIGHT_MCP_DATA_DIR` as part of an update: it contains the
paired MCP identity. See [the update section](docs/INSTALL.md#updates) for
details and rollback guidance.

## Documentation

- [Install, configure, verify, update](docs/INSTALL.md)
- [Compatibility and platform requirements](docs/COMPATIBILITY.md)
- [Agent operating guide](docs/AGENT-GUIDE.md)
- [Tool reference](docs/TOOLS.md)
- [Architecture and design reasoning](docs/ARCHITECTURE.md)
- [Security and data handling](docs/SECURITY.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Contributor and test guide](CONTRIBUTING.md)

## Current scope

The bridge negotiates H.264 video (up to 1280×720/30fps by default), omits
audio, and permits one local session at a time. HEVC/AV1, audio, clipboard and
file transfer, reconnect/attach to an existing session, and shared multi-user
control are deliberately out of scope. See [compatibility](docs/COMPATIBILITY.md)
before treating it as a general Moonlight replacement.
