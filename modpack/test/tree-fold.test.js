// Folding in the sidebar tree is one redraw: an unfold's new rows have their views in the frame right after the fold,
// not after a later task and a second redraw (measured 12 Nov: 2 renders and a task, 8 of 14 rows blank in the first).
import { test, expect } from "bun:test";
import { harness, world } from "./parity-harness.js";

const renderedText = (n) => typeof n === "string" ? n : (n?.kids ?? []).map(renderedText).join(" ");

test("an unfold draws every new row in the next render, with no task run in between", async () => {
  const w = world(), h = harness(w), tree = new h.Tree();
  tree.init({}, h.cx); h.tasks.length = 0; // init's loops never end
  tree.render(h.cx); await h.flushRows(tree);
  tree.toggle("sp:A", h.cx); tree.render(h.cx); await h.flushRows(tree);
  const folded = tree.list.length;
  h.tasks.length = 0;
  // The unfold, then one render. No task runs: a busy app starts them late.
  tree.toggle("sp:A", h.cx); tree.render(h.cx);
  expect(tree.list.length).toBeGreaterThan(folded);
  for (const row of tree.list) expect([row.key, tree.rowViews.has(row.key)]).toEqual([row.key, true]);
  // Each new view draws its own row from this render, not a blank.
  for (const row of tree.list.filter((r) => r.type === "tab")) expect(renderedText(tree.rowViews.get(row.key).render())).toContain(row.tab.name);
  // A fold needs nothing new either: the rows left already have their views.
  tree.toggle("sp:A", h.cx); tree.render(h.cx);
  for (const row of tree.list) expect(tree.rowViews.has(row.key)).toBe(true);
});

// A fold is a local update: the hierarchy is reused, no row view is made, released or given new props, and only the
// rows whose drawing changed are redrawn, all in the click's own event.
const setup = async (w = world()) => {
  const h = harness(w), tree = new h.Tree();
  tree.init({}, h.cx); h.tasks.length = 0;
  tree.render(h.cx); await h.flushRows(tree);
  const counts = { creates: 0, updates: 0, releases: 0, notified: [] };
  const make = h.cx.new;
  h.cx.new = (Class, p) => { counts.creates++; const v = make(Class, p), set = v.set_props, rel = v.release; v.set_props = (x) => { counts.updates++; return set(x); }; v.release = () => { counts.releases++; return rel(); }; return v; };
  h.cx.notify = (target) => { if (target) counts.notified.push([...tree.rowViews].find(([, v]) => v === target)?.[0]); };
  for (const v of tree.rowViews.values()) { const set = v.set_props, rel = v.release; v.set_props = (x) => { counts.updates++; return set(x); }; v.release = () => { counts.releases++; return rel(); }; }
  const reset = () => { counts.creates = counts.updates = counts.releases = 0; counts.notified = []; h.tasks.length = 0; };
  const settle = async () => { tree.render(h.cx); for (const task of h.tasks.splice(0)) await task(h.cx); tree.render(h.cx); };
  return { h, w, tree, counts, reset, settle };
};

test("fold and unfold reuse every row view and redraw only the folded row", async () => {
  const { h, tree, counts, reset } = await setup(world(30));
  let builds = 0; const build = h.env.buildPaneTree;
  tree.paneTree = ((orig) => function () { const m = this.model; const r = orig.call(this); if (r !== m) builds++; return r; })(tree.paneTree);
  for (let i = 0; i < 11; i++) {
    reset();
    h.byId("sp:A-fold").props.on_click({ click_count: 1 }, h.cx); tree.render(h.cx);
    expect([counts.creates, counts.updates, counts.releases, h.tasks.length]).toEqual([0, 0, 0, 0]);
    // The first click also moves the keyboard's row there (sel); after that only sp:A itself changes.
    expect([...new Set(counts.notified)]).toEqual(["sp:A"]);
    for (const row of tree.list) expect(tree.rowViews.has(row.key)).toBe(true);
  }
  expect(tree.folded.has("sp:A")).toBe(true); // 11 clicks: folded
  expect(builds).toBe(0);
});

