// The factory: a mind map of the agents actually running (owner request 17; it replaces request E's board of tiles),
// the full width: the sidebar already lists everything, so no side pane (owner, 10 Nov 2026).
// Machine → workspace as quiet section heads (17:55 request 11), then each workspace reads top down: an agent,
// the agents it started (herdr-core's recorded parent), their sub-agents, and each agent's in-process sub-agents
// (its own 7501 records). A node is the agent's mark, its pane's name (request 14) and the pack's one status
// marker (requests 7 and 10), with the program's own last status text under it, word for word. Hairline tree lines
// only for what Core recorded; a courier dot only for a start the board saw. Motion only on an observed change,
// none under Reduce Motion. It reads the app's live state and asks Core once per terminal for its status time
// (`hc get`; the app's list carries none). No file, no exec. The data rules are in lib/factory.js.

import { View, div, svg, PathBuilder } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { spaces, panes, terminals, agents, focused, machines, theme, run, hc, layout, nextCommand, shared, settings } from "herdr";
import { TYPE, SPACE, ICON, ROW, iconFor, RADIUS, iconPath, findNode, reduceMotion, clock, folderLabel, kindMarker, statusMarker, textButton, withFont, monoFont, interactionStyle, icon, spinner, workingText, NARROW } from "./lib/ui.js";
import { machineLabel } from "./lib/status.js";
import * as F from "./lib/factory.js";
import { newMap, bindMapKeys, drawMap, viewToggle, setView, setMode, openLead, closeLead, selectOnMap, stalled } from "./map.js";

// All type, spacing, row and mark sizes use the pack's shared scale, including Moshi.
const PANEL = ROW.two * 5;
const FILTER_KEY = "pdk.machine.filter";
// The machines a filter leaves out ("" is this computer): none for All or a machine no longer known.
const filterHides = (filter, spaceList, machineList) => {
  const names = F.machineView({ spaces: spaceList ?? [], machines: machineList ?? [] }).names.map((n) => n ?? "");
  return typeof filter === "string" && filter !== "all" && names.includes(filter) ? names.filter((n) => n !== filter) : [];
};
const MARK = iconFor(TYPE.base);
const PAD = SPACE[4];
const WORDS_ON = new Set(["working", "needs", "done"]); // anything else reads dimmed (request 8d)
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

// The arrow keys walk the board as drawn (X1), no wrap; nothing there, the selection stays. ↑ the parent (a helper:
// the pill above it in its column), ↓ the first child (a helper: the pill below it in its column), ←/→ the next agent
// along its row (a lead: the next lead, across sections). With nothing selected ↓ or → picks the first node, ↑ or ← the
// last. Parent and child come from the map's edges.
export function mapStep(map, sel, key) {
  const nodes = map.flatMap((g, gi) => g.sections.flatMap((s, si) => s.nodes.map((n) => ({ key: n.key, depth: n.depth, sec: `${gi}/${si}` }))));
  const keys = nodes.map((n) => n.key);
  if (!nodes.length) return sel;
  if (!keys.includes(sel)) return key === "down" || key === "right" ? keys[0] : keys.at(-1);
  const parent = new Map(map.flatMap((g) => g.sections.flatMap((s) => s.edges.map((e) => [e.to, e.from]))));
  const i = keys.indexOf(sel), me = nodes[i], next = nodes[i + 1];
  if (key === "up") return me.depth >= 2 ? keys[i - 1] : parent.get(sel) ?? sel;
  if (key === "down") return me.depth >= 2 ? (next?.depth >= 2 && next.sec === me.sec ? next.key : sel) : keys.find((n) => parent.get(n) === sel) ?? sel;
  let head = sel;
  while (nodes[keys.indexOf(head)].depth > 1) head = parent.get(head);
  const level = nodes[keys.indexOf(head)].depth;
  const line = nodes.filter((n) => n.depth === level && (level === 0 || n.sec === me.sec)).map((n) => n.key);
  return line[line.indexOf(head) + (key === "left" ? -1 : 1)] ?? sel;
}
// Bound under the board's own context, once per module load (the keymap is the app's), answered with on_action.
const ARROWS = ["up", "down", "left", "right"];
const arrowAction = (key) => `pdk_factory_${key}`;
let bound = false;

