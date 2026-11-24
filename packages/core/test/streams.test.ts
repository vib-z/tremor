import { describe, expect, test } from "bun:test";
import type { StreamFrame } from "@tremor/protocol";
import { Connection, FRAME } from "../src/node/rpc.ts";
import { TakeoverRefused, openStream } from "../src/node/streams.ts";
import { FakeCore, helloResult, sleep, until } from "./fake-core.ts";

const bytes = (s: string) => new TextEncoder().encode(s);
const u32 = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true);

async function setup(o: { features?: string[]; attach?: Record<string, unknown> } = {}) {
  const core = new FakeCore({});
  const ch = core.channel();
  core.handlers.hello = () => helloResult(undefined, true, o.features);
  core.handlers["terminal.attach"] = () => ({ channel: ch, terminal: { address: "t1" }, resize_notifications: true, automatic_input: true, ...o.attach });
  const connection = new Connection(core.client);
  const hello = await connection.hello({ framed: true, generation: 1 });
  const confirms: string[] = [];
  const open = (mode: "observe" | "active", confirm = true, idleMs?: number) =>
    openStream({ connection, hello, terminal: "c/t1", address: "t1", mode, cols: 100, rows: 30, confirmer: { confirm: async (r) => (confirms.push(r.action), confirm) }, ...(idleMs ? { idleMs } : {}) });
  const sent = (kind: number) => core.frames.filter((f) => f.channel === ch && f.kind === kind);
  return { core, ch, connection, open, confirms, sent };
}

