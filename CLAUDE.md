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
v2.3.1, released through this fork's own v2.5.0
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
  the repo - `About.vue`'s "check update" URL plus the pinned image tag
  in `compose.yaml` and README's quickstart/one-line updater all carry
  it (`Layout.vue` now links `/releases/latest`, so it no longer does).
- Tag namespace: darthrater78 and this fork both tag `vX.Y.Z`, and their
  v2.2.0/v2.3.0 are different commits from ours. `git fetch origin`
  keeps our local tags; always pick a release version above both.
- When merging darthrater78: drop their `.claude/dev-skills-gates.md`
  (their own session state), repoint any new `darthrater78/dockge`
  links/images to Ext745 (`git grep darthrater78` - attribution prose,
  the HACS `ha-dockge` integration and `docker/Dockerfile`'s public
  `:base`/`:build-healthcheck` images are intentionally left as-is).
- `docker-release.yml`'s gate job waits for a passing `ci.yml` run on
  the tagged commit, so push `master` before the tag.
