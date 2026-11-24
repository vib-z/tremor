#!/usr/bin/python3 -I -S
# The Usage helper. It asks nobody, as CodeNotch does: Claude Code's own /usage in print mode from one fixed scratch
# folder, Codex's account/read + account/rateLimits/read (subject to its fail-closed config guard), and Moshi only
# for providers with neither. Only parsed limit lines and masked identities leave it; Moshi's cost block and every
# id are dropped. A provider that is not installed is absent; one that is installed but can't be read (signed out,
# guarded off, a timeout) is reported as such, so the foot shows its mark and a short state (spec section 4).
#   pdk-usage.py read <scratch folder>
#   pdk-usage.py claude <scratch> <claude> <folder> <label> <seconds> <helper pid>   (the desktop job, desktop_job)
#   pdk-usage.py clean <label> <folder> <job pid>   (its cleaner, desktop_clean)
# On another machine the app runs this same file there with `python3 -c` (see mods/pdk-usage/main.js REMOTE).
import calendar, hashlib, importlib.util, json, os, plistlib, re, secrets, select, shutil, socket, stat, subprocess, sys, tempfile, time
from datetime import datetime, timezone

try:
    from zoneinfo import ZoneInfo
except ImportError:  # Python before 3.9: reset times fall back to this machine's zone
    ZoneInfo = None

CLEAN = {"codex", "claude-code"}  # never silently substitute Moshi for an off/guarded source
ABSENT = "absent"  # not installed here: no card, no line, nothing kept
_host = []
# One deadline for the whole helper: the app ends it at 90 s (mods/pdk-usage/main.js), so every read ends by
# WORK_SECONDS and the desktop job's teardown (desktop_read) has CLEANUP_SECONDS after that.
START = time.time()
WORK_SECONDS = 70
CLEANUP_SECONDS = 10


def left(cap, end=None):
    """`cap` seconds, or what is left before the work deadline if less (`end`: another deadline, from START)."""
    return max(0.0, min(cap, START + (WORK_SECONDS if end is None else end) - time.time()))


def host():
    """This machine's name as Moshi shows it: macOS's local host name (`<name>.local`), else the kernel's."""
    if not _host:
        out, _ = run(["/usr/sbin/scutil", "--get", "LocalHostName"], 5) if os.path.exists("/usr/sbin/scutil") else (None, None)
        _host.append(out.strip() + ".local" if out and out.strip() else socket.gethostname())
    return _host[0]


EMAIL = re.compile(r"([^\s()<>@,;:\"]+)@([^\s()<>@,;:\"]+)")


def account_id(provider, email):
    """A privacy-safe account identity (review UX06): a short hash of the provider and the address, never the address
    or an id. "" says "known: no account" (signed out); None says "not learned"."""
    if not isinstance(email, str) or not email.strip():
        return None
    return hashlib.sha256(f"tremor-usage:{provider}:{email.strip().lower()}".encode()).hexdigest()[:16]


def mask_email(text):
    """'person@example.com' -> 'p•••@e•••.com', as the reference shows. Idempotent."""
    def one(m):
        local, domain = m[1], m[2]
        parts = domain.split(".")
        tld = "." + parts[-1] if len(parts) > 1 else ""
        return f"{local[0]}•••@{domain[0]}•••{tld}"
    return EMAIL.sub(one, text) if isinstance(text, str) else None


ISO = re.compile(r"^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d+))?(Z|[+-]\d\d:?\d\d)?$")


def iso_ms(s):
    """ISO 8601 (Z or offset, any fraction digits) to epoch ms; None when absent or unreadable."""
    m = ISO.match(s) if isinstance(s, str) else None
    if not m:
        return None
    y, mo, d, h, mi, se, frac, tz = m.groups()
    t = calendar.timegm((int(y), int(mo), int(d), int(h), int(mi), int(se), 0, 0, 0))
    if tz and tz != "Z":
        sign = 1 if tz[0] == "+" else -1
        t -= sign * (int(tz[1:3]) * 3600 + int(tz[-2:]) * 60)
    return t * 1000 + int((frac or "0")[:3].ljust(3, "0"))


