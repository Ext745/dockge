#!/usr/bin/env bash
# Move a running Dockge install to the 2.4.0 runtime model: PUID/PGID instead of root or `user:`,
# a bind-root mount so Dockge can create bind-mount folders, and the hardened settings.
#
#   bash migrate-to-puid.sh [version]        (default version: 2.4.0)
#
# It reads the running container (docker inspect + its compose labels), asks only what it can't
# know, shows the new compose.yaml and a diff, and changes nothing until you answer y. It refuses
# compose files it can't rewrite safely (other services, custom networks, env_file, ${VAR}, ...).
# Backup, then rollback: see the end of the run. Needs bash and docker (with the compose plugin).
set -euo pipefail

VERSION="${1:-2.4.0}"
IMAGE="ghcr.io/darthrater78/dockge"

S=
docker ps >/dev/null 2>&1 || S=sudo
d() { $S docker "$@"; }
die() { echo "❌ $*" >&2; exit 1; }
note() { echo "ℹ️  $*"; }
ask() {
    local answer
    read -rp "$1 [$2]: " answer </dev/tty
    printf '%s' "${answer:-$2}"
}
label() { d inspect -f "{{index .Config.Labels \"$2\"}}" "$1"; }
# A YAML double-quoted string that compose reads back unchanged: escape \ and ", and $ as $$
q() {
    local v=${1//\\/\\\\}
    v=${v//\"/\\\"}
    v=${v//\$/\$\$}
    printf '"%s"' "$v"
}

# ---- 1. Find the running Dockge container --------------------------------------------------
mapfile -t found < <(d ps --format '{{.ID}} {{.Image}}' | awk '$2 ~ /(^|\/)dockge([:@]|$)/ { print $1 }')
if [ "${DOCKGE_CONTAINER:-}" ]; then
    found=("$DOCKGE_CONTAINER")
fi
[ "${#found[@]}" -gt 0 ] || die "No running Dockge container found. Start Dockge first."
[ "${#found[@]}" -eq 1 ] || die "Found ${#found[@]} Dockge containers. Choose one: DOCKGE_CONTAINER=<name> bash $0"
CID="${found[0]}"

F=$(label "$CID" com.docker.compose.project.config_files)
PROJECT=$(label "$CID" com.docker.compose.project)
SERVICE=$(label "$CID" com.docker.compose.service)
OLD_IMAGE=$(d inspect -f '{{.Config.Image}}' "$CID")
if [ -z "$F" ] || [ -z "$SERVICE" ]; then
    die "This Dockge wasn't started with docker compose; see the README's upgrade steps."
fi
case "$F" in *,*) die "Started from several compose files ($F); see the README's upgrade steps." ;; esac
[ -f "$F" ] || die "Compose file $F isn't on this machine. Run this on the Docker host."
note "Found Dockge: service '$SERVICE' in $F (image $OLD_IMAGE)"

# ---- 2. Refuse what a rewrite would lose ---------------------------------------------------
config=$(d compose -p "$PROJECT" -f "$F" config --no-interpolate)
problems=()
[ "$(d compose -p "$PROJECT" -f "$F" config --services | wc -l)" -eq 1 ] || problems+=("other services in the same compose file")
# shellcheck disable=SC2016 # a literal ${ is what is searched for
grep -q '\${' <<<"$config" && problems+=("\${VARIABLE} substitution (values would be written out literally)")
grep -Eq '^ +env_file:' <<<"$config" && problems+=("env_file")
while read -r key; do
    case "$key" in
        image | container_name | restart | ports | volumes | environment | user | group_add | networks \
            | read_only | tmpfs | security_opt | cap_drop | cap_add) ;;
        *) problems+=("service setting '$key'") ;;
    esac
done < <(awk -v s="  $SERVICE:" '$0 == s { on = 1; next } on && /^  [^ ]/ { on = 0 } on && /^    [a-z_]+:/ { sub(/^ +/, ""); sub(/:.*/, ""); print }' <<<"$config")
while read -r key; do
    case "$key" in name | services | networks | volumes) ;; *) problems+=("top-level '$key'") ;; esac
done < <(grep -E '^[a-z_]+:' <<<"$config" | sed 's/:.*//')
network=$(d inspect -f '{{.HostConfig.NetworkMode}}' "$CID")
case "$network" in "${PROJECT}_default" | default | bridge) ;; *) problems+=("network '$network'") ;; esac
if [ "${#problems[@]}" -gt 0 ]; then
    printf '❌ Not migrating automatically, because the compose file has:\n' >&2
    printf '   - %s\n' "${problems[@]}" >&2
    die "Follow the README's 'Moving to the recommended setup' steps instead; nothing was changed."
