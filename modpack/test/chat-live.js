// Driven by test/chat-live.sh (read its header): the real Feed and chat-call over the real helper, here and on box.
// `herdr` is stood in for by a module whose exec runs the program here, or through `hc exec --on <machine>` (Core's
// exec, which the app's exec({ on }) uses); hc's "unavailable" and "spawn_failed" answers reject, as the app's do.
import { plugin } from "bun";
import { appendFileSync, readFileSync, renameSync, writeFileSync, chmodSync, readdirSync, mkdirSync } from "node:fs";

const LIVE = process.env.PDK_LIVE;
const S = process.env.PDK_SANDBOX;
const HOMES = { here: process.env.HOME, box: process.env.PDK_BOX_HOME };

async function exec(cmd, args, { on = null, timeout = 30000 } = {}) {
  const argv = on ? ["hc", "exec", "--on", on, "--timeout", String(Math.ceil(timeout / 1000)), "--", cmd, ...args] : [cmd, ...args];
  const p = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (on && code !== 0) {
    for (const text of [stdout, stderr]) {
      let e = null;
      try { e = JSON.parse(text)?.error; } catch { /* the program's own output */ }
      if (e && typeof e === "object" && ["unavailable", "spawn_failed"].includes(e.kind)) throw new Error(e.message);
    }
  }
  return { code, stdout, stderr };
}
plugin({
  name: "herdr",
  setup(b) {
    b.module("herdr", () => ({ loader: "object", exports: { exec, appHome: () => process.env.PDK_APP_HOME, readTextFile: async (p) => readFileSync(p, "utf8") } }));
  },
});
const { chatCall } = await import("../shared/chat-call.js");
const { mediaPreview, mediaOriginal } = await import("../shared/helper.js");
const { Feed } = await import("../adapters/feed.js");
const { Thread, feed: feedThread, parseLines } = await import("../adapters/chat.js");

