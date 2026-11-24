// The Factory's Map view (owner, 14 Nov 2026; simplified 21:55): the agents as a star / mind map. Pure: plain data
// in, plain data out.
//
// Two modes. Collapsed: each job's top-level leads as hubs (mark, name, helper count, a ring of their whole team);
// one lead at a time opens in place, its whole team round it, the other leads moving aside. All expanded: every lead
// with its whole team. The tree is the team parents (`teamParents` in team.js: Core's parent, else a stampede relay
// job's lead), at any depth, so every agent is reachable.
//
// Geometry is in world units (px at camera scale 1), each scene centred on 0,0; the view adds the camera.

import { machineLabel } from "./status.js";

/**
 * @typedef {"working" | "needs" | "idle"} Status   // the map's three states: working, needs you, everything else
 *
 * @typedef {object} MapAgent
 * @property {string} key            Core address (unit.address), unique in the tree
 * @property {object} unit           the board unit, as buildBoard made it (name, kind, word, msg, title, pane, cwd, host…)
 * @property {string} name           unit.name
 * @property {Status} status         statusOf(unit.word)
 * @property {string|null} parent    the parent's key, null for a top-level agent of its job
 * @property {string} job            its job's id (the board region's id)
 * @property {number} depth          0 for a top-level agent
 * @property {MapAgent[]} children   direct helpers, in board order
 * @property {Team} team             counts over this agent's subtree
 *
 * @typedef {object} Team
 * @property {number} helpers        direct children
 * @property {number} all            every descendant
 * @property {number} working        descendants working
 * @property {number} needs          descendants needing you
 * @property {number} idle           descendants idle
 * @property {number} subTeams       direct children that have children of their own
 *
 * @typedef {object} MapJob
 * @property {string} id             board region id
 * @property {string} name           region name (the space / job)
 * @property {string|null} machine   region.machine
 * @property {string|null} branch    region.branch
 * @property {MapAgent[]} roots      its top-level agents
 * @property {number} agents         every agent in it
 *
 * @typedef {object} MapTree
 * @property {MapJob[]} jobs
 * @property {Map<string, MapAgent>} byKey
 * @property {{ jobs: number, agents: number, working: number, needs: number, idle: number }} counts
 *
 * @typedef {object} Nav               where the map is; `normalize` keeps it valid against a fresh tree
 * @property {"collapsed" | "expanded"} mode
 * @property {string|null} open       the top-level lead whose team is open in place (collapsed mode only)
 * @property {string|null} selected   the agent whose card shows
 *
 * @typedef {object} SceneNode
 * @property {string} key             agent key
 * @property {number} x
 * @property {number} y               centre, world units
 * @property {number} r               the disc's radius
 * @property {boolean} hub            a hub draws the label pill and the status line; a leaf, its name under it
 * @property {Status} status
 * @property {Status[]|null} ring     segment states, clockwise from 12 o'clock, or null for no ring
 * @property {number} ringR           the segmented ring's radius (0 with no ring)
 * @property {string} label           the name
 * @property {string} line            the status line under a hub's pill ("" for none)
 * @property {boolean} folded         a lead whose team is not shown (a click opens it)
 * @property {"lead" | "sub-lead" | "helper"} role   top-level, a helper with helpers, or a helper
 * @property {number} needs           agents in its team that need you (0 for a helper)
 * @property {number} labelY          added: top of the label (a hub's pill, 26 tall; a leaf's name, 16 tall)
 * @property {boolean} labelAbove     a helper's name over its disc (its lead is below it), not under
 * @property {number} nameAt          the least camera scale its text has room at: draw the name (or pill) when the
 *                                    camera's scale is at least this (a selected or needs-you name shows anyway)
 * @property {number} labelW          added: the label's estimated width, centred on x (pill: chars·8 or 7.4 + 44; name: chars·6.6+19)
 * @property {number} lineY           added: top of a hub's status line (16 tall); `line` is already cut to fit the
 *                                    room the layout keeps for it, so a new message never moves anything
 * @property {number} lineW           added: that room, centred on x (LINE_ROOM; 0 for a hub with no line or a leaf)
 *
 * @typedef {object} SceneLink
 * @property {string} from
 * @property {string} to
 * @property {[number, number]} a     start point (parent's centre)
 * @property {[number, number]} c     quadratic control point
 * @property {[number, number]} b     end point (child's centre)
 * @property {boolean} live           the child is working
 *
 * @typedef {object} SceneHead         a job's heading
 * @property {string} job
 * @property {string} title           the job's name (the view upper-cases it)
 * @property {string} meta            the branch ("master"), "" for none
 * @property {string} machine         its machine's label ("This computer", "studio-mac"); the view adds it to the
 *                                    meta line when more than one machine is shown
 * @property {number} x
 * @property {number} y               top of the title's line box (14 tall; the meta line sits 18 below it)
 * @property {"middle" | "start"} anchor
 *
 * @typedef {object} Scene
 * @property {SceneNode[]} nodes       drawn in this order (leaves first, hubs last, so hubs sit on top)
 * @property {SceneLink[]} links
 * @property {SceneHead[]} heads
 * @property {{ x: number, y: number, w: number, h: number }} bounds   everything drawn, labels included
 *
 * @typedef {object} Camera
 * @property {number} scale
 * @property {number} x               the world point at the viewport's centre
 * @property {number} y
 */

// Sizes (radius of the disc, of the segmented ring, of the orbit), from the approved mockups.
export const SIZE = {
  lead: 48, leadRing: 70,                         // a collapsed lead and the ring of its whole team
  open: 38, sub: 26, leaf: 19, subLeaf: 13,       // a lead open in place, a sub-lead, helpers by depth
  leafOrbit: 175, subOrbit: 235, subLeafOrbit: 118,
  segGap: 6,          // degrees between ring segments
  maxSegments: 24,    // more helpers than this share segments
};
export const SCALE = { min: 0.25, max: 4 };     // the camera's zoom range
export const STEP = 120;                        // px of wheel scroll that halve (or double) the zoom

// ---- the tree --------------------------------------------------------------------------------------------------

/** working → "working"; needs → "needs"; anything else (done, idle, exited, null) → "idle". */
export function statusOf(word) { return word === "working" || word === "needs" ? word : "idle"; }

// Counts over a built agent's subtree; its children are built first.
function teamOf(agent) {
  const t = { helpers: agent.children.length, all: 0, working: 0, needs: 0, idle: 0, subTeams: 0 };
  for (const c of agent.children) {
    t.all += 1 + c.team.all;
    t[c.status]++;
    for (const s of ["working", "needs", "idle"]) t[s] += c.team[s];
    if (c.children.length) t.subTeams++;
  }
  return t;
}

