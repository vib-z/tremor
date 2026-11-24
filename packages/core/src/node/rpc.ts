// JSON-RPC 2.0 to Herdr Core over a byte transport (the stdio of `hc connect`), plain and framed.
// Plain: one JSON message per line. Framed, after `hello {framed: true}` replies:
// [channel u32 LE][kind u8][len u32 LE][payload] (herdr-core schema/README.md and src/wire.rs at 3ba03e6).
//
// Two kinds of failure, never mixed: a TransportError means the connection is gone (reconnect);
// an RpcError is Core's answer (`{code, message, data: {kind, hint}}`), and the connection is fine.

import { spawn } from "node:child_process";
import type { CoreErrorData, CoreHello } from "@tremor/protocol";

export const FRAME = { DATA: 0, CREDIT: 1, CLOSE: 2, RESIZE: 3, FOCUS: 4, FACTS: 5, AUTOMATIC_INPUT: 6 } as const;
export const HEADER = 9;
export const MAX_PAYLOAD = 16 << 20;
/** Bytes a channel may hold for a listener that has not attached yet (an attach or subscribe reply in flight). */
const EARLY_MAX = 8 << 20;

export interface Frame {
  channel: number;
  kind: number;
  payload: Uint8Array;
}

export function encodeFrame(channel: number, kind: number, payload: Uint8Array = new Uint8Array()): Uint8Array {
  if (payload.length > MAX_PAYLOAD) throw new RangeError(`frame payload of ${payload.length} bytes exceeds ${MAX_PAYLOAD}`);
  const out = new Uint8Array(HEADER + payload.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, channel, true);
  v.setUint8(4, kind);
  v.setUint32(5, payload.length, true);
  out.set(payload, HEADER);
  return out;
}

const concat = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  if (a.length === 0) return b;
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
};

/** Frames from arbitrary chunks. Throws on a payload over the limit (the stream is then unusable). */
export class FrameDecoder {
  private buf: Uint8Array = new Uint8Array();
  push(chunk: Uint8Array): Frame[] {
    this.buf = concat(this.buf, chunk);
    const frames: Frame[] = [];
    while (this.buf.length >= HEADER) {
      const v = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
      const len = v.getUint32(5, true);
      if (len > MAX_PAYLOAD) throw new RangeError(`frame of ${len} bytes exceeds ${MAX_PAYLOAD}`);
      if (this.buf.length < HEADER + len) break;
      frames.push({ channel: v.getUint32(0, true), kind: v.getUint8(4), payload: this.buf.slice(HEADER, HEADER + len) });
      this.buf = this.buf.subarray(HEADER + len);
    }
    return frames;
  }
  get pending(): number {
    return this.buf.length;
  }
}

/** Whole lines from arbitrary chunks (a line split across chunks or frames is joined); UTF-8 decoded per line. */
export class LineDecoder {
  private buf: Uint8Array = new Uint8Array();
  private readonly text = new TextDecoder();
  push(chunk: Uint8Array): string[] {
    this.append(chunk);
    const lines: string[] = [];
    let line: string | null;
    while ((line = this.next()) !== null) lines.push(line);
    return lines;
  }
  append(chunk: Uint8Array): void {
    this.buf = concat(this.buf, chunk);
  }
  /** One line, or null when no whole line is buffered. */
  next(): string | null {
    const at = this.buf.indexOf(10);
    if (at < 0) return null;
    const line = this.text.decode(this.buf.subarray(0, at));
    this.buf = this.buf.subarray(at + 1);
    return line;
  }
  /** Everything after the last whole line, removed from the decoder. */
  take(): Uint8Array {
    const rest = this.buf;
    this.buf = new Uint8Array();
    return rest;
  }
  get pending(): number {
    return this.buf.length;
  }
}

/** A duplex byte pipe. `onClose` fires once, whoever closed it. */
export interface Transport {
  write(bytes: Uint8Array): void;
  onData(listener: (chunk: Uint8Array) => void): void;
  onClose(listener: (reason: string) => void): void;
  close(): void;
}

export class TransportError extends Error {
  override name = "TransportError";
}

/** Core answered with an error: nothing is wrong with the connection. `kind` is stable (not_found, unavailable, ...). */
export class RpcError extends Error {
  override name = "RpcError";
  constructor(
    readonly code: number,
    message: string,
    readonly kind: string,
    readonly hint: string,
  ) {
    super(message);
  }
}

/** The caller gave up before a reply. `sent`: the call had gone out, so whether Core acted on it is not known. */
export class CallAborted extends Error {
  override name = "AbortError";
  constructor(
    message: string,
    readonly sent: boolean,
  ) {
    super(message);
  }
}

export interface CallOptions {
  signal?: AbortSignal;
}

interface Pending {
  method: string;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  cleanup: () => void;
}

export interface Channel {
  /** Frames for this channel, in arrival order; frames that came before a listener are delivered to the first one. */
  onFrame(listener: (frame: Frame) => void): () => void;
  send(kind: number, payload?: Uint8Array): void;
}