let failed = 0;
const row = (ok, what) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${what}`); };
const sleep = (ms) => Bun.sleep(ms);

// As a view runs a Feed: step() once a second, never awaited; `until` is looked at every 50 ms.
async function drive(f, t, until, ms = 30000) {
  const end = Date.now() + ms;
  let next = 0;
  while (Date.now() < end) {
    if (Date.now() >= next) { f.step(t); next = Date.now() + 1000; }
    if (until()) return true;
    await sleep(50);
  }
  return until();
}
const settled = async (f) => { for (let i = 0; i < 400 && f.running; i++) await sleep(50); };
// A tail is waiting in the helper (started, in flight, past its first look).
async function waitingTail(f, t) {
  await settled(f);
  for (let i = 0; i < 30 && !f.running; i++) { f.step(t); await sleep(100); }
  await sleep(600);
  return Boolean(f.running);
}

function agent(where, kind) {
  const dir = `${LIVE}/${where}-${kind}`;
  const pid = Number(readFileSync(`${dir}/pid`, "utf8"));
  const calls = [];
  const call = async (command, req, opts) => {
    const c = { command, at: Date.now() };
    calls.push(c);
    const r = await chatCall(command, req, opts);
    c.reply = r;
    return r;
  };
  const f = new Feed({ address: `${where}/${kind}`, kind, on: where === "box" ? "box" : null, call });
  const t = { address: f.address, foreground: { pid, argv: kind === "codex" ? ["codex", "--no-daemon"] : ["claude"] } };
  const type = (text) => appendFileSync(`${dir}/in`, `${text}\n`);
  return { where, kind, f, t, calls, type, name: `${where} ${kind}` };
}
const texts = (f) => f.thread.rows().filter((r) => r.type === "user" || r.type === "assistant").map((r) => r.text);
const has = (f, text) => texts(f).some((x) => x.includes(text));
// What the session file holds now, mapped the same way, read straight from disk (both machines are this Mac).
const fileTexts = (a) => {
  const lines = readFileSync(a.f.binding.path.replace(/^~/, HOMES[a.where]), "utf8").split("\n").filter(Boolean).map((x, i) => [i, x]);
  const th = feedThread(new Thread(), a.kind, parseLines(lines), {});
  return th.rows().filter((r) => r.type === "user" || r.type === "assistant").map((r) => r.text);
};

async function bindAndRead(a) {
  const ok = await drive(a.f, a.t, () => a.f.state === "live" && a.f.caughtUpAt > 0, 20000);
  row(ok && a.f.binding?.ok, `${a.name}: probe binds (${a.f.binding?.ok ? `session ${a.f.binding.session.slice(0, 8)}` : a.f.reason ?? a.f.state}), first read live with ${texts(a.f).length} messages`);
}

async function liveAppend(a, label) {
  const waiting = await waitingTail(a.f, a.t);
  const word = `${label}-${Date.now()}`;
  const t0 = Date.now();
  a.type(word);
  await drive(a.f, a.t, () => has(a.f, word), 5000);
  const ms = Date.now() - t0;
  const rec = a.f.thread.entries.find((e) => e.type === "user" && e.text.includes(word));
  const sinceWrite = rec?.at ? Date.now() - rec.at : null;
  row(waiting && rec && ms < 1000, `${a.name}: a line typed while a tail waits shows in ${ms} ms (${sinceWrite ?? "?"} ms after the double wrote it)`);
  await drive(a.f, a.t, () => has(a.f, `Noted: ${word}`), 6000); // the double's reply, 2 s later
}

async function newSession(a) {
  const before = { session: a.f.binding.session, gen: a.f.gen };
  const waiting = await waitingTail(a.f, a.t);
  const tail = a.calls.length - 1;
  const t0 = Date.now();
  a.type(a.kind === "claude" ? "/clear" : "/new");
  const rebound = await drive(a.f, a.t, () => a.calls.slice(tail).some((c) => c.reply?.rebind), 8000);
  const ms = Date.now() - t0;
  if (a.kind === "codex") {
    // Codex writes the new thread's file with its first message and keeps the old one open meanwhile.
    const unbound = await drive(a.f, a.t, () => a.f.state === "unbound", 10000);
    const said = a.f.reason;
    const word = `first-message-${Date.now()}`;
    const t1 = Date.now();
    a.type(word);
    const bound = await drive(a.f, a.t, () => a.f.binding?.ok && a.f.binding.session !== before.session && has(a.f, word), 15000);
    const held = a.f.binding?.marks?.filter((m) => m.endsWith(".jsonl")).length ?? 0;
    row(waiting && rebound && unbound && bound && held >= 2 && a.f.gen > before.gen,
      `${a.name}: /new answers rebind in ${ms} ms ("${said}"); with the old rollout still held (${held} held), the new thread binds with its first message in ${Date.now() - t1} ms`);
  } else {
    const bound = await drive(a.f, a.t, () => a.f.binding?.ok && a.f.binding.session !== before.session && ["live", "waiting"].includes(a.f.state), 10000);
    row(waiting && rebound && bound && a.f.gen > before.gen && texts(a.f).length === 0,
      `${a.name}: /clear in the same process answers rebind in ${ms} ms, binds session ${a.f.binding?.session?.slice(0, 8)} (${a.f.state}), thread started over`);
  }
  await liveAppend(a, "after-new-session");
}

// Media on box (round 2): previews made there come back into this Mac's cache, in the local answer's shape.
async function media() {
  const BOX = HOMES.box, CACHE = `${process.env.PDK_APP_HOME}`;
  const tmpOf = await exec("/usr/bin/python3", ["-I", "-S", "-c", "import tempfile; print(tempfile.gettempdir())"], { on: "box" });
  const TMP = tmpOf.stdout.trim();
  const temps = () => readdirSync(TMP).filter((n) => n.startsWith("pdk-chat-")).sort().join(",");
  const before = temps();
  const file = (name, extra = {}) => ({ key: `file:${name}`, src: "file", kind: "image", path: `${BOX}/media/${name}`, on: "box", ...extra });
  const png = (r) => r?.image && readFileSync(`${CACHE}/${r.image}`).subarray(0, 4).toString("hex") === "89504e47";
  const timed = async (ref, variant) => { const t0 = Date.now(); const r = await mediaPreview(ref, variant).catch((e) => ({ error: e.message })); return [r, Date.now() - t0]; };
  let [r, ms] = await timed(file("shot.png"), "thumb");
  row(png(r) && r.width === 480 && r.srcWidth === 1600 && r.on === "box" && ms < 2000, `box image: a thumbnail (${r.width}x${r.height} of ${r.srcWidth}x${r.srcHeight}) in this Mac's cache (${r.image}) in ${ms} ms`);
  [r, ms] = await timed(file("shot.png"), "view");
  row(png(r) && r.width === 1600, `box image: the view (${r.width}x${r.height}) in ${ms} ms`);
  [r, ms] = await timed(file("clip.mp4", { kind: "video" }), "thumb");
  row(png(r) && r.kind === "video", `box video: its poster frame (${r.width}x${r.height}) in ${ms} ms${r.error ? ` (${r.error})` : ""}`);
  [r, ms] = await timed(file("report.pdf", { kind: "pdf" }), "thumb");
  row(png(r) && r.kind === "pdf", `box PDF: its first page (${r.width}x${r.height}) in ${ms} ms`);
  // An image a session file on box holds: a Claude user record with a pasted image block.
  const transcript = `${BOX}/.claude/projects/-media/0b2c8d10-5a1e-4c7e-9d2f-3e4a5b6c7d8e.jsonl`;
  mkdirSync(`${BOX}/.claude/projects/-media`, { recursive: true });
  const lead = '{"type":"user","message":{"content":"look"}}\n';
  writeFileSync(transcript, lead + JSON.stringify({ type: "user", message: { content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: readFileSync(`${BOX}/media/shot.png`).toString("base64") } }] } }) + "\n");
  [r, ms] = await timed({ key: "inline", src: "inline", kind: "image", transcript, offset: lead.length, index: 0, on: "box" }, "thumb");
  row(png(r) && r.mime === "image/png" && r.file === undefined, `box inline image held in a session file: a thumbnail (${r.width}x${r.height}) in ${ms} ms`);
  [r] = await timed(file("gone.png"), "thumb");
  row(r.missing === true && r.on === "box", `box missing file: says missing`);
  [r] = await timed(file("notes.txt"), "thumb");
  row(r.error === "not a media file", `box file outside the allowed kinds: refused ("${r.error}")`);
  // The original of a video on box, for the preview's Play (review R3): byte for byte in this Mac's cache.
  const hash = (p) => new Bun.CryptoHasher("sha256").update(readFileSync(p)).digest("hex");
  const t0 = Date.now();
  const o = await mediaOriginal(file("clip.mp4", { kind: "video", name: "clip.mp4" })).catch((e) => ({ error: e.message }));
  ms = Date.now() - t0;
  const same = o.path && hash(o.path) === hash(`${BOX}/media/clip.mp4`);
  row(same && o.path.includes("/pdk-cache/media/"), `box video original: ${o.path ?? o.error}, ${readFileSync(`${BOX}/media/clip.mp4`).length} bytes, sha256 ${same ? "equal" : "DIFFERENT"}, in ${ms} ms`);
  row(temps() === before, `box's temp folder (${TMP}): nothing left by the previews (pdk-chat-* before "${before}", after "${temps()}")`);
}

