// The chat helper (helper/pdk-chat.py), the real script against a scratch HOME in /tmp/pdk-ch<pid>: probe and tail
// for Claude and Codex with real processes standing in for the agents, a waiting tail that answers on an append,
// the refusals (a path outside the roots, another process start, a changed session), a line longer than `max`, a
// file that shrinks, and the same text run as `python3 -c` (another machine's route).
import { test, expect, afterAll, mock } from "bun:test";
import { projectKey } from "../adapters/binding.js";
import { mkdirSync, writeFileSync, appendFileSync, rmSync, readFileSync, truncateSync, existsSync, cpSync, readdirSync, chmodSync } from "node:fs";

const HELPER = new URL("../helper/pdk-chat.py", import.meta.url).pathname;
const ROOT = `/tmp/pdk-ch${process.pid}`;
const HOME = `${ROOT}/u`; // /tmp is /private/tmp: the helper answers in the HOME it was given
const SID = "0b2c8d10-5a1e-4c7e-9d2f-3e4a5b6c7d8e";
const SID2 = "1b2c8d10-5a1e-4c7e-9d2f-3e4a5b6c7d8e";
const TH = "01a1bd47-5fc4-76f0-926e-e081542198de";
const CL = `${HOME}/.claude/projects/-w/${SID}.jsonl`;
const CX = `${HOME}/.codex/sessions/2026/11/11/rollout-2026-11-11T22-00-00-${TH}.jsonl`;
mkdirSync(`${HOME}/.claude/sessions`, { recursive: true });
mkdirSync(`${HOME}/.claude/projects/-w`, { recursive: true });
mkdirSync(`${HOME}/.codex/sessions/2026/11/11`, { recursive: true });
const procs = [];
afterAll(() => { for (const p of procs) p.kill(); rmSync(ROOT, { recursive: true, force: true }); });

const TMP = `${ROOT}/tmp`; // the helper's temp folder (TMPDIR): media must leave nothing in it
mkdirSync(TMP, { recursive: true });
const ENV = { HOME, PATH: "/usr/bin:/bin:/usr/sbin", TMPDIR: TMP };
const parse = (r) => ({ code: r.exitCode, ...JSON.parse(r.stdout.toString()) });
const run = (command, req) => parse(Bun.spawnSync(["/usr/bin/python3", "-I", "-S", HELPER, command, JSON.stringify(req)], { env: ENV }));
async function runAsync(command, req) {
  const p = Bun.spawn(["/usr/bin/python3", "-I", "-S", HELPER, command, JSON.stringify(req)], { env: ENV, stdout: "pipe" });
  const text = await new Response(p.stdout).text();
  return { code: await p.exited, ...JSON.parse(text) };
}
const startOf = (pid) => Bun.spawnSync(["/bin/ps", "-o", "lstart=", "-p", String(pid)], { env: { LC_ALL: "C", TZ: "UTC" } }).stdout.toString().trim();
const sleeper = (args = ["/bin/sleep", "60"]) => { const p = Bun.spawn(args, { env: ENV }); procs.push(p); return p; };

// A Claude stand-in: a live process and its registry entry.
const claude = (sid = SID) => {
  const p = sleeper();
  const start = startOf(p.pid);
  writeFileSync(`${HOME}/.claude/sessions/${p.pid}.json`, JSON.stringify({ pid: p.pid, sessionId: sid, cwd: "/w", procStart: start }));
  return { pid: p.pid, start };
};
const tailReq = (who, extra = {}) => ({ kind: "claude", pid: who.pid, procStart: who.start, session: SID, path: CL, offset: 0, max: 65536, align: 0, headLen: 4096, wait: 0, ...extra });

test("probe claude: the process start and its registry text, in the HOME given", () => {
  const who = claude();
  const r = run("probe", { kind: "claude", pid: who.pid });
  expect(r.code).toBe(0);
  expect(r).toMatchObject({ home: HOME, start: who.start });
  expect(JSON.parse(r.registryText).sessionId).toBe(SID);
  const gone = run("probe", { kind: "claude", pid: 999999 });
  expect(gone).toMatchObject({ start: null, registryText: null });
});

