#!/usr/bin/env python3
"""The pack's one exec helper. Mods run it as `/usr/bin/python3 -I -S pdk-helper.py <command> ...`.

It reads, with three exceptions: it writes preview images into its own cache, `<app home>/pdk-cache/media/`
(the app home is three folders above this file; nothing else is written), and `open` and `reveal` hand one
media file to macOS's `open`. Every answer is one JSON object on stdout, always well under exec's 8 MiB cap.

  motion                                 {"reduce": bool}: the system's Reduce Motion
  start PID                              {"start": "Sun Nov  8 22:31:05 2026" | null}: `ps -o lstart` in C/UTC,
                                         the form Claude Code writes as procStart
  tty PID                                {"tty": "ttys055" | null}: the process's controlling terminal (`ps -o tty`),
                                         the key of Hermes' terminal-sessions/tty-dev-<tty> record (qa-modpack)
  held PID                               {"files": [...]}: files the process holds open under ~/.codex/
  read PATH OFFSET MAX ALIGN HEADLEN     whole lines of a transcript from OFFSET (negative: that far back
                                         from the end), at most MAX bytes of them
  rows KIND SESSION AFTER                rows of one session from a fixed SQLite store, read-only, after the cursor
                                         AFTER: {rows, next, more, snapshot}. The whole reply stays under ROWS_BUDGET
                                         bytes; `next` is the last row it holds, so the next call resumes there.
                                         Display text over ROW_TEXT characters is cut with a marker and the row says
                                         `clipped: true`; JSON fields (Hermes tool_calls, OpenCode data) stay valid
                                         (OpenCode's text, output and content strings are cut inside the decoded
                                         JSON). A row too big even so comes as {id or seq, skipped: true, bytes}.
  first PATH                             {line}: the first line of a transcript, read one byte at a time up to its
                                         newline (nothing after it), at most FIRST_MAX bytes; an error without one
  procs PID                              {children, state}: how many live direct children PID has (zombies are not
                                         live), and `ps`'s state letters for PID ("Ss", "R+"), null when it is gone
  slim PATH OFFSET                       the one transcript line at OFFSET (one too long for `read`), parsed, with
                                         inline image data replaced by its size and other strings over 8000
                                         characters cut: {"record": {...}}
  media PATH VARIANT FORCE               a preview of one media file (VARIANT thumb or view): {kind, size, image,
                                         width, height}, {large: true} over LARGE_FILE unless FORCE is 1, {missing:
                                         true}, or for HTML only {kind, size} (never rendered: it can run scripts
                                         and load remote content)
  inline PATH OFFSET INDEX VARIANT       the INDEX-th inline image of the transcript line at OFFSET, decoded into
                                         the cache: {image, width, height, file, mime, bytes}
  open PATH / reveal PATH                `open PATH` / `open -R PATH` for one media file
  fetch URL VARIANT                      after a click on a remote image: that one https URL, downloaded into the
                                         cache (image types only, at most REMOTE_MAX bytes, REMOTE_SECONDS, https
                                         redirects only, no cookies, credentials or proxies), then a preview of it
  store ID MACHINE STAMP                  a preview another machine made (shared/helper.js, pdk-chat.py `media` or
                                         `inline`): reads the base64 PNG the chat wrote to <app home>/pdk-cache/incoming/ID.b64,
                                         removes it, and keeps the PNG in the cache under a key of MACHINE and STAMP:
                                         {image, width, height}
  keep ID MACHINE STAMP EXT SIZE COUNT    another machine's media file (shared/helper.js mediaOriginal): the COUNT base64
                                         pieces the chat wrote to <app home>/pdk-cache/incoming/ID-<n>.b64, put together
                                         in the cache when exactly SIZE bytes (at most 25 MB), the pieces removed: {path};
                                         COUNT 0 only asks whether the cache has it: {path} or {missing: true}
  realpath PATH                          {path}: PATH's canonical path when it is the canonical app home or inside
                                         it, else an error (a mod checks a file it will write before writing it)
  models codex                           {models: [{id, label, description, efforts, defaultEffort, isDefault}]}:
                                         Codex's own model list (`codex app-server`, `model/list`) for the chat's
                                         model switcher, with the isolation flags of docs/modpack/qa/codex-launch.md
                                         (no hooks, notify, plugins, apps or MCP servers); no model is called
  names KIND CWD                         {names: [...]}: the NAMES of an agent's custom "/" commands and skills for
                                         the "/" menu (KIND claude: ~/.claude/commands, ~/.claude/skills and CWD's
                                         .claude/commands and .claude/skills; KIND codex: $CODEX_HOME/prompts), at
                                         most NAMES_MAX; folders are listed, no file is opened

Media files (`media`, `open`, `reveal`): an absolute path (or ~/...) to a regular file, not executable, whose
real path ends in an allow-listed image, video, PDF or HTML extension. Never an app, bundle, folder or script.
Previews are made by macOS's own `sips` (images) and `qlmanage -t` (a video's poster frame, a PDF's first page), with a
time limit, at most THUMB or VIEW pixels on the long side, into content-named files the cache keeps to
CACHE_FILES files and CACHE_BYTES bytes, enforced after every write, failed or not. The cache folder and every
folder on the way to it must be a plain folder inside the canonical app home, checked before each write and prune.
The network is used by `fetch` only, for the one URL a person clicked.

`read` returns {dev, ino, size, head, headLen, start, lines: [[offset, text]], skipped: [[offset, length]], next, eof}.
Lines end at a newline: a line still being written is left for the next read (its bytes are not consumed),
so a multi-byte character is never split. A complete line longer than MAX is not returned; it is listed in
`skipped` and the cursor moves past it. ALIGN=1 starts after the first newline at or past OFFSET (a read that
starts mid-file). `head` is a digest of the first HEADLEN bytes (or fewer when the file is shorter; the
answer says how many), so a rewritten file is told apart from an append.

Paths are allow-listed: transcripts under the agents' own session folders in HOME, ending in .jsonl or .json,
and no symlink out of them. Stores are fixed paths. Beyond those, `names` lists the command and skill folders
named above (names only), and nothing else in HOME is listed, read or written.
"""
import base64
import hashlib
import json
import os
import re
import select
import shutil
import signal
import socket
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

