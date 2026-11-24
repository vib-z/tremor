// Binding by evidence only (D29, D32, M4): pid with start time, no guessing, fail closed.
import { test, expect } from "bun:test";
import { bindClaude, bindCodex, bindGrok, bindHermesBreadcrumb, breadcrumbPath, bindOpenCode, bindPi, bindKimi, bindGemini, projectKey, rolloutName, sameBinding, lstartMs } from "../adapters/binding.js";

const H = "/Users/x";
const ID = "e8b56472-cac4-4c54-9b5c-881c604da6c0";
const START = "Sun Nov  8 22:31:05 2026";
const reg = (o = {}) => JSON.stringify({ pid: 101, sessionId: ID, cwd: "/Users/x/code/app", procStart: START, ...o });

test("Claude: the registry entry for this pid and start binds its transcript path", () => {
  const b = bindClaude({ home: H, pid: 101, start: START, registryText: reg() });
  expect(b.ok).toBe(true);
  expect(b.session).toBe(ID);
  expect(b.path).toBe(`/Users/x/.claude/projects/-Users-x-code-app/${ID}.jsonl`);
});

test("Claude: a reused pid (another start time), another pid, no entry, or no transcript all bind nothing", () => {
  expect(bindClaude({ home: H, pid: 101, start: "Sun Nov  8 20:00:00 2026", registryText: reg() }).ok).toBe(false);
  expect(bindClaude({ home: H, pid: 101, start: START, registryText: reg({ pid: 202 }) }).ok).toBe(false);
  expect(bindClaude({ home: H, pid: 101, start: START, registryText: null }).ok).toBe(false);
  expect(bindClaude({ home: H, pid: 101, start: START, registryText: "{not json" }).ok).toBe(false);
  expect(bindClaude({ home: H, pid: 101, start: START, registryText: reg(), env: { CLAUDE_CODE_CHILD_SESSION: "1" } }).ok).toBe(false);
});

test("Claude: /clear writes a new session id into the same entry, and the binding changes with it", () => {
  const a = bindClaude({ home: H, pid: 101, start: START, registryText: reg() });
  const b = bindClaude({ home: H, pid: 101, start: START, registryText: reg({ sessionId: "11111111-2222-4333-8444-555555555555" }) });
  expect(sameBinding({ ...a, pid: 101, start: START }, { ...b, pid: 101, start: START })).toBe(false);
});

test("Claude project key: every non-alphanumeric is a dash; long keys get the CLI's hash suffix", () => {
  expect(projectKey("/private/tmp/a b.c")).toBe("-private-tmp-a-b-c");
  const long = "/x".repeat(150);
  const k = projectKey(long);
  expect(k.startsWith("-x".repeat(100))).toBe(true);
  expect(k.length).toBeGreaterThan(201);
});

const T1 = "01a1bd47-5fc4-76f0-926e-e081542198de";
const T2 = "0b2c8d10-5a1e-4c7e-9d2f-3e4a5b6c7d8e";
const roll = (t) => `${H}/.codex/sessions/2026/11/08/rollout-2026-11-08T22-28-54-${t}.jsonl`;
const head = (t, p = {}) => JSON.stringify({ type: "session_meta", payload: { id: t, source: "cli", cwd: "/w", ...p } });
const argv = ["codex", "--no-daemon"];

test("Codex: exactly one held root rollout whose head names its thread binds", () => {
  const b = bindCodex({ home: H, argv, held: [roll(T1), `${H}/.codex/thread-writer-locks/${T1}.lock`], heads: { [roll(T1)]: head(T1) } });
  expect(b.ok).toBe(true);
  expect(b.session).toBe(T1);
});

