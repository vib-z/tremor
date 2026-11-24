#!/bin/sh
# Builds the screenshot scene in a running sandbox window, through the app's own commands only.
# Run it inside the sandbox environment:  modpack/test/sandbox.sh <short> modpack/test/scene.sh
#
# Agents here are test doubles: bin/claude and bin/codex in the sandbox start fake-agent.py, a plain program
# that prints OSC 7501 reports and copies the captured fixtures into the scratch HOME. No model, no agent.
set -eu
: "${PDK_SANDBOX:?run through modpack/test/sandbox.sh}"
S=$PDK_SANDBOX
TEST=$(cd "$(dirname "$0")" && pwd -P)

# The test doubles, named like the agents so Core sees a real launch's argv (argv[0] claude or codex).
for kind in claude codex; do
  cat > "$S/bin/$kind" <<EOF
#!/bin/bash
exec -a $kind /usr/bin/python3 -I -S "$TEST/fake-agent.py" --as $kind "\$@"
EOF
  chmod +x "$S/bin/$kind"
done
touch "$HOME/.zshrc"
# An agent with no structured transcript: the system's sleep, run under the name cursor-agent (a symlink keeps
# its signature; Core reports the name it was started as).
ln -sf /bin/sleep "$S/bin/cursor-agent"

# A fleet job folder in the scratch HOME, as herdr-fleet writes one (plan lanes and an inbox).
JOB="$HOME/code/jobs/jobs/demo-job"
mkdir -p "$JOB"
cat > "$JOB/plan.md" <<'EOF'
# Demo job

| lane | agent | owns |
|---|---|---|
| research-mods | Codex | the mod API table |
| research-chat | Claude | chat formats |
| build | Claude | the pack |
EOF
printf 'REPORT research-chat reports/research-chat.md\nTURN research-mods\n' > "$JOB/inbox.log"

W1=$S/work/core-client; W2=$S/work/evals
mkdir -p "$W2"
# core-client is a real git checkout with an upstream: two commits ahead, one behind, and an edit not committed,
# so the tree's branch, ahead/behind and dirty markers show real git answers. Config is per command (-c), so no
# git config file is written anywhere.
g() { git -c user.name=pdk -c user.email=pdk@example.invalid -c init.defaultBranch=main -c commit.gpgsign=false "$@"; }
g init -q "$S/work/origin" && g -C "$S/work/origin" commit -q --allow-empty -m base
g clone -q "$S/work/origin" "$W1" && g -C "$W1" checkout -q -b feat/machines --track origin/main
g -C "$S/work/origin" commit -q --allow-empty -m upstream
g -C "$W1" commit -q --allow-empty -m one && g -C "$W1" commit -q --allow-empty -m two && g -C "$W1" fetch -q
echo draft > "$W1/notes.md"
do_() { herdr-app do "$@"; }
id_of() { python3 -I -S -c 'import json,sys; print(json.load(sys.stdin)[sys.argv[1]])' "$1"; }

# Workspace 1: a working lead with two workers and in-process records; a review tab split with a shell.
r=$(do_ space.new --name core-client --folder "$W1" --tab lead --argv '["claude","--model","claude-haiku-5-5","--setting-sources","project,local","--pdk-name","lead1","--pdk-state","working","--pdk-title","Build the mod pack"]')
lead=$(printf '%s' "$r" | id_of terminal); space1=$(printf '%s' "$r" | id_of space)
sleep 2
hc label "$lead" stampede.job=demo-job stampede.agent=build >/dev/null
mkdir -p "$S/ctl"
printf 'spawn research-mods codex Mod API table\nspawn research-chat claude Chat formats\nrecord r1 working Explore the tree mod\nrecord r1/r2 idle Read AGENTS.md\nblocked permission Bash wants to run: rm -rf build/ (outside the allowed folders)\n' >> "$S/ctl/lead1"
r=$(do_ tab.new --space "$space1" --name review --folder "$W1" --argv '["codex","--no-daemon","--pdk-name","review","--pdk-state","done","--pdk-title","Review the plan","--pdk-thread","0b2c8d10-5a1e-4c7e-9d2f-3e4a5b6c7d8e"]')
term=$(printf '%s' "$r" | id_of terminal)
sleep 1
pane=$(herdr-app ls | python3 -I -S -c 'import json,sys; t=sys.argv[1]; print([x["pane"] for s in json.load(sys.stdin)["spaces"] for b in s["tabs"] for x in b["terminals"] if x["terminal"]==t][0])' "$term")
do_ pane.split --direction right --pane "$pane" >/dev/null

do_ tab.new --space "$space1" --name cursor --folder "$W1" --argv '["cursor-agent","7200"]' >/dev/null

# Workspace 2: an idle lead (settle allowed) and a tab split across two folders.
do_ space.new --name evals --folder "$W2" --tab lead --argv '["claude","--model","claude-haiku-5-5","--pdk-name","lead2","--pdk-state","idle","--pdk-title","Eval harness"]' >/dev/null
sleep 1
space2=$(herdr-app ls | python3 -I -S -c 'import json,sys; print([s["id"] for s in json.load(sys.stdin)["spaces"] if s["name"]=="evals"][0])')
r=$(do_ tab.new --space "$space2" --name checks --folder "$W2")
term=$(printf '%s' "$r" | id_of terminal)
sleep 1
pane=$(herdr-app ls | python3 -I -S -c 'import json,sys; t=sys.argv[1]; print([x["pane"] for s in json.load(sys.stdin)["spaces"] for b in s["tabs"] for x in b["terminals"] if x["terminal"]==t][0])' "$term")
mkdir -p "$W2/sub"
do_ pane.focus --pane "$pane" >/dev/null
do_ terminal.open --folder "$W2/sub" --place right >/dev/null
sleep 2

# Workspace 3, on the second machine ("box", machine.sh: a private Core under $S/mb, no SSH) when it was added:
# a done Codex lead and a split shell tab. The test doubles reach it through its own bin folder.
if hc machine ls --json | grep -q '"name":"box"'; then
  M=$S/mb; WB=$M/u/infra
  mkdir -p "$WB"
  for kind in claude codex; do ln -sf "$S/bin/$kind" "$M/bin/$kind"; done
  do_ space.new --machine box --name infra --folder "$WB" --tab deploy --argv '["codex","--no-daemon","--pdk-name","deploy","--pdk-state","done","--pdk-title","Ship the build"]' >/dev/null
  sleep 2
  space3=$(herdr-app ls | python3 -I -S -c 'import json,sys; print([s["id"] for s in json.load(sys.stdin)["spaces"] if s["name"]=="infra"][0])')
  r=$(do_ tab.new --space "$space3" --name logs --folder "$WB")
  term=$(printf '%s' "$r" | id_of terminal)
  sleep 1
  pane=$(herdr-app ls | python3 -I -S -c 'import json,sys; t=sys.argv[1]; print([x["pane"] for s in json.load(sys.stdin)["spaces"] for b in s["tabs"] for x in b["terminals"] if x["terminal"]==t][0])' "$term")
  do_ pane.split --direction right --pane "$pane" >/dev/null
  sleep 1
fi
do_ space.select --id "$space1" >/dev/null
herdr-app ls
