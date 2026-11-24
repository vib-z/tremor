// Tool calls and thoughts in the chat (owner, 11 Nov 2026 23:08: a call is "a short summary" that expands to
// "arguments, code, diffs, and the tool result", as "syntax-highlighted snippets, not dumped raw JSON"). The layout is
// design/chat-direction.md sections 4 and 5, in the pack's tokens; nothing is taken from another project's code.
//
// A closed call draws its header only. An open one draws the call's name, Arguments, Changes and Result from the
// entry's own fields (lib/chat.js callArgs, resultFields). Highlighted snippets are read-only editors made in handlers
// (ToolEditors.sync), never in a render, and released when their call closes or the chat moves to another session.

import { div } from "gpui-kit";
import { h_flex, v_flex, TextView, Editor, EditorState } from "gpui-base";
import { TYPE, RADIUS, ICON, ROW, SPACE, monoFont, foldMarker, spinner, focusRing, fitLabel } from "./lib/ui.js";
import { totals, shownRows, CODE } from "./lib/codeview.js";
import { ARG_LIMIT, RESULT_LIMIT, fences } from "./lib/chat.js";

const LINE = SPACE[5]; // one code line's allocation
const SNIPPET_MAX = 20; // lines a snippet or a long value shows before it scrolls
const DETAIL_MAX = SPACE[12] * 10; // an open call's detail scrolls past this
const WIDE = SPACE[12] * 12; // below this width a header drops its one-line summary
// The stock files mod's aliases for the editor's grammars.
const GRAMMAR = { ts: "js", tsx: "js", jsx: "js", mts: "js", cts: "js", mjs: "js", jsonc: "json", toml: "yaml", vue: "html", svelte: "html" };
const KEY_WORDS = { command: "Command", cmd: "Command", file_path: "Path", path: "Path", content: "Content", query: "Query", url: "URL" };
const tint = (c) => `${String(c).slice(0, 7)}18`;
const lineCount = (text) => String(text ?? "").split("\n").length;

// An argument drawn in a snippet box rather than as a line of text.
const boxed = (a) => Boolean(a.lang) || lineCount(a.text) > 1;

export const syntaxOf = (t) => ({ keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6, boolean: t.ansi6 });

