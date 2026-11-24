// The Factory's Map view (mods/pdk-factory/map.js), evaluated with a small GPUI element recorder and the real model:
// what it draws in Collapsed, with one lead open in place and in All expanded, for a native job (Core parents) and a
// relay job (no parent: the job's lead role leads), and what its own handlers do (clicks, the bound Esc / Enter /
// arrow actions, wheel, drag). Native layout, real input and the motion itself are checked on frames in a sandbox.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildBoard, sinceOf } from "../adapters/factory.js";
import { contrast, toHsl, fromHsl } from "../adapters/tokens.js";
import { teamParents } from "../adapters/team.js";
import { agentKind } from "../adapters/agents.js";
import { launchChoice, chipLabel } from "../adapters/models.js";
import * as M from "../adapters/factory-map.js";

const PACK = new URL("..", import.meta.url).pathname;
const claude = { key: "claude", name: "Claude Code", agent: true, shell: false };
const ARGV = ["claude", "--model", "claude-opus-5-5", "--effort", "xhigh"];

// Three jobs. job-a (native): lead-a working with a1, a2 working and a3 needing you. job-b (native): lead-b idle with
// b1 and a working sub-lead with s1, s2. job-r (relay: no Core parent, stampede labels): lead-r with r-build working
// and r-review, each in its own tab. Addresses t1… in this order.
function scene(status = {}, { msg = {}, extra = false, remote = false } = {}) {
  const terminals = [], panes = [], agents = [];
  let n = 0;
  const add = (name, st, parent = null, tab = null, labels = undefined) => {
    const address = remote && labels ? `studio-mac/t${++n}` : `t${++n}`, s = status[name] ?? st;
    terminals.push({ address, state: "live", status: s, name, program: claude, parent, labels, foreground: { argv: ARGV },
      report: { state: s, app: "claude", ...(msg[name] ? { msg: msg[name] } : {}) } });
    agents.push({ address, status: s });
    if (tab) panes.push({ pane: `p${n}`, tab, terminal: address, program: claude });
    return address;
  };
  const a = add("lead-a", "working", null, "a"); add("a1", "working", a); add("a2", "working", a); add("a3", "blocked", a);
  const b = add("lead-b", "idle", null, "b"); add("b1", "idle", b);
  const sub = add("sub", "working", b); add("s1", "idle", sub); add("s2", "working", sub);
  const job = (role) => ({ "stampede.job": "relay-1", "stampede.role": role });
  add("lead-r", "idle", null, "r1", job("lead")); add("r-build", "working", null, "r2", job("build")); add("r-review", "idle", null, "r3", job("review"));
  if (extra) add("b2", "idle", b);
  const spaces = [
    { id: "s1", name: "job-a", tabs: [{ id: "a", name: "main", index: 1 }] },
    { id: "s2", name: "job-b", branch: "master", tabs: [{ id: "b", name: "main", index: 1 }] },
    { id: remote ? "studio-mac/s3" : "s3", name: "job-r", ...(remote ? { machine: "studio-mac" } : {}),
      tabs: [{ id: "r1", name: "lead", index: 1 }, { id: "r2", name: "build", index: 2 }, { id: "r3", name: "review", index: 3 }] },
  ];
  const machines = [{ name: null, layout: "ready" }, ...(remote ? [{ name: "studio-mac", layout: "ready" }] : [])];
  return { board: buildBoard({ spaces, panes, terminals, agents, machines, focused: null }), terminals };
}
const SLOT = { width: 1200, height: 800 };
const T3 = { canvas: "#000000", surface: "#0a0a0a", foreground: "#f5f5f5", border: "#1f1f1f", input: "#2a2a2a", done: "#22c55e",
  blocked: "#facc15", accent: "#346bf1", muted: "#a1a1a1", dim: "#8a8a8a" };
const TOP = 76; // the wide header's height over the canvas (map.js TOP.wide)
const WIDTHS_TRIED = 8; // map.js: at most eight layouts per fit (fitScene's scale 1, SCALE.min and six halvings)

