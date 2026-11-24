import { test, expect, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

// pdk-machine-add: Herdr's own Add a machine dialog (stock.js, byte for byte) with the needs-an-answer branch sent to a
// Herdr terminal and the hand-off to the new machine's tab (main.js).
const PACK = new URL("..", import.meta.url).pathname;
const MOD = join(PACK, "mods/pdk-machine-add");

// The stock dialog this copy was taken from. A Herdr update: copy <app home>/mods/machine-add/main.js over stock.js;
// if its sha256 changed, re-check main.js's add() (a copy of stock's with two branches changed) against it.
const PIN = { version: "0.1.15", sha256: "53feb81ba5206782e9eea4b958a8fe601e0f1aeda98df0d71f8212bd096eae99" };
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
// The app the sandboxes run (sandbox.sh's APP): Herdr updates it in place.
const APP = process.env.PDK_APP ?? readFileSync(join(PACK, "test/sandbox.sh"), "utf8").match(/APP=\$\{PDK_APP:-([^}]+)\}/)[1];
const PLIST = join(dirname(dirname(APP)), "Info.plist");

test("stock.js is Herdr's machine-add/main.js byte for byte, and the Herdr here is the version it was taken from", () => {
  expect(sha(join(MOD, "stock.js"))).toBe(PIN.sha256);
  expect(JSON.parse(readFileSync(join(MOD, "mod.json"), "utf8")).cloned_from).toEqual({ name: "machine-add", version: PIN.version });
  if (existsSync(PLIST)) {
    const version = readFileSync(PLIST, "utf8").match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)</)?.[1];
    expect(version, `Herdr is ${version}: compare its mods/machine-add/main.js with stock.js (sha256 ${PIN.sha256})`).toBe(PIN.version);
  }
});

// A recording stand-in for gpui-kit, gpui-base and herdr.
const ROOT = mkdtempSync(join(tmpdir(), "pdk-machine-add-test-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));
writeFileSync(join(ROOT, "stub.js"), `
export const element=kind=>{const o={kind,ops:[]};let p;p=new Proxy(o,{get(o,k){if(k in o||k==="then"||typeof k==="symbol")return o[k];return(...a)=>{if(k==="when"){if(a[0])a[1](p);return p;}o.ops.push([k,...a]);return p;};}});return p;};
export class View {}
export const div=()=>element("div"),svg=()=>element("svg"),h_flex=()=>element("h_flex"),v_flex=()=>element("v_flex");
export const Button={new:id=>element("Button").id(id)},Toggle={new:id=>element("Toggle").id(id)},Progress={new:()=>element("Progress")},ProgressTrack={new:()=>element("ProgressTrack")},ProgressIndicator={new:()=>element("ProgressIndicator")},HoverCard={new:()=>element("HoverCard")},Popover={new:()=>element("Popover")};
export const store=new Map(),shared=k=>store.get(k)??null,setShared=(k,v)=>store.set(k,v),fonts=()=>[],window=()=>({platform:"macos"}),spaces=()=>[],panes=()=>[],machines=()=>[],focused=()=>null,keys=()=>[],appHome=()=>"/scratch/app",knownAgents=async()=>[],notify=()=>null,pickFolder=async()=>null;
export const state={};
export const InputState={new(){let value="";return{on(){},value:()=>value,set_value(v){value=v;},focus(){}};}};
export const Input={new:()=>element("input")},TextView={html:(id,html)=>{const e=element("text");e.html=html;return e;}};
export const home=()=>"/scratch",props=()=>state.props,theme=()=>state.theme,nextCommand=()=>new Promise(()=>{});
export const run=(...a)=>state.commands.push(a),closeOverlay=id=>state.closed.push(id),openOverlay=spec=>{state.opened.push(spec);return "view-"+state.opened.length;};
export const readTextFile=async()=>null;
export const hc=async args=>{state.hcCalls.push(args);return state.hc(args);};
export const exec=async(...a)=>{state.execCalls.push(a);if(a[0]==="hc"){state.hcCalls.push(a[1]);return state.hc(a[1]);}if(a[0]==="sh"&&String(a[1][1]).startsWith("t=$1"))return state.sweep(a[1][3]);if(a[0]==="sleep")return state.sleep(a[1][0]);return{code:0,stdout:"Linux\\n/usr/bin/herdr-core\\n"};};
`);
// As install.sh lays a mod out: its files, and adapters/ and shared/ in lib/.
const patch = (s, stub) => s.replace(/from "(?:gpui-kit|gpui-base|herdr)"/g, `from "${stub}"`);
for (const f of ["stock.js", "main.js"]) writeFileSync(join(ROOT, f), patch(readFileSync(join(MOD, f), "utf8"), "./stub.js"));
mkdirSync(join(ROOT, "lib"));
for (const dir of ["adapters", "shared"]) for (const n of readdirSync(join(PACK, dir)).filter((n) => n.endsWith(".js"))) writeFileSync(join(ROOT, "lib", n), patch(readFileSync(join(PACK, dir, n), "utf8"), "../stub.js"));
const { state, store } = await import(join(ROOT, "stub.js"));
const { default: MachineAdd, answerView, CLEANUP, CLEANUP_MS, LAUNCH_MS, OWED } = await import(join(ROOT, "main.js"));

const last = (e, k) => e.ops.filter((o) => o[0] === k).at(-1)?.[1];
const all = (e) => [e, ...e.ops.flatMap((o) => (o[0] === "child" ? [o[1]] : o[0] === "children" ? o[1] : [])).filter((c) => c?.ops).flatMap(all)];
const byId = (e, k) => all(e).find((n) => last(n, "id") === k);
const cx = { notify() {}, stop_propagation() {}, focus_handle: () => ({ focus() {} }), sleep: () => new Promise((r) => setImmediate(r)), spawn: (fn) => { fn(cx); }, timer: { after() {}, every() {} } };
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r)); };
async function dialog() { const m = new MachineAdd(); m.init({}, cx); await settle(); state.hcCalls.length = 0; return m; }

