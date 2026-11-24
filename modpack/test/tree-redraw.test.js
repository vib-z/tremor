// A fold click must redraw the tree itself, in the click's own event, under the host's real rules for contexts
// (host-scope.js). Measured in the running app on 13 Nov 2026: a row's handler runs in that row view's call, where
// the tree's saved init context redraws the row alone, so the list changed only when something else redrew the tree
// (host data, another mod, a 15 s timer); and the row pass started from render was refused by the host every time.
import { test, expect } from "bun:test";
import { world } from "./parity-harness.js";
import { hostScope } from "./host-scope.js";

const start = async (w = world()) => { const s = hostScope(w); await s.settle(); return s; };
const tabs = (s) => s.shown().filter((k) => k.startsWith("tb:"));

test("starting up makes no call the host refuses, and every row is shown", async () => {
  const s = await start();
  expect(s.rejections.map(String)).toEqual([]);
  expect(s.shown()).toEqual(s.tree.list.map((r) => r.key));
  expect(s.asked()).toEqual([]);
});

test("a click on a workspace row asks the tree to redraw in that event: its rows leave the list in the next frame", async () => {
  const s = await start();
  expect(tabs(s)).toEqual(["tb:tab1", "tb:tab2", "tb:tab3", "tb:tab4"]);
  s.click("sp:A");
  expect(s.tree.folded.has("sp:A")).toBe(true);
  expect(s.asked()).toContain("tree");
  expect(s.frame()).toContain("tree");
  expect(tabs(s)).toEqual(["tb:tab4"]);
  // And open again, the same way: one click, one frame, no task in between.
  s.click("sp:A");
  expect(s.frame()).toContain("tree");
  expect(tabs(s)).toEqual(["tb:tab1", "tb:tab2", "tb:tab3", "tb:tab4"]);
});

test("a click on the caret does the same", async () => {
  const s = await start();
  s.click("sp:A-fold");
  expect(s.asked()).toContain("tree");
  s.frame();
  expect(tabs(s)).toEqual(["tb:tab4"]);
});

test("Left and Right fold from the keyboard and redraw the tree in the key's event", async () => {
  const s = await start();
  s.click("sp:A"); s.frame();
  s.fire("pdk-tree", "on_key_down", { key: "right" });
  expect(s.asked()).toContain("tree");
  s.frame();
  expect(tabs(s)).toEqual(["tb:tab1", "tb:tab2", "tb:tab3", "tb:tab4"]);
});

// Saved in the click's own event, after the redraw was asked for: the host keeps it in memory and writes the file in
// the background. A save left to a task after the frame lost folds made with the sidebar hidden (no render) and
// folds made just before a reload (review R1).
test("the fold is saved in its event, after the tree was asked to redraw", async () => {
  const s = await start();
  const store = s.h.env.localStorage, set = store.setItem, saves = [];
  store.setItem = (key, value) => { if (key === "folded") saves.push([JSON.parse(value), s.asked().includes("tree")]); return set(key, value); };
  s.click("sp:A");
  expect(saves).toEqual([[["sp:A"], true]]);
});

test("a fold made with no frame after it is kept: the sidebar hidden, or the mod made again at once", async () => {
  const w = world();
  let wake = null;
  w.next = () => new Promise((r) => { wake = r; });
  const s = await start(w);
  // A command while the sidebar is hidden: its tasks run, its view is never drawn.
  wake("fold:sp:A"); await s.runTasks(); await s.runTasks();
  const again = () => { const t = new s.h.Tree(); t.init({}, s.h.cx); return t; };
  expect(again().folded.has("sp:A")).toBe(true);
  // A click, its frame, then a reload that drops every waiting task.
  s.click("sp:B"); s.frame(); s.lose();
  expect([...again().folded].sort()).toEqual(["sp:A", "sp:B"]);
});

test("a status change redraws its row with no call the host refuses, and the tree only once", async () => {
  const s = await start();
  s.h.world.terminals[2].status = "blocked"; s.h.world.agents[2].status = "blocked";
  s.hostChanged();
  expect(s.frame()).toEqual(["tree"]);
  await s.runTasks();
  expect(s.rejections.map(String)).toEqual([]);
  expect(s.frame()).toEqual(["tb:tab3"]);
});

test("a new tab gets its row within one task of the frame that first lists it", async () => {
  const s = await start(), w = s.h.world;
  w.spaces[0].tabs.push({ id: "tab9", name: "Task 9", active: false, settled: false });
  w.panes.push({ pane: "p9", tab: "tab9", terminal: "t9", cwd: "/repo/a", focused: false, program: { agent: true, key: "codex", name: "Codex" } });
  w.terminals.push({ address: "t9", state: "live", pid: 9, status: "idle", turn: 1, records: {}, report: { app: "codex", state: "idle" } });
  w.agents.push({ address: "t9", status: "idle", pinned: false, seq: 9 });
  s.hostChanged();
  await s.settle();
  expect(s.rejections.map(String)).toEqual([]);
  expect(tabs(s)).toContain("tb:tab9");
});

