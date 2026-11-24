import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CoreInput, CoreTerminal } from "@tremor/protocol";
import { applyInputs, initial } from "../src/store/index.ts";
import { FRAME } from "../src/node/rpc.ts";
import { BACKOFF_MS, CoreSource, Recorder, backoffDelay, type CoreSourceOptions } from "../src/node/source.ts";
import { FakeCore, Refuse, helloResult, sleep, until } from "./fake-core.ts";

const CORE = "c0ffee0000000000000000000000000f";
const rec = (address: string, o: Partial<CoreTerminal> = {}) =>
  ({ address, name: null, labels: {}, parent: null, state: "live", status: null, status_ms: null, reported: true, turn: 0, title: "", cwd: "/", argv: ["sh"], exit_code: null, signal: null, reason: null, keep: false, created_ms: 1, finished_ms: null, cols: 80, rows: 24, ...o }) as CoreTerminal;
const blocked = { state: "blocked", kind: "permission", msg: "approve Bash: ls", app: "claude-code" };

/** A source over fake cores; each (re)connect makes a new one. */
function harness(over: Partial<CoreSourceOptions> = {}, setup: (core: FakeCore, n: number) => void = () => {}) {
  const cores: FakeCore[] = [];
  const inputs: CoreInput[] = [];
  let n = 0;
  const source = new CoreSource({
    connect: () => {
      const core = new FakeCore({
        hello: () => helloResult(CORE),
        "events.subscribe": () => ({ seq: 10, terminals: [], channel: 1 }),
        "doc.get": (p) => ({ value: { name: p.name }, version: 2 }),
        "terminal.get": (p) => rec(p.terminal as string, { status: blocked, status_ms: 500 }),
      });
      setup(core, n);
      cores.push(core);
      n++;
      return core.client;
    },
    emit: (i) => inputs.push(i),
    newConnId: () => `c${n}`,
    random: () => 0.5,
    ...over,
  });
  stops.push(() => source.stop());
  return { source, cores, inputs, kinds: () => inputs.map((i) => i.kind) };
}
const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const s of stops.splice(0)) await s();
});

describe("backoff", () => {
  test("0.5, 1, 2, 5, 10, then 30 s", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map((a) => backoffDelay(a, BACKOFF_MS, 0.2, () => 0.5))).toEqual([500, 1000, 2000, 5000, 10000, 30000, 30000, 30000]);
  });
  test("jitter stays within ±20%", () => {
    expect(backoffDelay(6, BACKOFF_MS, 0.2, () => 0)).toBe(24000);
    expect(backoffDelay(6, BACKOFF_MS, 0.2, () => 1)).toBe(36000);
  });
});

