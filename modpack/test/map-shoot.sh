#!/bin/sh
# The Factory Map's frames, from a running map-scene.sh sandbox, through the app's own commands only.
#
#   modpack/test/map-shoot.sh <out dir>       (PDK_SHORT as for map-scene.sh, default fmap)
#
# Frames: board-dark.png (the Board, today's view), then, when the installed pack has the Map, at a 1440-wide view:
# fleet-dark, team-lead-dark (lead-repod-watch-core), team-sub-dark (research-moshi), expanded-dark, selected-dark
# (design-states chosen); fleet-light and expanded-light (T3 light); fleet-390 (a 390-wide view: the window is
# reopened at 670 pt, Core and agents stay); expanded-reduced (Reduce Motion on in the sandbox's installed helper only).
# The Map's commands it drives (delivered to the mod's nextCommand as "pdk-factory.<command>"):
#   view:map | view:board      mode:collapsed | mode:expanded      level:fleet      team:<terminal>      up
#   select:<terminal> | deselect
#
#   modpack/test/map-shoot.sh <out dir> before   (2155: main 697d7cb's Map on map-scene.sh's three jobs, relay included)
# For each machine filter (all, local = this computer, studio-mac) Fleet, Jobs and Expanded; then, under All, a
# native and the relay job's Team, an agent of each chosen (the owner's frame: build-backend-tui), the level switch's
# Agent and Team pressed with nothing chosen; and the owner's own view: studio-mac, build-backend-tui chosen.
#
#   modpack/test/map-shoot.sh <out dir> after    (2155 fix: Collapsed, one lead open, All expanded; same scene, filters)
# For each filter Collapsed and All expanded; under All a native and the relay lead open, an agent of each chosen
# (agent-native, agent-relay), the relay's needs-you agent chosen in All expanded, a switch from one open lead to the
# other; the owner's view (studio-mac, build-backend-tui); T3 light; a 390 view; Reduce Motion. Ends in Collapsed.
# A command the installed Map lacks is logged "missing" and its frames are skipped; out/map-shoot.log has it all.
set -eu
TEST=$(cd "$(dirname "$0")" && pwd -P)
short=${PDK_SHORT:-fmap}
S=/tmp/pdk-$short
PY=/usr/bin/python3