// Box unreachable: its route answers "can't reach" and its Core is stopped. The doubles keep running.
const VIA = `${S}/via-box`;
function routeOff() {
  renameSync(VIA, `${VIA}.on`);
  writeFileSync(VIA, '#!/bin/sh\necho "box is switched off for the test" >&2\nexit 1\n');
  chmodSync(VIA, 0o755);
  Bun.spawnSync(["sh", `${import.meta.dir}/machine.sh`, "stop"]);
  Bun.spawnSync(["pkill", "-f", `${S}/mb/bin/herdr-core connect`]);
}
const routeOn = () => renameSync(`${VIA}.on`, VIA);

async function offline(a) {
  await settled(a.f);
  routeOff();
  const off = await drive(a.f, a.t, () => a.f.state === "offline", 15000);
  row(off, `${a.name}: box's Core stopped, its route cut: the call rejects as offline ("${a.f.reason}")`);
  const word = `while-offline-${Date.now()}`;
  a.type(word); // the agent goes on writing while box can't be reached
  await sleep(3000);
  routeOn();
  const t0 = Date.now();
  const back = await drive(a.f, a.t, () => a.f.state === "live" && has(a.f, `Noted: ${word}`), 40000);
  const want = fileTexts(a), got = texts(a.f);
  const same = JSON.stringify(want) === JSON.stringify(got);
  row(back && same, `${a.name}: back after ${Date.now() - t0} ms, read on from the cursor: ${got.length} messages, the file has ${want.length}, ${same ? "nothing lost or doubled" : "MISMATCH"}`);
}

async function idleCost(a, ms = 31000) {
  await settled(a.f);
  const from = a.calls.length;
  const t0 = Date.now();
  await drive(a.f, a.t, () => false, ms);
  const n = a.calls.length - from;
  row(n <= Math.ceil(ms / 10000) + 1 && n >= 2, `${a.name}: idle and shown, ${n} helper calls in ${Math.round((Date.now() - t0) / 1000)} s (${a.calls.slice(from).map((c) => c.command).join(", ")})`);
}

const agents = [agent("here", "claude"), agent("here", "codex"), agent("box", "claude"), agent("box", "codex")];
for (const a of agents) {
  console.log(`-- ${a.name} (pid ${a.t.foreground.pid})`);
  await bindAndRead(a);
  await liveAppend(a, "live");
  await newSession(a);
}
console.log("-- box offline and back");
for (const a of agents.filter((x) => x.where === "box")) await offline(a);
console.log("-- media");
await media();
console.log("-- idle cost");
await idleCost(agents[0]);
await idleCost(agents[3]);
for (const a of agents) a.f.close();
console.log(failed ? `${failed} FAILED` : "all rows passed");
process.exit(failed ? 1 : 0);
