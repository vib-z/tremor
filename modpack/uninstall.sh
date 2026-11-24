#!/bin/sh
# Removes tremor from a Herdr app home and restores what the first install replaced.
#
#   modpack/uninstall.sh <app-home>
#
# Removes exactly the files the manifest lists (or, after an interrupted install, the journal), and only
# when each is unchanged since install: if you changed one, nothing is removed and the changed files are
# listed. A theme the Colours editor changed is not a refusal: it is moved to <app-home>/pdk-state/themes/.
# Then it restores the baseline and removes the chat's media cache (<app-home>/pdk-cache/media and incoming). Running it again is
# a no-op. Search keys and program visuals come out of their shared JSON files; unrelated bytes are preserved. The pack's runtime state (<app-home>/pdk-state/: settled workspaces, saved theme edits) stays.
set -eu

die() { echo "uninstall.sh: $*" >&2; exit 1; }
LIVE=
[ "${1:-}" = "--live" ] && { LIVE=1; shift; }
[ $# -eq 1 ] || die "usage: uninstall.sh [--live] <app-home>"

PACK=$(cd "$(dirname "$0")" && pwd -P)
. "$PACK/install-lib.sh"

TARGET=$(canonical_target "$1") || exit 1
refuse_live "$TARGET" "$LIVE" || exit 1
refuse_running "$TARGET" || exit 1

B="$TARGET/.pdk-backup"
# H1: refuse before writing uninstall.sums or removing/restoring any installed file.
keys_file preflight "$TARGET" "$PACK" "$B" || exit 1
programs_file preflight "$TARGET" "$PACK" "$B" || exit 1
if [ ! -d "$B" ]; then
  echo "Nothing to uninstall in $TARGET."
  exit 0
fi

refuse_backup_links "$B" || exit 1

# What is installed: the manifest, plus anything an interrupted install had journalled.
LIST="$B/uninstall.sums"
: > "$LIST"
[ -f "$B/manifest.sums" ] && cat "$B/manifest.sums" >> "$LIST"
[ -f "$B/pending.sums" ] && cat "$B/pending.sums" >> "$LIST"

# Nothing removed, restored or saved goes through a symlink (review F7, G4): the pack's files, the baseline, each
# saved theme's own file (cp would write through a link there) and the media cache this removes.
{
  sed 's/^[^ ]*  //' "$LIST"
  [ -f "$B/baseline.list" ] && cat "$B/baseline.list"
  sed -n 's|^[^ ]*  themes/\(pdk-[^/]*\.json\)$|pdk-state/themes/\1|p' "$LIST"
  echo pdk-cache/media
  echo pdk-cache/incoming
  echo keys.json
  echo programs.json
} | refuse_links "$TARGET" || exit 1

# Refuse before touching anything if a file the pack installed was changed since.
changed=$(changed_files "$TARGET" "$LIST" "$B")
edits=""; refused=""
for rel in $changed; do if editable "$rel"; then edits="$edits $rel"; else refused="$refused $rel"; fi; done
[ -z "$refused" ] || die "these pack files were changed since install, nothing removed:$refused"

# Validate both shared journals before modifying either file or removing installed assets.
keys_file verify "$TARGET" "$PACK" "$B" || exit 1
programs_file verify "$TARGET" "$PACK" "$B" || exit 1
keys_file unmerge "$TARGET" "$PACK" "$B" || exit 1
programs_file unmerge "$TARGET" "$PACK" "$B" || exit 1

# Colours edits: kept in pdk-state, then the theme file goes like the pack's other files.
for rel in $edits; do
  mkdir -p "$TARGET/pdk-state/themes"
  cp -p "$TARGET/$rel" "$TARGET/pdk-state/themes/$(basename "$rel")"
  rm -f "$TARGET/$rel"
done

# Remove the pack's own files (their content matches a recorded hash), then restore the baseline.
( cd "$TARGET" && sed 's/^[^ ]*  //' "$LIST" | LC_ALL=C sort -u | existing | sums_of ) > "$B/current.sums"
while IFS= read -r line; do
  grep -qxF "$line" "$LIST" && rm -f "$TARGET/${line#*  }"
done < "$B/current.sums"
if [ -f "$B/baseline.list" ]; then
  while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    mkdir -p "$TARGET/$(dirname "$rel")"
    cp -p "$B/baseline/$rel" "$TARGET/$rel"
  done < "$B/baseline.list"
fi

# Only folders the manifest put files in are the pack's (review F8): another mods/pdk-* folder is not touched.
OWNED=$(sed 's/^[^ ]*  //' "$LIST" | sed -n 's|^\(mods/pdk-[^/]*\)/.*|\1|p; s|^\(pdk\)/.*|\1|p' | LC_ALL=C sort -u)

# The two files the app writes into every mod folder it loads (gpui-shell's typings and editor config), in
# the pack's own mod folders once their main.js is gone, so no main.js-less folder is left behind.
for rel in $OWNED; do
  d="$TARGET/$rel"
  case $rel in mods/*) [ -d "$d" ] && [ ! -e "$d/main.js" ] && find "$d" -type f \( -name gpui-kit.d.ts -o -name jsconfig.json \) -delete ;; esac
done

# Empty folders the pack made, in its own folders only.
for rel in $OWNED; do
  [ -d "$TARGET/$rel" ] && find "$TARGET/$rel" -depth -type d -empty -delete 2>/dev/null || true
done
# The chat's media cache (review G5): the helper's previews, the pack's to remove, and pdk-cache/incoming (review
# R6: a remote preview's text on its way into the cache, and what a failed call left there). Only these two; the
# settled workspaces and saved theme edits in pdk-state stay.
rm -rf "$TARGET/pdk-cache/media" "$TARGET/pdk-cache/incoming"
rmdir "$TARGET/pdk-cache" 2>/dev/null || true
rm -rf "$B"
[ -z "$edits" ] || echo "Saved your Colours edits in $TARGET/pdk-state/themes/:$edits"
echo "Uninstalled tremor from $TARGET."
