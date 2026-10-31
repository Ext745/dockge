# Security Policy

## Reporting a Vulnerability

Please report security issues privately through GitHub's private vulnerability reporting:
https://github.com/Ext745/dockge/security/advisories/new

Do not open a public issue or discuss it in public before a fix is released.

If the issue also affects the original project, please report it to the upstream maintainers as well:
https://github.com/louislam/dockge/security/advisories/new

## Supported Versions

Only the latest release of this fork receives security fixes.

## Security architecture

What follows describes how this fork handles security, so it can be checked against the code. It started from darthrater78/dockge's description (v2.4.1) and is adjusted where this fork differs. Newest changes are listed at the end.

### Design

- **What Dockge can do.** It mounts `/var/run/docker.sock`, which is root-equivalent on the host: anyone who logs in to Dockge, or holds its API key, can run any container with any mount. Treat a Dockge login like root on the Docker host.
- **Login.** One user account: bcrypt password hash; JWT session tokens valid 30 days, signed with a random secret generated on first start; optional TOTP 2FA and optional Cloudflare Turnstile CAPTCHA. Login attempts are limited to 10 a minute for each client address, then to 30 a minute across all clients (an attempt refused by the per-address limit does not count towards the overall one). Behind a reverse proxy, turn on "Trust Proxy" in Settings so the client's address is used, not the proxy's. Checking a code while setting up 2FA is limited to 30 a minute.
- **REST API.** Off until an API key is generated in Settings or set with `DOCKGE_API_KEY`. Requests send it in `X-API-Key`; it is compared in constant time. Stack names are validated where every stack path is built.
- **Web console.** The host shell console is off unless `DOCKGE_ENABLE_CONSOLE=true`.
- **Process.** Dockge runs as root unless `DOCKGE_DROP_ROOT=true` is set with `PUID`/`PGID` (opt-in in this fork, so an existing install doesn't change user on an update). Then the container starts as root only to fix ownership of Dockge's own folders and join the docker.sock group, and runs as that user; Delete and Transfer use a short-lived helper container of Dockge's own image for app data owned by root. App files in the image are root-owned. The quickstart adds a read-only root filesystem, `no-new-privileges` and drops all capabilities, and mounts only Dockge's data folder and the stacks folder, as upstream, so Dockge has no access to the apps' data outside it. The wide `/opt/docker` mount of earlier quickstarts is no longer documented; `extra/narrow-bind-root.sh` removes it from an existing install.
- **Stored data** (`data/`, SQLite `dockge.db`, or MySQL/MariaDB when configured):
  - Password: bcrypt hash. JWT secret: plaintext in the database.
  - Remote agent passwords: AES-256-GCM. The key is the JWT secret, stored in the same database, so this protects a copy of the agent table on its own, not a copy of the whole database.
  - API key: plaintext in the database (Settings shows it again).
  - Registry logins: plaintext, as the Docker CLI stores them (in `data/docker-config` when Dockge drops root, else the container's `/root/.docker`).
  - Stack `.env` and `global.env`: written `0600`.
  - Nothing is encrypted at rest beyond the agent passwords. Protect `data/` and its backups like a credential store.
- **Network.** The web UI and socket.io on port 5001, plain HTTP. Put it behind an HTTPS reverse proxy for anything beyond a trusted LAN. Agent connections use the URL you enter (`https://` for TLS).
- **Releases.** Images are published to `ghcr.io/ext745/dockge` only from `v*` tags on `master` whose version matches `package.json` and whose commit passed CI. Unlike darthrater78's releases they are not gated by an image scan and carry no signed build provenance. The base and healthcheck images are darthrater78's, pinned by digest; all GitHub Actions are pinned to commit SHAs; Dependabot, dependency review and CodeQL run on pull requests.

### Changes

- 2026-10-31 (Ext745 v2.12.3): darthrater78 v2.4.2 merged (the items below dated 2026-10-31). New here: qs 6.17.1, the glob 14.0.3 / minimatch 11.0.3 overrides (Moderate), and from `npm audit fix` follow-redirects 1.16.2 and joi 17.13.9 (High); body-parser, fast-uri and ip-address were already fixed in Ext745 v2.12.2. vue-i18n 10 stays, on the grounds below.
- 2026-10-31 (v2.4.2): dependency fixes: body-parser 2.4.0 (High, denial of service from trailing bytes after a compressed body), fast-uri 3.1.9, ip-address 10.7.5, qs 6.17.1, and glob 14.0.3 / minimatch 11.0.3 through `overrides` (Moderate). Server dependencies audit clean.
- 2026-10-31 (risk accepted): GHSA-83rm-6c8r-g728 (High) and GHSA-8rc2-428q-7ww3 (Low) in vue-i18n 10.0.8. Not exploitable here: Dockge doesn't enable `escapeParameter`, renders no translation with `v-html`, and has no `srcdoc` in its messages. The fix needs vue-i18n 11; revisit if any of those change. The 10.x line is also out of support (no further fixes); accepted on the same grounds, no upgrade planned until an advisory affects Dockge.
- 2026-10-31 (v2.4.2): the quickstart and the migration script no longer mount `/opt/docker` or set `DOCKGE_BIND_ROOTS` by default; Dockge sees only its data folder and the stacks folder, as upstream. The wider mount is opt-in, with its trade-off documented.
- 2026-10-31 (v2.4.2): the wide mount is dropped from the quickstart, the docs and the migration script's prompt; `extra/narrow-bind-root.sh` switches an existing install back to the narrow mounts without moving any data.
- 2026-10-25 (Ext745 v2.12.2): darthrater78 v2.4.1 merged (the Node.js 22.23.4 / Go 1.27.3 items below). Login limit per client address before the overall one, so one client can no longer lock out every login. Requests for an offline agent are answered with an error. Port badges link only to `http`/`https` URLs (a compose port like `8080:80/javascript` gave a `javascript:` link).
- 2026-10-22 (v2.4.1): base image moved to Node.js 22.23.4 for the October 2026 Node.js security release (Brotli decoder RCE, TLS hostname bypasses).
- 2026-10-22 (v2.4.1): healthcheck binary rebuilt with Go 1.27.3 (CVE-2026-111943, CVE-2026-78667, CVE-2026-97031).
- 2026-10-22 (v2.4.1, risk accepted until 2.5.0): the API key and the session-signing secret are stored in plaintext in the database, and the agent-password key is that same secret. Accepted because `data/` is only readable on the Docker host; a fix (storing a hash of the API key, a separate key for agent passwords) is planned for 2.5.0.
- 2026-10-22 (v2.4.1, risk accepted until 2026-11-30): CVE-2026-78669 in the Docker Compose plugin's `golang.org/x/net`; no fixed Compose release yet.
- 2026-10-08 (v2.4.0, in this fork since v2.12.0 with dropping root opt-in): runs as a regular user with `PUID`/`PGID`; `.env` files `0600`; stack-name checks where paths are built (CodeQL path-injection fixes); image scan gate and build provenance; image went from 6 Critical / 41 High to 0. Details in the README's 2.4.0 notes.
