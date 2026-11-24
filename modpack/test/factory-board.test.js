// The factory's data model: grouping (machine → workspace → tab → pane), the mind map (left to right, edges only
// from what Core recorded), text taken verbatim, couriers only from evidence, and no motion without a change.
import { test, expect } from "bun:test";
import {
  buildBoard, counts, bubbleText, observe, newObservation,
  bubblesNow, couriersNow, pulsesNow, prune, nextDeadline, bubblePhase, courierPhase, sinceOf, MOTION, HISTORY,
  unitKind, readingGroups, bandEmpty, GRID, tabNamed, mindMap, mindSection, elbow, nodeMessage, freshNow, plainCount, NODE, SECTION,
} from "../adapters/factory.js";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import * as factory from "../adapters/factory.js";
import { readFileSync } from "node:fs";
import { contrast, toHsl, fromHsl, glassGrounds } from "../adapters/tokens.js";

const claude = { key: "claude", name: "Claude Code", agent: true, shell: false };
const codex = { key: "codex", name: "Codex", agent: true, shell: false };
const zsh = { key: "shell", name: "zsh", agent: false, shell: true };

// Two workspaces, three tabs, splits, a Core child with its own pane in another tab, a mod pane, a shell.
function fixture() {
  const spaces = [
    { id: "s1", name: "core-client", active: true, tabs: [{ id: "a", name: "lead", index: 1, active: true }, { id: "b", name: "review", index: 2 }] },
    { id: "s2", name: "evals", tabs: [{ id: "c", name: "checks", index: 1 }] },
  ];
  const panes = [
    { pane: "p1", tab: "a", terminal: "t1", program: claude, title: "lead" },
    { pane: "p2", tab: "a", terminal: "t5", program: zsh, title: "~/x" },
    { pane: "p3", tab: "b", terminal: "t3", program: codex },
    { pane: "p4", tab: "b", terminal: "t2", program: codex }, // t2 is t1's child: shown beside t1
    { pane: "p5", tab: "b", terminal: null, mod: "pdk-chat" },
    { pane: "p6", tab: "c", terminal: "t4", program: claude },
  ];
  const terminals = [
    { address: "t1", state: "live", status: "working", report: { state: "working", app: "claude-code", msg: "Reading src/a.js (r1)" }, program: claude, name: "lead", records: { r1: { state: "working", title: "Explore", msg: "grep TODO" } } },
    { address: "t2", state: "live", status: "blocked", parent: "t1", name: "worker", program: codex, report: { state: "blocked", kind: "permission", msg: "approve Write: /tmp/x/notes.txt" } },
    { address: "t6", state: "live", status: "idle", parent: "t2", name: "helper", program: codex, report: { state: "idle" } },
    { address: "t3", state: "live", status: "done", program: codex, name: "review", report: { state: "done" } },
    { address: "t4", state: "live", status: "idle", program: claude, report: { state: "idle", title: "Eval harness" } },
    { address: "t5", state: "live", status: null, program: zsh },
    { address: "t7", state: "live", status: "working", program: codex, name: "background", report: { state: "working" } },
    { address: "t8", state: "finished", status: null, program: zsh },
  ];
  const agents = [{ address: "t1", status: "working" }, { address: "t2", status: "blocked" }, { address: "t3", status: "done" }, { address: "t4", status: "idle" }];
  return { spaces, panes, terminals, agents, machines: [{ name: null, layout: "ready" }], focused: { terminal: "t4" } };
}

test("grouping: workspaces hold tabs as zones, tabs hold panes as units in pane order, paneless children beside their parent", () => {
  const board = buildBoard(fixture());
  expect(board.state).toBe("ready");
  expect(board.regions.map((r) => [r.name, r.zones.map((z) => z.name)])).toEqual([
    ["core-client", ["lead", "review"]], ["evals", ["checks"]], ["Without a pane", ["Running in herdr-core"]],
  ]);
  const [lead, review] = board.regions[0].zones;
  // lead: t1, then the split shell t5. t2 is t1's child but has its own pane in "review": it stays there (G7),
  // started by t1, with its paneless child t6 beside it. The mod pane is not a unit.
  expect(lead.squads.map((s) => s.map((u) => [u.address, u.depth, u.parent]))).toEqual([[["t1", 0, null]], [["t5", 0, null]]]);
  expect(review.squads.map((s) => s.map((u) => [u.address, u.depth, u.parent, u.startedBy]))).toEqual([
    [["t3", 0, null, null]], [["t2", 0, null, "t1"], ["t6", 1, "t2", "t2"]],
  ]);
  expect(board.regions[2].zones[0].units.map((u) => u.address)).toEqual(["t7"]); // running, reporting, no pane
  expect(board.regions.flatMap((r) => r.zones.flatMap((z) => z.units.map((u) => u.address)))).not.toContain("t8");
  const u = (a) => board.regions.flatMap((r) => r.zones.flatMap((z) => z.units)).find((x) => x.address === a);
  expect([u("t1").kind.label, u("t3").kind.label, u("t5").kind.label, u("t5").kind.agent, u("t7").kind.agent]).toEqual(["Claude Code", "Codex", "zsh", false, true]);
  expect([u("t2").word, u("t2").blockKind, u("t3").word, u("t4").focused, u("t1").focused]).toEqual(["needs", "permission", "done", true, false]);
  expect(u("t1").records).toEqual([{ id: "r1", depth: 0, title: "Explore", word: "working", text: "grep TODO", msg: "grep TODO" }]);
  expect([lead.word, review.word]).toEqual(["working", "needs"]); // the blocked child is in review now
  expect(counts(board)).toEqual({ workspaces: 2, zones: 3, units: 7, agents: 6, records: 1, needs: 1 });
});

test("states: loading, error and empty are their own boards", () => {
  expect(buildBoard({ machines: [{ name: null, layout: "loading" }] }).state).toBe("loading");
  expect(buildBoard({ machines: [{ name: null, layout: "unavailable" }] })).toMatchObject({ state: "error" });
  expect(buildBoard({ machines: [{ name: null, layout: "ready" }] }).state).toBe("empty");
});

test("a pane title that is only the terminal's address is not a name: the agent reads as its tab (request 14)", () => {
  const named = buildBoard({ ...fixture(), panes: [{ pane: "p", tab: "a", terminal: "t9", program: claude, title: "t9" }], terminals: [{ address: "t9", state: "live", program: claude }] });
  expect(named.regions[0].zones[0].units[0].name).toBe("lead");
});

test("bubble text is the program's own words, exactly; the raw state word only when it sent none", () => {
  const msg = "  Edit modpack/adapters/factory.js:42 (id=r1/r2)  ·  t9\n";
  expect(bubbleText({ state: "working", msg })).toBe(msg);
  expect(bubbleText({ state: "blocked", kind: "permission", msg: "" })).toBe("blocked");
  expect(bubbleText({ state: "idle" })).toBe("idle");
  expect(bubbleText(null)).toBeNull();
  const obs = newObservation(1000);
  const t = (m) => [{ address: "t1", state: "live", created_ms: 1, report: { state: "working", msg: m } }];
  observe(obs, t("first"), 1000);
  observe(obs, t(msg), 2000);
  expect(obs.bubbles.map((b) => b.text)).toEqual([msg]);
  expect(obs.agents.get("t1").history.map((h) => [h.text, h.observed])).toEqual([[msg, true], ["first", false]]);
  // A record speaks too, with its own words and its title as the label.
  observe(obs, [{ address: "t1", state: "live", created_ms: 1, report: { state: "working", msg }, records: { "r1/r2": { state: "working", title: "Read", msg: "cat a/b.md" } } }], 3000);
  expect(obs.bubbles.at(-1)).toMatchObject({ text: "cat a/b.md", label: "Read", source: "record" });
});

test("no motion without a change: the same list twice draws nothing new, and nothing is scheduled", () => {
  const obs = newObservation(5000);
  const list = [
    { address: "t1", state: "live", created_ms: 100, status: "working", report: { state: "working", msg: "already busy" } },
    { address: "t2", state: "live", created_ms: 100, parent: "t1", status: "idle", report: { state: "idle" } },
  ];
  // Present at the first look: history only, no bubble, no pulse, no courier for an old child.
  expect(observe(obs, list, 5000)).toBe(false);
  expect(observe(obs, list, 6000)).toBe(false);
  expect([obs.bubbles.length, obs.couriers.length, obs.pulses.size]).toEqual([0, 0, 0]);
  expect(nextDeadline(obs, 6000)).toBeNull();
  expect(obs.agents.get("t1").history[0]).toMatchObject({ text: "already busy", observed: false });
  // One observed change: one bubble, one pulse, deadlines until they end, then nothing again.
  const next = [{ ...list[0], status: "idle", report: { state: "idle", msg: "done: wrote x.md" } }, list[1]];
  expect(observe(obs, next, 7000)).toBe(true);
  expect(obs.bubbles.map((b) => b.text)).toEqual(["done: wrote x.md"]);
  expect([...pulsesNow(obs, 7000).keys()]).toEqual(["t1"]);
  expect(nextDeadline(obs, 7000)).toBe(7000 + MOTION.pulseOn);
  expect(observe(obs, next, 8000)).toBe(false);
  const end = 7000 + MOTION.bubbleShow + MOTION.bubbleFade;
  prune(obs, end);
  expect([obs.bubbles.length, obs.pulses.size, nextDeadline(obs, end)]).toEqual([0, 0, null]);
  expect(sinceOf(obs.agents.get("t1"), null)).toEqual({ at: 7000, basis: "observed" });
  expect(sinceOf(obs.agents.get("t1"), 4000)).toEqual({ at: 7000, basis: "observed" }); // a seen change wins
  expect(sinceOf(obs.agents.get("t2"), 4000)).toEqual({ at: 4000, basis: "core" });
  expect(sinceOf(obs.agents.get("t2"), null)).toEqual({ at: 5000, basis: "at least" });
});

