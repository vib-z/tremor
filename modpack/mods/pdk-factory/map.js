// The Factory's Map view (owner, 14 Nov 2026; simplified at 21:55): the agents as a star map, beside the Board. Two
// modes and one in-place expansion, nothing else: Collapsed shows each job's top-level leads; a click on a lead opens
// its whole team in place around it (one lead at a time; Esc or a second click closes it); All expanded shows every
// team. Who leads whom is team.js's one rule (Core's parent, else a stampede relay job's lead). The layout, navigation
// and camera maths are the model's (lib/factory-map.js); this file only draws them and turns gestures and keys into
// model calls.
//
// No retained child view: the Map's state is one plain object on the Factory (`newMap`), drawn by `drawMap` from the
// Factory's own render with the board it already built. Every change fits the content to the free view (under the
// header, clear of the card) unless the person has zoomed or panned since. Motion is native and only explains that
// change: each agent keeps its element id, so `.transition` glides it to its new place; newcomers and the drawing
// around them (links, rings, glow) wait at opacity 0 for one commit render and fade in as the glide ends. Nothing
// moves under Reduce Motion.

import { div, PathBuilder, Background } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, settings, terminals } from "herdr";
import { TYPE, SPACE, ROW, RADIUS, NARROW, withFont, monoFont, kindMarker, statusMarker, segmentedChoice, textButton, reduceMotion, keyed, pointed, since } from "./lib/ui.js";
import { contrast, toHsl, fromHsl } from "./lib/tokens.js";
import { machineLabel } from "./lib/status.js";
import { sinceOf } from "./lib/factory.js";
import { teamParents } from "./lib/team.js";
import { agentKind } from "./lib/agents.js";
import { launchChoice, chipLabel } from "./lib/models.js";
import * as M from "./lib/factory-map.js";

// ---- the toggles ------------------------------------------------------------------------------------------------

// Map / Board (the Map first, owner 14 Nov): icon segments, the words in the tooltips. The mode toggle says its two
// modes in words, the owner's own: Collapsed and All expanded.
export const VIEWS = [
  { value: "map", label: "Map", icon: "orbit", tooltip: "Map" },
  { value: "board", label: "Board", icon: "layout-list", tooltip: "Board" },
];
const MODES = [{ value: "collapsed", label: "Collapsed" }, { value: "expanded", label: "All expanded" }];
const STATUS_WORDS = { working: "working", needs: "needs you", idle: "idle" };

// The choices are remembered per Factory copy (plan decision 2).
const VIEW_KEY = "pdk.factory.view", MODE_KEY = "pdk.factory.mode";
const stored = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* not kept */ } };

/** The Map's state, kept on the Factory. */
export function newMap() {
  return {
    view: stored(VIEW_KEY) === "board" ? "board" : "map",
    nav: { ...M.startNav(), mode: stored(MODE_KEY) === "expanded" ? "expanded" : "collapsed" },
    cam: null, fitFor: null, fitAt: null, moved: false, // the camera; what and where its last fit was; a zoom or pan keeps it
    layout: null, pending: null, pendingShape: null, // the laid-out scene and its keys; what a layout task works on
    layouts: new Map(), // recent layouts by key, so a size or view seen before is drawn again at once
    tree: null, size: null, drag: null,
    sceneKey: null, drawn: new Set(), entering: new Set(), phase: 0, settled: 0, settling: 0, glideAt: -Infinity, searches: new Map(),
  };
}

export function setView(m, view) {
  if (!m || (view !== "map" && view !== "board") || m.view === view) return;
  m.view = view; m.sceneKey = null; store(VIEW_KEY, view);
}
/** mode:collapsed | mode:expanded, as the toggle does; a mode switch always fits. */
export function setMode(m, mode) {
  if (!m || (mode !== "collapsed" && mode !== "expanded")) return;
  m.nav = m.tree ? M.setMode(m.tree, m.nav, mode) : { ...m.nav, mode };
  m.cam = null; store(MODE_KEY, mode);
}
/** open:<terminal>: that lead's team, in place (Collapsed). */
export function openLead(m, key) {
  if (m && key) m.nav = { ...m.nav, mode: "collapsed", open: key, selected: key };
}
/** close: the open lead folds again. */
export function closeLead(m) {
  if (m) m.nav = { ...m.nav, open: null, selected: null };
}
/** select:<terminal> / deselect. In Collapsed an agent inside a folded team opens its lead first. */
export function selectOnMap(m, key) {
  if (!m) return;
  const a = key ? m.tree?.byKey.get(key) : null;
  if (!a) { m.nav = { ...m.nav, selected: null }; return; }
  if (m.nav.mode === "collapsed" && !M.visibleKeys(m.tree, M.normalize(m.tree, m.nav)).has(key)) {
    let root = a;
    while (root.parent) root = m.tree.byKey.get(root.parent);
    m.nav = { mode: "collapsed", open: root.key, selected: key };
  } else m.nav = { ...m.nav, selected: key };
}

/** The Map / Board toggle, in the Map's header and the Board's. */
export function viewToggle(t, f, hit = ROW.compact) {
  return segmentedChoice(t, "factory-view", VIEWS, f.atlas.view, (v, _e, cx) => { setView(f.atlas, v); f.handle.focus(); cx.notify(); },
    { variant: "navigation", label: "Factory view", ground: t.canvas, owner: f, hit }).flex_none();
}

// ---- keys -------------------------------------------------------------------------------------------------------

// Bound under the Map canvas's own context, once per module load (the keymap is the app's), answered with on_action.
// The header's controls and the card sit outside that context, so their own Enter, Space and arrows stay theirs.
const KEYS = ["escape", "enter", "up", "down", "left", "right"];
const action = (k) => `pdk_factory_map_${k}`;
let bound = false;
export function bindMapKeys(cx) {
  if (!bound) try { bound = cx.bind_keys(KEYS.map((keystroke) => ({ keystroke, action: action(keystroke), context: "PdkFactoryMap" }))) > 0; } catch { /* unbound */ }
}

// ---- colour -----------------------------------------------------------------------------------------------------

