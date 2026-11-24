// One agent's conversation, kept live from its own session file (owner, 11 Nov 2026: chat per tab and per agent, on
// this Mac and on machines reached over ssh). A small state machine over an injected transport, so it is the same
// here and on another machine, and can be tested with no process and no clock.
//
// A view keeps one Feed per agent it shows and calls step() from its one-second loop. A Feed never sleeps and never
// starts work by itself: step() starts at most one runner (one helper call, or a few pages while catching up) and
// returns its promise, which resolves true when something the view draws changed; null when a runner is in flight,
// the chat is hidden or nothing is due. Nothing is read while hidden (plan M5).
//
// The transport: call(command, request, { on, timeout }) -> Promise<reply>. It rejects with an Error when the helper
// cannot answer; the Error's `offline` is true when the machine itself could not be reached.
//   "probe" { kind, pid }
//     -> claude { home, start, registryText }     start: `ps -o lstart=` in C and UTC, null when the process is gone
//     -> codex  { home, start, held, heads, stats } held: files it holds under ~/.codex (null: unreadable); heads:
//                                                 the first line of each held rollout; stats: each one's {size,
//                                                 mtimeMs}; start: null when the process changed while its files
//                                                 were read
//   "slim"  { kind, pid, procStart, session, path, offset, marks?, roots? } -> { record } | { rebind: true }: one line
//        too long for a tail, its image payloads emptied (sizes kept), under the tail's proof
//   "tail"  { kind, pid, procStart, session, path, offset, max, align, headLen, wait, marks? }
//        `marks` (Codex): the rollouts and thread locks it held when bound (codexMarks); a change answers rebind.
//        `roots` (Codex, bound among several held conversations): `path` must still be the one written last.
//     -> the helper's `read` answer { dev, ino, size, head, headLen, start, next, eof, lines, skipped, missing?, shrunk? }
//        `wait` (ms): with nothing new to give, the transport may hold the answer that long for the file to grow.
//        `proved: true`: this answer checked the process and its session itself, so the Feed asks no probe between
//        tails. `rebind: true` (no lines): the process or its session is no longer the one named; prove it again.
// The session is decided here, from that evidence only, by adapters/binding.js: never the newest file, never a guess.
//
// What a view reads (and never writes):
//   state       "finding"  no answer about the session yet, or bound and nothing read yet
//               "unbound"  no proof this terminal owns a session: `reason` says why
//               "waiting"  bound, the session file isn't written yet (it appears with the first message)
//               "live"     bound and read
//               "offline"  the machine can't be reached: `reason`; retried at BACKOFF_MS
//               "error"    the helper refused or failed: `reason`; retried at BACKOFF_MS
//   binding     { ok, kind, pid, start, session, path, cwd, marks? } | { ok: false, reason, ... } | null
//   thread      adapters/chat.js Thread (rows() for the timeline)
//   cut         earlier messages were not loaded (a long session opens at its last TAIL bytes), or the oldest were
//               let go (a thread past THREAD_MAX entries drops its oldest third)
//   skipped     records too large to show
//   meta        { model, effort, contextPct, turn, source } from the lines read (no read of its own), or null
//   caughtUpAt  when a read last reached the end of the file (ms), 0 before
//   gen         rises whenever the conversation starts over (another process, another session, a replaced file):
//               what a view keyed to the old conversation (open rows, a draft's session) compares. It rises when the
//               new conversation takes the old one's place, not before (stale)
//   stale       the rows shown belong to the conversation before a start-over whose first read has not landed: the
//               new one is read aside and swapped in then, so what was drawn stays until there is something to draw
//               (owner, 12 Nov 2026: "the chat disappears")
//
// A first read is the last FIRST bytes, drawn at once; the last TAIL bytes are then read aside and take its place with
// the same gen, so its rows keep their keys and what a person opened stays open. One failed proof of a bound session
// is asked again after IDLE_MS; only a second failure in a row unbinds, and the thread stays either way.

import { Thread, parseLines, feed as feedThread, MAPPERS } from "./chat.js";
import { Cursor, TAIL } from "./reader.js";
import { bindClaude, bindCodex } from "./binding.js";
import { metaFromRecords, metaKeep, META_SOURCE } from "./meta.js";
import { addSlimmed } from "./media.js";

