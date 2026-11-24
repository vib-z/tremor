// The chat feed's contract (adapters/feed.js), against a fake transport and a fake clock: the session is decided
// from probe evidence only, one runner at a time, nothing while hidden, late answers dropped, a failure retried by
// backoff and read on from the cursor, a new session or process starts the thread over.
import { test, expect } from "bun:test";
import { Feed, WAIT_MS, IDLE_MS, REPROBE_MS, BACKOFF_MS, THREAD_MAX } from "../adapters/feed.js";

const HOME = "/Users/u";
const START = "Wed Nov 11 22:00:00 2026";
const SID = "0b2c8d10-5a1e-4c7e-9d2f-3e4a5b6c7d8e";
const SID2 = "1b2c8d10-5a1e-4c7e-9d2f-3e4a5b6c7d8e";
const PATH = (sid = SID) => `${HOME}/.claude/projects/-work-app/${sid}.jsonl`;
const registry = (sid = SID, pid = 41) => JSON.stringify({ pid, sessionId: sid, cwd: "/work/app", procStart: START });
const term = (pid = 41) => ({ address: "t1", foreground: { pid, argv: ["claude"] } });
const user = (id, text) => JSON.stringify({ type: "user", uuid: id, timestamp: "2026-11-11T22:00:01Z", message: { content: text } });
const said = (id, text) => JSON.stringify({ type: "assistant", uuid: id, timestamp: "2026-11-11T22:00:02Z", message: { id: `m-${id}`, content: [{ type: "text", text }] } });

// A fake machine: one session file as lines, served through the transport's two commands as the helper answers them.
function world({ sid = SID, proved = false } = {}) {
  const w = { now: 1000, calls: [], lines: [], sid, registryPid: 41, fail: null, hold: null, proved, dev: 1, ino: 7 };
  w.call = async (command, req, opts) => {
    w.calls.push([command, req, opts]);
    if (w.hold) await w.hold;
    if (w.fail) throw w.fail;
    if (command === "probe") return { home: HOME, start: START, registryText: registry(w.sid, w.registryPid) };
    if (req.path !== PATH(w.sid)) return { missing: true };
    let at = 0;
    const all = w.lines.map((text) => { const row = [at, text]; at += text.length + 1; return row; });
    const from = req.offset < 0 ? 0 : req.offset;
    return { dev: w.dev, ino: w.ino, size: at, head: "h", headLen: req.headLen, start: from, next: at, eof: true, lines: all.filter((l) => l[0] >= from), skipped: [], ...(w.proved ? { proved: true } : {}) };
  };
  w.feed = () => new Feed({ address: "t1", kind: "claude", call: w.call, now: () => w.now });
  return w;
}
const CXP = `${HOME}/.codex/sessions/2026/11/11/rollout-2026-11-11T22-00-00-01a1bd47-5fc4-76f0-926e-e081542198de.jsonl`;
const CXHEAD = JSON.stringify({ type: "session_meta", payload: { id: "01a1bd47-5fc4-76f0-926e-e081542198de", cwd: "/w" } });
const texts = (f) => f.thread.rows().map((r) => r.text);
const names = (w) => w.calls.map((c) => c[0]);

test("binds from the probe's evidence, then reads the session file into the thread", async () => {
  const w = world(); w.lines = [user("u1", "hello"), said("a1", "hi there")];
  const f = w.feed();
  expect(f.state).toBe("finding");
  await f.step(term()); // the proof goes straight on to its first read (chat-show E1)
  expect(f.binding).toMatchObject({ ok: true, session: SID, path: PATH(), pid: 41, start: START });
  expect(f.state).toBe("live");
  expect(texts(f)).toEqual(["hello", "hi there"]);
  expect(names(w)).toEqual(["probe", "tail"]);
  expect(f.caughtUpAt).toBe(1000);
});

test("no proof binds nothing and says why; it is asked again only after REPROBE_MS", async () => {
  const w = world(); w.registryPid = 99; // the registry names another process
  const f = w.feed();
  expect(await f.step(term())).toBe(true);
  expect(f.state).toBe("unbound");
  expect(f.reason).toMatch(/another process/);
  expect(f.step(term())).toBe(null);
  w.now += REPROBE_MS;
  expect(f.step(term())).not.toBe(null);
  expect(names(w)).toEqual(["probe", "probe"]);
});

