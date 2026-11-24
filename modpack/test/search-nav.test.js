// Moving through the Cmd+K palette (mods/pdk-search) from the keyboard and the pointer. Real keys can't be sent here
// (the screen is locked), so this drives what a key reaches: the bindings the palette installs under its field, the
// actions on its root, the field's own events and the list's key handler.
import { test, expect } from "bun:test";
import { harness, world, evaluate } from "./parity-harness.js";
import * as search from "../adapters/search.js";
import * as cmds from "../adapters/search-commands.js";

const FIELD_KEYS = ["up", "down", "pageup", "pagedown", "tab", "shift-tab", "ctrl-d", "alt-enter", "escape"];

// `before(h)` runs before the palette opens (to watch its timer or its field).
function open(before = () => {}) {
  const h = harness(world(6), { overlay: "o1" });
  Object.assign(h.env, search, cmds, { commands: () => [], layouts: () => [], keys: () => [] });
  const catalogue = ["tab.new", "space.rename", "pane.split"].map((name) => ({ name, args: [], about: name }));
  h.env.commands = () => catalogue;
  before(h);
  const v = new (evaluate("mods/pdk-search/main.js", h.env, "Search"))();
  v.init({}, h.cx);
  const draw = () => { h.elements.length = 0; v.render(h.cx); return h.byId("pdk-search"); };
  const picks = () => v.list().filter((r) => r.command).map((r) => r.key);
  const at = () => v.selected()?.key;
  // A key pressed in the field: its binding's action, dispatched to the root.
  const field = (key) => draw().props[`on_action:pdk_search_${key.replace("-", "_")}`]({}, h.cx);
  // A key pressed while the list has the keyboard.
  const list = (keystroke) => draw().props.on_key_down({ keystroke, key: keystroke }, h.cx);
  const type = (text) => { v.input.set_value(text); v.input.events.change(null, h.cx); };
  return { h, v, draw, picks, at, field, list, type };
}

test("keys the field eats are bound under it, and the root answers each one", () => {
  const { h, draw } = open();
  expect(h.bindings).toEqual([...FIELD_KEYS.map((keystroke) => ({ keystroke, action: `pdk_search_${keystroke.replace("-", "_")}`, context: "PdkSearch > Input" })),
    { keystroke: "escape", action: "pdk_search_escape", context: "PdkSearch" }]);
  const root = draw();
  expect(root.props.key_context).toBe("PdkSearch");
  for (const k of FIELD_KEYS) expect(typeof root.props[`on_action:pdk_search_${k.replace("-", "_")}`]).toBe("function");
});

test("↑ / ↓ while typing move through every row and wrap at both ends", () => {
  const { picks, at, field } = open();
  const all = picks();
  expect(all.length).toBeGreaterThan(3);
  expect(at()).toBe(all[0]); // the first match is ready at once
  field("down"); expect(at()).toBe(all[1]);
  field("up"); field("up"); expect(at()).toBe(all.at(-1));
  field("down"); expect(at()).toBe(all[0]);
  // The same from the list.
  const { picks: p2, at: at2, list } = open();
  list("down"); expect(at2()).toBe(p2()[1]);
});

test("Enter in the field or on the list runs the selected row; Esc closes", () => {
  let o = open();
  o.field("down");
  const row = o.v.selected();
  o.v.input.events.submit(null, o.h.cx);
  expect(o.h.calls).toContainEqual(["closeOverlay", "o1"]);
  expect(o.h.calls).toContainEqual([row.command.name, row.command.args]);
  o = open();
  o.v.handle.focus(); // the list has the keyboard
  o.list("enter");
  expect(o.h.calls).toContainEqual(["closeOverlay", "o1"]);
  o = open();
  o.list("escape");
  expect(o.h.calls).toEqual([["closeOverlay", "o1"]]);
});

test("filtering keeps a valid selection: the first match, and nothing when nothing matches", () => {
  const { v, at, type, field } = open();
  field("down"); field("down");
  type("Task 3");
  expect(v.list().filter((r) => r.command)[0].key).toBe(at());
  expect(v.selected().hay).toContain("task 3");
  type("zz-nothing");
  expect(at()).toBeUndefined();
  field("down");
  expect(at()).toBeUndefined();
});

