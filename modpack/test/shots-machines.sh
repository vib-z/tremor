#!/bin/sh
# The machines-tree screenshots (v4) of the scene (scene.sh, with "box" added by machine.sh), by app commands only.
#   modpack/test/sandbox.sh <short> modpack/test/shots-machines.sh <out dir> <light|dark|moshi> <what>...
# what: tree, folded, agents, machine-hidden, level-off, sidebar-open, sidebar-hidden, tabbar-remote, new-menu,
# keyboard (the keyboard's row: its ring and a workspace row's actions), plus-menu (the tab bar's +: PDK_PLUS_MENU,
# pdk-new-menu by default, new-menu for Herdr's own), single-machine
# (single-machine removes "box" from the sandbox Core's machine list, so it goes last).
set -eu
: "${PDK_SANDBOX:?run through modpack/test/sandbox.sh}"
OUT=$1; THEME=$2; shift 2
TEST=$(cd "$(dirname "$0")" && pwd -P)
mkdir -p "$OUT"
case $THEME in
  light) name=pdk-t3-light; look=light ;; dark) name=pdk-t3-dark; look=dark ;; moshi) name=pdk-moshi; look=dark ;;
  # Any pack preset by name (pdk-t3-blue-light is light, the rest dark).
  pdk-*-light) name=$THEME; look=light ;; pdk-*) name=$THEME; look=dark ;;
  *) echo "theme: light, dark, moshi or a pdk-* preset" >&2; exit 2 ;;
esac
q() { herdr-app ls | /usr/bin/python3 -I -S -c "$1" "${2:-}"; }
space() { q 'import json,sys; print([s["id"] for s in json.load(sys.stdin)["spaces"] if s["name"]==sys.argv[1]][0])' "$1"; }
tabid() { q 'import json,sys; a=sys.argv[1].split("/"); print([t["id"] for s in json.load(sys.stdin)["spaces"] if s["name"]==a[0] for t in s["tabs"] if t["name"]==a[1]][0])' "$1"; }
pane() { q 'import json,sys; a=sys.argv[1].split("/"); print([t["terminals"][0]["pane"] for s in json.load(sys.stdin)["spaces"] if s["name"]==a[0] for t in s["tabs"] if t["name"]==a[1]][0])' "$1"; }
shown_tab() { herdr-app status | /usr/bin/python3 -I -S -c 'import json,sys; print(json.load(sys.stdin).get("tab"))'; }
# A pick sent right after a reload is sometimes lost: sent again until the app shows the pane's tab.
pick() { want=$(tabid "$1"); for _ in 1 2 3 4 5 6 7 8; do herdr-app do "pdk-tree.pick:pn:$(pane "$1")" >/dev/null; sleep 1.5; [ "$(shown_tab)" = "$want" ] && return 0; done; echo "pick $1 did not take" >&2; }
do_() { herdr-app do "$@" >/dev/null; }
shot() { "$TEST/shoot.sh" "$OUT/$1-$THEME.png" "$look" >/dev/null; echo "$OUT/$1-$THEME.png"; }

do_ app.theme --name "$name"
do_ layout.select --stack work-body --child main; sleep 3
pick core-client/lead
for what in "$@"; do
  case $what in
    tree) shot tree ;;
    folded)
      # Moshi's collapsed look: core-client and evals folded (core-client counts what it hides), box's open.
      do_ "pdk-tree.fold:sp:$(space core-client)"; do_ "pdk-tree.fold:sp:$(space evals)"; sleep 1; shot folded
      do_ "pdk-tree.fold:sp:$(space core-client)"; do_ "pdk-tree.fold:sp:$(space evals)" ;;
    sidebar-open) shot sidebar-open ;;
    keyboard) do_ "pdk-tree.pick:sp:$(space core-client)"; do_ pdk-tree.focus; sleep 1; shot keyboard; pick core-client/lead ;;
    sidebar-hidden) do_ layout.toggle --id sidebar; sleep 1.5; shot sidebar-hidden; do_ layout.toggle --id sidebar ;;
    tabbar-remote) do_ space.select --id "$(space infra)"; sleep 1.5; shot tabbar-remote; pick core-client/lead ;;
    plus-menu) do_ mod.open --name "${PDK_PLUS_MENU:-pdk-new-menu}"; sleep 2; shot plus-menu; do_ mod.open --name "${PDK_PLUS_MENU:-pdk-new-menu}" ;;
    single-machine)
      hc machine rm box >/dev/null 2>&1 || true
      for _ in 1 2 3 4 5 6; do q 'import json,sys; sys.exit(any(s.get("machine") for s in json.load(sys.stdin)["spaces"]))' && break; sleep 1; done
      sleep 1; shot single-machine ;;
    *) echo "unknown shot: $what" >&2 ;;
  esac
done
