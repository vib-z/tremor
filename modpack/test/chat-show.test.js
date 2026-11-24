// Chat stays on screen and shows at once (owner, 12 Nov 2026: "the chat disappears and take long to show up").
// Measured before (reports/measure-before.md): a first open waited for the loop's next second twice (to prove, then
// to read), read 2 MB in four pages before anything was drawn, and its first render had no list; a start-over or one
// failed proof threw the drawn thread away before anything new was read. These run the real Feed and the real Chat
// view (mods/pdk-chat/main.js, its render, against stand-ins for the app) on a fake transport.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { harness, world } from "./parity-harness.js";
import * as chat from "../adapters/chat.js";
import * as reader from "../adapters/reader.js";
import * as feed from "../adapters/feed.js";
import * as appear from "../adapters/appear.js";
import * as composer from "../adapters/composer.js";
import * as slash from "../adapters/slash-commands.js";
import * as models from "../adapters/models.js";
import * as inter from "../adapters/interactions.js";
import * as amedia from "../adapters/media.js";
import * as factory from "../adapters/factory.js";
import * as tail from "../adapters/tail.js";
import * as codeview from "../adapters/codeview.js";
import * as status from "../adapters/status.js";
import * as agents from "../adapters/agents.js";
import * as tokens from "../adapters/tokens.js";
import * as views from "../adapters/views.js";

const { Feed, FIRST, REPROBE_MS } = feed;
const PACK = new URL("..", import.meta.url).pathname;
const HOME = "/Users/u", START = "Wed Nov 11 22:00:00 2026";
const SID = "0b2c8d10-5a1e-4c7e-9d2f-3e4a5b6c7d8e", SID2 = "1b2c8d10-5a1e-4c7e-9d2f-3e4a5b6c7d8e";
const PATH = (sid) => `${HOME}/.claude/projects/-work-app/${sid}.jsonl`;
const user = (id, text) => JSON.stringify({ type: "user", uuid: id, timestamp: "2026-11-11T22:00:01Z", message: { content: text } });
const said = (id, text) => JSON.stringify({ type: "assistant", uuid: id, timestamp: "2026-11-11T22:00:02Z", message: { id: `m-${id}`, content: [{ type: "text", text }] } });

// A fake machine: sessions as lines, the registry naming one, answered as the helper answers (offset < 0: the tail).
function machine() {
  const m = { now: 1000, calls: [], files: { [SID]: [user("u1", "hello"), said("a1", "hi there")] }, sid: SID, pid: 41, hold: null, holdTail: null };
  m.call = async (command, req) => {
    m.calls.push(command);
    if (m.hold) await m.hold;
    if (command === "tail" && m.holdTail) await m.holdTail;
    if (command === "probe") return { home: HOME, start: START, registryText: JSON.stringify({ pid: m.pid, sessionId: m.sid, cwd: "/work/app", procStart: START }) };
    const sid = Object.keys(m.files).find((s) => PATH(s) === req.path);
    if (!sid) return { missing: true };
    let at = 0;
    const all = m.files[sid].map((t) => { const r = [at, t]; at += t.length + 1; return r; });
    const from = req.offset < 0 ? Math.max(0, at + req.offset) : req.offset;
    const lines = all.filter((l) => l[0] >= from);
    return { dev: 1, ino: sid === SID ? 7 : 8, size: at, head: sid, headLen: req.headLen, start: lines[0]?.[0] ?? at, next: at, eof: true, lines, skipped: [] };
  };
  return m;
}
const term = (pid = 41, address = "t1") => ({ address, foreground: { pid, argv: ["claude"] }, status: "idle", turn: 1, labels: {} });
const texts = (f) => f.thread.rows().map((r) => r.text);
const newFeed = (m) => new Feed({ address: "t1", kind: "claude", call: m.call, now: () => m.now });
const bound = async (m) => { const f = newFeed(m); await f.step(term()); expect(texts(f)).toEqual(["hello", "hi there"]); return f; };

// ---- the Feed -------------------------------------------------------------------------------------------------

test("a proof that binds goes straight on to its first read, in the same step", async () => {
  const m = machine();
  const f = newFeed(m);
  await f.step(term());
  expect(m.calls).toEqual(["probe", "tail"]);
  expect(f.state).toBe("live");
  expect(texts(f)).toEqual(["hello", "hi there"]);
});

