import { test, expect } from "bun:test";
import { AGENT_VIEWS, PLACE_VIEWS, litSegment, pressView, paneControls, hoverStyle, HOVER_KEY } from "../adapters/views.js";
import { harness, world, evaluate } from "./parity-harness.js";
import { readFileSync } from "node:fs";

test("a segment is lit exactly while its view is on screen: Terminal and Grid both show the split panes", () => {
  const lit = (shown) => [litSegment(AGENT_VIEWS, shown), litSegment(PLACE_VIEWS, shown)];
  expect(lit("main")).toEqual(["main", "grid"]);
  expect(lit("chat")).toEqual(["chat", null]);
  expect(lit("factory")).toEqual([null, "factory"]);
  expect(lit(undefined)).toEqual(["main", "grid"]);
});

test("a press selects its segment's view; Grid is always the split pane view; a lit segment does nothing", () => {
  expect(pressView("main", "factory")).toBe("factory");
  expect(pressView("chat", "factory")).toBe("factory");
  expect(pressView("factory", "grid")).toBe("main");
  expect(pressView("chat", "grid")).toBe("main");
  expect(pressView("main", "chat")).toBe("chat");
  expect(pressView("chat", "main")).toBe("main");
  for (const [shown, lit] of [["main", "main"], ["main", "grid"], ["chat", "chat"], ["factory", "factory"], [undefined, "grid"]]) expect(pressView(shown, lit)).toBeNull();
  expect(pressView("main", "nowhere")).toBeNull();
});

test("both toggles are icons only, each segment with one word for its tooltip and its accessible name", () => {
  expect(AGENT_VIEWS.map((v) => [v.value, v.icon, v.label, v.tooltip])).toEqual([["chat", "message-square", "Chat", "Chat"], ["main", "square-terminal", "Terminal", "Terminal"]]);
  expect(PLACE_VIEWS.map((v) => [v.value, v.icon, v.label, v.tooltip])).toEqual([["grid", "layout-grid", "Grid", "Grid"], ["factory", "factory", "Factory", "Factory"]]);
});

test("the hover style is clean unless the shared key says normal", () => {
  expect([undefined, null, "clean", "normal", "Normal", "icons", 1].map(hoverStyle)).toEqual(["clean", "clean", "clean", "normal", "clean", "clean", "clean"]);
  expect(HOVER_KEY).toBe("pdk.pane.hover");
  expect(paneControls("p7", false)).toEqual(paneControls("p7", false, "clean"));
  expect(paneControls("p7", false, "bogus")).toEqual(paneControls("p7", false, "clean"));
});

test("Clean: split right, split down, expand, close as the earlier text buttons, each with Herdr's own command for that pane", () => {
  const c = paneControls("p7", false, "clean");
  expect(c.map((x) => [x.id, x.text, x.label, x.command, x.args, x.key])).toEqual([
    ["ph-r", "Split →", "Split right", "pane.split", { direction: "right", pane: "p7" }, "pane.split:right"],
    ["ph-d", "Split ↓", "Split down", "pane.split", { direction: "down", pane: "p7" }, "pane.split:down"],
    ["ph-z", "Expand", "Expand", "pane.zoom", { pane: "p7" }, "pane.zoom"],
    ["ph-x", "Close", "Close pane", "pane.close", { pane: "p7" }, "pane.close"],
  ]);
  expect(c.every((x) => x.label.split(" ").length <= 3)).toBe(true);
});

test("Normal: the same four as icons, each with its glyph, words, command and key", () => {
  const c = paneControls("p7", false, "normal");
  expect(c.map((x) => [x.id, x.glyph, x.label, x.command, x.args, x.key, x.text])).toEqual([
    ["ph-r", "columns-2", "Split right", "pane.split", { direction: "right", pane: "p7" }, "pane.split:right", undefined],
    ["ph-d", "rows-2", "Split down", "pane.split", { direction: "down", pane: "p7" }, "pane.split:down", undefined],
    ["ph-z", "maximize-2", "Expand", "pane.zoom", { pane: "p7" }, "pane.zoom", undefined],
    ["ph-x", "x", "Close pane", "pane.close", { pane: "p7" }, "pane.close", undefined],
  ]);
  expect(c.some((x) => x.pressed)).toBe(false);
});

