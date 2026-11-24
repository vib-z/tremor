// agentMeta (request 9a, the tree's agents view): the model and context use from the transcript the chat binds,
// against a fake `herdr` and the captured Claude and Codex samples (docs/modpack/research/fixtures/*/SOURCE.md).
import { test, expect, mock, beforeEach, afterAll } from "bun:test";
import { mkdirSync, cpSync, readdirSync, rmSync, readFileSync } from "node:fs";

const S = `/tmp/pdk-am${process.pid}`;
const PACK = new URL("..", import.meta.url).pathname;
const FIX = new URL("../../docs/modpack/research/fixtures/", import.meta.url).pathname;
mkdirSync(`${S}/lib`, { recursive: true });
for (const dir of ["adapters", "shared"]) for (const f of readdirSync(`${PACK}${dir}`)) if (f.endsWith(".js")) cpSync(`${PACK}${dir}/${f}`, `${S}/lib/${f}`);
afterAll(() => rmSync(S, { recursive: true, force: true }));

// bun keeps the first `herdr` mock's export list for the whole run: the same names as the other test files.
const HERDR = ["spaces", "panes", "terminals", "machines", "run", "hc", "notify", "readTextFile", "writeTextFile", "appHome", "home", "exec"];
mock.module("herdr", () => Object.fromEntries(HERDR.map((n) => [n, (...a) => globalThis.pdkHerdr[n](...a)])));

const H = `${S}/u`;
const ID = "e8b56472-cac4-4c54-9b5c-881c604da6c0";
const TH = "01a1bd47-5fc4-76f0-926e-e081542198de";
const START = "Mon Nov  9 09:15:30 2026";
const roll = `${H}/.codex/sessions/2026/11/09/rollout-2026-11-09T09-15-31-${TH}.jsonl`;
const asLines = (text) => text.split("\n").filter(Boolean).map((t, i) => [i, t]);
const CLAUDE = asLines(readFileSync(`${FIX}claude-code/haiku-two-files.jsonl`, "utf8"));
const CODEX = asLines(readFileSync(`${FIX}codex/rollout-luna-two-files.jsonl`, "utf8"));
let W;
const fake = {
  home: () => H,
  appHome: () => `${S}/home`,
  readTextFile: async (p) => { W.calls.push(["file", p]); return W.files[p] ?? null; },
  exec: async (_cmd, args) => {
    const [, , , command, ...rest] = args;
    W.calls.push([command, ...rest]);
    const reply = W.helper[command]?.(...rest) ?? { error: `no ${command}` };
    return { code: reply.error ? 2 : 0, stdout: JSON.stringify(reply), stderr: "" };
  },
};
globalThis.pdkHerdr = fake;
const { agentMeta, metaFromLines, claudeWindow, META_TAIL, META_MS } = await import(`${S}/lib/sessions.js`);

let pid = 100;
const term = (argv, address = "t3") => ({ address, state: "live", pid: 500, foreground: { pid: ++pid, argv, name: argv[0], cwd: "/w" }, status: "idle", labels: {} });
const reads = () => W.calls.filter((c) => c[0] === "read");
const ON = { live: () => true }; // a view that stays shown

beforeEach(() => {
  globalThis.pdkHerdr = fake;
  W = {
    calls: [],
    files: {},
    helper: {
      start: () => ({ start: START }),
      held: () => ({ alive: true, files: [roll] }),
      first: () => ({ line: JSON.stringify({ type: "session_meta", payload: { id: TH, source: "cli", cwd: "/w" } }) }),
      read: (path) => ({ lines: path.endsWith(".jsonl") && path.includes("/.codex/") ? CODEX : CLAUDE, skipped: [], start: 0, next: 1, eof: true }),
    },
  };
});
const claudeTerm = () => {
  const t = term(["claude"]);
  W.files[`${H}/.claude/sessions/${t.foreground.pid}.json`] = JSON.stringify({ pid: t.foreground.pid, sessionId: ID, cwd: "/w", procStart: START });
  return t;
};