test("phases, and Reduce Motion: no fade, no ring, no travel", () => {
  const b = { at: 0 };
  expect([bubblePhase(b, 10), bubblePhase(b, MOTION.bubbleShow + 1), bubblePhase(b, MOTION.bubbleShow + MOTION.bubbleFade)]).toEqual(["show", "fade", "gone"]);
  expect(bubblePhase(b, MOTION.bubbleShow + 1, true)).toBe("gone");
  const c = { at: 0 };
  expect([courierPhase(c, 0), courierPhase(c, MOTION.courierDepart + 1), courierPhase(c, MOTION.courierHold - 1), courierPhase(c, MOTION.courierHold)]).toEqual(["depart", "travel", "arrived", "gone"]);
  expect(courierPhase(c, 0, true)).toBe("arrived");
  const obs = newObservation(10); // t1 was there before the board's first look
  observe(obs, [{ address: "t1", state: "live", created_ms: 1, report: { state: "idle" } }], 10);
  observe(obs, [{ address: "t1", state: "live", created_ms: 1, report: { state: "working" } }], 100);
  expect(pulsesNow(obs, 100, true).size).toBe(0);
  expect(nextDeadline(obs, 100, true)).toBe(100 + MOTION.bubbleShow);
  expect(bubblesNow(obs, 100, true).get("t1").phase).toBe("show");
});

test("couriers only from evidence: a Core child seen starting; nothing else moves between agents", () => {
  const obs = newObservation(1000);
  const lead = { address: "t1", state: "live", created_ms: 10, report: { state: "working" } };
  const old = { address: "t2", state: "live", created_ms: 20, parent: "t1", report: { state: "working" } };
  observe(obs, [lead, old], 1000);
  expect(obs.couriers).toEqual([]); // started before the board looked: a static line, not a courier
  const kid = { address: "t3", state: "live", created_ms: 1500, parent: "t1", name: "build", report: { state: "working", msg: "starting" } };
  observe(obs, [lead, old, kid], 2000);
  expect(obs.couriers.map((c) => [c.kind, c.from, c.to, c.source])).toEqual([["start", "t1", "t3", "herdr-core parent"]]);
  expect(obs.bubbles.map((b) => [b.address, b.text])).toEqual([["t3", "starting"]]); // its first words, seen
  // A child whose parent the board doesn't know, and every later change: no courier. Messages between agents
  // are not recorded anywhere the board can read.
  observe(obs, [lead, { ...old, report: { state: "idle", msg: "sent t1 the report" } }, kid, { address: "t9", state: "live", created_ms: 2500, parent: "t77" }], 3000);
  expect(obs.couriers.length).toBe(1);
  expect(couriersNow(obs, 3300).map((x) => x.phase)).toEqual(["arrived"]);
  expect(couriersNow(obs, 2000).map((x) => x.phase)).toEqual(["depart"]);
});

test("F12: past the history cap the oldest entries go and are counted; each kept one keeps its own time", () => {
  const obs = newObservation(0);
  const at = (i) => [{ address: "t1", state: "live", created_ms: -1, report: { state: i % 2 ? "working" : "idle", msg: `step ${i}` } }];
  for (let i = 0; i <= HISTORY + 5; i++) observe(obs, at(i), 1000 + i * 10);
  const a = obs.agents.get("t1");
  expect(a.history.length).toBe(HISTORY);
  expect(a.dropped).toBe(6); // the first look (step 0, not observed) and steps 1..5
  expect(a.history.at(-1)).toMatchObject({ text: "step 6", at: 1060, observed: true });
  expect(a.history.every((h) => h.observed && h.at >= 1060)).toBe(true);
  expect(sinceOf(a, null)).toEqual({ at: 1000 + (HISTORY + 5) * 10, basis: "observed" });
});

test("F13: the board opens no file at all: no fleet paths, no reads, no folder watches, no exec", () => {
  for (const name of ["safeJob", "jobPath", "jobDir", "readInbox", "fleetRoles"]) expect(factory[name]).toBeUndefined();
  const view = readFileSync(new URL("../mods/pdk-factory/main.js", import.meta.url), "utf8");
  const imports = view.match(/import \{([^}]*)\} from "herdr"/)[1];
  for (const fn of ["readTextFile", "watchFolder", "exec", "writeTextFile"]) expect(imports).not.toMatch(new RegExp(`\\b${fn}\\b`));
});

test("G7: every real pane stays in its own tab; only paneless or same-tab children stand beside their parent", () => {
  const spaces = [
    { id: "s1", name: "a", tabs: [{ id: "A", name: "lead" }, { id: "B", name: "other" }] },
    { id: "s2", name: "b", tabs: [{ id: "C", name: "far" }] },
  ];
  const T = (address, parent = null) => ({ address, parent, state: "live", program: codex, report: { state: "working" } });
  const terminals = [T("t1"), T("t2", "t1"), T("t3", "t1"), T("t4", "t1"), T("t5", "t1")];
  const at = (panes) => {
    const b = buildBoard({ spaces, panes, terminals, machines: [{ name: null, layout: "ready" }] });
    const where = {};
    for (const r of b.regions) for (const z of r.zones) for (const u of z.units) where[u.address] = [z.id, u.depth, u.startedBy];
    return where;
  };
  const panes = [
    { pane: "p1", tab: "A", terminal: "t1", program: codex },
    { pane: "p2", tab: "A", terminal: "t2", program: codex }, // same tab: beside its parent
    { pane: "p3", tab: "B", terminal: "t3", program: codex }, // another tab: stays there
    { pane: "p4", tab: "C", terminal: "t4", program: codex }, // another workspace: stays there
  ]; // t5 has no pane: beside its parent
  expect(at(panes)).toEqual({ t1: ["A", 0, null], t2: ["A", 1, "t1"], t5: ["A", 1, "t1"], t3: ["B", 0, "t1"], t4: ["C", 0, "t1"] });
  // Moved: t2's pane goes to tab B, and t1's to the other workspace; each unit follows its own pane.
  const moved = panes.map((p) => (p.terminal === "t2" ? { ...p, tab: "B" } : p.terminal === "t1" ? { ...p, tab: "C" } : p));
  expect(at(moved)).toEqual({ t1: ["C", 0, null], t5: ["C", 1, "t1"], t4: ["C", 1, "t1"], t2: ["B", 0, "t1"], t3: ["B", 0, "t1"] });
});


test("G10: the unit's kind is the shared detector's (Hermes, not Python), its name not the program's name", () => {
  const python = { key: "program", name: "Python", agent: false, shell: false };
  const hermes = {
    address: "t9", state: "live", reported: false, status: null, program: python,
    argv: ["hermes", "--tui"], foreground: { argv: ["/opt/homebrew/bin/python3.11", "-c", "import x", "/Users/u/.hermes/hermes-agent/run"], name: "Python" },
  };
  const b = buildBoard({ spaces: [{ id: "s", name: "w", tabs: [{ id: "A", name: "agents" }] }], panes: [{ pane: "p", tab: "A", terminal: "t9", program: python, title: "Python" }], terminals: [hermes], machines: [{ name: null, layout: "ready" }] });
  const u = b.regions[0].zones[0].units[0];
  // Its words are its tab's name, not its kind (request 14): the kind is the mark, in the tooltip and accessible name.
  expect([u.kind.label, u.kind.agent, u.kind.shell, u.name]).toEqual(["Hermes", true, false, "agents"]);
  expect(unitKind({ ...hermes, foreground: { argv: ["/bin/zsh"], name: "zsh" }, program: zsh }, null, new Map()).label).toBe("zsh"); // back at its shell
});

// ---- machines (17:37 request 1, 17:55 request 11), one status system and agent marks (requests 7 and 10) ----

// The fixture plus a workspace on a second machine ("box", as modpack/test/machine.sh adds it), with a pane and a
// terminal the app lists, and a machine known to the app with no workspace yet ("spare").
function twoMachines(extra = {}) {
  const f = fixture();
  f.spaces.push({ id: "box/s3", name: "remote-build", machine: "box", tabs: [{ id: "box/d", name: "build", index: 1 }] });
  f.panes.push({ pane: "box/p7", tab: "box/d", terminal: "box/t9", program: codex });
  f.terminals.push({ address: "box/t9", state: "live", status: "blocked", program: codex, name: "builder", report: { state: "blocked", kind: "question", msg: "Which branch?" } });
  f.machines.push({ name: "box", layout: "ready" }, { name: "spare", layout: "loading" });
  return { ...f, ...extra };
}
const bandView = (board) => board.bands?.map((b) => [b.label, b.regions.map((r) => r.name)]) ?? null;