test("a status change rebuilds the hierarchy and redraws only its row, from one task", async () => {
  const { w, tree, counts, reset, settle } = await setup();
  reset();
  w.terminals[2].status = "blocked"; w.agents[2].status = "blocked";
  await settle();
  expect([counts.creates, counts.updates, counts.releases]).toEqual([0, 0, 0]);
  expect(counts.notified).toEqual(["tb:tab3"]);
  // Nothing changed: no task at all.
  reset(); await settle();
  expect(counts.notified).toEqual([]);
});

test("folds survive a refresh, panes coming and going, the machine filter and a new view; gone rows lose their views", async () => {
  const { h, w, tree, counts, reset, settle } = await setup();
  h.byId("sp:A-fold").props.on_click({ click_count: 1 }, h.cx); await settle();
  // A pane added to the folded workspace, then one removed elsewhere.
  w.spaces[0].tabs.push({ id: "tab9", name: "Task 9", active: false, settled: false });
  w.panes.push({ pane: "p9", tab: "tab9", terminal: "t9", cwd: "/repo/a", focused: false, program: { agent: true, key: "codex", name: "Codex" } });
  w.terminals.push({ address: "t9", state: "live", pid: 9, status: "idle", turn: 1, records: {}, report: { app: "codex", state: "idle" } });
  w.agents.push({ address: "t9", status: "idle", pinned: false, seq: 9 });
  await settle();
  expect(tree.folded.has("sp:A")).toBe(true);
  expect(tree.list.some((r) => r.key === "tb:tab9")).toBe(false);
  const r = w.spaces[2]; reset();
  const gone = r.tabs.pop().id; w.panes = w.panes.filter((p) => p.tab !== gone); w.terminals = w.terminals.filter((t) => t.address !== "t4"); w.agents = w.agents.filter((a) => a.address !== "t4");
  await settle();
  expect(tree.rowViews.has(`tb:${gone}`)).toBe(false);
  expect(counts.releases).toBe(1);
  // The filter: another machine only, then all again.
  tree.setFilter("box", h.cx); await settle();
  tree.setFilter("all", h.cx); await settle();
  expect(tree.folded.has("sp:A")).toBe(true);
  // A new copy of the view (re-init) reads the folds back.
  const again = new h.Tree(); again.init({}, h.cx); h.tasks.length = 0; again.render(h.cx);
  expect(again.folded.has("sp:A")).toBe(true);
  expect(again.list.some((r) => r.key === "tb:tab1")).toBe(false);
});

test("an empty workspace folds and unfolds, and rapid toggles end where the clicks say", async () => {
  const w = world(); w.spaces.push({ id: "E", name: "Empty", folder: "/repo/e", machine: null, tabs: [] });
  const { h, tree, counts, reset } = await setup(w);
  reset();
  for (let i = 0; i < 6; i++) { h.byId("sp:E-fold").props.on_click({ click_count: 1 }, h.cx); tree.render(h.cx); for (const v of tree.rowViews.values()) v.render(); }
  expect([tree.folded.has("sp:E"), counts.creates, h.tasks.length]).toEqual([false, 0, 0]);
  h.byId("sp:E-fold").props.on_click({ click_count: 1 }, h.cx); tree.render(h.cx);
  expect(tree.folded.has("sp:E")).toBe(true);
});