// A stand-in Core: the quiet add's reply, the machines listed, the terminals `hc run` makes (by name and address), and
// faults on request. A gate holds one kind of call open until the test lets it go.
const ok = (o) => ({ code: 0, stdout: JSON.stringify(o), stderr: "" });
const gate = () => { let open; const p = new Promise((r) => { open = r; }); return { p, open }; };
let core;
beforeEach(() => {
  const f = JSON.parse(readFileSync(join(PACK, "themes/pdk-t3-light.json"), "utf8"));
  Object.assign(state, { theme: { ...f, ...f.colors }, props: { overlay: "dialog" }, hcCalls: [], commands: [], closed: [], opened: [], execCalls: [], sweep: async () => ({ code: 0, stdout: "" }), sleep: async () => ({ code: 0, stdout: "" }) });
  store.clear();
  core = { quiet: NEEDS, machines: [], terminals: [], n: 0, gates: {}, faults: [], rmFails: 0, onGet: null };
  state.hc = async (args) => {
    const [verb, sub] = args;
    if (core.gates[verb === "machine" ? sub : verb]) await core.gates[verb === "machine" ? sub : verb].p;
    if (verb === "machine" && sub === "add") return core.quiet;
    if (verb === "machine" && sub === "ls") return ok({ machines: core.machines });
    if (verb === "machine" && sub === "rm") { core.machines = core.machines.filter((m) => m.name !== args[2]); return ok({}); }
    if (verb === "run") {
      const t = { address: `t${++core.n}`, name: args[args.indexOf("--name") + 1], target: args.at(-1), state: "live", gets: 0 };
      core.terminals.push(t);
      return ok({ address: t.address, state: "live" });
    }
    const t = core.terminals.find((x) => x.name === sub || x.address === sub);
    const missing = { code: 3, stdout: "", stderr: JSON.stringify({ error: { kind: "not_found" } }) };
    if (verb === "get") {
      const fault = core.faults.shift();
      if (fault === "reject") throw new Error("core socket reset");
      if (fault === "garbage") return { code: 1, stdout: "", stderr: "core restarting" };
      if (!t) return missing;
      t.gets++; core.onGet?.(t);
      return ok({ address: t.address, state: t.state, exit_code: t.exit_code ?? null, reason: t.reason ?? null, signal: t.signal ?? null });
    }
    if (verb === "kill") { if (t?.state === "live") Object.assign(t, { state: "finished", reason: "killed", signal: 1, exit_code: null }); return t ? ok({}) : missing; }
    if (verb === "rm") {
      if (!t) return missing;
      if (t.state === "live") return { code: 1, stdout: "", stderr: JSON.stringify({ error: { kind: "live" } }) };
      if (core.rmFails > 0) { core.rmFails--; return { code: 1, stdout: "", stderr: JSON.stringify({ error: { kind: "io" } }) }; }
      core.terminals = core.terminals.filter((x) => x !== t);
      return ok({ removed: t.address });
    }
    return ok({});
  };
});
const NEEDS = { code: 1, stdout: JSON.stringify({ error: { kind: "unreachable", message: "cannot reach hive: Host key verification failed." } }) };
// The person answers on the terminal's second read: it ends as `fields` say, and `machines` are listed from then on.
const endsWith = (fields, machines = []) => { core.onGet = (t) => { if (t.gets === 2 && t.state === "live") { Object.assign(t, { state: "finished", ...fields }); core.machines.push(...machines); } }; };
const runs = () => state.hcCalls.filter((a) => a[0] === "run");
// The cleanups close() starts (exec sh CLEANUP <name>, with its own time limit).
const sweeps = () => state.execCalls.filter((a) => a[0] === "sh");
// Its unseen wait is in 0.25 s polls, until the launch's limit (LAUNCH_MS, plus 5 s) has passed.
const sweepOf = (name) => ["sh", ["-c", CLEANUP, "sh", name, expect.stringMatching(/^\d+$/)], { timeout: CLEANUP_MS }];
const removals = () => state.hcCalls.filter((a) => a[0] === "machine" && a[1] === "rm");

