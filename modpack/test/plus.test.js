// The one "+" (spec §3): shared/new-workspace.js, which the tab bar hosts as pdk-tabs.new-workspace (review UX03), in the
// parity harness with stand-in exec, agents and picker.
import { test, expect } from "bun:test";
import { harness, world } from "./parity-harness.js";

const CLAUDE = { key: "claude", name: "Claude Code", run: ["claude"], installed: true };
const CODEX = { key: "codex", name: "Codex", run: ["codex", "--no-daemon"], installed: true };
// A world whose folders exist per machine, whose HOME is known per machine, and where space.new makes the workspace.
function scene({ dirs = { "": ["/repo/a", "/private-test"], box: ["/home/v"] }, homes = { box: "/home/v" }, known = [CLAUDE, CODEX] } = {}) {
  const w = world();
  w.focused = { space: "A", tab: "tab1", pane: "p1", terminal: "t1", cwd: "/repo/a" };
  w.exec = async (cmd, args, opts) => {
    const on = opts?.on ?? "";
    if (cmd === "test") return { code: (dirs[on] ?? []).includes(args[1]) ? 0 : 1, stdout: "", stderr: "" };
    if (cmd === "printenv") return homes[on] ? { code: 0, stdout: `${homes[on]}\n`, stderr: "" } : { code: 1, stdout: "", stderr: "" };
    return { code: 1, stdout: "", stderr: "not a git repository" };
  };
  w.known = () => known;
  w.onRun = (name, args) => {
    if (name !== "space.new") return;
    const id = `N${w.spaces.length}`;
    w.spaces.push({ id, name: args.name, folder: args.folder, machine: args.machine || null, active: false, tabs: [{ id: `${id}t`, name: args.tab, active: true }] });
    w.panes.push({ pane: `${id}p`, tab: `${id}t`, terminal: `${id}x`, cwd: args.folder, focused: false, program: { agent: true, key: "claude", name: "Claude Code" } });
  };
  const h = harness(w);
  const host = {}; // the tab bar copy that runs it
  const press = async (filter = "all") => { h.store.set("pdk.machine.filter", filter); h.env.newWorkspace(host, h.cx); for (const t of h.tasks.splice(0)) await t(h.cx); };
  const made = () => h.calls.filter((c) => c[0] === "space.new").map((c) => c[1]);
  const notes = () => h.calls.filter((c) => c[0] === "notify").map((c) => c[1].title);
  return { w, h, host, press, made, notes };
}

test("one press: the focused folder, named after it, Claude as its first tab, then shown; a second press while it runs does nothing", async () => {
  const s = scene();
  s.h.env.newWorkspace(s.host, s.h.cx); s.h.env.newWorkspace(s.host, s.h.cx);
  expect(s.h.tasks.length).toBe(1);
  for (const t of s.h.tasks.splice(0)) await t(s.h.cx);
  expect(s.made()).toEqual([{ machine: "", folder: "/repo/a", name: "a", tab: "Claude Code", argv: ["claude"] }]);
  expect(s.h.calls.at(-1)).toEqual(["space.select", { id: "N3" }]);
  expect(s.h.store.get("pdk.new.folders")).toEqual({ "": "/repo/a" });
  expect(s.h.store.get("pdk.new.agent")).toBe("claude");
  // A second +: the same folder, numbered, never a second "a".
  await s.press();
  expect(s.made()[1].name).toBe("a 2");
});

test("per machine: box's own last folder, else its home; never this computer's folder; Home names the home", async () => {
  const s = scene();
  s.h.store.set("pdk.new.folders", { box: "/srv/gone" });
  await s.press("box");
  expect(s.made()).toEqual([{ machine: "box", folder: "/home/v", name: "Home", tab: "Claude Code", argv: ["claude"] }]);
  const t = scene({ dirs: { "": ["/repo/a"], box: ["/srv/api", "/home/v"] } });
  t.h.store.set("pdk.new.folders", { "": "/repo/a", box: "/srv/api" });
  await t.press("box");
  expect(t.made()[0]).toMatchObject({ machine: "box", folder: "/srv/api", name: "api" });
});

