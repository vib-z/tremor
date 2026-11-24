// The Map view's model (adapters/factory-map.js): the tree from Core's parent links, counts, every agent reachable,
// level switching, scenes and camera. The fixture is the realistic one the owner asked for: two jobs, one with three
// sub-leads of three helpers each, 21 agents, plus a shell that must not appear.
import { test, expect } from "bun:test";
import { buildBoard } from "../adapters/factory.js";
import { teamParents } from "../adapters/team.js";
import * as M from "../adapters/factory-map.js";

const claude = { key: "claude", name: "Claude Code", agent: true, shell: false };
const codex = { key: "codex", name: "Codex", agent: true, shell: false };
const zsh = { key: "shell", name: "zsh", agent: false, shell: true };

// Job "stampede-restructure": lead-demo-restructure (working) with 5 helpers, 4 working.
// Job "watch-agent-controller": lead-repod-watch-core (idle) with design-states, review-result and three sub-leads
// (research-moshi working, research-voice, research-micro), each with three idle helpers: 15 agents.
export function realistic() {
  const terminals = [], panes = [], agents = [];
  let n = 0;
  const add = (name, program, status, parent = null, pane = null) => {
    const address = `t${++n}`;
    terminals.push({ address, state: "live", status, name, program, parent, report: { state: status, app: program.key } });
    agents.push({ address, status });
    if (pane) panes.push({ pane: `p${n}`, tab: pane, terminal: address, program });
    return address;
  };
  const a = add("lead-demo-restructure", claude, "working", null, "a");
  add("review-tree-shell", codex, "working", a); add("build-tree-shell", claude, "working", a);
  add("fix-onesource", claude, "working", a); add("review-onesource", codex, "working", a);
  add("build-relay-config", claude, "idle", a);
  const b = add("lead-repod-watch-core", claude, "idle", null, "b");
  add("design-states", claude, "idle", b); add("review-result", codex, "idle", b);
  const m = add("research-moshi", claude, "working", b);
  for (const h of ["acp", "local", "custom"]) add(h, claude, "idle", m);
  const v = add("research-voice", claude, "idle", b);
  for (const h of ["watchos", "priorart", "hacks"]) add(h, claude, "idle", v);
  const x = add("research-micro", codex, "idle", b);
  for (const h of ["repod", "x", "devices"]) add(h, codex, "idle", x);
  terminals.push({ address: "t99", state: "live", status: null, program: zsh });
  panes.push({ pane: "p99", tab: "b", terminal: "t99", program: zsh });
  const spaces = [
    { id: "s1", name: "stampede-restructure", tabs: [{ id: "a", name: "main", index: 1 }] },
    { id: "s2", name: "watch-agent-controller", branch: "master", tabs: [{ id: "b", name: "main", index: 1 }] },
  ];
  return { spaces, panes, terminals, agents, machines: [{ name: null, layout: "ready" }], focused: null };
}

test("contract: the tree holds every agent once, nested by Core parent, and the shell is not in it", () => {
  const tree = M.mapTree(buildBoard(realistic()));
  expect(tree.jobs.map((j) => [j.name, j.roots.map((r) => r.name), j.agents])).toEqual([
    ["stampede-restructure", ["lead-demo-restructure"], 6],
    ["watch-agent-controller", ["lead-repod-watch-core"], 15],
  ]);
  expect(tree.byKey.size).toBe(21);
  expect(tree.counts).toEqual({ jobs: 2, agents: 21, working: 6, needs: 0, idle: 15 });
  const moshi = [...tree.byKey.values()].find((a) => a.name === "research-moshi");
  expect(tree.byKey.get(moshi.parent).name).toBe("lead-repod-watch-core");
  expect(moshi.depth).toBe(1);
  expect(moshi.children.map((c) => c.name)).toEqual(["acp", "local", "custom"]);
  const lead = tree.jobs[1].roots[0];
  expect(lead.team).toEqual({ helpers: 5, all: 14, working: 1, needs: 0, idle: 13, subTeams: 3 });
  expect(M.hubLine(lead)).toBe("14 helpers");
  expect(M.hubLine(tree.jobs[0].roots[0])).toBe("5 helpers");
});

// ---- a second fixture: boards built by hand, for counts and shapes buildBoard's fixtures make awkward ----------

const unit = (address, { parent = null, word = "idle", agent = true, name = address, msg = null } = {}) =>
  ({ address, startedBy: parent, name, word, msg, kind: { agent, shell: !agent, label: agent ? "Claude Code" : "zsh" }, records: [] });
const board = (...regions) => ({ state: "ready", regions: regions.map(([id, units, extra = {}]) => ({ id, name: id, machine: null, branch: null, ...extra, zones: [{ id: `${id}-z`, units }] })) });
const helperName = (i) => `helper-${String(i).padStart(2, "0")}-review-pass`;
// One lead with `n` leaf helpers, the first `working` of them working.
const fan = (n, { working = 0, lead = "lead" } = {}) => [unit(lead, { name: `lead-${lead}-watch-core` }),
  ...Array.from({ length: n }, (_, i) => unit(`${lead}.${i}`, { parent: lead, name: helperName(i), word: i < working ? "working" : "idle" }))];
// A chain five deep (lead → s1 → s2 → s3 → s4), each with two leaves, plus a sibling sub-lead with 14 helpers.
const deep = () => {
  const us = [unit("L", { name: "lead-deep" })];
  let p = "L";
  for (let d = 1; d <= 4; d++) {
    us.push(unit(`s${d}`, { parent: p, name: `sub-lead-depth-${d}`, word: d === 3 ? "needs" : "idle" }));
    us.push(unit(`s${d}.a`, { parent: `s${d}`, name: `leaf-${d}-alpha`, word: "working" }), unit(`s${d}.b`, { parent: `s${d}`, name: `leaf-${d}-beta` }));
    p = `s${d}`;
  }
  us.push(unit("w", { parent: "L", name: "wide-sub-lead" }), ...Array.from({ length: 14 }, (_, i) => unit(`w.${i}`, { parent: "w", name: helperName(i) })));
  return us;
};

const real = () => M.mapTree(buildBoard(realistic()));
const byName = (tree, name) => [...tree.byKey.values()].find((a) => a.name === name);

test("tree: nesting five deep, depths and parents, the subtree counts", () => {
  const tree = M.mapTree(board(["j", deep()]));
  expect(tree.byKey.size).toBe(28);
  const s4 = tree.byKey.get("s4");
  expect([s4.depth, s4.parent, tree.byKey.get("s4.a").depth]).toEqual([4, "s3", 5]);
  expect(tree.jobs[0].roots.map((r) => r.key)).toEqual(["L"]);
  expect(tree.byKey.get("L").team).toEqual({ helpers: 2, all: 27, working: 4, needs: 1, idle: 22, subTeams: 2 });
  expect(tree.byKey.get("s3").team).toEqual({ helpers: 3, all: 5, working: 2, needs: 0, idle: 3, subTeams: 1 });
  expect(tree.counts).toEqual({ jobs: 1, agents: 28, working: 4, needs: 1, idle: 23 });
  // children keep the board's order
  expect(tree.byKey.get("L").children.map((c) => c.key)).toEqual(["s1", "w"]);
});

test("tree: a plain shell is left out, a shell with agent children stays as their parent", () => {
  const tree = M.mapTree(board(["j", [unit("a"), unit("sh", { agent: false }), unit("sh2", { agent: false }), unit("b", { parent: "sh2" }), unit("sh3", { agent: false, parent: "a" })]]));
  expect([...tree.byKey.keys()]).toEqual(["a", "sh2", "b"]);
  expect(tree.byKey.get("b").parent).toBe("sh2");
  expect(tree.byKey.get("a").children).toEqual([]);
  // a shell-only job is not a job
  expect(M.mapTree(board(["j", [unit("sh", { agent: false })]])).jobs).toEqual([]);
});

test("tree: a parent outside the board, or in another job, makes a top-level agent; a cycle is cut once", () => {
  const tree = M.mapTree(board(["j1", [unit("a", { parent: "gone" }), unit("b", { parent: "c" }), unit("c", { parent: "b" }), unit("d", { parent: "c" }), unit("e", { parent: "e" })]],
    ["j2", [unit("f", { parent: "a" })]]));
  expect(tree.byKey.size).toBe(6);
  expect(tree.jobs[0].roots.map((r) => r.key)).toEqual(["a", "b", "e"]);
  expect(tree.byKey.get("c").parent).toBe("b");
  expect(tree.byKey.get("d").parent).toBe("c");
  expect(tree.jobs[1].roots.map((r) => r.key)).toEqual(["f"]);
  // every agent once, through buildBoard too (the realistic board's 21)
  const r = real();
  const all = r.jobs.flatMap((j) => { const out = []; const walk = (a) => { out.push(a.key); a.children.forEach(walk); }; j.roots.forEach(walk); return out; });
  expect(all.length).toBe(21);
  expect(new Set(all).size).toBe(21);
});