def num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def plan_words(p):
    """A plan as its source names it, made readable: 'max_20x' -> 'Max 20x', 'prolite' -> 'Prolite'."""
    if not isinstance(p, str) or not p.strip():
        return None
    p = p.strip().replace("_", " ")
    return p[0].upper() + p[1:]


def now_ms():
    return int(time.time() * 1000)


def card(provider, source, **kw):
    c = {"provider": provider, "plan": None, "email": None, "host": host(), "capturedAt": now_ms(), "source": source, "windows": []}
    c.update(kw)
    return c


def run(argv, timeout, cwd=None, env=None, check=True, end=None):
    """(stdout, None) or (None, why). check=False keeps stdout whatever the exit code. The timeout is cut to what is
    left before the deadline (left)."""
    timeout = left(timeout, end)
    if timeout <= 0:
        return None, "out of time"
    try:
        r = subprocess.run(argv, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=timeout, cwd=cwd, env=env)
    except subprocess.TimeoutExpired:
        return None, f"no answer in {timeout:.0f} s"
    except OSError as e:
        return None, e.strerror or "could not start"
    if check and r.returncode != 0:
        return None, f"exit {r.returncode}"
    return r.stdout, None


# ---- Codex: its app-server ------------------------------------------------------------------------------------

def mins_label(mins):
    if mins % 1440 == 0:
        return f"{mins // 1440}d"
    if mins % 60 == 0:
        return f"{mins // 60}h"
    return f"{mins}m"


def codex_rpc(exe, timeout=20):
    """((account, limits), None); on a failure (None, why), or ((account, None), why) when account/read had answered."""
    args = [exe, "app-server", "-c", "features.hooks=false", "-c", "notify=[]", "--disable", "plugins", "--disable", "apps",
            "-c", 'sandbox_mode="workspace-write"', "-c", 'approval_policy="on-request"']
    # Shared bounded TOML guard. An absent, unreadable or ambiguous guard never permits a child.
    try:
        guard = sys.modules.get("pdk_codex_guard")  # the remote bootstrap loads it from its source
        if guard is None:
            path = os.path.join(os.path.dirname(os.path.realpath(__file__)), "codex_guard.py")
            spec = importlib.util.spec_from_file_location("pdk_codex_guard", path)
            guard = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(guard)
        args += guard.mcp_off_flags(dict(os.environ), os.getcwd())
    except Exception as e:
        return None, "isolation guard: " + str(e)
    try:
        p = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=dict(os.environ), cwd=os.getcwd())
    except OSError as e:
        return None, e.strerror or "could not start"
    deadline = time.time() + left(timeout)
    buf = b""
    account = None
    try:
        def send(o):
            p.stdin.write((json.dumps(o) + "\n").encode())
            p.stdin.flush()

        def reply(i):
            nonlocal buf
            while True:
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    try:
                        o = json.loads(line)
                    except ValueError:
                        continue
                    if isinstance(o, dict) and o.get("id") == i:
                        return o
                left = deadline - time.time()
                if left <= 0 or not select.select([p.stdout], [], [], left)[0]:
                    raise TimeoutError
                chunk = os.read(p.stdout.fileno(), 65536)
                if not chunk:
                    raise EOFError
                buf += chunk

        send({"id": 1, "method": "initialize", "params": {"clientInfo": {"name": "pdk-usage", "version": "1"}}})
        reply(1)
        send({"method": "initialized"})
        send({"id": 2, "method": "account/read", "params": {}})
        account = reply(2)
        send({"id": 3, "method": "account/rateLimits/read", "params": {"excludeResetCreditDetails": True}})
        limits = reply(3)
        return (account, limits), None
    except TimeoutError:
        return ((account, None) if account else None), f"request timed out after {timeout:g}s."
    except (EOFError, BrokenPipeError, OSError):
        return ((account, None) if account else None), "app-server ended early"
    finally:
        p.kill()
        p.wait()


