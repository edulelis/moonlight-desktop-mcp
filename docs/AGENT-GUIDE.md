# Agent operating guide

This MCP is a visual computer-use surface. Treat its Desktop screenshots as the
source of truth and act only through its visual input tools.

## Required operating loop

1. Call `runtime_status` when local readiness or version matters. For a new
   host, use `host_status`, complete pairing, and call `session_preflight`.
2. Call `session_start` for the normal Desktop path. Do not call
   `provider_app_start` unless the user explicitly asked for an
   Apollo-registered provider app.
3. Call `screen_capture` and use that snapshot’s coordinate space. Locate a
   target by visible reasoning, `screen_find_text`, or a retained template.
   Do not guess stale coordinates.
4. Send the smallest relevant visual input: prefer `session_mouse_click_at`,
   `session_key_press_named`, or `session_hotkey` over raw low-level events.
5. Verify the expected visible effect. Use `session_wait_for_change` for
   material updates, a scoped region for animated screens, and
   `screen_wait_for_text` for dialogs, menus, and completion labels.
6. Call `session_stop` after completion, failure, or ambiguity. Never leave a
   stream open merely to save a future connection.

## Interpretation rules

- “Open Valheim” means visually find and open it from the Desktop/Start menu;
  it does not mean choose an Apollo provider app with a matching name.
- “Increase volume by 10%” is ambiguous between Windows master volume and an
  application/game audio setting. Ask which target the user means before
  changing either.
- Capture again after a view-changing action. Coordinates from an old frame
  are not safe after menus move, resolution changes, a window opens, or a
  screen animates.
- A negative OCR/template result is not evidence that the target is absent.
  Re-capture, broaden the search region, or report the limitation.
- Do not respond with success until a suitable visible check confirms it, or
  explain precisely what could not be confirmed.

## Permission and stream boundaries

`session_preflight` names the exact missing Apollo toggles and gives the user
the Apollo web URL. Do not ask for unrelated permissions, attempt to change
them programmatically, or continue visual input when keyboard/mouse permission
is absent.

If the server reports that the streaming channel is already in use, report that
condition and stop. Do not cancel, attach to, or disrupt the other client’s
session.

## Authorization boundaries

Use normal visible UI close behavior; do not force-kill applications unless the
user expressly asks. Ask for confirmation before a consequential final action:
saving or overwriting files, deletion, submission, sending messages, purchases,
credentials, system-security changes, or destructive account operations.

The user may authorize ordinary navigation and reversible settings changes.
Even then, verify through the rendered desktop rather than hidden system state.