test("words: statusOf; hubLine is the team's size and who in it needs you", () => {
  expect(["working", "needs", "done", "idle", "exited", null].map(M.statusOf)).toEqual(["working", "needs", "idle", "idle", "idle", "idle"]);
  const line = (units) => M.hubLine(M.mapTree(board(["j", units])).jobs[0].roots[0]);
  expect(line(fan(3))).toBe("3 helpers");
  expect(line(fan(1))).toBe("1 helper");
  const needs = fan(4, { working: 1 }); needs[3].word = "needs"; needs[4].word = "needs";
  expect(line(needs)).toBe("4 helpers · 2 need you");
  const one = fan(2); one[1].word = "needs";
  expect(line(one)).toBe("2 helpers · 1 needs you");
  expect(line(deep())).toBe("27 helpers · 1 needs you");                      // the whole team, any depth
  expect(line([unit("solo", { msg: "hi" })])).toBe("");
});

test("ring: working, needs, idle order; one segment per helper up to 24, then shared in proportion", () => {
  const tree = real();
  const lead = tree.jobs[1].roots[0];
  expect(M.ringOf(lead)).toEqual(["working", "idle", "idle", "idle", "idle"]); // research-moshi works
  expect(M.ringOf(lead, { deep: true })).toEqual(["working", ...Array(13).fill("idle")]);
  expect(M.ringOf(byName(tree, "acp"))).toBeNull();
  const us = fan(40, { working: 30 }); us[35].word = "needs";
  const ring = M.ringOf(M.mapTree(board(["j", us])).jobs[0].roots[0]);
  expect(ring.length).toBe(24);
  expect(ring.indexOf("needs")).toBe(ring.lastIndexOf("working") + 1);
  expect(ring.filter((s) => s === "needs").length).toBe(1);
  expect(ring.filter((s) => s === "working").length).toBe(18);
  const twentyFour = M.ringOf(M.mapTree(board(["j", fan(24)])).jobs[0].roots[0]);
  expect(twentyFour.length).toBe(24);
});

// ---- relay jobs: the job's lead is the hub (team.js), first class in every view -------------------------------

// A stampede relay job: the workers have no Core parent, only the job's labels; beside the two native jobs.
export function relayFixture() {
  const f = realistic();
  const lab = (job, role) => ({ "stampede.job": job, "stampede.role": role });
  const add = (address, name, role, status, tab) => {
    f.terminals.push({ address, state: "live", status, name, program: claude, parent: null, labels: lab("restructure-1113", role), report: { state: status, app: "claude" } });
    f.agents.push({ address, status });
    f.panes.push({ pane: `p-${address}`, tab, terminal: address, program: claude });
  };
  add("t30", "lead-demo-restructure-1113", "lead", "idle", "r1");
  add("t31", "build-onesource", "helper", "working", "r2");
  add("t32", "review-onesource", "reviewer", "idle", "r3");
  add("t33", "fix-relay", "helper", "blocked", "r4");
  f.spaces.push({ id: "s3", name: "stampede-restructure-1113", tabs: ["r1", "r2", "r3", "r4"].map((id, i) => ({ id, name: id, index: i + 1 })) });
  return f;
}
const relayTree = () => { const f = relayFixture(); return M.mapTree(buildBoard(f), teamParents(f.terminals)); };
const teamOfLead = (tree, lead) => [...tree.byKey.values()].filter((a) => { let x = a; while (x.parent) x = tree.byKey.get(x.parent); return x === lead; }).map((a) => a.key);

test("relay: workers with no Core parent nest under their job's lead; native jobs as before", () => {
  const f = relayFixture();
  expect(M.mapTree(buildBoard(f)).jobs[2].roots.length).toBe(4);              // without team parents: four loose agents
  const tree = relayTree();
  const job = tree.jobs[2];
  expect(job.roots.map((r) => r.name)).toEqual(["lead-demo-restructure-1113"]);
  expect(job.roots[0].children.map((c) => c.name)).toEqual(["build-onesource", "review-onesource", "fix-relay"]);
  expect(M.hubLine(job.roots[0])).toBe("3 helpers · 1 needs you");
  expect(tree.jobs[1].roots[0].team.all).toBe(14);                            // the native tree unchanged
  expect(M.roleOf(tree, "t31")).toEqual({ role: "helper", of: "lead-demo-restructure-1113" });
});

test("relay and native in every view: collapsed shows the leads, open shows the team, expanded shows everyone", () => {
  const tree = relayTree();
  const col = M.sceneOf(tree, M.startNav());
  expect(col.nodes.map((n) => n.label)).toEqual(tree.jobs.map((j) => j.roots[0].name));
  for (const job of tree.jobs) {
    const lead = job.roots[0];
    expect(col.nodes.some((n) => n.key === lead.key && n.role === "lead" && n.folded && n.ring.length === lead.team.all)).toBe(true);
    const open = M.sceneOf(tree, M.clickAgent(tree, M.startNav(), lead.key));
    const team = new Set(teamOfLead(tree, lead));
    expect(open.nodes.filter((n) => team.has(n.key)).length).toBe(team.size);
    expect(open.links.filter((l) => team.has(l.to)).length).toBe(team.size - 1);
    expect(open.nodes.length).toBe(team.size + tree.jobs.length - 1);          // the other leads stay folded
  }
  expect(M.sceneOf(tree, { mode: "expanded", open: null, selected: null }).nodes.length).toBe(tree.byKey.size);
});

// ---- navigation: two modes, one lead open in place ------------------------------------------------------------

test("nav: a click opens a lead in place (selected), another switches, a click on the open lead or Esc closes it", () => {
  const tree = real();
  const [a, b] = tree.jobs.map((j) => j.roots[0].key);
  let nav = M.clickAgent(tree, M.startNav(), a);
  expect(nav).toEqual({ mode: "collapsed", open: a, selected: a });
  nav = M.clickAgent(tree, nav, b);
  expect(nav).toEqual({ mode: "collapsed", open: b, selected: b });
  expect(M.clickAgent(tree, nav, b)).toEqual(M.startNav());
  expect(M.up(tree, nav)).toEqual(M.startNav());
  // a helper in the open team: selected; Esc clears it first, then closes the lead
  const moshi = byName(tree, "research-moshi").key, acp = byName(tree, "acp").key;
  const sel = M.clickAgent(tree, nav, acp);
  expect(sel).toEqual({ mode: "collapsed", open: b, selected: acp });
  expect(M.clickAgent(tree, sel, acp).selected).toBeNull();
  expect(M.clickAgent(tree, sel, moshi)).toEqual({ mode: "collapsed", open: b, selected: moshi }); // a sub-lead selects
  expect(M.up(tree, sel)).toEqual({ mode: "collapsed", open: b, selected: null });
  expect(M.up(tree, M.up(tree, sel))).toEqual(M.startNav());
  expect(M.up(tree, M.startNav())).toEqual(M.startNav());
  // a lead with no helpers only selects
  const lone = M.mapTree(board(["j", [unit("solo")]]));
  expect(M.clickAgent(lone, M.startNav(), "solo")).toEqual({ mode: "collapsed", open: null, selected: "solo" });
});

test("nav: All expanded selects on click and Esc clears; the toggle keeps a selection in view", () => {
  const tree = real();
  const b = tree.jobs[1].roots[0].key, acp = byName(tree, "acp").key;
  const ex = M.setMode(tree, M.startNav(), "expanded");
  expect(ex).toEqual({ mode: "expanded", open: null, selected: null });
  expect(M.clickAgent(tree, ex, b)).toEqual({ mode: "expanded", open: null, selected: b });
  const sel = M.clickAgent(tree, ex, acp);
  expect(M.up(tree, sel)).toEqual(ex);
  expect(M.setMode(tree, sel, "collapsed")).toEqual({ mode: "collapsed", open: b, selected: acp }); // its lead opens
  expect(M.setMode(tree, M.clickAgent(tree, ex, b), "collapsed")).toEqual({ mode: "collapsed", open: null, selected: b });
  expect(M.setMode(tree, M.clickAgent(tree, M.startNav(), b), "expanded")).toEqual({ mode: "expanded", open: null, selected: b });
});

