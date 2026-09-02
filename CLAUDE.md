# CLAUDE.md
This is darthrater78/dockge with features being ported from hamphh/dockge 1.2.
See PORTING.md for what's done and what's remaining.
Currently on branch feat/agent-maintenance. Agent Maintenance UI, the
ignore-service-status toggle, the fullscreen toggle on the primary
compose.yaml editor, and the stack-terminal auto-collapse/auto-close are
all ported, typecheck/lint clean, and live-tested against real Docker
agents (2026-09-01; see PORTING.md for the bugs found and fixed along the
way - including a pre-existing missing Terminal.vue method that silently
broke every ProgressTerminal.show() call). The mobile-layout item was
investigated and closed as no action needed. Next up per PORTING.md's
suggested order: the advanced category filter dropdown on the stack list.
