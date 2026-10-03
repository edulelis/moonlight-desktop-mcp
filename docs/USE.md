# Use the MCP

This page describes the normal visual workflow after
[installation](INSTALL.md). The MCP controls the **remote Windows Desktop** in
an active Moonlight/GameStream session. It does not control the local computer
that invokes the MCP, and it does not use a Windows shell, registry, or process
list.

## Before pairing

The target PC needs Apollo or Sunshine running and a Desktop application
available in its provider configuration. The MCP invoker needs network access
to the host's GameStream endpoint, normally `HOST:47989`. It creates its own
paired client identity; it does not import or expose another Moonlight client's
profiles.

First call `runtime_status`. A ready native bridge is required before a Desktop
stream can start. Then call `host_status` with the host address to check that
Apollo responds and to see its reported web URL.

## Pair a host

1. Call `pairing_begin` with `host: "HOST:47989"`. It returns a four-digit PIN,
   a `pairing_id`, and the host's Apollo web URL.
2. On the computer from which you can reach that URL, open the returned URL and
   enter the PIN in Apollo. Confirm that the certificate warning, if shown, is
   for the expected host before accepting it.
3. Call `pairing_status` with the returned `pairing_id` until it reports
   `paired`. The result contains a local profile ID.
4. Call `profiles_list` whenever you need to select a paired profile. Its `id`
   is the `profile_id` for the remaining host and session tools.

The PIN and URL let the person running the MCP approve pairing from their own
machine. No remote Windows agent is added during this process.

## Optional: wake a sleeping or powered-off PC

Wake-on-LAN is optional. If the host can be asleep or powered off, obtain its
network-adapter MAC address and the IPv4 broadcast address for its LAN. Do not
guess either value. Call `profile_wol_configure` once with that information.

`host_wake` sends a magic packet immediately. More commonly,
`session_preflight` and `session_start` use the configured profile to wake the
PC automatically when Apollo is offline, then wait for Apollo to answer. A
successful magic packet does not prove that the PC is awake; continue only
after Apollo becomes reachable.

## Start a visual Desktop task

Use the following loop for requests such as “open Valheim”, “close Steam
normally”, or “change a visible Windows setting.”

1. Call `desktop_channel_status` to confirm that this dedicated headless
   Desktop channel is ready, select its paired target, and check whether a
   Desktop session or another MCP-owned Moonlight transport is already active,
   stopping, or being prepared. Follow `nextAction` rather than starting
   another session. Do
   not fall back to generic GUI computer use: it would control a local
   controller window instead of the remote Desktop.
2. Call `session_preflight` with the chosen `profile_id` and
   `mode: "computer_use"`. It checks only the permissions required for visual
   computer use. If it reports missing permissions, use its returned Apollo URL
   and change only the named toggles, then preflight again.
3. Call `session_start` with the same `profile_id`. This opens Apollo's
   **Desktop**, not a provider app. If another GameStream client owns the
   streaming channel, the MCP reports that state and does not take it over.
   It defaults to the `full_hd` profile (1920×1080/30fps at 20 Mbps). If the
   connection is slow, pass `stream_profile: "low_bandwidth"` for
   1280×720/30fps at 8 Mbps; individual video settings can still override that
   profile. This is the requested stream size, not a lookup or change to the
   Windows host's native display resolution; always use the dimensions returned
   by `screen_capture` for coordinates if the host negotiates a different size.
4. Save the returned `sessionId`. Call `screen_capture` with it and use the
   returned image and dimensions as the coordinate source for the next action.
   A current capture is the only evidence that a requested app, installer,
   account, license, or activation state is present; do not infer those facts
   from controller-local state or a provider-app registry.
5. Find the visible target: reason from the fresh screenshot, use
   `screen_find_text`/`screen_ocr`, or create and use a template. Send the
   smallest appropriate input, usually `session_mouse_click_at`, a named key,
   or `session_hotkey`.
6. Capture again or wait with `session_wait_for_change` or
   `screen_wait_for_text`. Report success only after the rendered Desktop shows
   the expected result.
7. Call `session_stop` with the same `session_id` when the task is complete,
   cannot be verified, or becomes ambiguous.

Snapshots and input share one remote-desktop coordinate space. Do not reuse
coordinates after a window opens, a menu moves, the resolution changes, or the
screen visibly changes.

## Desktop versus provider apps

`session_start` is the default for computer use. For example, “open Valheim”
means find it in the visible Desktop or Start menu and interact with it there;
it does not require Valheim to appear in Apollo's provider-app registry.

Use `apps_list` and `provider_app_start` only when the user explicitly asks to
start an Apollo-registered provider app. That is a separate launch path, not a
fallback for a visual desktop task.

## Safe operation boundaries

- Capture before coordinate input and verify afterward. A paired profile alone
  is not proof that a remote desktop is ready for input.
- Stop and let the user complete account sign-in, credentials or one-time codes,
  licence activation, and terms/EULA acceptance.
- Ask before a consequential final action such as saving/overwriting a file,
  deletion, a purchase, a message submission, or a security/account change.
- Use normal visible UI close behavior. Do not force-close an app unless the
  user explicitly asks.
- If the stream is already in use, report it and stop; do not cancel another
  client's session.

See [TOOLS.md](TOOLS.md) for every tool and [AGENT-GUIDE.md](AGENT-GUIDE.md)
for the full agent behavior contract. For specific failures, use
[Troubleshooting](TROUBLESHOOTING.md).