test("nav: normalize drops a gone or hidden lead or selection; only a top-level lead with helpers opens", () => {
  const tree = real();
  const b = tree.jobs[1].roots[0].key, moshi = byName(tree, "research-moshi").key, acp = byName(tree, "acp").key;
  expect(M.normalize(tree, { mode: "collapsed", open: "gone", selected: "gone" })).toEqual(M.startNav());
  expect(M.normalize(tree, { mode: "collapsed", open: moshi, selected: null }).open).toBeNull();     // not top-level
  expect(M.normalize(tree, { mode: "collapsed", open: null, selected: acp }).selected).toBeNull();   // not shown
  expect(M.normalize(tree, { mode: "collapsed", open: b, selected: acp }).selected).toBe(acp);
  expect(M.normalize(tree, { mode: "expanded", open: b, selected: acp })).toEqual({ mode: "expanded", open: null, selected: acp });
  expect(M.normalize(tree, { mode: "weird" }).mode).toBe("collapsed");
  expect(M.normalize(M.mapTree(board()), { mode: "collapsed", open: b, selected: b })).toEqual(M.startNav());
});

test("reach: every agent is shown in some scene reached by clicks from the start (relay, native, deep)", () => {
  for (const tree of [relayTree(), M.mapTree(board(["j", deep()], ["k", [...fan(5, { lead: "p" }), ...fan(3, { lead: "q" })]]))]) {
    const shown = new Set(), seen = new Set(), queue = [M.startNav(), M.setMode(tree, M.startNav(), "expanded")];
    while (queue.length) {
      const nav = M.normalize(tree, queue.shift()), id = JSON.stringify(nav);
      if (seen.has(id)) continue;
      seen.add(id);
      for (const n of M.sceneOf(tree, nav).nodes) { shown.add(n.key); queue.push(M.clickAgent(tree, nav, n.key)); }
    }
    expect([...shown].sort()).toEqual([...tree.byKey.keys()].sort());
  }
});

test("card: name, role, kind, state word and last line, once each", () => {
  const f = realistic();
  f.terminals.find((t) => t.name === "acp").report.msg = "ACP notes done";
  const tree = M.mapTree(buildBoard(f));
  const acp = byName(tree, "acp"), lead = tree.jobs[1].roots[0];
  expect(M.cardOf(tree, acp.key)).toEqual({ key: acp.key, name: "acp", role: "helper of research-moshi", kind: "Claude Code", word: "idle", line: "ACP notes done", pane: null });
  expect(M.cardOf(tree, byName(tree, "research-moshi").key).role).toBe("sub-lead of lead-repod-watch-core");
  expect(M.cardOf(tree, lead.key)).toMatchObject({ role: "lead", pane: "p7" });
  expect(M.roleOf(tree, lead.key)).toEqual({ role: "lead", of: null });
  expect([M.cardOf(tree, "gone"), M.roleOf(tree, "gone")]).toEqual([null, null]);
});

test("arrows: parent, first child, siblings without wrap, first or last when nothing is selected", () => {
  const tree = real();
  const lead = tree.jobs[1].roots[0];
  const open = M.collapsedScene(tree, { open: lead.key });
  const kids = lead.children.map((c) => c.key);
  const first = tree.jobs[0].roots[0].key;
  expect(M.arrowStep(tree, open, null, "down")).toBe(first);
  expect(M.arrowStep(tree, open, lead.key, "right")).toBe(kids[0]);
  expect(M.arrowStep(tree, open, kids[0], "left")).toBe(lead.key);
  expect(M.arrowStep(tree, open, kids[0], "down")).toBe(kids[1]);
  expect(M.arrowStep(tree, open, kids[0], "up")).toBe(kids[0]);
  expect(M.arrowStep(tree, open, kids.at(-1), "down")).toBe(kids.at(-1));
  expect(M.arrowStep(tree, open, kids[2], "right")).toBe(byName(tree, "acp").key);  // the open team, any depth
  const col = M.collapsedScene(tree);
  expect(M.arrowStep(tree, col, first, "down")).toBe(lead.key);                     // leads across jobs are siblings
  expect(M.arrowStep(tree, col, lead.key, "right")).toBe(lead.key);                 // a folded team's helpers aren't shown
  expect(M.arrowStep(tree, { nodes: [] }, null, "down")).toBeNull();
});

// ---- geometry ---------------------------------------------------------------------------------------------------

// Discs (with their ring box) and label rectangles, from the scene's own fields, never touching.
// A hub's label box is its pill and, below it, the room kept for its line (lineW); a leaf's, its name.
// (At scale 1, where these world tests lay out: a lead's pill 26 tall, a name 16, a pill and its line 49.)
const labelBox = (n) => { const w = Math.max(n.labelW, n.lineW); return { x: n.x - w / 2, y: n.labelY, w, h: n.lineW ? n.lineY + 16 - n.labelY : n.role === "lead" ? 26 : 16 }; };
// A disc with its ring box: the working / needs ring 6 off it and the selection ring 2 past that, or a team ring.
const ringOut = (n) => Math.max(n.r + 8, n.ringR ? n.ringR + 2 : 0);
const shapes = (scene) => scene.nodes.map((n) => ({ n, c: [n.x, n.y, ringOut(n)], l: labelBox(n) }));
const rectsMeet = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const discMeetsRect = ([x, y, r], b) => Math.hypot(x - Math.max(b.x, Math.min(x, b.x + b.w)), y - Math.max(b.y, Math.min(y, b.y + b.h))) < r;
const clashes = (scene) => {
  const s = shapes(scene), out = [];
  for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
    const a = s[i], b = s[j];
    if (Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1]) < a.c[2] + b.c[2] || rectsMeet(a.l, b.l) || discMeetsRect(a.c, b.l) || discMeetsRect(b.c, a.l)) out.push([a.n.label, b.n.label]);
  }
  return out;
};
const inside = (scene) => shapes(scene).every(({ c: [x, y, r], l }) => {
  const b = scene.bounds;
  return x - r >= b.x - 0.01 && x + r <= b.x + b.w + 0.01 && y - r >= b.y - 0.01 && l.x >= b.x - 0.01 && l.x + l.w <= b.x + b.w + 0.01 && l.y + l.h <= b.y + b.h + 0.01;
});

// Every scene a tree can show: collapsed, each lead open in place, all expanded, and a narrow view of each.
const scenes = (tree) => {
  const leads = tree.jobs.flatMap((j) => j.roots).filter((r) => r.children.length);
  return [M.collapsedScene(tree), M.collapsedScene(tree, { width: 400 }), M.expandedScene(tree), M.expandedScene(tree, { width: 400 }),
    ...leads.map((r) => M.collapsedScene(tree, { open: r.key }))];
};

test("layout: never overlap discs or labels, 1 / 5 / 14 / 40 helpers, with and without sub-leads, every view", () => {
  for (const n of [1, 5, 14, 40]) {
    const flat = M.mapTree(board(["j", fan(n, { working: 2 })], ["k", fan(3, { lead: "other" })]));
    const subs = Math.ceil(n / 3), us = [unit("lead", { name: "lead-mixed-watch-core" })];
    for (let i = 0; i < n; i++) {
      us.push(unit(`c${i}`, { parent: "lead", name: helperName(i) }));
      if (i < subs) for (let k = 0; k < 3; k++) us.push(unit(`c${i}.${k}`, { parent: `c${i}`, name: `sub-helper-${k}` }));
    }
    const mixed = M.mapTree(board(["j", us], ["k", fan(3, { lead: "other" })]));
    for (const tree of [flat, mixed]) for (const s of scenes(tree)) {
      expect([n, clashes(s)]).toEqual([n, []]);
      expect(inside(s)).toBe(true);
    }
  }
});

test("layout: the relay and five-deep trees, every view, no overlap; labels inside bounds", () => {
  for (const tree of [relayTree(), M.mapTree(board(["j", deep()], ["k", [...fan(5, { lead: "p" }), ...fan(3, { lead: "q" })]]))]) {
    for (const s of scenes(tree)) { expect(clashes(s)).toEqual([]); expect(inside(s)).toBe(true); }
  }
});