test("the first read is small; the full tail then replaces it with no new generation, so what was opened stays", async () => {
  const m = machine();
  const big = "x".repeat(1000);
  m.files[SID] = Array.from({ length: 600 }, (_, i) => (i % 2 ? said(`a${i}`, `${i} ${big}`) : user(`u${i}`, `${i} ${big}`)));
  const f = newFeed(m);
  await f.step(term());
  const first = f.thread.entries.length, gen = f.gen;
  expect(first).toBeGreaterThan(0);
  expect(first).toBeLessThan(600);
  expect(first * 1000).toBeLessThanOrEqual(FIRST + 2000);
  const kept = f.thread.entries.at(-1).key;
  m.now += 5000;
  while (f.thread.entries.length === first) { const p = f.step(term()); if (!p) break; await p; }
  expect(f.thread.entries.length).toBe(600);
  expect(f.gen).toBe(gen);
  expect(f.thread.entries.at(-1).key).toBe(kept);
});

test("a start-over keeps the drawn rows, marked stale, until the new conversation's first read lands", async () => {
  const m = machine();
  const f = await bound(m);
  const gen = f.gen;
  m.files[SID2] = [user("u9", "after the clear")];
  m.sid = SID2;
  f.kick();
  let release; m.holdTail = new Promise((r) => { release = r; });
  const run = f.step(term());
  await new Promise((r) => setTimeout(r, 0));
  expect(texts(f)).toEqual(["hello", "hi there"]); // still on screen
  expect(f.stale).toBe(true);
  expect(f.gen).toBe(gen); // gen rises at the swap, not before
  release(); m.holdTail = null; await run;
  expect(texts(f)).toEqual(["after the clear"]);
  expect([f.stale, f.gen]).toEqual([false, gen + 1]);
});

test("a start-over into a conversation with no transcript yet swaps once that is proven", async () => {
  const m = machine();
  const f = await bound(m);
  m.sid = SID2; // no file for it: /clear before the first message
  f.kick();
  await f.step(term());
  expect([f.state, f.stale, texts(f)]).toEqual(["waiting", false, []]);
});

test("one failed proof never unbinds or wipes the thread; two in a row unbind, and the rows stay", async () => {
  const m = machine();
  const f = await bound(m);
  const gen = f.gen;
  m.pid = 99; // the registry names another process
  f.kick(); await f.step(term());
  expect([f.state, f.binding.ok, f.gen]).toEqual(["live", true, gen]);
  expect(texts(f)).toEqual(["hello", "hi there"]);
  m.now += REPROBE_MS; f.kick(); await f.step(term());
  expect(f.state).toBe("unbound");
  expect(texts(f)).toEqual(["hello", "hi there"]);
  expect(f.stale).toBe(false);
  m.pid = 41; m.now += REPROBE_MS; f.kick(); await f.step(term()); // proven again, the same session: read on
  expect([f.state, f.gen]).toEqual(["live", gen]);
});

test("a failed read stays failed between tries: no flip back to loading until a read lands", async () => {
  const m = machine();
  const f = newFeed(m);
  const call = m.call;
  let refuse = true;
  const seen = []; // the state a view would draw at each moment: before a step, while its read is asked, after it
  f.call = async (command, req, o) => { if (command === "tail" && refuse) { seen.push(f.state); throw new Error("the helper refused"); } return call(command, req, o); };
  await f.step(term());
  expect([f.state, f.reason]).toEqual(["error", "the helper refused"]);
  seen.length = 0;
  for (let i = 0; i < 3; i++) { m.now += 30000; const p = f.step(term()); seen.push(f.state); await p; seen.push(f.state); }
  expect(seen.length).toBe(9);
  expect(new Set(seen)).toEqual(new Set(["error"]));
  refuse = false; m.now += 30000; await f.step(term());
  expect([f.state, texts(f)]).toEqual(["live", ["hello", "hi there"]]);
});

// ---- the Chat view, its own render ----------------------------------------------------------------------------

