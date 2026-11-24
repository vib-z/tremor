#!/usr/bin/env python3
"""tremor's chat helper: the evidence that ties a process to its session, and the new lines of that one session.

One process per call, one JSON line out; a refusal is {"error": "..."} with a non-zero exit. The same text runs as a
file on this Mac (`python3 -I -S pdk-chat.py <command> <json>`) and, on another machine, as that machine's own
`python3 -I -S -c <this text> <command> <json>`: nothing is installed there, nothing is written anywhere, and this
text never looks for itself (no __file__). Python's standard library only. Commands, as adapters/feed.js reads them:

  probe {kind, pid}
    claude  {home, start, registryText}: the process start (`ps -o lstart` in C and UTC, null when it is gone) and
            the text of ~/.claude/sessions/<pid>.json (at most 16 KiB, null when there is none)
    codex   {home, start, held, heads}: the files the process holds under ~/.codex (lsof; null when unreadable), the
            first line (at most 64 KiB) of each held rollout when it holds at most 8, and start null when the process
            changed while they were read
  tail {kind, pid, procStart, session, path, offset, max, align, headLen, wait, marks?, roots?}
    Only a .jsonl whose real path is under this home's .claude/projects/ (claude) or .codex/sessions/ or
    .codex/archived_sessions/ (codex), named for `session`. First the proof: the process start still equals
    procStart; Claude's registry still names `session` for this pid; Codex still holds `path` (and, given `marks`,
    the same rollouts and thread locks under ~/.codex, relative to it; given `roots`, the held conversations it was
    chosen among, `path` is still the only one written last). Any of these false:
    {rebind: true}, no lines. Else whole lines from `offset` as pdk-helper.py's `read` gives them: {dev, ino, size,
    head, headLen, start, next, eof, lines: [[offset, text]], skipped: [[offset, length]], missing?, shrunk?}. With
    no whole new line and `wait` > 0 (ms, at most 10000) it looks again about every 150 ms until the file grows or
    is replaced, the proof fails (Codex's held files at most every 3 s) or the time is up, then answers.
    Always `proved: true`: the answer checked the process and its session itself.

  slim {kind, pid, procStart, session, path, offset, marks?, roots?}
    One session line too long for a tail, under the tail's proof: {record} with inline image payloads emptied (their
    sizes in pdk_bytes, as pdk-helper.py `slim`), other long strings cut; {rebind: true} when the proof fails.
  media {path, variant, force}
    A preview of one media file a session names (pdk-helper.py `media`'s rules): {kind, size, path, real, srcWidth?,
    srcHeight?, png, width, height, stamp}; {missing, path}; {..., large} over 25 MB unless force; {kind, size, ...}
    for HTML (never rendered); {..., image: null, reason} with no preview (noTools: no sips or qlmanage here).
  piece {path, offset, length}
    Up to 2.8 MB of one media file (the same kinds and rules, at most 25 MB), for a copy on the caller's machine:
    {kind, size, ext, stamp, offset, data}; {missing: true}; {large: true, size}.
  inline {path, offset, index, variant}
    The index-th inline image of the line at offset in an allowed session file: {mime, bytes, srcWidth, srcHeight,
    png, width, height, stamp}. `png` is base64, at most about 2.9 MB (a `view` is made smaller to fit).

Read, and nothing else: that pid's registry file, the names of the files the process holds under ~/.codex, the
first line of held rollouts, the one proven session file, and for media the one file a request names. No folder is
listed. Written: only media's private temp folder, removed in the same call. macOS only: anywhere else, or without
/bin/ps or /usr/sbin/lsof, the answer is a refusal that says the session can't be proven there.
"""
import base64
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import unicodedata

sys.dont_write_bytecode = True

HOME_GIVEN = os.path.expanduser("~")
HOME = os.path.realpath(HOME_GIVEN)
ROOTS = {"claude": (".claude/projects",), "codex": (".codex/sessions", ".codex/archived_sessions")}
PS, LSOF = "/bin/ps", "/usr/sbin/lsof"
ENV = {"LC_ALL": "C", "TZ": "UTC", "PATH": "/bin:/usr/bin"}
REGISTRY_MAX = 16 << 10
HEAD_MAX = 64 << 10
HEADS = 8
HELD_MAX = 512           # Codex holds a handful; more under ~/.codex is not a process this can tell about
READ_MAX = 2 << 20
OUT_MAX = (4 << 20) - (64 << 10)
WAIT_MAX = 10000
POLL = 0.15
HOLD_EVERY = 3.0
CHUNK = 1 << 20
LOOK_BACK = 16 << 20     # how far back the first read looks for the start of the line it landed in
SKIP_MAX = 50000         # skipped-line descriptors in one answer (about 1 MB of JSON at most)
SCAN_MAX = 64 << 20      # bytes of skipped lines one answer passes over; the next read goes on from its cursor


