// tremor settings (pdk-settings, owner 11 Nov): the pane hover choice and a default folder per machine, saved,
// refused and cleared; Cmd+K's "tremor settings" opens it. The mod runs against a stub of gpui and herdr.
import { test, expect, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandRows } from "../adapters/search-commands.js";
const PACK = new URL("..", import.meta.url).pathname;
const ROOT = mkdtempSync(join(tmpdir(), "pdk-settings-test-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));
for (const dir of ["lib", "settings"]) mkdirSync(join(ROOT, dir));
writeFileSync(join(ROOT, "stub.js"), `
export const element=kind=>{const o={kind,ops:[]};let p;p=new Proxy(o,{get(o,k){if(k in o||k==="then"||typeof k==="symbol")return o[k];return(...a)=>{if(k==="when"){if(a[0])a[1](p);return p;}o.ops.push([k,...a]);return p;};}});return p;};
export class View {}
export const div=()=>element("div"),svg=()=>element("svg"),h_flex=()=>element("h_flex"),v_flex=()=>element("v_flex");
export const Button={new:id=>element("Button").id(id)},Toggle={new:id=>element("Toggle").id(id)},Progress={new:id=>element("Progress").id(id)},ProgressTrack={new:()=>element("ProgressTrack")},ProgressIndicator={new:()=>element("ProgressIndicator")},HoverCard={new:id=>element("HoverCard").id(id)},Popover={new:id=>element("Popover").id(id)};
export const TextView={html:(id,html)=>element("text")},readTextFile=async()=>null,hc=async()=>({code:1,stdout:""});
export const state={};
export const InputState={new(opts){let value=opts.value??"";return{events:{},on(k,fn){this.events[k]=fn;},value:()=>value,set_value(v){value=v;},focus(){state.onFocus?.();}};}};
export const Input={new:s=>{const e=element("input");e.input=s;return e;}};
export const settings=()=>({zoom:1}),keys=()=>[],fonts=()=>[],window=()=>({platform:"macos"}),props=()=>state.props,theme=()=>state.theme,home=()=>"/Users/v";
export const spaces=()=>[],machines=()=>[{name:"box",layout:"ready"}];
export const shared=k=>state.store[k]??null,setShared=(k,v)=>{state.store[k]=v;};
export const closeOverlay=id=>state.closed.push(id),run=(...a)=>state.commands.push(a);
export const pickFolder=async()=>state.pick,nextCommand=()=>new Promise(()=>{});
export const exec=async(cmd,args,opts)=>{state.execs.push({cmd,args,opts});const on=opts?.on??"";if(state.gate)await state.gate;
 if(cmd==="test"&&state.checkGates[args[1]])return await state.checkGates[args[1]];
 if(state.rejects.includes(on+":"+cmd))throw new Error("connection closed");
 if(cmd==="printenv")return state.homes[on]?{code:0,stdout:state.homes[on]+"\\n"}:{code:1,stdout:""};
 if(cmd==="test")return{code:(state.dirs[on]??[]).includes(args[1])?0:1,stdout:""};return{code:1,stdout:""};};
`);
const patch = (s) => s.replace(/from "(?:gpui-kit|gpui-base|herdr)"/g, 'from "../stub.js"');
for (const dir of ["adapters", "shared"]) for (const n of readdirSync(join(PACK, dir)).filter((n) => n.endsWith(".js"))) writeFileSync(join(ROOT, "lib", n), patch(readFileSync(join(PACK, dir, n), "utf8")));
writeFileSync(join(ROOT, "settings/main.js"), patch(readFileSync(process.env.PDK_SETTINGS_SOURCE ?? join(PACK, "mods/pdk-settings/main.js"), "utf8")).replaceAll('"./lib/', '"../lib/'));
const { state } = await import(join(ROOT, "stub.js"));
const { default: Settings, checkFolder } = await import(join(ROOT, "settings/main.js"));
const last = (e, k) => e.ops.filter((o) => o[0] === k).at(-1)?.[1];
const all = (e) => [e, ...e.ops.flatMap((o) => (o[0] === "child" ? [o[1]] : o[0] === "children" ? o[1] : [])).filter((c) => c?.ops).flatMap(all)];
const id = (e, k) => all(e).find((n) => last(n, "id") === k);
const text = (e) => JSON.stringify(e);
// Host callbacks expire when they return, even if their returned promise is pending.
const bindings = [];
const taskCx = () => ({ focus_handle: () => ({ focus() {} }), notify() {}, stop_propagation() {}, bind_keys: (l) => { bindings.push(...l); return l.length; },
  timer: { every: () => ({ cancel() {} }) }, spawn(fn) { return fn(taskCx()); } });
const cx = taskCx();
const fire = (fn, event = {}) => {
  let live = true;
  const tasks = [];
  const guard = () => { if (!live) throw new Error("cx is no longer valid after callback returned"); };
  const callbackCx = { notify() { guard(); }, stop_propagation() { guard(); },
    spawn(fn) { guard(); const task = Promise.resolve(fn(taskCx())); tasks.push(task); return task; } };
  let result;
  try { result = fn(event, callbackCx); } finally { live = false; }
  return Promise.all([result, ...tasks]);
};
const click = (p, name) => fire(last(id(p.render(), name), "on_click"));
const enter = (p, machine = "") => fire(p.rows[machine].input.events.submit);
const page = () => { const p = new Settings(); p.init({}, cx); return p; };

beforeEach(() => {
  const f = JSON.parse(readFileSync(join(PACK, "themes/pdk-t3-light.json"), "utf8"));
  Object.assign(state, { theme: { ...f, ...f.colors }, props: { overlay: "set" }, store: {}, closed: [], commands: [], pick: null, gate: null, execs: [], rejects: [], checkGates: {},
    homes: { "": "/Users/v", box: "/home/v" }, dirs: { "": ["/Users/v/work", "/Users/v/code"], box: ["/home/v/evals"] } });
});

test("two rows: Pane hover (Clean, Normal; absent is Clean) and a Default folder line per machine, This computer first", () => {
  const r = page().render();
  expect(last(id(r, "settings-head"), "h")).toBe(40);
  const choice = id(r, "settings-hover-choice");
  expect(text(choice)).toContain("Clean"); expect(text(choice)).toContain("Normal");
  expect(text(id(r, "settings-hover-choice-clean"))).toContain('"pressed",true');
  expect(id(r, "set-folder-local")).toBeDefined(); expect(id(r, "set-folder-box")).toBeDefined();
  expect(text(id(r, "set-folder-local"))).toContain("This computer");
  expect(id(r, "set-choose")).toBeDefined(); expect(text(id(r, "set-folder-box"))).not.toContain("Choose");
  // F1: the rule in the hint, Automatic as each field's placeholder; F2: the name line holds the name only.
  expect(text(id(r, "settings-folder-label"))).toContain("Empty: the folder you're in, else the last one used, else home");
  expect(text(id(r, "set-name-box"))).not.toContain("Automatic");
});

let focusCount = 0;
const focusCalls = () => focusCount;
const InputStateFocus = () => { focusCount = 0; state.onFocus = () => focusCount++; return () => { state.onFocus = null; }; };
test("each field's placeholder is Automatic; a saved path shows once, in the field, not in the name line", () => {
  state.store["pdk.new.default"] = { "": "/Users/v/work" };
  const p = page();
  const r = p.render();
  expect(text(id(r, "set-name-local"))).toContain("This computer");
  expect(text(id(r, "set-name-local"))).not.toContain("/Users/v/work");
  expect(text(id(r, "set-name-local"))).not.toContain("Automatic");
  expect(p.rows[""].input.value()).toBe("/Users/v/work");
  expect(text(r).split("/Users/v/work").length - 1).toBe(0); // the path lives in the field's state, drawn by the field
});

test("S2: the row reads field, Choose…, Clear in that order, and This computer's field is asked for focus on open", () => {
  const p = new Settings();
  const ticks = [];
  const openCx = { ...taskCx(), timer: { every: (_ms, fn) => { ticks.push(fn); return { cancel() { ticks.length = 0; } }; } } };
  const orig = InputStateFocus();
  p.init({}, openCx);
  const asked = focusCalls();
  expect(asked).toBeGreaterThan(0);
  ticks[0]?.(); // a frame without focus asks again
  expect(focusCalls()).toBeGreaterThan(asked);
  p.rows[""].input.events.focus({}, cx); ticks[0]?.(); // focus arrived: it stops
  expect(ticks.length).toBe(0);
  const row = id(p.render(), "set-folder-local");
  const order = all(row).map((n) => (n.kind === "input" ? "field" : last(n, "id"))).filter((k) => ["field", "set-choose", "set-clear-local"].includes(k));
  expect(order).toEqual(["field", "set-choose", "set-clear-local"]);
  orig();
});

test("S3: mod.json has no height, so the host fits the dialog to its content", () => {
  const mod = JSON.parse(readFileSync(join(PACK, "mods/pdk-settings/mod.json"), "utf8"));
  expect(mod.overlay.kind).toBe("dialog");
  expect("height" in mod.overlay).toBe(false);
  const r = page().render();
  expect(r.ops.some((o) => o[0] === "size_full" || o[0] === "h_full")).toBe(false);
  // The body keeps its content height (a shrinkable one collapsed to nothing in the fitted dialog) and scrolls past
  // 85% of the window.
  const body = id(r, "settings-body");
  expect(body.ops.some((o) => o[0] === "flex_none")).toBe(true);
  expect(body.ops.some((o) => o[0] === "min_h" || o[0] === "flex_shrink_1" || o[0] === "flex_1" || o[0] === "overflow_y_scrollbar")).toBe(false);
  expect(body.ops.some((o) => o[0] === "overflow_y_scroll")).toBe(true);
  globalThis.window = { viewport_size: () => ({ width: 1440, height: 900 }) };
  try { expect(last(id(page().render(), "settings-body"), "max_h")).toBe(Math.floor(900 * 0.85) - 40 - 48 - 2); } finally { delete globalThis.window; }
});

test("the hover choice writes pdk.pane.hover", () => {
  const r = page().render();
  last(id(r, "settings-hover-choice-normal"), "on_change")(true, cx); // a click, Space or Enter on the Toggle
  expect(state.store["pdk.pane.hover"]).toBe("normal");
  expect(text(id(page().render(), "settings-hover-choice-normal"))).toContain('"pressed",true');
});

test("saves per machine, ~ expanded there; refuses a missing, relative or root folder and saves nothing; Clear removes one", async () => {
  const p = page();
  await p.save("", "~/work/", cx);
  await p.save("box", "~/evals", cx);
  expect(state.store["pdk.new.default"]).toEqual({ "": "/Users/v/work", box: "/home/v/evals" });
  expect(p.rows.box.input.value()).toBe("/home/v/evals");
  for (const [m, typed, line] of [["", "/Users/v/nope", "No such folder"], ["box", "/Users/v/work", "No such folder"], ["", "work", "Needs a full path"], ["box", "/", "Not the root folder"]]) {
    await p.save(m, typed, cx);
    expect(p.rows[m].error).toBe(line);
  }
  expect(state.store["pdk.new.default"]).toEqual({ "": "/Users/v/work", box: "/home/v/evals" });
  expect(text(id(p.render(), "set-folder-local"))).toContain("Needs a full path");
  // Enter is the field's submit.
  p.rows[""].input.set_value("/Users/v/code"); await enter(p);
  expect(state.store["pdk.new.default"][""]).toBe("/Users/v/code");
  last(id(p.render(), "set-clear-box"), "on_click")({}, cx);
  expect(state.store["pdk.new.default"]).toEqual({ "": "/Users/v/code" });
  // "/" is fine for root.
  state.homes.box = "/root"; state.dirs.box.push("/");
  expect(await checkFolder("/", "box")).toEqual({ folder: "/" });
});

// Review RC07: Clear while a save's check is still running wins; the check's late answer saves nothing.
test("save, then Clear while its check runs, then the check answers: the default stays cleared", async () => {
  state.store["pdk.new.default"] = { box: "/home/v/evals" };
  state.dirs.box.push("/home/v/api");
  const p = page();
  let answer;
  state.gate = new Promise((r) => (answer = r));
  const saving = p.save("box", "/home/v/api", cx);
  expect(p.rows.box.busy).toBe(true);
  last(id(p.render(), "set-clear-box"), "on_click")({}, cx);
  answer();
  await saving;
  expect(state.store["pdk.new.default"]).toEqual({});
  expect(p.rows.box.busy).toBe(false);
  expect(p.rows.box.input.value()).toBe("");
  // A save after that still works.
  state.gate = null;
  await p.save("box", "/home/v/api", cx);
  expect(state.store["pdk.new.default"]).toEqual({ box: "/home/v/api" });
});

test("Choose… uses the folder picker on this computer; a cancel saves nothing", async () => {
  const p = page();
  await p.choose(cx);
  expect(state.store["pdk.new.default"]).toBeUndefined();
  state.pick = "/Users/v/code";
  await p.choose(cx);
  expect(state.store["pdk.new.default"]).toEqual({ "": "/Users/v/code" });
});

test("Cmd+K's tremor settings entry opens the page, found by its words", () => {
  const rows = commandRows({ catalogue: [], context: {}, snapshot: { spaces: [], panes: [], terminals: [], machines: [] } });
  const row = rows.find((r) => r.label === "tremor settings");
  expect(row.command).toEqual({ name: "mod.open", args: { name: "pdk-settings" } });
  expect(row.hay).toContain("default folder pane hover");
  expect(row.group).toBe("tremor");
});

// S1: one save model. Leaving a field commits it as Enter does; Done (and Escape, bound) commits, waits, closes.
test("leaving the field saves a typed path; a bad path shows its reason and writes nothing", async () => {
  const p = page();
  p.rows[""].input.set_value("/Users/v/work");
  await fire(p.rows[""].input.events.blur);
  expect(state.store["pdk.new.default"]).toEqual({ "": "/Users/v/work" });
  p.rows.box.input.set_value("/home/v/nope");
  await fire(p.rows.box.input.events.blur);
  expect(p.rows.box.error).toBe("No such folder");
  expect(state.store["pdk.new.default"]).toEqual({ "": "/Users/v/work" });
  expect(text(id(p.render(), "set-folder-box"))).toContain("No such folder");
});

test("one Done button, no Save or Cancel; Done commits the typed text and closes", async () => {
  const p = page();
  const r = p.render();
  expect(text(id(r, "settings-done"))).toContain('"Done"');
  for (const gone of ["settings-save", "settings-cancel", "settings-close"]) expect(id(r, gone)).toBeUndefined();
  p.rows[""].input.set_value("/Users/v/work");
  p.rows.box.input.set_value("/home/v/evals");
  await click(p, "settings-done");
  expect(state.store["pdk.new.default"]).toEqual({ "": "/Users/v/work", box: "/home/v/evals" });
  expect(state.closed).toEqual(["set"]);
  // An untouched page closes at once, writing nothing.
  Object.assign(state, { store: {}, closed: [] });
  await click(page(), "settings-done");
  expect(state.closed).toEqual(["set"]);
  expect(state.store["pdk.new.default"]).toBeUndefined();
});

test("Done after a fresh refusal stays open with the reason; a second Done closes and writes nothing", async () => {
  const p = page();
  p.rows[""].input.set_value("/Users/v/nope");
  await click(p, "settings-done");
  expect(state.closed).toEqual([]);
  expect(p.rows[""].error).toBe("No such folder");
  expect(text(id(p.render(), "set-folder-local"))).toContain("No such folder");
  await click(p, "settings-done");
  expect(state.closed).toEqual(["set"]);
  expect(state.store["pdk.new.default"]).toBeUndefined();
  // Typing again after a refusal makes the next refusal fresh again.
  Object.assign(state, { closed: [] });
  const q = page();
  q.rows[""].input.set_value("/Users/v/nope"); await click(q, "settings-done");
  q.rows[""].input.set_value("/Users/v/nope2"); await fire(q.rows[""].input.events.change);
  await click(q, "settings-done");
  expect(state.closed).toEqual([]);
});

test("Escape is bound in PdkSettings, the root declares it, and its action does what Done does", async () => {
  page();
  expect(bindings).toContainEqual({ keystroke: "escape", action: "pdk_settings_done", context: "PdkSettings" });
  expect(bindings.filter((b) => b.action === "pdk_settings_done")).toHaveLength(1); // once per module load
  page();
  expect(bindings.filter((b) => b.action === "pdk_settings_done")).toHaveLength(1);
  const p = page();
  const root = p.render();
  expect(last(root, "key_context")).toBe("PdkSettings");
  const action = root.ops.find((o) => o[0] === "on_action" && o[1] === "pdk_settings_done")[2];
  expect(root.ops.some((o) => o[0] === "on_key_down")).toBe(false); // bound, not caught
  p.rows[""].input.set_value("/Users/v/code");
  await fire(action);
  expect(state.store["pdk.new.default"]).toEqual({ "": "/Users/v/code" });
  expect(state.closed).toEqual(["set"]);
  // A refused path: Escape stays open once, then closes.
  Object.assign(state, { store: {}, closed: [] });
  const q = page(); q.rows[""].input.set_value("work");
  const esc = q.render().ops.find((o) => o[0] === "on_action" && o[1] === "pdk_settings_done")[2];
  await fire(esc); expect(state.closed).toEqual([]); expect(q.rows[""].error).toBe("Needs a full path");
  await fire(esc); expect(state.closed).toEqual(["set"]);
  expect(state.store["pdk.new.default"]).toBeUndefined();
});

test("callback contexts expire, spawned task contexts remain valid", async () => {
  await expect(fire(async (_e, cx) => { await Promise.resolve(); cx.notify(); })).rejects.toThrow("cx is no longer valid");
  await fire((_e, cx) => { cx.spawn(async (cx) => { await Promise.resolve(); cx.notify(); }); });
});

test("Choose click saves and fills without another call; cancel changes nothing", async () => {
  state.store["pdk.new.default"] = { "": "/Users/v/work" };
  const p = page();
  state.pick = "/Users/v/code/";
  let answer;
  state.gate = new Promise((r) => (answer = r));
  const choosing = click(p, "set-choose");
  await Promise.resolve();
  const pickedField = p.rows[""].input.value();
  answer(); await choosing;
  expect(pickedField).toBe("/Users/v/code/");
  expect(p.rows[""].input.value()).toBe("/Users/v/code");
  expect(state.store["pdk.new.default"]).toEqual({ "": "/Users/v/code" });
  state.pick = null;
  p.rows[""].input.set_value("typed but unsaved");
  const calls = state.execs.length;
  await click(p, "set-choose");
  expect(p.rows[""].input.value()).toBe("typed but unsaved");
  expect(state.store["pdk.new.default"]).toEqual({ "": "/Users/v/code" });
  expect(state.execs.length).toBe(calls);
});

test("prefilled per machine and normalized saved path remains after Enter", async () => {
  state.store["pdk.new.default"] = { "": "/Users/v/work", box: "/home/v/evals" };
  const p = page();
  expect(p.rows[""].input.value()).toBe("/Users/v/work");
  expect(p.rows.box.input.value()).toBe("/home/v/evals");
  p.rows[""].input.set_value(" ~/code/ ");
  await enter(p);
  expect(p.rows[""].input.value()).toBe("/Users/v/code");
  expect(state.store["pdk.new.default"][""]).toBe("/Users/v/code");
});

test("unchanged fields skip checks on Done and Enter even offline; Done closes", async () => {
  state.store["pdk.new.default"] = { box: "/home/v/evals" };
  state.dirs.box = []; state.homes.box = null;
  const p = page();
  p.rows.box.input.set_value(" /home/v/evals ");
  await enter(p, "box");
  await click(p, "settings-done");
  expect(state.execs).toEqual([]);
  expect(state.closed).toEqual(["set"]);
});

test("emptying a held value clears on Done or Enter, with no folder check", async () => {
  for (const submit of [(p) => click(p, "settings-done"), (p) => enter(p, "box")]) {
    state.store["pdk.new.default"] = { box: "/home/v/evals" };
    const p = page(); p.rows.box.input.set_value("  ");
    await submit(p);
    expect(state.store["pdk.new.default"]).toEqual({});
    expect(p.rows.box.input.value()).toBe("");
  }
  expect(state.execs).toEqual([]);
});


test("unreachable machine says Machine unavailable for absolute and ~ paths, saves nothing and keeps the page open", async () => {
  for (const [typed, rejecting] of [["/home/v/api", ["box:test"]], ["~/api", ["box:printenv"]], ["~/api", ["box:test"]]]) {
    state.store["pdk.new.default"] = { box: "/home/v/evals" };
    state.rejects = rejecting;
    const p = page(); p.rows.box.input.set_value(typed);
    await click(p, "settings-done");
    expect(p.rows.box.error).toBe("Machine unavailable");
    expect(state.store["pdk.new.default"]).toEqual({ box: "/home/v/evals" });
    expect(state.closed).toEqual([]);
  }
  state.rejects = [];
  expect(await checkFolder("/home/v/missing", "box")).toEqual({ error: "No such folder" });
  // Local execution failures retain their existing missing-folder wording.
  state.rejects = [":test"];
  expect(await checkFolder("/Users/v/work", "")).toEqual({ error: "No such folder" });
});

test("Clear discards typed text and Done restores nothing, including after Clear during a held check (RC07)", async () => {
  for (const held of [false, true]) {
    state.store["pdk.new.default"] = { box: "/home/v/evals" };
    state.closed = [];
    state.dirs.box.push("/home/v/api");
    const p = page(); p.rows.box.input.set_value("/home/v/api");
    let answer, saving;
    if (held) {
      state.gate = new Promise((r) => (answer = r));
      saving = enter(p, "box");
      expect(p.rows.box.busy).toBe(true);
    }
    await click(p, "set-clear-box");
    expect(state.store["pdk.new.default"]).toEqual({});
    expect(p.rows.box.input.value()).toBe("");
    if (held) { answer(); await saving; state.gate = null; }
    const calls = state.execs.length;
    await click(p, "settings-done");
    expect(state.store["pdk.new.default"]).toEqual({});
    expect(p.rows.box.input.value()).toBe("");
    expect(state.execs.length).toBe(calls);
    expect(state.closed).toEqual(["set"]);
  }
});


test("untouched page Done and Enter preserve another page's save or clear using its own baseline", async () => {
  for (const [initial, change] of [["/Users/v/work", "save"], ["/Users/v/work", "clear"], ["", "save"]]) {
    state.store["pdk.new.default"] = initial ? { "": initial } : {};
    state.closed = [];
    const a = page(), b = page();
    if (change === "save") {
      b.rows[""].input.set_value("/Users/v/code");
      await enter(b);
    } else await click(b, "set-clear-local");
    const expected = change === "save" ? { "": "/Users/v/code" } : {};
    const calls = state.execs.length;
    await enter(a);
    expect(state.store["pdk.new.default"]).toEqual(expected);
    await click(a, "settings-done");
    expect(state.store["pdk.new.default"]).toEqual(expected);
    expect(state.closed).toEqual(["set"]);
    expect(state.execs.length).toBe(calls);
    expect(a.rows[""].input.value()).toBe(initial);
  }
});


test("Choose during a held Enter check supersedes it and saves the picked folder", async () => {
  const p = page();
  p.rows[""].input.set_value("/Users/v/work");
  let answer;
  state.gate = new Promise((r) => (answer = r));
  const typing = enter(p);
  expect(p.rows[""].busy).toBe(true);
  state.pick = "/Users/v/code";
  const choosing = click(p, "set-choose");
  await Promise.resolve();
  expect(p.rows[""].input.value()).toBe("/Users/v/code");
  expect(state.execs.filter((c) => c.cmd === "test").map((c) => c.args[1])).toEqual(["/Users/v/work", "/Users/v/code"]);
  answer();
  await Promise.all([typing, choosing]);
  expect(state.execs.filter((c) => c.cmd === "test").map((c) => c.args[1])).toEqual(["/Users/v/work", "/Users/v/code"]);
  expect(state.store["pdk.new.default"]).toEqual({ "": "/Users/v/code" });
  expect(p.rows[""].input.value()).toBe("/Users/v/code");
});


const holdCheck = (folder) => {
  let answer;
  state.checkGates[folder] = new Promise((resolve) => { answer = (exists = true) => resolve({ code: exists ? 0 : 1, stdout: "" }); });
  return answer;
};

test("picked check supersedes typed check in either completion order; old answer never changes the pick", async () => {
  for (const pickedFirst of [false, true]) {
    state.store = {}; state.execs = [];
    const typedAnswer = holdCheck("/Users/v/work"), pickedAnswer = holdCheck("/Users/v/code");
    const p = page(); p.rows[""].input.set_value("/Users/v/work");
    const typing = enter(p);
    state.pick = "/Users/v/code";
    const choosing = click(p, "set-choose");
    await Promise.resolve();
    expect(state.execs.filter((c) => c.cmd === "test").map((c) => c.args[1])).toEqual(["/Users/v/work", "/Users/v/code"]);
    if (pickedFirst) { pickedAnswer(); await choosing; }
    else { typedAnswer(); await typing; }
    expect(p.rows[""].input.value()).toBe("/Users/v/code");
    if (pickedFirst) { typedAnswer(); await typing; }
    else { pickedAnswer(); await choosing; }
    expect(state.store["pdk.new.default"]).toEqual({ "": "/Users/v/code" });
    expect(p.rows[""].input.value()).toBe("/Users/v/code");
    expect(p.rows[""].busy).toBe(false);
  }
});

test("Clear while the picked check is held defeats both checks and keeps the field empty", async () => {
  state.store["pdk.new.default"] = { "": "/Users/v/code" };
  const typedAnswer = holdCheck("/Users/v/work"), pickedAnswer = holdCheck("/Users/v/picked");
  const p = page(); p.rows[""].input.set_value("/Users/v/work");
  const typing = enter(p);
  state.pick = "/Users/v/picked";
  const choosing = click(p, "set-choose");
  await Promise.resolve();
  expect(state.execs.filter((c) => c.cmd === "test").map((c) => c.args[1])).toEqual(["/Users/v/work", "/Users/v/picked"]);
  await click(p, "set-clear-local");
  expect(state.store["pdk.new.default"]).toEqual({});
  expect(p.rows[""].input.value()).toBe("");
  typedAnswer(); pickedAnswer();
  await Promise.all([typing, choosing]);
  expect(state.store["pdk.new.default"]).toEqual({});
  expect(p.rows[""].input.value()).toBe("");
  expect(p.rows[""].busy).toBe(false);
});

test("Done waits for a replacement picked check: no stays open with error, yes saves and closes", async () => {
  for (const exists of [false, true]) {
    state.store = {}; state.closed = [];
    const typedAnswer = holdCheck("/Users/v/work"), pickedAnswer = holdCheck("/Users/v/code");
    const p = page(); p.rows[""].input.set_value("/Users/v/work");
    const typing = enter(p);
    let flushed = false;
    const flush = p.flush.bind(p);
    p.flush = async (cx) => { const result = await flush(cx); flushed = true; return result; };
    const saving = click(p, "settings-done");
    state.pick = "/Users/v/code";
    const choosing = click(p, "set-choose");
    await Promise.resolve();
    typedAnswer(); await typing;
    // Yield an event-loop turn so a prematurely resolved flush/close would be observable.
    await new Promise(setImmediate);
    expect(flushed).toBe(false);
    expect(state.closed).toEqual([]);
    expect(p.rows[""].busy).toBe(true);
    pickedAnswer(exists);
    await Promise.all([saving, choosing]);
    expect(flushed).toBe(true);
    expect(p.rows[""].busy).toBe(false);
    expect(state.closed).toEqual(exists ? ["set"] : []);
    expect(p.rows[""].error).toBe(exists ? "" : "No such folder");
    expect(state.store["pdk.new.default"]).toEqual(exists ? { "": "/Users/v/code" } : undefined);
    expect(p.rows[""].input.value()).toBe("/Users/v/code");
  }
});
