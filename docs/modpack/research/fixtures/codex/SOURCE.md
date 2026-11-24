# codex fixture: CAPTURED (owned sample)

`rollout-luna-two-files.jsonl` is a trimmed copy of a real rollout written by codex-cli 0.167.0 on 2026-11-08.

- Run by research-chat in a fresh scratch folder holding two files, inside a Herdr Core terminal labelled `tremor.test=research-chat` (removed afterwards):
  `codex exec -m gpt-6-luna --skip-git-repo-check "List two files here, then say done."`
  (`--skip-git-repo-check` is needed outside a git repository.) The run printed `session id: 01a1bd47-5fc4-76f0-926e-e081542198de`.
- Read only `~/.codex/sessions/2026/11/08/rollout-2026-11-08T22-28-54-01a1bd47-5fc4-76f0-926e-e081542198de.jsonl` (27 lines, 183 KB), found by that id.
- Trimmed: `session_meta.payload.base_instructions` and `creator_user_id` replaced with `<trimmed>`, `creator_account_id` zeroed; developer `message` items, the owner's global AGENTS.md user item, `world_state` and `additional_tools.tools` replaced with placeholders; reasoning `encrypted_content` replaced. Every line and `ordinal` (0 to 26) is kept, so a reader can test ordinal rules.
- The run used the owner's Codex user config (it loaded hooks and MCP servers; `sandbox: danger-full-access`, `approval: never`), because the brief's command has no flag to skip it. Nothing from that config is in the fixture beyond these two words.
- What it shows: paginated dialect (`history_mode: paginated`), `task_started`, `UserMessage`, an empty `Reasoning`, a `commentary` `AgentMessage`, a code-mode `custom_tool_call` (`exec`) and its `custom_tool_call_output` sharing `call_id`, the `CommandExecution` turn item, the `final_answer` `AgentMessage`, `token_count` and `task_complete`.