test("an add that needs an answer runs `hc machine add <host>` in a named Herdr terminal shown over the dialog, never the sentence to copy", async () => {
  const m = await dialog();
  m.add("hive", cx); await settle();
  const [run] = runs();
  expect(run.slice(0, 4)).toEqual(["run", "--bg", "--json", "--name"]);
  expect(run[4]).toMatch(/^pdk-add-[a-z0-9]+$/);
  expect(run.slice(5)).toEqual(["--", "hc", "machine", "add", "hive"]);
  // Sent through exec with a known time limit, which CLEANUP's wait for an unseen terminal outlasts.
  expect(state.execCalls.find((a) => a[0] === "hc")[2]).toEqual({ timeout: LAUNCH_MS });
  expect(state.opened).toEqual([answerView("hive", "t1")]);
  expect(state.opened[0]).toMatchObject({ kind: "dialog", modal: true });
  expect(state.opened[0].layout.children.map((c) => c.content)).toEqual([{ mod: "pdk-machine-add", props: { part: "bar", target: "hive", terminal: "t1" } }, { terminal: "t1" }]);
  expect(m.state.hive).toBe("adding");
  expect(JSON.stringify(m.state)).not.toContain("hc machine");
  await m.close();
});

test("the answered add: exit 0 and the new machine there; the terminal removed, the view and the dialog closed, its tab chosen", async () => {
  const m = await dialog();
  core.machines = [{ id: "old", name: "box", target: "box" }];
  endsWith({ reason: "exited", exit_code: 0 }, [{ id: "new", name: "hive", target: "hive" }]);
  m.add("hive", cx); await settle();
  expect(core.terminals).toEqual([]);
  expect(state.closed).toEqual(["view-1", "dialog"]);
  expect(state.commands).toEqual([["pdk-tree.machine:hive"]]);
  expect(m.state.hive).toBeUndefined();
  expect(m.attempts.size).toBe(0);
});