test("one runner at a time, and nothing is read while hidden", async () => {
  const w = world(); const f = w.feed();
  expect(f.step(term(), { shown: false })).toBe(null);
  let release; w.hold = new Promise((r) => { release = r; });
  const run = f.step(term());
  expect(f.step(term())).toBe(null);
  release(); w.hold = null; await run;
  expect(names(w)).toEqual(["probe", "tail"]); // one runner: the proof and its first read
});

test("new lines are read on from the cursor: nothing twice, and an idle transport is not asked more than once a second", async () => {
  const w = world(); w.lines = [user("u1", "one")];
  const f = w.feed();
  await f.step(term());
  expect(await f.step(term())).toBe(false); // caught up: this tail may wait, and brings nothing
  expect(f.step(term())).toBe(null); // nothing new: not asked again before IDLE_MS
  w.lines.push(said("a1", "two"));
  w.now += IDLE_MS;
  await f.step(term());
  expect(texts(f)).toEqual(["one", "two"]);
  const tails = w.calls.filter((c) => c[0] === "tail");
  expect(tails[0][1].wait).toBe(0); // the first read never waits
  expect(tails[1][1]).toMatchObject({ offset: w.lines[0].length + 1, wait: WAIT_MS, session: SID, procStart: START });
});

test("a tail that proves itself needs no probe in between; one that doesn't is proven again every REPROBE_MS", async () => {
  for (const proved of [true, false]) {
    const w = world({ proved }); const f = w.feed();
    await f.step(term()); await f.step(term());
    w.now += REPROBE_MS; await f.step(term());
    expect(names(w)[2]).toBe(proved ? "tail" : "probe");
  }
});

test("another process in the terminal starts over and drops the late answer of the old one", async () => {
  const w = world(); w.lines = [user("u1", "old")];
  const f = w.feed();
  await f.step(term()); await f.step(term());
  const gen = f.gen;
  w.now += IDLE_MS;
  let release; w.hold = new Promise((r) => { release = r; });
  const late = f.step(term()); // a tail in flight for pid 41
  w.registryPid = 42; w.sid = SID2; w.lines = [user("u2", "new")];
  const next = f.step(term(42)); // pid 42 now: the old answer must not land
  expect(next).not.toBe(null);
  expect(f.state).toBe("finding");
  expect([f.gen, f.stale, texts(f)]).toEqual([gen, true, ["old"]]); // the old rows stay until the new first read lands
  release(); w.hold = null;
  expect(await late).toBe(false);
  await next; await f.step(term(42));
  expect(f.binding.session).toBe(SID2);
  expect(texts(f)).toEqual(["new"]);
  expect(f.gen).toBe(gen + 1);
});

test("a new session in the same process (/clear) starts the thread over", async () => {
  const w = world(); w.lines = [user("u1", "before")];
  const f = w.feed();
  await f.step(term()); await f.step(term());
  const gen = f.gen;
  w.sid = SID2; w.lines = [user("u2", "after")];
  f.kick();
  await f.step(term()); await f.step(term());
  expect(f.gen).toBe(gen + 1);
  expect(texts(f)).toEqual(["after"]);
});

test("a machine that drops is retried by backoff, proven again and read on with nothing lost or doubled", async () => {
  const w = world({ proved: true }); w.lines = [user("u1", "one")];
  const f = w.feed();
  await f.step(term()); await f.step(term());
  w.fail = Object.assign(new Error("machine unreachable"), { offline: true });
  w.now += IDLE_MS;
  expect(await f.step(term())).toBe(true);
  expect(f.state).toBe("offline");
  expect(f.reason).toBe("machine unreachable");
  expect(f.step(term())).toBe(null); // not before the backoff
  w.now += BACKOFF_MS[0]; await f.step(term());
  expect(f.state).toBe("offline");
  w.now += BACKOFF_MS[1] - 1;
  expect(f.step(term())).toBe(null);
  w.fail = null; w.lines.push(said("a1", "two")); w.now += 1;
  const before = w.calls.length;
  await f.step(term()); // proven again and read in one step
  expect(names(w).slice(before)).toEqual(["probe", "tail"]);
  expect(f.state).toBe("live");
  expect(texts(f)).toEqual(["one", "two"]);
  const helperSaidNo = world(); helperSaidNo.fail = new Error("path not allowed");
  const g = helperSaidNo.feed(); await g.step(term());
  expect(g.state).toBe("error");
});

