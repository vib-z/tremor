#!/usr/bin/env python3
"""A plain test program that stands in for an agent in the sandbox. It is not an agent: it calls no model
and runs nothing. It prints OSC 7501 status reports and leaves the same on-disk evidence the real agent
would, inside the sandbox HOME only, from the captured fixtures:

  claude:  ~/.claude/sessions/<pid>.json (pid, sessionId, cwd, procStart as `LC_ALL=C TZ=UTC ps -o lstart`)
           and ~/.claude/projects/<key(cwd)>/<session>.jsonl (the captured Claude fixture)
  codex:   ~/.codex/sessions/2026/11/08/rollout-...-<thread>.jsonl (the captured Codex fixture), held open
           while it runs, as Codex --no-daemon does

The sandbox's bin/claude and bin/codex start it with argv[0] set to the agent's name, so Core sees the
same argv a real launch has, and the pack's settle and reopen take their production paths.

It reads lines typed into its terminal: /exit (claude) or /quit (codex) clears its status and exits;
/clear (claude) or /new (codex) starts a new session in the same process, as the real ones do (Claude: a new
session id in its registry entry and a transcript written from the next message; Codex 0.167.0: a new thread's lock
held at once, its rollout written and held from its first message, and the old rollout and lock kept open until
20 s after that first message, as Codex lets go of them about a minute later); anything else is a message: its line appended to the transcript at once, working
for a moment, then a reply appended, then done. Records carry the real time, to the millisecond.
A control file $PDK_SANDBOX/ctl/<name> (one command per line) moves its state for screenshots:
  working | idle | done | error | blocked <kind> <message> | record <id> <state> <title> | clear-record <id>
  spawn <name> <kind> [args...]  (starts a worker with hc run, so Core records this one as its parent)
"""
import base64
import json
import os
import select
import shutil
import subprocess
import sys
import time
import uuid

FIXTURES = os.path.join(os.path.dirname(os.path.realpath(__file__)), "..", "..", "docs", "modpack", "research", "fixtures")
CLAUDE_FIXTURE = os.path.join(FIXTURES, "claude-code", "haiku-two-files.jsonl")
CODEX_FIXTURE = os.path.join(FIXTURES, "codex", "rollout-luna-two-files.jsonl")
CODEX_THREAD = "01a1bd47-5fc4-76f0-926e-e081542198de"


def b64(s):
    return base64.b64encode(s.encode()).decode()


def report(state, app, title="", msg="", kind="", rid=""):
    fields = [f"state={state}"]
    if rid:
        fields.append(f"id={rid}")
    if kind:
        fields.append(f"kind={kind}")
    if app:
        fields.append(f"app={app}")
    if title:
        fields.append(f"title={b64(title)}")
    if msg:
        fields.append(f"msg={b64(msg)}")
    sys.stdout.write("\x1b]7501;" + ":".join(fields) + "\x1b\\")
    sys.stdout.flush()


def key(cwd):
    return "".join(c if c.isascii() and c.isalnum() else "-" for c in cwd)


def lstart(pid):
    r = subprocess.run(["/bin/ps", "-o", "lstart=", "-p", str(pid)], capture_output=True, text=True,
                       env={"LC_ALL": "C", "TZ": "UTC", "PATH": "/bin:/usr/bin"})
    return r.stdout.strip()


def main():
    argv = sys.argv[1:]
    as_kind = "claude"
    if argv[:1] == ["--as"]:
        as_kind, argv = argv[1], argv[2:]
    opts = {}
    rest = []
    i = 0
    while i < len(argv):
        if argv[i].startswith("--pdk-") and i + 1 < len(argv):
            opts[argv[i][6:]] = argv[i + 1]
            i += 2
        else:
            rest.append(argv[i])
            i += 1
    argv = rest
    name = opts.get("name") or os.environ.get("PDK_FAKE_NAME") or as_kind
    title = opts.get("title", os.environ.get("PDK_FAKE_TITLE", ""))
    state = opts.get("state", os.environ.get("PDK_FAKE_STATE", "idle"))
    home = os.path.expanduser("~")
    cwd = os.getcwd()
    pid = os.getpid()
    app = "claude-code" if as_kind == "claude" else "codex"
    held = None
    transcript = None
    registry = None
    session = None

    if as_kind == "claude":
        session = argv[argv.index("--resume") + 1] if "--resume" in argv else (
            argv[argv.index("--session-id") + 1] if "--session-id" in argv else str(uuid.uuid4()))
        transcript, registry = claude_session(home, cwd, pid, session, CLAUDE_FIXTURE)
    else:
        session = argv[argv.index("resume") + 1] if "resume" in argv else opts.get("thread", os.environ.get("PDK_FAKE_THREAD", CODEX_THREAD))
        transcript, held = codex_session(home, cwd, session, CODEX_FIXTURE)
        kept = [held, codex_lock(home, session)]  # open until the process ends
        unwritten = False
        leaving, release_at = [], None  # the old thread's open files, let go of at release_at

    print(f"{name}: a plain test program standing in for {app} (no model, no tools).")
    print(f"session {session}")
    report(state, app, title)

    ctl = os.path.join(os.environ.get("PDK_SANDBOX", "/tmp"), "ctl", name)
    os.makedirs(os.path.dirname(ctl), exist_ok=True)
    seen = 0
    busy_until = None
    pending_reply = None
    while True:
        r, _, _ = select.select([sys.stdin], [], [], 0.4)
        if r:
            line = sys.stdin.readline()
            if not line:
                break
            text = line.strip()
            if text in ("/exit", "/quit"):
                report("clear", app)
                if registry and os.path.exists(registry):
                    os.remove(registry)
                print("bye")
                return
            if text in ("/clear", "/new"):
                session = str(uuid.uuid4())
                if as_kind == "claude":
                    transcript, registry = claude_session(home, cwd, pid, session, None)
                else:
                    leaving, kept = kept, [codex_lock(home, session)]
                    transcript, unwritten = codex_path(home, session), True
                print(f"session {session}")
                continue
            if text:
                report("working", app, title)
                busy_until = time.time() + 2.0
                pending_reply = text
                if as_kind == "codex" and unwritten:
                    transcript, held = codex_session(home, cwd, session, None)
                    kept.append(held)
                    unwritten = False
                    release_at = time.time() + 20
                append(as_kind, transcript, "user", text, session)
        if as_kind == "codex" and release_at and time.time() >= release_at:
            for f in leaving:
                f.close()
            leaving, release_at = [], None
        if busy_until and time.time() >= busy_until:
            append(as_kind, transcript, "assistant", f"Noted: {pending_reply}. (A test program's reply.)", session)
            report("done", app, title)
            busy_until = None
        if os.path.exists(ctl):
            lines = open(ctl).read().splitlines()
            for cmd in lines[seen:]:
                apply(cmd, app, title, name, as_kind)
            seen = len(lines)


