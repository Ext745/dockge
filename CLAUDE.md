# CLAUDE.md
This is darthrater78/dockge with features being ported from hamphh/dockge 1.2.
See PORTING.md for the full port summary — as of 2026-09-01 the port is
complete: every identified feature/gap has either shipped or been
investigated and closed as a non-issue, nothing is left open. Currently
on branch feat/agent-maintenance, typecheck/lint clean, all changes
live-tested against real Docker agents. Only remaining item is the
optional, unrelated lint cleanup (~99 pre-existing errors) noted in
PORTING.md's "Deferred by choice" section.

Standing rule: any new UI gets an actual browser page-load and
click-through as the first verification step, before testing the logic
underneath - several features this session (clearTerminal, getAgentName,
endpointDisplayFunction) passed socket-only tests while being completely
broken at the "does it render" level.
