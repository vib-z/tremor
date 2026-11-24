#!/bin/sh
# Runs one command in the live-test environment (fixes-modpack-live brief): the real HOME, USER, PATH, TERM
# and LANG, so real Claude Code and Codex find their own sign-in; everything Herdr under /tmp/pdk-live: its own
# app home and id, a private Core (HC_SESSION, XDG_STATE_HOME, XDG_RUNTIME_DIR, an empty XDG_CONFIG_HOME, no
# HC_SOCKET). Nothing else from the calling shell passes (no HERDR_* or HC_* of the pane this runs in).
# Telemetry is off for the run (HERDR_TELEMETRY=0, DO_NOT_TRACK=1): nothing about the test is sent.
#   modpack/test/live.sh <cmd> [args...]
set -eu
L=/tmp/pdk-live
mkdir -p "$L/home" "$L/state" "$L/config" "$L/work"
APP=${PDK_APP:-/Users/me/code/jobs/jobs/2026-11-08-demo-core-client-1108/sandbox/app-0.1.14/target/Herdr.app/Contents/MacOS/Herdr}
exec env -i \
  HOME="$HOME" USER="${USER:-$(id -un)}" PATH="$PATH" TERM="${TERM:-xterm-256color}" LANG="${LANG:-en_GB.UTF-8}" \
  HERDR_APP_HOME="$L/home" HERDR_APP_ID=pdk-live \
  HC_SESSION=pdk-live XDG_STATE_HOME="$L/state" XDG_RUNTIME_DIR="$L" XDG_CONFIG_HOME="$L/config" \
  HERDR_TELEMETRY=0 DO_NOT_TRACK=1 \
  PDK_SANDBOX="$L" APP="$APP" \
  "$@"
