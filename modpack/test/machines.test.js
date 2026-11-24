import { test, expect } from "bun:test";
import { harness, world as harnessWorld } from "./parity-harness.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildBoard } from "../adapters/factory.js";
import { lightsInset, keyAction, buildPaneTree, treeRows, rowSpec, machineList, machineFilter, machineChoices, inFilter, MACHINE_KEYS, rollup, rollupWords, parseGit, gitTail, GIT_READS, machineLabel } from "../adapters/status.js";

const ROOT = new URL("..", import.meta.url).pathname;
const src = (p) => readFileSync(join(ROOT, p), "utf8");
const claude = { name: "Claude Code", key: "claude", agent: true };
const codex = { name: "Codex", key: "codex", agent: true };
const zsh = { name: "zsh", key: "zsh", shell: true };
const tab = (id, name, extra = {}) => ({ id, name, named: true, active: false, settled: false, changed_at: null, ...extra });
const pane = (pane, tabId, terminal, program, extra = {}) => ({ pane, tab: tabId, terminal, program, title: "", focused: false, cwd: "/w", ...extra });
const term = (address, extra = {}) => ({ address, state: "live", parent: null, status: null, records: {}, ...extra });

// Two machines, as the sandbox scene has them: this computer (core-client: a needs-you Claude lead with a working
// Codex child pane and a done Codex review tab; evals: a shell tab) and "box" (infra: an idle Codex lead).
function world() {
  const spaces = [
    { id: "A", name: "core-client", machine: null, active: true, tabs: [tab("A1", "lead", { active: true, changed_at: 1000 }), tab("A2", "review")] },
    { id: "B", name: "evals", machine: null, active: false, tabs: [tab("B1", "checks", { active: true })] },
    { id: "C", name: "infra", machine: "box", active: false, tabs: [tab("C1", "deploy", { active: true })] },
  ];
  const panes = [
    pane("p1", "A1", "t1", claude, { focused: true }),
    pane("p2", "A1", "t2", codex),
    pane("p3", "A2", "t3", codex),
    pane("p4", "B1", "t4", zsh),
    pane("p5", "C1", "box/t1", codex),
  ];
  const terminals = [
    term("t1", { status: "blocked" }),
    term("t2", { status: "working", parent: "t1" }),
    term("t3", { status: "done" }),
    term("t4"),
    term("box/t1", { status: "idle" }),
  ];
  const agents = [{ address: "t1", status: "blocked" }, { address: "t2", status: "working" }, { address: "t3", status: "done" }, { address: "box/t1", status: "idle" }];
  return { spaces, panes, terminals, agents };
}
const machinesOf = (w) => machineList({ spaces: w.spaces, machines: [{ name: null, layout: "ready" }, { name: "box", layout: "ready" }], listed: [{ name: "box", state: "connected" }] });

test("machines come only from the app's data: this computer first, then each named one; temporary ones left out", () => {
  const w = world();
  expect(machinesOf(w).map((m) => [m.id, m.label, m.state])).toEqual([["", "This computer", null], ["box", "box", null]]);
  const listed = machineList({ spaces: [], machines: [{ name: null, layout: "ready" }], listed: [{ name: "tmp", temporary: true, state: "connected" }] });
  expect(listed.map((m) => m.label)).toEqual(["This computer"]);
  expect(machineLabel(null)).toBe("This computer");
});

test("a machine that doesn't answer says so in words, as the default sidebar does", () => {
  const list = machineList({ spaces: [], machines: [{ name: null, layout: "ready" }, { name: "box", layout: "loading" }, { name: "far", layout: "unavailable" }], listed: [{ name: "lost", state: "unreachable" }, { name: "zz", state: "needs_login" }] });
  expect(Object.fromEntries(list.map((m) => [m.label, m.state]))).toEqual({ "This computer": null, box: "loading", far: "unavailable", lost: "unreachable", zz: "needs login" });
});

// Spec §2: the sidebar lists only workspaces and their agents, for the machine the filter shows. No machine rows.
test("the machine filter: all by default; one machine shows only its workspaces; an unknown one is all", () => {
  const w = world();
  const known = machinesOf(w);
  expect(MACHINE_KEYS.filter).toBe("pdk.machine.filter");
  expect([null, undefined, "all", "", "box", "gone", 3].map((v) => machineFilter(v, known))).toEqual(["all", "all", "all", "", "box", "all", "all"]);
  const shown = (f) => treeRows(buildPaneTree(w).filter((s) => inFilter(f, s.machine))).filter((r) => r.type === "space").map((r) => r.key);
  expect([shown("all"), shown(""), shown("box")]).toEqual([["sp:A", "sp:B", "sp:C"], ["sp:A", "sp:B"], ["sp:C"]]);
  expect(treeRows(buildPaneTree(w)).some((r) => r.type === "machine")).toBe(false);
  // The mod: the command, the filter in force, the machine name at the right only under All with two machines.
  const tree = src("mods/pdk-tree/main.js");
  expect(tree).toMatch(/c\.startsWith\("machine:"\)\) this\.setFilter\(c\.slice\(8\), cx\)/);
  expect(tree).toMatch(/const filter = machineFilter\(shared\(MACHINE_KEYS\.filter\), known\);/);
  expect(tree).toMatch(/this\.hostShown = filter === "all" && known\.length > 1;/);
  for (const gone of ["machineRow(", "hiddenRow(", "addMachineRow(", "setHidden(", "setLevel(", "agentRow(", "view-switch"]) expect(tree).not.toContain(gone);
});