function evaluate(file, env, expression) {
  const names = new Set();
  const src = readFileSync(PACK + file, "utf8").replace(/^import ([\s\S]+?) from ["'][^"']+["'];/gm, (_l, spec) => {
    for (const part of spec.replace(/[{}]/g, "").split(",")) { const [n, a] = part.trim().split(/\s+as\s+/); if (n) names.add(a || n); }
    return "";
  }).replace(/export default class /g, "class ").replace(/\bexport (const|function|class) /g, "$1 ");
  return new Function(...names, `${src}\nreturn (${expression});`)(...[...names].map((n) => env[n]));
}
const strict = (o) => new Proxy(o, { get: (x, k) => (k in x ? x[k] : () => { throw new Error(`stand-in missing: ${String(k)}`); }) });

// The chat as the app runs it, on stand-ins: `w.view` is the work-body's shown child, `w.terminals` what Core reports.
function chatView(m) {
  const w = { zoom: 1, toBottom: 0, view: "chat", terminals: [term(), term(42, "t2"), term(43, "box/t3")], focused: { terminal: "t1", tab: "tab1" }, machines: [{ name: null, layout: "ready" }, { name: "box", layout: "ready" }],
    panes: [{ pane: "p1", tab: "tab1", terminal: "t1", cwd: "/work/app", focused: true }, { pane: "p2", tab: "tab1", terminal: "t2", cwd: "/work/app" }] };
  const h = harness(world());
  const base = { ...h.env, ...chat, ...reader, ...feed, ...appear, ...composer, ...slash, ...models, ...inter, ...amedia, ...factory, ...tail, ...codeview, ...status, ...agents, ...views,
    chatCall: m.call, terminals: () => w.terminals, machines: () => w.machines, panes: () => w.panes, focused: () => w.focused, agents: () => [],
    layout: () => ({ id: "work-body", active: w.view, children: [] }), settings: () => ({ zoom: w.zoom ?? 1 }), window: () => ({ active: true }),
    nextCommand: () => new Promise(() => {}), hc: async () => ({ code: 0 }), helper: async () => null, mediaPreview: async () => null,
    TextareaState: { new: () => ({ on() {}, set_auto_grow() {}, value: () => "", set_value() {}, focus() {} }) }, Textarea: { new: () => h.env.div() },
    VirtualListScrollHandle: { new: () => ({ scroll_to_bottom() { w.toBottom = (w.toBottom ?? 0) + 1; }, release() {} }) }, TextView: { new: () => h.env.div(), markdown: () => h.env.div() }, image: () => h.env.div() };
  const uiNames = [...readFileSync(`${PACK}shared/ui.js`, "utf8").matchAll(/^export (?:const|function|class) (\w+)/gm)].map((x) => x[1]);
  Object.assign(base, evaluate("shared/ui.js", new Proxy({ ...base, ...tokens }, { get: (x, k) => (k in x ? x[k] : () => null) }), `({ ${uiNames.join(",")} })`));
  Object.assign(base, evaluate("mods/pdk-chat/tools.js", strict(base), "({ ToolEditors, toolRow, thinkingRow, snippet, drawnSnippets, groupFolded })"),
    evaluate("mods/pdk-chat/media.js", strict(base), "({ MediaStore, mediaStrip, mediaRecords, mediaClass })"),
    evaluate("mods/pdk-chat/states.js", strict(base), "({ statePage, stateBlock })"));
  const Chat = evaluate("mods/pdk-chat/main.js", strict(base), "Chat");
  const c = new Chat();
  c.init({}, h.cx);
  h.tasks.splice(0); // init's tasks: the command and step loops, never run here
  const tasks = () => h.tasks.splice(0); // what a render or a step asked for, run as the app runs them after it
  return { w, h, c, tasks, render: () => c.render(h.cx) };
}
// What one render drew in the timeline: the list's item and the rows the timeline view draws for it.
const drawn = (v) => {
  const list = v.h.elements.findLast((e) => e.props.id === "chat-tl");
  if (!list) return { list: false, rows: 0 };
  v.c.timelineColumn(v.h.cx);
  return { list: true, rows: v.c.cur()?.drawnRows?.length ?? 0 };
};
const settle = async (v) => { for (let i = 0; i < 5; i++) { await new Promise((r) => setTimeout(r, 0)); for (const t of v.tasks()) await t(v.h.cx); } };

