<div align="center" width="100%">
    <img src="./frontend/public/icon.svg" width="128" alt="" />
</div>

# Dockge

A fancy, easy-to-use and reactive self-hosted docker compose.yaml stack-oriented manager.

[![GitHub Repo stars](https://img.shields.io/github/stars/Ext745/dockge?logo=github&style=flat)](https://github.com/Ext745/dockge) [![GitHub release (latest by date)](https://img.shields.io/github/v/release/Ext745/dockge?label=release)](https://github.com/Ext745/dockge/releases) [![GitHub last commit (branch)](https://img.shields.io/github/last-commit/Ext745/dockge/master?logo=github)](https://github.com/Ext745/dockge/commits/master/)

<img src="https://github.com/louislam/dockge/assets/1336778/26a583e1-ecb1-4a8d-aedf-76157d714ad7" width="900" alt="" />

View Video: https://youtu.be/AWAlOQeNpgU?t=48

---

## 🤖 Built by Claude Code

This is a fork of a fork. [darthrater78/dockge](https://github.com/darthrater78/dockge) — the base this repo builds on — had every line of its new code (from v1.5.2 through v2.1.0: REST API, Compose Drift Check, 2FA, port-conflict detection, CI hardening, and more) written by [Claude Code](https://claude.ai/code) under human direction, plus community PRs cherry-picked from [louislam/dockge](https://github.com/louislam/dockge) and its own fork collaborators. Full build history, the Dev Skills gate methodology, and contributor credits live in **[their README](https://github.com/darthrater78/dockge/blob/master/README.md)** — not duplicated here to keep this one short.

### This fork — [Ext745/dockge](https://github.com/Ext745/dockge)

On top of that base, [Claude Code](https://claude.ai/code) ported the following features from [hamphh/dockge 1.2](https://github.com/hamphh/dockge), a separate community fork, then closed out every remaining gap between the two:

| What was ported/added | Detail |
|---|---|
| **Agent Maintenance UI** | Container/image/network/volume listing per Docker agent, prune/prune-all/remove, image pull, live terminal streaming of Docker CLI output, multi-agent endpoint switching |
| **Ignore-service-status toggle** | `dockge.status.ignore=true` compose label excludes a service from a stack's aggregate running/exited status, on both the REST API and the dashboard's live status badge |
| **Fullscreen compose editor toggle** | Expand the primary `compose.yaml` editor (not just the override editor) into a fullscreen modal, synced via the same `v-model` |
| **Stack-terminal auto-collapse/auto-close** | The Compose page's progress terminal now opens on action and auto-hides ~10s after completion, matching the Agent Maintenance terminal's behavior |
| **Advanced category filter** | Filter the stack list by agent and status from a dropdown |
| **Delete-stack relocation** | Moved into the kebab (⋮) submenu, matching the rest of the per-stack destructive actions |
| **Node-to-node stack transfer** | Zip a stack, send it to another connected agent, deploy it there, then remove it from the source — moves a stack between hosts from the kebab menu. Ported from [NekoSuneProjectsForks/dockge](https://github.com/NekoSuneProjectsForks/dockge), with its RBAC-dependent access checks (a role system this fork doesn't have) dropped down to this fork's actual `checkLogin`-only auth model |
| **Interactive progress terminal** | The Compose/Agent Maintenance progress terminal now forwards keystrokes, so `docker compose` `[y/N]` prompts and Ctrl+C work instead of hanging forever. Also from NekoSuneProjectsForks/dockge |
| **Auto-prune dangling images** | `Stack.update()` now prunes dangling images after a successful pull+up, so old layers don't pile up on every update |

Along the way, several pre-existing bugs in darthrater78's codebase were found and fixed by live-testing against real Docker daemons rather than trusting socket-protocol tests alone: two dangling-image detection bugs in Agent Maintenance, a missing `Terminal.vue.clearTerminal()` method that silently broke every progress-terminal call (Compose *and* Agent Maintenance pages), a broken `$root.getAgentName()` reference that prevented the Agent Maintenance page from mounting at all, a dead branch in the endpoint-display helper, and a login double-callback bug (three independent `if`s instead of if/else-if meant a stray `token` on a normal login could reach the 2FA branch and fire `callback()` twice). See `PORTING.md` and `dockge-port-tracking.md` in this repo for the full write-up, live-test methodology, and the bugs found.

**Explicitly not ported:** hamphh's skopeo-based image-update checker (darthrater78 already has a more capable version-sync/drift-check system) and hamphh's dedicated mobile UI (darthrater78's stack list already reflows usably on phone-width viewports via CSS grid). NekoSuneProjectsForks/dockge's container file browser (feature doesn't exist in this fork) and its own node/agent filter (redundant with the category filter above) were skipped for the same reason — nothing to port against, or already covered.

This fork is kept in sync with darthrater78/dockge via regular merges — last synced through **v2.1.0** (port-conflict-detection badges, resizable terminal panel, mobile navigation fix, CVE dependency overrides).

---

## ⭐ Features

- 🧑‍💼 Manage your `compose.yaml` files
  - Create/Edit/Start/Stop/Restart/Update/Delete
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
- 🐳 (Ext745/dockge 🆕) Agent Maintenance UI — manage containers, images, networks, and volumes per agent, with live terminal output
- 🙈 (Ext745/dockge 🆕) Ignore-service-status toggle — exclude specific services from a stack's aggregate status badge
- ⛶ (Ext745/dockge 🆕) Fullscreen toggle for the compose.yaml editor
- 🏷️ (Ext745/dockge 🆕) Advanced stack-list filtering by agent and status
- 🔀 (Ext745/dockge 🆕) Node-to-node stack transfer — move a stack to another connected agent from the kebab menu

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
curl https://raw.githubusercontent.com/Ext745/dockge/master/compose.yaml --output compose.yaml

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
    image: ghcr.io/ext745/dockge:latest
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
| `POST` | `/api/stacks/:name/update` | Pull images and restart a stack |
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

This fork's own changes are listed in the "This fork — Ext745/dockge" section near the top of this README. For the full darthrater78 version history (v1.5.1 through v2.1.0), see [their README](https://github.com/darthrater78/dockge/blob/master/README.md#version-history).

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
https://github.com/Ext745/dockge/issues

### Ask for Help / Discussions
https://github.com/Ext745/dockge/discussions

### Translation
If you want to translate Dockge into your language, please read [Translation Guide](https://github.com/Ext745/dockge/blob/master/frontend/src/lang/README.md)

### Create a Pull Request

Be sure to read the [guide](https://github.com/Ext745/dockge/blob/master/CONTRIBUTING.md), as we don't accept all types of pull requests and don't want to waste your time.

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
