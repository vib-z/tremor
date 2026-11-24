// Every segmented control is shadcn's toggle group now (owner, 11 Nov): one Tab stop, arrow keys, Space or Enter
// (base Toggle's click) chooses. Each caller still switches what it switched. The tab bar's Grid / Factory, the pane
// header's Chat / Terminal (views.test.js) and the settings page's Clean / Normal (settings.test.js) are drawn there;
// here the rest, each call taken as written from its mod and pressed through the Toggle's on_change.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { harness, evaluate, world } from "./parity-harness.js";
import * as workspace from "../adapters/workspace.js";
import { AGENT_VIEWS } from "../adapters/views.js";

const PACK = new URL("..", import.meta.url).pathname;
// The whole `segmentedChoice(t, "<id>", …)` call in a mod's source, by its balanced parentheses.
function call(file, id) {
  const src = readFileSync(join(PACK, file), "utf8"), at = src.search(new RegExp(`segmentedChoice\\(t, ?"${id}"`));
  if (at < 0) throw new Error(`${id} not in ${file}`);
  let depth = 0;
  for (let i = src.indexOf("(", at); i < src.length; i++) {
    if (src[i] === "(") depth++;
    if (src[i] === ")" && --depth === 0) return src.slice(at, i + 1);
  }
}
const h = harness(world());
const t = h.env.theme();
const toggles = (group) => group.kids.map((tip) => tip.kids[0]);
const draw = (file, id, self, extra = {}) => new Function("t", "segmentedChoice", "AGENT_VIEWS", ...Object.keys(extra), `return ${call(file, id)};`)
  .call(self, t, h.ui.segmentedChoice, AGENT_VIEWS, ...Object.values(extra));
const press = (group, value) => toggles(group).find((x) => x.props.id.endsWith(`-${value}`)).props.on_change(true, h.cx);

test("the chat header's Chat / Terminal: Terminal opens the terminal, Chat (shown) does nothing", () => {
  const opened = [];
  const group = draw("mods/pdk-chat/main.js", "chat-view", { openTerminal: () => opened.push("terminal"), hit: (n) => n }, { ROW: h.ui.ROW });
  expect([group.props.role, toggles(group).map((x) => [x.kind, x.props.pressed])]).toEqual(["group", [["Toggle", true], ["Toggle", false]]]);
  press(group, "chat"); expect(opened).toEqual([]);
  press(group, "main"); expect(opened).toEqual(["terminal"]);
});

test("the model switcher's effort: a press picks that effort and gives the keyboard back to the switcher", () => {
  const efforts = ["low", "medium", "high"];
  let refocused = 0;
  const self = { switcher: { ei: 1 }, switchFocus: { focus: () => refocused++ } };
  const group = draw("mods/pdk-chat/main.js", "effort-group", self, { efforts, s: self.switcher, effortWord: (e) => e });
  expect(group.props.accessibility_label).toBe("Effort");
  press(group, "high"); expect([self.switcher.ei, refocused]).toEqual([2, 1]);
});

test("the search modes: Commands switches the palette to commands", () => {
  const modes = [];
  const group = draw("mods/pdk-search/main.js", "search-mode", { mode: "places", switchMode: (v, cx) => modes.push([v, cx === h.cx]) });
  press(group, "commands"); expect(modes).toEqual([["commands", true]]);
});

test("the Files / Changes switch opens the other dialog; disabled, it is no Tab stop", () => {
  const env = { ...h.env, ...workspace, props: () => ({ overlay: "o1" }) };
  const { utilityHeader } = evaluate("shared/workspace-dialog.js", env, "({utilityHeader})");
  h.clear(); h.overlays.length = 0;
  utilityHeader(t, "files", null, "", () => {});
  h.byId("utility-modes-changes").props.on_change(true, h.cx);
  expect(h.overlays.at(-1).mod).toBe("pdk-changes");
  h.clear(); utilityHeader(t, "files", null, "", () => {}, true);
  for (const v of ["files", "changes"]) expect([h.byId(`utility-modes-${v}`).props.tab_index, h.byId(`utility-modes-${v}`).props.tab_stop]).toEqual([undefined, undefined]);
});

// Review R1: Enter on an effort segment must not reach the switcher's own Enter (Apply) with the old effort. The keys
// go through the real handlers: the item's key-down and key-up, then (unless stopped) the switcher's switcherKeyDown
// from pdk-chat/main.js, with GPUI's keyboard click (Toggle's on_change) on the key-up of Enter or Space.
test("Enter or Space on an effort segment makes one choice and never reaches the switcher's Apply", async () => {
  const { switcherKey } = await import("../adapters/models.js");
  const src = readFileSync(join(PACK, "mods/pdk-chat/main.js"), "utf8");
  const at = src.indexOf("  switcherKeyDown(e, term, cx) {"); let depth = 0, end = src.indexOf("{", at);
  for (let i = end; i < src.length; i++) { if (src[i] === "{") depth++; if (src[i] === "}" && --depth === 0) { end = i; break; } }
  const switcherKeyDown = new Function("switcherKey", `return function ${src.slice(at + 2, end + 1)}`)(switcherKey);
  const efforts = ["low", "medium", "high"], applied = [];
  for (const key of ["enter", "space"]) {
    applied.length = 0;
    const self = { switcher: { kind: "claude", models: [{ id: "m", efforts }], mi: 0, ei: 1 }, switchFocus: { focus() {} },
      applySwitch() { applied.push(efforts[self.switcher.ei]); }, closeModels() {}, switcherKeyDown };
    const group = draw("mods/pdk-chat/main.js", "effort-group", self, { efforts, s: self.switcher, effortWord: (e) => e });
    const high = toggles(group).find((x) => x.props.id.endsWith("-high"));
    const dispatch = (phase, ev) => { let stopped = false; const cx = { ...h.cx, stop_propagation() { stopped = true; }, notify() {} };
      high.props[phase](ev, cx); if (!stopped && phase === "on_key_down") self.switcherKeyDown(ev, null, cx); return cx; };
    dispatch("on_key_down", { key, modifiers: {} });
    expect(applied, `${key} down`).toEqual([]);
    const cx = dispatch("on_key_up", { key, modifiers: {} });
    high.props.on_change(true, cx); // GPUI's keyboard click on the key-up
    expect([applied, efforts[self.switcher.ei]], key).toEqual([[], "high"]); // one choice, no Apply
    self.switcherKeyDown({ key: "enter" }, null, cx); // Enter on the switcher itself still applies, with the new effort
    expect(applied).toEqual(["high"]);
  }
});

test("`again` passes a press on the lit item to onChange too (the Map's lit Collapsed); without it the lit item does nothing", () => {
  const items = [{ value: "a", label: "A" }, { value: "b", label: "B" }];
  const got = [];
  press(h.ui.segmentedChoice(t, "again-on", items, "a", (v) => got.push(`on:${v}`), { again: true }), "a");
  press(h.ui.segmentedChoice(t, "again-off", items, "a", (v) => got.push(`off:${v}`)), "a");
  press(h.ui.segmentedChoice(t, "again-off", items, "a", (v) => got.push(`off:${v}`)), "b");
  expect(got).toEqual(["on:a", "off:b"]);
});
