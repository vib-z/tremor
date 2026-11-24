#!/bin/sh
# The final integrated screenshot set, in one command. It makes a private sandbox (sandbox.sh), installs this
# checkout's pack, builds one scene with every state the audits asked for, shoots every surface in each theme (full
# frames, then 2x crops by final-sheet.py), makes a contact sheet per theme and two across all 24 presets (tree and
# terminal; factory mind map), then quits
# the app, stops the sandbox Core and box's Core in that order and removes the sandbox. Stand-ins only
# (fake-agent.py); no real input.
#   modpack/test/shots-final.sh <out dir> [theme...]     themes: light dark moshi (the default) or pdk-* presets
# A surface whose mod, command or scene is not in this checkout is skipped and logged "not present at this commit",
# so the same command runs before and after the parity merges. Everything is logged to <out>/shots-final.log.
# PDK_SHORT names the sandbox (default f<pid>; /tmp/pdk-<short> must not exist). PDK_PRESETS=0 skips the presets.
# Inside the sandbox it runs itself: shots-final.sh --scene | --settle | --shoot <out> <theme> | --presets <out>.
set -eu
TEST=$(cd "$(dirname "$0")" && pwd -P)

if [ "${1:-}" != "${1#--}" ]; then
  : "${PDK_SANDBOX:?run through modpack/test/sandbox.sh}"
  S=$PDK_SANDBOX; H=$HERDR_APP_HOME
  q() { herdr-app ls | /usr/bin/python3 -I -S -c "$1" "${2:-}"; }
  space() { q 'import json,sys; print(next((s["id"] for s in json.load(sys.stdin)["spaces"] if s["name"]==sys.argv[1]), ""))' "$1"; }
  tabid() { q 'import json,sys; a=sys.argv[1].split("/"); print(next((t["id"] for s in json.load(sys.stdin)["spaces"] if s["name"]==a[0] for t in s["tabs"] if t["name"]==a[1]), ""))' "$1"; }
  pane() { q 'import json,sys; a=sys.argv[1].split("/"); print(next((t["terminals"][0]["pane"] for s in json.load(sys.stdin)["spaces"] if s["name"]==a[0] for t in s["tabs"] if t["name"]==a[1]), ""))' "$1"; }
  shown_tab() { herdr-app status | /usr/bin/python3 -I -S -c 'import json,sys; print(json.load(sys.stdin).get("tab"))'; }
  do_() { herdr-app do "$@" >/dev/null; }
  view() { do_ layout.select --stack work-body --child "$1"; sleep 1.5; }
  # While the screen is locked the window draws only when made to (shoot.sh's resize). A media tile asks for its
  # preview when drawn and shows it on a later frame, so the media chats get a few frames before their shot.
  repaint() { for _ in 1 2 3; do do_ window.maximize; sleep 1; do_ window.maximize; sleep 3; done; }
  # A pane in front through Herdr's own commands (works in a folded workspace, unlike the tree's pick).
  focus() {
    s=$(space "${1%%/*}"); t=$(tabid "$1"); p=$(pane "$1")
    for _ in 1 2 3 4 5; do
      do_ space.select --id "$s"; do_ tab.select --id "$t"; do_ pane.focus --pane "$p"; sleep 1.5
      [ "$(shown_tab)" = "$t" ] && return 0
    done
    echo "focus $1 did not take" >&2
  }
  # Is it in the installed pack: a mod, or a string in its main.js.
  has() { [ -d "$H/mods/$1" ] && { [ -z "${2:-}" ] || grep -qF -- "$2" "$H/mods/$1/main.js"; }; }
fi

case ${1:-} in
--scene)
  do_ layout.switch --name tremor
  sh "$TEST/machine.sh" add box >/dev/null
  sh "$TEST/scene.sh" >/dev/null
  # Beyond scene.sh: a long tab name (elided before its status), a second running tab, and a second idle workspace.
  ev=$(space evals)
  do_ tab.new --space "$ev" --name "a-long-tab-name-that-elides-before-its-time-and-status" --folder "$S/work/evals"
  do_ tab.new --space "$ev" --name parked --folder "$S/work/evals" --argv '["codex","--no-daemon","--pdk-name","parked","--pdk-state","idle","--pdk-title","Parked work"]'
  mkdir -p "$S/work/archive"
  do_ space.new --name archive --folder "$S/work/archive" --tab notes --argv '["claude","--model","claude-haiku-5-5","--pdk-name","archive","--pdk-state","idle","--pdk-title","Release notes"]'
  sleep 3 ;;
