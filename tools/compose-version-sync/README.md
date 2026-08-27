# compose-version-sync

Sync Docker Compose file image tags with the versions actually running on your Docker host.

If you use [What's Up Docker](https://github.com/fmartinou/whats-up-docker) (WUD) or Watchtower to auto-update containers, the running image tags drift from what your compose files say. This tool detects those mismatches and can update the compose files to match.

Designed for setups like [Dockge](https://github.com/louislam/dockge) where each stack lives in its own subfolder:

```
/opt/stacks/
├── uptime-kuma/
│   └── compose.yaml      # image: louislam/uptime-kuma:1.23.0
├── nginx-proxy-manager/
│   └── compose.yaml
└── vaultwarden/
    └── compose.yaml
```

## Install

```bash
pip install .
```

Or run directly:

```bash
pip install docker pyyaml rich click ruamel.yaml
python -m compose_version_sync.cli --help
```

## Usage

### Report mismatches

```bash
compose-version-sync --stacks-dir /opt/stacks report
```

### Update compose files to match running versions

```bash
# Preview changes first
compose-version-sync --stacks-dir /opt/stacks update --dry-run

# Apply changes
compose-version-sync --stacks-dir /opt/stacks update
```

### Filter by stack or service

```bash
compose-version-sync --stacks-dir /opt/stacks update --stack uptime-kuma --stack vaultwarden
compose-version-sync --stacks-dir /opt/stacks update --service db
```

## Configuration

Instead of passing `--stacks-dir` every time, set it as an environment variable:

```bash
export STACKS_DIR=/opt/stacks
compose-version-sync report
```

Or use a `.env` file (copy `.env.example`).

### Options

| Option | Env var | Description |
|---|---|---|
| `--stacks-dir` | `STACKS_DIR` | Path to the stacks folder (required) |
| `--compose-filename` | `COMPOSE_FILENAME` | Compose filename (default: `compose.yaml`) |
| `--docker-url` | `DOCKER_HOST` | Docker daemon URL (default: local socket) |

## How it works

1. Queries the Docker daemon for all running containers with compose labels
2. Scans the stacks directory for compose files in subfolders
3. Matches containers to compose services using `com.docker.compose.project` and `com.docker.compose.service` labels
4. Compares image references (repository + tag)
5. Reports or updates any mismatches

The tool uses `ruamel.yaml` to preserve comments and formatting when updating compose files.

## License

MIT