// DESIGN.md's layer() and readable(), private here until the shared rollout adds them to ui.js (lead, 14 Nov).
const hex = (c) => String(c ?? "").slice(0, 7);
const opaque = (c) => /^#[0-9a-f]{6}$/i.test(c);
// `top` laid over `under` at `a` (0..1), as an opaque colour.
function mix(top, under, a) {
  const p = hex(top), q = hex(under);
  if (!opaque(p) || !opaque(q)) return top;
  return `#${[1, 3, 5].map((i) => Math.round(parseInt(p.slice(i, i + 2), 16) * a + parseInt(q.slice(i, i + 2), 16) * (1 - a)).toString(16).padStart(2, "0")).join("")}`;
}
const LAYER = { hover: 0.07, selected: 0.14 };
const layer = (t, kind, ground) => mix(t.foreground, ground, LAYER[kind]);
const shades = new Map();
// `color` if it keeps `min` against `ground`, else the nearest lighter or darker shade of its hue that does.
function readable(color, ground, min) {
  const c = hex(color), g = hex(ground), id = `${c}|${g}|${min}`;
  if (!opaque(c) || !opaque(g)) return color;
  if (!shades.has(id)) {
    let out = c;
    if (contrast(c, g) < min) {
      const [h, s, l] = toHsl(c);
      search: for (let d = 1; d <= 100; d++) for (const L of [l - d, l + d]) {
        if (L < 0 || L > 100) continue;
        const x = fromHsl([h, s, L]);
        if (contrast(x, g) >= min) { out = x; break search; }
      }
    }
    if (shades.size > 256) shades.clear();
    shades.set(id, out);
  }
  return shades.get(id);
}
// The map's inks (plan decision 3): working is the theme's done green, needs you its blocked, the selection accent,
// all at 3:1 on the canvas; quiet links and idle ring segments the input edge; a lead's disc one layer up from a helper's.
function inks(t) {
  const green = readable(t.done, t.canvas, 3), needs = readable(t.blocked, t.canvas, 3);
  const disc = layer(t, "hover", t.surface), hub = layer(t, "selected", t.surface);
  return { green, needs, idle: t.input, link: t.input, accent: readable(t.accent, t.canvas, 3),
    disc, hub, edge: t.border, live: mix(green, disc, 0.55), waiting: mix(needs, disc, 0.55), pill: t.surface };
}

// ---- measures ---------------------------------------------------------------------------------------------------

// The drawing's own measures (DESIGN.md's PART idea): the mockups' numbers (wc.py, views.py), in px on screen.
const GEOM = {
  gridPitch: 28, gridDot: 1.5, gridInk: 0.045,       // the dot grid: pitch, dot side, foreground strength
  link: 1, live: 1.8, liveInk: 0.7,                  // a quiet link, a live one, the live one's strength
  seg: 4, segGap: M.SIZE.segGap, track: 1.5,         // a team ring's arcs, the degrees between them, its quiet track
  dash: 1.5, ring: 6, select: 2,                     // the status ring's stroke and gap off the disc; the selection ring's stroke, 2 past it
  glow: [[1.7, 0.03], [1.45, 0.04], [1.22, 0.05]],   // the working glow: radius × r, strength (no radial gradient exists)
};
// A disc's mark scales with its disc (0.84 × r, as the mockups' glyphs), 10 to 40 px (lead's allowance in scale.test).
const DISC_MARK = (r) => Math.round(Math.min(40, Math.max(10, 0.84 * r)));
// DESIGN.md Motion: base 250 ease-out for the move; the commit render that starts the fade comes one frame after.
const MOTION = { glide: 250, settle: 40, fade: 200 };
const MOVE = { duration: MOTION.glide, easing: "ease-out" };
const CARD_W = 560;
const PILL_MAX = 240;
const HEAD_W = 360;

// What the content keeps clear of: the header over it, the card under it (or a margin), and the padding round it.
const TOP = { wide: SPACE[5] + ROW.base + SPACE[1] + ROW.compact, narrow: SPACE[3] + ROW.touch + SPACE[1] + SPACE[2] + ROW.touch + SPACE[1] };
const PAD = { wide: SPACE[8], narrow: SPACE[4] };

// ---- paths ------------------------------------------------------------------------------------------------------

const rad = (deg) => (deg * Math.PI) / 180;
const polar = (x, y, r, deg) => [x + r * Math.cos(rad(deg)), y + r * Math.sin(rad(deg))];
const circle = (b, x, y, r) => b.move_to(x + r, y).arc_to(r, r, 0, false, true, x - r, y).arc_to(r, r, 0, false, true, x + r, y).close();
// A built path (immutable native geometry) painted over the whole view.
const paint = (path, ink, W, H) => window.paint_path(path, ink).absolute().left(0).top(0).w(W).h(H);

// The faint dot grid, `pitch` apart through (ox, oy): one dashed stroke per row (dash = the dot, gap = the rest of the
// pitch, the stroke as thick as the dot), so a row of squares is one path call, not one per dot.
// Built once per size, pitch and offset, then reused: every path call is a call into the host, and a render has 50 ms.
const grids = { key: null, path: null };
function grid(t, W, H, pitch, ox, oy) {
  const d = GEOM.gridDot, x0 = ((ox % pitch) + pitch) % pitch - pitch, y0 = ((oy % pitch) + pitch) % pitch;
  const key = `${W}x${H}|${pitch}|${x0}|${y0}`;
  if (grids.key !== key) {
    const len = Math.ceil((W - x0) / pitch) * pitch;
    let b = PathBuilder.stroke(d).dash_array([d, pitch - d]);
    for (let y = y0; y < H; y += pitch) b = b.move_to(x0, y + d / 2).line_to(x0 + len, y + d / 2);
    grids.key = key; grids.path = b.build();
  }
  return paint(grids.path, Background.solid(t.foreground).opacity(GEOM.gridInk), W, H).id("map-grid");
}

