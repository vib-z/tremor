# hermes fixture: CONSTRUCTED from source, not captured

`messages.jsonl` holds four rows of the `messages` table of `~/.hermes/state.db`, one JSON object per row, with a subset of its columns. Written by research-chat on 2026-11-08 from Hermes Agent source at `NousResearch/hermes-agent@2bd378ed1b8d` (the installed v0.23.0 build reports local commit 2bd378ed1b8d), MIT:

- columns: `hermes_state_common.py:531-562` (`CREATE TABLE messages`): `role` (user, assistant, tool), `content`, `tool_calls` (JSON text), `tool_call_id`, `tool_name`, `finish_reason`, `timestamp` (epoch seconds, REAL), `active`.
- `tool_calls` is `json.dumps` of the live agent's list (`hermes_state_messages.py:92-99, 278`). The OpenAI chat shape `{id, type: function, function: {name, arguments}}` is INFERRED from the agent being OpenAI-compatible, not read from a row.
- The session id format and the tool name `terminal` are illustrative.

No Hermes session was opened. A real reader runs `sqlite3 -readonly` (or Python) through `exec`.