function harness({ reduce = false, slot: first = SLOT } = {}) {
  let slot = first, layouts = 0, inRender = 0, drawing = false, nodes = [], data = scene(), cutAt = 0;
  const el = () => {
    const rec = { calls: [], props: {}, kids: [] };
    const proxy = new Proxy(rec, { get(target, key) {
      if (key in target) return target[key];
      return (...args) => {
        if (key === "child") target.kids.push(args[0]);
        else if (key === "children") target.kids.push(...args[0]);
        else if (key === "when") { if (args[0]) args[1](proxy); }
        else {
          target.calls.push([key, ...args]);
          target.props[key === "on_action" || key === "on_mouse_down" || key === "on_mouse_up" ? `${key}:${args[0]}` : key] = key.startsWith("on_") && args.length > 1 ? args[1] : args.length > 1 ? args : args[0];
        }
        return proxy;
      };
    } });
    nodes.push(proxy);
    return proxy;
  };
  let built = 0, failOnce = false;
  const path = () => new Proxy({}, { get: (_, key) => (key === "build" ? () => { built++; return {}; } : () => path()) });
  const store = new Map();
  const deps = {
    div: el, h_flex: el, v_flex: el, theme: () => T3, settings: () => ({ zoom: 1 }), terminals: () => data.terminals,
    PathBuilder: { fill: path, stroke: path }, Background: { solid: (c) => ({ c, opacity: (a) => ({ c, a }) }) },
    window: { paint_path: (_p, ink) => el().paint(ink) },
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    TYPE: { xs: 11, sm: 12, base: 13, lg: 16 }, SPACE: { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, half: 2 },
    ROW: { compact: 24, base: 28, two: 40, touch: 44 }, RADIUS: { sm: 4, md: 6, lg: 8 }, NARROW: 768,
    withFont: (x) => x, monoFont: () => "Menlo", reduceMotion: () => reduce, keyed() {}, pointed() {}, since: () => "1m",
    kindMarker: (t, kind, size, color, id) => { if (failOnce) { failOnce = false; throw new Error("interrupted"); } return el().id(id).mark(size); },
    statusMarker: (t, word, id) => el().id(id).status(word),
    segmentedChoice: (t, id, items, value, onChange, opts) => el().id(id).items(items).value(value).change(onChange).opts(opts),
    textButton: (t, id, text, label, onClick) => el().id(id).text(text).on_click(onClick),
    contrast, toHsl, fromHsl, machineLabel: (m) => m || "This computer", sinceOf, teamParents, agentKind, launchChoice, chipLabel,
    // Each fitSearch step is one layout. cutAt = n: the nth layout from now is cut off (the host's interrupt:
    // uncatchable, the task just ends, and so does the generator it was in).
    M: { ...M, sceneOf: (...a) => { layouts++; if (drawing) inRender++; return M.sceneOf(...a); },
      fitSearch: (...a) => {
        const g = M.fitSearch(...a);
        let dead = false;
        return { next() {
          if (dead) return { done: true, value: undefined };
          layouts++; if (drawing) inRender++;
          if (cutAt && --cutAt === 0) { dead = true; throw new Error("interrupted"); }
          return g.next();
        } };
      } },
  };
  const src = readFileSync(join(PACK, "mods/pdk-factory/map.js"), "utf8").replace(/^import .*;\n/gm, "").replace(/^export /gm, "");
  const api = new Function(...Object.keys(deps), `${src}\nreturn { newMap, drawMap, bindMapKeys, setMode, setView, openLead, closeLead, selectOnMap, viewToggle, VIEWS, stalled };`)(...Object.values(deps));
  const opened = [], spawned = [], waits = [];
  const f = { atlas: api.newMap(), handle: { focused: 0, focus() { this.focused++; } }, obs: { agents: new Map() }, coreMs: new Map(), focusPane: (a) => opened.push(a) };
  // Tasks as the host runs them: a body starts at once; sleep(0) goes on at the next turn, a short sleep (the fade's
  // commit) waits for settle(), a long one (the layout watchdog's) for wake(). `spawned` holds the waiting commits.
  const task = { notify() { h.notified++; }, sleep: (ms) => (ms === 0 ? Promise.resolve() : new Promise((r) => (ms < 100 ? spawned : waits).push(r))) };
  const cx = { spawn: (fn) => { fn(task)?.catch?.(() => {}); } }; // the host logs a task's error; the task is gone
  const turn = () => new Promise((r) => setTimeout(r, 0));
  const h = {
    api, f, m: () => f.atlas, opened, spawned, nodes: () => nodes, src,
    setScene: (next) => { data = next; }, built: () => built, failNextRender: () => { failOnce = true; }, cutLayout: (n) => { cutAt = n; }, setSlot: (next) => { slot = next; }, layouts: () => layouts, slot: () => slot, inRender: () => inRender,
    // A draw, then the layout task's turns, then a draw again when it landed (as its notify would).
    render: async () => {
      const draw = () => { nodes = []; drawing = true; try { api.drawMap(f, cx, data.board, slot); } finally { drawing = false; } };
      draw();
      const before = f.atlas.layout;
      for (let i = 0; i < WIDTHS_TRIED + 2; i++) await turn();
      if (f.atlas.layout !== before) draw();
    },
    byId: (id) => nodes.find((n) => n.props.id === id),
    ids: (prefix) => nodes.map((n) => String(n.props.id ?? "")).filter((id) => id.startsWith(prefix)),
    notified: 0,
  };
  h.cx = { notify: () => { h.notified++; }, stop_propagation() {}, sleep: async () => {} };
  h.press = (id) => h.byId(id).props.on_click({}, h.cx);
  h.key = (k) => h.byId("map-canvas").props[`on_action:pdk_factory_map_${k}`]({}, h.cx);
  h.settle = async () => { for (const r of h.spawned.splice(0)) r(); await turn(); };
  // The host's layout reporting a drawn size: the card's (its wrapper is keyed by the agent) or the header's.
  h.drawnCard = (w, hgt = 98) => h.nodes().find((n) => String(n.props.id ?? "").startsWith("map-card-at-")).props.on_size_change({ width: w, height: hgt }, h.cx);
  h.drawnHeader = (hgt) => h.byId("map-header").props.on_size_change({ width: h.slot().width, height: hgt }, h.cx);
  h.wake = async () => { for (const r of waits.splice(0)) r(); await turn(); };
  h.calls = (name) => nodes.flatMap((n) => n.calls.filter((c) => c[0] === name));
  // The agents drawn: disc ids, sorted.
  h.drawn = () => h.ids("mn-t").filter((id) => !id.includes("needs")).sort((x, y) => Number(x.slice(4)) - Number(y.slice(4)));
  h.wheel = (dy, p = { x: 300, y: 300 }) => h.byId("map-canvas").props.on_scroll_wheel({ delta: { x: 0, y: dy }, local_position: p, touch_phase: "moved" }, h.cx);
  return h;
}
const at = (n) => [n.props.left, n.props.top];
const called = (n, name) => n.calls.some((c) => c[0] === name);
const text = (n) => (typeof n === "string" ? n : (n?.kids ?? []).map(text).join(" "));

test("Collapsed: only each job's top-level leads, relay job's too, with their team size and a needs-you mark", async () => {
  const h = harness();
  await h.render();
  expect(h.drawn()).toEqual(["mn-t1", "mn-t5", "mn-t10"]);
  expect(h.byId("map-mode").props.value).toBe("collapsed");
  expect(h.byId("map-mode").props.items.map((i) => i.label)).toEqual(["Collapsed", "All expanded"]);
  expect(text(h.byId("mb-t10"))).toContain("2 helpers"); // the relay job's lead leads its job's other agents
  expect(text(h.byId("mb-t5"))).toContain("4 helpers");
  expect([h.byId("mn-needs-t1") != null, h.byId("mn-needs-t5") != null, h.byId("mn-needs-t10") != null]).toEqual([true, false, false]);
  expect(text(h.byId("map-sub"))).toContain("1 needs you");
});

test("a click on a lead opens its whole team in place; another lead switches; a second click or Esc folds it", async () => {
  const h = harness();
  await h.render();
  const before = at(h.byId("mn-t10"));
  h.press("mn-t5"); await h.render();
  expect([h.m().nav.open, h.m().nav.selected]).toEqual(["t5", "t5"]);
  expect(h.drawn()).toEqual(["mn-t1", "mn-t5", "mn-t6", "mn-t7", "mn-t8", "mn-t9", "mn-t10"]); // any depth, the others stay
  // The other leads move aside natively (same element, a transition), the newcomers wait at 0 and fade in.
  expect(at(h.byId("mn-t10"))).not.toEqual(before);
  expect(h.byId("mn-t10").calls.filter((c) => c[0] === "transition").map((c) => c[1])).toEqual(["left", "top", "width", "height"]);
  expect([h.byId("mn-t10").props.opacity, h.byId("mn-t8").props.opacity]).toEqual([1, 0]);
  await h.settle(); await h.render();
  expect(h.byId("mn-t8").props.opacity).toBe(1);
  h.press("mn-t1"); await h.render();
  expect(h.drawn()).toEqual(["mn-t1", "mn-t2", "mn-t3", "mn-t4", "mn-t5", "mn-t10"]);
  h.press("mn-t1"); await h.render();
  expect([h.m().nav.open, h.drawn().length]).toEqual([null, 3]);
  h.press("mn-t10"); await h.render();
  expect(h.drawn()).toEqual(["mn-t1", "mn-t5", "mn-t10", "mn-t11", "mn-t12"]); // the relay job opens the same way
  h.press("mn-t11"); await h.render();
  expect(h.m().nav.selected).toBe("t11");
  h.key("escape"); await h.render();
  expect([h.m().nav.open, h.m().nav.selected]).toEqual(["t10", null]);
  h.key("escape"); await h.render();
  expect([h.m().nav.open, h.drawn().length]).toEqual([null, 3]);
});