test("Claude: the model and context use from the last main-thread assistant usage, read from the tail only", async () => {
  const m = await agentMeta(claudeTerm(), ON);
  // claude-haiku-5-5, last usage 2 + 286 + 39332 = 39620 of 1M.
  expect(m).toEqual({ model: "claude-haiku-5-5", effort: "medium", contextPct: 4, turn: "msg_011CgrFRUS5uvhGZkKkynVar", source: "Claude Code transcript" });
  const [r] = reads();
  expect(r[1]).toBe(`${H}/.claude/projects/-w/${ID}.jsonl`);
  expect(r.slice(2)).toEqual([String(-META_TAIL), String(META_TAIL), "1", "4096"]);
});

test("Codex: last_token_usage against model_context_window, the model from the last turn_context", async () => {
  const m = await agentMeta(term(["codex", "--no-daemon"]), ON);
  // gpt-6-luna; the last token_count's last_token_usage.total_tokens 27431 of 258400 (total_token_usage is 54822).
  expect(m).toEqual({ model: "gpt-6-luna", effort: "max", contextPct: 11, turn: "01a1bd47-65ca-7c93-a644-861a80701eb6", source: "Codex rollout" });
  expect(reads()[0][1]).toBe(roll);
});

test("null when nothing is bound: another machine, another agent, a plain shell, no session, a failed read", async () => {
  expect(await agentMeta(term(["claude"], "box/t3"), ON)).toBeNull();
  expect(await agentMeta(term(["hermes"]), ON)).toBeNull();
  expect(await agentMeta(term(["zsh"]), ON)).toBeNull();
  expect(W.calls).toEqual([]);
  expect(await agentMeta(term(["claude"]), ON)).toBeNull(); // no registry entry: Claude has not registered a session
  expect(reads()).toEqual([]);
  W.helper.read = () => ({ error: "path not allowed" });
  expect(await agentMeta(claudeTerm(), ON)).toBeNull();
  W.helper.read = () => ({ missing: true });
  expect(await agentMeta(claudeTerm(), ON)).toBeNull();
});

test("one read per terminal per META_MS, a read under way is shared, a new process reads again", async () => {
  const t = claudeTerm();
  const [a, b] = await Promise.all([agentMeta(t, ON), agentMeta(t, ON)]);
  expect(a).toEqual(b);
  expect(reads().length).toBe(1);
  await agentMeta(t, ON);
  expect(reads().length).toBe(1);
  const later = Date.now() + META_MS + 1;
  const now = Date.now;
  Date.now = () => later;
  try { await agentMeta(t, ON); } finally { Date.now = now; }
  expect(reads().length).toBe(2);
  await agentMeta(claudeTerm(), ON); // same address, another process
  expect(reads().length).toBe(3);
});

// Audit H5: metadata is read only for a view that is still shown for that target and session.
test("H5: no token, nothing read; hidden during the bind, the 512 KiB read never starts; answers stay with their session", async () => {
  expect(await agentMeta(claudeTerm())).toBeNull(); // no token: no view asked
  expect(W.calls).toEqual([]);
  // The audit's repro: hidden while the session was being bound.
  let shown = true;
  const real = W.helper.start;
  W.helper.start = (...a) => { shown = false; return real(...a); };
  expect(await agentMeta(claudeTerm(), { live: () => shown })).toBeNull();
  expect(reads()).toEqual([]);
  W.helper.start = real;
  // Shared: a read goes on while another asker is still shown, and each asker gets only what it may see.
  const t = claudeTerm();
  let a = true;
  const [ra, rb] = await Promise.all([agentMeta(t, { live: () => a }), (a = false, agentMeta(t, ON))]);
  expect(ra).toBeNull();
  expect(rb?.model).toBe("claude-haiku-5-5");
  expect(reads().length).toBe(1);
  // A cached answer is for its session: the asker's own session decides, else the session is resolved again.
  expect((await agentMeta(t, { ...ON, session: ID }))?.model).toBe("claude-haiku-5-5");
  expect(reads().length).toBe(1);
  expect(await agentMeta(t, { ...ON, session: "another-session" })).toBeNull(); // not the terminal's session: nothing read
  expect(reads().length).toBe(1);
  W.files[`${H}/.claude/sessions/${t.foreground.pid}.json`] = JSON.stringify({ pid: t.foreground.pid, sessionId: "e8b56472-cac4-4c54-9b5c-881c604da6c1", cwd: "/w", procStart: START });
  await agentMeta(t, ON); // /clear: same process, new session
  expect(reads().length).toBe(2);
  // The chat no longer asks: its Feed reads them from the lines it tails. The tree no longer asks: its agents view is gone
  // (spec §2, no alternate Tree/Agents mode).
  const chat = readFileSync(`${PACK}mods/pdk-chat/main.js`, "utf8"), tree = readFileSync(`${PACK}mods/pdk-tree/main.js`, "utf8");
  expect(chat).not.toContain("agentMeta"); // the chat takes model and context from its Feed's own lines (adapters/feed.js)
  expect(tree).not.toContain("agentMeta");
});

