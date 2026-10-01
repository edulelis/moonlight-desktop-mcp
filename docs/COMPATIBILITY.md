# Compatibility

## Roles

| Component | Supported role |
| --- | --- |
| Remote host | Windows running Apollo or Sunshine with its Desktop application available |
| MCP invoker | macOS, Linux, or Windows with Node.js 20+, the native bridge prerequisites, and network reachability to the host |
| Transport | Moonlight/GameStream control, video, and encrypted input channels |

The host is not required to run SSH, RDP, WinRM, a custom service, or an MCP
server. Pairing creates a normal, separate GameStream client identity named
`Moonlight MCP`.

## Client-platform status

| Platform | JavaScript MCP | Native bridge source | Verification expectation |
| --- | --- | --- | --- |
| Linux | Supported | Supported | `npm run build:native`, `npm run doctor -- --strict`, then a Desktop visual smoke test |
| macOS | Supported | Supported | Same verification; install Xcode Command Line Tools and Homebrew dependencies first |
| Windows | Supported | Supported with `.exe` selection and atomic Windows frame replacement | Build with Visual Studio/CMake and FFmpeg/OpenSSL development packages, then perform a local smoke test |

There are no prebuilt binaries in this project. A successful local build is the
compatibility gate because FFmpeg/OpenSSL ABI details are platform- and
package-manager-specific. `runtime_status` and `npm run doctor` report the
bridge path and readiness on the actual invoker.

## Current protocol and media scope

- H.264 only, at up to 1280×720/30fps by default; session inputs may request
  up to 3840×2160/60fps within the tool schema, but practical host/network
  performance must be verified.
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
