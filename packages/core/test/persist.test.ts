import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CoreInput } from "@tremor/protocol";
import { digestJson, loadFixtures, replay } from "@tremor/protocol/conformance";
import { Store, engine } from "../src/store/index.ts";
import { orphanSettlements } from "../src/node/actions.ts";
import { Persistor, RETENTION, prune } from "../src/node/persist.ts";
import { sleep } from "./fake-core.ts";

const INPUTS = loadFixtures().find((f) => f.name === "lifecycle-approval")!.inputs;
const WHOLE = digestJson(replay(engine, INPUTS));
const NOW = 1794170400000;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const fresh = () => {
  const d = mkdtempSync(join(tmpdir(), "pdk-persist-"));
  dirs.push(d);
  return d;
};
const files = (dir: string) => readdirSync(dir).sort();
const logText = (dir: string) => files(dir).filter((f) => f.startsWith("log-")).map((f) => readFileSync(join(dir, f), "utf8")).join("");

/** The host's loop: apply each input to the store and append it to the log. */
async function host(dir: string, flushMs = 100) {
  const { persistor, state, recovery } = await Persistor.open({ dir, flushMs, now: () => NOW });
  const store = new Store(state);
  const feed = (inputs: CoreInput[]) => Promise.all(inputs.map((i) => (store.apply(i), persistor.append(i))));
  return { persistor, store, recovery, feed };
}

describe("persistence", () => {
  test("a first run recovers nothing and records no gap", async () => {
    const h = await host(fresh());
    expect(h.recovery).toEqual({ checkpoint: null, badCheckpoints: [], replayed: 0, skippedLines: 0, historyGap: null });
    expect(h.store.state.historyGapAt).toBeNull();
  });

  test("the log alone brings the state back after a crash", async () => {
    const dir = fresh();
    const a = await host(dir);
    await a.feed(INPUTS);
    // crash: no close, no checkpoint
    const b = await host(dir);
    expect(b.recovery).toMatchObject({ checkpoint: null, replayed: INPUTS.length, historyGap: null });
    expect(digestJson(b.store.state)).toBe(WHOLE);
  });

  test("inputs are written in batches within flushMs; a dispatched input is on disk before append resolves", async () => {
    const dir = fresh();
    const h = await host(dir, 60);
    const status = INPUTS.find((i) => i.kind === "notification")!;
    void h.persistor.append(status);
    expect(logText(dir)).not.toContain('"notification"');
    await sleep(100);
    expect(logText(dir)).toContain('"notification"');
    const dispatched = INPUTS.find((i) => i.kind === "user" && i.phase === "dispatched")!;
    void h.persistor.append(INPUTS[0]!);
    await h.persistor.append(dispatched);
    expect(logText(dir)).toContain('"dispatched"');
    expect(logText(dir)).toContain('"connecting"');
  });

  test("checkpoint, then the log tail from its offset", async () => {
    const dir = fresh();
    const a = await host(dir);
    await a.feed(INPUTS.slice(0, 12));
    await a.persistor.checkpoint(a.store.state);
    await a.feed(INPUTS.slice(12));
    const b = await host(dir);
    expect(b.recovery).toMatchObject({ checkpoint: 1, replayed: INPUTS.length - 12, historyGap: null });
    expect(digestJson(b.store.state)).toBe(WHOLE);
  });

  test("inputs appended while a checkpoint is being written land after it", async () => {
    const dir = fresh();
    const a = await host(dir);
    await a.feed(INPUTS.slice(0, 10));
    const cp = a.persistor.checkpoint(a.store.state);
    const rest = a.feed(INPUTS.slice(10));
    await Promise.all([cp, rest]);
    const b = await host(dir);
    expect(digestJson(b.store.state)).toBe(WHOLE);
  });

  test("keeps the newest checkpoint and two previous; logs older than the oldest kept go", async () => {
    const dir = fresh();
    const a = await host(dir);
    for (let i = 0; i < 5; i++) {
      await a.feed(INPUTS.slice(i * 6, i * 6 + 6));
      await a.persistor.checkpoint(a.store.state);
    }
    await a.feed(INPUTS.slice(30));
    expect(files(dir)).toEqual(["checkpoint-00000003.json", "checkpoint-00000004.json", "checkpoint-00000005.json", "log-00000003.jsonl", "log-00000004.jsonl", "log-00000005.jsonl", "log-00000006.jsonl"]);
    const b = await host(dir);
    expect(b.recovery.checkpoint).toBe(5);
    expect(digestJson(b.store.state)).toBe(WHOLE);
  });

  test("a truncated last line is ignored", async () => {
    const dir = fresh();
    const a = await host(dir);
    await a.feed(INPUTS);
    const log = files(dir).filter((f) => f.startsWith("log-")).at(-1)!;
    appendFileSync(join(dir, log), '{"t": 1794170399999, "source": "local", "conn": "e2", "kind": "notifi');
    const b = await host(dir);
    expect(b.recovery.skippedLines).toBe(1);
    expect(digestJson(b.store.state)).toBe(WHOLE);
    // and the next run appends to a new log, never after the cut line
    expect(b.persistor.generation).toBeGreaterThan(Number(/\d+/.exec(log)![0]));
  });

  test("a corrupt checkpoint falls back to the previous one and the logs after it", async () => {
    const dir = fresh();
    const a = await host(dir);
    await a.feed(INPUTS.slice(0, 10));
    await a.persistor.checkpoint(a.store.state);
    await a.feed(INPUTS.slice(10, 20));
    await a.persistor.checkpoint(a.store.state);
    await a.feed(INPUTS.slice(20));
    writeFileSync(join(dir, "checkpoint-00000002.json"), '{"tremor":"checkpoint","version":1,"generation":2,"offset":12,"state":{"sources":');
    const b = await host(dir);
    expect(b.recovery).toMatchObject({ checkpoint: 1, badCheckpoints: [2], historyGap: null });
    expect(digestJson(b.store.state)).toBe(WHOLE);
  });

  test("a checkpoint of another version or generation is not used", async () => {
    const dir = fresh();
    const a = await host(dir);
    await a.feed(INPUTS.slice(0, 10));
    await a.persistor.checkpoint(a.store.state);
    await a.feed(INPUTS.slice(10));
    const cp = JSON.parse(readFileSync(join(dir, "checkpoint-00000001.json"), "utf8"));
    writeFileSync(join(dir, "checkpoint-00000001.json"), JSON.stringify({ ...cp, version: 99 }));
    const b = await host(dir);
    expect(b.recovery.badCheckpoints).toEqual([1]);
  });

  test("no valid checkpoint: start from what the logs hold and record a history gap", async () => {
    const dir = fresh();
    const a = await host(dir);
    for (let i = 0; i < 4; i++) {
      await a.feed(INPUTS.slice(i * 8, i * 8 + 8));
      await a.persistor.checkpoint(a.store.state);
    }
    await a.feed(INPUTS.slice(32));
    for (const f of files(dir).filter((x) => x.startsWith("checkpoint-"))) writeFileSync(join(dir, f), "{}");
    const b = await host(dir);
    expect(b.recovery.checkpoint).toBeNull();
    expect(b.recovery.historyGap).toBe("no usable checkpoint");
    // Everything before the recovery, the remaining log included, reads as incomplete history.
    expect(b.store.state.historyGapAt).toBe(NOW);
    // What came before the oldest remaining log is not invented.
    expect(b.store.state.activity.length).toBeLessThan(replay(engine, INPUTS).activity.length);
    // The gap is a logged input, so a restart without any checkpoint replays it too...
    expect(logText(dir)).toContain('"kind":"history-gap","reason":"no usable checkpoint"');
    const c = await host(dir);
    expect(c.store.state.historyGapAt).toBe(NOW);
    expect(c.recovery.historyGap).toBe("no usable checkpoint");
    // ...and a checkpoint carries it.
    await c.persistor.checkpoint(c.store.state);
    const d = await host(dir);
    expect(d.recovery.historyGap).toBeNull();
    expect(d.store.state.historyGapAt).toBe(NOW);
  });

  test("a leftover temporary checkpoint is ignored", async () => {
    const dir = fresh();
    const a = await host(dir);
    await a.feed(INPUTS);
    writeFileSync(join(dir, "checkpoint-00000007.json.tmp"), "half a checkp");
    const b = await host(dir);
    expect(b.recovery.badCheckpoints).toEqual([]);
    expect(digestJson(b.store.state)).toBe(WHOLE);
  });

  test("a crash between dispatch and settle reads unknown after restart", async () => {
    const dir = fresh();
    const a = await host(dir);
    const upToDispatch = INPUTS.findIndex((i) => i.kind === "user" && i.phase === "dispatched");
    await a.feed(INPUTS.slice(0, upToDispatch + 1));
    const b = await host(dir);
    expect(b.store.state.approvals["approval:c0ffee0000000000000000000000000a/t1:1794170357600"]?.state).toBe("in-flight");
    for (const o of orphanSettlements(b.store.state, 1794170400000)) {
      b.store.apply(o);
      await b.persistor.append(o);
    }
    expect(b.store.state.actions.a1?.outcome?.state).toBe("unknown");
    expect(b.store.state.approvals["approval:c0ffee0000000000000000000000000a/t1:1794170357600"]?.state).toBe("unknown");
    const c = await host(dir);
    expect(c.store.state.actions.a1?.outcome?.state).toBe("unknown");
  });
});