test("Codex: shared daemon, nothing held yet, /new lock without its file, two roots, a wrong head, sub-agents only: no binding", () => {
  expect(bindCodex({ home: H, argv: ["codex"], held: [], heads: {} }).reason).toMatch(/daemon/);
  expect(bindCodex({ home: H, argv, held: [], heads: {} }).reason).toMatch(/first message/);
  expect(bindCodex({ home: H, argv, held: [roll(T1), `${H}/.codex/thread-writer-locks/${T2}.lock`], heads: { [roll(T1)]: head(T1) } }).ok).toBe(false);
  expect(bindCodex({ home: H, argv, held: [roll(T1), roll(T2)], heads: { [roll(T1)]: head(T1), [roll(T2)]: head(T2) } }).ok).toBe(false);
  expect(bindCodex({ home: H, argv, held: [roll(T1)], heads: { [roll(T1)]: head(T2) } }).ok).toBe(false);
  expect(bindCodex({ home: H, argv, held: [roll(T1)], heads: { [roll(T1)]: head(T1, { thread_source: "subagent" }) } }).ok).toBe(false);
  expect(bindCodex({ home: H, argv: ["codex", "app-server"], held: [roll(T1)], heads: { [roll(T1)]: head(T1) } }).ok).toBe(false);
  expect(bindCodex({ home: H, argv, held: null, heads: {} }).ok).toBe(false);
});

test("Codex: a lock left by a thread abandoned before its first message (older UUIDv7) doesn't block; a newer one does", () => {
  const OLD = "01a1ccdc-39b5-7831-a72e-3f5e8a0f056b", NOW = "01a1ccdd-9b08-73a0-b4f4-cfceadd1d7ee", NEWER = "01a1ccde-0000-7000-8000-000000000000";
  const lock = (t) => `${H}/.codex/thread-writer-locks/${t}.lock`;
  const b = bindCodex({ home: H, argv, held: [roll(NOW), lock(OLD), lock(NOW)], heads: { [roll(NOW)]: head(NOW) } });
  expect([b.ok, b.session]).toEqual([true, NOW]);
  expect(bindCodex({ home: H, argv, held: [roll(NOW), lock(NOW), lock(NEWER)], heads: { [roll(NOW)]: head(NOW) } }).reason).toMatch(/new thread/);
});

test("Codex: of several held conversations, the one written last binds; a tie or an unknown time binds nothing", () => {
  const A = "01a1cce6-8947-7dd2-a5c2-b1bee5dc42b6", B = "01a1cce7-9ffc-7b73-9be4-73c8446929f2";
  const lock = (t) => `${H}/.codex/thread-writer-locks/${t}.lock`;
  const held = [roll(A), roll(B), lock(A), lock(B)];
  const heads = { [roll(A)]: head(A), [roll(B)]: head(B) };
  const st = (a, b) => ({ [roll(A)]: { size: 9, mtimeMs: a }, [roll(B)]: { size: 9, mtimeMs: b } });
  expect(bindCodex({ home: H, argv, held, heads, stats: st(1000, 5000) }).session).toBe(B); // after /clear: the new one
  expect(bindCodex({ home: H, argv, held, heads, stats: st(9000, 5000) }).session).toBe(A); // a /resume of the older
  expect(bindCodex({ home: H, argv, held, heads, stats: st(5000, 5000) }).reason).toMatch(/same moment/);
  expect(bindCodex({ home: H, argv, held, heads, stats: { [roll(A)]: { mtimeMs: 1 } } }).reason).toMatch(/more than one/);
  expect(bindCodex({ home: H, argv, held, heads }).ok).toBe(false);
});

test("Codex: a root plus its own sub-agent rollout still binds the root", () => {
  const b = bindCodex({ home: H, argv, held: [roll(T1), roll(T2)], heads: { [roll(T1)]: head(T1), [roll(T2)]: head(T2, { parent_thread_id: T1, source: { subagent: T1 } }) } });
  expect(b.ok).toBe(true);
  expect(b.session).toBe(T1);
});

test("Codex rollout names", () => {
  expect(rolloutName(roll(T1)).thread).toBe(T1);
  expect(rolloutName("rollout-2026-11-08T22-28-54-abc_def.jsonl")).toMatchObject({ thread: "abc", rollout: "def" });
  expect(rolloutName("notes.jsonl")).toBeNull();
  expect(rolloutName(roll(T1) + ".zst").compressed).toBe(true);
});

