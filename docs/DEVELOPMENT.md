# Develop from source

This page is for contributors and people who intentionally want a source
checkout: to inspect code, change it, run tests, or build the MCP themselves.
For an ordinary installation or update, return to [Install and update](INSTALL.md).

## Before you start

Use a separate source directory; do not edit the installer-managed application
directory from [Install and update](INSTALL.md). The source build runs on the
MCP invoker, never on the Windows host it controls.

All platforms need Node.js 20 or newer, Git, CMake, a C compiler, OpenSSL
development headers, and FFmpeg development libraries for `avcodec`, `avutil`,
and `swscale`. macOS and Linux also use `pkg-config`; the Windows vcpkg route
uses its CMake toolchain instead.

| Development platform | Typical prerequisites |
| --- | --- |
| macOS | Xcode Command Line Tools, then `brew install node cmake pkg-config ffmpeg openssl@3 git` |
| Debian/Ubuntu | `sudo apt install nodejs npm git cmake pkg-config build-essential libssl-dev libavcodec-dev libavutil-dev libswscale-dev` |
| Fedora/RHEL family | Node.js, Git, CMake, `pkgconf-pkg-config`, C/C++ toolchain, OpenSSL development files, and FFmpeg development files from enabled repositories |
| Windows | Node.js 20+, Git for Windows, Visual Studio Build Tools with C++ tools, CMake, FFmpeg, and OpenSSL; the Windows installer shows one supported WinGet/vcpkg route |

On macOS, configure the Homebrew package metadata when it is not already in
your environment:

```sh
export PKG_CONFIG_PATH="$(brew --prefix ffmpeg)/lib/pkgconfig:$(brew --prefix openssl@3)/lib/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
export CMAKE_PREFIX_PATH="$(brew --prefix ffmpeg);$(brew --prefix openssl@3)${CMAKE_PREFIX_PATH:+;$CMAKE_PREFIX_PATH}"
```

For vcpkg on Windows, set its toolchain before building:

```powershell
$env:CMAKE_TOOLCHAIN_FILE = "$env:LOCALAPPDATA\vcpkg\scripts\buildsystems\vcpkg.cmake"
```

## Clone and build

```sh
git clone https://github.com/edulelis/moonlight-desktop-mcp.git
cd moonlight-desktop-mcp
npm ci
npm run setup:native
npm run build:native
npm run doctor -- --strict
```

`setup:native` obtains the exact `moonlight-common-c` revision in
`moonlight-core.lock.json`, including its required submodules. `build:native`
creates the local `moonlight-session-bridge` executable. Neither output belongs
in Git. Set `MOONLIGHT_CORE_DIR` to use another already-initialized core
checkout; `CMAKE_GENERATOR`, `CMAKE_PREFIX_PATH`, and
`MOONLIGHT_MCP_BUILD_TYPE` pass through to CMake.

## Run a source checkout as an MCP

Point your MCP client at this checkout's `src/index.js` and give it a private
state directory. Do not use an installer-managed MCP entry at the same time;
two configured copies make version and profile troubleshooting needlessly
ambiguous.

### Codex on macOS or Linux

From the source checkout root:

```sh
codex mcp add moonlight-desktop-dev \
  --env "MOONLIGHT_MCP_DATA_DIR=$HOME/.local/state/moonlight-desktop-mcp-dev" \
  -- "$(command -v node)" "$(pwd)/src/index.js"
```

### Codex on Windows PowerShell

From the source checkout root:

```powershell
$node = (Get-Command node).Source
$entry = (Resolve-Path .\src\index.js).Path
$data = Join-Path $env:LOCALAPPDATA "Moonlight Desktop MCP Dev"
codex mcp add moonlight-desktop-dev --env "MOONLIGHT_MCP_DATA_DIR=$data" -- $node $entry
```

For another client, adapt [examples/mcp-config.json](../examples/mcp-config.json)
with absolute paths. Pair and exercise the source build through the normal
[Use the MCP](USE.md) workflow.

## Update a source checkout

Stop an active Desktop stream first. Review the checkout, then refresh and
rebuild it:

```sh
git status --short
git pull --ff-only
npm ci
npm run setup:native
npm run build:native
npm test
npm run doctor -- --strict
```

`npm run check:updates` inspects dependency update information without changing
files. Add `-- --remote` for a read-only comparison with `origin`. It is a
source-maintenance command, not the normal installer update path.

## Verify a change

Run the fast checks for every source change:

```sh
npm run check
npm test
npm pack --dry-run
```

For native or protocol changes, also rebuild and run a non-consequential live
Desktop smoke test on an authorized host: start Desktop, capture, make a
reversible UI change, verify it, undo it, verify it, and stop the session. Do
not use personal files, saved work, or production settings as test fixtures.
See [CONTRIBUTING.md](../CONTRIBUTING.md) for repository rules and
[ARCHITECTURE.md](ARCHITECTURE.md) for the transport design.

## Move legacy local state

Older source checkouts stored profiles under their project `data/` directory.
The current MCP reads that location only as a migration fallback. Keep the data
private and migrate it without printing keys:

```sh
npm run migrate:state -- --dry-run
npm run migrate:state
```

Set `MOONLIGHT_MCP_DATA_DIR` before either command to select a particular
destination. Do not commit `data/`, screenshots, OCR cache, certificates, or
private keys.
