#!/bin/sh
# The chat feed live, with the test doubles (no model): adapters/feed.js and shared/chat-call.js over the real
# helper (helper/pdk-chat.py), on the sandbox's own machine and on box (test/machine.sh), for Claude and Codex.
#
#   modpack/test/sandbox.sh <short> modpack/test/chat-live.sh
#
# Rows (test/chat-live.js prints PASS or FAIL for each, with the measured times): the probe binds; a line appended
# while a tail waits comes back in under a second; /clear (Claude) or /new (Codex) in the same process answers
# rebind and binds the new session; on box, with its Core stopped and its route cut, the call rejects as offline,
# and once box is back the read goes on from the cursor with nothing lost or doubled; an idle shown chat's helper
# runs per 10 s; media on box (an image, a video, a PDF, an inline image) comes back as previews in this sandbox's
# preview cache, a missing file says missing, a text file is refused, a video's original comes back byte for byte,
# and box's temp folder is left as it was.
#
# The doubles run as plain processes in each machine's own HOME (box: $PDK_SANDBOX/mb/u), not in Core terminals, so
# a stopped box Core doesn't end them: what drops is the route, as when a remote machine goes away and comes back.
# Each reads its typed lines from a fifo this script holds open. Core is only the route: a call with `on` goes
# through `hc exec --on box`, the same Core exec the app's exec({ on }) uses. Everything stays under $PDK_SANDBOX.
set -eu
: "${PDK_SANDBOX:?run through modpack/test/sandbox.sh}"
S=$PDK_SANDBOX
TEST=$(cd "$(dirname "$0")" && pwd -P)
PACK=$(dirname "$TEST")
BUN=${PDK_BUN:-/Users/$USER/.bun/bin/bun}
L=$S/live
M=$S/mb

sh "$TEST/machine.sh" add box >/dev/null
mkdir -p "$S/home/pdk/helper" "$L"
cp "$PACK/helper/pdk-chat.py" "$PACK/helper/pdk-helper.py" "$S/home/pdk/helper/"
# Box's media (round 2): an image and a PDF drawn by test/media-fixture.py, a 2 s clip when ffmpeg is installed here,
# and a text file (not an allowed kind).
MB=$M/u/media
mkdir -p "$MB"
/usr/bin/python3 -I -S -c 'import runpy, sys; m = runpy.run_path(sys.argv[1]); d = sys.argv[2]
m["png"](d + "/shot.png", 1600, 1000, rows=m["gradient"](1600, 1000, (34, 139, 230), (190, 75, 219))); m["pdf"](d + "/report.pdf")' "$TEST/media-fixture.py" "$MB"
FFMPEG=/opt/homebrew/bin/ffmpeg
[ -x "$FFMPEG" ] && "$FFMPEG" -hide_banner -loglevel error -y -f lavfi -i testsrc2=size=1280x720:rate=25 -t 2 -pix_fmt yuv420p -c:v libx264 "$MB/clip.mp4"
echo "not media" > "$MB/notes.txt"

# One double: a fifo for its typed lines (held open here on fd $3, so it never reads an end of file), then the
# process, in that machine's HOME and a folder of its own.
double() {
  where=$1 kind=$2 fd=$3
  d=$L/$where-$kind
  rm -rf "$d"; mkdir -p "$d/w"; mkfifo "$d/in"
  eval "exec $fd<>\"\$d/in\""
  if [ "$where" = box ]; then
    set -- env -i HOME="$M/u" PATH=/usr/bin:/bin:/usr/sbin:/sbin LANG=en_GB.UTF-8 PDK_SANDBOX="$M"
  else
    set -- env
  fi
  extra=; [ "$kind" = codex ] && extra=--no-daemon
  (cd "$d/w" && exec "$@" /usr/bin/python3 -I -S "$TEST/fake-agent.py" --as "$kind" $extra --pdk-name "$where-$kind" <"$d/in" >"$d/out" 2>&1) &
  echo $! >"$d/pid"
}
double here claude 3
double here codex 4
double box claude 5
double box codex 6
sleep 1

status=0
PDK_LIVE="$L" PDK_APP_HOME="$S/home" PDK_BOX_HOME="$M/u" "$BUN" "$TEST/chat-live.js" || status=$?

for d in "$L"/*/; do kill "$(cat "$d/pid")" 2>/dev/null || true; done
exit $status