test("RP03: a non-zero exit is a failure even when a machine for that host is there (another client's): one line and Retry", async () => {
  const m = await dialog();
  endsWith({ reason: "exited", exit_code: 1 }, [{ id: "theirs", name: "independent-hive", target: "hive" }]);
  m.add("hive", cx); await settle();
  expect(m.state.hive).toBe("Couldn't add hive.");
  expect(state.closed).toEqual(["view-1"]); // the dialog stays
  expect(state.commands).toEqual([]);
  expect(core.terminals).toEqual([]);
  const msg = m.message(state.theme, "hive");
  expect(JSON.stringify(all(msg).flatMap((n) => n.ops.filter((o) => o[0] === "child" && typeof o[1] === "string").map((o) => o[1])))).toBe('["Couldn\'t add hive.","Retry"]');
  const retry = byId(msg, "ma-retry-hive");
  expect(retry.kind).toBe("Button");
  state.hcCalls.length = 0; core.onGet = null;
  last(retry, "on_click")({}, cx); await settle();
  expect(state.hcCalls[0]).toEqual(["machine", "add", "hive", "--json"]);
  await m.close();
});

test("RP02: a cancelled add never removes a machine, whether another client added one meanwhile or one was there before", async () => {
  for (const [ends, word] of [[{ reason: "killed", signal: 1, exit_code: null }, "Cancel"], [{ reason: "exited", signal: 2, exit_code: null }, "Ctrl+C"]]) {
    const m = await dialog();
    core.terminals = []; core.machines = [{ id: "before", name: "hive-old", target: "hive" }];
    endsWith(ends, [{ id: "theirs", name: "independent-hive", target: "hive" }]);
    m.add("hive", cx); await settle();
    expect(removals(), word).toEqual([]);
    expect(core.machines.map((x) => x.id), word).toEqual(["before", "theirs"]);
    expect(m.state.hive, word).toBe("Cancelled.");
    expect(state.commands, word).toEqual([]);
    expect(core.terminals, word).toEqual([]);
    state.closed.length = 0; state.opened.length = 0;
  }
});

test("RP03: an unreadable hc get is unknown, not an end: the watch goes on, nothing is killed or removed early", async () => {
  const m = await dialog();
  core.faults = ["reject", "garbage", "reject"]; // the first three reads fail
  endsWith({ reason: "exited", exit_code: 0 }, [{ id: "new", name: "hive", target: "hive" }]);
  m.add("hive", cx); await settle();
  // Three failed reads, then live, then finished: only then is it removed; it is never killed.
  const verbs = state.hcCalls.map((a) => a[0]);
  expect(verbs.slice(0, verbs.indexOf("rm")).filter((v) => v === "get").length).toBeGreaterThanOrEqual(5);
  expect(verbs).not.toContain("kill");
  expect(state.commands).toEqual([["pdk-tree.machine:hive"]]);
  expect(core.terminals).toEqual([]);
});

test("RP03: kill and rm answers are checked: a failed rm is tried again, and one that keeps failing stays owned until the dialog goes", async () => {
  let m = await dialog();
  core.rmFails = 2;
  endsWith({ reason: "exited", exit_code: 1 });
  m.add("hive", cx); await settle();
  expect(state.hcCalls.filter((a) => a[0] === "rm").length).toBe(3);
  expect(core.terminals).toEqual([]);
  expect(m.attempts.size).toBe(0);
  m = await dialog(); state.execCalls.length = 0;
  core.rmFails = 99;
  endsWith({ reason: "exited", exit_code: 1 });
  m.add("hive", cx); await settle();
  expect(core.terminals.length).toBe(1);
  expect(m.attempts.size).toBe(1);
  const name = core.terminals[0].name;
  await m.close();
  expect(sweeps()).toEqual([sweepOf(name)]);
});

test("RP01: closing while the quiet add or the machine list is still on its way starts no terminal and opens no view", async () => {
  for (const held of ["add", "ls"]) {
    const m = await dialog(); state.execCalls.length = 0; state.opened.length = 0;
    core.gates[held] = gate();
    m.add("hive", cx); await settle();
    await m.close();
    core.gates[held].open(); delete core.gates[held]; await settle();
    expect(runs(), held).toEqual([]);
    expect(state.opened, held).toEqual([]);
    expect(sweeps(), held).toEqual([]);
  }
});

