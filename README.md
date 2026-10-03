# Moonlight Desktop MCP

Moonlight Desktop MCP exposes a paired Apollo or Sunshine Desktop to an MCP
client over the GameStream protocol. It starts a Desktop stream, returns
screenshots, and accepts mouse and keyboard input in the same coordinate space.

The intended loop is straightforward:

1. Start the Desktop session.
2. Capture the current frame.
3. Find the visible control, icon, or text.
4. Send the smallest input that performs the requested action.
5. Capture again and check the result.

That makes it suitable for ordinary desktop tasks: opening an application from
the desktop or Start menu, changing a visible setting, dismissing a dialog, or
closing an application through its own UI. An application does not need to be
registered in Apollo for this path to work.

## What runs where

| Location | Components |
| --- | --- |
| Windows host | Apollo or Sunshine and the Windows desktop being controlled |
| Controlling machine | This MCP server, Moonlight transport bridge, screenshots, OCR cache, and paired client identity |

The controlling machine pairs with Apollo as its own GameStream client. Its
profile, frames, and OCR data stay local to that machine.

## MCP surface

| Need | Tools |
| --- | --- |
| Pair, wake, and inspect a host | `host_status`, pairing tools, `profile_wol_configure`, `host_wake`, `profile_status` |
| Check whether a session can start | `session_preflight`, `runtime_status` |
| Start and stop a desktop | `session_start`, `session_status`, `session_stop` |
| Read the screen | `screen_capture`, `screen_ocr`, `screen_find_text`, templates, crops, and diffs |
| Interact | mouse, drag, scroll, text, named key, and hotkey tools |
| Confirm an outcome | `session_wait_for_change`, `screen_wait_for_text` |

`session_start` is the Desktop path. `provider_app_start` exists for a user who
explicitly requests an Apollo-registered application. The full tool list is in
[docs/TOOLS.md](docs/TOOLS.md).

## Install or update

Run the command for the computer that will run the MCP. It installs the local
build prerequisites when its supported package manager is available, creates
or updates a clean checkout, builds the native bridge, and preserves pairing
state outside that checkout. If the Codex CLI is installed, it also adds the
`moonlight-desktop` stdio entry when one does not already exist.

macOS and Linux:

```sh
curl --proto '=https' --tlsv1.2 -fsSL \
  https://raw.githubusercontent.com/edulelis/moonlight-desktop-mcp/main/install.sh | bash
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/edulelis/moonlight-desktop-mcp/main/install.ps1 | iex
```

Run the same command again to update. The installers use Homebrew on macOS;
`apt`, `dnf`, or `pacman` on Linux; and WinGet plus vcpkg on Windows. They can
prompt for the package manager's administrator approval or license terms. The
native bridge is built locally; this release does not yet ship platform
binaries. See [docs/INSTALL.md](docs/INSTALL.md) for a reviewed/manual path,
pinning to a tag or commit, and unsupported package-manager cases.

## Quick start

Install the controller-side prerequisites from [docs/INSTALL.md](docs/INSTALL.md),
then build locally:

```sh
npm ci
npm run setup:native
npm run build:native
npm run doctor -- --strict
```

Register the stdio server with an MCP client. For Codex on macOS or Linux:

```sh
codex mcp add moonlight-desktop \
  --env "MOONLIGHT_MCP_DATA_DIR=$HOME/.local/state/moonlight-desktop-mcp" \
  -- "$(command -v node)" "$(pwd)/src/index.js"
```

For PowerShell and generic MCP-client configuration, see
[docs/INSTALL.md](docs/INSTALL.md) and
[examples/mcp-config.json](examples/mcp-config.json).

## First pairing and session

1. Call `host_status` with the host’s GameStream endpoint, typically
   `HOST:47989`.
2. Call `pairing_begin`, open the returned Apollo URL, and enter the PIN.
3. Wait for `pairing_status` to return a profile.
4. Optionally call `profile_wol_configure` with the host MAC address and LAN
   broadcast address. Later preflight/start calls wake this profile when the
   PC is offline.
5. Call `session_preflight` with `computer_use`. If Apollo reports missing
   permissions, change only the listed toggles in Apollo.
6. Call `session_start`, then use capture → locate → input → verify.
7. Call `session_stop` when the task is done or cannot be verified.

If Apollo already has an active GameStream application, the MCP reports that
condition and does not replace the other session.

## Agent behavior

The bundled Codex skill encodes the operating loop above. It uses the Desktop
by default, asks when the target is materially ambiguous, and requires a
visible check before reporting success. Read [docs/AGENT-GUIDE.md](docs/AGENT-GUIDE.md)
for the complete behavior contract.

## Inspecting an installation

```sh
npm run doctor -- --json
npm run check:updates
npm run check:updates -- --remote  # source checkout only
```

These commands report local state; they do not update dependencies, rebuild
the bridge, or change pairing data. For a source checkout, after reviewing an
update, use:

```sh
git pull --ff-only
npm ci
npm run setup:native
npm run build:native
npm test
```

Keep `MOONLIGHT_MCP_DATA_DIR` when updating. It holds the paired client
identity. [docs/INSTALL.md](docs/INSTALL.md) covers migration and rollback.

## Boundaries

- One local Desktop stream at a time; an existing GameStream session is left
  alone.
- H.264 video only, with 1280×720/30fps defaults. Audio is not exposed.
- No HEVC/AV1, clipboard, file transfer, session attach/recovery, or shared
  multi-user control.
- A local native build and a Desktop smoke test are required on each controller
  platform.

See [compatibility](docs/COMPATIBILITY.md),
[architecture](docs/ARCHITECTURE.md),
[security](docs/SECURITY.md), and
[troubleshooting](docs/TROUBLESHOOTING.md) for the technical details.
