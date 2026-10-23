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

## Dependency advisory disposition

The 0.10.0 candidate's locked dependency audit on **2026-10-23** reports one high
advisory and no moderate advisories. It is not an audit-clean release. After
`npm run check:updates`, a targeted lock-only refresh updated `ip-address` from
10.7.2 to 10.7.4 within its existing allowed range. All other dependency
resolutions and manifest dependency ranges are unchanged.

| Locked dependency | Advisory | Audit result on 2026-10-23 |
| --- | --- | --- |
| `node-forge` 1.4.0 (direct) | [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv): RSA PKCS#1 v1.5 signature-verification issue | High; `npm audit` reports no fix available. |
| `ip-address` 10.7.4 (through MCP SDK and `express-rate-limit`) | [GHSA-rxp7-6hxx-x8q5](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5): quadratic-time IPv6 zone-identifier parsing | Moderate finding in the previous 10.7.2 lock; no longer reported by `npm audit --package-lock-only` after the targeted update. |

Current `node-forge` use creates the local self-signed pairing identity and
reads certificate signature bytes; Apollo signature verification uses Node's
`crypto.verify`. This usage review does not establish that the application is
unaffected by the advisory. Updating the transitive `ip-address` resolution
removes its audit finding; it is not an application exploitability assessment.

Before publishing, rerun `npm audit` against the exact release lockfile and
recheck patched-version availability. The release workflow rejects critical
advisories; this existing high finding remains disclosed under that policy.
A remediation update must first run `npm run check:updates`, preserve a
reviewable dependency diff, and pass the relevant contract/native checks.
Do not use an unattended `npm audit fix` to change the candidate.

## Capture resource bounds

The candidate limits PNG encoding to two active and two pending jobs. Cancelled
queued jobs are removed, and excess work is refused instead of allowing an
unbounded encoding backlog. A cancelled active job keeps its slot until its
underlying encoding finishes. RGB snapshot retention is limited to twelve
snapshots and 96 MiB, plus an encoded-image cache. These are component limits,
not a total-process memory cap: decoders, in-flight frames, OCR workers, and
image responses also require memory.
