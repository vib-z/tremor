// The pack's own menus (spec §5, §8): only what Herdr's `menu` lacks, an agent's pin and unread and a machine's
// connect and sign-in. Workspaces, tabs and panes open Herdr's own menu (status.js nativeMenu).
// Pure capture/revalidation: an open menu never follows the currently focused workspace or terminal.
import { rebuiltMachine } from "./lib/status.js";
export const place = (s, panes) => {
  const tabs = new Set((s?.tabs ?? []).map((t) => t.id));
  return panes.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s?.folder || null;
};
const host = (s) => s?.machine ?? null;
export function captureMenu(type, target, live) {
  const { spaces = [], panes = [], terminals = [], machines = [] } = live;
  const tg = target ?? {};
  if (type === "machine") {
    const name = tg.machine ?? tg.id ?? null;
    const m = machines.find((m) => m.name === name);
    if (name && !m) return null;
    return { type, id: name ?? "", machine: name || null, name: name || "This computer", identity: m ? JSON.stringify([m.id, m.target, m.session, m.via]) : null, entry: m ?? null };
  }
  if (type === "agent") {
    const t = terminals.find((t) => t.address === (tg.terminal ?? tg.address));
    if (!t || t.state !== "live") return null;
    const pane = panes.find((p) => p.terminal === t.address);
    const s = spaces.find((s) => s.id === tg.space || s.tabs.some((c) => c.id === pane?.tab));
    if (!s || (tg.machine !== undefined && host(s) !== (tg.machine || null))) return null;
    return { type, id: t.address, terminal: t.address, space: s.id, machine: host(s), name: tg.name || t.name || t.address, pid: t.pid ?? null, pane: pane?.pane ?? null, folder: place(s, panes) };
  }
  return null;
}
export function validMenu(c, live) {
  if (!c) return false;
  const now = captureMenu(c.type, { ...c, terminal: c.terminal }, live);
  return Boolean(now && now.id === c.id && now.machine === c.machine && now.space === c.space &&
    (c.type !== "agent" || now.pid === c.pid) && (c.type !== "machine" || now.identity === c.identity));
}
export function menuEntries(c, live, { repair = null } = {}) {
  if (!validMenu(c, live)) return [];
  const item = (id, label, command, args = {}, extra = {}) => ({ id, label, command, args, ...extra });
  if (c.type === "agent") {
    const t = live.terminals.find((t) => t.address === c.terminal), a = live.agents.find((a) => a.address === c.terminal);
    return [item("pin", a?.pinned ? "Unpin" : "Pin", "terminal.pin", { terminal: c.terminal, pinned: !a?.pinned }),
      item("unread", "Mark unread", "unread", { terminal: c.terminal }, { disabled: !(t.turn > 0) || t.status === "working", reason: !(t.turn > 0) ? "No completed turn yet" : t.status === "working" ? "Turn is still working" : "" })];
  }
  const m = c.entry, connected = !c.machine || m?.state === "connected";
  const auth = /login|password|passphrase|host key|permission denied|auth/i.test(`${m?.state} ${m?.why}`);
  return [item("new", "New workspace", `pdk-tabs.new-workspace:${c.machine || "local"}`, {}, { disabled: !connected }),
    item("manage", "Manage…", "app.settings", { section: "machines" }),
    ...(rebuiltMachine(m) || repair ? [item("connect", repair?.error ? "Retry connection" : "Connect", "connect", {}, { disabled: Boolean(repair?.busy), reason: repair?.busy ? "Connecting…" : "", group: true })] : []),
    ...(auth ? [item("login", "Sign in in terminal", "login", {}, { group: true })] : [])];
}
