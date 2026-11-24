// Which session belongs to a terminal: decided only from evidence about this process (D29, D32, M4).
// Pure: the caller gathers the evidence (registry text, process start, held files, file heads, labels) and
// these functions decide. No "newest file", no listing of session folders; anything unclear binds nothing.
//
// Rules ported from Heeler (ZingerLittleBee/Heeler@7bfe7fa, Apache-2.0): Sources/Heeler/Chat/Source/
// HerdrCoreSessionBinder.swift:335-365 (Claude registry, pid and procStart), +Programs.swift:9-150 (Codex held
// rollouts, roots, locks, shared daemon), ClaudeProjectKey.swift (project key), CodexRolloutFileName.swift.
// Modified: rewritten in JavaScript; reasons are user-facing words; Grok, Hermes, OpenCode, Pi, Kimi and
// Gemini rules reduced to what can be decided without listing a folder. See modpack/NOTICE.md.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s) => typeof s === "string" && UUID.test(s);
const isV7 = (s) => isUuid(s) && s[14] === "7";

const no = (reason) => ({ ok: false, reason });
const yes = (fields) => ({ ok: true, ...fields });

// Claude Code's project folder name for a working directory (CLI 2.1.x).
export function projectKey(dir) {
  const s = String(dir).normalize("NFC");
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) ? s[i] : "-";
  }
  if (s.length <= 200) return out;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return out.slice(0, 200) + "-" + Math.abs(h).toString(36);
}

// A Codex rollout file name: rollout-<19 char time>-<thread>[_<rollout>].jsonl[.zst].
export function rolloutName(fileName) {
  let rest = String(fileName).split("/").pop();
  const compressed = rest.endsWith(".zst");
  if (compressed) rest = rest.slice(0, -4);
  if (!rest.startsWith("rollout-") || !rest.endsWith(".jsonl")) return null;
  rest = rest.slice(8, -6);
  const time = rest.slice(0, 19);
  rest = rest.slice(19);
  if (time.length !== 19 || rest[0] !== "-") return null;
  rest = rest.slice(1);
  const cut = rest.indexOf("_");
  const thread = cut < 0 ? rest : rest.slice(0, cut);
  const rollout = cut < 0 ? rest : rest.slice(cut + 1);
  if (!thread || !rollout) return null;
  return { time, thread, rollout, compressed };
}

const parse = (text) => { try { return JSON.parse(text); } catch { return null; } };

// Claude: ~/.claude/sessions/<pid>.json names the session; its pid and procStart must match this process
// (a reused pid carries another process's start). The transcript is at projects/<key(cwd)>/<id>.jsonl.
export function bindClaude({ home, pid, start, registryText, env = {} }) {
  if (!pid) return no("no foreground process");
  if (env.CLAUDE_CODE_CHILD_SESSION || env.CLAUDE_CODE_SKIP_PROMPT_HISTORY) return no("this Claude Code keeps no transcript");
  if (registryText == null) return no("Claude Code has not registered this session yet (it does at its prompt)");
  const e = parse(registryText);
  if (!e || !isUuid(e.sessionId)) return no("the session registry entry is unreadable");
  if (String(e.pid) !== String(pid)) return no("the registry entry names another process");
  if (!start || e.procStart !== start) return no("the registry entry belongs to an earlier process with this pid");
  const root = `${home}/.claude`;
  const cwd = typeof e.cwd === "string" ? e.cwd : null;
  if (!cwd) return no("the registry entry has no folder");
  return yes({ kind: "claude", session: e.sessionId.toLowerCase(), path: `${root}/projects/${projectKey(cwd)}/${e.sessionId}.jsonl`, cwd });
}

