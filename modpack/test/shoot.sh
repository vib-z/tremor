#!/bin/sh
# Saves the sandbox window's frame as a PNG: modpack/test/sandbox.sh <short> modpack/test/shoot.sh <file.png> [light|dark]
# The window redraws only when macOS lets it; while the screen is locked a resize still forces a frame, so
# this restores and maximizes the window before each shot.
set -eu
: "${PDK_SANDBOX:?run through modpack/test/sandbox.sh}"
out=$1; look=${2:-}
if [ -n "$look" ]; then
  /usr/bin/python3 -I -S - "$HERDR_APP_HOME/settings.json" "$look" <<'PY'
import json, sys
p, look = sys.argv[1], sys.argv[2]
s = json.load(open(p))
s["appearance"] = look
json.dump(s, open(p, "w"), indent=2)
PY
  sleep 1.5
fi
HA=${APP:-herdr-app}
"$HA" do window.maximize >/dev/null; sleep 0.8
"$HA" do window.maximize >/dev/null; sleep 1.5
"$HA" shot "$out"
