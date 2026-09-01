# hamphh/dockge 1.2 → darthrater78/dockge: porting tracker

## Done — live-tested and verified
- **Agent Maintenance UI** (branch `feat/agent-maintenance`)
  - Patches: `0001-Port-Agent-Maintenance-UI-from-hamphh-dockge-1.2.patch`, `0002-Fix-pre-existing-object-property-newline-lint-errors.patch`
  - Backend logic/types already existed unwired in darthrater78; added the socket handler, `AgentMaintenance.vue` page, `DockerArtefact.vue` + `ProgressTerminal.vue` components, `/agent` routes, nav link, missing i18n strings, missing icon, missing scss var.
  - Verified: `tsc --noEmit` clean, `vite build` clean, `eslint` clean on all touched files.
  - **Live-tested 2026-09-01** against two real, independent Docker daemons (docker:27-dind sidecars, one per dockge instance) driving the actual socket protocol end-to-end: container/image/network/volume listing, per-artefact prune/pruneAll/remove, image pull, `dockerSystemPrune`, live terminal streaming (captured real `docker pull` progress-bar ANSI output over the socket), and multi-agent endpoint switching (master vs. a registered remote agent, confirmed each targets its own daemon with independently-different data). Full setup + driver script notes below.
  - **Bugs found and fixed during live testing** (in `backend/agent-maintenance.ts`, `getImageData()`):
    1. `docker image ls --format json` (no `-a`) hides dangling/untagged images on current Docker CLI versions (`-a, --all` help text: "default hides intermediate and dangling images") — so dangling images never appeared in the UI at all, even though the Prune/System Prune buttons still cleaned them up correctly via the daemon API directly. Fixed by additionally querying `--filter dangling=true` and merging the results, mirroring the pattern `getVolumeData()` already uses.
    2. Even once listed, dangling images showed `dangling: false` — the code determined the flag from `imageInfo.Containers === "0"`, but current Docker CLI always reports `Containers: "N/A"` for `docker image ls` output (that field isn't populated there), so this comparison never matched. Fixed by also treating any untagged (`Tag === "<none>"`) image as dangling unconditionally, which is unambiguous regardless of the `Containers` field.
    - Known remaining limitation (not fixed, out of scope for this pass): the `Containers === "0"` heuristic for *tagged-but-unused* images (the "unused" label, as opposed to untagged/"dangling") is still unreliable on current Docker — such images won't show a dangling badge. Untagged dangling images (the common case, and the only one users can act on individually) are correctly detected now.

### How to reproduce the live test environment
Two `dockge-test:agent-maint` containers (build via `docker build -f docker/Dockerfile -t dockge-test:agent-maint --target release .` after `npm run build:frontend`), each pointed at its own `docker:27-dind` sidecar via `DOCKER_HOST`, so agent-maintenance actions are fully isolated from the host's real Docker daemon. Compose file and Node driver scripts (using the bundled `socket.io-client` to log in and call the exact socket events the frontend uses) were written to `/tmp/.../scratchpad/agent-maint-test/` for this session; recreate similarly if re-verifying. Left running after this session (ports 5011/master, 5012/agent; login `admin` / `TestPass123!`) so it can be poked at directly in a browser too — tear down with `docker compose down` in that directory when no longer needed.

- **Ignore-service-status toggle**
  - Backend/frontend: `common/compose-labels.ts` (already existed with `LABEL_STATUS_IGNORE` defined - carried over unused by the earlier v1.6.0 REST API port - just wasn't imported/wired up anywhere; left as-is, only consumed it), `frontend/src/components/Container.vue` (checkbox + `ignoreStatus` computed get/set on `service.labels`, array-of-`"KEY=VALUE"`-strings form to match how `environment`/`depends_on` already work here — darthrater78 has no `ComposeDocument`/labels-object abstraction like hamphh's, so this doesn't port hamphh's `Container.vue` logic verbatim, just its UX and label name), `backend/stack.ts` (`updateData()`'s per-service status aggregation now reads each container's actual runtime `Labels` string from `docker compose ps` and excludes `dockge.status.ignore=true` services from the running/exited counts, falling back to their state only if every other service is absent - same fallback hamphh uses).
  - **Scope note beyond the original "small checkbox" estimate:** darthrater78's `Stack.getStackList()` (the method that actually feeds the live dashboard's stack-list status badge) computes status from the cheap aggregate `docker compose ls` string and never called the per-service `updateData()` at all - so wiring the label into `updateData()` alone would have fixed the REST API's per-stack status but not the primary dashboard badge most users look at. Fixed by porting hamphh's own hybrid fallback: keep the cheap `docker compose ls` path when a stack's aggregate status starts with `"running"` (nothing to ignore-check), otherwise call `updateData()` for the accurate, label-aware count. This is the same tradeoff hamphh's upstream code already makes, not a new design.
  - Verified: `tsc --noEmit` clean, `npm run lint` shows no new errors (only pre-existing ones, already tracked below).
  - **Live-tested 2026-09-01**: deployed two real stacks via `deployStack` against the master's isolated dind daemon - one service running normally plus a second `busybox` service that exits immediately (`sh -c 'exit 1'`). With `dockge.status.ignore=true` on the crashing service, the dashboard's pushed `stackList` status was `RUNNING`; with the label removed (control), the identical scenario correctly showed `RUNNING_AND_EXITED`. Confirms the label is what's actually deciding the badge, not a side effect.

