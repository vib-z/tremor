import { describe, expect, test } from "bun:test";
import { CallAborted, Connection, FRAME, FrameDecoder, LineDecoder, MAX_PAYLOAD, RpcError, TransportError, encodeFrame } from "../src/node/rpc.ts";
import { FakeCore, HOLD, Refuse, helloResult, sleep } from "./fake-core.ts";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("frame codec", () => {
  test("round-trips any split of a stream of frames", () => {
    const frames = [
      { channel: 0, kind: FRAME.DATA, payload: bytes('{"jsonrpc":"2.0","id":1,"result":{}}') },
      { channel: 7, kind: FRAME.CREDIT, payload: new Uint8Array([0, 0, 4, 0]) },
      { channel: 3, kind: FRAME.CLOSE, payload: new Uint8Array() },
      { channel: 0xfffffffe, kind: FRAME.RESIZE, payload: new Uint8Array([80, 0, 24, 0]) },
    ];
    const wire = new Uint8Array(frames.flatMap((f) => [...encodeFrame(f.channel, f.kind, f.payload)]));
    expect(wire.length).toBe(frames.reduce((n, f) => n + 9 + f.payload.length, 0));
    for (let cut = 0; cut <= wire.length; cut++) {
      const d = new FrameDecoder();
      const got = [...d.push(wire.subarray(0, cut)), ...d.push(wire.subarray(cut))];
      expect(got).toEqual(frames);
      expect(d.pending).toBe(0);
    }
    const one = new FrameDecoder();
    const byByte = [...wire].flatMap((b) => one.push(new Uint8Array([b])));
    expect(byByte).toEqual(frames);
  });

  test("header layout is little-endian channel, kind, length", () => {
    expect([...encodeFrame(0x01020304, 6, new Uint8Array([9]))]).toEqual([4, 3, 2, 1, 6, 1, 0, 0, 0, 9]);
  });

  test("a payload over 16 MiB is refused both ways", () => {
    const header = new Uint8Array(9);
    new DataView(header.buffer).setUint32(5, MAX_PAYLOAD + 1, true);
    expect(() => new FrameDecoder().push(header)).toThrow(RangeError);
    expect(() => encodeFrame(1, 0, new Uint8Array(MAX_PAYLOAD + 1))).toThrow(RangeError);
  });

  test("JSON lines split across chunks, including inside a UTF-8 character", () => {
    const text = bytes('{"title":"✳ Claude"}\n{"a":1}\n{"b"');
    const d = new LineDecoder();
    const cut = text.indexOf(0xe2) + 1; // inside the 3-byte ✳
    expect(d.push(text.subarray(0, cut))).toEqual([]);
    expect(d.push(text.subarray(cut))).toEqual(['{"title":"✳ Claude"}', '{"a":1}']);
    expect(d.push(bytes(":2}\n"))).toEqual(['{"b":2}']);
  });
});

