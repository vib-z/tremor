// What the composer may do for an agent's raw Core status (D14, D35, plan R6): send guarded by Core's
// `--if` with that exact status when it is idle or working, unguarded when it finished, errored or reports
// nothing, and never while it is blocked (the person answers in the terminal). Never forced, never retried.
export function composerAction(raw) {
  if (raw === "blocked") return { send: false, reason: "It is waiting for you: answer in the terminal" };
  if (raw === "idle" || raw === "working") return { send: true, guard: raw };
  return { send: true, guard: null };
}

// The exact hc arguments for a send; null when nothing may be sent.
export function sendArgs(address, text, raw) {
  const a = composerAction(raw);
  const body = String(text ?? "").trim();
  if (!a.send || !body || !address) return null;
  return ["send", address, body, ...(a.guard ? ["--if", a.guard] : []), "--json"];
}

// A send's outcome from hc's exit and output: sent, or not sent with the reason. No retry either way.
export function sendOutcome(r) {
  if (r && r.code === 0) return { sent: true };
  let reason = (r?.stderr || r?.stdout || "").trim();
  try { reason = JSON.parse(reason)?.error?.message ?? JSON.parse(reason)?.error ?? reason; } catch { /* plain text */ }
  return { sent: false, reason: reason || "herdr-core did not take it" };
}

// The line under the composer: empty while a message can be sent (owner, 11 Nov 2026), the reason when it can't.
// The send guards above are unchanged.
export function composerHint(raw) {
  const a = composerAction(raw);
  return a.send ? "" : a.reason;
}

// Drafts belong to one agent's session (PM review R1): the text and folders typed for A stay with A while B is shown,
// and a send that finishes later clears only its own draft, and only if nobody changed it since. Keys are a
// machine-qualified terminal address with its bound session (lib/sessions.js), else its process.
export const draftKey = (address, session, pid) => (address ? `${address}|${session ? `s:${session}` : `p:${pid ?? "?"}`}` : null);
const EMPTY = Object.freeze({ text: "", attach: [] });
const blank = (d) => !d || (!String(d.text ?? "").trim() && !(d.attach ?? []).length);
const same = (a, b) => String(a?.text ?? "") === String(b?.text ?? "") && JSON.stringify(a?.attach ?? []) === JSON.stringify(b?.attach ?? []);

// Attachments are absolute paths on the originating agent's machine. No file contents are read or copied.
export const ATTACH_MAX = 16, ATTACH_PATH_MAX = 4096, ATTACH_CHARS_MAX = 16384;
export function boundedAttachments(paths) {
  if (!Array.isArray(paths) || paths.length > ATTACH_MAX) return null;
  const unique = [...new Set(paths)];
  if (unique.some(p => typeof p !== "string" || !p.startsWith("/") || p.length > ATTACH_PATH_MAX || /[\x00-\x1f\x7f]/.test(p))) return null;
  return unique.join("").length <= ATTACH_CHARS_MAX ? unique : null;
}
export function filesResult(request, result) {
  if (!request || result?.id !== request.id || result.on !== request.on || result.origin?.key !== request.origin?.key || result.origin?.gen !== request.origin?.gen) return null;
  const paths = boundedAttachments(result.paths); // any folder on the request's machine (the browser goes up)
  return paths?.length && paths.every(p => !p.split("/").includes("..")) ? paths : null;
}

export class Drafts {
  constructor() {
    this.kept = new Map(); // key -> {text, attach}: the drafts not shown
    this.notes = new Map(); // key -> the last failed send's words
    this.gens = new Map(); // key -> generation, bumped when the draft is cleared or its session restarts
    this.shown = { key: null, attach: [] }; // the shown draft's chips live here, so a late result can reach them
    this.moved = new Map(); // a process key -> the session key its draft carried over to
  }

  gen(key) {
    return this.gens.get(key) ?? 0;
  }

  // A new generation for `key` and the process key that carried over to it: earlier tokens are void.
  bump(key) {
    for (const k of [key, ...[...this.moved].filter(([, to]) => to === key).map(([from]) => from)]) this.gens.set(k, this.gen(k) + 1);
  }

  // The draft `key` can't take a delayed result any more: its session restarted, or it was cleared by a send.
  retire(key) {
    if (!key) return;
    this.bump(key);
    this.kept.delete(key);
  }

  // The draft that opened a picker, switcher or any other delayed request (audit H2, H3; Files attach, request 27):
  // a token naming it and its generation now. Null without a draft.
  origin(key) {
    return key ? { key, gen: this.gen(key) } : null;
  }

