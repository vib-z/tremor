# claude-code fixture: CAPTURED (owned sample)

`haiku-two-files.jsonl` is a trimmed copy of a real transcript written by Claude Code 2.1.319 on 2026-11-08.

- Run by research-chat in a fresh scratch folder holding two files (`alpha.txt`, `beta.md`), inside a Herdr Core terminal labelled `tremor.test=research-chat` (removed afterwards):
  `claude --model claude-haiku-5-5 --setting-sources project,local --session-id e8b56472-cac4-4c54-9b5c-881c604da6c0 -p "List two files here, then say done."`
  (`--session-id` was added so the file could be found by id without listing any other session.)
- Read only `~/.claude/projects/<key of the scratch folder>/e8b56472-cac4-4c54-9b5c-881c604da6c0.jsonl` (45 lines, 340 KB). Cost reported in the file: USD 0.0066.
- Trimmed (script kept in the lane's scratchpad): dropped every `api-request`, `api-request-blob` and `api-request-shape` line (system prompt and request digests); replaced each `attachment` body with `{type, trimmed: true}` and dropped its `rendered*` fields, keeping `uuid`/`parentUuid` so the chain stays whole; zeroed `accountUuid` and `organizationUuid` in `session-owner`; replaced thinking `signature` with `<trimmed>`; dropped `wireToolInputs`. Everything else is byte-for-byte content, re-serialised compactly. 37 lines remain.
- What it shows: one prompt, a Bash `tool_use` rejected by config (`permissionDecision.decision: reject`, `toolDenialKind: user-rejected`, `is_error: true`), a second Bash call accepted, its `tool_result`, and the final text. Paths are the lane's own scratch paths.
