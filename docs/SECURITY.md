# Security and data handling

## Trust model

Use this MCP only for hosts and desktop actions the user is authorized to
control. A screenshot can contain private messages, files, credentials, and
other sensitive desktop data. Pairing gives the local MCP client the Apollo
permissions granted to that identity; it is not a sandbox for actions on the
remote desktop.

## Local secrets and files

- `profiles.json` contains the dedicated client certificate and private key.
  It is written in the local MCP state directory with owner-only permissions
  where the platform supports POSIX modes.
- A profile can also contain a Wake-on-LAN MAC address and UDP broadcast
  destination. This is controller-side network configuration, not a remote
  credential; keep it with the same local profile data rather than sharing it
  in logs or chat unnecessarily.
- On Windows, protection is supplied by the selected user-profile directory’s
  ACL. Keep `MOONLIGHT_MCP_DATA_DIR` private to the user running the MCP.
- Per-session input keys are generated in memory, passed to the bridge via
  stdin, zeroed after launch, and never returned by a tool.
- Decoded frames are local temporary session files; OCR models cache locally.
  Neither is uploaded by this MCP.

Do not paste profile files, client keys, screenshots containing sensitive data,
or Apollo browser credentials into chat or issue trackers.

## Operational protections

- `session_preflight` reports missing permissions rather than elevating them.
- A detected existing GameStream app blocks new launch; there is no attach or
  takeover behavior.
- The agent guide requires visible confirmation for consequential actions and
  visual verification for normal actions.
- `session_stop` only cancels a session this MCP started. It does not stop
  another Moonlight client’s stream.

## Recommended practice

Use a dedicated Apollo identity for this MCP, review its permissions in Apollo,
and remove that identity in Apollo if the invoker is lost or no longer trusted.
Keep the MCP data directory backed up only through an encrypted, access-limited
backup process. Re-pair after a suspected key disclosure.
