#!/bin/sh
# A second machine for the sandbox, with no SSH: a private Core in $PDK_SANDBOX/mb that the sandbox Core reaches
# through `hc machine add --via` (herdr-core docs/machines.md, "Use another way in"). Everything stays under
# /tmp/pdk-<short>/; nothing outside the sandbox is read or written.
#
#   modpack/test/sandbox.sh <short> modpack/test/machine.sh add [name]   add it (default name: box)
#   modpack/test/sandbox.sh <short> modpack/test/machine.sh stop         stop its private Core (after checking its id)
#   modpack/test/sandbox.sh <short> modpack/test/machine.sh env          print its env, to run hc there by hand
#
# Spaces on it: herdr-app do space.new --machine box --name <n> --folder <dir under $PDK_SANDBOX/mb/u>.
# It is the same Mac, so `host` in `hc machine ls` reads this computer's name; the app shows it as "box".
set -eu
: "${PDK_SANDBOX:?run through modpack/test/sandbox.sh}"
S=$PDK_SANDBOX; M=$S/mb; REAL_HOME=$(cd /Users/"$USER" 2>/dev/null && pwd || echo /Users/"$USER")
# Box's PATH: its own bin (herdr-core and hc for its private Core) and the system's, as sandbox.sh gives the sandbox.
MSAFE="$M/bin:/usr/bin:/bin:/usr/sbin:/sbin"
menv() { env -i HOME="$M/u" PATH="$MSAFE" HC_SESSION=pdk-mb TERM=xterm-256color LANG=en_GB.UTF-8 \
  XDG_STATE_HOME="$M/state" XDG_RUNTIME_DIR="$M" XDG_CONFIG_HOME="$M/config" HERDR_TELEMETRY=0 DO_NOT_TRACK=1 "$@"; }
case ${1:-add} in
  add)
    name=${2:-box}
    mkdir -p "$M/u" "$M/state" "$M/config" "$M/bin"
    # Core looks for herdr-core on the destination's PATH (herdr-core src/machines.rs:242).
    ln -sf "$REAL_HOME/.local/bin/herdr-core" "$M/bin/herdr-core"
    ln -sf "$REAL_HOME/.local/bin/hc" "$M/bin/hc"
    # Box's shells (its Core's login shell, `hc run --on box`) start from $M/u: these set PATH back after path_helper
    # (/etc/profile, /etc/zprofile), as sandbox.sh does for the sandbox's own HOME. Lines already there stay.
    for rc in .profile .zshenv .zprofile .zshrc; do
      touch "$M/u/$rc"
      grep -qxF "export PATH=\"$MSAFE\" # pdk-sandbox" "$M/u/$rc" || printf '\nexport PATH="%s" # pdk-sandbox\n' "$MSAFE" >> "$M/u/$rc"
    done
    cat > "$S/via-$name" <<EOF
#!/bin/sh
exec env -i HOME=$M/u PATH=$MSAFE HC_SESSION=pdk-mb TERM=xterm-256color LANG=en_GB.UTF-8 \\
  XDG_STATE_HOME=$M/state XDG_RUNTIME_DIR=$M XDG_CONFIG_HOME=$M/config HERDR_TELEMETRY=0 DO_NOT_TRACK=1 sh -c "\$*"
EOF
    chmod +x "$S/via-$name"
    hc machine ls --json | grep -q "\"name\":\"$name\"" || hc --json machine add --name "$name" --via "$S/via-$name"
    for _ in 1 2 3 4 5 6 7 8 9 10; do hc machine ls --json | grep -q '"state":"connected"' && break; sleep 1; done
    hc machine ls --json ;;
  stop)
    # Only the sandbox's own machine Core: its socket lives under $M, so this cannot reach the default Core. With no
    # socket there is nothing to stop, and `hc server status` would start one, so it isn't asked.
    [ -S "$M/herdr-core/pdk-mb.sock" ] || { echo "no machine core running"; exit 0; }
    id=$(menv hc server status --json 2>/dev/null | /usr/bin/python3 -I -S -c 'import json,sys; print(json.load(sys.stdin)["core"]["id"])' 2>/dev/null || true)
    [ -n "$id" ] && { echo "stopping machine core $id ($M)"; menv hc server stop >/dev/null 2>&1 || true; } || echo "no machine core running" ;;
  env) echo "HOME=$M/u HC_SESSION=pdk-mb XDG_STATE_HOME=$M/state XDG_RUNTIME_DIR=$M XDG_CONFIG_HOME=$M/config PATH=$MSAFE" ;;
  *) echo "usage: machine.sh add [name] | stop | env" >&2; exit 2 ;;
esac
