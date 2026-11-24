# grok fixture: CONSTRUCTED from documented shapes, not captured

`updates.jsonl` imitates `~/.grok/sessions/<percent-encoded cwd>/<sessionId>/updates.jsonl`. Written by research-chat on 2026-11-08 from:

- Heeler `docs/research/grok-build-transcript-format.md` sections "Identity and location" and "Records and turns" (`ZingerLittleBee/Heeler@7bfe7fa`, Apache-2.0), observed on Grok Build 1.0.62 to 1.0.70;
- the record shapes in Heeler `Tests/HeelerTests/ChatFixtures/grok/core-turns.jsonl` (same commit).

The installed Grok Build is 1.0.77, newer than any Heeler observation. Ids, timestamps and text are made up; usage fields are left out of `turn_completed`.
