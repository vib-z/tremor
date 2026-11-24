# Chat support matrix, as shipped

Verified: the format was checked against a real transcript the agent wrote on this Mac, the adapter passes its
fixture, and the binding rule is implemented. Partial: the format comes from source or documentation only (fixture
CONSTRUCTED, labelled in its `SOURCE.md`), or the session can be found only in some launches. Unsupported: no
structured source for an interactive session. A terminal that can't be bound always gets the labelled terminal
fallback ("No session evidence for this terminal" with the reason, or "<agent>: chat unsupported, terminal only");
screen text is never shown as chat.

| Agent | Level | Format evidence | How a terminal is bound (evidence only) | Live in the sandbox (test double) | Not verified |
|---|---|---|---|---|---|
| Claude Code | **verified, live** | captured 2.1.319 transcript, `fixtures/claude-code/haiku-two-files.jsonl`; `test/chat.test.js`; live run 2026-11-09 (`reports/live-test.md`) | `~/.claude/sessions/<pid>.json` whose `pid` and `procStart` (`ps -o lstart`, C, UTC) match the foreground process; transcript at `projects/<key(cwd)>/<id>.jsonl`, no folder listing | live: bound a real 2.1.319 session, live tail of real turns (`ls`, `Write`), real blocked request, `/exit`, `--resume` verified twice | `/clear` mid-chat; a session whose transcript moved projects |
| Codex | **verified, live** (isolation: verified only with `--disable plugins --disable apps`, review F10) | captured 0.167.0 rollout, `fixtures/codex/rollout-luna-two-files.jsonl`; `test/chat.test.js`; live run 2026-11-09 | exactly one root rollout held open by the process (`lsof`), first line `session_meta` naming the thread in the file name; shared daemon, several roots, a `/new` lock without its file all refused | live: a real 0.167.0 `--no-daemon` worker (Core child of the Claude lead) bound by its held rollout, real turn (`rg --files`), `/quit`, `codex resume <id> --no-daemon` verified twice (held immediately on resume) | `/new` mid-chat; a shared-daemon Codex (refused by rule, not exercised); the 2026-11-09 00:20 live run still offered the plugin MCP namespace `mcp__cua_repl` (never called), so its isolation did not meet M6; the flags close it (qa-modpack rollout, `docs/modpack/qa/codex-launch.md`) |
| Grok Build | partial | constructed from Heeler's notes (Grok 1.0.62 to 1.0.70); installed 1.0.77 not sampled | one `~/.grok/active_sessions.json` row for the pid with a matching `pid_start`; two rows (after `/new`) refused | not run | format on 1.0.77; `pid_start` units on this Mac (one VM sample) |
| Pi / Oh My Pi | partial | constructed from Heeler's notes and Pi source | only Heeler's Pi extension label `heeler.session` (pid and start must match, file under Pi's sessions folder) | not run | everything live; not installed here |
| OpenCode | partial | constructed from Heeler's notes (2.0.32) | only an id given at launch (`-s ses_...`); rows read read-only from `opencode.db`, filtered to that session | not run | not installed here |
| Hermes | **verified, live** (chat; status and blocked state not, see last column) | captured 0.23.0 sessions of this job's own (`fixtures/hermes/`, `SOURCE.md`); `test/hermes.test.js`, `test/rowtail.test.js`; qa-modpack 2026-11-09 (`reports/qa-modpack.md`, `reports/qa-recheck.md`) | the terminal's own record `~/.hermes/terminal-sessions/tty-dev-<tty>` (`{session_id, cwd, ts}`), only for a live local process, written after it started, for its folder (0.23.0 writes no pid lease); rows from `state.db` filtered to that session (read-only) | live: real Hermes 0.23.0 (`--safe-mode -t terminal`, flags only) in two workspaces: prompt, terminal calls, outputs, answers, media tiles for paths it printed; a new turn appears in the open chat (recheck on 83508a0); detected by its Python launcher in tree, tabs, headers and factory | no OSC 7501, so no status in the tree or factory; blocked or permission state never observed (Hermes auto-approved the test's flagged command); `/new` mid-chat |
| Kimi Code | partial format, **binding unsupported** | constructed from Kimi source | none: its session folder is named by a hash and can't be found without listing `~/.kimi-code/sessions` (forbidden by D32); terminal fallback with that reason | not run | everything live |
| Gemini CLI | partial format, **binding unsupported** | constructed from Gemini source | none: the chat file name carries a timestamp, so finding it needs a listing; terminal fallback with that reason | not run | everything live |
| Cursor Agent | **unsupported** | only the print-mode stream is documented (`fixtures/cursor-agent`) | none | "Cursor Agent: chat unsupported, terminal only" shown for a stand-in named `cursor-agent` (`shots/.../06-chat-unsupported-*.png`) | n/a |

**Chat interactions (owner request 35; `adapters/interactions.js`, `test/interactions.test.js`).** Stop works for any
agent Core reports as working (Claude Code, Codex; not Hermes, which sends no OSC 7501): `hc interrupt` once per turn,
after re-checking the terminal, process, session, turn and that it still works; the chat shows what Core reported.
Approval and question cards are read only for every agent, with "Answer in the terminal" (the race limit in
README.md): Claude Code shows the pending call a permission is about and AskUserQuestion's own questions and choices;
Codex shows its pending call; Codex questions (response items) and Hermes show Core's message only. Hook rows: Claude's
hook attachments and Stop summary, Codex's hook prompts, display only. Shapes of Claude's hook attachments are taken
from its writer, not from a capture; stand-in scenes only (`test/interactions-scene.sh`).

Model switching (owner request 16) follows the same evidence rule: Claude Code (2.1.319: its own `/model` picker,
"session only") and Codex (0.167.0: `/model <id> --reasoning=<level>`, session only; models from its app-server
`model/list`) switch from the chat's chip and were verified with haiku and luna test sessions; neither writes the
agent's settings file. Every other agent's chip is read-only and says so. The current model shown after an app restart
is the last turn's until the next turn.
