import { test, expect } from "bun:test";
import { mkdirSync, cpSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { appearance } from "../adapters/appear.js";
import { contrast } from "../adapters/tokens.js";

// The drawn states (mods/pdk-chat/states.js) against the real ui.js: a copy of both imports recording stand-ins for
// gpui-kit, gpui-base and herdr (as status-motion.test.js does). One fixed folder, rewritten each run.
const ROOT = new URL("..", import.meta.url).pathname;
const LIB = "/tmp/pdk-states-lib";
mkdirSync(LIB, { recursive: true });
for (const dir of ["adapters", "shared"]) for (const f of readdirSync(join(ROOT, dir))) if (f.endsWith(".js")) cpSync(join(ROOT, dir, f), join(LIB, f));
writeFileSync(join(LIB, "stub-gpui.js"), `
const make = (kind, args) => {
  const el = { kind, args, ops: [] };
  const p = new Proxy(el, { get(o, k) {
    if (k in o || typeof k === "symbol" || k === "then") return o[k];
    return (...a) => { if (k === "when") { if (a[0]) a[1](p); return p; } o.ops.push([k, ...a]); return p; };
  } });
  return p;
};
export const div = () => make("div", []);
export const svg = (path) => make("svg", [path]);
export const h_flex = () => make("h_flex", []);
export const v_flex = () => make("v_flex", []);
export const Button = {}, Toggle = {}, Popover = {}, Progress = {}, ProgressTrack = {}, ProgressIndicator = {};
`);
writeFileSync(join(LIB, "stub-herdr.js"), `
export const state = { shared: {} };
export const shared = (k) => state.shared[k];
export const setShared = (k, v) => { state.shared[k] = v; };
export const home = () => "/h"; export const fonts = () => []; export const window = () => ({ platform: "macos" });
export const theme = () => ({}); export const keys = () => [];
`);
const stub = (src) => src.replace('from "gpui-kit"', 'from "./stub-gpui.js"').replace('from "gpui-base"', 'from "./stub-gpui.js"').replace('from "herdr"', 'from "./stub-herdr.js"');
writeFileSync(join(LIB, "ui.js"), stub(readFileSync(join(ROOT, "shared/ui.js"), "utf8")));
writeFileSync(join(LIB, "states.js"), stub(readFileSync(join(ROOT, "mods/pdk-chat/states.js"), "utf8")).replace('from "./lib/ui.js"', 'from "./ui.js"'));
const ui = await import(join(LIB, "ui.js"));
const { statePage, stateBlock, TEXT_MAX, ACTIONS } = await import(join(LIB, "states.js"));
const { state } = await import(join(LIB, "stub-herdr.js"));

const THEMES = readdirSync(join(ROOT, "themes")).filter((f) => f.endsWith(".json"));
const colors = (f) => JSON.parse(readFileSync(join(ROOT, "themes", f), "utf8")).colors;
const t = colors("pdk-t3-dark.json");
const op = (el, name) => el.ops.filter((o) => o[0] === name).at(-1)?.slice(1);
const kids = (el) => el.ops.filter((o) => o[0] === "child").map((o) => o[1]).concat(op(el, "children")?.[0] ?? []);
const nodes = (el) => (typeof el !== "object" || !el ? [] : [el, ...kids(el).flatMap(nodes)]);
const text = (el) => nodes(el).flatMap(kids).filter((k) => typeof k === "string");
const motion = (on) => { state.shared = { "pdk.reduceMotion": !on }; };
const MOVES = ["spin", "frames", "loop", "transition"];

// Every block and page appearance can answer, from its own facts.
const base = { address: "t1", agent: true, kindName: "Claude Code", supported: true, note: null, program: "zsh", state: "live", reason: "the helper refused", rows: 0, pending: 0, stale: false, since: 0, now: 10000, machine: null };
const BLOCKS = [];
for (const state of ["finding", "unbound", "waiting", "live", "offline", "error"]) for (const rows of [0, 2]) for (const machine of [null, "rohan"]) for (const stale of [false, true]) {
  const b = appearance({ ...base, state, rows, machine, stale }).block;
  if (b && !BLOCKS.some((x) => JSON.stringify(x) === JSON.stringify(b))) BLOCKS.push(b);
}
const PAGES = [{ address: null }, { agent: false }, { supported: false, kindName: "Hermes" }].map((f) => appearance({ ...base, ...f }).page);
const pressed = [];
const ctx = (width) => ({ act: (action) => pressed.push(action), hit: (desktop) => (width < ui.NARROW ? ui.ROW.touch : desktop) });
const draw = (width = 1440) => [...BLOCKS.map((b) => stateBlock(t, b, ctx(width))), ...PAGES.map((p) => statePage(t, p, ctx(width)))];
const isButton = (n) => op(n, "role")?.[0] === "button";
// What states.js itself draws: everything but the inside of the pack's action button.
const own = (el) => (typeof el !== "object" || !el || isButton(el) ? [] : [el, ...kids(el).flatMap(own)]);

test("each block has a role and a name by tone: loading and info a status, a failure an alert", () => {
  expect(new Set(BLOCKS.map((b) => b.tone))).toEqual(new Set(["loading", "info", "error"]));
  for (const b of BLOCKS) {
    const el = stateBlock(t, b, ctx(1440));
    expect(op(el, "role")[0], b.id).toBe(b.tone === "error" ? "alert" : "status");
    const name = op(el, "accessibility_label")[0];
    expect(name.startsWith(b.line.replace(/…$/, ""))).toBe(true);
    expect(name).not.toContain("…");
    if (b.detail) expect(name).toContain(b.detail);
  }
  const loading = stateBlock(t, appearance({ ...base, state: "finding", since: null }).block, ctx(1440));
  expect(op(loading, "accessibility_label")[0]).toBe("Loading conversation");
  const failed = stateBlock(t, appearance({ ...base, state: "error" }).block, ctx(1440));
  expect(op(failed, "accessibility_label")[0]).toMatch(/^Couldn't read the conversation: .*the helper refused/);
});

test("the mark: the shared spinner while loading, the blocked dot on a failure, none for a plain fact", () => {
  motion(true);
  for (const b of BLOCKS) {
    const svgs = nodes(stateBlock(t, b, ctx(1440))).filter((n) => n.kind === "svg");
    const dots = nodes(stateBlock(t, b, ctx(1440))).filter((n) => op(n, "bg")?.[0] === t.blocked);
    expect([svgs.length, dots.length], b.id).toEqual(b.tone === "loading" ? [1, 0] : b.tone === "error" ? [0, 1] : [0, 0]);
    if (b.tone === "loading") expect(svgs[0].args[0]).toBe("pdk/icons/working.svg");
  }
});

test("under Reduce Motion nothing in a state moves; with it off only the spinner turns", () => {
  motion(false);
  for (const el of draw()) expect(nodes(el).flatMap((n) => n.ops.filter((o) => MOVES.includes(o[0])))).toEqual([]);
  for (const b of BLOCKS.filter((x) => x.tone === "loading")) expect(nodes(stateBlock(t, b, ctx(1440))).find((n) => n.kind === "svg").args[0]).toBe("pdk/icons/working-still.svg");
  motion(true);
  const moved = draw().flatMap((el) => nodes(el).flatMap((n) => n.ops.filter((o) => MOVES.includes(o[0])).map((o) => o[0])));
  expect(new Set(moved)).toEqual(new Set(["spin"]));
});

test("every size is a token of this job's scales, every ink a token", () => {
  const TYPES = new Set([11, 12, 13, 16]), SPACES = new Set([4, 8, 12, 16, 24, 32]);
  const INKS = new Set(["foreground", "muted", "dim", "border", "canvas", "blocked"].map((k) => t[k]));
  for (const el of draw(390).concat(draw(1440))) for (const n of own(el)) for (const [name, v] of n.ops) {
    if (name === "text_size") expect(TYPES.has(v), `type ${v}`).toBe(true);
    if (["gap", "px", "pt", "p", "py"].includes(name)) expect(SPACES.has(v), `${name} ${v}`).toBe(true);
    if (name === "line_height") expect(["16px", "20px"]).toContain(v);
    if (name === "max_w") expect(v).toBe(TEXT_MAX);
    if (["h", "w", "size"].includes(name)) expect([ui.ICON.base, ui.ICON.dot, ui.SPACE[5]], `${name} ${v}`).toContain(v);
    if (["text_color", "bg"].includes(name)) expect(INKS.has(v), `${name} ${v}`).toBe(true);
    expect(["font_weight", "font_bold", "font_semibold"]).not.toContain(name); // 400, and 500 by font_medium only
  }
});

test("long words wrap: every text box can shrink and none is one truncated line", () => {
  for (const el of draw(390)) for (const n of own(el)) {
    expect(n.ops.some((o) => ["truncate", "whitespace_nowrap", "overflow_x_scroll"].includes(o[0]))).toBe(false);
    if (kids(n).some((k) => typeof k === "string")) expect(op(n, "w_full")).toEqual([]);
  }
});

test("the action: one button with the plan's words, a Tab stop that Enter and Space press, 44 high under 768 and 28 over", () => {
  for (const [width, h] of [[390, ui.ROW.touch], [767, ui.ROW.touch], [768, ui.ROW.base], [1440, ui.ROW.base]]) {
    for (const el of draw(width)) {
      const buttons = nodes(el).filter(isButton);
      for (const b of buttons) {
        expect(op(b, "h")[0]).toBe(h);
        expect(op(b, "tab_index")[0]).toBe(0);
        expect(Object.values(ACTIONS)).toContain(op(b, "accessibility_label")[0]);
        const key = op(b, "on_key_down")[0];
        for (const k of ["enter", "space"]) { pressed.length = 0; key({ key: k }, { stop_propagation() {} }); expect(pressed.length).toBe(1); }
        pressed.length = 0; key({ key: "a" }, { stop_propagation() {} }); expect(pressed).toEqual([]);
      }
      expect(buttons.length).toBeLessThanOrEqual(1);
    }
  }
  expect(new Set(BLOCKS.filter((b) => b.action === "retry").map((b) => b.id))).toEqual(new Set(["error", "offline"]));
  for (const b of BLOCKS) {
    pressed.length = 0;
    const btn = nodes(stateBlock(t, b, ctx(1440))).find(isButton);
    if (!b.action) { expect(btn).toBeUndefined(); continue; }
    op(btn, "on_click")[0]({}, { stop_propagation() {} });
    expect(pressed).toEqual([b.action]);
  }
});

test("contrast in every pack theme: each word's ink 4.5:1 on canvas (the button's on its ground), the failure dot 3:1", () => {
  const inks = new Set(draw().flatMap((el) => own(el).map((n) => op(n, "text_color")?.[0]).filter(Boolean)));
  expect(inks).toEqual(new Set([t.foreground, t.muted]));
  const keys = ["foreground", "muted"];
  for (const f of THEMES) {
    const c = colors(f);
    for (const k of keys) expect(contrast(c[k], c.canvas), `${f} ${k}`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.foreground, c.surface), `${f} button`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.blocked, c.canvas), `${f} blocked`).toBeGreaterThanOrEqual(3);
  }
});

test("words: plain, no dashes as punctuation, nothing about internals", () => {
  for (const el of draw()) for (const w of text(el)) {
    expect(w).not.toMatch(/ [---] |evidence|records|registry|undefined|null/);
  }
});
