// Captured workspace utility contract; no focused-workspace fallback.
export function captureWorkspace(p) {
  const path=v=>typeof v==="string"&&v.length<=16384&&!/[\x00-\x1f]/.test(v)&&(/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(v));
  if (typeof p?.space!=="string" || !p.space || !path(p.folder) || p.repo!=null&&!path(p.repo) || p.machine!=null&&typeof p.machine!=="string") return null;
  return { space:p.space, name:p.name || "Workspace", machine:p.machine ?? null, folder:p.folder, repo:p.repo || p.folder, trigger:p.trigger, returnCommand:p.returnCommand };
}
export function workspaceCurrent(target, spaces) {
  return Boolean(target && spaces.some(s=>s.id===target.space && (s.machine ?? null)===target.machine));
}
export function utilityKey(p) { return JSON.stringify([p?.space,p?.machine ?? null,p?.folder,p?.repo]); }
export const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];

// The one-tap "+" (spec §3; owner, 10 Nov: a workspace on the chosen machine, in a real folder, with an agent running).
// Shared keys: the last folder used on each machine (keyed by machine name, "" for this computer), the owner's default
// folder on each machine (same keys; set on the tremor settings page) and the last agent started (its key).
export const NEW_KEYS = { folders: "pdk.new.folders", default: "pdk.new.default", agent: "pdk.new.agent" };

// The machine "+" makes it on: the one the filter shows, else (All) the shown workspace's, else this computer ("").
export const newMachine = (filter, spaces = []) => (typeof filter === "string" && filter !== "all" ? filter : spaces.find((s) => s.active)?.machine ?? "");

// The folders a new workspace on `machine` ("" or null: this computer) may start in, best first: that machine's default
// folder (`defaults`, owner 11 Nov: "set a default path of where my agents would open"), the focused pane's folder when
// that pane is on that machine (`focusedPane`: { machine, cwd }), that machine's last-used folder (`lastFolders`), its
// `home`. Never "", never "/" unless the person is root (home /root or /var/root), never a
// relative path or another machine's. The caller checks each still exists there.
export function folderChoices({ machine = null, focusedPane = null, lastFolders = {}, home = null, defaults = {} } = {}) {
  const on = machine || "";
  const root = home === "/root" || home === "/var/root";
  const ok = (f) => typeof f === "string" && f.startsWith("/") && (f !== "/" || root);
  const focus = focusedPane && (focusedPane.machine || "") === on ? focusedPane.cwd : null;
  return [...new Set([defaults?.[on], focus, lastFolders?.[on], home].filter(ok))];
}

// The first of those; null when nothing is known (the caller opens a folder picker, on this computer only).
export const resolveFolder = (args) => folderChoices(args)[0] ?? null;

// A new workspace's name: its folder's last part, "Home" for the home folder, numbered when that machine already
// has one so called ("evals 2"), so two rows never read the same (lead, phase 2).
export function workspaceName(folder, { home = null, taken = [] } = {}) {
  const trimmed = String(folder).replace(/\/+$/, "");
  const base = !trimmed || trimmed === String(home ?? "").replace(/\/+$/, "") ? "Home" : trimmed.split("/").pop();
  const used = new Set(taken);
  let name = base;
  for (let n = 2; used.has(name); n++) name = `${base} ${n}`;
  return name;
}

// The agent "+" starts (`known`: knownAgents() on that machine, in Herdr's order): the last-used one (`lastUsed`: its
// key) when it is installed there, else Claude Code, else Codex, else the first installed; null when none is.
export function defaultAgent({ known = [], lastUsed = null } = {}) {
  const ready = (known ?? []).filter((a) => a?.installed && a.run?.length);
  const by = (key) => (key ? ready.find((a) => a.key === key) : null);
  return by(lastUsed) ?? by("claude") ?? by("codex") ?? ready[0] ?? null;
}