test("All expanded: everyone, the relay job's helpers linked to its lead, the sub-lead's to the sub-lead", async () => {
  const h = harness();
  h.api.setMode(h.m(), "expanded"); await h.render();
  expect(h.drawn().length).toBe(12);
  expect(h.byId("map-mode").props.value).toBe("expanded");
  const links = M.sceneOf(M.mapTree(scene().board, teamParents(scene().terminals)), h.m().nav).links.map((l) => `${l.from}>${l.to}`);
  expect(links).toEqual(expect.arrayContaining(["t10>t11", "t10>t12", "t7>t8", "t5>t7", "t1>t4"]));
  // Lead, sub-lead and helper read differently (design review B3): only a lead wears a pill (13); a sub-lead has a
  // plain 12/500 name, a helper a plain 11 one.
  const size = (id) => h.nodes().find((n) => n.props.id === id).kids.find((k) => k.props.text_size)?.props.text_size;
  expect([size("mp-t5"), h.byId("mp-t7"), h.byId("mt-t7").props.text_size, called(h.byId("mt-t7"), "font_medium")]).toEqual([13, undefined, 12, true]);
  expect([h.byId("mt-t8").props.text_size, called(h.byId("mt-t8"), "font_medium")]).toEqual([11, false]);
});

test("every mode fits its content to the free view, centred, clear of the header and the card", async () => {
  const h = harness();
  const check = (bottom) => {
    const sc = h.m().layout.scene, cam = h.m().cam, full = h.slot();
    const [x0, y0] = M.toScreen(cam, full, sc.bounds.x, sc.bounds.y), [x1, y1] = M.toScreen(cam, full, sc.bounds.x + sc.bounds.w, sc.bounds.y + sc.bounds.h);
    expect(x0).toBeGreaterThanOrEqual(0); expect(x1).toBeLessThanOrEqual(full.width);
    expect(y0).toBeGreaterThanOrEqual(TOP); expect(y1).toBeLessThanOrEqual(full.height - bottom);
    expect(Math.abs(x0 - (full.width - x1))).toBeLessThan(1); // centred across
  };
  await h.render(); check(0);
  h.press("mn-t5"); await h.render(); check(0); // the lead is selected as it opens: the card takes no room (F2)
  h.api.setMode(h.m(), "expanded"); await h.render(); check(0);
  h.api.selectOnMap(h.m(), null); // the fit alone (a selection may pan pills clear of the card: tested below)
  h.setSlot({ width: 390, height: 800 }); await h.render();
  const sc = h.m().layout.scene, [, y0] = M.toScreen(h.m().cam, h.slot(), sc.bounds.x, sc.bounds.y);
  expect(y0).toBeGreaterThanOrEqual(116);
});

test("a change refits unless the person zoomed or panned since; Esc with nothing to fold fits again", async () => {
  const h = harness();
  await h.render();
  const fitted = { ...h.m().cam };
  h.press("mn-t5"); await h.render();
  expect(h.m().cam).not.toEqual(fitted);
  const open = { ...h.m().cam };
  h.wheel(60);
  const zoomed = { ...h.m().cam };
  expect(zoomed.scale).toBeGreaterThan(open.scale);
  h.press("mn-t1"); await h.render();
  expect(h.m().cam).toEqual(zoomed); // the person's camera stays
  h.key("escape"); await h.render(); // folds t1
  h.key("escape"); await h.render(); // nothing left to fold: fit
  expect(h.m().cam).toEqual(fitted);
  const canvas = h.byId("map-canvas");
  canvas.props["on_mouse_down:left"]({ position: { x: 100, y: 100 } }, h.cx);
  canvas.props.on_mouse_move({ position: { x: 160, y: 130 } }, h.cx);
  canvas.props["on_mouse_up:left"]({ position: { x: 160, y: 130 } }, h.cx);
  expect([h.m().cam.x, h.m().cam.y]).toEqual([fitted.x - 60 / fitted.scale, fitted.y - 30 / fitted.scale]);
  h.setSlot({ width: 1000, height: 700 }); await h.render();
  expect(h.m().cam.x).toBe(fitted.x - 60 / fitted.scale); // panned: a resize keeps it too
});

test("the wheel zooms round the pointer in both modes", async () => {
  for (const mode of ["collapsed", "expanded"]) {
    const h = harness();
    h.api.setMode(h.m(), mode); await h.render();
    const cam0 = { ...h.m().cam }, p = { x: 300, y: 300 }, full = h.slot();
    const world = (cam) => [cam.x + (p.x - full.width / 2) / cam.scale, cam.y + (p.y - full.height / 2) / cam.scale];
    h.wheel(120, p); // GPUI's delta is positive for a scroll up: zoom in
    expect(h.m().cam.scale).toBeCloseTo(Math.min(M.SCALE.max, cam0.scale * 2), 5);
    world(h.m().cam).forEach((v, i) => expect(v).toBeCloseTo(world(cam0)[i], 5));
  }
});

test("the card: name once, then state and how long, role, model, its last line; Enter and Open pane open the pane", async () => {
  const h = harness();
  h.setScene(scene({}, { msg: { a3: "Bash wants to run: git push" } }));
  h.f.obs.agents.set("t4", { wordAt: Date.now() - 60000 }); // seen changing a minute ago
  await h.render();
  h.press("mn-t1"); await h.render();
  h.press("mn-t4"); await h.render();
  const card = h.byId("map-card");
  expect(text(card).split("a3").length - 1).toBe(1);
  expect(text(h.byId("map-card-facts"))).toBe(" needs you 1m · helper of lead-a · opus-5-5 · xhigh");
  expect(h.byId("map-card-status").props.status).toBe("needs");
  expect(text(h.byId("map-card-line"))).toBe("Bash wants to run: git push");
  h.key("enter");
  h.press("map-open");
  expect(h.opened).toEqual(["t4", "t4"]);
  h.press("mn-t1"); await h.render(); // folding the lead: lead-a's card, no line that only repeats the name
  h.press("mn-t1"); await h.render();
  expect(text(h.byId("map-card-facts"))).toContain("lead · opus-5-5 · xhigh");
  expect(h.byId("map-card-line")).toBeUndefined();
  const relay = harness();
  await relay.render(); relay.press("mn-t10"); await relay.render(); relay.press("mn-t11"); await relay.render();
  expect(text(relay.byId("map-card-facts"))).toContain("helper of lead-r");
});