def claude_session(home, cwd, pid, session, fixture):
    """Claude's registry entry naming `session`; its transcript from the fixture, or from the next message."""
    tdir = os.path.join(home, ".claude", "projects", key(cwd))
    os.makedirs(tdir, exist_ok=True)
    transcript = os.path.join(tdir, f"{session}.jsonl")
    if fixture and not os.path.exists(transcript):
        shutil.copyfile(fixture, transcript)
    sdir = os.path.join(home, ".claude", "sessions")
    os.makedirs(sdir, exist_ok=True)
    registry = os.path.join(sdir, f"{pid}.json")
    tmp = registry + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"pid": pid, "sessionId": session, "cwd": cwd, "procStart": lstart(pid),
                   "status": "idle", "updatedAt": int(time.time() * 1000)}, f)
    os.replace(tmp, registry)
    return transcript, registry


def codex_path(home, thread):
    rdir = os.path.join(home, ".codex", "sessions", "2026", "11", "08")
    os.makedirs(rdir, exist_ok=True)
    return os.path.join(rdir, f"rollout-2026-11-08T22-28-54-{thread}.jsonl")


def codex_lock(home, thread):
    ldir = os.path.join(home, ".codex", "thread-writer-locks")
    os.makedirs(ldir, exist_ok=True)
    return open(os.path.join(ldir, f"{thread}.lock"), "a")


def codex_session(home, cwd, thread, fixture):
    """A rollout for `thread` whose first line is its session_meta (then the fixture's lines), held open."""
    transcript = codex_path(home, thread)
    if not os.path.exists(transcript):
        src = open(fixture).read().splitlines(True) if fixture else [json.dumps({"type": "session_meta", "payload": {}}) + "\n"]
        with open(transcript, "w") as dst:
            for i, line in enumerate(src):
                if i == 0:
                    o = json.loads(line)
                    o["payload"]["id"] = o["payload"]["session_id"] = thread
                    o["payload"]["cwd"] = cwd
                    line = json.dumps(o) + "\n"
                dst.write(line)
    return transcript, open(transcript, "rb")


def apply(cmd, app, title, name, as_kind):
    parts = cmd.split(" ")
    word = parts[0]
    if word in ("working", "idle", "done", "error"):
        report(word, app, title)
    elif word == "blocked":
        report("blocked", app, title, msg=" ".join(parts[2:]), kind=parts[1])
    elif word == "record":
        report(parts[2], app, " ".join(parts[3:]), rid=parts[1])
    elif word == "clear-record":
        report("clear", app, rid=parts[1])
    elif word == "spawn":
        wname, wkind, rest = parts[1], parts[2], parts[3:]
        args = ["--pdk-name", wname, "--pdk-state", "working", "--pdk-title", " ".join(rest) or wname]
        if wkind == "codex":
            args += ["--no-daemon", "--pdk-thread", str(uuid.uuid4())]
        subprocess.Popen(["hc", "run", "--bg", "--name", wname, "--", wkind] + args,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def append(kind, path, role, text, session):
    t = time.time()
    now = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(t)) + f".{int(t * 1000) % 1000:03d}Z"
    if kind == "claude":
        if role == "user":
            rec = {"type": "user", "uuid": str(uuid.uuid4()), "sessionId": session, "timestamp": now, "isSidechain": False,
                   "message": {"role": "user", "content": text}}
        else:
            rec = {"type": "assistant", "uuid": str(uuid.uuid4()), "sessionId": session, "timestamp": now, "isSidechain": False,
                   "message": {"id": "msg_" + uuid.uuid4().hex[:20], "role": "assistant", "model": "test",
                               "content": [{"type": "text", "text": text}]}}
    else:
        item = {"type": "UserMessage", "id": str(uuid.uuid4()), "content": [{"type": "text", "text": text}]} if role == "user" else \
            {"type": "AgentMessage", "id": "msg_" + uuid.uuid4().hex, "content": [{"type": "Text", "text": text}], "phase": "final_answer"}
        rec = {"timestamp": now, "type": "event_msg", "payload": {"type": "item_completed", "thread_id": session, "turn_id": "t", "item": item}}
    with open(path, "a") as f:
        f.write(json.dumps(rec) + "\n")


if __name__ == "__main__":
    main()
