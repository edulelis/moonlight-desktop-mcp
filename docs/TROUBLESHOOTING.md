# Troubleshooting

## Start with local readiness

```sh
npm run doctor -- --json
```

`nativeBridgeReady` must be `true` before `session_start` can work. If the core
is missing, run `npm run setup:native`; if the bridge is missing, install the
platform development libraries and run `npm run build:native`.

## Pairing does not complete

- Use the exact `apolloWebUrl` returned by `pairing_begin`, accept the host’s
  self-signed certificate only after verifying it is your Apollo host, and
  enter the returned PIN there.
- Keep `pairing_status` polling until it reports `paired` or a concrete error.
- Ensure the invoker can reach the host’s GameStream HTTP port (normally
  47989) and Apollo web UI port (normally 47990).

## The PC is powered off or asleep

Configure the paired profile once with `profile_wol_configure`, supplying the
host's network-adapter MAC address and the IPv4 broadcast address of its LAN.
`host_wake` sends the magic packet immediately; normal `session_preflight` and
`session_start` also wake a configured host when Apollo is offline. If global
`255.255.255.255` broadcast is filtered, use the subnet's broadcast address
instead. Wake-on-LAN needs network hardware, firmware, and operating-system
support on the host, and a route that carries the UDP broadcast from the MCP
invoker.

## Apollo says permissions are missing

Call `profile_status` or `session_preflight`. Follow only the named permission
toggles in its user action. A usual computer-use identity needs List Apps, View
Streams, Launch Apps, Mouse Input, and Keyboard Input; file transfer is not
required.

## “Streaming channel is already in use”

Another GameStream client owns the channel. Close that client’s session or ask
its owner to do so, then retry. Do not call a cancellation endpoint to take it
over; this MCP intentionally refuses that behavior.

## Native build fails

- Confirm `cmake --version`, `git --version`, and Node 20+.
- On macOS, install Xcode Command Line Tools plus Homebrew FFmpeg/OpenSSL.
- On Linux, install the `libavcodec`, `libavutil`, `libswscale`, and OpenSSL
  development packages, not only runtime libraries.
- On Windows/vcpkg, export `CMAKE_TOOLCHAIN_FILE` before `npm run build:native`.
- Run `npm run setup:native` again if the locked Moonlight core or its
  submodules are absent.

## The image is moving or a visual wait fires immediately

Games and video desktops can animate continuously. Use a focused region with
`session_wait_for_change`, or prefer `screen_wait_for_text` for a known menu
or dialog. The session reports `visualBaselineStable: false` when it could not
find a still initial frame; that is usable, not a connection failure.

## A click misses its target

Capture again and use the newest `snapshotId`; do not reuse coordinates after a
window, scale factor, or menu changed. Locate the label with `screen_find_text`
or create/find a visual template, then use `session_mouse_click_at`. Confirm
the post-click state visually.

## OCR misses visible text

Use the correct `language` (`eng`, `por`, or `eng+por`), lower the confidence
threshold cautiously, crop to the relevant region, and capture a fresh frame.
The first language request may need a network download on the invoker.
