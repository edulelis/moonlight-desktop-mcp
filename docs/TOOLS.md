# Tool reference

Every coordinate is in the pixel space of the captured Desktop frame. Tools
marked read-only never launch an app or send remote input.

## Local and pairing

| Tool | Purpose |
| --- | --- |
| `runtime_status` | Installed version, local platform, data path, native bridge readiness, and update path. |
| `host_status` | Public GameStream host information without pairing or input. |
| `pairing_begin`, `pairing_status`, `pairing_cancel` | Dedicated Apollo PIN pairing lifecycle. |
| `profiles_list` | Local paired identities without secret material. |
| `profile_status` | Authenticated Apollo permissions and decoded readiness. |
| `session_preflight` | Exact permission check for the intended session mode. |
| `apps_list` | Read Apollo provider apps; this does not launch them. |

## Sessions

| Tool | Purpose |
| --- | --- |
| `session_start` | Start a new virtual Desktop session. Normal computer-use entry point. |
| `provider_app_start` | Start an explicit Apollo provider app; not the normal Desktop path. |
| `session_status` | Local transport/frame state. |
| `session_stop` | Stop only the session owned by this MCP process. |

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