def from_codex():
    """(card, None, account) when Codex reported limits; else (None, why, account), why ABSENT when Codex is not
    installed. `account` (account_id) is what the read learned of whose usage it was, even when it then failed."""
    exe = shutil.which("codex")
    if not exe:
        return None, ABSENT, None
    got, why = codex_rpc(exe)
    account, limits = got if got else (None, None)
    acc = ((account or {}).get("result") or {}).get("account") if account else None
    ident = ("" if account else None) if not isinstance(acc, dict) else account_id("codex", acc.get("email"))
    if why:
        return None, why, ident
    if not isinstance(acc, dict) or acc.get("type") != "chatgpt":
        return None, "not signed in" if not isinstance(acc, dict) else "API key: no plan limits", ""
    c = card("codex", "Codex app-server", plan=plan_words(acc.get("planType")), email=mask_email(acc.get("email")), account=ident)
    if "error" in limits:
        return None, "could not read its limits", ident
    snap = (limits.get("result") or {}).get("rateLimits") or {}
    for key in ("primary", "secondary"):
        w = snap.get(key)
        if isinstance(w, dict) and num(w.get("usedPercent")) is not None:
            mins = num(w.get("windowDurationMins"))
            c["windows"].append({"label": mins_label(int(mins)) if mins else key, "used": w["usedPercent"],
                                 "resetsAt": int(w["resetsAt"]) * 1000 if num(w.get("resetsAt")) else None, "mins": mins})
    return (c, None, ident) if c["windows"] else (None, "no limits", ident)


# ---- Claude Code: its own /usage, in print mode ----------------------------------------------------------------
# Ported from CodeNotch (vinzdg/codenotch@835550a342871779135b6484d6899161c5222f7c,
# Sources/Providers/ClaudeUsageCLI.swift: `arguments`, `parse`, `kind(forWeek:)`, `resetDate`), MIT,
# Copyright (c) 2026 Vinz (licenses/MIT-codenotch.txt). Changed: Python; user settings left out (--setting-sources).
# Invocation flags do not prove isolation from the caller's home or session records.

CLAUDE_ARGS = ["--print", "--no-session-persistence", "--strict-mcp-config", "--setting-sources", "project,local", "/usage"]
CLAUDE_LINE = re.compile(r"^Current (?:(session)|week \(([^)]+)\)):\s*(\d+)%\s*used(?:\s*·\s*resets\s*(.+?))?\s*$", re.M)
MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
STAMP = re.compile(r"^([A-Za-z]{3})[a-z]*\.? (\d{1,2}) at (\d{1,2})(?::(\d\d))?\s*([ap]m)$", re.I)


def claude_reset_ms(text, now):
    """'Nov 14 at 2pm (Europe/London)' -> epoch ms. No year is printed: the candidate nearest now, over last year,
    this year and next. 'h:mmpm' and, on the hour, 'hpm'. None when the wording isn't one of those."""
    stamp, zone = text.strip(), None
    if stamp.endswith(")") and "(" in stamp:
        name = stamp[stamp.rindex("(") + 1:-1]
        stamp = stamp[:stamp.rindex("(")].strip()
        try:
            zone = ZoneInfo(name) if ZoneInfo else None
        except Exception:
            zone = None
    m = STAMP.match(stamp)
    if not m or m[1].lower() not in MONTHS:
        return None
    hour = int(m[3]) % 12 + (12 if m[5].lower() == "pm" else 0)
    best = None
    for year in (now.year - 1, now.year, now.year + 1):
        try:
            d = datetime(year, MONTHS[m[1].lower()], int(m[2]), hour, int(m[4] or 0), tzinfo=zone) if zone else datetime(year, MONTHS[m[1].lower()], int(m[2]), hour, int(m[4] or 0)).astimezone()
        except ValueError:
            continue
        if best is None or abs((d - now).total_seconds()) < abs((best - now).total_seconds()):
            best = d
    return int(best.timestamp() * 1000) if best else None


def claude_windows(text, now):
    """The 'Current session' and 'Current week (...)' lines; everything else /usage prints is ignored."""
    windows, seen = [], set()
    for m in CLAUDE_LINE.finditer(text):
        week = (m[2] or "").strip()
        kind = "session" if m[1] else "all" if week.lower() == "all models" else week.lower()
        if kind in seen:
            continue
        seen.add(kind)
        windows.append({"label": "5h" if kind == "session" else "7d" if kind == "all" else week,
                        "used": int(m[3]), "resetsAt": claude_reset_ms(m[4], now) if m[4] else None,
                        "mins": 300 if kind == "session" else 10080, "_order": 0 if kind == "session" else 1 if kind == "all" else 2})
    windows.sort(key=lambda w: w.pop("_order"))
    return windows