if [ "${1:-}" = --in ]; then
  # Inside the sandbox: $2 out dir, $3 step.
  : "${PDK_SANDBOX:?run through modpack/test/sandbox.sh}"
  S=$PDK_SANDBOX; H=$HERDR_APP_HOME; OUT=$2
  do_() { herdr-app do "$@" > /dev/null; }
  t() { cat "$S/ctl/$1.t"; }
  # A Map command, then time for its animation to settle; PDK_SLOW=<n> multiplies every wait (a locked screen paints
  # only on forced frames, so a glide or layout can still be mid-way after 2.5 s: 2155 phase 2 used PDK_SLOW=3).
  f() { do_ "pdk-factory.$1"; sleep "$(awk "BEGIN{print ${2:-1.5}*${PDK_SLOW:-1}}")"; }
  # PDK_FRAMES=<n>: n forced frames before the shot (shoot.sh forces 2 itself; a locked screen moves a glide on per frame).
  shot() {
    for _ in $(seq 3 "${PDK_FRAMES:-2}"); do herdr-app do window.maximize > /dev/null; sleep 0.6; done
    "$TEST/shoot.sh" "$OUT/$1.png" "${2:-}" > /dev/null; echo "frame $OUT/$1.png"; }
  case $3 in
  board)
    do_ layout.select --stack work-body --child factory; sleep 3
    grep -q 'view:map' "$H/mods/pdk-factory/main.js" && f view:board
    shot board-dark dark ;;
  map)
    f view:map; f mode:collapsed; f level:fleet 2; shot fleet-dark dark
    f "team:$(t lead-repod-watch-core)" 2.5; shot team-lead-dark
    f "team:$(t research-moshi)" 2.5; shot team-sub-dark
    f up; f up; f mode:expanded 2.5; shot expanded-dark
    f "select:$(t design-states)"; shot selected-dark
    f deselect
    do_ app.theme --name pdk-t3-light
    f mode:collapsed; f level:fleet 2; shot fleet-light light
    f mode:expanded 2.5; shot expanded-light light
    $PY -I -S -c 'import json,sys; p=sys.argv[1]; s=json.load(open(p)); s["appearance"]="dark"; json.dump(s, open(p,"w"), indent=2)' "$H/settings.json"
    sleep 1.5 ;;
  before)
    do_ layout.select --stack work-body --child factory; sleep 3
    for m in all local studio-mac; do
      do_ "pdk-tree.machine:$m"; sleep 2
      f view:map; f mode:collapsed; f level:fleet 2; shot "fleet-$m" dark
      f level:jobs 2; shot "jobs-$m"
      f mode:expanded 2.5; shot "expanded-$m"
      f mode:collapsed
    done
    do_ pdk-tree.machine:all; sleep 2; f level:fleet 2
    f "team:$(t lead-repod-watch-core)" 2.5; shot team-native
    f "select:$(t design-states)" 2; shot agent-native; f deselect
    f level:fleet 2; f "team:$(t lead-demo-restructure)" 2.5; shot team-relay
    f "select:$(t build-backend-tui)" 2; shot agent-relay; f deselect
    f level:fleet 2; f level:team 2; shot level-team-nothing-chosen
    f level:fleet 2; f level:agent 2; shot level-agent-nothing-chosen
    f level:fleet 2; f mode:expanded 2.5; f "select:$(t build-relay-config)" 2; shot expanded-selected-relay; f deselect
    f mode:collapsed; do_ pdk-tree.machine:studio-mac; sleep 2
    f level:fleet 2; f "select:$(t build-backend-tui)" 2.5; shot owner-frame-studio-mac; f deselect
    do_ pdk-tree.machine:all; f level:fleet ;;
  after)
    do_ layout.select --stack work-body --child factory; sleep 3
    for m in all local studio-mac; do
      do_ "pdk-tree.machine:$m"; sleep 2
      f view:map; f deselect; f close; f mode:collapsed 2; shot "collapsed-$m" dark
      f mode:expanded 2.5; shot "expanded-$m"
      f mode:collapsed 2
    done
    do_ pdk-tree.machine:all; sleep 2
    f "open:$(t lead-repod-watch-core)" 2.5; shot open-native
    f "select:$(t design-states)" 2; shot agent-native; f deselect
    f "open:$(t lead-demo-restructure)" 2.5; shot open-relay-switched
    f "select:$(t build-backend-tui)" 2; shot agent-relay; f deselect
    f close 2; shot closed-again
    f mode:expanded 2.5; f "select:$(t build-relay-config)" 2; shot expanded-selected-relay; f deselect
    f mode:collapsed 2; do_ pdk-tree.machine:studio-mac; sleep 2
    f "select:$(t build-backend-tui)" 2.5; shot owner-frame-studio-mac; f deselect; f close
    do_ pdk-tree.machine:all; sleep 2
    do_ app.theme --name pdk-t3-light
    f mode:collapsed 2; f "open:$(t lead-demo-tree)" 2.5; shot open-light light; f close
    f mode:expanded 2.5; shot expanded-light light; f mode:collapsed 2
    $PY -I -S -c 'import json,sys; p=sys.argv[1]; s=json.load(open(p)); s["appearance"]="dark"; json.dump(s, open(p,"w"), indent=2)' "$H/settings.json"
    sleep 1.5 ;;
  narrow2)
    do_ layout.select --stack work-body --child factory; sleep 2
    f view:map; f mode:collapsed 2; shot collapsed-390 dark
    f "open:$(t lead-repod-watch-core)" 2.5; shot open-390; f close; f mode:expanded 2.5; shot expanded-390; f mode:collapsed ;;
  reduced2)
    do_ layout.select --stack work-body --child factory; sleep 2
    f view:map; f mode:expanded 2.5; shot expanded-reduced dark; f mode:collapsed 2
    f "open:$(t lead-demo-restructure)" 2.5; shot open-reduced; f close; f mode:collapsed ;;
  narrow)
    do_ layout.select --stack work-body --child factory; sleep 2
    f view:map; f mode:collapsed; f level:fleet 2; shot fleet-390 dark ;;
  reduced)
    do_ layout.select --stack work-body --child factory; sleep 2
    f view:map; f mode:expanded 2.5; shot expanded-reduced dark ;;
  esac
  exit 0
fi

OUT=$(mkdir -p "${1:?out dir}" && cd "$1" && pwd -P)
if [ "${2:-}" = after ]; then
  sb() { "$TEST/sandbox.sh" "$short" "$@"; }
  sb herdr-app status > /dev/null 2>&1 || { echo "no window at $S: map-scene.sh up first" >&2; exit 1; }
  AFTER=1
elif [ "${2:-}" = before ]; then
  "$TEST/sandbox.sh" "$short" herdr-app status > /dev/null 2>&1 || { echo "no window at $S: map-scene.sh up first" >&2; exit 1; }
  "$TEST/sandbox.sh" "$short" "$TEST/map-shoot.sh" --in "$OUT" before | tee "$OUT/map-shoot.log"; exit 0
