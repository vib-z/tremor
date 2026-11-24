# cursor-agent fixture: DOCUMENTED print-mode stream only

`print-stream.jsonl` follows the NDJSON that `cursor-agent -p --output-format stream-json` prints, per https://cursor.com/docs/cli/reference/output-format (read 2026-11-08): `system/init`, `user`, `assistant`, `tool_call` `started`/`completed` sharing `call_id`, and `result`.

This is NOT the store an interactive Cursor Agent session writes. That store is undocumented and was not opened. A completed generic `function` tool call is shown without a `result`, because the docs give a result shape only for `readToolCall` and `writeToolCall`.
