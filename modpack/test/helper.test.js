// The helper's protocol (M8): whole lines only, a cursor that carries a partial line, a line over 12 MiB
// skipped and labelled, rewrite and shrink told apart from an append by file identity, UTF-8 intact, paths
// allow-listed, SQLite rows filtered to one session and tolerant of a missing WAL, held files reported only
// under ~/.codex. Runs the real helper with python3 against a scratch HOME in /tmp/pdk-t<pid>.
import { test, expect, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, appendFileSync, rmSync, renameSync, truncateSync, symlinkSync, chmodSync } from "node:fs";
import { Database } from "bun:sqlite";
import { Cursor } from "../adapters/reader.js";

const HELPER = new URL("../helper/pdk-helper.py", import.meta.url).pathname;
const ROOT = `/tmp/pdk-t${process.pid}`;
const HOME = `${ROOT}/u`;
const P = `${HOME}/.claude/projects/-w`;
mkdirSync(P, { recursive: true });
afterAll(() => { try { chmodSync(`${HOME}/.hermes`, 0o755); } catch {} rmSync(ROOT, { recursive: true, force: true }); });

function run(...args) {
  const r = Bun.spawnSync(["/usr/bin/python3", "-I", "-S", HELPER, ...args.map(String)], { env: { HOME, PATH: "/usr/bin:/bin:/usr/sbin" } });
  const out = r.stdout.toString();
  expect(out.length).toBeLessThan(8 * 1024 * 1024);
  return { code: r.exitCode, ...JSON.parse(out) };
}
const read = (path, q) => run("read", path, q.offset, q.max, q.align, q.headLen);

test("whole lines only: a line still being written is carried to the next read", () => {
  const f = `${P}/a.jsonl`;
  writeFileSync(f, '{"n":1}\n{"n":');
  let r = run("read", f, 0, 65536, 0, 4096);
  expect(r.lines).toEqual([[0, '{"n":1}']]);
  expect(r.next).toBe(8);
  appendFileSync(f, '2}\n{"n":3}\n');
  r = run("read", f, r.next, 65536, 0, 4096);
  expect(r.lines.map((l) => l[1])).toEqual(['{"n":2}', '{"n":3}']);
});

test("a line over 12 MiB is skipped, labelled with its size, and reading goes on after it", () => {
  const f = `${P}/big.jsonl`;
  writeFileSync(f, '{"a":1}\n');
  appendFileSync(f, '{"blob":"' + "y".repeat(12.5 * 1024 * 1024) + '"}\n');
  appendFileSync(f, '{"z":1}\n');
  const c = new Cursor();
  c.offset = 0; c.dev = null;
  const seen = [];
  let skipped = [];
  let q = { offset: 0, max: 512 * 1024, align: 0, headLen: 4096 };
  for (let i = 0; i < 4; i++) {
    const r = read(f, q);
    seen.push(...r.lines.map((l) => l[1]));
    skipped.push(...r.skipped);
    q = { ...q, offset: r.next };
    if (r.eof) break;
  }
  expect(seen).toEqual(['{"a":1}', '{"z":1}']);
  expect(skipped).toHaveLength(1);
  expect(skipped[0][1]).toBeGreaterThan(12 * 1024 * 1024);
});

test("the cursor reads appends, and starts over on a rewrite or a shrink", () => {
  const f = `${P}/c.jsonl`;
  writeFileSync(f, '{"n":1}\n{"n":2}\n');
  const c = new Cursor();
  let got = c.accept(read(f, c.request()));
  expect(got.lines.map((l) => l[1])).toEqual(['{"n":1}', '{"n":2}']);
  appendFileSync(f, '{"n":3}\n');
  got = c.accept(read(f, c.request()));
  expect(got.lines.map((l) => l[1])).toEqual(['{"n":3}']);
  // Replaced by another file (a new inode), same length or longer.
  writeFileSync(`${P}/c.tmp`, '{"m":1}\n{"m":2}\n{"m":3}\n{"m":4}\n');
  renameSync(`${P}/c.tmp`, f);
  expect(c.accept(read(f, c.request())).reset).toBe(true);
  got = c.accept(read(f, c.request()));
  expect(got.lines).toHaveLength(4);
  // Shrunk below the cursor.
  truncateSync(f, 4);
  expect(c.accept(read(f, c.request())).reset).toBe(true);
});

