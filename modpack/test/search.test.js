// The Cmd+K palette's model (adapters/search.js, mods/pdk-search): every kind found, named as the sidebar names it,
// the command each pick runs, two machines and a 100-row world.
import { test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { searchRows, filterRows, groupRows, keepInView, machineNames, KINDS, SearchSelection } from "../adapters/search.js";
import { agentKind, kindName } from "../adapters/agents.js";

const kindOf = (t) => { const k = agentKind(t); return k ? kindName(k) : null; };
const claude = { name: "Claude Code", key: "claude", agent: true };
const codex = { name: "Codex", key: "codex", agent: true };
const zsh = { name: "zsh", key: "zsh", shell: true };
const tab = (id, name, extra = {}) => ({ id, name, named: true, active: false, settled: false, ...extra });
const pane = (p, tabId, terminal, program, extra = {}) => ({ pane: p, tab: tabId, terminal, program, title: "", focused: false, cwd: "/w", ...extra });
const term = (address, extra = {}) => ({ address, state: "live", parent: null, status: null, records: {}, ...extra });

// This computer: core-client (a Claude lead with a Codex worker in its own pane and a paneless background
// sub-agent; a review tab with a shell and Codex). The machine "box": web, one tab with a shell (Core's own
// `$SHELL -l`). A third machine, "idle", is connected with no workspaces.
function world({ remote = true } = {}) {
  const spaces = [
    { id: "A", name: "core-client", machine: null, active: true, tabs: [tab("A1", "lead", { active: true }), tab("A2", "review")] },
    ...(remote ? [{ id: "box/W", name: "web", machine: "box", active: false, tabs: [tab("box/W1", "build", { active: true })] }] : []),
  ];
  const panes = [
    pane("p1", "A1", "t1", claude, { focused: true }),
    pane("p2", "A1", "t2", codex),
    pane("p3", "A2", "t3", zsh),
    pane("p4", "A2", "t4", codex),
    ...(remote ? [pane("box/p1", "box/W1", "box/t1", zsh)] : []),
  ];
  const terminals = [
    term("t1", { status: "working", argv: ["claude"], foreground: { pid: 11, name: "claude", argv: ["claude"] }, records: { r1: { state: "working", title: "Explore" }, "r1/r2": { state: "idle", title: "Read docs" } } }),
    term("t2", { parent: "t1", status: "idle", name: "worker", argv: ["codex"] }),
    term("t3", { pid: 13, foreground: { pid: 13, name: "zsh", argv: ["/bin/zsh", "-l"] } }),
    term("t4", { status: "blocked", argv: ["codex"] }),
    term("t8", { parent: "t1", status: "working", name: "background", argv: ["codex"] }),
    ...(remote ? [term("box/t1", { pid: 21, foreground: { pid: 21, name: "zsh", argv: ["/bin/zsh", "-l"] } })] : []),
  ];
  const agents = [{ address: "t1", status: "working" }, { address: "t2", status: "idle" }, { address: "t4", status: "blocked" }, { address: "t8", status: "working" }];
  const machines = [{ name: null, layout: "ready" }, ...(remote ? [{ name: "box", layout: "ready" }, { name: "idle", layout: "ready" }] : [])];
  return { spaces, panes, terminals, agents, machines, kindOf };
}

// A row as text: its mark's kind in braces (agent marks {A:…}, terminal marks {T:…}), then its name and place.
const show = (rows) => rows.map((r) => `${r.kind}:${r.mark ? `{${r.mark.agent ? "A" : "T"}:${r.mark.label}} ` : ""}${r.label}${r.detail ? ` @ ${r.detail}` : ""}`);

test("every machine, workspace, tab, agent and pane, grouped by kind and named as the sidebar names them", () => {
  const rows = searchRows(world());
  expect([...new Set(rows.map((r) => r.kind))]).toEqual(KINDS);
  // Agents first (the visual contract's palette), then panes, workspaces and machines.
  expect(show(rows)).toEqual([
    // Owner request 14: the lead's mark, then the tab's own name (no badge); a tab of shells: the terminal mark.
    "tab:{A:Claude Code} lead @ This computer › core-client",
    "tab:{A:Codex} review @ This computer › core-client",
    "tab:{T:Terminal} build @ box › web",
    // One destination per running agent (assessment rank 7): a lead is its tab's row, not a second agent row; the
    // paneless sub-agent is listed.
    "agent:{A:Codex} worker @ This computer › core-client › lead",
    "agent:{A:Agent} background @ This computer › core-client › lead", // no pane and no detected kind: the generic mark
    // In-process sub-agents (7501 records), nested as in the tree.
    "agent:{A:Claude Code} Explore @ This computer › core-client › lead", // its owner's mark
    "agent:{A:Claude Code} Read docs @ This computer › core-client › lead",
    "pane:{T:zsh} Terminal @ This computer › core-client › review",
    // box's build tab has one pane: one row, the tab's, as in the sidebar (owner, 10 Nov).
    "workspace:core-client @ This computer",
    "workspace:web @ box",
    "machine:This computer @ 1 workspace",
    "machine:box @ 1 workspace",
    "machine:idle @ No workspaces",
  ]);
  // Every row has an accessible name that says its kind, name and place.
  for (const r of rows) expect(r.aria).toMatch(new RegExp(`^(Machine|Workspace|Tab|Agent|Pane) `));
  // The kind the mark stands for is in the accessible name.
  expect(rows.find((r) => r.key === "tb:A1").aria).toBe("Tab lead, Claude Code, lead agent of this tab, in This computer › core-client");
  expect(rows.find((r) => r.key === "pn:p2").aria).toBe("Agent worker, Codex, in This computer › core-client › lead");
});

test("an unnamed tab shows its lead pane's name beside the mark; a tab of shells keeps its own name", () => {
  const w = world({ remote: false });
  w.spaces[0].tabs.push(tab("A3", "3", { named: false }));
  w.panes.push(pane("p9", "A3", "t9", claude));
  w.terminals.push(term("t9", { name: "planner", status: "idle", argv: ["claude"] }));
  w.agents.push({ address: "t9", status: "idle" });
  const r = searchRows(w).find((x) => x.key === "tb:A3");
  expect([r.label, r.mark, r.badge]).toEqual(["planner", { agent: true, label: "Claude Code" }, undefined]);
  expect(r.aria).toBe("Tab planner, Claude Code, lead agent of this tab, in core-client");
});

test("a machine with nothing listed says why: loading, unavailable or empty", () => {
  const w = world();
  w.machines = [{ name: null, layout: "ready" }, { name: "box", layout: "ready" }, { name: "idle", layout: "unavailable" }, { name: "new", layout: "loading" }];
  const d = (key) => searchRows(w).find((r) => r.key === key).detail;
  expect([d("mc:idle"), d("mc:new"), d("mc:box")]).toEqual(["Unavailable", "Loading…", "1 workspace"]);
  // A record's kind is in its accessible name, and typing its owner's kind finds it.
  const rec = searchRows(w).find((r) => r.key === "rc:t1#r1");
  expect(rec.mark.record).toBe(true);
  expect(rec.aria).toBe("Agent Explore, Claude Code in-process sub-agent, in This computer › core-client › lead");
  expect(filterRows([rec], "claude explore")).toEqual([rec]);
});

test("one machine: no machine in any row's place", () => {
  const rows = searchRows(world({ remote: false }));
  expect(rows.filter((r) => r.kind === "machine").map((r) => r.label)).toEqual(["This computer"]);
  expect(rows.find((r) => r.key === "pn:p3").detail).toBe("core-client › review");
  expect(rows.find((r) => r.key === "sp:A").detail).toBe("");
});

test("machines come from Herdr only: this computer first, then machines() and the spaces' own, by name", () => {
  expect(machineNames([{ name: null }, { name: "zed" }], [{ machine: "box" }, { machine: null }])).toEqual([null, "box", "zed"]);
  expect(machineNames([], [])).toEqual([null]);
});

test("typing filters across all five kinds: every word must appear in a row's name, badge, kind or place", () => {
  const rows = searchRows(world());
  const kinds = (q) => [...new Set(filterRows(rows, q).map((r) => r.kind))];
  // The machine's name matches the machine and everything on it.
  expect(show(filterRows(rows, "box"))).toEqual(["tab:{T:Terminal} build @ box › web", "workspace:web @ box", "machine:box @ 1 workspace"]);
  expect(kinds("core")).toEqual(["tab", "agent", "pane", "workspace"]);
  // The kind still matches when it is drawn as a mark.
  expect(show(filterRows(rows, "CODEX review"))).toEqual(["tab:{A:Codex} review @ This computer › core-client"]);
  expect(show(filterRows(rows, "zsh review"))).toEqual(["pane:{T:zsh} Terminal @ This computer › core-client › review"]);
  // What runs in a pane counts: "claude" finds the lead's tab (its one row) and its in-process sub-agents.
  expect(filterRows(rows, "claude").map((r) => r.key)).toEqual(["tb:A1", "rc:t1#r1", "rc:t1#r1/r2"]);
  // A match on each kind at once, as in the filtered shot.
  expect(kinds("o")).toEqual(KINDS);
  expect(filterRows(rows, "nothing-like-this")).toEqual([]);
  expect(filterRows(rows, "  ")).toBe(rows);
});

test("each pick runs the app command that focuses its target", () => {
  const rows = searchRows(world());
  const cmd = (key) => rows.find((r) => r.key === key).command;
  // A machine shows its first workspace; one with none has nothing to show.
  expect(cmd("mc:")).toEqual({ name: "space.select", args: { id: "A" } });
  expect(cmd("mc:box")).toEqual({ name: "space.select", args: { id: "box/W" } });
  expect(cmd("mc:idle")).toBe(null);
  expect(cmd("sp:box/W")).toEqual({ name: "space.select", args: { id: "box/W" } });
  // An agent-led tab focuses its lead's pane (pane.focus selects the pane's tab and space, herdr-app
  // src/model.rs:439-444); a tab of shells is selected. The lead has no second row.
  expect(cmd("tb:A1")).toEqual({ name: "pane.focus", args: { pane: "p1" } });
  expect(cmd("tb:A2")).toEqual({ name: "pane.focus", args: { pane: "p4" } });
  expect(cmd("tb:box/W1")).toEqual({ name: "tab.select", args: { id: "box/W1" } });
  expect(rows.some((r) => r.key === "pn:p1")).toBe(false);
  expect(cmd("pn:p2")).toEqual({ name: "pane.focus", args: { pane: "p2" } });
  expect(rows.some((r) => r.key === "pn:box/p1")).toBe(false); // a tab of one pane: its tab's row shows it
  // A sub-agent without a pane is peeked, as a click on it in the tree does.
  expect(cmd("tm:t8")).toEqual({ name: "terminal.peek", args: { terminal: "t8" } });
  // An in-process sub-agent focuses the pane of the terminal that reports it.
  expect(cmd("rc:t1#r1/r2")).toEqual({ name: "pane.focus", args: { pane: "p1" } });
  // The list skips what has nothing to show: groupRows keeps it visible, the mod picks only rows with a command.
  expect(groupRows(rows).filter((r) => !r.head && !r.command).map((r) => r.key)).toEqual(["mc:idle"]);
});

test("the drawn list has a heading per kind and keeps the selected row in view", () => {
  const list = groupRows(searchRows(world()));
  expect(list.filter((r) => r.head).map((r) => `${r.label} ${r.count}`)).toEqual(["Tabs 3", "Agents 4", "Panes 1", "Workspaces 2", "Machines 3"]);
  expect(keepInView(40, 0, 0, 12)).toBe(0);
  expect(keepInView(40, 15, 0, 12)).toBe(4);
  expect(keepInView(40, 5, 10, 12)).toBe(4); // moving up brings the heading above along
  expect(keepInView(40, 39, 0, 12)).toBe(28);
  expect(keepInView(5, 4, 3, 12)).toBe(0);
});

test("100 rows and more: the model is cheap and only the rows in view are drawn", () => {
  const spaces = [], panes = [], terminals = [];
  for (let s = 0; s < 6; s++) {
    const machine = s < 4 ? null : "box";
    const tabs = [];
    for (let k = 0; k < 6; k++) {
      const id = `${machine ? "box/" : ""}S${s}T${k}`;
      tabs.push(tab(id, `tab ${k}`));
      for (let p = 0; p < 3; p++) {
        const addr = `${machine ? "box/" : ""}t${s}${k}${p}`;
        panes.push(pane(`${id}P${p}`, id, addr, p ? codex : zsh));
        terminals.push(term(addr, p ? { status: "working", argv: ["codex"] } : { pid: 1, foreground: { pid: 1, name: "zsh", argv: ["/bin/zsh", "-l"] } }));
      }
    }
    spaces.push({ id: `${machine ? "box/" : ""}S${s}`, name: `work ${s}`, machine, active: s === 0, tabs });
  }
  const input = { spaces, panes, terminals, agents: [], machines: [{ name: null }, { name: "box" }], kindOf };
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) groupRows(filterRows(searchRows(input), i % 2 ? "work 4" : ""));
  const each = (performance.now() - t0) / 20;
  const rows = searchRows(input);
  expect(rows.length).toBeGreaterThanOrEqual(100);
  // Here a pass takes well under a millisecond; QuickJS is slower, so the bound is generous (the app's render
  // deadline is 50 ms, gpui-kit shell/src/engine/quickjs/sandbox.rs:439). The real-app check is in the report.
  expect(each).toBeLessThan(10);
  const src = readFileSync(new URL("../mods/pdk-search/main.js", import.meta.url), "utf8");
  expect(src).toMatch(/list\.slice\(this\.top, this\.top \+ SHOWN\)/);
});