test("the selected row draws the accent edge without the list having the keyboard; pointer movement selects", () => {
  const { h, v, draw, picks } = open();
  const accent = h.env.theme().accent;
  draw();
  const [first, second] = picks();
  expect(v.handle.is_focused()).toBe(false);
  expect(h.byId(`ps-${first}`).props.border_color).toBe(accent);
  expect(h.byId(`ps-${second}`).props.border_color).not.toBe(accent);
  expect(h.byId(`ps-${first}`).props.aria_selected).toBe(true);
  h.byId(`ps-${second}`).props.on_mouse_move({}, h.cx);
  draw();
  expect(h.byId(`ps-${second}`).props.border_color).toBe(accent);
  expect(h.byId(`ps-${first}`).props.border_color).not.toBe(accent);
});

test("Page Down / Up jump between groups, and to the ends past the last and first", () => {
  const { v, at, field, list } = open();
  const rows = v.list();
  // The first pickable row after each heading.
  const starts = rows.filter((r, i) => r.command && (i === 0 || rows[i - 1].head)).map((r) => r.key);
  const picks = rows.filter((r) => r.command).map((r) => r.key);
  expect(starts.length).toBeGreaterThan(1);
  for (const s of starts.slice(1)) { field("pagedown"); expect(at()).toBe(s); }
  field("pagedown"); expect(at()).toBe(picks.at(-1));
  list("pageup"); expect(at()).toBe(starts.at(-1));
  for (const s of starts.slice(0, -1).reverse()) { field("pageup"); expect(at()).toBe(s); }
  field("pageup"); expect(at()).toBe(picks[0]);
  // A list without headings is one group.
  const choice = new search.SearchSelection(), flat = ["a", "b", "c"].map((key) => ({ key, command: {} }));
  choice.jump(flat, 1); expect(choice.key).toBe("c");
  choice.jump(flat, -1); expect(choice.key).toBe("a");
});

test("the field is the mode: a leading > is Commands; Tab, Shift-Tab, the segment and Backspace switch and keep the words", () => {
  const { h, v, draw, at, field, type } = open();
  let focused = 0; v.input.focus = () => focused++;
  type(">"); expect(v.mode).toBe("commands");
  expect(v.list().some((r) => r.kind === "command")).toBe(true);
  type(""); expect(v.mode).toBe("places"); // Backspace took the ">" away: Places, and its full list
  expect(v.list().some((r) => r.kind === "workspace")).toBe(true);
  type("task");
  field("down");
  field("tab");
  expect([v.mode, v.input.value(), v.query]).toEqual(["commands", ">task", ">task"]);
  expect(at()).toBe(v.list().find((r) => r.command)?.key); // the first match again
  field("shift-tab");
  expect([v.mode, v.input.value()]).toEqual(["places", "task"]);
  expect(at()).toBe(v.list().find((r) => r.command).key);
  // The segment does the same, and the field keeps the keyboard.
  const before = focused;
  draw(); h.byId("search-mode-commands").props.on_change(true, h.cx);
  expect([v.mode, v.input.value(), focused]).toEqual(["commands", ">task", before + 1]);
  // From the list, Tab is the same switch.
  draw().props.on_key_down({ keystroke: "tab", key: "tab" }, h.cx);
  expect(v.mode).toBe("places");
});

test("the foot shows Tab and the mode it goes to", () => {
  const { h, draw, field } = open();
  const hint = () => h.elements.find((e) => e.kids.length === 2 && ["Commands", "Places"].includes(e.kids[1]) && e.kids[0].kids?.some?.((k) => JSON.stringify(k).includes("⇥")));
  draw(); expect(hint()?.kids[1]).toBe("Commands");
  field("tab"); draw(); expect(hint()?.kids[1]).toBe("Places");
});