test("the pointer moving over tab rows redraws those rows only: not the tree, and no pass over every row", async () => {
  const s = await start();
  let passes = 0; const rows = s.tree.rows;
  s.tree.rows = function () { passes++; return rows.call(this); };
  s.fire("tb:tab2", "on_hover", true);
  expect(s.asked()).toEqual(["tb:tab2"]);
  expect(s.frame()).toEqual(["tb:tab2"]);
  expect(s.el("tb:tab2-close")).toBeDefined();
  s.fire("tb:tab2", "on_hover", false); s.fire("tb:tab3", "on_hover", true);
  expect(s.asked().sort()).toEqual(["tb:tab2", "tb:tab3"]);
  expect(s.frame().sort()).toEqual(["tb:tab2", "tb:tab3"]);
  expect(passes).toBe(0);
});

// docs/DESIGN.md, Focus ring: 2 px, inset, shown only after a key (the pack's pointer/keyboard switch).
test("a mouse click leaves no focus ring on its row; the first key shows it, 2 px; the next click hides it", async () => {
  const s = await start(), accent = s.h.env.theme().accent;
  const ring = (id) => s.el(id).props.border_color === accent;
  s.click("sp:B"); await s.settle();
  expect([s.tree.sel, s.tree.handle.is_focused(), ring("sp:B")]).toEqual(["sp:B", true, false]);
  // The arrows act on the clicked row, and the ring comes with the first key.
  s.fire("pdk-tree", "on_key_down", { key: "down" }); await s.settle();
  expect([s.tree.sel, ring("sp:R"), ring("sp:B"), s.el("sp:R").props.border]).toEqual(["sp:R", true, false, 2]);
  // A click on a tab row while the tree has the keyboard: no ring there, and none left behind.
  s.click("tb:tab4"); await s.settle();
  expect([s.tree.sel, ring("tb:tab4"), ring("sp:R")]).toEqual(["tb:tab4", false, false]);
  // A caret click: the same.
  s.click("sp:A-fold"); await s.settle();
  expect([s.tree.sel, ring("sp:A")]).toEqual(["sp:A", false]);
  // Keyboard again: the ring is back, on the row the arrows moved to.
  s.fire("pdk-tree", "on_key_down", { key: "down" }); await s.settle();
  expect(ring(s.tree.sel)).toBe(true);
});

test("a row is the same size with and without the ring, and its content starts where it did", async () => {
  const s = await start();
  const edge = (id) => s.el(id).props.border;
  expect([edge("sp:A"), edge("tb:tab1")]).toEqual([2, 2]);
  // 4 px to a workspace's name and to an agent's mark, as before the ring grew from 1 px to 2: the padding gives it back.
  expect([s.el("sp:A").props.pl + edge("sp:A"), s.el("tb:tab1").props.pl + edge("tb:tab1")]).toEqual([5, 5]);
});

test("a right-click on a row leaves no ring, there or on the row the keyboard had", async () => {
  const s = await start(), accent = s.h.env.theme().accent;
  const ring = (id) => s.el(id).props.border_color === accent;
  s.click("sp:B"); s.fire("pdk-tree", "on_key_down", { key: "down" }); await s.settle();
  expect(ring("sp:R")).toBe(true);
  s.fire("tb:tab2", "on_mouse_down:right"); await s.settle();
  expect([s.tree.sel, ring("tb:tab2"), ring("sp:R"), s.h.overlays.length]).toEqual(["tb:tab2", false, false, 1]);
  s.fire("sp:A", "on_mouse_down:right"); await s.settle();
  expect([s.tree.sel, ring("sp:A"), ring("tb:tab2")]).toEqual(["sp:A", false, false]);
});

test("a pdk-tree.fold: command folds the row and redraws the tree, from the command task", async () => {
  const w = world(), queue = [];
  let wake = null;
  w.next = () => queue.length ? Promise.resolve(queue.shift()) : new Promise((r) => { wake = r; });
  const s = await start(w);
  wake("fold:sp:A"); await s.runTasks();
  expect(s.tree.folded.has("sp:A")).toBe(true);
  expect(s.asked()).toContain("tree");
  expect(s.frame()).toContain("tree");
  expect(tabs(s)).toEqual(["tb:tab4"]);
  expect(s.rejections.map(String)).toEqual([]);
});

test("a row pass the host lost is started again after a second, not before", async () => {
  const s = await start(), w = s.h.world, now = Date.now, real = now();
  try {
    Date.now = () => real;
    w.spaces[0].tabs.push({ id: "tab9", name: "Task 9", active: false, settled: false });
    s.hostChanged(); s.frame();
    expect(s.lose()).toBeGreaterThan(0);
    await s.settle();
    // Still within the second: the pass counts as pending, so a redraw starts none.
    s.hostChanged(); await s.settle();
    expect(tabs(s)).not.toContain("tb:tab9");
    Date.now = () => real + 1001;
    s.hostChanged(); await s.settle();
    expect(tabs(s)).toContain("tb:tab9");
    expect(s.rejections.map(String)).toEqual([]);
  } finally { Date.now = now; }
});
