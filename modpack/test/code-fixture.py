"""FIXTURES, not captures: the code view's test transcripts (owner, inputs-moshi-code-view-2257.png).

  code-fixture.py CLAUDE_OUT CODEX_OUT CWD THREAD

Built like media-fixture.py from the verified samples (docs/modpack/research/fixtures, Claude Code 2.1.319 and
codex-cli 0.167.0): the sample's own lines first, then records of the same shapes with new ids. Claude writes two
briefs (Write x2, 53 and 50 lines) and edits one (Edit); Codex changes files in one FileChange (an update with a
unified diff, and an added file). Nothing is written to the files the records name.
"""
import json
import os
import sys
import uuid

HERE = os.path.dirname(os.path.realpath(__file__))
SAMPLES = os.path.join(HERE, "..", "..", "docs", "modpack", "research", "fixtures")


def brief(title, n):
    body = [f"# Brief: {title}", "", "## Goal", "Make sure the pack supports everything Herdr 0.1.14 offers.", "", "## Why"]
    body += [f"- **Point {i}:** a line of the brief that is long enough to be cut at the edge of the code view." for i in range(1, n - len(body) + 1)]
    return "\n".join(body[:n]) + "\n"


def claude(out, cwd):
    lines = open(os.path.join(SAMPLES, "claude-code", "haiku-two-files.jsonl")).read().splitlines()
    recs = [json.loads(l) for l in lines]
    user = next(r for r in recs if r.get("type") == "user" and isinstance(r["message"]["content"], str))
    asst = next(r for r in recs if r.get("type") == "assistant" and r["message"]["content"][0].get("type") == "text")
    result = next(r for r in recs if r.get("type") == "user" and isinstance(r["message"]["content"], list) and not r.get("toolDenialKind"))
    last, t = [recs[-1].get("uuid") or asst["uuid"]], [0]

    def stamp(r):
        t[0] += 1
        r.update(uuid=str(uuid.uuid4()), parentUuid=last[0], timestamp=f"2026-11-09T22:{40 + t[0]:02d}:00.000Z", cwd=cwd, sessionId=user["sessionId"])
        last[0] = r["uuid"]
        return r

    def prompt(text):
        r = json.loads(json.dumps(user))
        r["message"] = {"role": "user", "content": text}
        return stamp(r)

    def say(blocks):
        r = json.loads(json.dumps(asst))
        r["message"] = {**r["message"], "id": "msg_" + uuid.uuid4().hex[:24], "content": blocks}
        return stamp(r)

    def ok(tid):
        r = json.loads(json.dumps(result))
        r["message"] = {"role": "user", "content": [{"tool_use_id": tid, "type": "tool_result", "content": "File created successfully", "is_error": False}]}
        r["toolUseResult"] = {"type": "create"}
        return stamp(r)

    b = lambda n: os.path.join(cwd, "briefs", n)
    new = [
        prompt("Write the two parity briefs, then tighten the PM one's goal."),
        say([{"type": "text", "text": "Writing the briefs."}]),
        say([{"type": "tool_use", "id": "toolu_cv_w1", "name": "Write", "input": {"file_path": b("pm-parity.md"), "content": brief("review-pm, Herdr feature parity", 53)}}]),
        ok("toolu_cv_w1"),
        say([{"type": "tool_use", "id": "toolu_cv_w2", "name": "Write", "input": {"file_path": b("design-parity.md"), "content": brief("design-astra, every Herdr surface designed", 50)}}]),
        ok("toolu_cv_w2"),
        say([{"type": "tool_use", "id": "toolu_cv_e1", "name": "Edit", "input": {"file_path": b("pm-parity.md"),
             "old_string": "## Goal\nMake sure the pack supports everything Herdr 0.1.14 offers.\n",
             "new_string": "## Goal\nMake sure the pack supports everything Herdr 0.1.14 offers,\nand say plainly where it does not.\n"}}]),
        ok("toolu_cv_e1"),
        say([{"type": "text", "text": "Both briefs are written, and the PM brief's goal now asks for the gaps too."}]),
    ]
    with open(out, "w") as f:
        for l in lines + [json.dumps(r, separators=(",", ":")) for r in new]:
            f.write(l + "\n")