test("an expanded pane offers Restore on the same command in both styles; Normal's is pressed", () => {
  const clean = paneControls("p7", true, "clean").find((x) => x.id === "ph-z");
  expect([clean.text, clean.label, clean.command, clean.args]).toEqual(["Restore", "Restore", "pane.zoom", { pane: "p7" }]);
  const z = paneControls("p7", true, "normal").find((x) => x.id === "ph-z");
  expect([z.glyph, z.label, z.command, z.args, z.pressed]).toEqual(["minimize-2", "Restore", "pane.zoom", { pane: "p7" }, true]);
});

// ---- The same, drawn: the tab bar and the pane header against the recording renderer -----------------------------
test("the tab bar keeps one toggle, Grid | Factory; Chat | Terminal is not in it", () => {
  const w = world(), h = harness(w);
  w.onRun = (name, args) => { if (name === "layout.select" && args.stack === "work-body") w.view = args.child; };
  const tabs = new h.Tabs(); tabs.init({}, h.cx);
  const SEGMENTS = ["place-toggle-grid", "place-toggle-factory"];
  const draw = () => { h.elements.length = 0; tabs.render(); };
  const lit = () => { draw(); return SEGMENTS.filter((id) => h.byId(id).props.pressed === true); };
  const press = (id) => { draw(); h.byId(id).props.on_change(true, h.cx); return w.view; }; // a click, Space or Enter on the Toggle
  expect(lit()).toEqual(["place-toggle-grid"]);
  expect(SEGMENTS.map((id) => [h.byId(id).props.size, h.byId(id).props.w, h.byId(id).kids[0].kind, h.byId(`${id}-tip`).props.tooltip])).toEqual([[24, undefined, "svg", "Grid"], [24, undefined, "svg", "Factory"]]);
  for (const gone of ["factory", "view-toggle", "view-toggle-chat", "view-toggle-main"]) expect(h.byId(gone)).toBeUndefined();
  expect(press("place-toggle-factory")).toBe("factory");
  expect(lit()).toEqual(["place-toggle-factory"]);
  const before = h.calls.length;
  press("place-toggle-factory"); // lit already: nothing runs
  expect(h.calls.length).toBe(before);
  expect(press("place-toggle-grid")).toBe("main");
  w.view = "chat"; // a full-width chat is neither the grid nor the factory
  expect(lit()).toEqual([]);
  expect(press("place-toggle-grid")).toBe("main");
});

function paneHeader(w) {
  const h = harness(w);
  const Pane = evaluate("mods/pdk-pane/main.js", { ...h.env, ...evaluate("shared/ui.js", h.env, "({ folderLabel, folderName, paneLabel })") }, "Pane");
  h.props({ pane: "p1" });
  const pane = new Pane(); pane.init({}, h.cx);
  return { h, pane, draw: () => { h.elements.length = 0; pane.render(); } };
}
const kids = (h, id) => h.byId(id).kids.map((k) => k.props?.id);
const CONTROLS = ["ph-r-p1", "ph-d-p1", "ph-z-p1", "ph-x-p1"];

