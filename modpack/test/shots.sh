#!/bin/sh
# Takes the acceptance screenshots of the scene (scene.sh) in one appearance, by app commands only.
#   modpack/test/sandbox.sh <short> modpack/test/shots.sh <out dir> <light|dark>
set -eu
: "${PDK_SANDBOX:?run through modpack/test/sandbox.sh}"
OUT=$1; LOOK=$2
TEST=$(cd "$(dirname "$0")" && pwd -P)
mkdir -p "$OUT"
q() { herdr-app ls | /usr/bin/python3 -I -S -c "$1" "${2:-}"; }
space() { q 'import json,sys; print([s["id"] for s in json.load(sys.stdin)["spaces"] if s["name"]==sys.argv[1]][0])' "$1"; }
tab() { q 'import json,sys; a=sys.argv[1].split("/"); print([t["id"] for s in json.load(sys.stdin)["spaces"] if s["name"]==a[0] for t in s["tabs"] if t["name"]==a[1]][0])' "$1"; }
pane() { q 'import json,sys; a=sys.argv[1].split("/"); print([t["terminals"][0]["pane"] for s in json.load(sys.stdin)["spaces"] if s["name"]==a[0] for t in s["tabs"] if t["name"]==a[1]][0])' "$1"; }
view() { herdr-app do layout.select --stack work-body --child "$1" >/dev/null; }
go() { herdr-app do space.select --id "$(space "${1%%/*}")" >/dev/null; herdr-app do tab.select --id "$(tab "$1")" >/dev/null; herdr-app do pane.focus --pane "$(pane "$1")" >/dev/null; sleep "${2:-1}"; }
shot() { "$TEST/shoot.sh" "$OUT/$1-$LOOK.png" "$LOOK" >/dev/null; echo "$OUT/$1-$LOOK.png"; }

view main; go core-client/lead; shot 01-tree-terminal
go core-client/review; shot 02-workspace1-review-split
go evals/checks; shot 03-workspace2-split
go core-client/lead; view chat; sleep 3; shot 04-chat-claude-blocked
go core-client/review 3; shot 05-chat-codex
go core-client/cursor 2; shot 06-chat-unsupported
view factory; herdr-app do pdk-factory.floor >/dev/null; sleep 1; shot 07-factory-floor
herdr-app do "pdk-factory.line:$(q 'import json,sys; print([t["terminals"][0]["terminal"] for s in json.load(sys.stdin)["spaces"] if s["name"]=="core-client" for t in s["tabs"] if t["name"]=="lead"][0])')" >/dev/null; sleep 1; shot 08-factory-line