// ---- the view ---------------------------------------------------------------------------------------------------

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
// What the layout depends on: the jobs, every agent's place in the tree (in order) and its name (its label's width).
const shapeOf = (tree) => `${tree.jobs.map((j) => `${j.id}:${j.name}:${j.branch ?? ""}`).join("|")}#${[...tree.byKey.values()].map((a) => `${a.key}<${a.parent ?? ""}:${a.name}`).join("|")}`;
// A layout costs 20-170 ms in the app's script engine, and a render that runs past the host's 50 ms is dropped ("This
// view could not be re-rendered … interrupted", QA 2155 item 11). So layouts run in a task, never in a render, and the
// render draws the last laid-out scene meanwhile. The model's fitSearch is a generator, one layout per step: the task
// takes one step per call (a task call has 500 ms).
// Even one layout can pass 500 ms on a loaded machine (seen at load 70: interrupted in arcPlace, and the view stayed on
// the old scene for good). So each key keeps its search on the map: a resize back and forth resumes it. A step cut off
// by the host ends its generator too, so the next run starts that key's search again. A search silent for LAID_STALL
// is dead: a watchdog task (a cut ends only the task it hits) asks for a render, as does the Factory's look
// (`stalled`), and the render starts the task again.
const KEPT = 8, LAID_STALL = 1000;
function layOut(m, cx, key, shapeKey, tree, nav, full, pad, inset) {
  const run = (m.run ?? 0) + 1;
  m.run = run; m.pending = key; m.pendingShape = shapeKey; m.pendingAt = Date.now();
  let q = m.searches.get(key);
  // `stepping` still set: the last step never returned (cut off), and its generator is finished with it.
  if (!q || q.stepping) {
    q = { gen: M.fitSearch(tree, nav, full, pad, inset), stepping: false };
    m.searches.delete(key); m.searches.set(key, q);
    if (m.searches.size > KEPT) m.searches.delete(m.searches.keys().next().value);
  }
  const live = () => m.run === run && m.pending === key;
  cx.spawn(async (cx) => {
    // Out of the render first, then one layout per call; a newer layout (or a restart) takes over.
    for (;;) {
      await cx.sleep(0);
      if (!live()) return;
      m.pendingAt = Date.now();
      q.stepping = true;
      const r = q.gen.next();
      q.stepping = false;
      if (r.done) { q.best = r.value; break; }
    }
    if (!live()) return;
    const { scene, cam } = q.best;
    m.layout = { key, shapeKey, scene, cam }; m.pending = null; m.searches.delete(key);
    m.layouts.delete(key); m.layouts.set(key, m.layout);
    if (m.layouts.size > KEPT) m.layouts.delete(m.layouts.keys().next().value);
    cx.notify();
  });
  cx.spawn(async (cx) => {
    while (live()) {
      await cx.sleep(LAID_STALL / 2);
      if (live() && Date.now() - m.pendingAt > LAID_STALL) { cx.notify(); return; }
    }
  });
}
// The drawn scene, restyled from the tree (the layout is status-free); agents gone since it was laid out are left out.
function current(m, tree) {
  const s = M.restyle(m.layout.scene, tree), here = (k) => tree.byKey.has(k);
  return { ...s, nodes: s.nodes.filter((n) => here(n.key)), links: s.links.filter((l) => here(l.from) && here(l.to)) };
}
const sceneKey = (layout, scene) => `${layout.shapeKey}|${scene.nodes.map((x) => x.key).sort().join(",")}`;

/** The Map, the whole Factory block: `f` the Factory (atlas, handle, obs, coreMs, focusPane), `board` its board,
 *  `slot` the block's size from the layout (null: the last measured size). It ends by clearing `atlas.drawing`, the
 *  time the Factory's render began. */
export function drawMap(f, cx, board, slot) {
  const out = paintMap(f, cx, board, slot);
  f.atlas.drawing = 0;
  return out;
}
// A render that runs past the host's 50 ms budget is dropped and the last frame stays, with "This view could not be
// re-rendered" over it, until something asks for another render (QA 2155 item 11: it stayed frozen). The Factory marks
// when a render begins and drawMap clears it as it ends, so a mark left standing means a dropped render: the Factory's
// stall check (every 0.25 s) then asks for another; as it does for a layout search gone silent (see layOut). A render
// can't run past 50 ms, so a mark older than STALL is a dropped one.
const STALL = 200;
export const stalled = (m, now = Date.now()) =>
  (Boolean(m?.drawing) && now - m.drawing > STALL) || (m?.view === "map" && m.pending != null && now - m.pendingAt > LAID_STALL);