test("layout: the mockups' clockwise order (QA 2): leaves lower-left to upper-left, sub-leads top-right to bottom-right", () => {
  const tree = real();
  const lead = tree.jobs[1].roots[0];
  const check = (s) => {
    const at = Object.fromEntries(s.nodes.map((n) => [n.label, n]));
    const c = at["lead-repod-watch-core"], rel = (k) => [at[k].x - c.x, at[k].y - c.y];
    expect(rel("design-states")[0] < 0 && rel("review-result")[0] < 0).toBe(true);      // leaves on the left
    expect(rel("design-states")[1]).toBeGreaterThan(rel("review-result")[1]);            // design-states lower (views.py)
    for (const k of ["research-moshi", "research-voice", "research-micro"]) expect(rel(k)[0]).toBeGreaterThan(0);
    expect(rel("research-moshi")[1]).toBeLessThan(0);                                    // moshi above the lead
    expect(rel("research-moshi")[1]).toBeLessThan(rel("research-voice")[1]);
    expect(rel("research-voice")[1]).toBeLessThan(rel("research-micro")[1]);             // micro lowest
    for (const k of ["acp", "local", "custom"]) expect(Math.hypot(at[k].x - c.x, at[k].y - c.y)).toBeGreaterThan(Math.hypot(at["research-moshi"].x - c.x, at["research-moshi"].y - c.y));
  };
  const open = M.collapsedScene(tree, { open: lead.key });
  check(open);
  check(M.expandedScene(tree));
  expect(open.links.find((l) => l.to === byName(tree, "research-moshi").key).live).toBe(true);
  // lead, sub-lead and helper are told apart by role and size
  const at = Object.fromEntries(open.nodes.map((n) => [n.label, n]));
  expect([at["lead-repod-watch-core"].role, at["research-moshi"].role, at["acp"].role]).toEqual(["lead", "sub-lead", "helper"]);
  expect(at["lead-repod-watch-core"].r > at["research-moshi"].r && at["research-moshi"].r > at["acp"].r).toBe(true);
  expect(open.nodes.slice(-2).map((n) => n.role)).toEqual(["lead", "lead"]);           // leads drawn last, on top
});

test("layout: collapsed shows only the top-level leads, with ring, count and needs; wraps into rows when narrow", () => {
  const f = realistic();
  const hacks = f.terminals.find((t) => t.name === "hacks");
  hacks.status = "blocked"; hacks.report.state = "blocked";
  f.agents.find((a) => a.address === hacks.address).status = "blocked";
  const tree = M.mapTree(buildBoard(f));
  const c = M.collapsedScene(tree);
  expect(c.nodes.map((n) => [n.label, n.r, n.ringR, n.ring.length, n.line, n.needs, n.folded, n.role])).toEqual([
    ["lead-demo-restructure", 48, 70, 5, "5 helpers", 0, true, "lead"],
    ["lead-repod-watch-core", 48, 70, 14, "14 helpers · 1 needs you", 1, true, "lead"]]);
  expect(c.nodes[1].ring.filter((s) => s === "needs").length).toBe(1);
  expect(c.links).toEqual([]);
  expect(c.heads.map((h) => [h.title, h.machine, h.meta])).toEqual([["stampede-restructure", "This computer", ""], ["watch-agent-controller", "This computer", "master"]]);
  expect(c.nodes[0].y).toBe(c.nodes[1].y);
  const narrow = M.collapsedScene(tree, { width: 300, height: 900 });         // a tall narrow view stacks the jobs
  expect(narrow.nodes[0].x).toBe(narrow.nodes[1].x);
  expect(narrow.nodes[1].y).toBeGreaterThan(narrow.nodes[0].y + 200);
});

test("layout: opening a lead moves the others aside on the same rows, they stay folded; closing puts them back", () => {
  const tree = M.mapTree(board(["j", fan(5, { lead: "a" })], ["k", deep()], ["m", fan(3, { lead: "c" })]));
  const shut = M.collapsedScene(tree, { width: 1200 }), open = M.collapsedScene(tree, { open: "L", width: 1200 });
  const at = (s) => Object.fromEntries(s.nodes.map((n) => [n.key, n]));
  const [s0, o0] = [at(shut), at(open)];
  const rowsOf = (s) => new Set(["a", "L", "c"].map((k) => s[k].y)).size;
  expect(rowsOf(o0)).toBe(rowsOf(s0));                                         // the rows are split on the folded sizes
  expect(o0.c.x - o0.L.x).toBeGreaterThan(s0.c.x - s0.L.x);                     // the next lead moved aside
  expect(o0.L.x).toBeGreaterThan(o0.a.x);                                       // order kept (L's team opens to its right)
  expect([o0.a.folded, o0.c.folded, o0.a.r, o0.L.r, o0.L.folded]).toEqual([true, true, M.SIZE.lead, M.SIZE.open, false]);
  expect(open.nodes.length).toBe(2 + 28);
  expect(M.collapsedScene(tree, { width: 1200 })).toEqual(shut);
});

test("layout: Expanded puts jobs left to right at least 80 apart, heads above, every agent once", () => {
  const tree = M.mapTree(board(["j", deep()], ["k", [...fan(5, { lead: "p" }), ...fan(3, { lead: "q" })]], ["m", fan(40)]));
  const ex = M.expandedScene(tree, { width: Infinity });                     // one row
  expect(ex.nodes.map((n) => n.key).sort()).toEqual([...tree.byKey.keys()].sort());
  const jobOfKey = (k) => tree.byKey.get(k).job;
  const spans = tree.jobs.map((j) => {
    const s = shapes(ex).filter(({ n }) => jobOfKey(n.key) === j.id);
    return [Math.min(...s.map(({ c, l }) => Math.min(c[0] - c[2], l.x))), Math.max(...s.map(({ c, l }) => Math.max(c[0] + c[2], l.x + l.w)))];
  });
  for (let i = 1; i < spans.length; i++) expect(spans[i][0] - spans[i - 1][1]).toBeGreaterThanOrEqual(80);
  for (const [i, h] of ex.heads.entries()) {
    const top = Math.min(...ex.nodes.filter((n) => jobOfKey(n.key) === tree.jobs[i].id).map((n) => n.y - n.r));
    expect(h.y + 32).toBeLessThanOrEqual(top);
  }
  expect(ex.heads.map((h) => h.meta)).toEqual(["", "", ""]);                  // the branch only; no agent count
  const wide = M.expandedScene(M.mapTree(board(["j", fan(40)])));
  const lead = wide.nodes.find((n) => n.key === "lead");
  const rs = wide.nodes.filter((n) => n.key !== "lead").map((n) => Math.round(Math.hypot(n.x - lead.x, n.y - lead.y)));
  expect(new Set(rs).size).toBeGreaterThan(1);                                // 40 leaves take more than one orbit
  expect(Math.min(...rs)).toBe(M.SIZE.leafOrbit);
});

test("layout: a status or message change moves nothing", () => {
  const f = realistic();
  const before = M.mapTree(buildBoard(f));
  for (const t of f.terminals) { t.status = t.status === "working" ? "idle" : "working"; if (t.report) { t.report.state = t.status; t.report.msg = "a much longer message than before, about what it is doing now"; } }
  const after = M.mapTree(buildBoard(f));
  const pos = (s) => s.nodes.map((n) => [n.key, n.x, n.y, n.r, n.labelY]).sort();
  for (const sc of [(t) => M.collapsedScene(t), (t) => M.expandedScene(t), (t) => M.collapsedScene(t, { open: t.jobs[1].roots[0].key })]) {
    expect(pos(sc(after))).toEqual(pos(sc(before)));
    expect(sc(after).bounds).toEqual(sc(before).bounds);
  }
  expect(M.collapsedScene(after).nodes.every((n) => !n.lineW || [...n.line].length <= Math.floor((n.lineW - 8) / 6.6))).toBe(true);
});

test("restyle: a laid-out scene takes new statuses, rings, needs, lines and live links from the tree, nothing moved", () => {
  const f = realistic();
  const before = M.mapTree(buildBoard(f));
  const scene = M.collapsedScene(before, { open: before.jobs[1].roots[0].key });
  const acp = f.terminals.find((t) => t.name === "acp"), moshi = f.terminals.find((t) => t.name === "research-moshi");
  acp.status = "blocked"; acp.report.state = "blocked"; f.agents.find((a) => a.address === acp.address).status = "blocked";
  moshi.status = "idle"; moshi.report.state = "idle"; f.agents.find((a) => a.address === moshi.address).status = "idle";
  const after = M.mapTree(buildBoard(f));
  const re = M.restyle(scene, after), fresh = M.collapsedScene(after, { open: after.jobs[1].roots[0].key });
  expect(re).toEqual(fresh);
  const lead = re.nodes.find((n) => n.label === "lead-repod-watch-core");
  expect([lead.needs, re.nodes.find((n) => n.label === "acp").status]).toEqual([1, "needs"]);
  expect(re.links.find((l) => l.to === byName(after, "research-moshi").key).live).toBe(false);
});

