# hermes fixtures: CAPTURED on this Mac by qa-modpack, 2026-11-09 09:00 to 09:02 GMT

Hermes Agent v0.23.0 (2026.9.24), install `~/.hermes/hermes-agent` at local commit 2bd378ed1b8d (`hermes --version`), MIT.
Two real sessions started by this lane in the sandboxed Herdr app (private Core, `modpack/test/qa/fixture.sh`), each
launched as `hermes chat --safe-mode -t terminal --provider anthropic -m claude-haiku-5-5 -q "<one prompt>"` in a scratch
folder of this worktree. Only this lane's own rows were read (filtered by its session ids); nothing of the owner's is here.

- `messages.jsonl`: the 12 rows of the `messages` table for the two sessions (ids 3464 to 3471: the first turn of each;
  3472 to 3475: a second turn of the first session asking for `rm -rf` of a missing folder, which Hermes' smart approval
  flagged and auto-approved, recorded in the tool result's `approval` field), every column except the `display_identity` BLOB. Real shapes: `tool_calls` is JSON text `[{call_id, function{arguments, name}, id, response_item_id,
  type: "function"}]`; a `tool` row's `content` for the `terminal` tool is JSON text `{"output", "exit_code", "error"}`;
  `finish_reason` is `tool_calls` or `stop`; `active` is 1; `timestamp` is epoch seconds.
- `tty-dev-ttys055.json`: the breadcrumb Hermes wrote for the first session's tty, `~/.hermes/terminal-sessions/tty-dev-ttys055`
  (`hermes_cli/terminal_breadcrumbs.py:16-82`: the tty device of the process, sanitised, holds `{session_id, cwd, ts}`).
  The process (pid 27388, `ps -o tty=` ttys055) started 09:00:21 UTC; `ts` 1794214824.7 is 3.4 s later.
- `terminal-t3.json`: Core's `hc get t3 --json` for that pane (hc 0.1.19): the app's shell wrapper in `argv`, Hermes' own
  Python launcher as the foreground (its `-c` script clipped to 400 characters; it names `/.hermes/hermes-agent`),
  `status` null and `reported` false (Hermes emits no OSC 7501).
- Observed and not in a file: `~/.hermes/runtime/active_sessions.json` stayed `[]` (15 bytes) while both chats were live,
  so the pid lease the research notes described does not exist for a 0.23.0 CLI chat (its turns run in the gateway daemon).