function paintMap(f, cx, board, slot) {
  const m = f.atlas, t = theme(), now = Date.now(), reduce = reduceMotion();
  const size = slot ?? m.size ?? { width: NARROW * 2, height: NARROW };
  const W = Math.max(1, size.width), H = Math.max(1, size.height), narrow = W < NARROW;
  const full = { width: W, height: H };
  const root = withFont(div()).id("factory-map").relative().size_full().min_w(0).min_h(0).overflow_hidden().bg(t.canvas)
    .on_size_change((s, cx) => {
      const zoom = settings().zoom || 1, width = s.width / zoom, height = s.height / zoom;
      if (m.size?.width !== width || m.size?.height !== height) { m.size = { width, height }; cx.notify(); }
    });
  const tree = board.state === "ready" ? M.mapTree(board, teamParents(terminals())) : null;
  m.tree = tree;
  if (!tree?.byKey.size) {
    const words = board.state === "loading" ? "Loading the layout from herdr-core…"
      : board.state === "error" ? `Can't show the map: ${board.reason}.` : "No agents running. They appear here when they start.";
    return root.child(grid(t, W, H, GEOM.gridPitch, 0, 0))
      .child(header({ t, f, m, tree: null, narrow, W, board }))
      .child(div().id("map-state").absolute().left(0).top(0).w(W).h(H).flex().items_center().justify_center()
        .text_size(TYPE.sm).text_color(t.dim).role("status").child(words));
  }

  const nav = M.normalize(tree, m.nav);
  m.nav = nav;
  const expanded = nav.mode === "expanded";
  const selected = nav.selected ? tree.byKey.get(nav.selected) : null;
  const pad = narrow ? PAD.narrow : PAD.wide, G = narrow ? SPACE[4] : SPACE[6];
  // The free area starts under the header as drawn (its measured height; taller when narrow). The card never takes
  // room from the layout or the fit: a selection doesn't shrink or move the map (lead, review 2155 F2); what it covers
  // is panned clear of it (below).
  const headBottom = m.headH?.[narrow ? "narrow" : "wide"] ?? (narrow ? TOP.narrow : TOP.wide);
  const inset = { top: headBottom, bottom: 0 };
  // Laid out again only for a new tree shape, nav, size or header, never for a selection, drag, wheel or status render:
  // the layout is status-free, so the model's restyle re-reads what a status changes (status, needs, ring, line, live).
  const shapeKey = `${nav.mode}|${nav.open}|${shapeOf(tree)}`, layoutKey = `${shapeKey}|${W}x${H}|${headBottom}`;
  // A search for another view, cut off or left behind, is dropped once the wanted layout is drawn (review 2155 F1).
  if (m.pending && m.pending !== layoutKey && m.layout?.key === layoutKey) m.pending = null;
  if (m.layout?.key !== layoutKey) {
    const seen = m.layouts.get(layoutKey);
    if (seen) { m.layout = seen; m.pending = null; }
    else if ((m.pending !== layoutKey || now - m.pendingAt > LAID_STALL) && cx?.spawn) layOut(m, cx, layoutKey, shapeKey, tree, nav, full, pad, inset);
  }
  if (!m.layout) return root.child(grid(t, W, H, GEOM.gridPitch, 0, 0)).child(header({ t, f, m, tree, narrow, W, board }));
  const scene = current(m, tree);
  // Every change fits the content to the free view, centred, unless the person has zoomed or panned since the last
  // fit; Esc with nothing to close, or a mode switch, always fits. A change of what is shown (a lead opened, the card)
  // glides there; a new size, or the same scene laid out at a new width, only snaps, so a resize never fades or lags.
  const fitFor = m.layout.shapeKey, fitAt = `${W}x${H}|${m.layout.key}`;
  let refit = false;
  // While a layout of something new is on its way the camera waits for it, so one change makes one glide; the same
  // scene re-wrapped for a new size is not worth waiting for.
  const waiting = m.pending != null && m.pendingShape !== m.layout.shapeKey;
  if (!m.cam || (!m.moved && !waiting && (m.fitFor !== fitFor || m.fitAt !== fitAt))) {
    refit = m.cam != null && m.fitFor !== fitFor;
    // The layout's own camera when it was laid out for this view; else (a re-wrap on its way) the drawn scene fitted.
    // Content too tall to fit even at the smallest scale starts under the header (pan for the rest), never behind it.
    const cam = m.layout.key === layoutKey ? m.layout.cam : M.fit(scene.bounds, full, pad, inset);
    const y0 = M.toScreen(cam, full, 0, scene.bounds.y)[1], least = inset.top + pad;
    m.cam = y0 < least ? { ...cam, y: cam.y - (least - y0) / cam.scale } : cam;
    m.fitFor = fitFor; m.fitAt = fitAt; m.moved = false;
  }
  // The card takes no room, so once it is drawn (its measured rect) the camera pans up the least that keeps the chosen
  // agent and every lead's pill clear of it, and never lifts the content's top above the header's bottom: what can't
  // be cleared within that stays under the card, and nothing goes under the header. A new selection glides there (as a
  // refit does; Reduce Motion: at once); the same one kept clear after a new fit (a resize) snaps with it.
  if (!selected) { m.shownFor = null; m.shownSel = null; }
  else if (m.cardAt?.key === nav.selected) {
    const shown = `${nav.selected}|${m.fitAt}|${m.cardAt.w}x${m.cardAt.h}|${headBottom}`;
    const n = scene.nodes.find((x) => x.key === nav.selected);
    if (n && m.shownFor !== shown) {
      const card = { left: G, right: G + m.cardAt.w, top: H - G - m.cardAt.h - SPACE[4] };
      const need = (b) => (b.left < card.right && b.right > card.left ? Math.max(0, b.bottom - card.top) : 0);
      const pills = scene.nodes.filter((x) => x.role === "lead" && x !== n && m.cam.scale >= x.nameAt - 1e-9).map((x) => pillOf(x, m.cam, full));
      const ceiling = Math.max(0, M.toScreen(m.cam, full, 0, scene.bounds.y)[1] - (headBottom + SPACE[2]));
      const dy = Math.min(ceiling, Math.max(need(boxOf(n, m.cam, full)), ...pills.map(need)));
      if (dy > 0) { m.cam = { ...m.cam, y: m.cam.y + dy / m.cam.scale }; refit = m.shownSel !== nav.selected; }
    }
    m.shownFor = shown; m.shownSel = nav.selected;
  }
  const cam = m.cam, s = cam.scale;
  const S = (x, y) => M.toScreen(cam, full, x, y);

  // A new scene, or a refit, glides: each agent moves natively to its new place; newcomers and the drawing around them
  // fade in after one commit render. The first draw, and anything under Reduce Motion, starts settled.
  const key = sceneKey(m.layout, scene);
  if (key !== m.sceneKey || refit) {
    const first = m.sceneKey == null;
    m.sceneKey = key;
    m.phase++;
    if (first || reduce) { m.settled = m.phase; m.entering = new Set(); }
    else { m.glideAt = now; m.entering = new Set(scene.nodes.map((n) => n.key).filter((k) => !m.drawn.has(k))); }
  }
  m.drawn = new Set(scene.nodes.map((n) => n.key));
  const fresh = !reduce && m.settled !== m.phase;
  if (fresh && m.settling !== m.phase && cx?.spawn) {
    const p = m.settling = m.phase;
    // ponytail: one commit render per change, so the native fades have a value to start from (a transition only
    // animates a later change); the motion itself stays native.
    cx.spawn(async (cx) => { await cx.sleep(MOTION.settle); m.settled = p; cx.notify(); });
  }
  const motion = !reduce && now - m.glideAt < MOTION.glide + MOTION.fade;
  const ink = inks(t);
  // The header's words for where (a loose job's "Unknown host" too), so a heading never names another machine.
  const hostOf = (id) => { const r = board.regions.find((x) => x.id === id); return r?.hostLabel ?? machineLabel(r?.machine); };
  const several = new Set(tree.jobs.map((j) => hostOf(j.id))).size > 1;
  const machineOf = (id) => (several ? hostOf(id) : null);
  const ctx = { t, f, m, tree, nav, scene, ink, S, s, cam, W, H, G, full, narrow, now, reduce, fresh, motion, expanded, machineOf };

  // The grid moves and scales with the camera, its pitch kept between 1× and 2×.
  let pitch = GEOM.gridPitch * s;
  while (pitch < GEOM.gridPitch) pitch *= 2;
  while (pitch >= GEOM.gridPitch * 2) pitch /= 2;
  const [ox, oy] = S(0, 0);

  return root
    // The chosen agent is drawn last: where no room was kept for its name (a small view), it shows over what it meets.
    .child(canvas(ctx).child(grid(t, W, H, pitch, ox, oy)).child(decor(ctx)).children(scene.heads.map((h) => head(ctx, h)))
      .children([...scene.nodes].sort((a, b) => (a.key === nav.selected) - (b.key === nav.selected)).map((n) => node(ctx, n))))
    .child(header({ ...ctx, board }))
    .when(Boolean(selected), (el) => el.child(card(ctx, selected)));
}