  // A delayed result's chips go to the draft that asked, never to the one shown now: only while that draft still
  // has the token's generation (shown, or kept for later), each path once. False, and nothing added, otherwise.
  attachTo(origin, paths) {
    if (!origin?.key || this.gen(origin.key) !== origin.gen) return false;
    const key = this.moved.get(origin.key) ?? origin.key; // asked before the binding arrived: its session's draft
    let list = this.shown.key === key ? this.shown.attach : this.kept.get(key)?.attach;
    const picked = boundedAttachments(paths);
    if (!picked) return false;
    const next = boundedAttachments([...new Set([...(list ?? []), ...picked])]);
    if (!next) return false;
    if (!list) { list = []; this.kept.set(key, { text: "", attach: list }); }
    list.splice(0, list.length, ...next);
    return true;
  }

  // Leave `from` with what is typed now and take up `to`'s draft. A process's key turning into its session's key
  // (the binding arrived) carries the draft over. Another key on the same terminal is a restarted session: the old
  // draft retires, so nothing late lands in it.
  swap(from, current, to) {
    if (from === to) return current;
    // Returning after focus moved first gives a provisional process key. A positively different pid
    // retires the previous session; an unknown pid does not erase a kept draft on uncertainty.
    if (to?.includes("|p:") && !to.endsWith("|p:?")) {
      const address = to.split("|")[0];
      for (const [process, session] of this.moved) if (process.startsWith(address+"|p:") && process !== to && !process.endsWith("|p:?")) this.retire(session);
    }
    const carried = from && to && from.startsWith(to.split("|")[0] + "|p:") && to.includes("|s:");
    if (carried) {
      const oldSession = this.moved.get(from);
      if (oldSession && oldSession !== to) this.retire(oldSession);
      const kept = this.kept.get(to);
      const attach = boundedAttachments([...new Set([...(kept?.attach ?? []), ...current.attach])]);
      const draft = { text: current.text || kept?.text || "", attach: attach ?? kept?.attach ?? current.attach };
      this.kept.delete(from); this.kept.delete(to);
      if (this.notes.has(from)) { this.notes.set(to, this.notes.get(from)); this.notes.delete(from); }
      if (!attach) this.notes.set(to, "Some files were not attached: the draft attachment limit was reached.");
      this.moved.set(from, to);
      this.shown = { key: to, attach: draft.attach };
      return draft;
    }
    if (from && to && from.split("|")[0] === to.split("|")[0]) this.retire(from);
    else if (from) { if (blank(current)) this.kept.delete(from); else this.kept.set(from, { text: current.text, attach: [...current.attach] }); }
    const next = this.kept.get(to);
    this.kept.delete(to);
    const draft = next ? { text: next.text, attach: [...next.attach] } : { ...EMPTY, attach: [] };
    this.shown = { key: to, attach: draft.attach };
    return draft;
  }

  // A send from `origin` finished. `sent` is the draft as it was sent; `currentKey`/`current` what is shown now.
  // Returns whether the shown composer should be cleared. A failure keeps the draft and notes why, for its origin.
  // A cleared draft retires its generation: a picker opened before the send adds nothing to the next message.
  finished(origin, sent, ok, reason, currentKey, current) {
    if (!ok) { this.notes.set(origin, reason); return false; }
    this.notes.delete(origin);
    if (origin === currentKey) {
      if (!same(sent, current)) return false;
      this.bump(origin);
      return true;
    }
    if (same(this.kept.get(origin), sent)) this.retire(origin);
    return false;
  }

  note(key) {
    return this.notes.get(key) ?? null;
  }
}

// When a finished turn may be marked seen (PM review R2, audit H4; Herdr's docs/labels.md: herdr.seen is raised by a
// client in which a person has actually read the turn). Only for the bound session's chat, shown in a window in
// front, when what was drawn in view is a record this very turn wrote: Core's `turn` rises each time a status leaves
// working, so every record turn N wrote comes after any status time Core gave while `turn` was N-1. The gate keeps
// that time per terminal (observe); the drawn answer must be newer than it and no newer than the turn's end
// (status_ms), and the read it came from must have caught up after that end. Any of that unknown or not matching
// (turn N-1 never seen, an unchanged old answer, a render with the newest rows out of view): the turn stays unread.
// The latch is set only once the label write succeeded, and only for the visit that asked; a failed write is tried
// again after SEEN_RETRY_MS; leaving the chat ends the visit.
export const SEEN_RETRY_MS = 5000;
const SKEW_MS = 2000; // the transcript's clock against Core's, on one machine
export class SeenGate {
  constructor() {
    this.visits = 0;
    this.turns = new Map(); // address -> {turn, ms, prev: {turn, ms}}: the latest status time Core gave per turn value
    this.leave();
  }