export default class Factory extends View {
  init(_props, cx) {
    if (!bound) try { bound = cx.bind_keys(ARROWS.map((keystroke) => ({ keystroke, action: arrowAction(keystroke), context: "PdkFactory" }))) > 0; } catch {}
    // The Map (owner, 14 Nov 2026): first, beside this Board; its state and drawing are map.js's.
    bindMapKeys(cx);
    this.atlas = newMap();
    this.obs = F.newObservation(Date.now());
    this.sel = null;
    this.coreMs = new Map();
    this.timer = null;
    this.timerAt = null;
    this.handle = cx.focus_handle();
    this.boardScroll = ScrollHandle.new();
    this.rows = [];
    // One look a second at the app's live list, in memory (no file, no Core call): the window draws, and so
    // renders, only when macOS lets it, so render can't be the observer. It redraws only when something changed.
    this.look(cx);
    cx.timer.every(1000, (cx) => this.look(cx));
    // The Map's render dropped (past the host's budget) or its layout search cut off: draw again within ~0.25 s.
    cx.timer.every(250, (cx) => { if (stalled(this.atlas) && this.shown()) { this.atlas.drawing = 0; cx.notify(); } });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        // Bindable: "pdk-factory.select" (the focused pane's unit), "pdk-factory.select:<terminal>", "pdk-factory.deselect",
        // "pdk-factory.next" / "pdk-factory.previous".
        if (c === "focus") this.handle.focus();
        else if (c === "select") { this.sel = focused()?.terminal ?? null; this.revealSel = true; }
        else if (c.startsWith("select:")) { this.sel = c.slice(7) || null; this.revealSel = true; }
        else if (c === "deselect") this.sel = null;
        else if (c === "next" || c === "previous") this.move(c === "next" ? 1 : -1);
        // The Map's: "pdk-factory.view:map" / "view:board", "mode:collapsed" / "mode:expanded",
        // "open:<terminal>" (a lead's team, in place), "close" (it folds again).
        else if (c === "view:map" || c === "view:board") setView(this.atlas, c.slice(5));
        else if (c === "mode:collapsed" || c === "mode:expanded") setMode(this.atlas, c.slice(5));
        else if (c.startsWith("open:")) openLead(this.atlas, c.slice(5));
        else if (c === "close") closeLead(this.atlas);
        if (c === "select" || c.startsWith("select:") || c === "deselect") selectOnMap(this.atlas, this.sel);
        cx.notify();
      }
    });
  }

  shown() {
    return findNode(layout(), "work-body")?.active === "factory";
  }

  look(cx) {
    const now = Date.now();
    const terms = terminals();
    const changed = F.observe(this.obs, terms, now, new Map(agents().map((a) => [a.address, a])));
    this.seed(cx, terms);
    if (changed) {
      this.schedule(cx, now);
      if (this.shown()) cx.notify();
    }
  }

  // Core's own status time, asked once per terminal (the app's list has status_ms null). It dates the state the
  // board found at its first look; a change the board sees later is dated by the board.
  seed(cx, terms) {
    for (const x of terms) {
      if (this.coreMs.has(x.address) || x.state === "finished") continue;
      this.coreMs.set(x.address, null);
      cx.spawn(async (cx) => {
        const r = await hc(["get", x.address, "--json"]).catch(() => null);
        let ms = null;
        try { ms = JSON.parse(r?.stdout ?? "").status_ms ?? null; } catch { /* none */ }
        if (ms == null) return;
        this.coreMs.set(x.address, ms);
        if (this.shown()) cx.notify();
      });
    }
    for (const a of [...this.coreMs.keys()]) if (!this.obs.agents.has(a)) this.coreMs.delete(a);
  }

  // One timer for the next moment the picture changes on its own (a bubble fades, a courier sets off or goes).
  schedule(cx, now) {
    const next = F.nextDeadline(this.obs, now, reduceMotion());
    if (next == null || (this.timerAt != null && this.timerAt > now && this.timerAt <= next)) return;
    this.timer?.cancel();
    this.timerAt = next;
    this.timer = cx.timer.after(Math.max(16, next - now), (cx) => {
      this.timer = null;
      this.timerAt = null;
      const t = Date.now();
      F.prune(this.obs, t, reduceMotion());
      this.schedule(cx, t);
      if (this.shown()) cx.notify();
    });
  }

  focusPane(address) {
    const p = panes().find((x) => x.terminal === address);
    run("layout.select", { stack: "work-body", child: "main" });
    if (p) run("pane.focus", { pane: p.pane });
    else run("terminal.peek", { terminal: address });
  }

  move(delta) {
    if (!this.rows.length) return;
    const i = this.rows.findIndex((n) => n.key === this.sel);
    this.sel = this.rows[(i < 0 ? (delta > 0 ? 0 : this.rows.length - 1) : (i + delta + this.rows.length) % this.rows.length)].key;
    this.revealSel = true;
  }

  key(e, cx) {
    if (e.key === "escape") this.sel = null;
    else if (e.key === "enter" && this.sel) {
      const node = this.rows.find((n) => n.key === this.sel);
      if (node) this.focusPane(node.unit.address);
    } else if (ARROWS.includes(e.key)) return this.arrow(e.key, cx);
    else return;
    cx.notify();
  }

  arrow(key, cx) {
    const to = mapStep(this.map ?? [], this.sel, key);
    if (to !== this.sel) { this.sel = to; this.revealSel = true; }
    cx.notify();
  }

  render(cx) {
    if (this.atlas?.view === "map") this.atlas.drawing = Date.now(); // drawMap clears it; see map.js `stalled`
    const t = theme();
    const now = Date.now();
    const reduce = reduceMotion();
    F.prune(this.obs, now, reduce);
    const terms = terminals();
    // The machine filter the header writes (spec section 2): one machine shows only its workspaces; All, or a name no
    // longer known, shows every machine. The board leaves the others out as it did hidden machines.
    const board = F.buildBoard({ spaces: spaces(), panes: panes(), terminals: terms, agents: agents(), machines: machines(), focused: focused(),
      hidden: filterHides(shared(FILTER_KEY), spaces(), machines()) });
    if (this.atlas?.view === "map") return drawMap(this, cx, board, F.blockSize(layout(), "factory", window.viewport_size(), settings().zoom || 1));
    const units = new Map(board.regions.flatMap((r) => r.zones.flatMap((z) => z.units.map((u) => [u.address, { ...u, region: r, zone: z, machine: r.hostLabel ?? machineLabel(r.machine) }]))));
    const map = board.state === "ready" ? F.mindMap(board) : [];
    this.rows = F.outline(map); this.map = map;
    if (this.sel && !this.rows.some((n) => n.key === this.sel)) this.sel = null;
    const selected = this.rows.find((n) => n.key === this.sel);
    // Size callbacks describe the preceding layout during a resize. Use the current window allocation
    // for the pdk block; retain the independent measured box for other embedding contexts.
    const slot = F.blockSize(layout(), "factory", window.viewport_size(), settings().zoom || 1);
    const viewport = slot ? { width: slot.width, height: slot.height - ROW.two - (selected ? PANEL : 0) } : this.boardViewport;
    // The view's own width sets the least target size (owner, 12 Nov: 44 px under NARROW, 24 on desktop).
    const target = (viewport?.width ?? NARROW) < NARROW ? ROW.touch : ROW.compact;
    this.pillH = target > ROW.compact ? target : F.PILL.h; // a pill is pressable: 44 tall in a narrow view
    if (viewport) this.mapRoom = viewport.width - PAD * 2;
    let root = withFont(v_flex()).id("factory").size_full().min_w(0).min_h(0).bg(t.canvas).track_focus(this.handle).key_context("PdkFactory");
    for (const k of ARROWS) root = root.on_action(arrowAction(k), (_e, cx) => this.arrow(k, cx));
    return root
      .on_key_down((e, cx) => this.key(e, cx))
      .child(this.header(t, board, [...units.values()]))
      .child(this.boardArea(t, board, map, units, now, reduce))
      .when(Boolean(selected), (el) => el.child(this.panel(t, selected, this.coreMs, units, target)));
  }

  header(t, board, all) {
    const c = F.counts(board);
    const plain = all.filter((u) => !u.kind.agent);
    return h_flex().h(ROW.two).flex_none().px(SPACE[4]).gap(SPACE[3]).items_center().border_b(1).border_color(t.border).bg(t.canvas)
      .child(h_flex().gap(SPACE[2]).items_center()
        .child(svg(iconPath("factory")).size(iconFor(TYPE.base)).flex_none().text_color(t.muted))
        .child(div().text_size(TYPE.base).font_medium().text_color(t.foreground).child("Factory")))
      .child(div().min_w(0).truncate().text_size(TYPE.sm).text_color(t.dim).child(`${plural(c.workspaces, "workspace")} · ${plural(c.agents, "agent")}${plain.length ? ` · ${F.plainCount(plain)}` : ""}`))
      .when(c.needs > 0, (el) => el.child(h_flex().id("needs-count").flex_none().gap(SPACE[1]).items_center().text_size(TYPE.sm).text_color(t.foreground)
        .accessibility_label(`${c.needs} need you`).child(statusMarker(t, "needs", "needs-count-mark")).child(`${c.needs} need${c.needs === 1 ? "s" : ""} you`)))
      .when(Boolean(this.atlas), (el) => el.child(div().flex_1()).child(viewToggle(t, this)));
  }

  // Machine bands (when there are bands), workspaces as quiet section heads, each workspace's tree under its head:
  // the lead on top, what it started below, fitted to the board's width (it scrolls down).
  boardArea(t, board, map, units, now, reduce) {
    // Absolute scroll content has no intrinsic size contribution to this flex viewport.
    const wrap = (body) => div().id("board-viewport").relative().flex_1().min_w(0).min_h(0).overflow_hidden()
      .on_size_change((size, cx) => {
        const zoom = settings().zoom || 1;
        const width = size.width / zoom, height = size.height / zoom;
        if (this.boardViewport?.width !== width || this.boardViewport?.height !== height) {
          this.boardViewport = { width, height }; cx.notify();
        }
      }).child(body);
    const area = div().id("board").absolute().inset_0().min_w(0).min_h(0).overflow_scrollbar().track_scroll(this.boardScroll);
    if (board.state !== "ready") {
      // The board is rebuilt from the app's live machine list on every draw, so it fills in by itself once Core answers.
      const words = board.state === "loading" ? "Loading the layout from herdr-core…"
        : board.state === "error" ? `Can't show the board: ${board.reason}. Start it with hc server start; the board fills in when it answers.`
        : "No workspaces. Agents appear here when programs run in a workspace.";
      return wrap(area.child(h_flex().id("board-state").p(PAD).gap(SPACE[2]).items_center().text_size(TYPE.sm).text_color(board.state === "error" ? t.blocked : t.dim).role("status")
        .when(board.state === "loading", (el) => el.child(spinner(t, ICON.sm, { color: t.muted })))
        .child(div().min_w(0).child(words))));
    }
    const live = { units, now, reduce, statusMs: this.coreMs,
      couriers: F.couriersNow(this.obs, now, reduce), pulses: F.pulsesNow(this.obs, now, reduce) };
    const visible = map.map((g) => ({ ...g, sections: g.sections.filter((s) => !this.sel || s.nodes.some((n) => n.key === this.sel)).map((s) => F.treeSection(s, this.mapRoom ?? Infinity, this.pillH)) }));
    // Cards sit at fixed places, so a selection made by key or command is scrolled to: with a selection the board
    // shows only its section, so the card's place is the padding, its machine row, the section head, its y.
    // Asked once per change, so a person's own scrolling is not fought.
    const group = this.sel ? visible.find((g) => g.sections.length) : null;
    const picked = group ? group.sections[0].nodes.find((n) => n.key === this.sel) : null;
    const anchor = picked && div().id("sel-anchor").absolute().left(PAD + picked.x).w(picked.w).h(picked.h)
      .top(PAD + (group.band ? ROW.compact + SPACE[3] : 0) + F.SECTION.head + F.SECTION.gap + picked.y);
    if (anchor && this.revealSel) this.boardScroll.scroll_to_item(1);
    this.revealSel = false;
    // Machines 32 apart; a machine's row 12 above its first workspace; workspaces 24 apart.
    return wrap(area.child(v_flex().p(PAD).gap(SPACE[8]).items_stretch().children(visible.filter((g) => !this.sel || g.sections.length).map(({ band, sections }) => (band
      ? v_flex().id(`mb-${band.machine ?? "here"}`).min_w(0).gap(SPACE[3]).role("group")
        .accessibility_label(`Machine ${band.label}: ${plural(band.regions.length, "workspace")}`)
        .child(this.machineRow(t, band))
        .when(sections.length === 0, (el) => el.child(div().text_size(TYPE.xs).text_color(t.dim).child(F.bandEmpty(band.layout))))
        .when(sections.length > 0, (el) => el.child(v_flex().min_w(0).gap(SPACE[6]).children(sections.map((sec) => this.section(t, sec, live, true)))))
      : v_flex().min_w(0).gap(SPACE[6]).children(sections.map((sec) => this.section(t, sec, live)))))))
      .when(Boolean(anchor), (el) => el.child(anchor)));
  }

  // A machine's row: its mark (the sidebar's rule: the monitor for this computer, the server for another), its name,
  // and how many workspaces it has. No rule across the row: the name and the space under it set the group apart.
  machineRow(t, band) {
    const n = band.regions.length;
    return h_flex().id(`mh-${band.machine ?? "here"}`).w_full().min_w(0).h(ROW.compact).gap(SPACE[2]).items_center()
      .child(icon(band.machine ? "server" : "monitor", ICON.base, t.muted))
      .child(div().min_w(0).truncate().text_size(TYPE.base).font_medium().text_color(t.foreground).child(band.label))
      .when(n > 0, (el) => el.child(div().flex_none().text_size(TYPE.xs).text_color(t.dim).child(plural(n, "workspace"))));
  }

  // A workspace: its head (name, git branch, shown), its tree, and the plain terminals folded into one quiet count.
  section(t, sec, live, machineHeading = false) {
    const r = sec.region;
    const shells = sec.folded;
    const shellWords = shells.map((u) => `${u.name} in ${u.zone?.name ?? live.units.get(u.address)?.zone?.name ?? "no tab"}`).join(", ");
    // A courier travels the tree line of the edge it started.
    const road = new Map(sec.edges.map((e) => [`${e.from}\u0000${e.to}`, e.points]));
    const moving = live.couriers.map((c) => ({ ...c, road: road.get(`${c.courier.from}\u0000${c.courier.to}`) })).filter((c) => c.road);
    return v_flex().id(`sc-${r.id}`).min_w(0).gap(F.SECTION.gap).role("group")
      .accessibility_label(`Workspace ${r.name}${r.branch ? `, branch ${r.branch}` : ""}: ${sec.nodes.filter((n) => n.type === "unit").length} agents${shells.length ? `, ${F.plainCount(shells)}` : ""}`)
      .child(h_flex().min_w(0).h(F.SECTION.head).gap(SPACE[2]).items_center()
        .child(div().id(`sn-${r.id}`).min_w(0).max_w(320).truncate().text_size(TYPE.sm).font_medium().text_color(t.muted).accessibility_label(`${r.hostLabel ?? machineLabel(r.machine)} / ${r.name}`).child(r.name))
        .when(Boolean(r.branch), (el) => el.child(div().id(`sb-${r.id}`).min_w(0).max_w(200).truncate().text_size(TYPE.xs).font_family(monoFont()).text_color(t.dim).accessibility_label(`Git branch: ${r.branch}`).child(r.branch)))
        .when(!machineHeading, (el) => el.child(div().flex_none().text_size(TYPE.xs).text_color(t.dim).child(r.hostLabel ?? machineLabel(r.machine))))
        .when(r.active, (el) => el.child(div().flex_none().text_size(TYPE.xs).text_color(t.dim).child("shown"))))
      .when(sec.total === 0 && !r.loose, (el) => el.child(div().text_size(TYPE.xs).text_color(t.dim).child("No agents running here")))
      .when(sec.nodes.length > 0, (el) => el.child(div().relative().flex_none().w(sec.w).h(sec.h)
        .child(edges(t, sec.edges, sec.w, sec.h))
        .children(moving.map(({ road }) => stroke(road, t.working, 1, [SPACE[1], SPACE[1]])))
        .children(sec.nodes.map((n) => this.node(t, n, live)))
        .children(moving.map(({ courier, phase, road }) => this.courier(t, courier, phase, road, live)))))
      .when(shells.length > 0, (el) => el.child(h_flex().id(`sf-${r.id}`).h(SPACE[5]).gap(SPACE[2]).items_center().text_size(TYPE.xs).text_color(t.dim)
        .accessibility_label(`${F.plainCount(shells)}: ${shellWords}`)
        .child(kindMarker(t, { agent: false, label: shells[0].kind.label }, iconFor(TYPE.xs), t.dim, `sfk-${r.id}`))
        .child(F.plainCount(shells))));
  }

  // A node: a one-line hairline pill (owner, 14 Nov: "icons minimal rather than these massive cards"): the mark, the
  // pane's name and the status marker. Its time and the program's own last status text are in its accessible name
  // and the selection panel. An in-process sub-agent has a dashed edge.
  node(t, n, live) {
    const u = live.units.get(n.unit.address) ?? n.unit;
    const rec = n.type === "record";
    const word = rec ? n.record.word : u.word;
    const name = rec ? n.record.title : u.name;
    const msg = F.nodeMessage(n);
    const on = WORDS_ON.has(word) && (rec || u.kind.agent);
    const sel = this.sel === n.key;
    const pulse = rec ? null : live.pulses.get(u.address);
    const since = rec ? null : F.sinceOf(this.obs.agents.get(u.address), live.statusMs.get(u.address));
    const stateWords = word ? F.WORDS[word] : "No status reported";
    const kind = `${u.kind.label}${rec ? `, in-process sub-agent of ${u.name}` : u.startedBy ? `, started by ${live.units.get(u.startedBy)?.name ?? u.startedBy}` : ""}`;
    const label = `${name}, ${kind}. ${stateWords}${!rec && u.blockKind ? `: ${u.blockKind}` : ""}${since && word ? ` since ${clock(since.at)}` : ""}.${msg ? ` Said: ${msg}` : ""}`;
    return interactionStyle(div(), t, { variant: "data", selected: sel, selectedBorder: true, ground: t.surface }).id(`nd-${n.key}`).absolute().left(n.x).top(n.y).w(n.w).h(n.h).px(SPACE[2])
      .flex().flex_row().items_center().gap(SPACE[2]).rounded(RADIUS.md).border(1).when(rec, (el) => el.border_dashed())
      .border_color(sel ? t.accent : t.border)
      .role("button").accessibility_label(`${label} Show details`).tooltip(stateWords)
      // Selecting drops the other sections, so the board is asked to show the pill again (review-vertical 1).
      .on_click((_e, cx) => { this.sel = this.sel === n.key ? null : n.key; this.revealSel = this.sel != null; cx.notify(); })
      .when(pulse != null, (el) => el.child(div().id(`pl-${n.key}`).absolute().left(-1).top(-1).w(n.w).h(n.h).rounded(RADIUS.md)
        .border(1).border_color(t.muted).opacity(pulse === "on" ? 1 : 0).when(!live.reduce, (p) => p.transition("opacity", F.MOTION.pulseFade))))
      .child(kindMarker(t, { ...u.kind, record: rec, label: rec ? "In-process sub-agent" : u.kind.label, idle: word === "idle" && !sel, ground: "surface" }, MARK, on ? t.foreground : t.muted, `nk-${n.key}`))
      .child(div().id(`nn-${n.key}`).flex_1().min_w(0).truncate().text_size(TYPE.sm).text_color(on ? t.foreground : t.muted).child(name))
      .child(div().size(ICON.base).flex_none().flex().items_center().justify_center()
        .child(statusMarker(t, word, `ns-${n.key}`, { kind: rec ? null : u.blockKind }) ?? div()));
  }

  // A courier: one dot from the parent's edge to the child's, over the accent trail of the tree line that joins
  // them. Its id carries its destination, so a layout change redraws it in place instead of sliding it.
  courier(t, c, phase, road, live) {
    const from = road[0], to = road.at(-1);
    const p = phase === "depart" ? from : to;
    const words = `Started: ${live.units.get(c.from)?.name ?? c.from} started ${live.units.get(c.to)?.name ?? c.to}, recorded by ${c.source} at ${clock(c.at)}`;
    const move = { duration: F.MOTION.courierTravel, easing: "ease-in-out" };
    return div().id(`cr-${c.id}-${to[0]}-${to[1]}`).absolute().left(p[0] - ICON.dot / 2).top(p[1] - ICON.dot / 2).size(ICON.dot).rounded(RADIUS.sm).bg(t.working)
      .role("status").accessibility_label(words)
      .when(!live.reduce, (el) => el.transition("left", move).transition("top", move));
  }

  // The selected node's details under the map.
  panel(t, node, statusMs, units, target = ROW.compact) {
    const u = node.unit, rec = node.type === "record";
    const history = (this.obs.agents.get(u.address)?.history ?? []).filter((h) => rec ? h.source === "record" && h.id === node.record.id : h.source === "status");
    const since = rec ? null : F.sinceOf(this.obs.agents.get(u.address), statusMs.get(u.address));
    const narrow = target > ROW.compact;
    // At least 24 px (WCAG 2.2 target size, minimum); 44 by 44 in a narrow view.
    const buttons = h_flex().id("panel-actions").flex_none().gap(SPACE[1]).items_center()
      .child(textButton(t, "focus-pane", u.pane ? "Focus pane" : "Peek terminal", u.pane ? "Focus pane" : "Peek terminal", () => this.focusPane(u.address), { h: target }).min_w(target))
      .child(textButton(t, "deselect", "Close", "Close the selection", (_e, cx) => { this.sel = null; cx.notify(); }, { h: target }).min_w(target));
    return v_flex().id("selection").h(PANEL).flex_none().px(SPACE[4]).py(SPACE[3]).gap(SPACE[2]).border_t(1).border_color(t.border).bg(t.canvas)
      .child(h_flex().gap(SPACE[2]).items_center()
        .child(kindMarker(t, { ...u.kind, record: rec, label: rec ? "In-process sub-agent" : u.kind.label }, MARK, t.foreground, `pp-${node.key}`))
        .child(div().flex_1().min_w(0).truncate().text_size(TYPE.base).font_medium().text_color(t.foreground).accessibility_label(node.name).child(node.name))
        .child(statusMarker(t, node.word, `ps-${node.key}`, { kind: rec ? null : u.blockKind }) ?? div())
        .child(node.word === "working" ? workingText(t, "panel-working", F.WORDS.working, { size: TYPE.xs })
          : div().flex_none().text_size(TYPE.xs).text_color(t.muted).child(node.word ? F.WORDS[node.word] : "No status reported"))
        .when(!narrow, (el) => el.child(buttons)))
      // A narrow view puts the buttons on their own row, so the name keeps its room and both stay reachable.
      .when(narrow, (el) => el.child(buttons))
      .child(v_flex().flex_1().min_h(0).gap(SPACE[1]).overflow_y_scrollbar().text_size(TYPE.xs).text_color(t.muted)
        .child(h_flex().id("node-identity").gap(SPACE[1]).items_center().accessibility_label(node.identity)
          .child(div().min_w(0).truncate().child(`${node.context}${rec ? ` / ${node.name}` : ""}`))
          .when(rec, (el) => el.child(div().flex_none().font_family(monoFont()).child(`(${node.record.id})`)))
          .child(div().flex_none().font_family(monoFont()).child(`· ${u.address}`)))
        .when(Boolean(u.startedBy), (el) => el.child(h_flex().gap(SPACE[1]).items_center()
          .child(`${rec ? "Owner started" : "Started"} by ${units.get(u.startedBy)?.name ?? u.startedBy} `)
          .child(div().font_family(monoFont()).child(`(${u.startedBy})`)).child(" · herdr-core parent")))
        .when(Boolean(u.cwd), (el) => el.child(div().font_family(monoFont()).child(folderLabel(u.cwd))))
        .when(since != null, (el) => el.child(h_flex().gap(SPACE[1]).text_color(t.dim)
          .child(`${since?.basis === "at least" ? "At least since" : "Since"} `)
          .child(div().font_family(monoFont()).child(clock(since?.at))).child(` · ${since?.basis}`)))
        .child(div().font_medium().text_color(t.dim).child("Reports · newest first · text and states as reported"))
        .when(history.length === 0, (el) => el.child(div().text_color(t.dim).child("Nothing reported yet.")))
        .children(history.slice(0, 6).map((h, i) => h_flex().id(`report-${node.key}-${i}`).gap(SPACE[1]).items_start().text_color(i === 0 ? t.foreground : t.muted)
          .child(div().flex_none().font_family(monoFont()).child(`${h.observed ? clock(h.at) : `Before ${clock(this.obs.since)}`} ·`))
          .when(h.source === "record", (el) => el.child("record ").child(div().flex_none().font_family(monoFont()).child(h.id)))
          .when(h.source !== "record", (el) => el.child("status report"))
          .child(div().flex_1().min_w(0).child(` · ${h.text}`)))));
  }
}

// ---- drawing --------------------------------------------------------------------------------------------------

// The map's readable, neutral hairline; node outlines stay quiet.
function edges(t, list, w, h) {
  if (!list.length) return div();
  let b = PathBuilder.stroke(1);
  for (const e of list) {
    b = b.move_to(e.points[0][0], e.points[0][1]);
    for (const p of e.points.slice(1)) b = b.line_to(p[0], p[1]);
  }
  return window.paint_path(b.build(), t.dim).absolute().left(0).top(0).w(w).h(h);
}

// A line through `points` (board px), drawn in its own box.
function stroke(points, color, width, dash) {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const x0 = Math.min(...xs) - 3, y0 = Math.min(...ys) - 3;
  let b = PathBuilder.stroke(width);
  if (dash) b = b.dash_array(dash);
  b = b.move_to(points[0][0] - x0, points[0][1] - y0);
  for (const p of points.slice(1)) b = b.line_to(p[0] - x0, p[1] - y0);
  return window.paint_path(b.build(), color).absolute().left(x0).top(y0).w(Math.max(...xs) - x0 + 3).h(Math.max(...ys) - y0 + 3);
}

