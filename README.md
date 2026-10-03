# Moonlight Desktop MCP

Control a paired Apollo or Sunshine **Windows Desktop** through an MCP client.
The MCP opens a Moonlight/GameStream Desktop stream, returns screenshots, and
sends mouse and keyboard input in that screenshot's coordinate space. It is
for visible tasks such as opening an application, changing a setting, or
dismissing a dialog—not for hidden Windows shell, registry, or process access.

## Choose your path

| Your goal | Start here |
| --- | --- |
| Install, update, and run the MCP | [Install and update](docs/INSTALL.md) |
| Pair a PC and use the visual tools | [Use the MCP](docs/USE.md) |
| Clone, modify, test, or build the source yourself | [Develop from source](docs/DEVELOPMENT.md) |

Most people need only the first two links. The commands in the development
guide are deliberately not part of the normal installation path.

## Install or update

Run one command on the computer that will run the MCP—your Mac, Linux, or
Windows machine, not the Windows PC being controlled. Re-run the same command
later to update a clean installation.

macOS and Linux:

```sh
curl --proto '=https' --tlsv1.2 -fsSL \
  https://raw.githubusercontent.com/edulelis/moonlight-desktop-mcp/main/install.sh | bash
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/edulelis/moonlight-desktop-mcp/main/install.ps1 | iex
```

The installer obtains controller-side build dependencies, creates or refreshes
its own checkout, builds the native Moonlight bridge, and verifies readiness.
It preserves pairing data outside that checkout. When the Codex CLI is already
available, it adds the `moonlight-desktop` MCP entry if one does not exist.
It does not install anything on the Windows host; that host must already run
Apollo or Sunshine with a Desktop application. See
[Install and update](docs/INSTALL.md) for review, pinning, and other MCP
clients.

## Use the MCP

The normal computer-use loop is:

1. Pair once: `host_status` → `pairing_begin` → enter the returned PIN at the
   returned Apollo URL → `pairing_status`.
2. Optionally configure Wake-on-LAN with `profile_wol_configure` if the PC may
   be asleep or powered off.
3. Before each task, call `session_preflight` and then `session_start`.
4. Capture the Desktop, locate a visible target, input in that current frame's
   coordinate space, and capture again to verify the result.
5. Call `session_stop` when finished.

`session_start` always opens the Desktop. An application need not be registered
in Apollo to be opened from the Desktop or Start menu. Use
`provider_app_start` only when the user explicitly asks to launch an
Apollo-registered provider app. The detailed setup, safety boundaries, and
examples are in [Use the MCP](docs/USE.md).

## What it provides

| Need | MCP tools |
| --- | --- |
| Pair, inspect, and wake a host | `host_status`, pairing tools, `profile_status`, `profile_wol_configure`, `host_wake` |
| Check/start/stop a desktop | `session_preflight`, `session_start`, `session_status`, `session_stop` |
| See the remote screen | `screen_capture`, OCR, text/template lookup, crops, diffs, and waits |
| Interact and confirm | mouse, drag, scroll, text, named-key/hotkey tools, and visual waits |

The complete tool contract is in [docs/TOOLS.md](docs/TOOLS.md). The bundled
agent guidance is in [docs/AGENT-GUIDE.md](docs/AGENT-GUIDE.md).

## Scope and safety

- One Desktop stream at a time. If another GameStream client owns the channel,
  the MCP reports it and does not take it over.
- Pairing keys, frames, OCR cache, and Wake-on-LAN settings stay on the
  controlling machine.
- H.264 video is supported with 1280×720/30fps defaults. Audio, clipboard,
  file transfer, HEVC/AV1, and session recovery are out of scope.
- Every meaningful action should be visually verified using a fresh capture.

For compatibility, troubleshooting, architecture, and security details, see
[docs/COMPATIBILITY.md](docs/COMPATIBILITY.md),
[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md),
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and
[docs/SECURITY.md](docs/SECURITY.md).
