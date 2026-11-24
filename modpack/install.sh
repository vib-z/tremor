#!/bin/sh
# Installs tremor into a Herdr app home.
#
#   modpack/install.sh <app-home>
#
# Writes only the pack's own files: layouts/tremor.json, themes/pdk-{t3-light,t3-dark,moshi}.json, mods/pdk-*/,
# pdk/themes/ (the pack's colours, for the editor's reset), pdk/icons/, pdk/helper/, pdk/backgrounds/ (the glass backdrop), pdk/NOTICE.md and pdk/licenses/. It never edits Herdr's shipped files or any other layout, and never switches
# the shown layout (do that yourself: herdr-app do layout.switch --name tremor). Two shared overlays: keys.json adds Cmd+K/Cmd+P only in tremor; programs.json changes only agent visuals, app-wide.
# Existing custom keys/agent visuals are reported and kept; both changes have separate exact-text journals.
#
# Safety: refuses ~/.config/herdr-app (the live profile), anything inside it or holding it, any alias or
# symlink that resolves there, and any home whose app socket accepts a connection (a running window).
# `install.sh --live ~/.config/herdr-app` is the one way into the live profile itself (quit the app first);
# uninstall.sh takes the same flag.
# The first install keeps a baseline copy of every file it would replace in <app-home>/.pdk-backup/;
# installed files are recorded with sha256 hashes; uninstall.sh restores the baseline. Running it again
# updates the pack and keeps the first baseline. It refuses to overwrite a pack file you changed, except a theme
# the Colours editor changed: that one is kept as you left it.
# Over an earlier pdk-era install it removes layouts/pdk.json and the `layout:pdk` keys block when each is unchanged
# since that install, and adds tremor's; when either was changed it refuses before changing anything.
set -eu