// Owner, 14 Nov 20:09: studio-mac chosen showed no workspaces. Every workspace there is a native Core job's, made
// from `herdr.space` / `herdr.tab` labels, and Herdr 0.1.15 ids such a tab "<machine>/<tab label>": two jobs with a
// "main" tab both list "studio-mac/main", and a pane carries only that id (sandbox dump, app 0.1.15, hc 0.1.21).
// Each pane belongs to the one workspace its terminal's `herdr.space` label names: no row twice (the list draws
// nothing when a row's view is mounted twice), in the tree, the tab bar's model and the factory, under any filter.
test("two native Core jobs on a remote machine, each with a main tab: each workspace holds its own panes, no row twice", () => {
  const job = (space, tab) => ({ "herdr.space": space, "herdr.tab": tab });
  const spaces = [
    { id: "L", name: "here", machine: null, active: false, tabs: [tab("L1", "shell")] },
    { id: "studio-mac/repod", name: "watch", machine: "studio-mac", active: true, tabs: [tab("studio-mac/main", "1", { active: true }), tab("studio-mac/browser", "2")] },
    { id: "studio-mac/demo", name: "map", machine: "studio-mac", active: false, tabs: [tab("studio-mac/main", "1", { active: true }), tab("studio-mac/fix", "2")] },
  ];
  const panes = [
    pane("p0", "L1", "t1", zsh),
    pane("studio-mac/p1", "studio-mac/main", "studio-mac/t1", claude),
    pane("studio-mac/p2", "studio-mac/browser", "studio-mac/t2", claude),
    pane("studio-mac/p3", "studio-mac/main", "studio-mac/t3", claude),
    pane("studio-mac/p4", "studio-mac/main", "studio-mac/t4", claude),
    pane("studio-mac/p5", "studio-mac/fix", "studio-mac/t5", claude),
  ];
  const terminals = [
    term("t1"),
    term("studio-mac/t1", { status: "working", labels: job("repod", "main") }),
    term("studio-mac/t2", { status: "working", parent: "studio-mac/t1", labels: job("repod", "browser") }),
    term("studio-mac/t3", { status: "working", labels: job("demo", "main") }),
    term("studio-mac/t4", { status: "idle", parent: "studio-mac/t3", labels: job("demo", "main") }),
    term("studio-mac/t5", { status: "working", parent: "studio-mac/t3", labels: job("demo", "fix") }),
  ];
  const agents = terminals.slice(1).map((t) => ({ address: t.address, status: t.status }));
  const model = buildPaneTree({ spaces, panes, terminals, agents });
  for (const filter of ["all", "studio-mac", ""]) {
    const keys = treeRows(model.filter((s) => inFilter(filter, s.machine))).map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  }
  const terms = (s) => s.tabs.flatMap((t) => [t.lead?.address, ...t.items.flatMap(function all(n) { return [n.address, ...n.items.flatMap(all)]; })]).filter(Boolean).sort();
  expect(model.slice(1).map(terms)).toEqual([["studio-mac/t1", "studio-mac/t2"], ["studio-mac/t3", "studio-mac/t4", "studio-mac/t5"]]);
  expect(treeRows(model.filter((s) => inFilter("studio-mac", s.machine))).filter((r) => r.type === "space").map((r) => r.key)).toEqual(["sp:studio-mac/repod", "sp:studio-mac/demo"]);
  // The factory under the same filter (this computer hidden): each agent once, in its own workspace.
  const board = buildBoard({ spaces, panes, terminals, agents, hidden: [""] });
  const units = board.regions.map((r) => r.zones.flatMap((z) => z.units.map((u) => u.address)).sort());
  expect(units).toEqual([["studio-mac/t1", "studio-mac/t2"], ["studio-mac/t3", "studio-mac/t4", "studio-mac/t5"]]);
});

