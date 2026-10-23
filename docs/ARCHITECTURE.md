# Architecture

## Role

Provide a capture/input bridge over an existing Moonlight/Apollo connection.
The Windows host runs Apollo or Sunshine; the MCP server, native bridge, and
image helpers run on the machine that invokes the MCP.

## Data and control flow

```text
LLM / MCP client
  -> local Node MCP server
     -> local UDP Wake-on-LAN packet (when the selected profile is configured and Apollo is offline)
     -> Apollo HTTPS/GameStream control plane (pair, permissions, launch)
     -> local native Moonlight bridge (H.264 decode + encrypted input)
     -> local vision helpers (PNG, OCR, template, diff)
  -> rendered screenshots and verified action results
                         <-> Apollo/Sunshine on Windows
```

The Node process owns tool contracts, pairing profiles, screenshots, and OCR.
The small C bridge uses the upstream Moonlight common C library for the
GameStream video/input protocol and FFmpeg to decode H.264 frames into local
RGB images.

## Capture pipeline

Decoding retains the latest FFmpeg frame by reference in memory. Cheap frame
metadata continues to arrive independently; RGB conversion and atomic PPM
publication happen only for an explicit capture request. Scratch images use
owner-only permissions and checked writes, without a durability flush. There
are no periodic RGB file writes while the controller is idle, although video
decoding and network traffic continue.

The native bridge announces capture protocol 1. Node serializes/coalesces the
request, matching acknowledgement, and file read; sequence, dimensions, and
timestamp belong to that acknowledgement. It rejects stale replies, includes
request/delivery time in a conservative age bound, and waits for newer frames
after input. An older native binary requires a rebuild.

Pixel-only comparisons and template searches bypass PNG encoding. Image tools
encode asynchronously and reuse the PNG when retained RGB pixels are unchanged.
Compression samples the image: incompressible frames use lossless stored blocks,
while UI frames use fast lossless compression. PNG sizes can increase relative
to the previous compression; decoded pixels and capture coordinates are unchanged.
RGB history retains at most twelve snapshots and 96 MiB, with one additional
encoded-image cache. Evicted snapshot IDs cannot be used again.

All asynchronous PNG paths share a budget of two active jobs and two pending
jobs. Crop and scanline allocations happen after admission. Excess work returns
an explicit busy error. Stopping a session removes its queued work; already
running compression retains its slot until completion and discards its result.

The H.264 decoder uses four slice threads and low-delay mode instead of automatic
frame threading. This avoids frame-thread buffering on the tested low-delay
fixtures; it does not add hardware decoding or change the negotiated codec.
Startup stability uses elapsed time and excludes near-black transitional frames.
A persistently black or animated Desktop remains usable and is marked unstable.

## Desktop launch rule

Apollo provider apps are a host-defined launch registry. They are useful only
when a user asks for one by name. Typical computer-use requests—open something
on the desktop, change an app setting, dismiss a dialog—need the actual visible
Windows desktop. `session_start` therefore launches only Apollo’s Desktop app;
`provider_app_start` is a separate, explicit tool.

An application shown on the desktop need not be pre-registered in Apollo. The
Desktop stream is therefore the appropriate path for a request to interact with
visible Windows UI.

## Image helpers and coordinates

Screenshot, template, OCR, and difference helpers run beside the Moonlight
stream. They return capture-space coordinates and belong to the session that
owns the input channel. The resulting loop uses one coordinate system:

1. Capture an image.
2. Locate a visible target.
3. Act in the same coordinate system.
4. Capture or wait again to verify the effect.

The helpers identify pixels, text, and change regions. The MCP client decides
what the user's request means and asks when the target materially changes.

## Session and credential boundaries

- Pairing creates a separate client identity and PIN; existing Moonlight
  profiles are not imported or exposed.
- Apollo permissions are read and decoded before launch. Missing permissions
  produce an actionable request instead of a hidden configuration change.
- Wake-on-LAN configuration is stored with the local paired profile. The MCP
  sends its UDP magic packet from the controlling machine before a configured
  offline preflight or session start; it still waits for Apollo to become
  reachable before attempting GameStream launch.
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