fi

# ---- 3. Read the current settings from the container ---------------------------------------
DATA_SRC=""; DATA_TYPE=""; SOCK_SRC=""; STACKS_SRC=""
extra_mounts=()
STACKS_DIR=$(d inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$CID" | sed -n 's/^DOCKGE_STACKS_DIR=//p')
STACKS_DIR=${STACKS_DIR:-/opt/stacks}
while IFS='|' read -r type src dst rw; do
    [ -n "$dst" ] || continue
    case "$dst" in
        /app/data) DATA_SRC=$src; DATA_TYPE=$type ;;
        /var/run/docker.sock) SOCK_SRC=$src ;;
        "$STACKS_DIR") STACKS_SRC=$src ;;
        *) extra_mounts+=("$src:$dst$([ "$rw" = false ] && echo ':ro')") ;;
    esac
done < <(d inspect -f '{{range .Mounts}}{{.Type}}|{{if eq .Type "volume"}}{{.Name}}{{else}}{{.Source}}{{end}}|{{.Destination}}|{{.RW}}{{println}}{{end}}' "$CID")
[ -n "$DATA_SRC" ] || die "No data folder mounted at /app/data; nothing to migrate safely."
[ -n "$SOCK_SRC" ] || die "docker.sock isn't mounted into Dockge."
[ "$STACKS_SRC" = "$STACKS_DIR" ] || die "Stacks folder must be mounted at the same path on both sides ($STACKS_SRC → $STACKS_DIR)."

ports=()
# shellcheck disable=SC2016 # Go template variables, not shell
while read -r binding; do
    [ -n "$binding" ] && ports+=("$binding")
done < <(d inspect -f '{{range $p, $b := .HostConfig.PortBindings}}{{range $b}}{{if .HostIp}}{{.HostIp}}:{{end}}{{.HostPort}}:{{$p}}{{println}}{{end}}{{end}}' "$CID" | sed 's#/tcp$##')
restart=$(d inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$CID")
container_name=$(d compose -p "$PROJECT" -f "$F" config | awk -v s="  $SERVICE:" '$0 == s { on = 1; next } on && /^  [^ ]/ { on = 0 } on && /^    container_name:/ { print $2 }')

# Environment set by the compose file = container env minus the image's own defaults
image_env=$(d image inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$OLD_IMAGE")
envs=()
while read -r kv; do
    [ -n "$kv" ] || continue
    grep -qxF -- "$kv" <<<"$image_env" && continue
    case "${kv%%=*}" in PUID | PGID | DOCKGE_STACKS_DIR | DOCKGE_BIND_ROOTS) continue ;; esac
    envs+=("$kv")
done < <(d inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$CID")
old_user=$(d inspect -f '{{.Config.User}}' "$CID")

# ---- 4. Ask what can't be read --------------------------------------------------------------
me=${SUDO_UID:-$(id -u)}
my_group=${SUDO_GID:-$(id -g)}
echo
PUID=$(ask "Run Dockge as user id (PUID)" "$me")
PGID=$(ask "Group id (PGID; your own group, not the docker group)" "$my_group")
case "$PUID:$PGID" in *[!0-9:]* | :* | *:) die "PUID and PGID must be numbers." ;; esac
[ "$PUID" != 0 ] || die "PUID 0 is root; nothing to migrate."

# Suggest the stacks folder's parent (/opt/docker for /opt/docker/stacks), unless that is a system
# folder Dockge would then take ownership of; then suggest the stacks folder itself
default_root=$(dirname "$STACKS_DIR")
case "$default_root" in
    / | /opt | /srv | /home | /mnt | /var | /usr | /etc) default_root=$STACKS_DIR ;;
