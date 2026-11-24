#!/bin/sh
# The sidebar screenshots (sidebar-polish brief) of the scene (scene.sh), by app commands only.
#   modpack/test/sandbox.sh <short> modpack/test/shots-sidebar.sh <out dir> <before|after> <light|dark|moshi|pdk-theme> [collapsed|tab-folded|factory]
set -eu
: "${PDK_SANDBOX:?run through modpack/test/sandbox.sh}"
OUT=$1; WHEN=$2; THEME=$3; EXTRA=${4:-}
TEST=$(cd "$(dirname "$0")" && pwd -P)
mkdir -p "$OUT"
# light, dark, moshi, or any pack theme by name (pdk-t3-blue-light is light, the rest dark).
case $THEME in
  light) name=pdk-t3-light; look=light ;; dark) name=pdk-t3-dark; look=dark ;; moshi) name=pdk-moshi; look=dark ;;
  *-light) name=$THEME; look=light ;; *) name=$THEME; look=dark ;;
esac
q() { herdr-app ls | /usr/bin/python3 -I -S -c "$1" "${2:-}"; }
space() { q 'import json,sys; print([s["id"] for s in json.load(sys.stdin)["spaces"] if s["name"]==sys.argv[1]][0])' "$1"; }
tabid() { q 'import json,sys; a=sys.argv[1].split("/"); print([t["id"] for s in json.load(sys.stdin)["spaces"] if s["name"]==a[0] for t in s["tabs"] if t["name"]==a[1]][0])' "$1"; }
pane() { q 'import json,sys; a=sys.argv[1].split("/"); print([t["terminals"][0]["pane"] for s in json.load(sys.stdin)["spaces"] if s["name"]==a[0] for t in s["tabs"] if t["name"]==a[1]][0])' "$1"; }
shown_tab() { herdr-app status | /usr/bin/python3 -I -S -c 'import json,sys; print(json.load(sys.stdin).get("tab"))'; }
herdr-app do app.theme --name "$name" >/dev/null
herdr-app do layout.select --stack work-body --child main >/dev/null; sleep 1.5
want=$(tabid core-client/lead)
for _ in 1 2 3 4 5; do herdr-app do "pdk-tree.pick:pn:$(pane core-client/lead)" >/dev/null; sleep 1; [ "$(shown_tab)" = "$want" ] && break; done
file="$OUT/$WHEN-$THEME.png"
case $EXTRA in
  collapsed) herdr-app do "pdk-tree.fold:sp:$(space evals)" >/dev/null; sleep 1; file="$OUT/$WHEN-collapsed-$THEME.png" ;;
  tab-folded) herdr-app do "pdk-tree.fold:tb:$(tabid core-client/review)" >/dev/null; sleep 1; file="$OUT/$WHEN-tab-folded.png" ;;
  factory) herdr-app do layout.select --stack work-body --child factory >/dev/null; sleep 3; file="$OUT/$WHEN-factory-$THEME.png" ;;
esac
"$TEST/shoot.sh" "$file" "$look" >/dev/null
case $EXTRA in
  collapsed) herdr-app do "pdk-tree.fold:sp:$(space evals)" >/dev/null ;;
  tab-folded) herdr-app do "pdk-tree.fold:tb:$(tabid core-client/review)" >/dev/null ;;
  factory) herdr-app do layout.select --stack work-body --child main >/dev/null ;;
esac
echo "$file"
