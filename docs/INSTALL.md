# Install, configure, and update

Moonlight Desktop MCP runs locally on the MCP invoker. Install every item in
this guide on the macOS, Linux, or Windows computer that runs Codex/the MCP;
do not install anything beyond Apollo or Sunshine on the remote Windows host.

## 1. Prerequisites

All platforms require Node.js 20 or newer, Git, CMake, a C compiler, OpenSSL
development headers, FFmpeg development headers/libraries (`avcodec`,
`avutil`, `swscale`), and a clone of this project.

| Invoker platform | Suggested prerequisites |
| --- | --- |
| macOS | `brew install node cmake pkg-config ffmpeg openssl git` and Xcode Command Line Tools (`xcode-select --install`) |
| Debian/Ubuntu | `sudo apt install nodejs npm git cmake pkg-config build-essential libssl-dev libavcodec-dev libavutil-dev libswscale-dev` |
| Fedora/RHEL-family | Install Node.js, Git, CMake, a C toolchain, OpenSSL development files, and FFmpeg development files from the repositories enabled by your distribution. |
| Windows | Node.js 20+, Git for Windows, Visual Studio Build Tools with “Desktop development with C++”, CMake, and FFmpeg/OpenSSL development packages. [vcpkg](https://vcpkg.io/) is a practical way to provide the latter two. |

The host must be an Apollo or Sunshine machine reachable over the network and
must expose the normal GameStream ports. Its user will approve pairing and
grant only the requested Apollo client permissions through Apollo’s own web UI.

## 2. Install the local project and native bridge

From the project root:

```sh
npm ci
npm run setup:native
npm run build:native
npm run doctor -- --strict
```

`setup:native` clones the exact, source-controlled
[`moonlight-common-c`](https://github.com/moonlight-stream/moonlight-common-c)
revision in `moonlight-core.lock.json`, including its required submodules, into
your platform cache. Set `MOONLIGHT_CORE_DIR` to use a separately managed,
initialized checkout instead. `build:native` creates the local
`moonlight-session-bridge` binary; it is not committed to source control.

On Windows, when dependencies come from vcpkg, point CMake at its toolchain
before building. In PowerShell, for example:

```powershell
$env:CMAKE_TOOLCHAIN_FILE = "C:\vcpkg\scripts\buildsystems\vcpkg.cmake"
npm run build:native
```

`CMAKE_GENERATOR` and `MOONLIGHT_MCP_BUILD_TYPE` are also honoured if your CMake
environment needs them. The bridge source has Windows-specific atomic frame
replacement support, but the final authority is `npm run doctor -- --strict`
and a local Desktop session on the target platform.

## 3. Choose local data locations

The MCP stores its paired client certificate/private key, temporary decoded
frames, and downloaded OCR language data on the invoker. By default it uses:

| Platform | Default state directory |
| --- | --- |
| macOS | `~/Library/Application Support/Moonlight Desktop MCP` |
| Linux | `$XDG_STATE_HOME/moonlight-desktop-mcp` or `~/.local/state/moonlight-desktop-mcp` |
| Windows | `%LOCALAPPDATA%\Moonlight Desktop MCP` |

Set `MOONLIGHT_MCP_DATA_DIR` to choose another private local directory. The
previous source-checkout `data/profiles.json` location is read as a compatibility
fallback when no new state file exists, so existing pairings remain usable. To
move it permanently into the documented state location without printing its
secrets, run this once:

```sh
npm run migrate:state -- --dry-run
npm run migrate:state
```

## 4. Configure an MCP client

The server uses stdio. Substitute the absolute project path and Node executable
for your installation.

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

For another MCP client, use the equivalent configuration in
[examples/mcp-config.json](../examples/mcp-config.json). The command must be
able to launch Node, and its environment must retain the selected data path.

## 5. Install LLM operating instructions for Codex

The repository ships an opt-in Codex skill. It tells an agent to use visual
Desktop interaction, verify effects, and release streams. Preview its target
first, then install it only if you want to replace that same-named local skill:

```sh
npm run install:codex-skill -- --dry-run
npm run install:codex-skill -- --force
```

The skill requires the MCP registration named `moonlight-desktop`. It does not
install an MCP server or alter a remote Windows host.

## 6. Verify without remote input

Run `npm run doctor -- --strict`, then invoke the read-only `runtime_status`
tool. To test a paired host safely, ask an agent to use `host_status`,
`profiles_list`, `session_preflight`, `session_start`, and `screen_capture`
without mouse or keyboard tools; it must call `session_stop` afterwards.

## Updates

### Check first

```sh
npm run doctor -- --json
npm run check:updates
npm run check:updates -- --remote  # Git checkout only; read-only remote comparison
```

`check:updates` reports the installed MCP version, dependency updates from npm,
and the pinned Moonlight core revision. `--remote` uses `git ls-remote` only;
it does not fetch, checkout, pull, install, rebuild, or touch pairing data.
The MCP’s `runtime_status` tool exposes the same installed-version/build-state
information to an LLM.

### Apply a reviewed source update

Stop active streams, preserve any local changes, then:

```sh
git status --short
git pull --ff-only
npm ci
npm run setup:native
npm run build:native
npm test
npm run doctor -- --strict
```

If a new build fails, return to the previously known-good source revision and
run the same `npm ci`, `setup:native`, and `build:native` sequence. Do not
delete the data directory to roll back code: paired identities survive normal
source and dependency updates.

### Dependency updates

Treat a major dependency update as a code change. Review its release notes,
update `package.json` and `package-lock.json` deliberately, run the full test
suite, build the bridge, and manually verify a non-consequential Desktop UI
action. In particular, an OCR-engine update can change text recognition and
click-target confidence.