test("nothing usable: box says Folder unavailable; this computer asks with the picker, and a cancel makes nothing", async () => {
  const s = scene({ dirs: { "": [], box: [] }, homes: {} });
  await s.press("box");
  expect([s.made(), s.notes()]).toEqual([[], ["Folder unavailable"]]);
  const t = scene({ dirs: { "": [] }, homes: {} });
  await t.press();
  expect([t.made(), t.notes()]).toEqual([[], []]);
  t.w.pick = "/picked/evals";
  await t.press();
  expect(t.made()[0]).toMatchObject({ machine: "", folder: "/picked/evals", name: "evals" });
});

test("a default folder set for that machine is used ahead of the focused one and names the workspace; gone, the old order", async () => {
  const s = scene({ dirs: { "": ["/repo/a", "/work/evals"], box: ["/home/v", "/srv/api"] } });
  s.h.store.set("pdk.new.default", { "": "/work/evals", box: "/srv/api" });
  await s.press("");
  await s.press("box");
  expect(s.made().map((m) => [m.machine, m.folder, m.name])).toEqual([["", "/work/evals", "evals"], ["box", "/srv/api", "api"]]);
  const t = scene();
  t.h.store.set("pdk.new.default", { "": "/no/longer/here" });
  await t.press();
  expect(t.made()[0]).toMatchObject({ folder: "/repo/a", name: "a" });
});

test("agents: the last-used installed one, else Claude, else Codex; none installed says so and makes nothing", async () => {
  const s = scene({ known: [CODEX, { ...CLAUDE, installed: false }] });
  await s.press();
  expect(s.made()[0]).toMatchObject({ tab: "Codex", argv: ["codex", "--no-daemon"] });
  const t = scene();
  t.h.store.set("pdk.new.agent", "codex");
  await t.press();
  expect(t.made()[0].tab).toBe("Codex");
  const u = scene({ known: [{ ...CLAUDE, installed: false }] });
  await u.press();
  expect([u.made(), u.notes()]).toEqual([[], ["No agents installed"]]);
});

test("an offline machine makes nothing and says so; a workspace that never shows says Could not start", async () => {
  const s = scene();
  s.w.machines[0].state = "unreachable";
  await s.press("box");
  expect([s.made(), s.notes()]).toEqual([[], ["Offline"]]);
  const t = scene();
  t.w.onRun = () => {};
  await t.press();
  expect(t.notes()).toEqual(["Could not start"]);
});