def codex(out, cwd, thread):
    lines = open(os.path.join(SAMPLES, "codex", "rollout-luna-two-files.jsonl")).read().splitlines()
    recs = [json.loads(l) for l in lines]
    first = recs[0]
    first["payload"]["id"] = first["payload"]["session_id"] = thread
    first["payload"]["cwd"] = cwd
    lines[0] = json.dumps(first, separators=(",", ":"))
    um = next(r for r in recs if r["type"] == "event_msg" and r["payload"].get("item", {}).get("type") == "UserMessage")
    turn, n = "01a1bd47-code-7c93-a644-861a80701eb6", [len(recs)]

    def item(it):
        r = json.loads(json.dumps(um))
        n[0] += 1
        r.update(ordinal=n[0], timestamp=f"2026-11-09T22:50:{n[0] % 60:02d}.000Z")
        r["payload"] = {**r["payload"], "thread_id": thread, "turn_id": turn, "item": it}
        return r

    src = os.path.join(cwd, "src", "status.rs")
    diff = ("--- a/src/status.rs\n+++ b/src/status.rs\n@@ -12,7 +12,9 @@ pub fn word(s: &Status) -> &'static str {\n"
            "     match s {\n         Status::Working => \"working\",\n-        Status::Done => \"done\",\n"
            "+        Status::Done { seen: false } => \"done\",\n+        Status::Done { seen: true } => \"idle\",\n"
            "         Status::Blocked => \"needs you\",\n-        _ => \"idle\",\n+        Status::Idle => \"idle\",\n     }\n }\n")
    new = [
        item({"type": "UserMessage", "id": str(uuid.uuid4()), "content": [{"type": "text", "text": "Make a seen done turn read idle, and add a note.", "text_elements": []}]}),
        item({"type": "FileChange", "id": "fc-code-1", "status": "completed", "changes": {
            src: {"type": "update", "unified_diff": diff, "move_path": None},
            os.path.join(cwd, "NOTES.md"): {"type": "add", "content": "# Notes\n\nA done turn someone has seen reads idle.\n"}}}),
        item({"type": "AgentMessage", "id": "msg_code_final", "content": [{"type": "Text", "text": "Done: a seen turn now reads idle, and NOTES.md says why."}], "phase": "final_answer"}),
    ]
    done = json.loads(lines[-1])
    done["payload"] = {**done["payload"], "turn_id": turn, "root_turn_id": turn}
    with open(out, "w") as f:
        for l in lines + [json.dumps(r, separators=(",", ":")) for r in new] + [json.dumps(done, separators=(",", ":"))]:
            f.write(l + "\n")


def interactions(ask_out, perm_out, cwd):
    """Owner request 35: a Claude session asking a question (hook rows first, then AskUserQuestion with no answer
    yet), and one waiting on a permission (a Bash call with no result yet)."""
    lines = open(os.path.join(SAMPLES, "claude-code", "haiku-two-files.jsonl")).read().splitlines()
    recs = [json.loads(l) for l in lines]
    user = next(r for r in recs if r.get("type") == "user" and isinstance(r["message"]["content"], str))
    asst = next(r for r in recs if r.get("type") == "assistant" and r["message"]["content"][0].get("type") == "text")
    t = [0]

    def stamp(r):
        t[0] += 1
        r.update(uuid=str(uuid.uuid4()), timestamp=f"2026-11-09T23:{10 + t[0]:02d}:00.000Z", cwd=cwd, sessionId=user["sessionId"])
        return r

    def prompt(text):
        r = json.loads(json.dumps(user))
        r["message"] = {"role": "user", "content": text}
        return stamp(r)

    def say(blocks):
        r = json.loads(json.dumps(asst))
        r["message"] = {**r["message"], "id": "msg_" + uuid.uuid4().hex[:24], "content": blocks}
        return stamp(r)

    def hook(kind, name, event):
        return stamp({"type": "attachment", "isSidechain": False, "attachment": {"type": kind, "hookName": name, "hookEvent": event, "toolUseID": "toolu_x", "content": ""}})

    ask = [prompt("Set up the theme work."), hook("hook_success", "UserPromptSubmit", "UserPromptSubmit"),
           say([{"type": "text", "text": "Two things to settle before I start."}]),
           hook("hook_success", "PreToolUse:AskUserQuestion", "PreToolUse"),
           say([{"type": "tool_use", "id": "toolu_ask_1", "name": "AskUserQuestion", "input": {"questions": [
               {"header": "Theme", "question": "Which preset should I start from?", "multiSelect": False, "options": [
                   {"label": "T3 light", "description": "The light preset everything else is measured against"},
                   {"label": "Moshi", "description": "The terminal look, mono where it counts"}]},
               {"header": "Scope", "question": "What should the first pass cover?", "multiSelect": True, "options": [
                   {"label": "Sidebar", "description": "Tree rows, carets and status"}, {"label": "Chat", "description": "Bubbles, composer and cards"}]}]}}])]
    perm = [prompt("Clean the build folder."), hook("hook_success", "UserPromptSubmit", "UserPromptSubmit"),
            say([{"type": "text", "text": "Removing the old build output."}]),
            say([{"type": "tool_use", "id": "toolu_perm_1", "name": "Bash", "input": {"command": "rm -rf build/ && mkdir build", "description": "Clean the build folder"}}])]
    for out, new in ((ask_out, ask), (perm_out, perm)):
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "w") as f:
            for r in new:
                f.write(json.dumps(r, separators=(",", ":")) + "\n")


if __name__ == "__main__" and sys.argv[1:2] == ["interactions"]:
    interactions(*sys.argv[2:5])
    sys.exit(0)

if __name__ == "__main__":
    claude_out, codex_out, cwd, thread = sys.argv[1:5]
    for p in (claude_out, codex_out):
        os.makedirs(os.path.dirname(p), exist_ok=True)
    claude(claude_out, cwd)
    codex(codex_out, cwd, thread)
    print(json.dumps({"claude": claude_out, "codex": codex_out}))