test("a shown chat starts its agent's feed in that render, not at the loop's next turn; hidden, nothing", async () => {
  const m = machine();
  const v = chatView(m);
  v.w.view = "main";
  v.render();
  expect(m.calls).toEqual([]); // hidden: nothing is read
  v.w.view = "chat";
  v.render();
  expect(m.calls).toEqual(["probe"]);
  v.render(); // the same view again: nothing more starts while that step runs
  expect(m.calls).toEqual(["probe"]);
  await settle(v);
  expect(m.calls).toEqual(["probe", "tail"]);
  v.w.focused = { terminal: "t2", tab: "tab1" }; // another agent: its feed starts in the same render
  v.render();
  expect(m.calls.slice(2)).toEqual(["probe"]);
});

test("no render without rows for a thread that has rows: the list is drawn in the first render, before any measurement", async () => {
  const m = machine();
  const v = chatView(m);
  v.render();
  await settle(v);
  v.h.clear();
  v.render(); // no size has been measured (no on_size_change has run)
  expect(drawn(v)).toEqual({ list: true, rows: 2 });
  // Chat, Terminal and back: rows in the first render shown again.
  v.w.view = "main"; v.render(); v.w.view = "chat"; v.h.clear(); v.render();
  expect(drawn(v)).toEqual({ list: true, rows: 2 });
  // A start-over (/clear): the old rows stay drawn until the new conversation's first read lands.
  m.files[SID2] = [user("u9", "after the clear")];
  m.sid = SID2;
  await settle(v); // the step the render started when Chat was shown again
  v.c.cur().src.kick();
  let release; m.holdTail = new Promise((r) => { release = r; });
  const run = v.c.cur().src.step(term());
  expect(run).not.toBe(null);
  await new Promise((r) => setTimeout(r, 0));
  v.h.clear(); v.render();
  expect(drawn(v)).toEqual({ list: true, rows: 2 });
  expect(v.c.tlArgs.block).toMatchObject({ id: "loading" }); // under the old rows: the new session is loading
  release(); m.holdTail = null; await run; await settle(v);
  v.h.clear(); v.render();
  expect(drawn(v)).toEqual({ list: true, rows: 1 });
});

test("an agent on a machine that drops keeps its chat: its rows and the offline block, never the shell page; back, it reads at once", async () => {
  const m = machine();
  m.pid = 43; // the registry names the box terminal's process
  const v = chatView(m);
  v.w.focused = { terminal: "box/t3", tab: "tab1" };
  v.render();
  await settle(v);
  v.h.clear(); v.render();
  expect(drawn(v)).toEqual({ list: true, rows: 2 });
  // The machine is away: the terminal is still listed, but its foreground (so its kind) is not known.
  v.w.machines[1].layout = "unavailable";
  v.w.terminals[2] = { address: "box/t3", status: null };
  const calls = m.calls.length;
  v.h.clear(); v.render();
  expect(v.h.elements.some((e) => String(e.props.id ?? "").startsWith("chat-page-"))).toBe(false);
  expect(drawn(v)).toEqual({ list: true, rows: 2 });
  expect(v.c.tlArgs.block).toMatchObject({ id: "offline" });
  await v.c.tick(v.h.cx); await settle(v);
  expect(m.calls.length).toBe(calls); // nothing is read from a machine that is away
  // Back: the same process, the same session; it is read at once (not after a backoff), and nothing starts over.
  const gen = v.c.cur().src.gen;
  v.w.machines[1].layout = "ready";
  v.w.terminals[2] = term(43, "box/t3");
  await v.c.tick(v.h.cx); await settle(v);
  expect(m.calls.length).toBeGreaterThan(calls);
  expect(v.c.cur().src.gen).toBe(gen);
  v.h.clear(); v.render();
  expect([drawn(v), v.c.tlArgs.block]).toEqual([{ list: true, rows: 2 }, null]);
});