test("tail claude: whole lines with the read fields, proved; a line still being written waits", () => {
  const who = claude();
  writeFileSync(CL, '{"n":1}\n{"n":');
  const r = run("tail", tailReq(who));
  expect(r).toMatchObject({ proved: true, lines: [[0, '{"n":1}']], next: 8, eof: true, start: 0, headLen: 13 });
  for (const k of ["dev", "ino", "size", "head"]) expect(r[k]).toBeDefined();
});

test("a waiting tail answers soon after an append, and at the deadline when nothing comes", async () => {
  const who = claude();
  writeFileSync(CL, '{"n":1}\n');
  const t0 = Date.now();
  const pending = runAsync("tail", tailReq(who, { offset: 8, wait: 5000 }));
  await Bun.sleep(400);
  appendFileSync(CL, '{"n":2}\n');
  const r = await pending;
  expect(r.lines).toEqual([[8, '{"n":2}']]);
  expect(Date.now() - t0).toBeLessThan(1500);
  const t1 = Date.now();
  const idle = await runAsync("tail", tailReq(who, { offset: 16, wait: 600 }));
  expect(idle).toMatchObject({ lines: [], eof: true, proved: true });
  expect(Date.now() - t1).toBeGreaterThanOrEqual(550);
});

test("a missing file is waited for and read when it appears", async () => {
  const who = claude();
  rmSync(CL, { force: true });
  expect(run("tail", tailReq(who))).toMatchObject({ missing: true, proved: true });
  const pending = runAsync("tail", tailReq(who, { wait: 5000 }));
  await Bun.sleep(300);
  writeFileSync(CL, '{"n":1}\n');
  expect((await pending).lines).toEqual([[0, '{"n":1}']]);
});

