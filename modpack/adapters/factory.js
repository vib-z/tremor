// The factory board's facts, pure (owner request E, 2026-11-09; replaces D34's Floor and Line). Zones are tabs
// grouped by workspace, units are panes in pane order, a Core child sits beside the pane that started it.
// Only what was observed or sourced:
//   bubbles   the agent's own OSC 7501 text (`msg`) verbatim, else its raw state word, on an observed change;
//   couriers  a Core child seen starting: its `parent`, set once by Core at start, and its `created_ms` after the
//             board's first look. Fleet job files are not read (review F13): no path is ever opened;
//   motion    a phase that starts at an observed change and ends on a deadline; no change, no motion.
// Messages between agents are not recorded by herdr-core, so none are drawn.

import { displayWord, machineLabel, paneHomes } from "./status.js";
import { agentKind, kindName } from "./agents.js";

// ---- words and text --------------------------------------------------------------------------------------

// The program's own report (Core's `status` object, `report` in the app's list), or null.
const report = (t) => (t?.report && typeof t.report === "object" ? t.report : null);
const rawState = (t) => report(t)?.state ?? (typeof t?.status === "string" ? t.status : null);

// What a bubble says: the status text exactly as the program sent it, else its raw state word.
export function bubbleText(status) {
  if (!status || typeof status !== "object") return null;
  if (typeof status.msg === "string" && status.msg !== "") return status.msg;
  return typeof status.state === "string" && status.state !== "" ? status.state : null;
}

// A unit's display word, read as the tree reads it: the app's word for a listed agent (done is "done, not seen"),
// a paneless child's done is idle (it reports to its parent); a pane-backed child keeps the app word.
// A shell that stopped reporting is "exited".
export function unitWord(t, { listed = new Map(), nested = false, shell = false } = {}) {
  let w = displayWord(listed.get(t?.address)?.status ?? rawState(t));
  if (w === "done" && nested) w = "idle";
  if (!w && t?.reported && shell) w = "exited";
  return w;
}

export const RANK = { needs: 4, done: 3, working: 2, idle: 1, exited: 0 };
export const topWord = (words) => words.reduce((top, w) => (w && (top == null || RANK[w] > RANK[top]) ? w : top), null);

export const WORDS = { needs: "Needs you", working: "Working", done: "Done, not seen", idle: "Idle", exited: "Exited" };

// ---- kinds -----------------------------------------------------------------------------------------------

// What runs in a unit, in words; the view draws its mark with the pack's shared marker (ui.js kindMarker).
// The kind comes from the pack's one detector (agents.js agentKind), as the tree and the chat read it: Hermes runs
// as its own Python launcher, so the app's program name ("Python") is only the fallback (review G10).
export function unitKind(t, pane, listed) {
  const program = t?.program ?? pane?.program ?? null;
  const detected = t ? agentKind(t) : null;
  const agent = Boolean(detected || program?.agent || listed?.has(t?.address) || report(t)?.app);
  const label = (detected ? kindName(detected) : null) || program?.name || report(t)?.app || (agent ? "Agent" : "Terminal");
  return { label, agent, shell: !detected && Boolean(program?.shell), program: program?.name ?? null };
}

