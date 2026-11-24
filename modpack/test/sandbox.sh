#!/bin/sh
# Runs one command in an isolated Herdr sandbox: its own app home, a private Core
# session, a scratch HOME, no telemetry, no updater network. Never the live profile.
#
#   modpack/test/sandbox.sh <short> <command> [args...]
#
# <short> names /tmp/pdk-<short>/ (short: the app socket path has a length limit).
# The command runs with:
#   HOME=/tmp/pdk-<short>/u          scratch home: the app's CLI link, Library files,
#                                    shell rc files and any agent registries land here
#   HERDR_APP_HOME=/tmp/pdk-<short>/home, HERDR_APP_ID=pdk-<short>
#   HC_SESSION=pdk-<short>, XDG_STATE_HOME, XDG_RUNTIME_DIR, empty XDG_CONFIG_HOME
#   (the D13 environment; HC_SOCKET unset)
#   PATH=/tmp/pdk-<short>/bin (hc, herdr-app only) plus the system folders
#   HERDR_TELEMETRY=0, DO_NOT_TRACK=1, HERDR_RELEASES_URL=http://127.0.0.1:9 (dead)
# APP is the verified official 0.1.14 bundle from this job's sandbox.
set -eu
short=${1:?short name}; shift
case $short in *[!a-z0-9]*|'') echo "short name: [a-z0-9]+ only" >&2; exit 2;; esac
S=/tmp/pdk-$short
mkdir -p "$S/home" "$S/state" "$S/config" "$S/u" "$S/bin"
APP=${PDK_APP:-/Users/me/code/jobs/jobs/2026-11-08-demo-core-client-1108/sandbox/app-0.1.14/target/Herdr.app/Contents/MacOS/Herdr}
REAL_HOME=$(cd ~ && pwd)
# PATH holds only $S/bin (hc for the private Core, herdr-app, the scene's test doubles) and the system: no agent,
# moshi or herdr binary is reachable from the sandbox.
SAFE="$S/bin:/usr/bin:/bin:/usr/sbin:/sbin"
ln -sf "$REAL_HOME/.local/bin/hc" "$S/bin/hc"
ln -sf "$APP" "$S/bin/herdr-app"
# Opt-in, off by default: PDK_ALLOW=<name> links that one program (found on the caller's PATH) into $S/bin for this
# run. A name allowed by an earlier run is unlinked when it isn't asked for again.
if [ -f "$S/allowed" ]; then
  old=$(cat "$S/allowed")
  if [ "$old" != "${PDK_ALLOW:-}" ]; then [ -L "$S/bin/$old" ] && rm -f "$S/bin/$old"; rm -f "$S/allowed"; fi
fi
if [ -n "${PDK_ALLOW:-}" ]; then
  case $PDK_ALLOW in *[!a-z0-9._-]*|hc|herdr-app) echo "PDK_ALLOW: one program name, not hc or herdr-app" >&2; exit 2;; esac
  [ -e "$S/bin/$PDK_ALLOW" ] && [ ! -L "$S/bin/$PDK_ALLOW" ] && { echo "PDK_ALLOW: $S/bin/$PDK_ALLOW is a test double" >&2; exit 2; }
  real=$(command -v "$PDK_ALLOW") || { echo "PDK_ALLOW: $PDK_ALLOW not found" >&2; exit 2; }
  ln -sf "$real" "$S/bin/$PDK_ALLOW"
  echo "$PDK_ALLOW" > "$S/allowed"
fi
# Shells here start from the scratch HOME: Core's `$SHELL -l`, agent panes' `zsh -lic` (herdr-app window.rs:2413),
# `zsh -i`, `sh -l`. macOS's /etc/zprofile and /etc/profile run path_helper, which puts /etc/paths (/usr/local/bin
# and more) in front; each of these files sets PATH back after it. Lines already there (scene.sh's) stay.
for rc in .zshenv .zprofile .zshrc .profile; do
  touch "$S/u/$rc"
  grep -qxF "export PATH=\"$SAFE\" # pdk-sandbox" "$S/u/$rc" || printf '\nexport PATH="%s" # pdk-sandbox\n' "$SAFE" >> "$S/u/$rc"
done
# herdr-app fills PATH from the login shell plus /opt/homebrew/bin and /usr/local/bin when its parent is launchd
# (pid 1: a Finder launch, or this script started with `( … & )`), herdr-app@2405bf3 src/core_bin.rs:52-64,117-127,
# and mods' exec runs with that PATH (src/mods.rs:767-776). A /bin/sh that waits for the command stays its parent.
exec env -i \
  HOME="$S/u" USER="${USER:-$(id -un)}" LOGNAME="${USER:-$(id -un)}" SHELL=/bin/zsh \
  PATH="$SAFE" \
  TERM=xterm-256color LANG=en_GB.UTF-8 \
  HERDR_APP_HOME="$S/home" HERDR_APP_ID="pdk-$short" \
  HC_SESSION="pdk-$short" XDG_STATE_HOME="$S/state" XDG_RUNTIME_DIR="$S" XDG_CONFIG_HOME="$S/config" \
  HERDR_TELEMETRY=0 DO_NOT_TRACK=1 HERDR_RELEASES_URL=http://127.0.0.1:9 \
  PDK_SANDBOX="$S" APP="$APP" \
  /bin/sh -c '"$@"; exit $?' sandbox "$@"