test("the same bytes rewritten in place with other content are a rewrite too (the head differs)", () => {
  const f = `${P}/d.jsonl`;
  writeFileSync(f, '{"n":1}\n');
  const c = new Cursor();
  c.accept(read(f, c.request()));
  writeFileSync(f, '{"x":9}\n{"x":8}\n');
  expect(c.accept(read(f, c.request())).reset).toBe(true);
});

test("UTF-8 survives any read size: lines are cut only at newlines", () => {
  const f = `${P}/u.jsonl`;
  const lines = Array.from({ length: 40 }, (_, i) => JSON.stringify({ t: "é漢🙂".repeat(i + 1) }));
  writeFileSync(f, lines.join("\n") + "\n");
  for (const max of [7, 13, 101, 1000]) {
    const out = [];
    let q = { offset: 0, max, align: 0, headLen: 4096 };
    for (let i = 0; i < 400; i++) {
      const r = read(f, q);
      out.push(...r.lines.map((l) => l[1]), ...r.skipped.map(() => null));
      q.offset = r.next;
      if (r.eof) break;
    }
    const whole = out.filter(Boolean);
    for (const l of whole) expect(l.includes("\uFFFD")).toBe(false);
    expect(whole.every((l) => lines.includes(l))).toBe(true);
  }
}, 30000);

test("a first read starts back from the end, after a whole line", () => {
  const f = `${P}/t.jsonl`;
  writeFileSync(f, Array.from({ length: 100 }, (_, i) => `{"i":${i}}`).join("\n") + "\n");
  const r = run("read", f, -40, 65536, 1, 4096);
  expect(r.start).toBeGreaterThan(0);
  expect(r.lines.every((l) => l[1].startsWith('{"i":'))).toBe(true);
  expect(r.lines.at(-1)[1]).toBe('{"i":99}');
});

test("only transcripts under the agents' own folders: no other path, no symlink out, missing says missing", () => {
  expect(run("read", "/etc/hosts", 0, 100, 0, 4096).error).toBe("path not allowed");
  writeFileSync(`${ROOT}/outside.jsonl`, "{}\n");
  symlinkSync(`${ROOT}/outside.jsonl`, `${P}/link.jsonl`);
  expect(run("read", `${P}/link.jsonl`, 0, 100, 0, 4096).error).toBe("path not allowed");
  expect(run("read", `${P}/../../../outside.jsonl`, 0, 100, 0, 4096).error).toBe("path not allowed");
  expect(run("read", `${P}/none.jsonl`, 0, 100, 0, 4096).missing).toBe(true);
  expect(run("bogus").error).toBe("usage");
});

test("SQLite: one session's rows after a cursor, read-only, with or without WAL files", () => {
  mkdirSync(`${HOME}/.hermes`, { recursive: true });
  const db = new Database(`${HOME}/.hermes/state.db`);
  db.exec("pragma journal_mode=wal; create table messages (id integer primary key, session_id text, role text, content text, tool_call_id text, tool_calls text, tool_name text, timestamp real, finish_reason text, active int)");
  const ins = db.prepare("insert into messages (session_id, role, content) values (?, ?, ?)");
  ins.run("s1", "user", "hello"); ins.run("s2", "user", "someone else"); ins.run("s1", "assistant", "hi"); ins.run("s1", "user", "again");
  let r = run("rows", "hermes", "s1", 0);
  expect(r.rows.map((x) => x.content)).toEqual(["hello", "hi", "again"]);
  r = run("rows", "hermes", "s1", r.rows[1].id);
  expect(r.rows.map((x) => x.content)).toEqual(["again"]);
  db.close(); // the last connection removes -wal and -shm
  expect(run("rows", "hermes", "s1", 0).rows).toHaveLength(3);
  // A folder the reader can't write: no -shm can be made, so it falls back to an immutable snapshot.
  chmodSync(`${HOME}/.hermes`, 0o555);
  r = run("rows", "hermes", "s1", 0);
  chmodSync(`${HOME}/.hermes`, 0o755);
  expect(r.rows).toHaveLength(3);
  expect(run("rows", "elsewhere", "s1", 0).error).toBe("store");
  expect(run("rows", "opencode", "s1", 0).missing).toBe(true);
});