test("focus: the field is asked for each early frame until it has it, never after the person acts, never past 600 ms", () => {
  const timers = []; let asked = 0;
  const watch = (h) => {
    h.cx.timer = { after() {}, every: (ms, fn) => { const t = { ms, fn, cancelled: false, cancel() { t.cancelled = true; } }; timers.push(t); return t; } };
    const make = h.env.InputState.new; h.env.InputState = { new: (o) => ({ ...make(o), focus: () => asked++ }) };
  };
  let o = open(watch);
  const tick = () => timers.at(-1).fn(o.h.cx);
  expect(asked).toBe(1); // at once, in init
  expect(timers.at(-1).ms).toBeLessThanOrEqual(16);
  tick(); tick(); expect(asked).toBe(3);
  o.v.input.events.focus(null, o.h.cx); // the field has the keyboard: no asking, but the loop keeps watching
  tick(); expect([asked, timers.at(-1).cancelled]).toEqual([3, false]);
  o.v.input.events.blur(null, o.h.cx); // the popup took the keyboard after that
  tick(); expect(asked).toBe(4);
  // A key pressed first: no more asking.
  asked = 0; o = open(watch);
  o.field("down"); tick(); expect([asked, timers.at(-1).cancelled]).toEqual([1, true]);
  // A click first.
  asked = 0; o = open(watch);
  o.draw().props["on_mouse_down:left"]({}, o.h.cx); tick(); expect(asked).toBe(1);
  // Nothing happens for 600 ms: it gives up.
  asked = 0; o = open(watch);
  const now = Date.now; Date.now = () => now() + 601;
  try { tick(); } finally { Date.now = now; }
  expect([asked, timers.at(-1).cancelled]).toEqual([1, true]);
});

test("the wheel adds up small deltas, one step per row of travel, and starts over when it turns", () => {
  const { h, draw, at, picks } = open();
  const row = h.ui.ROW.two, all = picks();
  const wheel = (y) => { draw(); h.byId("pdk-search-list").props.on_scroll_wheel({ delta: { x: 0, y } }, h.cx); };
  for (let i = 0; i < 3; i++) wheel(-row / 4);
  expect(at()).toBe(all[0]);            // three quarters of a row: not yet
  wheel(-row / 4); expect(at()).toBe(all[1]);
  wheel(-row / 2); wheel(row / 2);      // half a row down, then back: the turn starts over
  expect(at()).toBe(all[1]);
  wheel(row / 2); expect(at()).toBe(all[0]);
  wheel(-row * 2); expect(at()).toBe(all[2]);
});

test("the Places command row clears the filter and goes to Places; Tab keeps the words", () => {
  const { v, type, field, h } = open();
  type("> places");
  const row = v.list().find((r) => r.command?.name === "pdk-search.mode:places");
  expect(row).toBeDefined();
  v.go(row.key, h.cx);
  expect([v.mode, v.query, v.input.value()]).toEqual(["places", "", ""]);
  type("> task"); field("tab");
  expect([v.mode, v.query]).toEqual(["places", "task"]);
});

test("Enter from the field runs the selection once: the root's key handler leaves it to submit", () => {
  // The host's order: the field's Enter propagates to the root's on_key_down, then the queued submit fires.
  const enter = (o) => { o.list("enter"); o.v.input.events.submit(null, o.h.cx); };
  let o = open();
  o.type("> new tab");
  const row = o.v.selected();
  enter(o);
  expect(o.h.calls.filter((c) => c[0] === row.command.name)).toHaveLength(1);
  o = open();
  o.type("> places");
  o.v.choice.choose(o.v.list().find((r) => r.command?.name === "pdk-search.mode:places").key);
  enter(o);
  expect([o.v.mode, o.v.query]).toEqual(["places", ""]);
  // From the list: once.
  o = open();
  o.type("> new tab");
  o.v.handle.focus();
  o.list("enter");
  expect(o.h.calls.filter((c) => c[0] === row.command.name)).toHaveLength(1);
});

test("the field keys are bound once per module load, not per open", () => {
  const { h } = open();
  const Search = evaluate("mods/pdk-search/main.js", h.env, "Search");
  h.bindings.length = 0;
  new Search().init({}, h.cx);
  new Search().init({}, h.cx);
  expect(h.bindings).toHaveLength(FIELD_KEYS.length + 1);
});

