---
name: moonlight-desktop-operator
description: Operate a paired Apollo Windows desktop through the configured moonlight-desktop MCP. For visible Windows tasks, start the Desktop stream, capture the UI, send coordinate-matched input, and verify the rendered result.
---

# Moonlight Desktop Operator

Use the `moonlight-desktop` MCP for authorized Windows GUI tasks on the paired
Apollo host. The MCP runs on the invoker and sends video/input over compatible
Moonlight/GameStream transport.

## Operating loop

1. For setup/readiness concerns, call `runtime_status`; then call
   `profiles_list` and `session_preflight` as appropriate. If pairing is
   required, `pairing_begin` returns the PIN and the Apollo web URL.
2. Call `session_start` for the virtual **Desktop**. Use
   `provider_app_start` only for an explicitly requested Apollo/Moonlight
   provider app.
3. Call `screen_capture` and treat its `snapshotId` and dimensions as the
   coordinate source for the next action. Locate targets through visible
   reasoning, `screen_find_text`, `screen_ocr`, or template matching.
4. Send the smallest fitting input. Prefer `session_mouse_click_at`, named
   key presses, and named hotkeys to independent low-level events.
5. Verify visibly. Use `session_wait_for_change` for material updates and a
   focused region for animated apps. Use `screen_wait_for_text` for visible
   dialogs, menus, and completion notices.
6. Call `session_stop` after success, failure, or ambiguity.

## Boundaries

- Desktop visual interaction is the default. A desktop icon need not appear in
  Apollo's provider-app list.
- Do not force-kill apps unless the user explicitly requests force close.
- Ask when the requested target is materially ambiguous. For example,
  “increase volume” can mean Windows master volume or an app’s own setting.
- Do not save, submit, delete, purchase, send, expose credentials, or finalize
  another consequential action without user authorization.
- If Apollo reports another stream owns the channel, report that exact
  condition and stop.
- Do not claim success before an appropriate visible check confirms it.
