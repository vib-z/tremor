#!/bin/sh
# The v3 acceptance screenshots (build-modpack-2) of the scene (scene.sh) in one theme, by app commands only.
#   modpack/test/sandbox.sh <short> modpack/test/shots-v3.sh <out dir> <light|dark|moshi>
set -eu
: "${PDK_SANDBOX:?run through modpack/test/sandbox.sh}"
OUT=$1; THEME=$2
TEST=$(cd "$(dirname "$0")" && pwd -P)
mkdir -p "$OUT"
case $THEME in
  light) name=pdk-t3-light; look=light ;;
  dark) name=pdk-t3-dark; look=dark ;;
  moshi) name=pdk-moshi; look=dark ;;
  *) echo "theme: light, dark or moshi" >&2; exit 2 ;;
esac
q() { herdr-app ls | /usr/bin/python3 -I -S -c "$1" "${2:-}"; }
tab() { q 'import json,sys; a=sys.argv[1].split("/"); print([t["id"] for s in json.load(sys.stdin)["spaces"] if s["name"]==a[0] for t in s["tabs"] if t["name"]==a[1]][0])' "$1"; }
pane() { q 'import json,sys; a=sys.argv[1].split("/"); print([t["terminals"][int(a[2]) if len(a)>2 else 0]["pane"] for s in json.load(sys.stdin)["spaces"] if s["name"]==a[0] for t in s["tabs"] if t["name"]==a[1]][0])' "$1"; }
view() { herdr-app do layout.select --stack work-body --child "$1" >/dev/null; }
tabid() { q 'import json,sys; a=sys.argv[1].split("/"); print([t["id"] for s in json.load(sys.stdin)["spaces"] if s["name"]==a[0] for t in s["tabs"] if t["name"]==a[1]][0])' "$1"; }
shown_tab() { herdr-app status | /usr/bin/python3 -I -S -c 'import json,sys; print(json.load(sys.stdin).get("tab"))'; }
# The tree's click path, confirmed: a pick sent within seconds of a mod (re)load was sometimes lost (observed
# 4 times in the sandbox), so it is sent again until the app shows the pane's tab, at most 5 times.
pick() {
  path=$1; want=$(tabid "$path"); target="pn:$(pane "$path")"
  for _ in 1 2 3 4 5; do
    herdr-app do "pdk-tree.pick:$target" >/dev/null; sleep "${2:-1}"
    [ "$(shown_tab)" = "$want" ] && return 0
  done
  echo "pick $path did not take" >&2; return 1
}
shot() { "$TEST/shoot.sh" "$OUT/$1-$THEME.png" "$look" >/dev/null; echo "$OUT/$1-$THEME.png"; }

herdr-app do app.theme --name "$name" >/dev/null
view main; sleep 1.5
# The tree's own click path (pdk-tree.pick): a pane in the first workspace's lead tab.
pick core-client/lead; shot 1-tree
pick core-client/review/0; view chat; sleep 3; shot 2-chat
view main; pick core-client/review/1; shot 3-tabs-pane-header