test("a replaced file starts the thread over; a file not written yet waits", async () => {
  const w = world(); w.lines = [user("u1", "one")];
  const f = w.feed();
  await f.step(term()); await f.step(term());
  w.ino = 8; w.lines = [user("u9", "rewritten")]; w.now += IDLE_MS;
  await f.step(term());
  expect(texts(f)).toEqual(["rewritten"]);
  const none = world(); none.call = async (c) => (c === "probe" ? { home: HOME, start: START, registryText: registry() } : { missing: true });
  const g = none.feed(); await g.step(term()); await g.step(term());
  expect(g.state).toBe("waiting");
});

test("a closed feed starts nothing", async () => {
  const w = world(); const f = w.feed();
  f.close();
  expect(f.step(term())).toBe(null);
});

const answer = (id, model, input, extra = {}) => JSON.stringify({ type: "assistant", uuid: id, timestamp: "2026-11-11T22:00:02Z", ...extra,
  message: { id: `m-${id}`, model, usage: { input_tokens: input, cache_read_input_tokens: 0 }, content: [{ type: "text", text: id }] } });

test("meta comes from the lines read, with no read of its own, and follows each new turn", async () => {
  const w = world(); w.lines = [user("u1", "hi"), answer("a1", "claude-haiku-5-5", 50000, { effort: "low" }), user("u2", "more")];
  const f = w.feed();
  await f.step(term()); await f.step(term());
  expect(f.meta).toEqual({ model: "claude-haiku-5-5", effort: "low", contextPct: 5, turn: "m-a1", source: "Claude Code transcript" });
  w.lines.push(answer("a2", "claude-opus-5-5", 100000, { isSidechain: true })); // a sub-agent's: not this conversation's
  w.now += IDLE_MS; await f.step(term());
  expect(f.meta.turn).toBe("m-a1");
  w.lines.push(answer("a3", "claude-opus-5-5", 200000));
  w.now += IDLE_MS; await f.step(term());
  expect(f.meta).toMatchObject({ model: "claude-opus-5-5", contextPct: 20, turn: "m-a3" });
  expect(f.metaRecs.length).toBe(1); // only what meta needs is kept
  expect(names(w)).toEqual(["probe", "tail", "tail", "tail", "tail"]);
});

test("Codex meta joins a turn_context and a token_count read in different pages", async () => {
  const pages = [
    [[0, JSON.stringify({ type: "turn_context", payload: { model: "gpt-6-luna", effort: "low", turn_id: "t1" } })]],
    [[100, JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { total_tokens: 30000 }, model_context_window: 100000 } } })]],
  ];
  let n = 0;
  const seen = [];
  const call = async (command, req) => {
    if (command === "tail") seen.push(req);
    if (command === "probe") return { home: HOME, start: START, held: [CXP], heads: { [CXP]: CXHEAD } };
    const lines = pages[n] ?? []; const last = n >= pages.length - 1; n++;
    return { dev: 1, ino: 2, size: 200, head: "h", headLen: 4096, start: 0, next: lines.length ? lines[0][0] + 50 : 200, eof: last, lines, skipped: [], proved: true };
  };
  const f = new Feed({ address: "t2", kind: "codex", call, now: () => 1000 });
  await f.step({ address: "t2", foreground: { pid: 51, argv: ["codex", "--no-daemon"] } });
  expect(f.binding.ok).toBe(true);
  await f.step({ address: "t2", foreground: { pid: 51, argv: ["codex", "--no-daemon"] } });
  expect(f.meta).toEqual({ model: "gpt-6-luna", effort: "low", contextPct: 30, turn: "t1", source: "Codex rollout" });
  expect(f.binding.marks).toEqual([CXP.slice(`${HOME}/.codex/`.length)]); // what a tail checks is still held
  expect(seen.filter((q) => q.marks).length).toBe(seen.length);
});

test("a thread past THREAD_MAX entries lets its oldest third go and says earlier messages are not shown", async () => {
  const w = world(); w.lines = Array.from({ length: THREAD_MAX + 1 }, (_, i) => user(`u${i}`, `m${i}`));
  const f = w.feed();
  await f.step(term()); await f.step(term());
  expect(f.cut).toBe(true);
  expect(f.thread.entries.length).toBe(THREAD_MAX + 1 - Math.floor((THREAD_MAX + 1) / 3));
  expect(texts(f).at(-1)).toBe(`m${THREAD_MAX}`);
});