test("Grok, Hermes, OpenCode, Pi: bound only from their own evidence; Kimi and Gemini refuse without listing", () => {
  const g = (rows, start = Date.UTC(2026, 10, 8, 22, 31, 5)) => bindGrok({ home: H, pid: 7, startEpochMs: start, registryText: JSON.stringify(rows) });
  const row = { session_id: ID, pid: 7, pid_start: Date.UTC(2026, 10, 8, 22, 31, 5) * 1000, cwd: "/w s" };
  expect(g([row]).path).toBe(`${H}/.grok/sessions/%2Fw%20s/${ID}/updates.jsonl`);
  expect(g([row, { ...row, session_id: "11111111-2222-4333-8444-555555555555" }]).ok).toBe(false);
  expect(g([row], Date.UTC(2026, 10, 8, 20, 0, 0)).ok).toBe(false);
  expect(bindOpenCode({ argv: ["opencode", "-s", "ses_abc123"] }).session).toBe("ses_abc123");
  expect(bindOpenCode({ argv: ["opencode"] }).ok).toBe(false);
  const label = JSON.stringify({ session: "p1", file: `${H}/.pi/agent/sessions/x/1_p1.jsonl`, pid: 5, start: START });
  expect(bindPi({ home: H, pid: 5, start: START, labels: { "heeler.session": label } }).ok).toBe(true);
  expect(bindPi({ home: H, pid: 6, start: START, labels: { "heeler.session": label } }).ok).toBe(false);
  expect(bindPi({ home: H, pid: 5, start: START, labels: { "heeler.session": JSON.stringify({ session: "p", file: "/etc/passwd", pid: 5, start: START }) } }).ok).toBe(false);
  expect(bindKimi().ok).toBe(false);
  expect(bindGemini().ok).toBe(false);
});

test("ps lstart in C/UTC to epoch", () => {
  expect(lstartMs("Sun Nov  8 22:31:05 2026")).toBe(Date.UTC(2026, 10, 8, 22, 31, 5));
  expect(lstartMs("garbage")).toBeNull();
});

// F4 for Hermes 0.23.0, from qa-modpack's capture (test/fixtures/hermes/tty-dev-ttys055.json on qa/modpack 10923d0):
// pid 27388 on ttys055 started 09:00:21 UTC; Hermes wrote its terminal record 3.4 s later. No pid lease exists.
const CRUMB = '{"session_id": "local-fd77ba7dbbb3120a3c876b5c082501f0de12a10231f91aff3d61b3bac8c10af5", "cwd": "/Users/me/code/jobs/worktrees/core-client-1108-qa/modpack/.sandbox/qa/work/alpha", "ts": 1794214824.711264}';
const CWD = "/Users/me/code/jobs/worktrees/core-client-1108-qa/modpack/.sandbox/qa/work/alpha";
const BORN = Date.UTC(2026, 10, 9, 9, 0, 21);

test("F4: Hermes binds its terminal's record only for a live process, written after it started, for its folder", () => {
  const h = (o = {}) => bindHermesBreadcrumb({ pid: 27388, tty: "ttys055", startEpochMs: BORN, cwd: CWD, breadcrumbText: CRUMB, ...o });
  expect(h()).toMatchObject({ ok: true, session: "local-fd77ba7dbbb3120a3c876b5c082501f0de12a10231f91aff3d61b3bac8c10af5", store: "hermes" });
  expect(breadcrumbPath(H, "ttys055")).toBe(`${H}/.hermes/terminal-sessions/tty-dev-ttys055`);
  // A later process on the same tty, before Hermes wrote its own record: the old record is not its session.
  expect(h({ startEpochMs: Date.UTC(2026, 10, 9, 9, 5, 0) }).reason).toMatch(/earlier process on this terminal/);
  expect(h({ startEpochMs: BORN + 4000 }).ok).toBe(false);
  // Gone, no terminal device, no record yet, another folder, unreadable or timeless records.
  expect(h({ startEpochMs: null }).reason).toMatch(/gone/);
  expect(h({ tty: null }).reason).toMatch(/no terminal device/);
  expect(h({ breadcrumbText: null }).reason).toMatch(/not recorded/);
  expect(h({ cwd: "/Users/x/elsewhere" }).reason).toMatch(/another folder/);
  expect(h({ breadcrumbText: "{" }).ok).toBe(false);
  expect(h({ breadcrumbText: JSON.stringify({ session_id: "s", cwd: CWD }) }).reason).toMatch(/no time/);
  // macOS reports /tmp folders under /private either way round.
  expect(h({ cwd: "/private/tmp/w", breadcrumbText: JSON.stringify({ session_id: "s", cwd: "/tmp/w/", ts: BORN / 1000 + 1 }) }).ok).toBe(true);
});
