#!/bin/sh
# The Factory Map's sandbox scene: two fleet jobs as Core-native spaces, 22 stand-in agents with real Core parent
# links (hc run --bg --parent), one needing you (a permission block), and a plain shell pane that is not an agent.
# The tree is the approved mockups' (assets/factory-map-1114): stampede-restructure, a working lead and 5 helpers
# (+ ship-notes, blocked); watch-agent-controller (branch master), an idle lead, 2 helpers and 3 sub-leads of 3.
# Plus a relay job on a second machine, studio-mac (machine.sh, a private Core through --via): the shape of the
# owner's stampede-restructure-1113, a stampede.role=lead and 3 workers with NO Core parent, each in its own tab named
# after it, all labelled with one stampede.job, and the job's relay (stampede.role=relay, no herdr.space).
#
#   modpack/test/map-scene.sh up              install this checkout's pack, open the app on tremor, start the tree
#   modpack/test/map-scene.sh status          the tree as Core and the app see it
#   modpack/test/map-scene.sh set <name> <state> [msg]   working | idle | done | error | blocked: live status change
#   modpack/test/map-scene.sh sync            copy the pack into the running sandbox (dev-sync.sh: hot reload)
#   modpack/test/map-scene.sh down            quit the app, stop the sandbox Core, wait on their pids (no rm)
#
# PDK_SHORT names the sandbox (default fmap: /tmp/pdk-fmap). PDK_VIEW=<w>x<h> sets the Factory view's size before
# `up` (default 1440x900; the window adds tremor's 280 pt sidebar). PDK_PACK=<a modpack dir> installs that pack
# instead of this checkout's (e.g. a `git archive` of main, so a builder's edits in the worktree stay out). Stand-ins only (map-agent.py over fake-agent.py).
set -eu
TEST=$(cd "$(dirname "$0")" && pwd -P)
short=${PDK_SHORT:-fmap}
S=/tmp/pdk-$short
PY=/usr/bin/python3
[ -n "${PDK_SANDBOX:-}" ] && S=$PDK_SANDBOX
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

# name | parent | job | tab | kind | state | message
TREE='lead-demo-tree||stampede-restructure|main|claude|working|v0.2.3 · #60 and #61 in review
review-tree-shell|lead-demo-tree|stampede-restructure|review|codex|working|reviewing the tree shell
build-tree-shell|lead-demo-tree|stampede-restructure|build|claude|working|building the tree shell
fix-onesource|lead-demo-tree|stampede-restructure|fix|claude|working|fixing one source
review-onesource|lead-demo-tree|stampede-restructure|review|codex|working|reviewing one source
build-tabs-config|lead-demo-tree|stampede-restructure|build|claude|idle|tabs config built
ship-notes|lead-demo-tree|stampede-restructure|ship|claude|blocked|Bash wants to run: git push origin HEAD
lead-repod-watch-core||watch-agent-controller|main|claude|idle|RESULT.md done · Codex review running
design-states|lead-repod-watch-core|watch-agent-controller|design|claude|idle|Delivered the watch-states mockup and design report
review-result|lead-repod-watch-core|watch-agent-controller|review|codex|idle|review written
research-moshi|lead-repod-watch-core|watch-agent-controller|moshi|claude|working|writing Moshi report
acp|research-moshi|watch-agent-controller|moshi|claude|idle|ACP notes done
local|research-moshi|watch-agent-controller|moshi|claude|idle|local models done
custom|research-moshi|watch-agent-controller|moshi|claude|idle|custom agents done
research-voice|lead-repod-watch-core|watch-agent-controller|voice|claude|idle|voice report done
watchos|research-voice|watch-agent-controller|voice|claude|idle|watchOS notes done
priorart|research-voice|watch-agent-controller|voice|claude|idle|prior art done
hacks|research-voice|watch-agent-controller|voice|claude|idle|hacks done
research-micro|lead-repod-watch-core|watch-agent-controller|micro|codex|idle|micro report done
repod|research-micro|watch-agent-controller|micro|codex|idle|repod notes done
x|research-micro|watch-agent-controller|micro|codex|idle|x notes done
devices|research-micro|watch-agent-controller|micro|codex|idle|devices notes done'
# The relay job on studio-mac (names, roles, tabs and labels as the owner's real one; build-relay-config needs you):
# name | role | kind | state | message
RELAY_JOB=hc-5a4f5e1c9038 RELAY_SPACE=stampede-5a4f5e1c9038 RELAY_NAME=stampede-restructure-1113 MACHINE=studio-mac
RELAY='lead-demo-restructure|lead|claude|done|PR #62 review: 8 fixes briefed to builder; v0.2.3 held
review-backend-tui|worker|codex|idle|review of the backend TUI written
build-backend-tui|worker|claude|working|building the backend TUI
build-relay-config|worker|claude|blocked|Bash wants to run: git push origin relay-config'