def claude_exe():
    """Claude Code as the shell finds it, else where its installers put it (often not on a non-interactive PATH)."""
    for exe in (shutil.which("claude"), os.path.expanduser("~/.local/bin/claude"), os.path.expanduser("~/.claude/local/claude")):
        if exe and os.path.isfile(exe) and os.access(exe, os.X_OK):
            return exe
    return None


def from_claude(scratch, exe=None, hop=True):
    """As from_codex; installed is its binary found or ~/.claude there. Signed out (its cheap `auth status` says so):
    /usage is not run. On a Mac outside its desktop session (over ssh the login keychain is closed, so Claude reads
    as signed out) the same read runs once more inside that session (desktop_read)."""
    exe = exe or claude_exe()
    if not exe:
        return None, (ABSENT if not os.path.isdir(os.path.expanduser("~/.claude")) else "not found"), None
    scratch = os.path.abspath(os.path.expanduser(scratch))
    out, why = run([exe, "auth", "status", "--json"], 15, check=False)  # signed out may exit non-zero
    try:
        status = json.loads(out) if out else {}
    except ValueError:
        status = {}
    if not isinstance(status, dict):
        status = {}
    if status.get("loggedIn") is False:
        if hop and MACOS and not desktop_session():
            return desktop_read(exe, scratch)
        return None, "not signed in", ""
    plan, email = plan_words(status.get("planTier") or status.get("subscriptionType")), mask_email(status.get("email"))
    ident = account_id("claude-code", status.get("email"))
    os.makedirs(scratch, exist_ok=True)
    env = dict(os.environ, PWD=scratch)
    text, why = run([exe] + CLAUDE_ARGS, 20, cwd=scratch, env=env)
    if why:
        return None, why, ident
    c = card("claude-code", "Claude Code /usage", plan=plan, email=email, account=ident, windows=claude_windows(text, datetime.now(timezone.utc)))
    return (c, None, ident) if c["windows"] else (None, "no limit line", ident)


# ---- Claude on a Mac reached over ssh: the same read inside its desktop session ---------------------------------
# Claude Code keeps its login in the macOS login keychain, which a non-interactive ssh session cannot open, so there
# it reads as signed out. launchd's gui domain is the Mac's own desktop session: a one-off job there runs this file's
# Claude read (from_claude, the same binary and flags) and hands back only what it would have returned. No standing
# job, no cache, no token. Something always owns the teardown: the helper once it has the answer or gives up; the
# job's own cleaner (desktop_clean) once the job ends, so a killed helper leaves nothing; and, for whatever those could
# not clear (a bootout that kept failing, a kill before bootstrap), the next desktop read's sweep.

MACOS = sys.platform == "darwin"
LAUNCHCTL = "/bin/launchctl"
HOP_SECONDS = 40  # at most, and never past the helper's deadline
NOT_LOADED = {"exit 3", "exit 113"}  # bootout of a job that is not there (it already removed itself)
STALE_SECONDS = 300  # older than any read can live (the app ends the helper at 90 s): the sweep's to clear


def desktop_session():
    """True in the Mac's desktop (Aqua) session, where the keychain is open; over ssh it says Background."""
    out, _ = run([LAUNCHCTL, "managername"], 5)
    return (out or "").strip() == "Aqua"


def own_source():
    """This helper's text: the remote bootstrap hands it over as SOURCE (it has no file there), else its file."""
    if "SOURCE" in globals():
        return SOURCE
    with open(os.path.realpath(__file__), encoding="utf-8") as f:
        return f.read()


def alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except OSError:
        pass
    return True


def unload(label):
    """Boot the job out: (True, None) when it is gone, also when it had already gone; else (False, why)."""
    _, why = run([LAUNCHCTL, "bootout", f"gui/{os.getuid()}/{label}"], 5, end=WORK_SECONDS + CLEANUP_SECONDS)
    return why is None or why in NOT_LOADED, why


