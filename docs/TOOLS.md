# Tool reference

Every coordinate is in the pixel space of the captured Desktop frame. Tools
marked read-only never launch an app or send remote input.

## Local and pairing

| Tool | Purpose |
| --- | --- |
| `desktop_channel_status` | Identify the dedicated headless Desktop channel, paired targets, active Desktop sessions, local transport occupancy, and bridge readiness. Start here; generic GUI computer use is not a fallback. |
| `runtime_status` | Installed version, local platform, data path, native bridge readiness, and update path. |
| `host_status` | Public GameStream host information without pairing or input. |
| `pairing_begin`, `pairing_status`, `pairing_cancel` | Dedicated Apollo PIN pairing lifecycle. |
| `profiles_list` | Local paired identities without secret material. |
| `profile_wol_configure` | Store a paired host's MAC address and Wake-on-LAN UDP broadcast settings locally. |
| `host_wake` | Send a Wake-on-LAN magic packet for a configured paired host. |
| `profile_status` | Authenticated Apollo permissions and decoded readiness. |
| `session_preflight` | Exact permission check for the intended session mode; can wake a configured offline host. |
| `apps_list` | Read Apollo provider apps; this does not launch them. |

## Sessions

| Tool | Purpose |
| --- | --- |
| `session_start` | Start a new virtual Desktop session. Normal computer-use entry point. |
| `provider_app_start` | Start an explicit Apollo provider app; not the normal Desktop path. |
| `session_status` | Local transport/frame state. |
| `session_stop` | Stop only the session owned by this MCP process. |

`profiles_list[].id` is the `profile_id` for these tools. `session_start` and
`provider_app_start` return a `sessionId`; use it as `session_id` for capture,
input, status, and stop tools. If Wake-on-LAN is configured, normal preflight
and start calls send magic packets only when the Apollo host does not answer.
`desktop_channel_status.activeSessions` contains only Desktop sessions; an
explicit provider-app stream is never mislabeled as a Desktop target.
`transportSessions` reports every local MCP-owned transport that prevents a
second Desktop launch, without exposing provider-app names.
`readiness.launchPreparationInProgress` covers the short pre-session interval
while this MCP is checking and reserving the Moonlight transport; it has no
session ID yet, so wait for `session_start` to return or fail before retrying.
If `activeSessions` already contains a Desktop session, capture that session as
the source of truth and still do not start another one.

## Visual observation

| Tool | Purpose |
| --- | --- |
| `screen_capture` | Fresh PNG plus retained `snapshotId`. |
| `screen_crop` | Focused screenshot crop. |
| `screen_diff` | Compare retained/current screenshot pixels. |
| `session_wait_for_change` | Wait for a material change after an action. Scope it for animated apps. |
| `screen_template_create`, `screen_find_template` | Retain and locate deterministic visual controls/icons. |
| `screen_ocr` | Local OCR text, lines, words, and capture-space bounds. |
| `screen_find_text` | Locate a visible label before clicking it. |
| `screen_wait_for_text` | Wait for a visible dialog/menu/completion label. |

Snapshots and templates are session-local. They are not a durable image store;
capture again if the session ends or the UI changes.

## Visual input

| Tool | Purpose |
| --- | --- |
| `session_mouse_move` | Absolute pointer position. |
| `session_mouse_click` | Click at the current pointer position. |
| `session_mouse_click_at` | Move and click atomically; preferred for visually located targets. |
| `session_mouse_drag` | Held/interpolated drag. |
| `session_scroll` | Vertical wheel input. |
| `session_type` | UTF-8 text input. |
| `session_key` | Low-level held virtual key. |
| `session_key_press` | Raw virtual-key press/release. |
| `session_key_press_named` | Named Windows key such as `ENTER`, `ESCAPE`, or `F5`. |
| `session_hotkey` | Named modifier chord such as `CTRL` + `SHIFT` + `S`. |
| `session_shortcut` | Raw virtual-key chord for cases not covered by named hotkeys. |

Prefer named keys and `session_hotkey` over virtual-key integers. Follow every
meaningful input with appropriate visual verification.