esac
echo "Dockge creates missing bind-mount folders under one folder that holds your stacks and your apps' data,"
echo "mounted at the same path. Enter it, or 'none' to only create folders inside each stack."
BIND_ROOT=$(ask "Bind-root folder" "$default_root")
case "$BIND_ROOT" in
    none) BIND_ROOT= ;;
    /) die "Not / : choose the folder that holds your stacks and app data." ;;
    /*) ;;
    *) die "Use an absolute path, or 'none'." ;;
esac
case "$BIND_ROOT" in
    /opt | /srv | /home | /mnt | /var | /usr | /etc) note "$BIND_ROOT is broad: Dockge will see (and own the top folder of) everything in it." ;;
esac
VERSION=$(ask "Dockge version" "$VERSION")

# ---- 5. Write the new compose file (not applied yet) ---------------------------------------
new=$(mktemp)
trap 'rm -f "$new"' EXIT
{
    echo "services:"
    echo "  $SERVICE:"
    echo "    image: $IMAGE:$VERSION"
    [ -n "$container_name" ] && echo "    container_name: $container_name"
    [ -n "$restart" ] && [ "$restart" != no ] && echo "    restart: $restart"
    if [ "${#ports[@]}" -gt 0 ]; then
        echo "    ports:"
        printf '      - %s\n' "${ports[@]}"
    fi
    echo "    volumes:"
    echo "      - $(q "$SOCK_SRC:/var/run/docker.sock")"
    echo "      - $(q "$DATA_SRC:/app/data")"
    case "$STACKS_DIR/" in
        "$BIND_ROOT"/*) [ -n "$BIND_ROOT" ] || echo "      - $STACKS_DIR:$STACKS_DIR" ;;
        *) echo "      - $STACKS_DIR:$STACKS_DIR" ;;
    esac
    [ -n "$BIND_ROOT" ] && echo "      - $BIND_ROOT:$BIND_ROOT"
    for m in "${extra_mounts[@]}"; do echo "      - $(q "$m")"; done
    echo "    environment:"
    echo "      - PUID=$PUID"
    echo "      - PGID=$PGID"
    echo "      - DOCKGE_STACKS_DIR=$STACKS_DIR"
    [ -n "$BIND_ROOT" ] && echo "      - DOCKGE_BIND_ROOTS=$BIND_ROOT"
    for e in "${envs[@]}"; do echo "      - $(q "$e")"; done
    echo "    read_only: true"
    echo "    tmpfs:"
    echo "      - /tmp"
    echo "    security_opt:"
    echo "      - no-new-privileges:true"
    echo "    cap_drop:"
    echo "      - ALL"
    echo "    cap_add:"
    printf '      - %s\n' CHOWN DAC_OVERRIDE FOWNER SETUID SETGID
    if [ "$DATA_TYPE" = volume ]; then
        echo "volumes:"
        echo "  $DATA_SRC:"
        echo "    external: true"
    fi
} >"$new"
d compose -p "$PROJECT" -f "$new" config --quiet || die "The generated compose file didn't validate; nothing was changed."

echo
echo "──────── new $F ────────"
cat "$new"
echo "──────── changes (old → new; comments in the old file are not kept, it is backed up) ────────"
diff -u "$F" "$new" || true
[ -n "$old_user" ] && note "user: \"$old_user\" is removed: Dockge switches to $PUID:$PGID itself and joins the docker.sock group."
echo
[ "$(ask "Apply this? Dockge restarts; your stacks keep running (y/N)" "N")" = y ] || { echo "Nothing changed."; exit 0; }

# ---- 6. Back up, switch, start, check -------------------------------------------------------
# The backup holds Dockge's database and maybe secrets from compose.yaml: owner-only
umask 077
B="${HOME}/dockge-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$B"
d pull -q "$IMAGE:$VERSION" >/dev/null
d compose -p "$PROJECT" -f "$F" stop "$SERVICE"
cp -a "$F" "$B/compose.yaml"
d run --rm --entrypoint tar -v "$DATA_SRC:/data:ro" "$OLD_IMAGE" czf - -C /data . >"$B/data.tgz"
echo "Backup: $B (compose.yaml, data.tgz)"

if [ -w "$F" ]; then cat "$new" >"$F"; else $S tee "$F" <"$new" >/dev/null; fi
d compose -p "$PROJECT" -f "$F" up -d "$SERVICE"

host_ip=$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' || true)
first=${ports[0]:-}
case "$first" in
    *.*:*:*) url_host=${first%%:*}; url_port=$(cut -d: -f2 <<<"$first") ;;
    *:*) url_host=${host_ip:-localhost}; url_port=${first%%:*} ;;
    *) url_host=; url_port= ;;
esac
rollback="cp '$B/compose.yaml' '$F' && $S docker compose -p '$PROJECT' -f '$F' up -d $SERVICE"
if [ -n "$url_host" ]; then
    printf "Waiting for Dockge to start"
    for _ in $(seq 1 60); do curl -fs -o /dev/null "http://$url_host:$url_port/" && break; printf "."; sleep 2; done
    echo
fi
d compose -p "$PROJECT" -f "$F" logs "$SERVICE" 2>&1 | grep -E "\[entrypoint\] running as|Running as" | tail -2 || true
if [ -z "$url_host" ] || curl -fs -o /dev/null "http://$url_host:$url_port/"; then
    echo "✅ Dockge $VERSION is running as $PUID:$PGID${url_host:+: http://$url_host:$url_port}"
else
    echo "❌ No answer from http://$url_host:$url_port yet. Log: $S docker compose -p $PROJECT -f $F logs $SERVICE"
fi
echo "To undo: $rollback"