// A label's width on screen: the model's px measure of its pill or name (any scale, a tier with no room kept too), or a
// folded lead's team line's room when that is wider.
const labelPx = (n) => Math.max(M.labelPx(n), Number.isFinite(n.nameAt) ? n.lineW * n.nameAt : 0);
// A label's px height (the model's: a lead's pill, with its team line; a name).
const labelH = (n) => (n.role === "lead" ? (n.lineW > 0 ? 33 + 16 : 26) : 16);
// A label's top on screen: the model's labelY while the camera keeps its room; a name shown by force below that scale
// (or with no room kept: nameAt Infinity) is placed as the model places a name, SPACE[1] past its ring box (the status
// and selection rings, or the team ring), under the disc or, for a helper above its lead, over it.
function labelTopOf(n, cam, full) {
  const s = cam.scale;
  if (s >= n.nameAt - 1e-9) return M.toScreen(cam, full, n.x, n.labelY)[1];
  const y = M.toScreen(cam, full, n.x, n.y)[1], o = Math.max(n.r * s + GEOM.ring + GEOM.select, n.ringR ? n.ringR * s + 2 : 0);
  return n.labelAbove ? y - o - SPACE[1] - labelH(n) : y + o + SPACE[1];
}
// A node's disc, rings and label on screen.
function boxOf(n, cam, full) {
  const [x, y] = M.toScreen(cam, full, n.x, n.y), ring = n.r * cam.scale + GEOM.ring + GEOM.select * 1.5;
  const top = labelTopOf(n, cam, full), half = Math.max(ring, labelPx(n) / 2);
  return { top: Math.min(y - ring, top), bottom: Math.max(y + ring, top + labelH(n)), left: x - half, right: x + half };
}
// A lead's pill (and team line) on screen: the model's px width, no ring margin.
function pillOf(n, cam, full) {
  const x = M.toScreen(cam, full, n.x, n.y)[0], top = labelTopOf(n, cam, full), half = labelPx(n) / 2;
  return { top, bottom: top + labelH(n), left: x - half, right: x + half };
}

// The canvas: the scene's ground, its keys (under its own context), its wheel (zoom round the pointer), drag (pan) and
// empty-click (clears the selection).
function canvas(ctx) {
  const { f, m, full } = ctx;
  let el = div().id("map-canvas").absolute().left(0).top(0).w(full.width).h(full.height).track_focus(f.handle).key_context("PdkFactoryMap")
    .role("group").accessibility_label("Factory map");
  el = (m.drag?.moved ? el.cursor_grabbing() : el.cursor_grab())
    .on_mouse_down("left", (e, _cx) => { pointed(); f.handle.focus(); m.drag = { x: e.position.x, y: e.position.y, moved: false }; })
    .on_mouse_move((e, cx) => {
      const d = m.drag;
      if (!d) return;
      const dx = e.position.x - d.x, dy = e.position.y - d.y;
      if (!d.moved && Math.hypot(dx, dy) < SPACE[1]) return;
      d.moved = true; d.x = e.position.x; d.y = e.position.y;
      m.cam = M.pan(m.cam, dx, dy); m.moved = true; cx.notify();
    })
    .on_mouse_up("left", (_e, cx) => {
      const d = m.drag;
      m.drag = null;
      if (d && !d.moved && m.nav.selected) { m.nav = { ...m.nav, selected: null }; cx.notify(); }
      else if (d?.moved) cx.notify();
    })
    .on_hover((on) => { if (!on) m.drag = null; })
    .on_scroll_wheel((e, cx) => {
      // GPUI's delta is positive for a scroll up (away); the model counts as the web does, negative to zoom in.
      const dy = -(e.delta?.y ?? 0);
      const p = e.local_position ?? e.position;
      if (!dy || !m.cam) return;
      m.cam = M.zoomAt(m.cam, M.wheelFactor(dy), [p.x, p.y], full);
      m.moved = true;
      cx.notify();
    });
  for (const k of KEYS) el = el.on_action(action(k), (_e, cx) => { keyed(); onKey(ctx, k); cx.notify(); });
  return el;
}

function onKey(ctx, k) {
  const { f, m, tree, scene, S, full } = ctx;
  const nav = M.normalize(tree, m.nav);
  if (k === "escape") {
    const next = M.up(tree, nav);
    if (next.open === nav.open && next.selected === nav.selected) { m.cam = null; m.moved = false; } // nothing to close: fit
    else m.nav = next;
  } else if (k === "enter") {
    const a = nav.selected && tree.byKey.get(nav.selected);
    if (a) f.focusPane(a.unit.address);
  } else {
    const to = M.arrowStep(tree, scene, nav.selected, k);
    if (!to || to === nav.selected) return;
    m.nav = M.normalize(tree, { ...nav, selected: to });
    // An agent chosen off screen is brought to the middle.
    const n = scene.nodes.find((x) => x.key === to);
    const [x, y] = S(n.x, n.y);
    if (x < 0 || x > full.width || y < 0 || y > full.height) { m.cam = { ...m.cam, x: n.x, y: n.y }; m.moved = true; }
  }
}

const glide = (el, on) => (on ? el.transition("left", MOVE).transition("top", MOVE).transition("width", MOVE).transition("height", MOVE) : el);

