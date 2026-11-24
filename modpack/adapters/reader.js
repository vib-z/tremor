// Where a transcript read continues: a byte cursor over whole lines, with the file's identity, so an append
// is read on, and a rewrite, a replacement or a shrink starts the thread over (M8). Pure: the helper's
// answers in, the next request out. The first read starts TAIL bytes back from the end, so a long session
// opens at once and says that earlier messages were not loaded.

export const TAIL = 2 * 1024 * 1024;
export const STEP = 512 * 1024;
export const HEAD = 4096;

export class Cursor {
  // `tail`: how far back from the end the first read starts.
  constructor(tail = TAIL) {
    this.tail = tail;
    this.reset();
  }

  reset() {
    this.offset = null;
    this.dev = null;
    this.ino = null;
    this.head = null;
    this.headLen = HEAD;
  }

  // Arguments for `helper read PATH OFFSET MAX ALIGN HEADLEN`.
  request() {
    return this.offset == null ? { offset: -this.tail, max: STEP, align: 1, headLen: HEAD } : { offset: this.offset, max: STEP, align: 0, headLen: this.headLen };
  }

  // Where it stands, to go back to when what an answer brought is not applied (see undo).
  mark() {
    return { offset: this.offset, dev: this.dev, ino: this.ino, head: this.head, headLen: this.headLen };
  }

  // Back to `m`, where it stood before an answer whose lines were not applied.
  undo(m) {
    Object.assign(this, m);
  }

  // {lines, skipped, cut, more} for new lines; {reset: true} when the file is not the one we were reading.
  accept(r) {
    if (!r || r.error) return { error: r?.error ?? "no answer" };
    if (r.missing) {
      const had = this.offset != null;
      this.reset();
      return { missing: true, reset: had, lines: [] };
    }
    const fresh = this.offset == null;
    if (!fresh && (r.dev !== this.dev || r.ino !== this.ino || r.head !== this.head || r.headLen !== this.headLen || r.shrunk || r.size < this.offset)) {
      this.reset();
      return { reset: true, lines: [] };
    }
    if (fresh) {
      this.dev = r.dev;
      this.ino = r.ino;
      this.head = r.head;
      this.headLen = r.headLen;
    }
    this.offset = r.next;
    return { lines: r.lines ?? [], skipped: r.skipped ?? [], cut: fresh && r.start > 0, more: !r.eof, reset: false };
  }
}

// Rows of a SQLite store, by the last id or seq seen.
export class RowCursor {
  constructor() {
    this.after = 0;
  }

  accept(r) {
    if (!r || r.error) return { error: r?.error ?? "no answer" };
    if (r.missing) return { missing: true, rows: [] };
    const rows = (r.rows ?? []).filter((row) => (row.id ?? row.seq) != null);
    this.after = r.next ?? this.after;
    return { rows, more: Boolean(r.more), snapshot: Boolean(r.snapshot) };
  }
}

// Whether an answer that arrives after an await may still be used (review F5): the chat reads a transcript only
// while it is shown, for the target it was asked for. Every change of either (a hide, a show, a new target)
// starts a new generation; a read carries the token it started with and is dropped if the token went stale or
// the chat is hidden now, so a hide and show of the same target in between drops it too.
export class ViewGate {
  constructor() {
    this.gen = 0;
    this.shown = false;
    this.target = null;
  }

  observe(shown, target) {
    if (shown !== this.shown || target !== this.target) {
      this.gen++;
      this.shown = shown;
      this.target = target;
    }
    return this.gen;
  }

  // A token for a read that starts now, or null when nothing may be read.
  start(shown, target) {
    this.observe(shown, target);
    return shown && target ? this.gen : null;
  }

  valid(token, shown, target) {
    this.observe(shown, target);
    return token != null && token === this.gen && shown;
  }
}