test("the mod is opened by mod.open:pdk-search, draws the search glyph and takes colours from the theme only", () => {
  const src = readFileSync(new URL("../mods/pdk-search/main.js", import.meta.url), "utf8");
  const mod = JSON.parse(readFileSync(new URL("../mods/pdk-search/mod.json", import.meta.url), "utf8"));
  expect(mod.overlay.kind).toBe("popup");
  expect(src).toMatch(/icon\("search", /);
  // Request 14: a mark (kindMarker) before the name; the kind as words only on rows without one.
  expect(src).toMatch(/kindMarker\(t, r\.mark, /);
  expect(src).toMatch(/!r\.mark && r\.what/);
  expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  // Every row and the field have an accessible name.
  expect(src).toMatch(/accessibility_label\(`\$\{r\.aria\}/);
  expect(src).toMatch(/Input\.new\(this\.input\)[^\n]*accessibility_label\(/);
  const keys = JSON.parse(readFileSync(new URL("../keys.json", import.meta.url), "utf8"));
  expect(keys).toEqual({ "layout:tremor": { "cmd-k": "mod.open:pdk-search", "cmd-p": "mod.open:pdk-search" } });
});

test("no mod draws a literal \"$\" as a mark: shells go through the shared kindMarker", () => {
  // kindMarker (shared/ui.js) is the one place a shell's mark is chosen; build-media turns it into the Moshi
  // terminal glyph. A "$" written in a mod would bypass that.
  const mods = new URL("../mods/", import.meta.url).pathname;
  const files = readdirSync(mods).flatMap((m) => readdirSync(`${mods}${m}`).filter((f) => f.endsWith(".js")).map((f) => `${mods}${m}/${f}`));
  expect(files.length).toBeGreaterThan(8);
  for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/(["'`])\$\1/);
  // The palette's shell rows carry a terminal mark for kindMarker, never text.
  const shell = searchRows(world()).find((r) => r.key === "pn:p3");
  expect(shell.mark).toEqual({ agent: false, label: "zsh" });
});


test("R6: live insertion/removal before a chosen result preserves identity and re-resolves its command", () => {
  const a = { key: "a", command: { name: "pane.focus", args: { pane: "p1" } } };
  const b = { key: "b", command: { name: "pane.focus", args: { pane: "p2" } } };
  const choice = new SearchSelection();
  choice.move([a, b], 1);
  expect(choice.current([a, b])).toBe(b);
  const updated = { ...b, command: { name: "terminal.peek", args: { terminal: "new-address" } } };
  expect(choice.current([{ key: "new", command: {} }, a, updated])).toBe(updated);
  expect(choice.current([updated])).toBe(updated);
  expect(choice.current([a])).toBeNull();
  expect(choice.missing).toBe(true);
  // Return alone never clears the explicit reselection requirement.
  expect(choice.current([a, updated])).toBeNull();
  choice.move([a, updated], 1);
  expect(choice.current([a, updated])).toBe(a);
  choice.choose("b");
  expect(choice.current([updated])).toBe(updated);
  choice.reset();
  expect(choice.current([a, updated])).toBe(a);
});

// Assessment rank 7: "Claude Code" once, not under both Tabs and Agents.
test("one destination per running agent: a tab's lead is its tab row only; other agents keep their own", () => {
  const rows = searchRows(world());
  // The leads (Claude in "lead", Codex in "review") have no row of their own; their tab rows focus them.
  expect(rows.some((r) => r.key === "pn:p1" || r.key === "pn:p4")).toBe(false);
  expect([rows.find((r) => r.key === "tb:A1").command.args, rows.find((r) => r.key === "tb:A2").command.args]).toEqual([{ pane: "p1" }, { pane: "p4" }]);
  // Every other agent keeps exactly one row: the worker's pane, the paneless sub-agent, the in-process records.
  expect(rows.filter((r) => r.kind === "agent").map((r) => r.key)).toEqual(["pn:p2", "tm:t8", "rc:t1#r1", "rc:t1#r1/r2"]);
});

// Review UX14: the palette is as tall as its content, at most nine entries; mod.json gives the popup no height, so Herdr
// sizes it to the content (checked live: a two-result query draws no blank area).
test("the palette's list is as tall as what it shows, up to nine entries", async () => {
  const { harness, world, evaluate } = await import("./parity-harness.js");
  const search = await import("../adapters/search.js"), cmds = await import("../adapters/search-commands.js");
  const w = world(6), h = harness(w);
  Object.assign(h.env, search, cmds, { commands: () => [], layouts: () => [], keys: () => [], closeOverlay() {} });
  const Search = evaluate("mods/pdk-search/main.js", h.env, "Search");
  const v = new Search(); v.init({}, h.cx);
  const listH = (q) => { v.query = q; v.choice.reset(); v.top = 0; h.elements.length = 0; v.render(h.cx); return h.byId("pdk-search-list").props.h; };
  const ROW = h.ui.ROW, pad = 2 * h.ui.SPACE[1];
  expect(listH("zz-nothing")).toBe(ROW.base + pad);           // "Nothing matches"
  const all = listH(""), one = listH("Task 3");
  expect(all).toBeLessThanOrEqual(ROW.two * 9 + pad);          // the cap
  expect(one).toBeLessThan(all);
  expect([ROW.base + ROW.two + pad, 2 * (ROW.base + ROW.two) + pad]).toContain(one); // a heading and its row (or two)
  expect(JSON.parse(readFileSync(new URL("../mods/pdk-search/mod.json", import.meta.url), "utf8")).overlay.height).toBeUndefined();
});
