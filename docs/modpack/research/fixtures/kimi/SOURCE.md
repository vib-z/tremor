# kimi fixture: CONSTRUCTED from source, not captured

`wire.jsonl` imitates `~/.kimi-code/sessions/<workspaceId>/<sessionId>/agents/main/wire.jsonl`. Written by research-chat on 2026-11-08 from Kimi Code source at `MoonshotAI/kimi-code@1c142a00` (tag `@moonshot-ai/kimi-code@2.5.2`, the installed version), MIT:

- layout: `docs/en/guides/sessions.md:5-26`, `docs/en/configuration/data-locations.md:38-85`.
- record types and checks: `packages/agent-core-v2/src/human/persist/v2/wire.ts:4, 22-33, 80-105, 128-145` (`metadata.protocol_version` first; `turn.prompt{promptId}`, `context.append_message{message}`, `turn.ended{turnId, reason}`).
- message shapes: `packages/agent-core-v2/src/human/message.ts:14-96` (`role` user/assistant/tool, `content` parts `text`/`think`, assistant `toolCalls[{type: function, id, name, arguments}]`, tool `toolCallId`).

NOT VERIFIED: that 2.5.2 writes exactly these records (the reader lives under `persist/v2`), the `time` unit, and whether real records carry more fields. The tool name `Shell` is illustrative.