test("RP01: closing while `hc run` is on its way ends that terminal by its name, and no view opens after", async () => {
  const m = await dialog();
  core.gates.run = gate();
  m.add("hive", cx); await settle();
  const name = state.hcCalls.find((a) => a[0] === "run")[4];
  await m.close();
  expect(sweeps()).toEqual([sweepOf(name)]);
  core.gates.run.open(); delete core.gates.run; await settle();
  expect(state.opened).toEqual([]);
  expect(m.attempts.size).toBe(0);
});

test("RP01: two hosts at once are two attempts, each with its own terminal; closing ends both", async () => {
  const m = await dialog();
  m.add("hive", cx); m.add("grok", cx); await settle();
  expect(runs().map((a) => a.at(-1))).toEqual(["hive", "grok"]);
  const names = runs().map((a) => a[4]);
  expect(new Set(names).size).toBe(2);
  expect(state.opened.length).toBe(2);
  await m.close();
  expect(state.closed.slice(0, 2)).toEqual(["view-1", "view-2"]);
  expect(sweeps()).toEqual(names.map(sweepOf));
});

test("RP01: close awaits nothing, so the 250 ms budget can't cut its cleanup; the cleanup runs as its own process", async () => {
  const m = await dialog();
  m.add("hive", cx); await settle();
  state.hc = () => new Promise(() => {}); // every hc call from here on hangs
  const t0 = Date.now();
  await Promise.race([m.close(), new Promise((_, no) => setTimeout(() => no(new Error("close waited")), 250))]);
  expect(Date.now() - t0).toBeLessThan(250);
  expect(sweeps().length).toBe(1);
});

// The cleanup script against a stand-in hc: its `hc run` lands late (two not-founds), then it is live, then killed;
// rm fails once. It ends with the terminal removed.
test("RP01: CLEANUP waits for a terminal still on its way, kills it, and retries rm until it is removed", () => {
  const bin = join(ROOT, "fakebin"), log = join(ROOT, "hc.log"), st = join(ROOT, "hc.state");
  mkdirSync(bin, { recursive: true });
  writeFileSync(st, "0");
  writeFileSync(join(bin, "hc"), `#!/bin/sh
n=$(cat "${st}"); echo "$*" >> "${log}"
case "$1" in
  get) n=$((n+1)); echo $n > "${st}"
       if [ $n -le 2 ]; then echo '{"error":{"kind":"not_found"}}' >&2; exit 3; fi
       if [ -f "${st}.killed" ]; then echo '{"state":"finished","reason":"killed"}'; else echo '{"state":"live"}'; fi ;;
  kill) touch "${st}.killed" ;;
  rm) if [ -f "${st}.rmfailed" ]; then exit 0; fi; touch "${st}.rmfailed"; exit 1 ;;
esac
`, { mode: 0o755 });
  const r = Bun.spawnSync(["/bin/sh", "-c", CLEANUP, "sh", "pdk-add-x", "160"], { env: { PATH: `${bin}:/usr/bin:/bin` } });
  expect(r.exitCode).toBe(0);
  const calls = readFileSync(log, "utf8").trim().split("\n").map((l) => l.split(" ")[0]);
  expect(calls).toEqual(["get", "get", "get", "kill", "get", "rm", "get", "rm"]);
});

// The real CLEANUP body against a stand-in hc and an instant sleep: the terminal appears only after `late` reads
// (each read is a 0.25 s poll), then is live until killed. Returns the exit code and the hc verbs called.
function cleanupRun(late, wait, vanish = false) {
  const dir = mkdtempSync(join(ROOT, "cleanup-")), st = join(dir, "n"), log = join(dir, "log");
  writeFileSync(st, "0");
  writeFileSync(join(dir, "sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  writeFileSync(join(dir, "hc"), `#!/bin/sh
echo "$1" >> "${log}"
case "$1" in
  get) n=$(($(cat "${st}")+1)); echo $n > "${st}"
       if [ $n -le ${late} ]; then echo '{"error":{"kind":"not_found"}}' >&2; exit 3; fi
       if [ -f "${dir}/rmd" ]; then echo '{"error":{"kind":"not_found"}}' >&2; exit 3; fi
       ${vanish ? `touch "${dir}/rmd"` : ""}
       if [ -f "${dir}/killed" ]; then echo '{"state":"finished","reason":"killed"}'; else echo '{"state":"live"}'; fi ;;
  kill) touch "${dir}/killed" ;;
  rm) touch "${dir}/rmd" ;;