test("machines: two machines group as bands, this computer first, workspaces under their own machine, the map in the same order", () => {
  const board = buildBoard(twoMachines());
  expect(bandView(board)).toEqual([["This computer", ["core-client", "evals"]], ["box", ["remote-build"]], ["spare", []]]);
  expect(board.hiddenMachines).toBe(0);
  expect(bandEmpty(board.bands[2].layout)).toBe("Loading…");
  // Reading order (board and map): each band's workspaces, then the paneless rest outside any band.
  expect(readingGroups(board).map((g) => [g.band?.label ?? null, g.regions.map((r) => r.name)])).toEqual([
    ["This computer", ["core-client", "evals"]], ["box", ["remote-build"]], ["spare", []], [null, ["Without a pane"]],
  ]);
  const remote = board.regions.find((r) => r.name === "remote-build").zones[0].units[0];
  expect([remote.address, remote.word, remote.blockKind]).toEqual(["box/t9", "needs", "question"]);
});

test("machines: a machine hidden in the sidebar is left out of the board and counted, its terminals not shown as paneless", () => {
  const board = buildBoard(twoMachines({ hidden: ["box"] }));
  expect(bandView(board)).toEqual([["This computer", ["core-client", "evals"]], ["spare", []]]);
  expect(board.hiddenMachines).toBe(1);
  const all = board.regions.flatMap((r) => r.zones.flatMap((z) => z.units.map((u) => u.address)));
  expect(all).not.toContain("box/t9");
  expect(counts(board).needs).toBe(1); // only this computer's worker
  // "" hides this computer; a stale name in the list (no such machine) hides nothing and isn't counted.
  const here = buildBoard(twoMachines({ hidden: ["", "gone"] }));
  expect(bandView(here)).toEqual([["box", ["remote-build"]], ["spare", []]]);
  expect(here.hiddenMachines).toBe(1);
  expect(here.regions.map((r) => r.name)).toEqual(["remote-build"]);
  // Every machine hidden: the board is empty and says so through the count.
  const none = buildBoard(twoMachines({ hidden: ["", "box", "spare"] }));
  expect(none.regions.filter((r) => !r.loose)).toEqual([]);
  expect(none.hiddenMachines).toBe(3);
});

test("machines: one machine, or the level off, means no bands; hidden machines stay hidden either way", () => {
  const single = buildBoard(fixture());
  expect(single.bands).toBeNull();
  expect(readingGroups(single)).toEqual([{ band: null, regions: single.regions }]);
  const off = buildBoard(twoMachines({ level: false }));
  expect(off.bands).toBeNull();
  expect(off.regions.map((r) => r.name)).toEqual(["core-client", "evals", "remote-build", "Without a pane"]);
  expect(buildBoard(twoMachines({ level: false, hidden: ["box"] })).regions.map((r) => r.name)).toEqual(["core-client", "evals", "Without a pane"]);
  // Unset or any other value: bands on (the sidebar's default).
  expect(buildBoard(twoMachines({ level: undefined })).bands).not.toBeNull();
  expect(buildBoard(twoMachines({ level: true })).bands).not.toBeNull();
});

const MODPACK = join(import.meta.dir, "..");
const sources = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? (n === "node_modules" || n === "lib" ? [] : sources(p)) : /\.(js|json|svg)$/.test(n) ? [p] : [];
});

test("no flag anywhere in the pack: no flag glyph, drawing or word on any marker (request 5b and 7)", () => {
  const files = ["mods", "shared", "adapters", "icons"].flatMap((d) => sources(join(MODPACK, d)));
  expect(files.length).toBeGreaterThan(10);
  for (const f of files) expect([f, /\bflag\b|flagGlyph|pennant|\u2691|\u{1F6A9}/iu.test(readFileSync(f, "utf8"))]).toEqual([f, false]);
});



