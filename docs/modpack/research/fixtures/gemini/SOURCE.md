# gemini fixture: CONSTRUCTED from source, not captured

`session.jsonl` imitates `~/.gemini/tmp/<projectIdentifier>/chats/session-<timestamp>-<shortId>.jsonl`. Written by research-chat on 2026-11-08 from Gemini CLI source at `google-gemini/gemini-cli@dc6602ce` (tag v0.67.0, the installed version), Apache-2.0:

- types: `packages/core/src/services/chatRecordingTypes.ts` (`ConversationRecord` header fields, `MessageRecord` with `type` user/gemini/info/error/warning, `ToolCallRecord{id, name, args, result, status}`, `$patch`, `$set`, `$rewindTo` records).
- writer: `packages/core/src/services/chatRecordingService.ts:781-823` (path and name), `:940-956` (append one JSON line), `:963-1008` (atomic whole-file rewrite: header line, then one line per message).

INFERRED: the `result` part shape (a Gemini `functionResponse` part), the `status` values and the model name. A tool result arriving as a later `$patch` of the same message id is the reading of `ToolCallPatch`/`MessagePatch`, not an observed file.
