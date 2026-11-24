// The foot of the sidebar (owner, 10 Nov 2026, design option A; spec section 4; the visual contract's values): per
// machine a small label, then per installed agent its mark (no name), "49% · resets 1d 11h" and a bar the foot's
// width; "-" when it can't be read (Claude: "Sign in" or "Can't read"), "stale" on a value kept from before. Every number is one the helper
// (helper/pdk-usage.py) read on that machine. The machine filter (shared pdk.machine.filter, the header writes it)
// picks which machines show. The gear opens Herdr's own Settings (spec section 5): tremor has no setting of its own.
//
// Bindable in keys.json: "pdk-usage.refresh" (read every machine again now).

import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, appHome, theme, shared, setShared, run, nextCommand, readTextFile, machines, settings } from "herdr";
import { TYPE, SPACE, ICON, ROW, withFont, agentMark, softInk, button, tooltip, shortcut, progressBar } from "./lib/ui.js";
import { machineList } from "./lib/status.js";
import { UsageReader, usageKeys, footLines, FILTER_KEY, filtered } from "./usage.js";

// The contract's foot: 12 all round, groups 12 apart; a 14 px label with 8 under it; each agent a 16 px line, the
// next one 8 below, its 4 px bar 5 under its words. The foot is at most 40% of the sidebar's height; more scrolls.
const LABEL = SPACE[3] + SPACE.half, LINE = SPACE[4], BAR = SPACE[1], CAP = 0.4;
const lineHeight = (l, i) => (i ? SPACE[2] : 0) + LINE + (l.fill == null ? 0 : SPACE.status + BAR);
const groupHeight = (g) => LABEL + SPACE[2] + g.lines.reduce((h, l, i) => h + lineHeight(l, i), 0);

// Another machine runs this same helper with its own python3, from the source read here: the guard is loaded first
// under the name the helper looks for, then the helper as a script, given its own text (SOURCE: a Mac's desktop-session
// read runs it again). Its scratch folder sits in that machine's home where this computer's sits in the app's.
const REMOTE = [
  "import sys, types",
  'g = types.ModuleType("pdk_codex_guard"); sys.modules["pdk_codex_guard"] = g',
  'exec(compile(sys.argv[1], "codex_guard.py", "exec"), g.__dict__)',
  'src = sys.argv[2]; sys.argv = ["pdk-usage.py"] + sys.argv[3:]',
  'exec(compile(src, "pdk-usage.py", "exec"), {"__name__": "__main__", "SOURCE": src})',
].join("\n");
const REMOTE_SCRATCH = "~/.config/herdr-app/pdk-state/usage-scratch";

// Only the bar calls this, once per machine every 5 minutes.
async function fetchUsage(machine) {
  const dir = `${appHome()}/pdk/helper`;
  const r = machine
    ? await exec("python3", ["-I", "-S", "-c", REMOTE, await readTextFile(`${dir}/codex_guard.py`), await readTextFile(`${dir}/pdk-usage.py`), "read", REMOTE_SCRATCH], { on: machine, timeout: 90000 })
    : await exec("/usr/bin/python3", ["-I", "-S", `${dir}/pdk-usage.py`, "read", `${appHome()}/pdk-state/usage-scratch`], { timeout: 90000, cwd: appHome() });
  const reply = JSON.parse(r.stdout);
  if (r.code !== 0 || !Array.isArray(reply?.cards)) throw new Error(reply?.error ?? "No usage reply");
  return reply;
}

// This computer, then each connected machine (the sidebar's own list and names): all of them are read.
const knownMachines = () => machineList({ machines: machines(), listed: shared("pdk.machines.list") ?? [] });
const shownMachines = () => knownMachines().filter((m) => m.state == null);