  // Core's terminal records ({address, turn, status_ms}), as often as the chat sees them, for every terminal: a turn
  // that ends while its chat shows another agent still has its start. ponytail: one small entry per terminal ever seen.
  observe(list) {
    for (const t of list ?? []) {
      if (!t?.address || !Number.isInteger(t.turn) || !Number.isFinite(t.status_ms)) continue;
      const o = this.turns.get(t.address);
      if (!o || t.turn < o.turn) this.turns.set(t.address, { turn: t.turn, ms: t.status_ms, prev: null });
      else if (t.turn === o.turn) o.ms = Math.max(o.ms, t.status_ms);
      else this.turns.set(t.address, { turn: t.turn, ms: t.status_ms, prev: t.turn === o.turn + 1 ? { turn: o.turn, ms: o.ms } : null });
    }
  }

  // The latest status time Core gave while `turn` was turn-1, or null if the gate never saw it.
  floor(address, turn) {
    const o = this.turns.get(address);
    return o?.turn === turn - 1 ? o.ms : o?.prev?.turn === turn - 1 ? o.prev.ms : null;
  }

  leave() {
    this.visits++; // a result from before this belongs to no one now
    this.visit = null;
    this.since = null; // when this visit began: a render from before it doesn't count
    this.written = null;
    this.pending = false;
    this.failedAt = null;
  }

  // facts: {address, session, turn, seen, shown, foreground, endedAt (status_ms), drawn: {at, answerAt, readAt} (when
  // a render with the newest rows in view ran, the newest agent record it showed, and when the read it came from
  // caught up), now}. A token {turn, visit} for the label write, or null.
  decide(f) {
    if (f.address && f.endedAt != null) this.observe([{ address: f.address, turn: f.turn, status_ms: f.endedAt }]);
    if (!f.shown || !f.foreground || !f.address || !f.session) return null;
    const visit = `${f.address}|${f.session}`;
    if (this.visit !== visit) { this.leave(); this.visit = visit; this.since = f.now; }
    if (!(f.turn > f.seen)) return null;
    if (!(f.drawn?.at >= this.since)) return null; // drawn during this visit
    const answerAt = f.drawn?.answerAt, readAt = f.drawn?.readAt, endedAt = f.endedAt;
    if (endedAt == null || answerAt == null || readAt == null) return null;
    const floor = this.floor(f.address, f.turn);
    if (floor == null) return null; // when this turn began is unknown
    if (!(answerAt > floor + SKEW_MS) || answerAt > endedAt + SKEW_MS) return null; // not a record this turn wrote
    if (!(readAt > endedAt)) return null; // drawn from a read that may predate the turn's end
    if (this.pending || this.written === f.turn) return null;
    if (this.failedAt != null && f.now - this.failedAt < SEEN_RETRY_MS) return null;
    this.pending = true;
    return { turn: f.turn, visit: this.visits };
  }

  result(token, ok, now) {
    if (token?.visit !== this.visits) return; // another visit's write finishing late changes nothing here
    this.pending = false;
    if (ok) { this.written = token.turn; this.failedAt = null; } else this.failedAt = now;
  }
}

// A sent message shows at once (owner, 11 Nov 2026: "a sent message shows at once"): after Core accepts it, as the
// last user row, dim and marked "Sending…", until the transcript records a user entry with the same text (trimmed;
// a "/" command is recorded by its name) beyond those it had when sent, or PENDING_MS pass.
export const PENDING_MS = 15000;
const sentKey = (text) => { const t = String(text ?? "").trim(); return /^\/\S+/.exec(t)?.[0] ?? t; };
const recorded = (entries, key) => (entries ?? []).filter((e) => e.type === "user" && sentKey(e.text) === key).length;
export const pendingSend = (text, entries, now) => ({ text: String(text ?? "").trim(), key: sentKey(text), base: recorded(entries, sentKey(text)), at: now });
export const stillPending = (p, entries, now) => now - p.at < PENDING_MS && recorded(entries, p.key) <= p.base;