export const WAIT_MS = 10000; // how long one tail may wait for the file to grow
export const IDLE_MS = 1000; // the least time between the starts of two tails when the first brought nothing
export const REPROBE_MS = 5000; // an unbound terminal, or a bound one whose tails don't prove themselves, is asked again
export const BACKOFF_MS = [2000, 5000, 10000, 20000];
export const STUCK_MS = 45000; // a runner silent this long is given up; its late answer is dropped
export const PAGES = 4; // pages one runner reads while catching up
export const THREAD_MAX = 3000; // entries a thread keeps before its oldest third goes
export const FIRST = 128 * 1024; // a first read: drawn at once, then the full TAIL replaces it (measured: 45 ms sooner than 256 KB)
const CALL_SLACK_MS = 15000;

const DECIDE = {
  claude: (ev, pid) => bindClaude({ home: ev.home, pid, start: ev.start ?? null, registryText: ev.registryText ?? null }),
  codex: (ev, _pid, argv) => {
    if (!ev.start) return { ok: false, reason: "the Codex process changed while its files were read" };
    const b = bindCodex({ home: ev.home, argv, held: ev.held ?? null, heads: ev.heads ?? {}, stats: ev.stats ?? {} });
    return b.ok ? { ...b, marks: codexMarks(ev.home, ev.held) } : b;
  },
};

