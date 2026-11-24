// tremor settings (owner, 11 Nov): one short page, opened from Cmd+K's "tremor settings", with two rows only: the pane
// hover style (pdk.pane.hover) and, per machine, the folder "+" starts a new workspace in (pdk.new.default; the rule is
// folderChoices in adapters/workspace.js). Herdr's own Settings cannot hold a mod's option, so these live here.
// Every field saves as it is committed: Enter, leaving the field, Choose…, Clear, or a click on a choice. A refused path
// shows its reason under the field and writes nothing. Done closes the page, as Escape does: it commits the field's
// typed text as leaving it would, waits for a check in flight, then closes; a path that commit refused keeps the page
// open with its reason, and a second Done or Escape closes it (nothing written).
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { settings, theme, props, closeOverlay, shared, setShared, exec, pickFolder, spaces, machines, home, nextCommand } from "herdr";
import { TYPE, SPACE, ROW, RADIUS, button, segmentedChoice, overlayFrame, overlayHeader, fieldFrame } from "./lib/ui.js";
import { machineList } from "./lib/status.js";
import { NEW_KEYS } from "./lib/workspace.js";

export const HOVER = "pdk.pane.hover";
export const HOVERS = [{ value: "clean", label: "Clean" }, { value: "normal", label: "Normal" }];

// A folder typed for machine `on` ("" this computer): a leading ~ is that machine's home, then it must be a full path,
// not "/" unless that home is root's, and a folder there. { folder } or { error }: one short line.
export async function checkFolder(text, on) {
  const at = on || null;
  let homeUnavailable = false;
  const homeOf = at ? await exec("printenv", ["HOME"], { on: at }).then((r) => (r.code === 0 ? r.stdout.trim() : null), () => { homeUnavailable = true; return null; }) : home();
  let f = String(text ?? "").trim();
  if (f === "~" || f.startsWith("~/")) {
    if (homeUnavailable) return { error: "Machine unavailable" };
    if (!homeOf) return { error: "No such folder" };
    f = homeOf + f.slice(1);
  }
  if (!f.startsWith("/")) return { error: "Needs a full path" };
  f = f.replace(/\/+$/, "") || "/";
  if (f === "/" && homeOf !== "/root" && homeOf !== "/var/root") return { error: "Not the root folder" };
  const there = await exec("test", ["-d", f], { on: at }).then((r) => r.code === 0, () => null);
  if (at && there === null) return { error: "Machine unavailable" };
  return there ? { folder: f } : { error: "No such folder" };
}

// Escape is bound under the page, not caught: the host's own escape → overlay.close sits in the shallower `Overlay`
// context (host keys.rs install), and the kit field passes Escape on, so this binding takes it first.
const DONE = "pdk_settings_done";
let bound = false; // once per module load: the keymap is the app's