test("links: control point off the chord, live when the child works, linkPoint ends at both centres", () => {
  const tree = real();
  const ex = M.expandedScene(tree);
  const l = ex.links.find((k) => k.live);
  expect(M.linkPoint(l, 0)).toEqual(l.a);
  expect(M.linkPoint(l, 1)).toEqual(l.b);
  const mid = M.linkPoint(l, 0.5);
  expect(mid).toEqual([0.25 * l.a[0] + 0.5 * l.c[0] + 0.25 * l.b[0], 0.25 * l.a[1] + 0.5 * l.c[1] + 0.25 * l.b[1]]);
  expect(ex.links.length).toBe(tree.byKey.size - tree.jobs.reduce((n, j) => n + j.roots.length, 0));
  expect(ex.links.filter((k) => k.live).length).toBe(5); // six work, one of them a root
});

// ---- camera -----------------------------------------------------------------------------------------------------

test("camera: fit shows the bounds whole, never past scale 1, never below SCALE.min", () => {
  const vp = { width: 1440, height: 900 };
  const ex = M.expandedScene(real());
  const cam = M.fit(ex.bounds, vp);
  const b = ex.bounds;
  for (const [x, y] of [[b.x, b.y], [b.x + b.w, b.y + b.h]]) {
    const [sx, sy] = M.toScreen(cam, vp, x, y);
    expect(sx >= 48 - 1e-6 && sx <= vp.width - 48 + 1e-6 && sy >= 48 - 1e-6 && sy <= vp.height - 48 + 1e-6).toBe(true);
  }
  expect(M.fit({ x: 0, y: 0, w: 10, h: 10 }, vp).scale).toBe(1);
  expect(M.fit({ x: 0, y: 0, w: 1e6, h: 10 }, vp).scale).toBe(M.SCALE.min);
  expect(M.fit({ x: -5, y: -5, w: 0, h: 0 }, vp)).toEqual({ scale: 1, x: -5, y: -5 });
});

test("camera: zoomAt keeps the point under the pointer, clamps; pan follows the pointer; wheelFactor halves at STEP", () => {
  const vp = { width: 1000, height: 600 };
  const cam = { scale: 1, x: 40, y: -20 };
  const p = [800, 150];
  const world = (c) => [c.x + (p[0] - vp.width / 2) / c.scale, c.y + (p[1] - vp.height / 2) / c.scale];
  const z = M.zoomAt(cam, 2.5, p, vp);
  expect(z.scale).toBe(2.5);
  const [a, b] = [world(cam), world(z)];
  expect(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])).toBeLessThan(1e-9);
  const [sx, sy] = M.toScreen(z, vp, ...a);
  expect([Math.round(sx), Math.round(sy)]).toEqual(p);
  expect(M.zoomAt(cam, 100, p, vp).scale).toBe(M.SCALE.max);
  expect(M.zoomAt(cam, 0.001, { x: 800, y: 150 }, vp).scale).toBe(M.SCALE.min);
  const clamped = M.zoomAt(cam, 100, p, vp);
  expect(Math.abs(world(clamped)[0] - a[0])).toBeLessThan(1e-9);
  const moved = M.pan({ scale: 2, x: 0, y: 0 }, 100, -50);
  expect(moved).toEqual({ scale: 2, x: -50, y: 25 });
  expect(M.toScreen(moved, vp, 0, 0)).toEqual([600, 250]);
  expect(M.wheelFactor(M.STEP)).toBeCloseTo(0.5, 10);
  expect(M.wheelFactor(-M.STEP)).toBeCloseTo(2, 10);
  expect(M.wheelFactor(0)).toBe(1);
});

// ---- QA phase 2 -----------------------------------------------------------------------------------------------

// Every link sampled as a polyline must stay off every hub's label box (pill and line room), except the box of the
// hub it ends at (a link arrives at its child's centre from wherever the parent is).
const segMeets = (p, q, r) => {
  let t0 = 0, t1 = 1;
  const d = [q[0] - p[0], q[1] - p[1]];
  for (const [pp, qq] of [[-d[0], p[0] - r.x], [d[0], r.x + r.w - p[0]], [-d[1], p[1] - r.y], [d[1], r.y + r.h - p[1]]]) {
    if (pp === 0) { if (qq < 0) return false; continue; }
    const t = qq / pp;
    if (pp < 0) { if (t > t1) return false; t0 = Math.max(t0, t); } else { if (t < t0) return false; t1 = Math.min(t1, t); }
  }
  return t0 < t1;
};
const throughLabels = (scene) => {
  const out = [];
  for (const l of scene.links) {
    const pts = Array.from({ length: 41 }, (_, i) => M.linkPoint(l, i / 40));
    for (const n of scene.nodes) {
      if (!n.hub || n.key === l.to) continue;
      const b = labelBox(n);
      if (pts.some((p, i) => i > 0 && segMeets(pts[i - 1], p, b))) out.push(`${l.from}→${l.to} through ${n.label}`);
    }
  }
  return out;
};

test("QA 3: no link runs through a hub's pill or line (realistic, fan 5 and 14, mixed 14, five deep; Team and Expanded)", () => {
  const mixed = [unit("lead", { name: "lead-mixed-watch-core" })];
  for (let i = 0; i < 14; i++) {
    mixed.push(unit(`c${i}`, { parent: "lead", name: helperName(i) }));
    if (i < 5) for (let k = 0; k < 3; k++) mixed.push(unit(`c${i}.${k}`, { parent: `c${i}`, name: `sub-helper-${k}` }));
  }
  const trees = [real(), ...[fan(5), fan(14), mixed, deep()].map((us) => M.mapTree(board(["j", us])))];
  for (const tree of trees) {
    const leads = [...tree.byKey.values()].filter((a) => a.children.length);
    for (const s of scenes(tree)) {
      expect(throughLabels(s)).toEqual([]);
      expect(clashes(s)).toEqual([]);
    }
  }
  // the full circle (no sub-leads) leaves the sector under the lead empty: no child straight below it
  const five = M.expandedScene(M.mapTree(board(["j", fan(5)])));
  const lead = five.nodes.find((n) => n.key === "lead");
  for (const n of five.nodes) if (n !== lead) {
    const below = Math.atan2(n.x - lead.x, n.y - lead.y) * 180 / Math.PI;          // 0 = straight down
    expect(Math.abs(below)).toBeGreaterThan(30);
  }
});

test("QA 4: a job's head and meta sit at least 24 px above the topmost disc or label of its constellation", () => {
  for (const tree of [real(), M.mapTree(board(["j", deep()], ["k", fan(14)], ["m", fan(40)]))]) {
    const ex = M.expandedScene(tree);
    for (const h of ex.heads) {
      const mine = ex.nodes.filter((n) => tree.byKey.get(n.key).job === h.job);
      const top = Math.min(...mine.map((n) => Math.min(n.y - ringOut(n), n.labelY)));
      expect(top - (h.y + (h.meta ? 32 : 14))).toBeGreaterThanOrEqual(24 - 1e-6);
    }
  }
});

test("lines: a hub's count fits its fixed room; a helper has none", () => {
  const us = fan(140); for (let i = 1; i <= 12; i++) us[i].word = "needs";
  const tree = M.mapTree(board(["j", us]));
  const lead = M.collapsedScene(tree).nodes[0];
  expect([lead.line, lead.lineW]).toEqual(["140 helpers · 12 need you", M.LINE_ROOM]);
  expect(M.expandedScene(tree).nodes.filter((n) => !n.hub).every((n) => n.lineW === 0 && n.line === "")).toBe(true);
});