// Everything around the discs, under them: the glow, the links, the working, needs-you and team rings. A fresh id
// per change, so it is drawn at its final places and fades in once the discs have moved. Its geometry is built only
// when the camera, the size or what the scene shows changes, and reused otherwise (QA 2155 item 11: a render's
// calls into the host add up, and a render past its 50 ms budget is dropped).
function decorPaths(ctx) {
  const { scene, S, s } = ctx;
  const glow = GEOM.glow.map(() => PathBuilder.fill());
  let quiet = PathBuilder.stroke(GEOM.link), live = PathBuilder.stroke(GEOM.live);
  const rings = { working: PathBuilder.stroke(GEOM.seg), needs: PathBuilder.stroke(GEOM.seg) };
  const caps = { working: PathBuilder.fill(), needs: PathBuilder.fill() };
  let track = PathBuilder.stroke(GEOM.track), waiting = PathBuilder.stroke(GEOM.dash);
  const n = { quiet: 0, live: 0, waiting: 0, track: 0, working: 0, needs: 0 }, dashed = [];
  for (const l of scene.links) {
    const [ax, ay] = S(...l.a), [cx, cy] = S(...l.c), [bx, by] = S(...l.b);
    if (l.live) { live = live.move_to(ax, ay).curve_to(bx, by, cx, cy); n.live++; }
    else { quiet = quiet.move_to(ax, ay).curve_to(bx, by, cx, cy); n.quiet++; }
  }
  for (const node of scene.nodes) {
    const [x, y] = S(node.x, node.y), r = node.r * s;
    if (node.status === "working") {
      GEOM.glow.forEach(([k], i) => { glow[i] = circle(glow[i], x, y, r * k); });
      const R = r + GEOM.ring;
      dashed.push(PathBuilder.stroke(GEOM.dash).dash_array([0.9 * R, 0.35 * R]).move_to(x + R, y)
        .arc_to(R, R, 0, false, true, x - R, y).arc_to(R, R, 0, false, true, x + R, y).build());
    }
    // Needs you: a whole ring where working has a dashed one (its shape as well as its colour).
    if (node.status === "needs") { waiting = circle(waiting, x, y, r + GEOM.ring); n.waiting++; }
    // A team ring (a folded lead's): one calm hairline round the whole team, with an arc per helper working or needing
    // you on it, so a quiet team reads as a still ring, never as a dashed one that looks like loading.
    if (node.ring?.length && node.ringR) {
      const R = node.ringR * s, each = 360 / node.ring.length, cap = ((GEOM.seg / 2) / R) * (180 / Math.PI);
      track = circle(track, x, y, R); n.track++;
      node.ring.forEach((st, i) => {
        if (!rings[st]) return;
        const a0 = -90 + i * each + GEOM.segGap / 2 + cap, a1 = -90 + (i + 1) * each - GEOM.segGap / 2 - cap;
        const p0 = polar(x, y, R, a0), p1 = polar(x, y, R, Math.max(a0, a1));
        if (a1 > a0) rings[st] = rings[st].move_to(...p0).arc_to(R, R, 0, a1 - a0 > 180, true, ...p1);
        caps[st] = circle(circle(caps[st], ...p0, GEOM.seg / 2), ...p1, GEOM.seg / 2);
        n[st]++;
      });
    }
  }
  // [built path, what it is] in paint order; the inks are the theme's, chosen when painting.
  return [
    ...glow.map((b, i) => [b.build(), `glow${i}`]),
    ...(n.quiet ? [[quiet.build(), "quiet"]] : []), ...(n.live ? [[live.build(), "live"]] : []),
    ...dashed.map((p) => [p, "dashed"]),
    ...(n.waiting ? [[waiting.build(), "waiting"]] : []), ...(n.track ? [[track.build(), "track"]] : []),
    ...["needs", "working"].filter((st) => n[st]).flatMap((st) => [[rings[st].build(), st], [caps[st].build(), st]]),
  ];
}
function decor(ctx) {
  const { m, scene, ink, W, H, cam, fresh, motion } = ctx;
  const key = `${W}x${H}|${cam.x},${cam.y},${cam.scale}|${m.layout.key}|${scene.nodes.map((x) => `${x.status}${x.ring?.join("") ?? ""}`).join(",")}`;
  if (m.paths?.key !== key) m.paths = { key, list: decorPaths(ctx) };
  const solid = (c, a) => Background.solid(c).opacity(a);
  const inkOf = { quiet: ink.link, live: solid(ink.green, GEOM.liveInk), dashed: ink.live, waiting: ink.needs, track: ink.idle,
    working: ink.green, needs: ink.needs, ...Object.fromEntries(GEOM.glow.map(([, a], i) => [`glow${i}`, solid(ink.green, a)])) };
  return div().id(`map-decor-${m.phase}`).absolute().left(0).top(0).w(W).h(H).opacity(fresh ? 0 : 1)
    .when(motion, (el) => el.transition("opacity", { duration: MOTION.fade, delay: MOTION.glide - MOTION.settle, easing: "ease-out" }))
    .children(m.paths.list.map(([path, what]) => paint(path, inkOf[what], W, H)));
}

// A job's heading: its name upper-cased, its meta line under it; with more than one machine shown, the meta starts
// with the job's machine.
function head(ctx, h) {
  const { t, S, motion, machineOf } = ctx;
  const [x, y] = S(h.x, h.y);
  const meta = [machineOf(h.job), h.meta].filter(Boolean).join(" · ");
  return v_flex().id(`mh-${h.job}`).absolute().top(y).left(h.anchor === "middle" ? x - HEAD_W / 2 : x).w(HEAD_W)
    .when(h.anchor === "middle", (el) => el.items_center()).gap(SPACE[1]).text_size(TYPE.xs).font_family(monoFont()).text_color(t.dim)
    .child(div().max_w(HEAD_W).truncate().child(h.title.toUpperCase()))
    .when(Boolean(meta), (el) => el.child(div().max_w(HEAD_W).truncate().child(meta)))
    .when(motion, (el) => el.transition("left", MOVE).transition("top", MOVE));
}

// Words over the drawing sit on a patch of the canvas, so a link passing under them never runs through the letters.
const backed = (t, el) => el.px(SPACE[1]).rounded(RADIUS.sm).bg(t.canvas);