// The machine selector (owner, 11 Nov: "a minimal dropdown with icons", Add machine in it): All, then This computer
// and each machine by name, the filter's own one chosen; a machine that doesn't answer still listed, said Offline
// (loading is not); with only this computer, This computer alone and chosen, so the selector still shows.
test("the machine selector's entries: All, This computer, each machine; the chosen one; Offline; one machine still listed", () => {
  const known = machineList({ spaces: [], machines: [{ name: null, layout: "ready" }, { name: "box", layout: "ready" }, { name: "far", layout: "unavailable" }, { name: "new", layout: "loading" }] });
  const choices = machineChoices(known, "box");
  expect(choices.map((m) => [m.value, m.label, m.aria, m.chosen, m.note, m.icon])).toEqual([
    ["all", "All", "All machines", false, undefined, null], ["", "This computer", "This computer", false, undefined, "monitor"],
    ["box", "box", "box", true, undefined, "server"], ["far", "far", "far", false, "Offline", "server"], ["new", "new", "new", false, undefined, "server"]]);
  expect(machineChoices(known, "all").filter((m) => m.chosen).map((m) => m.value)).toEqual(["all"]);
  expect(machineChoices(known.slice(0, 1), "all").map((m) => [m.value, m.label, m.chosen, m.icon])).toEqual([["", "This computer", true, "monitor"]]);
  // The mod: the selector on its own row where the tabs were (A, until the owner picks), the Workspaces row as it was.
  const tree = src("mods/pdk-tree/main.js");
  expect(tree).not.toContain("SELECT_AT"); // the owner picked A (11 Nov): one placement, no switch
  expect(tree).toMatch(/\.child\(h_flex\(\)\.id\("machine-row"\)\.h\(SPACE\[10\]\)/);
  expect(tree).toMatch(/\.child\(div\(\)\.text_size\(TYPE\.sm\)\.text_color\(t\.muted\)\.child\("Workspaces"\)\)/);
  for (const gone of ["machineTabsRow", "machineScroll", "segmentedChoice"]) expect(tree).not.toContain(gone);
});

// Herdr 0.1.15 item 3: a machine that needs a login says "Sign in"; choosing it opens Herdr's own Settings at Machines
// (where 0.1.15 shows `hc machine login <name>` with Copy), never a login row of ours, even when it is the chosen one.
test("a machine that needs a login says Sign in, and choosing it opens Herdr's Settings at Machines", () => {
  const known = machineList({ spaces: [], machines: [{ name: null, layout: "ready" }, { name: "box", layout: "unavailable" }, { name: "far", layout: "unavailable" }],
    listed: [{ name: "box", state: "needs_login" }, { name: "far", state: "unreachable" }] });
  const choices = machineChoices(known, "all");
  expect(choices.map((m) => [m.value, m.login, m.note])).toEqual([["all", false, undefined], ["", false, undefined], ["box", true, "Sign in"], ["far", false, "Offline"]]);
  const w = harnessWorld(), h = harness(w); const tree = new h.Tree(); tree.init({}, h.cx); h.tasks.length = 0;
  tree.chooseMachine(choices, "box"); tree.chooseMachine(choices, "far"); tree.chooseMachine(choices, ""); tree.chooseMachine(choices, "all");
  tree.chooseMachine(machineChoices(known, "box"), "box");
  expect(h.calls).toEqual([["app.settings", { section: "machines" }], ["pdk-tree.machine:far"], ["pdk-tree.machine:local"], ["app.settings", { section: "machines" }]]);
});

// The rendered selector (owner, 11 Nov: "world class ... easy not to miss"; shadcn's sidebar switcher). The trigger: a
// 32 px row button in the field look (a 1 px `input` edge, `accent` while open), the chosen one's glyph, its name in
// 13/500 foreground, the up-down chevrons; the whole name in the tooltip; the row's measured width, and the menu as
// wide, 4 below. No click handler of its own, since the app's Popover owns the press, Esc and a press outside; Enter or
// Space open it. The menu: All, This computer, each machine, a rule, Add machine; the current one marked. A choice
// sets the filter (the current one changes nothing), Sign in opens Settings, Add machine opens tremor's add dialog,
// and each closes the menu.
test("the machine selector: its trigger, the entries in order, the current one marked; each kind of choice, Sign in, Add machine", async () => {
  const w = harnessWorld(), h = harness(w);
  w.hc = async (args) => ({ code: 0, stdout: JSON.stringify({ machines: args.join(" ") === "machine ls --json" ? [{ name: "box", state: "connected" }, { name: "hive", state: "needs_login" }] : [] }), stderr: "" });
  const tree = new h.Tree(); tree.init({}, h.cx);
  const tasks = h.tasks.splice(0); await tasks[0](h.cx); // init's machine read (its first task); the endless loops stay off
  const cx = { ...h.cx, stop_propagation: () => {} };
  const draw = () => { h.elements.length = 0; tree.render(h.cx); return h.byId("machine-menu"); };
  h.store.set("pdk.machine.filter", "box");
  let pop = draw();
  const trigger = pop.props.trigger;
  expect(pop.kind).toBe("Popover");
  const th = h.env.theme();
  expect([trigger.props.id, trigger.props.h, trigger.props.rounded, trigger.props.border, trigger.props.border_color, trigger.props.role, trigger.props.tooltip, trigger.props.accessibility_label, trigger.props.tab_index])
    .toEqual(["machine-select", 32, 6, 1, th.input, "button", "box", "Machine: box", 0]);
  expect(trigger.kids.map((k) => k.kind === "svg" ? `svg:${k.props.size}` : k.kids.join(""))).toEqual(["svg:14", "box", "svg:14"]);
  expect([trigger.props.on_click, trigger.kids[1].props.truncate, trigger.kids[1].props.font_medium, trigger.kids[1].props.text_color]).toEqual([undefined, true, true, th.foreground]);
  expect([pop.props.open, pop.props.anchor]).toEqual([false, "top_left"]);
  // The row measured (280 wide): the trigger fills it inside the list's 8 px inset, and the menu is as wide, 4 below.
  tree.measureSelect({ width: 280 }, h.cx); pop = draw();
  expect([pop.props.trigger.props.w, pop.props.content.props.w, pop.props.content.props.mt]).toEqual([264, 264, 4]);
  // Opened by the Popover (a press) or by Enter on the trigger; the trigger then shows it is open.
  pop.props.on_open_change(true, h.cx); pop = draw();
  expect([tree.machineMenu, pop.props.open, pop.props.trigger.props.bg, pop.props.trigger.props.border_color]).toEqual([true, true, th.hover, th.accent]);
  pop.props.on_open_change(false, h.cx); trigger.props.on_key_down({ key: "enter" }, cx); expect(tree.machineMenu).toBe(true);
  pop = draw();
  const menu = pop.props.content;
  expect(menu.props.role).toBe("menu");
  // The choices in the scroll area, then the rule and Add machine pinned under it (review RC03).
  expect(menu.kids.map((k) => k.props.id ?? (k.props.h === 1 ? "rule" : "?"))).toEqual(["machine-menu-scroll", "rule", "machine-menu-act-add"]);
  expect(menu.kids[0].kids.map((k) => k.props.id)).toEqual(["machine-menu-all", "machine-menu-this", "machine-menu-m-box", "machine-menu-m-hive"]);
  const item = (id) => h.byId(id).props;
  // The current one: the selected fill, and "current" in its accessible name; a Button carries no checked state (RC05).
  expect(["all", "this", "m-box", "m-hive"].map((v) => [item(`machine-menu-${v}`).role, item(`machine-menu-${v}`).checked, item(`machine-menu-${v}`).accessibility_label])).toEqual([
    ["menu_item", undefined, "All"], ["menu_item", undefined, "This computer"], ["menu_item", undefined, "box, current"], ["menu_item", undefined, "hive, Sign in"]]);
  expect([item("machine-menu-m-box").bg, item("machine-menu-act-add").role]).toEqual([h.env.theme().selected, "menu_item"]);
  for (const [id, call] of [["machine-menu-all", ["pdk-tree.machine:all"]], ["machine-menu-this", ["pdk-tree.machine:local"]], ["machine-menu-m-hive", ["app.settings", { section: "machines" }]],
    ["machine-menu-act-add", ["mod.open", { name: "pdk-machine-add" }]]]) {
    tree.machineMenu = true; draw(); h.calls.length = 0;
    item(id).on_click({}, cx);
    expect([h.calls, tree.machineMenu], id).toEqual([[call], false]);
  }
  tree.machineMenu = true; draw(); h.calls.length = 0; item("machine-menu-m-box").on_click({}, cx);
  expect([h.calls, tree.machineMenu]).toEqual([[], false]); // the current one: closed, nothing run
});

// The menu's keyboard (review RC02): Up on the first entry goes to the last (Add machine) and Down on the last to
// the first, never to the window's next Tab stop; Esc on an entry, or anywhere in the sidebar while it is open, closes
// it and gives the trigger the keyboard; Tab closes it. It opens on the current entry, in view.
test("the machine menu's arrows wrap inside it; Esc closes it from an entry or the sidebar; it opens on the current entry", async () => {
  const w = harnessWorld(), h = harness(w);
  const tree = new h.Tree(); tree.init({}, h.cx); h.tasks.length = 0;
  h.store.set("pdk.machine.filter", "box");
  const cx = { ...h.cx, stop_propagation: () => {} };
  // The app forbids a focus handle made in render: the menu makes its entries' handles when it opens.
  const draw = () => { h.elements.length = 0; const make = h.cx.focus_handle; h.cx.focus_handle = () => { throw new Error("focus_handle in render"); };
    try { tree.render(h.cx); } finally { h.cx.focus_handle = make; } return h.byId("machine-menu"); };
  let pop = draw();
  expect([tree.menuKeys.size, pop.props.track_focus]).toEqual([0, undefined]);
  pop.props.on_open_change(true, h.cx); pop = draw(); pop.props.on_open_change(false, h.cx); pop = draw();
  // The keyboard is on one handle at a time.
  let at = null;
  const moved = [], spy = () => { for (const [id, hd] of tree.menuKeys) { hd.focus = () => { at = id; moved.push(id.replace("machine-menu-", "")); }; hd.is_focused = () => at === id; }
    tree.selectKeys.focus = () => { at = "trigger"; moved.push("trigger"); }; };
  spy();
  expect(pop.props.track_focus).toBe(tree.menuKeys.get("machine-menu-m-box")); // the keyboard lands on the current entry
  pop.props.on_open_change(true, h.cx); draw(); spy();
  const reveals = () => h.scrolls.filter(([hd]) => hd === tree.menuScroll).map(([, at]) => at);
  expect(reveals().at(-1)).toBe(2); // All, This computer, box: the current one in view
  // The real keys: bound in PdkMenu, answered by the frame's actions.
  const frame = h.byId("machine-menu-list");
  expect(frame.props.key_context).toBe("PdkMenu");
  const key = (k) => { draw(); h.byId("machine-menu-list").props[`on_action:pdk_menu_${k.replace("-", "_")}`]({}, cx); };
  at = "machine-menu-m-box";
  key("down"); key("down"); key("down"); key("up"); key("home"); key("end");
  expect(moved).toEqual(["act-add", "all", "this", "all", "all", "act-add"]);
  expect([tree.machineMenu, reveals().at(-1)]).toEqual([true, 0]); // Add machine is pinned: no scroll for it
  key("escape");
  expect([tree.machineMenu, moved.at(-1)]).toEqual([false, "trigger"]);
  // Open again, the keyboard somewhere else in the sidebar (the trigger, a row): Esc there closes it too.
  pop = draw(); pop.props.on_open_change(true, h.cx); spy();
  tree.onKey({ key: "escape" }, cx);
  expect([tree.machineMenu, moved.at(-1)]).toEqual([false, "trigger"]);
  for (const k of ["tab", "shift-tab"]) {
    pop = draw(); pop.props.on_open_change(true, h.cx); spy();
    key(k);
    expect([tree.machineMenu, moved.at(-1)]).toEqual([false, "trigger"]);
  }
});

// Review RC03: thirty machines don't run the menu off the window. The choices scroll inside the room under the
// trigger (the list's measured height and the Workspaces row, less the frame, the rule and Add machine); Add machine
// stays pinned under them; an entry the keyboard moves to is brought into view.
test("thirty machines: the choices scroll inside the room under the trigger, Add machine pinned under them", async () => {
  const w = harnessWorld(), h = harness(w);
  const names = Array.from({ length: 30 }, (_, i) => `m${String(i).padStart(2, "0")}`);
  w.hc = async (args) => ({ code: 0, stdout: JSON.stringify({ machines: args.join(" ") === "machine ls --json" ? names.map((name) => ({ name, state: "connected" })) : [] }), stderr: "" });
  const tree = new h.Tree(); tree.init({}, h.cx);
  const tasks = h.tasks.splice(0); await tasks[0](h.cx);
  tree.treeViewport = 500;
  const cx = { ...h.cx, stop_propagation: () => {} };
  h.elements.length = 0; tree.render(h.cx);
  const menu = h.byId("machine-menu").props.content, scroll = menu.kids[0];
  expect([scroll.props.id, scroll.props.max_h, scroll.props.overflow_y_scroll, scroll.props.track_scroll]).toEqual(["machine-menu-scroll", 492, true, tree.menuScroll]);
  expect(scroll.kids.length).toBe(33); // All, This computer, box (the harness's), thirty
  expect(menu.kids.at(-1).props.id).toBe("machine-menu-act-add");
  h.byId("machine-menu").props.on_open_change(true, h.cx); h.elements.length = 0; tree.render(h.cx);
  for (const [id, hd] of tree.menuKeys) hd.is_focused = () => id === "machine-menu-m-m20";
  h.byId("machine-menu-list").props["on_action:pdk_menu_down"]({}, cx);
  expect(h.scrolls.filter(([hd]) => hd === tree.menuScroll).map(([, at]) => at).at(-1)).toBe(24);
  // A short sidebar still leaves three entries' room.
  tree.treeViewport = 40; h.elements.length = 0; tree.render(h.cx);
  expect(h.byId("machine-menu-scroll").props.max_h).toBe(84);
});

// Review RC04: a machine may be named "add" (or "all"); its entry's id is never the Add machine action's.
test("a machine named add or all has its own entry, apart from Add machine and All", async () => {
  const w = harnessWorld(), h = harness(w);
  w.hc = async (args) => ({ code: 0, stdout: JSON.stringify({ machines: args.join(" ") === "machine ls --json" ? [{ name: "add", state: "connected" }, { name: "all", state: "connected" }] : [] }), stderr: "" });
  const tree = new h.Tree(); tree.init({}, h.cx);
  const tasks = h.tasks.splice(0); await tasks[0](h.cx);
  const cx = { ...h.cx, stop_propagation: () => {} };
  h.elements.length = 0; tree.render(h.cx);
  const ids = h.elements.filter((e) => /^machine-menu-(?!scroll|list)/.test(String(e.props.id ?? ""))).map((e) => e.props.id);
  expect(ids).toEqual(["machine-menu-all", "machine-menu-this", "machine-menu-m-add", "machine-menu-m-all", "machine-menu-m-box", "machine-menu-act-add"]);
  expect(new Set(ids).size).toBe(ids.length);
  h.calls.length = 0; h.byId("machine-menu-m-add").props.on_click({}, cx); h.byId("machine-menu-act-add").props.on_click({}, cx);
  expect(h.calls).toEqual([["pdk-tree.machine:add"], ["mod.open", { name: "pdk-machine-add" }]]);
  expect(machineChoices(machineList({ spaces: [], machines: [{ name: null, layout: "ready" }, { name: "all", layout: "ready" }] }), "all").map((m) => m.kind)).toEqual(["all", "this", "machine"]);
});

// Owner, 11 Nov: folding other workspaces "does not work". Every fold path works (the command, a click on the row or
// its caret, Left, Right and Space, a workspace on another machine, the saved folds after a restart), but a press on a
// workspace released outside the sidebar left a drag behind: hovering another workspace then clicking its caret moved
// the first workspace there as well as folding, so the rows jumped under the pointer. A press anywhere outside a row
// (on_mouse_down_out, capture phase, so a caret's own stop doesn't hide it) now ends such a drag; a real drag still moves.
test("a drag left behind by a press released outside never finishes on a caret click; a real drag still moves", async () => {
  const w = harnessWorld(); w.spaces[2].id = "box/spR";
  const h = harness(w); const tree = new h.Tree(); tree.init({}, h.cx); h.tasks.length = 0;
  const cx = { ...h.cx, stop_propagation: () => {} };
  const draw = async () => { h.elements.length = 0; tree.render(h.cx); await h.flushRows(tree); };
  await draw();
  const row = (id) => h.byId(id).props, rows = ["sp:A", "sp:B", "sp:box/spR"];
  // A press: GPUI's capture phase first (every other row's mouse_down_out), then the pressed row's own mouse_down,
  // unless a caret inside it stopped that.
  const pressOn = (id, { caret = false } = {}) => { for (const r of rows) if (r !== id) row(r).on_mouse_down_out?.({}, cx); if (!caret) row(id)["on_mouse_down:left"]({}, cx); };
  pressOn("sp:A"); await draw();          // released outside the sidebar: no mouse_up anywhere in the tree
  row("sp:B").on_mouse_move({}, cx); await draw();
  pressOn("sp:B", { caret: true }); row("sp:B")["on_mouse_up:left"]({}, cx); h.byId("sp:B-fold").props.on_click({}, cx); await draw();
  expect([h.calls.filter((c) => c[0] === "space.move"), tree.folded.has("sp:B"), tree.ignoreSpaceClick]).toEqual([[], true, false]);
  // The workspace on another machine folds and unfolds by its row too.
  for (const want of [true, false]) { pressOn("sp:box/spR"); row("sp:box/spR")["on_mouse_up:left"]({}, cx); row("sp:box/spR").on_click({ click_count: 1 }, cx); await draw(); expect(tree.folded.has("sp:box/spR")).toBe(want); }
  // A real drag, pressed on Alpha and released on Beta, still moves Alpha.
  pressOn("sp:A"); row("sp:B").on_mouse_move({}, cx); row("sp:B")["on_mouse_up:left"]({}, cx);
  expect(h.calls.filter((c) => c[0] === "space.move").map((c) => c[1].id)).toEqual(["A"]);
});

// With only this computer there is nothing to filter, but the selector stays, reading This computer, so Add machine is
// reachable; its menu is This computer, marked, then Add machine.
test("with one machine the selector still shows, reading This computer, and holds Add machine", () => {
  const w = harnessWorld(); w.spaces = w.spaces.filter((s) => !s.machine); w.machines = [];
  const h = harness(w); const tree = new h.Tree(); tree.init({}, h.cx); h.tasks.length = 0;
  h.elements.length = 0; tree.render(h.cx);
  const pop = h.byId("machine-menu"), trigger = pop.props.trigger;
  expect([trigger.props.tooltip, trigger.kids.map((k) => k.kind === "svg" ? k.props.size : k.kids.join(""))]).toEqual(["This computer", [14, "This computer", 14]]);
  expect(pop.props.content.kids.map((k) => k.props.id ?? "rule")).toEqual(["machine-menu-scroll", "rule", "machine-menu-act-add"]);
  expect(pop.props.content.kids[0].kids.map((k) => k.props.id)).toEqual(["machine-menu-this"]);
  expect(h.byId("machine-menu-this").props.accessibility_label).toBe("This computer, current");
});

test("workspace and tab rows: a caret after the name (spec order and the drawing), none on the left", () => {
  const w = world();
  const rows = treeRows(buildPaneTree(w));
  expect(rowSpec(rows.find((r) => r.key === "sp:A")).caret.solid).toBe(true);
  expect(rowSpec(rows.find((r) => r.key === "tb:A1")).caret).toMatchObject({ solid: false, label: "Collapse tab lead" });
  // The drawing: the caret is a child after the name, inside nameCaret or right after the bold name.
  const tree = src("mods/pdk-tree/main.js");
  const nameCaret = tree.slice(tree.indexOf("  nameCaret("), tree.indexOf("  mark("));
  expect(nameCaret.indexOf("child(spec.text)")).toBeLessThan(nameCaret.indexOf("this.caret(t, key, spec)"));
  const spaceRow = tree.slice(tree.indexOf("  spaceRow("), tree.indexOf("  tabRow("));
  expect(spaceRow.indexOf("child(spec.text)")).toBeLessThan(spaceRow.indexOf("this.caret(t, key, spec)"));
  // Row carets are the shared caretButton.
  expect(tree).not.toMatch(/foldMarker\(/);
  expect(tree).toMatch(/return caretButton\(t, `\$\{key\}-fold`, c\.open, c\.label/);
});

test("a folded row counts what it hides, needs you first, then working, then done; idle is left out", () => {
  const w = world();
  const folded = new Set(["sp:A", "tb:A1"]);
  const rows = treeRows(buildPaneTree(w));
  expect(rowSpec(rows.find((r) => r.key === "sp:A"), folded).aria).toBe("Workspace core-client, collapsed: 1 needs you, 1 working, 1 done");
  expect(rowSpec(rows.find((r) => r.key === "sp:A"), folded).rollup.map((c) => c.word)).toEqual(["needs", "working", "done"]);
  // A folded tab counts what the fold hides (its lead shows its own on the left): the working child.
  const tb = rowSpec(rows.find((r) => r.key === "tb:A1"), folded);
  expect(tb).toMatchObject({ word: "needs", rollup: [{ word: "working", n: 1 }] });
  // Open rows count nothing; box's idle lead counts nothing either.
  expect(rowSpec(rows.find((r) => r.key === "sp:A")).rollup).toEqual([]);
  expect(rowSpec(rows.find((r) => r.key === "sp:C"), new Set(["sp:C"])).rollup).toEqual([]);
  expect(rollupWords([{ word: "needs", n: 2 }, { word: "working", n: 4 }])).toBe("2 need you, 4 working");
  expect(rollup([])).toEqual([]);
});

test("tab and child rows: the mark, the name, then the status marker alone at the right end; idle and shells dimmed", () => {
  const w = world();
  const rows = treeRows(buildPaneTree(w));
  const lead = rowSpec(rows.find((r) => r.key === "tb:A1"));
  expect(lead).toMatchObject({ word: "needs", mark: { agent: true, label: "Claude Code" }, at: 1000 });
  const shell = rowSpec(rows.find((r) => r.key === "tb:B1"));
  expect(shell).toMatchObject({ word: null, mark: { agent: false, label: "Terminal" } });
  expect(rowSpec(rows.find((r) => r.key === "tb:C1"))).toMatchObject({ word: "idle" });
  expect(rowSpec(rows.find((r) => r.key === "pn:p2"))).toMatchObject({ word: "working", mark: { agent: true, label: "Codex" } });
  // The drawing (owner, 11 Nov): the mark, the name, then the 7 px marker alone at the row's right end; its word
  // ("Working", "Ready") is the marker's tooltip and, with the time, in the row's accessible name. Hover on a tab:
  // Close comes in before the marker, which stays (so its tooltip can be read under the pointer).
  const tree = src("mods/pdk-tree/main.js");
  for (const row of ["tabRow(", "childRow("]) {
    const body = tree.slice(tree.indexOf(`  ${row}`), tree.indexOf("\n  }\n", tree.indexOf(`  ${row}`)));
    expect(body.indexOf("this.mark(")).toBeLessThan(body.indexOf("this.nameCaret("));
    expect(body.indexOf("this.nameCaret(")).toBeLessThan(body.indexOf("this.status("));
    expect(body).toContain("accessibility_label(this.agentAria(spec))");
    expect(body).not.toContain("this.time(");
  }
  expect(src("adapters/status.js")).toMatch(/export const STATUS_WORD = \{ working: "Working", idle: "Ready", done: "Done", needs: "Needs you" \};/);
  expect(tree).toMatch(/statusMarker\(t, spec\.word, `\$\{key\}-st`, \{ kind, size: ICON\.dot, tip: STATUS_WORD\[spec\.word\] \}\)/);
  expect(tree).not.toMatch(/child\(STATUS_WORD\[/);
  expect(tree).toMatch(/\.px\(0\) : null,\n\s+this\.status\(t, key, spec, item\.tab\.lead\?\.kind\) \?\? \(acting \? div\(\)\.w\(ICON\.dot \+ SPACE\.half\)/);
  expect(tree).toMatch(/textButton\(t, `\$\{key\}-close`, "×", "Close tab", \(\) => run\("tab\.close", \{ id: item\.tab\.id \}\)/);
});

test("every status goes through statusMarker (request 7): the tree and the tab bar draw no status of their own", () => {
  const tree = src("mods/pdk-tree/main.js");
  const tabs = src("mods/pdk-tabs/main.js");
  // The tab bar shows idle too (a hollow ring), no longer skips it.
  expect(tabs).toMatch(/children\(\[statusMarker\(t, word, `tab-st-/);
  // No dot, ring or square of their own (a fill or border in a status colour), and no flag glyph.
  for (const s of [tree, tabs]) expect(s).not.toMatch(/\.(bg|border_color)\(t\.(working|done|blocked|idle)\b|\bflag|\u2691|\u{1F6A9}/u);
});

// Herdr 0.1.15 item 2: the ref-only reads stock's spaces mod makes (no git status): branch, ahead and behind; no
// "edits not committed" mark (only git status knows); not a repo, or git couldn't say, said so.
test("git after the workspace's name: branch, ahead and behind from ref-only reads; unknown said so", () => {
  const ok = (stdout) => ({ code: 0, stdout, stderr: "" }), no = (stderr) => ({ code: 128, stdout: "", stderr });
  const repo = { top: ok("/w/app\n"), common: ok("/w/app/.git\n") };
  const g = parseGit({ ...repo, branch: ok("refs/heads/feat/machines\n"), counts: ok("2\t1\n") });
  expect(g).toEqual({ branch: "feat/machines", ahead: 2, behind: 1 });
  expect(gitTail(g)).toEqual({ branch: "feat/machines", ahead: "↑2", behind: "↓1", aria: "branch feat/machines, 2 ahead, 1 behind" });
  // No upstream: 0 and 0. Detached: symbolic-ref answers nothing.
  expect(gitTail(parseGit({ ...repo, branch: ok("refs/heads/main\n"), counts: no("fatal: no upstream configured for branch 'main'") })))
    .toMatchObject({ branch: "main", ahead: null, behind: null, aria: "branch main" });
  expect(parseGit({ ...repo, branch: { code: 1, stdout: "", stderr: "" }, counts: ok("0\t0\n") }).branch).toBe("detached");
  expect(parseGit({ top: no("fatal: not a git repository (or any of the parent directories): .git"), common: no("fatal: not a git repository") })).toBe(null);
  expect(parseGit({ top: no("ssh: connect to host box: Connection refused"), common: ok("") })).toEqual({ unknown: true });
  expect(gitTail({ unknown: true })).toMatchObject({ branch: "git ?", aria: "Git status unknown: the machine didn't answer" });
  expect(gitTail(null)).toBe(null);
  expect(gitTail(undefined)).toBe(null);
  expect(GIT_READS).toEqual({ top: ["rev-parse", "--path-format=absolute", "--show-toplevel"], common: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    branch: ["symbolic-ref", "-q", "HEAD"], counts: ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"] });
});

// The owner's pick C (visual contract, Machine tabs): the top strip keeps the traffic lights and, at its right end,
// search and the sidebar toggle; no logo, no name, no search field row.
test("the sidebar head: search and the sidebar toggle at the strip's right end; no search field row", () => {
  const tree = src("mods/pdk-tree/main.js");
  const head = tree.slice(tree.indexOf("  renderHead() {"), tree.indexOf("  machineSelect("));
  expect(head).toMatch(/\.justify_end\(\)/);
  // The shared button (24, ghost-muted, 4 px corner) in the shared tooltip, each with its real key.
  expect(head).toMatch(/tooltip\(t, `\$\{id\}-tip`, button\(t, id, \{ icon: name, label, onPress, variant: "ghost-muted", size: "xs" \}\)\.rounded\(RADIUS\.sm\),\n\s+label, \{ keys: shortcut\(action\) \?\? \[\] \}\)/);
  expect(head).toContain('quiet("sidebar-search", "search", "Search", "mod.open:pdk-search", () => run("mod.open", { name: "pdk-search" }))');
  expect(head).toContain('quiet("sidebar-toggle", "panel-left", "Toggle sidebar", "layout.toggle:sidebar", () => run("layout.toggle", { id: "sidebar" }))');
  for (const gone of ["image(", '"tremor"', "pdk-search-field", "searchField("]) expect(tree).not.toContain(gone);
  const tabs = src("mods/pdk-tabs/main.js");
  expect(tabs).toMatch(/sidebar\?\.hidden\), \(el\) => el\.child\(iconButton\(t, "sidebar-show", "panel-left", "Show sidebar ⌘B"/);
  // Request 16: both put it right after the traffic lights, from one rule, so it never moves on screen.
  expect(tree).toMatch(/\.pl\(lightsInset\(window\(\), layout\(\), settings\(\)\.zoom\)\)/);
  expect(tabs).toMatch(/Math\.max\(SPACE\[3\], lightsInset\(w, root, settings\(\)\.zoom\) - \(sidebar\?\.hidden \? 0 : /);
  // Owner, 11 Nov (the top bar lines up): what follows the window buttons starts 12 (SPACE[3]) after their 54 px.
  const mac = { platform: "macos", titlebar: "none", fullscreen: false };
  const root = { traffic_lights: [14, 12] };
  expect([lightsInset(mac, root), lightsInset(mac, root, 2), lightsInset({ ...mac, fullscreen: true }, root), lightsInset({ platform: "linux" }, root)]).toEqual([80, 40, 12, 12]);
  // The layout's sidebar is the node Herdr's ⌘B toggles (defaults/keys.macos.json:37 "layout.toggle:sidebar").
  expect(JSON.parse(src("layouts/tremor.json")).children[0].id).toBe("sidebar");
});

// Owner, 11 Nov: "look at the mac icons, sidebar icon and the + button". One centre line in the 40 px top bar: the
// window buttons' container is the bar (traffic_lights y 12: 12 + AppKit's 16 px button + 12 = 40, so they centre at
// 20), and both bars draw their divider over their bottom edge instead of as a border inside it, so their content
// centres in the whole 40 too (it centred in 39, half a point high). "No workspace" is lifted SPACE.raise so its
// x-height, not its line box, sits on that line. Measured at 2x: every item 39.5 to 40 against the buttons' 40.
test("the top bar's content centres in its whole 40 px, on the window buttons' centre line", () => {
  const layout = JSON.parse(src("layouts/tremor.json"));
  const bar = (id) => JSON.stringify(layout).includes(`"id":"${id}","type":"block","size":{"px":40}`);
  expect([layout.traffic_lights, bar("brand"), bar("tabs")]).toEqual([[14, 12], true, true]);
  expect(layout.traffic_lights[1] * 2 + 16).toBe(40);
  const tree = src("mods/pdk-tree/main.js"), tabs = src("mods/pdk-tabs/main.js");
  const head = tree.slice(tree.indexOf("  renderHead() {"), tree.indexOf("  machineSelect("));
  for (const s of [head, tabs]) {
    expect(s).not.toMatch(/border_b\(1\)\.border_color\(t\.border\)/);
    expect(s).toContain(".child(div().absolute().left(0).right(0).bottom(0).h(1).bg(t.border))");
  }
  expect(tabs).toContain('div().relative().top(-SPACE.raise).text_size(TYPE.sm).text_color(t.dim).child("No workspace")');
});

// Review UX07 (spec §2, contract): the sidebar opens at 280 and resizes between 240 and 480 at the root's boundary.
test("the sidebar is 280 wide by default, 240 at least and 480 at most, resizable at the root", () => {
  const root = JSON.parse(src("layouts/tremor.json"));
  const { size, min, max } = root.children[0];
  expect({ size, min, max }).toEqual({ size: { px: 280 }, min: 240, max: 480 });
  expect(root.resizable).not.toBe(false);
});

test("the Chat / Terminal toggle is icons only, keeping a short tooltip and its accessible name; it sits on each agent's bar", () => {
  const views = src("adapters/views.js");
  expect(views).toContain('{ value: "chat", label: "Chat", icon: "message-square", tooltip: "Chat" }');
  expect(views).toContain('{ value: "main", label: "Terminal", icon: "square-terminal", tooltip: "Terminal" }');
  // Owner, 11 Nov: on each pane's top bar and the chat's header, not in the tab bar.
  expect(src("mods/pdk-pane/main.js")).toContain('segmentedChoice(t, `ph-view-${pane}`, AGENT_VIEWS, "main",');
  expect(src("mods/pdk-chat/main.js")).toContain('segmentedChoice(t, "chat-view", AGENT_VIEWS, "chat", () => this.openTerminal(),');
  expect(src("mods/pdk-tabs/main.js")).not.toMatch(/AGENT_VIEWS|view-toggle/);
});

test("the tab bar names a remote workspace's machine with machineLabel, before its tabs", () => {
  const tabs = src("mods/pdk-tabs/main.js");
  expect(tabs).toMatch(/const remote = space\?\.machine \? machineLabel\(space\.machine\) : null;/);
  expect(tabs.indexOf('"tab-machine"')).toBeLessThan(tabs.indexOf('"tab-scroll"'));
});

test("request 14: beside a mark the words are the tab's or pane's own name; the kind is in the mark and the accessible name", () => {
  const w = world();
  w.terminals[1].name = "research-mods";
  const rows = treeRows(buildPaneTree(w));
  expect(rowSpec(rows.find((r) => r.key === "tb:A1"))).toMatchObject({ text: "lead", badge: null, mark: { label: "Claude Code" }, aria: "Claude Code, lead agent of tab lead, shown, expanded" });
  const child = rowSpec(rows.find((r) => r.key === "pn:p2"));
  expect(child).toMatchObject({ text: "research-mods", mark: { agent: true, label: "Codex" } });
  expect(child.aria).toBe("Sub-agent pane research-mods, Codex");
  // A plain shell tab: the terminal mark and the tab's name.
  expect(rowSpec(rows.find((r) => r.key === "tb:B1"))).toMatchObject({ text: "checks", mark: { agent: false, label: "Terminal" } });
});

test("request 20: no footer in the tree (pdk-usage's bar holds Settings); Add machine is Herdr's own dialog, from Cmd+K and the sidebar", () => {
  const tree = src("mods/pdk-tree/main.js");
  expect(tree).not.toMatch(/textButton\(t, "colours"|"machine-level"|border_t\(1\)/);
  expect(tree).not.toMatch(/colours|pdk-tokens/); // the token editor is retired (spec §8)
  expect(src("adapters/search-commands.js")).toContain('["machine-add","Add machine","Connect another computer",{name:"mod.open",args:{name:"pdk-machine-add"}}]');
});

test("detail: an agent row's mark starts where its workspace's name does; each level's thin line runs under its parent's mark, at every depth", () => {
  const tree = src("mods/pdk-tree/main.js");
  // The constants are scale names (request 21): read the scale from shared/ui.js and resolve them.
  const UI = src("shared/ui.js");
  const table = (n) => JSON.parse(UI.match(new RegExp(`export const ${n} = (\\{[^}]*\\});`))[1].replace(/(\w+):/g, '"$1":'));
  const scale = { SPACE: table("SPACE"), ICON: table("ICON") };
  const k = {};
  for (const name of ["SPACE_X", "MARK_W", "GAP", "LINE"]) {
    const [, group, step] = tree.match(new RegExp(`const ${name} = (SPACE|ICON)(?:\\[(\\d+)\\]|\\.(\\w+));`)).filter(Boolean);
    k[name] = scale[group][step];
  }
  // Owner, 11 Nov: a workspace's tab rows start at its name's left edge (both rows SPACE_X in); children keep a level.
  expect(tree).toMatch(/const NAME_X = SPACE_X;/);
  k.NAME_X = k.SPACE_X;
  expect(tree).toMatch(/h\(ROW\)\.pl\(SPACE_X - 1\)\.pr\(SPACE_X - 1\)/);
  expect(tree).toMatch(/return this\.row\(t, key, sel, on\)\.pl\(NAME_X - 1\)/);
  // A child's first cell starts CHILD_X (below 0) from the row's edge, as a margin; the row itself has no left padding.
  expect(tree).toMatch(/h_flex\(\)\.flex_none\(\)\.ml\(CHILD_X - 1\)\.children\(item\.lines/);
  expect(tree).toMatch(/return this\.row\(t, spec\.key, sel, on\)\n/);
  expect(tree).toMatch(/const LINE_AT = GAP \+ MARK_W \/ 2;/);
  expect(tree).toMatch(/const CHILD_X = NAME_X \+ MARK_W \/ 2 - LINE_AT;/);
  const LINE_AT = k.GAP + k.MARK_W / 2;
  const CHILD_X = k.NAME_X + k.MARK_W / 2 - LINE_AT;
  // A tab row's mark centre, then each child level's: the next level's line must sit exactly there.
  const markCentre = (depth) => (depth < 0 ? k.NAME_X + k.MARK_W / 2 : CHILD_X + (depth + 1) * k.LINE + k.GAP + k.MARK_W / 2);
  const lineAt = (depth) => CHILD_X + depth * k.LINE + LINE_AT;
  for (const d of [0, 1, 2, 3]) expect(lineAt(d)).toBe(markCentre(d - 1));
  // The branch tick reaches its cell's end and stops short of the mark.
  expect(k.LINE - LINE_AT).toBeGreaterThan(0);
});

test("request 22: workspace and agent names at the body step, medium at most; meta in the small step", () => {
  const tree = src("mods/pdk-tree/main.js");
  // Only the 11/12/13 steps, and no bold anywhere in the tree.
  expect(tree).not.toMatch(/TYPE\.md|font_bold\(/);
  const space = tree.slice(tree.indexOf("  spaceRow("), tree.indexOf("  tabRow("));
  expect(space).toMatch(/text_size\(TYPE\.base\)\.font_medium\(\)\.text_color\(t\.foreground\)/);
  const git = tree.slice(tree.indexOf("  gitTail("), tree.indexOf("  spaceRow("));
  expect(git).toMatch(/text_size\(TYPE\.xs\)/);
  // Every row 28 with 13 px names (visual contract): the agent rows' ink is softInk, foreground on hover.
  expect(tree).toMatch(/const ROW = ROWS\.agent;/);
  expect(tree).toMatch(/div\(\)\.min_w\(0\)\.truncate\(\)\.text_size\(TYPE\.base\)\.child\(spec\.text\)/);
  expect(tree).toMatch(/\{ on, sel, color: softInk\(t\) \}/);
});

test("R3, R8: the tree's keys act on the rows drawn", () => {
  const space = { type: "space", key: "sp:A" };
  const pane = { type: "pane", key: "pn:p1", node: { items: [] } };
  expect([keyAction("down", null), keyAction("up", pane), keyAction("end", space)]).toEqual([{ move: 1 }, { move: -1 }, { move: Infinity }]);
  expect(keyAction("enter", pane)).toEqual({ activate: true });
  expect(keyAction("right", pane)).toBe(null); // nothing under it to fold
  expect(keyAction("left", space)).toEqual({ fold: "close" });
  expect(keyAction("+", space)).toBe(null); // one + in the sidebar, a button (spec §3)
  expect(keyAction("h", space)).toBe(null);
  // The mod builds its key list from the drawn items and keeps the row on screen.
  const tree = src("mods/pdk-tree/main.js");
  expect(tree).toMatch(/this\.nav = items\.map\(\(i\) => i\.nav\);/);
  expect(tree).toMatch(/this\.treeScroll\.scroll_to_item\(at\)/);
});

test("design items 1, 5, 6, 12: mono metadata, flat segments, records as the neutral glyph, 24px targets", () => {
  const tree = src("mods/pdk-tree/main.js");
  const tabs = src("mods/pdk-tabs/main.js");
  // 1: times, counts, git and the agents line's ids and percentages in the mono face.
  for (const re of [/mono\(div\(\)\.text_size\(TYPE\.xs\)\.text_color\(t\.dim\)\.child\(`×\$\{c\.n\}`\)\)/, /return mono\(h_flex\(\)\)\.id\(`\$\{key\}-git`\)/]) expect(tree).toMatch(re);
  // 5: 28x24 segments, radius 4, 4px apart, no inner border or padding, in the field and in the tab bar.
  // Now the shared segmentedChoice (C6), whose icon segments are 28 by 24 at radius 4, 4px apart.
  expect(tabs).toMatch(/segmentedChoice\(t, "place-toggle", PLACE_VIEWS, [^\n]*\n\s+\{ variant: "navigation"/);
  // 6: an in-process record is the neutral agent glyph, whatever kind its parent reports.
  const w = world();
  w.terminals[0].records = { r1: { state: "working", title: "Explore", kind: "claude" } };
  const rec = treeRows(buildPaneTree(w)).find((r) => r.type === "rec");
  expect(rowSpec(rec).mark).toEqual({ agent: true, record: true, label: "In-process record" });
  // 12: caret and + targets 24px high, the keyboard ring in the accent.
  // Marks whole at 14 (visual contract), never dimmed or faded.
  expect(tree).toMatch(/kindMarker\(t, \{ \.\.\.spec\.mark, ground: "chrome" \}, ICON\.base, t\.muted/);
  expect(tree).not.toMatch(/opacity\(0\.5\)/);
  expect(tree).toContain('plusButton(t, "space-new", words, () => run("pdk-tabs.new-workspace"))');

});

test("consistency C6, C7, C10, C13, C14: shared focus, row states, fixed tab slots, target sizes and fitted labels", () => {
  const tree = src("mods/pdk-tree/main.js");
  const tabs = src("mods/pdk-tabs/main.js");
  const ui = src("shared/ui.js");
  // C6: a tab takes focus and Enter or Space shows it;
  // the tab bar says which tab is shown, not which Herdr last chose, while the Factory is up.
  expect(tabs).toMatch(/focusRing\(h_flex\(\), t, pick\)\.id\(`tab-\$\{c\.id\}`\)/);
  expect(tabs).toMatch(/\.role\("tab"\)\.aria_selected\(active\)/);
  expect(tabs).toMatch(/run\("tab\.select", \{ id: c\.id \}\); if \(this\.shown\(\) === "factory"\) this\.select\("main"\)/);
  expect(tabs).toMatch(/run\("tab\.rename", \{ id: c\.id \}\)/);
  expect(tabs).toMatch(/run\("tab\.move", /);
  // C7: every clickable tree row takes the shared row states on a clear ground.
  expect(tree).toMatch(/const states = \(el, t, \{ on = false, sel = false, color = t\.foreground \} = \{\}\) => rowStates\(el, t, \{ selected: on, focused: sel, ground: CLEAR, color, ring: 2 \}\)/);
  expect(tree.match(/states\(h_flex\(\)\.id\(key\)/g).length).toBe(2); // the workspace row and the agent rows
  expect(tree).not.toMatch(/\.hover\(\(el\) => el\.bg\(t\.hover\)\)/);
  expect(ui).toMatch(/\.hover\(\(el\) => el\.bg\(fgStep\(t, t\.hover\)\)\)\n\s+\.role\("button"\)\.accessibility_label\(label\)\.tooltip\(label\)\n\s+\.on_click/);
  // C10: the status slot (14) and the close slot (20) are always there; Close shows on the shown tab, on hover or
  // on focus, so the tab's width never changes.
  expect(tabs).toMatch(/div\(\)\.w\(ICON\.base\)\.flex_none\(\)[^\n]*children\(\[statusMarker\(t, word/);
  expect(tabs).toMatch(/const closeShown = active \|\| this\.hoverTab === c\.id;/);
  expect(tabs).toMatch(/color: closeShown \? t\.muted : CLEAR \}\)\n\s+\.w\(CLOSE_W\)\.px\(0\)\.focus\(/);
  expect(tabs).toMatch(/\.child\(close\);/);
  expect(tabs).toMatch(/\.h\(ROW\.base\)\.px\(SPACE\[2\]\)\.gap\(SPACE\[2\]\)\.rounded\(RADIUS\.md\)/); // 28-high tabs (visual contract)
  // C13 (visual contract): the tab's close glyph in a 16 px slot, the tab bar's + 24 by 24 with its key in a tooltip.
  expect(tree).not.toMatch(/h: 22/);
  expect(tabs).toMatch(/const CLOSE_W = SPACE\[4\];/);
  expect(tabs).toMatch(/tooltip\(t, "tab-new-tip", plusButton\(t, "tab-new", "New tab", [^\n]+\n\s+"New tab", \{ keys: shortcut\("tab\.new"\) \?\? \[\] \}\)\)/);
  // C14: the tab's name keeps its full words in its accessible name when it truncates.
  expect(tabs).toMatch(/fitLabel\(`tab-name-\$\{c\.id\}`, /);
});

test("request 37: a folded workspace row is its name, caret and counts only; open, the branch comes back", () => {
  const w = world();
  const rows = treeRows(buildPaneTree(w));
  const folded = rowSpec(rows.find((r) => r.key === "sp:A"), new Set(["sp:A"]));
  expect(folded.plus).toBeNull(); // one + in the sidebar, none per workspace (spec §3)
  expect(folded.git).toBe(false);
  expect(folded.rollup.length).toBeGreaterThan(0);
  const open = rowSpec(rows.find((r) => r.key === "sp:A"), new Set());
  expect(open.plus).toBeNull();
  expect(open.git).toBe(true);
  expect(open.rollup).toEqual([]);
  // The row draws the + and the git only from those (mods/pdk-tree spaceRow), and no compact git string is left.
  const tree = src("mods/pdk-tree/main.js");
  expect(tree).not.toMatch(/openNew|renderNew|part: "new"/);
  expect(tree).toMatch(/spec\.git \? this\.gitTail\(t, key, s\) : null/);
  expect(tree).not.toMatch(/gitTail\(t, key, s, compact\)/);
});

// One way in (lead, 11 Nov): Add machine is the machine selector's last entry, so the row pinned under the list, above
// the usage foot, is gone; the list is the sidebar's last part. Cmd+K's Add machine stays.
test("Add machine is only in the machine selector's menu: no pinned row under the list", () => {
  const w = harnessWorld(), h = harness(w); const tree = new h.Tree(); tree.init({}, h.cx); h.tasks.length = 0;
  h.clear(); const root = tree.render(h.cx);
  expect(h.byId("machine-add")).toBeUndefined();
  expect(root.kids.at(-1).props.id).toBe("tree-viewport");
  expect(h.elements.filter((e) => e.kids.includes("Add machine")).length).toBe(1); // the menu's entry
  expect(src("mods/pdk-tree/main.js")).not.toMatch(/button\(t, "machine-add"/);
  expect(src("adapters/search-commands.js")).toContain('["machine-add","Add machine","Connect another computer",{name:"mod.open",args:{name:"pdk-machine-add"}}]');
});

// The add dialog's hand-off (pdk-tree.machine:<name>): the filter set to the new machine and `hc machine ls` read
// again at once, so its tab is there and chosen without waiting for the 15 s refresh.
test("choosing a machine sets the filter and reads the machine list again", async () => {
  const w = harnessWorld(), h = harness(w), asked = [];
  w.hc = async (args) => { asked.push(args.join(" ")); return { code: 0, stdout: JSON.stringify({ machines: [{ name: "box", state: "connected" }, { name: "hive", state: "connected" }] }), stderr: "" }; };
  const tree = new h.Tree(); tree.init({}, h.cx); h.tasks.length = 0; asked.length = 0;
  tree.setFilter("hive", h.cx);
  expect(h.store.get("pdk.machine.filter")).toBe("hive");
  await Promise.all(h.tasks.splice(0).map((task) => task(h.cx)));
  expect(asked).toEqual(["machine ls --json"]);
  expect(tree.listed.map((m) => m.name)).toEqual(["box", "hive"]);
});