// Codex: the native process holds its own rollout open from the first prompt. Exactly one held root rollout
// whose first line is the session_meta of the thread its name says. A shared daemon, several roots, a lock
// for a thread without its rollout, or a head that doesn't match binds nothing.
export function bindCodex({ home, argv, held, heads, stats = {} }) {
  const root = `${home}/.codex/`;
  if (!held) return no("can't read the files this Codex holds");
  if ((argv ?? []).some((a) => a === "--managed-daemon" || a === "app-server")) return no("a Codex app-server, not a window");
  const files = held.filter((f) => f.startsWith(root));
  const rollouts = files
    .filter((f) => f.includes("/sessions/") || f.includes("/archived_sessions/"))
    .map((f) => ({ path: f, name: rolloutName(f) }))
    .filter((r) => r.name && !r.name.compressed);
  const threads = new Set(rollouts.map((r) => r.name.thread.toLowerCase()));
  // Codex keeps holding the lock of a thread it left before its first message (/clear, then /new: seen with 0.167.0,
  // 11 Nov 2026). Thread ids are UUIDv7, which sort by when they were made, so a lock older than a held rollout's
  // thread is that left thread; only a newer one is a new thread with no file yet.
  const newest = rollouts.every((r) => isV7(r.name.thread)) ? [...threads].sort().at(-1) : null;
  const lockWithout = files.some((f) => {
    if (!f.includes("/thread-writer-locks/")) return false;
    const leaf = f.split("/").pop();
    if (!leaf.endsWith(".lock")) return true;
    const t = leaf.slice(0, -5).toLowerCase();
    return !threads.has(t) && !(newest && isV7(t) && t < newest);
  });
  if (rollouts.length === 0) {
    if (!(argv ?? []).includes("--no-daemon")) return no("this Codex runs on the shared daemon (start it with --no-daemon)");
    return no("Codex writes its session file after the first message");
  }
  if (rollouts.length > 8) return no("this Codex holds too many session files to tell");
  if (lockWithout) return no("this Codex started a new thread that has no file yet");
  const rootsFound = [];
  for (const r of rollouts) {
    const head = parse(heads?.[r.path] ?? "");
    const p = head?.payload;
    if (head?.type !== "session_meta" || !p || String(p.id).toLowerCase() !== r.name.thread.toLowerCase()) return no("a held session file does not match its name");
    const plain = typeof p.source === "string" || p.source == null;
    const isRoot = !p.parent_thread_id && p.thread_source !== "subagent" && plain;
    if (isRoot) rootsFound.push({ path: r.path, session: r.name.thread.toLowerCase(), cwd: typeof p.cwd === "string" ? p.cwd : null });
  }
  if (!rootsFound.length) return no("only sub-agent sessions are held");
  if (rootsFound.length === 1) return yes({ kind: "codex", ...rootsFound[0] });
  // Several conversations held (after /clear or /new Codex keeps the old rollout open about a minute): the one it is
  // in is the one it wrote last, when that one was written after every other last changed. A tie, or a time that
  // can't be read, binds nothing.
  const at = (r) => (Number.isFinite(stats?.[r.path]?.mtimeMs) ? stats[r.path].mtimeMs : null);
  const times = rootsFound.map(at);
  if (times.includes(null)) return no("this Codex holds more than one conversation");
  const last = Math.max(...times);
  if (times.filter((t) => t === last).length !== 1) return no("this Codex holds more than one conversation, written at the same moment");
  // `roots`: the choice was among these, so it holds only while that file is still the one written last (a tail rechecks).
  return yes({ kind: "codex", ...rootsFound[times.indexOf(last)], roots: rootsFound.map((r) => r.path) });
}

// Grok Build: ~/.grok/active_sessions.json rows {session_id, pid, pid_start, cwd}. One row for this pid whose
// pid_start (microseconds since the epoch on macOS) is within a second of the process's start.
export function bindGrok({ home, pid, startEpochMs, registryText }) {
  const rows = parse(registryText ?? "");
  if (!Array.isArray(rows)) return no("Grok Build has not registered a session");
  const mine = rows.filter((r) => String(r?.pid) === String(pid));
  if (mine.length === 0) return no("no Grok Build session for this process");
  if (mine.length > 1) return no("this Grok Build has several sessions (after /new): can't tell which is shown");
  const r = mine[0];
  if (!isUuid(r.session_id) || typeof r.cwd !== "string") return no("the Grok Build session row is unreadable");
  const startOk = typeof r.pid_start === "number" && startEpochMs != null && Math.abs(r.pid_start / 1000 - startEpochMs) < 1500;
  if (!startOk) return no("the Grok Build row belongs to an earlier process with this pid");
  return yes({ kind: "grok", session: r.session_id, path: `${home}/.grok/sessions/${encodeURIComponent(r.cwd)}/${r.session_id}/updates.jsonl`, cwd: r.cwd });
}

