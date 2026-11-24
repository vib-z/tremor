// CoreSource: one framed `hc connect` connection, recorded as CoreInput lines (the I/O seam, D5).
// Connect, hello (generation 1), subscribe, stream events, re-read documents, take a fresh terminal.get on
// every blocked status, and reconnect on transport failure only, with a new connection id each time.

import { randomBytes } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import { CORE_GENERATION, type ConnId, type CoreHello, type CoreInput, type CoreNotification, type CoreSubscribed, type CoreTerminal, type SourceId } from "@tremor/protocol";
import { Connection, FRAME, LineDecoder, RpcError, TransportError, type CallOptions, type Transport } from "./rpc.ts";

export const BACKOFF_MS = [500, 1000, 2000, 5000, 10000, 30000] as const;
export const LIVENESS_MS = 45_000;

export interface SubscribeFilter {
  labels?: Record<string, string>;
  terminal?: string;
  children_of?: string;
}

export interface CoreSourceOptions {
  /** Starts `hc connect` (or anything speaking its protocol). */
  connect: () => Transport;
  /** Every input, in order, synchronously: the store applies it and the log records it. */
  emit: (input: CoreInput) => void;
  source?: SourceId;
  filter?: SubscribeFilter;
  /** Documents re-read after every subscribe, `doc` event and `missed` (read-only). */
  documents?: string[];
  livenessMs?: number;
  backoffMs?: readonly number[];
  /** ±fraction applied to each delay. */
  jitter?: number;
  random?: () => number;
  now?: () => number;
  newConnId?: () => ConnId;
}

/** The wait before reconnect attempt `attempt` (1-based): 0.5, 1, 2, 5, 10, then 30 s, each ±jitter. */
export function backoffDelay(attempt: number, backoff: readonly number[] = BACKOFF_MS, jitter = 0.2, random: () => number = Math.random): number {
  const base = backoff[Math.min(Math.max(attempt, 1), backoff.length) - 1] as number;
  return Math.round(base * (1 - jitter + 2 * jitter * random()));
}

class Fatal extends Error {}

interface Live {
  c: Connection;
  conn: ConnId;
  coreId: string;
  hello: CoreHello;
}

export class CoreSource {
  private readonly o: Required<Omit<CoreSourceOptions, "filter">> & { filter: SubscribeFilter };
  private stopped = true;
  private attempt = 0;
  private current: { c: Connection; conn: ConnId } | null = null;
  private live: Live | null = null;
  private lastConn: ConnId | null = null;
  private wake: (() => void) | null = null;
  private loop: Promise<void> | null = null;

  constructor(opts: CoreSourceOptions) {
    this.o = {
      source: "local",
      filter: {},
      documents: ["herdr-app"],
      livenessMs: LIVENESS_MS,
      backoffMs: BACKOFF_MS,
      jitter: 0.2,
      random: Math.random,
      now: Date.now,
      newConnId: () => randomBytes(6).toString("hex"),
      ...opts,
    };
  }

  get connection(): Connection | null {
    return this.live?.c ?? null;
  }
  get coreId(): string | null {
    return this.live?.coreId ?? null;
  }
  get hello(): CoreHello | null {
    return this.live?.hello ?? null;
  }
  get conn(): ConnId | null {
    return this.live?.conn ?? null;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.loop = this.run();
  }