test("a helper that needs you says so: its ring and edge, the shared mark beside its name, the card", async () => {
  const h = harness();
  h.api.openLead(h.m(), "t1"); await h.render();
  expect(h.byId("ms-t4").props.status).toBe("needs");
  expect(h.byId("mt-t4").props.text_color).toBe(T3.foreground);
  expect(new Set([h.byId("mn-t4").props.border_color, h.byId("mn-t2").props.border_color, T3.border]).size).toBe(3);
  const decor = h.byId(h.ids("map-decor-")[0]);
  expect(decor.kids.filter((k) => k.props.paint === T3.blocked).length).toBe(1);
});

test("each label sits on one canvas patch drawn after the links, in every mode", async () => {
  for (const go of [(h) => h, (h) => h.api.openLead(h.m(), "t5"), (h) => h.api.setMode(h.m(), "expanded")]) {
    const h = harness();
    go(h); await h.render();
    const order = h.byId("map-canvas").kids.map((k) => String(k.props.id ?? ""));
    const links = order.findIndex((id) => id.startsWith("map-decor-"));
    expect(links).toBeGreaterThan(-1);
    for (const [i, id] of order.entries()) if (id.startsWith("mn-")) expect(i).toBeGreaterThan(links);
    for (const id of h.ids("mb-")) expect(h.byId(id).props.bg).toBe(T3.canvas);
  }
});

test("calm: no travelling dot or loop in any mode; under Reduce Motion no glide or fade either", async () => {
  const live = harness();
  live.api.setMode(live.m(), "expanded"); await live.render();
  expect([live.calls("loop").length, live.ids("mdot-").length]).toEqual([0, 0]);
  const h = harness({ reduce: true });
  await h.render();
  h.press("mn-t5"); await h.render();
  h.api.setMode(h.m(), "expanded"); await h.render();
  expect([h.calls("loop").length, h.calls("transition").length, h.spawned.length]).toEqual([0, 0, 0]);
  expect(h.nodes().filter((n) => n.props.opacity === 0)).toEqual([]);
});

test("the layout is kept across drag, wheel and status renders; statuses still show at once", async () => {
  const h = harness();
  h.api.setMode(h.m(), "expanded"); await h.render();
  const once = h.layouts();
  h.wheel(60); await h.render();
  const canvas = h.byId("map-canvas");
  canvas.props["on_mouse_down:left"]({ position: { x: 100, y: 100 } }, h.cx);
  canvas.props.on_mouse_move({ position: { x: 150, y: 120 } }, h.cx); await h.render();
  h.setScene(scene({ b1: "working", s1: "blocked" })); await h.render();
  expect(h.layouts()).toBe(once);
  expect(h.byId("mn-t6").props.border_color).toBe(h.byId("mn-t2").props.border_color);
  expect(h.byId("ms-t8").props.status).toBe("needs"); // s1 now needs you: the shared mark beside its name
  h.setScene(scene({}, { extra: true })); await h.render();
  expect(h.layouts()).toBeGreaterThan(once); // a new tree shape lays it out again (a few widths, see below)
});

// QA 2155 item 5: text keeps its px size, so the model lays a scene out for the scale it is shown at (fitScene). The
// view takes fitScene's loop one layout per call (a render, or a call, that runs too long is dropped); it must land
// exactly where fitScene does.
test("the layout task lands where the model's fitScene does, at sizes that fit and with the tiers' fallback", async () => {
  for (const [mode, slot] of [["expanded", SLOT], ["collapsed", SLOT], ["expanded", { width: 900, height: 600 }], ["expanded", { width: 800, height: 300 }]]) {
    const h = harness({ slot });
    h.api.setMode(h.m(), mode);
    await h.render(); await h.render();
    const tree = M.mapTree(scene().board, teamParents(scene().terminals));
    const { scene: want, cam } = M.fitScene(tree, h.m().nav, h.slot(), 32, { top: TOP, bottom: 0 });
    expect([mode, slot, h.m().layout.scene.bounds]).toEqual([mode, slot, want.bounds]);
    expect(h.m().layout.cam).toEqual(cam);
  }
});

test("keys: Esc, Enter and the arrows bound once under the Map's own context; header presses hand them back", async () => {
  const h = harness();
  const bound = [];
  const cx = { bind_keys: (l) => { bound.push(...l); return l.length; } };
  h.api.bindMapKeys(cx); h.api.bindMapKeys(cx);
  expect(bound).toEqual(["escape", "enter", "up", "down", "left", "right"].map((k) => ({ keystroke: k, action: `pdk_factory_map_${k}`, context: "PdkFactoryMap" })));
  await h.render();
  const canvas = h.byId("map-canvas");
  expect([canvas.props.key_context, canvas.props.track_focus]).toEqual(["PdkFactoryMap", h.f.handle]);
  expect(canvas.kids.some((k) => k.props.id === "map-header")).toBe(false);
  h.key("down"); await h.render();
  expect(h.m().nav.selected).toBe("t1");
  h.key("down"); await h.render();
  expect(h.m().nav.selected).toBe("t5");
  const start = h.f.handle.focused;
  h.byId("map-mode").props.change("expanded", null, h.cx); await h.render();
  h.byId("factory-view").props.change("board", null, h.cx);
  expect(h.f.handle.focused).toBe(start + 2);
});

test("the header is the title, where, the mode and Map / Board; narrow puts the mode on its own row", async () => {
  const h = harness();
  await h.render();
  for (const gone of ["map-level", "map-crumbs", "map-hint", "map-count-working"]) expect(h.byId(gone)).toBeUndefined();
  expect(h.src).not.toMatch(/crumb|gotoLevel|levelOf|zoomStep|LIVE_DOT|map-hint|LEVEL/);
  const n = harness({ slot: { width: 390, height: 800 } });
  await n.render();
  const rows = n.byId("map-header").kids;
  const has = (row, id) => JSON.stringify(row, (k, v) => (k === "calls" ? undefined : v)).includes(`"id":"${id}"`);
  expect([has(rows[0], "factory-view"), has(rows[0], "map-mode"), has(rows.at(-1), "map-mode")]).toEqual([true, false, true]);
});

