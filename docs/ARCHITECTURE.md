# Architecture and design reasoning

## Goal

Provide a computer-use layer over an already-working Moonlight/Apollo path,
without deploying a custom service, remote shell, browser extension, or CV
agent on the Windows host.

## Data and control flow

```text
LLM / MCP client
  -> local Node MCP server
     -> Apollo HTTPS/GameStream control plane (pair, permissions, launch)
     -> local native Moonlight bridge (H.264 decode + encrypted input)
     -> local vision helpers (PNG, OCR, template, diff)
  -> rendered screenshots and verified action results
                         <-> Apollo/Sunshine on Windows
```

The Node process owns tool contracts, pairing profiles, screenshots, OCR, and
agent-facing safety semantics. The small C bridge uses the upstream Moonlight
common C library for the real GameStream video/input protocol and FFmpeg only
to decode H.264 frames into local RGB images.

## Why Desktop first

Apollo provider apps are a host-defined launch registry. They are useful only
when a user asks for one by name. Typical computer-use requests—open something
on the desktop, change an app setting, dismiss a dialog—need the actual visible
Windows desktop. `session_start` therefore launches only Apollo’s Desktop app;
`provider_app_start` is a separate, explicit tool.

This removes the common failure mode of treating a visible app as though it
must be pre-registered in Apollo. It also keeps the agent grounded in the same
interface the user sees.

## Why vision lives inside this MCP

Passing every remote screenshot to an independent CV service would require
another connection, transform coordinate systems, and make verification
ambiguous. The retained screenshot/template/OCR primitives run beside the
Moonlight stream, return capture-space coordinates, and are scoped to the
session that owns the input channel. That makes this loop deterministic:

1. Capture an image.
2. Locate a visible target.
3. Act in the same coordinate system.
4. Capture or wait again to verify the effect.

The MCP is intentionally not a general visual reasoning model. It provides
reliable image primitives; the LLM decides what the user’s request means and
asks a clarifying question when it materially changes the target.

## Safety boundaries

- Pairing creates a separate client identity and PIN; existing Moonlight
  profiles are not imported or exposed.
- Apollo permissions are read and decoded before launch. Missing permissions
  produce an actionable request instead of a hidden configuration change.
- Before launch, the MCP checks `currentGame`. An existing stream produces a
  clear error and is never taken over or cancelled.
- Session cleanup cancels only the Desktop app launched by the owning MCP
  process. SIGINT, SIGTERM, and unexpected bridge termination use the same
  cleanup path.
- Private key material and input session keys never appear in tool responses,
  log messages, or command-line arguments.

## Reproducible native dependency

The native Moonlight core is a separate upstream project with required ENet and
nanors submodules. `moonlight-core.lock.json` records an exact revision;
`setup:native` checks it out detached and initializes submodules. This avoids
accidentally compiling against an incompatible system ENet version and keeps
updates explicit and reviewable.

## Cross-platform approach

The MCP process is Node.js and uses OS-specific state/cache directories. The
bridge chooses an `.exe` name on Windows; its frame publisher uses Windows
atomic replacement (`MoveFileEx`) rather than POSIX `rename` semantics and
relies on user-profile ACLs instead of POSIX file modes. CMake receives an
optional `CMAKE_TOOLCHAIN_FILE` for environments such as vcpkg.

Native library availability still belongs to the invoker’s package manager,
which is why no prebuilt executable is claimed. A local bridge build and a
real Desktop visual smoke test are required for each target platform.
