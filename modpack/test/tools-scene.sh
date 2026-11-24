#!/bin/sh
# The tool-call scene, in a running sandbox window, through app commands only. FIXTURES: Claude test doubles
# (fake-agent.py, no model) whose transcripts tools-fixture.py writes: every tool family, and a 300-call thread.
#   modpack/test/sandbox.sh <short> modpack/test/tools-scene.sh
set -eu
: "${PDK_SANDBOX:?run through modpack/test/sandbox.sh}"
S=$PDK_SANDBOX
TEST=$(cd "$(dirname "$0")" && pwd -P)
cat > "$S/bin/claude" <<EOF
#!/bin/bash
exec -a claude /usr/bin/python3 -I -S "$TEST/fake-agent.py" --as claude "\$@"
EOF
chmod +x "$S/bin/claude"
touch "$HOME/.zshrc"
W=$S/work/tools
mkdir -p "$W/src"
RW=$(cd "$W" && pwd -P)
KEY=$(/usr/bin/python3 -I -S -c 'import sys; print("".join(c if c.isascii() and c.isalnum() else "-" for c in sys.argv[1]))' "$RW")
D="$HOME/.claude/projects/$KEY"
mkdir -p "$D"
/usr/bin/python3 -I -S "$TEST/tools-fixture.py" "$D/7001c0de-0000-4c43-9a8e-1f0e2d3c4b5a.jsonl" "$RW" >/dev/null
/usr/bin/python3 -I -S "$TEST/tools-fixture.py" "$D/7001c0de-0300-4c43-9a8e-1f0e2d3c4b5a.jsonl" "$RW" 300 >/dev/null
sed -i '' 's/7001c0de-0000-4c43/7001c0de-0300-4c43/g' "$D/7001c0de-0300-4c43-9a8e-1f0e2d3c4b5a.jsonl"
id_of() { /usr/bin/python3 -I -S -c 'import json,sys; print(json.load(sys.stdin)[sys.argv[1]])' "$1"; }
argv() { printf '["claude","--session-id","7001c0de-%s-4c43-9a8e-1f0e2d3c4b5a","--pdk-name","%s","--pdk-state","done","--pdk-title","Tool fixture"]' "$1" "$2"; }
r=$(herdr-app do space.new --name tools --folder "$W" --tab calls --argv "$(argv 0000 tcalls)")
space=$(printf '%s' "$r" | id_of space)
sleep 1
herdr-app do tab.new --space "$space" --name long --folder "$W" --argv "$(argv 0300 tlong)" >/dev/null
sleep 2
herdr-app ls >/dev/null && echo scene ready