test("request 14: where a mark is drawn the words are the pane's or tab's own name, never the agent kind", () => {
  const f = fixture();
  // An unnamed tab (its name is its position) beside the named ones: a nameless Claude whose title is its kind, a
  // Codex with a telling title, and a shell whose title is a path.
  f.spaces[1].tabs.push({ id: "e", name: "2", index: 2, named: false }, { id: "g", name: "3", index: 3, named: false });
  f.panes.push({ pane: "p8", tab: "e", terminal: "t10", program: claude, title: "✳ Claude Code" },
    { pane: "p9", tab: "g", terminal: "t11", program: codex, title: "Review the plan" }, { pane: "p10", tab: "g", terminal: "t12", program: zsh, title: "~/work" });
  f.panes.push({ pane: "p11", tab: "b", terminal: "t13", program: codex, title: "Codex" });
  f.terminals.push({ address: "t10", state: "live", status: "idle", program: claude, report: { state: "idle", app: "claude-code" } },
    { address: "t11", state: "live", status: "working", program: codex, report: { state: "working" } },
    { address: "t12", state: "live", status: null, program: zsh },
    { address: "t13", state: "live", status: "idle", program: codex, report: { state: "idle" } });
  const board = buildBoard(f);
  const zones = board.regions.flatMap((r) => r.zones);
  const unit = (a) => zones.flatMap((z) => z.units).find((u) => u.address === a);
  // Units: Core's name, else a telling title, else (an agent) its tab's name or "Tab <n>"; a shell its program.
  expect(["t1", "t10", "t11", "t12", "t13"].map((a) => unit(a).name)).toEqual(["lead", "Tab 2", "Review the plan", "zsh", "review"]);
  for (const u of zones.flatMap((z) => z.units)) if (u.kind.agent) expect([u.address, u.name === u.kind.label]).toEqual([u.address, false]);
  expect([tabNamed({ name: "lead" }), tabNamed({ name: "2" }), tabNamed({ name: "2", named: true })]).toEqual([true, false, true]);
  // The view: no kind in words beside a mark; the kind stays in the tooltip and the accessible name.
  const src = readFileSync(join(MODPACK, "mods/pdk-factory/main.js"), "utf8");
  expect(src).not.toMatch(/badge\(|\.child\((u|lead)\.kind\.label\)/);
  expect(src).not.toContain(".tooltip(`${name}, ${kind}`)"); // spec section 7: no metadata tooltip; the node's accessible name keeps it
});

// ---- the mind map (owner request 17) ------------------------------------------------------------------------

const keys = (sec) => sec.nodes.map((n) => [n.key, n.depth, n.row]);

test("mind map: each workspace reads left to right, an agent then what it started then its in-process sub-agents; rows top-aligned", () => {
  const map = mindMap(buildBoard(fixture()));
  expect(map.map((g) => [g.band, g.sections.map((s) => s.region.name)])).toEqual([[null, ["core-client", "evals", "Without a pane"]]]);
  const [cc, ev, loose] = map[0].sections;
  // t1 started t2 (its pane is in another tab: the tree follows Core, not tabs), t2 started t6; t1's record r1 is an
  // in-process sub-agent after its Core children; t3 stands alone; the shell t5 has no relation and folds.
  expect(keys(cc)).toEqual([["t1", 0, 0], ["t2", 1, 0], ["t6", 2, 0], ["t1#r1", 1, 1], ["t3", 0, 2]]);
  expect(cc.folded.map((u) => u.address)).toEqual(["t5"]);
  expect(plainCount(cc.folded)).toBe("1 shell");
  expect([keys(ev), keys(loose)]).toEqual([[["t4", 0, 0]], [["t7", 0, 0]]]);
  // Positions on the grid: columns of card + gutter, rows of card + gap; the section as wide and tall as its tree.
  const at = Object.fromEntries(cc.nodes.map((n) => [n.key, [n.x, n.y]]));
  expect(at).toEqual({ t1: [0, 0], t2: [264, 0], t6: [528, 0], "t1#r1": [264, 68], t3: [0, 136] });
  expect([cc.w, cc.h]).toEqual([3 * NODE.w + 2 * NODE.col, 3 * NODE.h + 2 * NODE.row]);
  for (const v of [...Object.values(NODE), ...Object.values(SECTION)]) expect(v % GRID).toBe(0);
  // Elbows: straight to a first child on its parent's row, else one turn in the middle of the gutter.
  expect(elbow(cc.nodes[0], cc.nodes[1])).toEqual([[240, 28], [264, 28]]);
  expect(elbow(cc.nodes[0], cc.nodes[3])).toEqual([[240, 28], [252, 28], [252, 96], [264, 96]]);
});

test("mind map: edges only from what Core recorded (a started-by parent, an agent's own records), never between unrelated agents", () => {
  const f = fixture();
  // In evals: an agent whose Core parent is in core-client (another workspace), a shell that started an agent, and
  // two agents side by side with no relation.
  f.panes.push({ pane: "p20", tab: "c", terminal: "t20", program: codex }, { pane: "p21", tab: "c", terminal: "t21", program: zsh },
    { pane: "p22", tab: "c", terminal: "t22", program: claude });
  f.terminals.push({ address: "t20", state: "live", parent: "t3", program: codex, name: "cross", report: { state: "working" } },
    { address: "t21", state: "live", program: zsh, name: "launcher" },
    { address: "t22", state: "live", parent: "t21", program: claude, name: "launched", report: { state: "idle" } });
  const [cc, ev] = mindMap(buildBoard(f))[0].sections;
  const edgeSet = (sec) => sec.edges.map((e) => `${e.from}>${e.to}:${e.kind}`).sort();
  expect(edgeSet(cc)).toEqual(["t1>t1#r1:record", "t1>t2:started", "t2>t6:started"]);
  // t20's parent is in another workspace: no edge crosses sections; it stands alone and keeps "started by".
  expect(edgeSet(ev)).toEqual(["t21>t22:started"]);
  expect(keys(ev)).toEqual([["t4", 0, 0], ["t20", 0, 1], ["t21", 0, 2], ["t22", 1, 2]]);
  expect(ev.nodes.find((n) => n.key === "t20").unit.startedBy).toBe("t3");
  // A shell that started something is a node, not folded; every edge's ends are nodes of the same section.
  expect(ev.folded).toEqual([]);
  for (const sec of [cc, ev]) for (const e of sec.edges) expect([sec.nodes.some((n) => n.key === e.from), sec.nodes.some((n) => n.key === e.to)]).toEqual([true, true]);
  // No relation recorded, no edge: the same board without parents has none.
  const flat = fixture();
  for (const t of flat.terminals) { delete t.parent; delete t.records; }
  expect(mindMap(buildBoard(flat))[0].sections.flatMap((s) => s.edges)).toEqual([]);
});

test("mind map: the line under a name is the program's own status text, exactly (first line), or nothing", () => {
  const [cc] = mindMap(buildBoard(fixture()))[0].sections;
  const node = (k) => cc.nodes.find((n) => n.key === k);
  expect(nodeMessage(node("t2"))).toBe("approve Write: /tmp/x/notes.txt");
  expect(nodeMessage(node("t1"))).toBe("Reading src/a.js (r1)");
  expect(nodeMessage(node("t1#r1"))).toBe("grep TODO");
  // A record with no text of its own has no message (the view shows its state word, dimmed, as for an agent).
  expect(nodeMessage({ type: "record", record: { msg: null, text: "working" } })).toBeNull();
  expect(nodeMessage(node("t3"))).toBeNull(); // done with no text: the view shows its state word, dimmed
  const multi = { type: "unit", unit: { msg: "Edit main.js (id=w7)\nsecond line" } };
  expect(nodeMessage(multi)).toBe("Edit main.js (id=w7)");
  // A new message is fresh on its own node (a record's on the record's node) only while the board just saw it.
  const obs = newObservation(10);
  observe(obs, fixture().terminals, 20);
  const t = fixture().terminals;
  t[0].report = { ...t[0].report, msg: "Reading src/b.js" };
  t[0].records = { r1: { state: "working", title: "Explore", msg: "grep FIXME" } };
  observe(obs, t, 1000);
  expect([...freshNow(obs, 1500)].sort()).toEqual(["t1", "t1#r1"]);
  expect([...freshNow(obs, 1000 + MOTION.bubbleShow + 1)]).toEqual([]);
});

test("mind map: hidden machines are left out, bands follow the machine level, the folded count names what it holds", () => {
  const two = mindMap(buildBoard(twoMachines()));
  expect(two.map((g) => [g.band?.label ?? null, g.sections.map((s) => s.region.name)])).toEqual([
    ["This computer", ["core-client", "evals"]], ["box", ["remote-build"]], ["spare", []], [null, ["Without a pane"]],
  ]);
  const hidden = mindMap(buildBoard(twoMachines({ hidden: ["box"] })));
  expect(hidden.flatMap((g) => g.sections.map((s) => s.region.name))).not.toContain("remote-build");
  expect(hidden.flatMap((g) => g.sections.flatMap((s) => s.nodes.map((n) => n.key)))).not.toContain("box/t9");
  expect(mindMap(buildBoard(twoMachines({ level: false }))).map((g) => g.band)).toEqual([null]);
  expect(plainCount([{ kind: { shell: true } }, { kind: { shell: false } }])).toBe("2 terminals");
});

test("the view: nodes and the header draw through kindMarker and statusMarker; no tiles, no ground, no side pane", () => {
  const src = readFileSync(join(MODPACK, "mods/pdk-factory/main.js"), "utf8");
  expect(src).not.toMatch(/kindMonogram|flagGlyph|ground\(|TILE|PIECE|ZONE\b|bubbleBox|text_size\(\d/);
  const body = (name) => { const at = src.search(new RegExp(`\\n  ${name}\\(t[,)]`)); return src.slice(at, src.indexOf("\n  }\n", at)); };
  expect(body("node")).toContain("kindMarker(t,");
  expect(body("node")).toContain("statusMarker(t, word, `ns-${n.key}`");
  expect(src).toContain('statusMarker(t, "needs", "needs-count-mark")');
  // The owner's 10 Nov cut: no Overview, Key or Outline beside the map, no record count or "Observed since".
  expect(src).not.toMatch(/Overview|"Key"|Outline|keyOpen|Observed since|"record"\)|Select a node/);
  // Every gap and padding in the view is on the grid; the blocked token only colours the error line.
  for (const m of src.matchAll(/\.(?:gap|p|px|py|pt|pb|pl|pr|ml|mt)\((-?\d+(?:\.\d+)?)\)/g)) expect([m[0], Math.abs(Number(m[1])) % GRID]).toEqual([m[0], 0]);
  expect(src.match(/t\.blocked/g)).toEqual(["t.blocked"]);
  // A blocked agent's word is "needs": that word is what statusMarker draws as the yellow dot.
  const worker = buildBoard(fixture()).regions[0].zones[1].units.find((u) => u.address === "t2");
  expect([worker.word, worker.blockKind]).toEqual(["needs", "permission"]);
});

// PM acceptance regressions. These fixtures deliberately mix panes, paneless children and reported records.
test("R4: a child with its own pane retains app Done in the same or a different tab; paneless completion is idle", () => {
  for (const tab of ["a", "b"]) {
    const f = fixture();
    f.panes.find((p) => p.terminal === "t2").tab = tab;
    f.agents.find((a) => a.address === "t2").status = "done";
    f.terminals.find((t) => t.address === "t6").report.state = "done";
    const units = buildBoard(f).regions.flatMap((r) => r.zones.flatMap((z) => z.units));
    expect(units.find((u) => u.address === "t2").word).toBe("done");
    expect(units.find((u) => u.address === "t6").word).toBe("idle");
    f.agents.find((a) => a.address === "t2").status = "idle";
    expect(buildBoard(f).regions.flatMap((r) => r.zones.flatMap((z) => z.units)).find((u) => u.address === "t2").word).toBe("idle");
  }
});

test("R5: orphan and nested records are reachable exactly once and contribute to attention separately from terminals", () => {
  const f = fixture();
  f.terminals[0].records = { "a/b": { state: "blocked", title: "Orphan", msg: "Need approval" }, "a/b/c": { state: "done", title: "Child" }, q: { state: "error", title: "Question" } };
  const board = buildBoard(f), map = mindMap(board), rows = factory.outline(map);
  expect(rows.filter((n) => n.type === "record").map((n) => n.key)).toEqual(["t1#a/b", "t1#a/b/c", "t1#q"]);
  const sec = map[0].sections[0];
  expect(sec.edges.filter((e) => e.kind === "record").map((e) => [e.from, e.to])).toEqual([["t1#a/b", "t1#a/b/c"], ["t1", "t1#a/b"], ["t1", "t1#q"]]);
  expect(counts(board)).toMatchObject({ units: 7, agents: 6, records: 3, needs: 3 });
  expect(board.regions[0].word).toBe("needs");
  expect(factory.attention(sec.nodes).key).toBe("t2");
  expect(factory.attention(sec.nodes.filter((n) => n.key !== "t2")).key).toBe("t1#a/b");
  expect(rows.find((n) => n.key === "t1#a/b").unit.address).toBe("t1");
});

test("R13: hidden paneless remote roots and descendants cannot leak; host context survives flat grouping", () => {
  const f = twoMachines({ level: false });
  f.terminals.push({ address: "box/t20", state: "live", report: { state: "blocked" }, program: codex },
    { address: "box/t21", parent: "box/t20", state: "live", report: { state: "working" }, program: codex },
    { address: "unqualified", state: "live", report: { state: "working" }, program: codex });
  const shown = factory.outline(mindMap(buildBoard(f)));
  expect(shown.find((n) => n.key === "box/t20").identity).toContain("box / Without a pane / Without a tab");
  expect(shown.find((n) => n.key === "unqualified").identity).toStartWith("Unknown host / ");
  expect(factory.outline(mindMap(buildBoard({ ...f, hidden: ["box"] }))).some((n) => n.key.startsWith("box/"))).toBe(false);
  const none = buildBoard({ ...fixture(), hidden: [""] });
  expect([none.state, none.allHidden, none.regions.length]).toEqual(["empty", true, 0]);
});

function deepFixture() {
  const f = fixture();
  f.terminals = Array.from({ length: 55 }, (_, i) => ({ address: `t${i + 1}`, name: `Duplicate long agent name ${"and context ".repeat(5)}`, state: "live", parent: i ? `t${i}` : null, program: codex, report: { state: "working", msg: `Reported ${i}` }, records: i === 54 ? { "missing/record": { title: "Deep record", state: "blocked", msg: "Please review" } } : {} }));
  f.panes = [{ pane: "p1", tab: "a", terminal: "t1", program: codex }];
  f.agents = [];
  return f;
}

test("R16: all 55 deep agents and orphan records navigate by stable ID, every one on the board", () => {
  const map = mindMap(buildBoard(deepFixture())), rows = factory.outline(map), sec = map[0].sections[0];
  expect(rows.length).toBe(56);
  const tree = factory.treeSection(sec, 1200);
  for (const row of rows) {
    const node = tree.nodes.find((n) => n.key === row.key);
    expect(node).toBeDefined();
    expect(node.x).toBeGreaterThanOrEqual(0);
    expect(node.x + node.w).toBeLessThanOrEqual(tree.w);
    expect(row.identity).toContain("This computer / core-client / lead / Duplicate long agent name");
  }
  for (const edge of tree.edges) expect(sec.edges.some((e) => e.from === edge.from && e.to === edge.to)).toBe(true);
  expect(rows.at(-1).key).toBe("t55#missing/record");
});

// Evaluate the actual view with a small GPUI element recorder. This exercises its event handlers and rendered
// selection/detail state without a native window; the screenshot pass checks actual GPUI layout separately.
function viewHarness(input = fixture()) {
  const nodes = [];
  const el = () => {
    const props = {}, children = [];
    let proxy;
    proxy = new Proxy({ props, kids: children }, { get(target, key) {
      if (key in target) return target[key];
      return (...args) => {
        if (key === "child") children.push(args[0]);
        else if (key === "children") children.push(...args[0]);
        else if (key === "when") { if (args[0]) args[1](proxy); }
        else props[key] = args.length > 1 ? args : args[0];
        if (key === "on_action") props[`on_action:${args[0]}`] = args[1];
        return proxy;
      };
    } });
    nodes.push(proxy);
    return proxy;
  };
  // Exercise the published shared state/focus helpers inside the actual Factory renderer.
  const uiDeps = { div: el, svg: el, h_flex: el, v_flex: el, shared: () => null, home: () => "/h", fonts: () => [],
    window: () => ({ platform: "macos" }), theme: () => ({}), spaces: () => input.spaces, statusLabel: () => "",
    kindOrProgram: () => null, agentKind: () => null, kindName: () => "", contrast, toHsl, fromHsl, glassGrounds };
  const uiSource = readFileSync(join(MODPACK, "shared/ui.js"), "utf8").replace(/^import .*;\n/gm, "").replace(/^export /gm, "");
  const styles = new Function(...Object.keys(uiDeps), `${uiSource}\nreturn { focusRing, rowStates, interactionStyle, AGENT_MARKS, markColor, dimMark, groundOf };`)(...Object.values(uiDeps));
  const calls = [];
  const chrome = JSON.parse(readFileSync(join(MODPACK, "layouts/tremor.json"), "utf8"));
  chrome.children[1].children.find(n => n.id === "work-body").active = "factory";
  const defs = { View: class {}, div: el, svg: el, v_flex: el, h_flex: el, F: factory,
    TYPE: { xs: 11, sm: 12, base: 13, lg: 15 }, SPACE: { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48 },
    ICON: { dot: 8, base: 14 }, ROW: { compact: 24, base: 28, two: 40, touch: 44 }, NARROW: 768, RADIUS: { sm: 4, md: 6, lg: 8 }, iconFor: (t) => t >= 13 ? 14 : 12,
    settings: () => ({zoom:input.zoom??1}), layout: () => input.layout ?? chrome, ...styles, theme: () => ({ canvas: "canvas", chrome: "chrome", border: "border", accent: "accent", working: "working", dim: "dim", input: "input", surface: "surface", foreground: "foreground", muted: "muted", selected: "selected" }), spaces: () => input.spaces, panes: () => input.panes, terminals: () => input.terminals, agents: () => input.agents, machines: () => input.machines,
    focused: () => input.focused, shared: (k) => k === "pdk.machine.filter" ? input.filter : null, machineLabel: (m) => m || "This computer",
    monoFont: () => "Menlo", reduceMotion: () => true, withFont: (x) => x, clock: (x) => String(x), folderLabel: (x) => x, iconPath: (x) => x,
    kindMarker: (t, kind, size, color, id) => el().id(id).mark_kind(kind).size(size).text_color(color), statusMarker: el, foldMarker: el, run: (...args) => calls.push(args),
    textButton: (t, id, text, label, click, opts = {}) => el().id(id).h(opts.h ?? 20).child(text).on_click(click),
    icon: (name, size, color) => el().icon(name).size(size).text_color(color),
    spinner: (t, size, opts = {}) => el().spinner(true).size(size).text_color(opts.color ?? t.foreground),
    workingText: (t, id, text, opts = {}) => el().id(id).working(true).text_size(opts.size ?? 12).child(text),
    PathBuilder: { stroke: () => new Proxy({}, { get: (_, key) => key === "build" ? () => ({}) : () => defs.PathBuilder.stroke() }) },
    window: { viewport_size: () => input.windowSize ?? null, paint_path: (_path, color) => el().paint_color(color) },
    ScrollHandle: { new: () => ({ scroll_to_item() {} }) }, hc: async () => null, nextCommand: () => new Promise(() => {}),
    // The Map (map.js) is its own module with its own tests; here the Factory is the Board alone.
    bindMapKeys: () => {}, newMap: () => null, stalled: () => false,
  };
  const src = readFileSync(join(MODPACK, "mods/pdk-factory/main.js"), "utf8").replace(/^import .*;\n/gm, "").replace("export default class Factory", "class Factory").replace(/^export /gm, "");
  const Factory = new Function(...Object.keys(defs), `${src}\nreturn Factory;`)(...Object.values(defs));
  const view = new Factory();
  const scrolls = [];
  Object.assign(view, { obs: newObservation(1), sel: null, coreMs: new Map(), rows: [], boardScroll: { scroll_to_item: (i) => scrolls.push(i) } });
  const render = () => { nodes.length = 0; view.render(); };
  return { view, nodes, calls, render, scrolls, Factory, src, ui: styles, byId: (id) => nodes.find((n) => n.props.id === id), cx: { notify() {}, stop_propagation() {} } };
}

test("R5/R16 view: keyboard reaches a deep record, shows its full identity and opens its owner", () => {
  const h = viewHarness(deepFixture());
  h.render();
  // Reading order is pdk-factory.next's (the arrows walk the tree: the X1 tests at the end).
  for (let i = 0; i < 56; i++) h.view.move(1);
  h.render();
  expect(h.view.sel).toBe("t55#missing/record");
  expect(h.byId("nd-t55#missing/record")).toBeDefined();
  expect(h.byId("node-identity").props.accessibility_label).toContain("Deep record (missing/record) · t55");
  h.view.key({ key: "enter" }, h.cx);
  expect(h.calls.at(-1)).toEqual(["terminal.peek", { terminal: "t55" }]);
});

test("the machine filter: one machine shows only its workspaces; All or a machine no longer known shows every one", () => {
  const ids = (h) => h.nodes.map((n) => String(n.props.id ?? "")).filter((id) => id.startsWith("sc-")).sort();
  for (const [filter, want] of [["box", ["sc-box/s3"]], ["", ["sc-no-pane", "sc-s1", "sc-s2"]], ["all", ["sc-box/s3", "sc-no-pane", "sc-s1", "sc-s2"]], ["gone", ["sc-box/s3", "sc-no-pane", "sc-s1", "sc-s2"]], [undefined, ["sc-box/s3", "sc-no-pane", "sc-s1", "sc-s2"]]]) {
    const h = viewHarness({ ...twoMachines(), filter }); h.render();
    expect(ids(h), String(filter)).toEqual(want);
    expect(h.byId("show-machines")).toBeUndefined(); // the old hide list's recovery is gone with it
  }
});

test("with nothing selected nothing sits under the map", () => {
  const s = viewHarness();
  s.view.obs.log.push({ from: "t1", to: "t2", at: 42, source: "herdr-core parent" });
  s.render();
  expect(s.byId("selection")).toBeUndefined();
});

test("R13: null initial shared filters keep the board available", () => {
  expect(buildBoard({ ...fixture(), hidden: null }).state).toBe("ready");
});

test("R13: Core alphanumeric terminal IDs retain their qualified host", () => {
  expect(factory.terminalHost("t2j").label).toBe("This computer");
  expect(factory.terminalHost("box/t2j").name).toBe("box");
});

test("R16: 55 unrelated agents share wrapped rows inside the board, every one shown", () => {
  const f = deepFixture();
  f.terminals = f.terminals.map((t) => ({ ...t, parent: null }));
  f.panes = f.terminals.map((t, i) => ({ pane: `p${i}`, tab: "a", terminal: t.address, program: codex }));
  const map = mindMap(buildBoard(f)), sec = map[0].sections[0];
  const tree = factory.treeSection(sec, 400);
  expect(tree.nodes).toHaveLength(sec.nodes.length);
  for (const n of tree.nodes) expect(n.x + n.w).toBeLessThanOrEqual(400);
  expect(Math.max(...tree.nodes.map((n) => n.y + n.h))).toBe(tree.h);
});


const renderedText = (n) => typeof n === "string" ? n : (n?.kids ?? []).map(renderedText).join(" ");

test("design 7: one-line pills fit the board inside 16px gutters at any width; edges remain neutral", () => {
  const h = viewHarness(); h.render();
  const pills = () => h.nodes.filter((n) => String(n.props.id ?? "").startsWith("nd-"));
  for (const width of [400, 1200]) {
    h.byId("board-viewport").props.on_size_change({ width, height: 600 }, h.cx); h.render();
    expect(pills()).toHaveLength(h.view.rows.length);
    for (const n of pills()) {
      expect(n.props.h).toBe(width < 768 ? 44 : 28); // a pressable is 44 tall in a narrow view
      expect(n.props.left + n.props.w).toBeLessThanOrEqual(width - 32);
    }
  }
  const edges = h.nodes.filter((n) => n.props.paint_color);
  expect(edges.length).toBeGreaterThan(0);
  expect(edges.every((n) => n.props.paint_color === "dim")).toBe(true);
});

test("design 7: a displayed machine heading removes repeated workspace host text", () => {
  const grouped = viewHarness(twoMachines()); grouped.render();
  expect(renderedText(grouped.byId("sc-s1"))).not.toContain("This computer");
  expect(renderedText(grouped.byId("sc-box/s3"))).not.toContain("box");
  expect(renderedText(grouped.byId("mb-box"))).toContain("box");
});


test("design 6: records are neutral in map and selected details; idle marks use their real ground", () => {
  const f = fixture(); f.terminals[0].records.r1.state = "idle";
  const h = viewHarness(f); h.render();
  expect(h.byId("nk-t1#r1").props.mark_kind).toMatchObject({ record: true, label: "In-process sub-agent", idle: true, ground: "surface" });
  expect(h.byId("nk-t4").props.mark_kind).toMatchObject({ idle: true, ground: "surface" });
  h.view.sel = "t1#r1"; h.render();
  expect(h.byId("nk-t1#r1").props.mark_kind.idle).toBe(false);
  expect(h.byId("pp-t1#r1").props.mark_kind.record).toBe(true);
  expect(h.byId("nk-t1").props.mark_kind.record).toBe(false);
});


test("design 1: names keep UI type while branch IDs and state times use the metadata mono face", () => {
  const f = fixture(); f.spaces[0].branch = "feat/design";
  const h = viewHarness(f); h.view.sel = "t1"; h.view.coreMs.set("t1", 42); observe(h.view.obs, f.terminals, 1); h.render();
  expect(h.byId("sb-s1").props.font_family).toBe("Menlo");
  expect(h.byId("nt-t1")).toBeUndefined(); // the time is in the pill's accessible name and the details, not the pill
  expect(h.byId("nd-t1").props.accessibility_label).toContain("since 42");
  expect(h.byId("nn-t1").props.font_family).toBeUndefined();
  expect(h.byId("nn-t1").props.text_size).toBe(12);
});

function styled(node, state) {
  const props = {}; let el;
  el = new Proxy({}, { get: (_, key) => (...args) => { props[key] = args[0]; return el; } });
  node.props[state](el); return props;
}

test("C3/C7: Factory chrome is canvas, cards retain surface and status slots", () => {
  const h = viewHarness(twoMachines()); h.render();
  expect(h.nodes.some((n) => n.props.bg === "chrome")).toBe(false);
  h.view.sel = "t1#r1"; h.render();
  const card = h.byId("nd-t1#r1");
  expect(h.byId("selection").props.bg).toBe("canvas");
  expect(card.props.bg).toBe("surface"); expect(styled(card, "hover").bg).toBe("surface");
  expect(styled(card, "hover").border_color).toBe("accent"); expect(card.props.tab_index).toBeUndefined();
  // Keep the map's existing container navigation; a record still opens its owner after helper extraction.
  h.view.key({ key: "enter" }, h.cx); expect(h.calls.at(-1)).toEqual(["pane.focus", { pane: "p1" }]);
});

test("C12: an observed courier trail and dot use working, with timing unchanged", () => {
  const h = viewHarness();
  h.view.obs.couriers.push({ id: "observed", from: "t1", to: "t2", at: Date.now(), source: "herdr-core parent" });
  h.render();
  expect(h.nodes.some((n) => n.props.paint_color === "working")).toBe(true);
  const dot = h.nodes.find((n) => String(n.props.id).startsWith("cr-observed-")); expect(dot.props.bg).toBe("working");
  expect(h.nodes.filter((n) => n.props.size === 8 && n.props.bg === "working").length).toBe(1);
  expect(MOTION).toEqual({ bubbleShow: 6000, bubbleFade: 600, pulseOn: 300, pulseFade: 900, courierDepart: 60, courierTravel: 1100, courierHold: 4500 });
});

test("C3: idle marks keep 3:1 on canvas in all 24 themes; selected marks remain fully legible", () => {
  const { ui } = viewHarness();
  const presets = readdirSync(join(MODPACK, "themes")).filter((n) => /^pdk-.*\.json$/.test(n)); expect(presets.length).toBe(24);
  for (const name of presets) {
    const f = JSON.parse(readFileSync(join(MODPACK, "themes", name), "utf8")), t = { ...f.colors, background: f.background };
    for (const kind of Object.keys(ui.AGENT_MARKS)) {
      const brand = ui.markColor(t, kind), dimmed = ui.dimMark(brand, ui.groundOf(t, "canvas"));
      for (const ground of ui.groundOf(t, "canvas")) expect(contrast(dimmed, ground), `${name} ${kind} canvas`).toBeGreaterThanOrEqual(3);
      for (const ground of ui.groundOf(t, "selected")) expect(contrast(brand, ground), `${name} ${kind} selected`).toBeGreaterThanOrEqual(3);
    }
  }
});

test("F6: every card draws at any height, with no window note, including after selection", () => {
  const f = fixture(); f.terminals[0].records["r1/r2"] = { state: "blocked", title: "Deep selected record" };
  const h = viewHarness(f); h.render();
  const drawn = () => h.nodes.filter((n) => String(n.props.id ?? "").startsWith("nd-"));
  for (const height of [700, 300]) {
    h.view.sel = null; h.byId("board-viewport").props.on_size_change({ width: 1064, height }, h.cx); h.render();
    expect(drawn()).toHaveLength(h.view.rows.length);
    expect(renderedText(h.byId("board"))).not.toContain("arrow keys for more");
  }
  // A selection shows its section whole.
  h.view.sel = "t1#r1/r2"; h.render();
  expect(h.byId("nd-t1#r1/r2")).toBeDefined();
  expect(drawn()).toHaveLength(mindMap(buildBoard(f))[0].sections[0].nodes.length);
});

test("F6 follow-up: restore lays out by the current window allocation before the previous size callback updates", () => {
  const f = fixture(); f.windowSize = {width:1192,height:882};
  const h = viewHarness(f); h.render();
  h.byId("board-viewport").props.on_size_change({width:935,height:766},h.cx);h.render();
  f.windowSize = {width:600,height:820};
  // Deliberately retain the 935px measurement: on_size_change runs after this render.
  h.render();
  const room = 600 - (JSON.parse(readFileSync(join(MODPACK,"layouts/tremor.json"),"utf8")).children[0].size.px + 1) - 32;
  for(const n of h.nodes.filter(n=>String(n.props.id??"").startsWith("nd-")))expect(n.props.left+n.props.w).toBeLessThanOrEqual(room);
});

test("F6 follow-up: current native layout allocation handles the sidebar, zoom and unfit card sizes", () => {
  const chrome=JSON.parse(readFileSync(join(MODPACK,"layouts/tremor.json"),"utf8"));chrome.children[1].children.find(n=>n.id==="work-body").active="factory";
  const side=chrome.children[0].size.px+1; // the shipped sidebar and its divider (280 + 1 since the UX pass; was 256 + 1)
  expect(factory.blockSize(chrome,"factory",{width:1280,height:820})).toEqual({width:1280-side,height:780});
  chrome.children[0].hidden=true;
  expect(factory.blockSize(chrome,"factory",{width:1280,height:820})).toEqual({width:1280,height:780});
  chrome.children[0].hidden=false;
  const zoomed=factory.blockSize(chrome,"factory",{width:1280,height:820},1.5);
  expect(zoomed.width).toBeCloseTo(1280/1.5-side);expect(zoomed.height).toBeCloseTo(820/1.5-40);
  const f=fixture();f.windowSize={width:480,height:320};const h=viewHarness(f);h.render();
  // Narrower than a card: one stacked column of narrowed cards (was none at all), nothing windowed by width.
  const cards=h.nodes.filter(n=>String(n.props.id??"").startsWith("nd-"));
  expect(cards.length).toBeGreaterThan(0);expect(cards.every(c=>c.props.w<NODE.w)).toBe(true);
  expect(renderedText(h.byId("sc-s1"))).not.toContain("No agents running here");
});

test("spec section 7: every factory tooltip is three words at most; the full words stay in accessible names", () => {
  const f = twoMachines(); f.terminals[0].report.msg = "A long status message the agent sent about its current step";
  const h = viewHarness(f); h.view.sel = "t1"; h.view.coreMs.set("t1", 42); observe(h.view.obs, f.terminals, 1); h.render();
  const tips = h.nodes.map((n) => n.props.tooltip).filter((x) => typeof x === "string");
  expect(tips.length).toBeGreaterThan(0);
  for (const tip of tips) expect(tip.split(/\s+/).length, tip).toBeLessThanOrEqual(3);
  expect(h.byId("node-identity").props.accessibility_label).toContain("t1");
});

test("machine row: its icon by machine kind (monitor here, server elsewhere), name 13/500, the count, no rule", () => {
  const h = viewHarness(twoMachines()); h.render();
  const row = (id) => h.byId(`mh-${id}`);
  const glyph = (id) => row(id).kids.find((k) => k.props?.icon);
  expect([glyph("here").props.icon, glyph("box").props.icon, glyph("spare").props.icon]).toEqual(["monitor", "server", "server"]);
  expect(glyph("here").props).toMatchObject({ size: 14, text_color: "muted" });
  expect(row("here").props.h).toBe(24);
  const name = row("here").kids[1];
  expect([name.props.text_size, name.props.font_medium, name.props.text_color, renderedText(name)]).toEqual([13, undefined, "foreground", "This computer"]);
  expect("font_medium" in name.props && !("font_semibold" in name.props)).toBe(true);
  const count = row("here").kids[2];
  expect([renderedText(count), count.props.text_size, count.props.text_color]).toEqual(["2 workspaces", 11, "dim"]);
  expect(renderedText(row("box"))).toContain("1 workspace");
  // A machine with no workspace says why once, not "0 workspaces" too.
  expect(row("spare").kids.length).toBe(2);
  // No hairline anywhere in the band: nothing one pixel high on the border colour.
  const band = (n) => [n, ...(n.kids ?? []).flatMap(band)];
  expect(band(h.byId("mb-here")).some((n) => n.props?.h === 1 && n.props?.bg === "border")).toBe(false);
  expect(h.byId("mb-here").props.accessibility_label).toBe("Machine This computer: 2 workspaces");
  // Spacing: the row 12 above its first workspace, workspaces 24 apart.
  expect(h.byId("mb-here").props.gap).toBe(12);
  expect(h.byId("mb-here").kids[1].props.gap).toBe(24);
  // The workspace head sits a level under the machine: 12/500 muted.
  expect(h.byId("sn-s1").props).toMatchObject({ text_size: 12, text_color: "muted" });
  expect(readFileSync(join(MODPACK, "mods/pdk-factory/main.js"), "utf8")).not.toContain("font_semibold");
});

test("a pill is one line: mark, name, status; the program's own words are in its accessible name and the details", () => {
  const f = fixture(); f.terminals.find((t) => t.address === "t7").report.msg = undefined;
  const h = viewHarness(f); h.render();
  expect(h.byId("nw-t1")).toBeUndefined(); expect(h.byId("nm-t1")).toBeUndefined();
  expect(h.byId("nd-t1").kids.map((k) => k.props?.id)).toEqual(["nk-t1", "nn-t1", undefined]);
  expect(h.byId("nd-t1").props.accessibility_label).toContain("Working. Said: Reading src/a.js (r1)");
  expect(h.byId("nd-t2").props.accessibility_label).toContain("Said: approve Write: /tmp/x/notes.txt");
  // The details panel: the live word while working, the plain word otherwise; both buttons 24 high.
  h.view.sel = "t1"; h.render();
  expect(renderedText(h.byId("panel-working"))).toBe("Working");
  expect([h.byId("focus-pane").props.h, h.byId("deselect").props.h]).toEqual([24, 24]);
  // A view under 768 wide: 44 by 44 at least; 768 and wider: 24 again.
  h.view.boardViewport = { width: 390, height: 800 }; h.render();
  for (const id of ["focus-pane", "deselect"]) expect([h.byId(id).props.h, h.byId(id).props.min_w]).toEqual([44, 44]);
  const actionsInHead = () => h.byId("selection").kids[0].kids.includes(h.byId("panel-actions"));
  expect(actionsInHead()).toBe(false); // their own row: the name keeps its room, Close stays on screen
  h.view.boardViewport = { width: 768, height: 800 }; h.render();
  for (const id of ["focus-pane", "deselect"]) expect([h.byId(id).props.h, h.byId(id).props.min_w]).toEqual([24, 24]);
  expect(actionsInHead()).toBe(true);
  h.view.sel = "t2"; h.render();
  expect(h.byId("panel-working")).toBeUndefined();
});

test("board states: loading shows the spinner beside its words; the error says what to do", () => {
  const loading = viewHarness({ ...fixture(), spaces: [], panes: [], terminals: [], agents: [], machines: [{ name: null, layout: "loading" }] }); loading.render();
  const state = loading.byId("board-state");
  expect(state.kids[0].props.spinner).toBe(true);
  expect(renderedText(state)).toContain("Loading");
  const down = viewHarness({ ...fixture(), spaces: [], panes: [], terminals: [], agents: [], machines: [{ name: null, layout: "unavailable" }] }); down.render();
  expect(down.byId("board-state").kids.some((k) => k.props?.spinner)).toBe(false);
  expect(renderedText(down.byId("board-state"))).toBe("Can't show the board: herdr-core is not answering on this computer. Start it with hc server start; the board fills in when it answers.");
});

test("the board: a lead centred on top, what it started side by side below, their helpers stacked under them", () => {
  const f = fixture(); f.terminals[0].records["r1/r2"] = { state: "idle", title: "Read AGENTS.md" };
  const section = mindMap(buildBoard(f))[0].sections[0];
  const tree = factory.treeSection(section, 1200), P = factory.PILL, t = new Map(tree.nodes.map((n) => [n.key, n]));
  expect(tree.nodes.map((n) => n.key)).toEqual(section.nodes.map((n) => n.key));
  // t1 leads: t2 (which it started) and its record r1 stand in its row below; t2's helper t6 and r1's own r1/r2 stack
  // under them, one indent in. t3 started nothing and was started by nothing: its own row, no lead over it.
  const row = P.h + P.row;
  expect([t.get("t2").y, t.get("t1#r1").y, t.get("t1#r1").x - t.get("t2").x]).toEqual([row, row, P.w + P.col]);
  expect([t.get("t6").x - t.get("t2").x, t.get("t6").y - t.get("t2").y]).toEqual([P.indent, P.h + P.gap]);
  expect([t.get("t1#r1/r2").x - t.get("t1#r1").x, t.get("t1#r1/r2").y]).toEqual([P.indent, row + P.h + P.gap]);
  expect(t.get("t3").y).toBe(row + 2 * P.h + P.gap + P.row);
  // The lead centred over its row of two: its centre is that row's.
  expect(t.get("t1").x + t.get("t1").w / 2).toBe((2 * P.w + P.col) / 2);
  // A lead's branch: its bottom centre, the rail, the agent's top centre; a helper's: down the indent column.
  expect(tree.edges.find((e) => e.to === "t1#r1").points).toEqual([[t.get("t1").x + t.get("t1").w / 2, P.h], [t.get("t1").x + t.get("t1").w / 2, P.h + P.row / 2], [P.w + P.col + P.w / 2, P.h + P.row / 2], [P.w + P.col + P.w / 2, row]]);
  expect(tree.edges.find((e) => e.to === "t6").points).toEqual([[P.indent / 2, row + P.h], [P.indent / 2, t.get("t6").y + P.h / 2], [P.indent, t.get("t6").y + P.h / 2]]);
  // The view: at the app's narrowest (a 200 wide view, a 168 board), 488 and 1160, every pill shows inside the board.
  for (const width of [200, 488, 1160]) {
    const h = viewHarness(f); h.view.boardViewport = { width, height: 800 }; h.render();
    const pills = h.nodes.filter((n) => String(n.props.id ?? "").startsWith("nd-"));
    expect(pills.length).toBe(h.view.rows.length);
    for (const c of pills) expect(c.props.left + c.props.w).toBeLessThanOrEqual(Math.max(width - 32, P.w));
  }
});

test("a 15-agent section fits the board: every agent, one edge per pair, rows wrapping down a trunk when narrow", () => {
  // A lead, four workers it started, each with two helpers, and two loose agents: 15 agents in one tab.
  const term = (address, parent) => ({ address, name: address, state: "live", status: "idle", parent, program: codex, report: { state: "idle" } });
  const terminals = [term("lead", null)];
  for (let w = 1; w <= 4; w++) { terminals.push(term(`w${w}`, "lead")); for (let k = 1; k <= 2; k++) terminals.push(term(`w${w}h${k}`, `w${w}`)); }
  terminals.push(term("solo1", null), term("solo2", null));
  expect(terminals).toHaveLength(15);
  const f = { ...fixture(), terminals, agents: [], panes: terminals.map((t, i) => ({ pane: `p${i}`, tab: "a", terminal: t.address, program: codex })) };
  const sec = mindMap(buildBoard(f))[0].sections[0], P = factory.PILL;
  const pairs = terminals.filter((t) => t.parent).map((t) => [t.parent, t.address]);
  for (const room of [1200, 500]) {
    const tree = factory.treeSection(sec, room), t = new Map(tree.nodes.map((n) => [n.key, n]));
    expect(tree.nodes.map((n) => n.key).sort()).toEqual(terminals.map((x) => x.address).sort());
    expect(tree.edges.map((e) => [e.from, e.to]).sort()).toEqual([...pairs].sort());
    for (const n of tree.nodes) expect(n.x + n.w, `${room} ${n.key}`).toBeLessThanOrEqual(room);
    for (const [p, c] of pairs) {
      expect(t.get(c).y, `${room} ${c}`).toBeGreaterThan(t.get(p).y); // below its parent
      if (p !== "lead") expect(t.get(c).x - t.get(p).x).toBe(P.indent); // a helper, one indent in
    }
    for (const e of tree.edges.filter((e) => e.from === "lead")) {
      expect(e.points[0]).toEqual([t.get("lead").x + t.get("lead").w / 2, P.h]);
      expect(e.points.at(-1)).toEqual([t.get(e.to).x + P.w / 2, t.get(e.to).y]);
    }
    if (room === 1200) expect(new Set(["w1", "w2", "w3", "w4"].map((w) => t.get(w).y)).size).toBe(1); // one row
    else {
      // Two to a row: w3 starts the second row, reached down the trunk at the left.
      expect(t.get("w3").y).toBeGreaterThan(t.get("w1").y);
      expect(tree.edges.find((e) => e.to === "w3").points.some(([x]) => x === P.trunk / 2)).toBe(true);
    }
  }
  // The view draws all 15 at a wide board, with no window note.
  const h = viewHarness(f); h.view.boardViewport = { width: 1440, height: 600 }; h.render();
  expect(h.nodes.filter((n) => String(n.props.id ?? "").startsWith("nd-")).length).toBe(15);
  expect(renderedText(h.byId("board"))).not.toContain("arrow keys for more");
});

test("review-vertical: with no width known yet every pill is placed and sized; a narrow view's pills are 44 tall", () => {
  const f = fixture(), sec = mindMap(buildBoard(f))[0].sections[0], P = factory.PILL;
  const open = factory.treeSection(sec);
  for (const n of open.nodes) expect([n.key, Number.isFinite(n.x), Number.isFinite(n.y), n.h]).toEqual([n.key, true, true, P.h]);
  expect(open.nodes.find((n) => n.key === "t2").y).toBe(P.h + P.row);
  expect(open.w).toBeGreaterThan(0);
  // The view before any size arrives: the same tree, not the mind map's places.
  const h = viewHarness(f); h.render();
  expect([h.byId("nd-t2").props.top, h.byId("nd-t2").props.h]).toEqual([P.h + P.row, P.h]);
  // Under NARROW (768) the view's target is 44, so every pill and its rows grow to it; 768 and up keep 28.
  h.view.boardViewport = { width: 390, height: 800 }; h.render();
  const pills = () => h.nodes.filter((n) => String(n.props.id ?? "").startsWith("nd-"));
  expect(new Set(pills().map((n) => n.props.h))).toEqual(new Set([44]));
  expect(h.byId("nd-t2").props.top).toBe(44 + P.row);
  h.view.boardViewport = { width: 768, height: 800 }; h.render();
  expect(new Set(pills().map((n) => n.props.h))).toEqual(new Set([28]));
});

test("R1: a pill selected by click is scrolled to, as by key; deselecting asks no scroll", () => {
  const h = viewHarness(twoMachines()); h.view.boardViewport = { width: 1200, height: 300 }; h.render();
  h.byId("nd-t4").props.on_click({}, h.cx); h.render();
  expect(h.view.sel).toBe("t4");
  expect(h.scrolls).toEqual([1]);
  const anchor = h.byId("sel-anchor"), pill = h.byId("nd-t4");
  expect([anchor.props.left, anchor.props.h]).toEqual([16 + pill.props.left, pill.props.h]);
  h.byId("nd-t4").props.on_click({}, h.cx); h.render();
  expect([h.view.sel, h.scrolls]).toEqual([null, [1]]);
});

test("R1: a card selected by key below the fold is scrolled into view, once per change", () => {
  const h = viewHarness(deepFixture()); h.view.boardViewport = { width: 390, height: 600 }; h.render();
  // The last card, chosen by command: far below a 600 high view.
  h.view.sel = h.view.rows.at(-1).key; h.view.revealSel = true;
  h.render();
  const last = h.view.rows.at(-1);
  expect(h.view.sel).toBe(last.key);
  const card = h.byId(`nd-${last.key}`);
  expect(card.props.top).toBeGreaterThan(600);
  // The board is asked to show its anchor (its second child), which sits where the card sits in the board.
  expect(h.scrolls).toEqual([1]);
  const board = h.byId("board"), anchor = board.kids[1];
  expect(anchor.props.id).toBe("sel-anchor");
  expect([anchor.props.top, anchor.props.left, anchor.props.h]).toEqual([16 + factory.SECTION.head + factory.SECTION.gap + card.props.top, 16 + card.props.left, card.props.h]);
  // A render without a new selection does not scroll again, so a person's own scrolling is not fought.
  h.render(); expect(h.scrolls).toEqual([1]);
});

// X1: the arrows walk the mind map as a tree, bound under the board's own context.
const xMap = [
  { sections: [{ nodes: [{ key: "P", depth: 0 }, { key: "C1", depth: 1 }, { key: "G", depth: 2 }, { key: "C2", depth: 1 }], edges: [{ from: "P", to: "C1" }, { from: "C1", to: "G" }, { from: "P", to: "C2" }] },
    { nodes: [{ key: "Q", depth: 0 }, { key: "Q1", depth: 1 }], edges: [{ from: "Q", to: "Q1" }] }] },
  { sections: [{ nodes: [{ key: "R", depth: 0 }], edges: [] }] },
];
test("X1: ↑ parent, ↓ first child, ←/→ along the row, a helper ↑/↓ in its column, no wrap", () => {
  const { view } = viewHarness();
  const step = (sel, key) => { view.map = xMap; view.sel = sel; view.arrow(key, { notify() {} }); return view.sel; };
  expect(step("C2", "up")).toBe("P"); // the parent
  expect(step("G", "up")).toBe("C1"); // a helper: the pill above it in its column
  expect(step("G", "right")).toBe("C2"); // a helper: the next agent along its column's row
  expect(step("P", "up")).toBe("P"); // a lead has none
  expect(step("P", "down")).toBe("C1"); // the first child
  expect(step("C1", "down")).toBe("G");
  expect(step("G", "down")).toBe("G"); // a leaf stays
  expect(step("C1", "right")).toBe("C2"); // beside it on its level
  expect(step("C2", "right")).toBe("C2"); // the section's last on that level stays: no wrap
  expect(step("Q1", "left")).toBe("Q1"); // another section's level is not this one's
  expect(step("P", "right")).toBe("Q"); // the leads' level runs on to the next section
  expect(step("Q", "right")).toBe("R"); // and across groups
  expect(step("Q", "left")).toBe("P");
  // Nothing selected: ↓ or → the first node, ↑ or ← the last.
  expect([step(null, "down"), step(null, "right"), step(null, "up"), step(null, "left")]).toEqual(["P", "P", "R", "R"]);
});


test("X1: the arrows are bound once in PdkFactory, the root declares it, and each action steps the selection", () => {
  const h = viewHarness();
  const bound = [], cx = { bind_keys: (l) => { bound.push(...l); return l.length; }, focus_handle: () => ({ focus() {} }), timer: { every() {}, after() {} }, spawn() {}, notify() {} };
  h.view.init({}, cx);
  new h.Factory().init({}, cx); // a second view of the same module load binds nothing more
  expect(bound).toEqual(["up", "down", "left", "right"].map((k) => ({ keystroke: k, action: `pdk_factory_${k}`, context: "PdkFactory" })));
  Object.assign(h.view, { obs: newObservation(1), coreMs: new Map(), boardScroll: { scroll_to_item() {} } });
  h.render();
  const root = h.byId("factory");
  expect(root.props.key_context).toBe("PdkFactory");
  const first = h.view.rows[0].key;
  root.props["on_action:pdk_factory_down"]({}, h.cx);
  expect(h.view.sel).toBe(first);
  root.props["on_action:pdk_factory_down"]({}, h.cx); // the tree: ↓ the first child, ↑ back to its parent
  const child = h.view.rows.find((n) => (h.view.map.flatMap((g) => g.sections.flatMap((s) => s.edges))).some((e) => e.from === first && e.to === n.key));
  expect(h.view.sel).toBe(child ? child.key : first);
  root.props["on_action:pdk_factory_up"]({}, h.cx);
  expect(h.view.sel).toBe(first);
});