// The recheck's repro (review-audit-1109-recheck H5): A's read is pending when B's view asks for the same terminal.
test("H5: a read in flight is for one session: another session's asker never joins it, and a mismatch reads nothing", async () => {
  const t = claudeTerm();
  let a = true;
  const pa = agentMeta(t, { live: () => a, session: ID }); // A: the terminal's own session
  a = false; // A's view leaves while the bind is pending
  const pb = agentMeta(t, { ...ON, session: "session-B" }); // B joins with another session
  const [ra, rb] = await Promise.all([pa, pb]);
  expect(ra).toBeNull();
  expect(rb).toBeNull(); // never A's metadata
  expect(reads()).toEqual([]); // and A's transcript is not read for B
  // Askers of one session still share one read; the tree, with no session, gets the terminal's own.
  const [rc, rd] = await Promise.all([agentMeta(t, { ...ON, session: ID }), agentMeta(t, { ...ON, session: ID })]);
  expect([rc?.model, rd?.model]).toEqual(["claude-haiku-5-5", "claude-haiku-5-5"]);
  expect(reads().length).toBe(1);
  expect((await agentMeta(t, ON))?.model).toBe("claude-haiku-5-5");
});

test("nulls, never a guess: an unknown window, sub-agent and synthetic turns, no usage yet, use past the window", () => {
  const rec = (o) => [0, JSON.stringify(o)];
  const a = (model, usage, extra = {}) => rec({ type: "assistant", message: { model, usage }, ...extra });
  const u = { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 70 };
  expect(metaFromLines("claude", [a("claude-opus-4-5-20251101", u)])).toEqual({ model: "claude-opus-4-5-20251101", effort: null, contextPct: null, turn: 0 });
  expect(metaFromLines("claude", [a("claude-haiku-4-5", { input_tokens: 50000 }), a("claude-opus-5-5", u, { isSidechain: true }), a("<synthetic>", u)]))
    .toEqual({ model: "claude-haiku-4-5", effort: null, contextPct: 25, turn: 0 });
  expect(metaFromLines("claude", [a("claude-haiku-4-5", { input_tokens: 300000 })])).toEqual({ model: "claude-haiku-4-5", effort: null, contextPct: null, turn: 0 });
  expect(metaFromLines("claude", [a("claude-haiku-4-5", { input_tokens: "x" })])).toEqual({ model: "claude-haiku-4-5", effort: null, contextPct: null, turn: 0 });
  expect(metaFromLines("claude", [[0, "{not json"], rec({ type: "user" })])).toEqual({ model: null, effort: null, contextPct: null, turn: null });
  expect(claudeWindow("claude-haiku-4-5-20251001")).toBe(200000);
  expect(claudeWindow("claude-sonnet-5-5[1m]")).toBe(1e6);
  expect(claudeWindow("claude-opus-5")).toBe(1e6);
  expect(claudeWindow("claude-opus-5-55")).toBeNull();
  // Codex before its first answer: a token_count without info, no turn_context in the tail.
  expect(metaFromLines("codex", [rec({ type: "event_msg", payload: { type: "token_count", info: null } })])).toEqual({ model: null, effort: null, contextPct: null, turn: null });
  // Codex: only the last token_count counts, not an older, fuller one.
  const tc = (total, window) => rec({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { total_tokens: total }, model_context_window: window } } });
  expect(metaFromLines("codex", [rec({ type: "turn_context", payload: { model: "gpt-6" } }), tc(90000, 100000), tc(5000, 100000)])).toEqual({ model: "gpt-6", effort: null, contextPct: 5, turn: 0 });
});