HOME_AS_GIVEN = os.path.expanduser("~")
HOME = os.path.realpath(HOME_AS_GIVEN)
ROOTS = [os.path.join(HOME, p) for p in (
    ".claude/projects",
    ".codex/sessions",
    ".codex/archived_sessions",
    ".grok/sessions",
    ".pi/agent/sessions",
    ".omp/agent/sessions",
    ".kimi-code/sessions",
    ".gemini/tmp",
)]
STORES = {
    "hermes": os.path.join(HOME, ".hermes/state.db"),
    "opencode": os.path.join(HOME, ".local/share/opencode/opencode.db"),
}
CHUNK = 1 << 20
MAX_READ = 2 << 20
ROW_LIMIT = 400
ROW_TEXT = 64_000
ROWS_BUDGET = 4 << 20
FIRST_MAX = 64 << 10

MEDIA = {
    "png": "image", "jpg": "image", "jpeg": "image", "gif": "image", "webp": "image", "heic": "image",
    "heif": "image", "tif": "image", "tiff": "image", "bmp": "image",
    "mp4": "video", "mov": "video", "m4v": "video", "webm": "video",
    "pdf": "pdf", "html": "html", "htm": "html",
}
INLINE_TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/webp": "webp",
                "image/heic": "heic", "image/tiff": "tiff", "image/bmp": "bmp"}
SIZES = {"thumb": 480, "view": 2560}
LARGE_FILE = 25 << 20       # an image or PDF this big waits for a click
MAX_INLINE_LINE = 48 << 20  # longest transcript line `slim` and `inline` parse
SLIM_TEXT = 8000
SLIM_ANSWER = 4 << 20
ASSET_LIMIT = 16 << 20      # the app's image loader refuses bigger files (gpui-shell assets.rs:26)
TOOL_SECONDS = 20
REMOTE_MAX = 25 << 20
REMOTE_SECONDS = 20
CACHE_FILES = 400
CACHE_BYTES = 300 << 20
SELF = os.path.realpath(__file__)
APP_HOME = os.path.dirname(os.path.dirname(os.path.dirname(SELF)))
CACHE_REL = "pdk-cache/media"
INCOMING_REL = "pdk-cache/incoming"
INCOMING_KEEP = 600  # seconds an incoming file a failed call left behind is kept
CACHE = os.path.join(APP_HOME, CACHE_REL)


def out(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))
    sys.stdout.write("\n")


def fail(message, code=2):
    out({"error": message})
    sys.exit(code)


def allowed(path):
    if not path.endswith((".jsonl", ".json")):
        return None
    real = os.path.realpath(path)
    for root in ROOTS:
        if real.startswith(root + os.sep):
            return real
    return None


def motion():
    try:
        r = subprocess.run(["/usr/bin/defaults", "read", "com.apple.universalaccess", "reduceMotion"],
                           capture_output=True, text=True, timeout=5)
        out({"reduce": r.stdout.strip() == "1"})
    except Exception:
        out({"reduce": False})


def start(pid):
    if not pid.isdigit():
        fail("pid")
    env = {"LC_ALL": "C", "TZ": "UTC", "PATH": "/bin:/usr/bin"}
    r = subprocess.run(["/bin/ps", "-o", "lstart=", "-p", pid], capture_output=True, text=True, env=env, timeout=5)
    text = r.stdout.strip()
    out({"start": text if r.returncode == 0 and text else None})


def tty(pid):
    if not pid.isdigit():
        fail("pid")
    env = {"LC_ALL": "C", "PATH": "/bin:/usr/bin"}
    r = subprocess.run(["/bin/ps", "-o", "tty=", "-p", pid], capture_output=True, text=True, env=env, timeout=5)
    text = r.stdout.strip()
    out({"tty": text if r.returncode == 0 and text and text not in ("??", "?") else None})


def held(pid):
    if not pid.isdigit():
        fail("pid")
    root = os.path.join(HOME, ".codex") + os.sep
    given = os.path.join(HOME_AS_GIVEN, ".codex") + os.sep
    r = subprocess.run(["/usr/sbin/lsof", "-nP", "-a", "-d", "0-65535", "-Fn", "-p", pid],
                       capture_output=True, text=True, env={"LC_ALL": "C", "PATH": "/bin:/usr/bin"}, timeout=10)
    files = []
    for line in r.stdout.splitlines():
        if line.startswith("n"):
            name = line[1:]
            # Only Codex's own files; anything else the process holds is not ours to report.
            # lsof names the real path; answer in the HOME the caller uses (a symlinked home, /tmp on macOS).
            if name.startswith(root):
                files.append(given + name[len(root):])
            elif name.startswith(given):
                files.append(name)
    out({"alive": r.returncode == 0, "files": sorted(set(files))})


