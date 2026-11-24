// Terminal bytes: `terminal.attach` on a framed connection, as the `TerminalStream` main hands the renderer.
// Observer by default; active (takeover) only after the person confirms in main, ending after 10 minutes
// without their input. Frames keep Core's order, so a RESIZE is applied before any later DATA.

import { LIMITS, type CoreHello, type CoreTerminal, type StreamCapabilities, type StreamFrame, type TerminalKey, type TerminalStream } from "@tremor/protocol";
import type { Confirmer } from "./actions.ts";
import { FRAME, type Connection } from "./rpc.ts";

export const TAKEOVER_IDLE_MS = 10 * 60 * 1000;

export interface OpenStreamOptions {
  connection: Connection;
  hello: CoreHello;
  terminal: TerminalKey;
  /** Core's address for it (`t7`). */
  address: string;
  mode: "observe" | "active";
  cols: number;
  rows: number;
  /** Required for active mode. */
  confirmer?: Confirmer;
  terminalName?: string;
  history?: number;
  idleMs?: number;
}

interface AttachResult {
  channel: number;
  terminal: CoreTerminal;
  resize_notifications?: boolean;
  automatic_input?: boolean;
}

export class TakeoverRefused extends Error {}

export interface MainStream extends TerminalStream {
  readonly channel: number;
  /** Writes and resizes main dropped (observer input, or after close). */
  readonly dropped: number;
}

export async function openStream(o: OpenStreamOptions): Promise<MainStream> {
  if (o.mode === "active") {
    if (!o.confirmer) throw new TakeoverRefused("takeover needs a confirmer");
    const name = o.terminalName ?? o.address;
    const yes = await o.confirmer.confirm({ kind: "takeover", terminal: o.terminal, terminalName: name, action: `Take over ${name}: what you type goes to its program` }).catch(() => false);
    if (!yes) throw new TakeoverRefused("the person did not confirm the takeover");
  }
  const observe = o.mode === "observe";
  const features = o.hello.features ?? [];
  const reply = await o.connection.call<AttachResult>("terminal.attach", {
    terminal: o.address,
    cols: o.cols,
    rows: o.rows,
    observe,
    ...(o.history ? { history: o.history } : {}),
    ...(observe && features.includes("resize_notifications") ? { resize_notifications: true } : {}),
  });
  const capabilities: StreamCapabilities = { automaticInput: features.includes("automatic_input") && reply.automatic_input === true, resizeNotifications: reply.resize_notifications === true };
  return new Stream(o, reply.channel, capabilities);
}

class Stream implements MainStream {
  readonly mode: "observe" | "active";
  dropped = 0;
  private seq = 0;
  private ended = false;
  private readonly unconsumed = new Map<number, number>();
  private readonly listeners = new Set<(f: StreamFrame) => void>();
  private readonly early: StreamFrame[] = [];
  private idle: ReturnType<typeof setTimeout> | undefined;
  private readonly offFrames: () => void;
  private readonly offClose: () => void;

  constructor(
    private readonly o: OpenStreamOptions,
    readonly channel: number,
    readonly capabilities: StreamCapabilities,
  ) {
    this.mode = o.mode;
    const ch = o.connection.channel(channel);
    this.offFrames = ch.onFrame((f) => {
      if (this.ended) return;
      if (f.kind === FRAME.DATA) {
        const seq = ++this.seq;
        this.unconsumed.set(seq, f.payload.length);
        this.deliver({ kind: "data", seq, bytes: f.payload });
      } else if (f.kind === FRAME.RESIZE && f.payload.length === 4) {
        const v = new DataView(f.payload.buffer, f.payload.byteOffset, 4);
        this.deliver({ kind: "resize", seq: ++this.seq, cols: v.getUint16(0, true), rows: v.getUint16(2, true) });
      } else if (f.kind === FRAME.CLOSE) {
        const why = parseClose(f.payload);
        this.end();
        this.deliver({ kind: "close", seq: ++this.seq, ...why });
      }
    });
    this.offClose = o.connection.onClose((reason) => {
      if (this.ended) return;
      this.end();
      this.deliver({ kind: "close", seq: ++this.seq, reason: `connection closed: ${reason}`, exitCode: null, signal: null });
    });
    if (this.mode === "active") this.touch();
  }

  onFrame(listener: (frame: StreamFrame) => void): () => void {
    this.listeners.add(listener);
    for (const f of this.early.splice(0)) listener(f);
    return () => this.listeners.delete(listener);
  }

  /** CREDIT exactly once per data frame the emulator reports consumed; anything else is ignored. */
  consumed(seq: number): void {
    const n = this.unconsumed.get(seq);
    if (n === undefined || this.ended) return;
    this.unconsumed.delete(seq);
    if (n > 0) this.o.connection.channel(this.channel).send(FRAME.CREDIT, u32(n));
  }

  write(bytes: Uint8Array, source: "human" | "automatic"): void {
    if (this.mode !== "active" || this.ended || bytes.length === 0 || bytes.length > LIMITS.writeBytes) {
      this.dropped++;
      return;
    }
    const kind = source === "automatic" && this.capabilities.automaticInput ? FRAME.AUTOMATIC_INPUT : FRAME.DATA;
    this.o.connection.channel(this.channel).send(kind, bytes);
    if (source === "human") this.touch();
  }

  resize(cols: number, rows: number): void {
    if (this.mode !== "active" || this.ended || !Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2 || cols > LIMITS.cols || rows > LIMITS.rows) {
      this.dropped++;
      return;
    }
    const b = new Uint8Array(4);
    const v = new DataView(b.buffer);
    v.setUint16(0, cols, true);
    v.setUint16(2, rows, true);
    this.o.connection.channel(this.channel).send(FRAME.RESIZE, b);
  }

  close(): void {
    if (this.ended) return;
    this.end();
    if (!this.o.connection.closed) this.o.connection.channel(this.channel).send(FRAME.CLOSE);
  }

  private touch(): void {
    clearTimeout(this.idle);
    const ms = this.o.idleMs ?? TAKEOVER_IDLE_MS;
    this.idle = setTimeout(() => {
      this.close();
      this.deliver({ kind: "close", seq: ++this.seq, reason: `takeover ended: no input for ${ms >= 60_000 ? `${ms / 60_000} minutes` : `${ms} ms`}`, exitCode: null, signal: null });
    }, ms);
  }

  private end(): void {
    this.ended = true;
    clearTimeout(this.idle);
    this.unconsumed.clear();
    this.offFrames();
    this.offClose();
    this.o.connection.dropChannel(this.channel);
  }

  private deliver(f: StreamFrame): void {
    if (this.listeners.size === 0) this.early.push(f);
    else for (const l of this.listeners) l(f);
  }
}

function parseClose(payload: Uint8Array): { reason: string; exitCode: number | null; signal: number | null } {
  try {
    const j = JSON.parse(new TextDecoder().decode(payload)) as { reason?: string; exit_code?: number | null; signal?: number | null };
    return { reason: j.reason ?? "closed", exitCode: j.exit_code ?? null, signal: j.signal ?? null };
  } catch {
    return { reason: "closed", exitCode: null, signal: null };
  }
}

const u32 = (n: number): Uint8Array => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
};
