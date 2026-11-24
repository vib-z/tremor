// "/" commands in the chat and terminal views, as Moshi offers them (owner request 30; reports/slash-commands.md).
// Each agent's own built-ins (adapters/slash-data.js, generated from its pinned source) plus the names of its custom
// commands and skills, never their contents. The menu only inserts text; sending stays the composer's guarded Send.
// Pure: plain data in, plain data out.
import { SLASH_DATA } from "./slash-data.js";

// The agents with a sourced list; any other agent gets no menu and says so.
export const SLASH_KINDS = Object.keys(SLASH_DATA);
export const NO_MENU = "No / command list for this agent: none is published that tremor can read. Typed commands still go as typed.";

// What a command does, as a quiet label (reports/slash-commands.md, safety classes). `switcher`: the chat opens its
// session-only model switcher instead of inserting. Custom commands and skills are never marked safe.
const SESSION = new Set(["clear", "new", "reset", "resume", "fork", "branch", "handoff", "sessions"]);
const ENDS = new Set(["exit", "quit", "logout"]);
const DESTRUCTIVE = new Set(["delete", "undo", "rollback", "rewind", "stop", "archive", "clean"]);
const WRITES = new Set(["init", "config", "settings", "permissions", "approvals", "mcp", "plugins", "worktree", "save", "export",
  "hooks", "memory", "memories", "keymap", "theme", "statusline", "title", "import", "install-github-app", "terminal-setup", "yolo", "cron", "login", "update"]);
export const SAFETY_WORDS = { switcher: "opens the switcher", session: "new session", ends: "ends the agent", destructive: "can't be undone",
  writes: "writes settings or files", custom: "custom", skill: "skill" };
export function safetyOf(entry) {
  const n = entry.name;
  if (entry.custom) return entry.type === "skill" ? "skill" : "custom";
  if (n === "model" || n === "effort") return "switcher";
  if (SESSION.has(n)) return "session";
  if (ENDS.has(n)) return "ends";
  if (DESTRUCTIVE.has(n)) return "destructive";
  if (WRITES.has(n)) return "writes";
  return entry.type === "skill" ? "skill" : null;
}

// Custom names from the helper's `names` (names only): Claude's commands and skills (project and user), Codex's
// /prompts:<name>. Hermes has none here: its dynamic skills are its own state, which the pack doesn't read.
export function customEntries(kind, names = []) {
  if (kind !== "claude" && kind !== "codex") return [];
  return names.filter((x) => x && typeof x.name === "string" && /^[A-Za-z0-9._:-]{1,64}$/.test(x.name))
    .map((x) => ({ name: x.name, args: "", description: `${x.scope === "project" ? "Project" : "Your"} ${x.type === "skill" ? "skill" : kind === "codex" ? "prompt" : "command"}`,
      aliases: [], type: x.type === "skill" ? "skill" : "command", custom: true }));
}

// The menu's entries for one agent: its built-ins in their source's order, then custom ones, a name once.
export function commandsFor(kind, names = []) {
  const src = SLASH_DATA[kind];
  if (!src) return [];
  const seen = new Set();
  return [...src.commands, ...customEntries(kind, names)].filter((c) => !seen.has(c.name) && seen.add(c.name))
    .map((c) => ({ ...c, safety: safetyOf(c) }));
}

// Where the list comes from, for its footer's tooltip.
export const sourceLine = (kind) => (SLASH_DATA[kind] ? `${SLASH_DATA[kind].agent} ${SLASH_DATA[kind].version}: ${SLASH_DATA[kind].source} (${SLASH_DATA[kind].licence})` : "");

// The chat's trigger: a draft that is "/" and a name being typed (nothing after a space or a new line). The query,
// or null when the menu should be closed.
export function slashQuery(text) {
  const m = /^\/([^\s/]*)$/.exec(String(text ?? ""));
  return m ? m[1].toLowerCase() : null;
}

