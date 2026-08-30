<div align="center" width="100%">
    <img src="./frontend/public/icon.svg" width="128" alt="" />
</div>

# Dockge

A fancy, easy-to-use and reactive self-hosted docker compose.yaml stack-oriented manager.

[![GitHub Repo stars](https://img.shields.io/github/stars/darthrater78/dockge?logo=github&style=flat)](https://github.com/darthrater78/dockge) [![GitHub release (latest by date)](https://img.shields.io/github/v/release/darthrater78/dockge?label=release)](https://github.com/darthrater78/dockge/releases) [![GitHub last commit (branch)](https://img.shields.io/github/last-commit/darthrater78/dockge/master?logo=github)](https://github.com/darthrater78/dockge/commits/master/)

<img src="https://github.com/louislam/dockge/assets/1336778/26a583e1-ecb1-4a8d-aedf-76157d714ad7" width="900" alt="" />

View Video: https://youtu.be/AWAlOQeNpgU?t=48

---

## 🤖 Built by Claude Code

> **Every line of new code in this fork — from v1.5.2 onward — was written entirely by [Claude Code](https://claude.ai/code), Anthropic's AI coding agent.** No human wrote the implementation code. A human ([@darthrater78](https://github.com/darthrater78)) directed the work: describing features, reviewing PRs, and approving releases, but Claude Code authored all source changes, security fixes, documentation, and release engineering across **8 feature releases and 33+ commits**.

### What Claude Code built in this fork

Starting from the upstream [louislam/dockge](https://github.com/louislam/dockge) at v1.4.2, Claude Code implemented the following — each delivered as a branch, PR, security-reviewed build, and tagged release:

| Version | What was built | Scope |
|---------|---------------|-------|
| **v1.5.2** | Agent name column migration fix | Database migration that existing installs missed |
| **v1.5.3** | Security hardening | Path traversal fix, JWT expiry (30-day), XSS sanitization, password model fix, nightly CI workflow |
| **v1.6.0** | REST API (ported) | Ported from [finder39/dockge](https://github.com/finder39/dockge) and adapted to this fork's architecture — 13 endpoints, API key auth, stack validation, update history, auto-update scheduler |
| **v1.6.1** | Settings UI | Frontend for API key management, cron scheduler, per-stack auto-update toggle |
| **v1.6.2** | Stack lifecycle API | `POST /api/stacks/:name/down` endpoint completing the full start/stop/restart/down lifecycle |
| **v1.6.3** | API data fix | Container state, status, health, and image info populated in `GET /api/stacks` responses |
| **v1.7.0** | Compose Drift Check | Detect image tag drift between running containers and compose files, one-click sync, YAML-comment-preserving writes, sync history with revert, multi-host agent support |
| **v1.7.1** | Global drift scan | "Scan All" button on Home page scanning every stack on every connected agent |
| **v1.8.0** | Feature removal & rename | Removed skopeo-based image update detection (too complex, unreliable), renamed to "Compose Drift Check" |
| **v1.8.1** | Dark mode & reliability | Fixed Bootstrap CSS overrides breaking dark mode, added 30s agent timeout for offline nodes |
| **v1.8.2** | Security patch | Updated ws (HIGH — memory disclosure/DoS), yaml (MODERATE — stack overflow), express (body-parser DoS, ReDoS, qs bypass) |
| **v1.9.0** | 2FA & encryption | TOTP two-factor authentication, `.env` file persistence on stack save, AES-256-GCM encryption for agent credentials at rest, terminal shell allowlist |

### How it worked

1. **Human direction** — The maintainer described what to build ("add a REST API", "detect image drift", "add 2FA") and provided architectural preferences
2. **Claude Code implementation** — Claude Code read the existing codebase, designed the changes, wrote the code, and produced working builds
3. **Security gate** — Every build went through a security scan checking for hardcoded secrets, injection vectors, path traversal, weak crypto, and dependency CVEs before any commit
4. **Review & release** — The maintainer reviewed each PR, tested the build, and approved the release. Claude Code authored the release notes, tags, and changelog entries

All Claude-authored commits carry a `Co-Authored-By: Claude` trailer in the git history. PR branches are prefixed with `claude/`.

### The Dev Skills gate system

Starting with later releases, development used a custom **Dev Skills** discipline — a structured set of mandatory gates that Claude Code enforces on itself before any code can be committed, pushed, or released. This changed the quality of the output significantly compared to earlier releases that relied on ad-hoc review.

The gate system works like a pre-flight checklist that cannot be skipped:

```
🔢 VERSION  →  🔨 BUILD  →  🔒 SECURITY  →  📄 DOCS  →  📦 RELEASE  →  🚀 PUSH
```

**What each gate catches:**

1. **Version Gate** — Every version-carrying file in the project (package.json, source code, UI strings) must agree. Claude Code greps the entire codebase for hardcoded version strings — a missed version in a window title or "About" dialog is a gate failure. The repository URL must also be present in manifests.

2. **Build Gate** — A test build must be created and verified working before anything is committed. Not "it compiled" — the app must start, the golden path must work, and no regressions should be visible.

3. **Security & Quality Gate** — This is where the biggest improvement happened. After every successful build, Claude Code runs a full scan of all source files against a detailed security checklist:
   - **Hard stops** (must fix): hardcoded secrets, SQL injection, `shell=True` with user input, disabled TLS, pickle on untrusted data, path traversal, missing auth, debug mode in production, weak crypto
   - **Quality review**: N+1 queries, god functions (>40 lines), deep nesting, wrong data structures, string concatenation in loops, unbounded caches, missing database indexes
   - The security scan also runs the project's native `npm audit` and checks every dependency for typosquatting, maintenance health, and known CVEs

4. **Docs Gate** — Changelog entries, README updates for new/changed/removed features, and stale documentation are all checked before release.

5. **Release & Push Gates** — Branch protection is enforced (never commit directly to main), release notes must be reviewed and approved, and the final push requires explicit human confirmation.

**How this made the image better:**

- **v1.5.3's security hardening** (path traversal, JWT expiry, XSS fixes) came directly from the security gate catching patterns in the existing codebase
- **v1.8.2's dependency patches** (ws memory disclosure, yaml stack overflow, express DoS) were surfaced by the mandatory `npm audit` step
- **v1.9.0's terminal shell allowlist** and **agent credential encryption** were security gate findings — Claude Code flagged that terminal commands accepted arbitrary shells and that agent passwords were stored in plaintext, then fixed both before the build could pass
- **Earlier releases without the gate system** shipped features that later had to be removed (the skopeo-based image update detection in v1.8.0) — the quality gate's complexity review would likely have flagged that design as too fragile before it shipped

The gate system means no commit happens without a security scan, no release ships without verified docs, and no push goes out without the maintainer explicitly typing "push." It turns Claude Code from a code generator into a disciplined release engineer.

### Community contributions cherry-picked into this fork

This fork stands on the work of the upstream project and its community. The following features were cherry-picked from open pull requests on [louislam/dockge](https://github.com/louislam/dockge) and integrated before Claude Code development began:

| Contributor | Feature | Upstream PR |
|-------------|---------|-------------|
| [Elias Floreteng](https://github.com/eliasfloreteng) | Compose override editor — edit `compose.override.yaml` alongside the main compose file | [#23](https://github.com/louislam/dockge/pull/23) |
| [Richy HBM](https://github.com/RichyHBM) | PUID/PGID support — set stack file/directory ownership | [#83](https://github.com/louislam/dockge/pull/83) |
| [Kevin (syko9000)](https://github.com/syko9000) | Global `.env` editor and usage in docker operations | [#387](https://github.com/louislam/dockge/pull/387) |
| [Julian (skl)](https://github.com/skl) | Agent friendly name — set/update display names for remote agents | [#414](https://github.com/louislam/dockge/pull/414) |
| [CampaniaGuy](https://github.com/CampaniaGuy) | Theme options — light/dark/auto theme selection in settings | [#575](https://github.com/louislam/dockge/pull/575) |
| [Niraj Yadav](https://github.com/nickkdev) | Remove terminal buffer console logging | [#582](https://github.com/louislam/dockge/pull/582) |
| [Lance Cain (mizady)](https://github.com/mizady) | Container control buttons — start/stop/restart individual containers | [#649](https://github.com/louislam/dockge/pull/649) |
| [Justin Wiebe](https://github.com/justwiebe) | Resource usage stats on the compose page (CPU, memory per container) | [#700](https://github.com/louislam/dockge/pull/700) |
| [Joshua Anderson (andersmmg)](https://github.com/andersmmg) | Replace textarea editor with CodeMirror (syntax highlighting, line numbers) | [#786](https://github.com/louislam/dockge/pull/786) |
| [Matthew McConnell (maca134)](https://github.com/maca134) | Improved stack list UI when using agents | [#800](https://github.com/louislam/dockge/pull/800) |
| [Dimariqe](https://github.com/Dimariqe) | Clipboard copy/paste support in the web terminal | [#822](https://github.com/louislam/dockge/pull/822) |
| [nullcat](https://github.com/nullcat) | Fix `isComposeExitClean` TypeError when compose is stopped | [#37](https://github.com/louislam/dockge/pull/37) |
| [Aymen Djellal](https://github.com/aymen-djellal) | Improve JSON parsing with error handling | [#25](https://github.com/louislam/dockge/pull/25) |
| [Grant Birkinbine](https://github.com/GrantBirki) | Update json-yaml-validate to latest version | [#446](https://github.com/louislam/dockge/pull/446) |

**REST API origin — [finder39/dockge](https://github.com/finder39/dockge):**
The REST API framework (v1.6.0) was ported from finder39's Dockge fork ("Dockge Managed"), which implemented the original API router, auto-update scheduler, image update detection via skopeo, and update history tracking. Claude Code adapted the code to work with this fork's architecture and added backward compatibility for mixed-version agent deployments.

**Fork collaborator — [Chris Cooper (cmcooper1980)](https://github.com/cmcooper1980):**
- Cloudflare Turnstile CAPTCHA integration on login
- "Update All" button for bulk stack updates
- v-html XSS vulnerability fixes and npm audit cleanup
- Variable highlighting in the CodeMirror editor
- Agent display logic improvements
- Compose override editor refinements (dynamic titles, component naming)

**Upstream — [Louis Lam (louislam)](https://github.com/louislam):**
Dockge itself is Louis Lam's project. This fork is built on top of the [original Dockge](https://github.com/louislam/dockge) at v1.4.2, which includes the core compose manager, interactive terminal, multi-agent support, and the reactive real-time UI.

---

## ⭐ Features

- 🧑‍💼 Manage your `compose.yaml` files
  - Create/Edit/Start/Stop/Restart/Delete
- ⌨️ Interactive Editor for `compose.yaml`
- 🦦 Interactive Web Terminal
- 🕷️ (1.4.0 🆕) Multiple agents support - You can manage multiple stacks from different Docker hosts in one single interface
- 🏪 Convert `docker run ...` commands into `compose.yaml`
- 📙 File based structure - Dockge won't kidnap your compose files, they are stored on your drive as usual. You can interact with them using normal `docker compose` commands
- 🧩 (1.5.1 🆕) Compose override editor - Edit `compose.override.yaml` alongside your main compose file, when present
- 🔐 (1.5.1 🆕) Optional Cloudflare Turnstile CAPTCHA on login
- 🌐 (1.6.0 🆕) REST API for external automation (CI/CD, scripts, monitoring)
- 🔄 (1.7.0 🆕) Compose Drift Check — detect and fix image tag drift between running containers and compose files
- 🔑 (1.9.0 🆕) Two-Factor Authentication (TOTP) — protect your account with app-based 2FA

<img src="https://github.com/louislam/dockge/assets/1336778/cc071864-592e-4909-b73a-343a57494002" width=300 />

- 🚄 Reactive - Everything is just responsive. Progress (Pull/Up/Down) and terminal output are in real-time
- 🐣 Easy-to-use & fancy UI - If you love Uptime Kuma's UI/UX, you will love this one too

![](https://github.com/louislam/dockge/assets/1336778/89fc1023-b069-42c0-a01c-918c495f1a6a)

## 🔧 How to Install

Requirements:
- [Docker](https://docs.docker.com/engine/install/) 20+ / Podman
- (Podman only) podman-docker (Debian: `apt install podman-docker`)
- OS:
  - Major Linux distros that can run Docker/Podman such as:
     - ✅ Ubuntu
     - ✅ Debian (Bullseye or newer)
     - ✅ Raspbian (Bullseye or newer)
     - ✅ CentOS
     - ✅ Fedora
     - ✅ ArchLinux
  - ❌ Debian/Raspbian Buster or lower is not supported
  - ❌ Windows (Will be supported later)
- Arch: armv7, arm64, amd64 (a.k.a x86_64)

### Basic

- Default Stacks Directory: `/opt/stacks`
- Default Port: 5001

```
# Create directories that store your stacks and stores Dockge's stack
mkdir -p /opt/stacks /opt/dockge
cd /opt/dockge

# Download the compose.yaml
curl https://raw.githubusercontent.com/darthrater78/dockge/master/compose.yaml --output compose.yaml

# Start the server
docker compose up -d

# If you are using docker-compose V1 or Podman
# docker-compose up -d
```

Dockge is now running on http://localhost:5001

### Advanced

If you want to store your stacks in another directory, you can generate your compose.yaml file by using the following URL with custom query strings.

```
# Download your compose.yaml
curl "https://dockge.kuma.pet/compose.yaml?port=5001&stacksPath=/opt/stacks" --output compose.yaml
```

- port=`5001`
- stacksPath=`/opt/stacks`

Also, once compose is generated/downloaded, add the `PUID` and `PGID` section below to your compose `environment:` section to set stack ownership, otherwise default is `root`

```
      # Both PUID and PGID must be set for it to do anything
      - PUID=1000 # Set the stack file/dir ownership to this user
      - PGID=1000 # Set the stack file/dir ownership to this group
```

Interactive compose.yaml generator is available on: 
https://dockge.kuma.pet

### -OR-
Copy and paste your compose from the following:

If you want to store your stacks in another directory, you can change the `DOCKGE_STACKS_DIR` environment variable and volumes.

compose:
```
services:
  dockge:
    image: ghcr.io/darthrater78/dockge:latest
    restart: unless-stopped
    ports:
      # Host Port:Container Port
      - 5001:5001
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./data:/app/data
        
      # If you want to use private registries, you need to share the auth file with Dockge:
      # - /root/.docker/:/root/.docker

      # Stacks Directory
      # Your stacks directory in the host (The paths inside container must be the same as the host)
      # ⚠️ If you did it wrong, your data could end up be written into a wrong path.
      # ✔️ CORRECT EXAMPLE: - /my-stacks:/my-stacks (Both paths match)
      # ❌ WRONG EXAMPLE: - /docker:/my-stacks (Both paths do not match)
      - /opt/stacks:/opt/stacks
    environment:
      # Tell Dockge where your stacks directory is
      - DOCKGE_STACKS_DIR=/opt/stacks
      # Both PUID and PGID must be set for it to do anything
      - PUID=1000 # Set the stack file/dir ownership to this user
      - PGID=1000 # Set the stack file/dir ownership to this group
```

## How to Update

```bash
cd /opt/dockge
docker compose pull && docker compose up -d
```

## Optional: Cloudflare Turnstile CAPTCHA

To require a CAPTCHA challenge on the login page, set both of the following environment variables on the Dockge container. If either is unset, CAPTCHA verification is skipped.

```
      - TURNSTILE_SITE_KEY=<your Turnstile site key>
      - TURNSTILE_SECRET_KEY=<your Turnstile secret key>
```

Keys can be created in the [Cloudflare dashboard](https://developers.cloudflare.com/turnstile/get-started/).

## REST API

Dockge v1.6.0 introduces a REST API for managing stacks programmatically. The API runs on the master node only — agents do not need any changes and continue to communicate via Socket.IO.

### Authentication

All API endpoints require a static API key passed in the `X-API-Key` header.

Set your API key via environment variable:
```
      - DOCKGE_API_KEY=your-secret-api-key-here
```

Or set it at runtime through the UI/socket settings. The key is stored as a SHA-256 hash.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/stacks` | List all stacks (local and remote agents) |
| `GET` | `/api/stacks/:name` | Get details for a single stack |
| `POST` | `/api/stacks/:name/start` | Start a stack |
| `POST` | `/api/stacks/:name/stop` | Stop a stack |
| `POST` | `/api/stacks/:name/restart` | Restart a stack |
| `POST` | `/api/stacks/:name/down` | Tear down a stack |
| `GET` | `/api/version-sync/scan` | Scan for image tag mismatches between compose files and running containers |
| `POST` | `/api/version-sync/sync` | Sync a specific service's compose image to the running version |
| `POST` | `/api/version-sync/sync-all` | Sync all mismatched services for a stack |
| `GET` | `/api/version-sync/history` | Query version sync history with pagination |
| `POST` | `/api/version-sync/revert` | Revert a previous version sync |

### Query Parameters

**`GET /api/stacks`** and **`GET /api/stacks/:name`** accept:
- `?endpoint=hostname:port` — target a specific remote agent

**`GET /api/version-sync/scan`** accepts:
- `?stackName=mystack` — scan a specific stack (omit to scan all)
- `?endpoint=hostname:port` — target a specific remote agent

**`POST /api/version-sync/sync`** accepts JSON body:
- `stackName` (string, required) — stack to sync
- `service` (string, required) — service name within the stack
- `newImage` (string, required) — image tag to write into the compose file

**`POST /api/version-sync/sync-all`** accepts JSON body:
- `stackName` (string, required) — stack to sync all mismatches for

**`GET /api/version-sync/history`** accepts:
- `?page=1&limit=20` — pagination
- `?stackName=mystack` — filter by stack name
- `?service=myservice` — filter by service name

**`POST /api/version-sync/revert`** accepts JSON body:
- `stackName` (string, required) — stack containing the service to revert
- `service` (string, required) — service to revert to its previous image

### Example

```bash
# List all stacks
curl -H "X-API-Key: your-key" http://localhost:5001/api/stacks

# Scan all stacks for compose/running image mismatches
curl -H "X-API-Key: your-key" http://localhost:5001/api/version-sync/scan

# Scan a specific stack
curl -H "X-API-Key: your-key" "http://localhost:5001/api/version-sync/scan?stackName=myapp"

# Sync a service to its running image
curl -X POST -H "X-API-Key: your-key" -H "Content-Type: application/json" \
  -d '{"stackName":"myapp","service":"web","newImage":"nginx:1.27"}' \
  http://localhost:5001/api/version-sync/sync

# Revert a previous sync
curl -X POST -H "X-API-Key: your-key" -H "Content-Type: application/json" \
  -d '{"stackName":"myapp","service":"web"}' \
  http://localhost:5001/api/version-sync/revert
```

### Agent Compatibility

The API communicates with remote agents via Socket.IO. Agents running pre-1.6.0 versions are supported with graceful degradation:
- Stack listing falls back to legacy call signatures
- Unsupported agents are listed in the response so you know which nodes need upgrading

**Compose Drift Check requires v1.7.0 on all instances.** The master Dockge and every agent must run v1.7.0 or later for Compose Drift Check to work. The scan and sync commands are registered as new socket events (`scanVersionSync`, `syncVersion`, `syncAllVersions`, `revertVersionSync`) — agents running older versions will not respond to these events. The global scan on the Home page only contacts agents that are online; offline or pre-1.7.0 agents are skipped with a warning.

**Agent credential encryption (v1.9.0):** Agent passwords are now encrypted at rest using AES-256-GCM. A one-time migration encrypts existing plaintext passwords on first startup. Remote agents do not need updating — the wire protocol is unchanged. However, rolling back the primary to a pre-1.9.0 version after migration will break agent authentication; back up the SQLite database before upgrading.

## Version History

### 1.9.0

**Added**
- Two-Factor Authentication (TOTP) — full backend implementation for setup, verification, enable/disable flows that were previously non-functional
- `.env` file persistence — stack save now writes the `.env` file when the user provides environment content
- Agent credential encryption — passwords stored at rest are encrypted with AES-256-GCM, keyed from the JWT secret
- One-time database migration to encrypt existing plaintext agent passwords

**Fixed**
- `callbackError` now correctly distinguishes `ValidationError` from generic `Error` (subclass check order was inverted)
- Removed stray `console.log` in `getComposeOptions`
- SSL passphrase no longer logged in debug config output

**Security**
- Interactive terminal shell restricted to allowlist (`bash`, `sh`, `ash`, `zsh`)
- Socket handler `updateAgent` params validated as `unknown` before use
- Removed dead `needRehashPassword` function

**Known issue**
- `UPTIME_KUMA_WS_ORIGIN_CHECK=bypass` disables WebSocket origin validation entirely — if you use this env var for reverse proxy compatibility, be aware it removes CSRF protection. A safer allowlist-based alternative is planned for a future release.

### 1.8.2

Security patch — updated production dependencies to fix known vulnerabilities:

- `ws` 8.17.1 → 8.21.3 (HIGH) — memory disclosure; memory-exhaustion DoS from tiny fragments
- `yaml` 2.3.4 → 2.9.0 (MODERATE) — stack overflow via deeply nested YAML collections
- `express` 4.21.2 → 4.22.2 — body-parser DoS when an invalid limit silently disables size enforcement; path-to-regexp ReDoS via multiple route parameters; qs arrayLimit bypass allowing DoS via memory exhaustion

### 1.8.1

**Fixed**
- Dark mode drift check panel — Bootstrap CSS custom properties were overriding inherited colors, making table text nearly invisible
- Scan hanging forever when an agent is offline — added 30s per-agent timeout

**Changed**
- Moved "Sync All" button to top of drift check panel, disabled until scan completes

### 1.8.0

**Removed**
- Image update detection feature (skopeo-based registry digest comparison)
- Auto-update scheduler (cron-based), per-stack auto-update toggle, and "Update All" button
- `skopeo` from Docker image dependencies
- All update-related API endpoints (`/api/stacks/:name/update`, `/api/stacks/:name/check-updates`, `/api/update-all`, `/api/scheduler`, `/api/update-history`)
- Settings UI for update defaults and scheduler configuration

**Changed**
- Renamed "Version Sync" to "Compose Drift Check" across the UI
- Replaced "Update All" sidebar button with "Compose Drift Check" link
- Simplified Settings page to API key management only

**Fixed**
- Dark mode styling for drift check panel (table text visibility, code element contrast)

### 1.7.1
- Global Version Sync — Scan All button on the Home page detects image tag drift across every stack on every connected agent in one click
- Per-row Sync buttons and Sync All to update compose files to match running containers
- Version Sync API endpoint documentation and examples added to README
- Agent compatibility requirements documented (all instances need v1.7.0+)

### 1.7.0
- Compose Version Sync: detect and fix image tag drift between running containers and compose files
- Scan for mismatches caused by external update tools (WUD, Watchtower)
- One-click sync to update compose files, preserving YAML comments
- Sync history with revert capability
- REST API endpoints at `/api/version-sync/`
- Multi-host support via Dockge agent socket handlers

### 1.6.3
- Fixed `GET /api/stacks` returning empty `services` — container state, status, health, and image info are now included per stack
- Enables HA integration container sensors to display per-container running state

### 1.6.2
- Added `POST /api/stacks/:name/down` endpoint — stop and remove containers (make stack inactive)
- Completes the stack lifecycle API: start, stop, restart, down

### 1.6.1
- Added Settings UI for update defaults (prune toggles), auto-update scheduler (enable/cron), and API key management
- Added per-stack auto-update toggle in the Compose view
- Added `setApiKey` socket handler for setting API keys from the UI
- Fixed misleading API key storage description in settings

### 1.6.0

**REST API**
- 13 endpoints for managing stacks programmatically
- Static API key authentication via `X-API-Key` header
- Stack name validation prevents path traversal
- Update history tracking with pagination and filtering

**Auto-Update Scheduler**
- Cron-based scheduled updates with per-stack opt-in
- Configurable image pruning after updates
- Self-update detection via sidecar container
- Image update detection using skopeo

**Agent Backward Compatibility**
- Version-gated degradation for pre-1.6.0 agents
- Mixed-version deployments work without breaking satellite nodes

**Infrastructure**
- Added skopeo to Docker image
- Knex migration for `stack_setting` and `update_history` tables

### 1.5.3

Security hardening:
- **Path traversal fix** — stack names are now validated in `Stack.getStack()` before any filesystem or Docker operation, preventing directory escape via crafted names
- **JWT expiry** — tokens now expire after 30 days (previously never expired)
- **Password model fix** — `resetPassword` no longer leaves the plaintext password on the user instance after updating
- **XSS fix** — compose `x-dockge.urls` only renders `http:`/`https:` links; `javascript:` and other dangerous protocols are dropped
- **Nightly workflow fix** — retargeted to `ghcr.io/darthrater78/dockge`, uses `GITHUB_TOKEN` instead of a custom PAT

### 1.5.2
- Fixed: adding a new Dockge Agent failed with `SQLITE_ERROR: table agent has no column named name` on any pre-existing install. The original `agent` table migration was edited in place to add a `name` column instead of shipping a follow-up migration, so databases that had already applied the old migration never picked up the column. A new idempotent migration backfills it.

### 1.5.1

**Fixes**
- Fixed Update All button crash (undefined `sortedStackList`/`processing`)
- Fixed post-setup login callback swallowed by missing `captchaToken` argument
- Fixed potential crash on malformed login payload when Turnstile is enabled
- Fixed Turnstile script load failure permanently blocking login with no fallback
- Fixed duplicate Turnstile widgets on repeated Login component mounts
- Fixed broken i18n lookup on the stack update toast message

**Chores**
- Replaced `console.*` logging in Turnstile verification with the project's log module
- Documented Compose Override, Turnstile CAPTCHA, and Update All features in README, including `TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY` env vars

## Screenshots

![](https://github.com/louislam/dockge/assets/1336778/e7ff0222-af2e-405c-b533-4eab04791b40)


![](https://github.com/louislam/dockge/assets/1336778/7139e88c-77ed-4d45-96e3-00b66d36d871)

![](https://github.com/louislam/dockge/assets/1336778/f019944c-0e87-405b-a1b8-625b35de1eeb)

![](https://github.com/louislam/dockge/assets/1336778/a4478d23-b1c4-4991-8768-1a7cad3472e3)


## Motivations

- I have been using Portainer for some time, but for the stack management, I am sometimes not satisfied with it. For example, sometimes when I try to deploy a stack, the loading icon keeps spinning for a few minutes without progress. And sometimes error messages are not clear.
- Try to develop with ES Module + TypeScript

If you love this project, please consider giving it a ⭐.


## 🗣️ Community and Contribution

### Bug Report
https://github.com/darthrater78/dockge/issues

### Ask for Help / Discussions
https://github.com/darthrater78/dockge/discussions

### Translation
If you want to translate Dockge into your language, please read [Translation Guide](https://github.com/darthrater78/dockge/blob/master/frontend/src/lang/README.md)

### Create a Pull Request

Be sure to read the [guide](https://github.com/darthrater78/dockge/blob/master/CONTRIBUTING.md), as we don't accept all types of pull requests and don't want to waste your time.

## FAQ

#### "Dockge"?

"Dockge" is a coinage word which is created by myself. I originally hoped it sounds like `Dodge`, but apparently many people called it `Dockage`, it is also acceptable.

The naming idea came from Twitch emotes like `sadge`, `bedge` or `wokege`. They all end in `-ge`.

#### Can I manage a single container without `compose.yaml`?

The main objective of Dockge is to try to use the docker `compose.yaml` for everything. If you want to manage a single container, you can just use Portainer or Docker CLI.

#### Can I manage existing stacks?

Yes, you can. However, you need to move your compose file into the stacks directory:

1. Stop your stack
2. Move your compose file into `/opt/stacks/<stackName>/compose.yaml`
3. In Dockge, click the " Scan Stacks Folder" button in the top-right corner's dropdown menu
4. Now you should see your stack in the list

#### Is Dockge a Portainer replacement?

Yes or no. Portainer provides a lot of Docker features. While Dockge is currently only focusing on docker-compose with a better user interface and better user experience.

If you want to manage your container with docker-compose only, the answer may be yes.

If you still need to manage something like docker networks, single containers, the answer may be no.

#### Can I install both Dockge and Portainer?

Yes, you can.

## Others

Dockge is built on top of [Compose V2](https://docs.docker.com/compose/migrate/). `compose.yaml`  also known as `docker-compose.yml`.