// Core hands out addresses in start order: "t" and a base-36 counter (t7v, t7w, t10g, t123, t12b), after any
// "machine/" prefix. A parent's children go in that order (Herdr's tab order is arbitrary for tabs Core made), but
// only when every sibling's address reads that way on one machine; else they keep the board's order.
const startOf = (address) => {
  const m = /^(.*\/)?t([0-9a-z]+)$/.exec(String(address));
  return m ? { host: m[1] ?? "", n: parseInt(m[2], 36) } : null;
};
function byStart(list) {
  const at = list.map((u) => startOf(u.address));
  if (!at.every((s) => s && s.host === at[0].host)) return;
  const n = new Map(list.map((u, i) => [u, at[i].n]));
  list.sort((a, b) => n.get(a) - n.get(b));
}

/**
 * The jobs and their agent trees from a ready board (F.buildBoard). Agents only: a plain terminal is left out unless
 * it has agent children (then it stays, as their parent). In-process records are not nodes. Every agent of the board
 * appears exactly once; a parent outside the board (or a cycle) makes the agent a top-level one.
 * A parent in another job counts as outside (each job is its own tree). Roots keep the board's (tab) order; a
 * parent's children go in Core's start order when their addresses give it (see startOf). `parents` is
 * `teamParents(terminals())` (team.js); without it, or for an address it lacks, Core's parent (`unit.startedBy`).
 * @returns {MapTree}
 */
