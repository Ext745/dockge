#!/bin/sh
# Dockge container entrypoint.
#
# PUID/PGID unset (or 0), or the container started with `user:`: run as-is, exactly like
# earlier versions. PUID/PGID set and started as root: take ownership of Dockge's own folders
# (not the app data inside your stacks), join the docker.sock group, then drop to PUID:PGID with
# no capabilities. No host-side chown or docker group lookup needed.
set -eu

log() {
    echo "[entrypoint] $*" >&2
}

if [ "$(id -u)" != "0" ] || [ -z "${PUID:-}${PGID:-}" ]; then
    exec "$@"
fi

case "${PUID:-}:${PGID:-}" in
    *[!0-9:]* | :* | *:)
        # The backend reports the bad value after login and leaves ownership alone
        log "PUID and PGID must both be numeric ids (PUID='${PUID:-}', PGID='${PGID:-}'); running as root"
        exec "$@"
        ;;
esac

if [ "$PUID" = "0" ]; then
    exec "$@"
fi

# The socket Dockge talks to: DOCKER_HOST=unix:///path, or the default
SOCK=/var/run/docker.sock
case "${DOCKER_HOST:-}" in
    unix://*) SOCK="${DOCKER_HOST#unix://}" ;;
    ?*) SOCK="" ;;
esac

GROUPS_LIST="$PGID"
if [ -n "$SOCK" ]; then
    if [ ! -S "$SOCK" ]; then
        log "$SOCK is not mounted; running as root"
        exec "$@"
    fi
    SOCK_GID="$(stat -c %g "$SOCK")"
    if [ "$SOCK_GID" = "0" ]; then
        log "$SOCK belongs to group root, so uid $PUID could not use it; running as root"
        exec "$@"
    fi
    if [ "$SOCK_GID" != "$PGID" ]; then
        GROUPS_LIST="$PGID,$SOCK_GID"
    fi
fi

DATA_DIR="$(cd /app && realpath -m "${DOCKGE_DATA_DIR:-./data}")"
STACKS_DIR="$(realpath -m "${DOCKGE_STACKS_DIR:-/opt/stacks}")"

# chown only what isn't already PUID:PGID, never through symlinks
own() {
    find "$@" \( ! -user "$PUID" -o ! -group "$PGID" \) -exec chown -h "$PUID:$PGID" {} +
}

# A folder Dockge must write to: create it, and take it over only when PUID can't write to it
own_dir() {
    if [ "$1" = "/" ]; then
        return 0
    fi
    mkdir -p "$1"
    if ! setpriv --reuid="$PUID" --regid="$PGID" --groups="$GROUPS_LIST" test -w "$1" -a -x "$1"; then
        log "taking ownership of $1 for $PUID:$PGID"
        chown "$PUID:$PGID" "$1"
    fi
}

own_dir "$DATA_DIR"
own "$DATA_DIR"

own_dir "$STACKS_DIR"
own "$STACKS_DIR" -maxdepth 1 \( -type d -o -name global.env \)
own "$STACKS_DIR" -mindepth 2 -maxdepth 2 -type f \( -name compose.yaml -o -name compose.yml \
    -o -name docker-compose.yaml -o -name docker-compose.yml -o -name 'compose.override.y*ml' \
    -o -name 'docker-compose.override.y*ml' -o -name .env \)

# Folders under which Dockge creates bind-mount sources; only the folder itself, never its contents
set -f
for ROOT in $(echo "${DOCKGE_BIND_ROOTS:-}" | tr ',:' '  '); do
    case "$ROOT" in
        /?*) if [ -d "$ROOT" ]; then own_dir "$(realpath "$ROOT")"; fi ;;
    esac
done
set +f

# Registry logins: /root/.docker isn't readable after the switch, so keep them in the data folder
if [ -z "${DOCKER_CONFIG:-}" ]; then
    export DOCKER_CONFIG="$DATA_DIR/docker-config"
    mkdir -p "$DOCKER_CONFIG"
    if [ -f /root/.docker/config.json ] && [ ! -e "$DOCKER_CONFIG/config.json" ]; then
        log "copying registry logins from /root/.docker to $DOCKER_CONFIG"
        cp /root/.docker/config.json "$DOCKER_CONFIG/config.json"
    fi
    chown -R -h "$PUID:$PGID" "$DOCKER_CONFIG"
    chmod -R go-rwx "$DOCKER_CONFIG"
fi
export HOME=/tmp

log "running as uid $PUID gid $PGID (groups $GROUPS_LIST)"
exec setpriv --reuid="$PUID" --regid="$PGID" --groups="$GROUPS_LIST" --inh-caps=-all -- "$@"
