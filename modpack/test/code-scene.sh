#!/bin/sh
# The code view's scene (owner, inputs-moshi-code-view-2257.png), in a running sandbox window, through app commands
# only. FIXTURES: test doubles (fake-agent.py, no model) whose transcripts code-fixture.py builds from the verified
# Claude and Codex samples: Claude writes two briefs and edits one, Codex changes a file and adds one.
#   modpack/test/sandbox.sh <short> modpack/test/code-scene.sh
set -eu
: "${PDK_SANDBOX:?run through modpack/test/sandbox.sh}"
S=$PDK_SANDBOX
TEST=$(cd "$(dirname "$0")" && pwd -P)
for kind in claude codex; do
  cat > "$S/bin/$kind" <<EOS
#!/bin/bash
exec -a $kind /usr/bin/python3 -I -S "$TEST/fake-agent.py" --as $kind "\$@"
EOS
  chmod +x "$S/bin/$kind"
done
touch "$HOME/.zshrc"

W=$S/work/code
mkdir -p "$W"
RW=$(cd "$W" && pwd -P)
THREAD=01a1bd47-c0de-7bb0-9cc1-0d1e2f3a4b5c
SID=c0de51a5-0000-4c43-9a8e-1f0e2d3c4b5a
KEY=$(/usr/bin/python3 -I -S -c 'import sys; print("".join(c if c.isascii() and c.isalnum() else "-" for c in sys.argv[1]))' "$RW")
/usr/bin/python3 -I -S "$TEST/code-fixture.py" "$HOME/.claude/projects/$KEY/$SID.jsonl" \
  "$HOME/.codex/sessions/2026/11/08/rollout-2026-11-08T22-28-54-$THREAD.jsonl" "$RW" "$THREAD" >/dev/null

id_of() { /usr/bin/python3 -I -S -c 'import json,sys; print(json.load(sys.stdin)[sys.argv[1]])' "$1"; }
r=$(herdr-app do space.new --name code --folder "$W" --tab briefs --argv "[\"claude\",\"--session-id\",\"$SID\",\"--pdk-name\",\"cbriefs\",\"--pdk-state\",\"done\",\"--pdk-title\",\"Code fixture\"]")
space=$(printf '%s' "$r" | id_of space)
sleep 1
herdr-app do tab.new --space "$space" --name patch --folder "$W" --argv "[\"codex\",\"--no-daemon\",\"--pdk-name\",\"cpatch\",\"--pdk-state\",\"idle\",\"--pdk-thread\",\"$THREAD\"]" >/dev/null
sleep 2
herdr-app ls >/dev/null && echo scene ready
