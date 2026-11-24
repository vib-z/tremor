// Herdr's own Add a machine dialog: stock.js is Herdr App 0.1.15's mods/machine-add/main.js byte for byte (Apache-2.0,
// see NOTICE.md; test/machine-add.test.js pins its sha256). Only two things change here (owner, 11 Nov):
// - an add that needs an answer (a host key, a password, installing herdr-core there) runs `hc machine add <host>` in
//   a Herdr terminal shown over the dialog, where the person answers; nothing they type passes through this mod;
// - a machine added ends on its machine tab (pdk-tree.machine:<name>, which also refreshes the tabs); after the
//   terminal, the dialog closes too.
// Opened with `mod.open pdk-machine-add` (the sidebar's Add machine). props.part "bar": the terminal view's top strip.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { hc, exec, run, props, theme, shared, setShared, openOverlay, closeOverlay, nextCommand } from "herdr";
import { TYPE, SPACE, button } from "./lib/ui.js";
import MachineAdd from "./stock.js";

// The terminal view: a Herdr layout overlay, the strip with the host and Cancel above the terminal itself. It closes
// by itself when the terminal ends. Esc goes to the terminal; Ctrl+C there (the keyboard's way out) or Cancel ends it.
export const answerView = (target, terminal) => ({
  kind: "dialog", modal: true, width: 720, height: 460,
  layout: { id: "ma-answer", type: "column", background: "popover", children: [
    { id: "ma-answer-bar", type: "block", size: { px: 52 }, content: { mod: "pdk-machine-add", props: { part: "bar", target, terminal } } },
    { id: "ma-answer-terminal", type: "block", padding: [0, 12], content: { terminal } },
  ] },
});

// How this attempt's terminal ended (`hc get --json`). Cancel (terminal.kill: reason "killed") or Ctrl+C (SIGINT:
// signal 2; exit 130 when the program catches it) is a cancel. Success is its own: finished, exit code 0.
export const cancelled = (end) => end?.reason === "killed" || end?.signal != null || end?.exit_code === 130;
export const succeeded = (end) => end?.state === "finished" && end.reason === "exited" && end.exit_code === 0;

// The terminal's name, chosen before `hc run` is sent, so a close can end it before the reply arrives.
const terminalName = () => `pdk-add-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// `hc run` is sent through exec with this time limit, so a terminal it creates can only appear within it.
export const LAUNCH_MS = 20000;
// Cleanup that outlives the dialog (close() has 250 ms; an exec already started keeps running): the terminal named
// $1 is killed while live and removed once finished. Not seen yet, it is waited for $2 polls of 0.25 s: until its
// launch's limit has passed (`until`), since its `hc run` may still be on its way. Once seen, removed or gone ends it;
// 20 s more at most. Its own exec limit is past both. (hc writes its errors, not_found among them, to stderr.)
export const CLEANUP = `t=$1; wait=$2; seen=; i=0
while [ "$i" -lt $((wait + 80)) ]; do
  s=$(hc get "$t" --json 2>&1)
  case $s in
    *'"state":"live"'*) seen=1; hc kill "$t" >/dev/null 2>&1 ;;
    *'"state":"finished"'*) seen=1; hc rm "$t" >/dev/null 2>&1 && exit 0 ;;
    *not_found*) [ -n "$seen" ] && exit 0; [ "$i" -ge "$wait" ] && exit 1 ;;
  esac
  i=$((i+1)); sleep 0.25
