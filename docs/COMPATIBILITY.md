# Compatibility

This is a technical platform-support reference. To install and run the MCP,
use [Install and update](INSTALL.md); commands such as `npm run build:native`
below apply only to an intentional [source checkout](DEVELOPMENT.md).

## Roles

| Component | Supported role |
| --- | --- |
| Remote host | Windows running Apollo or Sunshine with its Desktop application available |
| MCP invoker | macOS, Linux, or Windows with Node.js 20+, the native bridge prerequisites, and network reachability to the host |
| Transport | Moonlight/GameStream control, video, and encrypted input channels |

The connection is GameStream. The Windows host needs Apollo or Sunshine and its
Desktop application; pairing creates a separate GameStream client identity
named `Moonlight MCP`.

## Client-platform status

| Platform | JavaScript MCP | Native bridge source | Verification expectation |
| --- | --- | --- | --- |
| Linux | Supported | Supported | Installer validates the bridge; source builds run `npm run build:native`, `npm run doctor -- --strict`, then a Desktop visual smoke test |
| macOS | Supported | Supported | Same; source builds need Xcode Command Line Tools and Homebrew dependencies |
| Windows | Supported | Supported with `.exe` selection and atomic Windows frame replacement | Installer uses WinGet/vcpkg; source builds use Visual Studio/CMake and FFmpeg/OpenSSL development packages |

There are no prebuilt binaries in this project. The installer builds the bridge
locally because FFmpeg/OpenSSL ABI details vary by platform and package
manager. `runtime_status` reports the bridge path and readiness for every
installation; `npm run doctor` is the equivalent source-checkout command.

## Current protocol and media scope

- H.264 only. Desktop sessions default to the `full_hd` profile
  (1920×1080/30fps at 20 Mbps); choose `low_bandwidth` for
  1280×720/30fps at 8 Mbps when the connection is constrained. Individual
  session inputs may still request up to 3840×2160/60fps and 50 Mbps within the
  tool schema, but practical host/network performance must be verified. The
  selected profile requests a stream size; it does not query or modify the
  Windows host's native display resolution. Use each captured frame's reported
  dimensions as the coordinate space.
- Video is decoded locally through FFmpeg and emitted to the MCP as PNG
  screenshots. Audio is intentionally not decoded or exposed.
- One active local stream at a time. Existing GameStream sessions are detected
  before launch and are never cancelled or attached to.
- Mouse, click, drag, scroll, UTF-8 text, virtual keys, named keys, and named
  hotkeys are supported through Moonlight’s encrypted input channel.
- OCR is local Tesseract.js; `eng`, `por`, and other installed Tesseract codes
  may be used. First use of a language can download its data on the invoker.

## Explicitly out of scope

This is not a full Moonlight client. It does not offer audio playback, HEVC or
AV1 decoding, clipboard/file transfer, display selection, session recovery,
multi-session multiplexing, virtual monitor provisioning, or taking over a
stream another client owns. Those omissions are deliberate safety and scope
boundaries, not fallbacks to Windows shell access.