test("held: only the process's files under ~/.codex, named as the caller's HOME has them", async () => {
  const roll = `${HOME}/.codex/sessions/2026/11/08/rollout-2026-11-08T22-28-54-01a1bd47-5fc4-76f0-926e-e081542198de.jsonl`;
  mkdirSync(roll.slice(0, roll.lastIndexOf("/")), { recursive: true });
  writeFileSync(roll, "{}\n");
  writeFileSync(`${ROOT}/other.txt`, "x");
  const child = Bun.spawn(["/usr/bin/python3", "-I", "-S", "-c", "import sys,time; a=open(sys.argv[1]); b=open(sys.argv[2]); print('ok', flush=True); time.sleep(30)", roll, `${ROOT}/other.txt`], { stdout: "pipe" });
  const reader = child.stdout.getReader();
  await reader.read();
  const r = run("held", child.pid);
  child.kill();
  expect(r.files).toEqual([roll]);
  expect(run("held", "x1").error).toBe("pid");
});

test("start: ps lstart in C and UTC for a live pid, null for a gone one", () => {
  expect(run("start", process.pid).start).toMatch(/^\w{3} \w{3} [ \d]\d \d\d:\d\d:\d\d \d{4}$/);
  expect(run("start", 999999).start).toBeNull();
});

// ---- The helper contract of fixes-review-1 (first, rows) ----

