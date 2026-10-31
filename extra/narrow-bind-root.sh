#!/usr/bin/env bash
# Move a running Dockge from the wide bind-root mount of the 2.4.0/2.4.1 quickstart (Ext745 2.12.0-2.12.2)
# (/opt/docker:/opt/docker + DOCKGE_BIND_ROOTS) back to mounting only the stacks folder, as
# upstream Dockge does.
#
#   bash narrow-bind-root.sh
#
# It reads the running container, changes two lines of its compose file (the bind-root volume
# becomes the stacks folder, DOCKGE_BIND_ROOTS is removed), rewrites the quickstart's comments
# that described them, shows a diff, and changes nothing until you answer y. Every other line is
# kept. Your stacks and app data don't move. Needs bash and docker (with the compose plugin).
set -euo pipefail

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
env_of() { d inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1" | sed -n "s/^$2=//p"; }

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
[ -n "$F" ] && [ -n "$SERVICE" ] || die "This Dockge wasn't started with docker compose; edit its settings by hand (README, 'Installed with an older quickstart?')."
case "$F" in *,*) die "Started from several compose files ($F); edit them by hand." ;; esac
[ -f "$F" ] || die "Compose file $F isn't on this machine. Run this on the Docker host."
note "Found Dockge: service '$SERVICE' in $F"

# ---- 2. Read what it uses now --------------------------------------------------------------
STACKS_DIR=$(env_of "$CID" DOCKGE_STACKS_DIR)
STACKS_DIR=${STACKS_DIR:-/opt/stacks}
STACKS_DIR=${STACKS_DIR%/}
ROOTS=$(env_of "$CID" DOCKGE_BIND_ROOTS)
if [ -z "$ROOTS" ]; then
    echo "✅ DOCKGE_BIND_ROOTS isn't set: Dockge already mounts only what it needs. Nothing to do."
    exit 0
fi
case "$ROOTS" in *,* | *:*) die "DOCKGE_BIND_ROOTS lists several folders ($ROOTS); edit the compose file by hand." ;; esac
ROOT=${ROOTS%/}
case "$STACKS_DIR/" in
    "$ROOT"/?*) ;;
    *) die "The stacks folder ($STACKS_DIR) isn't inside the bind root ($ROOT); edit the compose file by hand." ;;
esac
mounted=$(d inspect -f '{{range .Mounts}}{{.Source}}|{{.Destination}}{{println}}{{end}}' "$CID")
grep -qxF "$ROOT|$ROOT" <<<"$mounted" || die "$ROOT isn't mounted at the same path in Dockge; edit the compose file by hand."
has_stacks_mount=no
grep -qxF "$STACKS_DIR|$STACKS_DIR" <<<"$mounted" && has_stacks_mount=yes