export function mapTree(board, parents = null) {
  const jobs = [], byKey = new Map(), seen = new Set();
  for (const region of board?.regions ?? []) {
    const units = [];
    for (const z of region.zones ?? []) for (const u of z.units ?? []) {
      if (!u?.address || seen.has(u.address)) continue;
      seen.add(u.address);
      units.push(u);
    }
    const here = new Set(units.map((u) => u.address));
    const parentOf = new Map(units.map((u) => {
      const p = parents?.get?.(u.address) ?? u.startedBy;
      return [u.address, p && p !== u.address && here.has(p) ? p : null];
    }));
    // A cycle: the first of its members in board order becomes top-level.
    for (const u of units) {
      const trail = new Set([u.address]);
      for (let p = parentOf.get(u.address); p; p = parentOf.get(p)) {
        if (p === u.address) { parentOf.set(u.address, null); break; }
        if (trail.has(p)) break; // a cycle above u, cut on its own member's turn
        trail.add(p);
      }
    }
    const kids = new Map();
    for (const u of units) { const p = parentOf.get(u.address); if (p) kids.set(p, [...(kids.get(p) ?? []), u]); }
    for (const list of kids.values()) byStart(list);
    const keep = new Map();
    const kept = (u) => {
      if (!keep.has(u.address)) keep.set(u.address, Boolean(u.kind?.agent) || (kids.get(u.address) ?? []).some(kept));
      return keep.get(u.address);
    };
    const make = (u, parent, depth) => {
      const a = { key: u.address, unit: u, name: u.name ?? u.address, status: statusOf(u.word), parent, job: region.id, depth, children: [], team: null };
      byKey.set(a.key, a);
      a.children = (kids.get(u.address) ?? []).filter(kept).map((k) => make(k, a.key, depth + 1));
      a.team = teamOf(a);
      return a;
    };
    const roots = units.filter((u) => !parentOf.get(u.address) && kept(u)).map((u) => make(u, null, 0));
    if (roots.length) jobs.push({ id: region.id, name: region.name, machine: region.machine ?? null, branch: region.branch ?? null, roots, agents: roots.reduce((n, r) => n + 1 + r.team.all, 0) });
  }
  const counts = { jobs: jobs.length, agents: byKey.size, working: 0, needs: 0, idle: 0 };
  for (const a of byKey.values()) counts[a.status]++;
  return { jobs, byKey, counts };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The one line under a hub: its team's size, and who in it needs you ("5 helpers", "14 helpers · 2 need you");
 *  "" for an agent with no helpers. */
export function hubLine(agent) {
  const { all = 0, needs = 0 } = agent?.team ?? {};
  if (!all) return "";
  return `${plural(all, "helper")}${needs ? ` · ${needs} need${needs === 1 ? "s" : ""} you` : ""}`;
}

const roleWord = (a) => (!a.parent ? "lead" : a.children.length ? "sub-lead" : "helper");

/** Who an agent is in its team: { role: "lead" | "sub-lead" | "helper", of: its lead's name or null }, or null. */
export function roleOf(tree, key) {
  const a = tree.byKey.get(key);
  return a ? { role: roleWord(a), of: a.parent ? tree.byKey.get(a.parent)?.name ?? null : null } : null;
}

/** The card's facts, once each: name, role ("helper of X"), agent kind, state word (the view adds how long), last line. */
export function cardOf(tree, key) {
  const a = tree.byKey.get(key);
  if (!a) return null;
  const u = a.unit ?? {};
  const { role, of } = roleOf(tree, key);
  return { key, name: a.name, role: of ? `${role} of ${of}` : role, kind: u.kind?.label ?? null, word: u.word ?? null, line: u.msg || u.title || "", pane: u.pane ?? null };
}

const STATES = ["working", "needs", "idle"];

// Shares `max` slots between counts in proportion, every non-zero count keeping at least one (largest remainder).
function share(counts, max) {
  const total = counts.reduce((a, b) => a + b, 0);
  const exact = counts.map((c) => (c * max) / total);
  const out = counts.map((c, i) => (c ? Math.max(1, Math.floor(exact[i])) : 0));
  const sum = () => out.reduce((a, b) => a + b, 0);
  const pick = (score) => out.reduce((best, _, i) => (score(i) > score(best) ? i : best), 0);
  while (sum() < max) out[pick((i) => (counts[i] ? exact[i] - out[i] : -Infinity))]++;
  while (sum() > max) out[pick((i) => (out[i] > 1 ? out[i] - exact[i] : -Infinity))]--;
  return out;
}

/** The ring's segments for a hub: one per helper (all descendants when `deep`, else direct helpers), working first,
 *  then needs, then idle; at most SIZE.maxSegments (more share, keeping the proportions). null when it has none. */
export function ringOf(agent, { deep = false } = {}) {
  const counts = deep ? STATES.map((s) => agent.team[s]) : STATES.map((s) => agent.children.filter((c) => c.status === s).length);
  const n = counts.reduce((a, b) => a + b, 0);
  if (!n) return null;
  const segs = n > SIZE.maxSegments ? share(counts, SIZE.maxSegments) : counts;
  return STATES.flatMap((s, i) => Array(segs[i]).fill(s));
}

// ---- navigation ------------------------------------------------------------------------------------------------

/** The starting place: collapsed, nothing open, nothing chosen. */
export const startNav = () => ({ mode: "collapsed", open: null, selected: null });

const rootOf = (tree, key) => { let a = tree.byKey.get(key); while (a?.parent) a = tree.byKey.get(a.parent); return a ?? null; };
const subtree = (a) => [a.key, ...a.children.flatMap(subtree)];

/** The agents a nav's scene shows: every agent when expanded; else every top-level lead and the open lead's team. */
export function visibleKeys(tree, nav) {
  if (nav.mode === "expanded") return new Set(tree.byKey.keys());
  const open = nav.open ? tree.byKey.get(nav.open) : null;
  return new Set([...tree.jobs.flatMap((j) => j.roots.map((r) => r.key)), ...(open ? subtree(open) : [])]);
}

/** The nav made valid for `tree`: open only a live top-level lead with helpers, in collapsed mode; selected only an
 *  agent the scene shows. */
export function normalize(tree, nav) {
  const mode = nav?.mode === "expanded" ? "expanded" : "collapsed";
  const o = mode === "collapsed" && nav?.open ? tree.byKey.get(nav.open) : null;
  const out = { mode, open: o && !o.parent && o.children.length ? o.key : null, selected: null };
  if (nav?.selected && visibleKeys(tree, out).has(nav.selected)) out.selected = nav.selected;
  return out;
}

/** A click on agent `key`. Collapsed: a top-level lead with helpers opens its team in place (selected, so its card
 *  shows), or closes it when it is the open one; anything else is selected, a second click clearing it. Expanded: a
 *  click selects. */
export function clickAgent(tree, nav, key) {
  const n = normalize(tree, nav);
  const a = tree.byKey.get(key);
  if (!a) return n;
  if (n.mode === "collapsed" && !a.parent && a.children.length) return n.open === key ? { ...n, open: null, selected: null } : { ...n, open: key, selected: key };
  return normalize(tree, { ...n, selected: n.selected === key ? null : key });
}

/** Esc: clears a helper's selection, else closes the open lead, else clears the selection. Else unchanged. */
export function up(tree, nav) {
  const n = normalize(tree, nav);
  if (n.selected && n.selected !== n.open) return { ...n, selected: null };
  if (n.open) return { ...n, open: null, selected: null };
  return n;
}

/** The mode toggle. Back to collapsed, an agent selected inside a team opens its lead, so it stays in view. */
export function setMode(tree, nav, mode) {
  const n = normalize(tree, nav);
  if (mode !== "collapsed") return normalize(tree, { ...n, mode: "expanded" });
  const root = n.selected ? rootOf(tree, n.selected) : null;
  return normalize(tree, { mode: "collapsed", open: root && root.key !== n.selected ? root.key : null, selected: n.selected });
}

/** The arrow keys over the visible scene: ← the parent, → the first child, ↑/↓ the previous / next sibling, no wrap.
 *  Nothing selected: ↓ or → picks the first agent, ↑ or ← the last. Returns the agent key to select.
 *  `key` is "left" / "right" / "up" / "down" (GPUI) or "ArrowLeft"… (DOM). Order is the tree's (board) order. */
export function arrowStep(tree, scene, selected, key) {
  const shown = new Set(scene.nodes.map((n) => n.key));
  const order = [...tree.byKey.keys()].filter((k) => shown.has(k));
  const dir = String(key).replace(/^arrow/i, "").toLowerCase();
  const cur = shown.has(selected) ? tree.byKey.get(selected) : null;
  if (!cur) return order.length && (dir === "down" || dir === "right") ? order[0] : order.length && (dir === "up" || dir === "left") ? order.at(-1) : selected ?? null;
  if (dir === "left") return cur.parent && shown.has(cur.parent) ? cur.parent : cur.key;
  if (dir === "right") return cur.children.find((c) => shown.has(c.key))?.key ?? cur.key;
  const shownParent = (a) => (a.parent && shown.has(a.parent) ? a.parent : null);
  const sibs = order.filter((k) => shownParent(tree.byKey.get(k)) === shownParent(cur));
  const i = sibs.indexOf(cur.key);
  if (dir === "up") return sibs[Math.max(0, i - 1)];
  if (dir === "down") return sibs[Math.min(sibs.length - 1, i + 1)];
  return cur.key;
}

// ---- scenes ----------------------------------------------------------------------------------------------------

const chars = (s) => [...String(s ?? "")].length;
// Estimated widths, generous so the view never cuts a name: a helper's name at 11 px with room for its needs-you
// mark (always kept, so a status change moves nothing); a pill's name at 13 px medium (a lead) or 12 px medium, plus
// its padding (2 × 12), status mark (7), gap (8) and a margin (5).
const nameW = (s) => chars(s) * 6.6 + 19;
const pillW = (s, lead) => chars(s) * (lead ? 8 : 7.4) + 44;
const headW = (s) => chars(s) * 8.2 + 8;          // a job's title, 11 px mono with 1.6 px tracking
// A hub's line is its team's size (hubLine); the layout keeps a fixed room for it (27 characters) so a change never
// moves anything, and cuts the line to it.
export const LINE_ROOM = 180;
const GAP = 6;                                    // the least space between two nodes' discs and labels (px)
// The view draws text (names, pills, lines, heads) at a fixed size in px while the camera scales the rest, and thins
// it when small: helpers' names show from scale LABELS.full, sub-leads' pills and lines from LABELS.pills; heads and
// the top-level leads' pills and lines (what tells the jobs and hubs apart) always.
// So a scene is laid out for the scale it is shown at: each text box and gap is its px size times the factor of its
// tier, 1 / the scale it is drawn at (KN for helpers' names, KH for sub-leads' pills, KD for heads and leads), in world
// units. Set for the length of one layout call (`laidOut`); 1 outside.
// ponytail: module-level settings, fine while layout stays synchronous; pass them down if layout ever awaits.
export const LABELS = { full: 0.55, pills: 0.35 };
let KN = 1, KH = 1, KD = 1;
const textK = (role) => (role === "helper" ? KN : role === "sub-lead" ? KH : KD);
// All expanded names everyone at the scale it is shown (`names: true`): helpers' and sub-leads' names take full room
// too. Its fallback for a small view (`names: false`) keeps room only for what is drawn at that scale: a tier below its
// scale reserves nothing (K 0, so nameAt is Infinity; the view's tooltip names it). Collapsed (no `names`) keeps each
// tier's room as at the scale it shows from, so its names appear on zooming in.
function laidOut(scale, build, { names } = {}) {
  const was = [KN, KH, KD], s = clamp(scale, SCALE.min, 1);
  [KN, KH, KD] = names === true ? [1 / s, 1 / s, 1 / s]
    : names === false ? [s >= LABELS.full ? 1 / s : 0, s >= LABELS.pills ? 1 / s : 0, 1 / s]
    : [1 / Math.max(s, LABELS.full), 1 / Math.max(s, LABELS.pills), 1 / s];
  try { return build(); } finally { [KN, KH, KD] = was; }
}
// Drawn in px by the view: the working / needs-you ring 6 off the disc and the selection ring 2 past it (RING_OUT),
// a team ring's half stroke (2), the gap from that ring box to the name (NAME_GAP); a disc never under MIN_DISC.
const RING_OUT = 8, NAME_GAP = 4, MIN_DISC = 8;
const clip = (s, room) => {
  const max = Math.floor((room - 8) / 6.6), all = [...String(s ?? "")];
  return all.length > max ? `${all.slice(0, max - 1).join("")}…` : all.join("");
};

/** @returns {SceneNode} */
// Only a top-level lead wears a pill (and, folded, its team's line under it); a sub-lead has a plain 12 px medium
// name, a helper an 11 px name. A name sits under its ring box, or a helper's over it (`above`) when its lead is
// below, so its own link never runs through it; a hub's name always sits under it (its children keep that clear).
const subW = (s) => chars(s) * 7.4 + 19;
/** The px width a node's label takes as the view draws it (a lead's pill, a sub-lead's or a helper's name), at any
 *  scale: for a name the view shows although its tier kept no room (selected, needs you). */
export const labelPx = (n) => (n.role === "lead" ? pillW(n.label, true) : n.role === "sub-lead" ? subW(n.label) : nameW(n.label));
const ringBox = (r, ringR) => Math.max(r + RING_OUT * KD, ringR ? ringR + 2 * KD : 0);
function sceneNode(a, x, y, { r, hub = false, ring = null, ringR = 0, line = "", folded = false, room = LINE_ROOM, above = false }) {
  const role = roleWord(a), needs = a.children.length ? a.team.needs : 0, pill = role === "lead";
  const R = ring ? ringR : 0, k = textK(role), d = Math.max(r, MIN_DISC * KD), o = ringBox(d, R);
  const up = !hub && above, h = pill ? 26 : 16;
  const labelY = up ? y - o - (NAME_GAP + h) * k : y + o + NAME_GAP * k;
  const shown = pill && line ? clip(line, room) : "";
  return { key: a.key, x, y, r: d, hub, status: a.status, ring, ringR: R, label: a.name, line: shown, folded, role, needs,
    lineW: shown ? room * k : 0, labelY, labelW: (pill ? pillW(a.name, true) : role === "sub-lead" ? subW(a.name) : nameW(a.name)) * k,
    labelAbove: up, nameAt: 1 / k, lineY: labelY + 33 * k };
}

// A node's two rectangles: its disc with its ring box, and its label (a lead's pill and the room for its line, or a
// name). Status-free, so a status change never moves anything.
function boxes(n) {
  const o = ringBox(n.r, n.ringR);
  const disc = { x: n.x - o, y: n.y - o, w: 2 * o, h: 2 * o };
  const w = Math.max(n.labelW, n.lineW), k = textK(n.role);
  if (!k) return [disc, null];                              // a name that is not drawn keeps no room
  const label = { x: n.x - w / 2, y: n.labelY, w, h: n.lineW > 0 ? n.lineY + 16 * k - n.labelY : (n.role === "lead" ? 26 : 16) * k };
  return [disc, label];
}
const apart = (a, b) => { const g = GAP * KD; return a.x + a.w + g <= b.x || b.x + b.w + g <= a.x || a.y + a.h + g <= b.y || b.y + b.h + g <= a.y; };
const union = (rects) => {
  if (!rects.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...rects.map((r) => r.x)), y = Math.min(...rects.map((r) => r.y));
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
};
const rad = (deg) => (deg * Math.PI) / 180;

// The clear sector under a hub: its pill and line sit straight below the disc, so no child and no outgoing link may go
// there. Half-angle from straight down (90°), in degrees: the label box's corner angle, at least 30, plus a margin.
const deg = (r) => (r * 180) / Math.PI;
const sectorOf = (node) => { const l = boxes(node)[1]; return Math.max(30, l ? deg(Math.atan2(l.w / 2, l.y - node.y)) : 0) + 4; };

// The item angles an arc may use around `parent`: [a0, a1] inside the window outside its sector, and `d`, the wanted
// centre. A link bends clockwise by atan(2·bend) as it leaves, so the side that turns into the sector gives that up.
function arcWindow(parent, dir, maxSpan, bend) {
  const h = sectorOf(parent), lo = 90 + h, hi = 450 - h - deg(Math.atan(2 * bend));
  let d = ((((dir - lo) % 360) + 360) % 360) + lo;
  if (d > hi) d = d - hi < lo + 360 - d ? hi : lo;
  let a0 = Math.max(lo, d - maxSpan / 2), a1 = Math.min(hi, d + maxSpan / 2);
  const S = Math.min(maxSpan, hi - lo);
  if (a1 - a0 < S / 2) { const c = clamp(d, lo + S / 2, hi - S / 2); a0 = c - S / 2; a1 = c + S / 2; }
  return { a0, a1, d };
}

// The ways m items can sit in a window: `step` apart, centred on d first, then shifted 5° at a time either way while
// the arc fits (so a neighbour's label nudges the arc rather than sending an item one orbit out); spread evenly, one
// way only, when step >= 360.
// An odd outer orbit (`stagger`) starts half a step round, so its children sit between the inner ones, not behind.
function arcAngles({ a0, a1, d }, m, step, stagger = false) {
  if (step >= 360) {
    // evenly, then turned 5° at a time either way, up to half the spacing, while every one stays in the window
    const base = Array.from({ length: m }, (_, i) => a0 + ((a1 - a0) * (i + (stagger ? 1 : 0.5))) / (m + (stagger ? 1 : 0)));
    const half = (a1 - a0) / (2 * (m + (stagger ? 1 : 0))), ways = [base];
    for (let o = 5; o <= half; o += 5) for (const sgn of [1, -1]) {
      const turned = base.map((x) => x + sgn * o);
      if (turned[0] >= a0 && turned.at(-1) <= a1) ways.push(turned);
    }
    return ways;
  }
  const g = m > 1 ? Math.min(step, (a1 - a0) / (m - 1)) : 0, span = g * (m - 1);
  const lo = a0 + span / 2, hi = a1 - span / 2, c0 = clamp(d + (stagger ? Math.min(step, a1 - a0) / 2 : 0), lo, hi);
  const centres = [c0];
  for (let o = 5; c0 - o >= lo || c0 + o <= hi; o += 5) {
    if (c0 + o <= hi) centres.push(c0 + o);
    if (c0 - o >= lo) centres.push(c0 - o);
  }
  return centres.map((c) => Array.from({ length: m }, (_, i) => c - span / 2 + g * i));
}

// A link's curve as a polyline, and whether it crosses a rectangle (Liang-Barsky per segment).
const curveOf = (l) => Array.from({ length: 13 }, (_, i) => linkPoint(l, i / 12));
function segHits(p, q, r) {
  let t0 = 0, t1 = 1;
  const dx = q[0] - p[0], dy = q[1] - p[1];
  for (const [pp, qq] of [[-dx, p[0] - r.x], [dx, r.x + r.w - p[0]], [-dy, p[1] - r.y], [dy, r.y + r.h - p[1]]]) {
    if (pp === 0) { if (qq < 0) return false; continue; }
    const t = qq / pp;
    if (pp < 0) { if (t > t1) return false; t0 = Math.max(t0, t); } else { if (t < t0) return false; t1 = Math.min(t1, t); }
  }
  return true;
}
const curveHits = (pts, r) => Boolean(r) && pts.some((p, i) => i > 0 && segHits(pts[i - 1], p, r));
// Whether a curve comes within a disc ({x, y, r}): its bounding box first, then each segment's distance.
function curveNear(c, d) {
  const b = c.box;
  if (d.x + d.r < b[0] || d.x - d.r > b[2] || d.y + d.r < b[1] || d.y - d.r > b[3]) return false;
  const r2 = d.r * d.r;
  for (let i = 1; i < c.pts.length; i++) {
    const [px, py] = c.pts[i - 1], dx = c.pts[i][0] - px, dy = c.pts[i][1] - py, L = dx * dx + dy * dy;
    const t = L ? clamp(((d.x - px) * dx + (d.y - py) * dy) / L, 0, 1) : 0;
    const ex = px + t * dx - d.x, ey = py + t * dy - d.y;
    if (ex * ex + ey * ey < r2) return true;
  }
  return false;
}
const curve = (l) => {
  const pts = curveOf(l), xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { pts, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
};
const DISC_CLEAR = 4; // px a link keeps from any disc but its own two ends
const SHADE_LOOK = 12; // degrees a swept child looks past a shadowed place for an open one
const grow = (r, by) => ({ x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by });

// What a constellation has placed so far: every rectangle, every hub's label box (with its key), every disc, every
// link's curve (with the key it ends at). No link crosses a hub's pill or line but its own incoming one; a helper's own
// link misses its name (another link under a helper's name is hidden by the view's patch under the words); a link
// passes no disc but its own two ends, so no agent reads as a sibling's child.
const newWorld = () => ({ rects: [], labels: [], discs: [], curves: [] });
const discOf = (n) => ({ key: n.key, x: n.x, y: n.y, r: n.r + DISC_CLEAR });
function addNode(world, n) {
  const [disc, label] = boxes(n);
  world.rects.push(disc, ...(label ? [label] : []));
  world.discs.push(discOf(n));
  if (n.hub && label) world.labels.push({ key: n.key, r: grow(label, 2) });
}

// Children on arcs around `parent`: orbit k at radius R + k·dR (y squashed by `squash`), centred on angle `dir`,
// `step` degrees apart (360: spread evenly) within `maxSpan` and outside the parent's clear sector; an odd orbit
// starts half a step round. Every rectangle stays GAP apart, every link stays off every hub's label and every disc
// but its own ends, and every disc off every link; a child keeps out of an inner disc's shadow where it can. Each orbit takes as many of the rest as a clockwise sweep can fit
// (each at the first clear angle); they take the arc's own even pattern when that is clear, else the swept angles.
// All the rest may first take the orbit up to 30% wider. Board order runs clockwise. Returns [{ node, angle }] and
// adds them to `world`.
// ponytail: the sweep steps 1° and checks against everything placed; fine to a few hundred agents.
function arcPlace(items, { parent, R, dir, step, maxSpan, squash = 1, bend, make, world }) {
  const out = [];
  if (!items.length) return out;
  const win = arcWindow(parent, dir, maxSpan, bend);
  const probe = items.map((a) => boxes(make(a, 0, 0, { x: 0, y: 0 })));
  const dR = Math.max(...probe.flat().filter(Boolean).map((b) => Math.max(b.w, b.h))) + GAP * KD;
  const at = (a, angle, Rk) => {
    const node = make(a, parent.x + Rk * Math.cos(rad(angle)), parent.y + Rk * squash * Math.sin(rad(angle)), parent);
    const [disc, name] = boxes(node);
    return { node, angle, rects: name ? [disc, name] : [disc], disc: discOf(node), label: name && grow(name, 2), curve: curve(link(parent, node, bend, false)),
      ray: curve(link(parent, node, 0, false)) };
  };
  // t clear of the world and of `others` (both ways).
  const clearOf = (t, others) => t.rects.every((r) => world.rects.every((p) => apart(r, p)) && others.every((u) => u.rects.every((q) => apart(r, q))))
    && world.labels.every((l) => !curveHits(t.curve.pts, l.r))
    && (t.node.hub ? world.curves.every((c) => !curveHits(c.pts, t.label)) : !curveHits(t.curve.pts, t.label)) // a helper's own link misses its name
    && world.discs.every((d) => d.key === parent.key || !curveNear(t.curve, d))
    && world.curves.every((c) => !curveNear(c, t.disc))
    && others.every((u) => (!u.node.hub || !curveHits(t.curve.pts, u.label)) && (!t.node.hub || !curveHits(u.curve.pts, t.label))
      && !curveNear(t.curve, u.disc) && !curveNear(u.curve, t.disc));
  // Out of every placed disc's shadow: the straight line from the parent clears it too (wanted, not required: with
  // many helpers round one lead the shadows close every gap, and the curved link alone still clears the disc).
  const unshadowed = (t, others) => [...world.discs, ...others.map((u) => u.disc)].every((d) => d.key === parent.key || !curveNear(t.ray, d));
  const allClear = (tries) => tries.every((t, i) => clearOf(t, tries.slice(0, i)) && unshadowed(t, tries.slice(0, i)));
  const pattern = (list, Rk, stagger) => {
    for (const angles of arcAngles(win, list.length, step, stagger)) {
      const tries = angles.map((angle, i) => at(list[i], angle, Rk));
      if (allClear(tries)) return tries;
    }
    return null;
  };
  // Each in turn at the first clear angle after the last one; one in an inner disc's shadow looks up to SHADE_LOOK°
  // further for a place out of every shadow.
  const sweep = (list, Rk) => {
    const got = [];
    let from = win.a0;
    for (const a of list) {
      let t = null;
      for (let angle = from; angle <= win.a1 && !t; angle += 1) { const c = at(a, angle, Rk); if (clearOf(c, got)) t = c; }
      if (!t) break;
      if (!unshadowed(t, got)) {
        for (let angle = t.angle + 1; angle <= Math.min(win.a1, t.angle + SHADE_LOOK); angle += 1) {
          const c = at(a, angle, Rk);
          if (clearOf(c, got) && unshadowed(c, got)) { t = c; break; }
        }
      }
      got.push(t);
      from = t.angle + 1;
    }
    return got;
  };
  let rest = items;
  for (let k = 0; rest.length; k++) {
    const Rk = R + k * dR, stagger = k % 2 === 1;
    let fit = null;
    for (const g of [1, 1.1, 1.2, 1.3]) if (!fit) fit = pattern(rest, Rk * g, stagger);
    if (!fit) {
      const swept = sweep(rest, Rk);
      fit = swept.length ? pattern(rest.slice(0, swept.length), Rk, stagger) ?? swept : null;
    }
    if (!fit && k >= 60) fit = rest.map((a, i) => at(a, win.a0 + ((win.a1 - win.a0) * (i + 0.5)) / rest.length, Rk)); // keeps a pathological input finite
    if (!fit) continue;
    for (const t of fit) {
      addNode(world, t.node);
      world.curves.push({ to: t.node.key, ...t.curve });
      out.push({ node: t.node, angle: t.angle });
    }
    rest = rest.slice(fit.length);
  }
  return out;
}

const link = (from, to, bend, live) => {
  const dx = to.x - from.x, dy = to.y - from.y;
  return { from: from.key, to: to.key, a: [from.x, from.y], c: [(from.x + to.x) / 2 - dy * bend, (from.y + to.y) / 2 + dx * bend], b: [to.x, to.y], live };
};
const hubNode = (a, x, y, opts) => sceneNode(a, x, y, { hub: true, ...opts });
const leafNode = (a, x, y, r, parent) => sceneNode(a, x, y, { r, above: parent.y - y > r });
// Leaves first, then hubs deepest first, so a lead sits on top; board order inside each group.
const drawOrder = (nodes, tree) => [...nodes].sort((p, q) => (p.hub - q.hub) || (p.hub ? tree.byKey.get(q.key).depth - tree.byKey.get(p.key).depth : 0));

function moved(part, dx, dy) {
  for (const n of part.nodes) { n.x += dx; n.y += dy; n.labelY += dy; n.lineY += dy; }
  for (const l of part.links) for (const p of [l.a, l.c, l.b]) { p[0] += dx; p[1] += dy; }
  for (const h of part.heads ?? []) { h.x += dx; h.y += dy; }
  return part;
}
// A head's box: its title, and under it the meta with the machine's label in front (as the view may draw it).
const headRect = (h) => {
  const w = Math.max(headW(h.title), nameW([h.machine, h.meta].filter(Boolean).join(" · "))) * KD;
  return { x: h.anchor === "middle" ? h.x - w / 2 : h.x, y: h.y, w, h: 32 * KD };
};
const partBounds = (part) => union([...part.nodes.flatMap(boxes).filter(Boolean), ...(part.heads ?? []).map(headRect)]);

// Finished scene: draw order, rectangles to bounds, centred on 0,0.
function finish(tree, part) {
  let b = partBounds(part);
  moved(part, -(b.x + b.w / 2), -(b.y + b.h / 2));
  b = partBounds(part);
  return { nodes: drawOrder(part.nodes, tree), links: part.links, heads: part.heads ?? [], bounds: b };
}

// Parts laid left to right by their bounds, `gap` apart, their anchors on one line.
function row(parts, gap) {
  let x = 0;
  for (const p of parts) { const b = partBounds(p); moved(p, x - b.x, 0); x += b.w + gap; }
  return { nodes: parts.flatMap((p) => p.nodes), links: parts.flatMap((p) => p.links), heads: parts.flatMap((p) => p.heads ?? []) };
}

// Radii in an open team by depth: hubs 38 → 26 → 18 → 14 → 12, helpers 19 → 13 → 11 → 10 (the mockup's first two).
const HUB_R = [SIZE.open, SIZE.sub, 18, 14, 12];
const LEAF_R = [SIZE.leaf, SIZE.leaf, SIZE.subLeaf, 11, 10];
const hubR = (d) => HUB_R[Math.min(d, HUB_R.length - 1)];
const leafR = (d) => LEAF_R[Math.min(d, LEAF_R.length - 1)];

// One root's whole subtree (wc.py generalised). The root: leaves round it when it has no sub-leads, else on an arc to
// the left, sub-leads on an arc to the right. A sub-lead: its leaves and its own sub-leads on smaller orbits centred
// on the direction away from its parent, deeper the same way. Every rectangle avoids every earlier one.
function constellation(root) {
  const E = SIZE;
  const nodes = [], links = [];
  const centre = hubNode(root, 0, 0, { r: E.open });
  nodes.push(centre);
  const world = newWorld();
  addNode(world, centre);
  const hub = (a) => (x, y) => hubNode(a, x, y, { r: hubR(a.depth) });
  const place = (a, node, away) => {
    const subs = a.children.filter((c) => c.children.length), leaves = a.children.filter((c) => !c.children.length);
    const top = away == null;
    const d = a.depth;
    const subOpts = top ? { R: E.subOrbit, dir: 0, step: 62, maxSpan: leaves.length ? 150 : 360 }
      : { R: Math.max(110, E.subOrbit * 0.7 ** d), dir: away, step: 50, maxSpan: 160 };
    const leafOpts = top ? (subs.length ? { R: E.leafOrbit, dir: 180, step: 40, maxSpan: 160 } : { R: E.leafOrbit, dir: 90, step: 360, maxSpan: 360 })
      : { R: Math.max(70, E.subLeafOrbit * 0.8 ** (d - 1)), dir: away, step: 37, maxSpan: 200 };
    const bend = top ? [0.12, 0.08] : [0.06, 0.06];
    const subNodes = arcPlace(subs, { parent: node, ...subOpts, bend: bend[1], world, make: (s, x, y) => hub(s)(x, y) });
    const leafNodes = arcPlace(leaves, { parent: node, ...leafOpts, bend: bend[0], world, make: (l, x, y, p) => leafNode(l, x, y, leafR(l.depth), p) });
    for (const { node: n } of leafNodes) { nodes.push(n); links.push(link(node, n, bend[0], n.status === "working")); }
    for (const { node: n } of subNodes) { nodes.push(n); links.push(link(node, n, bend[1], n.status === "working")); }
    subNodes.forEach(({ node: n, angle }, i) => place(subs[i], n, angle));
  };
  place(root, centre, null);
  return { nodes, links };
}

// A top-level lead with its team folded: its disc, the segmented ring of its whole team, its helper count.
const leadPart = (root) => ({ nodes: [hubNode(root, 0, 0, { r: SIZE.lead, ring: ringOf(root, { deep: true }), ringR: SIZE.leadRing, line: hubLine(root), folded: root.children.length > 0 })], links: [] });

const HEAD_CLEAR = 24; // px between a job's head (title and meta, 32 tall) and the top of its leads
const JOB_GAP = 120, LEAD_GAP = 80, ROW_GAP = 80;

// Every job: its leads left to right (each folded, or whole when `whole(root)`), its head above. Jobs flow left to
// right in rows, in board order: of every way to cut them into rows, the one the view ({width, height}, px) shows
// largest. The rows are chosen on the folded sizes in collapsed mode, so opening a lead only moves its neighbours
// aside, never to another row.
function layout(tree, whole, view, splitWhole) {
  const jobPart = (job, isWhole) => {
    const part = row(job.roots.map((r) => (isWhole(r) ? constellation(r) : leadPart(r))), LEAD_GAP);
    const b = partBounds(part);
    part.heads = [{ job: job.id, title: job.name, meta: job.branch ?? "", machine: machineLabel(job.machine), x: b.x + b.w / 2, y: b.y - (HEAD_CLEAR + 32) * KD, anchor: "middle" }];
    return part;
  };
  const items = tree.jobs.map((job) => {
    const measured = jobPart(job, splitWhole), b = partBounds(measured);
    // the part as measured when it is drawn the same way (all of expanded, every job but the open one's)
    return { part: job.roots.every((r) => whole(r) === splitWhole(r)) ? measured : jobPart(job, whole), w: b.w, h: b.h };
  });
  // The ways to cut the jobs into rows: every one (a cut after each job or not) up to 10 jobs; past that, greedy rows
  // no wider than an even share of the whole.
  // ponytail: 2^(jobs-1) cuts, fine to 10 jobs; past that the greedy split, which can miss the best rows.
  const total = items.reduce((n, it) => n + it.w, 0) + JOB_GAP * Math.max(0, items.length - 1);
  const ways = [];                                         // each: cut[i] true starts a new row at job i
  if (items.length <= 10) for (let mask = 0; mask < 2 ** Math.max(0, items.length - 1); mask++) ways.push(items.map((_, i) => i > 0 && Boolean((mask >> (i - 1)) & 1)));
  else for (let n = 1; n <= items.length; n++) {
    let w = 0;
    ways.push(items.map((it, i) => { const cut = i > 0 && w + JOB_GAP + it.w > total / n + 1e-6; w = i === 0 || cut ? it.w : w + JOB_GAP + it.w; return cut; }));
  }
  let best = null;
  for (const cut of ways) {
    const rows = [];
    items.forEach((it, i) => {
      const last = rows.at(-1);
      if (last && !cut[i]) { last.items.push(it); last.w += JOB_GAP + it.w; last.h = Math.max(last.h, it.h); }
      else rows.push({ items: [it], w: it.w, h: it.h });
    });
    const w = Math.max(...rows.map((r) => r.w)), h = rows.reduce((t, r) => t + r.h, 0) + ROW_GAP * (rows.length - 1);
    const shows = Math.min(view.width / w, view.height / h);
    if (!best || shows > best.shows + 1e-9) best = { rows, shows };
  }
  const all = { nodes: [], links: [], heads: [] };
  let y = 0;
  for (const r of best?.rows ?? []) {
    const part = row(r.items.map((it) => it.part), JOB_GAP);
    const b = partBounds(part);
    moved(part, -(b.x + b.w / 2), y - b.y);
    y += b.h + ROW_GAP;
    all.nodes.push(...part.nodes); all.links.push(...part.links); all.heads.push(...part.heads);
  }
  return finish(tree, all);
}

// `width` and `height` are the view's room in px (rows of jobs follow its shape); `scale` the camera scale the
// scene will be shown at (text keeps its px size).

/** Collapsed: each job's top-level leads, folded, with `open` (a top-level lead's key, or null) whole in place.
 *  Names keep each tier's room (they appear on zooming in), or with `names: false` only what is drawn (see laidOut). */
export function collapsedScene(tree, { open = null, width = 1440, height = width * 0.62, scale = 1, names } = {}) {
  return laidOut(scale, () => layout(tree, (r) => r.key === open, { width, height }, () => false), { names });
}

/** All expanded: every lead with its whole team; `names` (true) keeps every agent's name room at the scale shown;
 *  false keeps room only for what the view draws at that scale (see laidOut). */
export function expandedScene(tree, { width = 1440, height = width * 0.62, scale = 1, names = true } = {}) {
  return laidOut(scale, () => layout(tree, () => true, { width, height }, () => true), { names });
}

/** The scene a nav shows. */
export function sceneOf(tree, nav, { width = 1440, height = width * 0.62, scale = 1, names } = {}) {
  const n = normalize(tree, nav);
  return n.mode === "expanded" ? expandedScene(tree, { width, height, scale, names }) : collapsedScene(tree, { open: n.open, width, height, scale, names });
}

export const FIT_STEP = 0.75;   // fitSearch's scan: each try this much smaller than the last

/** The scene a nav shows, laid out for the scale it fits `viewport` at (less `pad` and `inset`, as fit), and that
 *  camera, one layout pass per step: a generator whose every `next()` lays out once (so the view can spread it over
 *  task calls) and whose return value is { scene, cam, scale, whole }.
 *  Text keeps its px size, so a smaller scale needs more world room for it, and whether a layout fits at its own scale
 *  is not monotonic (the rows of jobs change with the scale). So: scale 1 if it fits; else, from the scale scale 1's
 *  layout fits at (the answer is no larger), scan down FIT_STEP at a time to the first scale whose layout fits, and
 *  refine once at the midpoint above it.
 *  All expanded first names everyone (Collapsed keeps each tier's room). When no scanned scale fits that way, it
 *  keeps room only for what the view draws at the scale (helpers named from LABELS.full; the view's tooltips name the
 *  rest), scanning only below LABELS.full (above it the layouts are the same), so the map fits whenever it can; at
 *  worst it shows that layout at SCALE.min. Passes for the QA scene: 3-4 when it fits first, 6-8 when it falls back. */
export function* fitSearch(tree, nav, viewport, pad = 48, inset = {}) {
  const { top = 0, right = 0, bottom = 0, left = 0 } = inset;
  const room = { width: viewport.width - left - right - 2 * pad, height: viewport.height - top - bottom - 2 * pad };
  const at = (scale, names) => {
    const scene = sceneOf(tree, nav, { ...room, scale, names }), b = scene.bounds;
    const need = Math.min(b.w > 0 ? room.width / b.w : Infinity, b.h > 0 ? room.height / b.h : Infinity);
    const cam = fit(b, viewport, pad, inset);
    return { scene, cam, scale, whole: need >= cam.scale - 1e-9 };
  };
  const fits = (r) => r.cam.scale >= r.scale;
  const expanded = normalize(tree, nav).mode === "expanded", want = expanded ? true : undefined;
  const first = at(1, want);
  if (fits(first)) return first;
  // Scan down from `from` (exclusive of scales above `below`) with `names`; the first fit, refined once; else null.
  function* scan(from, names, below = Infinity) {
    let above = null;
    for (let s = from; s > SCALE.min; above = s, s *= FIT_STEP) {
      if (s >= below) continue;
      yield;
      const r = at(s, names);
      if (!fits(r)) continue;
      if (above == null) return r;
      const m = (s + above) / 2;
      if (m >= below) return r;                              // (the same layout as one that did not fit)
      yield;
      const mid = at(m, names);
      return fits(mid) ? mid : r;
    }
    return null;
  }
  const top1 = Math.min(1, first.cam.scale);
  const named = yield* scan(top1, want);
  if (named) return named;
  const drawn = yield* scan(top1, false, LABELS.full);
  if (drawn) return drawn;
  yield;
  return at(SCALE.min, false);
}

/** fitSearch run to the end: { scene, cam, scale, whole }. */
export function fitScene(tree, nav, viewport, pad = 48, inset = {}) {
  const run = fitSearch(tree, nav, viewport, pad, inset);
  for (;;) { const step = run.next(); if (step.done) return step.value; }
}

/** A laid-out scene with what a status change alters re-read from `tree`: each node's status, needs, ring and line,
 *  each link's live. Nothing moves; an agent no longer in the tree keeps what it had (a new shape needs a new layout). */
export function restyle(scene, tree) {
  const nodes = scene.nodes.map((n) => {
    const a = tree.byKey.get(n.key);
    if (!a) return n;
    return { ...n, status: a.status, needs: a.children.length ? a.team.needs : 0, ring: n.ring ? ringOf(a, { deep: true }) : null, line: n.lineW ? clip(hubLine(a), LINE_ROOM) : n.line };
  });
  const links = scene.links.map((l) => { const a = tree.byKey.get(l.to); return a ? { ...l, live: a.status === "working" } : l; });
  return { ...scene, nodes, links };
}

/** A point on a link's curve at t in [0, 1]. */
export function linkPoint(link, t) {
  const u = 1 - t;
  return [0, 1].map((i) => u * u * link.a[i] + 2 * u * t * link.c[i] + t * t * link.b[i]);
}

// ---- camera (expanded mode, and fitting a scene) ---------------------------------------------------------------

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The camera that shows `bounds` whole and centred in `viewport` ({width, height}) less `inset` (px kept clear on
 *  each side, e.g. { bottom: the card's height }), with `pad` px around, scale clamped to [SCALE.min, 1] (a scene
 *  never blows up past its designed size). */
export function fit(bounds, viewport, pad = 48, inset = {}) {
  const { top = 0, right = 0, bottom = 0, left = 0 } = inset;
  const w = viewport.width - left - right - 2 * pad, h = viewport.height - top - bottom - 2 * pad;
  const scale = clamp(Math.min(bounds.w > 0 ? w / bounds.w : 1, bounds.h > 0 ? h / bounds.h : 1), SCALE.min, 1);
  return { scale, x: bounds.x + bounds.w / 2 - (left - right) / 2 / scale, y: bounds.y + bounds.h / 2 - (top - bottom) / 2 / scale };
}

/** Zoom by `factor` keeping the world point under `point` (viewport px, origin top-left) where it is; scale clamped
 *  to SCALE. `point` is [x, y] or {x, y}. */
export function zoomAt(cam, factor, point, viewport) {
  const [px, py] = Array.isArray(point) ? point : [point.x, point.y];
  const ox = px - viewport.width / 2, oy = py - viewport.height / 2;
  const scale = clamp(cam.scale * factor, SCALE.min, SCALE.max);
  const wx = cam.x + ox / cam.scale, wy = cam.y + oy / cam.scale;
  return { scale, x: wx - ox / scale, y: wy - oy / scale };
}

/** Pan by a viewport-px delta (the world follows the pointer). */
export function pan(cam, dx, dy) { return { ...cam, x: cam.x - dx / cam.scale, y: cam.y - dy / cam.scale }; }

/** World → viewport px, as [x, y]. */
export function toScreen(cam, viewport, x, y) {
  return [viewport.width / 2 + (x - cam.x) * cam.scale, viewport.height / 2 + (y - cam.y) * cam.scale];
}

/** The scroll delta a wheel event gives as a zoom factor (exp(-dy * k), k so STEP px halves, -STEP doubles). */
export function wheelFactor(dy) { return Math.exp((-dy * Math.LN2) / STEP); }
