import { describe, expect, test } from "bun:test";
import type { CoreInput, CoreTerminal, StoreState } from "@tremor/protocol";
import { loadFixtures, replay } from "@tremor/protocol/conformance";
import { attention, chat, engine, factory, openApprovals, relayEdges, sessionTree } from "../src/store/index.ts";

const C = "c0ffee0000000000000000000000000c";
const k = (a: string) => `${C}/${a}`;
const rec = (address: string, o: Partial<CoreTerminal> = {}): CoreTerminal =>
  ({ address, name: address, labels: {}, parent: null, state: "live", status: null, status_ms: null, reported: true, turn: 0, title: "", cwd: "/", argv: ["sh"], exit_code: null, signal: null, reason: null, keep: false, created_ms: 1, finished_ms: null, cols: 80, rows: 24, ...o }) as CoreTerminal;

let seq = 0;
const ev = (type: string, terminal: string, data: unknown): CoreInput => ({ t: 1000 + ++seq, source: "local", conn: "e1", kind: "notification", msg: { method: "event", params: { seq, type: type as "status", terminal, data } } });
function connected(terminals: CoreTerminal[], more: CoreInput[] = []): StoreState {
  const head: CoreInput[] = [
    { t: 1, source: "local", conn: "e1", kind: "connecting", attempt: 0 },
    { t: 2, source: "local", conn: "e1", kind: "hello", result: { core: { id: C, name: "x" }, generation: 1, version: "0.1.19", features: [] } },
    { t: 3, source: "local", conn: "e1", kind: "subscribed", result: { seq: 0, terminals, channel: null } },
  ];
  return replay(engine, [...head, ...more]);
}

describe("sessionTree", () => {
  test("leads by parent with workers nested, pinned first, then by start time", () => {
    seq = 0;
    const s = connected([
      rec("t1", { created_ms: 10 }),
      rec("t2", { parent: "t1", created_ms: 30 }),
      rec("t3", { parent: "t1", created_ms: 20 }),
      rec("t4", { created_ms: 40, labels: { "herdr.pinned": "1" } }),
      rec("t5", { parent: "t9", created_ms: 50 }), // its parent is not in view: shown as a lead
    ]);
    const tree = sessionTree(s);
    expect(tree.map((n) => n.terminal)).toEqual([k("t4"), k("t1"), k("t5")]);
    expect(tree[0]?.pinned).toBe(true);
    expect(tree[1]?.workers.map((n) => n.terminal)).toEqual([k("t3"), k("t2")]);
  });

  test("attention follows herdr.seen: blocked and error need you, working, done when turn > seen, else idle", () => {
    seq = 0;
    const s = connected([
      rec("t1", { status: { state: "blocked", kind: "permission" } }),
      rec("t2", { status: { state: "error" } }),
      rec("t3", { status: { state: "working" } }),
      rec("t4", { status: { state: "done" }, turn: 3, labels: { "herdr.seen": "2" } }),
      rec("t5", { status: { state: "done" }, turn: 3, labels: { "herdr.seen": "3" } }),
      rec("t6", { state: "finished", status: null }),
    ]);
    const got = Object.fromEntries(Object.values(s.terminals).map((t) => [t.address, attention(s, t)]));
    expect(got).toEqual({ t1: "needs-you", t2: "needs-you", t3: "working", t4: "done", t5: "idle", t6: "finished" });
  });

  test("a missing herdr.seen is not zero: an old turn is idle until Tremor sees a turn end", () => {
    seq = 0;
    const s0 = connected([rec("t1", { status: { state: "done" }, turn: 5 })]);
    expect(attention(s0, s0.terminals[k("t1")]!)).toBe("idle");
    seq = 0;
    const s1 = connected([rec("t1", { status: { state: "working" }, turn: 5 })], [ev("status", "t1", { status: { state: "done" }, records: {}, reported: true }), ev("turn", "t1", { turn: 6, state: "done" })]);
    expect(attention(s1, s1.terminals[k("t1")]!)).toBe("done");
  });

  test("without the label, Tremor's own settled markSeen decides", () => {
    seq = 0;
    const s = connected(
      [rec("t1", { status: { state: "done" }, turn: 2 })],
      [
        { t: 50, kind: "user", phase: "dispatched", clientId: "c", action: { type: "markSeen", terminal: k("t1"), turn: 2, actionId: "m1" } },
        { t: 51, kind: "user", phase: "settled", clientId: "c", actionId: "m1", outcome: { state: "done", detail: "" } },
      ],
    );
    expect(attention(s, s.terminals[k("t1")]!)).toBe("idle");
  });

  test("a non-numeric label is treated as missing", () => {
    seq = 0;
    const s = connected([rec("t1", { status: { state: "done" }, turn: 1, labels: { "herdr.seen": "yes" } })]);
    expect(attention(s, s.terminals[k("t1")]!)).toBe("idle");
  });
});

const fixture = (name: string) => {
  const dir = undefined; // all fixtures live in packages/protocol/fixtures
  const f = loadFixtures(dir).find((x) => x.name === name)!;
  return replay(engine, f.inputs);
};