die() { echo "install.sh: $*" >&2; exit 1; }
LIVE=
[ "${1:-}" = "--live" ] && { LIVE=1; shift; }
[ $# -eq 1 ] || die "usage: install.sh [--live] <app-home>"
export PDK_LIVE=$LIVE

PACK=$(cd "$(dirname "$0")" && pwd -P)
. "$PACK/install-lib.sh"

TARGET=$(canonical_target "$1") || exit 1
refuse_live "$TARGET" "$LIVE" || exit 1
refuse_running "$TARGET" || exit 1
B="$TARGET/.pdk-backup"
# H1: both shared files and journal temporary paths are preflighted before even staging or making a backup.
keys_file plan "$TARGET" "$PACK" "$B" || exit 1
programs_file preflight "$TARGET" "$PACK" "$B" || exit 1
mkdir -p "$TARGET"
refuse_backup_links "$B" || exit 1
mkdir -p "$B/baseline"
STAGE="$B/staging.$$"
rm -rf "$STAGE"
mkdir -p "$STAGE"
trap 'rm -rf "$STAGE" "$B/known.sums"' EXIT

# 1. Assemble the pack in a staging folder, as it will be laid out in the home.
mkdir -p "$STAGE/layouts" "$STAGE/themes" "$STAGE/pdk/themes" "$STAGE/pdk/icons" "$STAGE/pdk/helper" "$STAGE/mods"
cp "$PACK/layouts/tremor.json" "$STAGE/layouts/"
cp "$PACK/themes/"pdk-*.json "$STAGE/themes/"
cp "$PACK/themes/"pdk-*.json "$STAGE/pdk/themes/"
cp "$PACK/icons/"*.svg "$STAGE/pdk/icons/"
mkdir -p "$STAGE/pdk/icons/agents" && cp "$PACK/icons/agents/"*.svg "$STAGE/pdk/icons/agents/"
mkdir -p "$STAGE/pdk/icons/agents-colour" && cp "$PACK/icons/agents-colour/"*.svg "$STAGE/pdk/icons/agents-colour/"
cp "$PACK/helper/"*.py "$STAGE/pdk/helper/"
mkdir -p "$STAGE/pdk/backgrounds" && cp "$PACK/backgrounds/"*.png "$STAGE/pdk/backgrounds/"
mkdir -p "$STAGE/pdk/licenses"
cp "$PACK/NOTICE.md" "$STAGE/pdk/"
cp "$PACK/licenses/"*.txt "$STAGE/pdk/licenses/"
for m in "$PACK"/mods/pdk-*; do
  name=$(basename "$m")
  mkdir -p "$STAGE/mods/$name/lib"
  cp "$m"/*.js "$m"/mod.json "$STAGE/mods/$name/"
  cp "$PACK/adapters/"*.js "$PACK/shared/"*.js "$STAGE/mods/$name/lib/"
done

# 2. What a previous run left: the manifest of the last complete install, and the journal of an
#    interrupted one. A file matching either is the pack's own.
touch "$B/baseline.list"
: > "$B/known.sums"
[ -f "$B/manifest.sums" ] && cat "$B/manifest.sums" >> "$B/known.sums"
[ -f "$B/pending.sums" ] && cat "$B/pending.sums" >> "$B/known.sums"

# No read or write below the target goes through a symlink (review F7): the pack's paths, a previous
# install's, its state. Checked before the first read of a target file.
{ ( cd "$STAGE" && find . -type f | sed 's|^\./||' ); sed 's/^[^ ]*  //' "$B/known.sums"; echo pdk-state/themes; echo keys.json; echo programs.json; } | refuse_links "$TARGET" || exit 1

# 3. Refuse to overwrite a pack file someone changed since it was installed; keep edited themes as they are.
changed=$(changed_files "$TARGET" "$B/known.sums" "$B")
keep=""; refused=""
for rel in $changed; do if editable "$rel"; then keep="$keep $rel"; else refused="$refused $rel"; fi; done
# A changed file this pack no longer ships is an earlier install's (the pdk era's layouts/pdk.json).
for rel in $refused; do
  [ -e "$STAGE/$rel" ] || die "these files of the earlier install were changed since it was installed, nothing changed:$refused. Move them out of $TARGET to keep them, or run uninstall.sh${LIVE:+ --live} from the old checkout first, then install again"
done
[ -z "$refused" ] || die "these pack files were changed since the last install, not overwriting:$refused"
kept() { case " $keep " in *" $1 "*) return 0 ;; esac; return 1; }

# 4. The new journal, written before anything moves: every file and its hash.
( cd "$STAGE" && find . -type f | sed 's|^\./||' | LC_ALL=C sort ) > "$B/pending.list"
( cd "$STAGE" && sums_of < "$B/pending.list" ) > "$B/pending.sums.new"

# Baseline: the first time a path is installed over, keep what was there (once, ever, and never the pack's own).
( cd "$TARGET" && existing < "$B/pending.list" | sums_of ) > "$B/current.sums"
while IFS= read -r line; do
  rel=${line#*  }
  kept "$rel" && continue
  grep -qxF "$rel" "$B/baseline.list" && continue
  grep -qxF "$line" "$B/known.sums" && continue
  mkdir -p "$B/baseline/$(dirname "$rel")"
  cp -p "$TARGET/$rel" "$B/baseline/$rel"
  printf '%s\n' "$rel" >> "$B/baseline.list"
done < "$B/current.sums"
cat "$B/pending.sums.new" >> "$B/known.sums"
mv -f "$B/pending.sums.new" "$B/pending.sums"

# 5. Move each file into place (a rename per file). PDK_INSTALL_STOP_AFTER=n stops early, for the tests.
n=0
while IFS= read -r rel; do
  if [ -n "${PDK_INSTALL_STOP_AFTER:-}" ] && [ "$n" -ge "$PDK_INSTALL_STOP_AFTER" ]; then
    echo "install.sh: stopped after $n files (test hook)" >&2
    exit 3
  fi
  if kept "$rel"; then n=$((n + 1)); continue; fi
  mkdir -p "$TARGET/$(dirname "$rel")"
  mv -f "$STAGE/$rel" "$TARGET/$rel"
  n=$((n + 1))
done < "$B/pending.list"

# 6. Files a previous install had that this one no longer ships: remove when unchanged.
( cd "$TARGET" && sed 's/^[^ ]*  //' "$B/known.sums" | LC_ALL=C sort -u | grep -vxFf "$B/pending.list" | existing | sums_of ) > "$B/current.sums"
while IFS= read -r line; do
  grep -qxF "$line" "$B/known.sums" && rm -f "$TARGET/${line#*  }"
done < "$B/current.sums"

# 7. The manifest last, atomically; the journal goes.
mv -f "$B/pending.sums" "$B/manifest.sums.tmp"
mv -f "$B/manifest.sums.tmp" "$B/manifest.sums"
rm -f "$B/pending.list" "$B/known.sums" "$B/current.sums"
mkdir -p "$TARGET/pdk-state"
# 8. The layout-scoped shortcuts and app-wide program visuals, each with its own exact-text journal.
keys_file merge "$TARGET" "$PACK" "$B" || exit 1
programs_file merge "$TARGET" "$PACK" "$B" || exit 1
[ -z "$keep" ] || echo "Kept your Colours edits in:$keep (reset them in Colours to get the pack's new values)."
echo "Installed tremor into $TARGET ($n files). Switch to it: herdr-app do layout.switch --name tremor"