test("a kick (the machine is back, a /clear) starts the backoff again from its first step", async () => {
  const m = machine();
  const f = await bound(m);
  m.hold = null;
  const down = Object.assign(new Error("box can't be reached"), { offline: true });
  f.call = async () => { throw down; };
  for (let i = 0; i < 3; i++) { f.kick(); m.now = Math.max(m.now, f.retryAt); await f.step(term()); }
  expect(f.state).toBe("offline");
  f.kick(); // back: the first try after it may still fail while the link settles
  await f.step(term());
  expect(f.retryAt - m.now).toBe(feed.BACKOFF_MS[0]);
});

test("after a failure the first read does not wait for the file to grow: the state is right as soon as it answers", async () => {
  const m = machine();
  const f = await bound(m);
  await f.step(term()); // caught up: this one may wait
  const call = m.call, waits = [];
  let down = true;
  f.call = async (command, req, o) => { if (command === "tail") waits.push(req.wait); if (down) throw Object.assign(new Error("box can't be reached"), { offline: true }); return call(command, req, o); };
  m.now += 5000; await f.step(term());
  expect(f.state).toBe("offline");
  down = false; waits.length = 0;
  m.now = f.retryAt; await f.step(term());
  expect([f.state, waits[0]]).toEqual(["live", 0]);
});

test("over a machine, at most two helper calls before rows: a line too long for the short first read is slimmed by the full read", async () => {
  const m = machine();
  const big = "x".repeat(1000);
  m.files[SID] = Array.from({ length: 400 }, (_, i) => (i % 2 ? said(`a${i}`, `${i} ${big}`) : user(`u${i}`, `${i} ${big}`)));
  const huge = m.files[SID].length - 3; // an answer near the end, too long for a tail (a pasted screenshot)
  const call = m.call;
  m.call = async (command, req, o) => {
    if (command === "slim") { m.calls.push("slim"); return { record: JSON.parse(m.files[SID][huge]) }; }
    const r = await call(command, req, o);
    if (command !== "tail" || !r.lines) return r;
    const at = r.lines.findIndex((l) => l[1] === m.files[SID][huge]);
    if (at >= 0) { r.skipped = [[r.lines[at][0], 9e6]]; r.lines = r.lines.filter((_, i) => i !== at); }
    return r;
  };
  const f = new Feed({ address: "box/t1", kind: "claude", on: "box", call: (...a) => m.call(...a), now: () => m.now });
  await f.step(term());
  expect(m.calls).toEqual(["probe", "tail"]);
  expect([f.state, f.skipped, f.thread.entries.length > 0]).toEqual(["live", 0, true]);
  m.now += 5000;
  for (let i = 0; i < 4 && f.thread.entries.length < 400; i++) { const p = f.step(term()); if (p) await p; m.now += 1000; }
  expect(m.calls).toContain("slim");
  expect([f.thread.entries.length, f.skipped]).toEqual([400, 0]);
});

// ---- the end review's three (review-show.md, Bugs) -------------------------------------------------------------

test("a short first read that draws nothing proves nothing: the kept rows stay and the full read decides", async () => {
  const m = machine();
  const long = user("u9", "y".repeat(200000)); // one record longer than the short read
  const call = m.call;
  m.call = async (command, req, o) => {
    if (command === "slim") { m.calls.push("slim"); return { record: JSON.parse(long) }; }
    const r = await call(command, req, o);
    // As the helper answers a window that starts inside that record: no whole line, the record skipped.
    if (command === "tail" && r.lines?.some((l) => l[1] === long)) { r.skipped = [[r.lines.find((l) => l[1] === long)[0], long.length]]; r.lines = r.lines.filter((l) => l[1] !== long); }
    return r;
  };
  const f = await bound(m);
  const gen = f.gen;
  m.files[SID2] = [long];
  m.sid = SID2;
  f.kick();
  const states = [];
  const wrap = f.call;
  f.call = async (command, req, o) => { states.push([f.state, f.thread.entries.length]); return wrap(command, req, o); };
  await f.step(term());
  for (const [, rows] of states) expect(rows).toBe(2); // the kept rows, at every call until the swap
  expect(texts(f)).toEqual(["y".repeat(200000)]);
  expect([f.state, f.stale, f.gen]).toEqual(["live", false, gen + 1]);
  // A cold open of it: loading until the full read, never an empty conversation.
  const g = newFeed(m);
  g.call = async (command, req, o) => { if (command === "tail") expect(g.state).not.toBe("live"); return m.call(command, req, o); };
  await g.step(term());
  expect(texts(g)).toEqual(["y".repeat(200000)]);
});

