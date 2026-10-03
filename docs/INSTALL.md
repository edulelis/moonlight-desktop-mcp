# Install and update

This page is for people who want to **run** Moonlight Desktop MCP. It does not
require cloning the repository or running development commands. If you want to
inspect, modify, or build the source yourself, use
[Develop from source](DEVELOPMENT.md) instead.

Install on the computer that will invoke the MCP (a Mac, Linux, or Windows
computer). That machine holds the paired GameStream client identity, receives
the remote Desktop video, and sends input. The Windows computer being
controlled needs Apollo or Sunshine already running; this installer does not
install software there.

## Install once

Run the matching command in a terminal on the controlling computer.

### macOS and Linux

```sh
curl --proto '=https' --tlsv1.2 -fsSL \
  https://raw.githubusercontent.com/edulelis/moonlight-desktop-mcp/main/install.sh | bash
```

### Windows PowerShell

```powershell
irm https://raw.githubusercontent.com/edulelis/moonlight-desktop-mcp/main/install.ps1 | iex
```

The installer may ask the operating system's package manager for normal
administrator approval or licence acceptance. It installs missing local build
dependencies, creates a managed application checkout, builds the native
Moonlight bridge, and runs a readiness check. It does **not** replace paired
profiles or install a Windows-side agent.

| Controlling platform | Managed application location |
| --- | --- |
| macOS | `~/Library/Application Support/Moonlight Desktop MCP/app` |
| Linux | `$XDG_DATA_HOME/moonlight-desktop-mcp/app`, or `~/.local/share/moonlight-desktop-mcp/app` |
| Windows | `%LOCALAPPDATA%\Moonlight Desktop MCP\app` |

On macOS, the first run can request Xcode Command Line Tools. Let that Apple
installer finish, then run the one command again. Linux requires a supported
`apt`, `dnf`, or `pacman` setup; Windows requires WinGet. See
[Troubleshooting](TROUBLESHOOTING.md) when a prerequisite cannot be installed.

## Connect it to an MCP client

When the Codex CLI is available, the installer automatically adds
`moonlight-desktop` if that name is not already configured. Restart the MCP
client if it was running during installation, then confirm it can see the
server:

```sh
codex mcp get moonlight-desktop --json
```

An existing entry is intentionally left unchanged. Update its command yourself
if it points to an old or custom location.

For another MCP client, configure a local stdio server with its command set to
the `node` executable and its argument set to `src/index.js` inside the managed
application location above. Give it a private `MOONLIGHT_MCP_DATA_DIR`. The
shape is shown in [examples/mcp-config.json](../examples/mcp-config.json); use
your MCP client's configuration syntax and absolute paths.

After the client connects, call `runtime_status`. It reports the installed
version and whether the local native bridge is ready without contacting the
Windows host. Continue with [Use the MCP](USE.md) to pair and operate a PC.

## Update

Re-run the same one-command installer on the controlling computer. It refreshes
only a clean managed checkout, rebuilds the bridge, and retains pairing data.
Stop an active Desktop stream first. Normal users do not need to run `git pull`,
`npm ci`, or native build commands to update.

If the installer says that its managed checkout has local changes, do not
discard files blindly. Either preserve those changes in a source clone and
follow [Develop from source](DEVELOPMENT.md), or install into another location
using `MOONLIGHT_MCP_INSTALL_DIR`.

## Review or pin a release

The standard commands track the public `main` branch. You can read the
[macOS/Linux installer](../install.sh) or [Windows installer](../install.ps1)
before running it. To install a specific release, pin **both** the downloaded
script and the checked-out revision. Replace `v0.8.0` with the release you
intend to use.

```sh
curl --proto '=https' --tlsv1.2 -fsSL \
  https://raw.githubusercontent.com/edulelis/moonlight-desktop-mcp/v0.8.0/install.sh \
  | MOONLIGHT_MCP_REF=v0.8.0 bash
```

```powershell
$env:MOONLIGHT_MCP_REF = "v0.8.0"; irm https://raw.githubusercontent.com/edulelis/moonlight-desktop-mcp/v0.8.0/install.ps1 | iex
```

`MOONLIGHT_MCP_INSTALL_DIR` selects a different managed application location.
`MOONLIGHT_MCP_DATA_DIR` selects a different private state location.
`MOONLIGHT_MCP_CONFIGURE_CODEX=0` leaves Codex registration untouched on every
platform. The Windows script also accepts `-SkipCodexConfiguration` when saved
and run as a local PowerShell script.

## Pairing data and privacy

The MCP stores its paired client certificate/private key, local screenshots,
OCR data, and optional Wake-on-LAN settings on the controlling computer.

| Platform | Default private state directory |
| --- | --- |
| macOS | `~/Library/Application Support/Moonlight Desktop MCP` |
| Linux | `$XDG_STATE_HOME/moonlight-desktop-mcp`, or `~/.local/state/moonlight-desktop-mcp` |
| Windows | `%LOCALAPPDATA%\Moonlight Desktop MCP` |

Keep that directory when updating. To move a legacy source-checkout profile
without printing its secrets, run the migration command described in
[Develop from source](DEVELOPMENT.md#move-legacy-local-state).