describe("chat", () => {
  test("interleaves transcript, claimed messages, notes and pairs tool use with its result", () => {
    const s = fixture("transcript-fleet");
    const items = chat(s, "a7000000000000000000000000000007/t1");
    expect(items.map((i) => i.kind)).toEqual(["transcript", "transcript", "transcript", "message-in", "observation", "observation", "observation", "observation", "observation"]);
    const [, use, result, msg] = items;
    expect(use?.toolUseId).toBe("toolu_1");
    expect(result?.toolUseId).toBe("toolu_1");
    expect(msg?.sender).toBe("claimed");
    expect(msg?.event.type).toBe("message");
    expect(items.every((i) => i.trust === "untrusted")).toBe(true);
  });

  test("the sender's chat shows a claimed message as outgoing", () => {
    const s = fixture("transcript-fleet");
    const items = chat(s, "a7000000000000000000000000000007/t2").filter((i) => i.event.type === "message");
    expect(items.map((i) => i.kind)).toEqual(["message-out"]);
  });

  test("status bubbles, the approval card and composer messages with their outcomes", () => {
    const s = fixture("lifecycle-approval");
    const items = chat(s, "c0ffee0000000000000000000000000a/t1");
    const kinds = items.map((i) => i.kind);
    expect(kinds).toContain("bubble");
    expect(kinds).toContain("approval");
    const out = items.find((i) => i.kind === "message-out");
    expect(out?.sender).toBe("proven");
    expect(out?.text).toBe("Thanks. Wrap up.");
    expect(items.some((i) => i.event.type === "turn")).toBe(false);
  });

  test("child records are their own bubbles, and a gone record says so", () => {
    const s = fixture("missed-twice-records");
    const bubbles = chat(s, "a1000000000000000000000000000001/t1").filter((i) => i.kind === "bubble");
    expect(bubbles.map((b) => b.text)).toEqual(["build: working", "build: done", "test: working 40%", "test: working 60%", "test: gone", "idle"]);
  });
});

describe("relayEdges", () => {
  test("proven messages, claimed messages and observations are distinct edges with evidence", () => {
    const tx = fixture("transcript-fleet");
    const edges = relayEdges(tx, 0);
    const H = "a7000000000000000000000000000007";
    expect(edges.find((e) => e.kind === "claimed-message")).toMatchObject({ from: `${H}/t2`, to: `${H}/t1`, count: 1 });
    const obs = edges.filter((e) => e.kind === "observation");
    // hc's note and three fleet lines about t2, all for the lead; the REPORT line names no agent: no edge.
    expect(obs).toHaveLength(1);
    expect(obs[0]).toMatchObject({ from: `${H}/t2`, to: `${H}/t1`, count: 4 });
    expect(obs[0]?.evidence).toHaveLength(4);
    const life = relayEdges(fixture("lifecycle-approval"), 0);
    expect(life).toEqual([expect.objectContaining({ from: "person", to: "c0ffee0000000000000000000000000a/t1", kind: "message", count: 1, evidence: ["user:fixture-client:a2"] })]);
  });

  test("an observation with no recorded recipient ends at the rail, and sinceMs filters", () => {
    seq = 0;
    const s = connected(
      [rec("t1", { labels: { "stampede.job": "j", "stampede.agent": "w1" } })],
      [{ t: 5000, kind: "fleet", job: "j", file: "1:2:3", offset: 0, line: "TURN w1 done" }],
    );
    const edges = relayEdges(s, 0);
    expect(edges).toEqual([{ from: k("t1"), to: "observation-rail", kind: "observation", count: 1, lastAt: 5000, evidence: ["fleet:j:1:2:3:0"] }]);
    expect(relayEdges(s, 5001)).toEqual([]);
    expect(factory(s, 0).rail).toBe(true);
  });
});

describe("factory and openApprovals", () => {
  test("nodes carry parent and attention; the ticker is newest first and bounded", () => {
    const s = fixture("lifecycle-approval");
    const g = factory(s, 0);
    expect(g.nodes.map((n) => [n.terminal.split("/")[1], n.lead?.split("/")[1] ?? null, n.attention])).toEqual([
      ["t1", null, "finished"],
      ["t2", "t1", "finished"],
    ]);
    expect(g.rail).toBe(false);
    expect(g.ticker[0]?.key).toBe(s.activity[s.activity.length - 1]?.key);
    expect(g.ticker.length).toBeLessThanOrEqual(50);
  });

  test("open and in-flight requests, oldest first; resolved ones are gone", () => {
    expect(openApprovals(fixture("approval-voids"))).toEqual([]);
    const f = loadFixtures().find((x) => x.name === "approval-single-use")!;
    const mid = replay(engine, f.inputs.slice(0, 8));
    expect(openApprovals(mid).map((a) => [a.state, a.actionId])).toEqual([["in-flight", "a1"]]);
    const before = replay(engine, f.inputs.slice(0, 7));
    expect(openApprovals(before).map((a) => a.state)).toEqual(["open"]);
  });
});