// An agent: its disc (its own mark on a raised ground), the selection ring, its label. Its id is its key in every
// scene, so a change moves it. A lead, a sub-lead and a helper differ at a glance: the disc's size (the model's) and
// ground, a pill in 13/500 for a lead, a plain name in 12/500 for a sub-lead, in 11 for a helper.
function node(ctx, n) {
  const { t, f, m, tree, nav, ink, S, s, cam, full, fresh, motion } = ctx;
  const a = tree.byKey.get(n.key), u = a.unit;
  const [x, y] = S(n.x, n.y), R = Math.max(1, n.r * s);
  const sel = nav.selected === n.key, working = n.status === "working", needs = n.status === "needs", lead = n.role === "lead";
  const sub = n.role === "sub-lead";
  const entering = fresh && m.entering.has(n.key);
  const press = (_e, cx) => { m.nav = M.clickAgent(tree, m.nav, n.key); cx.notify(); };
  const down = (_e, cx) => { pointed(); f.handle.focus(); cx.stop_propagation(); };
  const what = nav.mode === "collapsed" && lead && a.children.length ? (nav.open === n.key ? "fold its team" : "show its team") : sel ? "clear the selection" : "show its card";
  const team = a.children.length ? `, ${plural(a.team.all, "helper")}` : "";
  // The label's top is the model's labelY on screen (under the disc, or over it for a helper above its lead); the
  // model laid the scene out for this scale with text at its px size, so its widths are world units × the scale.
  const labelTop = labelTopOf(n, cam, full) - (y - R);
  // A name shows from the camera scale its room was kept for (the model's nameAt); a selected or needs-you one shows
  // anyway, at the px width it was laid out with (labelW × nameAt).
  const showLabel = sel || needs || s >= n.nameAt - 1e-9;
  const LW = labelPx(n) + SPACE[4];
  // One canvas patch under the whole label (a lead's pill and line together, a name and its mark), drawn after the
  // links, so no link is ever seen through or between its words. What a press reaches keeps the arrow (the canvas
  // round it is a grab hand: a drag pans).
  const label = h_flex().id(`ml-${n.key}`).absolute().left(R - LW / 2).top(labelTop).w(LW).justify_center()
    .child(backed(t, lead
      ? v_flex().id(`mb-${n.key}`).max_w(LW).items_center().gap(SPACE[2])
        .child(h_flex().id(`mp-${n.key}`).h(ROW.compact).max_w(LW).px(SPACE[3]).gap(SPACE[2]).items_center().rounded_full()
          .bg(ink.pill).border(1).border_color(sel ? ink.accent : t.input).hover((st) => st.bg(layer(t, "hover", ink.pill)))
          .cursor_default().on_mouse_down("left", down).on_click(press)
          .child(statusMarker(t, n.status, `ms-${n.key}`) ?? div())
          .child(div().min_w(0).max_w(PILL_MAX).truncate().text_size(TYPE.base).font_medium().text_color(t.foreground).child(n.label)))
        .when(Boolean(n.line), (el) => el.child(div().max_w(n.lineW * s).truncate().text_size(TYPE.xs).text_color(t.muted).child(n.line)))
      // A sub-lead or a helper says needs you beside its name with the shared mark, as a lead's pill does.
      : h_flex().id(`mb-${n.key}`).max_w(LW).gap(SPACE[1]).items_center().cursor_default().on_mouse_down("left", down).on_click(press)
        .when(needs, (el) => el.child(statusMarker(t, "needs", `ms-${n.key}`) ?? div()))
        .child(div().id(`mt-${n.key}`).min_w(0).truncate().text_size(sub ? TYPE.sm : TYPE.xs).when(sub, (el) => el.font_medium())
          .text_color(sub || working || needs || sel ? t.foreground : t.muted).child(n.label))));
  // A folded lead whose team has someone who needs you says so on its disc, with the shared mark.
  const badge = n.folded && n.needs > 0 && div().id(`mn-needs-${n.key}`).absolute().left(R * (1 + Math.SQRT1_2) - SPACE[2]).top(R * (1 - Math.SQRT1_2) - SPACE[2])
    .size(SPACE[4]).rounded_full().bg(t.canvas).flex().items_center().justify_center()
    .child(statusMarker(t, "needs", `mn-needs-mark-${n.key}`, { tip: `${n.needs} need${n.needs === 1 ? "s" : ""} you` }) ?? div());
  // The selection ring 2 px past the status ring (GEOM.ring off the disc), so a working or needs-you agent shows both.
  const ringBox = R + GEOM.ring + GEOM.select + GEOM.select / 2;
  return glide(div().id(`mn-${n.key}`).absolute().left(x - R).top(y - R).w(2 * R).h(2 * R).rounded_full()
    .bg(lead ? ink.hub : ink.disc).border(1).border_color(working ? ink.live : needs ? ink.waiting : lead ? t.input : ink.edge).hover((st) => st.border_color(t.muted))
    .flex().items_center().justify_center()
    .opacity(entering ? 0 : 1)
    .when(motion && m.entering.has(n.key), (el) => el.transition("opacity", { duration: MOTION.fade, delay: MOTION.glide / 2, easing: "ease-out" }))
    .role("button").accessibility_label(`${n.label}, ${n.role}, ${STATUS_WORDS[n.status]}${team}${n.needs ? `, ${n.needs} need you` : ""}. Press to ${what}`)
    .cursor_default().on_mouse_down("left", down).on_click(press)
    // Its name on hover while the name itself isn't drawn (DESIGN.md: no tooltip that repeats a label).
    .when(!showLabel, (el) => el.tooltip(n.label))
    .child(kindMarker(t, u.kind, DISC_MARK(R), t.foreground, `mk-${n.key}`))
    .when(Boolean(badge), (el) => el.child(badge))
    .when(sel, (el) => el.child(glide(div().id(`msel-${n.key}`).absolute().left(R - ringBox).top(R - ringBox).w(2 * ringBox).h(2 * ringBox)
      .rounded_full().border(GEOM.select).border_color(ink.accent), motion)))
    .when(showLabel, (el) => el.child(glide(label, motion))), motion);
}

// ---- header and card --------------------------------------------------------------------------------------------