def sweep():
    """What an earlier read could not clear: this user's desktop jobs and folders older than any read can live, by
    the time in their names. A younger one may be another read's, so it is left alone. Nothing here stops the read:
    run() never raises, and an entry that goes while it is looked at (another read swept it) is skipped."""
    cutoff = time.time() - STALE_SECONDS
    out, _ = run([LAUNCHCTL, "print", f"gui/{os.getuid()}"], 5)
    for label, at in set(re.findall(r"\b(dev\.tremor\.usage\.(\d+)\.[0-9a-f]+)\b", out or "")):
        if int(at) < cutoff:
            unload(label)
    tmp = tempfile.gettempdir()
    try:
        names = os.listdir(tmp)
    except OSError:
        names = []
    for name in names:
        m, path = re.match(r"pdk-usage-(\d+)-", name), os.path.join(tmp, name)
        if not m or int(m[1]) >= cutoff:
            continue
        try:
            st = os.lstat(path)  # one look, not following a link: a link is not a folder
        except OSError:
            continue
        if stat.S_ISDIR(st.st_mode) and st.st_uid == os.getuid():
            shutil.rmtree(path, ignore_errors=True)


def desktop_read(exe, scratch):
    """from_claude's result from a one-off launchd job in this Mac's desktop session. No desktop session (bootstrap
    refused): signed out, at once. The job's folder is mkdtemp's (mode 700, a random name) and its label is new per
    read, so two reads never meet; both names carry the time, for the sweep. Its files go only once it is booted
    out: if that fails they stay, for the job's cleaner or the next read's sweep."""
    seconds = left(HOP_SECONDS)
    if seconds < 1:
        return None, "out of time", None
    hop_end = min(time.time() + seconds, START + WORK_SECONDS)  # fixed now: the sweep and bootstrap below come out of it
    sweep()
    at = int(time.time())
    label = f"dev.tremor.usage.{at}.{secrets.token_hex(8)}"
    d = tempfile.mkdtemp(prefix=f"pdk-usage-{at}-")
    out = os.path.join(d, "out.json")
    try:
        with open(os.path.join(d, "claude.py"), "w", encoding="utf-8") as f:
            f.write(own_source())
        env = {k: os.environ[k] for k in ("HOME", "PATH", "CLAUDE_CONFIG_DIR") if k in os.environ}
        with open(os.path.join(d, "job.plist"), "wb") as f:
            plistlib.dump({"Label": label, "LimitLoadToSessionType": "Aqua", "RunAtLoad": True, "EnvironmentVariables": env,
                           "ProgramArguments": [sys.executable, "-I", "-S", os.path.join(d, "claude.py"), "claude", scratch, exe, d, label,
                                                f"{max(0.0, hop_end - time.time()):.1f}", str(os.getpid())],
                           "StandardOutPath": "/dev/null", "StandardErrorPath": "/dev/null"}, f)
        _, why = run([LAUNCHCTL, "bootstrap", f"gui/{os.getuid()}", os.path.join(d, "job.plist")], 10)
        if why:
            return None, "not signed in", ""
        while time.time() < hop_end:
            try:
                with open(out, encoding="utf-8") as f:
                    answer = json.load(f)
                os.remove(out)  # taken: the job may go
                c, why, ident = answer
                return c, why, ident
            except FileNotFoundError:
                time.sleep(0.1)
            except (ValueError, TypeError):
                return None, "unreadable answer", None
        return None, f"no answer in {seconds:.0f} s", None
    finally:
        gone, why = unload(label)
        if gone:
            shutil.rmtree(d, ignore_errors=True)
        else:
            print(f"pdk-usage: {label} not booted out ({why}); its cleaner or the next read's sweep removes it and {d}", file=sys.stderr)


