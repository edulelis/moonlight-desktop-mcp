# Changelog

## 0.10.0 — 2026-10-23

### Capture and responsiveness

- Decode H.264 with slice threading and low-delay mode to avoid the previous
  frame-thread buffering on tested low-delay fixtures. Hardware decoding and
  codec negotiation are unchanged.
- Retain the latest decoded frame in memory. Convert it to RGB and publish a
  temporary PPM only when a capture is requested, removing periodic idle RGB
  writes and durability flushes. Video decode and network traffic continue
  while a session is active.
- Encode PNGs asynchronously, reuse the encoded image when RGB pixels are
  unchanged, and bypass PNG work for pixel-only comparisons and templates.
  Lossless compression adapts to the frame; output PNGs can be larger than
  before, while pixels and capture coordinates remain unchanged.
- Bound PNG encoding to two active and two pending jobs. Remove cancelled
  queued work and refuse excess requests instead of allocating an unbounded
  encoding backlog. Cancelled active jobs keep their slot until encoding ends.
- Correlate native capture requests with their acknowledgements, reject stale
  replies, include request/delivery time in frame-age checks, and require a
  newer frame after input.
- Use elapsed startup time and exclude near-black transitional frames from
  stability decisions. Persistently black or animated desktops remain usable
  and are marked unstable.
- Allow `include_image: false` on visual-change and text wait results, omitting
  image content when the caller only needs a local verification result. This
  does not measure or establish a token-cost advantage over another MCP.
- Limit retained RGB history to twelve snapshots and 96 MiB, plus an encoded
  image cache. Evicted snapshot IDs are no longer available. This is not a
  total-process memory limit.

### Controller build portability

- Normalize native executable output paths for multi-configuration Windows
  generators so the controller build script can find the generated bridge.
  Statically link the pinned Moonlight core on Windows to avoid missing DLL
  exports and a private DLL lookup path. Registry publication requires a
  successful Windows native CI build.

### Dependencies

- Update only the transitive `ip-address` lock resolution from 10.7.2 to 10.7.4
  within its existing allowed range, after running `npm run check:updates`.
  The moderate GHSA-rxp7-6hxx-x8q5 finding is no longer reported in the release
  lock audit. Manifest dependency ranges and all other resolutions are unchanged.
- Retain and document the existing high `node-forge` advisory. The current
  locked audit reports no fix available; this release does not claim to be
  unaffected or audit-clean. See [Security](docs/SECURITY.md).

### Validation and performance evidence

Host-free JavaScript/MCP contract tests cover capture, freshness, startup,
encoding, and wait behavior. Native fixture tests run against deterministic
capture/decoder inputs without a paired host. A reversible live Desktop smoke
check also completed; none of these checks changes the installed runtime.

A Mac run after adding the bounded queue used seven samples per synthetic
controller-side capture case. Compared with the recorded baseline on the same
host and fixtures, the measured median wall times were:

| Synthetic capture workload | Before | After |
| --- | --- | --- |
| 1920×1080 desktop-like UI | 11.4 ms | 4.4 ms |
| 3840×2160 desktop-like UI | 41.9 ms | 14.8 ms |
| 3840×2160 high-entropy noise | 402.6 ms | 23.0 ms |

These measurements include controller-side JavaScript frame read/copy/encode
work. They exclude H.264 decoding, native frame publication, network transport,
MCP JSON/base64 serialization, model reasoning, and token billing. They are not
end-to-end Desktop timings or a comparison against a Mac accessibility MCP.
Separate live captures used different screen content and do not establish a
controlled speedup. Re-run the synthetic harness after further pipeline changes.

Local preparation checks passed on 2026-10-23: all 74 JavaScript tests on
macOS with Node 20, 22, and 24 and on Linux with Node 24; Mac/Linux native
builds, fixtures, and production loader probes; isolated Linux installer
bootstrap/update; package dry-run; official MCP publisher 1.8.2 metadata
validation; and workflow lint/release guards. Registry publication additionally
requires the hosted CI matrix, including the Windows native build.

### Upgrade and release notes

- Rebuild the native bridge and restart the MCP client together. Capture
  protocol 1 requires the matching native executable; an older native binary
  must be rebuilt. Pairing profiles remain in their private state directory.
- Complete the JavaScript/MCP checks, native fixtures, and controller-native
  builds on macOS, Linux, and Windows. The Windows native build remains a CI
  release gate until a successful run is recorded; Mac/Linux results do not
  prove Windows compatibility.
- Run packaging and official MCP metadata validation against the candidate.
  Keep package, lockfile, server metadata, and the eventual tag at 0.10.0.
- Rerun the locked dependency audit. The existing policy blocks critical
  advisories and discloses the unresolved high `node-forge` finding. See
  [Security](docs/SECURITY.md) for the dated findings and fixed moderate
  advisory. This release does not claim a clean dependency audit.
