# Shared by install.sh and uninstall.sh: where a target home really is, and whether it is safe to touch.

sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }

# The target with symlinks resolved, also when it doesn't exist yet (its nearest existing parent is).
canonical_target() {
  t=$1
  case $t in /*) ;; *) t="$(pwd -P)/$t" ;; esac
  rest=""
  while [ ! -e "$t" ]; do
    rest="/$(basename "$t")$rest"
    t=$(dirname "$t")
  done
  if [ -d "$t" ]; then t=$(cd "$t" && pwd -P); else
    d=$(cd "$(dirname "$t")" && pwd -P); t="$d/$(basename "$t")"
    [ -L "$t" ] && { echo "install: $1 is a symlink to a file" >&2; return 1; }
  fi
  printf '%s%s\n' "$t" "$rest"
}

# The live profile (and an XDG one), as it really is on disk. The account's home comes from the user
# database as well as $HOME, so a changed HOME cannot hide the real profile.
live_profiles() {
  real=$(eval echo "~$(id -un)")
  for p in "$real/.config/herdr-app" "$HOME/.config/herdr-app" ${XDG_CONFIG_HOME:+"$XDG_CONFIG_HOME/herdr-app"}; do
    if [ -e "$p" ]; then (cd "$p" 2>/dev/null && pwd -P) || printf '%s\n' "$p"; else printf '%s\n' "$p"; fi
    printf '%s\n' "$p"
  done
}

# Is the target exactly a live profile (not inside it, not holding it)?
is_live() {
  for live in $(live_profiles); do [ "$1" = "$live" ] && return 0; done
  return 1
}

# With --live (the owner's live-install gate, 10 Nov), the live profile itself is allowed; inside it, holding it, and
# every other target follow the same rules as without it. `--live` on a target that is not a live profile is refused.
refuse_live() {
  target=$1; live_ok=${2:-}
  if [ -n "$live_ok" ]; then
    is_live "$target" || { echo "install: refusing $target: --live is only for the live Herdr profile itself" >&2; return 1; }
  fi
  for live in $(live_profiles); do
    [ -n "$live_ok" ] && [ "$target" = "$live" ] && continue
    case $target/ in
      "$live"/*) echo "install: refusing $target: that is (inside) the live Herdr profile $live" >&2; return 1 ;;
    esac
    case $live/ in
      "$target"/*) echo "install: refusing $target: it holds the live Herdr profile $live" >&2; return 1 ;;
    esac
  done
  return 0
}

# A window owns the home while its control socket accepts a connection, answering or not.
refuse_running() {
  sock="$1/herdr-app.sock"
  [ -S "$sock" ] || return 0
  if /usr/bin/python3 -I -S -c 'import socket,sys
s=socket.socket(socket.AF_UNIX)
s.settimeout(1)
try:
    s.connect(sys.argv[1]); sys.exit(0)
except OSError:
    sys.exit(1)' "$sock"; then
    echo "install: refusing $1: a Herdr window is running on it (quit it first)" >&2
    return 1
  fi
  return 0
}

# Review F7: the target is canonical, but a symlink below it could lead anywhere (the live profile included).
# Prints every existing symlink on the way to <target>/<rel> for the relative paths on stdin, leaf included.
links_under() {
  target=$1
  set -f
  while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    p=$target; ifs=$IFS; IFS=/
    for part in $rel; do
      p="$p/$part"
      if [ -L "$p" ]; then printf '%s\n' "${p#"$target"/}"; break; fi
      [ -d "$p" ] || break
    done
    IFS=$ifs
  done | LC_ALL=C sort -u
  set +f
}

# Refuses when the pack's backup folder, or anything in it, is a symlink.
refuse_backup_links() {
  b=$1
  if [ -L "$b" ] || { [ -d "$b" ] && [ -n "$(find "$b" -type l | head -1)" ]; }; then
    echo "refusing: $b is or holds a symbolic link (it could lead outside the target)" >&2
    return 1
  fi
}

# Refuses when any path on stdin, below <target>, passes through or is a symlink.
refuse_links() {
  found=$(links_under "$1")
  [ -z "$found" ] && return 0
  echo "refusing $1: these are symbolic links (they could lead outside the target):" $found >&2
  return 1
}

# sha256 sums ("hash  path") of the relative paths on stdin, in one process; nothing for no paths.
sums_of() {
  # With no paths, BSD xargs still runs shasum once, on empty stdin ("-"): that line is dropped.
  tr '\n' '\0' | xargs -0 shasum -a 256 | grep -v '  -$' || true
}

# The relative paths on stdin that exist as files here.
existing() {
  while IFS= read -r rel; do [ -f "$rel" ] && printf '%s\n' "$rel"; done
}

# Theme files the token editor writes (mods/pdk-tokens): the person's edits, kept by install and saved by
# uninstall into <home>/pdk-state/themes/, never a reason to refuse.
editable() { case $1 in themes/pdk-*.json) return 0 ;; esac; return 1; }

# Pack files whose content matches no recorded hash and is not the untouched original either.
changed_files() {
  home=$1; known=$2; b=$3; out=""
  [ -s "$known" ] || return 0
  cur=$( cd "$home" && sed 's/^[^ ]*  //' "$known" | LC_ALL=C sort -u | existing | sums_of )
  printf '%s\n' "$cur" | while IFS= read -r line; do
    [ -n "$line" ] || continue
    rel=${line#*  }
    grep -qxF "$line" "$known" && continue
    [ -f "$b/baseline/$rel" ] && cmp -s "$b/baseline/$rel" "$home/$rel" && continue
    printf ' %s' "$rel"
  done
}

# The pack's shortcuts: merges keys.json (`layout:tremor` cmd-k/cmd-p → mod.open:pdk-search) into
# <home>/keys.json, and takes it out again. The app reads that file as the whole key set, writing Herdr's defaults when
# it is absent (herdr-app@2405bf3 src/keys.rs:166-182), so a missing file is created from the defaults of the
# version the pack was built on (keys.herdr-0.1.14.macos.json, byte for byte), never from the pack's keys alone.
# The section goes in as one block of text before the file's last brace, so taking that block out gives back the
# file byte for byte, whatever else the person changed. A key the person already uses where it would apply
# (`global`, `terminal`, or their own `layout:tremor`) is reported and left out, except the stock global Cmd+P picker,
# which the tremor layout is explicitly authorised to shadow. Other layouts keep that global binding. State in <backup>/keys/: `added` (the
# block), `created` (the whole file, when there was none) and `original` (the first file this changed).
# An earlier install's block for another layout name (the pdk era's `layout:pdk`) is taken out on the way, when it is
# exactly as installed; when it was edited, `plan` (install.sh, before anything moves) and `merge` refuse.
#   keys_file plan|merge <home> <pack> <backup>   |   keys_file unmerge <home> <pack> <backup>
keys_file() {
  /usr/bin/python3 -I -S - "$@" <<'PY'
import json, os, stat, sys
mode, home, pack, backup = sys.argv[1:5]
family = sys.argv[5] if len(sys.argv) > 5 else "keys"
assert family in ("keys", "programs")
filename = family + ".json"
path, st = os.path.join(home, filename), os.path.join(backup, family)

# Before staging or an uninstall journal, reject links/non-files and every temporary path we may use. Repeat
# here before key writes too; O_EXCL|O_NOFOLLOW below closes the later insertion window without following it.
key_paths = [filename] + [".pdk-backup/" + family + "/" + n for n in ("original", "added", "created")]
for rel in key_paths + [p + ".pdk-tmp" for p in key_paths]:
    here = home
    parts = rel.split("/")
    for i, part in enumerate(parts):
        here = os.path.join(here, part)
        try:
            info = os.lstat(here)
        except FileNotFoundError:
            break
        if stat.S_ISLNK(info.st_mode):
            sys.exit(filename + ": refusing symbolic links (they could lead outside the target): " + rel)
        if i < len(parts) - 1 and not stat.S_ISDIR(info.st_mode):
            sys.exit(filename + ": refusing non-directory parent: " + rel)
        if i == len(parts) - 1:
            if rel.endswith(".pdk-tmp"):
                sys.exit(filename + ": refusing existing temporary path: " + rel)
            if not stat.S_ISREG(info.st_mode):
                sys.exit(filename + ": refusing non-plain file: " + rel)
if mode == "preflight":
    sys.exit(0)

DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
home_fd = os.open(home, DIR_FLAGS)

def directory(rel, create=False):
    """Walk from the verified home descriptor, never following a link in a parent component."""
    fd = os.dup(home_fd)
    try:
        for part in rel.split("/") if rel else []:
            if part in ("", ".", ".."):
                raise ValueError("invalid keys parent")
            if create:
                try:
                    os.mkdir(part, 0o755, dir_fd=fd)
                except FileExistsError:
                    pass
            child = os.open(part, DIR_FLAGS, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise

def parent(p):
    rel = os.path.relpath(p, home)
    if rel == ".." or rel.startswith("../"):
        raise ValueError("keys write outside the verified home")
    folder, name = os.path.split(rel)
    return directory(folder), name

ours = json.load(open(os.path.join(pack, "keys.json" if family == "keys" else "pdk-programs.json"), encoding="utf-8"))
say = lambda m: print(filename + ": " + m)

def read(p):
    with open(p, encoding="utf-8", newline="") as f:
        return f.read()

def write(p, text, mode_from=None):
    permissions = 0o644
    if mode_from:
        source, leaf = parent(mode_from)
        try:
            info = os.stat(leaf, dir_fd=source, follow_symlinks=False)
            if not stat.S_ISREG(info.st_mode):
                raise ValueError("keys mode source is not a plain file")
            permissions = info.st_mode & 0o777
        finally:
            os.close(source)
    folder, name = parent(p)
    tmp = name + ".pdk-tmp"
    owned = False
    try:
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=folder)
        owned = True
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
            os.fchmod(f.fileno(), permissions)
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
            actual = os.stat(tmp, dir_fd=folder, follow_symlinks=False)
            opened = os.fstat(f.fileno())
            if (actual.st_dev, actual.st_ino) != (opened.st_dev, opened.st_ino):
                raise ValueError("keys temporary file was replaced")
            os.replace(tmp, name, src_dir_fd=folder, dst_dir_fd=folder)
            owned = False
    finally:
        if owned:
            try:
                os.unlink(tmp, dir_fd=folder)
            except FileNotFoundError:
                pass
        os.close(folder)

if family == "programs":
    # Retain the person's exact JSON text. Insert only visual fields at object boundaries; journal each
    # literal block so removal preserves unrelated bytes, including Unicode, whitespace and key order.
    fields = {"icon", "tint", "color", "tile"}
    assert set(ours) == {"programs"} and all(set(v) <= fields for v in ours["programs"].values())
    def unique(pairs):
        out = {}
        for k, v in pairs:
            if k in out: raise ValueError("duplicate JSON key")
            out[k] = v
        return out
    decoder = json.JSONDecoder(object_pairs_hook=unique)
    def parse(text):
        if len(text) > 2 * 1024 * 1024: raise ValueError("programs overlay exceeds 2 MiB")
        result = json.loads(text, object_pairs_hook=unique)
        if not isinstance(result, dict): raise ValueError("not an object")
        return result
    def object_at(text, start=0):
        start += len(text[start:]) - len(text[start:].lstrip())
        value, end = decoder.raw_decode(text, start)
        if not isinstance(value, dict): raise ValueError("not an object")
        members, pos = {}, start + 1
        while text[pos:end].strip() != "}":
            pos += len(text[pos:]) - len(text[pos:].lstrip())
            key, pos = decoder.raw_decode(text, pos)
            pos += len(text[pos:]) - len(text[pos:].lstrip())
            assert text[pos] == ":"; pos += 1
            pos += len(text[pos:]) - len(text[pos:].lstrip())
            begin = pos; _, pos = decoder.raw_decode(text, pos); members[key] = (begin, pos)
            pos += len(text[pos:]) - len(text[pos:].lstrip())
            if text[pos] == "}": break
            assert text[pos] == ","; pos += 1
        return value, end, members
    def insertion(text, start, values):
        obj, end, _ = object_at(text, start)
        q = len(text[:end-1].rstrip())
        block = ("," if obj else "") + "\n" + ",\n".join("    " + json.dumps(k) + ": " + json.dumps(v, ensure_ascii=False) for k, v in values.items())
        return q, block
    def remove_block(text, block):
        left, right = text.split(block, 1)
        # If the original object was empty, a later neighbouring property may own the separator.
        if not block.startswith(","):
            if left.rstrip().endswith("{") and right.lstrip().startswith(","):
                i = len(right)-len(right.lstrip()); right = right[:i]+right[i+1:]
            elif left.rstrip().endswith(",") and right.lstrip().startswith("}"):
                i = len(left.rstrip())-1; left = left[:i]+left[i+1:]
        return left+right
    journal, made = os.path.join(st, "added"), os.path.join(st, "created")
    if mode == "merge":
        created = not os.path.lexists(path)
        text = "{}\n" if created else read(path)
        try: cur = parse(text)
        except (ValueError, RecursionError):
            say("not an unambiguous JSON object, left as it is: logos not added"); sys.exit(0)
        if os.path.exists(journal):
            saved = json.loads(read(journal))
            if all(text.count(b) == 1 for b in saved["blocks"]):
                now = cur.get("programs", {})
                current = all(isinstance(now.get(k), dict) and all(now[k].get(f) == v for f, v in ours["programs"].get(k, {}).items()) for k in saved["targets"])
                if current and set(ours["programs"]) <= set(now):
                    say("logos already installed"); sys.exit(0)
                # Remove only the previous exact owned blocks before replacing their journal. This checkpoint
                # lets an interrupted upgrade resume like an unapplied first install; user text is never rebuilt.
                old_text = text
                for block in saved["blocks"]: text = remove_block(text, block)
                cur = parse(text)
                if os.path.exists(made) and read(made) == old_text:
                    os.remove(path); created = True
                else: write(path, text, path)
                say("upgrading the previous owned logo overlay")
            entries_now = cur.get("programs", {})
            visual_now = isinstance(entries_now, dict) and any(isinstance(entries_now.get(k), dict) and any(f in entries_now[k] for f in fields) for k in saved["targets"])
            if any(b in text for b in saved["blocks"]) or visual_now:
                sys.exit("programs.json: installed logo blocks changed; restore or uninstall them before reinstalling")
            say("resuming an unapplied logo journal")
        root, _, root_members = object_at(text)
        edits, targets, additions = [], [], {}
        entries = cur.get("programs", {})
        if not isinstance(entries, dict):
            say('"programs" is not an object; logos not added'); sys.exit(0)
        programs_start = root_members.get("programs", (None,))[0]
        members = object_at(text, programs_start)[2] if programs_start is not None else {}
        for key, visual in ours["programs"].items():
            entry = entries.get(key)
            if key in entries and (not isinstance(entry, dict) or any(f in entry for f in fields)):
                say(key + " already customised: kept, logo skipped"); continue
            targets.append(key)
            if entry is None: additions[key] = visual
            else: edits.append(insertion(text, members[key][0], visual))
        if additions:
            edits.append(insertion(text, programs_start, additions) if programs_start is not None else insertion(text, 0, {"programs": additions}))
        if not edits: sys.exit(0)
        new = text
        for q, block in sorted(edits, reverse=True): new = new[:q]+block+new[q:]
        expected = json.loads(json.dumps(cur)); expected.setdefault("programs", {})
        for key in targets: expected["programs"].setdefault(key, {}).update(ours["programs"][key])
        assert parse(new) == expected, "program overlay changed unrelated fields"
        os.close(directory(".pdk-backup/programs", create=True))
        if not created and not os.path.exists(os.path.join(st, "original")): write(os.path.join(st, "original"), text, path)
        write(journal, json.dumps({"blocks": [b for _, b in edits], "targets": targets}) + "\n")
        if created: write(made, new)
        write(path, new, None if created else path)
        say("added app-wide Moshi logos: " + ", ".join(targets)); sys.exit(0)
    # Validate every block before either shared file or installed assets are removed.
    if not os.path.exists(journal) or not os.path.lexists(path): sys.exit(0)
    text, saved = read(path), json.loads(read(journal))
    if os.path.exists(made) and read(made) == text:
        if mode != "verify": os.remove(path)
        say("removed (the pack created it)"); sys.exit(0)
    if all(text.count(b) == 1 for b in saved["blocks"]):
        new = text
        for block in saved["blocks"]: new = remove_block(new, block)
        parse(new)
        if mode != "verify": write(path, new, path)
        say("removed only the installed logo blocks; other bytes kept"); sys.exit(0)
    try: cur = parse(text)
    except (ValueError, RecursionError): cur = {}
    entries = cur.get("programs", {})
    if isinstance(entries, dict) and not any(isinstance(entries.get(k), dict) and any(f in entries[k] for f in fields) for k in saved["targets"]): sys.exit(0)
    sys.exit("programs.json: the pack's logo blocks were edited since install, nothing removed: restore the blocks or remove their visual fields, then uninstall again")

def has_ours(cur, wanted=None):
    return all(isinstance(cur.get(s), dict) and cur[s].get(k) == v for s, keys in (wanted or ours).items() for k, v in keys.items())

if os.path.islink(path) or (os.path.lexists(path) and not os.path.isfile(path)):
    sys.exit("keys.json: refusing %s: not a plain file (a link could lead outside the target)" % path)

def without_earlier(text, cur):
    """The file without an earlier install's block for another layout name (the pdk era), when that block is exactly as
    installed. As it is when there is none or it is gone; refuses when the person edited it."""
    journal = os.path.join(st, "added")
    if not os.path.exists(journal):
        return text
    old = read(journal)
    try:
        installed = json.loads("{" + old.lstrip(",\n") + "}")
    except ValueError:
        return text
    if not isinstance(installed, dict) or set(installed) == set(ours):
        return text
    if text.count(old) == 1 and all(cur.get(s) == v for s, v in installed.items()):
        return text.replace(old, "", 1)
    if old in text or has_ours(cur, installed):
        sys.exit("keys.json: the earlier install's %s block was edited since install, nothing changed: take it out yourself,"
                 " or run uninstall.sh%s from the old checkout first, then install again"
                 % (" and ".join(json.dumps(s) for s in installed), " --live" if os.environ.get("PDK_LIVE") else ""))
    return text

if mode == "plan":
    if os.path.lexists(path):
        text = read(path)
        try:
            cur = json.loads(text)
        except ValueError:
            cur = None
        if isinstance(cur, dict):
            without_earlier(text, cur)
    sys.exit(0)

if mode == "merge":
    created = not os.path.lexists(path)
    if created:
        if os.uname().sysname != "Darwin":
            say("absent and no default to start from on this system: Cmd+K not added (run Herdr once, then install again)")
            sys.exit(0)
        text = read(os.path.join(pack, "keys.herdr-0.1.14.macos.json"))
    else:
        text = read(path)
    try:
        cur = json.loads(text)
    except ValueError:
        cur = None
    if not isinstance(cur, dict):
        say("not a JSON object, left as it is: Cmd+K not added")
        sys.exit(0)
    made = os.path.join(st, "created")
    owned_created = os.path.exists(made) and read(made) == text
    # Upgrade only an untouched, journalled earlier block; a person's section remains theirs.
    text = without_earlier(text, cur)
    cur = json.loads(text)
    add = {}
    for sec, keys in ours.items():
        mine = cur.get(sec)
        for k, v in keys.items():
            # Where the person already uses the key: their own section for our layout, or a section ours would
            # shadow (global) or lose to (terminal, herdr-app src/keys.rs:118-131).
            used = [(s, cur[s][k]) for s in (sec, "global", "terminal") if isinstance(cur.get(s), dict) and k in cur[s]
                    and not (s == "global" and k == "cmd-p" and cur[s][k] == "mod.open:picker")]
            if any(a == v for _, a in used):
                continue
            if used:
                s, a = used[0]
                say('%s is already bound in "%s" to %s: kept, Cmd+K not added' % (k, s, json.dumps(a)))
            elif mine is not None:
                say('has its own "%s" section: add "%s": "%s" there yourself, or remove that section and install again' % (sec, k, v))
            else:
                add.setdefault(sec, {})[k] = v
    if not add:
        if has_ours(cur):
            say("Cmd+K is already there for the tremor layout")
        sys.exit(0)
    body = ",\n".join('  %s: {\n%s\n  }' % (json.dumps(s), ",\n".join('    %s: %s' % (json.dumps(k), json.dumps(v)) for k, v in keys.items())) for s, keys in add.items())
    end = text.rstrip().rfind("}")
    q = len(text[:end].rstrip())
    block = ("" if text[:q].endswith("{") else ",") + "\n" + body
    new = text[:q] + block + text[q:]
    merged = dict(cur)
    merged.update(add)
    assert json.loads(new) == merged, "keys.json merge changed something else"
    os.close(directory(".pdk-backup/keys", create=True))
    if not created and not os.path.exists(os.path.join(st, "original")):
        write(os.path.join(st, "original"), text, path)
    # The journal first: an install stopped here leaves a block that the file doesn't hold, which uninstall skips.
    write(os.path.join(st, "added"), block)
    if created or owned_created:
        write(os.path.join(st, "created"), new)
    elif os.path.exists(os.path.join(st, "created")):
        os.remove(os.path.join(st, "created"))
    write(path, new, None if created else path)
    say("added Cmd+K and Cmd+P (search) for the tremor layout. Any edit makes the whole file yours: later Herdr versions no longer"
        " add their new default shortcuts to it. uninstall.sh takes just this out again.")
    sys.exit(0)

# unmerge
if not os.path.exists(os.path.join(st, "added")) or not os.path.lexists(path):
    sys.exit(0)
block, text = read(os.path.join(st, "added")), read(path)
made = os.path.join(st, "created")
if os.path.exists(made) and read(made) == text:
    if mode != "verify": os.remove(path)
    say("removed (the pack created it; Herdr writes its defaults again on the next start)")
    sys.exit(0)
if text.count(block) == 1:
    new = text.replace(block, "", 1)
    json.loads(new)
    if mode != "verify": write(path, new, path)
    say("took Cmd+K / Cmd+P out; the rest of the file is as it was")
    sys.exit(0)
try:
    cur = json.loads(text)
except ValueError:
    cur = {}
try:
    installed = json.loads("{" + block.lstrip(",\n") + "}")
except ValueError:
    installed = ours
if not isinstance(cur, dict) or not has_ours(cur, installed):
    sys.exit(0)
sys.exit('keys.json: the pack\'s Cmd+K block was edited since install, nothing removed: take the search keys out of %s yourself, then run uninstall.sh again' % " and ".join(json.dumps(s) for s in installed))
PY
}

# Field-by-field program identity overlay, using keys_file's verified atomic I/O and separate journal.
programs_file() {
  keys_file "$@" programs
}
