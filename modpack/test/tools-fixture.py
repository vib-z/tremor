#!/usr/bin/env python3
"""FIXTURES, not captures: a Claude Code transcript whose tool calls cover each family the chat draws.

  tools-fixture.py OUT CWD [CALLS]

Records of the shapes in the verified sample (docs/modpack/research/fixtures/claude-code/haiku-two-files.jsonl,
Claude Code 2.1.319): a prompt, then calls with their results: a multi-line command, a file read (numbered lines,
as Claude Code writes them), a search, an edit with a diff, a write, a failed command, a refused command, an MCP
call with a JSON result, a web fetch, a sub-agent task; then the answer with a fenced code block. With CALLS, the
transcript is instead one prompt and CALLS commands with short results (the long-thread measurement).
"""
import json
import sys
import uuid

out, cwd = sys.argv[1], sys.argv[2]
calls = int(sys.argv[3]) if len(sys.argv) > 3 else 0
sid = "7001c0de-0000-4c43-9a8e-1f0e2d3c4b5a"
n = [0]


def stamp():
    n[0] += 1
    return f"2026-11-11T22:{n[0] // 60 % 60:02d}:{n[0] % 60:02d}.000Z"


def env(kind, message, **extra):
    return {"parentUuid": None, "isSidechain": False, "userType": "external", "cwd": cwd, "sessionId": sid, "version": "2.1.319",
            "gitBranch": "main", "type": kind, "message": message, "uuid": str(uuid.uuid4()), "timestamp": stamp(), **extra}


def user(text):
    return env("user", {"role": "user", "content": text})


def say(text):
    return env("assistant", {"role": "assistant", "model": "claude-haiku-5-5", "content": [{"type": "text", "text": text}]})


lines = []


def call(name, args, result, error=False, refused=False):
    tid = "toolu_" + uuid.uuid4().hex[:24]
    lines.append(env("assistant", {"role": "assistant", "model": "claude-haiku-5-5", "content": [{"type": "tool_use", "id": tid, "name": name, "input": args}]}))
    block = {"type": "tool_result", "tool_use_id": tid, "content": result}
    if error:
        block["is_error"] = True
    extra = {"toolDenialKind": "user_rejected"} if refused else {}
    lines.append(env("user", {"role": "user", "content": [block]}, **extra))


MAIN = """import { readFileSync } from "node:fs";

// The app's settings, with defaults for what is missing.
export function settings(path) {
  const text = readFileSync(path, "utf8");
  const parsed = JSON.parse(text);
  return { theme: "dark", zoom: 1, ...parsed };
}
"""

if calls:
    lines.append(user(f"Run {calls} quick checks."))
    for i in range(calls):
        call("Bash", {"command": f"test -f part-{i}.txt && echo ok-{i}", "description": f"Check part {i}"}, f"ok-{i}")
    lines.append(say(f"All {calls} checks ran."))
else:
    lines.append(user("Tidy the settings loader and check the tests."))
    lines.append(say("Looking at the loader first."))
    call("Bash", {"command": "rg --files src | head -n 4\nnpm test -- --reporter=dot", "description": "List sources and run the tests"},
         "src/main.js\nsrc/settings.js\nsrc/theme.js\nsrc/zoom.js\n\n  42 passing (1s)")
    call("Read", {"file_path": f"{cwd}/src/settings.js"}, "".join(f"{i + 1:>6}→{l}\n" for i, l in enumerate(MAIN.splitlines())))
    call("Grep", {"pattern": "readFileSync", "path": "src", "output_mode": "files_with_matches"}, "Found 2 files\nsrc/settings.js\nsrc/theme.js")
    call("Edit", {"file_path": f"{cwd}/src/settings.js", "old_string": "  const parsed = JSON.parse(text);\n  return { theme: \"dark\", zoom: 1, ...parsed };",
                  "new_string": "  let parsed = {};\n  try { parsed = JSON.parse(text); } catch { /* a torn file reads as defaults */ }\n  return { theme: \"dark\", zoom: 1, ...parsed };"},
         f"The file {cwd}/src/settings.js has been updated.")
    call("Write", {"file_path": f"{cwd}/src/defaults.json", "content": "{\n  \"theme\": \"dark\",\n  \"zoom\": 1\n}\n"}, f"File created successfully at: {cwd}/src/defaults.json")
    call("Bash", {"command": "npm run lint"}, "src/settings.js:5:9  error  'parsed' is never reassigned  prefer-const\n\n✖ 1 problem (1 error, 0 warnings)", error=True)
    call("Bash", {"command": "rm -rf node_modules && npm ci"}, "The user doesn't want to proceed with this tool use. The tool use was rejected.", error=True, refused=True)
    call("mcp__github__search_issues", {"query": "settings loader crash", "repo": "vib-z/tremor", "limit": 3},
         json.dumps({"total": 2, "items": [{"number": 41, "title": "Settings crash on a torn file", "state": "open"},
                                           {"number": 37, "title": "Zoom resets", "state": "closed"}]}, indent=2))
    call("WebFetch", {"url": "https://nodejs.org/api/fs.html", "prompt": "What does readFileSync throw?"}, "readFileSync throws when the path does not exist (ENOENT).")
    call("Task", {"description": "Check the theme loader", "prompt": "Read src/theme.js and say whether it handles a torn file.", "subagent_type": "general-purpose"},
         "It does not: theme.js calls JSON.parse without a guard.")
    lines.append(say("The loader now keeps its defaults when the file is torn:\n\n```js\nlet parsed = {};\ntry { parsed = JSON.parse(text); } catch { /* defaults */ }\n```\n\nLint still fails on one line, and I did not reinstall the packages."))

with open(out, "w") as f:
    for line in lines:
        f.write(json.dumps(line) + "\n")
print(out)
