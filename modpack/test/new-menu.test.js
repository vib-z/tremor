import { test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { harness, world, evaluate } from "./parity-harness.js";

// C17: the tab bar's + opens the pack's clone of Herdr's new menu, restyled to the pack's menu rows, never a new menu.
const ROOT = new URL("..", import.meta.url).pathname;
const MENU = readFileSync(join(ROOT, "mods/pdk-new-menu/main.js"), "utf8");
const STOCK_PATH = join(ROOT, "../../core-client-1108/.refs/herdr-app/defaults/mods/new-menu/main.js");
const STOCK = existsSync(STOCK_PATH) ? readFileSync(STOCK_PATH, "utf8") : "";
const TABS = readFileSync(join(ROOT, "mods/pdk-tabs/main.js"), "utf8");

test("C17: the tab bar's + opens the clone", () => {
  expect(TABS).toContain('openOverlay({ mod: "pdk-new-menu", kind: "popup"');
  expect(TABS).not.toContain('mod: "new-menu"');
});

// Spec §3 and §5: a minimal menu. Terminal and the installed agents as a tab in the shown workspace; New workspace is
// the sidebar's + (one command); no uninstalled inventory, no bare space.new, no worktree rows (the workspace menu
// keeps those).
test("the minimal new menu: installed agents only, Terminal, New workspace through the +; real keys only", () => {
  for (const s of ['run("tab.new", { space: space?.id, ...(a ? { name: a.name, argv: a.run } : {}) })', 'run("pdk-tabs.new-workspace")', 'shortcut("tab.new")',
    'shortcut("pdk-tabs.new-workspace")', "knownAgents({ on: machine })", 'const KNOWN = "new-menu.agents"', "this.agents.filter(a => a.installed && a.run?.length)",
    "setShared(NEW_KEYS.agent, a.key)", "Could not load agents", "Checking installed agents", "No agents installed", "inFilter(filter, s.machine)"]) expect(MENU).toContain(s);
  for (const gone of ['run("space.new")', '"not installed"', 'mod: "worktree"', "New worktree", "!a.installed", "function shortcut"]) expect(MENU).not.toContain(gone);
  expect(MENU).toContain('/^[1-9]$/.test(e.key) ? installed[Number(e.key) - 1]');
});

// The visual contract (option-a-rest 02): the shared menu frame and items, agents first, then Terminal, a rule, New
// workspace; marks 14; each item's real key in the plain kbd form.
test("C17: drawn with the shared menu and the pack's marks", () => {
  expect(MENU).toContain('menuFrame(t, "new-menu", items, { menu, close: () => closeOverlay(props().overlay) })');
  expect(MENU).toMatch(/menuItem\(t, `new-\$\{a\.key\}`, \{ text: a\.name, icon: mark\(true, a\.name, `\$\{a\.key\}-mk`\), keys: i < 9 \? \[String\(i \+ 1\)\] : \[\]/);
  expect(MENU).toMatch(/kindMarker\(t, \{ agent, label, ground: "popover" \}, ICON\.base, t\.muted, id\)/);
  expect(MENU.indexOf("installed.map(")).toBeLessThan(MENU.indexOf('menuItem(t, "terminal"'));
  expect(MENU.indexOf('menuItem(t, "terminal"')).toBeLessThan(MENU.indexOf('menuItem(t, "space"'));
  expect(MENU).not.toMatch(/\b(svg|image)\(/);
});

// Review UX11: "Checking" only until knownAgents() answers; an empty answer reads "No agents installed", a failed one
// "Could not load agents"; a cached list shows at once meanwhile.
test("the new menu tells still checking from none installed and from a failed check", async () => {
  const shown = async (known) => {
    const w = world(); w.known = known; const h = harness(w);
    const NewMenu = evaluate("mods/pdk-new-menu/main.js", h.env, "NewMenu");
    const menu = new NewMenu(); menu.init({}, h.cx);
    const ids = () => { h.elements.length = 0; menu.render(); return h.elements.map((e) => e.props.id).filter((id) => /^(agents-|new-(?!menu))/.test(String(id))); };
    const before = ids();
    for (const t of h.tasks.splice(0)) await t(h.cx);
    return [before, ids()];
  };
  expect(await shown(async () => [])).toEqual([["agents-checking"], ["agents-none"]]);
  expect(await shown(async () => [{ key: "codex", name: "Codex", installed: false, run: ["codex"] }])).toEqual([["agents-checking"], ["agents-none"]]);
  expect(await shown(async () => { throw new Error("no"); })).toEqual([["agents-checking"], ["agents-failed"]]);
  expect((await shown(async () => [{ key: "claude", name: "Claude Code", installed: true, run: ["claude"] }]))[1]).toContain("new-claude");
});

// T3: one focus, keys bound in PdkMenu (the host's Overlay escape and the kit Root's Tab come first otherwise).
test("the New menu: the frame holds the keyboard under PdkMenu; arrows, Home, End move, Esc and Tab close; Enter and the digits still pick", async () => {
  const w = world(); w.known = async () => [{ key: "claude", name: "Claude Code", installed: true, run: ["claude"] }, { key: "codex", name: "Codex", installed: true, run: ["codex"] }];
  const h = harness(w, { overlay: "nm" });
  const NewMenu = evaluate("mods/pdk-new-menu/main.js", h.env, "NewMenu");
  const menu = new NewMenu(); menu.init({}, h.cx);
  for (const t of h.tasks.splice(0)) await t(h.cx);
  expect(h.bindings.map((b) => [b.keystroke, b.action, b.context])).toEqual(["up", "down", "home", "end", "tab", "shift-tab", "escape"].map((k) => [k, `pdk_menu_${k.replace("-", "_")}`, "PdkMenu"]));
  const draw = () => { h.elements.length = 0; menu.render(); return h.byId("new-menu"); };
  const frame = draw();
  expect([frame.props.key_context, frame.props.track_focus]).toEqual(["PdkMenu", menu.handle]);
  // The item handles come from the first key, never from render.
  let at = null;
  const act = (k) => { const f = draw(); f.props[`on_action:pdk_menu_${k.replace("-", "_")}`]({}, h.cx); };
  act("down");
  const hs = [...h.env.menuState(menu, "new-menu").handles];
  expect(hs.map(([id]) => id)).toEqual(["new-claude", "new-codex", "terminal", "space"]);
  for (const [id, hd] of hs) { hd.focus = () => { at = id; }; hd.is_focused = () => at === id; }
  at = "new-claude";
  act("down"); expect(at).toBe("new-codex");
  act("end"); expect(at).toBe("space");
  act("down"); expect(at).toBe("new-claude"); // wraps
  act("up"); expect(at).toBe("space");
  act("home"); expect(at).toBe("new-claude");
  expect(h.byId("new-codex").props.track_focus).toBe(hs[1][1]);
  for (const k of ["escape", "tab", "shift-tab"]) { h.calls.length = 0; act(k); expect(h.calls).toEqual([["closeOverlay", "nm"]]); }
  // Enter is the item's Button (its click); the digits are the wrapper's.
  h.calls.length = 0; draw(); h.byId("new-codex").props.on_click({}, { stop_propagation() {} });
  expect(h.calls.at(-1)).toEqual(["tab.new", { space: "A", name: "Codex", argv: ["codex"] }]);
  h.calls.length = 0; draw(); h.byId("new-menu-keys").props.on_key_down({ key: "1", modifiers: {} }, h.cx);
  expect(h.calls).toContainEqual(["tab.new", { space: "A", name: "Claude Code", argv: ["claude"] }]);
});