test("Clean (the default): the earlier text buttons over the path, hidden until hover, on Herdr's own commands", () => {
  const w = world();
  const { h, pane, draw } = paneHeader(w);
  draw();
  expect(CONTROLS.map((id) => [h.byId(id).kids[0], h.byId(id).props.accessibility_label, h.byId(id).props.tooltip]))
    .toEqual([["Split →", "Split right", "Split right"], ["Split ↓", "Split down", "Split down"], ["Expand", "Expand", "Expand"], ["Close", "Close pane", "Close pane"]]);
  expect([h.byId("ph-ctl-p1").props.absolute, h.byId("ph-ctl-p1").props.w]).toEqual([true, 0]); // over the path, no width at rest
  pane.hovered = true; draw();
  expect(h.byId("ph-ctl-p1").props.w).toBeUndefined();
  for (const [id, call] of [["ph-r-p1", ["pane.split", { direction: "right", pane: "p1" }]], ["ph-d-p1", ["pane.split", { direction: "down", pane: "p1" }]],
    ["ph-z-p1", ["pane.zoom", { pane: "p1" }]], ["ph-x-p1", ["pane.close", { pane: "p1" }]]]) {
    h.byId(id).props.on_click({}, h.cx);
    expect(h.calls.at(-1)).toEqual(call);
  }
  h.store.set("pdk.pane.hover", "something else"); draw();
  expect(h.byId("ph-r-p1").kids[0]).toBe("Split →");
});

test("Normal: the controls are square icon buttons on Herdr's own commands, hidden until hover, each in a tooltip with its key", () => {
  const w = world(); w.keys = [{ section: "global", keys: "cmd-shift-enter", action: "pane.zoom" }];
  const { h, pane, draw } = paneHeader(w);
  h.store.set("pdk.pane.hover", "normal");
  draw();
  expect(CONTROLS.map((id) => [h.byId(id).props.size, h.byId(id).kids[0].kind, h.byId(id).props.accessibility_label, h.byId(id).props.tooltip]))
    .toEqual([[24, "svg", "Split right", "Split right"], [24, "svg", "Split down", "Split down"], [24, "svg", "Expand", "Expand ⌘⇧↵"], [24, "svg", "Close pane", "Close pane"]]);
  expect([h.byId("ph-ctl-p1").props.absolute, h.byId("ph-ctl-p1").props.w]).toEqual([true, 0]); // over the path, no width at rest
  pane.hovered = true; draw();
  expect(h.byId("ph-ctl-p1").props.w).toBeUndefined();
  // The words and the bound key in the app's own tooltip on the button (no key bound: words only, never a made-up
  // key); no card that could lie over a control (owner, 11 Nov).
  expect(h.elements.some((e) => e.kind === "HoverCard")).toBe(false);
  for (const [id, call] of [["ph-r-p1", ["pane.split", { direction: "right", pane: "p1" }]], ["ph-d-p1", ["pane.split", { direction: "down", pane: "p1" }]],
    ["ph-z-p1", ["pane.zoom", { pane: "p1" }]], ["ph-x-p1", ["pane.close", { pane: "p1" }]]]) {
    h.byId(id).props.on_click({}, h.cx);
    expect(h.calls.at(-1)).toEqual(call);
  }
});

test("an expanded pane keeps its controls in the row with Restore, so the way back never needs a hover, in both styles", () => {
  const w = world(); w.panes[0].zoomed = true;
  const { h, draw } = paneHeader(w);
  for (const style of [undefined, "normal"]) {
    h.store.set("pdk.pane.hover", style); draw();
    const ctl = h.byId("ph-ctl-p1").props, z = h.byId("ph-z-p1");
    expect([ctl.absolute, ctl.w, ctl.flex_none]).toEqual([undefined, undefined, true]);
    expect(z.props.accessibility_label).toBe("Restore");
    if (style) expect([z.props.bg, z.props.text_color]).toEqual([h.env.theme().selected, h.env.theme().foreground]);
    else expect(z.kids[0]).toBe("Restore");
    z.props.on_click({}, h.cx);
    expect(h.calls.at(-1)).toEqual(["pane.zoom", { pane: "p1" }]);
  }
});