case ${1:-} in
--tree)
  # Inside the sandbox: the test doubles, the two job folders, then every agent with hc run (parents first).
  : "${PDK_SANDBOX:?run through modpack/test/sandbox.sh}"
  for kind in claude codex; do
    printf '#!/bin/bash\nexec -a %s /usr/bin/python3 -I -S "%s/map-agent.py" --as %s "$@"\n' "$kind" "$TEST" "$kind" > "$S/bin/$kind"
    chmod +x "$S/bin/$kind"
  done
  g() { git -c user.name=pdk -c user.email=pdk@example.invalid -c init.defaultBranch=master -c commit.gpgsign=false "$@"; }
  W=$S/work
  if [ ! -d "$W/watch-agent-controller/.git" ]; then
    g init -q "$W/watch-agent-controller" && g -C "$W/watch-agent-controller" commit -q --allow-empty -m base
    # The mockup's "detached": a checkout of a commit, not a branch.
    g init -q "$W/stampede-restructure" && g -C "$W/stampede-restructure" commit -q --allow-empty -m base
    g -C "$W/stampede-restructure" checkout -q --detach
  fi
  mkdir -p "$S/ctl"
  printf '%s\n' "$TREE" | while IFS='|' read -r name parent job tab kind state msg; do
    set -- --json --bg --keep --no-notify --name "$name" --cwd "$W/$job" \
      --label "herdr.space=$job" --label "herdr.tab=${job%%-*}-$tab" \
      --label "stampede.job=$job" --label "stampede.agent=$name" --label "stampede.kind=$kind" \
      --label "stampede.role=$([ -n "$parent" ] && echo helper || echo lead)"
    [ -n "$parent" ] && set -- "$@" --parent "$(cat "$S/ctl/$parent.t")"
    first=$state; [ "$state" = blocked ] && first=working
    set -- "$@" -- "$kind" --pdk-name "$name" --pdk-state "$first" --pdk-title "$msg" --pdk-msg "$msg"
    [ "$kind" = codex ] && set -- "$@" --no-daemon --pdk-thread "$(uuidgen | tr A-Z a-z)"
    hc run "$@" | $PY -I -S -c 'import json,sys; print(json.load(sys.stdin)["address"])' > "$S/ctl/$name.t"
    [ "$state" = blocked ] && printf 'blocked permission %s\n' "$msg" >> "$S/ctl/$name"
    echo "$name $(cat "$S/ctl/$name.t") ${parent:+<- $parent} $state"
  done
  # A plain shell in the second job: a pane the Map must not show.
  hc run --json --bg --keep --no-notify --name shell --cwd "$W/watch-agent-controller" \
    --label herdr.space=watch-agent-controller --label herdr.tab=watch-shell -- /bin/zsh -i > /dev/null
  sleep 3
  # Tab ids are unique per Core (a second job's "main" joins the first's), so they carry the job's first word; the
  # app shows unknown ids under Herdr's names, so each space and tab is renamed to its plain name.
  for job in stampede-restructure watch-agent-controller; do herdr-app do space.rename --id "$job" --name "$job" > /dev/null; done
  printf '%s\nx||watch-agent-controller|shell\n' "$TREE" | while IFS='|' read -r _ _ job tab _; do
    herdr-app do tab.rename --id "${job%%-*}-$tab" --name "$tab" > /dev/null; done
  # The relay job, on studio-mac. Its Core has its own PATH and env, so each agent goes through /usr/bin/env with
  # PDK_SANDBOX (the control files) and the double's absolute path (a bare `claude` there could be the real one).
  "$TEST/machine.sh" add "$MACHINE" > /dev/null
  mkdir -p "$W/$RELAY_NAME"
  hc run --json --bg --no-notify --on "$MACHINE" --name "relay-${RELAY_JOB#hc-}" --cwd "$W/$RELAY_NAME" \
    --label "stampede.agent=relay-${RELAY_JOB#hc-}" --label "stampede.job=$RELAY_JOB" --label stampede.role=relay \
    -- /bin/sh -c 'exec sleep 86400' | $PY -I -S -c 'import json,sys; print(json.load(sys.stdin)["address"])' > "$S/ctl/relay.t"
  printf '%s\n' "$RELAY" | while IFS='|' read -r name role kind state msg; do
    first=$state; [ "$state" = blocked ] && first=working
    set -- --json --bg --keep --no-notify --on "$MACHINE" --name "$name" --cwd "$W/$RELAY_NAME" \
      --label "herdr.space=$RELAY_SPACE" --label "herdr.tab=$name" \
      --label "stampede.job=$RELAY_JOB" --label "stampede.agent=$name" --label "stampede.role=$role" \
      -- /usr/bin/env PDK_SANDBOX="$S" "$S/bin/$kind" --pdk-name "$name" --pdk-state "$first" --pdk-title "$msg" --pdk-msg "$msg"
    [ "$kind" = codex ] && set -- "$@" --no-daemon --pdk-thread "$(uuidgen | tr A-Z a-z)"
    hc run "$@" | $PY -I -S -c 'import json,sys; print(json.load(sys.stdin)["address"])' > "$S/ctl/$name.t"
    [ "$state" = blocked ] && printf 'blocked permission %s\n' "$msg" >> "$S/ctl/$name"
    echo "$name $(cat "$S/ctl/$name.t") ($role, no parent) $state"
  done
  sleep 3
  herdr-app ls | $PY -I -S -c '