test("order: a parent's children in Core's start order (base-36 address counter), whatever Herdr's tab order", () => {
  // The QA sandbox's shape: each of lead-repod-watch-core's helpers in its own tab, the tabs in Herdr's arbitrary order.
  const f = realistic();
  const t = (name) => f.terminals.find((x) => x.name === name);
  const tabs = ["review", "micro", "voice", "design", "moshi"];
  const owner = { design: "design-states", review: "review-result", moshi: "research-moshi", voice: "research-voice", micro: "research-micro" };
  for (const tab of tabs) f.panes.push({ pane: `p-${tab}`, tab, terminal: t(owner[tab]).address, program: claude });
  f.spaces[1].tabs = [...tabs.map((id, i) => ({ id, name: id, index: i + 1 })), ...f.spaces[1].tabs]; // the lead's tab last
  const board = buildBoard(f);
  const boardOrder = board.regions[1].zones.flatMap((z) => z.units).map((u) => u.name);
  expect(boardOrder.indexOf("research-micro")).toBeLessThan(boardOrder.indexOf("research-moshi")); // the trap is set
  const tree = M.mapTree(board);
  const lead = byName(tree, "lead-repod-watch-core");
  expect(lead.children.map((c) => [c.name, c.key])).toEqual([
    ["design-states", "t8"], ["review-result", "t9"], ["research-moshi", "t10"], ["research-voice", "t14"], ["research-micro", "t18"]]);
  expect(tree.jobs[1].roots.map((r) => r.name)).toEqual(["lead-repod-watch-core"]);
  // and so the Team scene reads like the mockup
  const at = Object.fromEntries(M.collapsedScene(tree, { open: lead.key }).nodes.map((n) => [n.label, n.y]));
  expect(at["design-states"] > at["review-result"] && at["research-moshi"] < at["research-voice"] && at["research-voice"] < at["research-micro"]).toBe(true);
});

test("order: the counter is base 36 after any machine prefix; mixed machines or other addresses keep board order", () => {
  const kidsOf = (addrs) => M.mapTree(board(["j", [unit("L"), ...addrs.map((a) => unit(a, { parent: "L" }))]])).byKey.get("L").children.map((c) => c.key);
  expect(kidsOf(["t12b", "t7w", "t10g", "t125", "t7v"])).toEqual(["t7v", "t7w", "t10g", "t125", "t12b"]);
  expect(kidsOf(["t1b", "t19", "t9", "t10"])).toEqual(["t9", "t10", "t19", "t1b"]);
  expect(kidsOf(["box/t1c", "box/t2", "box/t1b"])).toEqual(["box/t2", "box/t1b", "box/t1c"]);
  expect(kidsOf(["box/t1c", "t2", "box/t1b"])).toEqual(["box/t1c", "t2", "box/t1b"]);      // two machines: board order
  expect(kidsOf(["t1c", "worker", "t1b"])).toEqual(["t1c", "worker", "t1b"]);              // not a Core address: board order
});

// ---- end review F1: a link passes no disc but its own two ends --------------------------------------------------

// The reviewer's shapes: a lead with `helpers` leaves and sub-leads of the given sizes.
const shape = (helpers, subs = []) => {
  const us = [unit("lead", { name: "lead-shape-watch-core" })];
  for (let i = 0; i < helpers; i++) us.push(unit(`h${i}`, { parent: "lead", name: helperName(i) }));
  subs.forEach((k, s) => {
    us.push(unit(`s${s}`, { parent: "lead", name: `sub-lead-${s}-research` }));
    for (let i = 0; i < k; i++) us.push(unit(`s${s}.${i}`, { parent: `s${s}`, name: `sub-${s}-helper-${i}` }));
  });
  return M.mapTree(board(["j", us]));
};
const throughDiscs = (scene) => {
  const out = [];
  for (const l of scene.links) {
    const pts = Array.from({ length: 41 }, (_, i) => M.linkPoint(l, i / 40));
    for (const n of scene.nodes) {
      if (n.key === l.from || n.key === l.to) continue;
      if (pts.some(([x, y]) => Math.hypot(x - n.x, y - n.y) < n.r + 2)) out.push(`${l.from}→${l.to} through ${n.label}`);
    }
  }
  return out;
};

test("F1: no link passes within r+2 of a disc but its own two (QA tree, 14 and 40 flat, sub-leads, mixed, deep)", () => {
  const mixed = [unit("lead", { name: "lead-mixed-watch-core" })];
  for (let i = 0; i < 14; i++) {
    mixed.push(unit(`c${i}`, { parent: "lead", name: helperName(i) }));
    if (i < 5) for (let k = 0; k < 3; k++) mixed.push(unit(`c${i}.${k}`, { parent: `c${i}`, name: `sub-helper-${k}` }));
  }
  const trees = [real(), shape(14), shape(40), shape(2, [5, 5, 5]), shape(2, [3, 3, 3]), shape(5, [4, 4]), shape(3, [6]),
    M.mapTree(board(["j", mixed])), M.mapTree(board(["j", deep()]))];
  for (const tree of trees) {
    const leads = [...tree.byKey.values()].filter((a) => a.children.length);
    for (const s of scenes(tree)) {
      expect(throughDiscs(s)).toEqual([]);
      expect(throughLabels(s)).toEqual([]);                                        // QA 3 still holds
      expect(clashes(s)).toEqual([]);
    }
  }
});

// Wanted, not required: with many flat helpers round one lead the inner discs' shadows close the gaps (14 in Team
// leaves one helper behind another, its curved link still clear of the disc: the test above). Pinned where it holds.
test("F1: no child sits in another's shadow where there is room (QA tree, sub-lead shapes)", () => {
  for (const tree of [real(), shape(2, [5, 5, 5]), shape(2, [3, 3, 3]), shape(5, [4, 4]), shape(3, [6])]) {
    for (const s of [M.expandedScene(tree), M.collapsedScene(tree, { open: tree.jobs[0].roots[0].key })]) {
      const at = new Map(s.nodes.map((n) => [n.key, n]));
      const out = [];
      for (const l of s.links) {
        const [a, b] = [at.get(l.from), at.get(l.to)];
        for (const n of s.nodes) {
          if (n === a || n === b) continue;
          const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((n.x - a.x) * dx + (n.y - a.y) * dy) / (dx * dx + dy * dy)));
          if (Math.hypot(a.x + t * dx - n.x, a.y + t * dy - n.y) < n.r + 2) out.push(`${n.label} shadows ${b.label}`);
        }
      }
      expect(out).toEqual([]);
    }
  }
});

test("fit: every mode fits whole and centred in the view less the card's room, at any view size", () => {
  const tree = relayTree();
  const navs = [M.startNav(), ...tree.jobs.map((j) => M.clickAgent(tree, M.startNav(), j.roots[0].key)), M.setMode(tree, M.startNav(), "expanded")];
  for (const vp of [{ width: 1232, height: 760 }, { width: 390, height: 700 }]) for (const nav of navs) {
    const inset = { bottom: 130 }, pad = 24;
    const { scene: s, cam } = M.fitScene(tree, nav, vp, pad, inset);
    const [x0, y0] = M.toScreen(cam, vp, s.bounds.x, s.bounds.y), [x1, y1] = M.toScreen(cam, vp, s.bounds.x + s.bounds.w, s.bounds.y + s.bounds.h);
    const e = 1e-6;
    // whole, unless even the smallest scale can't hold it (then it is centred and the person pans)
    if (cam.scale > M.SCALE.min) expect(x0 >= pad - e && x1 <= vp.width - pad + e && y0 >= pad - e && y1 <= vp.height - inset.bottom - pad + e).toBe(true);
    // centred in the room left
    expect(Math.abs((x0 - 0) - (vp.width - x1))).toBeLessThan(1e-6);
    expect(Math.abs(y0 - (vp.height - inset.bottom - y1))).toBeLessThan(1e-6);
  }
});

test("simple: no levels, breadcrumb, job scene, team scene or level steps left in the model", () => {
  for (const gone of ["LEVELS", "levelOf", "gotoLevel", "crumbs", "openJob", "zoomStep", "jobScene", "teamScene", "fleetScene", "LIVE_DOT"]) expect(M[gone]).toBeUndefined();
});

// ---- QA 2155: the scene's own shapes (map-scene.sh) -------------------------------------------------------------