// K4: a Places search lists its best few commands under the places.
test("Places \"settings\" lists tremor settings under a Commands heading; Enter on it opens Settings as Commands mode does", () => {
  const o = open();
  o.type("settings");
  const list = o.v.list();
  const head = list.findIndex((r) => r.head && r.label === "Commands");
  expect(head).toBeGreaterThanOrEqual(0);
  const cmds = list.slice(head + 1);
  expect(list[head].count).toBe(cmds.length);
  expect(cmds[0].label).toBe("tremor settings");
  o.v.choice.choose(cmds[0].key);
  o.v.input.events.submit(null, o.h.cx);
  expect(o.h.calls).toContainEqual(["mod.open", { name: "pdk-settings" }]);
  expect(o.h.store.get("pdk.search.recent")[0]).toBe(cmds[0].key);
});

test("Places commands: at most 3, label matches first, never the Places command; an empty query adds none", () => {
  const o = open();
  o.type("");
  expect(o.v.list().some((r) => r.head && r.label === "Commands")).toBe(false);
  // "pane" is in labels (Pane hover: …, Split pane) and only in the words of Places ("…tabs, agents and panes").
  o.type("pane");
  const list = o.v.list(), at = list.findIndex((r) => r.head && r.label === "Commands");
  const cmds = list.slice(at + 1);
  expect(cmds.length).toBeLessThanOrEqual(3);
  expect(cmds.every((r) => r.kind === "command")).toBe(true);
  expect(cmds.some((r) => r.command.name === "pdk-search.mode:places")).toBe(false);
  const inLabel = cmds.map((r) => r.label.toLowerCase().includes("pane"));
  expect(inLabel).toEqual([...inLabel].sort((a, b) => b - a)); // every label match before any other
  expect(cmds.length).toBe(3);
  // ">" stays commands only: no place rows.
  o.type("> settings");
  expect(o.v.list().filter((r) => !r.head).every((r) => r.kind === "command")).toBe(true);
});

// K5: Escape clears a non-empty query first, and closes only an empty field.
test("Escape is bound under the field; it clears a non-empty query and keeps the palette open, then closes", () => {
  const { h, v, field, type, list } = open();
  expect(h.bindings).toContainEqual({ keystroke: "escape", action: "pdk_search_escape", context: "PdkSearch > Input" });
  type("> new");
  field("escape");
  expect([v.query, v.mode]).toEqual(["", "places"]);
  expect(h.calls.some((c) => c[0] === "closeOverlay")).toBe(false);
  field("escape");
  expect(h.calls).toContainEqual(["closeOverlay", "o1"]);
  // The list's key path does the same.
  const o = open();
  o.type("Task");
  o.list("escape");
  expect(o.v.query).toBe("");
  expect(o.h.calls.some((c) => c[0] === "closeOverlay")).toBe(false);
  o.list("escape");
  expect(o.h.calls).toContainEqual(["closeOverlay", "o1"]);
});

test("Esc is drawn once, in the foot: Clear while the field has text, Close when it is empty", () => {
  const { h, draw, type } = open();
  const escs = () => { draw(); return h.elements.filter((e) => e.props.role === "image" && e.props.accessibility_label === "Esc"); };
  const word = () => { escs(); return h.elements.find((e) => e.kids.some((k) => k?.props?.accessibility_label === "Esc")).kids.at(-1); };
  expect(escs()).toHaveLength(1);
  expect(word()).toBe("Close");
  type("Task");
  expect(escs()).toHaveLength(1);
  expect(word()).toBe("Clear");
});

// Review finding 1: with the list holding the keyboard no Input is in the path, so Escape is bound under the root too
// (the host's Overlay escape would otherwise close the palette with text in it).
test("Escape is bound under PdkSearch as well; from the list it clears a non-empty query, then closes", () => {
  const { h, v, draw, type } = open();
  expect(h.bindings).toContainEqual({ keystroke: "escape", action: "pdk_search_escape", context: "PdkSearch" });
  expect(h.bindings).toContainEqual({ keystroke: "escape", action: "pdk_search_escape", context: "PdkSearch > Input" });
  type("Task");
  v.handle.focus(); // the list (root handle) has the keyboard
  const root = draw();
  expect(root.props.key_context).toBe("PdkSearch");
  root.props["on_action:pdk_search_escape"]({}, h.cx);
  expect(v.query).toBe("");
  expect(h.calls.some((c) => c[0] === "closeOverlay")).toBe(false);
  draw().props["on_action:pdk_search_escape"]({}, h.cx);
  expect(h.calls).toContainEqual(["closeOverlay", "o1"]);
});
