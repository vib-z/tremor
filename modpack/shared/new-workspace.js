// The one "+" (spec §3), as the flow that acts: a workspace on the machine the filter shows (All: the shown
// workspace's, else this computer), in that machine's focused, last-used or home folder, named after it, with the
// default agent running as its first tab, then shown. A press while one is being made does nothing; anything missing
// says so and makes nothing. The decisions are adapters/workspace.js's.
//
// Hosted by the tab bar (pdk-tabs.new-workspace[:<local|name>]): `<mod>.<command>` reaches shown copies only
// (Herdr's mod guide), and the tab bar shows whether or not the sidebar does (review UX03). Every "+" route runs it:
// the sidebar's +, pdk-new-menu's New workspace, Cmd+K's New workspace entries and a machine's menu.

import { spaces, panes, machines, focused, run, shared, setShared, exec, knownAgents, notify, pickFolder, home as homeDir } from "herdr";
import { machineLabel, MACHINE_KEYS, machineFilter, machineList } from "./status.js";
import { NEW_KEYS, newMachine, folderChoices, workspaceName, defaultAgent } from "./workspace.js";

// One creation at a time, guarded by the host that runs it (the tab bar copy: `host.creating`). The guard lives and
// dies with that copy: a module outlives its copies, and a closed copy's unfinished task is cancelled, so a guard of
// the module's own could stay set for good (review UX17). `on`: a machine named by the command ("" this computer),
// else the filter's.
// Where the + would make a workspace, without exec: the machine newWorkspace picks and the first folder create would
// try (defaults, focused pane, last used, and home only on this computer: another's is unknown without exec). The
// folder is null when nothing is known yet; create still checks a folder exists before it uses it.
export function plusTarget(on = null) {
  const filter = machineFilter(shared(MACHINE_KEYS.filter), machineList({ spaces: spaces(), machines: machines(), listed: shared("pdk.machines.list") ?? [] }));
  const machine = on ?? newMachine(filter, spaces());
  const f = focused();
  const space = spaces().find((s) => s.id === f?.space);
  const focusedPane = space ? { machine: space.machine ?? "", cwd: f.cwd } : null;
  const folder = folderChoices({ machine, focusedPane, lastFolders: shared(NEW_KEYS.folders) ?? {}, home: machine ? null : homeDir(), defaults: shared(NEW_KEYS.default) ?? {} })[0] ?? null;
  return { machine, folder, focusedPane };
}

export function newWorkspace(host, cx, on = null) {
  if (host.creating) return;
  const { machine, focusedPane } = plusTarget(on);
  if (machine && machines().find((m) => m.name === machine)?.layout !== "ready") {
    notify({ title: "Offline", body: machineLabel(machine), level: "warning" });
    return;
  }
  host.creating = true;
  cx.spawn(async (cx) => {
    try { await create(machine, focusedPane, cx); }
    catch (e) { notify({ title: "Could not start", body: String(e?.message ?? e), level: "error" }); }
    host.creating = false;
    cx.notify();
  });
}

async function create(machine, focusedPane, cx) {
  const on = machine || null;
  const lastFolders = shared(NEW_KEYS.folders) ?? {};
  const exists = async (dir) => { try { return (await exec("test", ["-d", dir], { on })).code === 0; } catch { return false; } };
  // Its home: this computer's from the app, another's asked there with a fixed argv (never shell text).
  const askHome = async () => (on ? await exec("printenv", ["HOME"], { on }).then((r) => (r.code === 0 ? r.stdout.trim() : null), () => null) : homeDir());
  const home = await askHome();
  let folder = null;
  for (const dir of folderChoices({ machine, focusedPane, lastFolders, home, defaults: shared(NEW_KEYS.default) ?? {} })) if (await exists(dir)) { folder = dir; break; }
  // Nothing usable: this computer asks with its folder picker (cancel makes nothing); another machine can't.
  if (!folder && !on) folder = await pickFolder({ prompt: "Open" });
  if (!folder) { if (on) notify({ title: "Folder unavailable", body: machineLabel(on), level: "warning" }); return; }
  let known;
  try { known = await knownAgents({ on }); }
  catch (e) { notify({ title: "Could not start", body: String(e?.message ?? e), level: "error" }); return; }
  const agent = defaultAgent({ known, lastUsed: shared(NEW_KEYS.agent) });
  if (!agent) { notify({ title: "No agents installed", body: machineLabel(on), level: "warning" }); return; }
  const name = workspaceName(folder, { home, taken: spaces().filter((s) => (s.machine ?? "") === machine).map((s) => s.name) });
  const before = new Set(spaces().map((s) => s.id));
  run("space.new", { machine, folder, name, tab: agent.name, argv: agent.run });
  // Ready only once Herdr shows the workspace with its terminal (run returns nothing to wait on).
  let made = null;
  for (let i = 0; i < 100 && !made; i++) {
    await cx.sleep(100);
    const s = spaces().find((x) => !before.has(x.id) && (x.machine ?? "") === machine && x.name === name);
    if (s && panes().some((p) => p.terminal && s.tabs.some((t) => t.id === p.tab))) made = s;
  }
  if (!made) { notify({ title: "Could not start", body: name, level: "error" }); return; }
  setShared(NEW_KEYS.agent, agent.key);
  setShared(NEW_KEYS.folders, { ...(shared(NEW_KEYS.folders) ?? {}), [machine]: folder });
  if (!made.active) run("space.select", { id: made.id });
}

// The focused pane's folder is its machine's last-used one, for the next "+" there. Called from the host's render:
// writes only when the folder changed and is one "+" could use.
export function rememberFolder() {
  const f = focused();
  const at = spaces().find((s) => s.id === f?.space);
  if (!at) return;
  const m = at.machine ?? "";
  const used = shared(NEW_KEYS.folders) ?? {};
  if (folderChoices({ machine: m, focusedPane: { machine: m, cwd: f.cwd } })[0] === f.cwd && used[m] !== f.cwd) setShared(NEW_KEYS.folders, { ...used, [m]: f.cwd });
}
