# Install and update

Install Moonlight Desktop MCP on the machine that will invoke it. That machine
holds the paired GameStream identity, receives the Desktop video, runs OCR, and
sends input. The Windows machine provides Apollo or Sunshine and its Desktop
application.

## One command

Run the matching command in a terminal on the controlling machine. Re-run the
same command to update a clean installation.

### macOS and Linux

```sh
curl --proto '=https' --tlsv1.2 -fsSL \
  https://raw.githubusercontent.com/edulelis/moonlight-desktop-mcp/main/install.sh | bash
```

### Windows PowerShell

```powershell
irm https://raw.githubusercontent.com/edulelis/moonlight-desktop-mcp/main/install.ps1 | iex
```

The bootstrapper obtains the build prerequisites, checks out the project,
builds the native Moonlight bridge, and runs `npm run doctor -- --strict`.
It uses these platform tools:

| Platform | Bootstrap dependencies |
| --- | --- |
| macOS | Homebrew, Xcode Command Line Tools, Homebrew Node/CMake/FFmpeg/OpenSSL packages |
| Linux | `apt`, `dnf`, or `pacman` with `sudo` when build packages are missing |
| Windows | WinGet for Git, Node LTS, CMake, and Visual Studio Build Tools; vcpkg for FFmpeg and OpenSSL |

Those tools may show their normal elevation, license, or first-install prompts.
On macOS, install Xcode Command Line Tools with `xcode-select --install` if
they are absent, allow the installation to finish, then re-run the command.

The default source locations are:

| Platform | Checkout location |
| --- | --- |
| macOS | `~/Library/Application Support/Moonlight Desktop MCP/app` |
| Linux | `$XDG_DATA_HOME/moonlight-desktop-mcp/app`, or `~/.local/share/moonlight-desktop-mcp/app` |
| Windows | `%LOCALAPPDATA%\Moonlight Desktop MCP\app` |

The bootstrapper leaves a pre-existing `moonlight-desktop` Codex registration
unchanged. When the Codex CLI is present and that registration is absent, it
adds one pointing at the new checkout. Pairing data is stored separately, so an
ordinary code update does not replace the client identity.

### Review or pin an installation

The commands above deliberately track the public `main` branch. Read the
[macOS/Linux script](../install.sh) or [Windows script](../install.ps1) before
running it if that is your preferred workflow.

To hold both the downloaded script and checkout to a released tag or commit,
replace `v0.7.0` below with the version you chose:

```sh
curl --proto '=https' --tlsv1.2 -fsSL \
  https://raw.githubusercontent.com/edulelis/moonlight-desktop-mcp/v0.7.0/install.sh \
  | MOONLIGHT_MCP_REF=v0.7.0 bash
```

```powershell
$env:MOONLIGHT_MCP_REF = "v0.7.0"; irm https://raw.githubusercontent.com/edulelis/moonlight-desktop-mcp/v0.7.0/install.ps1 | iex
```

For a separate checkout location, set `MOONLIGHT_MCP_INSTALL_DIR` before
running the bootstrapper. An update stops if that checkout has local changes;
commit or stash them first, or select a different directory. The bootstrapper
accepts `MOONLIGHT_MCP_REPOSITORY` for a source mirror or local test checkout.

## Manual installation

Use this path when your package manager is not one of the supported bootstrap
options, when you maintain dependencies yourself, or when you want to review
every command.

### Prerequisites

All platforms need Node.js 20 or newer, Git, CMake, a C compiler, OpenSSL
development headers, and FFmpeg development headers/libraries for `avcodec`,
`avutil`, and `swscale`.

| Controlling platform | Example prerequisites |
| --- | --- |
| macOS | `brew install node cmake pkg-config ffmpeg openssl@3 git`; install Xcode Command Line Tools with `xcode-select --install` |
| Debian/Ubuntu | `sudo apt install nodejs npm git cmake pkg-config build-essential libssl-dev libavcodec-dev libavutil-dev libswscale-dev` |
| Fedora/RHEL family | Node.js, Git, CMake, `pkgconf-pkg-config`, a C/C++ toolchain, OpenSSL development files, and FFmpeg development files from enabled repositories |
| Windows | Node.js 20+, Git for Windows, Visual Studio Build Tools with C++ tools, CMake, FFmpeg, and OpenSSL. The included Windows bootstrapper provisions these with WinGet and vcpkg. |