export default class Usage extends View {
  init(_props, cx) {
    this.footH = null;
    this.readers = new Map();
    const reader = (m) => {
      if (!this.readers.has(m.id)) this.readers.set(m.id, new UsageReader(shared, setShared, () => fetchUsage(m.name), Date.now, m.id));
      return this.readers.get(m.id);
    };
    // A machine that connects is read within a minute; each is read again when its reply is 5 minutes old.
    cx.spawn(async (cx) => {
      for (;;) {
        for (const m of shownMachines()) if (reader(m).stale()) reader(m).read();
        await cx.sleep(60000);
      }
    });
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) === "refresh") for (const m of shownMachines()) reader(m).read();
        cx.notify();
      }
    });
    cx.timer.every(60000, (cx) => cx.notify()); // the reset countdowns move
  }

  render() {
    return this.bar(theme());
  }

  // Option A's foot: per machine with data, its label and "7d used", then per agent a line and a bar. The gear sits at
  // the right of the first label, or alone. The block takes the height its lines need (layout.resize), up to 40% of
  // the sidebar; more scrolls inside it.
  bar(t) {
    const now = Date.now();
    // The filter is checked against every known machine first (review UX02): a chosen machine that is offline or still
    // loading keeps the foot to itself, which then shows nothing, never another machine's usage.
    const groups = filtered(knownMachines(), shared(FILTER_KEY)).filter((m) => m.state == null).map((m) => ({ ...m, lines: footLines(shared(usageKeys(m.id).data), now) })).filter((m) => m.lines.length);
    // The gear: Herdr's own Settings, as its ⌘, does; "Settings" and the key in a short tooltip.
    const gear = tooltip(t, "usage-settings-tip", button(t, "usage-settings", { icon: "settings", label: "Settings", size: "xs", variant: "ghost-muted", onPress: () => run("app.settings") }),
      "Settings", { keys: shortcut("app.settings") ?? [] });
    const ink = softInk(t);
    const line = (m, l, i) => v_flex().id(`ul-${m.id}-${l.key}`).w_full().when(i > 0, (el) => el.mt(SPACE[2]))
      .role("group").accessibility_label(`${l.name} on ${m.label}: ${l.words}`)
      .child(h_flex().h(LINE).gap(SPACE.mark).items_center()
        .child(agentMark(t, l.name, ICON.sm))
        .child(div().min_w(0).truncate().text_size(TYPE.xs).text_color(l.stale || l.fill == null ? t.dim : ink).child(l.text)))
      .when(l.fill != null, (el) => el.child(h_flex().w_full().mt(SPACE.status)
        .child(progressBar(t, `ub-${m.id}-${l.key}`, l.fill, { color: l.high ? t.blocked : t.done, label: `${l.name} on ${m.label}` }))));
    const group = (m, i) => v_flex().id(`um-${m.id || "here"}`).w_full().flex_none().role("group").accessibility_label(`${m.label} usage`)
      .child(h_flex().h(LABEL).mb(SPACE[2]).gap(SPACE[2]).items_center().text_size(TYPE.xs)
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(m.label))
        .child(div().flex_none().text_color(t.dim).child("7d used"))
        .child(i === 0 ? gear : div().w(ROW.compact).flex_none())) // the gear's width on every label, so "7d used" lines up
      .children(m.lines.map((l, k) => line(m, l, k)));
    const zoom = Number(settings()?.zoom) || 1;
    const sidebar = (globalThis.window?.viewport_size?.().height ?? 800) / zoom;
    const content = 1 + SPACE[3] * 2 + groups.reduce((h, g) => h + groupHeight(g), 0) + Math.max(0, groups.length - 1) * SPACE[3];
    const height = groups.length ? Math.min(content, Math.floor(sidebar * CAP)) : ROW.two;
    if (height !== this.footH) { this.footH = height; run("layout.resize", { id: "usage", px: height }); }
    return withFont(v_flex()).id("usage-bar").size_full().bg(t.surface).border_t(1).border_color(t.border)
      .when(groups.length === 0, (el) => el.px(SPACE[3]).justify_center().child(h_flex().w_full().justify_end().child(gear)))
      .when(groups.length > 0, (el) => el.child(v_flex().id("usage-groups").size_full().min_h(0).p(SPACE[3]).gap(SPACE[3])
        .when(content > height, (g) => g.overflow_y_scrollbar())
        .children(groups.map(group))));
  }
}