// Filter, on names and aliases only (a description says what a command does, not what it is called): the exact
// name or alias first, then names starting with the query, then aliases starting with it, then names containing
// it; source order within each.
export function filterCommands(list, query) {
  const q = String(query ?? "").toLowerCase();
  if (!q) return list;
  const exact = list.filter((c) => c.name.toLowerCase() === q || c.aliases?.includes(q));
  const starts = [...exact, ...list.filter((c) => !exact.includes(c) && c.name.toLowerCase().startsWith(q))];
  const alias = list.filter((c) => !starts.includes(c) && c.aliases?.some((a) => a.startsWith(q)));
  const has = list.filter((c) => !starts.includes(c) && !alias.includes(c) && c.name.toLowerCase().includes(q));
  return [...starts, ...alias, ...has];
}

// The menu's state: the list shown, the highlighted row.
export const openMenu = (list, query = "") => ({ query, all: list, shown: filterCommands(list, query), i: 0 });
export const setQuery = (m, query) => ({ ...m, query, shown: filterCommands(m.all, query), i: 0 });

// One key in the menu: ↑↓ move (wrapping), Enter or Tab inserts the highlighted command, Esc closes.
export function menuKey(m, key) {
  const n = m.shown.length;
  if (key === "escape") return { m, action: "close" };
  if (key === "enter" || key === "tab") return { m, action: n ? "insert" : null };
  if (key === "up" || key === "down") return { m: { ...m, i: n ? (m.i + (key === "up" ? n - 1 : 1)) % n : 0 }, action: null };
  return { m, action: null };
}

// What the chat does with a pick: the switcher for /model and /effort, else the command and a space in the draft
// (never sent).
export const chatPick = (entry) => (entry.safety === "switcher" ? { switcher: true } : { text: `/${entry.name} ` });

// Whether a sent draft starts a new session in its agent: the chat then binds again at once.
export function startsSession(kind, text) {
  const n = /^\/([a-z0-9-]+)(\s|$)/.exec(String(text ?? "").trim())?.[1];
  if (!n || !SLASH_DATA[kind]) return false;
  const c = SLASH_DATA[kind].commands.find((x) => x.name === n || x.aliases?.includes(n));
  return Boolean(c && SESSION.has(c.name));
}

// Keys `hc keys` types as themselves (verified on a stand-in, 2026-11-09): lower-case letters, digits, "/", "-",
// "." and space. Upper case comes out lower case, and ":" "_" "?" "@" have no key name, so a name with them can't
// be typed into a terminal from here. The command and a space, as hc keys names; null when it can't be typed.
export function terminalKeys(entry) {
  const text = `/${entry.name}`;
  if (!/^\/[a-z0-9.-]{1,64}$/.test(text)) return null;
  return [...text, "space"];
}
export const UNTYPEABLE = "Can't be typed into a terminal from here: hc keys has no key for “:”, “_” or capitals";

// The rows in view: `rows` at most, keeping the highlighted one inside.
export function visibleRows(m, rows = 8) {
  const n = m.shown.length;
  const start = Math.max(0, Math.min(m.i - rows + 1 + Math.min(rows - 1, Math.floor(rows / 2)), n - rows));
  return { start, rows: m.shown.slice(start, start + rows) };
}

// Typing a picked command into a terminal (the pane's "/" button): only into the pane, terminal, process and agent
// the popup opened for, and only at the agent's prompt (a key typed into an approval prompt could answer it). The
// `hc keys` call, which never holds "enter", or why nothing is typed. `now`: what that pane shows at the moment.
export function terminalInsert(entry, target, now) {
  const keys = terminalKeys(entry);
  if (!keys) return { why: UNTYPEABLE };
  if (!now || !target?.terminal || now.terminal !== target.terminal || now.pid !== target.pid || now.kind !== target.kind) return { why: "That pane shows another program now: nothing was typed" };
  if (now.status === "working") return { why: "It is working: pick a command when it has finished its turn" };
  if (now.status === "blocked") return { why: "It is waiting for you in its terminal: nothing was typed" };
  return { args: ["keys", target.terminal, ...keys, "--json"] };
}