export default class Settings extends View {
  init(_props, cx) {
    this.origin = { ...props() };
    this.handle = cx.focus_handle();
    this.acted = false; this.warned = false;
    if (!bound) try { bound = cx.bind_keys([{ keystroke: "escape", action: DONE, context: "PdkSettings" }]) > 0; } catch {}
    // This computer first, then each added machine as the selector lists them (temporary ones are left out there).
    this.machines = machineList({ spaces: spaces(), machines: machines(), listed: shared("pdk.machines.list") ?? [] });
    this.rows = Object.fromEntries(this.machines.map((m) => {
      const baseline = this.defaults()[m.id] ?? "";
      const row = { baseline, input: InputState.new({ value: baseline, placeholder: "Automatic" }), focused: false, error: "", busy: false, gen: 0, pending: null };
      const commit = (_e, cx) => { cx.spawn(async (cx) => { await this.save(m.id, row.input.value(), cx); }); };
      row.input.on("submit", (e, cx) => { this.acted = true; commit(e, cx); });
      row.input.on("change", (_e, cx) => { this.acted = true; this.warned = false; row.error = ""; cx.notify(); });
      row.input.on("focus", (_e, cx) => { row.focused = true; cx.notify(); });
      // Leaving the field commits it, as Enter does.
      row.input.on("blur", (e, cx) => { row.focused = false; cx.notify(); commit(e, cx); });
      return [m.id, row];
    }));
    // First focus: This computer's field. The dialog takes the keyboard as it opens, a frame or more after this, so
    // ask again on each frame it lacks focus, for at most 600 ms, never once the person has acted (as Cmd+K does).
    const first = this.rows[""];
    if (first) {
      first.input.focus();
      const opened = Date.now();
      const early = cx.timer?.every(16, () => {
        if (this.acted || first.focused || Date.now() - opened > 600) early?.cancel();
        else first.input.focus();
      });
    }
    // How the sandbox drives it without a pointer: "folder:<machine>=<path>" types and saves, "choose", "clear:<machine>",
    // "hover:<clean|normal>", "done" (machine "" is this computer).
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c.startsWith("folder:")) { const [m, ...p] = c.slice(7).split("="); this.rows[m]?.input.set_value(p.join("=")); await this.save(m, p.join("="), cx); }
        else if (c === "choose") await this.choose(cx);
        else if (c === "done") await this.done(cx);
        else if (c.startsWith("clear:")) this.clear(c.slice(6));
        else if (c.startsWith("hover:")) setShared(HOVER, c.slice(6));
        cx.notify();
      }
    });
  }
  close() { closeOverlay(this.origin.overlay); }
  defaults() { return shared(NEW_KEYS.default) ?? {}; }

  async save(machine, text, cx) {
    const row = this.rows[machine];
    if (!row || row.busy) return row?.pending;
    const trimmed = String(text ?? "").trim();
    if (trimmed === row.baseline) { row.error = ""; return; }
    if (!trimmed) { this.clear(machine); cx.notify(); return; }
    // A Clear (or a newer save) while this check runs makes its result stale (review RC07).
    const gen = ++row.gen;
    row.busy = true; cx.notify();
    const work = (async () => {
      const r = await checkFolder(text, machine);
      if (gen !== row.gen) return;
      row.busy = false;
      row.error = r.error ?? "";
      if (r.folder) { setShared(NEW_KEYS.default, { ...this.defaults(), [machine]: r.folder }); row.baseline = r.folder; row.input.set_value(r.folder); }
      cx.notify();
    })();
    row.pending = work;
    try { await work; } finally { if (row.pending === work) row.pending = null; }
  }

  // Commit every changed field and wait for any check already in flight. True when every row is clear of an error.
  async flush(cx) {
    const waits = [];
    for (const [machine, row] of Object.entries(this.rows)) {
      const text = String(row.input.value() ?? "").trim();
      if (!row.busy) waits.push(this.save(machine, text, cx));
      else if (row.pending) waits.push(row.pending);
    }
    await Promise.all(waits);
    // A check that started or was replaced (a pick) during that wait is waited for too.
    for (;;) {
      const running = Object.values(this.rows).filter((row) => row.busy && row.pending).map((row) => row.pending);
      if (!running.length) break;
      await Promise.all(running);
    }
    return Object.values(this.rows).every((row) => !row.error);
  }

  // Done and Escape: commit, wait, close. A refusal keeps the page open once to show why; the next press closes.
  async done(cx) {
    this.acted = true;
    if (await this.flush(cx) || this.warned) { this.close(); return; }
    this.warned = true; cx.notify();
  }

  // This computer only: the native folder picker; a cancel changes nothing.
  async choose(cx) {
    const f = await pickFolder({ prompt: "Choose" });
    if (f) {
      const row = this.rows[""];
      if (row.busy) { row.gen++; row.busy = false; }
      row.input.set_value(f); cx.notify();
      await this.save("", f, cx);
    }
  }
  clear(machine) {
    const { [machine]: _gone, ...rest } = this.defaults();
    setShared(NEW_KEYS.default, rest);
    const row = this.rows[machine];
    if (row) { row.gen++; row.busy = false; row.error = ""; row.baseline = ""; row.input.set_value(""); }
  }

  render() {
    const t = theme();
    const set = this.defaults();
    const hover = shared(HOVER) === "normal" ? "normal" : "clean";
    const label = (id, words, hint) => v_flex().id(id).gap(SPACE.half)
      .child(div().text_size(TYPE.base).font_medium().text_color(t.foreground).child(words))
      .child(div().text_size(TYPE.sm).text_color(t.dim).child(hint));
    // Each machine: its name on one line, then [field] [Choose…] [Clear]; Tab follows that order, then Done.
    const machine = (m) => {
      const row = this.rows[m.id], folder = set[m.id];
      return v_flex().id(`set-folder-${m.id || "local"}`).gap(SPACE[1])
        .child(div().id(`set-name-${m.id || "local"}`).text_size(TYPE.sm).font_medium().text_color(t.foreground).child(m.label))
        .child(h_flex().gap(SPACE[2]).items_center()
          .child(fieldFrame(Input.new(row.input), t, { focused: row.focused, disabled: row.busy }).disabled(row.busy)
            .flex_1().min_w(0).h(ROW.base).px(SPACE[2]).items_center().rounded(RADIUS.md).text_size(TYPE.base)
            .accessibility_label(`Default folder on ${m.label}`))
          .when(!m.id, (el) => el.child(button(t, "set-choose", { text: "Choose…", variant: "outline", size: "xs", onPress: (_e, cx) => { this.acted = true; cx.spawn(async (cx) => { await this.choose(cx); }); } })))
          .child(button(t, `set-clear-${m.id || "local"}`, { text: "Clear", variant: "ghost-muted", size: "xs", disabled: !folder, onPress: (_e, cx) => { this.acted = true; this.clear(m.id); cx.notify(); } })))
        .when(Boolean(row.error), (el) => el.child(div().text_size(TYPE.sm).text_color(t.blocked).child(row.error)));
    };
    // No height in mod.json: the host fits the dialog to this content, up to 85% of the window (host window.rs). The
    // body keeps its content height (a shrinkable body collapses to nothing in a fitted dialog) and scrolls past that
    // 85%, less the header and the foot. Plain overflow_y_scroll: overflow_y_scrollbar's bar adds height the fitted
    // dialog does not leave room for, and Done was cut off (sandbox frames, 12 Nov). ponytail: the limit is read from the window at render; a resize redraws.
    const vh = globalThis.window?.viewport_size?.()?.height;
    const room = vh ? Math.max(ROW.two, Math.floor(vh / (settings()?.zoom || 1) * 0.85) - ROW.two - (ROW.two + SPACE[2]) - 2) : null;
    return overlayFrame(t, "pdk-settings", { hostFrame: true }).w_full().text_color(t.foreground).track_focus(this.handle)
      .key_context("PdkSettings").on_action(DONE, (_e, cx) => { cx.spawn(async (cx) => { await this.done(cx); }); })
      .on_mouse_down("left", () => { this.acted = true; })
      .child(overlayHeader(t, "settings-head", "tremor settings"))
      .child(v_flex().id("settings-body").flex_none().when(room != null, (el) => el.max_h(room)).overflow_y_scroll().px(SPACE[4]).py(SPACE[3]).gap(SPACE[4])
        .child(h_flex().id("settings-hover").gap(SPACE[3]).items_center()
          .child(label("settings-hover-label", "Pane hover", "How a pane looks under the pointer").flex_1().min_w(0))
          .child(segmentedChoice(t, "settings-hover-choice", HOVERS, hover, (v, _e, cx) => { this.acted = true; setShared(HOVER, v); cx.notify(); }, { label: "Pane hover", owner: this })))
        .child(v_flex().id("settings-folder").gap(SPACE[2])
          .child(label("settings-folder-label", "Default folder", "Empty: the folder you're in, else the last one used, else home"))
          .children(this.machines.map(machine))))
      .child(h_flex().h(ROW.two + SPACE[2]).flex_none().px(SPACE[4]).gap(SPACE[2]).items_center().border_t(1).border_color(t.border)
        .child(div().flex_1())
        .child(button(t, "settings-done", { text: "Done", variant: "primary", onPress: (_e, cx) => { cx.spawn(async (cx) => { await this.done(cx); }); } })));
  }
}