describe("streams", () => {
  test("observe by default: attach asks to observe, with resize notifications when Core has them", async () => {
    const h = await setup();
    const s = await h.open("observe");
    expect(h.core.calls.find((c) => c.method === "terminal.attach")?.params).toEqual({ terminal: "t1", cols: 100, rows: 30, observe: true, resize_notifications: true });
    expect(s.mode).toBe("observe");
    expect(s.capabilities).toEqual({ automaticInput: true, resizeNotifications: true });
    expect(h.confirms).toEqual([]);
  });

  test("frames arrive in Core's order, a RESIZE before later DATA, including frames that came before a listener", async () => {
    const h = await setup();
    const s = await h.open("observe");
    h.core.sendFrame(h.ch, FRAME.DATA, bytes("paint"));
    h.core.sendFrame(h.ch, FRAME.RESIZE, new Uint8Array([120, 0, 40, 0]));
    h.core.sendFrame(h.ch, FRAME.DATA, bytes("after"));
    await sleep(5);
    const got: StreamFrame[] = [];
    s.onFrame((f) => got.push(f));
    expect(got.map((f) => (f.kind === "data" ? `data:${new TextDecoder().decode(f.bytes)}` : f.kind === "resize" ? `resize:${f.cols}x${f.rows}` : f.kind))).toEqual(["data:paint", "resize:120x40", "data:after"]);
    expect(got.map((f) => f.seq)).toEqual([1, 2, 3]);
  });

  test("CREDIT only for bytes the emulator reported consumed, once each", async () => {
    const h = await setup();
    const s = await h.open("observe");
    const got: StreamFrame[] = [];
    s.onFrame((f) => got.push(f));
    h.core.sendFrame(h.ch, FRAME.DATA, bytes("12345"));
    h.core.sendFrame(h.ch, FRAME.RESIZE, new Uint8Array([80, 0, 24, 0]));
    h.core.sendFrame(h.ch, FRAME.DATA, bytes("abc"));
    await until(() => got.length === 3, 1000, "frames");
    await sleep(5);
    expect(h.sent(FRAME.CREDIT)).toEqual([]);
    s.consumed(3);
    s.consumed(2); // a resize carries no credit
    s.consumed(3);
    s.consumed(99);
    await sleep(5);
    expect(h.sent(FRAME.CREDIT).map((f) => u32(f.payload))).toEqual([3]);
    s.consumed(1);
    await sleep(5);
    expect(h.sent(FRAME.CREDIT).map((f) => u32(f.payload))).toEqual([3, 5]);
  });

  test("an observer's writes and resizes are dropped in main", async () => {
    const h = await setup();
    const s = await h.open("observe");
    s.write(bytes("rm -rf /\r"), "human");
    s.write(bytes("\x1b[?1;2c"), "automatic");
    s.resize(200, 50);
    await sleep(5);
    expect(h.sent(FRAME.DATA)).toEqual([]);
    expect(h.sent(FRAME.AUTOMATIC_INPUT)).toEqual([]);
    expect(h.sent(FRAME.RESIZE)).toEqual([]);
    expect(s.dropped).toBe(3);
  });

  test("takeover needs the person's confirmation; declined, nothing attaches", async () => {
    const h = await setup();
    await expect(h.open("active", false)).rejects.toBeInstanceOf(TakeoverRefused);
    expect(h.core.calls.some((c) => c.method === "terminal.attach")).toBe(false);
    expect(h.confirms).toEqual(["Take over t1: what you type goes to its program"]);
  });

  test("an active viewer types as DATA; query replies go as AUTOMATIC_INPUT only when hello and attach both say so", async () => {
    const both = await setup();
    const a = await both.open("active");
    expect(both.core.calls.find((c) => c.method === "terminal.attach")?.params.observe).toBe(false);
    a.write(bytes("ls\r"), "human");
    a.write(bytes("\x1b[0n"), "automatic");
    a.resize(90, 20);
    await sleep(5);
    expect(both.sent(FRAME.DATA).map((f) => new TextDecoder().decode(f.payload))).toEqual(["ls\r"]);
    expect(both.sent(FRAME.AUTOMATIC_INPUT).map((f) => new TextDecoder().decode(f.payload))).toEqual(["\x1b[0n"]);
    expect([...(both.sent(FRAME.RESIZE)[0]?.payload ?? [])]).toEqual([90, 0, 20, 0]);
    a.close();

    for (const [features, attach] of [
      [["framed", "attach"], { automatic_input: true }],
      [undefined, { automatic_input: false }],
      [undefined, { automatic_input: undefined }],
    ] as const) {
      const h = await setup({ ...(features ? { features: [...features] } : {}), attach });
      const s = await h.open("active");
      expect(s.capabilities.automaticInput).toBe(false);
      s.write(bytes("\x1b[0n"), "automatic");
      await sleep(5);
      expect(h.sent(FRAME.AUTOMATIC_INPUT)).toEqual([]);
      expect(h.sent(FRAME.DATA)).toHaveLength(1);
    }
  });

  test("Core's CLOSE ends the stream with the program's exit", async () => {
    const h = await setup();
    const s = await h.open("observe");
    const got: StreamFrame[] = [];
    s.onFrame((f) => got.push(f));
    h.core.sendFrame(h.ch, FRAME.CLOSE, bytes('{"reason":"exited","exit_code":0,"signal":null}'));
    await until(() => got.length === 1, 1000, "close");
    expect(got[0]).toMatchObject({ kind: "close", reason: "exited", exitCode: 0, signal: null });
    h.core.sendFrame(h.ch, FRAME.DATA, bytes("late"));
    await sleep(5);
    expect(got).toHaveLength(1);
  });

  test("closing sends CLOSE once; a dropped connection closes the stream", async () => {
    const h = await setup();
    const s = await h.open("observe");
    s.close();
    s.close();
    await sleep(5);
    expect(h.sent(FRAME.CLOSE)).toHaveLength(1);
    const s2 = await h.open("observe");
    const got: StreamFrame[] = [];
    s2.onFrame((f) => got.push(f));
    h.core.hangUp();
    await until(() => got.length === 1, 1000, "close");
    expect(got[0]?.kind).toBe("close");
  });

  test("a takeover ends after the idle window without human input", async () => {
    const h = await setup();
    const s = await h.open("active", true, 40);
    const got: StreamFrame[] = [];
    s.onFrame((f) => got.push(f));
    s.write(bytes("a"), "human");
    await sleep(25);
    s.write(bytes("\x1b[0n"), "automatic"); // a query reply is not a person
    await until(() => got.some((f) => f.kind === "close"), 1000, "idle close");
    expect(got.at(-1)).toMatchObject({ kind: "close", reason: "takeover ended: no input for 40 ms" });
    await sleep(5);
    expect(h.sent(FRAME.CLOSE)).toHaveLength(1);
  });
});