def read(path, offset, limit, align, headlen):
    real = allowed(path)
    if not real:
        fail("path not allowed")
    try:
        offset = int(offset)
        limit = max(1, min(int(limit), MAX_READ))
        headlen = max(1, min(int(headlen), 65536))
    except ValueError:
        fail("offset")
    try:
        f = open(real, "rb")
    except FileNotFoundError:
        out({"missing": True})
        return
    with f:
        st = os.fstat(f.fileno())
        first = f.read(headlen)
        result = {"dev": st.st_dev, "ino": st.st_ino, "size": st.st_size, "head": hashlib.sha1(first).hexdigest(),
                  "headLen": len(first), "lines": [], "skipped": [], "eof": False}
        if offset < 0:
            offset = max(0, st.st_size + offset)
        if offset > st.st_size:
            # Shorter than our cursor: shrunk or replaced. The caller starts over.
            result.update(start=offset, next=offset, shrunk=True)
            out(result)
            return
        f.seek(offset)
        pos = offset
        if align == "1" and offset > 0:
            # Start after the line we landed in. That line is listed in `skipped` (when it is whole), so a caller
            # can still get it through `slim`: a tail window that lands in one huge line (a pasted screenshot)
            # would otherwise lose that line.
            landed = line_start(f, offset - 1)
            f.seek(offset - 1)
            pos = offset - 1
            while True:
                b = f.read(CHUNK)
                if not b:
                    result.update(start=pos, next=pos, eof=True)
                    out(result)
                    return
                nl = b.find(b"\n")
                if nl >= 0:
                    if pos + nl > offset - 1 and landed is not None:  # we did land inside a line
                        result["skipped"].append([landed, pos + nl - landed])
                    pos += nl + 1
                    f.seek(pos)
                    break
                pos += len(b)
        result["start"] = pos
        used = 0
        while used < limit:
            f.seek(pos)
            buf = f.read(limit - used)
            if not buf:
                result["eof"] = True
                break
            first = buf.find(b"\n")
            if first < 0:
                if result["lines"]:
                    break  # the next line does not fit this answer: the next read starts there
                end = scan_to_newline(f, pos + len(buf))
                if end is None:
                    result["eof"] = True  # a line still being written: left for later, nothing consumed
                    break
                result["skipped"].append([pos, end - pos])  # a whole line longer than MAX
                pos = end + 1
                continue
            cut = 0
            while True:
                nl = buf.find(b"\n", cut)
                if nl < 0:
                    break
                result["lines"].append([pos + cut, buf[cut:nl].decode("utf-8", "replace")])
                cut = nl + 1
            used += cut
            pos += cut
        result["next"] = pos
        out(result)


def line_start(f, at):
    """Where the line holding byte `at` starts, looking back at most MAX_INLINE_LINE bytes; None past that."""
    end = at
    while end > 0 and at - end < MAX_INLINE_LINE:
        lo = max(0, end - CHUNK)
        f.seek(lo)
        b = f.read(end - lo)
        nl = b.rfind(b"\n")
        if nl >= 0:
            return lo + nl + 1
        end = lo
    return 0 if end == 0 else None


TOO_LONG = -1


def scan_to_newline(f, at, limit=None):
    """The offset of the next newline at or after `at`, without keeping the bytes; None at end of file; TOO_LONG
    when `limit` bytes were looked at without finding one (nothing past them is read)."""
    f.seek(at)
    seen = 0
    while True:
        b = f.read(CHUNK if limit is None else max(1, min(CHUNK, limit - seen)))
        if not b:
            return None
        nl = b.find(b"\n")
        if nl >= 0:
            return at + nl
        at += len(b)
        seen += len(b)
        if limit is not None and seen >= limit:
            return TOO_LONG


def text_field(v):
    """A display field: bytes read as UTF-8, cut at ROW_TEXT characters with a marker. (value, clipped)"""
    if isinstance(v, bytes):
        v = v.decode("utf-8", "replace")
    if isinstance(v, str) and len(v) > ROW_TEXT:
        return v[:ROW_TEXT] + "\u2026", True
    return v, False


def json_field(v, display=()):
    """A JSON text field, kept valid: only strings under `display` keys are cut, inside the decoded value.
    Text that is not JSON is passed on whole for the reader to report. (value, clipped)"""
    if isinstance(v, bytes):
        v = v.decode("utf-8", "replace")
    if not display or not isinstance(v, str) or len(v) <= ROW_TEXT:
        return v, False
    try:
        doc = json.loads(v)
    except ValueError:
        return v, False
    cut = [False]

    def walk(x):
        if isinstance(x, dict):
            for k, y in x.items():
                if k in ARGUMENT_KEYS:
                    continue  # a tool's arguments are data, not display text
                if k in display and isinstance(y, str) and len(y) > ROW_TEXT:
                    x[k] = y[:ROW_TEXT] + "\u2026"
                    cut[0] = True
                else:
                    walk(y)
        elif isinstance(x, list):
            for y in x:
                walk(y)

    walk(doc)
    return (json.dumps(doc, ensure_ascii=False, separators=(",", ":")), True) if cut[0] else (v, False)


ARGUMENT_KEYS = {"input", "args", "arguments", "rawInput"}
ROW_SHAPES = {
    # kind: (table, wanted columns (those the table has are read), cursor column, display columns, JSON columns
    # and the display keys inside them). Hermes 0.23.0's table has `active` (0: retired by compaction) and
    # `reasoning` (captured by qa-modpack, modpack/test/fixtures/hermes); older ones may not.
    "hermes": ("messages", ("id", "role", "content", "tool_call_id", "tool_calls", "tool_name", "timestamp", "finish_reason",
                            "active", "reasoning"), "id", {"content", "reasoning"}, {"tool_calls": ()}),
    "opencode": ("session_message", ("id", "type", "seq", "data"), "seq", set(), {"data": ("text", "output", "content")}),
}


