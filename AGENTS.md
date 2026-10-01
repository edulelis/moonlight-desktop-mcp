# Moonlight Desktop MCP contributor context

This repository implements a local, visual Moonlight/Apollo computer-use MCP.
The user’s normal intent is Desktop visual interaction, not direct remote host
administration.

- Read `README.md`, `docs/ARCHITECTURE.md`, and `docs/AGENT-GUIDE.md` before
  changing protocol, tool, or agent behavior.
- Keep Apollo provider apps explicit-only; retain `session_start` as Desktop
  only. Never add an automatic app-registry lookup for a visible desktop task.
- Preserve pairing privacy, exact permission preflight, stream-in-use refusal,
  and stop-only-owned-session cleanup.
- Use screenshot coordinate space and visual verification for remote actions.
  Do not add registry, shell, process-list, SSH, RDP, or Windows-side agent
  workarounds.
- Keep native builds portable across macOS, Linux, and Windows. Use
  `npm run check`, `npm test`, and appropriate native/real-host smoke tests.
- `data/` contains local profiles, OCR models, and screenshots and must remain
  ignored. Never include it in test fixtures, docs, logs, or patches.
