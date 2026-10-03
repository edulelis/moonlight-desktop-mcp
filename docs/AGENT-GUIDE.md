# Agent operating guide

## Connection semantics

This MCP controls the remote desktop in its active streaming session. It does
not control the invoker's local operating system. A paired profile identifies
a possible target, but only a live session with a current screenshot confirms
that input is directed to that target. Do not infer a usable remote desktop
from a local application or process alone.

Before interacting, select or create a paired profile, call
`session_preflight`, and start a Desktop session. If the PC is offline and the
profile has Wake-on-LAN configured, preflight/start wakes it and waits for
Apollo. If the profile lacks that configuration, ask the user for the host MAC
address and LAN broadcast address; do not guess either value. The screenshots
and input tools for that session share one remote-desktop coordinate space.

Treat the active Desktop stream as the source of truth. Read its screenshots,
send input in their coordinate system, then inspect the rendered result.

## Required operating loop

1. Call `runtime_status` when local readiness or version matters. For a new
   host, use `host_status`, complete pairing, and call `session_preflight`.
2. Call `session_start` for the normal Desktop path. Use
   `provider_app_start` only for a user-requested Apollo-registered provider
   app.
3. Call `screen_capture` and use that snapshot’s coordinate space. Locate a
   target by visible reasoning, `screen_find_text`, or a retained template.
   Do not reuse coordinates from an older frame.
4. Send the smallest relevant visual input: prefer `session_mouse_click_at`,
   `session_key_press_named`, or `session_hotkey` over raw low-level events.
5. Verify the expected visible effect. Use `session_wait_for_change` for
   material updates, a scoped region for animated screens, and
   `screen_wait_for_text` for dialogs, menus, and completion labels.
6. Call `session_stop` after completion, failure, or ambiguity.

## Interpretation rules

- “Open Valheim” means find and open it from the Desktop or Start menu. It is
  not a request for an Apollo provider app with the same name.
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

If the server reports that the streaming channel is already in use, report the
condition and stop. That channel belongs to another client session.

## Authorization boundaries

Use normal visible UI close behavior; do not force-kill applications unless the
user expressly asks. Ask for confirmation before a consequential final action:
saving or overwriting files, deletion, submission, sending messages, purchases,
credentials, system-security changes, or destructive account operations.

Stop and let the user complete account sign-in, credential or one-time-code
entry, license activation, and terms or EULA acceptance. Resume only after the
user confirms that the required step is complete.

The user may authorize ordinary navigation and reversible settings changes.
Even then, verify through the rendered desktop rather than hidden system state.