def out(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n")


class Refused(Exception):
    pass


def need(tool):
    if sys.platform != "darwin":
        raise Refused("can't prove the session on this machine: tremor's chat reads macOS machines only")
    if not os.access(tool, os.X_OK):
        raise Refused(f"can't prove the session on this machine: it has no {tool}")


def proc_start(pid):
    need(PS)
    r = subprocess.run([PS, "-o", "lstart=", "-p", str(pid)], capture_output=True, text=True, env=ENV, timeout=5)
    text = r.stdout.strip()[:256]
    return text if r.returncode == 0 and text else None


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except PermissionError:
        return True
    except OSError:
        return False


def registry_text(pid):
    try:
        with open(os.path.join(HOME, ".claude", "sessions", f"{pid}.json"), "rb") as f:
            raw = f.read(REGISTRY_MAX + 1)
    except OSError:
        return None
    return raw.decode("utf-8", "replace") if len(raw) <= REGISTRY_MAX else None


def held_real(pid):
    """The real paths the process holds open under ~/.codex, or None when they can't be read or are too many."""
    need(LSOF)
    root = os.path.join(HOME, ".codex") + os.sep
    given = os.path.join(HOME_GIVEN, ".codex") + os.sep
    r = subprocess.run([LSOF, "-nP", "-a", "-d", "0-65535", "-Fn", "-p", str(pid)],
                       capture_output=True, text=True, env=ENV, timeout=10)
    if r.returncode != 0 and not r.stdout:
        return None
    files = set()
    for line in r.stdout.splitlines():
        name = line[1:] if line.startswith("n") else None
        if name and (name.startswith(root) or name.startswith(given)):
            files.add(root + name[len(root if name.startswith(root) else given):])
    return sorted(files) if len(files) <= HELD_MAX else None


def rollout_thread(path):
    """The thread a rollout's name says (rollout-<19 char time>-<thread>[_<rollout>].jsonl), or None."""
    base = os.path.basename(path)
    if not base.startswith("rollout-") or not base.endswith(".jsonl"):
        return None
    rest = base[8:-6]
    if len(rest) < 21 or rest[19] != "-":
        return None
    thread = rest[20:].split("_")[0]
    return thread.lower() or None


def project_key(folder):
    """Claude Code's project folder name for a working directory: adapters/binding.js projectKey, which counts UTF-16
    code units after NFC (as JavaScript strings do), with the CLI's hash suffix past 200 of them."""
    units = unicodedata.normalize("NFC", str(folder)).encode("utf-16-le", "surrogatepass")
    codes = [int.from_bytes(units[i:i + 2], "little") for i in range(0, len(units), 2)]
    out = "".join(chr(c) if (48 <= c <= 57) or (65 <= c <= 90) or (97 <= c <= 122) else "-" for c in codes)
    if len(codes) <= 200:
        return out
    h = 0
    for c in codes:
        h = (h * 31 + c) & 0xFFFFFFFF
    h = abs(h - (1 << 32) if h >= 1 << 31 else h)
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    b36 = ""
    while True:
        h, r = divmod(h, 36)
        b36 = digits[r] + b36
        if not h:
            break
    return out[:200] + "-" + b36


def allowed(kind, path):
    if not isinstance(path, str) or not path.endswith(".jsonl"):
        return None
    real = os.path.realpath(path)
    for root in ROOTS.get(kind, ()):
        if real.startswith(os.path.join(HOME, root) + os.sep):
            return real
    return None


def first_line(real):
    try:
        with open(real, "rb", buffering=0) as f:  # unbuffered: readline stops at the newline, nothing after is read
            line = f.readline(HEAD_MAX + 1)
    except OSError:
        return None
    return line[:-1].decode("utf-8", "replace") if line.endswith(b"\n") else None


def written(real):
    try:
        st = os.stat(real)
    except OSError:
        return None
    return {"size": st.st_size, "mtimeMs": st.st_mtime_ns // 1_000_000}


def probe(req):
    kind, pid = req.get("kind"), as_pid(req.get("pid"))
    if kind == "claude":
        return {"home": HOME_GIVEN, "start": proc_start(pid), "registryText": registry_text(pid)}
    if kind == "codex":
        # The same process before and after its files are read: a pid reused meanwhile would hold another's files.
        start = proc_start(pid)
        real = held_real(pid)
        given = lambda p: os.path.join(HOME_GIVEN, os.path.relpath(p, HOME))
        rollouts = [p for p in (real or []) if rollout_thread(p) and allowed("codex", p)]
        heads = {given(p): first_line(p) for p in rollouts} if len(rollouts) <= HEADS else {}
        # When it holds several conversations, the one it is in is the one it wrote last (binding.js decides).
        stats = {given(p): written(p) for p in rollouts} if len(rollouts) <= HEADS else {}
        after = proc_start(pid)
        return {"home": HOME_GIVEN, "start": start if start and after == start else None,
                "held": None if real is None else [given(p) for p in real], "heads": heads, "stats": stats}
    raise Refused(f"unknown kind {kind!r}")


def as_pid(v):
    if isinstance(v, bool) or not isinstance(v, (int, str)) or not str(v).isdigit() or int(v) <= 0:
        raise Refused("pid")
    return int(v)


def as_int(v, name):
    if isinstance(v, bool) or not isinstance(v, int):
        raise Refused(name)
    return v


# ---- tail ----

def line_start(f, at):
    """Where the line holding byte `at` starts, looking back at most LOOK_BACK bytes; None past that."""
    end = at
    while end > 0 and at - end < LOOK_BACK:
        lo = max(0, end - CHUNK)
        f.seek(lo)
        b = f.read(end - lo)
        nl = b.rfind(b"\n")
        if nl >= 0:
            return lo + nl + 1
        end = lo
    return 0 if end == 0 else None


def newline_at(f, at):
    """The offset of the next newline at or after `at`, without keeping the bytes; None at the end of the file."""
    # ponytail: an unbounded forward scan over one huge line; a resumable skip cursor if such lines ever get common
    f.seek(at)
    step = 4096  # short lines are found without reading a whole chunk each
    while True:
        b = f.read(step)
        if not b:
            return None
        nl = b.find(b"\n")
        if nl >= 0:
            return at + nl
        at += len(b)
        step = min(step * 4, CHUNK)


def read(real, offset, limit, align, headlen):
    """pdk-helper.py's `read`: whole lines only, a line longer than `limit` listed in `skipped`, the first read
    (align) starting after the line it landed in. `ends` (not sent) holds where each line's bytes end."""
    try:
        f = open(real, "rb")
    except FileNotFoundError:
        return {"missing": True}, []
    with f:
        st = os.fstat(f.fileno())
        first = f.read(headlen)
        r = {"dev": st.st_dev, "ino": st.st_ino, "size": st.st_size, "head": hashlib.sha1(first).hexdigest(),
             "headLen": len(first), "lines": [], "skipped": [], "eof": False}
        ends = []
        if offset < 0:
            offset = max(0, st.st_size + offset)
        if offset > st.st_size:
            r.update(start=offset, next=offset, shrunk=True)  # shorter than the cursor: shrunk or replaced
            return r, ends
        pos = offset
        if align and offset > 0:
            # Start after the line we landed in, listed in `skipped` when whole, so a local caller can still get it.
            landed = line_start(f, offset - 1)
            nl = newline_at(f, offset - 1)
            if nl is None:  # one line still being written fills the window: its rest comes as a torn line, dropped
                r.update(start=st.st_size, next=st.st_size, eof=True)
                return r, ends
            if nl > offset - 1 and landed is not None:
                r["skipped"].append([landed, nl - landed])
            pos = nl + 1
        r["start"] = pos
        used = scanned = 0
        while used < limit:
            if len(r["skipped"]) >= SKIP_MAX or scanned >= SCAN_MAX:
                break  # enough said for one answer: `next` is where the next read goes on
            f.seek(pos)
            buf = f.read(limit - used)
            if not buf:
                r["eof"] = True
                break
            if buf.find(b"\n") < 0:
                if r["lines"]:
                    # The next line does not fit this answer, or is still being written (the file ended first).
                    r["eof"] = len(buf) < limit - used
                    break
                end = newline_at(f, pos + len(buf))
                if end is None:
                    r["eof"] = True  # a line still being written: left for later, nothing consumed
                    break
                r["skipped"].append([pos, end - pos])  # a whole line longer than the limit
                scanned += end + 1 - pos
                pos = end + 1
                continue
            cut = 0
            while True:
                nl = buf.find(b"\n", cut)
                if nl < 0:
                    break
                r["lines"].append([pos + cut, buf[cut:nl].decode("utf-8", "replace")])
                ends.append(pos + nl + 1)
                cut = nl + 1
            used += cut
            pos += cut
        r["next"] = pos
        return r, ends


def bounded(r, ends):
    """The answer's text, under OUT_MAX: lines that don't fit are left for the next read (a lone one is skipped)."""
    text = json.dumps(r, ensure_ascii=False, separators=(",", ":"))
    while len(text.encode("utf-8")) > OUT_MAX and r.get("lines"):
        keep = len(r["lines"]) // 2
        if keep:
            r["next"] = r["lines"][keep][0]
            del r["lines"][keep:], ends[keep:]
        else:
            off = r["lines"][0][0]
            r["skipped"].append([off, ends[0] - 1 - off])
            r["next"] = ends[0]
            r["lines"], ends[:] = [], []
        r["skipped"] = [s for s in r["skipped"] if s[0] < r["next"]]
        r["eof"] = False
        text = json.dumps(r, ensure_ascii=False, separators=(",", ":"))
    return text


def ident(real):
    try:
        st = os.stat(real)
        return (st.st_dev, st.st_ino, st.st_size)
    except OSError:
        return None


def proof(req):
    """The checks a tail or a slim makes before reading `path`: (kind, pid, real, proven, registry_ok, holds)."""
    kind, pid = req.get("kind"), as_pid(req.get("pid"))
    session = req.get("session")
    proc = req.get("procStart")
    real = allowed(kind, req.get("path"))
    if not real or not isinstance(session, str) or not isinstance(proc, str):
        raise Refused("path not allowed")
    base = os.path.basename(real).lower()
    named = base == session.lower() + ".jsonl" if kind == "claude" else rollout_thread(real) == session.lower()
    if not named:
        raise Refused("path not allowed: not that session's file")

    def registry_ok():
        # The whole proof bindClaude makes: this pid, this session, this process's start, and the file read is the
        # one the entry names (its folder's project key), compared as real paths.
        try:
            e = json.loads(registry_text(pid) or "")
        except ValueError:
            return False
        if not isinstance(e, dict) or str(e.get("pid")) != str(pid) or e.get("procStart") != proc:
            return False
        sid, cwd = e.get("sessionId"), e.get("cwd")
        if not isinstance(sid, str) or sid.lower() != session.lower() or not isinstance(cwd, str) or not cwd:
            return False
        named = os.path.join(HOME_GIVEN, ".claude", "projects", project_key(cwd), f"{sid}.jsonl")
        return os.path.realpath(named) == real

    marks = req.get("marks")
    if marks is not None and (not isinstance(marks, list) or not all(isinstance(m, str) for m in marks)):
        raise Refused("marks")
    codex_root = os.path.join(HOME, ".codex") + os.sep
    roots = req.get("roots")
    if roots is not None and (not isinstance(roots, list) or not all(isinstance(x, str) for x in roots)):
        raise Refused("roots")
    roots = None if roots is None else [x for x in (allowed("codex", x) for x in roots) if x]

    def written_last(held_now):
        # Bound among several held conversations: still the one written last, alone (binding.js bindCodex).
        times = {x: (written(x) or {}).get("mtimeMs") for x in roots if x in held_now}
        if real not in times or None in times.values():
            return False
        return [t for t in times.values() if t >= times[real]] == [times[real]]

    def holds():
        # Codex: still the file, and (when the caller says what it was bound on) the same rollouts and thread locks,
        # so a /clear, which takes a new thread's lock while the old rollout stays open, answers rebind.
        now = held_real(pid) or []
        if real not in now:
            return False
        if roots and not written_last(now):
            return False
        if marks is None:
            return True
        rel = [p[len(codex_root):] for p in now]
        mine = sorted(r for r in rel if (r.startswith(("sessions/", "archived_sessions/")) and r.endswith(".jsonl")) or r.startswith("thread-writer-locks/"))
        return mine == sorted(marks)

    proven = lambda: proc_start(pid) == proc and (registry_ok() if kind == "claude" else holds())
    return kind, pid, real, proven, registry_ok, holds


def tail(req):
    kind, pid, real, proven, registry_ok, holds = proof(req)
    offset = as_int(req.get("offset"), "offset")
    limit = max(1, min(as_int(req.get("max"), "max"), READ_MAX))
    headlen = max(1, min(as_int(req.get("headLen"), "headLen"), 65536))
    align = bool(req.get("align"))
    wait = max(0, min(as_int(req.get("wait", 0), "wait"), WAIT_MAX)) / 1000
    deadline = time.monotonic() + wait
    while True:
        if not proven():
            return {"rebind": True, "proved": True}
        checked = time.monotonic()
        r, ends = read(real, offset, limit, align, headlen)
        if r.get("lines") or r.get("skipped") or r.get("shrunk") or time.monotonic() >= deadline:
            r["proved"] = True
            return bounded(r, ends)
        # Nothing whole and new: watch the file, cheaply, until it changes or the time is up.
        mark = ident(real)
        changed = False
        while not changed and time.monotonic() < deadline:
            time.sleep(min(POLL, max(0, deadline - time.monotonic())))
            if not alive(pid) or (kind == "claude" and not registry_ok()):
                changed = True  # proven() above says how
            elif kind == "codex" and time.monotonic() - checked >= HOLD_EVERY:
                checked = time.monotonic()
                changed = not holds()
            changed = changed or ident(real) != mark
        if not changed:
            r["proved"] = True
            return bounded(r, ends)


# ---- media: a preview of a file a session names, or of an image a session file holds ----
# The rules pdk-helper.py's `media` and `inline` keep on this Mac: allow-listed kinds, a regular file that is not
# executable, the same size limits. The preview is made with this machine's own sips and qlmanage in a private
# folder made for this call (mkdtemp, mode 700) and removed before the answer: the one thing this helper writes.
# The answer carries the PNG as base64 (`png`) with `stamp`, which names this exact file and variant; the caller
# keeps it in its own cache.
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
MAX_INLINE_LINE = 48 << 20  # longest transcript line `inline` parses
PNG_MAX = 2_900_000         # base64 of this, with the facts, stays under the 4 MiB answer
TOOL_SECONDS = 20
SIPS, QLMANAGE = "/usr/bin/sips", "/usr/bin/qlmanage"
NO_TOOLS = "can't make a preview on this machine"


def tool(argv):
    try:
        r = subprocess.run(argv, capture_output=True, text=True, timeout=TOOL_SECONDS,
                           env={"PATH": "/usr/bin:/bin:/usr/sbin", "HOME": HOME_GIVEN, "LC_ALL": "C"})
        return r.returncode == 0
    except (subprocess.TimeoutExpired, OSError):
        return False


def dims(path):
    try:
        r = subprocess.run([SIPS, "-g", "pixelWidth", "-g", "pixelHeight", path], capture_output=True,
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


def can_preview():
    return sys.platform == "darwin" and os.access(SIPS, os.X_OK) and os.access(QLMANAGE, os.X_OK)


def preview(kind, src, side):
    """A PNG of src at most `side` pixels on its long side, smaller when it would not fit the answer: (bytes, w, h)
    or None. Made in a private folder that is gone when this returns."""
    tmp = tempfile.mkdtemp(prefix="pdk-chat-")
    try:
        while True:
            made = None
            if kind in ("video", "pdf"):  # Quick Look: a video's poster frame, a PDF's first page
                if tool([QLMANAGE, "-t", "-s", str(side), "-o", tmp, src]):
                    made = os.path.join(tmp, os.path.basename(src) + ".png")
            else:
                w, h = dims(src)
                argv = [SIPS, "-s", "format", "png"]
                if not w or not h or max(w, h) > side:
                    argv += ["-Z", str(side)]
                made = os.path.join(tmp, f"out-{side}.png")
                if not tool(argv + [src, "--out", made]):
                    made = None
            if not made or not os.path.isfile(made) or os.path.islink(made):
                return None
            size = os.path.getsize(made)
            if size <= PNG_MAX:
                w, h = dims(made)
                with open(made, "rb") as f:
                    data = f.read()
                return (data, w, h) if w and h else None
            if side <= 240:
                return None
            os.remove(made)
            side = int(side * 0.7)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def with_png(info, made):
    if not made:
        return {**info, "image": None, "reason": "no preview"}
    data, w, h = made
    return {**info, "png": base64.b64encode(data).decode("ascii"), "width": w, "height": h}


def media_file(path):
    """(path, real, stat, kind, ext) of an allow-listed media file, None when it is missing, else a refusal."""
    if not isinstance(path, str):
        raise Refused("usage")
    if path.startswith("~/"):
        path = os.path.join(HOME_GIVEN, path[2:])
    if not path.startswith("/") or "\0" in path:
        raise Refused("path not allowed")
    real = os.path.realpath(path)
    ext = real.rsplit(".", 1)[-1].lower() if "." in os.path.basename(real) else ""
    if ext not in MEDIA:
        raise Refused("not a media file")
    try:
        st = os.stat(real)
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(st.st_mode):
        raise Refused("not a regular file")
    if st.st_mode & 0o111:
        raise Refused("executable file")
    return path, real, st, MEDIA[ext], ext


def media(req):
    path, variant, force = req.get("path"), req.get("variant"), req.get("force")
    if variant not in SIZES:
        raise Refused("usage")
    found = media_file(path)
    if not found:
        return {"missing": True, "path": path}
    path, real, st, kind, _ = found
    info = {"kind": kind, "size": st.st_size, "path": path, "real": real}
    if kind == "html":
        return info
    if kind in ("image", "pdf") and st.st_size > LARGE_FILE and force not in (True, 1, "1"):
        return {**info, "large": True}
    if not can_preview():
        return {**info, "image": None, "reason": NO_TOOLS, "noTools": True}
    if kind == "image":
        info["srcWidth"], info["srcHeight"] = dims(real)
    info["stamp"] = json.dumps(["file", real, st.st_size, st.st_mtime_ns, st.st_ino, variant])
    return with_png(info, preview(kind, real, SIZES[variant]))


DATA_URL = re.compile(r"^data:(image/[\w.+-]+)((?:;[\w-]+=[^;,]*)*);base64,", re.I)


def image_slots(node):
    """Inline images in the order adapters/media.js counts them (pdk-helper.py `images`): (holder, key, mime, data,
    block). A block is {type: image, source: {type: base64, data}} (holder: its source); else a data URL string."""
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


def images(node):
    return [(mime, data) for _, _, mime, data, _ in image_slots(node)]


def session_line(real, offset):
    """The whole line at `offset` (a line start) of an allowed session file, as bytes."""
    with open(real, "rb") as f:
        if offset < 0 or offset > os.fstat(f.fileno()).st_size:
            raise Refused("offset")
        if offset > 0:
            f.seek(offset - 1)
            if f.read(1) != b"\n":
                raise Refused("not a line start")
        end = None
        at = offset
        f.seek(at)
        while at - offset <= MAX_INLINE_LINE:
            b = f.read(CHUNK)
            if not b:
                break
            nl = b.find(b"\n")
            if nl >= 0:
                end = at + nl
                break
            at += len(b)
        if end is None:
            raise Refused("line too long" if at - offset > MAX_INLINE_LINE else "no whole line")
        f.seek(offset)
        return f.read(end - offset)


def inline(req):
    path, offset, index, variant = req.get("path"), req.get("offset"), req.get("index"), req.get("variant")
    if variant not in SIZES:
        raise Refused("usage")
    offset, index = as_int(offset, "offset"), as_int(index, "index")
    real = allowed("claude", path) or allowed("codex", path)
    if not real:
        raise Refused("path not allowed")
    try:
        line = session_line(real, offset)
    except FileNotFoundError:
        return {"missing": True}
    try:
        found = images(json.loads(line))
    except ValueError:
        raise Refused("not json")
    if index < 0 or index >= len(found):
        raise Refused("no such image")
    mime, data = found[index]
    ext = INLINE_TYPES.get(mime)
    if not ext:
        raise Refused("image type")
    try:
        raw = base64.b64decode(data, validate=False)
    except ValueError:
        raise Refused("bad image data")
    info = {"mime": mime, "bytes": len(raw)}
    if not can_preview():
        return {**info, "image": None, "reason": NO_TOOLS, "noTools": True}
    tmp = tempfile.mkdtemp(prefix="pdk-chat-")
    try:
        src = os.path.join(tmp, f"image.{ext}")
        fd = os.open(src, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(raw)
        info["srcWidth"], info["srcHeight"] = dims(src)
        info["stamp"] = json.dumps(["inline", real, offset, index, hashlib.sha1(line).hexdigest(), variant])
        made = preview("image", src, SIZES[variant])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    if not made:
        raise Refused("no preview")
    return with_png(info, made)


SLIM_TEXT = 8000
SLIM_ANSWER = (4 << 20) - (64 << 10)


def slim(req):
    """One session line too long for a tail (a pasted screenshot), as pdk-helper.py `slim` gives it: the record with
    inline image payloads emptied and their sizes kept (pdk_bytes), other strings over SLIM_TEXT characters cut.
    Under the tail's proof: {rebind: true} when it fails."""
    kind, pid, real, proven, _, _ = proof(req)
    offset = as_int(req.get("offset"), "offset")
    if not proven():
        return {"rebind": True, "proved": True}
    try:
        record = json.loads(session_line(real, offset))
    except FileNotFoundError:
        return {"missing": True, "proved": True}
    except ValueError:
        raise Refused("not json")
    for holder, key, mime, data, block in image_slots(record):
        size = len(data) * 3 // 4
        if block:
            holder["data"] = ""
            holder["pdk_bytes"] = size
        elif holder is not None:
            holder[key] = f"data:{mime};pdk-bytes={size};base64,"

    def cut(v, n):
        if isinstance(v, str):
            return v if len(v) <= n else v[:n] + "…"
        if isinstance(v, list):
            return [cut(x, n) for x in v]
        if isinstance(v, dict):
            return {k: cut(x, n) for k, x in v.items()}
        return v

    for n in (SLIM_TEXT, SLIM_TEXT // 8):
        text = json.dumps({"record": cut(record, n), "proved": True}, ensure_ascii=True, separators=(",", ":"))
        if len(text) <= SLIM_ANSWER:
            return text
    raise Refused("record too large")


PIECE_MAX = 2_800_000  # bytes of a file in one answer (base64 of it stays under the 4 MiB bound)


def piece(req):
    """Part of one media file a session names, for a copy on the caller's machine (shared/helper.js mediaOriginal):
    {kind, size, ext, stamp, offset, data (base64)}; {missing: true}; {large: true, size} over LARGE_FILE. `stamp`
    names this exact file, so the caller can tell a file that changed between pieces."""
    found = media_file(req.get("path"))
    if not found:
        return {"missing": True}
    _, real, st, kind, ext = found
    if st.st_size > LARGE_FILE:
        return {"large": True, "size": st.st_size, "kind": kind}
    offset = as_int(req.get("offset", 0), "offset")
    length = max(0, min(as_int(req.get("length", PIECE_MAX), "length"), PIECE_MAX))
    if offset < 0 or offset > st.st_size:
        raise Refused("offset")
    with open(real, "rb") as f:
        f.seek(offset)
        data = f.read(length)
    stamp = json.dumps(["original", real, st.st_size, st.st_mtime_ns, st.st_ino])
    return {"kind": kind, "size": st.st_size, "ext": ext, "stamp": stamp, "offset": offset, "data": base64.b64encode(data).decode("ascii")}


COMMANDS = {"probe": probe, "tail": tail, "slim": slim, "media": media, "inline": inline, "piece": piece}


def main(argv):
    try:
        if len(argv) != 2 or argv[0] not in COMMANDS:
            raise Refused("usage: probe|tail|slim|media|inline|piece <json>")
        try:
            req = json.loads(argv[1])
        except ValueError:
            raise Refused("the request is not JSON")
        if not isinstance(req, dict):
            raise Refused("the request is not an object")
        answer = COMMANDS[argv[0]](req)
    except Refused as e:
        out({"error": str(e)})
        return 2
    except Exception as e:  # never a traceback for an answer
        out({"error": f"{type(e).__name__}: {e}"})
        return 3
    sys.stdout.write(answer + "\n" if isinstance(answer, str) else json.dumps(answer, ensure_ascii=False, separators=(",", ":")) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
