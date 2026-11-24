#!/bin/sh
# The media lane's scene, in a running sandbox window, through app commands only. FIXTURES: test doubles
# (fake-agent.py, no model) whose transcripts are built by media-fixture.py from the verified Claude and Codex
# samples, naming media it draws under $PDK_SANDBOX/media.
#   modpack/test/sandbox.sh <short> modpack/test/media-scene.sh
set -eu
: "${PDK_SANDBOX:?run through modpack/test/sandbox.sh}"
S=$PDK_SANDBOX
TEST=$(cd "$(dirname "$0")" && pwd -P)
for kind in claude codex; do
  cat > "$S/bin/$kind" <<EOF
#!/bin/bash
exec -a $kind /usr/bin/python3 -I -S "$TEST/fake-agent.py" --as $kind "\$@"
EOF
  chmod +x "$S/bin/$kind"
done
touch "$HOME/.zshrc"

W=$S/work/media
mkdir -p "$W"
RW=$(cd "$W" && pwd -P)
THREAD=01a1bd47-77aa-7bb0-9cc1-0d1e2f3a4b5c
KEY=$(/usr/bin/python3 -I -S -c 'import sys; print("".join(c if c.isascii() and c.isalnum() else "-" for c in sys.argv[1]))' "$RW")
CT="$S/fixture/claude.jsonl"
XT="$HOME/.codex/sessions/2026/11/08/rollout-2026-11-08T22-28-54-$THREAD.jsonl"
PDK_FIXTURE_THREAD=$THREAD /usr/bin/python3 -I -S "$TEST/media-fixture.py" "$S/media" "$CT" "$XT" "$RW" >/dev/null

# A long chat opens at its top in this build, so the Claude fixture is shown as three sessions (three tabs): the
# prompts with pasted images, the tool work, the answer. The same records, split by line.
/usr/bin/python3 -I -S -c '
import json, os, sys
src, out = sys.argv[1], sys.argv[2]
new = [l for l in open(src).read().splitlines() if json.loads(l).get("timestamp", "").startswith("2026-11-09")]
os.makedirs(out, exist_ok=True)
for sid, part in (("0000", new[0:3]), ("1111", new[3:7]), ("2222", new[7:])):
    open(os.path.join(out, f"5d0c3a51-{sid}-4c43-9a8e-1f0e2d3c4b5a.jsonl"), "w").write("".join(l + "\n" for l in part))
' "$CT" "$HOME/.claude/projects/$KEY"

id_of() { /usr/bin/python3 -I -S -c 'import json,sys; print(json.load(sys.stdin)[sys.argv[1]])' "$1"; }
claude_argv() { printf '["claude","--session-id","5d0c3a51-%s-4c43-9a8e-1f0e2d3c4b5a","--pdk-name","%s","--pdk-state","done","--pdk-title","Media fixture"]' "$1" "$2"; }
r=$(herdr-app do space.new --name media --folder "$W" --tab pasted --argv "$(claude_argv 0000 mpasted)")
space=$(printf '%s' "$r" | id_of space)
sleep 1
herdr-app do tab.new --space "$space" --name tools --folder "$W" --argv "$(claude_argv 1111 mtools)" >/dev/null
herdr-app do tab.new --space "$space" --name answer --folder "$W" --argv "$(claude_argv 2222 manswer)" >/dev/null
herdr-app do tab.new --space "$space" --name codex --folder "$W" --argv "[\"codex\",\"--no-daemon\",\"--pdk-name\",\"mcodex\",\"--pdk-state\",\"idle\",\"--pdk-thread\",\"$THREAD\"]" >/dev/null
sleep 2
herdr-app ls >/dev/null && echo scene ready
