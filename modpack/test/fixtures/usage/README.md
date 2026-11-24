# Usage source fixtures

Real output shapes captured on 2026-11-09 with the email masked before reading. Emails, ids, host names and the
credits balance are replaced with fake values, so the masking under test runs on a fake address.

- `moshi-usage.json`: `moshi usage` (moshi-hook 0.4.53), the cost block shortened and its numbers replaced.
- `codex-account.json`, `codex-rate-limits.json`: `codex app-server` (codex-cli 0.167.0) replies to
  `account/read` and `account/rateLimits/read`.
- `claude-auth-status.json`: `claude auth status --json` (Claude Code 2.1.319).
- `claude-usage.txt`: `claude --print --no-session-persistence --strict-mcp-config --setting-sources project,local
  "/usage"` (Claude Code 2.1.319): the header and the two limit lines as printed; the section after them is shortened
  and its figures are made up (the helper drops it).
- `claude-usage-session.txt`: the session line and the `h:mm` reset as CodeNotch documents them
  (`ClaudeUsageCLI.swift`, the comment above `line`), plus a week line with no reset; written here, not captured.
