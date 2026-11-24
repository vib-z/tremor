import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The shared working pair's contract (owner, 12 Nov): one spinner and one live status word for Chat, Factory and
// every other surface, still under Reduce Motion. build-status extends this file with the drawn behaviour.
const UI = readFileSync(join(new URL("..", import.meta.url).pathname, "shared/ui.js"), "utf8");
const body = (name) => UI.slice(UI.indexOf(`export function ${name}(`), UI.indexOf("\n}\n", UI.indexOf(`export function ${name}(`)));

test("the contract: spinner and workingText keep their signatures and both ask about Reduce Motion", () => {
  expect(UI).toContain("export function spinner(t, size = ICON.sm, { color = t.foreground } = {})");
  expect(UI).toContain("export function workingText(t, id, text, { size = TYPE.sm } = {})");
  expect(UI).toMatch(/export const MOTION = \{ spin: \d+, step: \d+ \};/);
  for (const name of ["spinner", "workingText"]) expect(body(name), name).toContain("reduceMotion()");
  expect(body("workingText")).toContain('.role("status")');
  expect(body("workingText")).toContain(".accessibility_label(");
});

// ---- The drawn behaviour, against the real ui.js --------------------------------------------------------------
// ui.js runs inside the app; here a copy of it imports recording stand-ins for gpui-kit, gpui-base and herdr (as
// icons.test.js does). One fixed folder, rewritten each run.
import { mkdirSync, cpSync, writeFileSync, readdirSync } from "node:fs";
const ROOT = new URL("..", import.meta.url).pathname;
const LIB = "/tmp/pdk-status-motion-lib";
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
export const Button = { new: (id) => make("Button", []).id(id) }, Toggle = { new: (id) => make("Toggle", []).id(id) }, Popover = { new: (id) => make("Popover", []).id(id) };
export const Progress = { new: (id) => make("Progress", []).id(id) }, ProgressTrack = { new: () => make("ProgressTrack", []) }, ProgressIndicator = { new: () => make("ProgressIndicator", []) };
`);
writeFileSync(join(LIB, "stub-herdr.js"), `
export const state = { shared: {} };
export const shared = (k) => state.shared[k];
export const setShared = (k, v) => { state.shared[k] = v; };
export const home = () => "/h";
export const fonts = () => [];
export const window = () => ({ platform: "macos" });
export const theme = () => ({});
export const keys = () => [];
`);
writeFileSync(join(LIB, "ui.js"), UI.replace('from "gpui-kit"', 'from "./stub-gpui.js"').replace('from "gpui-base"', 'from "./stub-gpui.js"').replace('from "herdr"', 'from "./stub-herdr.js"'));
const ui = await import(join(LIB, "ui.js"));
const { state } = await import(join(LIB, "stub-herdr.js"));
const op = (el, name) => el.ops.filter((o) => o[0] === name).at(-1)?.slice(1);
const kids = (el) => el.ops.filter((o) => o[0] === "child").map((o) => o[1]).concat(op(el, "children")?.[0] ?? []);
const t = { foreground: "#fafafa", muted: "#a1a1a1", dim: "#737373" };
const motion = (on) => { state.shared = { "pdk.reduceMotion": !on }; };
const MOVES = ["spin", "frames", "loop", "transition"];
const moving = (el) => (typeof el !== "object" || !el ? [] : [...el.ops.filter((o) => MOVES.includes(o[0])).map((o) => o[0]), ...kids(el).flatMap(moving)]);

test("spinner: the ring turning once every MOTION.spin, the dense drawing at 7 px, in foreground unless told", () => {
  motion(true);
  const s = ui.spinner(t);
  expect([s.args[0], op(s, "size")[0], op(s, "text_color")[0], op(s, "spin")[0]]).toEqual(["pdk/icons/working.svg", ui.ICON.sm, t.foreground, ui.MOTION.spin]);
  expect(ui.spinner(t, ui.ICON.dot).args[0]).toBe("pdk/icons/working-dense.svg");
  expect(op(ui.spinner(t, ui.ICON.sm, { color: t.muted }), "text_color")[0]).toBe(t.muted);
  for (const name of ["working", "working-dense", "working-still"]) expect(ui.ICONS).toContain(name);
  // The glyph: a quarter-strength track and a round-capped arc in the same ink.
  for (const f of ["working.svg", "working-dense.svg"]) {
    const g = readFileSync(join(ROOT, "icons", f), "utf8");
    expect(g).toMatch(/<circle[^>]*stroke-opacity="0\.25"/);
    expect(g).toContain('stroke-linecap="round"');
    expect(g).toContain("currentColor");
  }
});

test("spinner under Reduce Motion: three still dots, no motion call", () => {
  motion(false);
  for (const size of [ui.ICON.dot, ui.ICON.sm, ui.ICON.base]) {
    const s = ui.spinner(t, size);
    expect(s.args[0]).toBe("pdk/icons/working-still.svg");
    expect(moving(s)).toEqual([]);
  }
  expect((readFileSync(join(ROOT, "icons/working-still.svg"), "utf8").match(/<circle/g) ?? []).length).toBe(3);
});

test("workingText: one cell per letter, muted base, two foreground overlays on frames of equal length", () => {
  motion(true);
  const w = ui.workingText(t, "w", "Working");
  expect([op(w, "id")[0], op(w, "role")[0], op(w, "accessibility_label")[0], op(w, "text_color")[0], op(w, "text_size")[0]])
    .toEqual(["w", "status", "Working", t.muted, ui.TYPE.sm]);
  const cells = kids(w);
  expect(cells.length).toBe(7);
  const lists = [];
  cells.forEach((c, i) => {
    const [base, peak, half] = kids(c);
    expect(base).toBe("Working"[i]);
    for (const o of [peak, half]) {
      expect(op(o, "text_color")[0]).toBe(t.foreground);
      expect(op(o, "absolute")).toEqual([]);
      expect(op(o, "frames")[1]).toBe(ui.MOTION.step);
      lists.push(op(o, "frames")[0]);
    }
    expect(op(half, "opacity")[0]).toBe(0.5);
    expect(op(peak, "opacity")).toBeUndefined();
  });
  expect(new Set(lists.map((l) => l.length)).size).toBe(1); // one length: the shared clock keeps them in step
  expect(lists[0].length).toBeGreaterThan(cells.length + 2); // a rest after the sweep
  // No gradient, no loop, no timer: only frames.
  expect([...new Set(moving(w))]).toEqual(["frames"]);
  expect(ui.workingText(t, "x", "Go", { size: ui.TYPE.base }).ops.find((o) => o[0] === "text_size")[1]).toBe(ui.TYPE.base);
});

test("workingText: the peak visits each letter once, left to right, with half-strength copies one letter either side", () => {
  motion(true);
  const word = "Working";
  const cells = kids(ui.workingText(t, "w", word));
  const peak = cells.map((c) => op(kids(c)[1], "frames")[0]);
  const half = cells.map((c) => op(kids(c)[2], "frames")[0]);
  const where = peak[0].map((_, f) => peak.map((l, i) => (l[f] ? i : -1)).filter((i) => i >= 0));
  for (const lit of where) expect(lit.length).toBeLessThanOrEqual(1); // one peak at a time
  const path = where.flat();
  expect(path).toEqual([...word].map((_, i) => i)); // each letter once, in order
  peak.forEach((l, i) => l.forEach((ch, f) => { if (ch) expect(ch).toBe(word[i]); }));
  for (let f = 0; f < peak[0].length; f++) {
    const p = where[f][0];
    half.forEach((l, i) => expect(Boolean(l[f]), `frame ${f} letter ${i}`).toBe(p !== undefined && Math.abs(p - i) === 1
      || p === undefined && (f === 0 && i === 0 || f === word.length + 1 && i === word.length - 1)));
  }
});

test("workingText under Reduce Motion: the plain word in foreground, nothing moving, the same name", () => {
  motion(false);
  const w = ui.workingText(t, "w", "Working");
  expect(kids(w)).toEqual(["Working"]);
  expect([op(w, "text_color")[0], op(w, "role")[0], op(w, "accessibility_label")[0]]).toEqual([t.foreground, "status", "Working"]);
  expect(moving(w)).toEqual([]);
});

test('statusMarker("working") draws the spinner: 7 px in the dense box, ICON.sm otherwise; label and tooltip stay', () => {
  motion(true);
  const dense = ui.statusMarker(t, "working", "d", { size: ui.ICON.dot });
  expect([kids(dense)[0].args[0], op(kids(dense)[0], "size")[0]]).toEqual(["pdk/icons/working-dense.svg", ui.ICON.dot]);
  const box = ui.statusMarker(t, "working", "b");
  expect([kids(box)[0].args[0], op(kids(box)[0], "size")[0], op(kids(box)[0], "spin")[0]]).toEqual(["pdk/icons/working.svg", ui.ICON.sm, ui.MOTION.spin]);
  expect(op(box, "tooltip")[0]).toMatch(/working/i);
  expect(op(box, "accessibility_label")[0]).toMatch(/working/i);
  expect(op(box, "role")[0]).toBe("image");
  motion(false);
  expect(moving(ui.statusMarker(t, "working", "b"))).toEqual([]);
  expect(UI).not.toMatch(/export function arc\(/);
});

// ---- Chat on the pair (plan.md "Chat") -------------------------------------------------------------------------
const CHAT = readFileSync(join(ROOT, "mods/pdk-chat/main.js"), "utf8");
const TOOLS = readFileSync(join(ROOT, "mods/pdk-chat/tools.js"), "utf8");
const method = (src, name) => src.slice(src.indexOf(`\n  ${name}(`), src.indexOf("\n  }\n", src.indexOf(`\n  ${name}(`)));

test("Chat's status line: spinner, live word, then the title, at the left, one status with its name", () => {
  const row = method(CHAT, "observedRow");
  const working = row.slice(row.indexOf('raw === "working"'), row.indexOf('raw === "blocked"'));
  const at = (s) => working.indexOf(s);
  expect(at("spinner(t, iconFor(TYPE.base))")).toBeGreaterThan(0);
  expect(at('workingText(t, "chat-working-word", "Working", { size: TYPE.base })')).toBeGreaterThan(at("spinner("));
  expect(at("`· ${r.title}`")).toBeGreaterThan(at("workingText("));
  expect(working).toContain('.role("status").accessibility_label(r.title ? `Working: ${r.title}` : "Working")');
  expect(working).toContain(".gap(SPACE[2])");
  expect(working).toContain(".h(ROW.base)");
  expect(working).not.toContain("statusMarker"); // no second mark at the row's far end
});

test("one shimmer in Chat: no spinner on the work-group head; a tool's Running is a muted spinner and a plain word", () => {
  expect(method(CHAT, "workGroup")).not.toMatch(/spinner\(|workingText\(/);
  expect(TOOLS).toContain('.child(spinner(t, ICON.sm, { color: t.muted })).child("Running")');
  expect(TOOLS).not.toContain("workingText");
  expect((CHAT.match(/workingText\(/g) ?? []).length).toBe(1);
});

test("Chat's error lines say what to do next", () => {
  expect(CHAT).toContain("The agent reported an error. Open Terminal above to see it and reply.");
  expect(readFileSync(new URL("../adapters/appear.js", import.meta.url), "utf8")).toContain("Try again, or open Terminal above to follow the agent there.");
});

test("targets: 24 px at least on desktop, ROW.touch under NARROW px of view width (owner, 12 Nov)", () => {
  const hit = (width) => (width < ui.NARROW ? ui.ROW.touch : null);
  expect(CHAT).toContain("return this.width < NARROW ? ROW.touch : desktop;");
  expect([hit(390), hit(767), hit(768), hit(1440)]).toEqual([44, 44, null, null]);
  // Every pressable the note names asks hit(); none is under 24.
  for (const s of ["hit: this.hit(ROW.compact) }", "{ h: this.hit(ROW.compact), size: TYPE.lg, pressed", "{ h: this.hit(ROW.base), size: TYPE.lg, disabled",
    '.id("model-chip").h(this.hit(ROW.base))', "turn === term.turn, h: this.hit(ROW.base) }", '{ variant: "send", disabled: !can, h: this.hit(ROW.base) }',
    "{ h: this.hit(ROW.compact), size: TYPE.base }", ".id(`wg-${g.key}`).h(this.hit(ROW.compact))", "hit: this.hit(ROW.compact),"]) expect(CHAT).toContain(s);
  expect(CHAT).not.toMatch(/\{ h: 20\b/);
  expect(TOOLS).toContain(".w_full().h(hit)");
  expect(TOOLS).toContain(".w_full().h(ctx.hit ?? ROW.compact)");
  // The shared parts take the size: a segment and an action button at 44, their words unchanged.
  const seg = ui.segmentedChoice(t, "s", [{ value: "a", label: "A" }], "a", () => {}, { hit: ui.ROW.touch });
  const toggle = kids(kids(seg)[0])[0];
  expect(op(toggle, "h")[0]).toBe(ui.ROW.touch);
  expect(op(kids(kids(ui.segmentedChoice(t, "s", [{ value: "a", label: "A" }], "a", () => {}))[0])[0], "h")[0]).toBe(ui.ROW.compact);
  const send = ui.actionButton(t, "send", "↑", "Send", () => {}, { variant: "send", h: ui.ROW.touch });
  expect([op(send, "h")[0], op(send, "w")[0], op(send, "rounded")[0], op(send, "text_size")[0]]).toEqual([44, 44, 22, ui.TYPE.lg]);
  expect(op(ui.actionButton(t, "stop", "Stop", "Stop", () => {}), "h")[0]).toBe(ui.ROW.base);
});

test("Chat takes its width from the layout on the first render after a resize, as Factory does", async () => {
  const { blockSize } = await import("../adapters/factory.js");
  const cut = (name) => CHAT.slice(CHAT.indexOf(`\n  ${name}(`) + 1, CHAT.indexOf("\n  }\n", CHAT.indexOf(`\n  ${name}(`)) + 4);
  const chrome = JSON.parse(readFileSync(join(ROOT, "layouts/tremor.json"), "utf8"));
  chrome.children[1].children.find((n) => n.id === "work-body").active = "chat";
  let viewport = { width: 1440, height: 900 }, zoom = 1;
  const env = { blockSize, layout: () => chrome, settings: () => ({ zoom }), NARROW: ui.NARROW, ROW: ui.ROW, SPACE: ui.SPACE, COLUMN: 760 };
  globalThis.window = { viewport_size: () => viewport };
  try {
    const methods = new Function(...Object.keys(env), `return ({ ${["fit", "hit", "column", "inset"].map(cut).join(",")} });`)(...Object.values(env));
    const chat = Object.assign(Object.create(methods), { width: 1440, height: 900 }); // the last measured box: a wide window
    const side = chrome.children[0].size.px + 1;
    viewport = { width: 670, height: 844 }; // the window shrank; no size callback has run yet
    chat.fit();
    expect(chat.width).toBe(670 - side); // 389: the view's own width, this render
    expect([chat.hit(ui.ROW.base), chat.hit(ui.ROW.compact)]).toEqual([ui.ROW.touch, ui.ROW.touch]);
    expect(chat.column()).toBe(670 - side - 2 * ui.SPACE[4]);
    viewport = { width: 1440, height: 900 }; chat.fit();
    expect(chat.hit(ui.ROW.base)).toBe(ui.ROW.base);
    expect(chat.column()).toBe(760);
    zoom = 2; chat.fit(); // styles are in unzoomed units: a 1440 window at 2x is a 720 one
    expect(chat.width).toBe(720 - side);
    expect(chat.hit(ui.ROW.base)).toBe(ui.ROW.touch);
    // No chat block in the layout: the measured box stays.
    const bare = Object.assign(Object.create(new Function("blockSize", "layout", "settings", `return ({ ${cut("fit")} });`)(blockSize, () => null, () => ({}))), { width: 500 });
    bare.fit();
    expect([bare.width, bare.laid]).toEqual([500, false]);
  } finally { delete globalThis.window; }
  expect(CHAT).toContain("  render(cx) {\n    this.fit();");
  expect(CHAT).toContain("on_size_change((size, cx) => { if (!this.laid && ");
});