test("Map / Board: the Map first and the default; the choice and the mode are remembered", async () => {
  const h = harness();
  expect(h.api.VIEWS.map((v) => v.value)).toEqual(["map", "board"]);
  expect(h.m().view).toBe("map");
  h.api.setView(h.m(), "board");
  h.api.setMode(h.m(), "expanded");
  const again = h.api.newMap();
  expect([again.view, again.nav.mode]).toEqual(["board", "expanded"]);
});

test("select:<terminal> in Collapsed opens that agent's lead and selects it; close folds it", async () => {
  const h = harness();
  await h.render();
  h.api.selectOnMap(h.m(), "t8"); await h.render();
  expect([h.m().nav.open, h.m().nav.selected]).toEqual(["t5", "t8"]);
  h.api.closeLead(h.m()); await h.render();
  expect([h.m().nav.open, h.m().nav.selected]).toEqual([null, null]);
  h.api.openLead(h.m(), "t10"); await h.render();
  expect(h.drawn()).toContain("mn-t12");
});

// QA 2155 item 10: under All, a job's heading says which machine it is on, quietly; one machine, no word.
test("with two machines shown each job's heading names its machine; with one it doesn't", async () => {
  const h = harness();
  h.setScene(scene({}, { remote: true }));
  h.api.setMode(h.m(), "expanded"); await h.render();
  // Its machine, then its branch; no count (design review 4: the header and the leads count already).
  expect(text(h.byId("mh-studio-mac/s3"))).toBe("JOB-R studio-mac");
  expect(text(h.byId("mh-s2"))).toBe("JOB-B This computer · master");
  const one = harness();
  one.api.setMode(one.m(), "expanded"); await one.render();
  expect(text(one.byId("mh-s2"))).not.toContain("This computer");
});

// QA 2155 item 7: a quiet team's ring is one still hairline, not a dashed grey ring that reads as loading.
test("a folded lead's team ring: one quiet track round it, an arc only per helper working or needing you", async () => {
  const h = harness();
  h.setScene(scene({ a1: "idle", a2: "idle", a3: "idle", sub: "idle", s2: "idle", "r-build": "idle" }));
  await h.render();
  const decor = h.byId(h.ids("map-decor-")[0]);
  expect(decor.kids.filter((k) => k.props.paint === T3.input).length).toBe(1); // the tracks, one path; no links here
  expect(decor.kids.filter((k) => k.props.paint === "#22c55e" || k.props.paint === T3.blocked).length).toBe(0);
  h.setScene(scene()); await h.render();
  const busy = h.byId(h.ids("map-decor-")[0]);
  expect(busy.kids.filter((k) => k.props.paint === T3.blocked).length).toBe(2); // lead-a's needs arc and its caps
});

// QA 2155 item 11 ("This view could not be re-rendered" after All expanded + selecting the remote build-relay-config):
// the select and card path with a remote agent whose record is missing or partial must still draw.
test("All expanded, selecting a remote helper whose terminal record is missing or partial still draws its card", async () => {
  const h = harness();
  const data = scene({ "r-build": "blocked" }, { remote: true, msg: { "r-build": "Bash wants to run: git push origin relay-config" } });
  h.setScene({ board: data.board, terminals: data.terminals.filter((t) => t.name !== "r-build") });
  h.api.setMode(h.m(), "expanded"); await h.render();
  h.api.selectOnMap(h.m(), "studio-mac/t11"); await h.render();
  expect(h.byId("map-card")).toBeDefined();
  // No record, so no labels to place it under its lead: it draws as its own, with its kind from the board.
  expect(text(h.byId("map-card-facts"))).toContain("needs you · lead · Claude Code");
  expect(text(h.byId("map-card-line"))).toBe("Bash wants to run: git push origin relay-config");
  h.setScene({ board: data.board, terminals: data.terminals.map((t) => (t.name === "r-build" ? { ...t, foreground: { argv: "claude" } } : t)) });
  await h.render();
  expect(text(h.byId("map-card-facts"))).toContain("needs you · helper of lead-r · Claude Code");
  h.key("enter");
  expect(h.opened).toEqual(["studio-mac/t11"]);
});

// A window being resized refits at once: no glide, no fade (the drawing around the agents never blinks out).
test("a new size snaps to the new fit; only a change of what is shown glides and fades", async () => {
  const h = harness();
  await h.render();
  h.press("mn-t5"); await h.render(); // a change of what is shown: one glide and its commit render
  expect(h.spawned.length).toBe(1);
  h.spawned.length = 0;
  h.m().glideAt = -Infinity; // later: that glide has ended
  const decor = h.ids("map-decor-")[0], cam = { ...h.m().cam };
  for (const width of [1100, 1000, 900]) { h.setSlot({ width, height: 760 }); await h.render(); }
  expect(h.m().cam).not.toEqual(cam);
  expect([h.spawned.length, h.ids("map-decor-")[0], h.calls("transition").length]).toEqual([0, decor, 0]);
});

// QA 2155 item 11: a render that runs past the host's budget is dropped ("This view could not be re-rendered …
// interrupted") and, with the layout memo unwritten, retried the same way for good. A layout costs 10-30 ms in the
// app's engine (measured in the sandbox: 13 ms one lead open, 22 ms All expanded), so no render ever lays out.
test("no render lays the map out: layouts run in a task and the render draws the last laid-out scene", async () => {
  const h = harness();
  const data = scene({}, { remote: true });
  h.setScene(data);
  h.render(); // the very first draw: no layout yet, the header alone
  expect([h.byId("map-header") != null, h.byId("map-canvas")]).toEqual([true, undefined]);
  await h.render();
  h.press("mn-t5"); await h.render();
  h.api.setMode(h.m(), "expanded"); await h.render();
  h.api.selectOnMap(h.m(), "studio-mac/t11"); await h.render();
  h.setSlot({ width: 1000, height: 700 }); await h.render();
  h.setScene(scene({ b1: "working" }, { remote: true, extra: true })); await h.render();
  expect(h.layouts()).toBeGreaterThan(0);
  expect(h.inRender()).toBe(0);
  expect(h.byId("map-card")).toBeDefined();
});

// The frame trick (maximise, restore) and a live window resize: a re-wrap on its way never holds the camera, and a
// size seen before is drawn again at once from the kept layouts.
test("a resize fits the drawn scene at once, and a size seen before lays nothing out again", async () => {
  const h = harness();
  h.api.setMode(h.m(), "expanded"); await h.render();
  const fittedIn = (full) => {
    const b = h.m().layout.scene.bounds, cam = h.m().cam;
    const [x0, y0] = M.toScreen(cam, full, b.x, b.y), [x1, y1] = M.toScreen(cam, full, b.x + b.w, b.y + b.h);
    return x0 >= 0 && x1 <= full.width && y0 >= TOP && y1 <= full.height;
  };
  const big = { width: 1600, height: 900 };
  h.setSlot(big); h.render(); // drawn before the re-wrap lands: still fitted to the new size
  expect(fittedIn(big)).toBe(true);
  await h.render();
  const n = h.layouts();
  h.setSlot(SLOT); await h.render();
  h.setSlot(big); await h.render();
  expect(h.layouts()).toBe(n); // both sizes laid out once
  expect(fittedIn(big)).toBe(true);
});

