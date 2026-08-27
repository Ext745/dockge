<div align="center" width="100%">
    <img src="./frontend/public/icon.svg" width="128" alt="" />
</div>

# Dockge

A fancy, easy-to-use and reactive self-hosted docker compose.yaml stack-oriented manager.

[![GitHub Repo stars](https://img.shields.io/github/stars/louislam/dockge?logo=github&style=flat)](https://github.com/louislam/dockge) [![Docker Pulls](https://img.shields.io/docker/pulls/louislam/dockge?logo=docker)](https://hub.docker.com/r/louislam/dockge/tags) [![Docker Image Version (latest semver)](https://img.shields.io/docker/v/louislam/dockge/latest?label=docker%20image%20ver.)](https://hub.docker.com/r/louislam/dockge/tags) [![GitHub last commit (branch)](https://img.shields.io/github/last-commit/louislam/dockge/master?logo=github)](https://github.com/louislam/dockge/commits/master/)

<img src="https://github.com/louislam/dockge/assets/1336778/26a583e1-ecb1-4a8d-aedf-76157d714ad7" width="900" alt="" />

View Video: https://youtu.be/AWAlOQeNpgU?t=48

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
- 🔄 (1.8.0 🆕) Compose Drift Check — detect and fix image tag drift between running containers and compose files

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
curl https://raw.githubusercontent.com/darthrater78/dockge/merged-features/compose.yaml --output compose.yaml

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

## Version History

### 1.8.0
- Removed image update detection feature (skopeo-based registry digest comparison)
- Removed auto-update scheduler (cron-based), per-stack auto-update toggle, and "Update All" button
- Removed `skopeo` from Docker image dependencies
- Renamed "Version Sync" to "Compose Drift Check" across the UI
- Replaced "Update All" sidebar button with "Compose Drift Check" link
- Simplified Settings page — removed update defaults and scheduler UI, kept API key management
- Fixed dark mode styling for drift check panel (table text, code element contrast)

### 1.7.1
- Added global "Scan All" Compose Drift Check panel on the Home page — scans every stack across all connected agents in one click
- Added Compose Drift Check API endpoint documentation and examples to README
- Documented agent compatibility requirements for Compose Drift Check

### 1.7.0
- Added Compose Drift Check: detect and fix image tag drift between running containers and compose files
- Per-stack Compose Drift Check button in the Compose view for scanning individual stacks
- Scan for mismatches caused by external update tools (WUD, Watchtower) that update containers without touching compose YAML
- One-click sync to update compose files to match running container images, preserving YAML comments
- Sync history with revert capability
- REST API endpoints at `/api/version-sync/` for scan, sync, sync-all, history, and revert
- Multi-host support via Dockge agent socket handlers
- **Note:** All Dockge instances (master + agents) must run v1.7.0+ for Compose Drift Check to work

### 1.6.3
- Fixed `GET /api/stacks` returning empty `services` — container state, status, health, and image info are now included per stack
- Enables HA integration container sensors to display per-container running state

### 1.6.2
- Added `POST /api/stacks/:name/down` endpoint — stop and remove containers (make stack inactive)
- Completes the stack lifecycle API: start, stop, restart, down

### 1.6.1
- Added Settings UI for API key management
- Added `setApiKey` socket handler for setting API keys from the UI

### 1.6.0
- Added REST API for external automation (CI/CD pipelines, scripts, monitoring tools)
- Added version-gated backward compatibility for pre-1.6.0 agents
- Security: API authentication uses SHA-256 hashed constant-time comparison
- Security: Stack name validation prevents path traversal in all API endpoints

### 1.5.3
- Security: blocked path traversal via crafted stack names in all stack operations (start, stop, delete, etc.)
- Security: JWT tokens now expire after 30 days instead of never
- Security: `resetPassword` no longer leaves the plaintext password on the user model instance
- Security: compose YAML `x-dockge.urls` now only renders `http:`/`https:` links, blocking `javascript:` XSS
- Fixed: nightly release workflow now targets `ghcr.io/darthrater78/dockge` instead of the upstream namespace, and uses `GITHUB_TOKEN` instead of a custom PAT

### 1.5.2
- Fixed: adding a new Dockge Agent failed with `SQLITE_ERROR: table agent has no column named name` on any pre-existing install. The original `agent` table migration was edited in place to add a `name` column instead of shipping a follow-up migration, so databases that had already applied the old migration never picked up the column. A new migration backfills it.

### 1.5.1
- Added Compose override editor (`compose.override.yaml` support)
- Added optional Cloudflare Turnstile CAPTCHA on login
- Fixed: post-setup login callback not firing
- Fixed: potential crash on malformed login payload when Turnstile is enabled
- Fixed: Turnstile script load failure permanently blocking login
- Fixed: duplicate Turnstile widgets on repeated Login component mounts

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
https://github.com/louislam/dockge/issues

### Ask for Help / Discussions
https://github.com/louislam/dockge/discussions

### Translation
If you want to translate Dockge into your language, please read [Translation Guide](https://github.com/louislam/dockge/blob/master/frontend/src/lang/README.md)

### Create a Pull Request

Be sure to read the [guide](https://github.com/louislam/dockge/blob/master/CONTRIBUTING.md), as we don't accept all types of pull requests and don't want to waste your time.

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