import json, sys
for s in json.load(sys.stdin)["spaces"]:
    if s.get("machine"): print(s["id"]); [print("tab", t["id"]) for t in s["tabs"]]' | while read -r a b; do
    case $a in tab) herdr-app do tab.rename --id "$b" --name "${b##*/}" > /dev/null ;;
      *) herdr-app do space.rename --id "$a" --name "$RELAY_NAME" > /dev/null ;; esac
  done
  ;;
--status)
  : "${PDK_SANDBOX:?run through modpack/test/sandbox.sh}"
  hc ls --json | $PY -I -S -c '
import json, sys
ts = json.load(sys.stdin)["terminals"]
name = {t["address"]: t.get("name") for t in ts}
for t in ts:
    print("%5s %-34s %-24s %-8s <- %s" % (t["address"], t.get("where", "?"), t.get("name") or "", t.get("status") or "-", name.get(t.get("parent"), "")))
agents = [t for t in ts if t.get("status")]
print(len(agents), "agents,", len(ts) - len(agents), "other terminals")'
  herdr-app ls | $PY -I -S -c '
import json, sys
for s in json.load(sys.stdin)["spaces"]:
    print("app:", s["name"], "·", sum(len(t["terminals"]) for t in s["tabs"]), "panes in", len(s["tabs"]), "tabs:", ", ".join(t["name"] or "?" for t in s["tabs"]))'
  ;;
up)
  [ -e "$S" ] && { echo "$S exists (an earlier run): use another PDK_SHORT, or ask the owner to remove it"; exit 1; }
  sb true
  sb sh -c '"$1" "$HERDR_APP_HOME"' install "${PDK_PACK:-$(dirname "$TEST")}/install.sh" > /dev/null
  view=${PDK_VIEW:-1440x900}
  $PY -I -S - "$S/home" "${view%x*}" "${view#*x}" <<'PY'
import json, sys
h, w, ht = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
for f, v in (("shared.json", {"frame.welcomed": "0.1.15"}), ("update-notes.json", {"last_run": "0.1.15", "presented": []}),
             ("window.json", {"state": "windowed", "bounds": [0, 0, max(480, w + 280), ht]})):
    json.dump(v, open(f"{h}/{f}", "w"))
p = f"{h}/settings.json"
try: s = json.load(open(p))
except Exception: s = {}
s["appearance"] = "dark"; json.dump(s, open(p, "w"), indent=2)
PY
  launch
  sb herdr-app do layout.switch --name tremor > /dev/null
  sb "$TEST/map-scene.sh" --tree
  sleep 2
  sb "$TEST/map-scene.sh" --status
  echo "up: $S (app log $S/app.log)" ;;
status) sb "$TEST/map-scene.sh" --status ;;
set)
  name=${2:?name}; state=${3:?state}
  [ -f "$S/ctl/$name.t" ] || { echo "no agent $name in $S" >&2; exit 2; }
  [ -n "${4:-}" ] && printf 'msg %s\n' "$4" >> "$S/ctl/$name"
  case $state in
    blocked) printf 'blocked permission %s\n' "${4:-Bash wants to run a command}" >> "$S/ctl/$name" ;;
    working|idle|done|error) printf '%s\n' "$state" >> "$S/ctl/$name" ;;
    *) echo "state: working | idle | done | error | blocked" >&2; exit 2 ;;
  esac
  sleep 1
  sb hc get "$(cat "$S/ctl/$name.t")" --json | $PY -I -S -c 'import json,sys; d=json.load(sys.stdin); print(d["name"], (d.get("status") or {}).get("state"))' ;;
sync) "$TEST/dev-sync.sh" "$S/home" ;;
down)
  quit
  # The sandbox Core's pids first: after `hc server stop` any hc call starts it again, so wait on pids.
  [ -d "$S/state" ] && pids=$(sb hc server status --json 2>/dev/null | $PY -I -S -c '
import json, sys
out = []
def walk(o):
    if isinstance(o, dict):
        for k, v in o.items():
            if k.endswith("pid") and isinstance(v, int): out.append(v)
            else: walk(v)
    elif isinstance(o, list):
        for v in o: walk(v)
walk(json.load(sys.stdin)); print(*out)' 2>/dev/null || true)
  sb "$TEST/machine.sh" stop || true
  sb hc server stop > /dev/null 2>&1 || true
  for p in ${pids:-}; do for _ in $(seq 1 30); do kill -0 "$p" 2>/dev/null || break; sleep 1; done; done
  left=$(pgrep -fl "pdk-$short" || true)
  [ -n "$left" ] && { echo "still running under $S:"; echo "$left"; }
  echo "down. Left in place (not removed): $S" ;;
*) sed -n 2,14p "$0"; exit 2 ;;
esac