test("the status marker sits right after the pane's name, and a pane with no status keeps no empty slot", () => {
  const w = world();
  const { h, draw } = paneHeader(w);
  w.panes[0].status = "working"; draw();
  expect(kids(h, "ph-left-p1")).toEqual(["ph-kind-p1", "ph-name-p1", "ph-st-p1"]);
  w.panes[0].status = null; draw();
  expect(kids(h, "ph-left-p1")).toEqual(["ph-kind-p1", "ph-name-p1"]);
});

test("an agent's pane has Chat | Terminal in the middle of its bar: Terminal lit, Chat focuses that pane and shows its chat; no Commands button", () => {
  const w = world();
  const { h, draw } = paneHeader(w);
  draw();
  const chat = h.byId("ph-view-p1-chat"), term = h.byId("ph-view-p1-main");
  expect([chat.props.pressed, term.props.pressed, chat.props.size, term.props.size, h.byId("ph-view-p1-chat-tip").props.tooltip, h.byId("ph-view-p1-main-tip").props.tooltip]).toEqual([false, true, 24, 24, "Chat", "Terminal"]);
  // The bar's middle: the two sides share the width evenly, and the path with its controls is the right side.
  expect(kids(h, "pane-head-p1")).toEqual(["ph-left-p1", "ph-view-p1", "ph-right-p1"]);
  expect([h.byId("ph-left-p1").props.flex_1, h.byId("ph-right-p1").props.flex_1, h.byId("ph-view-p1").props.flex_none]).toEqual([true, true, true]);
  expect(kids(h, "ph-right-p1")).toEqual(["ph-dir-p1", "ph-ctl-p1"]);
  expect(h.byId("ph-slash-p1")).toBeUndefined();
  const before = h.calls.length;
  term.props.on_change(false, h.cx); // lit already
  expect(h.calls.length).toBe(before);
  chat.props.on_change(true, h.cx);
  expect(h.calls.slice(-2)).toEqual([["pane.focus", { pane: "p1" }], ["layout.select", { stack: "work-body", child: "chat" }]]);
  expect(h.store.get("pdk.chat.pick").address).toBe("t1");
});

// Review R1: the chat follows focus only when focus moves. A sub-agent picked in the sidebar stays its target while
// its parent's pane keeps the focus, so a pane's Chat button has to name its own terminal. This runs the chat's real
// updateTarget (cut from its source) against the real pane header.
test("a pane's Chat button shows that pane's agent, not a sub-agent picked in the sidebar earlier", () => {
  const w = world(); w.terminals.push({ address: "t-child", state: "live", pid: 99, parent: "t1" });
  const { h, draw } = paneHeader(w);
  const src = readFileSync(new URL("../mods/pdk-chat/main.js", import.meta.url), "utf8");
  const method = src.slice(src.indexOf("  updateTarget() {"), src.indexOf("  async tick(cx) {"));
  const updateTarget = new Function("focused", "shared", "terminals", `return function ${method.trim()}`)(h.env.focused, h.env.shared, h.env.terminals);
  const chat = { chosen: null, target: null, resets: 0, agents: new Map(), leaveSession() { this.resets++; }, agentFor() {}, updateTarget };
  expect(chat.updateTarget()).toBe("t1"); // the focused pane's agent
  h.store.set("pdk.chat.pick", { address: "t-child", at: 1 }); // a pane-less sub-agent picked in the sidebar, in chat
  expect(chat.updateTarget()).toBe("t-child");
  draw(); // back in the grid, focus still on p1: its Chat button
  h.byId("ph-view-p1-chat").props.on_change(true, h.cx);
  expect(chat.updateTarget()).toBe("t1");
  // Review R2: picks in one millisecond, from either writer in either order. The chat tells them apart by address.
  const now = Date.now;
  try {
    Date.now = () => 1004;
    const sidebarPick = (address) => h.store.set("pdk.chat.pick", { address, at: Date.now() }); // as pdk-tree's pick writes it
    sidebarPick("t-child");
    expect(chat.updateTarget()).toBe("t-child");
    draw(); h.byId("ph-view-p1-chat").props.on_change(true, h.cx);
    expect(h.store.get("pdk.chat.pick")).toEqual({ address: "t1", at: 1004 });
    expect(chat.updateTarget()).toBe("t1");
    sidebarPick("t-child");
    expect(chat.updateTarget()).toBe("t-child");
    const resets = chat.resets;
    expect(chat.updateTarget()).toBe("t-child"); // the same pick again is not a new one
    expect(chat.resets).toBe(resets);
  } finally { Date.now = now; }
});

