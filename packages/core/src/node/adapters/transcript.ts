// A Claude Code session transcript (`~/.claude/projects/<project>/<session>.jsonl`) as `transcript` inputs:
// assistant text, tool uses and their results (paired by tool_use_id), and user turns. Untrusted text, local
// files only. Lines are numbered from 1 within a file identity; the store's cursor is the last line applied.

import { stat } from "node:fs/promises";
import type { CoreInput, TerminalKey, TranscriptEntry } from "@tremor/protocol";
import { completeLines, fileIdentity, readFrom, type Cursor } from "./fleet.ts";

/** Bound on stored text per entry. ponytail: plain cut; keep full tool output in the transcript file itself. */
export const TEXT_MAX = 16 * 1024;
const cut = (s: string) => (s.length > TEXT_MAX ? `${s.slice(0, TEXT_MAX)}…` : s);

type Block = { type?: string; text?: string; name?: string; id?: string; input?: Record<string, unknown>; tool_use_id?: string; content?: unknown };

const textOf = (c: unknown): string =>
  typeof c === "string"
    ? c
    : Array.isArray(c)
      ? c
          .filter((b: Block) => b?.type === "text" && typeof b.text === "string")
          .map((b: Block) => b.text)
          .join("\n")
      : "";

/** What a tool was asked to do, briefly: the command or path when there is one. */
function toolText(name: string, input: Record<string, unknown> = {}): string {
  for (const k of ["command", "file_path", "path", "pattern", "url", "description"]) if (typeof input[k] === "string") return input[k] as string;
  return JSON.stringify(input);
}

/** One Claude Code transcript line as an entry, or null for lines that are not chat (summaries, snapshots, meta). */
export function parseClaudeLine(raw: unknown): TranscriptEntry | null {
  const o = raw as { type?: string; uuid?: string; timestamp?: string; isMeta?: boolean; message?: { content?: unknown } } | null;
  if (!o || (o.type !== "user" && o.type !== "assistant") || o.isMeta) return null;
  const extra = { ...(typeof o.uuid === "string" ? { id: o.uuid } : {}), ...(o.timestamp && !Number.isNaN(Date.parse(o.timestamp)) ? { sourceAt: Date.parse(o.timestamp) } : {}) };
  const content = o.message?.content;
  const blocks: Block[] = Array.isArray(content) ? content : [];
  if (o.type === "user") {
    const result = blocks.find((b) => b?.type === "tool_result");
    if (result) return { role: "tool-result", text: cut(textOf(result.content)), ...(typeof result.tool_use_id === "string" ? { toolUseId: result.tool_use_id } : {}), ...extra };
    const text = textOf(content);
    return text ? { role: "user", text: cut(text), ...extra } : null;
  }
  const text = textOf(content);
  if (text) return { role: "assistant", text: cut(text), ...extra };
  const use = blocks.find((b) => b?.type === "tool_use" && typeof b.name === "string");
  if (use) return { role: "tool-use", tool: use.name as string, text: cut(toolText(use.name as string, use.input)), ...(typeof use.id === "string" ? { toolUseId: use.id } : {}), ...extra };
  return null;
}

export interface TranscriptAdapterOptions {
  terminal: TerminalKey;
  path: string;
  emit: (input: CoreInput) => void;
  /** The store's cursor for `transcript:<terminal>`. */
  cursor: () => Cursor;
  now?: () => number;
}

export class TranscriptAdapter {
  private at: { file: string; byte: number; line: number } | null = null;
  /** Lines up to this one were applied before a restart (the store's cursor). */
  private skipTo = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private busy = false;

  constructor(private readonly o: TranscriptAdapterOptions) {}

  async poll(): Promise<number> {
    if (this.busy) return 0;
    this.busy = true;
    try {
      const st = await stat(this.o.path).catch(() => null);
      if (!st) return 0;
      const id = fileIdentity(st);
      if (this.at === null) {
        const stored = this.o.cursor();
        const file = stored && stored.file.split("#")[0] === id ? stored.file : id;
        this.skipTo = stored && stored.file === file ? stored.offset : 0;
        this.at = { file, byte: 0, line: 0 };
      } else if (this.at.file.split("#")[0] !== id) {
        this.at = { file: id, byte: 0, line: 0 };
        this.skipTo = 0;
      } else if (st.size < this.at.byte) {
        this.at = { file: `${id}#${Number(this.at.file.split("#")[1] ?? 0) + 1}`, byte: 0, line: 0 };
        this.skipTo = 0;
      }
      const at = this.at;
      const { lines, consumed } = completeLines(await readFrom(this.o.path, at.byte, st.size), at.byte);
      let n = 0;
      for (const l of lines) {
        const line = ++at.line;
        if (line <= this.skipTo) continue;
        let entry: TranscriptEntry | null = null;
        try {
          entry = parseClaudeLine(JSON.parse(l.text));
        } catch {
          continue; // not JSON: not chat
        }
        if (!entry) continue;
        this.o.emit({ t: (this.o.now ?? Date.now)(), kind: "transcript", terminal: this.o.terminal, file: at.file, line, entry });
        n++;
      }
      at.byte += consumed;
      return n;
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