test("the full tail taking the short read's place keeps the rows a person is reading where they are", async () => {
  const m = machine();
  const big = "x".repeat(1000);
  m.files[SID] = Array.from({ length: 600 }, (_, i) => (i % 2 ? said(`a${i}`, `${i} ${big}`) : user(`u${i}`, `${i} ${big}`)));
  const v = chatView(m);
  v.render(); await settle(v); v.h.clear(); v.render(); drawn(v);
  const s = v.c.cur();
  const before = s.drawnRows.map((r) => r.key);
  v.c.read(s, before.at(-1)); // reading: a call opened, following stops
  s.src.probeAt = Number.MAX_SAFE_INTEGER;
  await s.src.step(term()); // the full tail is read aside and swapped in
  expect(s.src.thread.entries.length).toBe(600);
  v.h.clear(); v.render(); drawn(v);
  expect(s.drawnRows.map((r) => r.key)).toEqual(before);
});

test("hidden while its proof is answered: the chained first read never starts", async () => {
  const m = machine();
  let release; m.hold = new Promise((r) => { release = r; });
  const v = chatView(m);
  v.render();
  expect(m.calls).toEqual(["probe"]);
  v.w.view = "main"; v.render();
  release(); m.hold = null; await settle(v);
  expect(m.calls).toEqual(["probe"]);
  expect(v.c.cur().src.thread.entries.length).toBe(0);
  // Another agent shown instead: likewise.
  const m2 = machine();
  let release2; m2.hold = new Promise((r) => { release2 = r; });
  const v2 = chatView(m2);
  v2.render();
  v2.w.focused = { terminal: "t2", tab: "tab1" }; v2.render();
  const t1 = v2.c.agents.get("t1");
  release2(); m2.hold = null; await settle(v2);
  expect(t1.src.thread.entries.length).toBe(0);
});

// ---- the reviewer's second look (review-show-2.md) -------------------------------------------------------------

test("hidden while a long record is slimmed: the cursor does not move past it, and it is read once shown again", async () => {
  const m = machine();
  const f = await bound(m);
  const lateText = `late ${"x".repeat(600000)}`;
  const late = user("u-late", lateText);
  m.files[SID].push(late); m.now += 1000;
  let release, entered;
  const hold = new Promise((r) => { release = r; }), started = new Promise((r) => { entered = r; });
  const call = f.call;
  f.call = async (command, req, o) => {
    if (command === "slim") { entered(); await hold; return { record: JSON.parse(late) }; }
    const r = await call(command, req, o);
    if (command === "tail" && r.lines?.some((l) => l[1] === late)) { r.skipped = [[r.lines.find((l) => l[1] === late)[0], late.length]]; r.lines = r.lines.filter((l) => l[1] !== late); }
    return r;
  };
  let shown = true;
  const at = f.cursor.offset;
  const run = f.step(term(), { shown: () => shown });
  await started;
  shown = false; release(); await run;
  expect([f.cursor.offset, f.running]).toEqual([at, null]);
  shown = true; m.now += 1000; await f.step(term(), { shown: () => shown });
  expect(texts(f)).toContain(lateText);
});

test("a stale runner never puts back a cursor that a newer one moved", async () => {
  const m = machine();
  const f = await bound(m);
  m.files[SID].push(user("n1", "one more")); m.now += 1000;
  let release; const hold = new Promise((r) => { release = r; });
  const call = f.call;
  let first = true;
  f.records = async (path, got, live) => { if (first) { first = false; await hold; } return Object.assign(chat.parseLines(got.lines).map((x) => ({ ...x, path })), { unread: 0 }); };
  const old = f.step(term());
  await new Promise((r) => setTimeout(r, 0));
  f.runSeq++; f.running = null; // given up (as STUCK_MS does), a newer runner reads on
  m.files[SID].push(user("n2", "and another"));
  await f.step(term());
  const moved = f.cursor.offset;
  release(); await old;
  expect(f.cursor.offset).toBe(moved);
  void call;
});