test("first: only the first line, read up to its newline and no further; no newline within 64 KiB is an error", async () => {
  const dir = `${HOME}/.codex/sessions/2026/11/09`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/a.jsonl`, '{"type":"session_meta"}\n{"secret":"transcript body"}\n');
  const r = run("first", `${dir}/a.jsonl`);
  expect(r.line).toBe('{"type":"session_meta"}');
  expect(JSON.stringify(r)).not.toContain("secret");
  writeFileSync(`${dir}/long.jsonl`, "x".repeat(70 * 1024) + "\n");
  expect(run("first", `${dir}/long.jsonl`).error).toContain("64 KiB");
  expect(run("first", `${dir}/none.jsonl`).missing).toBe(true);
  expect(run("first", "/etc/hosts").error).toBe("path not allowed");
  // A pipe whose writer stays open after the first line: a read past the newline would wait for more and time out.
  const fifo = `${dir}/pipe.jsonl`;
  Bun.spawnSync(["/usr/bin/mkfifo", fifo]);
  const writer = Bun.spawn(["/bin/sh", "-c", `exec 3>"${fifo}"; printf '{"n":1}\\n' >&3; sleep 8`]);
  const started = Date.now();
  const p = Bun.spawn(["/usr/bin/python3", "-I", "-S", HELPER, "first", fifo], { env: { HOME, PATH: "/usr/bin:/bin" }, stdout: "pipe" });
  const text = await new Response(p.stdout).text();
  writer.kill();
  expect(JSON.parse(text).line).toBe('{"n":1}');
  expect(Date.now() - started).toBeLessThan(5000);
}, 15000);

test("rows (F9): the reply stays under 4 MiB, resumes after the last row it held, and JSON fields stay valid", () => {
  const db = new Database(`${HOME}/.hermes/state.db`);
  db.exec("delete from messages");
  const ins = db.prepare("insert into messages (session_id, role, content, tool_calls) values (?, ?, ?, ?)");
  const big = "z".repeat(60000);
  for (let i = 0; i < 300; i++) ins.run("big", "assistant", big, null);
  const args = JSON.stringify({ command: "q".repeat(70000) });
  ins.run("big", "assistant", "w".repeat(100000), JSON.stringify([{ id: "c1", function: { name: "terminal", arguments: args } }]));
  ins.run("big", "assistant", "", JSON.stringify([{ id: "c2", function: { name: "x", arguments: "a".repeat(3 << 20) } }]));
  db.close();
  const seen = [];
  let after = 0;
  for (let i = 0; i < 20; i++) {
    const r = Bun.spawnSync(["/usr/bin/python3", "-I", "-S", HELPER, "rows", "hermes", "big", String(after)], { env: { HOME, PATH: "/usr/bin:/bin" } });
    const text = r.stdout.toString();
    expect(text.length).toBeLessThanOrEqual(4 * 1024 * 1024);
    const reply = JSON.parse(text);
    seen.push(...reply.rows);
    if (reply.rows.length) expect(reply.next).toBe(reply.rows.at(-1).id);
    after = reply.next;
    if (!reply.more) break;
  }
  expect(seen).toHaveLength(302);
  expect(new Set(seen.map((x) => x.id)).size).toBe(302);
  const clipped = seen[300];
  expect(clipped.clipped).toBe(true);
  expect(clipped.content.length).toBe(64001);
  expect(JSON.parse(JSON.parse(clipped.tool_calls)[0].function.arguments).command).toHaveLength(70000); // never cut
  expect(seen[301]).toMatchObject({ skipped: true, role: "assistant" });
  // OpenCode: long text inside the data JSON is cut inside the decoded value; the field stays JSON.
  mkdirSync(`${HOME}/.local/share/opencode`, { recursive: true });
  const oc = new Database(`${HOME}/.local/share/opencode/opencode.db`);
  oc.exec("create table session_message (id text, session_id text, type text, seq integer, data text)");
  oc.prepare("insert into session_message values (?, ?, ?, ?, ?)").run("m1", "s", "assistant", 1, JSON.stringify({ content: [{ type: "text", text: "t".repeat(90000) }, { type: "tool", state: { input: { content: "i".repeat(90000) } } }] }));
  oc.close();
  const r = run("rows", "opencode", "s", 0);
  const data = JSON.parse(r.rows[0].data);
  expect(r.rows[0].clipped).toBe(true);
  expect(data.content[0].text.length).toBe(64001);
  expect(data.content[1].state.input.content).toHaveLength(90000);
}, 60000);

test("an aligned read that lands inside a line lists that line in skipped, so it can be slimmed", () => {
  const f = `${P}/landed.jsonl`;
  writeFileSync(f, '{"a":1}\n' + JSON.stringify({ big: "b".repeat(3 << 20) }) + "\n" + '{"z":1}\n');
  const r = run("read", f, -(2 << 20), 512 * 1024, 1, 4096);
  expect(r.lines.map((l) => l[1])).toEqual(['{"z":1}']);
  expect(r.skipped).toEqual([[8, (3 << 20) + 10]]);
  // Landing exactly on a line start lists nothing.
  const at = run("read", f, 8, 64, 1, 4096);
  expect(at.skipped.some(([o]) => o < 8)).toBe(false);
});

test("procs: live direct children and ps state of a pid; a gone pid has state null; no shell", async () => {
  const parent = Bun.spawn(["/bin/sh", "-c", "sleep 30 & sleep 30 & wait"]);
  await Bun.sleep(400);
  const r = run("procs", parent.pid);
  expect(r.children).toBe(2);
  expect(r.state).toMatch(/^S/);
  parent.kill();
  const idle = Bun.spawn(["/bin/sleep", "30"]);
  await Bun.sleep(200);
  expect(run("procs", idle.pid)).toEqual({ code: 0, children: 0, state: expect.stringMatching(/^S/) });
  idle.kill();
  await idle.exited;
  expect(run("procs", 999999)).toEqual({ code: 0, children: 0, state: null });
  expect(run("procs", "1;ls").error).toBe("pid");
  expect(run("procs", "-1").error).toBe("pid");
}, 30000);

test("tty (qa-modpack's patch): a process's controlling terminal, null without one or when gone", async () => {
  // A process in a session of its own has no controlling terminal, wherever the tests run.
  const none = Bun.spawn(["/usr/bin/python3", "-I", "-S", "-c", "import os, sys, time; os.setsid(); print(1, flush=True); time.sleep(5)"], { stdout: "pipe" });
  await none.stdout.getReader().read();
  expect(run("tty", none.pid).tty).toBeNull();
  none.kill();
  expect(run("tty", 999999).tty).toBeNull();
  expect(run("tty", "12; ls").error).toBe("pid");
  // Ask for this test process's own terminal when it has one (a run in a terminal); either way the answer is a name or null.
  const mine = run("tty", process.pid).tty;
  expect(mine === null || /^ttys?\d+$/.test(mine)).toBe(true);
});