done
exit 1`;
// How long a cleanup may run: the unseen wait (the launch's limit plus 5 s) and 20 s more, with room to spare.
export const CLEANUP_MS = LAUNCH_MS + 5000 + 20000 + 15000;

// Terminals a closed dialog still owes a cleanup ({ name, until }: when its launch can no longer create it), kept in
// shared state so they outlive it: a sweep that fails gets one more kill and rm through hc, and one that still fails
// stays listed; the next dialog sweeps it again.
export const OWED = "pdk.machine.add.owed";
const owed = () => (shared(OWED) ?? []).filter((o) => typeof o?.name === "string" && typeof o.until === "number");
export function sweep(name, until, again = true) {
  setShared(OWED, [...owed().filter((o) => o.name !== name), { name, until }]);
  const wait = Math.max(1, Math.ceil((until - Date.now()) / 250));
  return exec("sh", ["-c", CLEANUP, "sh", name, String(wait)], { timeout: CLEANUP_MS })
    .then((r) => r?.code === 0, () => false)
    .then(async (done) => {
      if (!done) {
        await hc(["kill", name]).catch(() => null);
        const r = await hc(["rm", name]).catch(() => null);
        // Removed now, or not there once its launch can no longer create it; not there before then proves nothing.
        done = r?.code === 0 || (/not_found/.test(`${r?.stdout ?? ""}${r?.stderr ?? ""}`) && Date.now() >= until);
      }
      if (done) setShared(OWED, owed().filter((o) => o.name !== name));
      else if (again && Date.now() < until) {
        // Once more after its launch's limit, while this code still runs; else it stays owed for the next dialog.
        const waited = await exec("sleep", [String(Math.ceil((until - Date.now()) / 1000))], { timeout: until - Date.now() + 5000 })
          .then((r) => r?.code === 0, () => false);
        if (waited) return sweep(name, until, false);
      }
      return done;
    });
}

export default class TremorMachineAdd extends MachineAdd {
  init(p, cx) {
    if (props()?.part === "bar") return;
    this.failed = new Set();
    // Each add that needs an answer, from before its terminal is asked for until that terminal is removed.
    this.attempts = new Set();
    this.closed = false;
    for (const o of owed()) sweep(o.name, o.until);
    super.init(p, cx);
    // While it is open, bindable in keys.json and how the sandbox drives it without a pointer:
    // "pdk-machine-add.add:<host>" is a click on that host's Add (or Retry).
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c.startsWith("add:")) this.add(c.slice(4), cx);
      }
    });
  }

  async hcJson(args) {
    const r = await hc(args).catch(() => null);
    try { return JSON.parse(r.stdout || r.stderr); } catch { return null; }
  }

  machineOf(target) {
    return this.added.find((m) => m.target === target || m.name === target || m.host === target);
  }

  // A machine just added: its tab chosen (the tree's command sets pdk.machine.filter and reads `hc machine ls`).
  choose(target) {
    const m = this.machineOf(target);
    if (m) run(`pdk-tree.machine:${m.name}`);
  }

  // Stock add(), with the needs-an-answer branch sent to the terminal and the success branch choosing the tab.
  add(target, cx) {
    target = target.trim();
    if (!target || this.closed || this.state[target] === "adding") return;
    this.pending.delete(target);
    this.failed.delete(target);
    this.state[target] = "adding";
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await hc(["machine", "add", target, "--json"]).catch((e) => ({ code: 1, stderr: String(e), stdout: "" }));
      if (this.closed) return;
      let why = null;
      try {
        why = r.code === 0 ? null : (JSON.parse(r.stdout || r.stderr).error ?? { message: (r.stderr || r.stdout).trim() });
      } catch {
        why = { message: (r.stderr || r.stdout || "it didn't answer").trim() };
      }
      if (!why) {
        delete this.state[target];
        this.input.set_value("");
        this.typed = "";
        await this.refresh();
        await this.checkMac(target);
        if (this.closed) return;
        this.choose(target);
      } else if (["hc_missing", "incompatible", "login_needed", "auth_failed", "host_key"].includes(why.kind) || /password|passphrase|host key|permission denied|login/i.test(why.message ?? "")) {
        return this.answer(target, cx);
      } else this.state[target] = why.message || "it didn't work";
      await this.refresh();
      if (this.closed) return;
      cx.notify();
    });
  }

  // The add in a Herdr terminal (hc run, sent through exec with LAUNCH_MS: a real core terminal, no pane), shown over
  // the dialog until it ends. Done (exit 0 and the machine there): the dialog closes on its tab. Else one line and
  // Retry. A cancel removes no machine: hc lists one only once its add has finished.
  async answer(target, cx) {
    const a = { target, name: terminalName(), sent: false, overlay: null };
    this.attempts.add(a);
    const before = await this.hcJson(["machine", "ls", "--json"]);
    if (this.closed) return; // nothing was started
    a.pre = new Set((before?.machines ?? []).map((m) => m.id));
    a.sent = true;
    a.until = Date.now() + LAUNCH_MS + 5000;
    const r = await exec("hc", ["run", "--bg", "--json", "--name", a.name, "--", "hc", "machine", "add", target], { timeout: LAUNCH_MS }).catch(() => null);
    let started = null;
    try { started = JSON.parse(r.stdout); } catch {}
    if (this.closed) return; // close() swept it by name; no view opens after close
    if (!started?.address) return this.finish(a, { state: "unknown" }, cx);
    a.overlay = openOverlay(answerView(target, started.address));
    // Watch it: live, finished, or gone. An unreadable answer is unknown, not an end; after 30 s of those, give up.
    let end = null, unknown = 0;
    while (!end) {
      await cx.sleep(500);
      if (this.closed) return;
      const g = await this.hcJson(["get", a.name, "--json"]);
      if (this.closed) return;
      if (g?.state === "live") unknown = 0;
      else if (g?.state === "finished") end = g;
      else if (g?.error?.kind === "not_found") end = { state: "gone" };
      else if (++unknown >= 60) end = { state: "unknown" };
    }
    return this.finish(a, end, cx);
  }

  async finish(a, end, cx) {
    if (a.overlay) closeOverlay(a.overlay);
    const clean = await this.dispose(a, cx);
    if (this.closed) return;
    if (clean) this.attempts.delete(a); // else the dialog going sweeps it
    await this.refresh();
    if (this.closed) return;
    const m = succeeded(end) && (this.added.find((x) => x.target === a.target && !a.pre.has(x.id)) ?? this.machineOf(a.target));
    if (m) {
      delete this.state[a.target];
      run(`pdk-tree.machine:${m.name}`);
      return this.close();
    }
    this.fail(a.target, cancelled(end) ? "Cancelled." : `Couldn't add ${a.target}.`, cx);
  }

  // The terminal ended and removed, each answer checked: killed while live, removed once finished.
  async dispose(a, cx) {
    for (let i = 0; i < 8; i++) {
      const g = await this.hcJson(["get", a.name, "--json"]);
      if (g?.error?.kind === "not_found") return true;
      if (g?.state === "live") await hc(["kill", a.name]).catch(() => null);
      else if (g?.state === "finished" && (await hc(["rm", a.name]).catch(() => null))?.code === 0) return true;
      await cx.sleep(250);
    }
    return false;
  }

  fail(target, line, cx) {
    this.state[target] = line;
    this.failed.add(target);
    cx.notify();
  }

  // Esc, the Esc chip, or the dialog going: every terminal it asked for is swept (owed in shared state until removed),
  // outside this view; nothing is awaited here, so the 250 ms budget is never in the way.
  async close() {
    this.closed = true;
    for (const a of this.attempts ?? []) {
      if (a.overlay) closeOverlay(a.overlay);
      if (a.sent) sweep(a.name, a.until);
    }
    this.attempts?.clear();
    super.close();
  }

  // After the terminal: the line and Retry, where stock had its sentence and Copy. Retry is the shared small outline
  // button, the edge the dialog's own Add buttons have.
  message(t, target) {
    if (!this.failed.has(target)) return super.message(t, target);
    return v_flex().gap(SPACE[1])
      .child(div().text_size(TYPE.sm).text_color(t.blocked).child(this.state[target]))
      .child(h_flex().child(button(t, `ma-retry-${target}`, { text: "Retry", onPress: (_e, cx) => this.add(target, cx), variant: "outline", size: "xs" })));
  }

  render() {
    if (props()?.part !== "bar") return super.render();
    const t = theme();
    const { target, terminal } = props();
    // Like the dialog's header: the host as its title, Cancel quiet at the right (the shared small ghost-muted button);
    // its sides line up with the terminal box below (12).
    return h_flex().id("ma-bar").size_full().px(SPACE[3]).items_center().bg(t.popover).text_color(t.foreground)
      .child(div().flex_1().min_w(0).truncate().text_size(TYPE.lg).font_semibold().child(target))
      .child(button(t, "ma-cancel", { text: "Cancel", onPress: () => run("terminal.kill", { terminal }), variant: "ghost-muted", size: "xs" }));
  }
}
