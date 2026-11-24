// What the chat draws when it is not, or not only, a conversation: the pages with no conversation to show and the
// one block at the thread's end that says a conversation is loading, empty, away or failed (owner, 12 Nov 2026: a
// loading or empty chat must not look broken). lib/appear.js decides which and in what words; this draws it.
// One scale for all of it: type 16 (a page's title), 13/500 (a block's line), 12 (what to know or do); gaps 8 and 16;
// ink `foreground` for what is happening, `muted` for the rest, on `canvas`. Nothing moves under Reduce Motion: the
// shared spinner draws its still dots then.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { TYPE, SPACE, ICON, ROW, spinner, actionButton } from "./lib/ui.js";

export const ACTIONS = { terminal: "Open terminal", retry: "Try again" };
export const TEXT_MAX = 420; // a line of explanation stays readable; narrower views wrap it
// Line heights: the block's line sits in a 20 px line so its 14 px mark centres on the words; the rest 16.
const LINE = `${SPACE[5]}px`, SMALL = `${SPACE[4]}px`;

// ctx: { act(action, cx), hit(desktop) } - the chat runs the action; `hit` is a pressable's height at this width
// (44 under 768 px of view width, else `desktop`). actionButton is a Tab stop that Enter and Space press.
const button = (t, id, action, ctx) => actionButton(t, id, ACTIONS[action], ACTIONS[action], (_e, cx) => ctx.act(action, cx), { h: ctx.hit(ROW.base) });

// What a screen reader says for a block: the line without its trailing dots, then the detail.
export const blockName = (b) => [b.line.replace(/…$/, ""), b.detail].filter(Boolean).join(": ");

// A page: the whole body, centred. For no agent, a plain terminal and a kind tremor can't read.
export function statePage(t, p, ctx) {
  return v_flex().id(`chat-page-${p.id}`).size_full().items_center().justify_center().gap(SPACE[2]).px(SPACE[6]).bg(t.canvas)
    .child(div().w_full().max_w(TEXT_MAX).text_center().text_size(TYPE.lg).font_medium().text_color(t.foreground).child(p.title))
    .when(Boolean(p.body), (el) => el.child(div().w_full().max_w(TEXT_MAX).text_center().text_size(TYPE.sm).line_height(SMALL).text_color(t.muted).child(p.body)))
    .when(Boolean(p.action), (el) => el.child(div().pt(SPACE[2]).child(button(t, `chat-page-${p.action}`, p.action, ctx))));
}

// The block's mark, in a 14 px box on the line: the shared spinner while something is coming, the `blocked` dot
// for a failure, none for a plain fact (empty, can't follow).
const mark = (t, tone) => tone === "loading" ? spinner(t, ICON.base)
  : tone === "error" ? div().size(ICON.dot).rounded(ICON.dot / 2).bg(t.blocked) : null;

// A block: the thread's last item, at the left, where the next message would be. The detail and the button line up
// under the words, not under the mark. Loading is a polite status; a failure an alert.
export function stateBlock(t, b, ctx) {
  const m = mark(t, b.tone);
  return h_flex().id(`chat-state-${b.id}`).w_full().gap(SPACE[2]).items_start()
    .role(b.tone === "error" ? "alert" : "status").accessibility_label(blockName(b))
    .when(Boolean(m), (el) => el.child(h_flex().h(SPACE[5]).w(ICON.base).flex_none().items_center().justify_center().child(m)))
    .child(v_flex().flex_1().min_w(0).gap(SPACE[2]).items_start()
      .child(div().w_full().max_w(TEXT_MAX).text_size(TYPE.base).line_height(LINE).font_medium().text_color(t.foreground).child(b.line))
      .when(Boolean(b.detail), (el) => el.child(div().w_full().max_w(TEXT_MAX).text_size(TYPE.sm).line_height(SMALL).text_color(t.muted).child(b.detail)))
      .when(Boolean(b.action), (el) => el.child(button(t, `chat-state-${b.action}`, b.action, ctx))));
}
