# CLAUDE.md
This is Ext745/dockge, a fork of darthrater78/dockge. See PORTING.md for
the hamphh/dockge 1.2 port summary — complete as of 2026-09-01, nothing
left open. On top of that, this fork has its own original/ported-from-
elsewhere work (node-to-node stack transfer, terminal clipboard/log-export
tooling, and the reliability fixes layered onto them) — see the
"This fork — Ext745/dockge" section near the top of README.md for the
current, up-to-date list; that section is the canonical changelog, not a
separate doc.

Currently on `master`, synced with darthrater78/dockge through their
v2.1.0, released through this fork's own v2.4.0
(`ghcr.io/ext745/dockge`). Typecheck/lint clean project-wide (0 eslint
errors), all changes live-tested against real Docker agents.

Standing rules:
- Any new UI gets an actual browser page-load and click-through as the
  first verification step, before testing the logic underneath -
  several features have passed socket-only tests while being
  completely broken at the "does it render" level.
- When live-testing against a real Docker daemon, always point
  `DOCKER_HOST` at an isolated sidecar (e.g. `docker:27-dind`), never
  the host's own daemon - it may be running real, unrelated
  infrastructure that shouldn't be disturbed.
- Before tagging a release, grep for the outgoing version string across
  `.vue`/`.ts`/`.json` - `Layout.vue` and `About.vue`'s hardcoded
  "check update" URLs have gone stale on every release so far.