# ---- 3. Change the two lines (exact matches only) ------------------------------------------
# A list item whose value, without quotes and a trailing comment, is exactly $2
count_item() {
    awk -v want="$2" -v q="'" '
        { line = $0; sub(/[ \t]+#.*$/, "", line) }
        line ~ /^[ \t]*-[ \t]/ {
            v = line; sub(/^[ \t]*-[ \t]+/, "", v); sub(/[ \t]+$/, "", v)
            if (v ~ "^\".*\"$" || v ~ ("^" q ".*" q "$")) v = substr(v, 2, length(v) - 2)
            if (v == want) n++
        }
        END { print n + 0 }' "$1"
}
# The DOCKGE_BIND_ROOTS entry, as "- DOCKGE_BIND_ROOTS=..." or "DOCKGE_BIND_ROOTS: ..."
count_env() { grep -cE "^[[:space:]]*(-[[:space:]]+[\"']?DOCKGE_BIND_ROOTS=|[\"']?DOCKGE_BIND_ROOTS[\"']?:)" "$1" || true; }

[ "$(count_item "$F" "$ROOT:$ROOT")" -eq 1 ] || die "Couldn't find exactly one '- $ROOT:$ROOT' volume line in $F (long syntax or \${VARIABLES}?); edit it by hand."
[ "$(count_env "$F")" -eq 1 ] || die "Couldn't find exactly one DOCKGE_BIND_ROOTS line in $F; edit it by hand."

new=$(mktemp "$(dirname "$F")/.narrow-bind-root.XXXXXX.yaml")
trap 'rm -f "$new"' EXIT
# The comments the 2.4.0/2.4.1 quickstart wrote about these lines are rewritten too (exact matches
# only, so comments you wrote yourself are kept as they are).
awk -v want="$ROOT:$ROOT" -v repl="$STACKS_DIR:$STACKS_DIR" -v drop="$has_stacks_mount" -v q="'" \
    -v root="$ROOT" -v stacks="$STACKS_DIR" '
    BEGIN {
        envre = "^[ \t]*(-[ \t]+[\"" q "]?DOCKGE_BIND_ROOTS=|[\"" q "]?DOCKGE_BIND_ROOTS[\"" q "]?:)"
        mount1 = "# " root ": your stacks (" stacks ") and their bind-mount folders"
        mount2 = "#   (" root "/<app>). Both sides MUST be the same full path."
        dir1 = "# DOCKGE_STACKS_DIR: where Dockge looks for stacks (inside " root ")."
        roots1 = "# DOCKGE_BIND_ROOTS: Dockge creates missing bind-mount folders under these"
        roots2 = "#   paths (comma-separated), owned by PUID/PGID, before a stack starts."
        roots3 = "#   ./relative folders inside a stack are always created."
    }
    $0 ~ envre { next }
    {
        c = $0; sub(/[ \t]+$/, "", c)
        if (c == mount1) { print "# " stacks ": your stacks. Both sides MUST be the same full path."; next }
        if (c == mount2) { print "#   Dockge sees only this folder, not your apps" q " data elsewhere."; next }
        if (c == dir1) {
            print "# DOCKGE_STACKS_DIR: where Dockge looks for stacks. Missing ./relative"
            print "#   bind-mount folders inside a stack are created, owned by PUID/PGID."
            next
        }
        if (c == roots1) { inroots = 1; next }
        if (inroots && (c == roots2 || c == roots3)) next
        inroots = 0
    }
    {
        line = $0; sub(/[ \t]+#.*$/, "", line)
        if (line ~ /^[ \t]*-[ \t]/) {
            v = line; sub(/^[ \t]*-[ \t]+/, "", v); sub(/[ \t]+$/, "", v)
            if (v ~ "^\".*\"$" || v ~ ("^" q ".*" q "$")) v = substr(v, 2, length(v) - 2)
            if (v == want) {
                if (drop == "yes") next
                match($0, /^[ \t]*-[ \t]+/)
                indent = substr($0, 1, RLENGTH)
                comment = ""
                if (match($0, /[ \t]+#.*$/)) comment = substr($0, RSTART)
                print indent repl comment
                next
            }
        }
        print
    }' "$F" >"$new"
d compose -p "$PROJECT" --project-directory "$(dirname "$F")" -f "$new" config --quiet \
    || die "The changed compose file didn't validate; nothing was changed."

echo
echo "──────── changes to $F ────────"
diff -u "$F" "$new" || true

# ---- 4. What changes for your stacks -------------------------------------------------------
echo
echo "After this, Dockge sees only $STACKS_DIR and its data folder, not the rest of $ROOT."
missing=()
while IFS= read -r src; do
    [ -e "$src" ] || missing+=("$src")
done < <(find "$STACKS_DIR" -mindepth 2 -maxdepth 2 -type f \( -name 'compose.y*ml' -o -name 'docker-compose.y*ml' \
    -o -name 'compose.override.y*ml' -o -name 'docker-compose.override.y*ml' \) -exec cat {} + 2>/dev/null \
    | sed -nE "s#^[[:space:]]*-[[:space:]]+[\"']?(${ROOT//./\\.}/[^:\"' ]+):.*#\1#p" | sort -u)
if [ "${#missing[@]}" -gt 0 ]; then
    note "These bind-mount folders don't exist yet. Docker will create them owned by root when their stack starts;"
    note "create them yourself first if the app runs as a regular user (mkdir -p, then chown):"
    printf '     %s\n' "${missing[@]}"
fi
owner=$(stat -c '%u:%g' "$ROOT" 2>/dev/null || echo "0:0")
if [ "$owner" != 0:0 ]; then
    note "$ROOT is owned by $owner: Dockge took ownership of that folder (not its contents) to create bind folders."
    note "This script doesn't change it back. If you want root to own it again: sudo chown root:root $ROOT"
fi
# Comments the rewrite didn't recognise (your own wording) that still describe the wide mount
left=$(grep -nE "^[[:space:]]*#.*(DOCKGE_BIND_ROOTS|${ROOT//./\\.}:${ROOT//./\\.})" "$new" || true)
if [ -n "$left" ]; then
    note "These comments in $F still mention the wide mount; edit them by hand afterwards:"
    printf '     %s\n' "$left"
fi
# The data folder should be its own folder, not the one holding compose.yaml (upstream: ./data)
DATA_SRC=$(sed -n 's#|/app/data$##p' <<<"$mounted" | head -1)
[ -n "$DATA_SRC" ] && case "$(dirname "$F")/" in
    "${DATA_SRC%/}"/*)
        note "Dockge's data folder ($DATA_SRC) also holds its compose file, so Dockge can edit its own settings."
        note "Upstream and the quickstart use a data/ subfolder instead. This script doesn't move it; to change it,"
        note "stop Dockge, move everything except compose.yaml into $(dirname "$F")/data and mount that at /app/data."
        ;;
esac

# ---- 4b. Files a stack reads that Dockge would no longer see ------------------------------
# Dockge runs docker compose inside its container, so env_file, configs/secrets files, build
# contexts and include/extends files must be inside the stacks folder. Bind mounts don't count:
# Docker resolves those on the host.
echo
echo "Checking which files each stack reads..."
outside=()
unreadable=()
no_env_check=no
under_stacks() { case "$1/" in "$STACKS_DIR"/*) return 0 ;; *) return 1 ;; esac; }
for dir in "$STACKS_DIR"/*/; do
    dir=${dir%/}
    stack=${dir##*/}
    cf=
    for n in compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
        [ -f "$dir/$n" ] && { cf=$n; break; }
    done
    [ -n "$cf" ] || continue
    # The same variable sources Dockge uses: global.env, then the stack's .env on top
    args=()
    if [ -f "$STACKS_DIR/global.env" ]; then
        args+=(--env-file ../global.env)
        [ -f "$dir/.env" ] && args+=(--env-file ./.env)
    fi
    # --no-env-resolution keeps env_file paths in the output (older Compose: inlined, so not checked)
    if ! cfg=$(cd "$dir" && d compose "${args[@]}" config --no-env-resolution 2>/dev/null); then
        if cfg=$(cd "$dir" && d compose "${args[@]}" config 2>/dev/null); then
            no_env_check=yes
        else
            unreadable+=("$stack")
            continue
        fi
    fi
    paths=$(
        {
            # From the merged config: build contexts, env_file paths, configs/secrets files
            awk '
                /^[ ]*env_file:[ ]*$/ { ef = 1; ind = match($0, /[^ ]/); next }
                ef && match($0, /[^ ]/) <= ind { ef = 0 }
                ef && /^[ ]*- \// { p = $0; sub(/^[ ]*- /, "", p); print "env_file\t" p; next }
                ef && /^[ ]*(- )?path: \// { p = $0; sub(/^[ ]*(- )?path: /, "", p); print "env_file\t" p; next }
                /^[ ]+context: \// { p = $0; sub(/^[ ]+context: /, "", p); print "build context\t" p }
                /^[ ]+file: \// { p = $0; sub(/^[ ]+file: /, "", p); print "config/secret file\t" p }
            ' <<<"$cfg"
            # From the stack's own files: include and extends, which the merge hides
            for src in "$dir"/compose*.y*ml "$dir"/docker-compose*.y*ml; do
                [ -f "$src" ] || continue
                awk -v q="'" '
                    function val(l) {
                        sub(/[ \t]+#.*$/, "", l); sub(/^[ \t]*(- )?/, "", l)
                        sub(/^(path|project_directory|env_file|file):[ \t]*/, "", l); sub(/^- /, "", l)
                        gsub("[\"" q "]", "", l); sub(/[ \t]+$/, "", l)
                        return l
                    }
                    /^include:/ { inc = 1; next }
                    inc && /^[^ \t#]/ { inc = 0 }
                    inc { v = val($0); if (v != "" && v !~ /:$/) print "include\t" v; next }
                    /^[ \t]+extends:/ { ext = 1; ei = match($0, /[^ \t]/); next }
                    ext && match($0, /[^ \t]/) <= ei { ext = 0 }
                    ext && /^[ \t]+file:/ { print "extends file\t" val($0) }
                ' "$src"
            done
        } | tr -d "\"'" | sort -u
    )
    while IFS=$'\t' read -r kind p; do
        [ -n "$p" ] || continue
        case "$p" in /*) ;; *) p="$dir/$p" ;; esac
        p=$(realpath -m "$p")
        under_stacks "$p" || outside+=("$stack: $kind $p")
    done <<<"$paths"
done
if [ "${#outside[@]}" -gt 0 ]; then
    echo "⚠️  These stacks read files outside $STACKS_DIR. After the switch, Dockge can't see them, so"
    echo "   Deploy, Start, Restart and Update of these stacks fail from Dockge until each file is moved"
    echo "   into the stack's folder (and the path in its compose file updated):"
    printf '     %s\n' "${outside[@]}"
else
    echo "✅ No stack reads files outside $STACKS_DIR."
fi
if [ "$no_env_check" = yes ]; then
    note "This Docker Compose is too old for --no-env-resolution, so env_file paths weren't checked."
fi
if [ "${#unreadable[@]}" -gt 0 ]; then
    note "Couldn't read the config of: ${unreadable[*]} (docker compose config failed). Check those by hand."
fi

echo
[ "$(ask "Apply this? Dockge restarts; your stacks keep running (y/N)" "N")" = y ] || { echo "Nothing changed."; exit 0; }

# ---- 5. Back up, switch, check -------------------------------------------------------------
umask 077
B="${HOME}/dockge-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$B"
cp -a "$F" "$B/compose.yaml"
echo "Backup: $B/compose.yaml"
if [ -w "$F" ]; then cat "$new" >"$F"; else $S tee "$F" <"$new" >/dev/null; fi
d compose -p "$PROJECT" -f "$F" up -d "$SERVICE"

rollback="cp '$B/compose.yaml' '$F' && $S docker compose -p '$PROJECT' -f '$F' up -d $SERVICE"
printf "Waiting for Dockge to start"
state=
for _ in $(seq 1 60); do
    cid=$(d compose -p "$PROJECT" -f "$F" ps -q "$SERVICE" 2>/dev/null || true)
    state=$( [ -n "$cid" ] && d inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || true)
    case "$state" in healthy | running) break ;; esac
    printf "."
    sleep 2
done
echo
case "$state" in
    healthy | running) echo "✅ Dockge is $state with only $STACKS_DIR mounted." ;;
    starting) echo "⏳ Dockge is running and its health check hasn't finished yet; it usually does within 2 minutes." ;;
    *) echo "❌ Dockge isn't up yet ($state). Log: $S docker compose -p $PROJECT -f $F logs $SERVICE" ;;
esac
echo "To undo: $rollback"