def rows(kind, session, after):
    db = STORES.get(kind)
    if not db:
        fail("store")
    try:
        after = int(after)
    except ValueError:
        fail("after")
    if not os.path.exists(db):
        out({"missing": True})
        return
    con = None
    for uri in (f"file:{db}?mode=ro", f"file:{db}?immutable=1"):
        try:
            con = sqlite3.connect(uri, uri=True, timeout=2)
            con.execute("select 1 from sqlite_master limit 1")
            snapshot = "immutable" in uri
            break
        except sqlite3.Error:
            con = None
    if con is None:
        fail("store unreadable", 3)
    con.row_factory = sqlite3.Row
    table, wanted, cursor_col, display, json_cols = ROW_SHAPES[kind]
    data, used, cursor, more = [], 0, after, False
    try:
        have = {c[1] for c in con.execute(f"pragma table_info({table})")}
        cols = ", ".join(c for c in wanted if c in have)
        query = f"select {cols} from {table} where session_id = ? and {cursor_col} > ? order by {cursor_col} limit ?"
        for n, r in enumerate(con.execute(query, (session, after, ROW_LIMIT + 1))):
            if n == ROW_LIMIT:
                more = True
                break
            row, clipped = {}, False
            for k in r.keys():
                v = r[k]
                if k in display:
                    v, c = text_field(v)
                elif k in json_cols:
                    v, c = json_field(v, json_cols[k])
                else:
                    v, c = (v.decode("utf-8", "replace") if isinstance(v, bytes) else v), False
                row[k] = v
                clipped = clipped or c
            if clipped:
                row["clipped"] = True
            size = len(json.dumps(row, ensure_ascii=False, separators=(",", ":")).encode()) + 1
            if size > ROWS_BUDGET // 2:
                # Too big to send even after cutting its text: its place is kept, its body is not.
                keep = {k: row[k] for k in ("id", "seq", "role", "type", "tool_call_id") if k in row}
                row, size = {**keep, "skipped": True, "bytes": size}, 200
            if used + size > ROWS_BUDGET:
                more = True
                break
            data.append(row)
            used += size
            cursor = row[cursor_col]
    except sqlite3.Error as e:
        fail(f"query: {e}", 3)
    out({"rows": data, "next": cursor, "snapshot": snapshot, "more": more})


def procs(pid):
    if not pid.isdigit():
        fail("pid")
    env = {"LC_ALL": "C", "PATH": "/bin:/usr/bin"}
    try:
        me = subprocess.run(["/bin/ps", "-o", "stat=", "-p", pid], capture_output=True, text=True, env=env, timeout=5)
        everyone = subprocess.run(["/bin/ps", "-A", "-o", "ppid=", "-o", "stat="], capture_output=True, text=True, env=env, timeout=10)
    except (subprocess.TimeoutExpired, OSError):
        fail("ps")
    if everyone.returncode != 0:
        fail("ps")
    state = me.stdout.strip() if me.returncode == 0 and me.stdout.strip() else None
    children = 0
    for line in everyone.stdout.splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[0] == pid and not parts[1].startswith("Z"):
            children += 1
    out({"children": children, "state": state})


def first(path):
    real = allowed(path)
    if not real:
        fail("path not allowed")
    try:
        f = open(real, "rb", buffering=0)  # unbuffered: readline takes one byte at a time, so nothing past it is read
    except FileNotFoundError:
        out({"missing": True})
        return
    with f:
        line = f.readline(FIRST_MAX + 1)
    if not line.endswith(b"\n"):
        fail("no whole first line within 64 KiB")
    out({"line": line[:-1].decode("utf-8", "replace")})


def installed():
    # The cache sits in an app home; a copy of this file anywhere else (a checkout) writes nothing.
    if os.path.basename(os.path.dirname(SELF)) != "helper" or os.path.basename(os.path.dirname(os.path.dirname(SELF))) != "pdk":
        fail("not installed")


def media_file(path):
    """The real path and stat of an allow-listed media file, or fail."""
    if path.startswith("~/"):
        path = os.path.join(HOME_AS_GIVEN, path[2:])
    if not path.startswith("/") or "\0" in path:
        fail("path not allowed")
    real = os.path.realpath(path)
    ext = real.rsplit(".", 1)[-1].lower() if "." in os.path.basename(real) else ""
    if ext not in MEDIA:
        fail("not a media file")
    try:
        st = os.stat(real)
    except FileNotFoundError:
        out({"missing": True, "path": path})
        sys.exit(0)
    except OSError:
        fail("unreadable")
    if not stat.S_ISREG(st.st_mode):
        fail("not a regular file")
    if st.st_mode & 0o111:
        fail("executable file")
    return real, st, MEDIA[ext]


def tool(argv):
    try:
        r = subprocess.run(argv, capture_output=True, text=True, timeout=TOOL_SECONDS,
                           env={"PATH": "/usr/bin:/bin:/usr/sbin", "HOME": HOME_AS_GIVEN, "LC_ALL": "C"})
        return r.returncode == 0
    except (subprocess.TimeoutExpired, OSError):
        return False


