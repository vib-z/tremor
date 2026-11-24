// The sidebar, in Herdr's own order: the workspaces of the machine the filter shows (spec §2: all of them, each with
// its machine's name at the right, or one machine's), under each its tabs, under a split tab its panes on thin
// lines, under a pane its Core sub-agents (by `parent`) and in-process records (7501). Laid out like Claude Desktop's
// sidebar with Moshi's row cues: a name, then a small caret after it as its fold control, never one on the left; a
// tab or child row is the agent's mark then its name, its status marker alone at the right end (owner, 11 Nov: the
// symbol says it; the word is its tooltip); a folded row counts what it hides. Above the list, the machine selector
// (its menu ends with Add machine, the sidebar's one way in) and the Workspaces row with the one +. No machine rows
// and no empty-state rows: an empty sidebar shows what can be acted on.
// props.part "head": the 40px strip beside the window buttons (search and the sidebar toggle at its right end).
//
// Row rules adapted from Herdr App's shipped `agents` mod (Apache-2.0); machine states and the git question after
// Herdr App's `spaces` mod (defaults/mods/spaces/main.js); see lib/status.js and NOTICE.md.

import { div } from "gpui-kit";
import { v_flex, h_flex, v_virtual_list, Scrollbar, VirtualListScrollHandle, ScrollHandle, InputState, Input } from "gpui-base";
import { spaces, panes, terminals, agents, focused, theme, run, props, shared, setShared, setAgentOrder, layout, window, nextCommand, openOverlay, machines, hc, exec, settings } from "herdr";
import { plusButton } from "./lib/plus.js";
import { plusTarget } from "./lib/new-workspace.js";
import { lightsInset, keyAction, machineLabel, buildPaneTree, treeRows, rowSpec, tabRowOn, findRow, machineList, machineFilter, machineChoices, inFilter, nativeMenu, STATUS_WORD, gitTail, parseGit, GIT_READS, rollupWords, MACHINE_KEYS, rebuiltMachine, reconnectArgs, moveWorkspace, renameTarget, renameSave } from "./lib/status.js";
import { TYPE, SPACE, ICON, ROW as ROWS, RADIUS, icon, withFont, monoFont, kindOf, kindMarker, statusMarker, textButton, caretButton, rowStates, byPointer, pointed, keyed, findNode, since, softInk, button, tooltip, shortcut, fieldFrame, focusRing, popover, menuFrame, menuItem, menuState, bindMenuKeys, folderLabel } from "./lib/ui.js";
import { helper } from "./lib/helper.js";
import ContextMenu from "./menu.js";
import { TreeRowView } from "./row-view.js";

// Row geometry (visual contract, option A): every row 28, in the list's 8 px inset. A workspace row 4 px in, its name
// 13/500; an agent row's mark 14 starts where that name does (owner, 11 Nov: left aligned with the workspaces), then
// 8 px to its name, 13/400 in softInk, its status at the right end. A child's thin line hangs under its parent's mark:
// each level is one LINE-wide cell further in, the line LINE_AT into its cell, so a row's mark centre
// (CHILD_X + depth * LINE + GAP + MARK_W / 2) is exactly the next level's line. CHILD_X is below 0 (the first cell
// starts left of the row's edge, empty there), so the cells take it as a margin.
const ROW = ROWS.agent;
const SPACE_X = SPACE[1];
const NAME_X = SPACE_X;
const MARK_W = ICON.base;
const GAP = SPACE[2];
const LINE = SPACE[5];
const LINE_AT = GAP + MARK_W / 2;
const CHILD_X = NAME_X + MARK_W / 2 - LINE_AT;

const GIT_EVERY = 15000;

// Thin connector cells: │ continues, ├ branches, └ ends with a soft corner; the branch reaches the cell's end.
function lineCell(t, glyph, h) {
  const color = (t.dim ?? t.muted) + "80";
  const cell = div().relative().w(LINE).h(h).flex_none();
  const tick = LINE - LINE_AT;
  if (glyph === "│") return cell.child(div().absolute().left(LINE_AT).top(0).w(1).h(h).bg(color));
  if (glyph === "├") return cell.child(div().absolute().left(LINE_AT).top(0).w(1).h(h).bg(color)).child(div().absolute().left(LINE_AT).top(h / 2).w(tick).h(1).bg(color));
  if (glyph === "└") return cell.child(div().absolute().left(LINE_AT).top(0).w(tick).h(h / 2 + 1).border_l(1).border_b(1).border_color(color).rounded_bl(4));
  return cell;
}

// Row states (design-system audit C7) are the shared rowStates: hover fills with `hover` unless the row is selected,
// pressing shows `selected`, and the keyboard's row wears the accent border. The tree keeps one keyboard focus and
// moves a selection, so no row is a Tab stop of its own. Rows sit straight on the sidebar, so their ground is clear
// (a glass sidebar's tint is not laid twice).
const CLEAR = "#00000000";
// The ring is 2 px (docs/DESIGN.md, Focus ring); each row's padding is 1 px less on both sides, so nothing moves.
const states = (el, t, { on = false, sel = false, color = t.foreground } = {}) => rowStates(el, t, { selected: on, focused: sel, ground: CLEAR, color, ring: 2 });
// Metadata (branch, ids, percentages, times, counts) in the mono face (design item 1); names stay in the UI face.
const mono = (el) => { const f = monoFont(); return f ? el.font_family(f) : el; };

