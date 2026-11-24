// The tab bar: the shown workspace's tabs as slim 24px tabs (drag to reorder, double-click to rename,
// right-click for Herdr's menu, + for Herdr's new menu), then the Grid / Factory toggle (icons only, request 3b; Chat /
// Terminal is on each pane's own bar: owner, 11 Nov). Before the tabs: the sidebar toggle while the
// sidebar is hidden (request 4a), and the machine's name when the shown workspace isn't on this computer (request 1).
// The bar is painted with `canvas`, not `chrome` (owner 3a: only the sidebar turns blue or glass; the two are equal
// in the base themes).
//
// A clone of Herdr App's shipped `tabs` mod (herdrdev/herdr-app@2405bf3, defaults/mods/tabs/main.js,
// Apache-2.0). Changed: Files and Changes buttons and the side-panel memory removed (plan M9); T3 sizes
// (24px tabs, radius 6) as measured by herdr-t3; text and minimal markers (the only icons are the toggle's);
// the Grid / Factory toggle added.

import { View, div } from "gpui-kit";
import { h_flex, ScrollHandle } from "gpui-base";
import { spaces, panes, terminals, agents, run, openOverlay, theme, window, layout, settings, shared, setShared, machines, nextCommand, focused } from "herdr";
import { TYPE, SPACE, ICON, ROW, RADIUS, withFont, iconButton, textButton, focusRing, segmentedChoice, fitLabel, statusMarker, kindMarker, agentLabel, kindOf, findNode, tooltip, shortcut } from "./lib/ui.js";
import { displayWord, buildPaneTree, tabHeads, machineLabel, lightsInset, MACHINE_KEYS, machineFilter, inFilter, machineList, nativeMenu, paneHomes } from "./lib/status.js";
import { newWorkspace, rememberFolder } from "./lib/new-workspace.js";
import { plusButton } from "./lib/plus.js";
import { STACK, PLACE_VIEWS, litSegment, pressView, TABS_KEY, followTab, forgetTab, keepTab } from "./lib/views.js";