// The held files a Codex binding was decided on: its rollouts and thread locks, under ~/.codex. A tail answers rebind
// when they change (a /clear takes a new thread's lock while the old rollout is still held: Codex 0.167.0).
export const codexMarks = (home, held) => {
  const root = `${home}/.codex/`;
  return (held ?? []).filter((f) => f.startsWith(root)).map((f) => f.slice(root.length))
    .filter((r) => (/^(archived_)?sessions\//.test(r) && r.endsWith(".jsonl")) || r.startsWith("thread-writer-locks/")).sort();
};

// Records from one accepted answer. A line too long for it (a pasted screenshot) is asked for again through the
// transport's `slim`, under the same proof (review R5): its record with the image payloads emptied, so its text shows
// and its image loads as an inline preview; at most MAX_SLIM per answer, the rest count as `unread`. A view may pass
// its own (the chat's media reader slims long local lines through the local helper).

export const feedSupports = (kind) => Boolean(DECIDE[kind] && MAPPERS[kind]);

// What one conversation's read holds. A Feed shows one, and reads another aside (`next`) to swap in.
const conversation = (tail) => ({ thread: new Thread(), mapState: {}, cursor: new Cursor(tail), cut: false, skipped: 0, meta: null, metaRecs: [] });
const HELD = ["thread", "mapState", "cursor", "cut", "skipped", "meta", "metaRecs"];

export class Feed {
  constructor({ address, kind, on = null, call, now = Date.now, records = null }) {
    Object.assign(this, { address, kind, on, call, now, records: records ?? ((path, got, live) => this.slimmedRecords(path, got, live)) });
    this.gen = 0;
    this.binding = null;
    this.state = "finding";
    this.reason = null;
    this.running = null;
    this.runSeq = 0;
    this.runningSince = 0;
    this.retryAt = 0;
    this.probeAt = 0;
    this.tailAt = 0;
    this.fails = 0;
    this.forceProbe = false;
    this.selfProving = false;
    this.closed = false;
    this.missed = false; // the last proof of a bound session failed once
    this.next = null; // the conversation read aside: { ...conversation, fill } (fill: the full tail of the one shown)
    this.startOver();
  }

  // The conversation starts over: it is read from its file's tail aside and swapped in once that first read lands,
  // so what is drawn stays until then. With nothing drawn there is nothing to keep, and it starts at once.
  // metaRecs: the few records meta is read from (adapters/meta.js metaKeep).
  startOver() {
    this.caughtUp = false;
    this.caughtUpAt = 0;
    this.fillDue = false;
    if (this.thread?.entries.length) { this.next = { ...conversation(FIRST), fill: false }; return; }
    this.next = null;
    Object.assign(this, conversation(FIRST));
    this.gen++;
  }

  get stale() {
    return Boolean(this.next && !this.next.fill) && this.state !== "unbound";
  }

  // The conversation read aside takes the shown one's place: a new one with a new gen, a full tail with the same.
  swap() {
    const n = this.next;
    this.next = null;
    for (const k of HELD) this[k] = n[k];
    if (!n.fill) this.gen++;
  }

  // Prove the session again at the next step (after a sent /clear, /new or /resume, or its machine back), with the
  // backoff from its first step: a machine just back may fail once more while its link settles.
  kick() {
    this.forceProbe = true;
    this.retryAt = 0;
    this.fails = 0;
  }

  // Dropped by its view: nothing more starts and a late answer changes nothing.
  close() {
    this.closed = true;
    this.runSeq++;
    this.running = null;
  }

  // `shown`: whether the view shows this feed, a boolean or a function asked again before each call of the runner and
  // before its answer is taken, so nothing is read once the view is hidden or shows another agent.
  step(terminal, { shown = true } = {}) {
    const showing = typeof shown === "function" ? shown : () => shown;
    if (this.closed || !showing() || !feedSupports(this.kind)) return null;
    const now = this.now();
    const pid = terminal?.foreground?.pid ?? null;
    // Another process in this terminal: whatever was bound or in flight was about the old one.
    if (this.binding && this.binding.pid !== pid) {
      if (this.binding.ok) this.startOver();
      this.binding = null;
      this.missed = false;
      this.state = "finding";
      this.reason = null;
      this.runSeq++;
      this.running = null;
      this.retryAt = 0;
    }
    if (this.running) {
      if (now - this.runningSince < STUCK_MS) return null;
      this.runSeq++; // given up
      this.running = null;
    }
    if (now < this.retryAt) return null;
    const bound = Boolean(this.binding?.ok);
    const probe = this.forceProbe || !this.binding || (now >= this.probeAt && (!bound || !this.selfProving));
    if (!probe && (!bound || now < this.tailAt)) return null;
    const token = ++this.runSeq;
    const current = () => token === this.runSeq && !this.closed; // this runner is still the feed's own
    const live = Object.assign(() => current() && showing(), { current });
    this.runningSince = now;
    const run = (async () => {
      try {
        let changed = probe ? await this.probe(terminal, pid, live) : await this.tail(live);
        // A proof that binds goes straight on to its first read, in this runner: nothing waits for the next step.
        if (probe && live() && this.binding?.ok && !this.forceProbe && (["finding", "offline", "error"].includes(this.state) || this.next)) changed = (await this.tail(live)) || changed;
        if (live()) this.fails = 0;
        return changed;
      } catch (e) {
        if (!live()) return false;
        this.state = e?.offline ? "offline" : "error";
        this.reason = String(e?.message ?? e);
        this.forceProbe = true; // back again, the session is proven before anything more is read
        this.retryAt = this.now() + BACKOFF_MS[Math.min(this.fails++, BACKOFF_MS.length - 1)];
        return true;
      } finally {
        if (token === this.runSeq) this.running = null;
      }
    })();
    this.running = run;
    return run;
  }

  async probe(terminal, pid, live) {
    this.forceProbe = false;
    const before = `${this.state}|${this.reason}|${this.gen}`;
    const tag = (b, start = null) => ({ ...b, kind: this.kind, pid, start });
    let b;
    if (!pid) b = tag({ ok: false, reason: "no foreground process" });
    else {
      const ev = (await this.call("probe", { kind: this.kind, pid }, { on: this.on, timeout: CALL_SLACK_MS })) ?? {};
      if (!live()) return false;
      b = tag(DECIDE[this.kind](ev, pid, terminal?.foreground?.argv ?? []), ev.start ?? null);
    }
    const had = this.binding;
    // A bound session's proof failing once (a registry mid-rewrite, a slow answer) is asked again soon; only a second
    // failure in a row unbinds. The thread is never dropped for a failed proof.
    if (had?.ok && !b.ok && !this.missed) { this.missed = true; this.probeAt = this.now() + IDLE_MS; return false; }
    this.missed = false;
    const same = Boolean(had?.ok && b.ok && had.session === b.session && had.path === b.path && had.start === b.start);
    if (had?.ok && b.ok && !same) this.startOver(); // another session or process: the conversation starts over
    this.binding = b;
    this.probeAt = this.now() + REPROBE_MS;
    if (!b.ok) { this.state = "unbound"; this.reason = b.reason; }
    else if (!same || this.state === "offline" || this.state === "error") {
      // After a failure the state a person sees stays, with its reason, until a read lands (no flip to loading between tries).
      if (this.state !== "offline" && this.state !== "error") { this.state = this.caughtUpAt ? "live" : "finding"; this.reason = null; }
      this.tailAt = 0;
    }
    return before !== `${this.state}|${this.reason}|${this.gen}`;
  }

  async tail(live) {
    const b = this.binding;
    let changed = false;
    for (let page = 0; page < PAGES; page++) {
      const c = this.next ?? this; // the conversation being read: the one aside, else the one shown
      const q = c.cursor.request();
      // Caught up, or a session file not written yet: the helper may hold the answer until the file grows or appears.
      // Not after a failure: that state stays on screen until this answer, which must not wait for new lines.
      const wait = !this.next && ((this.caughtUp && this.state === "live") || this.state === "waiting") ? WAIT_MS : 0;
      const started = this.now();
      const r = await this.call("tail", { kind: b.kind, pid: b.pid, procStart: b.start, session: b.session, path: b.path, ...q, wait, ...(b.marks ? { marks: b.marks } : {}), ...(b.roots ? { roots: b.roots } : {}) },
        { on: this.on, timeout: wait + CALL_SLACK_MS });
      if (!live()) return changed;
      if (r?.rebind) { this.forceProbe = true; return changed; }
      // A Codex binding picked among several held conversations (binding `roots`) is proven again every REPROBE_MS
      // whatever its tails say: which one is current can change with no change in what is held.
      this.selfProving = r?.proved === true && !b.roots;
      const cursor = c.cursor;
      const mark = cursor.mark();
      const got = cursor.accept(r);
      if (got.error) throw new Error(got.error);
      if (got.reset) { // the file is not the one being read: a rewrite, a replacement, a shrink
        this.startOver();
        changed = true;
        if (!got.missing) continue;
      }
      if (got.missing) {
        if (this.next) { this.swap(); changed = true; } // the new conversation has no file yet: it is the empty one
        if (this.state !== "waiting") changed = true;
        this.state = "waiting";
        this.reason = null;
        this.tailAt = started + IDLE_MS;
        return changed;
      }
      if (got.cut) c.cut = true;
      // A short first read with the full one to come draws now: its lines too long for a tail are slimmed then.
      const later = got.cut && c.cursor.tail < TAIL;
      const recs = await this.records(b.path, later ? { ...got, skipped: [] } : got, live);
      // Moving the cursor and applying its records are one step: dropped because Chat was hidden, the cursor it moved
      // goes back. A runner replaced meanwhile (another process, a start-over, given up) touches no cursor.
      if (!live()) { if (live.current?.()) cursor.undo(mark); return changed; }
      c.skipped += recs.unread ?? 0;
      if (recs.length || recs.unread) {
        feedThread(c.thread, b.kind, recs, c.mapState);
        if (c.thread.trim(THREAD_MAX)) c.cut = true;
        this.takeMeta(c, recs);
        changed = true;
      }
      // A short first read that drew nothing (its window inside one long record) proves nothing: the full tail is read
      // now, in this runner, before anything is swapped in or called live.
      if (later && !c.thread.entries.length) { c.cursor = new Cursor(TAIL); c.cut = false; continue; }
      // A short first read that left earlier lines out: the full tail is read aside once this one is caught up.
      if (later) this.fillDue = true;
      // A new conversation's first read landed, or the full tail reached the end: it takes the shown one's place.
      if (this.next && (!this.next.fill || !got.more)) { this.swap(); changed = true; }
      if (this.state !== "live") { this.state = "live"; this.reason = null; changed = true; }
      this.caughtUp = !got.more;
      if (!got.more) {
        if (!this.caughtUpAt) changed = true;
        this.caughtUpAt = this.now();
        if (!got.lines.length) this.tailAt = started + IDLE_MS;
        break;
      }
    }
    if (this.fillDue && !this.next && this.caughtUp) { this.fillDue = false; this.next = { ...conversation(TAIL), fill: true }; this.tailAt = 0; }
    return changed;
  }

  slimmedRecords(path, got, live) {
    const b = this.binding;
    const recs = parseLines(got.lines ?? []).map((r) => ({ ...r, path }));
    const ask = (p, offset) => this.call("slim", { kind: b.kind, pid: b.pid, procStart: b.start, session: b.session, path: p, offset,
      ...(b.marks ? { marks: b.marks } : {}), ...(b.roots ? { roots: b.roots } : {}) }, { on: this.on, timeout: CALL_SLACK_MS });
    return addSlimmed(recs, got.skipped, path, live, ask);
  }

  // meta from the records just read, folded into the few kept from before: a first read of a long file fills it when
  // its lines hold it, and nothing is read for it alone.
  takeMeta(c, recs) {
    if (!META_SOURCE[this.kind]) return false;
    c.metaRecs = metaKeep(this.kind, c.metaRecs, recs);
    const m = c.metaRecs.length ? { ...metaFromRecords(this.kind, c.metaRecs), source: META_SOURCE[this.kind] } : null;
    if (JSON.stringify(m) === JSON.stringify(c.meta)) return false;
    c.meta = m;
    return true;
  }
}