test("a plain shell's pane has no chat and so no toggle", () => {
  const w = world(); w.panes[0].program = { shell: true, name: "zsh" }; w.terminals[0] = { address: "t1", state: "live", pid: 1 };
  const { h, draw } = paneHeader(w);
  draw();
  expect(h.byId("ph-view-p1")).toBeUndefined();
  expect(kids(h, "pane-head-p1")).toEqual(["ph-left-p1", "ph-right-p1"]);
  expect([h.byId("ph-left-p1").props.flex_1, h.byId("ph-right-p1").props.flex_1]).toEqual([undefined, true]); // the path keeps the room
});

// Owner, 11 Nov: "when tooltip opens, click doesn't work". Every control that shows a tooltip with its key carries
// the app's own tooltip on itself (words and keys) and no HoverCard: a HoverCard's card is drawn in a Popup whose host
// blocks the mouse, and in the 40 px top bar the window clamped a card meant above its trigger down over it. A press
// on each runs its action, tooltip or not: the sidebar's search and toggle, the tab bar's +, the pane's controls.
test("a control's tooltip is on the control itself, so a press acts while it shows: sidebar head, tab bar +, pane controls", () => {
  const w = world(); w.keys = [{ section: "global", keys: "cmd-k", action: "mod.open:pdk-search" }, { section: "global", keys: "cmd-t", action: "tab.new" },
    { section: "global", keys: "cmd-shift-enter", action: "pane.zoom" }];
  const h = harness(w, { part: "head" }); const head = new h.Tree(); head.init({}, h.cx); h.tasks.length = 0;
  head.render(h.cx);
  const tabs = new h.Tabs(); tabs.init({}, h.cx); h.tasks.length = 0; tabs.render();
  const { h: ph, pane, draw } = paneHeader(w); pane.hovered = true; draw();
  expect([...h.elements, ...ph.elements].some((e) => e.kind === "HoverCard")).toBe(false);
  const cx = { ...h.cx, stop_propagation: () => {} };
  for (const [hh, id, tip, call] of [[h, "sidebar-search", "Search ⌘K", ["mod.open", { name: "pdk-search" }]], [h, "sidebar-toggle", "Toggle sidebar", ["layout.toggle", { id: "sidebar" }]],
    [h, "tab-new", "New tab ⌘T", null], [ph, "ph-z-p1", "Expand ⌘⇧↵", ["pane.zoom", { pane: "p1" }]]]) {
    const el = hh.byId(id);
    expect([el.props.tooltip, typeof el.props.on_click], id).toEqual([tip, "function"]);
    const before = [hh.calls.length, hh.overlays.length];
    el.props.on_click({}, cx);
    if (call) expect(hh.calls.at(-1), id).toEqual(call); else expect(hh.overlays.length, id).toBe(before[1] + 1); // + opens the new menu
  }
});

// Chat or Terminal per tab (owner, 11 Nov 2026).
import { TABS_KEY, PICK_FRESH_MS, followTab, rememberChat, forgetTab } from "../adapters/views.js";

