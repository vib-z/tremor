#!/bin/sh
# The preset themes (themes-more brief), each picked through Herdr's own app.theme, with the tree, a chat and the
# factory board. (The Colours editor is retired, spec section 8: no edit or Glass stage.)
#   modpack/test/sandbox.sh <short> modpack/test/shots-themes.sh <out dir> <theme> <light|dark>
# One named shot of the tree in <theme>:
#   modpack/test/sandbox.sh <short> modpack/test/shots-themes.sh <out dir> <theme> <light|dark> <shot>
set -eu
: "${PDK_SANDBOX:?run through modpack/test/sandbox.sh}"
OUT=$1; NAME=$2; LOOK=$3; SHOT=${4:-}
TEST=$(cd "$(dirname "$0")" && pwd -P)
H=$HERDR_APP_HOME
mkdir -p "$OUT"
q() { herdr-app ls | /usr/bin/python3 -I -S -c "$1" "${2:-}"; }
tabid() { q 'import json,sys; a=sys.argv[1].split("/"); print([t["id"] for s in json.load(sys.stdin)["spaces"] if s["name"]==a[0] for t in s["tabs"] if t["name"]==a[1]][0])' "$1"; }
pane() { q 'import json,sys; a=sys.argv[1].split("/"); print([t["terminals"][int(a[2]) if len(a)>2 else 0]["pane"] for s in json.load(sys.stdin)["spaces"] if s["name"]==a[0] for t in s["tabs"] if t["name"]==a[1]][0])' "$1"; }
shown_tab() { herdr-app status | /usr/bin/python3 -I -S -c 'import json,sys; print(json.load(sys.stdin).get("tab"))'; }
pick() { want=$(tabid "$1"); for _ in 1 2 3 4 5; do herdr-app do "pdk-tree.pick:pn:$(pane "$1")" >/dev/null; sleep 1; [ "$(shown_tab)" = "$want" ] && return 0; done; echo "pick $1 did not take" >&2; }
view() { herdr-app do layout.select --stack work-body --child "$1" >/dev/null; }
shot() { "$TEST/shoot.sh" "$OUT/$NAME-$1.png" "$LOOK" >/dev/null; echo "$OUT/$NAME-$1.png"; }

herdr-app do app.theme --name "$NAME" >/dev/null
view main; sleep 1.5
if [ -n "$SHOT" ]; then
  # The appearance first: app.theme sets the half matching the theme, and Colours edits the theme showing.
  /usr/bin/python3 -I -S -c 'import json,sys; p=sys.argv[1]; s=json.load(open(p)); s["appearance"]=sys.argv[2]; json.dump(s, open(p, "w"), indent=2)' "$H/settings.json" "$LOOK"
  sleep 1.5
  pick core-client/lead
  "$TEST/shoot.sh" "$OUT/$SHOT.png" "$LOOK" >/dev/null; echo "$OUT/$SHOT.png"
  exit 0
fi
pick core-client/lead; shot tree
pick core-client/review/0; view chat; sleep 3; shot chat
view factory; sleep 3; shot factory
view main