// Review UX03: `<mod>.<command>` reaches shown copies only, so every "+" route runs the tab bar's command (the tab bar
// shows whether or not the sidebar does): its command loop makes the workspace with no tree involved.
test("the tab bar's pdk-tabs.new-workspace[:machine] makes the workspace; the sidebar's +, the menu and Cmd+K run it", async () => {
  const s = scene({ dirs: { "": ["/repo/a"], box: ["/home/v"] } });
  const queue = ["new-workspace:box"];
  s.w.next = () => (queue.length ? Promise.resolve(queue.shift()) : new Promise(() => {}));
  const tabs = new s.h.Tabs();
  tabs.init({}, s.h.cx);
  // The loop takes one command, starts the creation, then waits for the next command.
  const loop = s.h.tasks.splice(0)[0]; loop(s.h.cx);
  await new Promise((r) => setTimeout(r, 0));
  for (const t of s.h.tasks.splice(0)) await t(s.h.cx);
  expect(s.made()).toEqual([{ machine: "box", folder: "/home/v", name: "Home", tab: "Claude Code", argv: ["claude"] }]);
  // Every route names that command: the sidebar's +, the new menu, a machine's menu, Cmd+K (parity-panels).
  const src = (f) => require("node:fs").readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  for (const f of ["mods/pdk-tree/main.js", "mods/pdk-new-menu/main.js"]) expect(src(f)).toContain('run("pdk-tabs.new-workspace")');
  expect(src("mods/pdk-tree/menu-model.js")).toContain('`pdk-tabs.new-workspace:${c.machine || "local"}`');
  expect(src("mods/pdk-tree/main.js")).not.toMatch(/newWorkspace\(|pdk-tree\.new-workspace/);
});

// Review UX17: the guard lives with the tab bar copy that started the creation. A module outlives its copies and a
// closed copy's unfinished task is cancelled, so a guard of the module's own stayed set and every later + did nothing.
test("a tab bar closed while a creation is pending doesn't block the next +: a new tab bar starts one", async () => {
  const s = scene({ dirs: { "": ["/repo/a"], box: ["/home/v"] } });
  const commands = [];
  s.w.next = () => (commands.length ? Promise.resolve(commands.shift()) : new Promise(() => {}));
  const command = async (tabs, c) => { commands.push(c); const loop = s.h.tasks.splice(0)[0]; loop(s.h.cx); await new Promise((r) => setTimeout(r, 0)); };
  const first = new s.h.Tabs(); first.init({}, s.h.cx);
  await command(first, "new-workspace");
  expect(first.creating).toBe(true);
  s.h.tasks.length = 0; // the copy closes: its pending creation task is cancelled, never resumed
  const second = new s.h.Tabs(); second.init({}, s.h.cx);
  await command(second, "new-workspace:box");
  for (const t of s.h.tasks.splice(0)) await t(s.h.cx);
  expect(s.made()).toEqual([{ machine: "box", folder: "/home/v", name: "Home", tab: "Claude Code", argv: ["claude"] }]);
  expect(second.creating).toBe(false);
});

// F3: where the + would make a workspace, answered without exec, and shown on the sidebar's +.
test("plusTarget: local with a default, with only a focused pane, with nothing but home; remote with a default, with nothing", () => {
  const s = scene();
  const at = (on) => { const { machine, folder } = s.h.env.plusTarget(on); return { machine, folder }; };
  s.h.store.set("pdk.new.default", { "": "/repo/b", box: "/home/v/evals" });
  expect(at()).toEqual({ machine: "", folder: "/repo/b" });
  expect(at("box")).toEqual({ machine: "box", folder: "/home/v/evals" });
  s.h.store.set("pdk.new.default", {});
  expect(at()).toEqual({ machine: "", folder: "/repo/a" }); // the focused pane's
  s.w.focused = null;
  expect(at()).toEqual({ machine: "", folder: "/private-test" }); // home, this computer only
  expect(at("box")).toEqual({ machine: "box", folder: null }); // a remote home is unknown without exec
  s.h.store.set("pdk.new.folders", { box: "/home/v/api" });
  expect(at("box")).toEqual({ machine: "box", folder: "/home/v/api" });
  // newWorkspace picks the same machine: the filter's.
  s.h.store.set("pdk.machine.filter", "box");
  expect(at().machine).toBe("box");
  expect(s.h.calls.filter((c) => c[0] === "exec")).toEqual([]);
});

test("the sidebar's + names the folder and the machine in its tooltip and accessible name", () => {
  const s = scene();
  const words = () => { s.h.clear(); const tree = new s.h.Tree(); tree.init({}, s.h.cx); tree.render(s.h.cx); const b = s.h.byId("space-new"); return [b.props.tooltip, b.props.accessibility_label]; };
  s.h.store.set("pdk.new.default", { "": "/private-test/code/evals" });
  expect(words()).toEqual(["New workspace in ~/code/evals", "New workspace in ~/code/evals"]);
  s.h.store.set("pdk.machine.filter", "box");
  s.h.store.set("pdk.new.default", { box: "/home/v/evals" });
  expect(words()[0]).toBe("New workspace in /home/v/evals on box");
  s.h.store.set("pdk.new.default", {});
  expect(words()[0]).toBe("New workspace on box");
});
