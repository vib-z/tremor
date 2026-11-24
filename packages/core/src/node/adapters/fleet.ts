// A Herdr fleet job folder's inbox.log (REPORT, TURN, QUESTION, GONE lines, written by fleet-job's hooks)
// as `fleet` inputs: untrusted observations, never actions. Identity is the file's, not its name:
// `<dev>:<ino>:<birthtimeMs>`, plus `#<n>` once it was truncated; offsets are byte offsets of line starts.

import { open, stat } from "node:fs/promises";
import { join } from "node:path";
import type { CoreInput, FileId } from "@tremor/protocol";

export type Cursor = { file: FileId; offset: number } | undefined;

export const fileIdentity = (st: { dev: number; ino: number; birthtimeMs: number }): FileId => `${st.dev}:${st.ino}:${Math.trunc(st.birthtimeMs)}`;
const base = (f: FileId) => f.split("#")[0] as string;
const generation = (f: FileId) => Number(f.split("#")[1] ?? 0);

/** Where to read a file from next: the same identity and position, or a new identity after truncation or replacement. */
export function position(identity: FileId, size: number, at: Cursor): { file: FileId; offset: number } {
  if (!at || base(at.file) !== identity) return { file: identity, offset: 0 };
  if (size < at.offset) return { file: `${identity}#${generation(at.file) + 1}`, offset: 0 };
  return at;
}

/** Complete lines from `bytes` (read at `from`), each with its byte offset; a trailing partial line is left for later. */
export function completeLines(bytes: Uint8Array, from: number): { lines: { offset: number; text: string }[]; consumed: number } {
  const lines: { offset: number; text: string }[] = [];
  const text = new TextDecoder();
  let start = 0;
  for (let i = 0; i < bytes.length; i++)
    if (bytes[i] === 10) {
      lines.push({ offset: from + start, text: text.decode(bytes.subarray(start, i)) });
      start = i + 1;
    }
  return { lines, consumed: start };
}

/** Reads `path` from `offset` to its current end. */
export async function readFrom(path: string, offset: number, size: number): Promise<Uint8Array> {
  if (size <= offset) return new Uint8Array();
  const h = await open(path, "r");
  try {
    const buf = new Uint8Array(size - offset);
    const { bytesRead } = await h.read(buf, 0, buf.length, offset);
    return buf.subarray(0, bytesRead);
  } finally {
    await h.close();
  }
}

export interface FleetAdapterOptions {
  job: string;
  /** The job folder; the adapter reads `inbox.log` in it and nothing else. */
  dir: string;
  emit: (input: CoreInput) => void;
  /** The store's cursor for `fleet:<job>`: where a restart resumes. */
  cursor: () => Cursor;
  now?: () => number;
}

export class FleetAdapter {
  private at: Cursor;
  private timer: ReturnType<typeof setInterval> | undefined;
  private busy = false;

  constructor(private readonly o: FleetAdapterOptions) {}

  /** Emits every new complete line; returns how many. */
  async poll(): Promise<number> {
    if (this.busy) return 0;
    this.busy = true;
    try {
      const path = join(this.o.dir, "inbox.log");
      const st = await stat(path).catch(() => null);
      if (!st) return 0;
      // ponytail: whole-file polling by size; a truncation that regrows past the old offset between polls reads as appended
      const at = position(fileIdentity(st), st.size, this.at ?? this.o.cursor());
      const { lines, consumed } = completeLines(await readFrom(path, at.offset, st.size), at.offset);
      for (const l of lines) this.o.emit({ t: (this.o.now ?? Date.now)(), kind: "fleet", job: this.o.job, file: at.file, offset: l.offset, line: l.text });
      this.at = { file: at.file, offset: at.offset + consumed };
      return lines.length;
    } finally {
      this.busy = false;
    }
  }

  start(intervalMs = 1000): void {
    this.timer ??= setInterval(() => void this.poll().catch(() => {}), intervalMs);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