describe("Connection", () => {
  test("concurrent calls resolve by id, whatever order Core answers in", async () => {
    const core = new FakeCore({ "terminal.get": (p) => (p.terminal === "t1" ? sleep(20).then(() => ({ address: "t1" })) : { address: p.terminal }) });
    const c = new Connection(core.client);
    const [a, b] = await Promise.all([c.call("terminal.get", { terminal: "t1" }), c.call("terminal.get", { terminal: "t2" })]);
    expect([a, b]).toEqual([{ address: "t1" }, { address: "t2" }]);
  });

  test("hello framed switches modes exactly after its reply, even with frames in the same chunk", async () => {
    const core = new FakeCore({
      hello: (_p, call) => {
        // Reply line and the first frame written as one chunk.
        const reply = bytes(`${JSON.stringify({ jsonrpc: "2.0", id: call.id, result: helloResult() })}\n`);
        const frame = encodeFrame(5, FRAME.DATA, bytes('{"jsonrpc":"2.0","method":"heartbeat","params":{"seq":1}}\n'));
        core.raw(new Uint8Array([...reply, ...frame]));
        core.mode = "framed";
        return HOLD;
      },
      "terminal.list": () => ({ terminals: [] }),
    });
    const c = new Connection(core.client);
    const got: Uint8Array[] = [];
    const hello = await c.hello({ framed: true, generation: 1 });
    expect(hello.generation).toBe(1);
    expect(c.mode).toBe("framed");
    c.channel(5).onFrame((f) => got.push(f.payload));
    expect(new TextDecoder().decode(got[0])).toContain("heartbeat");
    expect(await c.call<object>("terminal.list")).toEqual({ terminals: [] });
  });

  test("a JSON-RPC error is an RpcError with Core's kind; the connection stays up", async () => {
    const core = new FakeCore({
      "terminal.send": () => {
        throw new Refuse("blocked", "t1 is blocked (permission)");
      },
      "terminal.get": () => ({ address: "t1" }),
    });
    const c = new Connection(core.client);
    const err = await c.call("terminal.send", { terminal: "t1", text: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect(err).not.toBeInstanceOf(TransportError);
    expect((err as RpcError).kind).toBe("blocked");
    expect(c.closed).toBe(false);
    expect(await c.call<object>("terminal.get", { terminal: "t1" })).toEqual({ address: "t1" });
  });

  test("closing rejects every pending call with a TransportError", async () => {
    const core = new FakeCore({ "terminal.wait": () => HOLD });
    const c = new Connection(core.client);
    const pending = [c.call("terminal.wait"), c.call("terminal.wait")];
    await core.waitFor("terminal.wait", 2);
    core.hangUp("hc connect exited (code 1)");
    for (const p of pending) {
      const e = (await p.catch((x) => x)) as Error;
      expect(e).toBeInstanceOf(TransportError);
      expect(e.message).toContain("hc connect exited");
    }
    expect(await c.call("terminal.get").catch((e) => e)).toBeInstanceOf(TransportError);
  });

  test("close() by Tremor rejects pending calls too", async () => {
    const core = new FakeCore({ "terminal.wait": () => HOLD });
    const c = new Connection(core.client);
    const p = c.call("terminal.wait");
    await core.waitFor("terminal.wait");
    c.close();
    expect(await p.catch((e) => e)).toBeInstanceOf(TransportError);
  });

  test("aborting a call stops waiting; a late reply is ignored", async () => {
    const core = new FakeCore({ "terminal.get": () => HOLD });
    const c = new Connection(core.client);
    const ac = new AbortController();
    const p = c.call("terminal.get", { terminal: "t1" }, { signal: ac.signal });
    const call = await core.waitFor("terminal.get");
    ac.abort();
    expect(await p.catch((e) => e)).toBeInstanceOf(CallAborted);
    core.reply(call.id, { address: "t1" });
    await sleep(5);
    expect(core.calls.map((x) => x.method)).toEqual(["terminal.get"]);
  });

  test("an already aborted signal sends nothing", async () => {
    const core = new FakeCore({});
    const c = new Connection(core.client);
    const ac = new AbortController();
    ac.abort();
    expect(await c.call("terminal.keys", {}, { signal: ac.signal }).catch((e) => e)).toBeInstanceOf(CallAborted);
    await sleep(5);
    expect(core.calls).toEqual([]);
  });

  test("aborting terminal.send sends $/cancelRequest with its id, and Core's answer decides", async () => {
    for (const mode of ["plain", "framed"] as const) {
      const core = new FakeCore({ hello: () => helloResult(undefined, mode === "framed"), "terminal.send": () => HOLD });
      const c = new Connection(core.client);
      await c.hello({ framed: mode === "framed" });
      const ac = new AbortController();
      const p = c.call("terminal.send", { terminal: "t1", text: "hi" }, { signal: ac.signal });
      const call = await core.waitFor("terminal.send");
      ac.abort();
      const cancel = await core.waitFor("$/cancelRequest");
      expect(cancel).toEqual({ id: undefined, method: "$/cancelRequest", params: { id: call.id } });
      core.refuse(call.id, "cancelled", "send cancelled before typing");
      const e = await p.catch((x) => x);
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).kind).toBe("cancelled");
    }
  });

  test("an aborted send that had started typing resolves with Core's result", async () => {
    const core = new FakeCore({ "terminal.send": () => HOLD });
    const c = new Connection(core.client);
    const ac = new AbortController();
    const p = c.call("terminal.send", { terminal: "t1", text: "hi" }, { signal: ac.signal });
    const call = await core.waitFor("terminal.send");
    ac.abort();
    await core.waitFor("$/cancelRequest");
    core.reply(call.id, { turn: 3, status: "idle", started: true });
    expect(await p).toEqual({ turn: 3, status: "idle", started: true });
  });

  test("stream frames that arrive before a listener are kept for it, in order", async () => {
    const core = new FakeCore({ hello: () => helloResult() });
    const c = new Connection(core.client);
    await c.hello({ framed: true });
    core.sendFrame(9, FRAME.DATA, bytes("a"));
    core.sendFrame(9, FRAME.RESIZE, new Uint8Array([100, 0, 30, 0]));
    core.sendFrame(9, FRAME.DATA, bytes("b"));
    await sleep(5);
    const got: number[] = [];
    c.channel(9).onFrame((f) => got.push(f.kind));
    expect(got).toEqual([FRAME.DATA, FRAME.RESIZE, FRAME.DATA]);
  });

  test("garbage from Core closes the connection as a transport failure", async () => {
    const core = new FakeCore({ "terminal.wait": () => HOLD });
    const c = new Connection(core.client);
    const p = c.call("terminal.wait");
    await core.waitFor("terminal.wait");
    core.raw(bytes("not json\n"));
    expect(await p.catch((e) => e)).toBeInstanceOf(TransportError);
    expect(c.closed).toBe(true);
  });
});
