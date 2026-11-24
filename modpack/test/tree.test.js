import { test, expect } from "bun:test";
import { buildPaneTree, treeRows, kindOrProgram, rowSpec, tabHeads, tabRowOn, findRow } from "../adapters/status.js";
import { readFileSync } from "node:fs";

const claude = { name: "Claude Code", key: "claude", agent: true };
const codex = { name: "Codex", key: "codex", agent: true };
const zsh = { name: "zsh", key: "zsh", shell: true };

const tab = (id, name, extra = {}) => ({ id, name, named: true, active: false, settled: false, ...extra });
const pane = (pane, tabId, terminal, program, extra = {}) => ({ pane, tab: tabId, terminal, program, title: "", focused: false, cwd: "/w", ...extra });
const term = (address, extra = {}) => ({ address, state: "live", parent: null, status: null, records: {}, ...extra });

// Two workspaces, three tabs, splits. Workspace A: tab "lead" holds the Claude lead (working) split with its
// Codex child in a pane of its own, plus a background child with no pane; tab "review" holds a shell split with
// Codex. Workspace B: tab "checks" holds a shell and a Codex child of A's lead (its pane is in another tab), and
// a tab Herdr's tab.settle hid from its own lists (here a row like any other).
function world() {
  const spaces = [
    { id: "A", name: "core-client", active: true, tabs: [tab("A1", "lead", { active: true }), tab("A2", "review")] },
    { id: "B", name: "evals", active: false, tabs: [tab("B1", "checks", { active: true }), tab("B2", "old", { settled: true })] },
  ];
  const panes = [
    pane("p1", "A1", "t1", claude, { focused: true }),
    pane("p2", "A1", "t2", codex),
    pane("p3", "A2", "t3", zsh),
    pane("p4", "A2", "t4", codex),
    pane("p5", "B1", "t5", zsh),
    pane("p6", "B1", "t6", codex),
    pane("p7", "B2", "t7", zsh),
  ];
  const terminals = [
    term("t1", { status: "working", records: { r1: { state: "working", title: "Explore" }, "r1/r2": { state: "idle", title: "Read docs" } } }),
    term("t2", { parent: "t1", status: "idle", name: "worker" }),
    term("t3"),
    term("t4", { status: "blocked" }),
    term("t5"),
    term("t6", { parent: "t1", status: "done" }),
    term("t7"),
    term("t8", { parent: "t1", status: "working", name: "background" }),
    term("t9", { parent: "t1", state: "exited", name: "gone" }),
  ];
  const agents = [{ address: "t1", status: "working" }, { address: "t2", status: "idle" }, { address: "t4", status: "blocked" }, { address: "t6", status: "done" }];
  return { spaces, panes, terminals, agents };
}

const shape = (rows) => rows.map((r) => `${r.lines.join("")}${r.type}:${r.node.name ?? r.node.title}${r.node.badge ? `[${r.node.badge}]` : ""}`);

test("order is workspace, tab, pane; sub-agents under their parent's pane; a hidden-running tab is a row too", () => {
  const rows = treeRows(buildPaneTree(world()));
  expect(shape(rows)).toEqual([
    "space:core-client",
    "tab:lead",
    "├pane:worker",
    "├pane:background",
    "└rec:Explore",
    " └rec:Read docs",
    "tab:review",
    "└pane:Terminal",
    "space:evals",
    "tab:checks",
    "└pane:Terminal",
    "tab:old",
  ]);
});

test("every terminal appears once, and an exited child does not appear", () => {
  const rows = treeRows(buildPaneTree(world()));
  const addresses = rows.filter((r) => r.type === "pane").map((r) => r.node.address);
  expect(new Set(addresses).size).toBe(addresses.length);
  expect(addresses).not.toContain("t9");
  expect(addresses).not.toContain("t7");
});

test("words roll up: blocked tab, working lead over idle and working children, space takes the most urgent", () => {
  const model = buildPaneTree(world());
  const [a, b] = model;
  expect(a.tabs[0].word).toBe("working");
  expect(a.tabs[1].word).toBe("needs");
  expect(a.word).toBe("needs");
  // A done child in another tab: done is its parent's news, but it has a pane (and leads that tab), so its own
  // done shows on the tab row.
  expect(b.tabs[0].leadWord).toBe("done");
});