// A helper's name shown below its tier (selected, or needing you) takes its own width, not the room the layout kept
// for hidden names (none): "ship-notes", not "ship-no…".
test("a forced helper name keeps its whole width when helper names are thinned out", async () => {
  const h = harness();
  h.api.setMode(h.m(), "expanded"); await h.render();
  h.m().cam = { ...h.m().cam, scale: 0.4 }; h.m().moved = true; await h.render();
  const label = h.byId("ml-t4");
  expect(label.props.w).toBeGreaterThanOrEqual([..."a3"].length * 11 * 0.62 + 24);
  expect(h.byId("mn-t4").kids.some((k) => k.props.id === "ml-t4")).toBe(true); // shown: it needs you
});

// QA 2155 item 11 at 2001fef: a render's calls into the host add up (each a bridge call; the 50 ms render budget is
// a few thousand of them), so the drawing round the agents is built once per camera, size and scene, not per render.
test("paths are built once and reused while nothing they draw has changed", async () => {
  const h = harness();
  h.api.setMode(h.m(), "expanded"); await h.render();
  const once = h.built();
  await h.render(); await h.render();
  expect(h.built()).toBe(once); // no new paths: same camera, size and statuses
  h.wheel(60); await h.render();
  expect(h.built()).toBeGreaterThan(once); // the camera moved: drawn again
  const moved = h.built();
  h.setScene(scene({ b1: "working" })); await h.render();
  expect(h.built()).toBeGreaterThan(moved); // a status changed what is drawn
});

// QA 2155 item 11: a dropped render keeps the last frame until something asks for another; the Factory's
// once-a-second look asks when a render began and never ended.
test("a render that never ends is seen as stalled, and the next render clears it", async () => {
  const h = harness();
  await h.render();
  h.failNextRender();
  h.m().drawing = Date.now(); // the Factory's render began
  expect(() => h.api.drawMap(h.f, { spawn() {} }, scene().board, h.slot())).toThrow("interrupted");
  expect([h.api.stalled(h.m()), h.api.stalled(h.m(), Date.now() + 300)]).toEqual([false, true]); // 0.2 s: a render can't take that long
  h.m().drawing = Date.now(); await h.render();
  expect(h.api.stalled(h.m(), Date.now() + 1500)).toBe(false);
  // The Factory's look does the asking (main.js): a stalled Map is drawn again.
  const main = readFileSync(join(PACK, "mods/pdk-factory/main.js"), "utf8");
  expect(main).toMatch(/cx\.timer\.every\(250, \(cx\) => \{ if \(stalled\(this\.atlas\) && this\.shown\(\)\) \{ this\.atlas\.drawing = 0; cx\.notify\(\); \} \}\);/);
  expect(main).toMatch(/if \(this\.atlas\?\.view === "map"\) this\.atlas\.drawing = Date\.now\(\);/);
});

// Design review B2 (model d4855dd): each name shows from the camera scale the model kept its room for (nameAt), so
// All expanded names everyone at its fit; zoomed out further the names go, a disc then tells its name on hover, and a
// selected or needs-you name stays at the width it was laid out with.
test("names show from their nameAt: everyone at the fit, a tooltip instead when zoomed out, forced names whole", async () => {
  const h = harness({ slot: { width: 700, height: 520 } });
  h.api.setMode(h.m(), "expanded"); await h.render();
  expect(h.m().cam.scale).toBeLessThan(M.LABELS.full); // under the old helper tier, still named
  const shown = (k) => h.byId(`mn-${k}`).kids.some((c) => c.props.id === `ml-${k}`);
  const keys = h.drawn().map((id) => id.slice(3));
  expect(keys.filter(shown)).toEqual(keys);
  expect(keys.map((k) => h.byId(`mn-${k}`).props.tooltip).filter(Boolean)).toEqual([]); // no tooltip repeats a name
  h.m().cam = { ...h.m().cam, scale: h.m().cam.scale / 2 }; h.m().moved = true; await h.render();
  expect(keys.filter(shown)).toEqual(["t4"]); // a3 needs you
  expect(h.byId("mn-t6").props.tooltip).toBe("b1");
  const n4 = h.m().layout.scene.nodes.find((n) => n.key === "t4");
  expect(h.byId("ml-t4").props.w).toBeCloseTo(n4.labelW * n4.nameAt + 16, 6);
});

// Design review 5 and 6: what a press reaches keeps the arrow, the empty canvas the grab hand; the selection ring
// sits outside the status ring, so a selected helper that needs you shows both.
test("arrow cursor on discs and labels, grab on the canvas; the selection ring clears the status ring", async () => {
  const h = harness();
  await h.render(); h.api.selectOnMap(h.m(), "t4"); await h.render();
  expect(called(h.byId("map-canvas"), "cursor_grab")).toBe(true);
  for (const id of ["mn-t1", "mp-t1", "mn-t4", "mb-t4"]) expect(called(h.byId(id), "cursor_default")).toBe(true);
  const R = h.byId("mn-t4").props.w / 2, ring = h.byId("msel-t4"), inner = ring.props.w / 2 - ring.props.border;
  expect(inner).toBeGreaterThan(R + 6 + 1.5 / 2); // past the needs ring (6 off the disc, 1.5 wide)
  expect(ring.props.left).toBe(R - ring.props.w / 2);
});

// Design review B1: "Collapsed" is lit while a team is open; a press on it folds the team, even with a helper chosen.
test("a press on the lit Collapsed folds the open team; it reaches the view because the toggle passes it", async () => {
  const h = harness();
  await h.render(); h.api.selectOnMap(h.m(), "t8"); await h.render();
  expect([h.m().nav.open, h.byId("map-mode").props.value, h.byId("map-mode").props.opts.again]).toEqual(["t5", "collapsed", true]);
  h.byId("map-mode").props.change("collapsed", null, h.cx); await h.render();
  expect([h.m().nav.open, h.m().nav.selected, h.m().nav.mode]).toEqual([null, null, "collapsed"]);
  h.byId("map-mode").props.change("collapsed", null, h.cx); await h.render(); // nothing open: nothing changes
  expect([h.m().nav.open, h.m().nav.mode, h.drawn().length]).toEqual([null, "collapsed", 3]);
  h.byId("map-mode").props.change("expanded", null, h.cx); h.byId("map-mode").props.change("expanded", null, h.cx); await h.render();
  expect(h.m().nav.mode).toBe("expanded");
});

