# opencode fixture: CONSTRUCTED from documented shapes, not captured

`session_message.jsonl` holds four rows of the `session_message` table of `opencode.db` (OpenCode 2.x; not installed here), one JSON object per row with `data` decoded. Written by research-chat on 2026-11-08 from Heeler `docs/research/opencode-session-store.md` ("Tables", "Ids and times", "Rows", "Assistant steps", "Tool items"; `ZingerLittleBee/Heeler@7bfe7fa`, Apache-2.0), observed on OpenCode 2.0.32.

INFERRED: the inner layout of a `tool` content item's `state` (documented only as streaming, then running with an input object, then completed with `content[]`) and the id suffixes.