describe("retention", () => {
  const state = replay(engine, INPUTS);
  const last = INPUTS.at(-1)!.t;

  test("nothing inside the window is pruned", () => expect(prune(state, last)).toBe(state));

  test("items older than 14 days leave with their dedupe keys; open approvals stay", () => {
    const s = prune(state, last + RETENTION.maxAgeMs + 1);
    expect(s.activity).toEqual([]);
    expect(s.seen).toEqual({});
    expect(s.approvals).toEqual({});
    expect(Object.keys(s.terminals).length).toBe(2);
    const open = replay(engine, INPUTS.slice(0, 10));
    expect(Object.values(prune(open, last + RETENTION.maxAgeMs + 1).approvals).map((a) => a.state)).toEqual(["open"]);
  });

  test("at most maxItems per source, newest kept", () => {
    const s = prune(state, last, { maxAgeMs: RETENTION.maxAgeMs, maxItems: 3 });
    const core = s.activity.filter((e) => e.provenance.kind === "core" || e.provenance.kind === "get");
    expect(core.map((e) => e.key)).toEqual(state.activity.filter((e) => e.provenance.kind === "core" || e.provenance.kind === "get").slice(-3).map((e) => e.key));
    expect(s.activity.filter((e) => e.provenance.kind === "user")).toHaveLength(3);
    for (const e of state.activity) expect(Boolean(s.seen[e.key])).toBe(s.activity.includes(e));
  });
});