// Review 2155 (map.js:481): a folded lead's team line keeps its room at every scale with its pill (model 8aa8540), so
// it shows at every scale too: with a team open at a size that fits under 0.55, the other folded leads keep theirs.
test("a folded lead's team line shows at any scale, with its pill: one team open, the others keep their lines", async () => {
  const h = harness({ slot: { width: 520, height: 420 } });
  await h.render(); h.api.openLead(h.m(), "t5"); await h.render();
  expect(h.m().cam.scale).toBeLessThan(0.55);
  expect([text(h.byId("mb-t1")), text(h.byId("mb-t10"))]).toEqual([expect.stringContaining("3 helpers"), expect.stringContaining("2 helpers")]);
  expect(text(h.byId("mb-t5"))).not.toContain("helpers"); // the open lead's team is on screen: no line
});

// QA 2155 after 569d038 (fmap2, load 70): one layout in the search ran past a task's 500 ms, the host cut the task off,
// and the view stayed on the Collapsed scene with "All expanded" lit, for good. A search silent for 1 s is dead: the
// Factory's look (or the watchdog) asks for a render and the render starts it again; the cut ended its generator, so
// that key's search starts over.
test("a layout search cut off mid-way starts again; the view never stays on the old scene", async () => {
  const slot = { width: 700, height: 520 }; // All expanded bisects here
  const whole = harness({ slot });
  await whole.render();
  const before = whole.layouts();
  whole.api.setMode(whole.m(), "expanded"); await whole.render();
  const steps = whole.layouts() - before;
  expect(steps).toBeGreaterThan(3);
  const h = harness({ slot });
  await h.render();
  const start = h.layouts();
  h.cutLayout(3);
  h.api.setMode(h.m(), "expanded"); await h.render(); await h.render();
  expect(h.drawn().length).toBe(3); // the search died: still Collapsed's scene
  expect(h.api.stalled(h.m())).toBe(false);
  expect(h.api.stalled(h.m(), Date.now() + 1500)).toBe(true); // the Factory's look asks for a render
  h.m().pendingAt -= 1500; await h.render();
  expect(h.drawn().length).toBe(12);
  expect(h.layouts() - start).toBe(3 + steps); // two done, the cut one, then the search again from its start
  expect(h.m().layout.scene.bounds).toEqual(whole.m().layout.scene.bounds);
  expect(h.api.stalled(h.m(), Date.now() + 2500)).toBe(false);
});

// Review 2155 F1: a search cut off, then a view whose layout is already there (Collapsed) or the Board, must not leave
// the Map "stalled" for good (the look would redraw it every second).
test("a cut-off search for a view left behind is dropped: not stalled in Collapsed or on the Board", async () => {
  for (const leave of [(h) => h.api.setMode(h.m(), "collapsed"), (h) => h.api.setView(h.m(), "board")]) {
    const h = harness({ slot: { width: 700, height: 520 } });
    await h.render();
    h.cutLayout(2); h.api.setMode(h.m(), "expanded"); await h.render();
    expect(h.api.stalled(h.m(), Date.now() + 1500)).toBe(true);
    leave(h); if (h.m().view === "map") await h.render();
    expect([h.api.stalled(h.m(), Date.now() + 1500), h.api.stalled(h.m(), Date.now() + 60000)]).toEqual([false, false]);
  }
});

// N2: a cut is noticed by a watchdog task of its own (the cut ends only the task it hits), not only by the 1 s look.
test("the layout watchdog asks for a render once a search goes silent", async () => {
  const h = harness({ slot: { width: 700, height: 520 } });
  await h.render();
  h.cutLayout(2); h.api.setMode(h.m(), "expanded"); await h.render();
  const before = h.notified;
  await h.wake(); // not silent long enough yet: it waits again
  expect(h.notified).toBe(before);
  h.m().pendingAt -= 1500; await h.wake();
  expect(h.notified).toBe(before + 1);
  await h.render();
  expect(h.drawn().length).toBe(12);
});

// Review 2155 F2 and the design reviews (f593b53, 1f1916c): a selection never refits or shrinks the map; the card is
// as wide as its words; once it is drawn (its measured rect) the camera pans up the least that keeps the chosen agent
// and every lead's pill clear of it, never lifting the content above the header's drawn bottom.
const pillBottom = (h, k) => h.byId(`mn-${k}`).props.top + h.byId(`ml-${k}`).props.top + 26;
const contentTop = (h) => M.toScreen(h.m().cam, h.slot(), 0, h.m().layout.scene.bounds.y)[1];
const lowLeft = (h, maxX = 560) => h.m().layout.scene.nodes.filter((x) => M.toScreen(h.m().cam, h.slot(), x.x, x.y)[0] < maxX).sort((a, b) => b.y - a.y)[0];
test("selecting never lays out or rescales; with the card drawn, the least pan clears the chosen agent and the pills it covers", async () => {
  for (const reduce of [false, true]) {
    const h = harness({ reduce, slot: { width: 1200, height: 560 } });
    h.api.setMode(h.m(), "expanded"); await h.render();
    const n = h.layouts(), cam = { ...h.m().cam }, key = h.m().layout.key, low = lowLeft(h);
    h.api.selectOnMap(h.m(), low.key); await h.render();
    expect(h.m().cam).toEqual(cam); // the card isn't drawn yet: nothing moves
    const card = h.byId("map-card");
    expect([card.props.w, card.props.min_w, card.props.max_w]).toEqual([undefined, 320, 560]); // as wide as its words
    h.drawnCard(370); await h.render();
    expect([h.layouts(), h.m().layout.key, h.m().cam.scale, h.m().cam.x]).toEqual([n, key, cam.scale, cam.x]);
    expect(h.m().cam.y).toBeGreaterThan(cam.y); // panned up
    const cardTop = 560 - 24 - 98 - 16;
    const disc = h.byId(`mn-${low.key}`), label = h.byId(`ml-${low.key}`);
    const bottoms = [disc.props.top + label.props.top + (low.role === "lead" ? 26 : 16)];
    for (const x of h.m().layout.scene.nodes.filter((x) => x.role === "lead" && x.key !== low.key)) {
      const left = h.byId(`mn-${x.key}`).props.left + h.byId(`ml-${x.key}`).props.left + 8; // the patch's SPACE[4]/2
      if (left < 24 + 370) bottoms.push(pillBottom(h, x.key));
    }
    for (const b of bottoms) expect(b).toBeLessThanOrEqual(cardTop + 1e-6);
    expect(Math.max(...bottoms)).toBeGreaterThan(cardTop - 1); // the least: the lowest one just clear
    expect(contentTop(h)).toBeGreaterThanOrEqual(TOP + 8 - 1e-6);
    expect(h.calls("transition").length > 0).toBe(!reduce);
    const panned = { ...h.m().cam };
    await h.render();
    expect(h.m().cam).toEqual(panned); // once per selection
  }
});

