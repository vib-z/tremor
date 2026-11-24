// The "/" commands popup for one pane (owner request 30): the agent's own list (lib/slash-commands.js), filtered as
// you type; ↑↓ move, Enter types the command and a space into that pane's terminal without Enter (`hc keys`, the
// pane and process it opened for only, at the agent's prompt only), Esc closes. Focus goes back to the terminal.
// Opened bare (`mod.open:pdk-slash`, bindable), it serves the focused pane; the pane header's "/" button is gone
// (owner, 11 Nov: the chat's composer opens the same list on "/").
// The pattern of the search palette (mods/pdk-search): its own field, keys on the root, the same commands.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { panes, terminals, focused, theme, run, hc, props, closeOverlay, nextCommand } from "herdr";
import { helper } from "./lib/helper.js";
import { agentKind, kindName } from "./lib/agents.js";
import { TYPE, SPACE, ROW, RADIUS, withFont, monoFont, slashList, fieldFrame } from "./lib/ui.js";
import { commandsFor, sourceLine, openMenu, setQuery, menuKey, visibleRows, terminalInsert, terminalKeys, UNTYPEABLE, SAFETY_WORDS } from "./lib/slash-commands.js";

const rawStatus = (t) => (typeof t?.status === "string" ? t.status : t?.status?.state ?? null);

export default class Slash extends View {
  init(_props, cx) {
    const p = props() ?? {};
    const pane = p.pane ?? panes().find((x) => x.terminal === focused()?.terminal)?.pane ?? null;
    const term = terminals().find((x) => x.address === (p.terminal ?? panes().find((x) => x.pane === pane)?.terminal));
    this.target = term ? { pane, terminal: term.address, pid: p.pid ?? term.foreground?.pid ?? null, kind: agentKind(term) } : null;
    this.menu = openMenu(this.target ? commandsFor(this.target.kind) : []);
    this.note = null;
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Filter commands" });
    this.input.on("change", (_e, cx) => { this.menu = setQuery(this.menu, this.input.value().replace(/^\//, "")); this.note = null; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.pick(cx));
    this.inputFocused = false; // the field's accent border shows only while it has the keyboard (as the palette's)
    this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.inputFocused = false; cx.notify(); });
    this.input.focus();
    cx.timer.after(600, () => this.input.focus()); // the popup takes the keyboard as it opens (as the palette does)
    if (this.target) {
      cx.spawn(async (cx) => {
        const r = await helper("names", [this.target.kind, term.cwd || "-"]).catch(() => null);
        this.menu = setQuery(openMenu(commandsFor(this.target.kind, r?.names ?? [])), this.menu.query);
        cx.notify();
      });
    }
    // While open: "pdk-slash.query:<text>" filters, ".up" / ".down" move, ".pick" is Enter (how the sandbox drives it).
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c.startsWith("query:")) { this.input.set_value(c.slice(6)); this.menu = setQuery(this.menu, c.slice(6)); }
        else if (c === "up" || c === "down") this.menu = menuKey(this.menu, c).m;
        else if (c === "pick") this.pick(cx);
        cx.notify();
      }
    });
  }

  close() {
    closeOverlay(props().overlay);
  }

  // Types the highlighted command into the pane's own terminal, if it is still that pane's, at its prompt.
  pick(cx, i = this.menu.i) {
    const entry = this.menu.shown[i];
    if (!entry || !this.target) return;
    const t = terminals().find((x) => x.address === this.target.terminal);
    const shows = panes().find((x) => x.pane === this.target.pane)?.terminal;
    const now = t && shows === t.address ? { terminal: t.address, pid: t.foreground?.pid ?? null, kind: agentKind(t), status: rawStatus(t) } : null;
    const go = terminalInsert(entry, this.target, now);
    if (!go.args) { this.note = go.why; cx.notify(); return; }
    cx.spawn(async (cx) => {
      const r = await hc(go.args).catch((e) => ({ code: 1, stderr: String(e?.message ?? e) }));
      if (r?.code !== 0) { this.note = `Not typed: ${String(r?.stderr || r?.stdout || "hc keys failed").slice(0, 160)}`; cx.notify(); return; }
      this.close();
      run("pane.focus", { pane: this.target.pane });
    });
  }

  render() {
    const t = theme();
    const m = this.menu;
    const kind = this.target?.kind;
    return withFont(v_flex()).id("pdk-slash").track_focus(this.handle).w_full().bg(t.popover)
      .role("dialog").accessibility_label(kind ? `${kindName(kind)} commands` : "Commands")
      .on_key_down((e, cx) => {
        const key = { up: "up", down: "down", tab: "tab", escape: "escape" }[e.key];
        if (!key) return;
        cx.stop_propagation();
        const { m: next, action } = menuKey(this.menu, key);
        this.menu = next;
        if (action === "close") return this.close();
        if (action === "insert") return this.pick(cx);
        cx.notify();
      })
      // The palette's inset search field (design-final-look F6): shared fieldFrame, 36 px, 8 px corners, surface ground.
      .child(div().flex_none().p(SPACE[2]).child(fieldFrame(h_flex().h(ROW.base + SPACE[2]).px(SPACE[3]).gap(SPACE[2]).items_center().rounded(RADIUS.lg), t, { focused: this.inputFocused })
        .child(div().flex_none().text_size(TYPE.sm).font_family(monoFont()).text_color(t.dim).child("/"))
        .child(Input.new(this.input).flex_1().h_full().bg(t.surface).border_0().text_size(TYPE.base).text_color(t.foreground).accessibility_label("Filter commands"))))
      .child(this.target
        ? slashList(t, m, visibleRows(m), { id: "pslash", source: sourceLine(kind), words: SAFETY_WORDS, note: this.note,
          blocked: (c) => (terminalKeys(c) ? null : UNTYPEABLE),
          onPick: (i, _e, cx) => { this.menu = { ...this.menu, i }; this.pick(cx, i); } })
        : div().h(ROW.base).px(SPACE[3]).flex().items_center().text_size(TYPE.sm).text_color(t.dim).child("No agent pane is focused"));
  }
}