def desktop_job(scratch, exe, folder, label, helper):
    """The job's side. Its answer, then, once the answer is taken, the helper is gone or its own time is up, it hands
    the teardown to its cleaner and ends. The cleaner has its own session, so ending the job does not end it."""
    out = os.path.join(folder, "out.json")
    try:
        answer = from_claude(scratch, exe, hop=False)
        with open(out + ".part", "w", encoding="utf-8") as f:
            json.dump(answer, f, ensure_ascii=False)
        os.replace(out + ".part", out)
        while os.path.exists(out) and left(1) > 0 and alive(helper):
            time.sleep(0.1)
    finally:
        subprocess.Popen([sys.executable, "-I", "-S", os.path.join(folder, "claude.py"), "clean", label, folder, str(os.getpid())],
                         start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def desktop_clean(label, folder, job):
    """Once the job has ended, boot it out (a few tries) and only then remove its folder. If it cannot be booted out,
    the folder stays as the record and the next desktop read's sweep finishes the work."""
    while alive(job) and left(1) > 0:
        time.sleep(0.1)
    for _ in range(3):
        if unload(label)[0]:
            shutil.rmtree(folder, ignore_errors=True)
            return
        time.sleep(0.5)


# ---- Moshi hook: optional, for providers with no clean source --------------------------------------------------

def plan_and_email(label):
    """Moshi's 'Grok (person@example.com)' -> ('Grok', 'p•••@e•••.com')."""
    if not isinstance(label, str):
        return None, None
    m = re.match(r"^(.*?)\s*\(([^()]*)\)\s*$", label)
    if m and "@" in m[2]:
        return mask_email(m[1]) or None, mask_email(m[2])
    return mask_email(label), None


def from_moshi():
    exe = shutil.which("moshi") or shutil.which("moshi-hook")
    if not exe:
        return [], ABSENT
    out, why = run([exe, "usage"], 20)
    if why:
        return [], why
    try:
        data = json.loads(out)
    except ValueError:
        return [], "printed something other than JSON"
    cards = []
    for e in data if isinstance(data, list) else []:
        if not isinstance(e, dict) or not isinstance(e.get("agent"), str):
            continue
        plan, email = plan_and_email(e.get("accountLabel"))
        windows = [{"label": str(w.get("label") or ""), "used": w["usedPercentage"], "resetsAt": iso_ms(w.get("resetsAt")), "mins": None}
                   for w in e.get("windows") or [] if isinstance(w, dict) and num(w.get("usedPercentage")) is not None]
        cards.append(card(e["agent"], "Moshi hook", plan=plan, email=email, host=e.get("hostName") or host(),
                          capturedAt=iso_ms(e.get("capturedAt")), windows=windows))
    return cards, None


def read(scratch):
    """Cards with limits only. `sources`, per source and the provider it reads: ok True read, False installed but
    unavailable (the app keeps its last good values, marked stale, else a short state), None not installed; `account`
    whose read it was (account_id), so a kept value is only ever the same account's."""
    cards, sources = [], []
    for name, provider, (c, why, account) in (("Codex app-server", "codex", from_codex()), ("Claude Code /usage", "claude-code", from_claude(scratch))):
        if c:
            cards.append(c)
        sources.append({"name": name, "provider": provider, "ok": None if why == ABSENT else why is None, "account": account})
    moshi, why = from_moshi()
    cards.extend(m for m in moshi if m["provider"] not in CLEAN and m["windows"])
    sources.append({"name": "Moshi hook", "provider": None, "ok": None if why == ABSENT else why is None})
    return {"readAt": now_ms(), "host": host(), "cards": cards, "sources": sources}


if __name__ == "__main__":
    if len(sys.argv) == 8 and sys.argv[1] == "claude":  # inside the desktop session's job: never hops again
        WORK_SECONDS = float(sys.argv[6])  # the helper's time for this read; its teardown has CLEANUP_SECONDS more
        desktop_job(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], int(sys.argv[7]))
        sys.exit(0)
    if len(sys.argv) == 5 and sys.argv[1] == "clean":  # the job's cleaner, after the job has ended
        desktop_clean(sys.argv[2], sys.argv[3], int(sys.argv[4]))
        sys.exit(0)
    if len(sys.argv) != 3 or sys.argv[1] != "read":
        print(json.dumps({"error": "usage: pdk-usage.py read <scratch folder>"}))
        sys.exit(2)
    print(json.dumps(read(sys.argv[2]), ensure_ascii=False))