test("each tab remembers Chat or Terminal and the agent it showed", () => {
  expect(TABS_KEY).toBe("pdk.chat.tabs");
  const live = (a) => ["t1", "t2", "t3"].includes(a);
  const tabs = ["A", "B", "C"];
  const go = (o) => followTab({ tabs, live, now: 10000, ...o });
  // Back on a tab that showed Chat: Chat again, with its agent.
  expect(go({ entries: { A: "t1" }, tab: "A", view: "main" })).toEqual({ entries: { A: "t1" }, select: "chat", pick: "t1" });
  expect(go({ entries: { A: "t1", B: "t2" }, tab: "B", view: "chat" })).toEqual({ entries: { A: "t1", B: "t2" }, select: null, pick: "t2" });
  // A tab that showed its panes: its panes, whatever the last tab showed.
  expect(go({ entries: { A: "t1" }, tab: "B", view: "chat" })).toEqual({ entries: { A: "t1" }, select: "main", pick: null });
  expect(go({ entries: { A: "t1" }, tab: "B", view: "main" })).toEqual({ entries: { A: "t1" }, select: null, pick: null });
  // Factory is left alone.
  expect(go({ entries: { A: "t1" }, tab: "A", view: "factory" }).select).toBeNull();
  // A stale entry (its agent gone) and a gone tab's entry are dropped; the tab shows its panes.
  expect(go({ entries: { A: "t9", Z: "t1" }, tab: "A", view: "chat" })).toEqual({ entries: {}, select: "main", pick: null });
  // A sidebar pick in the tab just shown wins over the remembered agent, and is remembered; an old one doesn't.
  const pick = { address: "t3", at: 10000 - PICK_FRESH_MS / 2 };
  expect(go({ entries: { B: "t2" }, tab: "B", view: "main", pick, pickTab: "B" })).toEqual({ entries: { B: "t3" }, select: "chat", pick: null });
  expect(go({ entries: {}, tab: "B", view: "chat", pick, pickTab: "B" })).toEqual({ entries: { B: "t3" }, select: null, pick: null });
  expect(go({ entries: {}, tab: "B", view: "main", pick, pickTab: "B" }).select).toBeNull(); // in the grid, a pick only focuses
  expect(go({ entries: { B: "t2" }, tab: "B", view: "main", pick: { ...pick, at: 0 }, pickTab: "B" }).pick).toBe("t2");
  expect(go({ entries: { B: "t2" }, tab: "B", view: "main", pick, pickTab: "A" }).pick).toBe("t2"); // a pick for another tab
  // Chat chosen on a tab with no entry, seen by the tab bar together with the tab change (it draws late): kept, with
  // the focused agent; a Chat that was already on screen when the tab changed is not a request.
  expect(go({ entries: {}, tab: "B", view: "chat", asked: true, focus: "t2" })).toEqual({ entries: { B: "t2" }, select: null, pick: "t2" });
  expect(go({ entries: {}, tab: "B", view: "chat", asked: false, focus: "t2" }).select).toBe("main");
  expect(go({ entries: {}, tab: "B", view: "chat", asked: true, focus: "t9" }).select).toBe("main"); // gone
  expect(rememberChat({ A: "t1" }, "B", "t2")).toEqual({ A: "t1", B: "t2" });
  expect(forgetTab({ A: "t1", B: "t2" }, "A")).toEqual({ B: "t2" });
});

import { keepTab } from "../adapters/views.js";
test("between tab changes the shown tab remembers what it shows", () => {
  const live = (a) => a === "t1" || a === "t2";
  expect(keepTab({ entries: {}, tab: "A", view: "chat", focus: "t1", live })).toEqual({ A: "t1" }); // Chat chosen, no pick
  expect(keepTab({ entries: { A: "t2" }, tab: "A", view: "chat", focus: "t1", live })).toBeNull(); // a pick's agent stays
  expect(keepTab({ entries: { A: "t2", B: "t1" }, tab: "A", view: "main", live })).toEqual({ B: "t1" }); // panes: forgotten
  expect(keepTab({ entries: { A: "t2" }, tab: "A", view: "factory", live })).toBeNull();
  expect(keepTab({ entries: {}, tab: "A", view: "chat", focus: "t9", live })).toBeNull();
});