test("rows carry what the UI needs to focus a pane and follow selection", () => {
  const rows = treeRows(buildPaneTree(world()));
  const tab = rows.find((r) => r.key === "tb:A1");
  expect(tab.node.lead.pane).toBe("p1");
  expect(tab.node.lead.focused).toBe(true);
  expect(tab.space.id).toBe("A");
  expect(rows.find((r) => r.type === "pane" && r.node.address === "t1")).toBe(undefined);
  const bg = rows.find((r) => r.node.address === "t8");
  expect(bg.node.pane).toBe(null);
  expect(bg.node.sub).toBe(true);
});

test("folding a tab hides its panes; folding a space hides its tabs", () => {
  const model = buildPaneTree(world());
  expect(shape(treeRows(model, new Set(["tb:A1"]))).slice(0, 3)).toEqual(["space:core-client", "tab:lead", "tab:review"]);
  expect(shape(treeRows(model, new Set(["sp:A"])))[1]).toBe("space:evals");
});

test("adding and closing panes and tabs changes the rows on the next read (live lists, no cache)", () => {
  const w = world();
  w.panes.push(pane("p8", "A2", "t10", zsh));
  w.terminals.push(term("t10", { name: "added" }));
  expect(shape(treeRows(buildPaneTree(w)))).toContain("└pane:added");
  w.spaces[0].tabs = w.spaces[0].tabs.filter((t) => t.id !== "A2");
  w.panes = w.panes.filter((p) => p.tab !== "A2");
  const after = shape(treeRows(buildPaneTree(w)));
  expect(after).not.toContain("tab:review");
  expect(after).not.toContain("└pane:added");
});

test("a child whose pane comes first in the list still nests under its parent", () => {
  const w = world();
  w.panes = [w.panes[1], w.panes[0], ...w.panes.slice(2)];
  const rows = shape(treeRows(buildPaneTree(w)));
  expect(rows.slice(1, 3)).toEqual(["tab:lead", "├pane:worker"]);
});

// The lead, phase 2: a shell row is "Terminal" like every other; an agent pane is called by its agent. Neither a
// title, a folder, "/" nor a terminal id names a pane; Core's own name for the terminal does.
test("a pane is called by Core's name for it, else by what runs there: never its title, folder or address", () => {
  const w = world();
  w.panes[2].title = "t3";
  w.panes[3].title = "Build the mod pack";
  w.panes[2].cwd = "/";
  const rows = shape(treeRows(buildPaneTree(w)));
  expect(rows.slice(6, 8)).toEqual(["tab:review", "└pane:Terminal"]);
  w.terminals[2].name = "server";
  expect(shape(treeRows(buildPaneTree(w))).slice(6, 8)).toEqual(["tab:review", "└pane:server"]);
});

test("a mod pane is a plain row under its tab", () => {
  const w = world();
  w.panes.push({ pane: "p9", tab: "B1", terminal: null, mod: "files", title: "Files", focused: false });
  const rows = shape(treeRows(buildPaneTree(w)));
  expect(rows.slice(-4)).toEqual(["tab:checks", "├pane:Terminal", "└pane:Files", "tab:old"]);
});

test("a detected agent kind names the row, not its launcher's program (Hermes under Python)", () => {
  const w = world();
  const python = { name: "Python", key: "python", agent: false };
  w.panes.push(pane("p9", "B1", "t11", python, { title: "t11" }));
  w.terminals.push(term("t11"));
  const kindOf = (t) => (t.address === "t11" ? "Hermes" : null);
  const row = treeRows(buildPaneTree({ ...w, kindOf })).find((r) => r.node.address === "t11");
  // An agent pane is called by its agent; the kind is Hermes, for the mark and the accessible name too.
  expect(row.node.name).toBe("Hermes");
  expect(row.node.kindName).toBe("Hermes");
  expect(row.node.agent).toBe(true);
  expect(rowSpec(row).mark).toEqual({ agent: true, label: "Hermes" });
  // Without a detected kind the kind is the program.
  expect(rowSpec(treeRows(buildPaneTree(w)).find((r) => r.node.address === "t11")).mark.label).toBe("Python");
  expect(kindOrProgram("Hermes", python)).toBe("Hermes");
  expect(kindOrProgram(null, python)).toBe("Python");
  expect(kindOrProgram(null, null, "Sub-agent")).toBe("Sub-agent");
});

