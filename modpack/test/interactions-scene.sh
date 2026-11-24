#!/bin/sh
# Owner request 35's scene: three stand-in Claude sessions (fake-agent.py, no model) in one workspace: one asking a
# question, one waiting on a permission, one working (for Stop). Their transcripts come from code-fixture.py.
#   modpack/test/sandbox.sh <short> modpack/test/interactions-scene.sh
set -eu
: "${PDK_SANDBOX:?run through modpack/test/sandbox.sh}"
S=$PDK_SANDBOX
TEST=$(cd "$(dirname "$0")" && pwd -P)
cat > "$S/bin/claude" <<EOS
#!/bin/bash
exec -a claude /usr/bin/python3 -I -S "$TEST/fake-agent.py" --as claude "\$@"
EOS
chmod +x "$S/bin/claude"
touch "$HOME/.zshrc"
W=$S/work/asks
mkdir -p "$W" "$S/ctl"
RW=$(cd "$W" && pwd -P)
KEY=$(/usr/bin/python3 -I -S -c 'import sys; print("".join(c if c.isascii() and c.isalnum() else "-" for c in sys.argv[1]))' "$RW")
ASK=a5c00000-0000-4c43-9a8e-1f0e2d3c4b5a PERM=be4a0000-0000-4c43-9a8e-1f0e2d3c4b5a RUN=40c00000-0000-4c43-9a8e-1f0e2d3c4b5a
/usr/bin/python3 -I -S "$TEST/code-fixture.py" interactions "$HOME/.claude/projects/$KEY/$ASK.jsonl" "$HOME/.claude/projects/$KEY/$PERM.jsonl" "$RW"
cp "$HOME/.claude/projects/$KEY/$PERM.jsonl" "$HOME/.claude/projects/$KEY/$RUN.jsonl"
argv() { printf '["claude","--session-id","%s","--pdk-name","%s","--pdk-state","%s","--pdk-title","%s"]' "$1" "$2" "$3" "$4"; }
id_of() { /usr/bin/python3 -I -S -c 'import json,sys; print(json.load(sys.stdin)[sys.argv[1]])' "$1"; }
r=$(herdr-app do space.new --name asks --folder "$W" --tab ask --argv "$(argv $ASK iask idle 'Theme work')")
space=$(printf '%s' "$r" | id_of space)
sleep 1
herdr-app do tab.new --space "$space" --name perm --folder "$W" --argv "$(argv $PERM iperm idle 'Clean build')" >/dev/null
herdr-app do tab.new --space "$space" --name run --folder "$W" --argv "$(argv $RUN irun working 'Cleaning the build folder')" >/dev/null
sleep 2
echo "blocked question Which preset should I start from?" >> "$S/ctl/iask"
echo "blocked permission Bash command: rm -rf build/ && mkdir build" >> "$S/ctl/iperm"
sleep 1
herdr-app ls >/dev/null && echo scene ready