const clean = (s) => String(s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
// Names (owner request 14): where an agent's mark is drawn, the words are the pane's or tab's own name, never the
// agent kind (that stays in the tooltip and the accessible name). A unit's name: Core's name for the terminal, else
// the program's own telling title; else, for an agent, `fallback` (its tab's name), and for a plain program its
// program's name (a shell reads "zsh").
function unitName(t, pane, kind, fallback) {
  if (t?.name) return t.name;
  const raw = String(report(t)?.title || pane?.title || t?.title || "").trim();
  const live = clean(raw);
  // A path (checked before clean() strips its leading "~/") or a user@host is where it is, not a name.
  const telling = live && live !== kind.label && live !== kind.program && live !== t?.address && !/^[~/]|^[A-Za-z]:\\/.test(raw) && !live.includes("@");
  if (telling) return live;
  return kind.agent ? fallback ?? t?.address ?? pane?.pane ?? kind.label : kind.label;
}

// A tab someone named shows its name; an unnamed one (its name is its position) reads "Tab <n>". `TabInfo.named`
// when the app gives it, else a name that is only digits is a position.
export const tabNamed = (tab) => tab?.named ?? !/^\d+$/.test(String(tab?.name ?? ""));
const tabLabel = (tab) => (tabNamed(tab) ? tab.name : `Tab ${tab.index ?? tab.name}`);

// ---- the board -------------------------------------------------------------------------------------------

// A terminal's in-process sub-agents (7501 records), by id; nesting shows as depth (`a/b`).
export function recordUnits(t) {
  const records = t?.records ?? {};
  return Object.keys(records).sort().map((id) => {
    const r = records[id];
    const w = displayWord(r?.state);
    return { id, depth: id.split("/").length - 1, title: r?.title || r?.app || id, word: w === "done" ? "idle" : w, text: bubbleText(r),
      msg: typeof r?.msg === "string" ? r.msg : null };
  });
}

// Core qualifies remote terminal addresses as machine/tN. Invalid/missing addresses stay explicitly unknown.
export function terminalHost(address) {
  if (/^t[a-z0-9]+$/.test(address ?? "")) return { name: "", label: "This computer" };
  const remote = /^([^/]+)\/t[a-z0-9]+$/.exec(address ?? "");
  return remote ? { name: remote[1], label: remote[1] } : { name: null, label: "Unknown host" };
}

// Workspace → tab (zone) → pane (unit) in Herdr's order. Every real pane stays in its own tab, as in the sidebar
// (review G7). A Core child stands beside its parent, in the parent's squad, only when it has no pane or its pane
// is in the tab where the parent is shown; a child with a pane elsewhere is a unit of that tab, still "started by"
// its parent. Live terminals only.
// Machines (owner 17:37 request 1, 17:55 request 11): the board groups like the sidebar, machine → workspace → tab.
// A workspace's machine is `SpaceInfo.machine` (null: this computer); the known machines are this computer, the
// app's `machines()` and the spaces' own, never invented. `hidden` (shared MACHINE_KEYS.hidden) lists machine names
// ("" is this computer) the sidebar hides: their workspaces are left out and counted. `level` (MACHINE_KEYS.level)
// false, or one known machine, means no machine bands.
export function machineView({ spaces = [], machines = [], hidden = [], level } = {}) {
  const names = [...new Set([null, ...machines.map((m) => m.name ?? null), ...spaces.map((s) => s.machine ?? null)])];
  names.sort((a, b) => (a == null ? -1 : b == null ? 1 : String(a).localeCompare(String(b))));
  const off = new Set((Array.isArray(hidden) ? hidden : []).map((n) => String(n ?? "")));
  const shown = names.filter((n) => !off.has(n ?? ""));
  return { names: shown, hidden: names.length - shown.length, bands: level !== false && names.length > 1, isShown: (s) => !off.has(s.machine ?? "") };
}

export function buildBoard({ spaces: all = [], panes = [], terminals = [], agents = [], machines = [], focused = null, hidden = [], level } = {}) {
  const mv = machineView({ spaces: all, machines, hidden, level });
  const spaces = all.filter(mv.isShown);
  const here = machines.find((m) => m.name == null);
  const extra = { hiddenMachines: mv.hidden, allHidden: mv.names.length === 0, bands: null };
  if (all.length === 0 && here?.layout === "loading") return { state: "loading", regions: [], ...extra };
  if (all.length === 0 && here?.layout === "unavailable") return { state: "error", reason: "herdr-core is not answering on this computer", regions: [], ...extra };
  // The panes of a hidden machine's workspaces: their terminals are not "without a pane", they are hidden.
  const offTabs = new Set(all.filter((s) => !mv.isShown(s)).flatMap((s) => s.tabs.map((t) => t.id)));
  const away = new Set(panes.filter((p) => p.terminal && offTabs.has(p.tab)).map((p) => p.terminal));
  const listed = new Map(agents.map((a) => [a.address, a]));
  const off = new Set((Array.isArray(hidden) ? hidden : []).map((n) => String(n ?? "")));
  const live = terminals.filter((t) => t && t.state !== "finished" && !off.has(terminalHost(t.address).name));
  const byAddress = new Map(live.map((t) => [t.address, t]));
  const paneOf = new Map(panes.filter((p) => p.terminal).map((p) => [p.terminal, p]));
  const kidsOf = new Map();
  for (const t of live) if (t.parent && byAddress.has(t.parent)) kidsOf.set(t.parent, [...(kidsOf.get(t.parent) ?? []), t]);
  // The tab a terminal is shown in: its own pane's, else (paneless) its parent's; null when neither.
  const shown = new Map();
  const shownTab = (t, trail = new Set()) => {
    if (!t) return null;
    if (shown.has(t.address)) return shown.get(t.address);
    const own = paneOf.get(t.address);
    let tab = own ? own.tab : null;
    if (!own && t.parent && byAddress.has(t.parent) && !trail.has(t.parent)) tab = shownTab(byAddress.get(t.parent), new Set([...trail, t.address]));
    shown.set(t.address, tab);
    return tab;
  };
  const attached = (t) => Boolean(t.parent && byAddress.has(t.parent)) && (!paneOf.has(t.address) || paneOf.get(t.address).tab === shownTab(byAddress.get(t.parent)));
  const nested = new Set(live.filter(attached).map((t) => t.address));

  const unit = (t, pane, { depth = 0, parent = null, space, tab, label = null }) => {
    const address = t?.address ?? pane?.terminal;
    const kind = unitKind(t, pane, listed);
    const child = Boolean(t?.parent && byAddress.has(t.parent));
    const word = t ? unitWord(t, { listed, nested: child && !paneOf.has(address), shell: kind.shell }) : displayWord(pane?.status);
    return {
      address, depth, parent, space, tab,
      host: terminalHost(address),
      startedBy: child ? t.parent : null,
      pane: pane?.pane ?? paneOf.get(address)?.pane ?? null,
      name: unitName(t, pane, kind, label),
      kind, word,
      blockKind: word === "needs" ? report(t)?.kind ?? null : null,
      title: report(t)?.title || t?.title || pane?.title || "",
      msg: typeof report(t)?.msg === "string" ? report(t).msg : null,
      progress: typeof report(t)?.progress === "number" ? report(t).progress : null,
      cwd: pane?.cwd ?? t?.cwd ?? null,
      records: recordUnits(t),
      focused: Boolean(focused?.terminal && focused.terminal === address),
    };
  };
  // A unit and its Core children, depth first (cycles cut).
  const squad = (t, pane, where) => {
    const out = [unit(t, pane, where)];
    const seen = new Set([t?.address]);
    const walk = (address, depth) => {
      for (const k of kidsOf.get(address) ?? []) {
        if (seen.has(k.address) || !nested.has(k.address)) continue;
        seen.add(k.address);
        out.push(unit(k, paneOf.get(k.address), { ...where, depth, parent: address }));
        walk(k.address, depth + 1);
      }
    };
    if (t) walk(t.address, 1);
    return out;
  };

  const placed = new Set();
  const homes = paneHomes(all, panes, terminals);
  const regions = spaces.map((s) => {
    const zones = s.tabs.map((tab) => {
      const squads = [];
      for (const p of panes) {
        if (p.tab !== tab.id || homes.get(p.pane) !== s.id || !p.terminal || nested.has(p.terminal)) continue;
        const sq = squad(byAddress.get(p.terminal), p, { space: s.id, tab: tab.id, label: tabLabel(tab) });
        for (const u of sq) placed.add(u.address);
        squads.push(sq);
      }
      const units = squads.flat();
      return { id: tab.id, space: s.id, name: tab.name, named: tabNamed(tab), label: tabLabel(tab), index: tab.index, active: Boolean(tab.active && s.active), squads, units, word: topWord(units.flatMap((u) => [u.word, ...u.records.map((r) => r.word)]).filter((w) => w !== "exited")) };
    });
    return { id: s.id, name: s.name, machine: s.machine ?? null, branch: s.branch ?? null, active: Boolean(s.active), zones, word: topWord(zones.map((z) => z.word)) };
  });
  // Running and reporting, but in no pane and under no pane's terminal: shown so nothing running is hidden.
  const loose = live.filter((t) => !placed.has(t.address) && !nested.has(t.address) && !away.has(t.address)
    && (t.reported || report(t) || listed.has(t.address)));
  const hosts = [...new Set(loose.map((t) => terminalHost(t.address).name))];
  for (const host of hosts) {
    const id = host === "" ? "no-pane" : `no-pane:${host ?? "unknown"}`;
    const squads = loose.filter((t) => terminalHost(t.address).name === host).map((t) => squad(t, null, { space: null, tab: id }));
    for (const sq of squads) for (const u of sq) placed.add(u.address);
    const units = squads.flat();
    regions.push({ id, name: "Without a pane", machine: host || null, hostLabel: host == null ? "Unknown host" : machineLabel(host), active: false, loose: true,
      zones: [{ id, space: null, name: "Running in herdr-core", label: "Without a tab", index: 0, active: false, squads, units, word: topWord(units.flatMap((u) => [u.word, ...u.records.map((r) => r.word)])) }], word: topWord(units.flatMap((u) => [u.word, ...u.records.map((r) => r.word)])) });
  }
  // A band per shown machine, in the sidebar's order (this computer first), its workspaces in Herdr's order; a
  // machine with none says why from its layout state. "Without a pane" stays outside the bands.
  const bands = mv.bands ? mv.names.map((name) => ({
    machine: name, label: machineLabel(name), layout: machines.find((m) => (m.name ?? null) === name)?.layout ?? null,
    regions: regions.filter((r) => !r.loose && (r.machine ?? null) === name),
  })) : null;
  return { state: regions.length ? "ready" : "empty", regions, hiddenMachines: mv.hidden, allHidden: mv.names.length === 0, bands };
}

// What a machine band with no workspace says, from its layout state.
export const bandEmpty = (layout) => (layout === "loading" ? "Loading…" : layout === "unavailable" ? "Not answering" : "No workspaces");

// The board's reading order: each band's workspaces, then the rest (without a pane), as the board and map draw them.
export const readingGroups = (board) => {
  if (!board.bands) return [{ band: null, regions: board.regions }];
  const rest = board.regions.filter((r) => r.loose);
  return [...board.bands.map((b) => ({ band: b, regions: b.regions })), ...(rest.length ? [{ band: null, regions: rest }] : [])];
};

export function counts(board) {
  let zones = 0, units = 0, agents = 0, records = 0, needs = 0;
  for (const r of board.regions) {
    if (!r.loose) zones += r.zones.length;
    for (const z of r.zones) for (const u of z.units) {
      units++;
      if (u.kind.agent) agents++;
      records += u.records.length;
      needs += [u, ...u.records].filter((n) => n.word === "needs").length;
    }
  }
  return { workspaces: board.regions.filter((r) => !r.loose).length, zones, units, agents, records, needs };
}

// ---- the mind map (owner request 17) -----------------------------------------------------------------------
//
// Each workspace is a section in reading order (drawn top down by treeSection): an agent, the agents it started (Core's `parent`), their
// sub-agents, then each agent's in-process sub-agents (its own 7501 records). Those are the only edges: nothing is
// joined that Core didn't record. An agent with no recorded relation stands alone, in tab then pane order. Plain
// terminals with no relation fold into a count per workspace ("3 shells"); one that started or was started by
// something stays a node, so no recorded edge is lost. Rows are top-aligned: a parent sits on its first child's row.

// The board's spacing grid: one base unit of 4 px; every size and gap below is a multiple of it (request 12).
export const GRID = 4;
export const NODE = { w: 240, h: 56, col: 24, row: 12 }; // a card; the gutter between columns; between rows
export const SECTION = { head: 20, gap: 12 }; // a workspace's heading row; heading to tree

const plainWord = (units) => (units.every((u) => u.kind.shell) ? "shell" : "terminal");
// "3 shells" (or "2 terminals" when some aren't shells), for the folded count and the header.
export const plainCount = (units) => `${units.length} ${plainWord(units)}${units.length === 1 ? "" : "s"}`;

// One workspace (a board region) as a laid-out tree: nodes with their column and row, elbow edges, folded terminals.
export function mindSection(region) {
  const units = region.zones.flatMap((z) => z.units);
  const here = new Map(units.map((u) => [u.address, u]));
  const started = (u) => (u.startedBy && here.has(u.startedBy) && u.startedBy !== u.address ? u.startedBy : null);
  const kids = new Map();
  for (const u of units) if (started(u)) kids.set(u.startedBy, [...(kids.get(u.startedBy) ?? []), u]);
  const related = (u) => Boolean(started(u) || kids.has(u.address));
  const folded = units.filter((u) => !u.kind.agent && !related(u) && !u.records.length);
  const nodes = [], edges = [];
  let rows = 0, depthMax = 0;
  const seen = new Set();
  // Depth first; a leaf takes the next row, a parent its first child's. Cycles are cut by `seen`.
  const place = (node, depth) => {
    depthMax = Math.max(depthMax, depth);
    node.depth = depth;
    nodes.push(node);
    const children = [];
    if (node.type === "unit") {
      for (const k of kids.get(node.unit.address) ?? []) if (!seen.has(k.address)) { seen.add(k.address); children.push({ type: "unit", key: k.address, unit: k, edge: "started" }); }
      for (const r of node.unit.records.filter((r) => (r.depth === 0 || !node.unit.records.some((p) => p.id === r.id.slice(0, r.id.lastIndexOf("/")))))) children.push({ type: "record", key: `${node.unit.address}#${r.id}`, unit: node.unit, record: r, edge: "record" });
    } else {
      const prefix = `${node.record.id}/`;
      for (const r of node.unit.records) if (r.id.startsWith(prefix) && r.depth === node.record.depth + 1) children.push({ type: "record", key: `${node.unit.address}#${r.id}`, unit: node.unit, record: r, edge: "record" });
    }
    if (!children.length) node.row = rows++;
    for (const c of children) {
      place(c, depth + 1);
      edges.push({ from: node.key, to: c.key, kind: c.edge });
    }
    if (children.length) node.row = nodes.find((n) => n.key === children[0].key).row;
  };
  for (const u of units) {
    if (seen.has(u.address) || started(u) || folded.includes(u)) continue;
    seen.add(u.address);
    place({ type: "unit", key: u.address, unit: u }, 0);
  }
  for (const u of units) if (!seen.has(u.address) && !folded.includes(u)) { seen.add(u.address); place({ type: "unit", key: u.address, unit: u }, 0); }
  for (const n of nodes) { n.x = n.depth * (NODE.w + NODE.col); n.y = n.row * (NODE.h + NODE.row); }
  const at = new Map(nodes.map((n) => [n.key, n]));
  for (const e of edges) e.points = elbow(at.get(e.from), at.get(e.to));
  return {
    region, nodes, edges, folded,
    w: nodes.length ? (depthMax + 1) * NODE.w + depthMax * NODE.col : 0,
    h: rows ? rows * NODE.h + (rows - 1) * NODE.row : 0,
  };
}

// The hairline from a parent's right edge to a child's left edge, turning once in the gutter between them.
export function elbow(a, b) {
  const y1 = a.y + NODE.h / 2, y2 = b.y + NODE.h / 2, x1 = a.x + NODE.w, x2 = b.x, mid = x1 + NODE.col / 2;
  return y1 === y2 ? [[x1, y1], [x2, y2]] : [[x1, y1], [mid, y1], [mid, y2], [x2, y2]];
}

// The whole board as the mind map draws it: the reading groups (machine bands), each workspace a section.
export const mindMap = (board) => readingGroups(board).map((g) => ({ band: g.band, sections: g.regions.map(mindSection) }));

// The map's nodes in reading order, the arrow keys' order. Every report record is selectable; an action always targets
// its real owner.
export function outline(map) {
  return map.flatMap((g) => g.sections.flatMap((s) => s.nodes.map((n) => {
    const zone = s.region.zones.find((z) => z.units.some((u) => u.address === n.unit.address));
    const host = s.region.loose ? s.region.hostLabel : machineLabel(s.region.machine);
    const name = n.type === "record" ? n.record.title : n.unit.name;
    const context = `${host} / ${s.region.name} / ${zone?.label ?? zone?.name ?? "Without a tab"} / ${n.unit.name}`;
    return { ...n, region: s.region, zone, host, name, context,
      identity: `${context}${n.type === "record" ? ` / ${name} (${n.record.id})` : ""} · ${n.unit.address}`,
      word: n.type === "record" ? n.record.word : n.unit.word };
  })));
}

// The Board's layout (owner, 14 Nov: "the lead agent on top and branches below", "kinda centred", "fit the screen",
// "icons minimal rather than these massive cards"). Each agent is a one-line pill. A lead sits centred over the agents
// it started, which stand side by side below it and wrap onto further rows to fit `room`; each of those agents'
// own helpers stack under it in an indented column. Agents nothing started and that started nothing share rows too,
// with no lead over them. The board only grows downward. A lead's edge is a hairline from its bottom centre to the
// rail above its agent's row (rows after the first are reached down a trunk at the left), then down into the
// agent's top; a helper's is the sidebar tree's thin line down the indent column.
// ponytail: the indent stops at PILL.levels, so a deep chain keeps a readable pill; past it the line drops straight.
export const PILL = { lead: 256, w: 176, h: 28, col: 16, row: 24, gap: 4, indent: 16, levels: 3, trunk: 16 };
// `h`: the pill's height; a narrow view passes its 44 px target (docs/DESIGN.md: narrow pressables are 44 tall).
export function treeSection(section, room = Infinity, h = PILL.h) {
  const P = { ...PILL, h };
  const kids = new Set(section.edges.map((e) => e.from));
  // Groups in reading order: a lead and its columns (an agent it started and that agent's descendants), or a run of
  // lone agents, a column each. `nodes` is depth first, so a column's members follow its head.
  const groups = [];
  for (const n of section.nodes) {
    const last = groups.at(-1);
    if (n.depth === 0 && kids.has(n.key)) groups.push({ lead: n, cols: [] });
    else if (n.depth === 0) { if (last && !last.lead) last.cols.push([n]); else groups.push({ lead: null, cols: [[n]] }); }
    else if (n.depth === 1) last.cols.push([n]);
    else last.cols.at(-1).push(n);
  }
  const at = new Map(), lines = new Map();
  let y = 0, w = 0;
  for (const g of groups) {
    // A board narrower than a pill narrows it; a trunk takes its strip at the left first.
    const width = (x0) => Math.max(0, Math.min(P.w, room - x0));
    const fits = (x0) => Math.max(1, Math.floor((room - x0 + P.col) / (width(x0) + P.col)));
    let x0 = 0, per = fits(0);
    if (g.lead && g.cols.length > per) { x0 = P.trunk; per = fits(x0); }
    const pw = width(x0), step = pw + P.col;
    let top = y;
    if (g.lead) {
      const span = Math.min(per, g.cols.length) * step - P.col, lw = Math.min(Math.max(span, pw), P.lead);
      at.set(g.lead.key, { x: x0 + (span - lw) / 2, y, w: lw, h: P.h });
      top += P.h + P.row;
    }
    const rails = [];
    for (let r = 0, start = 0; start < g.cols.length; r++, start += per) { // by start: Infinity * 0 is NaN
      const row = g.cols.slice(start, start + per);
      rails.push(top - P.row / 2);
      let bottom = top;
      row.forEach((col, i) => col.forEach((n, k) => {
        const off = Math.min(n.depth - col[0].depth, P.levels) * P.indent, ny = top + k * (P.h + P.gap);
        at.set(n.key, { x: x0 + i * step + off, y: ny, w: Math.max(0, pw - off), h: P.h });
        if (k === 0 && g.lead) lines.set(n.key, { rails, r, x0 });
        bottom = Math.max(bottom, ny + P.h);
      }));
      w = Math.max(w, x0 + row.length * step - P.col);
      top = bottom + P.row;
    }
    y = top;
  }
  const nodes = section.nodes.map((n) => ({ ...n, ...at.get(n.key) }));
  const place = new Map(nodes.map((n) => [n.key, n]));
  const edges = section.edges.filter((e) => place.has(e.from) && place.has(e.to)).map((e) => {
    const a = place.get(e.from), b = place.get(e.to), line = lines.get(e.to);
    if (!line) { // a helper: down the parent's indent column, across to the child's left side
      const x = a.x + P.indent / 2, mid = b.y + P.h / 2;
      return { ...e, points: b.x > a.x ? [[x, a.y + P.h], [x, mid], [b.x, mid]] : [[x, a.y + P.h], [x, b.y]] };
    }
    const lx = a.x + a.w / 2, cx = b.x + b.w / 2, rail = line.rails[line.r], first = line.rails[0];
    const down = line.r === 0 ? [[lx, a.y + P.h], [lx, rail]] : [[lx, a.y + P.h], [lx, first], [line.x0 / 2, first], [line.x0 / 2, rail]];
    return { ...e, points: [...down, [cx, rail], [cx, b.y]] };
  });
  return { ...section, nodes, edges, total: section.nodes.length, w, h: Math.max(0, y - P.row) };
}

export const attention = (nodes) => nodes.find((n) => (n.type === "record" ? n.record.word : n.unit.word) === "needs") ?? nodes[0];

// A node's line under its name: the program's own last status text, first line exactly as sent, or null.
export const nodeMessage = (node) => {
  const text = node.type === "record" ? node.record.msg : node.unit.msg;
  return typeof text === "string" && text !== "" ? text.split("\n")[0] : null;
};

// ---- observation -----------------------------------------------------------------------------------------

// How long each phase lasts. A bubble shows, then fades; a pulse rings once; a courier leaves, travels,
// waits at its destination, then goes. Under Reduce Motion each is instant: no fade, no ring, no travel.
export const MOTION = { bubbleShow: 6000, bubbleFade: 600, pulseOn: 300, pulseFade: 900, courierDepart: 60, courierTravel: 1100, courierHold: 4500 };
export const HISTORY = 20;
const MAX_BUBBLES = 200;
const MAX_LOG = 100;

export function newObservation(now) {
  return { since: now, seq: 0, agents: new Map(), bubbles: [], couriers: [], pulses: new Map(), log: [] };
}

const key = (s) => (s ? `${s.state ?? ""}\u0000${s.msg ?? ""}` : "");

// What a unit said, newest first. Past the cap the oldest go and are counted; each kept entry keeps its own
// time, so nothing kept claims an earlier start (review F12).
function said(obs, a, entry) {
  a.history.unshift(entry);
  if (a.history.length > HISTORY) { a.dropped += a.history.length - HISTORY; a.history.length = HISTORY; }
  if (!entry.observed) return;
  obs.bubbles.push({ id: ++obs.seq, address: a.address, text: entry.text, source: entry.source, label: entry.label ?? null, rec: entry.id ?? null, at: entry.at });
  if (obs.bubbles.length > MAX_BUBBLES) obs.bubbles.splice(0, obs.bubbles.length - MAX_BUBBLES);
}

function courier(obs, c) {
  obs.couriers.push({ id: ++obs.seq, ...c });
  obs.log.unshift(c);
  if (obs.log.length > MAX_LOG) obs.log.length = MAX_LOG;
}

// One look at the live terminals. Records what changed since the last look and returns whether anything did.
// A terminal Core created after the board started is seen being born: its first words and its start are events.
// Anything already there at the first look is history only ("before the board started"), never a bubble.
export function observe(obs, terminals, now, listed = new Map()) {
  let changed = false;
  const live = new Set();
  for (const t of terminals) {
    if (!t || t.state === "finished") continue;
    live.add(t.address);
    const root = report(t);
    const word = displayWord(listed.get(t.address)?.status ?? rawState(t));
    let a = obs.agents.get(t.address);
    if (!a) {
      const born = typeof t.created_ms === "number" && t.created_ms >= obs.since;
      a = { address: t.address, firstSeen: now, born, root: key(root), records: new Map(), word, wordAt: born ? now : null, history: [], dropped: 0 };
      obs.agents.set(t.address, a);
      if (born) changed = true;
      if (born && t.parent && obs.agents.has(t.parent)) {
        courier(obs, { kind: "start", from: t.parent, to: t.address, at: now, source: "herdr-core parent", text: `${t.parent} started ${t.name || t.address}` });
      }
      const text = bubbleText(root);
      if (text != null) said(obs, a, { text, at: now, core: t.status_ms ?? null, observed: born, source: "status" });
      for (const r of recordUnits(t)) {
        a.records.set(r.id, key(t.records[r.id]));
        if (r.text != null) said(obs, a, { text: r.text, at: now, observed: born, source: "record", label: r.title, id: r.id });
      }
      continue;
    }
    const k = key(root);
    if (k !== a.root) {
      a.root = k;
      const text = bubbleText(root);
      if (text != null) { said(obs, a, { text, at: now, core: t.status_ms ?? null, observed: true, source: "status" }); changed = true; }
    }
    const ids = new Set();
    for (const r of recordUnits(t)) {
      ids.add(r.id);
      const rk = key(t.records[r.id]);
      if (a.records.get(r.id) === rk) continue;
      a.records.set(r.id, rk);
      if (r.text != null) { said(obs, a, { text: r.text, at: now, observed: true, source: "record", label: r.title, id: r.id }); changed = true; }
    }
    for (const id of [...a.records.keys()]) if (!ids.has(id)) a.records.delete(id);
    if (word !== a.word) {
      a.word = word;
      a.wordAt = now;
      obs.pulses.set(t.address, now);
      changed = true;
    }
  }
  for (const address of [...obs.agents.keys()]) {
    if (live.has(address)) continue;
    obs.agents.delete(address);
    obs.pulses.delete(address);
    changed = true;
  }
  return changed;
}

// Since when a unit has been in its state, and how we know: when the board saw it change; else Core's own status
// time from the board's first look (sourced); else at least since that first look.
export function sinceOf(a, statusMs) {
  if (!a) return null;
  if (a.wordAt != null) return { at: a.wordAt, basis: "observed" };
  if (statusMs) return { at: statusMs, basis: "core" };
  return { at: a.firstSeen, basis: "at least" };
}

// ---- phases ----------------------------------------------------------------------------------------------

export function bubblePhase(b, now, reduce = false) {
  const age = now - b.at;
  if (age < MOTION.bubbleShow) return "show";
  if (!reduce && age < MOTION.bubbleShow + MOTION.bubbleFade) return "fade";
  return "gone";
}

export function pulsePhase(at, now, reduce = false) {
  if (reduce) return "gone";
  const age = now - at;
  if (age < MOTION.pulseOn) return "on";
  if (age < MOTION.pulseOn + MOTION.pulseFade) return "off";
  return "gone";
}

// depart: drawn at its source; travel and arrived: at its destination (the move is the native transition).
export function courierPhase(c, now, reduce = false) {
  const age = now - c.at;
  if (age >= MOTION.courierHold) return "gone";
  if (reduce) return "arrived";
  if (age < MOTION.courierDepart) return "depart";
  return age < MOTION.courierDepart + MOTION.courierTravel ? "travel" : "arrived";
}

// The newest bubble of each unit that hasn't gone.
export function bubblesNow(obs, now, reduce = false) {
  const out = new Map();
  for (const b of obs.bubbles) {
    const phase = bubblePhase(b, now, reduce);
    if (phase === "gone") continue;
    const cur = out.get(b.address);
    if (!cur || cur.bubble.at <= b.at) out.set(b.address, { bubble: b, phase });
  }
  return out;
}

// The nodes whose newest message the board saw arrive in the last few seconds (a record's node is
// "<address>#<record id>"): their message line is drawn in full contrast until it settles.
export function freshNow(obs, now, reduce = false) {
  const out = new Set();
  for (const b of obs.bubbles) if (bubblePhase(b, now, reduce) === "show") out.add(b.rec ? `${b.address}#${b.rec}` : b.address);
  return out;
}

export const couriersNow = (obs, now, reduce = false) =>
  obs.couriers.map((c) => ({ courier: c, phase: courierPhase(c, now, reduce) })).filter((x) => x.phase !== "gone");

export const pulsesNow = (obs, now, reduce = false) =>
  new Map([...obs.pulses].map(([a, at]) => [a, pulsePhase(at, now, reduce)]).filter(([, p]) => p !== "gone"));

// Forget what has finished showing (history stays).
export function prune(obs, now, reduce = false) {
  obs.bubbles = obs.bubbles.filter((b) => bubblePhase(b, now, reduce) !== "gone");
  obs.couriers = obs.couriers.filter((c) => courierPhase(c, now, reduce) !== "gone");
  for (const [a, at] of obs.pulses) if (pulsePhase(at, now, reduce) === "gone") obs.pulses.delete(a);
}

// When the picture next changes on its own (a phase ends), or null: with nothing observed, nothing moves.
export function nextDeadline(obs, now, reduce = false) {
  const times = [];
  for (const b of obs.bubbles) times.push(b.at + MOTION.bubbleShow, ...(reduce ? [] : [b.at + MOTION.bubbleShow + MOTION.bubbleFade]));
  for (const at of obs.pulses.values()) if (!reduce) times.push(at + MOTION.pulseOn, at + MOTION.pulseOn + MOTION.pulseFade);
  for (const c of obs.couriers) times.push(...(reduce ? [] : [c.at + MOTION.courierDepart]), c.at + MOTION.courierHold);
  const next = times.filter((x) => x > now);
  return next.length ? Math.min(...next) : null;
}

// Current block allocation, before element size callbacks arrive. Follows Herdr App 2405bf3
// src/window/pane_size.rs (Apache-2.0): fixed/weighted siblings, min/max, gaps, borders and padding.
// Work in the layout's unzoomed units, like NODE; the window getter reports current window pixels.
export function blockSize(root, target, viewport, zoom = 1) {
  if (!root || !viewport || !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)) return null;
  const clamp = (n, value) => Math.max(n.min ?? 0, Math.min(n.max ?? Infinity, value));
  const weight = (n) => n.size?.weight ?? 1;
  const visit = (n, width, height) => {
    if (!n || n.hidden) return null;
    const p = n.padding ?? 0, [py, px] = Array.isArray(p) ? p : [p, p], border = n.border?.width ?? 0;
    width = Math.max(0, width - 2 * (px + border)); height = Math.max(0, height - 2 * (py + border));
    if (n.id === target) return { width, height };
    const children = (n.children ?? []).filter(c => !c.hidden);
    if (n.type === "stack") return visit(children.find(c => c.id === n.active) ?? children[0], width, Math.max(0, height - (n.header ? n.header.height ?? 28 : 0)));
    if (n.type !== "row" && n.type !== "column") return null;
    const row = n.type === "row", gap = (n.gap ?? 0) + (n.divider?.width ?? 0);
    let left = (row ? width : height) - gap * Math.max(0, children.length - 1);
    const spans = children.map(c => c.size?.px == null ? null : clamp(c, c.size.px));
    spans.forEach(x => { if (x != null) left -= x; });
    let pending = spans.flatMap((x, i) => x == null ? [i] : []);
    const originalWeight = Math.max(Number.EPSILON, pending.reduce((s, i) => s + weight(children[i]), 0)), initial = Math.max(0, left);
    while (pending.length) {
      const total = Math.max(Number.EPSILON, pending.reduce((s, i) => s + weight(children[i]), 0));
      const free = Math.min(Math.max(0, left), initial * total / originalWeight);
      const violations = pending.map(i => { const share = free * weight(children[i]) / total; spans[i] = clamp(children[i], share); return [i, spans[i] - share]; });
      const sum = violations.reduce((s, [, v]) => s + v, 0);
      if (Math.abs(sum) < Number.EPSILON) break;
      const frozen = violations.filter(([, v]) => sum > 0 ? v > 0 : v < 0).map(([i]) => i);
      for (const i of frozen) left -= spans[i];
      pending = pending.filter(i => !frozen.includes(i));
    }
    for (let i = 0; i < children.length; i++) {
      const found = visit(children[i], row ? spans[i] : width, row ? height : spans[i]);
      if (found) return found;
    }
    return null;
  };
  return visit(root, viewport.width / zoom, viewport.height / zoom);
}