Clone the repository and build from its root:

```sh
npm ci
npm run setup:native
npm run build:native
npm run doctor -- --strict
```

`setup:native` clones the exact
[`moonlight-common-c`](https://github.com/moonlight-stream/moonlight-common-c)
revision recorded in `moonlight-core.lock.json`, including required submodules,
into the platform cache. Set `MOONLIGHT_CORE_DIR` when another initialized
checkout should be used. `build:native` creates a local
`moonlight-session-bridge` executable; it is not committed to the project.

For Windows dependencies installed by vcpkg, set its CMake toolchain before
building:

```powershell
$env:CMAKE_TOOLCHAIN_FILE = "C:\vcpkg\scripts\buildsystems\vcpkg.cmake"
npm run build:native
```

`CMAKE_GENERATOR`, `CMAKE_PREFIX_PATH`, and `MOONLIGHT_MCP_BUILD_TYPE` are
also passed through to CMake when an environment needs them.

## Local state

The MCP stores its paired client certificate/private key, decoded frames, and
downloaded OCR language data on the controlling machine.

| Platform | Default state directory |
| --- | --- |
| macOS | `~/Library/Application Support/Moonlight Desktop MCP` |
| Linux | `$XDG_STATE_HOME/moonlight-desktop-mcp`, or `~/.local/state/moonlight-desktop-mcp` |
| Windows | `%LOCALAPPDATA%\Moonlight Desktop MCP` |

Set `MOONLIGHT_MCP_DATA_DIR` for another private location. The old
source-checkout `data/profiles.json` path is read as a migration fallback. To
move an existing profile without printing its secrets:

```sh
npm run migrate:state -- --dry-run
npm run migrate:state
```

## MCP and agent configuration

The server uses stdio. Replace the source path and Node path below when the
checkout is elsewhere.

### Codex on macOS or Linux

```sh
codex mcp add moonlight-desktop \
  --env "MOONLIGHT_MCP_DATA_DIR=$HOME/.local/state/moonlight-desktop-mcp" \
  -- "$(command -v node)" "$(pwd)/src/index.js"

codex mcp get moonlight-desktop --json
```

### Codex on Windows PowerShell

```powershell
$node = (Get-Command node).Source
$entry = (Resolve-Path .\src\index.js).Path
$data = Join-Path $env:LOCALAPPDATA "Moonlight Desktop MCP"
codex mcp add moonlight-desktop --env "MOONLIGHT_MCP_DATA_DIR=$data" -- $node $entry
codex mcp get moonlight-desktop --json
```

For another MCP client, use the equivalent stdio configuration in
[examples/mcp-config.json](../examples/mcp-config.json).

The repository also includes optional operating instructions for Codex. Preview
the target, then replace that same-named local skill only when desired:

```sh
npm run install:codex-skill -- --dry-run
npm run install:codex-skill -- --force
```

## Verify and inspect

`npm run doctor -- --strict` checks local bridge readiness. After pairing, a
safe connection test is `host_status`, `profiles_list`, `session_preflight`,
`session_start`, and `screen_capture`, followed by `session_stop`; it sends no
mouse or keyboard input.

For an installed checkout, inspect state and available updates with:

```sh
npm run doctor -- --json
npm run check:updates
npm run check:updates -- --remote
```

The `--remote` form performs a read-only Git comparison for source checkouts.
The MCP's `runtime_status` tool reports the same local version and bridge state
to an MCP client.

## Manual update and rollback

Stop active streams before an update. A clean source checkout can be refreshed
and rebuilt with:

```sh
git pull --ff-only
npm ci
npm run setup:native
npm run build:native
npm test
npm run doctor -- --strict
```

If a build fails after a source update, return the checkout to a previously
known-good revision and repeat the build sequence. Keep
`MOONLIGHT_MCP_DATA_DIR`: it contains the paired client identity and is not a
code cache.