// The header: the title, where and how many (and who needs you), the mode toggle, Map / Board. Nothing else.
function header({ t, f, m, tree, narrow, W, board }) {
  const hit = narrow ? ROW.touch : ROW.compact;
  const labels = tree ? [...new Set(tree.jobs.map((j) => { const r = board.regions.find((x) => x.id === j.id); return r?.hostLabel ?? machineLabel(r?.machine); }))] : [];
  const where = labels.length === 1 ? labels[0] : labels.length ? plural(labels.length, "machine") : machineLabel(null);
  const needs = tree?.counts.needs ?? 0;
  const sub = h_flex().id("map-sub").min_w(0).gap(SPACE[2]).items_center().text_size(TYPE.sm).text_color(t.muted)
    .child(div().min_w(0).truncate().child(tree ? `${where} · ${plural(tree.counts.agents, "agent")}` : where))
    .when(needs > 0, (el) => el.child(h_flex().flex_none().gap(SPACE[1]).items_center().text_color(t.foreground)
      .child(statusMarker(t, "needs", "map-sub-needs") ?? div()).child(`${needs} need${needs === 1 ? "s" : ""} you`)));
  const title = div().flex_none().text_size(TYPE.lg).font_medium().text_color(t.foreground).child("Factory");
  // A press in the header hands the keyboard back to the canvas, so Esc and the arrows keep working. "Collapsed" stays
  // lit while one lead's team is open, so a press on it folds that team (closeLead: setMode keeps it open for a
  // selected helper).
  const mode = segmentedChoice(t, "map-mode", MODES, m.nav.mode, (v, _e, cx) => {
    if (v === m.nav.mode) { if (v === "collapsed" && m.nav.open) closeLead(m); } else setMode(m, v);
    f.handle.focus(); cx.notify();
  }, { variant: "navigation", label: "Map mode", ground: t.canvas, owner: f, hit, again: true }).flex_none();
  // Its drawn height is the free area's top (the fit, and the selection pan's ceiling), kept per layout (wide, narrow):
  // a window going wide then narrow never draws the narrow map under the wide header's height.
  const which = narrow ? "narrow" : "wide";
  const measured = (el) => el.on_size_change((sz, cx) => {
    const h = Math.ceil(sz.height / (settings().zoom || 1));
    if (m.headH?.[which] !== h) { m.headH = { ...m.headH, [which]: h }; cx.notify(); }
  });
  if (narrow) {
    return measured(v_flex()).id("map-header").absolute().left(0).top(0).w(W).px(SPACE[4]).pt(SPACE[3]).gap(SPACE[2])
      .child(h_flex().gap(SPACE[2]).items_center().child(title).child(div().flex_1()).child(viewToggle(t, f, hit)))
      .child(h_flex().min_w(0).items_center().child(mode));
  }
  return measured(h_flex()).id("map-header").absolute().left(0).top(0).w(W).px(SPACE[6]).pt(SPACE[5]).gap(SPACE[4]).items_start().justify_between()
    .child(v_flex().min_w(0).gap(SPACE[1]).child(h_flex().h(ROW.base).items_center().child(title)).child(h_flex().min_w(0).h(ROW.compact).items_center().child(sub)))
    .child(h_flex().flex_none().gap(SPACE[3]).items_center().child(mode).child(viewToggle(t, f, hit)));
}

// The chosen agent's card's words: its name and Open pane; its state and how long, its role, its model (else its
// kind); its last line when it says more than its name.
function cardText(f, tree, a, now) {
  const c = M.cardOf(tree, a.key), u = a.unit;
  // A remote agent's record may be missing or partial: every field read is optional.
  const term = (terminals() ?? []).find((x) => x?.address === a.key) ?? null;
  const argv = term?.foreground?.argv ?? term?.argv;
  const choice = launchChoice(term ? agentKind(term) : null, Array.isArray(argv) ? argv : []);
  const kind = choice.model ? chipLabel(choice) : c.kind;
  const s = sinceOf(f.obs?.agents.get(u.address), f.coreMs?.get(u.address));
  const state = `${STATUS_WORDS[a.status]}${s ? ` ${since(now - s.at)}` : ""}`;
  const facts = [c.role, kind].filter(Boolean).join(" · ");
  const said = String(c.line ?? "").split("\n")[0];
  return { c, u, state, facts, line: said && said !== c.name ? said : "", open: u.pane ? "Open pane" : "Peek terminal" };
}
// The card is as wide as its words (CARD_MIN to CARD_W, and the view); its drawn size is measured for the pan.
const CARD_MIN = 320;
// The chosen agent's card, bottom left: what helps, once each.
function card({ t, f, m, tree, W, G, narrow, now }, a) {
  const { c, u, state, facts, line, open } = cardText(f, tree, a, now);
  const target = narrow ? ROW.touch : ROW.compact;
  // Its wrapper is keyed by the agent, so each new card reports its drawn size (the pan waits for it).
  return div().id(`map-card-at-${a.key}`).absolute().left(G).bottom(G)
    .on_size_change((sz, cx) => {
      const zoom = settings().zoom || 1, w = sz.width / zoom, h = sz.height / zoom;
      if (m.cardAt?.key !== a.key || m.cardAt.w !== w || m.cardAt.h !== h) { m.cardAt = { key: a.key, w, h }; cx.notify(); }
    })
    .child(card0(t, f, a, { c, u, state, facts, line, open }, target, W, G));
}
function card0(t, f, a, { c, u, state, facts, line, open }, target, W, G) {
  return v_flex().id("map-card").min_w(Math.min(CARD_MIN, W - 2 * G)).max_w(Math.min(CARD_W, W - 2 * G))
    .p(SPACE[4]).gap(SPACE[1])
    .rounded(RADIUS.lg).bg(t.surface).border(1).border_color(t.border).role("group")
    .accessibility_label(`${c.name}: ${state}, ${facts}${line ? `. ${line}` : ""}`)
    .child(h_flex().gap(SPACE[2]).items_center()
      .child(div().min_w(0).truncate().text_size(TYPE.lg).font_medium().text_color(t.foreground).child(c.name))
      .child(div().flex_1())
      .child(textButton(t, "map-open", open, u.pane ? "Open its pane" : "Peek its terminal", () => f.focusPane(u.address), { h: target, size: TYPE.sm })))
    .child(h_flex().id("map-card-facts").min_w(0).gap(SPACE[1]).items_center().text_size(TYPE.sm).text_color(t.muted)
      .child(statusMarker(t, a.status, "map-card-status") ?? div())
      .child(div().flex_none().text_color(a.status === "needs" ? t.foreground : t.muted).child(state))
      .when(Boolean(facts), (el) => el.child(div().min_w(0).truncate().child(`· ${facts}`))))
    .when(Boolean(line), (el) => el.child(div().id("map-card-line").min_w(0).truncate().text_size(TYPE.sm).text_color(t.muted).child(line)));
}