--settle)
  log() { echo "scene: $*"; }
  # Beyond media-scene.sh: one more chat whose tiles are every inline fallback (a remote image, a large file, an HTML
  # page, a video with no poster, an image that can't be read). Its transcript is the answer chat's, with a new last
  # message naming them. The empty clip keeps Quick Look busy until the helper's 20 s limit, so it has no poster.
  src=$(ls "$HOME"/.claude/projects/*/5d0c3a51-2222-4c43-9a8e-1f0e2d3c4b5a.jsonl 2>/dev/null | head -1)
  if [ -n "$src" ] && [ -n "$(space media)" ]; then
    mkdir -p "$S/media/fallback"; : > "$S/media/fallback/no-poster.mp4"; printf 'not an image\n' > "$S/media/fallback/unreadable.png"
    /usr/bin/python3 -I -S -c '
import json, sys
src, d = sys.argv[1], sys.argv[2]
lines = open(src).read().splitlines()
i = max(n for n, l in enumerate(lines) if json.loads(l).get("type") == "assistant")
r = json.loads(lines[i])
r["message"]["content"] = [{"type": "text", "text": (
    "Everything here that has no inline preview: the reference photo https://images.example.com/photos/reference.jpg, "
    f"the scan {d}/huge-scan.png, the page {d}/page.html, the clip {d}/fallback/no-poster.mp4 "
    f"and the frame {d}/fallback/unreadable.png.")}]
lines[i] = json.dumps(r, separators=(",", ":"))
open(src.replace("-2222-", "-3333-"), "w").write("".join(l + "\n" for l in lines[:i + 1]))' "$src" "$S/media"
    do_ tab.new --space "$(space media)" --name fallbacks --folder "$S/work/media" --argv '["claude","--session-id","5d0c3a51-3333-4c43-9a8e-1f0e2d3c4b5a","--pdk-name","mfallbacks","--pdk-state","done","--pdk-title","Media fallbacks"]'
    sleep 2; log "media/fallbacks: a chat with every inline fallback tile"
  else log "media/fallbacks: not present at this commit (no media scene)"; fi
  # Each media chat drawn once now, so its tiles' previews (the helper's sips and qlmanage) are made before the shots.
  for tb in media/pasted media/tools media/answer media/fallbacks; do [ -n "$(tabid "$tb")" ] && { focus "$tb"; view chat; repaint; sleep 8; repaint; }; done
  view main
  # The later scenes' workspaces fold, so the tree fits one frame.
  for w in media code asks; do s=$(space "$w"); [ -n "$s" ] && do_ "pdk-tree.fold:sp:$s"; done
  focus core-client/lead
  # Done and not yet seen: review finishes a real turn (working, then done) while the lead's tab is shown.
  printf 'working\n' >> "$S/ctl/review"; sleep 3; printf 'done\n' >> "$S/ctl/review"; sleep 2
  log "core-client/review: finished a turn off screen (done, unseen)" ;;
--shoot)
  OUT=$2; THEME=$3
  case $THEME in
    light) name=pdk-t3-light; look=light ;; dark) name=pdk-t3-dark; look=dark ;; moshi) name=pdk-moshi; look=dark ;;
    pdk-*-light) name=$THEME; look=light ;; pdk-*) name=$THEME; look=dark ;;
    *) echo "theme: light, dark, moshi or a pdk-* preset" >&2; exit 2 ;;
  esac
  D=$OUT/$THEME; F=$D/frames; mkdir -p "$F"; : > "$D/manifest.tsv"
  n=0
  log() { echo "$THEME $1: $2" | tee -a "$OUT/shots-final.log"; }
  skip() { log "$1" "not present at this commit ($2)"; }
  # frame <name>: a full frame; crop <name> <sidebar|tabbar|work|full|diff> [base frame]: a crop of it, cut later.
  frame() { n=$((n + 1)); LAST=$F/$(printf %02d "$n")-$1.png; "$TEST/shoot.sh" "$LAST" "$look" >/dev/null; }
  crop() { printf '%s\t%s\t%s\t%s\n' "$1" "$LAST" "${3:--}" "$2" >> "$D/manifest.tsv"; log "$1" "shot"; }
  close() { do_ overlay.close; sleep 1; }
  # pop <name> <app command...>: two base frames (what moves between them is animation), the command, then the frame
  # with what it opened, cropped by difference. A command that fails is logged and the run goes on.
  pop() {
    pn=$1; shift; frame "$pn-before"; B=$LAST; frame "$pn-still"; B2=$LAST
    if ! "$@" >/dev/null 2>&1; then log "$pn" "FAILED: $*"; return 0; fi
    sleep 2.5; frame "$pn"; crop "$pn" diff "$B,$B2"
  }
  # A palette command (Cmd+K, ">" for commands), picked for the workspace shown, as a person would.
  palette() { herdr-app do mod.open --name pdk-search && sleep 1.5 && herdr-app do "pdk-search.query:>$1" && sleep 1 && herdr-app do pdk-search.pick; }

  do_ app.theme --name "$name"
  view main; focus core-client/lead
  # Two machines, the workspaces, agent-led tabs, splits, needs-you/working/done/idle, the sub-agent chain, the long name.
  frame tree; crop tree sidebar; crop tabbar tabbar; crop terminal work
  fold3() { for w in core-client evals infra; do do_ "pdk-tree.fold:sp:$(space "$w")"; done; sleep 1; }
  fold3
  # Every workspace folded: name, caret and counts only, as Moshi's (owner request 37).
  frame collapsed; crop tree-collapsed sidebar
  fold3
  sleep 1
  if has pdk-new-menu; then pop plus-menu herdr-app do mod.open --name pdk-new-menu; close; else skip plus-menu "no pdk-new-menu"; fi
  pop palette herdr-app do mod.open --name pdk-search; close
  if has pdk-pane '"slash"'; then pop slash-terminal herdr-app do pdk-pane.slash; close; else skip slash-terminal "pdk-pane has no slash command"; fi
  # The pack guide.
  if has pdk-guide; then pop guide herdr-app do mod.open --name pdk-guide; close; else skip guide "no pdk-guide"; fi
  # Files and Changes on the shown workspace (core-client), through the palette's own commands.
  if has pdk-workspace-files && has pdk-search '"mode:"'; then pop files-dialog palette "Browse files and previews"; close
  else skip files-dialog "no pdk-workspace-files or no palette commands"; fi
  if has pdk-changes && has pdk-search '"mode:"'; then pop changes-dialog palette "Review and commit all changes"; close
  else skip changes-dialog "no pdk-changes or no palette commands"; fi
  if has pdk-factory; then view factory; sleep 2; frame factory; crop factory-mind-map work; view main; else skip factory-mind-map "no pdk-factory"; fi

  # The chat: the lead's approval card (scene.sh's permission request), its "/" menu, then the later scenes' question
  # card, code view and media.
  view chat; sleep 2; frame approval; crop approval-card work
  # The "/" menu on evals' lead, so the draft it leaves never shows in the approval card.
  if has pdk-chat '"slash"'; then focus evals/lead; view chat; pop slash-chat herdr-app do pdk-chat.slash; do_ pdk-chat.slash:escape; sleep 1
  else skip slash-chat "pdk-chat has no slash command"; fi
  if [ -n "$(space asks)" ]; then focus asks/ask; view chat; sleep 2; frame question; crop question-card work
  else skip question-card "no interactions-scene.sh"; fi
  if [ -n "$(space code)" ] && has pdk-chat '"code:"'; then
    focus code/briefs; view chat; do_ pdk-chat.code:open; sleep 2; frame code-view; crop code-view work
  else skip code-view "no code-scene.sh or no pdk-chat code view"; fi
  if [ -n "$(space media)" ]; then
    focus media/pasted; view chat; repaint; frame image-tile; crop image-tile work
    focus media/answer; view chat; repaint; frame media-tiles; crop media-tiles work
    # Its newest tile is the missing frame: its preview is the two-line error ("Not found", then where and why).
    pop preview-error herdr-app do pdk-chat.preview:1; close
    focus media/tools; view chat; repaint; frame media-tools; crop media-tools work
    # The video's tile, by its place among the chat's tiles (newest first), opens its preview: poster and Play.
    pop video-poster herdr-app do "pdk-chat.preview:${PDK_VIDEO_TILE:-1}"; close
    if [ -n "$(tabid media/fallbacks)" ]; then focus media/fallbacks; view chat; repaint; frame media-fallbacks; crop media-fallbacks work
    else skip media-fallbacks "no media/fallbacks chat"; fi
  else skip media "no media workspace"; fi
  view main; focus core-client/lead ;;
--presets)
  # Per preset: the tree and terminal, then the factory mind map (its own frame and a crop of the work area).
  OUT=$2; P=$OUT/presets; mkdir -p "$P/factory"; : > "$P/factory/manifest.tsv"
  for f in "$H"/pdk/themes/pdk-*.json; do
    name=$(basename "$f" .json)
    case $name in *-light) look=light ;; *) look=dark ;; esac
    do_ app.theme --name "$name"; sleep 1.5
    "$TEST/shoot.sh" "$P/$name.png" "$look" >/dev/null && echo "preset $name: shot" | tee -a "$OUT/shots-final.log"
    if has pdk-factory; then
      view factory; "$TEST/shoot.sh" "$P/factory/$name.png" "$look" >/dev/null
      printf '%s\t%s\t-\twork\n' "$name" "$P/factory/$name.png" >> "$P/factory/manifest.tsv"; view main
    fi
  done
  has pdk-factory || echo "presets factory-mind-map: not present at this commit (no pdk-factory)" | tee -a "$OUT/shots-final.log" ;;
--*) echo "unknown step: $1" >&2; exit 2 ;;
*)
  OUT=${1:?usage: shots-final.sh <out dir> [theme...]}; shift
  mkdir -p "$OUT"; OUT=$(cd "$OUT" && pwd -P)
  THEMES=${*:-light dark moshi}
  short=${PDK_SHORT:-f$$}
  case $short in *[!a-z0-9]*|'') echo "PDK_SHORT: [a-z0-9]+ only" >&2; exit 2 ;; esac
  S=/tmp/pdk-$short
  [ -e "$S" ] && { echo "$S exists: pick another PDK_SHORT" >&2; exit 2; }
  PY=/usr/bin/python3
  sb() { "$TEST/sandbox.sh" "$short" "$@"; }
  log() { echo "$*" | tee -a "$OUT/shots-final.log"; }
  APP_PID=
  # Quit the app, then the sandbox Core (waiting on its processes, not on hc, which would start it again), then
  # box's Core; the sandbox goes only when nothing runs under it.
  stop_all() {
    trap - EXIT INT TERM
    sb herdr-app do app.quit >/dev/null 2>&1 || true
    [ -n "$APP_PID" ] && for _ in $(seq 1 20); do kill -0 "$APP_PID" 2>/dev/null || break; sleep 1; done
    pids=$(sb hc server status --json 2>/dev/null | $PY -I -S -c '
import json, sys
d = json.load(sys.stdin); out = []
def walk(o):
    if isinstance(o, dict):
        for k, v in o.items():
            if k.endswith("pid") and isinstance(v, int): out.append(v)
            else: walk(v)
    elif isinstance(o, list):
        for v in o: walk(v)
walk(d); print(d.get("core", {}).get("id", "?"), *out)' 2>/dev/null || true)
    if [ -n "$pids" ]; then
      log "stopping sandbox core ${pids%% *}"; sb hc server stop >/dev/null 2>&1 || true
      for p in ${pids#* }; do for _ in $(seq 1 30); do kill -0 "$p" 2>/dev/null || break; sleep 1; done; done
    fi
    PDK_SANDBOX=$S sh "$TEST/machine.sh" stop | tee -a "$OUT/shots-final.log"
    # The app's helpers (a usage read) may still be finishing after it quit.
    for _ in $(seq 1 15); do pgrep -f "pdk-$short" >/dev/null || break; sleep 1; done
    if pgrep -fl "pdk-$short" >/dev/null; then log "left running under $S (not removed):"; pgrep -fl "pdk-$short" | tee -a "$OUT/shots-final.log"
    else rm -rf "/tmp/pdk-${short:?}"; log "sandbox $S removed"; fi
  }
  trap stop_all EXIT
  trap 'exit 130' INT TERM

  # The commit, for the log and the sheets (PDK_REV names it when the checkout is an export, not a git tree).
  rev=$(git -C "$TEST" rev-parse --short HEAD 2>/dev/null || echo "${PDK_REV:-unknown}")
  log "shots-final: $rev $(date -u +%FT%TZ), sandbox $S, themes: $THEMES"
  sb sh -c '"$1" "$HERDR_APP_HOME"' install "$(dirname "$TEST")/install.sh" >/dev/null
  $PY -I -S -c '
import json, sys
h = sys.argv[1]
for f, v in (("shared.json", {"frame.welcomed": "0.1.14"}), ("update-notes.json", {"last_run": "0.1.14", "presented": []})):
    json.dump(v, open(f"{h}/{f}", "w"))
p = f"{h}/settings.json"
try: s = json.load(open(p))
except Exception: s = {}
s["appearance"] = "light"; json.dump(s, open(p, "w"), indent=2)' "$S/home"
  sb sh -c 'exec "$APP"' > "$S/app.log" 2>&1 &
  APP_PID=$!
  for _ in $(seq 1 40); do sb herdr-app status >/dev/null 2>&1 && break; sleep 1; done
  sb "$TEST/shots-final.sh" --scene
  # The media scene draws its 4 s clip with ffmpeg when it can (PDK_ALLOW links that one program for this run).
  if command -v ffmpeg >/dev/null; then PDK_ALLOW=ffmpeg sb "$TEST/media-scene.sh" >/dev/null; else sb "$TEST/media-scene.sh" >/dev/null; log "scene: no ffmpeg, so no video clip"; fi
  for sc in code-scene interactions-scene; do
    if [ -f "$TEST/$sc.sh" ]; then sb "$TEST/$sc.sh" >/dev/null; log "scene: $sc.sh"; else log "scene: $sc.sh not present at this commit"; fi
  done
  sb "$TEST/shots-final.sh" --settle | tee -a "$OUT/shots-final.log"
  for th in $THEMES; do
    sb "$TEST/shots-final.sh" --shoot "$OUT" "$th"
    $PY "$TEST/final-sheet.py" crops "$OUT/$th" "$th" >/dev/null
    $PY "$TEST/final-sheet.py" sheet "$OUT/sheet-$th.png" "tremor final set, $th, $rev" "$OUT/$th"/crops/*.png >/dev/null
    log "$th: $(wc -l < "$OUT/$th/manifest.tsv" | tr -d ' ') crops, sheet-$th.png"
  done
  if [ "${PDK_PRESETS:-1}" != 0 ]; then
    sb "$TEST/shots-final.sh" --presets "$OUT"
    $PY "$TEST/final-sheet.py" sheet "$OUT/sheet-presets.png" "tremor presets, $rev" "$OUT"/presets/*.png >/dev/null
    log "presets: $(ls "$OUT"/presets/*.png | wc -l | tr -d ' ') frames, sheet-presets.png"
    if [ -s "$OUT/presets/factory/manifest.tsv" ]; then
      $PY "$TEST/final-sheet.py" crops "$OUT/presets/factory" factory >/dev/null
      $PY "$TEST/final-sheet.py" sheet "$OUT/sheet-presets-factory.png" "tremor presets, factory mind map, $rev" "$OUT"/presets/factory/*.png >/dev/null
      log "presets: $(wc -l < "$OUT/presets/factory/manifest.tsv" | tr -d ' ') factory frames and crops, sheet-presets-factory.png"
    fi
  fi ;;
esac