  /** Ends the connection for good: `offline`, no reconnect. */
  async stop(reason = "stopped"): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.current?.c.close(reason);
    this.wake?.();
    await this.loop;
    if (this.lastConn !== null) this.emit({ kind: "offline", conn: this.lastConn, reason });
  }

  /** A call on the live connection; a TransportError when there is none. */
  call<T>(method: string, params: unknown, opts: CallOptions = {}): Promise<T> {
    const live = this.live;
    if (!live) return Promise.reject(new TransportError("not connected to Core"));
    return live.c.call<T>(method, params, opts);
  }

  /** A fresh terminal.get, recorded as a `terminal` input before it is returned. */
  async getTerminal(address: string, opts: CallOptions = {}): Promise<CoreTerminal> {
    const live = this.live;
    if (!live) throw new TransportError("not connected to Core");
    const result = await live.c.call<CoreTerminal>("terminal.get", { terminal: address }, opts);
    if (this.live === live) this.emit({ kind: "terminal", conn: live.conn, result });
    return result;
  }

  private emit(i: DistributiveOmit<Extract<CoreInput, { source: SourceId }>, "t" | "source">): void {
    this.o.emit({ ...i, t: this.o.now(), source: this.o.source } as CoreInput);
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      const conn = this.o.newConnId();
      this.lastConn = conn;
      this.emit({ kind: "connecting", conn, attempt: this.attempt });
      let reason: string;
      try {
        reason = await this.session(conn);
      } catch (e) {
        if (e instanceof Fatal) {
          this.stopped = true;
          this.emit({ kind: "offline", conn, reason: e.message });
          this.lastConn = null;
          return;
        }
        reason = (e as Error).message;
      } finally {
        this.live = null;
        this.current = null;
      }
      if (this.stopped) return;
      this.attempt++;
      const retryInMs = backoffDelay(this.attempt, this.o.backoffMs, this.o.jitter, this.o.random);
      this.emit({ kind: "closed", conn, reason, attempt: this.attempt, retryInMs });
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, retryInMs);
        this.wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      this.wake = null;
    }
  }

  /** One connection's life. Resolves with why the transport ended; throws Fatal for answers that rule out retrying. */
  private async session(conn: ConnId): Promise<string> {
    const c = new Connection(this.o.connect());
    this.current = { c, conn };
    const ended = new Promise<string>((resolve) => c.onClose(resolve));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const alive = () => {
      clearTimeout(timer);
      timer = setTimeout(() => c.close(`no message from Core for ${this.o.livenessMs / 1000} s`), this.o.livenessMs);
    };
    alive();
    try {
      if (this.stopped) c.close("stopped");
      try {
        const hello = await c.hello({ framed: true, generation: CORE_GENERATION });
        alive();
        this.emit({ kind: "hello", conn, result: hello });
        if (hello.generation !== CORE_GENERATION) throw new Fatal(`Core speaks protocol generation ${hello.generation}; Tremor needs ${CORE_GENERATION}`);
        if (c.mode !== "framed") throw new Fatal("Core did not switch to framed mode");
        const sub = await c.call<CoreSubscribed>("events.subscribe", this.o.filter);
        alive();
        if (sub.channel === null || sub.channel === undefined) throw new Fatal("subscribe gave no event channel on a framed connection");
        const live: Live = { c, conn, coreId: hello.core.id, hello };
        // The snapshot is recorded first; event frames that came with it wait in the channel until `listen`.
        this.emit({ kind: "subscribed", conn, result: sub });
        this.attempt = 0;
        this.live = live;
        this.listen(live, sub.channel, alive);
        this.afterSnapshot(live, sub.terminals);
      } catch (e) {
        if (e instanceof RpcError) throw new Fatal(`Core refused the handshake: ${e.kind}: ${e.message}`);
        if (e instanceof Fatal) throw e;
        // A transport failure: `ended` says why.
      }
      return await ended;
    } catch (e) {
      c.close((e as Error).message);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  private listen(live: Live, channel: number, alive: () => void): void {
    const lines = new LineDecoder();
    const ch = live.c.channel(channel);
    ch.onFrame((f) => {
      alive();
      if (f.kind === FRAME.CLOSE) return live.c.close("Core closed the event stream");
      if (f.kind !== FRAME.DATA) return;
      for (const line of lines.push(f.payload)) if (line.trim() !== "") this.onLine(live, line);
      // Consumed: every whole line in this frame is recorded; a partial line is held, already counted by Core.
      ch.send(FRAME.CREDIT, u32(f.payload.length));
    });
  }

  private onLine(live: Live, line: string): void {
    const { method, params } = JSON.parse(line) as CoreNotification;
    const msg = { method, params } as CoreNotification;
    this.emit({ kind: "notification", conn: live.conn, msg });
    if (msg.method === "missed") this.afterSnapshot(live, msg.params.terminals);
    if (msg.method !== "event") return;
    const p = msg.params;
    const data = p.data as { status?: { state?: string } | null; name?: string } | null;
    if (p.type === "status" && p.terminal !== undefined && data?.status?.state === "blocked") void this.quietly(this.getTerminal(p.terminal));
    if (p.type === "doc" && p.machine === undefined && typeof data?.name === "string" && this.o.documents.includes(data.name)) void this.quietly(this.readDoc(live, data.name));
  }

  /** After a subscribe reply or `missed`: documents again, and a fresh get for every blocked terminal. */
  private afterSnapshot(live: Live, terminals: CoreTerminal[]): void {
    for (const name of this.o.documents) void this.quietly(this.readDoc(live, name));
    for (const t of terminals) if (t.status?.state === "blocked") void this.quietly(this.getTerminal(t.address));
  }

  private async readDoc(live: Live, name: string): Promise<void> {
    const r = await live.c.call<{ value: unknown; version: number }>("doc.get", { name });
    if (this.live === live || this.current?.c === live.c) this.emit({ kind: "doc", conn: live.conn, name, version: r.version, value: r.value });
  }

  /** Background reads: a transport failure ends the session anyway, and Core's refusal is an answer. */
  private async quietly(p: Promise<unknown>): Promise<void> {
    await p.catch(() => {});
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

const u32 = (n: number): Uint8Array => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
};

/** Writes inputs as JSONL, the fixture format, so a live session can become a fixture. */
export class Recorder {
  private readonly out: WriteStream;
  constructor(path: string) {
    this.out = createWriteStream(path, { flags: "a" });
  }
  write = (input: CoreInput): void => {
    this.out.write(`${JSON.stringify(input)}\n`);
  };
  close(): Promise<void> {
    return new Promise((resolve, reject) => this.out.end((e?: Error | null) => (e ? reject(e) : resolve())));
  }
}