// Text shown exactly as written: in a fence longer than any run of backticks in it, so nothing inside is read as
// markdown or HTML, and spacing and line breaks stay. Prose (a thought) is escaped instead, with its line breaks kept.
export const literal = (text) => {
  const fence = "`".repeat(Math.max(3, ...(String(text).match(/`+/g) ?? []).map((r) => r.length + 1)));
  return `${fence}\n${text}\n${fence}`;
};
export const escaped = (text) => String(text).replace(/([\\`*_{}[\]()#+\-.!|<>~])/g, "\\$1").replace(/\n/g, "  \n");

// Whether a work group draws folded: a person's fold, or an older group of more than three that nobody opened
// (design chat-direction.md section 7). The render and the editors ask the same question (review R4).
export const groupFolded = (g, last, open, collapsed) =>
  collapsed.has(g.key) || (!last && g.items.length > 3 && !open.has(g.key) && !g.items.some((i) => open.has(i.key)));

// An open call's parts drawn as snippets, `[part, lang, text, numbers]`: each boxed argument, and a result with text.
const callParts = (e) => [
  ...(e.args ?? []).flatMap((a, i) => (boxed(a) ? [[`a${i}`, a.lang ?? "text", a.text, a.key === "content"]] : [])),
  ...(String(e.output ?? "").trim() ? [["out", e.outputLang ?? "text", e.output, /^read$/i.test(String(e.name ?? ""))]] : []),
];

// Every snippet the rows drawn show, by `<row key>|<part>` (review R4): each fenced block of an answer, and the parts
// of each open call in a group drawn open. A call in a folded group keeps its open key and has no editor.
export function drawnSnippets(rows, open, collapsed) {
  const out = new Map();
  let lastWork = -1;
  rows.forEach((r, i) => { if (r.type === "work") lastWork = i; });
  rows.forEach((r, i) => {
    if (r.type === "assistant" && r.text?.includes("```")) fences(r.text).forEach((p, k) => { if (p.code !== undefined) out.set(`${r.key}|f${k}`, [p.lang ?? "text", p.code, false]); });
    if (r.type !== "work" || groupFolded(r, i === lastWork && i >= rows.length - 2, open, collapsed)) return;
    for (const e of r.items) if (open.has(e.key)) for (const [part, ...spec] of callParts(e)) out.set(`${e.key}|${part}`, spec);
  });
  return out;
}

// The read-only editors of what the session shown draws, by `<scope>|<row key>|<part>`. Made and updated in handlers
// only; a value that streams in is set on the editor it already has.
export class ToolEditors {
  constructor() {
    this.map = new Map();
  }

  // Plain text wraps (review 7); code, commands and JSON keep their lines and scroll sideways. An editor whose grammar,
  // colours, numbering or wrapping changed (a theme switch, a language that arrived late) is made again (review 10);
  // one whose text grew keeps its state and takes the new text.
  ensure(key, lang, value, numbers, t) {
    const grammar = GRAMMAR[lang] ?? lang, wrap = grammar === "text", syntax = syntaxOf(t);
    const sig = JSON.stringify([grammar, syntax, numbers, wrap]);
    const had = this.map.get(key);
    if (had && had.sig === sig) {
      if (had.value !== value && had.state) { had.state.set_value(value); had.value = value; }
      return;
    }
    if (had) { had.state?.release(); this.map.delete(key); }
    try {
      const state = EditorState.new({ language: grammar, value, readonly: true, font_family: monoFont(), font_size: TYPE.sm,
        line_numbers: numbers, folding: false, soft_wrap: wrap, syntax });
      this.map.set(key, { state, value, sig });
    } catch {
      this.map.set(key, { state: null, value, sig, failed: true }); // drawn as plain text, said so
    }
  }

  get(key) {
    return this.map.get(key) ?? null;
  }

  // Every editor whose key starts with `prefix` ("" for all).
  release(prefix = "") {
    for (const [k, e] of this.map) if (k.startsWith(prefix)) { e.state?.release(); this.map.delete(k); }
  }

  // The editors an open call needs: an argument with a language or more than one line, and a result with text. Plain
  // text goes in a plain-text editor too (mono, selectable, scrolls), so nothing in it is read as markup.
  sync(scope, e, t) {
    for (const [part, lang, value, numbers] of callParts(e)) this.ensure(`${scope}|${e.key}|${part}`, lang, value, numbers, t);
  }

  // Exactly `want` (drawnSnippets) for `scope`, made or updated; every other editor is released (review R4). No scope:
  // none at all.
  reconcile(scope, want, t) {
    const head = scope ? `${scope}|` : null;
    for (const [k, e] of this.map) if (!head || !k.startsWith(head) || !want.has(k.slice(head.length))) { e.state?.release(); this.map.delete(k); }
    if (head) for (const [k, [lang, value, numbers]] of want) this.ensure(head + k, lang, value, numbers, t);
  }

  // The editors of a call that closed, or of every call of a scope.
  drop(scope, key = "") {
    this.release(`${scope}|${key}${key ? "|" : ""}`);
  }
}

// ---- the header ----

const STATE_WORD = { pending: "Running", ok: "Completed", error: "Failed", rejected: "Rejected" };
const verbOf = (e) => (e.status === "pending" ? e.going ?? e.doing ?? e.verb : e.status === "ok" ? e.done ?? e.verb : e.doing ?? e.verb);

function status(t, e) {
  if (e.status === "pending") return h_flex().flex_none().gap(SPACE[1]).items_center().text_size(TYPE.xs).text_color(t.muted).child(spinner(t, ICON.sm, { color: t.muted })).child("Running");
  if (e.status === "error") return h_flex().flex_none().gap(SPACE[1]).items_center().text_color(t.foreground).child("Failed").child(div().size(ICON.dot).flex_none().rounded(ICON.dot / 2).bg(t.blocked));
  if (e.status === "rejected") return div().flex_none().px(SPACE[1]).h(ROW.compact - SPACE[2]).flex().items_center().rounded(RADIUS.sm).bg(tint(t.blocked)).text_color(t.blocked).text_size(TYPE.xs).child("Rejected");
  if (e.changes?.length) return div().flex_none().text_color(t.done).child("✓");
  return null;
}

export const diffCounts = (t, n, id) => h_flex().id(id).flex_none().gap(SPACE[1]).text_size(TYPE.xs).font_family(monoFont())
  .when(n.add > 0, (el) => el.child(div().text_color(t.ansi2).child(`+${n.add}`)))
  .when(n.del > 0, (el) => el.child(div().text_color(t.ansi1).child(`−${n.del}`)));

// One call's header: verb, the detail in mono with the caret right after it, the one-line summary (or an edit's
// counts) and the status. The whole line is one disclosure target.
function toolHeader(t, e, open, toggle, width, focus, hit = ROW.compact) {
  const verb = verbOf(e);
  const detail = e.changes?.length ? `${shortPath(e.changes[0].path)}${e.changes.length > 1 ? ` +${e.changes.length - 1} files` : ""}`
    : e.input?.path && e.detail === e.input.path ? shortPath(e.detail) : e.detail ?? "";
  const full = e.changes?.length ? e.changes.map((f) => f.path).join(", ") : e.detail ?? "";
  const summary = !e.changes?.length && width >= WIDE && e.summary && e.summary !== e.detail ? e.summary : null;
  const sumMax = Math.max(0, Math.floor((width - SPACE[12] * 4) / 3));
  return focusRing(h_flex(), t, toggle).id(`tc-${e.key}`).when(Boolean(focus), (el) => el.track_focus(focus)).w_full().h(hit).px(SPACE[1]).gap(SPACE[2]).items_center().rounded(RADIUS.md).text_size(TYPE.sm)
    .cursor_pointer().hover((st) => st.bg(t.hover)).tooltip(open ? "Collapse call" : "Expand call")
    .role("button").accessibility_label(`${STATE_WORD[e.status] ?? "Completed"} ${e.name ?? verb}: ${verb} ${full}. ${open ? "Collapse call" : "Expand call"}`)
    .on_click(toggle)
    .child(div().flex_none().text_color(open ? t.foreground : t.muted).child(verb))
    .child(h_flex().flex_shrink_1().min_w(Math.min(SPACE[12] * 2, sumMax)).gap(SPACE[1]).items_center()
      .when(Boolean(detail), (el) => el.child(fitLabel(`tcd-${e.key}`, detail).font_family(monoFont()).text_color(open ? t.foreground : t.dim)))
      .child(foldMarker(t, open)))
    // The summary sits by its call (review 3); the right end is for counts and status only.
    .when(Boolean(summary), (el) => el.child(fitLabel(`tcs-${e.key}`, `· ${summary}`).flex_shrink_1().min_w(0).max_w(sumMax).text_size(TYPE.xs).text_color(t.dim)))
    .child(div().flex_1().min_w(0))
    .when(Boolean(e.changes?.length), (el) => el.child(diffCounts(t, totals(e.changes), `tcn-${e.key}`)))
    .children([status(t, e)].filter(Boolean));
}

const shortPath = (p) => { const parts = String(p).split("/").filter(Boolean); return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : String(p); };

// ---- the open call ----

const SMALL = `${SPACE[3] + SPACE.half}px`; // 14 px leading for labels
const label = (t, text) => div().text_size(TYPE.xs).line_height(SMALL).text_color(t.muted).child(text);
const quiet = (t, text, id) => div().id(id).min_h(ROW.compact).flex().items_center().text_size(TYPE.xs).line_height(`${SPACE[3] + SPACE.half}px`).text_color(t.muted).child(text);

// A highlighted snippet: its editor in a box as tall as its lines (2 to SNIPPET_MAX), or plain text when no editor
// could be made. `ed` is undefined until a handler made it (an open call coming back into view): two lines say so.
export function snippet(t, id, text, ed, { one = false } = {}) {
  // A one-line value is a 28 px editor (review 1); anything else 2 to SNIPPET_MAX lines.
  const h = one && lineCount(text) === 1 ? ROW.base : Math.min(SNIPPET_MAX, Math.max(2, lineCount(text))) * LINE + SPACE[2];
  const frame = (child) => div().id(id).w_full().h(h).flex_none().rounded(RADIUS.lg).border(1).border_color(t.border).bg(t.surface).overflow_hidden().py(SPACE[1]).child(child);
  if (!ed) return frame(div().px(SPACE[3]).text_size(TYPE.sm).text_color(t.muted).child("Loading details…")).h(2 * LINE + SPACE[2]);
  if (ed.failed) return v_flex().w_full().gap(SPACE[1]).child(plain(t, `${id}-p`, text, true)).child(quiet(t, "Code highlighting unavailable.", `${id}-q`));
  return frame(Editor.new(ed.state).size_full()).when(h === ROW.base, (el) => el.py(0));
}

// Plain text exactly as recorded: selectable, in a box that scrolls past SNIPPET_MAX lines. Mono for results and
// multi-line values.
function plain(t, id, text, mono) {
  const many = lineCount(text) > 1;
  return div().id(id).w_full().when(many, (el) => el.max_h(SNIPPET_MAX * LINE).overflow_y_scrollbar().rounded(RADIUS.lg).border(1).border_color(t.border).bg(t.surface).px(SPACE[3]).py(SPACE[1]))
    .text_size(TYPE.sm).line_height(`${LINE}px`).text_color(t.foreground).when(mono, (el) => el.font_family(monoFont()))
    .child(TextView.markdown(`${id}-t`, many ? literal(text) : escaped(text)).selectable(true).on_link_click(() => {}));
}

const limitNote = (t, id, text, max) => (String(text).length >= max
  ? quiet(t, `Chat limit: ${max.toLocaleString("en-US")} characters. Use Terminal for the original session.`, id) : null);

// An argument (review 1): a value of one line sits on its key's row (the key at most 96 wide, the value wrapping;
// a path in mono, review 7); a value of several lines is its key and then its snippet.
const PATH_KEYS = new Set(["file_path", "path", "filePath", "notebook_path", "cwd"]);
function argView(t, e, a, i, ed) {
  const id = `ta-${e.key}-${i}`;
  const known = KEY_WORDS[a.key];
  const key = div().text_size(TYPE.xs).text_color(t.muted).when(!known, (el) => el.font_family(monoFont())).child(known ?? a.key);
  const note = [limitNote(t, `${id}-l`, a.text, ARG_LIMIT)].filter(Boolean);
  if (lineCount(a.text) > 1) return v_flex().id(id).w_full().gap(SPACE[1]).child(key.line_height(SMALL)).child(snippet(t, `${id}-s`, a.text, ed)).children(note);
  return v_flex().id(id).w_full().gap(SPACE[1])
    .child(h_flex().w_full().min_h(ROW.compact).gap(SPACE[2]).items_center()
      .child(key.flex_none().max_w(SPACE[12] * 2).truncate())
      .child(div().flex_1().min_w(0).child(boxed(a) ? snippet(t, `${id}-s`, a.text, ed, { one: true }) : plain(t, `${id}-v`, a.text, PATH_KEYS.has(a.key)))))
    .children(note);
}

const EMPTY_RESULT = { pending: "Waiting for result…", ok: "No text result.", error: "No error details recorded.", rejected: "No rejection details recorded." };

function resultView(t, e, ed) {
  const out = String(e.output ?? "");
  const id = `tr-${e.key}`;
  const body = !out.trim() ? quiet(t, EMPTY_RESULT[e.status] ?? EMPTY_RESULT.ok, `${id}-e`)
    : snippet(t, `${id}-s`, out, ed);
  return v_flex().w_full().gap(SPACE[1]).child(label(t, "Result")).child(body).children([limitNote(t, `${id}-l`, out, RESULT_LIMIT)].filter(Boolean));
}

// One changed file: its path and counts, then its unified rows in a frame that scrolls sideways (no line is cut by
// the view), the first CODE.clamp rows until "… +N lines" opens the rest, and what the chat did not keep.
const codeLine = (t, r, id) => h_flex().id(id).h(LINE).flex_none().px(SPACE[3]).gap(SPACE[2]).items_center()
  .when(r.kind === "+", (el) => el.bg(tint(t.ansi2))).when(r.kind === "-", (el) => el.bg(tint(t.ansi1)))
  .child(div().w(SPACE[2]).flex_none().text_color(r.kind === "+" ? t.ansi2 : r.kind === "-" ? t.ansi1 : t.dim).child(r.kind === "@" ? "" : r.kind.trim()))
  .child(div().flex_none().whitespace_nowrap().text_color(r.kind === "@" ? t.muted : t.foreground).child(r.text));

export function codeFile(t, key, f, k, unfolded) {
  const id = `${key}:${k}`;
  const open = unfolded.has(id);
  const { rows, hidden } = shownRows(f, open);
  const unfold = (_e, cx) => { unfolded.add(id); cx.notify(); };
  const notes = [
    f.dropped ? `${f.dropped} more lines are not kept in chat.` : null,
    f.truncated ? "The rest of this change is not kept in chat." : null,
    f.rows.some((r) => r.text.length > CODE.chars && r.text.endsWith("…")) ? "Long lines may be shortened in chat." : null,
  ].filter(Boolean);
  return v_flex().w_full().gap(SPACE[1])
    .child(h_flex().min_h(ROW.compact).gap(SPACE[2]).items_center().min_w(0)
      .child(div().flex_1().min_w(0).font_family(monoFont()).text_size(TYPE.xs).text_color(t.foreground).accessibility_label(f.path).child(f.path))
      .child(diffCounts(t, f, `cvf-n-${id}`)))
    .child(v_flex().id(`cvb-${id}`).w_full().rounded(RADIUS.lg).border(1).border_color(t.border).bg(t.surface).overflow_hidden().py(SPACE[1])
      .font_family(monoFont()).text_size(TYPE.sm)
      .child(v_flex().id(`cvx-${id}`).w_full().overflow_x_scrollbar().when(open, (el) => el.max_h(SNIPPET_MAX * LINE).overflow_y_scrollbar())
        .children(rows.map((r, i) => codeLine(t, r, `cl-${id}-${i}`))))
      .when(hidden > 0, (el) => el.child(focusRing(h_flex(), t, unfold).id(`cvm-${id}`).h(ROW.compact).px(SPACE[3]).items_center().rounded(RADIUS.sm)
        .text_size(TYPE.xs).text_color(t.dim).cursor_pointer().hover((st) => st.text_color(t.muted))
        .role("button").accessibility_label(`Show ${hidden} more lines`).on_click(unfold).child(`… +${hidden} lines`))))
    .when(notes.length > 0, (el) => el.child(quiet(t, `${notes.join(" ")} Use Terminal for the original session.`, `cvn-${id}`)));
}

// ---- rows ----

// A call: its header, and when open its detail box; `strip` is its media, which stays visible when it is closed.
// `ctx`: { open, toggle, close, unfolded, editors, scope, width, hit, viewport }; `hit`: a head's pressable height.
export function toolRow(t, e, ctx, strip) {
  const open = ctx.open.has(e.key);
  const toggle = (_ev, cx) => ctx.toggle(e, cx);
  const ed = (part) => ctx.editors.get(`${ctx.scope}|${e.key}|${part}`) ?? undefined;
  const ceiling = Math.max(ROW.base * 3, Math.min(DETAIL_MAX, Math.round(ctx.viewport * 0.6)));
  const args = e.args ?? [];
  // One 24 px line for the call's own name and "Arguments", then the arguments, the changes and the result 8 apart
  // (review 1: the result stays in view).
  const detail = !open ? null : v_flex().id(`tdx-${e.key}`).ml(SPACE[6]).mt(SPACE[1]).mb(SPACE[2]).p(SPACE[3]).gap(SPACE[2]).rounded(RADIUS.lg).border(1).border_color(t.border)
    .bg(t.surface).max_h(ceiling).overflow_y_scrollbar()
    .on_key_down((ev, cx) => { if (ev?.key === "escape") { cx.stop_propagation(); ctx.close(e, cx, true); } })
    .child(h_flex().h(ROW.compact).gap(SPACE[1]).items_center().text_size(TYPE.xs).text_color(t.muted)
      .child(div().font_family(monoFont()).child(e.name ?? "")).when(args.length > 0, (el) => el.child(div().child("· Arguments"))))
    .children(args.length ? args.map((a, i) => argView(t, e, a, i, boxed(a) ? ed(`a${i}`) : null))
      : [quiet(t, e.rich ? "No arguments recorded." : e.detail || "No arguments recorded.", `ta-${e.key}-none`)])
    .when(Boolean(e.changes?.length), (el) => el.child(v_flex().w_full().gap(SPACE[1]).child(label(t, "Changes"))
      .children(e.changes.map((f, k) => codeFile(t, e.key, f, k, ctx.unfolded)))
      .when(e.changes.length >= CODE.files, (c) => c.child(quiet(t, "Chat limit: 12 files. Use Terminal for the original session.", `cvl-${e.key}`)))))
    .child(resultView(t, e, ed("out")));
  return v_flex().w_full()
    .child(toolHeader(t, e, open, toggle, ctx.width, ctx.focusOf(e.key), ctx.hit))
    .children([detail].filter(Boolean))
    .children([strip].filter(Boolean));
}

// A thought: "Thought" and its first line; open, its words, escaped, in a box that scrolls past twelve lines.
export function thinkingRow(t, e, ctx) {
  const open = ctx.open.has(e.key);
  const toggle = (_ev, cx) => ctx.toggle(e, cx);
  return v_flex().w_full()
    .child(focusRing(h_flex(), t, toggle).id(`th-${e.key}`).when(Boolean(ctx.focusOf(e.key)), (el) => el.track_focus(ctx.focusOf(e.key))).w_full().h(ctx.hit ?? ROW.compact).px(SPACE[1]).gap(SPACE[2]).items_center().rounded(RADIUS.md).text_size(TYPE.sm)
      .cursor_pointer().hover((st) => st.bg(t.hover)).tooltip(open ? "Collapse call" : "Expand call")
      .role("button").accessibility_label(`Thought: ${String(e.text).split("\n")[0]}. ${open ? "Collapse" : "Expand"}`).on_click(toggle)
      .child(div().flex_none().text_color(open ? t.foreground : t.muted).child("Thought"))
      .child(h_flex().flex_shrink_1().min_w(0).gap(SPACE[1]).items_center()
        .child(fitLabel(`thd-${e.key}`, String(e.text).split("\n").find((l) => l.trim()) ?? "").text_color(t.muted))
        .child(foldMarker(t, open))))
    .when(open, (el) => el.child(div().id(`thx-${e.key}`).ml(SPACE[6]).mt(SPACE[1]).mb(SPACE[2]).px(SPACE[3]).py(SPACE[2]).rounded(RADIUS.lg).bg(t.surface)
      .border(1).border_color(t.border).max_h(12 * LINE).overflow_y_scrollbar().text_size(TYPE.sm).line_height(`${LINE}px`).text_color(t.muted)
      .on_key_down((ev, cx) => { if (ev?.key === "escape") { cx.stop_propagation(); ctx.close(e, cx, true); } })
      .child(TextView.markdown(`thm-${e.key}`, escaped(e.text)).selectable(true).on_link_click(() => {}))));
}