type Notification = { method: string; params: unknown };

export class Connection {
  mode: "plain" | "framed" = "plain";
  closed = false;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly lines = new LineDecoder();
  private readonly frames = new FrameDecoder();
  private readonly notifyListeners = new Set<(n: Notification) => void>();
  private readonly closeListeners = new Set<(reason: string) => void>();
  private readonly channels = new Map<number, { listeners: Set<(f: Frame) => void>; early: Frame[]; earlyBytes: number }>();
  private switchOn: number | null = null;
  private closeReason = "";

  constructor(private readonly transport: Transport) {
    transport.onData((chunk) => this.receive(chunk));
    transport.onClose((reason) => this.shutdown(reason));
  }

  /** `hello`; with `framed: true` the connection switches to frames right after this reply. Call it alone, first. */
  async hello(params: { framed?: boolean; generation?: number } = {}, opts: CallOptions = {}): Promise<CoreHello> {
    if (this.pending.size > 0) throw new Error("hello must be the only call in flight");
    const id = this.nextId;
    if (params.framed) this.switchOn = id;
    try {
      return await this.call<CoreHello>("hello", params, opts);
    } finally {
      this.switchOn = null;
    }
  }

  call<T = unknown>(method: string, params: unknown = {}, opts: CallOptions = {}): Promise<T> {
    if (this.closed) return Promise.reject(new TransportError(`connection closed: ${this.closeReason}`));
    const signal = opts.signal;
    if (signal?.aborted) return Promise.reject(new CallAborted(`${method} aborted before it was sent`, false));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        if (method === "terminal.send") {
          // Core stops a send that has not started typing; its reply (cancelled, or done) still decides.
          this.notify("$/cancelRequest", { id });
          return;
        }
        this.pending.get(id)?.cleanup();
        this.pending.delete(id);
        reject(new CallAborted(`${method} aborted; Core may have acted on it`, true));
      };
      const cleanup = () => signal?.removeEventListener("abort", onAbort);
      this.pending.set(id, { method, resolve: resolve as (v: unknown) => void, reject, cleanup });
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        this.sendMessage({ jsonrpc: "2.0", id, method, params });
      } catch (e) {
        cleanup();
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  notify(method: string, params: unknown = {}): void {
    if (!this.closed) this.sendMessage({ jsonrpc: "2.0", method, params });
  }

  /** Notifications on the JSON-RPC stream itself (plain-mode events, or channel 0 in framed mode). */
  onNotification(listener: (n: Notification) => void): () => void {
    this.notifyListeners.add(listener);
    return () => this.notifyListeners.delete(listener);
  }

  onClose(listener: (reason: string) => void): () => void {
    if (this.closed) queueMicrotask(() => listener(this.closeReason));
    else this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  channel(id: number): Channel {
    if (this.mode !== "framed") throw new Error("channels need a framed connection");
    return {
      onFrame: (listener) => {
        const ch = this.slot(id);
        ch.listeners.add(listener);
        const early = ch.early.splice(0);
        ch.earlyBytes = 0;
        for (const f of early) listener(f);
        return () => ch.listeners.delete(listener);
      },
      send: (kind, payload) => this.sendFrame(id, kind, payload),
    };
  }

  /** Forgets a channel's buffered frames and listeners (after CLOSE). */
  dropChannel(id: number): void {
    this.channels.delete(id);
  }

  sendFrame(channel: number, kind: number, payload: Uint8Array = new Uint8Array()): void {
    if (this.closed) throw new TransportError(`connection closed: ${this.closeReason}`);
    this.write(encodeFrame(channel, kind, payload));
  }

  close(reason = "closed by Tremor"): void {
    if (this.closed) return;
    this.closeReason = reason;
    this.transport.close();
    this.shutdown(reason);
  }

  private slot(id: number) {
    let ch = this.channels.get(id);
    if (!ch) this.channels.set(id, (ch = { listeners: new Set(), early: [], earlyBytes: 0 }));
    return ch;
  }

  private sendMessage(msg: object): void {
    const json = new TextEncoder().encode(JSON.stringify(msg));
    this.write(this.mode === "framed" ? encodeFrame(0, FRAME.DATA, json) : concat(json, new Uint8Array([10])));
  }

  private write(bytes: Uint8Array): void {
    try {
      this.transport.write(bytes);
    } catch (e) {
      const err = new TransportError(`write failed: ${(e as Error).message}`);
      this.close(err.message);
      throw err;
    }
  }

  private receive(chunk: Uint8Array): void {
    if (this.closed) return;
    try {
      if (this.mode === "plain") {
        // One line at a time: bytes after hello's reply are frames, even inside the same chunk.
        this.lines.append(chunk);
        let line: string | null;
        while (!this.framed() && (line = this.lines.next()) !== null) if (line.trim() !== "") this.message(line);
        if (this.framed()) this.frameBytes(this.lines.take());
      } else this.frameBytes(chunk);
    } catch (e) {
      this.close(`bad data from core: ${(e as Error).message}`);
    }
  }

  /** A method, not a field read: `message` may switch the mode mid-chunk. */
  private framed(): boolean {
    return this.mode === "framed";
  }

  private frameBytes(bytes: Uint8Array): void {
    for (const f of this.frames.push(bytes)) {
      if (f.channel === 0) {
        if (f.kind === FRAME.DATA) this.message(new TextDecoder().decode(f.payload));
        continue;
      }
      const ch = this.slot(f.channel);
      if (ch.listeners.size > 0) for (const l of ch.listeners) l(f);
      else {
        ch.early.push(f);
        ch.earlyBytes += f.payload.length;
        if (ch.earlyBytes > EARLY_MAX) throw new Error(`channel ${f.channel} buffered over ${EARLY_MAX} bytes with no listener`);
      }
    }
  }

  private message(text: string): void {
    const m = JSON.parse(text) as { id?: unknown; method?: unknown; params?: unknown; result?: unknown; error?: { code?: number; message?: string; data?: Partial<CoreErrorData> } };
    if (typeof m.method === "string" && m.id === undefined) {
      for (const l of this.notifyListeners) l({ method: m.method, params: m.params });
      return;
    }
    if (typeof m.id !== "number") return; // a call from Core (peer cores only) or junk: not ours
    const p = this.pending.get(m.id);
    if (!p) return; // abandoned by its caller
    this.pending.delete(m.id);
    p.cleanup();
    if (m.error) p.reject(new RpcError(m.error.code ?? -32603, m.error.message ?? "", m.error.data?.kind ?? "internal", m.error.data?.hint ?? ""));
    else {
      if (this.switchOn === m.id && (m.result as { framed?: unknown } | undefined)?.framed === true) this.mode = "framed";
      p.resolve(m.result);
    }
  }

  private shutdown(reason: string): void {
    if (this.closed && this.pending.size === 0 && this.closeListeners.size === 0) return;
    this.closed = true;
    this.closeReason ||= reason;
    const err = new TransportError(`connection closed: ${this.closeReason}`);
    for (const p of this.pending.values()) {
      p.cleanup();
      p.reject(err);
    }
    this.pending.clear();
    const listeners = [...this.closeListeners];
    this.closeListeners.clear();
    for (const l of listeners) l(this.closeReason);
  }
}

/** `hc connect` as a child process: its stdio is the transport. `env` must be complete (it is not merged). */
export function spawnTransport(command: string, args: string[], env: Record<string, string>): Transport & { pid: number | undefined; kill(signal?: NodeJS.Signals): void } {
  const child = spawn(command, args, { env, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  let done = false;
  const closers: ((reason: string) => void)[] = [];
  const finish = (reason: string) => {
    if (done) return;
    done = true;
    for (const c of closers) c(reason);
  };
  child.stderr.on("data", (b: Buffer) => (stderr = (stderr + b.toString("utf8")).slice(-2000)));
  child.stdin.on("error", () => {}); // EPIPE after exit: reported through `exit`
  child.on("error", (e) => finish(`${command} failed: ${e.message}`));
  child.on("exit", (code, signal) => finish(`${command} exited (${signal ?? `code ${code}`})${stderr.trim() ? `: ${stderr.trim().split("\n").pop()}` : ""}`));
  return {
    pid: child.pid,
    write(bytes) {
      if (done || !child.stdin.writable) throw new TransportError("hc connect is not running");
      child.stdin.write(bytes);
    },
    onData(listener) {
      child.stdout.on("data", (b: Buffer) => listener(new Uint8Array(b.buffer, b.byteOffset, b.byteLength)));
    },
    onClose(listener) {
      closers.push(listener);
    },
    close() {
      child.stdin.end();
      child.kill("SIGTERM");
    },
    kill(signal = "SIGKILL") {
      child.kill(signal);
    },
  };
}

/** Two in-memory transports wired back to back (tests and fakes). Delivery is asynchronous, like a pipe. */
export function transportPair(): [Transport & { closeFromPeer(reason: string): void }, Transport & { closeFromPeer(reason: string): void }] {
  const make = () => ({ data: [] as ((c: Uint8Array) => void)[], close: [] as ((r: string) => void)[], done: false });
  const a = make();
  const b = make();
  const end = (reason: string) => {
    for (const side of [a, b])
      if (!side.done) {
        side.done = true;
        for (const l of side.close) queueMicrotask(() => l(reason));
      }
  };
  const side = (me: typeof a, peer: typeof a) => ({
    write(bytes: Uint8Array) {
      if (me.done) throw new TransportError("closed");
      const copy = bytes.slice();
      queueMicrotask(() => {
        if (!peer.done) for (const l of peer.data) l(copy);
      });
    },
    onData: (l: (c: Uint8Array) => void) => void me.data.push(l),
    onClose: (l: (r: string) => void) => void me.close.push(l),
    close: () => end("closed"),
    closeFromPeer: (reason: string) => end(reason),
  });
  return [side(a, b), side(b, a)];
}
