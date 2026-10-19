# Contributing and verification

## Development rules

- Keep the normal path Desktop-first. Do not make Apollo provider-app launch a
  substitute for visible computer use.
- Never add a remote Windows shell, registry/process inspection, or a hidden
  Windows agent as a fallback.
- Do not log, return, or embed pairing private keys, certificates, session
  keys, or unredacted test screenshots.
- Preserve the channel-ownership rule: a stream in use must be reported, not
  taken over.
- Keep every agent-facing input tool paired with an observable visual
  verification path.

## Checks

```sh
npm ci
npm run check
npm test
npm pack --dry-run
```

For native changes, also run:

```sh
npm run setup:native
npm run build:native
npm run doctor -- --strict
```

Then perform a non-consequential live smoke test on an authorized host: start
Desktop, capture, make a reversible UI change, verify it visually, undo it,
verify again, and stop the session. Do not use personal files, saved work, or
production settings as test fixtures.

## Release discipline

Update `package.json`, `package-lock.json`, and the MCP server version together.
Run `npm run check:updates` before dependency upgrades. Treat a pinned
`moonlight-core.lock.json` revision change as a transport change: rebuild and
exercise pairing, channel-in-use detection, capture, input, and cleanup.

A `v*` tag must exactly match the package and `server.json` version. Pushing
that tag runs the full JavaScript/MCP contract checks, validates `server.json`
with the official publisher, authenticates through GitHub Actions OIDC, and
publishes the metadata to the official MCP Registry. The workflow uses no PAT
or registry secret. Do not move or reuse a published version tag; Registry
version metadata is immutable, so corrections require a new version.