// Two native jobs on this computer and the relay job on studio-mac: its lead (done) and three workers with no Core
// parent, each in its own tab, one needing you; the job's relay terminal and a plain shell are never drawn.
function qaScene() {
  const f = realistic();
  const tree = f.terminals.find((t) => t.name === "lead-demo-restructure");
  tree.name = "lead-demo-tree";
  f.terminals.find((t) => t.name === "build-relay-config").name = "build-tabs-config";
  const ship = { address: "t40", state: "live", status: "blocked", name: "ship-notes", program: claude, parent: tree.address, report: { state: "blocked", kind: "permission", msg: "Bash wants to run: git push" } };
  f.terminals.push(ship); f.agents.push({ address: "t40", status: "blocked" });
  const host = "studio-mac", job = "hc-5a4f5e1c9038";
  const add = (id, name, role, status, program = claude) => {
    const address = `${host}/${id}`;
    f.terminals.push({ address, state: "live", status, name, program, parent: null, labels: { "stampede.job": job, "stampede.role": role }, report: { state: status, app: program.key } });
    f.agents.push({ address, status });
    f.panes.push({ pane: `p-${id}`, tab: `r-${name}`, terminal: address, program });
    return `r-${name}`;
  };
  const tabs = [add("t7w", "lead-demo-restructure", "lead", "done"), add("t10g", "review-backend-tui", "worker", "idle", codex),
    add("t10h", "build-backend-tui", "worker", "working"), add("t10i", "build-relay-config", "worker", "blocked")];
  f.terminals.push({ address: `${host}/t10j`, state: "live", status: null, name: "relay-5a4f5e1c9038", program: zsh, parent: null, labels: { "stampede.job": job, "stampede.role": "relay" } });
  f.spaces.push({ id: "s3", name: "stampede-restructure-1113", machine: host, tabs: tabs.map((id, i) => ({ id, name: id.slice(2), index: i + 1 })) });
  f.machines = [{ name: null, layout: "ready" }, { name: host, layout: "ready" }];
  return M.mapTree(buildBoard(f), teamParents(f.terminals));
}
const qaNavs = (tree) => [M.startNav(), ...tree.jobs.map((j) => M.clickAgent(tree, M.startNav(), j.roots[0].key)), M.setMode(tree, M.startNav(), "expanded")];

test("QA 1, 2: the relay job on another machine has its lead as hub, its workers as helpers, in every view", () => {
  const tree = qaScene();
  expect(tree.jobs.map((j) => [j.name, j.roots.map((r) => r.name), j.agents])).toEqual([
    ["stampede-restructure", ["lead-demo-tree"], 7], ["watch-agent-controller", ["lead-repod-watch-core"], 15],
    ["stampede-restructure-1113", ["lead-demo-restructure"], 4]]);
  const relay = tree.jobs[2].roots[0];
  expect(relay.children.map((c) => c.name)).toEqual(["review-backend-tui", "build-backend-tui", "build-relay-config"]);
  expect(tree.byKey.size).toBe(26);
  const col = M.sceneOf(tree, M.startNav());
  expect(col.nodes.map((n) => [n.label, n.line])).toEqual([["lead-demo-tree", "6 helpers · 1 needs you"],
    ["lead-repod-watch-core", "14 helpers"], ["lead-demo-restructure", "3 helpers · 1 needs you"]]);
  for (const nav of [M.clickAgent(tree, M.startNav(), relay.key), M.setMode(tree, M.startNav(), "expanded")]) {
    const s = M.sceneOf(tree, nav);
    expect(s.links.filter((l) => l.from === relay.key).map((l) => tree.byKey.get(l.to).name).sort()).toEqual(["build-backend-tui", "build-relay-config", "review-backend-tui"]);
    expect(s.nodes.find((n) => n.key === relay.key)).toMatchObject({ role: "lead", hub: true });
  }
});

test("QA 4: every view fits whole, centred, clear of the edges and of the card's room", () => {
  const tree = qaScene();
  for (const vp of [{ width: 1232, height: 760 }, { width: 390, height: 700 }]) for (const nav of qaNavs(tree)) {
    const pad = 32, inset = { bottom: 120 };
    const { scene: s, cam } = M.fitScene(tree, nav, vp, pad, inset);
    const [x0, y0] = M.toScreen(cam, vp, s.bounds.x, s.bounds.y), [x1, y1] = M.toScreen(cam, vp, s.bounds.x + s.bounds.w, s.bounds.y + s.bounds.h);
    const room = vp.height - inset.bottom, e = 1e-6;
    if (cam.scale > M.SCALE.min) expect(x0 >= pad - e && x1 <= vp.width - pad + e && y0 >= pad - e && y1 <= room - pad + e).toBe(true); // nothing at an edge
    expect(Math.abs(x0 - (vp.width - x1)) < e && Math.abs(y0 - (room - y1)) < e).toBe(true);               // centred: no band on one side
    if (cam.scale < 1) expect(Math.min(x0, y0) - pad).toBeLessThan(e);                                     // filled to the pad on one axis
  }
});

// Discs, pills, names and heads: nothing over anything; links off every hub's pill and line (but its own incoming
// link), off every helper's own name, and off every disc but their own two.
const headBox = (h) => { const w = Math.max([...h.title].length * 8.2 + 8, h.meta ? [...h.meta].length * 6.6 + 19 : 0); return { x: h.x - w / 2, y: h.y, w, h: h.meta ? 32 : 14 }; };
const ownName = (s) => s.links.flatMap((l) => {
  const n = s.nodes.find((x) => x.key === l.to);
  if (n.hub) return [];
  const pts = Array.from({ length: 41 }, (_, i) => M.linkPoint(l, i / 40));
  return pts.some((p, i) => i > 0 && segMeets(pts[i - 1], p, labelBox(n))) ? [`${n.label}'s link runs through its name`] : [];
});

test("QA 5, 12: Collapsed with each lead open and All expanded: no pill over pill, no head through nodes, links off labels", () => {
  const tree = qaScene();
  for (const width of [1232, 390]) for (const nav of qaNavs(tree)) {
    const s = M.sceneOf(tree, nav, { width });
    expect(clashes(s)).toEqual([]);
    expect(throughLabels(s)).toEqual([]);
    expect(throughDiscs(s)).toEqual([]);
    expect(ownName(s)).toEqual([]);
    const heads = s.heads.map(headBox);
    for (const n of s.nodes) for (const h of heads) {
      expect(rectsMeet(labelBox(n), h) || discMeetsRect([n.x, n.y, ringOut(n)], h)).toBe(false);
    }
    for (let i = 0; i < heads.length; i++) for (let j = i + 1; j < heads.length; j++) expect(rectsMeet(heads[i], heads[j])).toBe(false);
  }
  // a helper above its lead names itself above its disc, so its own link stays clear
  const ex = M.expandedScene(tree), at = new Map(ex.nodes.map((n) => [n.key, n]));
  const above = ex.nodes.filter((n) => !n.hub && at.get(tree.byKey.get(n.key).parent).y - n.y > n.r);
  expect(above.length).toBeGreaterThan(0);
  expect(above.every((n) => n.labelAbove && n.labelY + 16 < n.y - n.r)).toBe(true);
});

test("QA 5: a pill is wide enough for the view's own: name at 13 px (lead) or 12 px, padding, mark and gap", () => {
  const tree = qaScene();
  for (const n of M.expandedScene(tree).nodes.filter((x) => x.role === "lead")) {   // only leads wear a pill
    expect(n.labelW).toBeGreaterThanOrEqual([...n.label].length * 8 + 24 + 7 + 8);
  }
});

// The view draws text at a fixed px size and scales the rest with the camera: at the scale a scene is shown, its text
// boxes (in px) must still keep apart and clear of the heads, or names meet heads (build-view's frame,
// selected-relay-remote.png: review-onesource over "This computer · 7 agents", acp / local over a meta).
test("scale: laid out for the scale it is shown at, the text the view draws keeps apart and heads stay 24 px clear", () => {
  const tree = qaScene();
  const views = [[{ width: 1232, height: 760 }, { bottom: 170 }], [{ width: 1440, height: 900 }, { bottom: 170 }], [{ width: 1440, height: 900 }, {}],
    [{ width: 1232, height: 842 }, {}], [{ width: 800, height: 500 }, {}], [{ width: 390, height: 700 }, { bottom: 170 }]];
  let small = 1;
  for (const [vp, inset] of views) for (const nav of qaNavs(tree)) {
    const { scene: s, cam, scale } = M.fitScene(tree, nav, vp, 32, inset);
    small = Math.min(small, cam.scale);
    expect(cam.scale >= scale || scale === M.SCALE.min).toBe(true);                 // shown at least as large as laid out
    // Screen boxes as the view draws them: discs scale (with their rings 8 px out, or a team ring's 2), text keeps
    // its px size (a name 16 tall, a lead's pill 26, a pill and its line 49, a head 32), each name 4 px past its ring
    // box, at the place the model gives, drawn once the camera's scale reaches the node's nameAt.
    const S = (x, y) => M.toScreen(cam, vp, x, y), k = cam.scale, boxes = [];
    for (const n of s.nodes) {
      const [x, y] = S(n.x, n.y), R = Math.max(n.r * k + 8, n.ringR ? n.ringR * k + 2 : 0);
      expect(n.r * k).toBeGreaterThanOrEqual(8 - 1e-6);                                  // no disc under 8 px
      boxes.push({ who: `${n.label} disc`, x: x - R, y: y - R, w: 2 * R, h: 2 * R, of: n.key, disc: true });
      if (k < n.nameAt - 1e-9) continue;                                                   // not drawn this small
      const h = n.lineW ? 49 : n.role === "lead" ? 26 : 16, w = Math.max(n.labelW, n.lineW) * k;
      const top = n.labelAbove ? y - R - 4 - h : S(n.x, n.labelY)[1];
      if (!n.labelAbove) expect(top - (y + R)).toBeGreaterThanOrEqual(4 - 1e-6);           // under the ring box, never on it
      else expect(S(n.x, n.labelY)[1]).toBeLessThanOrEqual(top + 1e-6);                    // the model kept that room above
      boxes.push({ who: `${n.label} label`, x: x - w / 2, y: top, w, h, of: n.key });
    }
    for (const hd of s.heads) {
      const [x, y] = S(hd.x, hd.y), w = Math.max([...hd.title].length * 8.2 + 8, hd.meta ? [...hd.meta].length * 6.6 + 19 : 0);
      const mine = boxes.filter((b) => b.of && tree.byKey.get(b.of).job === hd.job);
      expect(Math.min(...mine.map((b) => b.y)) - (y + 32)).toBeGreaterThanOrEqual(24 - 1e-6);   // 24 px under the head, on screen
      boxes.push({ who: `${hd.title} head`, x: x - w / 2, y, w, h: 32 });
    }
    const meet = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.disc && b.disc) continue;                                                   // discs: the world test covers them
      if (a.of && a.of === b.of) continue;
      if (a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6) meet.push(`${a.who} / ${b.who}`);
    }
    expect(meet).toEqual([]);
  }
  expect(small).toBeLessThan(0.8);                                                     // the small views really scale down
});