test("no pan when the drawn card covers nothing", async () => {
  const h = harness(); // Collapsed at 1200 x 800: a row of three hubs, room under it
  await h.render();
  const cam = { ...h.m().cam };
  expect(M.toScreen(cam, h.slot(), 0, h.m().layout.scene.bounds.y + h.m().layout.scene.bounds.h)[1]).toBeLessThan(800 - 24 - 98 - 16);
  h.api.selectOnMap(h.m(), "t10"); await h.render();
  h.drawnCard(370); await h.render();
  expect([h.m().cam, h.calls("transition").length]).toEqual([cam, 0]);
});

// The ceiling: the content's top never rises above the header's drawn bottom; what can't be cleared within that stays
// under the card (the chosen agent first among what is cleared; nothing goes under the header).
test("the pan's ceiling holds at 1440 and at 390, where the header is taller", async () => {
  for (const [slot, head, card] of [[{ width: 1440, height: 360 }, TOP, [560, 200]], [{ width: 390, height: 700 }, 116, [358, 160]]]) {
    const h = harness({ slot });
    h.api.setMode(h.m(), "expanded"); await h.render();
    h.drawnHeader(head); await h.render();
    const low = lowLeft(h, card[0]);
    h.api.selectOnMap(h.m(), low.key); await h.render();
    h.drawnCard(...card); await h.render();
    expect([JSON.stringify(slot), contentTop(h) >= head + 8 - 1e-6]).toEqual([JSON.stringify(slot), true]);
    const disc = h.byId(`mn-${low.key}`);
    expect(disc.props.top).toBeGreaterThanOrEqual(head); // the chosen agent never under the header
  }
});

// The free area starts under the header as drawn (its measured height), not a guess; each layout (wide, narrow) uses
// its own header's measure (seen at 390: a maximise drew the wide header, then the narrow map took its 76 pt).
test("the fit starts under the header's drawn height, the wide and the narrow header each their own", async () => {
  const h = harness();
  await h.render();
  h.drawnHeader(140); await h.render(); await h.render();
  expect(h.m().layout.key.endsWith("|140")).toBe(true);
  expect(contentTop(h)).toBeGreaterThanOrEqual(140 + 32 - 1e-6);
  h.setSlot({ width: 390, height: 800 }); await h.render(); await h.render();
  expect(h.m().layout.key.endsWith("|116")).toBe(true); // the narrow header's own height, not the wide one's 140
  h.drawnHeader(130); await h.render(); await h.render();
  h.setSlot(SLOT); await h.render(); await h.render();
  expect(h.m().layout.key.endsWith("|140")).toBe(true);
});

// Design review note: at 390 a name shown by force (selected, needs you) whose tier keeps no room is placed as any
// shown name is, past its ring box, never over its own disc.
test("at 390 a forced name sits past its ring box, never over its disc", async () => {
  const h = harness({ slot: { width: 390, height: 700 } });
  h.api.setMode(h.m(), "expanded"); await h.render();
  for (const k of ["t4", "t8"]) {
    h.api.selectOnMap(h.m(), k); await h.render();
    const n = h.m().layout.scene.nodes.find((x) => x.key === k), disc = h.byId(`mn-${k}`), label = h.byId(`ml-${k}`);
    expect(Number.isFinite(n.nameAt) && h.m().cam.scale >= n.nameAt).toBe(false); // forced: no room at this scale
    const R = disc.props.w / 2, ring = R + 6 + 2;
    if (n.labelAbove) expect(label.props.top + 16).toBeLessThanOrEqual(R - ring - 4 + 1e-6);
    else expect(label.props.top).toBeGreaterThanOrEqual(R + ring + 4 - 1e-6);
    // drawn last: its name shows over a pill it meets (design review at 1f1916c, 390)
    expect(h.byId("map-canvas").kids.filter((c) => String(c.props.id ?? "").startsWith("mn-")).at(-1).props.id).toBe(`mn-${k}`);
  }
});

// Model 8dfec1e: where everyone-named can't fit, All expanded keeps name room only for what is drawn (a hidden tier's
// nameAt is Infinity). Its names come by tooltip; a selected or needs-you one still shows, at the model's px width.
test("the tiers' fallback: hidden names by tooltip, forced ones at their px width, a selection panned without NaN", async () => {
  const h = harness({ slot: { width: 600, height: 400 } });
  h.api.setMode(h.m(), "expanded"); await h.render();
  const hidden = h.m().layout.scene.nodes.filter((n) => !Number.isFinite(n.nameAt)).map((n) => n.key);
  expect(hidden).toEqual(expect.arrayContaining(["t2", "t4", "t7", "t8"]));
  expect(h.byId("mn-t2").props.tooltip).toBe("a1");
  expect(h.byId("ml-t4").props.w).toBeCloseTo(2 * 6.6 + 19 + 16, 6); // a3 needs you: nameW("a3") + the patch
  for (const k of hidden) { h.api.selectOnMap(h.m(), k); await h.render(); expect(Number.isFinite(h.m().cam.y)).toBe(true); }
  expect(Number.isFinite(h.byId("ml-t8").props.w)).toBe(true);
});

// Design review at 1f1916c (v4-2): the pan measured against a generous guess of the card moved the map for nothing.
// Against the card as drawn, a pill just right of it is no reason to move.
test("a lead pill right of the drawn card is no reason to pan (the card's drawn width, not a guess)", async () => {
  const h = harness({ slot: { width: 1200, height: 560 } });
  h.api.setMode(h.m(), "expanded"); await h.render();
  const c0 = h.m().cam;
  h.m().cam = { ...c0, x: c0.x - 250 / c0.scale }; h.m().moved = true; await h.render(); // the person panned right
  const left = h.byId("mn-t1").props.left + h.byId("ml-t1").props.left + 8;
  expect([left > 24 + 320, left < 24 + 560, pillBottom(h, "t1") > 560 - 24 - 98 - 16]).toEqual([true, true, true]);
  const cam = { ...h.m().cam };
  h.api.selectOnMap(h.m(), [...h.m().layout.scene.nodes].sort((a, b) => a.y - b.y)[0].key); await h.render();
  h.drawnCard(320); await h.render();
  expect(h.m().cam).toEqual(cam);
});