test("a session file not written yet is waited for by the helper, not asked for every second", async () => {
  const w = world();
  w.call = async (command, req) => { w.calls.push([command, req]); return command === "probe" ? { home: HOME, start: START, registryText: registry() } : { missing: true, proved: true }; };
  const f = w.feed();
  await f.step(term()); await f.step(term());
  expect(f.state).toBe("waiting");
  w.now += IDLE_MS; await f.step(term());
  expect(w.calls.filter((c) => c[0] === "tail").map((c) => c[1].wait)).toEqual([0, WAIT_MS]);
});

test("R2: a Codex bound among several held conversations moves when another becomes the one written last, within one waiting tail", async () => {
  const TA = "01a1cce6-8947-7dd2-a5c2-b1bee5dc42b6", TB = "01a1cce7-9ffc-7b73-9be4-73c8446929f2";
  const roll = (t) => `${HOME}/.codex/sessions/2026/11/12/rollout-2026-11-12T00-00-00-${t}.jsonl`;
  const head = (t) => JSON.stringify({ type: "session_meta", payload: { id: t, cwd: "/w" } });
  const times = { [roll(TA)]: 20, [roll(TB)]: 10 };
  let now = 1000;
  const tails = [];
  // The transport proves every tail (as a helper that only checks the held set would): the Feed must not rely on it.
  const call = async (command, req) => {
    if (command === "probe") return { home: HOME, start: START, held: [roll(TA), roll(TB)], heads: { [roll(TA)]: head(TA), [roll(TB)]: head(TB) },
      stats: Object.fromEntries(Object.entries(times).map(([p, t]) => [p, { size: 1, mtimeMs: t }])) };
    tails.push(req.path);
    if (req.wait) now += req.wait;
    return { dev: 1, ino: req.path === roll(TA) ? 2 : 3, size: 0, head: "h", headLen: 4096, start: 0, next: 0, eof: true, lines: [], skipped: [], proved: true };
  };
  const f = new Feed({ address: "t3", kind: "codex", call, now: () => now });
  const t = { address: "t3", foreground: { pid: 61, argv: ["codex", "--no-daemon"] } };
  await f.step(t); await f.step(t);
  expect(f.binding.session).toBe(TA);
  expect(f.binding.roots).toEqual([roll(TA), roll(TB)]);
  await f.step(t); // a waiting tail
  times[roll(TB)] = 30; // B is written: it is the conversation now
  now += IDLE_MS;
  await f.step(t); // the next waiting tail of A
  await f.step(t); await f.step(t);
  expect(f.binding.session).toBe(TB);
  expect(tails.at(-1)).toBe(roll(TB));
});

test("R5: a line too long for one answer is asked for through slim, so a remote pasted image keeps its text", async () => {
  const w = world();
  const slimmed = { type: "user", uuid: "u9", timestamp: "2026-11-11T22:00:01Z", message: { content: [{ type: "text", text: "Inspect this image" },
    { type: "image", source: { type: "base64", media_type: "image/png", data: "", pdk_bytes: 450000 } }] } };
  const asked = [];
  w.call = async (command, req, opts) => {
    w.calls.push([command, req, opts]);
    if (command === "probe") return { home: HOME, start: START, registryText: registry() };
    if (command === "slim") { asked.push(req); return req.offset === 0 ? { record: slimmed, proved: true } : { error: "line too long" }; }
    return { dev: 1, ino: 7, size: 600193, head: "h", headLen: 4096, start: 0, next: 600193, eof: true, lines: [], skipped: [[0, 600192], [700000, 9]], proved: true };
  };
  const f = new Feed({ address: "t1", kind: "claude", on: "box", call: w.call, now: () => w.now });
  await f.step(term()); await f.step(term());
  expect(texts(f)).toEqual(["Inspect this image"]);
  expect(f.thread.rows()[0].media?.[0]).toMatchObject({ src: "inline", offset: 0, index: 0, bytes: 450000 });
  expect(asked[0]).toMatchObject({ kind: "claude", pid: 41, procStart: START, session: SID, path: PATH(), offset: 0 });
  expect(w.calls.find((c) => c[0] === "slim")[2].on).toBe("box");
  expect(f.skipped).toBe(1); // the one that could not be slimmed still counts
});