test("QA N1: at 390 wide the jobs stack, no heading meets another, and every lead's pill holds its whole name", () => {
  const tree = qaScene();
  for (const vp of [{ width: 390, height: 700 }, { width: 390, height: 844 }]) for (const nav of qaNavs(tree).filter((n) => n.mode === "collapsed")) {
    const { scene: s, cam } = M.fitScene(tree, nav, vp, 32);
    const heads = s.heads.map((h) => {
      const [x, y] = M.toScreen(cam, vp, h.x, h.y), w = Math.max([...h.title].length * 8.2 + 8, [...h.meta].length * 6.6 + 19);
      return { x: x - w / 2, y, w, h: 32 };
    });
    expect(new Set(heads.map((h) => Math.round(h.y))).size).toBe(3);                 // one job a row
    for (let i = 0; i < heads.length; i++) for (let j = i + 1; j < heads.length; j++) expect(rectsMeet(heads[i], heads[j])).toBe(false);
    for (const h of heads) expect(h.x >= 0 && h.x + h.w <= vp.width).toBe(true);      // a heading fits the view's width
    for (const n of s.nodes.filter((x) => x.role === "lead")) {
      expect(n.labelW * cam.scale).toBeGreaterThanOrEqual([...n.label].length * 8 + 24 + 7 + 8);  // the whole name, at 13 px
      const [x] = M.toScreen(cam, vp, n.x, n.y);
      expect(x - (n.labelW * cam.scale) / 2 >= 0 && x + (n.labelW * cam.scale) / 2 <= vp.width).toBe(true);
    }
  }
});

// ---- design review (2155) -------------------------------------------------------------------------------------

// The view fits the map to the whole view (the card floats over it, build-view 2155).
test("B2 / F2: All expanded names everyone where that fits (1440x900, 1232x800), else keeps names for what is drawn; always whole", () => {
  const tree = qaScene();
  for (const [vp, everyone] of [[{ width: 1440, height: 900 }, true], [{ width: 1232, height: 800 }, true], [{ width: 1100, height: 700 }, false], [{ width: 390, height: 844 }, false]]) {
    const { scene: s, cam, whole } = M.fitScene(tree, M.setMode(tree, M.startNav(), "expanded"), vp, 32);
    expect(s.nodes.length).toBe(26);
    const named = s.nodes.filter((n) => cam.scale >= n.nameAt - 1e-9);
    if (everyone) expect(named.length).toBe(26);
    else expect(named.length).toBeLessThan(26);                                                  // tiered: the rest by tooltip
    expect(s.nodes.filter((n) => n.role === "lead").every((n) => named.includes(n))).toBe(true);  // leads always named
    expect(Math.min(...s.nodes.map((n) => n.r * cam.scale))).toBeGreaterThanOrEqual(8 - 1e-6);
    const [x0, y0] = M.toScreen(cam, vp, s.bounds.x, s.bounds.y), [x1, y1] = M.toScreen(cam, vp, s.bounds.x + s.bounds.w, s.bounds.y + s.bounds.h);
    expect([vp.width, whole, x0 >= 32 - 1e-6 && y0 >= 32 - 1e-6 && x1 <= vp.width - 32 + 1e-6 && y1 <= vp.height - 32 + 1e-6]).toEqual([vp.width, true, true]);
  }
});

test("F2: fitSearch lays out once per step, and fitScene is it run to the end", () => {
  const tree = qaScene(), nav = M.setMode(tree, M.startNav(), "expanded");
  for (const vp of [{ width: 1440, height: 900 }, { width: 1100, height: 700 }]) {
    const run = M.fitSearch(tree, nav, vp, 32);
    let steps = 1, r;
    while (!(r = run.next()).done) steps++;
    expect(r.value.scene).toEqual(M.fitScene(tree, nav, vp, 32).scene);
    expect(steps).toBeLessThanOrEqual(8);                                                    // a layout pass each
  }
});

test("B3: only leads wear a pill; a sub-lead has a plain 12 px name, a helper an 11 px one", () => {
  const tree = qaScene();
  for (const s of [M.expandedScene(tree), M.collapsedScene(tree, { open: tree.jobs[1].roots[0].key })]) {
    for (const n of s.nodes) {
      const c = [...n.label].length;
      const want = n.role === "lead" ? c * 8 + 44 : n.role === "sub-lead" ? c * 7.4 + 19 : c * 6.6 + 19;
      expect([n.label, n.labelW]).toEqual([n.label, want]);
      if (n.role !== "lead") expect([n.label, labelBox(n).h, n.lineW]).toEqual([n.label, 16, 0]);
    }
  }
});

test("4: a job's heading says its machine and branch, no count; only a folded lead carries the team line", () => {
  const tree = qaScene();
  const col = M.collapsedScene(tree);
  expect(col.heads.map((h) => [h.title, h.machine, h.meta])).toEqual([["stampede-restructure", "This computer", ""],
    ["watch-agent-controller", "This computer", "master"], ["stampede-restructure-1113", "studio-mac", ""]]);
  expect(col.nodes.map((n) => n.line)).toEqual(["6 helpers · 1 needs you", "14 helpers", "3 helpers · 1 needs you"]);
  const open = M.collapsedScene(tree, { open: tree.jobs[1].roots[0].key });
  expect(open.nodes.filter((n) => n.line).map((n) => n.label)).toEqual(["lead-demo-tree", "lead-demo-restructure"]);  // the folded two
  expect(M.expandedScene(tree).nodes.every((n) => n.line === "" && n.lineW === 0)).toBe(true);
});

test("6: every name sits past its ring box (status or selection ring 8 px out, a team ring's 2), never on it", () => {
  const tree = qaScene();
  for (const s of [M.collapsedScene(tree), M.collapsedScene(tree, { open: tree.jobs[1].roots[0].key }), M.expandedScene(tree)]) {
    for (const n of s.nodes) {
      const o = ringOut(n);
      if (n.labelAbove) expect(n.y - o - (n.labelY + labelBox(n).h)).toBeGreaterThanOrEqual(4 - 1e-9);
      else expect(n.labelY - (n.y + o)).toBeGreaterThanOrEqual(4 - 1e-9);
    }
  }
});

test("labelPx: the px width of a node's label as the view draws it, the same at any scale", () => {
  const tree = qaScene();
  for (const scale of [1, 0.4]) {
    const s = M.expandedScene(tree, { scale, names: true });
    for (const n of s.nodes) expect(M.labelPx(n)).toBeCloseTo(n.labelW * scale, 6);   // where its room is kept, the same width
  }
  const hidden = M.expandedScene(tree, { scale: 0.3, names: false }).nodes.find((n) => n.role === "helper");
  expect([hidden.nameAt, M.labelPx(hidden)]).toEqual([Infinity, [...hidden.label].length * 6.6 + 19]);
});
