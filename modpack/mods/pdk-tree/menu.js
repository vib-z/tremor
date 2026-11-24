// The pack's menu for an agent (pin, unread) and a machine (connect, sign in), as menu-model.js lists them; every
// other right-click opens Herdr's own menu (spec §5). Adapted from Herdr App 2405bf3 defaults/mods/menu/main.js,
// Apache-2.0: Pdk shared rows and captured target guards.
import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { run, props, closeOverlay, theme, terminals, spaces, panes, agents, shared, hc, nextCommand, machines } from "herdr";
import { TYPE, SPACE, ROW, fitLabel, menuFrame, menuItem, menuState, bindMenuKeys, shortcut } from "./lib/ui.js";
import { captureMenu, validMenu, menuEntries } from "./menu-model.js";
export default class ContextMenu extends View {
  menuLive() {
    const repair = JSON.parse(localStorage.getItem("pdk.machines.reconnecting") ?? "{}");
    const ms = [...(shared("pdk.machines.list") ?? [])];
    for (const m of machines()) if (m.name && !ms.some((x) => x.name === m.name)) ms.push({ name: m.name, state: m.layout === "ready" ? "connected" : "loading" });
    for (const r of Object.values(repair)) if (!ms.some((m) => m.name === r.machine.name)) ms.push(r.machine);
    return { spaces: spaces(), panes: panes(), terminals: terminals(), agents: agents(), machines: ms };
  }
  initMenu(_props, cx) {
    const p = props();
    this.menuContext = captureMenu(p.tab, p.target, this.menuLive());
    this.menuError = "";
    this.menuHandle = cx.focus_handle(); this.menuHandle.focus();
    bindMenuKeys(cx);
    cx.spawn(async (cx) => { for (;;) {
      const cmd = await nextCommand();
      if (cmd.startsWith("take:")) await this.menuChoose(cmd.slice(5), cx);
      cx.notify();
    } });
  }
  menuList() {
    const c = this.menuContext;
    const repair = JSON.parse(localStorage.getItem("pdk.machines.reconnecting") ?? "{}")[c?.machine];
    return menuEntries(c, this.menuLive(), { repair });
  }
  menuClose(returnFocus = true) {
    closeOverlay(props().overlay);
    if (returnFocus && props().returnCommand) run(props().returnCommand);
  }
  async menuChoose(id, cx) {
    const c = this.menuContext, live = this.menuLive();
    if (!validMenu(c, live)) { this.menuError = "This target is no longer available. Close this menu and choose it again."; return cx.notify(); }
    const entry = this.menuList().find((x) => x.id === id);
    if (!entry || entry.disabled) return;
    if (entry.command === "unread") {
      const t = live.terminals.find((t) => t.address === c.terminal);
      const r = await hc(["label", c.terminal, `herdr.seen=${t.turn - 1}`]);
      if (r.code) { this.menuError = r.stderr || r.stdout || "Could not mark unread."; return cx.notify(); }
      this.menuClose();
    } else if (entry.command === "connect") { this.menuClose(false); run(`pdk-tree.connect:${c.id}`); }
    else if (entry.command === "login") {
      // Native Core login runs in a local terminal, with an argv vector and the captured machine name.
      this.menuClose(false); run("space.new", { name: `Sign in to ${c.machine}`, machine: "", argv: ["hc", "machine", "login", c.machine] });
      run("layout.select", { stack: "work-body", child: "main" });
    } else { this.menuClose(!entry.destructive); run(entry.command, entry.args); }
  }
  // The shared menu (visual contract: items 28, 13 px softInk, a disabled one at DISABLED, 0.5, with its reason as its accessible
  // name), under the target's name and machine. The keys are menuFrame's; Esc, Tab and Shift-Tab close and give the
  // row its focus. The frame holds the keyboard, so its PdkMenu bindings match.
  renderMenu() {
    const t = theme(), c = this.menuContext, rows = this.menuList(), menu = menuState(this, "pdk-context-menu");
    const items = [
      h_flex().h(ROW.compact).px(SPACE[2]).gap(SPACE[2]).items_center()
        .child(fitLabel("context-name", c?.name ?? "Target unavailable").flex_1().text_size(TYPE.base).font_medium().text_color(t.foreground))
        .child(fitLabel("context-host", c?.machine ?? "This computer").max_w(100).text_size(TYPE.xs).text_color(t.dim)),
      ...(!rows.length ? [div().p(SPACE[2]).text_size(TYPE.sm).text_color(t.dim).child("This target is no longer available.")] : []),
      ...rows.flatMap((it) => [
        ...(it.group ? [div().h(1).mx(SPACE[2]).my(SPACE[1]).flex_none().bg(t.border)] : []),
        menuItem(t, `context-${it.id}`, { text: it.reason ? `${it.label} · ${it.reason}` : it.label, keys: shortcut(it.command) ?? [], disabled: it.disabled, destructive: it.destructive, menu,
          onPress: (_e, cx) => this.menuChoose(it.id, cx) }),
      ]),
      ...(this.menuError ? [fitLabel("context-error", this.menuError).p(SPACE[2]).text_size(TYPE.sm).text_color(t.blocked)] : []),
    ];
    return div().id("pdk-context-menu-keys").w_full()
      .child(menuFrame(t, "pdk-context-menu", items, { menu, close: () => this.menuClose() }).track_focus(this.menuHandle).w_full().accessibility_label(c ? `Actions for ${c.name}` : "Target unavailable"));
  }
}