## Deferred by choice
- **~99 pre-existing lint errors** (94 `object-property-newline` + 5 `curly`, concentrated in `api-router.ts`, `compose-version-sync.ts`, `docker-socket-handler.ts`, `two-fa.ts`, `version-sync-history-service.ts`). Purely cosmetic, 100% auto-fixable, zero semantic risk. Do via `eslint --fix` + diff review as its own isolated commit once the live test is done.

## Confirmed real gaps — still to port
1. **Fullscreen toggle on the *primary* compose.yaml editor** — darthrater78 only has fullscreen for the compose **override** editor modal (`compose-override-editor-modal`, `size="fullscreen"`). Small, UI-only: copy the same modal pattern onto the main editor. Source reference: hamphh's `Compose.vue`.
2. **Advanced category filter dropdown** on the stack list — darthrater78 already has basic text search plus a *disabled placeholder* for this (`<div v-if="false" class="header-filter">` with a commented-out `<StackListFilter>`), so someone already started it. Needs: the `StackFilter` class (category/status-based filtering) in `common/util-common.ts` and the `BDropdown` UI in `StackList.vue`. Medium effort — source reference: hamphh's `StackList.vue` + `common/util-common.ts` (`StackFilter`, `StackStatusInfo`).

## Confirmed NOT needed (already present or superseded in darthrater78)
- Basic stack list search/filter — present
- Service resource stats panel — present (`DockerStat.vue`, darthrater78's own implementation)
- Unhealthy status detection/display — present, logic essentially identical
- Image update notifications via skopeo — **not worth porting**; darthrater78 has its own more advanced version-sync system (`compose-version-sync.ts`, `version-sync-history-service.ts`, `Updates.vue`, "Update All")
- Multi-agent support — already present (from upstream 1.4.0)

## Unverified — need to check before deciding whether they're gaps
- **Mobile layout**: hamphh has a dedicated `/stacks` route + `MobileStackList.vue` for viewing the stack list on mobile. darthrater78 just hides the stack-list column via `v-if="!$root.isMobile"` in `Dashboard.vue` — haven't confirmed whether there's an equivalent alternate view for mobile users or whether this is an actual regression/gap.
- **Stack-level terminal auto-collapse / auto-close 10s after action** — we ported the `ProgressTerminal.vue` component for Agent Maintenance, but hamphh's 1.1 release note describes this behavior for the *main stack terminal* on the Compose page too. Haven't confirmed if darthrater78's existing stack terminal already behaves this way or needs the same component swapped in.
- **Button tooltips** — hamphh added tooltips broadly in 1.1 ("most buttons now have tooltips"). Haven't audited darthrater78's coverage to know if this is a real gap or already comparable.
- **YAML validation improvements** (pre-save validation) — not compared between the two forks.
- **"Delete stack" button moved to submenu** — cosmetic placement change in hamphh; not checked whether darthrater78 already does this or where its delete button currently lives.

## Suggested order (live testing is done, green light given)
1. Fullscreen toggle on primary editor (small, UI-only) — **up next**
2. Resolve the four "unverified" items above with quick checks (likely small or non-issues)
3. Advanced category filter dropdown (medium — the real remaining chunk of work)
4. Lint cleanup (`eslint --fix`, isolated commit)
