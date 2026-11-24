// Persistence, one transaction model (spec section 4, D15): the CoreInput log plus atomic checkpoints.
//
// Files in `dir`:
//   log-<gen>.jsonl         a header line {tremor: "log", version, generation}, then one CoreInput per line
//   checkpoint-<gen>.json   {tremor: "checkpoint", version, generation, offset, state}: `state` holds every
//                           input of log <gen> up to byte `offset`, and of every earlier log
// A checkpoint is taken at the end of its log, which then rotates: later inputs go to log <gen+1>.
// Order: flush the log through the offset, write the checkpoint to a temporary file, flush, rename, flush
// the folder. The newest checkpoint and two previous ones are kept; logs older than the oldest kept one go.

import { open, readdir, readFile, rename, rm, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import type { ActivityEvent, CoreInput, StoreState } from "@tremor/protocol";
import { applyInputs, initial, own } from "../store/engine.ts";

export const LOG_VERSION = 1;
export const CHECKPOINT_VERSION = 1;
export const RETENTION = { maxAgeMs: 14 * 24 * 60 * 60 * 1000, maxItems: 20_000 } as const;

export interface PersistOptions {
  dir: string;
  /** A batch is written at most this long after its first input. */
  flushMs?: number;
  /** Checkpoints kept: the newest and two previous. */
  keep?: number;
  retention?: { maxAgeMs: number; maxItems: number };
  now?: () => number;
}

export interface Recovery {
  /** The checkpoint recovery started from, or null (replayed the logs from the start). */
  checkpoint: number | null;
  /** Checkpoint files that could not be used. */
  badCheckpoints: number[];
  /** Inputs replayed from the logs. */
  replayed: number;
  /** Lines skipped: a truncated last line, or a line that is not JSON. */
  skippedLines: number;
  /** Set when earlier history is missing (no usable checkpoint over a log that does not start at 1, or a missing log). */
  historyGap: string | null;
}

const pad = (n: number) => String(n).padStart(8, "0");
const logName = (g: number) => `log-${pad(g)}.jsonl`;
const checkpointName = (g: number) => `checkpoint-${pad(g)}.json`;
const gens = (files: string[], re: RegExp) =>
  files
    .map((f) => re.exec(f)?.[1])
    .filter((x): x is string => x !== undefined)
    .map(Number)
    .sort((a, b) => a - b);

const isDispatched = (i: CoreInput) => i.kind === "user" && i.phase === "dispatched";

export class Persistor {
  private gen: number;
  /** Bytes appended to the current log, flushed or not (where the next line will start). */
  private logical = 0;
  private buffer: string[] = [];
  private waiting: { resolve: () => void; reject: (e: unknown) => void }[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private queue: Promise<void> = Promise.resolve();
  private handle: FileHandle | null = null;
  private readonly o: Required<PersistOptions>;

  private constructor(o: Required<PersistOptions>, gen: number) {
    this.o = o;
    this.gen = gen;
  }

  /** Recovers the state from `dir`, then starts a new log generation for appending. */
  static async open(opts: PersistOptions): Promise<{ persistor: Persistor; state: StoreState; recovery: Recovery }> {
    const o: Required<PersistOptions> = { flushMs: 100, keep: 3, retention: RETENTION, now: Date.now, ...opts };
    const { state, recovery, lastGen, gap } = await recover(o.dir, o.now);
    const p = new Persistor(o, lastGen + 1);
    p.serial(() => p.openLog(p.gen));
    p.logical = Buffer.byteLength(header(p.gen));
    await p.queue;
    // The gap is logged like any input, so every later recovery replays it.
    if (gap) await p.append(gap).then(() => p.flush());
    return { persistor: p, state, recovery };
  }

  get generation(): number {
    return this.gen;
  }

  /** Appends an input. Resolves once it is on disk; a `dispatched` input is written at once, the rest within flushMs. */
  append(input: CoreInput): Promise<void> {
    const line = `${JSON.stringify(input)}\n`;
    this.buffer.push(line);
    this.logical += Buffer.byteLength(line);
    const done = new Promise<void>((resolve, reject) => this.waiting.push({ resolve, reject }));
    if (isDispatched(input)) void this.flush().catch(() => {});
    else this.timer ??= setTimeout(() => void this.flush().catch(() => {}), this.o.flushMs);
    return done;
  }

  /** Writes and syncs everything appended so far. */
  flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    const text = this.buffer.join("");
    const waiting = this.waiting;
    this.buffer = [];
    this.waiting = [];
    return this.serial(async () => {
      if (text && this.handle) {
        await this.handle.write(text);
        await this.handle.datasync();
      }
    }).then(
      () => waiting.forEach((w) => w.resolve()),
      (e) => {
        waiting.forEach((w) => w.reject(e));
        throw e;
      },
    );
  }

  /**
   * Prunes `state` to the retention window and checkpoints it. `state` must hold every input appended so far
   * (the host applies each input to the store as it appends it). Returns the pruned state.
   */
  checkpoint(state: StoreState): Promise<StoreState> {
    const pruned = prune(state, this.o.now(), this.o.retention);
    const json = JSON.stringify({ tremor: "checkpoint", version: CHECKPOINT_VERSION, generation: this.gen, offset: this.logical, state: pruned });
    const gen = this.gen;
    const flushed = this.flush();
    // Later inputs belong to the next log, whatever the disk is still doing.
    this.gen = gen + 1;
    this.logical = Buffer.byteLength(header(this.gen));
    return flushed
      .then(() =>
        this.serial(async () => {
          await this.handle?.close();
          await this.openLog(gen + 1);
          await writeAtomic(this.o.dir, checkpointName(gen), json);
          await this.removeOld();
        }),
      )
      .then(() => pruned);
  }

  async close(): Promise<void> {
    await this.flush();
    await this.serial(async () => {
      await this.handle?.close();
      this.handle = null;
    });
  }

  private serial(op: () => Promise<void>): Promise<void> {
    const next = this.queue.then(op);
    this.queue = next.catch(() => {});
    return next;
  }

  private async openLog(gen: number): Promise<void> {
    this.handle = await open(join(this.o.dir, logName(gen)), "a");
    await this.handle.write(header(gen));
    await this.handle.datasync();
  }

  private async removeOld(): Promise<void> {
    const files = await readdir(this.o.dir);
    const cps = gens(files, /^checkpoint-(\d+)\.json$/);
    const kept = cps.slice(-this.o.keep);
    const oldest = kept[0];
    if (oldest === undefined) return;
    for (const g of cps) if (!kept.includes(g)) await rm(join(this.o.dir, checkpointName(g)), { force: true });
    for (const g of gens(files, /^log-(\d+)\.jsonl$/)) if (g < oldest) await rm(join(this.o.dir, logName(g)), { force: true });
  }
}

const header = (gen: number) => `${JSON.stringify({ tremor: "log", version: LOG_VERSION, generation: gen })}\n`;

async function writeAtomic(dir: string, name: string, text: string): Promise<void> {
  const tmp = join(dir, `${name}.tmp`);
  const h = await open(tmp, "w");
  try {
    await h.write(text);
    await h.sync();
  } finally {
    await h.close();
  }
  await rename(tmp, join(dir, name));
  try {
    const d = await open(dir, "r");
    await d.sync().finally(() => d.close());
  } catch {
    // Not every platform can sync a folder; the rename is still atomic.
  }
}

interface ParsedLog {
  inputs: CoreInput[];
  skipped: number;
  ok: boolean;
}

/** A log's inputs from byte `from`. A last line without its newline is a write the crash cut short. */
function parseLog(text: string, from: number, gen: number): ParsedLog {
  const nl = text.indexOf("\n");
  try {
    const h = JSON.parse(text.slice(0, nl)) as { tremor?: string; version?: number; generation?: number };
    if (nl < 0 || h.tremor !== "log" || h.version !== LOG_VERSION || h.generation !== gen) return { inputs: [], skipped: 0, ok: false };
  } catch {
    return { inputs: [], skipped: 0, ok: false };
  }
  const bytes = Buffer.from(text, "utf8");
  const body = bytes.subarray(Math.max(from, nl + 1)).toString("utf8");
  const lines = body.split("\n");
  const last = lines.pop() ?? "";
  let skipped = last === "" ? 0 : 1;
  const inputs: CoreInput[] = [];
  for (const l of lines) {
    if (l.trim() === "") continue;
    try {
      inputs.push(JSON.parse(l) as CoreInput);
    } catch {
      skipped++;
    }
  }
  return { inputs, skipped, ok: true };
}

function validCheckpoint(v: unknown, gen: number): v is { generation: number; offset: number; state: StoreState } {
  const c = v as { tremor?: unknown; version?: unknown; generation?: unknown; offset?: unknown; state?: Partial<StoreState> } | null;
  const s = c?.state;
  return (
    !!c &&
    c.tremor === "checkpoint" &&
    c.version === CHECKPOINT_VERSION &&
    c.generation === gen &&
    typeof c.offset === "number" &&
    !!s &&
    typeof s === "object" &&
    ["sources", "terminals", "seen", "approvals", "actions", "cursors", "docs"].every((k) => typeof (s as Record<string, unknown>)[k] === "object" && (s as Record<string, unknown>)[k] !== null) &&
    Array.isArray(s.activity)
  );
}

/**
 * Newest valid checkpoint plus the logs after it; failing that, whatever the logs still hold. When history is
 * missing, `gap` is a `history-gap` input (already applied to `state`) for the caller to append to the log.
 */
export async function recover(dir: string, now: () => number = Date.now): Promise<{ state: StoreState; recovery: Recovery; lastGen: number; gap: CoreInput | null }> {
  const files = await readdir(dir).catch(() => [] as string[]);
  const cps = gens(files, /^checkpoint-(\d+)\.json$/);
  const logs = gens(files, /^log-(\d+)\.jsonl$/);
  const recovery: Recovery = { checkpoint: null, badCheckpoints: [], replayed: 0, skippedLines: 0, historyGap: null };
  let state = initial();
  let from = { gen: logs[0] ?? 1, offset: 0 };
  for (const g of [...cps].reverse()) {
    try {
      const c: unknown = JSON.parse(await readFile(join(dir, checkpointName(g)), "utf8"));
      if (!validCheckpoint(c, g)) throw new Error("invalid");
      state = own(c.state);
      recovery.checkpoint = g;
      from = { gen: g, offset: c.offset };
      break;
    } catch {
      recovery.badCheckpoints.push(g);
    }
  }
  if (recovery.checkpoint === null) {
    if (recovery.badCheckpoints.length > 0) recovery.historyGap = "no usable checkpoint";
    else if (logs.length > 0 && logs[0] !== 1) recovery.historyGap = `logs before ${logs[0]} are gone`;
  }
  // A checkpoint sits at the end of its own log, so the next log may follow it directly.
  let next = from.gen;
  for (const g of logs.filter((x) => x >= from.gen)) {
    const inOrder = g === next || (recovery.checkpoint !== null && next === from.gen && g === from.gen + 1);
    if (!inOrder) recovery.historyGap ??= `log ${next} is missing`;
    next = g + 1;
    const parsed = parseLog(await readFile(join(dir, logName(g)), "utf8"), g === from.gen ? from.offset : 0, g);
    if (!parsed.ok) {
      recovery.historyGap ??= `log ${g} is unreadable`;
      continue;
    }
    recovery.skippedLines += parsed.skipped;
    recovery.replayed += parsed.inputs.length;
    applyInputs(state, parsed.inputs);
  }
  // Everything before now, the remaining log included, is shown as incomplete history.
  const gap: CoreInput | null = recovery.historyGap === null ? null : { t: now(), kind: "history-gap", reason: recovery.historyGap };
  if (gap) applyInputs(state, [gap]);
  return { state, recovery, lastGen: Math.max(0, ...cps, ...logs), gap };
}

/** Where an activity came from, for retention per source. */
function origin(e: ActivityEvent): string {
  const p = e.provenance;
  switch (p.kind) {
    case "core":
    case "snapshot":
    case "get":
      return `core:${p.source}`;
    case "transcript":
      return "transcript";
    case "fleet":
      return `fleet:${p.job}`;
    case "plugin":
      return `plugin:${p.id}`;
    default:
      return p.kind;
  }
}

/**
 * Activity older than maxAgeMs (by receive time), or beyond the newest maxItems of its source, leaves the
 * store with its dedupe keys (occurrence keys never recur). Open and in-flight approvals and unsettled
 * actions always stay; resolved ones go with their activity; gone terminals go once nothing refers to them.
 */
export function prune(state: StoreState, now: number, r: { maxAgeMs: number; maxItems: number } = RETENTION): StoreState {
  const cutoff = now - r.maxAgeMs;
  const counts = new Map<string, number>();
  const keep = new Array<boolean>(state.activity.length);
  for (let i = state.activity.length - 1; i >= 0; i--) {
    const e = state.activity[i] as ActivityEvent;
    const o = origin(e);
    const n = (counts.get(o) ?? 0) + 1;
    counts.set(o, n);
    keep[i] = e.receivedAt >= cutoff && n <= r.maxItems;
  }
  if (keep.every(Boolean)) return state;
  const activity = state.activity.filter((_, i) => keep[i]);
  const seen = { ...state.seen };
  for (const e of state.activity.filter((_, i) => !keep[i])) delete seen[e.key];
  const approvals = Object.fromEntries(Object.entries(state.approvals).filter(([id, a]) => a.state === "open" || a.state === "in-flight" || seen[id]));
  const acted = new Set(activity.map((e) => (e.provenance.kind === "user" ? e.provenance.actionId : null)));
  const actions = Object.fromEntries(Object.entries(state.actions).filter(([id, a]) => a.outcome === null || acted.has(id)));
  const referenced = new Set(activity.map((e) => e.terminal));
  const terminals = Object.fromEntries(Object.entries(state.terminals).filter(([k, t]) => !t.gone || referenced.has(k)));
  return { ...state, activity, seen, approvals, actions, terminals };
}
