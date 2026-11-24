// The tremor guide (spec section 5): one short page, opened from Cmd+K. What tremor adds to Herdr, each with its
// keys when the person has them bound (shared kbd, keys() normalised once); Herdr's own Settings and keyboard
// shortcuts do the rest. It never reads profiles, changes setup state or starts a terminal.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, props, run, closeOverlay } from "herdr";
import { TYPE, SPACE, ROW, softInk, button, kbd, shortcut, overlayFrame, overlayHeader } from "./lib/ui.js";

// [what, in a few words, the command whose binding it shows (or null)]
export const ROWS = [
  ["Find anything", "Workspaces, tabs and running agents.", "mod.open:pdk-search"],
  ["New workspace", "The + over the workspaces starts one with an agent.", null],
  ["Machines", "All machines' work, or one machine's.", null],
  ["Chat, Terminal, Factory", "Three views of the same work, in the tab bar.", null],
  ["Pane hover", "Pane hover: Clean or Pane hover: Normal, in Cmd+K.", null],
  ["Usage", "Each machine's limits, at the foot of the sidebar.", null],
  ["tremor settings", "Default folder and pane hover, from Cmd+K.", "mod.open:pdk-settings"],
  ["Settings", "Herdr's own: themes, machines, updates.", "app.settings"],
];

export default class Guide extends View {
  init(_props, cx) {
    this.origin = { ...props() };
    this.handle = cx.focus_handle(); this.handle.focus();
  }
  close() { closeOverlay(this.origin.overlay); }
  open(command) { this.close(); run(command); }
  render() {
    const t = theme();
    const row = ([what, words, command], i) => {
      const keys = command ? shortcut(command) : null;
      return h_flex().id(`guide-row-${i}`).h(ROW.two).flex_none().gap(SPACE[3]).items_center()
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().text_size(TYPE.base).font_medium().text_color(t.foreground).child(what))
          .child(div().truncate().text_size(TYPE.sm).text_color(t.muted).child(words)))
        .when(Boolean(keys), (el) => el.child(kbd(t, keys)));
    };
    return overlayFrame(t, "pdk-guide", { hostFrame: true }).size_full().text_color(t.foreground).track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { cx.stop_propagation(); this.close(); } })
      .child(overlayHeader(t, "guide-head", "tremor"))
      .child(v_flex().id("guide-body").flex_1().min_h(0).overflow_y_scrollbar().px(SPACE[4]).py(SPACE[3]).gap(SPACE[1])
        .child(div().pb(SPACE[2]).text_size(TYPE.base).text_color(softInk(t)).child("A layout for Herdr. Herdr Core still runs every terminal."))
        .children(ROWS.map(row)))
      .child(h_flex().h(ROW.two + SPACE[2]).flex_none().px(SPACE[4]).gap(SPACE[2]).items_center().border_t(1).border_color(t.border)
        .child(button(t, "guide-keys", { text: "Keyboard shortcuts", variant: "ghost-muted", onPress: () => this.open("app.help") }))
        .when(Boolean(shortcut("app.help")), (el) => el.child(kbd(t, shortcut("app.help"))))
        .child(div().flex_1())
        .child(button(t, "guide-close", { text: "Close", variant: "primary", onPress: () => this.close() })));
  }
}
