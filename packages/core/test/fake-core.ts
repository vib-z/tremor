// An in-memory stand-in for `hc connect`: speaks plain and framed JSON-RPC like herdr-core's server.rs,
// so rpc, source, actions and streams can be tested without a real core.
import { FRAME, FrameDecoder, LineDecoder, encodeFrame, transportPair, type Frame, type Transport } from "../src/node/rpc.ts";

export type Call = { id: number | undefined; method: string; params: Record<string, unknown> };
/** Thrown by a handler: answered as a JSON-RPC error with this stable kind. */
export class Refuse extends Error {
  constructor(
    readonly kind: string,
    message = kind,
  ) {
    super(message);
  }
}
/** Returned by a handler: no reply for now; answer later with `reply` or `refuse`. */
export const HOLD = Symbol("hold");
type Handler = (params: Record<string, unknown>, call: Call) => unknown;

export class FakeCore {
  mode: "plain" | "framed" = "plain";
  readonly calls: Call[] = [];
  readonly frames: Frame[] = [];
  readonly client: Transport & { closeFromPeer(reason: string): void };
  private readonly server: Transport & { closeFromPeer(reason: string): void };
  private readonly lines = new LineDecoder();
  private readonly decoder = new FrameDecoder();
  private nextChannel = 1;

  constructor(public handlers: Record<string, Handler> = {}) {
    [this.client, this.server] = transportPair();
    this.server.onData((chunk) => this.receive(chunk));
  }

  /** The next stream channel number, as Core's Conn::new_channel hands them out. */
  channel(): number {
    return this.nextChannel++;
  }

  reply(id: number | undefined, result: unknown): void {
    if (id !== undefined) this.send({ jsonrpc: "2.0", id, result });
  }

  refuse(id: number | undefined, kind: string, message = kind): void {
    if (id !== undefined) this.send({ jsonrpc: "2.0", id, error: { code: -32000, message, data: { kind, hint: "" } } });
  }

  /** A notification: on the events channel in framed mode, else on the plain stream. */
  notify(method: string, params: unknown, channel = 0): void {
    const line = new TextEncoder().encode(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    if (channel !== 0) this.sendFrame(channel, FRAME.DATA, line);
    else if (this.mode === "plain") this.server.write(line);
    else this.sendFrame(0, FRAME.DATA, line.subarray(0, line.length - 1));
  }

  sendFrame(channel: number, kind: number, payload: Uint8Array = new Uint8Array()): void {
    this.server.write(encodeFrame(channel, kind, payload));
  }

  /** Raw bytes as Core would write them (to test splitting). */
  raw(bytes: Uint8Array): void {
    this.server.write(bytes);
  }

  hangUp(reason = "hc connect exited"): void {
    this.server.closeFromPeer(reason);
  }

  waitFor(method: string, n = 1): Promise<Call> {
    return new Promise((resolve) => {
      const tick = () => {
        const found = this.calls.filter((c) => c.method === method);
        if (found.length >= n) resolve(found[n - 1] as Call);
        else setTimeout(tick, 1);
      };
      tick();
    });
  }

  private send(msg: object): void {
    const json = new TextEncoder().encode(JSON.stringify(msg));
    if (this.mode === "framed") this.sendFrame(0, FRAME.DATA, json);
    else this.server.write(new Uint8Array([...json, 10]));
  }

  private receive(chunk: Uint8Array): void {
    if (this.mode === "plain") {
      this.lines.append(chunk);
      let line: string | null;
      while ((line = this.lines.next()) !== null) this.handle(JSON.parse(line));
      return;
    }
    for (const f of this.decoder.push(chunk)) {
      if (f.channel === 0 && f.kind === FRAME.DATA) this.handle(JSON.parse(new TextDecoder().decode(f.payload)));
      else this.frames.push(f);
    }
  }

  private handle(msg: { id?: number; method: string; params?: Record<string, unknown> }): void {
    const call: Call = { id: msg.id, method: msg.method, params: msg.params ?? {} };
    this.calls.push(call);
    const handler = this.handlers[call.method];
    if (!handler) {
      if (call.id !== undefined) this.refuse(call.id, "unknown_method");
      return;
    }
    Promise.resolve()
      .then(() => handler(call.params, call))
      .then(
        (result) => {
          if (result === HOLD) return;
          this.reply(call.id, result);
          // server.rs: a successful framed hello switches after its reply.
          if (call.method === "hello" && (result as { framed?: boolean }).framed) this.mode = "framed";
        },
        (e) => this.refuse(call.id, e instanceof Refuse ? e.kind : "internal", (e as Error).message),
      );
  }
}

export const helloResult = (id = "c0ffee0000000000000000000000000f", framed = true, features = ["framed", "attach", "events", "status", "resize_notifications", "automatic_input"]) => ({
  core: { id, name: "fake" },
  generation: 1,
  version: "0.1.19",
  features,
  methods: [],
  framed,
});

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Resolves when `check` returns a truthy value (polling), or rejects after `ms`. */
export async function until<T>(check: () => T | undefined | null | false, ms = 2000, what = "condition"): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = check();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(2);
  }
}