esac
`, { mode: 0o755 });
  const r = Bun.spawnSync(["/bin/sh", "-c", CLEANUP, "sh", "pdk-add-x", String(wait)], { env: { PATH: `${dir}:/usr/bin:/bin` } });
  return { code: r.exitCode, verbs: readFileSync(log, "utf8").trim().split("\n") };
}

test("RP01: CLEANUP outlasts the launch: a terminal its `hc run` creates 24 s in (past the old 10 s window) is still killed and removed", async () => {
  // The wait close() asks for covers the launch's whole limit, and the exec running CLEANUP outlasts that wait.
  const m = await dialog();
  m.add("hive", cx); await settle();
  const t0 = Date.now(); await m.close();
  const wait = Number(sweeps()[0][1][4]);
  expect(wait * 250).toBeGreaterThanOrEqual(LAUNCH_MS);
  expect(CLEANUP_MS).toBeGreaterThan((wait + 80) * 250 + (Date.now() - t0));
  const late = cleanupRun(96, wait);
  expect(late.code).toBe(0);
  expect(late.verbs.slice(96)).toEqual(["get", "kill", "get", "rm"]);
  // Seen live, then gone (removed by someone else) before its own rm: done at once, not after the wait.
  const gone = cleanupRun(0, wait, true);
  expect(gone.code).toBe(0);
  expect(gone.verbs).toEqual(["get", "kill", "get"]);
  // Never created: it gives up only once the wait is over, and says so (exit 1).
  const never = cleanupRun(10000, wait);
  expect(never.code).toBe(1);
  expect(never.verbs.length).toBe(wait + 1);
});

test("RP01: a cleanup that exits 1 is not dropped: one more kill and rm through hc, and if that fails too the terminal stays owed and the next dialog sweeps it", async () => {
  let m = await dialog();
  m.add("hive", cx); await settle();
  const name = core.terminals[0].name;
  state.sweep = async () => ({ code: 1, stdout: "" });
  await m.close(); await settle();
  expect(state.hcCalls.slice(-2)).toEqual([["kill", name], ["rm", name]]);
  expect(core.terminals).toEqual([]);
  expect(store.get(OWED)).toEqual([]);
  // A Core that keeps refusing: the name stays owed, and a new dialog starts its cleanup again.
  m = await dialog(); state.execCalls.length = 0;
  m.add("grok", cx); await settle();
  const second = core.terminals.at(-1).name;
  core.rmFails = 99;
  await m.close(); await settle();
  expect(store.get(OWED)).toEqual([{ name: second, until: expect.any(Number) }]);
  state.execCalls.length = 0; core.rmFails = 0; state.sweep = async () => ({ code: 0, stdout: "" });
  store.set(OWED, [...store.get(OWED), "not-an-entry", { name: 3 }]); // anything malformed is dropped, never swept
  await dialog();
  expect(sweeps()).toEqual([sweepOf(second)]);
  expect(store.get(OWED)).toEqual([]);
});

// Review 3: closed while `hc run` is still on its way, and the cleanup fails early (rejects, or exits 1) while the
// launch can still create the terminal. Not finding it then proves nothing: it stays owed. Once the launch's limit has
// passed it is swept again (the terminal, created meanwhile, is removed); if this code is gone by then, the next
// dialog sweeps it.
test("RP01: a cleanup that fails while the launch is pending never forgets the terminal the launch creates afterwards", async () => {
  // CLEANUP's job against the stand-in Core: kill and remove the terminal if it is there.
  const real = async (name) => {
    const t = core.terminals.find((x) => x.name === name);
    if (!t) return { code: 1, stdout: "" };
    core.terminals = core.terminals.filter((x) => x !== t);
    return { code: 0, stdout: "" };
  };
  for (const early of [async () => { throw new Error("sh did not start"); }, async () => ({ code: 1, stdout: "" })]) {
    for (const stillRunning of [true, false]) {
      const m = await dialog(); core.terminals = []; store.clear();
      core.gates.run = gate();
      m.add("hive", cx); await settle();
      const name = state.hcCalls.find((a) => a[0] === "run")[4];
      let first = true;
      state.sweep = (n) => (first ? ((first = false), early()) : real(n));
      // The launch lands during the wait for its limit; then the second sweep runs (or, stopped, it doesn't).
      state.sleep = async () => { core.gates.run.open(); await settle(); return stillRunning ? { code: 0 } : Promise.reject(new Error("gone")); };
      await m.close(); await settle(); await settle(); await settle();
      delete core.gates.run;
      if (stillRunning) {
        expect(core.terminals).toEqual([]);
        expect(store.get(OWED)).toEqual([]);
      } else {
        expect(core.terminals.map((t) => t.name)).toEqual([name]); // created after close, nobody has removed it yet
        expect(store.get(OWED).map((o) => o.name)).toEqual([name]); // but it is still owed
        state.sweep = real;
        await dialog(); await settle(); // the next dialog sweeps it
        expect(core.terminals).toEqual([]);
        expect(store.get(OWED)).toEqual([]);
      }
      expect(state.opened.filter((o) => o.layout).length).toBe(0); // no view opened after close
    }
  }
});

test("RP01: closed while a refresh is on its way, nothing acts on the closed dialog: the quiet add's and the answered add's", async () => {
  // Quiet: the add succeeds, then the dialog closes during its refresh.
  let m = await dialog();
  core.quiet = { code: 0, stdout: "{}" }; core.machines = [{ id: "b", name: "box", target: "box" }];
  core.gates.ls = gate();
  m.add("box", cx); await settle();
  await m.close();
  core.gates.ls.open(); delete core.gates.ls; await settle();
  expect(state.commands).toEqual([]);
  // Answered: the terminal ends with exit 0, then the dialog closes during finish's refresh.
  m = await dialog(); state.closed.length = 0;
  core.quiet = NEEDS;
  endsWith({ reason: "exited", exit_code: 0 }, [{ id: "new", name: "hive", target: "hive" }]);
  const finish = core.onGet;
  core.onGet = (t) => { finish(t); if (t.state === "finished" && !core.gates.ls) core.gates.ls = gate(); };
  m.add("hive", cx); await settle();
  await m.close();
  core.gates.ls.open(); delete core.gates.ls; await settle();
  expect(state.commands).toEqual([]);
  expect(state.closed).toEqual(["view-1", "dialog"]);
  expect(m.state.hive).toBe("adding");
});

test("an add that needs no answer stays one quiet click, as in stock, and ends on the new machine's tab", async () => {
  const m = await dialog();
  core.quiet = { code: 0, stdout: "{}" }; core.machines = [{ id: "b", name: "box", target: "box" }];
  m.add("box", cx); await settle();
  expect(state.opened).toEqual([]);
  expect(state.commands).toEqual([["pdk-tree.machine:box"]]);
  expect(state.closed).toEqual([]); // the dialog stays, saying Added
  expect(m.isAdded("box")).toBe(true);
});

test("RP05: from the keyboard, Ctrl+C in the terminal (SIGINT) ends the add as cancelled; Cancel is the shared button and ends it with Herdr's terminal.kill", async () => {
  const m = await dialog();
  endsWith({ reason: "exited", signal: 2, exit_code: null });
  m.add("hive", cx); await settle();
  expect(m.state.hive).toBe("Cancelled.");
  expect(core.terminals).toEqual([]);
  state.props = { part: "bar", target: "hive", terminal: "t4", overlay: "view-1" };
  const bar = new MachineAdd(); bar.init({}, cx);
  const el = bar.render();
  expect(all(el).some((n) => n.ops.some((o) => o[0] === "child" && o[1] === "hive"))).toBe(true);
  const cancel = byId(el, "ma-cancel");
  expect(cancel.kind).toBe("Button");
  expect(last(cancel, "tab_index")).toBe(0);
  last(cancel, "on_click")({}, cx);
  expect(state.commands.at(-1)).toEqual(["terminal.kill", { terminal: "t4" }]);
});