describe("CoreSource", () => {
  test("connects framed with generation 1, subscribes with the filter, records the snapshot then reads documents", async () => {
    const h = harness({ filter: { labels: { "tremor.test": "x" } } });
    h.source.start();
    await until(() => h.inputs.find((i) => i.kind === "doc"), 1000, "doc");
    const core = h.cores[0]!;
    expect(core.calls[0]).toMatchObject({ method: "hello", params: { framed: true, generation: 1 } });
    expect(core.calls[1]).toMatchObject({ method: "events.subscribe", params: { labels: { "tremor.test": "x" } } });
    expect(h.kinds()).toEqual(["connecting", "hello", "subscribed", "doc"]);
    expect(h.inputs[3]).toMatchObject({ kind: "doc", conn: "c0", name: "herdr-app", version: 2 });
    expect(h.source.coreId).toBe(CORE);
  });

  test("event lines split across frames become notification inputs, with CREDIT for consumed bytes", async () => {
    const h = harness();
    h.source.start();
    await until(() => h.source.connection, 1000, "live");
    const core = h.cores[0]!;
    const line = new TextEncoder().encode(`${JSON.stringify({ jsonrpc: "2.0", method: "event", params: { seq: 11, type: "title", terminal: "t1", data: { title: "x" } } })}\n${JSON.stringify({ jsonrpc: "2.0", method: "heartbeat", params: { seq: 11 } })}\n`);
    core.sendFrame(1, FRAME.DATA, line.subarray(0, 30));
    core.sendFrame(1, FRAME.DATA, line.subarray(30));
    await until(() => h.inputs.filter((i) => i.kind === "notification").length === 2, 1000, "notifications");
    const notes = h.inputs.filter((i): i is Extract<CoreInput, { kind: "notification" }> => i.kind === "notification");
    expect(notes.map((i) => i.msg.method)).toEqual(["event", "heartbeat"]);
    expect(notes[0]?.msg).toEqual({ method: "event", params: { seq: 11, type: "title", terminal: "t1", data: { title: "x" } } });
    await until(() => core.frames.filter((f) => f.kind === FRAME.CREDIT).length === 2, 1000, "credit");
    const credit = core.frames.filter((f) => f.kind === FRAME.CREDIT).map((f) => new DataView(f.payload.buffer, f.payload.byteOffset).getUint32(0, true));
    expect(credit).toEqual([30, line.length - 30]);
  });

  test("every blocked status gets a fresh terminal.get, recorded after the status", async () => {
    const h = harness();
    h.source.start();
    await until(() => h.source.connection, 1000, "live");
    h.cores[0]!.notify("event", { seq: 11, type: "status", terminal: "t1", data: { status: blocked, records: {}, reported: true } }, 1);
    await until(() => h.inputs.find((i) => i.kind === "terminal"), 1000, "terminal");
    expect(h.kinds().slice(-2)).toEqual(["notification", "terminal"]);
    expect(h.cores[0]!.calls.find((c) => c.method === "terminal.get")?.params).toEqual({ terminal: "t1" });
  });

  test("blocked terminals in a snapshot get one too, and missed re-reads documents", async () => {
    const h = harness({}, (core) => (core.handlers["events.subscribe"] = () => ({ seq: 10, terminals: [rec("t3", { status: blocked, status_ms: 9 })], channel: 1 })));
    h.source.start();
    await until(() => h.inputs.find((i) => i.kind === "terminal"), 1000, "terminal");
    h.cores[0]!.notify("missed", { seq: 40, terminals: [rec("t4", { status: blocked })] }, 1);
    await until(() => h.inputs.filter((i) => i.kind === "doc").length === 2 && h.inputs.filter((i) => i.kind === "terminal").length === 2, 1000, "re-reads");
    expect(h.cores[0]!.calls.filter((c) => c.method === "terminal.get").map((c) => c.params.terminal)).toEqual(["t3", "t4"]);
  });

  test("a doc event for a watched document re-reads it; other documents and other machines do not", async () => {
    const h = harness();
    h.source.start();
    await until(() => h.inputs.find((i) => i.kind === "doc"), 1000, "doc");
    const core = h.cores[0]!;
    core.notify("event", { seq: 11, type: "doc", data: { name: "other", version: 1 } }, 1);
    core.notify("event", { seq: 12, type: "doc", machine: "rohan", data: { name: "herdr-app", version: 1 } }, 1);
    core.notify("event", { seq: 13, type: "doc", data: { name: "herdr-app", version: 3 } }, 1);
    await until(() => h.inputs.filter((i) => i.kind === "doc").length === 2, 1000, "second doc");
    expect(core.calls.filter((c) => c.method === "doc.get").map((c) => c.params.name)).toEqual(["herdr-app", "herdr-app"]);
  });

  test("a transport failure reconnects with a new connection id and the backoff; the store ends live on the new one", async () => {
    const h = harness({ backoffMs: [20, 40] });
    h.source.start();
    await until(() => h.source.connection, 1000, "live");
    h.cores[0]!.hangUp("hc connect exited (code 1)");
    await until(() => h.inputs.filter((i) => i.kind === "subscribed").length === 2, 2000, "second subscribe");
    const closed = h.inputs.find((i) => i.kind === "closed");
    expect(closed).toMatchObject({ conn: "c0", attempt: 1, retryInMs: 20 });
    expect(String((closed as { reason: string }).reason)).toContain("hc connect exited");
    expect(h.inputs.filter((i) => i.kind === "connecting").map((i) => [i.conn, (i as { attempt: number }).attempt])).toEqual([
      ["c0", 0],
      ["c1", 1],
    ]);
    const state = initial();
    applyInputs(state, h.inputs);
    expect(state.sources.local).toMatchObject({ conn: "c1", connection: { state: "live" }, retired: ["c0"] });
  });

  test("failures in a row back off further; a successful subscribe resets the count", async () => {
    let refuse = 2;
    const h = harness({ backoffMs: [5, 10, 15] }, (core) => {
      if (refuse-- > 0) queueMicrotask(() => core.hangUp("spawn failed"));
    });
    h.source.start();
    await until(() => h.source.connection, 2000, "live");
    expect(h.inputs.filter((i) => i.kind === "closed").map((i) => [(i as { attempt: number }).attempt, (i as { retryInMs: number }).retryInMs])).toEqual([
      [1, 5],
      [2, 10],
    ]);
    h.cores[2]!.hangUp();
    await until(() => h.inputs.filter((i) => i.kind === "closed").length === 3, 2000, "third close");
    expect(h.inputs.filter((i) => i.kind === "closed").at(-1)).toMatchObject({ attempt: 1, retryInMs: 5 });
  });

  test("no message for the liveness window is a dead connection", async () => {
    const h = harness({ livenessMs: 40, backoffMs: [1000] });
    h.source.start();
    await until(() => h.inputs.find((i) => i.kind === "closed"), 1000, "closed");
    expect(String((h.inputs.find((i) => i.kind === "closed") as { reason: string }).reason)).toContain("no message from Core");
  });

  test("heartbeats keep it alive", async () => {
    const h = harness({ livenessMs: 60 });
    h.source.start();
    await until(() => h.source.connection, 1000, "live");
    for (let i = 0; i < 6; i++) {
      h.cores[0]!.notify("heartbeat", { seq: 10 }, 1);
      await sleep(25);
    }
    expect(h.kinds()).not.toContain("closed");
  });

  test("a refused hello or subscribe is an answer: offline, no reconnect", async () => {
    const h = harness({ backoffMs: [5] }, (core) => {
      core.handlers["events.subscribe"] = () => {
        throw new Refuse("not_found", "no terminal t9");
      };
    });
    h.source.start();
    await until(() => h.inputs.find((i) => i.kind === "offline"), 1000, "offline");
    await sleep(30);
    expect(h.kinds()).toEqual(["connecting", "hello", "offline"]);
    expect(h.cores).toHaveLength(1);
  });

  test("a generation other than 1 is refused", async () => {
    const h = harness({}, (core) => (core.handlers.hello = () => ({ ...helloResult(CORE), generation: 2 })));
    h.source.start();
    await until(() => h.inputs.find((i) => i.kind === "offline"), 1000, "offline");
    expect(String((h.inputs.at(-1) as { reason: string }).reason)).toContain("generation 2");
  });

  test("Core's error on a call does not drop the connection", async () => {
    const h = harness({}, (core) => {
      core.handlers["terminal.get"] = () => {
        throw new Refuse("not_found");
      };
    });
    h.source.start();
    await until(() => h.source.connection, 1000, "live");
    expect(await h.source.getTerminal("t9").catch((e) => e.kind)).toBe("not_found");
    await sleep(10);
    expect(h.kinds()).not.toContain("closed");
    expect(h.source.connection).not.toBeNull();
  });

  test("stop goes offline and never reconnects", async () => {
    const h = harness({ backoffMs: [5] });
    h.source.start();
    await until(() => h.source.connection, 1000, "live");
    await h.source.stop("app quit");
    await sleep(30);
    expect(h.kinds().slice(-1)).toEqual(["offline"]);
    expect(h.inputs.at(-1)).toMatchObject({ conn: "c0", reason: "app quit" });
    expect(h.cores).toHaveLength(1);
  });
});

test("Recorder writes inputs as fixture lines", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pdk-rec-"));
  const r = new Recorder(join(dir, "core.jsonl"));
  r.write({ t: 1, source: "local", conn: "e1", kind: "connecting", attempt: 0 });
  r.write({ t: 2, source: "local", conn: "e1", kind: "offline", reason: "x" });
  await r.close();
  const lines = readFileSync(join(dir, "core.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(lines.map((l) => l.kind)).toEqual(["connecting", "offline"]);
  rmSync(dir, { recursive: true });
});