test("refusals: a path outside the roots, another session's file name, a bad request", () => {
  const who = claude();
  mkdirSync(`${HOME}/.ssh`, { recursive: true });
  writeFileSync(`${HOME}/.ssh/x.jsonl`, "{}\n");
  for (const path of [`${HOME}/.ssh/x.jsonl`, `${HOME}/.claude/projects/-w/../../.ssh/x.jsonl`, `${HOME}/.claude/sessions/${who.pid}.json`, CX]) {
    const r = run("tail", tailReq(who, { path }));
    expect(r.code).not.toBe(0);
    expect(r.error).toMatch(/path not allowed/);
  }
  expect(run("tail", tailReq(who, { session: SID2 })).error).toMatch(/not that session's file/);
  expect(run("tail", { ...tailReq(who), pid: "1; rm" }).error).toBe("pid");
  expect(run("nope", {}).error).toMatch(/usage/);
});

test("rebind: another process start, a registry naming another session, a process gone", () => {
  const who = claude();
  writeFileSync(CL, '{"n":1}\n');
  expect(run("tail", tailReq(who, { procStart: "Mon Jan  1 00:00:00 2024" }))).toEqual({ code: 0, rebind: true, proved: true });
  writeFileSync(`${HOME}/.claude/sessions/${who.pid}.json`, JSON.stringify({ pid: who.pid, sessionId: SID2, cwd: "/w", procStart: who.start }));
  expect(run("tail", tailReq(who)).rebind).toBe(true);
  expect(run("tail", tailReq({ pid: 999999, start: who.start })).rebind).toBe(true);
});

test("R1: a Claude tail reads only the file its registry names, and only for that registry's process start", () => {
  const who = claude();
  writeFileSync(CL, '{"n":1}\n');
  expect(run("tail", tailReq(who)).lines.length).toBe(1);
  // Another project's file with the same session name: not this session's.
  mkdirSync(`${HOME}/.claude/projects/-other`, { recursive: true });
  writeFileSync(`${HOME}/.claude/projects/-other/${SID}.jsonl`, '{"n":"other"}\n');
  expect(run("tail", tailReq(who, { path: `${HOME}/.claude/projects/-other/${SID}.jsonl` }))).toEqual({ code: 0, rebind: true, proved: true });
  // A registry entry an earlier process with this pid left (its procStart is not this process's).
  writeFileSync(`${HOME}/.claude/sessions/${who.pid}.json`, JSON.stringify({ pid: who.pid, sessionId: SID, cwd: "/w", procStart: "Mon Jan  1 00:00:00 2024" }));
  expect(run("tail", tailReq(who)).rebind).toBe(true);
  // A registry entry for another folder names another file.
  writeFileSync(`${HOME}/.claude/sessions/${who.pid}.json`, JSON.stringify({ pid: who.pid, sessionId: SID, cwd: "/elsewhere", procStart: who.start }));
  expect(run("tail", tailReq(who)).rebind).toBe(true);
});

test("R1: the helper's project key is binding.js projectKey, on the same cases", () => {
  const cases = ["/w", "/private/tmp/a b.c", "/Users/x/café/naïve", "/tmp/e\u0301t\u00e9", "/tmp/🦊 fox", "/x".repeat(150), "/é".repeat(120)];
  const py = Bun.spawnSync(["/usr/bin/python3", "-I", "-S", "-c", "import json, runpy, sys; m = runpy.run_path(sys.argv[1], run_name='pdk'); print(json.dumps([m['project_key'](c) for c in json.loads(sys.argv[2])]))", HELPER, JSON.stringify(cases)]);
  expect(JSON.parse(py.stdout.toString())).toEqual(cases.map(projectKey));
});

test("a /clear while a tail waits ends the wait with rebind", async () => {
  const who = claude();
  writeFileSync(CL, '{"n":1}\n');
  const t0 = Date.now();
  const pending = runAsync("tail", tailReq(who, { offset: 8, wait: 5000 }));
  await Bun.sleep(300);
  writeFileSync(`${HOME}/.claude/sessions/${who.pid}.json`, JSON.stringify({ pid: who.pid, sessionId: SID2, cwd: "/w", procStart: who.start }));
  expect((await pending).rebind).toBe(true);
  expect(Date.now() - t0).toBeLessThan(1500);
});

test("a line longer than max is listed in skipped and reading goes on after it; a shrunk file says so", () => {
  const who = claude();
  const big = '{"blob":"' + "y".repeat(100000) + '"}';
  writeFileSync(CL, `{"a":1}\n${big}\n{"z":1}\n`);
  const r = run("tail", tailReq(who, { max: 4096 }));
  expect(r.lines).toEqual([[0, '{"a":1}']]);
  const r2 = run("tail", tailReq(who, { offset: r.next, max: 4096 }));
  expect(r2.skipped).toEqual([[8, big.length]]);
  expect(r2.lines).toEqual([[9 + big.length, '{"z":1}']]);
  truncateSync(CL, 4);
  expect(run("tail", tailReq(who, { offset: r2.next }))).toMatchObject({ shrunk: true, lines: [] });
});

test("an answer stays under 4 MiB: lines that don't fit are left for the next read, none lost", () => {
  const who = claude();
  writeFileSync(CL, "\x01\n".repeat(1 << 20)); // 2 MiB of one-byte lines: about 20 MiB as JSON
  const r1 = Bun.spawnSync(["/usr/bin/python3", "-I", "-S", HELPER, "tail", JSON.stringify(tailReq(who, { max: 2 << 20 }))], { env: ENV });
  expect(r1.stdout.length).toBeLessThan(4 << 20);
  const a = JSON.parse(r1.stdout.toString());
  expect(a.eof).toBe(false);
  expect(a.lines.length).toBeGreaterThan(1000);
  expect(a.next).toBe(a.lines.length * 2); // the next read starts right after the last line given
  expect(a.lines.at(-1)[0]).toBe(a.next - 2);
});

test("R7: an answer of skipped lines only stays under 4 MiB and the next read goes on from its cursor", () => {
  const who = claude();
  writeFileSync(CL, "xx\n".repeat(400000)); // every line longer than max=1
  let offset = 0, skipped = 0, reads = 0, eof = false;
  while (!eof && reads < 40) {
    const r1 = Bun.spawnSync(["/usr/bin/python3", "-I", "-S", HELPER, "tail", JSON.stringify(tailReq(who, { offset, max: 1 }))], { env: ENV });
    expect(r1.stdout.length).toBeLessThan(4 << 20);
    const a = JSON.parse(r1.stdout.toString());
    expect(a.lines).toEqual([]);
    if (a.skipped.length) expect(a.skipped[0][0]).toBe(offset); // nothing passed over unsaid
    skipped += a.skipped.length; offset = a.next; eof = a.eof; reads++;
  }
  expect([skipped, offset, eof]).toEqual([400000, 1200000, true]);
}, 60000);

test("R5: slim answers one long line's record with its image payloads emptied, under the tail's proof", () => {
  const who = claude();
  const data = "A".repeat(600000);
  const rec = { type: "user", message: { content: [{ type: "text", text: "Inspect this image" }, { type: "image", source: { type: "base64", media_type: "image/png", data } }],
    note: "data:image/png;base64," + data } };
  writeFileSync(CL, JSON.stringify(rec) + "\n");
  const t = run("tail", tailReq(who, { offset: -2097152, max: 524288, align: 1 }));
  expect([t.lines.length, t.skipped.length]).toEqual([0, 1]);
  const q = { ...tailReq(who), offset: t.skipped[0][0] };
  delete q.max; delete q.align; delete q.headLen; delete q.wait;
  const r = run("slim", q);
  expect(r.code).toBe(0);
  expect(r.record.message.content[0].text).toBe("Inspect this image");
  expect(r.record.message.content[1].source).toMatchObject({ data: "", pdk_bytes: 450000 });
  expect(r.record.message.note).toBe("data:image/png;pdk-bytes=450000;base64,");
  expect(run("slim", { ...q, procStart: "Mon Jan  1 00:00:00 2024" }).rebind).toBe(true);
  expect(run("slim", { ...q, offset: 5 }).error).toBe("not a line start");
  expect(run("slim", { ...q, path: `${HOME}/.ssh/x.jsonl` }).error).toMatch(/path not allowed/);
});

test("the first read starts after the line it landed in", () => {
  const who = claude();
  writeFileSync(CL, '{"a":1}\n{"b":2}\n{"c":3}\n');
  const r = run("tail", tailReq(who, { offset: -12, align: 1 }));
  expect(r.lines).toEqual([[16, '{"c":3}']]);
  expect(r.skipped).toEqual([[8, 7]]);
});

test("codex: probe reports held files and heads, tail checks the process still holds the file", () => {
  const meta = JSON.stringify({ type: "session_meta", payload: { id: TH, cwd: "/w" } });
  writeFileSync(CX, `${meta}\n{"type":"event_msg"}\n`);
  const p = sleeper(["/usr/bin/python3", "-I", "-S", "-c", "import sys,time; f=open(sys.argv[1]); time.sleep(60)", CX]);
  let r;
  for (let i = 0; i < 40; i++) { r = run("probe", { kind: "codex", pid: p.pid }); if (r.held?.length) break; Bun.sleepSync(50); }
  expect(r.code).toBe(0);
  expect(r.home).toBe(HOME);
  expect(r.held).toEqual([CX]);
  expect(r.heads).toEqual({ [CX]: meta });
  expect(r.stats[CX]).toMatchObject({ size: readFileSync(CX).length });
  expect(Math.abs(r.stats[CX].mtimeMs - Date.now())).toBeLessThan(60000);
  expect(r.start).toBe(startOf(p.pid));
  const q = { kind: "codex", pid: p.pid, procStart: r.start, session: TH, path: CX, offset: 0, max: 65536, align: 0, headLen: 4096, wait: 0 };
  expect(run("tail", q).lines.length).toBe(2);
  // Given what it was bound on (marks), a change in the held rollouts and thread locks answers rebind (a /clear).
  const rel = CX.slice(`${HOME}/.codex/`.length);
  expect(run("tail", { ...q, marks: [rel] }).lines.length).toBe(2);
  expect(run("tail", { ...q, marks: [rel, "thread-writer-locks/01a1ccdd-9b08-73a0-b4f4-cfceadd1d7ee.lock"] }).rebind).toBe(true);
  expect(run("tail", { ...q, marks: "x" }).error).toBe("marks");
  const other = sleeper();
  expect(run("tail", { ...q, pid: other.pid, procStart: startOf(other.pid) }).rebind).toBe(true); // holds nothing
  expect(run("tail", { ...q, kind: "claude" }).error).toMatch(/path not allowed/);
});

test("R2: a Codex tail bound among several held roots answers rebind once another is written last", () => {
  const TB = "01a1cce7-9ffc-7b73-9be4-73c8446929f2";
  const CB = `${HOME}/.codex/sessions/2026/11/11/rollout-2026-11-11T22-01-00-${TB}.jsonl`;
  writeFileSync(CX, JSON.stringify({ type: "session_meta", payload: { id: TH, cwd: "/w" } }) + "\n");
  writeFileSync(CB, JSON.stringify({ type: "session_meta", payload: { id: TB, cwd: "/w" } }) + "\n");
  const old = Date.now() / 1000 - 60;
  Bun.spawnSync(["/usr/bin/touch", "-t", new Date(old * 1000).toISOString().replace(/[-:T]/g, "").slice(0, 12), CB]);
  const p = sleeper(["/usr/bin/python3", "-I", "-S", "-c", "import sys,time; a=open(sys.argv[1]); b=open(sys.argv[2]); time.sleep(60)", CX, CB]);
  let r;
  for (let i = 0; i < 40; i++) { r = run("probe", { kind: "codex", pid: p.pid }); if (r.held?.length === 2) break; Bun.sleepSync(50); }
  expect(r.stats[CX].mtimeMs).toBeGreaterThan(r.stats[CB].mtimeMs);
  const rel = (f) => f.slice(`${HOME}/.codex/`.length);
  const q = { kind: "codex", pid: p.pid, procStart: r.start, session: TH, path: CX, offset: 0, max: 65536, align: 0, headLen: 4096, wait: 0, marks: [rel(CX), rel(CB)].sort(), roots: [CX, CB] };
  expect(run("tail", q).lines.length).toBe(1);
  appendFileSync(CB, '{"type":"event_msg"}\n'); // B is written last now
  expect(run("tail", q).rebind).toBe(true);
  expect(run("tail", { ...q, roots: "x" }).error).toBe("roots");
});

test("the same text runs as python3 -c, with nothing written next to it", () => {
  const who = claude();
  const src = readFileSync(HELPER, "utf8");
  const r = parse(Bun.spawnSync(["/usr/bin/python3", "-I", "-S", "-c", src, "probe", JSON.stringify({ kind: "claude", pid: who.pid })], { env: ENV }));
  expect(r).toMatchObject({ code: 0, start: who.start, home: HOME });
  expect(existsSync(new URL("../helper/__pycache__", import.meta.url).pathname)).toBe(false);
});

// shared/chat-call.js over a fake `herdr` whose exec runs the program here: a local call runs the installed file, a
// call with `on` sends the text through `python3 -c`; exec's own rejection there is "offline", a refusal is not.
// bun keeps the first `herdr` mock's export list for the whole run: the same names as the other test files.
const HERDR = ["spaces", "panes", "terminals", "machines", "run", "hc", "notify", "readTextFile", "writeTextFile", "appHome", "home", "exec"];
mock.module("herdr", () => Object.fromEntries(HERDR.map((n) => [n, (...a) => globalThis.pdkHerdr[n](...a)])));

test("chat-call: one process per call, here from the app's folder, there through python3 -c", async () => {
  mkdirSync(`${ROOT}/home/pdk/helper`, { recursive: true });
  cpSync(HELPER, `${ROOT}/home/pdk/helper/pdk-chat.py`);
  const execs = [];
  let unreachable = false;
  globalThis.pdkHerdr = {
    appHome: () => `${ROOT}/home`,
    readTextFile: async (p) => { execs.push(["read", p]); return readFileSync(p, "utf8"); },
    exec: async (cmd, args, opts) => {
      execs.push([cmd, args[2] === "-c" ? "-c" : args[2], opts]);
      if (unreachable) throw new Error("machine box is not connected");
      const r = Bun.spawnSync([cmd === "python3" ? "/usr/bin/python3" : cmd, ...args], { env: ENV });
      return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
    },
  };
  const { chatCall } = await import("../shared/chat-call.js");
  const who = claude();
  expect(await chatCall("probe", { kind: "claude", pid: who.pid })).toMatchObject({ start: who.start });
  expect(execs[0]).toEqual(["/usr/bin/python3", `${ROOT}/home/pdk/helper/pdk-chat.py`, { timeout: 15000 }]);
  expect(await chatCall("probe", { kind: "claude", pid: who.pid }, { on: "box", timeout: 25000 })).toMatchObject({ start: who.start });
  await chatCall("probe", { kind: "claude", pid: who.pid }, { on: "box" });
  expect(execs.filter((e) => e[0] === "read").length).toBe(1); // the text is read once
  expect(execs.at(-1)).toEqual(["python3", "-c", { on: "box", timeout: 15000 }]);
  const refused = await chatCall("tail", tailReq(who, { path: `${HOME}/.ssh/x.jsonl` }), { on: "box" }).catch((e) => e);
  expect([refused.message, refused.offline]).toEqual(["path not allowed", undefined]);
  unreachable = true;
  const off = await chatCall("probe", { kind: "claude", pid: who.pid }, { on: "box" }).catch((e) => e);
  expect(off.offline).toBe(true);
  expect(off.message).toMatch(/box can't be reached/);
});

// Media on another machine: pdk-chat.py makes the preview there and answers its PNG; nothing is left in its temp folder.
const FIXTURE = new URL("./media-fixture.py", import.meta.url).pathname;
const M = `${HOME}/media`;
mkdirSync(M, { recursive: true });
Bun.spawnSync(["/usr/bin/python3", "-I", "-S", "-c", `import runpy; m = runpy.run_path(${JSON.stringify(FIXTURE)}); m["png"](${JSON.stringify(`${M}/shot.png`)}, 1200, 800, rows=m["gradient"](1200, 800, (34, 139, 230), (190, 75, 219))); m["pdf"](${JSON.stringify(`${M}/report.pdf`)})`]);
writeFileSync(`${M}/notes.txt`, "x");
writeFileSync(`${M}/page.html`, "<p>x</p>");
cpSync(`${M}/shot.png`, `${M}/run.png`); chmodSync(`${M}/run.png`, 0o755);
const isPng = (b64) => Buffer.from(b64, "base64").subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const tmpEmpty = () => readdirSync(TMP).filter((n) => n.startsWith("pdk-chat-")).length === 0;

test("media: an image and a PDF come back as PNG previews with the local answer's facts; the temp folder is empty", () => {
  const img = run("media", { path: `${M}/shot.png`, variant: "thumb", force: false });
  expect(img).toMatchObject({ code: 0, kind: "image", size: readFileSync(`${M}/shot.png`).length, srcWidth: 1200, srcHeight: 800, width: 480, height: 320 });
  expect(isPng(img.png)).toBe(true);
  expect(JSON.parse(img.stamp)[0]).toBe("file");
  const view = run("media", { path: `${M}/shot.png`, variant: "view" });
  expect([view.width, view.height]).toEqual([1200, 800]); // never larger than the file
  const doc = run("media", { path: `${M}/report.pdf`, variant: "thumb" });
  expect(doc.kind).toBe("pdf");
  expect(isPng(doc.png)).toBe(true);
  expect(tmpEmpty()).toBe(true);
});

test("media: missing, HTML, refused kinds and executables answer as the local helper does", () => {
  expect(run("media", { path: `${M}/gone.png`, variant: "thumb" })).toMatchObject({ code: 0, missing: true });
  const page = run("media", { path: `${M}/page.html`, variant: "thumb" });
  expect([page.kind, page.png]).toEqual(["html", undefined]);
  expect(run("media", { path: `${M}/notes.txt`, variant: "thumb" }).error).toBe("not a media file");
  expect(run("media", { path: `${M}/run.png`, variant: "thumb" }).error).toBe("executable file");
  expect(run("media", { path: "media/shot.png", variant: "thumb" }).error).toBe("path not allowed");
  expect(run("media", { path: "~/media/shot.png", variant: "thumb" }).kind).toBe("image");
});

test("inline: an image held in a session file comes back as a preview", () => {
  const data = readFileSync(`${M}/shot.png`).toString("base64");
  writeFileSync(CL, `{"type":"user"}\n` + JSON.stringify({ type: "user", message: { content: [{ type: "image", source: { type: "base64", media_type: "image/png", data } }] } }) + "\n");
  const r = run("inline", { path: CL, offset: 16, index: 0, variant: "thumb" });
  expect(r).toMatchObject({ code: 0, mime: "image/png", bytes: readFileSync(`${M}/shot.png`).length, srcWidth: 1200, width: 480 });
  expect(isPng(r.png)).toBe(true);
  expect(run("inline", { path: CL, offset: 3, index: 0, variant: "thumb" }).error).toBe("not a line start");
  expect(run("inline", { path: CL, offset: 16, index: 1, variant: "thumb" }).error).toBe("no such image");
  expect(run("inline", { path: `${M}/shot.png`, offset: 0, index: 0, variant: "thumb" }).error).toBe("path not allowed");
  expect(tmpEmpty()).toBe(true);
});

test("mediaPreview with `on`: the preview lands in this Mac's cache in the local shape, keyed by machine", async () => {
  cpSync(new URL("../helper/pdk-helper.py", import.meta.url).pathname, `${ROOT}/home/pdk/helper/pdk-helper.py`);
  globalThis.pdkHerdr = {
    appHome: () => `${ROOT}/home`,
    readTextFile: async (p) => readFileSync(p, "utf8"),
    exec: async (cmd, args) => {
      const r = Bun.spawnSync([cmd === "python3" ? "/usr/bin/python3" : cmd, ...args], { env: ENV });
      return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
    },
  };
  const { mediaPreview } = await import("../shared/helper.js");
  const ref = { key: "file:x", src: "file", kind: "image", path: `${M}/shot.png`, on: "box" };
  const t0 = Date.now();
  const a = await mediaPreview(ref, "thumb");
  expect(Date.now() - t0).toBeLessThan(2000);
  expect(a).toMatchObject({ kind: "image", srcWidth: 1200, width: 480, height: 320, on: "box" });
  expect(a.png).toBeUndefined();
  expect(a.image).toMatch(/^pdk-cache\/media\/[0-9a-f]{24}\.png$/);
  expect(isPng(readFileSync(`${ROOT}/home/${a.image}`).toString("base64"))).toBe(true);
  const b = await mediaPreview({ ...ref, on: "vps" }, "thumb");
  expect(b.image).not.toBe(a.image); // the same path on two machines never shares an entry
  expect(readdirSync(`${ROOT}/home/pdk-cache/incoming`)).toEqual([]);
  expect(await mediaPreview({ ...ref, path: `${M}/gone.png` }, "thumb")).toMatchObject({ missing: true, on: "box" });
  const inl = await mediaPreview({ key: "i", src: "inline", kind: "image", transcript: CL, offset: 16, index: 0, on: "box" }, "thumb");
  expect(inl).toMatchObject({ mime: "image/png", width: 480, on: "box" });
  expect(inl.file).toBeUndefined();
  const refused = await mediaPreview({ ...ref, path: `${M}/notes.txt` }, "thumb").catch((e) => e);
  expect(refused.message).toBe("not a media file");
  // `store` keeps only a PNG, and the incoming file goes either way.
  const store = (id) => JSON.parse(Bun.spawnSync(["/usr/bin/python3", "-I", "-S", `${ROOT}/home/pdk/helper/pdk-helper.py`, "store", id, "box", "[]"], { env: ENV }).stdout.toString());
  writeFileSync(`${ROOT}/home/pdk-cache/incoming/bad.b64`, Buffer.from("GIF89a not a png").toString("base64"));
  expect(store("bad").error).toBe("not a PNG preview");
  expect(store("../x").error).toBe("usage");
  expect(store("none").error).toBe("no preview to keep");
  expect(readdirSync(`${ROOT}/home/pdk-cache/incoming`)).toEqual([]);
});

test("R3 mediaOriginal: a remote file comes to this Mac's cache byte for byte, in pieces, and is used again", async () => {
  const { mediaOriginal } = await import("../shared/helper.js");
  const bytes = Buffer.alloc(6_500_000);
  for (let i = 0; i < bytes.length; i += 4096) bytes.writeUInt32LE((i * 2654435761) >>> 0, i);
  writeFileSync(`${M}/clip.mp4`, bytes); // three pieces
  const ref = { key: "file:clip", src: "file", kind: "video", path: `${M}/clip.mp4`, name: "clip.mp4", on: "box" };
  const hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
  const a = await mediaOriginal(ref);
  expect(a.path).toMatch(new RegExp(`^(/private)?${ROOT}/home/pdk-cache/media/[0-9a-f]{24}\\.mp4$`));
  expect(hash(readFileSync(a.path))).toBe(hash(bytes));
  expect(readdirSync(`${ROOT}/home/pdk-cache/incoming`)).toEqual([]);
  expect((await mediaOriginal(ref)).path).toBe(a.path); // the same file unchanged: the copy here
  const opened = JSON.parse(Bun.spawnSync(["/usr/bin/python3", "-I", "-S", `${ROOT}/home/pdk/helper/pdk-helper.py`, "realpath", a.path], { env: ENV }).stdout.toString());
  expect(opened.path).toBeDefined(); // inside the app home, where `open` takes it
  writeFileSync(`${M}/big.mov`, Buffer.alloc(26 * 1024 * 1024));
  expect((await mediaOriginal({ ...ref, path: `${M}/big.mov`, name: "big.mov" }).catch((e) => e)).message).toBe("big.mov on box is 27.3 MB: only files up to 25 MB are copied to this Mac");
  expect((await mediaOriginal({ ...ref, path: `${M}/gone.mp4`, name: "gone.mp4" }).catch((e) => e)).message).toBe("gone.mp4 is not on box any more");
  expect((await mediaOriginal({ ...ref, path: `${M}/notes.txt` }).catch((e) => e)).message).toBe("not a media file");
  expect((await mediaOriginal({ ...ref, on: null }).catch((e) => e)).message).toMatch(/another machine/);
}, 60000);

test("R8 mediaOriginal: a piece that makes no progress, overruns, comes for another offset or is not base64 is refused at once, nothing left", async () => {
  const { mediaOriginal } = await import("../shared/helper.js");
  const real = globalThis.pdkHerdr.exec;
  const run = async (head, piece) => {
    let pieces = 0;
    globalThis.pdkHerdr.exec = async (cmd, args, opts) => {
      if (!opts?.on) return real(cmd, args, opts); // this Mac's helper (keep) runs for real
      const req = JSON.parse(args.at(-1));
      if (req.length === 0) return { code: 0, stdout: JSON.stringify(head), stderr: "" };
      if (++pieces > 50) throw new Error("the copy loop did not end");
      return { code: 0, stdout: JSON.stringify(piece(req)), stderr: "" };
    };
    const e = await mediaOriginal({ src: "file", kind: "video", path: "/x/clip.mp4", name: "clip.mp4", on: "box" }).catch((x) => x);
    return { message: e?.message, pieces, left: readdirSync(`${ROOT}/home/pdk-cache/incoming`) };
  };
  const head = (size) => ({ kind: "video", size, ext: "mp4", stamp: `s-${size}-${Math.random()}`, offset: 0, data: "" });
  try {
    const h = head(1); // the reviewer's reply: size 1, every piece empty at offset 0
    expect(await run(h, () => ({ ...h, offset: 0, data: "" }))).toEqual({ message: "clip.mp4 from box was refused: a piece of it was empty", pieces: 1, left: [] });
    const g = head(3);
    expect(await run(g, () => ({ ...g, offset: 0, data: Buffer.from("12345").toString("base64") }))).toMatchObject({ message: "clip.mp4 from box was refused: a piece of it was longer than the file", pieces: 1, left: [] });
    const w = head(3);
    expect(await run(w, () => ({ ...w, offset: 7, data: "YWJj" }))).toMatchObject({ message: "clip.mp4 from box was refused: a piece came for another place in the file", pieces: 1, left: [] });
    const b = head(3);
    expect(await run(b, () => ({ ...b, offset: 0, data: "@@@@" }))).toMatchObject({ message: "clip.mp4 from box was refused: a piece of it is not base64", pieces: 1, left: [] });
    // Pieces that each add a byte but more of them than the size allows: refused at the cap, nothing left.
    const c = head(5);
    expect(await run(c, (req) => ({ ...c, offset: req.offset, data: Buffer.from("x").toString("base64") }))).toMatchObject({ pieces: 2, left: [] });
    expect((await run({ ...head(1), size: -1 }, () => ({}))).message).toBe("clip.mp4 from box was refused: its size is not a size");
  } finally {
    globalThis.pdkHerdr.exec = real;
  }
});