const toolCall = (i, big) => JSON.stringify({ type: "assistant", uuid: `step${i}`, message: { id: `msg${i}`, content: [{ type: "tool_use", id: `tool${i}`, name: "Read", input: { file_path: `/work/app/file${i}`, padding: big } }] } });

test("reading inside a long tool group: the full tail bringing earlier calls into it keeps the window, and what was opened", async () => {
  const m = machine();
  const big = "x".repeat(1000);
  m.files[SID] = [...Array.from({ length: 40 }, (_, i) => (i % 2 ? said(`a${i}`, `${i} ${big}`) : user(`u${i}`, `${i} ${big}`))), ...Array.from({ length: 200 }, (_, i) => toolCall(i, big))];
  const v = chatView(m);
  v.render(); await settle(v); v.h.clear(); v.render(); drawn(v);
  const s = v.c.cur();
  const group = s.src.thread.rows().at(-1);
  expect(group.type).toBe("work");
  const shortKey = group.key;
  // A person opens the last call and folds the group from its header... then opens the group again from its header.
  const call = s.src.thread.entries.find((e) => e.id === "tool199");
  v.c.toggleCall(s, call, v.h.cx);
  s.collapsed.delete(group.key); s.open.add(group.key); // the header's press when folded (groupHead)
  s.src.probeAt = Number.MAX_SAFE_INTEGER;
  await s.src.step(term()); // the full tail: earlier calls join the group, whose key changes
  const after = s.src.thread.rows().at(-1);
  expect(after.key).not.toBe(shortKey);
  v.h.clear(); v.render(); drawn(v);
  expect(s.drawnRows.flatMap((r) => r.items ?? []).some((e) => e.id === "tool199")).toBe(true);
  expect(s.open.has(call.key)).toBe(true); // the call: keyed by its own entry, it stays open
  expect(s.open.has(after.key)).toBe(true); // the group opened from its header stays open
});

test("another process takes the terminal during an old slim: the old runner leaves the new conversation's cursor alone", async () => {
  const m = machine();
  const f = await bound(m);
  const oldLine = user("u-old", "x".repeat(600000));
  m.files[SID].push(oldLine); m.now += 1000;
  let release, entered;
  const hold = new Promise((r) => { release = r; }), started = new Promise((r) => { entered = r; });
  const transport = f.call;
  f.call = async (command, req, o) => {
    if (command === "slim") { if (req.path === PATH(SID)) { entered(); await hold; return { record: JSON.parse(oldLine) }; } return { record: JSON.parse(m.files[SID2][0]) }; }
    const r = await transport(command, req, o);
    if (command === "tail" && r.lines) { r.skipped = r.lines.filter((l) => l[1].length > 524288).map((l) => [l[0], l[1].length]); r.lines = r.lines.filter((l) => l[1].length <= 524288); }
    return r;
  };
  const old = f.step(term()); await started;
  const moved = f.cursor.offset;
  m.sid = SID2; m.pid = 42;
  m.files[SID2] = [user("u-new", "b".repeat(moved - user("u-new", "").length - 1))]; // the same length: the same offset
  await f.step(term(42));
  const mark = f.cursor.mark(), gen = f.gen;
  expect(f.cursor.offset).toBe(moved);
  release(); await old;
  expect(f.cursor.mark()).toEqual(mark);
  m.now += 1000; await f.step(term(42));
  expect(f.gen).toBe(gen); // no false replacement: what is open and pending in the view (keyed to gen) stays
});

// ---- the transcript always ends above the composer (owner, 12 Nov 2026: "transcript should not hide below the box") ----

const byId = (v, id) => v.h.elements.findLast((e) => e.props.id === id);
const parentOf = (v, node) => v.h.elements.findLast((e) => e.kids.some((k) => k.props === node.props));
const sizesOf = (v) => byId(v, "chat-tl").props.virtual.sizes;
// A chat with rows, rendered once laid out, its timeline column drawn (as the child view draws it).
async function shownChat() {
  const m = machine();
  const v = chatView(m);
  v.render(); await settle(v); v.h.clear(); v.render(); v.c.timelineColumn(v.h.cx);
  return v;
}