// Sidebar polish (owner 10:59, Claude Desktop's tree): carets after names, no monograms. Spec §3: one + in the
// sidebar, none per workspace.
test("a workspace row: bold name, a solid caret right after it that folds, no + of its own", () => {
  const rows = treeRows(buildPaneTree(world()));
  const ws = rowSpec(rows[0]);
  expect(ws).toMatchObject({ text: "core-client", strong: true, click: "fold" });
  expect(ws.caret).toEqual({ open: true, solid: true, label: "Collapse workspace core-client" });
  expect(ws.plus).toBeNull();
  expect(rowSpec(rows[0], new Set(["sp:A"])).caret).toMatchObject({ open: false, label: "Expand workspace core-client" });
});

test("a tab row: a grey caret that folds its panes", () => {
  const rows = treeRows(buildPaneTree(world()));
  const tab = rowSpec(rows.find((r) => r.key === "tb:A2"));
  expect(tab).toMatchObject({ text: "review", badge: null, strong: false, plus: null, mark: { agent: true, label: "Codex" } });
  expect(tab.caret).toEqual({ open: true, solid: false, label: "Collapse tab review" });
});

// Spec §7: no metadata tooltip on a row; the kind stays in the accessible name and the mark.
test("pane rows draw no monogram of their own and carry no tooltip: the kind is in the accessible name and kindMarker", () => {
  const w = world();
  const python = { name: "Python", key: "python", agent: false };
  w.panes.push(pane("p9", "B1", "t11", python, { title: "t11" }));
  w.terminals.push(term("t11"));
  const rows = treeRows(buildPaneTree({ ...w, kindOf: (t) => (t.address === "t11" ? "Hermes" : null) }));
  const zsh = rowSpec(rows.find((r) => r.node?.address === "t3"));
  expect(zsh).toMatchObject({ text: "Terminal", child: true, click: "focus", mark: { agent: false, label: "zsh" } });
  expect(zsh.aria).toBe("Pane Terminal, zsh");
  expect(zsh.tooltip).toBeUndefined();
  expect(Object.keys(zsh)).not.toContain("marker");
  // Hermes leads the checks tab only if it comes first; here Codex (t6) does, so Hermes keeps its pane row.
  const hermes = rowSpec(rows.find((r) => r.node?.address === "t11"));
  expect(hermes.aria).toBe("Pane Hermes, Hermes");
  const bg = rowSpec(rows.find((r) => r.node?.address === "t8"));
  expect(bg.aria).toBe("Sub-agent without a pane background, Sub-agent");
  // Agent marks on rows (owner 17:40 request 5, 17:52 request 8c) come only from shared/ui.js's kindMarker
  // (build-media draws the Moshi marks there); the tree never draws a monogram itself.
  const tree = readFileSync(new URL("../mods/pdk-tree/main.js", import.meta.url), "utf8");
  expect(/kindMonogram\(/.test(tree)).toBe(false);
  expect(/kindMarker\(t, \{ \.\.\.spec\.mark, ground: "chrome" \}, ICON\.base/.test(tree)).toBe(true);
});

// ---- Agent-led tab rows: the nine cases of reports/sidebar-mapping.md (owner-approved 05c691346ef8) ----
const claude2 = { name: "Claude Code", key: "claude", agent: true };
function tabWorld(panesIn, terms, extra = {}) {
  const spaces = [{ id: "S", name: "ws", active: true, tabs: [tab("T", extra.name ?? "lead", { active: true, named: extra.named ?? true })] }];
  const agents = terms.filter((t) => t.status).map((t) => ({ address: t.address, status: t.status }));
  return { spaces, panes: panesIn, terminals: terms, agents };
}
const tabOf = (w, kindOf) => buildPaneTree({ ...w, kindOf }).flatMap((s) => s.tabs)[0];

test("1. one agent pane: the tab row is the agent's mark and the tab's own name (request 14), and no row of its own", () => {
  const w = tabWorld([pane("p1", "T", "t1", claude2)], [term("t1", { status: "working" })]);
  const t = tabOf(w);
  expect([t.name, t.badge, t.label.kind, t.lead.address, t.items.length]).toEqual(["lead", null, "Claude Code", "t1", 0]);
  expect(shape(treeRows(buildPaneTree(w)))).toEqual(["space:ws", "tab:lead"]);
});

test("2. an agent pane plus shells: the shells hang under the tab row", () => {
  const w = tabWorld([pane("p1", "T", "t1", codex), pane("p2", "T", "t2", zsh)], [term("t1", { status: "idle" }), term("t2")], { name: "review" });
  expect(shape(treeRows(buildPaneTree(w))).slice(1)).toEqual(["tab:review", "└pane:Terminal"]);
});

test("3. two independent agents: the first in pane order leads, the second keeps its row and its sub-agents", () => {
  const w = tabWorld(
    [pane("p1", "T", "t1", claude2), pane("p2", "T", "t2", codex), pane("p3", "T", "t3", zsh)],
    [term("t1", { status: "working" }), term("t2", { status: "idle" }), term("t3"), term("t4", { parent: "t2", status: "working", name: "research-chat" })]);
  expect(shape(treeRows(buildPaneTree(w))).slice(1)).toEqual(["tab:lead", "├pane:Codex", "│└pane:research-chat", "└pane:Terminal"]);
  // Codex started by Claude (a Core child) sits under the lead in the same place.
  w.terminals[1].parent = "t1";
  expect(shape(treeRows(buildPaneTree(w))).slice(1, 3)).toEqual(["tab:lead", "├pane:Codex"]);
});

test("4. shells only: the plain tab name, no badge, no lead", () => {
  const w = tabWorld([pane("p1", "T", "t1", zsh), pane("p2", "T", "t2", zsh)], [term("t1"), term("t2")], { name: "checks" });
  const t = tabOf(w);
  expect([t.name, t.badge, t.lead]).toEqual(["checks", null, null]);
  expect(shape(treeRows(buildPaneTree(w))).slice(1)).toEqual(["tab:checks", "├pane:Terminal", "└pane:Terminal"]);
  expect(rowSpec(treeRows(buildPaneTree(w))[1])).toMatchObject({ click: "show", aria: "Tab checks, shown, expanded" });
});

test("5. the lead's sub-agents and records hang directly under the merged row; another pane's stay under it", () => {
  const w = tabWorld(
    [pane("p1", "T", "t1", claude2), pane("p2", "T", "t2", codex)],
    [term("t1", { status: "working", records: { r1: { state: "working", title: "Explore" } } }), term("t3", { parent: "t1", status: "working", name: "research-mods" }),
     term("t2", { status: "idle" }), term("t4", { parent: "t2", status: "idle", name: "codex-sub" })]);
  expect(shape(treeRows(buildPaneTree(w))).slice(1)).toEqual(["tab:lead", "├pane:research-mods", "├rec:Explore", "└pane:Codex", " └pane:codex-sub"]);
});

test("6. the lead is the Core parent, else the first agent pane; focus never decides", () => {
  // The worker's pane comes first, but Claude started it: Claude leads.
  const w = tabWorld([pane("p2", "T", "t2", codex), pane("p1", "T", "t1", claude2)], [term("t2", { parent: "t1", status: "idle" }), term("t1", { status: "working" })]);
  expect(tabOf(w).lead.address).toBe("t1");
  // Two independent agents with the second focused: still the first.
  const v = tabWorld([pane("p1", "T", "t1", claude2), pane("p2", "T", "t2", codex, { focused: true })], [term("t1", { status: "idle" }), term("t2", { status: "idle" })]);
  expect(tabOf(v).lead.address).toBe("t1");
});

test("7. the merged row's name focuses the lead's pane; the caret folds; its words say both", () => {
  const w = tabWorld([pane("p1", "T", "t1", claude2), pane("p2", "T", "t2", zsh)], [term("t1", { status: "working" }), term("t2")]);
  const row = treeRows(buildPaneTree(w))[1];
  const spec = rowSpec(row);
  expect(spec).toMatchObject({ text: "lead", badge: null, mark: { agent: true, label: "Claude Code" }, click: "focus-lead", lead: { pane: "p1", address: "t1" } });
  expect(spec.caret).toMatchObject({ solid: false, label: "Collapse tab lead" });
  expect(spec.aria).toBe("Claude Code, lead agent of tab lead, shown, expanded");
  expect(spec.aria).toContain("Claude Code, lead agent of tab lead");
  // The lead's own state on the left, open or folded; folded, what the fold hides is counted on the right.
  w.terminals[1].status = "blocked";
  w.agents.push({ address: "t2", status: "blocked" });
  const r2 = treeRows(buildPaneTree(w))[1];
  expect(rowSpec(r2)).toMatchObject({ word: "working", rollup: [] });
  const folded = rowSpec(r2, new Set(["tb:T"]));
  expect(folded).toMatchObject({ word: "working", rollup: [{ word: "needs", n: 1 }] });
  expect(folded.aria).toBe("Claude Code, lead agent of tab lead, shown, collapsed: 1 needs you");
});

test("8. a focused pane inside a folded tab highlights the folded row; open, only the lead's focus does", () => {
  const w = tabWorld([pane("p1", "T", "t1", claude2), pane("p2", "T", "t2", zsh)], [term("t1", { status: "idle" }), term("t2")]);
  const t = tabOf(w);
  expect(tabRowOn(t, { tab: "T", pane: "p2" }, false)).toBe(true);
  expect(tabRowOn(t, { tab: "T", pane: "p2" }, true)).toBe(false);
  expect(tabRowOn(t, { tab: "T", pane: "p1" }, true)).toBe(true);
  expect(tabRowOn(t, { tab: "OTHER", pane: "p9" }, false)).toBe(false);
});

test("9. the lead exits: the plain tab name, its pane a row; another agent left becomes the lead", () => {
  const exitedClaude = term("t1", { reported: true, status: null });
  const w = tabWorld([pane("p1", "T", "t1", zsh), pane("p2", "T", "t2", zsh)], [exitedClaude, term("t2")]);
  expect(shape(treeRows(buildPaneTree(w))).slice(1)).toEqual(["tab:lead", "├pane:Terminal", "└pane:Terminal"]);
  const v = tabWorld([pane("p1", "T", "t1", zsh), pane("p2", "T", "t2", codex)], [{ ...exitedClaude }, term("t2", { status: "idle" })]);
  expect(shape(treeRows(buildPaneTree(v))).slice(1)).toEqual(["tab:lead", "└pane:Terminal"]);
});

test("the shared naming: the tab bar and the factory get the sidebar's label and lead for every tab", () => {
  const heads = tabHeads(buildPaneTree(world()));
  // The mark shows the kind, so the words are the tab's own name; the kind stays in the mark's words and the
  // accessible name (owner request 14, replacing the approved agent name + badge).
  expect(heads.get("A1")).toEqual({ text: "lead", badge: null, kind: "Claude Code", aria: "Claude Code, lead agent of tab lead", lead: { pane: "p1", address: "t1" } });
  expect(heads.get("A2")).toMatchObject({ text: "review", badge: null, kind: "Codex" });
  // A tab nobody named ("2" is its number): its lead pane's name, here Core's name for the terminal.
  const w = tabWorld([pane("p1", "T", "t1", claude2)], [term("t1", { status: "idle", name: "research-mods" })], { name: "2", named: false });
  expect(tabHeads(buildPaneTree(w)).get("T")).toMatchObject({ text: "research-mods", badge: null, aria: "research-mods: Claude Code, lead agent of this tab" });
  // Nobody named the tab or its terminal: it is called by its agent (owner, 10 Nov), whatever its title or folder.
  const v = tabWorld([pane("p1", "T", "t1", claude2, { title: "✳ Fix the rows", cwd: "/" })], [term("t1", { status: "idle" })], { name: "2", named: false });
  expect(tabHeads(buildPaneTree(v)).get("T")).toMatchObject({ text: "Claude Code", aria: "Claude Code, lead agent of this tab" });
  // All three views read it from here.
  for (const f of ["../mods/pdk-tree/main.js", "../mods/pdk-tabs/main.js"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    expect(/tabHeads\(|rowSpec\(/.test(src), f).toBe(true);
  }
});

test("a command naming the lead's pane reaches its merged tab row; other keys their own rows", () => {
  const rows = treeRows(buildPaneTree(world()));
  expect(findRow(rows, "pn:p1").key).toBe("tb:A1");
  expect(findRow(rows, "pn:p3").key).toBe("pn:p3");
  expect(findRow(rows, "tb:A2").key).toBe("tb:A2");
  expect(findRow(rows, "pn:nope")).toBe(null);
});

// Fit: fitHead never clips a badge (pdk-tabs still draws through it). The factory's zones are gone (mind map,
// request 17), so the rooms are the old zone widths as literals: one unit 156 px, three 436, minus padding and border.
import { fitHead } from "../adapters/status.js";
const ONE = 156 - 2 * 12 - 2;
const THREE = 436 - 2 * 12 - 2;
const used = (f, extras) => 20 + Math.min(f.nameW, f.nameMax ?? Infinity) + f.badgeW + extras.reduce((s, e) => s + e.length * 11 * 0.6 + 6, 0);

test("fit: a one-unit zone keeps 'Cursor Agent' and its badge whole by dropping the count and 'shown'", () => {
  const room = ONE;
  const f = fitHead({ room, fixed: 20, name: "Cursor Agent", badge: "cursor", extras: ["1 unit", "shown"] });
  expect(f.extras).toEqual([]);
  expect(used(f, f.extras)).toBeLessThanOrEqual(room);
  expect(f.badgeW).toBeGreaterThan(0);
});

test("fit: the count drops before the name, 'shown' before the count; a wide zone keeps everything", () => {
  const wide = THREE;
  expect(fitHead({ room: wide, fixed: 20, name: "Claude Code", badge: "lead", extras: ["3 units", "shown"] })).toMatchObject({ extras: ["3 units", "shown"], nameMax: null });
  const mid = fitHead({ room: 200, fixed: 20, name: "Claude Code", badge: "lead", extras: ["1 unit", "shown"] });
  expect(mid.extras).toEqual(["1 unit"]);
  expect(mid.nameMax).toBe(null);
});

test("fit: when even the name won't fit, it truncates and the badge keeps its room", () => {
  const one = ONE;
  for (const room of [one, one + 20, one + 60]) {
    const f = fitHead({ room, fixed: 20, name: "A very long agent kind name", badge: "evals-run", extras: ["2 units", "shown"] });
    expect(f.extras).toEqual([]);
    expect(f.nameMax).not.toBe(null);
    expect(20 + f.nameMax + f.badgeW).toBeLessThanOrEqual(room);
  }
});

test("fit: the tree and the tab bar draw no badge (request 14)", () => {
  for (const f of ["../mods/pdk-tree/main.js", "../mods/pdk-tabs/main.js"]) expect(readFileSync(new URL(f, import.meta.url), "utf8")).not.toMatch(/\bbadge\(/);
});

// Codex's tab-naming review (reports/review-tabnames.md): each counterexample, as reported.
test("N1: the lead back at its shell, a live Codex it started (own pane) survives: Codex leads, the shell is its own row", () => {
  const w = tabWorld([pane("p1", "T", "t1", zsh), pane("p2", "T", "t2", codex)],
    [term("t1", { reported: true, status: null }), term("t2", { parent: "t1", status: "idle" })]);
  expect(tabOf(w).lead.address).toBe("t2");
  expect(shape(treeRows(buildPaneTree(w))).slice(1)).toEqual(["tab:lead", "└pane:Terminal"]);
  expect(tabHeads(buildPaneTree(w)).get("T")).toMatchObject({ text: "lead", kind: "Codex", lead: { pane: "p2", address: "t2" } });
});

test("N2: independent agent A, parent B, B's child C, in that order: B leads (Core parent before pane order)", () => {
  const w = tabWorld([pane("pA", "T", "tA", claude2), pane("pB", "T", "tB", claude2), pane("pC", "T", "tC", codex)],
    [term("tA", { status: "idle", name: "A" }), term("tB", { status: "working", name: "B" }), term("tC", { parent: "tB", status: "working", name: "C" })]);
  expect(tabOf(w).lead.address).toBe("tB");
  expect(shape(treeRows(buildPaneTree(w))).slice(1)).toEqual(["tab:lead", "├pane:C", "└pane:A"]);
  expect(tabHeads(buildPaneTree(w)).get("T").lead.address).toBe("tB");
});

test("N3: fitHead keeps a long badge whole when there is room; past it, the badge truncates and nothing overruns", () => {
  const asked = fitHead({ room: Infinity, fixed: 20, name: "Claude Code", badge: "production-readiness" }).need;
  const f = fitHead({ room: asked, fixed: 20, name: "Claude Code", badge: "production-readiness", extras: ["1 unit"] });
  expect([f.badgeMax, f.nameMax]).toEqual([null, null]);
  // Past the room: the name keeps a few characters, then the badge truncates; nothing runs past the room.
  const room = 2 * 132 + 8;
  const g = fitHead({ room, fixed: 20, name: "Claude Code", badge: "a-very-long-production-readiness-review-tab", extras: ["1 unit"] });
  expect(g.badgeMax).not.toBe(null);
  expect(20 + g.nameMax + 6 + g.badgeMax).toBeLessThanOrEqual(room);
});

// The lead's review (phase 2): no caret on a row with nothing under it; a tab with rows under it keeps one.
test("N4: a lone agent's merged row has no caret; one with rows under it does", () => {
  const w = tabWorld([pane("p1", "T", "t1", claude2)], [term("t1", { status: "working" })]);
  const spec = rowSpec(treeRows(buildPaneTree(w))[1]);
  expect(spec.caret).toBeNull();
  expect(spec.aria).toBe("Claude Code, lead agent of tab lead, shown");
  const v = tabWorld([pane("p1", "T", "t1", claude2), pane("p2", "T", "t2", zsh)], [term("t1", { status: "working" }), term("t2")]);
  expect(rowSpec(treeRows(buildPaneTree(v))[1]).caret).toEqual({ open: true, solid: false, label: "Collapse tab lead" });
  // A shell-only tab with no panes under it still has nothing to fold.
  const e = tabWorld([], [], { name: "empty" });
  expect(rowSpec(treeRows(buildPaneTree(e))[1]).caret).toBe(null);
});

// Owner, 10 Nov: "now i need to one by one go and change names". A new workspace's shell was three rows ("u", "t1",
// "u"; on box "/", "box/t1", "/"): now one row per agent or terminal, never a terminal id or a bare "/".
test("one row per agent or terminal: a tab of one pane is one row; an unnamed one is called by what runs there", () => {
  const box = { name: "zsh", key: "shell", shell: true, agent: false };
  const one = (address, cwd, program = box, title = address) => tabWorld([pane("p1", "T", address, program, { title, cwd })], [term(address)], { name: "1", named: false });
  for (const [address, cwd] of [["t1", "/tmp/u"], ["box/t1", "/"], ["box/t1", null]]) {
    const rows = shape(treeRows(buildPaneTree(one(address, cwd))));
    expect(rows, `${address} in ${cwd}`).toEqual(["space:ws", "tab:Terminal"]);
  }
  // A program that is not a shell keeps its name; a tab someone named keeps theirs.
  expect(shape(treeRows(buildPaneTree(one("t1", "/w", { name: "Neovim", key: "nvim", agent: false }))))).toEqual(["space:ws", "tab:Neovim"]);
  const named = tabWorld([pane("p1", "T", "t1", box, { title: "t1" })], [term("t1")], { name: "api" });
  expect(shape(treeRows(buildPaneTree(named)))).toEqual(["space:ws", "tab:api"]);
  // Two panes keep their rows, each called by what runs there, never "/", a folder or the terminal id.
  const split = tabWorld([pane("p1", "T", "box/t1", box, { title: "box/t1", cwd: "/" }), pane("p2", "T", "box/t2", box, { title: "t2", cwd: "/srv/api" })],
    [term("box/t1"), term("box/t2")], { name: "1", named: false });
  expect(shape(treeRows(buildPaneTree(split)))).toEqual(["space:ws", "tab:Terminal", "├pane:Terminal", "└pane:Terminal"]);
  // The tab row is the selected one when its single pane has focus (it has no child row to show it).
  const t = buildPaneTree(one("t1", "/w"))[0].tabs[0];
  expect(tabRowOn(t, { tab: "T", pane: "p1" }, true)).toBe(true);
  expect(tabRowOn(buildPaneTree(split)[0].tabs[0], { tab: "T", pane: "p1" }, true)).toBe(false);
});

// The lead's after-shots: Herdr's terminal.open names its tab "shell"; that is the app's default, not a name, so the
// tab reads "Terminal" (an agent's tab, its agent) in the sidebar, the tab bar and Cmd+K, which all take tabLabel.
test("a tab Herdr named \"shell\" (terminal.open) reads as unnamed: Terminal, or its agent", async () => {
  const box = { name: "zsh", key: "shell", shell: true, agent: false };
  const shell = tabWorld([pane("p1", "T", "t1", box, { title: "t1" })], [term("t1")], { name: "shell", named: true });
  expect(shape(treeRows(buildPaneTree(shell)))).toEqual(["space:ws", "tab:Terminal"]);
  expect(tabHeads(buildPaneTree(shell)).get("T")).toMatchObject({ text: "Terminal" });
  const agent = tabWorld([pane("p1", "T", "t1", claude2)], [term("t1", { status: "idle" })], { name: "shell", named: true });
  expect(tabHeads(buildPaneTree(agent)).get("T")).toMatchObject({ text: "Claude Code", aria: "Claude Code, lead agent of this tab" });
  // Cmd+K's tab row (review UX08: the palette showed "shell" too).
  const { searchRows } = await import("../adapters/search.js");
  expect(searchRows(shell).find((r) => r.key.startsWith("tb:")).label).toBe("Terminal");
});

// Owner, 11 Nov ("let's follow herdr core bits"): a pane row shows the terminal's name: Core's start name when it has
// one, else what it runs (the agent, "Terminal" for a shell); never its title, folder, template, id or a label.
test("a pane row reads the terminal's start name, else what it runs; nothing else", () => {
  const w = tabWorld([pane("p1", "T", "t1", codex, { title: "✳ Plan the release", cwd: "/srv/api" }), pane("p2", "T", "t2", zsh, { title: "vim notes.md", cwd: "/srv/api" }),
    pane("p3", "T", "t4", zsh, { title: "htop", cwd: "/" })],
    [term("t1", { status: "idle" }), term("t2", { name: "api-server" }), term("t3", { parent: "t1", template: "worker", program: codex, report: { app: "codex" } }), term("t4")], { name: "1", named: false });
  // t2 is named in Core (its title says vim); t3 has no pane and a template (it runs Codex); t4 is a plain shell (htop).
  expect(treeRows(buildPaneTree(w)).filter((r) => r.type === "pane").map((r) => `${r.key} ${r.node.name}`))
    .toEqual(["tm:t3 Codex", "pn:p2 api-server", "pn:p3 Terminal"]);
  // Labels are not names (nothing of ours is read).
  w.terminals[1].labels = { "pdk.name": "API", "herdr.seen": "1" }; w.terminals[3].labels = { "herdr.right-click": "menu" };
  expect(treeRows(buildPaneTree(w)).filter((r) => r.type === "pane").map((r) => r.node.name)).toEqual(["Codex", "api-server", "Terminal"]);
});