// Hermes 0.23.0 writes no pid lease: runtime/active_sessions.json stays `{"entries": []}` with live chats (qa-modpack's
// capture, 2026-11-09). It names the live session of a process's controlling terminal in
// <HERMES_HOME>/terminal-sessions/tty-dev-<tty> = {session_id, cwd, ts}, written again whenever that session changes
// (hermes-agent@2bd378ed1b8d hermes_cli/terminal_breadcrumbs.py:32-78). Rules from qa-modpack's adapters/hermes.js.
export const breadcrumbPath = (home, tty) => `${home}/.hermes/terminal-sessions/tty-dev-${String(tty).replace(/[^A-Za-z0-9._-]/g, "-")}`;

const sameDir = (a, b) => {
  const norm = (p) => String(p ?? "").replace(/\/+$/, "").replace(/^\/private(\/|$)/, "/");
  return norm(a) !== "" && norm(a) === norm(b);
};

// A tty name comes back with every new terminal, so the record binds only for a live process (F4: ps's start) when
// written after that process started (ps gives whole seconds, so not before its start's second) and for this
// terminal's folder. Anything else binds nothing.
export function bindHermesBreadcrumb({ pid, tty, startEpochMs, cwd, breadcrumbText }) {
  if (!pid) return no("no foreground process");
  if (startEpochMs == null) return no("the Hermes process is gone");
  if (!tty) return no("this Hermes has no terminal device");
  if (breadcrumbText == null) return no("Hermes has not recorded this terminal's session yet (it does when the chat opens)");
  const b = parse(breadcrumbText);
  if (!b || typeof b.session_id !== "string" || !b.session_id.trim()) return no("the Hermes terminal record is unreadable");
  if (typeof b.ts !== "number" || !Number.isFinite(b.ts)) return no("the Hermes terminal record has no time");
  if (b.ts * 1000 < startEpochMs) return no("the Hermes terminal record belongs to an earlier process on this terminal");
  if (typeof b.cwd !== "string" || !sameDir(b.cwd, cwd)) return no("the Hermes terminal record is for another folder");
  return yes({ kind: "hermes", session: b.session_id, store: "hermes", path: null, cwd: b.cwd });
}

// OpenCode: only an id given at launch (`-s ses_...`) names a process's session.
export function bindOpenCode({ argv }) {
  const a = argv ?? [];
  const i = a.findIndex((x) => x === "-s" || x === "--session");
  const id = i >= 0 ? a[i + 1] : a.find((x) => x.startsWith("--session="))?.slice(10);
  if (!id || !/^ses_[A-Za-z0-9]+$/.test(id)) return no("OpenCode names its session only when started with -s");
  return yes({ kind: "opencode", session: id, store: "opencode" });
}

// Pi and Oh My Pi: Heeler's Pi extension writes label heeler.session = {session, file, pid, start}.
export function bindPi({ home, pid, start, labels }) {
  const v = parse(labels?.["heeler.session"] ?? "");
  if (!v) return no("Pi names its session only through an extension label (heeler.session)");
  if (String(v.pid) !== String(pid) || !start || v.start !== start) return no("the Pi session label belongs to another process");
  const roots = [`${home}/.pi/agent/sessions/`, `${home}/.omp/agent/sessions/`];
  if (typeof v.file !== "string" || !roots.some((r) => v.file.startsWith(r)) || v.file.includes("/../")) return no("the Pi session file is outside Pi's sessions folder");
  return yes({ kind: "pi", session: String(v.session), path: v.file });
}

// Kimi Code and Gemini CLI file sessions under names a reader can only find by listing folders.
export const bindKimi = () => no("Kimi Code's session folder can't be found without listing its sessions");
export const bindGemini = () => no("Gemini CLI's session file can't be found without listing its chats folder");

// A binding stays valid only for the same process and the same session (M4): drop it when either changes.
export function sameBinding(a, b) {
  return Boolean(a && b && a.pid === b.pid && a.start === b.start && a.session === b.session && a.path === b.path);
}

// macOS `ps -o lstart` in C/UTC ("Sun Nov  8 22:31:05 2026") to epoch ms.
export function lstartMs(text) {
  const m = /^\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})$/.exec(String(text ?? "").trim());
  if (!m) return null;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mon = months.indexOf(m[1]);
  if (mon < 0) return null;
  return Date.UTC(Number(m[6]), mon, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
}
