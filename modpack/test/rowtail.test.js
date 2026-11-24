// The Hermes live tail (QA final): a session that grows while the chat reads it. A writer process keeps the WAL store
// open and commits rows in three batches, as Hermes' gateway does; each read goes through the real helper `rows`,
// the RowCursor and the thread, as pdk-chat's tick does. Every row must arrive once, in order, none twice.
// FIXTURE: the table shape is Hermes 0.23.0's (hermes_state_common.py:531-562, as in hermes.test.js); rows are made here.
import { test, expect, afterAll } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { RowCursor } from "../adapters/reader.js";
import { Thread, feed } from "../adapters/chat.js";

const ROOT = `/tmp/pdk-r${process.pid}`;
const HOME = `${ROOT}/u`;
const DB = `${HOME}/.hermes/state.db`;
const HELPER = new URL("../helper/pdk-helper.py", import.meta.url).pathname;
mkdirSync(`${HOME}/.hermes`, { recursive: true });
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const WRITER = `
import sqlite3, sys, json, time
con = sqlite3.connect(sys.argv[1], isolation_level=None)
con.execute("pragma journal_mode=wal")
con.execute("create table if not exists messages (id integer primary key autoincrement, session_id text not null, role text not null, content text, tool_call_id text, tool_calls text, tool_name text, timestamp real not null, finish_reason text, reasoning text, active integer not null default 1)")
print("ready", flush=True)
for line in sys.stdin:
    for row in json.loads(line):
        con.execute("insert into messages (session_id, role, content, tool_call_id, tool_calls, timestamp) values (?, ?, ?, ?, ?, ?)",
                    (row["s"], row["role"], row.get("content"), row.get("tcid"), row.get("calls"), time.time()))
    print("ok", flush=True)
`;

test("a session growing in three batches: every new row reaches the chat once, in order, with the WAL held open", async () => {
  const w = Bun.spawn(["/usr/bin/python3", "-I", "-S", "-c", WRITER, DB], { stdin: "pipe", stdout: "pipe" });
  const out = w.stdout.getReader();
  const said = async () => new TextDecoder().decode((await out.read()).value).trim();
  expect(await said()).toBe("ready");
  const write = async (rows) => { w.stdin.write(JSON.stringify(rows) + "\n"); w.stdin.flush(); expect(await said()).toBe("ok"); };
  const cursor = new RowCursor();
  const thread = new Thread();
  const tick = () => {
    const r = Bun.spawnSync(["/usr/bin/python3", "-I", "-S", HELPER, "rows", "hermes", "S", String(cursor.after)], { env: { HOME, PATH: "/usr/bin:/bin" } });
    const got = cursor.accept(JSON.parse(r.stdout.toString()));
    expect(got.error).toBeUndefined();
    expect(got.snapshot).toBe(false); // a live read, not the immutable fallback that would miss the WAL
    feed(thread, "hermes", got.rows, {});
    return got.rows.map((x) => x.id);
  };
  const call = (id) => JSON.stringify([{ id, function: { name: "terminal", arguments: JSON.stringify({ command: `echo ${id}` }) } }]);
  try {
    await write([{ s: "S", role: "user", content: "first" }, { s: "S", role: "assistant", content: "", calls: call("c1") },
      { s: "S", role: "tool", tcid: "c1", content: JSON.stringify({ output: "1", exit_code: 0, error: null }) }, { s: "S", role: "assistant", content: "one" },
      { s: "OTHER", role: "user", content: "someone else" }]);
    expect(tick()).toEqual([1, 2, 3, 4]);
    expect(tick()).toEqual([]); // nothing new: nothing read twice
    await write([{ s: "S", role: "user", content: "second" }, { s: "S", role: "assistant", content: "two" }]);
    expect(tick()).toEqual([6, 7]);
    await write([{ s: "S", role: "user", content: "third" }, { s: "S", role: "assistant", content: "", calls: call("c2") },
      { s: "S", role: "tool", tcid: "c2", content: JSON.stringify({ output: "2", exit_code: 0, error: null }) }, { s: "S", role: "assistant", content: "three" }]);
    expect(tick()).toEqual([8, 9, 10, 11]);
    const rows = thread.rows();
    expect(rows.filter((r) => r.type === "user").map((r) => r.text)).toEqual(["first", "second", "third"]);
    expect(rows.filter((r) => r.type === "assistant").map((r) => r.text)).toEqual(["one", "two", "three"]);
    expect(rows.flatMap((r) => r.items ?? []).map((i) => [i.id, i.status])).toEqual([["c1", "ok"], ["c2", "ok"]]);
    const keys = thread.entries.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  } finally {
    w.kill();
  }
}, 30000);

// The cause QA saw: the rows arrived, but a chat taller than its pane opens at its top, so the newest turn was below
// the fold. The chat now draws the newest rows that fit (adapters/tail.js).
import { tailStart, rowHeight } from "../adapters/tail.js";

test("the newest rows that fit are drawn; a growing chat keeps its newest row in view; the newest is always drawn", () => {
  const turn = (n, long = false) => [
    { type: "user", key: `u${n}`, text: `Prompt ${n}` },
    { type: "work", key: `w${n}`, items: [{ key: `c${n}`, type: "tool", verb: "Ran", detail: `echo ${n}` }] },
    { type: "assistant", key: `a${n}`, text: `Turn ${n} done. ` + "A longer answer line. ".repeat(long ? 40 : 1) },
  ];
  const at = { column: 696, height: 480 };
  const short = [...turn(1), ...turn(2)];
  expect(tailStart(short, at)).toBe(0); // fits: everything
  const grown = [...short, ...turn(3, true), ...turn(4, true), ...turn(5)];
  const from = tailStart(grown, at);
  expect(from).toBeGreaterThan(0);
  expect(grown.slice(from).at(-1).key).toBe("a5"); // the newest is drawn
  const drawn = grown.slice(from).reduce((h, r) => h + rowHeight(r, at.column) + 14, 0);
  expect(drawn).toBeLessThanOrEqual(at.height); // and what is drawn fits
  const huge = [{ type: "assistant", key: "x", text: "y".repeat(20000) }];
  expect(tailStart(huge, at)).toBe(0); // a single row taller than the pane is still drawn
  // Media tiles count: a strip of tiles is about a tile's height.
  expect(rowHeight({ type: "user", text: "", media: [{}, {}] }, 696)).toBeGreaterThanOrEqual(180);
});