def dims(path):
    try:
        r = subprocess.run(["/usr/bin/sips", "-g", "pixelWidth", "-g", "pixelHeight", path], capture_output=True,
                           text=True, timeout=TOOL_SECONDS, env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"})
    except (subprocess.TimeoutExpired, OSError):
        return None, None
    w = h = None
    for line in r.stdout.splitlines():
        k, _, v = line.strip().partition(": ")
        if k == "pixelWidth" and v.isdigit():
            w = int(v)
        elif k == "pixelHeight" and v.isdigit():
            h = int(v)
    return w, h


RENDER = 2  # bumped when previews are drawn differently: the app's image cache is keyed by file name


def cache_key(*parts):
    return hashlib.sha1("\0".join(str(p) for p in (RENDER,) + parts).encode("utf-8", "surrogateescape")).hexdigest()[:24]


def cache_dir(rel=CACHE_REL):
    """<app home>/pdk-cache/media (or `rel`), made when missing. Review G4: every folder on the way is a plain folder
    (no link), and the result is inside the canonical app home; checked before every write and prune."""
    home = os.path.realpath(APP_HOME)
    path = home
    for part in rel.split("/"):
        path = os.path.join(path, part)
        try:
            os.mkdir(path, 0o755)
        except FileExistsError:
            pass
        except OSError:
            fail("cache folder unavailable")
        st = os.lstat(path)
        if stat.S_ISLNK(st.st_mode) or not stat.S_ISDIR(st.st_mode):
            fail("cache folder is not a plain folder")
    if os.path.realpath(path) != path or os.path.commonpath([path, home]) != home:
        fail("cache folder is outside the app home")
    return path


def is_plain_file(path):
    try:
        return stat.S_ISREG(os.lstat(path).st_mode)
    except OSError:
        return False


def remove_entry(path):
    """Removes a file or a link itself (never what a link points to)."""
    try:
        os.unlink(path)
    except OSError:
        pass


def cached(key):
    name = f"{key}.png"
    return name, os.path.join(cache_dir(), name)


def write_new(path, data):
    """Writes bytes to a new file in the cache: created exclusively, never through a link, then moved into place."""
    tmp = f"{path}.{os.getpid()}.tmp"
    remove_entry(tmp)
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def prune():
    """Keeps the cache to CACHE_FILES files and CACHE_BYTES bytes, oldest first; links are removed as links."""
    cache = cache_dir()
    entries = []
    for e in os.scandir(cache):
        if e.is_symlink():
            remove_entry(e.path)
        elif e.is_file(follow_symlinks=False):
            st = e.stat(follow_symlinks=False)
            entries.append((st.st_mtime, st.st_size, e.path))
    entries.sort()
    total = sum(e[1] for e in entries)
    while entries and (len(entries) > CACHE_FILES or total > CACHE_BYTES):
        _, size, path = entries.pop(0)
        remove_entry(path)
        total -= size


def render(kind, src, key, side):
    """A PNG preview of src in the cache, at most `side` pixels on its long side: (name, w, h) or None."""
    name, dst = cached(key)
    if not is_plain_file(dst):
        remove_entry(dst)  # a link or anything else in its place goes
        tmp = tempfile.mkdtemp(prefix=".make-", dir=cache_dir())
        try:
            made = None
            if kind in ("video", "pdf"):  # Quick Look: a video's poster frame, a PDF's first page on white paper
                if tool(["/usr/bin/qlmanage", "-t", "-s", str(side), "-o", tmp, src]):
                    made = os.path.join(tmp, os.path.basename(src) + ".png")
            else:
                w, h = dims(src)
                argv = ["/usr/bin/sips", "-s", "format", "png"]
                if not w or not h or max(w, h) > side:
                    argv += ["-Z", str(side)]
                made = os.path.join(tmp, "out.png")
                if not tool(argv + [src, "--out", made]):
                    made = None
            if not made or not is_plain_file(made) or os.path.getsize(made) > ASSET_LIMIT:
                return None
            cache_dir()  # checked again right before the write
            os.replace(made, dst)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
            prune()  # G5: after every write, made or not
    w, h = dims(dst)
    return (f"{CACHE_REL}/{name}", w, h) if w and h else None


def media(path, variant, force):
    installed()
    if variant not in SIZES:
        fail("variant")
    real, st, kind = media_file(path)
    info = {"kind": kind, "size": st.st_size, "path": path, "real": real}
    if kind == "html":
        out(info)
        return
    if kind in ("image", "pdf") and st.st_size > LARGE_FILE and force != "1":
        out({**info, "large": True})
        return
    if kind == "image":
        info["srcWidth"], info["srcHeight"] = dims(real)
    made = render(kind, real, cache_key(real, st.st_size, st.st_mtime_ns, st.st_ino, variant), SIZES[variant])
    if not made:
        out({**info, "image": None, "reason": "no preview"})
        return
    info["image"], info["width"], info["height"] = made
    out(info)


def transcript_line(path, offset):
    """The whole line at OFFSET of an allowed transcript (OFFSET starts a line), as bytes."""
    real = allowed(path)
    if not real:
        fail("path not allowed")
    try:
        offset = int(offset)
    except ValueError:
        fail("offset")
    try:
        f = open(real, "rb")
    except FileNotFoundError:
        out({"missing": True})
        sys.exit(0)
    with f:
        if offset < 0 or offset > os.fstat(f.fileno()).st_size:
            fail("offset")
        if offset > 0:
            f.seek(offset - 1)
            if f.read(1) != b"\n":
                fail("not a line start")
        f.seek(offset)
        end = scan_to_newline(f, offset, MAX_INLINE_LINE + 1)  # G6: bounded before anything is kept
        if end == TOO_LONG or (end is not None and end - offset > MAX_INLINE_LINE):
            fail("line too long")
        if end is None:
            fail("no whole line")
        f.seek(offset)
        return f.read(end - offset)


DATA_URL = re.compile(r"^data:(image/[\w.+-]+)((?:;[\w-]+=[^;,]*)*);base64,", re.I)


def images(node):
    """Inline images in the order media.js inlineImages counts them: (holder, key, mime, data, block). A block
    is {type: image, source: {type: base64, data}} (holder: its source); else a data URL string (holder[key])."""
    found = []

    def walk(v, holder, key):
        if isinstance(v, str):
            m = DATA_URL.match(v)
            if m:
                found.append((holder, key, m.group(1).lower(), v[m.end():], False))
            return
        if isinstance(v, list):
            for i, x in enumerate(v):
                walk(x, v, i)
            return
        if not isinstance(v, dict):
            return
        src = v.get("source")
        if v.get("type") == "image" and isinstance(src, dict) and src.get("type") == "base64" and isinstance(src.get("data"), str):
            found.append((src, "data", str(src.get("media_type") or "image/png").lower(), src["data"], True))
            return
        for k in list(v.keys()):
            walk(v[k], v, k)

    walk(node, None, None)
    return found


def slim(path, offset):
    try:
        record = json.loads(transcript_line(path, offset))
    except ValueError:
        fail("not json")
    for holder, key, mime, data, block in images(record):
        size = len(data) * 3 // 4
        if block:
            holder["data"] = ""
            holder["pdk_bytes"] = size
        elif holder is not None:
            holder[key] = f"data:{mime};pdk-bytes={size};base64,"

    def cut(v, n):
        if isinstance(v, str):
            return v if len(v) <= n else v[:n] + "\u2026"
        if isinstance(v, list):
            return [cut(x, n) for x in v]
        if isinstance(v, dict):
            return {k: cut(x, n) for k, x in v.items()}
        return v

    # G6: the budget is the encoded answer, envelope and newline included. ASCII JSON (\u escapes) counts every
    # byte as written and survives any lone surrogate; a record still over budget at a shorter cut is refused.
    for n in (SLIM_TEXT, SLIM_TEXT // 8):
        text = json.dumps({"record": cut(record, n)}, ensure_ascii=True, separators=(",", ":")) + "\n"
        if len(text) <= SLIM_ANSWER:
            sys.stdout.write(text)
            return
    fail("record too large")


def inline(path, offset, index, variant):
    installed()
    if variant not in SIZES or not index.isdigit():
        fail("usage")
    line = transcript_line(path, offset)
    try:
        found = images(json.loads(line))
    except ValueError:
        fail("not json")
    i = int(index)
    if i >= len(found):
        fail("no such image")
    _, _, mime, data, _ = found[i]
    ext = INLINE_TYPES.get(mime)
    if not ext:
        fail("image type")
    key = cache_key(hashlib.sha1(line).hexdigest(), i)
    original = os.path.join(cache_dir(), f"{key}-src.{ext}")
    try:
        raw = base64.b64decode(data, validate=False)
    except ValueError:
        fail("bad image data")
    out(preview_of(original, raw, mime, key, variant))


def preview_of(original, raw, mime, key, variant):
    """Keeps `raw` as the original (unless it is there already) and makes its preview; on failure the original goes
    (G5). The quota is enforced either way."""
    try:
        if not is_plain_file(original):
            remove_entry(original)
            cache_dir()
            write_new(original, raw)
        made = render("image", original, cache_key(key, variant), SIZES[variant])
        if not made:
            remove_entry(original)
            fail("no preview")
        w, h = dims(original)
        return {"image": made[0], "width": made[1], "height": made[2], "srcWidth": w, "srcHeight": h,
                "file": original, "mime": mime, "bytes": os.path.getsize(original)}
    finally:
        prune()


class Deadline(BaseException):
    """Not an Exception: nothing on the way (urllib, http.client, ssl) catches it by accident."""


def past_deadline(_signum, _frame):
    raise Deadline()


class HttpsOnlyRedirects(urllib.request.HTTPRedirectHandler):
    max_redirections = 3

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urllib.parse.urlsplit(newurl).scheme != "https":
            raise urllib.error.HTTPError(newurl, code, "redirect to a non-https address refused", headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(url, variant):
    """Review G8: a remote image, previewed in the app after a person clicked it, and only then."""
    installed()
    if variant not in SIZES:
        fail("variant")
    u = urllib.parse.urlsplit(url)
    if u.scheme != "https" or not u.hostname or u.username or u.password:
        fail("only an https address without credentials")
    key = cache_key("url", url)
    cache = cache_dir()
    for ext in set(INLINE_TYPES.values()):
        have = os.path.join(cache, f"{key}-src.{ext}")
        if is_plain_file(have):
            mime = next(m for m, e in INLINE_TYPES.items() if e == ext)
            out({**preview_of(have, b"", mime, key, variant), "url": url, "host": u.hostname})
            return
    # No proxies from the environment, no cookie jar, no auth handlers (none is installed by default).
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), HttpsOnlyRedirects())
    req = urllib.request.Request(url, headers={"User-Agent": "pdk-preview", "Accept": "image/*"})
    started = time.monotonic()
    # Recheck G8: REMOTE_SECONDS is one hard deadline for the whole download (name lookup, connect, TLS, every
    # redirect, headers, body): an interval timer on this single-threaded process interrupts whatever is waiting.
    signal.signal(signal.SIGALRM, past_deadline)
    signal.setitimer(signal.ITIMER_REAL, REMOTE_SECONDS)
    try:
        with opener.open(req, timeout=REMOTE_SECONDS) as r:
            if urllib.parse.urlsplit(r.geturl()).scheme != "https":
                fail("redirect to a non-https address refused")
            mime = (r.headers.get_content_type() or "").lower()
            ext = INLINE_TYPES.get(mime)
            if not ext:
                fail(f"not an image ({mime or 'no type'})")
            length = r.headers.get("Content-Length")
            if length and length.isdigit() and int(length) > REMOTE_MAX:
                fail("over 25 MB")
            body = bytearray()
            while True:
                if time.monotonic() - started > REMOTE_SECONDS:
                    fail("took too long")
                chunk = r.read(64 << 10)
                if not chunk:
                    break
                body += chunk
                if len(body) > REMOTE_MAX:
                    fail("over 25 MB")
    except Deadline:
        fail("took too long")
    except urllib.error.HTTPError as e:
        fail(f"refused: {e.msg if 'non-https' in str(e.msg) else e.code}")
    except (urllib.error.URLError, OSError, ValueError) as e:
        if isinstance(e, socket.timeout) or isinstance(getattr(e, "reason", None), (Deadline, socket.timeout)):
            fail("took too long")  # a socket's own timeout is the same deadline, reached a moment earlier
        fail(f"could not load: {getattr(e, 'reason', e)}")
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
    original = os.path.join(cache_dir(), f"{key}-src.{ext}")
    out({**preview_of(original, bytes(body), mime, key, variant), "url": url, "host": u.hostname})


def store(ident, machine, stamp):
    """A preview another machine made, from the text file the chat wrote: checked, kept in the cache, the file gone."""
    installed()
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", ident) or not machine or len(stamp) > 8192:
        fail("usage")
    incoming = cache_dir(INCOMING_REL)
    src = os.path.join(incoming, f"{ident}.b64")
    try:
        if not is_plain_file(src) or os.path.getsize(src) > 2 * ASSET_LIMIT:
            fail("no preview to keep")
        with open(src, "rb") as f:
            data = base64.b64decode(f.read(), validate=True)
    except (OSError, ValueError):
        fail("no preview to keep")
    finally:
        remove_entry(src)
        sweep_incoming(incoming)
    if not data.startswith(b"\x89PNG\r\n\x1a\n") or len(data) > ASSET_LIMIT:
        fail("not a PNG preview")
    name, dst = cached(cache_key("remote", machine, stamp))
    try:
        if not is_plain_file(dst):
            remove_entry(dst)
            cache_dir()
            write_new(dst, data)
    finally:
        prune()
    w, h = dims(dst)
    if not w or not h:
        remove_entry(dst)
        fail("not a PNG preview")
    out({"image": f"{CACHE_REL}/{name}", "width": w, "height": h})


def keep(ident, machine, stamp, ext, size, count):
    """Another machine's media file, from the COUNT pieces the chat wrote to incoming/ID-<n>.b64 (shared/helper.js
    mediaOriginal): put together in the cache as <key>.EXT when exactly SIZE bytes, the pieces gone either way. COUNT 0
    asks only whether the cache has it already. {path} (absolute: `open` and `reveal` take it) or {missing: true}."""
    installed()
    if (not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", ident) or not machine or len(stamp) > 8192 or ext not in MEDIA
            or not size.isdigit() or not count.isdigit() or int(size) > LARGE_FILE or int(count) > 64):
        fail("usage")
    size, count = int(size), int(count)
    name = f"{cache_key('original', machine, stamp)}.{ext}"
    dst = os.path.join(cache_dir(), name)
    incoming = cache_dir(INCOMING_REL)
    parts = [os.path.join(incoming, f"{ident}-{i}.b64") for i in range(count)]
    try:
        if is_plain_file(dst) and os.path.getsize(dst) == size:
            os.utime(dst)  # in use: the last to be pruned
            out({"path": dst})
            return
        if not count:
            out({"missing": True})
            return
        tmp = f"{dst}.{os.getpid()}.tmp"
        remove_entry(tmp)
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
        try:
            with os.fdopen(fd, "wb") as f:
                for part in parts:
                    if not is_plain_file(part) or os.path.getsize(part) > 4 << 20:
                        fail("a piece of the file is missing")
                    with open(part, "rb") as p:
                        f.write(base64.b64decode(p.read(), validate=True))
                    if f.tell() > size:
                        fail("the file is larger than it said")
            if os.path.getsize(tmp) != size:
                fail("the file is not the size it said")
            cache_dir()
            os.replace(tmp, dst)
        except ValueError:
            fail("a piece of the file is not base64")
        finally:
            remove_entry(tmp)
    finally:
        for part in parts:
            remove_entry(part)
        sweep_incoming(incoming)
        prune()
    out({"path": dst})


def sweep_incoming(incoming):
    """What a failed call left in incoming/: links, and files older than INCOMING_KEEP."""
    now = time.time()
    for e in os.scandir(incoming):
        try:
            if e.is_symlink() or now - e.stat(follow_symlinks=False).st_mtime > INCOMING_KEEP:
                remove_entry(e.path)
        except OSError:
            pass


def realpath_cmd(path):
    installed()
    if not path.startswith("/") or "\0" in path:
        fail("path not allowed")
    home = os.path.realpath(APP_HOME)
    real = os.path.realpath(path)
    # The canonical app home itself, or anything in it (Colours compares the two); nothing outside.
    if os.path.commonpath([real, home]) != home:
        fail("outside the app home")
    out({"path": real})


def open_media(path, reveal=False):
    real, _, _ = media_file(path)
    argv = ["/usr/bin/open"] + (["-R"] if reveal else []) + [real]
    ok = tool(argv)
    out({"ok": ok} if ok else {"error": "open failed"})


CODEX_ISOLATION = ["-c", "features.hooks=false", "-c", "notify=[]", "--disable", "plugins", "--disable", "apps"]
MODELS_SECONDS = 20
MODELS_MAX = 40


def codex_guard():
    """The shared MCP guard (codex_guard.py beside this file; -I keeps this folder off sys.path, so by its path)."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("codex_guard", os.path.join(os.path.dirname(os.path.abspath(__file__)), "codex_guard.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def models(kind):
    """Codex's model list from its own app-server: initialize, then model/list (paged), nothing else."""
    if kind != "codex":
        fail("models: codex only")
    exe = shutil.which("codex")
    if not exe:
        out({"error": "codex is not on this app's PATH"})
        return
    # Every MCP server the child would load is turned off, or Codex doesn't start at all (audit H11).
    guard = codex_guard()
    try:
        mcp_off = guard.mcp_off_flags(dict(os.environ), tempfile.gettempdir())
    except guard.Refused as e:
        out({"error": "Codex's config can't be checked, so Codex wasn't started: %s" % e})
        return
    try:
        p = subprocess.Popen([exe, "app-server", *CODEX_ISOLATION, *mcp_off], stdin=subprocess.PIPE,
                             stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, cwd=tempfile.gettempdir(),
                             start_new_session=True)
    except OSError as e:
        out({"error": "can't start codex app-server (%s)" % e.strerror})
        return
    end = time.monotonic() + MODELS_SECONDS
    buf = b""

    def send(obj):
        p.stdin.write((json.dumps(obj) + "\n").encode())
        p.stdin.flush()

    def answer(want):
        nonlocal buf
        while time.monotonic() < end:
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                try:
                    msg = json.loads(line)
                except ValueError:
                    continue
                if isinstance(msg, dict) and msg.get("id") == want:
                    return msg
            r, _, _ = select.select([p.stdout], [], [], max(0.0, min(0.5, end - time.monotonic())))
            if r:
                chunk = os.read(p.stdout.fileno(), 65536)
                if not chunk:
                    return None
                buf += chunk
        return None

    found = []
    error = None
    try:
        send({"id": 1, "method": "initialize", "params": {"clientInfo": {"name": "pdk-helper", "version": "1"}}})
        init = answer(1)
        if not init or "result" not in init:
            error = "codex app-server did not start" if not init else str(init.get("error", {}).get("message", "initialize failed"))[:200]
        else:
            send({"method": "initialized"})
            cursor = None
            for page in range(5):
                send({"id": 2 + page, "method": "model/list", "params": {"cursor": cursor} if cursor else {}})
                r = answer(2 + page)
                if not r or "result" not in r:
                    error = "no model list in %ds" % MODELS_SECONDS if not r else str(r.get("error", {}).get("message", "model/list failed"))[:200]
                    break
                for m in r["result"].get("data") or []:
                    if not isinstance(m, dict) or m.get("hidden") or not isinstance(m.get("id"), str):
                        continue
                    efforts = [e.get("reasoningEffort") for e in m.get("supportedReasoningEfforts") or [] if isinstance(e, dict)]
                    found.append({"id": m["id"][:80], "label": str(m.get("displayName") or m["id"])[:80],
                                  "description": str(m.get("description") or "")[:200],
                                  "efforts": [e for e in efforts if isinstance(e, str) and re.match(r"^[a-z]{1,16}$", e)],
                                  "defaultEffort": m.get("defaultReasoningEffort") if isinstance(m.get("defaultReasoningEffort"), str) else None,
                                  "isDefault": m.get("isDefault") is True})
                cursor = r["result"].get("nextCursor")
                if not cursor or len(found) >= MODELS_MAX:
                    break
    except (OSError, ValueError) as e:
        error = "codex app-server: %s" % e
    finally:
        try:
            p.terminate()
            p.wait(timeout=3)
        except Exception:
            p.kill()
    if error and not found:
        out({"error": error})
    else:
        out({"models": found[:MODELS_MAX]})


NAMES_MAX = 300


def names(kind, cwd):
    """The names of an agent's custom "/" commands and skills (owner request 30), never their contents: Claude's
    .claude/commands/**/*.md (a folder makes a "folder:name" namespace) and .claude/skills/<name>/SKILL.md, in the
    project folder `cwd` and the user's home; Codex's $CODEX_HOME/prompts/*.md as prompts:<name>. Listing only:
    no file is opened. At most NAMES_MAX names."""
    if kind not in ("claude", "codex"):
        fail("names: claude or codex")
    found = []

    def add(name, scope, typ):
        if len(found) < NAMES_MAX and re.match(r"^[A-Za-z0-9._:-]{1,64}$", name):
            found.append({"name": name, "scope": scope, "type": typ})

    def commands(root, scope, prefix="", depth=0):
        try:
            entries = sorted(os.scandir(root), key=lambda e: e.name)
        except OSError:
            return
        for e in entries:
            if e.name.startswith("."):
                continue
            if e.name.endswith(".md") and e.is_file():
                add(prefix + e.name[:-3], scope, "command")
            elif depth < 2 and e.is_dir():
                commands(e.path, scope, prefix + e.name + ":", depth + 1)

    def skills(root, scope):
        try:
            entries = sorted(os.scandir(root), key=lambda e: e.name)
        except OSError:
            return
        for e in entries:
            if not e.name.startswith(".") and e.is_dir() and os.path.isfile(os.path.join(e.path, "SKILL.md")):
                add(e.name, scope, "skill")

    if kind == "claude":
        places = [(os.path.join(cwd, ".claude"), "project")] if os.path.isabs(cwd) and os.path.realpath(cwd) != HOME else []
        places.append((os.path.join(HOME_AS_GIVEN, ".claude"), "user"))
        for base, scope in places:
            commands(os.path.join(base, "commands"), scope)
            skills(os.path.join(base, "skills"), scope)
    else:
        home = os.environ.get("CODEX_HOME") or os.path.join(HOME_AS_GIVEN, ".codex")
        try:
            entries = sorted(os.scandir(os.path.join(home, "prompts")), key=lambda e: e.name)
        except OSError:
            entries = []
        for e in entries:
            if e.name.endswith(".md") and not e.name.startswith(".") and e.is_file():
                add("prompts:" + e.name[:-3], "user", "command")
    out({"names": found})


def main(argv):
    if not argv:
        fail("command")
    cmd, args = argv[0], argv[1:]
    table = {"motion": (motion, 0), "start": (start, 1), "tty": (tty, 1), "held": (held, 1), "read": (read, 5), "rows": (rows, 3),
             "first": (first, 1), "procs": (procs, 1),
             "slim": (slim, 2), "media": (media, 3), "inline": (inline, 4),
             "open": (open_media, 1), "reveal": (lambda p: open_media(p, True), 1),
             "fetch": (fetch, 2), "store": (store, 3), "keep": (keep, 6), "realpath": (realpath_cmd, 1), "models": (models, 1), "names": (names, 2)}
    if cmd not in table or len(args) != table[cmd][1]:
        fail("usage")
    table[cmd][0](*args)


if __name__ == "__main__":
    main(sys.argv[1:])