// Review R1/R2: a host that redraws only the views it was told to (the root on notify(), a row view on notify(view)
// or when made), then the real registered handlers of what it drew.
const retained = async (w) => {
  const h = harness(w), dirty = new Set(); let root = false, tree;
  const make = h.cx.new;
  h.cx.new = (C, p) => { const v = make(C, p), rel = v.release; dirty.add(v); v.release = () => { dirty.delete(v); return rel(); }; return v; };
  h.cx.notify = (target) => { if (target) dirty.add(target); else root = true; };
  const settle = async () => {
    root = true;
    for (let i = 0; i < 10; i++) {
      if (root) { root = false; tree.render(h.cx); }
      const shown = new Set(tree.list.map((r) => tree.rowViews.get(r.key)));
      for (const v of [...dirty]) if (shown.has(v)) { dirty.delete(v); v.render(); }
      const tasks = h.tasks.splice(0);
      if (!tasks.length && !root) return;
      for (const task of tasks) await task(h.cx);
    }
    throw new Error("not settled");
  };
  tree = new h.Tree(); tree.init({}, h.cx); h.tasks.length = 0;
  await settle();
  return { h, tree, settle };
};
const twoPaneWorld = () => {
  const w = world();
  for (const s of w.spaces) { s.active = false; for (const t of s.tabs) t.active = false; }
  w.panes.push({ pane: "p5", tab: "tab1", terminal: "t5", focused: false, program: { agent: true, key: "codex", name: "Codex" } });
  w.terminals.push({ address: "t5", state: "live", pid: 5, status: "idle", records: {}, report: { app: "codex", state: "idle" } });
  w.agents.push({ address: "t5", status: "idle", pinned: false, seq: 5 });
  return w;
};

test("a pane moved to another tab, then its tab to another workspace, clicks and opens its menu for the new place", async () => {
  const w = twoPaneWorld(), { h, tree, settle } = await retained(w);
  expect(tree.list.find((r) => r.key === "pn:p5")?.tab.id).toBe("tab1");
  w.panes.find((p) => p.pane === "p5").tab = "tab2";
  await settle();
  h.calls.length = 0;
  h.byId("pn:p5").props.on_click({}, h.cx);
  expect(h.calls.find((c) => c[0] === "tab.select")?.[1].id).toBe("tab2");
  // Its tab moves to workspace B.
  const tab2 = w.spaces[0].tabs.find((t) => t.id === "tab2");
  w.spaces[0].tabs = w.spaces[0].tabs.filter((t) => t !== tab2); w.spaces[1].tabs.push(tab2);
  await settle();
  h.calls.length = 0;
  h.byId("pn:p5").props["on_mouse_down:right"]({}, h.cx);
  expect(h.overlays.at(-1)?.props?.target?.space).toBe("B");
  h.byId("pn:p5").props.on_click({}, h.cx);
  expect(h.calls.filter((c) => c[0] === "space.select" || c[0] === "tab.select").map((c) => c[1].id)).toEqual(["B", "tab2"]);
  // The tab row itself, moved: its click shows it in B.
  h.calls.length = 0;
  h.byId("tb:tab2").props.on_click({}, h.cx);
  expect(h.calls.find((c) => c[0] === "space.select")?.[1].id).toBe("B");
});

test("a row task queued before newer data and a fold makes no view or metadata for a row already gone", async () => {
  const w = twoPaneWorld(), { h, tree, settle } = await retained(w);
  // A render sees a new tab and queues its row task; the tab goes, and a fold reconciles, before that task runs.
  w.spaces[0].tabs.push({ id: "tab9", name: "Temporary", active: false });
  tree.render(h.cx);
  expect(h.tasks.length).toBeGreaterThan(0);
  w.spaces[0].tabs.pop();
  h.byId("sp:B-fold").props.on_click({ click_count: 1 }, h.cx);
  await settle();
  expect(tree.list.some((r) => r.key === "tb:tab9")).toBe(false);
  expect([tree.rowViews.has("tb:tab9"), tree.rowItems.has("tb:tab9"), tree.rowSigs.has("tb:tab9"), h.tasks.length]).toEqual([false, false, false, 0]);
  // A new row from the host still gets its view from one task; a fold after it still needs none.
  w.spaces[0].tabs.push({ id: "tab8", name: "Kept", active: false });
  tree.render(h.cx); expect(h.tasks.length).toBe(1);
  await settle();
  expect(tree.rowViews.has("tb:tab8")).toBe(true);
  h.byId("sp:B-fold").props.on_click({ click_count: 1 }, h.cx); tree.render(h.cx);
  expect(h.tasks.length).toBe(0);
});