// The visual contract's tab bar (option-a-rest, 03): tabs 28 high, 8 px in and apart, a 6 px corner, 13 px muted on
// the bar, the shown one foreground on `selected`; the agent's mark 14; the close glyph in a 16 px slot; a name of at
// most 200 px. The close glyph's colour while it is not shown is clear.
const CLOSE_W = SPACE[4];
const NAME_MAX = 200;
const CLEAR = "#00000000";
const FOLLOW_MS = 250;
export default class Tabs extends View {
  init(_props, cx) {
    this.pressed = null;
    // The strip's scroll position, so the shown tab is kept in view (Herdr 0.1.15 stock tabs/main.js).
    this.scroll = ScrollHandle.new();
    // The one "+" (spec §3): "pdk-tabs.new-workspace" (the machine the filter shows) and
    // "pdk-tabs.new-workspace:<local|name>" (one machine). Here because the tab bar shows whether or not the sidebar
    // does, and `<mod>.<command>` reaches shown copies only (review UX03).
    cx?.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "new-workspace") newWorkspace(this, cx);
        else if (c.startsWith("new-workspace:")) newWorkspace(this, cx, c.slice(14) === "local" ? "" : c.slice(14));
      }
    });
    // The follower also runs on a short timer: a bar draws only when the window does, and a hidden or locked window
    // would let it see a tab change and the view chosen there in one late look. It returns at once when nothing moved.
    cx?.timer.every(FOLLOW_MS, () => this.follow());
  }

  shown() {
    return findNode(layout(), STACK)?.active ?? "main";
  }

  select(child) {
    run("layout.select", { stack: STACK, child });
  }

  // Chat or Terminal per tab (adapters/views.js followTab): when the shown tab changes, it shows what it showed when
  // it was left, Chat with its agent or its panes. Here because the tab bar is always on screen. Nothing is decided
  // before the app lists its terminals (a tab's agent would read as gone).
  follow() {
    const tab = focused()?.tab ?? null;
    const all = terminals();
    const view = this.shown(), was = this.viewSeen;
    this.viewSeen = view;
    if (!tab || !all.length) return;
    if (tab === this.followed) { // the same tab: its entry follows what it shows
      const next = keepTab({ entries: shared(TABS_KEY), tab, view, focus: focused()?.terminal ?? null, live: (a) => all.some((x) => x.address === a) });
      if (next) setShared(TABS_KEY, next);
      return;
    }
    this.followed = tab;
    const asked = was !== undefined && was !== "chat" && view === "chat"; // Chat chosen since the last look
    const had = shared(TABS_KEY) ?? {};
    const pick = shared("pdk.chat.pick");
    const r = followTab({ entries: had, tab, view, tabs: spaces().flatMap((s) => s.tabs.map((c) => c.id)),
      live: (a) => all.some((x) => x.address === a), pick, pickTab: panes().find((p) => p.terminal === pick?.address)?.tab ?? null, asked, focus: focused()?.terminal ?? null });
    if (JSON.stringify(r.entries) !== JSON.stringify(had)) setShared(TABS_KEY, r.entries);
    if (r.pick) setShared("pdk.chat.pick", { address: r.pick, at: Date.now() });
    if (r.select) this.select(r.select);
  }

  // The Grid / Factory toggle (owner, 11 Nov; adapters/views.js). Icons only (request 3b): the words are the tooltip
  // and the accessible name. The shared segmentedChoice (C6): 24 px square segments, 2 px apart, the shown one
  // filled, Enter or Space to choose.
  place(t) {
    const shown = this.shown();
    // Grid over a chat: this tab shows its panes from now on.
    const press = (v) => {
      const tab = focused()?.tab;
      if (v === "grid" && shown === "chat" && tab && (shared(TABS_KEY) ?? {})[tab]) setShared(TABS_KEY, forgetTab(shared(TABS_KEY), tab));
      this.select(pressView(shown, v));
    };
    return segmentedChoice(t, "place-toggle", PLACE_VIEWS, litSegment(PLACE_VIEWS, shown), press,
      { variant: "navigation", label: "Show", ground: t.canvas, owner: this }).flex_none();
  }

  menu(c, space) {
    const live = spaces().find((s) => s.id === space.id && (s.machine ?? null) === (space.machine ?? null));
    if (!live?.tabs.some((t) => t.id === c.id)) return;
    // Herdr's own tab menu (spec §5), its target captured now.
    openOverlay(nativeMenu("tab", { id: c.id, space: space.id }));
  }

  render() {
    const t = theme();
    rememberFolder();
    this.follow();
    // The machine filter (spec §2): another machine's workspace, though shown by Herdr, has no tabs here.
    const filter = machineFilter(shared(MACHINE_KEYS.filter), machineList({ spaces: spaces(), machines: machines(), listed: shared("pdk.machines.list") ?? [] }));
    const space = spaces().find((p) => p.active && inFilter(filter, p.machine));
    const shown = space?.tabs ?? [];
    // Herdr 0.1.15 (stock tabs/main.js): the shown tab scrolls into view when it changes, and again when the strip or
    // a tab up to it changes size (a rename or a status mark on an earlier tab can push it out).
    const shownAt = shown.findIndex((c) => c.active);
    if (shown[shownAt]?.id !== this.shownTab || shownAt !== this.shownAt) {
      this.shownTab = shown[shownAt]?.id; this.shownAt = shownAt;
      if (shownAt >= 0) this.scroll.scroll_to_item(shownAt);
    }
    const reveal = (_size, cx) => { if (shownAt >= 0) { this.scroll.scroll_to_item(shownAt); cx.notify(); } };
    const all = terminals();
    // The shown workspace's own panes: another workspace may list the same tab id (status.js paneHomes).
    const homes = paneHomes(spaces(), panes(), all);
    const allPanes = panes().filter((p) => homes.get(p.pane) === space?.id);
    const stop = (_e, cx) => cx.stop_propagation();
    // The sidebar's naming (adapters/status.js tabHeads): the agent's mark, then the tab's own name (request 14).
    const heads = tabHeads(buildPaneTree({ spaces: space ? [space] : [], panes: allPanes, terminals: all, agents: agents(), kindOf }));
    const item = (c, i) => {
      const inTab = allPanes.filter((p) => p.tab === c.id);
      const termOf = (p) => all.find((x) => x.address === p?.terminal);
      const head = heads.get(c.id);
      const lead = (head?.lead && inTab.find((p) => p.pane === head.lead.pane)) ?? inTab.find((p) => kindOf(termOf(p))) ?? inTab.find((p) => p.program?.agent) ?? inTab[0];
      const program = lead?.program;
      // The mark's words: the lead's kind (or the program); the visible text is the tab's name.
      const label = head?.kind ?? agentLabel(termOf(lead), program);
      const name = head ? head.text : /^tb\d+$/.test(c.name) ? label : c.name;
      const word = displayWord(c.status);
      const active = c.active && this.shown() !== "factory";
      const pick = () => { run("tab.select", { id: c.id }); if (this.shown() === "factory") this.select("main"); };
      // The close slot is always there (C10), so showing Close on the shown tab, on hover or on focus never moves
      // anything; it shows its glyph only then.
      const closeShown = active || this.hoverTab === c.id;
      const close = textButton(t, `close-${c.id}`, "×", "Close tab", () => run("tab.close", { id: c.id }), { h: CLOSE_W, size: TYPE.lg, color: closeShown ? t.muted : CLEAR })
        .w(CLOSE_W).px(0).focus((s) => s.border_color(t.accent).text_color(t.foreground));
      return focusRing(h_flex(), t, pick).id(`tab-${c.id}`).relative().h(ROW.base).px(SPACE[2]).gap(SPACE[2]).rounded(RADIUS.md).items_center().flex_none().text_size(TYPE.base)
        .bg(active ? t.selected : t.canvas).text_color(active ? t.foreground : t.muted)
        .hover((s) => s.bg(active ? t.selected : t.hover).text_color(t.foreground))
        .on_hover((on, cx) => { const was = this.hoverTab; this.hoverTab = on ? c.id : was === c.id ? null : was; if (this.hoverTab !== was) cx.notify(); })
        .when(i <= shownAt, (el) => el.on_size_change(reveal))
        .role("tab").aria_selected(active).set_position(i + 1, shown.length).accessibility_label(head?.aria ?? `Tab ${name}`)
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = { id: c.id, space: space.id, machine: space.machine ?? null }; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_key_down((e, cx) => {
          if (e.key === "context-menu" || e.key === "m" || e.key === "f10" && e.shift) this.menu(c, space);
          else if (e.key === "enter" || e.key === "space") pick(); else return;
          cx.stop_propagation();
        })
        .on_mouse_move((_e, cx) => { if (this.pressed && this.pressed.space === space.id && this.over !== c.id) { this.over = c.id; cx.notify(); } })
        .on_mouse_up("left", (_e, cx) => {
          const from = this.pressed; this.pressed = null; this.over = null;
          const live = spaces().find((s) => s.id === from?.space && (s.machine ?? null) === from.machine);
          if (live?.id === space.id && live.tabs.some((t) => t.id === from.id)) {
            const to = live.tabs.findIndex((t) => t.id === c.id);
            if (from.id !== c.id && to >= 0) run("tab.move", { id: from.id, index: to + 1 });
            else pick();
          }
          cx.notify();
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.menu(c, space); })
        .when(this.pressed && this.over === c.id && this.pressed.id !== c.id, (el) => el.child(div().absolute().top(0).bottom(0).w(1).bg(t.accent)
          .when(shown.findIndex((x) => x.id === this.pressed.id) > i, (line) => line.left(0))
          .when(shown.findIndex((x) => x.id === this.pressed.id) < i, (line) => line.right(0))))
        .child(kindMarker(t, { agent: Boolean(kindOf(termOf(lead)) || program?.agent), label }, ICON.base, active ? t.foreground : t.dim, `tab-kind-${c.id}`))
        .child(fitLabel(`tab-name-${c.id}`, c.zoomed ? `${name} · expanded` : name).max_w(NAME_MAX))
        .child(div().w(ICON.base).flex_none().flex().items_center().justify_center().children([statusMarker(t, word, `tab-st-${c.id}`)].filter(Boolean)))
        .child(close);
    };
    const root = layout();
    const sidebar = findNode(root, "sidebar");
    const w = window();
    // The first thing in the bar starts 12 after what is before it, the sidebar or the window buttons (lightsInset).
    const lightsPadding = Math.max(SPACE[3], lightsInset(w, root, settings().zoom) - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0));
    const remote = space?.machine ? machineLabel(space.machine) : null;
    // The divider is drawn over the bottom edge (the last child), so everything centres in the whole 40 px, on the
    // window buttons' centre line, as in the sidebar's head (owner, 11 Nov: the top bar lines up).
    return withFont(h_flex()).size_full().min_w(0).relative().pl(lightsPadding).pr(SPACE[2]).gap(SPACE[1]).items_center().bg(t.canvas)
      .role("tab_list").accessibility_label(remote ? `Tabs of ${space.name} on ${remote}` : "Tabs")
      // Herdr's own layout.toggle (⌘B in its keys); the sidebar's head carries it while the sidebar shows.
      .when(Boolean(sidebar?.hidden), (el) => el.child(iconButton(t, "sidebar-show", "panel-left", "Show sidebar ⌘B", () => run("layout.toggle", { id: "sidebar" }), { glyph: ICON.base })))
      .when(Boolean(remote), (el) => el.child(div().id("tab-machine").flex_none().h(20).px(SPACE[2]).flex().items_center().rounded(RADIUS.sm).border(1).border_color(t.border)
        .text_size(TYPE.xs).text_color(t.muted).role("image").accessibility_label(`On ${remote}`).child(remote)))
      .on_mouse_up("left", () => { this.pressed = null; this.over = null; })
      .on_scroll_wheel((e) => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(SPACE[1]).overflow_x_scrollbar().track_scroll(this.scroll).on_size_change(reveal)
        .children(shown.map(item))
        // Lifted SPACE.raise so its x-height, not its line box, sits on the bar's centre line.
        .when(!space, (el) => el.child(div().relative().top(-SPACE.raise).text_size(TYPE.sm).text_color(t.dim).child("No workspace")))
        // Right after the last tab (option-a-rest 03). The + (24, the + button's 4 px corner) in the shared tooltip with its key (option-a-rest, 06: "New tab ⌘T").
        .child(tooltip(t, "tab-new-tip", plusButton(t, "tab-new", "New tab", () => openOverlay({ mod: "pdk-new-menu", kind: "popup", width: 250, height: 512 })),
          "New tab", { keys: shortcut("tab.new") ?? [] })))
      .child(div().w(1).h(16).mx(4).bg(t.border).flex_none())
      .child(this.place(t))
      .when(w?.buttons, (el) => el
        .child(textButton(t, "minimize", "-", "Minimize", () => run("window.minimize"), { h: 24, size: TYPE.lg }))
        .child(textButton(t, "maximize", w.maximized ? "▭" : "□", w.maximized ? "Restore" : "Maximize", () => run("window.maximize"), { h: 24, size: TYPE.lg }))
        .child(textButton(t, "close-window", "×", "Close window", () => run("window.close"), { h: 24, size: TYPE.lg })))
      .child(div().absolute().left(0).right(0).bottom(0).h(1).bg(t.border));
  }
}