// Where a workspace is now: its first terminal's live folder, else where it was made (the spaces mod's `place`).
function placeOf(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

// The Workspaces + says where it will make the workspace (F3): "New workspace in ~/code/evals", "… on box" on another
// machine, and no folder while none is known yet.
export const plusWords = ({ machine, folder }) =>
  `New workspace${folder ? ` in ${machine ? folder : folderLabel(folder)}` : ""}${machine ? ` on ${machine}` : ""}`;

// The tree's keys, bound under its own context (PdkTree) so a host keymap cannot take them first; the root's
// on_key_down does the same if a host refused the bindings. Enter and Space stay unbound: they press the focused
// caret or button. Once per module load: the keymap is the app's.
const TREE_KEYS = ["left", "right", "up", "down", "home", "end"];
const treeAction = (key) => `pdk_tree_${key}`;
let treeBound = false;
function bindTreeKeys(cx) {
  if (treeBound) return;
  try { treeBound = cx.bind_keys(TREE_KEYS.map((keystroke) => ({ keystroke, action: treeAction(keystroke), context: "PdkTree" }))) > 0; } catch {}
}

export default class Tree extends ContextMenu {
  init(_props, cx) {
    this.rootCx = cx;
    this.part = props()?.part ?? null;
    if (this.part === "head") return;
    bindMenuKeys(cx); // the machine menu's and the context menu's keys
    if (this.part === "menu") return this.initMenu(_props, cx);
    bindTreeKeys(cx);
    // The machine selector's menu: open or not (the Popover is controlled); the trigger's and each entry's keyboard
    // handle (by entry id); its scroll area's position.
    this.machineMenu = false;
    this.selectKeys = cx.focus_handle();
    this.menuKeys = menuState(this, "machine-menu-list").handles; // by item id
    this.menuScroll = ScrollHandle.new();
    // Rename in place (owner, 10 Nov): one field, reused by every rename (an InputState is made in init only). Enter
    // saves; leaving it (a click anywhere else) saves, as Finder does; Esc cancels (onKey).
    this.renaming = null;
    this.renameInput = InputState.new({});
    this.renameInput.on("submit", (_e, cx) => this.endRename(true, cx));
    this.renameInput.on("blur", (_e, cx) => {
      const r = this.renaming;
      if (!r) return;
      // The double-click's first click asked Herdr to show a tab or focus a pane, which it does a moment later: that
      // one blur keeps the field. Any other blur is the person leaving (a click or Tab elsewhere): saved, and the
      // focus stays where they went (review UX16).
      if (r.steal && Date.now() - r.at < 400) { r.steal = false; return this.renameInput.focus(); }
      this.endRename(true, cx, { refocus: false });
    });
    this.folded = new Set(JSON.parse(localStorage.getItem("folded") ?? "[]"));
    // The workspace last shown on each machine ("" for this computer), so choosing a machine shows it again.
    this.lastSpace = JSON.parse(localStorage.getItem("lastSpace") ?? "{}");
    this.reconnecting = JSON.parse(localStorage.getItem("pdk.machines.reconnecting") ?? "{}");
    this.pressedSpace = null; this.overSpace = null;
    this.sel = null;
    this.hovered = null;
    this.listed = [];
    this.git = {};
    this.handle = cx.focus_handle();
    this.treeScroll = VirtualListScrollHandle.new();
    // Retained row views by row key, kept while the row exists (folded or filtered out included), and the
    // signature each one last drew from, so a change redraws only the rows it touches.
    this.rowViews = new Map(); this.rowSigs = new Map(); this.rowItems = new Map(); this.rowsPending = false;
    this.refreshMachines(cx);
    cx.timer.every(15000, (cx) => this.refreshMachines(cx));
    cx.timer.every(GIT_EVERY, (cx) => this.refreshGit(cx));
    // Reduce Motion: read once a minute (macOS posts no change a mod can hear).
    cx.spawn(async (cx) => {
      for (;;) {
        const r = await helper("motion").catch(() => null);
        if (r && shared("pdk.reduceMotion") !== r.reduce) setShared("pdk.reduceMotion", r.reduce);
        await cx.sleep(60000);
      }
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") this.handle.focus();
        // "pdk-tree.focus:<row key>": the keyboard back on a row (the + menu closing returns it to its trigger).
        else if (c.startsWith("focus:")) { this.handle.focus(); this.focusRow(c.slice(6), cx); }
        // "pdk-tree.key:<key>": the same as that key pressed in the tree (down, up, enter, left, right, +, h).
        else if (c.startsWith("key:")) this.onKey({ key: c.slice(4) }, cx);
        // Bindable in keys.json: "pdk-tree.fold:<row key>" (fold or unfold a row: sp:, tb:, pn: keys),
        // "pdk-tree.machine:<all|local|name>" (the machine filter,
        // spec §2). The + is the tab bar's pdk-tabs.new-workspace (shared/new-workspace.js), which shows whether or not
        // the sidebar does.
        else if (c.startsWith("fold:")) this.toggle(c.slice(5), cx);
        else if (c.startsWith("machine:")) this.setFilter(c.slice(8), cx);
        else if (c.startsWith("menu:")) this.openContext(findRow(this.list ?? [], c.slice(5)) ?? this.nav?.find((r) => r.key === c.slice(5)));
        else if (c.startsWith("connect:")) this.reconnect(c.slice(8), cx);
        // "pdk-tree.rename:<row key>": rename that row in place, as a double-click on its name or F2 does.
        else if (c.startsWith("rename:")) this.startRename(findRow(this.list ?? [], c.slice(7)), cx);
        // "pdk-tree.pick:<row key>": what a click on that row does (sp:, tb:, pn:, tm: keys).
        else if (c.startsWith("pick:")) {
          const item = findRow(this.list ?? [], c.slice(5));
          if (item) { this.sel = item.key; this.activate(item, cx); }
        }
        this.notifyTree(cx);
      }
    });
    cx.timer.every(30000, (cx) => cx.notify());
    // The tree's own context. A task's cx redraws the view that started the task, from any call; init's cx redraws
    // whichever view is running, which in a row's handler is that row alone (measured in the app, 13 Nov).
    cx.spawn((own) => { this.rootCx = own; });
  }

  // After a change from an event or a task: the rows it touches are redrawn in the same frame as the tree.
  notifyTree(cx) {
    this.syncRows(cx);
    this.redraw();
  }

  // The tree alone, for size callbacks (the rows follow from render's task, as for the host's data). Rows get their
  // own redraw through applyRows.
  redraw() {
    this.rootCx.notify();
  }

  measureViewport(size, cx) {
    // Size callbacks are window logical pixels; styles and row sizes use the layout's unzoomed scale.
    const height = Math.max(ROW, Math.floor(size.height / (settings().zoom || 1)));
    if (this.treeViewport !== height) { this.treeViewport = height; this.reveal = this.sel; this.redraw(); }
  }

  // The hierarchy, rebuilt only when the host's data says something different (a fold, a hover or a timer redraw
  // reuses it). Content, not identity: the host may hand the same data in new arrays, or change it in place.
  paneTree() {
    const input = [spaces(), panes(), terminals(), agents()];
    const json = JSON.stringify(input);
    if (json !== this.treeJson || !this.model) {
      this.treeJson = json;
      this.model = buildPaneTree({ spaces: input[0], panes: input[1], terminals: input[2], agents: input[3], kindOf });
      this.pruneDue = true;
    }
    return this.model;
  }

  // The rows drawn now, each with what its drawing depends on (sig). Pure: render and events both call it.
  rows() {
    const sp = spaces();
    this.ps = panes();
    const model = this.paneTree();
    const known = machineList({ spaces: sp, machines: machines(), listed: this.listed });
    const filter = machineFilter(shared(MACHINE_KEYS.filter), known);
    this.filter = filter;
    this.hostShown = filter === "all" && known.length > 1;
    this.choices = machineChoices(known, filter);
    this.shown = model.filter((s) => inFilter(filter, s.machine));
    const list = treeRows(this.shown, this.folded);
    this.list = list;
    // A rename whose row went away (closed, folded, filtered out) is dropped, not saved.
    if (this.renaming && !list.some((r) => r.key === this.renaming.key)) this.renaming = null;
    // The keyboard's row rings only after a key: a click selects the row and focuses the tree, and draws no ring.
    const keys = this.handle.is_focused() && !byPointer();
    // One theme read per pass, shared by the rows' drawing (a theme change redraws every row through its signature).
    this.t = theme();
    const all = JSON.stringify([shared("pdk.focus.pointer"), this.hostShown, this.t]);
    const order = sp.map((s) => s.id);
    const focus = focused();
    const items = list.map((item, i) => {
      const apart = item.type === "space" && i > 0;
      return { key: item.key, h: apart ? ROW + SPACE[2] : ROW, nav: item, apart, sig: all + this.rowSig(item, keys && this.sel === item.key, apart, order, focus) };
    });
    this.nav = items.map((i) => i.nav);
    // Kept for hidden rows too: a folded row's view, redrawn by the host meanwhile, draws what its signature says.
    for (const it of items) this.rowItems.set(it.key, it);
    return items;
  }

  // Everything a row's drawing and its handlers read besides the theme and the pointer (rows() adds those). `sel`:
  // the keyboard's row. `where`: the tab, workspace and machine its click and menu act on, so a pane or tab moved
  // elsewhere with no visible change still gets handlers for its new place (review R1).
  rowSig(item, sel, apart, order, focus) {
    const spec = rowSpec(item, this.folded), key = item.key, n = item.node;
    const where = [item.tab?.id ?? null, item.space?.id ?? null, item.space?.machine ?? null];
    const own = [sel, this.renaming?.key === key, item.lines.join(""), where];
    if (item.type === "space") {
      const s = item.space, over = this.overSpace === s.id && this.pressedSpace ? [order.indexOf(this.pressedSpace.id), order.indexOf(s.id)] : null;
      return JSON.stringify([spec, own, apart, s.id, s.machine ?? null, gitTail(this.gitOf(s)) ?? null, over]);
    }
    if (item.type === "tab") return JSON.stringify([spec, own, this.agentAria(spec), item.space.id, item.space.active, item.tab.id, item.tab.lead?.kind ?? null, tabRowOn(item.tab, focus, !this.folded.has(key))]);
    return JSON.stringify([spec, own, this.agentAria(spec), n.kind ?? null, n.pane ?? null, n.address ?? null, n.focused ?? null, item.tab?.active ?? null, item.space?.active ?? null, focus?.terminal ?? null]);
  }

  // A row's view draws the row as it is now, from the latest rows() that listed it; a row gone draws nothing.
  drawRow(key) {
    const it = this.rowItems.get(key);
    if (!it) return div();
    const t = this.t ?? theme(), item = it.nav, sel = this.handle.is_focused() && !byPointer() && this.sel === key;
    if (item.type === "space") return it.apart ? div().pt(SPACE[2]).child(this.spaceRow(t, item, sel)) : this.spaceRow(t, item, sel);
    return item.type === "tab" ? this.tabRow(t, item, sel) : this.childRow(t, item, sel);
  }

  // Brings the row views to `items`, from an event or a task (never render, where the app forbids it): a row seen
  // for the first time gets its view, a row whose signature changed is redrawn (that child alone), the rest are
  // left as they are. Views of rows that left the hierarchy are released; folded or filtered rows keep theirs.
  // Says whether it made or released a view: the list mounts views by key, so only then does the tree need a redraw.
  applyRows(items, cx) {
    let mounted = false;
    for (const it of items) {
      const view = this.rowViews.get(it.key);
      if (!view) { this.rowViews.set(it.key, cx.new(TreeRowView, { draw: () => this.drawRow(it.key) })); mounted = true; }
      else if (this.rowSigs.get(it.key) !== it.sig) cx.notify(view);
      this.rowSigs.set(it.key, it.sig);
    }
    if (this.pruneDue) {
      this.pruneDue = false;
      const known = new Set(treeRows(this.model ?? []).map((r) => r.key));
      for (const [key, view] of this.rowViews) if (!known.has(key)) { view.release(); this.rowViews.delete(key); mounted = true; }
      // Rows listed by a render but gone before any view was made for them (review R2) leave nothing behind either.
      for (const map of [this.rowSigs, this.rowItems]) for (const key of map.keys()) if (!known.has(key)) map.delete(key);
    }
    return mounted;
  }

  // From render: when a row needs a view or a redraw (the host's data changed), one task brings them up to date.
  // A fold, a key or a click has already done it in its event (notifyTree), so its frame needs no task. The task
  // reads the rows as they are when it runs, not as this render saw them: newer data or an event may have come
  // between, and an older list would make views for rows already gone (review R2). A task starts its body inside
  // render, where the host refuses every notify, so it first leaves the render. `rowsPending` is when the pass was
  // asked for: one still pending after a second is asked again, so a task the host lost cannot stop row updates.
  prepareRows(items, cx) {
    if (this.rowsPending && Date.now() - this.rowsPending < 1000) return;
    if (!this.pruneDue && items.every((it) => this.rowViews.has(it.key) && this.rowSigs.get(it.key) === it.sig)) return;
    this.rowsPending = Date.now();
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      this.rowsPending = false;
      if (this.syncRows(cx)) cx.notify();
    });
  }

  // In an event: the rows as the change just made leaves them, their views ready for the next frame.
  syncRows(cx) {
    if (this.part) return false;
    return this.applyRows(this.rows(), cx);
  }

  // `hc machine ls`: each machine's state, which machines() doesn't carry (the spaces mod's refreshMachines).
  refreshMachines(cx) {
    cx.spawn(async (cx) => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) { this.listed = JSON.parse(r.stdout).machines ?? []; setShared("pdk.machines.list", this.listed); } } catch {}
      this.notifyTree(cx);
    });
  }

  // Each workspace's git, asked where it is now (on its own machine), one at a time: a place not asked yet at
  // once, the rest again every GIT_EVERY while the window is in front.
  refreshGit(cx) {
    if (this.gitBusy) return;
    const ps = panes();
    const all = spaces().map((s) => [JSON.stringify([s.machine ?? null, placeOf(s, ps)]), s.machine ?? null, placeOf(s, ps)]).filter(([, , cwd]) => cwd);
    const asks = window()?.active ? all : all.filter(([key]) => !(key in this.git));
    if (!asks.length) return;
    this.gitBusy = true;
    cx.spawn(async (cx) => {
      for (const [key, on, cwd] of asks) {
        try {
          // Herdr 0.1.15's ref-only reads, two at a time (stock spaces/main.js check()): no worktree scan, nothing
          // written under .git, its index watch left asleep (status.js GIT_READS).
          const ask = (args) => exec("git", args, { cwd, on });
          const [top, common] = await Promise.all([ask(GIT_READS.top), ask(GIT_READS.common)]);
          const repo = top.code === 0 && common.code === 0;
          const [branch, counts] = repo ? await Promise.all([ask(GIT_READS.branch), ask(GIT_READS.counts)]) : [null, null];
          this.git[key] = parseGit({ top, common, branch, counts });
        } catch { this.git[key] = { unknown: true }; }
      }
      this.gitBusy = false;
      this.notifyTree(cx);
    });
  }

  gitOf(s) {
    return this.git[JSON.stringify([s.machine ?? null, placeOf(s, this.ps ?? [])])];
  }

  // The machine filter (spec §2): "all", "local" (this computer) or a machine's name. One machine shows its last
  // workspace again, else its first; All keeps the focus where it is. The work area follows in render (syncBody).
  // The tabs are read again, so a machine just added (pdk-machine-add) gets its tab, chosen, at once.
  setFilter(arg, cx = this.rootCx) {
    const value = arg === "all" ? "all" : arg === "local" ? "" : arg;
    setShared(MACHINE_KEYS.filter, value);
    this.refreshMachines(cx);
    if (value === "all") return;
    const mine = spaces().filter((s) => (s.machine ?? "") === value);
    const last = mine.find((s) => s.id === this.lastSpace[value]) ?? mine[0];
    if (last && !last.active) run("space.select", { id: last.id });
  }

  // A machine chosen with no workspace there shows none of another machine's: the work area is hidden, not closed,
  // and comes back as soon as a shown workspace is (spec §2). Asked once per change, from a task, never in render.
  syncBody(want, cx) {
    const hidden = Boolean(findNode(layout(), "work-body")?.hidden);
    if (hidden !== want) { this.bodyAsk = null; return; }
    if (this.bodyAsk === want) return;
    this.bodyAsk = want;
    cx.spawn(async () => run(want ? "layout.show" : "layout.hide", { id: "work-body" }));
  }

  saveFolds() {
    localStorage.setItem("folded", JSON.stringify([...this.folded]));
  }

  toggle(key, cx) {
    this.folded.has(key) ? this.folded.delete(key) : this.folded.add(key);
    // An unfold's new rows get their views here, in the event, so the next frame draws them whole; only the folded
    // row itself is redrawn (its caret and counts). The rows it hid keep their views for the next unfold.
    this.notifyTree(cx);
    // Saved after the redraw is asked for, still in this event: the host keeps it in memory and writes the file in
    // the background (0.03 ms here, measured), and a save left to a later task is lost when the sidebar is hidden
    // (no render) or the mod reloads first (review R1).
    this.saveFolds();
  }

  chatShown() {
    return findNode(layout(), "work-body")?.active === "chat";
  }

  // An agent was picked: its pane gets focus; a sub-agent without a pane is peeked, or shown in chat.
  pick(row) {
    this.focusAsked = Date.now();
    if (row.pane) {
      run("pane.focus", { pane: row.pane });
      setShared("pdk.chat.pick", { address: row.address, at: Date.now() });
    } else if (this.chatShown()) {
      setShared("pdk.chat.pick", { address: row.address, at: Date.now() });
    } else {
      run("terminal.peek", { terminal: row.address });
    }
  }

  // The strip beside the window buttons (visual contract, Machine tabs: h40, its divider below): the traffic lights,
  // then at the right end two quiet 24 px buttons as stock Herdr has them, search (the palette, ⌘K) and the sidebar
  // toggle (Herdr's layout.toggle, ⌘B). Its empty ground still drags the window.
  renderHead() {
    const t = theme();
    // Each a shared button (24, ghost-muted, the + button's 4 px corner) in the shared tooltip with its real key.
    const quiet = (id, name, label, action, onPress) => tooltip(t, `${id}-tip`, button(t, id, { icon: name, label, onPress, variant: "ghost-muted", size: "xs" }).rounded(RADIUS.sm),
      label, { keys: shortcut(action) ?? [] });
    // Its divider is drawn over its bottom edge, not as a border inside it, so the buttons centre in the whole 40 px,
    // on the window buttons' centre line (the layout puts their 40 px container at the top: traffic_lights y 12).
    return withFont(h_flex()).size_full().relative().bg(t.chrome).pl(lightsInset(window(), layout(), settings().zoom)).pr(SPACE[2]).gap(SPACE[1]).items_center().justify_end()
      .child(quiet("sidebar-search", "search", "Search", "mod.open:pdk-search", () => run("mod.open", { name: "pdk-search" })))
      .child(quiet("sidebar-toggle", "panel-left", "Toggle sidebar", "layout.toggle:sidebar", () => run("layout.toggle", { id: "sidebar" })))
      .child(div().absolute().left(0).right(0).bottom(0).h(1).bg(t.border));
  }

  // The machine selector (owner, 11 Nov: "a minimal dropdown with icons", Add machine in it; then "world class ... so
  // it's easy not to miss"), after shadcn's sidebar switcher (sidebar.tsx:476-488 and its team switcher block): a 32 px
  // row button in the pack's field look (fieldFrame: a 1 px `input` edge at rest, `accent` while open or focused, the
  // shared focus ring), the chosen one's glyph (none for All), its name in 13/500 foreground (All reads "All
  // machines"), the up-down chevrons at its right end; `hover` under the pointer and while open. It takes its row's
  // measured width; a long name ends in an ellipsis, whole in the tooltip. The menu, as wide and 4 below (the
  // reference's trigger-width content, side offset 4), is the shared menu in the app's own Popover, which owns the
  // press, the anchoring, a press outside and the focus (the trigger has no click handler of its own; Enter or Space
  // opens it, as focusRing presses). Entries: All, This computer, each machine (status.js machineChoices), the current
  // one in the selected fill and named "current", in a scroll area as tall as the room under the trigger, then a rule
  // and Add machine, pinned under it (review RC03), which opens tremor's copy of Herdr's add dialog.
  machineSelect(t, choices) {
    const shown = choices.find((m) => m.chosen) ?? choices[0], open = this.machineMenu, room = this.selectRoom;
    // Ids by kind, so a machine named "add" or "all" is never another entry's (review RC04).
    const entries = [...choices.map((m) => ({ id: m.kind === "machine" ? `m-${m.value}` : m.kind, choice: m })), { id: "act-add" }];
    // Each entry's keyboard handle, made in an event (the menu opening, a key), never in render, where the app forbids
    // it; an entry gets one the first time the menu opens with it.
    const itemId = (en) => `machine-menu-${en.id}`;
    const ensure = (cx) => { for (const en of entries) if (!this.menuKeys.has(itemId(en))) this.menuKeys.set(itemId(en), cx.focus_handle()); };
    const current = Math.max(0, choices.findIndex((m) => m.chosen));
    const setOpen = (v, cx) => { this.machineMenu = v; if (v) { ensure(cx); this.menuScroll.scroll_to_item(current); } this.notifyTree(cx); };
    const take = (fn) => (_e, cx) => { setOpen(false, cx); fn(); };
    // The shared menu's keys (menuFrame): the arrows wrap inside it, Home and End jump, and the entry moved to comes
    // into view (review RC02). Esc, Tab and Shift-Tab close it and give the trigger the keyboard.
    const reveal = (id) => { const j = entries.findIndex((en) => itemId(en) === id); if (j >= 0 && j < choices.length) this.menuScroll.scroll_to_item(j); };
    const close = (cx) => { setOpen(false, cx); this.selectKeys.focus(); };
    const trigger = fieldFrame(focusRing(h_flex(), t, (_e, cx) => setOpen(true, cx)), t, { focused: open, ground: t.chrome })
      .id("machine-select").track_focus(this.selectKeys).h(SPACE[8]).when(Boolean(room), (el) => el.w(room))
      .px(SPACE[2]).gap(SPACE[2]).items_center().rounded(RADIUS.md).text_size(TYPE.base)
      .when(open, (el) => el.bg(t.hover)).hover((st) => st.bg(t.hover))
      .role("button").accessibility_label(`Machine: ${shown.aria}`).tooltip(shown.aria)
      .when(Boolean(shown.icon), (el) => el.child(icon(shown.icon, ICON.base, t.muted)))
      .child(div().flex_1().min_w(0).truncate().font_medium().text_color(t.foreground).child(shown.aria))
      .child(icon("chevrons-up-down", ICON.base, t.dim));
    const menuOf = menuState(this, "machine-menu-list");
    const item = (en) => menuItem(t, itemId(en), en.choice
      ? { text: en.choice.label, icon: en.choice.icon ?? div().size(ICON.base).flex_none(), note: en.choice.note, checked: en.choice.chosen, menu: menuOf,
        onPress: take(() => this.chooseMachine(choices, en.choice.value)) }
      : { text: "Add machine", icon: "plus", menu: menuOf, onPress: take(() => run("mod.open", { name: "pdk-machine-add" })) });
    // The room under the trigger: the list's measured height and the Workspaces row, less the frame, the rule and Add
    // machine below the scroll area.
    const tall = Math.max(ROWS.base * 3, (this.treeViewport ?? ROWS.base * 8) - SPACE[2]);
    const menu = menuFrame(t, "machine-menu-list", [
      v_flex().id("machine-menu-scroll").w_full().max_h(tall).overflow_y_scroll().track_scroll(this.menuScroll).children(entries.slice(0, -1).map(item)),
      div().h(1).mx(SPACE[2]).my(SPACE[1]).flex_none().bg(t.border),
      item(entries.at(-1)),
    ], { menu: menuOf, close, onMove: reveal }).mt(SPACE[1]).when(Boolean(room), (el) => el.w(room)).accessibility_label("Machines");
    const pop = popover(t, "machine-menu", { trigger, content: menu, open, onOpenChange: setOpen }).anchor("top_left");
    const first = this.menuKeys.get(itemId(entries[current]));
    return first ? pop.track_focus(first) : pop;
  }

  // The selector's row, measured: inside the app's Popover the trigger keeps its own width, so without this a long
  // name would push past the sidebar's edge. Size callbacks are window logical pixels; styles use the unzoomed scale.
  measureSelect(size, cx) {
    const room = Math.max(ROWS.compact, Math.floor(size.width / (settings().zoom || 1)) - 2 * SPACE[2]);
    if (room !== this.selectRoom) { this.selectRoom = room; this.redraw(); }
  }

  // A machine chosen: the filter command (local for this computer); a machine that needs a login opens Herdr's own
  // Settings at Machines instead, where its `hc machine login` line and Copy are (Herdr 0.1.15 item 3), even when it
  // is the current one. The current one otherwise changes nothing.
  chooseMachine(choices, v) {
    const m = choices.find((c) => c.value === v);
    if (m?.login) run("app.settings", { section: "machines" });
    else if (!m?.chosen) run(`pdk-tree.machine:${v === "" ? "local" : v}`);
  }

  // Show a tab: its workspace first when another one is shown.
  showTab(spaceId, tabId) {
    this.focusAsked = Date.now();
    if (!spaces().find((s) => s.id === spaceId)?.active) run("space.select", { id: spaceId });
    run("tab.select", { id: tabId });
  }

  activate(item, cx) {
    if (!item) return;
    if (item.type === "space") run("space.select", { id: item.space.id });
    else if (item.type === "tab" && item.tab.lead) this.pickPane({ node: item.tab.lead, tab: item.tab, space: item.space });
    else if (item.type === "tab") this.showTab(item.space.id, item.tab.id);
    else if (item.type === "pane" || item.type === "agent") this.pickPane(item);
    else if (item.type === "rec") this.pickPane({ ...item, node: this.ownerOf(item) });
  }

  ownerOf(item) {
    return { address: item.node.owner, pane: panes().find((p) => p.terminal === item.node.owner)?.pane ?? null };
  }

  // A pane row: its tab shown, the pane focused; chat and the terminal follow focus.
  pickPane(item) {
    const n = item.node.type === "rec" ? this.ownerOf(item) : item.node;
    if (n.pane && item.tab) this.showTab(item.space.id, item.tab.id);
    this.pick(n);
  }

  // Keys move through the rows drawn, by the rule in status.js keyAction.
  onKey(e, cx) {
    keyed(); // the ring comes with the first key after a click, on the row the click chose
    // While a name is being edited the keys are the field's (arrows move its caret); Enter saves, Esc cancels. The
    // Enter or Esc that just ended one goes no further.
    if (this.renaming) {
      if (e.key === "enter" || e.key === "escape") { this.endRename(e.key === "enter", cx); cx.stop_propagation(); }
      return;
    }
    if ((e.key === "enter" || e.key === "escape") && Date.now() - (this.renameEnded ?? 0) < 300) return cx.stop_propagation();
    // Esc closes the machine menu wherever in the sidebar the keyboard is while it is open (review RC02).
    if (e.key === "escape" && this.machineMenu) { this.machineMenu = false; this.selectKeys.focus(); this.notifyTree(cx); return cx.stop_propagation(); }
    const nav = this.nav ?? [];
    const found = nav.findIndex((r) => r.key === this.sel), at = Math.max(0, found);
    const item = nav[at];
    // F2 renames a workspace or tab row; on any other row (a pane) it does what a click does.
    if (item && e.key === "f2") { if (renameTarget(item, "")) this.startRename(item, cx); else this.activate(item, cx); return cx.stop_propagation(); }
    if (item && (e.key === "context-menu" || e.key === "m" || e.key === "f10" && e.shift)) {
      this.openContext(item); cx.stop_propagation(); return this.notifyTree(cx);
    }
    const a = keyAction(e.key, item);
    if (!a) return;
    if (a.move) {
      const i = a.move === Infinity ? nav.length - 1 : a.move === -Infinity ? 0 : Math.max(0, Math.min(nav.length - 1, at + a.move));
      this.sel = nav[i]?.key ?? null;
      this.reveal = this.sel;
    } else if (a.activate) this.activate(item, cx);
    else if (a.fold && found < 0) { this.sel = item.key; this.reveal = this.sel; } // no row chosen yet: choose one, fold nothing
    else if (a.fold) {
      const open = !this.folded.has(item.key);
      if (a.fold === "toggle" || (a.fold === "open") !== open) this.toggle(item.key, cx);
    }
    cx.stop_propagation(); this.notifyTree(cx);
  }

  // Rename in place: the row's name becomes the field, its text selected. One at a time: starting another saves this one.
  // `steal`: a double-click whose first click just asked Herdr for a focus change (see the blur handler).
  startRename(item, cx, { steal = false } = {}) {
    const target = renameTarget(item, item ? rowSpec(item, this.folded).text : null);
    if (!target) return;
    if (this.renaming) this.endRename(true, cx, { refocus: false });
    this.renaming = { ...target, at: Date.now(), steal };
    this.sel = item.key;
    this.renameInput.set_value(target.text);
    this.renameInput.set_selected_range({ start: 0, end: target.text.length });
    this.renameInput.focus();
    this.notifyTree(cx);
  }

  // Saves (Herdr's own space.rename / tab.rename with the captured id) or cancels. Enter and Esc give the keyboard back
  // to the tree (`refocus`); leaving the field leaves it where the person went.
  endRename(save, cx, { refocus = true } = {}) {
    const r = this.renaming;
    if (!r) return;
    this.renaming = null;
    this.renameEnded = Date.now();
    const command = save ? renameSave(r, this.renameInput.value()) : null;
    if (command) run(...command);
    if (refocus) this.handle.focus();
    this.notifyTree(cx);
  }

  // A row's name, or the field while it is renamed: the row's own height and type (13; a workspace's 500), the shared
  // field edge. A double-click on the name renames; its first click did what a click does.
  nameOrField(t, item, key, name, { medium = false } = {}) {
    if (this.renaming?.key === key) {
      return fieldFrame(h_flex().id(`${key}-rename`).flex_1().min_w(0).h(ROWS.compact).px(SPACE[1]).items_center().rounded(RADIUS.sm), t, { focused: true, ground: t.chrome })
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => cx.stop_propagation())
        .child(Input.new(this.renameInput).w_full().h_full().bg(t.chrome).border_0().px(0).text_size(TYPE.base).when(medium, (el) => el.font_medium())
          .accessibility_label("Name"));
    }
    return name.id(`${key}-name`).on_click((e, cx) => {
      if ((e?.click_count ?? 1) < 2 || !renameTarget(item, "")) return;
      cx.stop_propagation();
      if (item.type === "space") this.toggle(key, cx); // the first click folded it: put that back
      this.startRename(item, cx, { steal: Date.now() - (this.focusAsked ?? 0) < 1000 });
    });
  }

  // A caret right after a name: its fold control, the shared caretButton (a 10px caret in a 24px target, a Tab stop
  // that Enter or Space folds), dim (visual contract). Only a workspace and a tab with rows under it have one.
  caret(t, key, spec) {
    const c = spec.caret;
    // Its row becomes the keyboard's, with the tree's focus, so the arrows after a click act on this row.
    return caretButton(t, `${key}-fold`, c.open, c.label, (_e, cx) => { this.sel = key; this.handle.focus(); this.toggle(key, cx); }, { color: t.dim });
  }

  // Name, then caret. The mark in front says the kind, so the name is the tab's or pane's own (request 14). The ink
  // is the row's (softInk at rest, foreground on hover or when shown).
  nameCaret(t, key, spec, item) {
    if (this.renaming?.key === key) return this.nameOrField(t, item, key, null);
    return h_flex().flex_1().min_w(0).items_center()
      .child(this.nameOrField(t, item, key, div().min_w(0).truncate().text_size(TYPE.base).child(spec.text)))
      .when(spec.pinned, (el) => el.child(div().h(SPACE[4]).px(SPACE[1]).flex_none().text_size(TYPE.xs).text_color(t.muted).tooltip("Pinned").accessibility_label("Pinned").child("Pinned")))
      .when(Boolean(spec.caret), (el) => el.child(this.caret(t, key, spec)));
  }

  // The agent's real mark, 14, in front of a tab or child row's name, in one fixed slot so every name on a level
  // starts at the same x (visual contract: marks whole, never dimmed).
  mark(t, key, spec) {
    const slot = div().w(MARK_W).flex_none().flex().items_center().justify_center();
    if (!spec.mark) return slot;
    return slot.child(kindMarker(t, { ...spec.mark, ground: "chrome" }, ICON.base, t.muted, `${key}-mk`));
  }

  // The status at the row's right end, where its word used to end: the 7 px marker alone (owner, 11 Nov: the symbol
  // says it). The word ("Ready", "Needs you") is its tooltip and is in the row's accessible name. Nothing when
  // nothing was reported.
  status(t, key, spec, kind) {
    return STATUS_WORD[spec.word] ? statusMarker(t, spec.word, `${key}-st`, { kind, size: ICON.dot, tip: STATUS_WORD[spec.word] }) : null;
  }

  // An agent row's accessible name: its words, its status word and when its state last changed (neither is drawn).
  agentAria(spec) {
    return [spec.aria, STATUS_WORD[spec.word], spec.at && spec.word ? since(Date.now() - spec.at) : null].filter(Boolean).join(", ");
  }

  // What a fold hides, in the same markers with counts (request 8a), needs you first.
  rollup(t, key, counts) {
    if (!counts?.length) return null;
    return h_flex().id(`${key}-rollup`).flex_none().gap(SPACE[2]).items_center().role("image").accessibility_label(rollupWords(counts))
      .children(counts.map((c) => h_flex().flex_none().gap(SPACE[1]).items_center()
        .child(statusMarker(t, c.word, `${key}-r-${c.word}`))
        .child(mono(div().text_size(TYPE.xs).text_color(t.dim).child(`×${c.n}`)))));
  }

  // An agent row: 28 high, 8 px at the right, 8 px between its parts; softInk at rest (visual contract).
  row(t, key, sel, on) {
    return states(h_flex().id(key).relative().h(ROW).pr(SPACE[2] - 1).gap(GAP).flex_none().items_center().rounded(RADIUS.md), t, { on, sel, color: softInk(t) });
  }

  // Hover is the row's own state: the row left and the row entered are redrawn, through their views, and nothing else.
  hover(key) {
    return (on, cx) => {
      const was = this.hovered;
      if (on) this.hovered = key; else if (was === key) this.hovered = null;
      if (this.hovered === was) return;
      for (const k of new Set([was, this.hovered])) { const view = k && this.rowViews.get(k); if (view) cx.notify(view); }
    };
  }

  // After an open workspace's name: the branch, ↑ahead ↓behind and * for edits not committed (request 8e); the branch
  // truncates. A folded row leaves it out (request 37); its accessible name keeps the words.
  gitTail(t, key, s) {
    const g = gitTail(this.gitOf(s));
    if (!g) return null;
    return mono(h_flex()).id(`${key}-git`).min_w(0).flex_shrink(1).overflow_hidden().gap(4).pl(4).items_center().text_size(TYPE.xs).text_color(t.dim)
      .accessibility_label(g.aria)
      // A few characters of the branch stay ("fe…") however narrow the row gets.
      .child(div().min_w(28).truncate().child(g.branch))
      .when(Boolean(g.ahead), (el) => el.child(div().flex_none().text_color(t.ansi2 ?? t.done).child(g.ahead)))
      .when(Boolean(g.behind), (el) => el.child(div().flex_none().text_color(t.ansi1 ?? t.blocked).child(g.behind)));
  }

  spaceRow(t, item, sel) {
    const s = item.space;
    const spec = rowSpec(item, this.folded);
    const key = spec.key;
    // A workspace row: 4 px in, 4 px between its parts, its name 13/500 in foreground (visual contract).
    return states(h_flex().id(key).relative().h(ROW).pl(SPACE_X - 1).pr(SPACE_X - 1).gap(SPACE_X).flex_none().items_center().rounded(RADIUS.md), t, { sel })
      .role("tree_item").accessibility_label(spec.aria)
      .on_mouse_down("left", () => { pointed(); this.ignoreSpaceClick = false; this.pressedSpace = { id: s.id, machine: s.machine ?? null }; this.overSpace = s.id; })
      // A press anywhere else ends a drag left behind by a press released outside the sidebar; a caret, which stops
      // its own press, would otherwise finish it and move a workspace under the pointer (owner, 11 Nov: folding other
      // workspaces "does not work"). Capture phase, so before a new press's own row starts its drag.
      .on_mouse_down_out(() => { this.pressedSpace = null; this.overSpace = null; this.ignoreSpaceClick = false; })
      .on_mouse_move((_e, cx) => { const move = moveWorkspace(spaces(), this.pressedSpace?.id, s.id); const over = move ? s.id : null; if (over !== this.overSpace) { this.overSpace = over; this.notifyTree(cx); } })
      .on_mouse_up("left", (_e, cx) => {
        const press = this.pressedSpace; this.pressedSpace = null; const over = this.overSpace; this.overSpace = null;
        const source = spaces().find((x) => x.id === press?.id);
        const move = source && (source.machine ?? null) === press.machine && over === s.id ? moveWorkspace(spaces(), source.id, s.id) : null;
        this.ignoreSpaceClick = Boolean(press && press.id !== s.id);
        if (move) { run("space.move", move); cx.stop_propagation(); } this.notifyTree(cx);
      })
      .when(this.overSpace === s.id && this.pressedSpace?.id !== s.id, (el) => el.child(div().absolute().left(0).right(0).h(1).bg(t.accent)
        .when(spaces().findIndex((x) => x.id === this.pressedSpace.id) > spaces().findIndex((x) => x.id === s.id), (line) => line.top(0))
        .when(spaces().findIndex((x) => x.id === this.pressedSpace.id) < spaces().findIndex((x) => x.id === s.id), (line) => line.bottom(0))))
      .on_mouse_down("right", (_e, cx) => { pointed(); cx.stop_propagation(); this.openContext(item); this.notifyTree(cx); })
      .on_click((_e, cx) => { if (this.ignoreSpaceClick) { this.ignoreSpaceClick = false; return; } this.sel = key; this.handle.focus(); this.toggle(key, cx); })
      // Clipped: on a narrow folded row the git markers end at the counts instead of running under them.
      .when(this.renaming?.key === key, (el) => el.child(this.nameOrField(t, item, key, null, { medium: true })))
      .when(this.renaming?.key !== key, (el) => el.child(h_flex().flex_1().min_w(0).overflow_hidden().items_center()
        // The name before the branch: it keeps up to 140px, the branch truncates first.
        .child(this.nameOrField(t, item, key, div().max_w(140).flex_shrink(0).truncate().text_size(TYPE.base).font_medium().text_color(t.foreground)
          .child(spec.text)))
        .child(this.caret(t, key, spec))
        .children([spec.git ? this.gitTail(t, key, s) : null].filter(Boolean))))
      .children([this.rollup(t, key, spec.rollup)].filter(Boolean))
      // Under All with two or more machines, each workspace says where it runs (spec §2, option A); This computer as
      // its glyph alone, as its machine tab (owner, 11 Nov), the words its tooltip and accessible name.
      .when(this.hostShown, (el) => el.child(s.machine ? div().flex_none().pl(SPACE[1]).text_size(TYPE.xs).text_color(t.dim).child(machineLabel(s.machine))
        : div().id(`${key}-host`).flex_none().pl(SPACE[1]).tooltip(machineLabel(null)).accessibility_label(machineLabel(null)).role("image").child(icon("monitor", ICON.base, t.dim))));
  }

  // A tab, or an agent-led tab merged with its lead's row: its name focuses the lead's pane, its caret (only with
  // rows under it) folds. On hover or keyboard selection its Close comes in before the status marker, which stays so
  // its tooltip can be read under the pointer; a row with no status keeps the marker's slot, so Close stays in one
  // column down the list. Herdr's tab.close asks first.
  tabRow(t, item, sel) {
    const spec = rowSpec(item, this.folded);
    const key = spec.key;
    const on = item.space.active && tabRowOn(item.tab, focused(), !this.folded.has(key));
    const acting = this.hovered === key || sel;
    return this.row(t, key, sel, on).pl(NAME_X - 1)
      .role("tree_item").accessibility_label(this.agentAria(spec))
      .on_hover(this.hover(key))
      .on_mouse_down("left", () => pointed())
      .on_mouse_down("right", (_e, cx) => { pointed(); cx.stop_propagation(); this.openContext(item); this.notifyTree(cx); })
      .on_click((_e, cx) => { this.sel = key; this.activate(item); this.notifyTree(cx); })
      .child(this.mark(t, key, spec))
      .child(this.nameCaret(t, key, spec, item))
      .children([this.rollup(t, key, spec.rollup), acting ? textButton(t, `${key}-close`, "×", "Close tab", () => run("tab.close", { id: item.tab.id }), { h: ROWS.compact, size: TYPE.lg }).w(ROWS.compact).px(0) : null,
        this.status(t, key, spec, item.tab.lead?.kind) ?? (acting ? div().w(ICON.dot + SPACE.half).flex_none() : null)].filter(Boolean));
  }

  // A pane, a sub-agent or an in-process record: its mark and name behind the thin lines; time and status at the end.
  childRow(t, item, sel) {
    const n = item.node;
    const spec = rowSpec(item, this.folded);
    const focus = focused();
    const pane = item.type === "pane";
    const on = pane && (n.pane ? n.focused && item.tab?.active && item.space?.active : n.address === focus?.terminal);
    return this.row(t, spec.key, sel, on)
      .role("tree_item").accessibility_label(this.agentAria(spec))
      .on_mouse_down("left", () => pointed())
      .on_mouse_down("right", (_e, cx) => { pointed(); cx.stop_propagation(); this.openContext(item); this.notifyTree(cx); }).on_click((_e, cx) => { this.sel = spec.key; this.activate(item); this.notifyTree(cx); })
      .child(h_flex().flex_none().ml(CHILD_X - 1).children(item.lines.map((g) => lineCell(t, g, ROW))))
      .child(this.mark(t, spec.key, spec))
      // A child reads as part of the row above by its indent and line.
      .child(this.nameCaret(t, spec.key, spec, item))
      .children([this.rollup(t, spec.key, spec.rollup), this.status(t, spec.key, spec, n.kind)].filter(Boolean));
  }

  // Right-click (spec §5): Herdr's own menu for a workspace, a tab and a plain pane, its target captured now; the
  // pack's menu (menu.js) only for an agent's pin and unread, which Herdr's lacks.
  openContext(item) {
    if (!item) return;
    const n = item.node;
    let menu = null;
    if (item.type === "space") menu = nativeMenu("space", { id: item.space.id });
    else if (item.type === "tab") menu = nativeMenu("tab", { id: item.tab.id, space: item.space.id });
    else if (item.type === "pane" && n.pane && !n.agent) menu = nativeMenu("pane", { pane: n.pane, terminal: n.address });
    else if (["pane", "agent", "rec"].includes(item.type)) {
      const terminal = n.type === "rec" ? n.owner : n.address;
      if (!terminal) return;
      menu = { mod: "pdk-tree", kind: "popup", width: 280, props: { part: "menu", tab: "agent", trigger: item.key, returnCommand: `pdk-tree.focus:${item.key}`,
        target: { terminal, space: item.space.id, machine: item.space.machine ?? null, name: n.type === "rec" ? `Owner of ${n.title}` : n.name } } };
    }
    if (!menu) return;
    this.sel = item.key; this.handle.focus();
    openOverlay(menu);
  }

  focusRow(key, cx) {
    if (!key) return;
    const sp = spaces();
    if (key.startsWith("sp:") && !sp.some((s) => s.id === key.slice(3)) || key.startsWith("tb:") && !sp.some((s) => s.tabs.some((t) => t.id === key.slice(3))))
      key = sp.length ? `sp:${(sp.find((s) => s.active) ?? sp[0]).id}` : null;
    if (!key) return;
    const visit = (n, path) => {
      const own = n.type === "rec" ? `rc:${n.owner}#${n.id}` : n.key;
      if (own === key) { for (const k of path) this.folded.delete(k); return true; }
      return [...(n.tabs ?? []), ...(n.items ?? [])].some((x) => visit(x, [...path, own]));
    };
    for (const n of this.model ?? []) if (visit(n, [])) break;
    this.sel = key; this.reveal = key; this.notifyTree(cx); this.saveFolds();
  }

  // Herdr's stock spaces.reconnect workflow, with the exact rebuilt predicate and persisted retry receipt.
  reconnect(name, cx) {
    const machine = this.listed.find((m) => m.name === name) ?? this.reconnecting[name]?.machine;
    if (!machine || !(rebuiltMachine(machine) || this.reconnecting[name]) || this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true; state.error = null;
    const persist = () => localStorage.setItem("pdk.machines.reconnecting", JSON.stringify(this.reconnecting));
    persist(); this.notifyTree(cx);
    cx.spawn(async (cx) => {
      try {
        const ask = async (args) => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) { let error; try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch {} throw new Error(error || r.stderr || r.stdout || "Couldn't connect."); }
        };
        if (!state.removed) {
          const r = await hc(["machine", "ls", "--json"]);
          const current = r.code === 0 ? JSON.parse(r.stdout).machines?.find((m) => m.name === name) : null;
          if (!current || !rebuiltMachine(current) || JSON.stringify([current.id, current.target, current.session, current.via]) !== JSON.stringify([machine.id, machine.target, machine.session, machine.via])) throw new Error("Machine changed. Open its menu again.");
          await ask(["machine", "rm", name]); state.removed = true; persist();
        }
        await ask(reconnectArgs(machine));
        delete this.reconnecting[name];
      } catch (e) { state.error = String(e.message ?? e); state.busy = false; }
      persist(); this.refreshMachines(cx); this.notifyTree(cx);
    });
  }

  render(cx) {
    if (this.part === "head") return this.renderHead();
    if (this.part === "menu") return this.renderMenu(cx);
    const t = theme();
    const sp = spaces();
    const items = this.rows();
    const list = this.list, filter = this.filter, choices = this.choices;
    // The workspace last shown on each machine, for setFilter; the work area shows only the filter's work.
    const active = sp.find((s) => s.active);
    if (active && this.lastSpace[active.machine ?? ""] !== active.id) {
      this.lastSpace[active.machine ?? ""] = active.id;
      localStorage.setItem("lastSpace", JSON.stringify(this.lastSpace));
    }
    this.syncBody(filter === "all" || Boolean(active && inFilter(filter, active.machine)), cx);

    if (sp.some((s) => !(JSON.stringify([s.machine ?? null, placeOf(s, this.ps)]) in this.git))) this.refreshGit(cx);

    // The keyboard's row shows only while the tree has the keyboard; the focused pane's row always shows.
    const keys = this.handle.is_focused();
    const order = list.flatMap((r) => r.type === "tab" && r.tab.lead ? [r.tab.lead.address] : r.type === "pane" && r.node.agent && r.node.address ? [r.node.address] : []);
    setAgentOrder([...new Set(order)]);
    const signature = items.map((i) => i.key).join("|");
    if (this.reveal || keys && this.sel && signature !== this.itemSignature) {
      const at = items.findIndex((i) => i.key === (this.reveal ?? this.sel));
      if (at >= 0) this.treeScroll.scroll_to_item(at);
      this.reveal = null;
    }
    this.itemSignature = signature;
    this.prepareRows(items, cx);
    const nativeRows = (range) => items.slice(range.start, range.end).map((item) =>
      div().size_full().when(this.rowViews.has(item.key), (el) => el.child(this.rowViews.get(item.key))));

    return withFont(v_flex()).id("pdk-tree").size_full().min_h(0).bg(t.chrome).text_size(TYPE.base)
      .track_focus(this.handle).on_key_down((e, cx) => this.onKey(e, cx))
      // The tree's key context, left off while a name is edited or the machine menu is open, so those keep the arrows.
      .when(!this.renaming && !this.machineMenu, (el) => TREE_KEYS.reduce((e, key) => e.on_action(treeAction(key), (_e, cx) => this.onKey({ key }, cx)), el.key_context("PdkTree")))
      .on_mouse_up("left", (_e, cx) => { if (this.pressedSpace || this.overSpace) { this.pressedSpace = null; this.overSpace = null; this.notifyTree(cx); } })
      .role("tree").accessibility_label("Workspaces, tabs and panes")
      // The machine selector on its own row (the owner's pick A, 11 Nov), the trigger in the list's 8 px inset.
      .child(h_flex().id("machine-row").h(SPACE[10]).flex_none().px(SPACE[2]).items_center()
        .on_size_change((size, cx) => this.measureSelect(size, cx)).child(this.machineSelect(t, choices)))
      .child(h_flex().h(SPACE[10]).flex_none().px(SPACE[3]).items_center().justify_between()
        .child(div().text_size(TYPE.sm).text_color(t.muted).child("Workspaces"))
        .child(((words) => tooltip(t, "space-new-tip", plusButton(t, "space-new", words, () => run("pdk-tabs.new-workspace")), words))(plusWords(plusTarget()))))
      // No footer: the sidebar's foot is pdk-usage's bar (request 20). A virtual list: retained child views own the
      // rows' independently clickable caret and + controls; no handlers register inside item callbacks.
      .child(v_flex().id("tree-viewport").relative().flex_1().min_h(0).px(SPACE[2]).on_size_change((size, cx) => this.measureViewport(size, cx))
        .child(v_virtual_list("pdk-tree-list", items.length, items.map((i) => i.h), (i) => items[i].key,
          nativeRows).track_scroll(this.treeScroll).h(this.treeViewport ?? ROW).w_full())
        .child(Scrollbar.vertical("pdk-tree-list").absolute().inset_0()));
  }
}
