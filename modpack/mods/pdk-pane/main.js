// A pane's 33px header: the kind's mark, the pane's own name and its status marker (owner, 11 Nov: the dot sits by
// the name, the right end is the controls'), the folder; on hover, this pane's controls in the style Cmd+K picks
// (adapters/views.js): Clean, the earlier text buttons Split →, Split ↓, Expand and Close; or Normal, the same four
// as square icon buttons. An expanded pane keeps them in view, with Restore, so the way back is always on screen.
// An agent's pane has the Chat / Terminal toggle in the middle of its bar (owner, 11 Nov: on each
// pane's bar, in the centre, clear of the expand and close buttons): Chat shows that agent's chat. Click: focus the pane.
//
// A clone of Herdr App's shipped `pane` mod (herdrdev/herdr-app@2405bf3, defaults/mods/pane/main.js,
// Apache-2.0). Changed: T3 sizes (12px text, 24px buttons) as measured by herdr-t3, the shared markers, the pack's
// glyphs in the shapes the shipped mod draws, a short tooltip with its key and an accessible name on every button,
// the Chat / Terminal toggle.

import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, terminals, props, run, theme, shared, setShared } from "herdr";
import { TYPE, ICON, ROW, withFont, SPACE, kindMarker, kindOf, statusMarker, iconButton, textButton, segmentedChoice, tooltip, shortcut, folderLabel, folderName, paneLabel } from "./lib/ui.js";
import { STACK, AGENT_VIEWS, pressView, paneControls, HOVER_KEY } from "./lib/views.js";
import { displayWord } from "./lib/status.js";

export default class Pane extends View {
  init(_props, cx) {
    this.hovered = false;
    this.keys = [0, 1, 2, 3].map(() => cx.focus_handle()); // the four controls, so Tab can reveal them (C10)
  }

  render() {
    const t = theme();
    const p = panes().find((x) => x.pane === props()?.pane);
    if (!p) return div();
    // The mark says what runs (its kind in the tooltip), the text says which pane it is (owner request 14).
    const term = terminals().find((x) => x.address === p.terminal);
    const kind = kindOf(term);
    const agent = Boolean(kind || p.program?.agent || p.status);
    const name = paneLabel(p, term);
    const pane = p.pane;
    const word = displayWord(p.status);
    // Clean: the earlier text button. Normal: a 24 px square icon button. Either way its tooltip is its words and its
    // key, on the control itself (shared tooltip).
    const button = (c, k) => tooltip(t, `${c.id}-tip-${pane}`,
      (c.text ? textButton(t, `${c.id}-${pane}`, c.text, c.label, () => run(c.command, c.args))
        : iconButton(t, `${c.id}-${pane}`, c.glyph, c.label, () => run(c.command, c.args), { size: ROW.compact, pressed: c.pressed, tip: false })).track_focus(this.keys[k]),
      c.label, { keys: shortcut(c.key) ?? [] });
    // The controls lie over the path, at the bar's right end (design-system C10): shown while the pointer is on the
    // header or one of them has the keyboard; nothing else moves. Hidden, they take no width, so no click lands on them.
    // An expanded pane keeps them in the row, after the path, which then ends before them.
    const show = this.hovered || this.keys.some((h) => h.is_focused());
    const controls = h_flex().id(`ph-ctl-${pane}`).gap(SPACE[1]).items_center()
      .when(p.zoomed, (el) => el.flex_none().pl(SPACE[2]))
      .when(!p.zoomed, (el) => el.absolute().top(0).bottom(0).right(0).pl(SPACE[2]).bg(t.surface).overflow_hidden()
        .when(!show, (hid) => hid.w(0).pl(SPACE[0])))
      .children(paneControls(pane, p.zoomed, shared(HOVER_KEY)).map(button));
    // The visual contract's pane header (option-a-rest 04): 33 high on `surface`, 8 px in and apart, the mark 14, the
    // name 12/500 in foreground, its status marker after it, the folder 11 dim pushed right with an ellipsis; a bottom edge.
    // Three parts. On an agent's pane the left and right parts share the width evenly, which puts the toggle between
    // them in the bar's exact middle; a plain shell has no toggle, and its name takes only the room it needs.
    return withFont(h_flex()).id(`pane-head-${pane}`).size_full().px(SPACE[2]).gap(SPACE[2]).items_center().bg(t.surface).border_b(1).border_color(t.border)
      .text_size(TYPE.sm)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .child(h_flex().id(`ph-left-${pane}`).min_w(0).h_full().gap(SPACE[2]).items_center().when(agent, (el) => el.flex_1()).when(!agent, (el) => el.flex_shrink_1())
        .child(kindMarker(t, { agent, label: kind || p.program?.name || "Terminal" }, ICON.base, t.muted, `ph-kind-${pane}`))
        .child(div().id(`ph-name-${pane}`).flex_shrink_1().min_w(0).truncate().max_w(240).font_medium().text_color(t.foreground)
          .child(name))
        .children([statusMarker(t, word, `ph-st-${pane}`)].filter(Boolean)))
      // Chat / Terminal for this pane's agent (owner, 11 Nov): a pane shows the terminal, so Terminal is lit; Chat
      // focuses this pane and shows its agent's chat. A plain shell has no chat and no toggle. The chat follows focus
      // only when focus moves, so the press also names this terminal as the chat's pick, as a click on its sidebar
      // row does (pdk-tree pick): a sub-agent chosen there earlier must not come back (review R1).
      .when(agent, (el) => el.child(segmentedChoice(t, `ph-view-${pane}`, AGENT_VIEWS, "main",
        (v) => { run("pane.focus", { pane }); setShared("pdk.chat.pick", { address: p.terminal, at: Date.now() }); run("layout.select", { stack: STACK, child: pressView("main", v) }); },
        { variant: "navigation", label: "Show this agent as", ground: t.surface, owner: this }).flex_none()))
      // The folder is metadata: 11 px, dim, at the header's right end. Its own name only (owner, 11 Nov: the whole path,
      // cut at its end, lost the part that tells panes apart; a long name still ends in an ellipsis). The whole path is
      // the name's accessible name and the tooltip of the space it sits in, which the controls cover on hover.
      .child(div().id(`ph-right-${pane}`).flex_1().min_w(0).h_full().relative().flex().items_center().justify_end()
        .when(Boolean(p.cwd), (el) => el.tooltip(folderLabel(p.cwd)))
        .child(div().id(`ph-dir-${pane}`).min_w(0).truncate().text_size(TYPE.xs).text_color(t.dim).accessibility_label(folderLabel(p.cwd)).child(folderName(p.cwd)))
        .child(controls));
  }
}
