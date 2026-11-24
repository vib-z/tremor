import { View, div } from "gpui-kit";
import { theme, spaces, machines, knownAgents, run, closeOverlay, props, shared, setShared } from "herdr";
import { ICON, SPACE, kindMarker, menuFrame, menuItem, menuState, bindMenuKeys, shortcut } from "./lib/ui.js";
import { MACHINE_KEYS, machineFilter, machineList, inFilter } from "./lib/status.js";
import { NEW_KEYS } from "./lib/workspace.js";

// Herdr's own new menu (herdr-app@2405bf3 defaults/mods/new-menu, Apache-2.0; see NOTICE.md), kept minimal (spec §3,
// §5): the agents installed where the shown workspace runs and Terminal, as a new tab there, then New workspace,
// which is the sidebar's + (pdk-tabs.new-workspace, shared/new-workspace.js). No uninstalled agents and no bare space.new. Drawn with the shared
// menu (visual contract, option-a-rest 02): items 28, marks 14, each item's real key in the plain kbd form; 1 to 9
// start the agents in order; the arrows, Home, End, Enter, Esc and Tab are the shared menu's (Esc and Tab close).

// The last agents each machine reported, shown at once while knownAgents() checks again.
const KNOWN = "new-menu.agents";

export default class NewMenu extends View {
  // The workspace a new tab goes in: the shown one, when the machine filter shows it (spec §2).
  space() {
    const filter = machineFilter(shared(MACHINE_KEYS.filter), machineList({ spaces: spaces(), machines: machines(), listed: shared("pdk.machines.list") ?? [] }));
    return spaces().find(s => s.active && inFilter(filter, s.machine)) ?? null;
  }
  init(_props, cx) {
    const machine = this.space()?.machine;
    const where = machine ?? "";
    this.agents = shared(KNOWN)?.[where] ?? [];
    this.handle = cx.focus_handle();
    this.handle.focus();
    bindMenuKeys(cx);
    cx.spawn(async cx => {
      try {
        this.agents = await knownAgents({ on: machine });
        this.checked = true; // an empty answer is "none installed", not still checking (review UX11)
        setShared(KNOWN, { ...shared(KNOWN), [where]: this.agents });
      }
      catch { this.failed = true; }
      cx.notify();
    });
  }
  render() {
    const t = theme();
    const space = this.space(), menu = menuState(this, "new-menu");
    const installed = space ? this.agents.filter(a => a.installed && a.run?.length) : [];
    const go = (fn) => (_e, cx) => { closeOverlay(props().overlay); fn(cx); };
    const start = (a) => { if (a) setShared(NEW_KEYS.agent, a.key); run("tab.new", { space: space?.id, ...(a ? { name: a.name, argv: a.run } : {}) }); };
    const mark = (agent, label, id) => kindMarker(t, { agent, label, ground: "popover" }, ICON.base, t.muted, id);
    const line = (id, words) => menuItem(t, id, { text: words, disabled: true });
    const items = [
      ...installed.map((a, i) => menuItem(t, `new-${a.key}`, { text: a.name, icon: mark(true, a.name, `${a.key}-mk`), keys: i < 9 ? [String(i + 1)] : [], menu, onPress: go(() => start(a)) })),
      ...(space && !installed.length ? [this.failed ? line("agents-failed", "Could not load agents") : this.checked ? line("agents-none", "No agents installed") : line("agents-checking", "Checking installed agents…")] : []),
      ...(space ? [menuItem(t, "terminal", { text: "Terminal", icon: mark(false, "Terminal", "terminal-mk"), keys: shortcut("tab.new") ?? [], menu, onPress: go(() => start(null)) })] : []),
      div().h(1).mx(SPACE[2]).my(SPACE[1]).flex_none().bg(t.border),
      menuItem(t, "space", { text: "New workspace", keys: shortcut("pdk-tabs.new-workspace") ?? [], menu, onPress: go(() => run("pdk-tabs.new-workspace")) }),
    ];
    // The digits on a wrapper; the frame holds the keyboard, so its PdkMenu bindings match. Closing gives the
    // keyboard back where it was (the host's overlay restores it).
    return div().id("new-menu-keys").w_full()
      .on_key_down((e, cx) => {
        if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
        const agent = /^[1-9]$/.test(e.key) ? installed[Number(e.key) - 1] : null;
        if (agent) { closeOverlay(props().overlay); start(agent); }
      })
      .child(menuFrame(t, "new-menu", items, { menu, close: () => closeOverlay(props().overlay) }).track_focus(this.handle).w_full().accessibility_label("New"));
  }
}
