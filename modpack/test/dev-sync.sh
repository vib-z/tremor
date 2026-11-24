#!/bin/sh
# Development only: copies the pack's files into a running sandbox home so the app hot-reloads them.
# Refuses anything but /tmp/pdk-*/home. Real installs go through install.sh (which refuses a running window).
set -eu
H=${1:?sandbox app home}
case $(cd "$H" && pwd -P) in /private/tmp/pdk-*/home|/tmp/pdk-*/home) ;; *) echo "dev-sync: sandbox homes only" >&2; exit 1;; esac
P=$(cd "$(dirname "$0")/.." && pwd -P)
cp "$P/layouts/tremor.json" "$H/layouts/"
cp "$P/themes/"pdk-*.json "$H/themes/"
mkdir -p "$H/pdk/themes"; cp "$P/themes/"pdk-*.json "$H/pdk/themes/"
mkdir -p "$H/pdk/icons" "$H/pdk/helper"
cp "$P/icons/"*.svg "$H/pdk/icons/"
cp "$P/helper/"*.py "$H/pdk/helper/"
for m in "$P"/mods/pdk-*; do
  n=$(basename "$m"); mkdir -p "$H/mods/$n/lib"
  cp "$P/adapters/"*.js "$P/shared/"*.js "$H/mods/$n/lib/"
  cp "$m"/*.js "$m"/mod.json "$H/mods/$n/"
done