test("layout: the composer is a sibling under the timeline's region, never over it; the timeline is a live log", async () => {
  const v = await shownChat();
  const foot = byId(v, "chat-foot");
  expect(foot.props.absolute).toBeUndefined();
  expect("bottom" in foot.props).toBe(false);
  expect(foot.props.on_size_change).toBeUndefined(); // nothing measures it: the column places it
  expect(foot.props.flex_none).toBe(true);
  const timeline = byId(v, "timeline");
  expect(timeline.props.role).toBe("log");
  const region = parentOf(v, timeline);
  expect([region.props.flex_1, region.props.min_h, region.props.overflow_hidden]).toEqual([true, 0, true]);
  const column = parentOf(v, region);
  const at = column.kids.findIndex((k) => k.props === region.props);
  expect(column.kids[at + 1].props).toBe(foot.props);
  expect(byId(v, "chat-tl").props.virtual.count).toBe(3);
  expect(sizesOf(v).slice(1)).toEqual([20, 0]);
});

test("a grown draft: the composer at 8 rows and back to 1 changes none of the list's sizes; the end gap stays 20", async () => {
  const v = await shownChat();
  const before = sizesOf(v);
  const box = byId(v, "composer-box");
  expect(box).toBeTruthy();
  for (const h of [8 * 22 + 72, 22 + 72]) {
    box.props.on_size_change({ width: 700, height: h }, v.h.cx);
    v.h.clear(); v.render(); v.c.timelineColumn(v.h.cx);
    expect(sizesOf(v)).toEqual(before);
    expect(sizesOf(v)[1]).toBe(20);
  }
});

for (const zoom of [0.9, 1.25]) {
  test(`zoom ${zoom}: the timeline and its column report window pixels; the list's sizes come out in layout units`, async () => {
    const v = await shownChat();
    v.w.zoom = zoom;
    const view = 600, thread = 1500; // layout units
    byId(v, "timeline").props.on_size_change({ width: 900 * zoom, height: view * zoom }, v.h.cx);
    byId(v, "tl-column").props.on_size_change({ width: 900 * zoom, height: thread * zoom }, v.h.cx);
    v.h.clear(); v.render(); v.c.timelineColumn(v.h.cx);
    expect(sizesOf(v)).toEqual([thread, 20, 0]);
    expect(byId(v, "tl-column").props.min_h).toBe(view - 20);
  });
}

test("following stops when the reader leaves the end and starts again when they come back to it, from the list's range", async () => {
  const v = await shownChat();
  const s = v.c.cur();
  let woken = 0;
  v.c.acx = { notify: () => { woken++; } };
  const place = (start, end) => { byId(v, "chat-tl").props.virtual.render({ start, end }, v.h.cx); };
  place(0, 3); v.tasks();
  expect(s.follow).not.toBe(false);
  // A wheel (downward: direction plays no part) that leaves the end out of view stops following.
  byId(v, "timeline").props.on_scroll_wheel({ delta: { y: -40 } }, v.h.cx);
  place(0, 2);
  expect(s.follow).toBe(false);
  for (const t of v.tasks()) await t(v.h.cx);
  expect(woken).toBe(1); // the chat draws again to stop holding the end
  v.h.clear(); v.render(); v.c.timelineColumn(v.h.cx);
  const held = v.w.toBottom;
  v.h.clear(); v.render();
  expect(v.w.toBottom).toBe(held); // not following: nothing pulls the list to its end
  // A measuring call says nothing.
  byId(v, "timeline").props.on_scroll_wheel({ delta: { y: 40 } }, v.h.cx);
  place(0, 1);
  expect(s.follow).toBe(false);
  // Back at the end: following starts again and asks for a redraw, which holds the list at its end.
  for (const t of v.tasks()) await t(v.h.cx);
  const asked = woken;
  place(0, 3);
  expect(s.follow).toBe(true);
  for (const t of v.tasks()) await t(v.h.cx);
  expect(woken).toBeGreaterThan(asked);
  v.h.clear(); v.render();
  expect(v.w.toBottom).toBe(held + 1);
  // A wheel at the end with the end still drawn keeps following, and asks for nothing.
  v.tasks(); // the render's own (the child's new props)
  byId(v, "timeline").props.on_scroll_wheel({ delta: { y: 40 } }, v.h.cx);
  place(0, 3);
  expect(s.follow).toBe(true);
  expect(v.tasks().length).toBe(0);
});