fi
sb() { "$TEST/sandbox.sh" "$short" "$@"; }
# Start the window and wait for it. sandbox.sh relinks bin/herdr-app on every call, so polling it while the launch's own
# sandbox.sh is still linking makes one `ln -sf` fail and the launch die (seen: "ln: ... File exists"); the poll waits
# 3 s first, and one more launch is tried if no window answers.
# The app's own version goes in update-notes.json first, so no "Updated to …" toast covers the frame.
launch() {
  v=$(sb herdr-app --version | awk '{print $2}')
  printf '{"last_run": "%s", "presented": []}' "$v" > "$S/home/update-notes.json"
  for _try in 1 2; do
    ( nohup "$TEST/sandbox.sh" "$short" herdr-app >> "$S/app.log" 2>&1 & )
    sleep 3
    for _ in $(seq 1 40); do sb herdr-app status > /dev/null 2>&1 && return 0; sleep 1; done
  done
  echo "no window answered at $S (see $S/app.log)" >&2; return 1
}
# Quit and wait until nothing answers (the socket file can outlive the app, so ask, don't look).
quit() {
  sb herdr-app do app.quit > /dev/null 2>&1 || true
  for _ in $(seq 1 30); do sb herdr-app status > /dev/null 2>&1 || return 0; sleep 1; done
}
log() { echo "$*" | tee -a "$OUT/map-shoot.log"; }
sb herdr-app status > /dev/null 2>&1 || launch
log "map-shoot $(git -C "$TEST" rev-parse --short HEAD 2>/dev/null) $(date -u +%FT%TZ) sandbox $S"
# The window at a given view width (tremor's sidebar is 280 pt; the app floors windows at 480): quit, write
# window.json, reopen. Core keeps every terminal (keep), so the tree is the same after.
reopen() {
  quit
  sleep 1
  $PY -I -S -c 'import json,sys; json.dump({"state":"windowed","bounds":[0,0,max(480,int(sys.argv[2])+280),900]}, open(sys.argv[1]+"/window.json","w"))' "$S/home" "$1"
  launch
  sleep 3
}
if [ -n "${AFTER:-}" ]; then
  sb "$TEST/map-shoot.sh" --in "$OUT" after | tee -a "$OUT/map-shoot.log"
  reopen 390; sb "$TEST/map-shoot.sh" --in "$OUT" narrow2 | tee -a "$OUT/map-shoot.log"
  reopen 1440
  HP="$S/home/pdk/helper/pdk-helper.py"; cp "$HP" "$S/pdk-helper.py.orig"
  $PY -I -S -c 'import sys; p=sys.argv[1]; s=open(p).read(); open(p,"w").write(s.replace("out({\"reduce\": r.stdout.strip() == \"1\"})", "out({\"reduce\": True})"))' "$HP"
  grep -q '"reduce": True' "$HP" || log "Reduce Motion patch did not apply"
  reopen 1440; sb "$TEST/map-shoot.sh" --in "$OUT" reduced2 | tee -a "$OUT/map-shoot.log"
  cp "$S/pdk-helper.py.orig" "$HP"; reopen 1440
  sb herdr-app do pdk-factory.view:map > /dev/null; sb herdr-app do pdk-factory.mode:collapsed > /dev/null
  log "done: $(ls "$OUT"/*.png | wc -l | tr -d ' ') frames in $OUT (left in Collapsed)"; exit 0
fi
sb "$TEST/map-shoot.sh" --in "$OUT" board | tee -a "$OUT/map-shoot.log"
M="$S/home/mods/pdk-factory/main.js"
missing=""
for c in view:map view:board mode:collapsed mode:expanded level:fleet team: up deselect select:; do
  case $c in *:) q="\"$c";; *) q="\"$c\"";; esac   # "team:" is a prefix; "up" is a whole command
  grep -qF "$q" "$M" || missing="$missing $c"
done
if [ -n "$missing" ]; then
  log "Map frames skipped: the installed pdk-factory lacks the command(s):$missing"
  exit 0
fi
sb "$TEST/map-shoot.sh" --in "$OUT" map | tee -a "$OUT/map-shoot.log"
reopen 390
sb "$TEST/map-shoot.sh" --in "$OUT" narrow | tee -a "$OUT/map-shoot.log"
reopen 1440
HP="$S/home/pdk/helper/pdk-helper.py"
cp "$HP" "$S/pdk-helper.py.orig"
$PY -I -S -c 'import sys; p=sys.argv[1]; s=open(p).read(); open(p,"w").write(s.replace("out({\"reduce\": r.stdout.strip() == \"1\"})", "out({\"reduce\": True})"))' "$HP"
reopen 1440
sb "$TEST/map-shoot.sh" --in "$OUT" reduced | tee -a "$OUT/map-shoot.log"
cp "$S/pdk-helper.py.orig" "$HP"
reopen 1440
log "done: $(ls "$OUT"/*.png | wc -l | tr -d ' ') frames in $OUT"
