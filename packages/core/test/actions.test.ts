import { afterEach, describe, expect, test } from "bun:test";
import { IntentError, type CoreInput, type CoreTerminal } from "@tremor/protocol";
import { Store } from "../src/store/index.ts";
import { ActionService, orphanSettlements, type ConfirmRequest } from "../src/node/actions.ts";
import { CoreSource } from "../src/node/source.ts";
import { FakeCore, HOLD, Refuse, helloResult, sleep, until } from "./fake-core.ts";

const CORE = "c0ffee0000000000000000000000000a";
const K = `${CORE}/t1`;
const BLOCKED = { app: "claude-code", state: "blocked", kind: "permission", msg: "approve Write: /tmp/x" };
const APPROVAL = `approval:${K}:500`;
const rec = (o: Partial<CoreTerminal> = {}) =>
  ({ address: "t1", name: "agent", labels: {}, parent: null, state: "live", status: BLOCKED, status_ms: 500, reported: true, turn: 1, title: "", cwd: "/", argv: ["/opt/homebrew/bin/claude"], exit_code: null, signal: null, reason: null, keep: false, created_ms: 1, finished_ms: null, cols: 80, rows: 24, ...o }) as CoreTerminal;

type Handlers = ConstructorParameters<typeof FakeCore>[0];
const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const s of stops.splice(0)) await s();
});

async function setup(o: { snapshot?: CoreTerminal[]; handlers?: Handlers; confirm?: (r: ConfirmRequest) => Promise<boolean>; statusWaitMs?: number } = {}) {
  const store = new Store();
  const timeline: string[] = [];
  const recorded: CoreInput[] = [];
  const confirms: ConfirmRequest[] = [];
  const handlers: Handlers = {
    hello: () => helloResult(CORE),
    "events.subscribe": () => ({ seq: 10, terminals: o.snapshot ?? [rec()], channel: 1 }),
    "terminal.get": (p) => (o.snapshot ?? [rec()]).find((t) => t.address === p.terminal) ?? rec(),
    "terminal.keys": () => ({ status: "blocked", turn: 1 }),
    "terminal.send": () => ({ turn: 1, status: "idle", started: true }),
    "terminal.interrupt": () => ({ outcome: "stopped", key: "esc" }),
    "terminal.label": () => rec(),
    ...o.handlers,
  };
  const core: FakeCore = new FakeCore(Object.fromEntries(Object.entries(handlers ?? {}).map(([m, h]) => [m, (p: Record<string, unknown>, c: Parameters<NonNullable<Handlers>[string]>[1]) => (timeline.push(`core:${m}`), h(p, c))])));
  const source = new CoreSource({ connect: () => core.client, emit: (i) => (timeline.push(i.kind), store.apply(i)), newConnId: () => "e1", documents: [], backoffMs: [60_000] });
  stops.push(() => source.stop());
  source.start();
  await until(() => source.connection, 1000, "live");
  if ((o.snapshot ?? [rec()]).some((t) => t.status?.state === "blocked")) await until(() => Object.keys(store.state.approvals).length > 0, 1000, "approval");
  timeline.length = 0;
  let n = 0;
  const svc = new ActionService({
    clientId: "test",
    store,
    core: source,
    statusWaitMs: o.statusWaitMs ?? 80,
    newActionId: () => `a${++n}`,
    record: async (i) => {
      timeline.push(i.kind === "user" ? i.phase : i.kind);
      recorded.push(i);
      store.apply(i);
    },
    confirmer: {
      confirm: async (r) => {
        timeline.push("confirm");
        confirms.push(r);
        return o.confirm ? o.confirm(r) : true;
      },
    },
  });
  /** Core reports a new root status for t1 on the event stream. */
  const status = (seq: number, s: unknown) => core.notify("event", { seq, type: "status", terminal: "t1", data: { status: s, records: {}, reported: true } }, 1);
  return { store, core, source, svc, timeline, recorded, confirms, status };
}

const approve = (option = "Approve") => ({ type: "approve", approvalId: APPROVAL, option });

describe("approve", () => {
  test("confirm, record, fresh get, exact match, keys, then the terminal leaves the request: done and sent", async () => {
    const h = await setup({ handlers: { "terminal.keys": () => (setTimeout(() => h.status(11, { app: "claude-code", state: "working" }), 5), { status: "blocked", turn: 1 }) } });
    const out = await h.svc.act(approve());
    expect(out.state).toBe("done");
    expect(h.timeline).toEqual(["confirm", "dispatched", "core:terminal.get", "terminal", "core:terminal.keys", "notification", "settled"]);
    expect(h.core.calls.find((c) => c.method === "terminal.keys")?.params).toEqual({ terminal: "t1", keys: ["enter"] });
    expect(h.confirms[0]).toEqual({ kind: "approve", terminal: K, terminalName: "agent", action: "Approve: approve Write: /tmp/x" });
    expect(h.store.state.approvals[APPROVAL]?.state).toBe("sent");
  });

  test("a changed fingerprint sends nothing", async () => {
    // The same words, a new occurrence: Core's status_ms moved.
    const h = await setup();
    h.core.handlers["terminal.get"] = () => rec({ status_ms: 900 });
    const out = await h.svc.act(approve());
    expect(out.state).toBe("voided");
    expect(h.core.calls.some((c) => c.method === "terminal.keys")).toBe(false);
    expect(h.store.state.approvals[APPROVAL]?.state).toBe("voided");
  });

  test("a different message under the same status time is a different request", async () => {
    const h = await setup();
    h.core.handlers["terminal.get"] = () => rec({ status: { ...BLOCKED, msg: "approve Bash: rm -rf /" } });
    expect((await h.svc.act(approve())).state).toBe("voided");
    expect(h.core.calls.some((c) => c.method === "terminal.keys")).toBe(false);
  });

  test("a second approve is refused, while the first is confirming and after it", async () => {
    let release = (_: boolean) => {};
    const h = await setup({ confirm: () => new Promise((r) => (release = r)) });
    const first = h.svc.act(approve());
    await until(() => h.confirms.length === 1, 1000, "confirm");
    const second = await h.svc.act(approve("Deny"));
    expect(second).toEqual({ state: "refused", detail: "the request was already used" });
    expect(h.recorded).toEqual([]);
    release(true);
    h.core.handlers["terminal.keys"] = () => (setTimeout(() => h.status(11, { state: "working" }), 5), { status: "blocked", turn: 1 });
    expect((await first).state).toBe("done");
    expect((await h.svc.act(approve())).state).toBe("refused");
    expect(h.core.calls.filter((c) => c.method === "terminal.keys")).toHaveLength(1);
    expect(h.confirms).toHaveLength(1);
  });

  test("a declined confirmation sends nothing and spends the request", async () => {
    const h = await setup({ confirm: async () => false });
    const out = await h.svc.act(approve());
    expect(out).toEqual({ state: "refused", detail: "the person did not confirm" });
    expect(h.timeline).toEqual(["confirm", "dispatched", "settled"]);
    expect(h.store.state.approvals[APPROVAL]?.state).toBe("refused");
  });

  test("a confirmer that throws counts as declined", async () => {
    const h = await setup({ confirm: async () => Promise.reject(new Error("no Touch ID")) });
    expect((await h.svc.act(approve())).state).toBe("refused");
    expect(h.core.calls.some((c) => c.method === "terminal.keys")).toBe(false);
  });

  test("a broken transport during terminal.keys settles unknown, and nothing is retried", async () => {
    const h = await setup({ handlers: { "terminal.keys": () => HOLD } });
    const p = h.svc.act(approve());
    await h.core.waitFor("terminal.keys");
    h.core.hangUp("hc connect exited");
    const out = await p;
    expect(out.state).toBe("unknown");
    expect(out.detail).toContain("connection broke");
    await sleep(30);
    expect(h.core.calls.filter((c) => c.method === "terminal.keys")).toHaveLength(1);
    expect(h.store.state.approvals[APPROVAL]?.state).toBe("unknown");
  });

  test("keys typed but the status never moves: unknown after the wait", async () => {
    const h = await setup({ statusWaitMs: 40 });
    const out = await h.svc.act(approve());
    expect(out.state).toBe("unknown");
    expect(out.detail).toContain("did not change");
    expect(h.store.state.approvals[APPROVAL]?.state).toBe("unknown");
  });

  test("Core refusing the keys (it finished meanwhile) is refused, not unknown", async () => {
    const h = await setup({
      handlers: {
        "terminal.keys": () => {
          throw new Refuse("finished", "t1 has finished");
        },
      },
    });
    expect((await h.svc.act(approve())).state).toBe("refused");
  });

  test("a request voided while confirming is not sent", async () => {
    let release = (_: boolean) => {};
    const h = await setup({ confirm: () => new Promise((r) => (release = r)) });
    const p = h.svc.act(approve());
    await until(() => h.confirms.length === 1, 1000, "confirm");
    h.status(11, { state: "working" });
    await until(() => h.store.state.approvals[APPROVAL]?.state === "voided", 1000, "voided");
    release(true);
    expect((await p).state).toBe("voided");
    expect(h.core.calls.some((c) => c.method === "terminal.keys")).toBe(false);
  });

  test("an unknown option, a question with no buttons, and an unknown request are refused before any confirm", async () => {
    const h = await setup();
    expect((await h.svc.act(approve("Maybe"))).detail).toBe("not one of this request's options");
    expect((await h.svc.act({ type: "approve", approvalId: `approval:${K}:1`, option: "Approve" })).detail).toBe("no such request");
    expect(h.confirms).toEqual([]);
    const q = await setup({ snapshot: [rec({ status: { ...BLOCKED, kind: "question" } })] });
    expect((await q.svc.act(approve())).detail).toBe("not one of this request's options");
    // A shell that claims to be Claude gets no buttons: they come from argv, not from `app`.
    const sh = await setup({ snapshot: [rec({ argv: ["sh", "-c", "printf ..."] })] });
    expect((await sh.svc.act(approve())).detail).toBe("not one of this request's options");
  });

  test("every path records dispatched before its first Core call and settled after its last", async () => {
    const cases: [string, Parameters<typeof setup>[0], unknown][] = [
      ["approve", { handlers: { "terminal.keys": () => ({ status: "blocked", turn: 1 }) }, statusWaitMs: 10 }, approve()],
      ["send", { snapshot: [rec({ status: { state: "idle" } })] }, { type: "send", terminal: K, text: "hi", expectedStatus: "idle" }],
      ["interrupt", {}, { type: "interrupt", terminal: K }],
      ["markSeen", { snapshot: [rec({ status: { state: "done" }, turn: 2 })] }, { type: "markSeen", terminal: K, turn: 2 }],
      ["pin", {}, { type: "pin", terminal: K, pinned: true }],
    ];
    for (const [name, opts, intent] of cases) {
      const h = await setup(opts);
      await h.svc.act(intent);
      const user = h.timeline.filter((x) => x === "dispatched" || x === "settled" || x.startsWith("core:"));
      expect([name, user[0], user.at(-1)]).toEqual([name, "dispatched", "settled"]);
      expect(user.filter((x) => x.startsWith("core:")).length).toBeGreaterThan(0);
    }
  });
});

describe("send, interrupt, markSeen, pin", () => {
  const send = (expectedStatus: string, text = "hello") => ({ type: "send", terminal: K, text, expectedStatus });

  test("the composer guard: idle and working pass `if`, done sends without one", async () => {
    const h = await setup({ snapshot: [rec({ status: { state: "idle" } })] });
    expect((await h.svc.act(send("idle"))).state).toBe("done");
    expect((await h.svc.act(send("working"))).state).toBe("done");
    expect((await h.svc.act(send("done"))).detail).toBe("sent without a guard");
    expect(h.core.calls.filter((c) => c.method === "terminal.send").map((c) => c.params)).toEqual([
      { terminal: "t1", text: "hello", if: "idle" },
      { terminal: "t1", text: "hello", if: "working" },
      { terminal: "t1", text: "hello" },
    ]);
    expect(h.core.calls.some((c) => "force" in c.params)).toBe(false);
  });

  test("a blocked agent cannot be messaged; nothing reaches Core", async () => {
    const h = await setup();
    expect((await h.svc.act(send("idle"))).state).toBe("refused");
    expect(h.core.calls.some((c) => c.method === "terminal.send")).toBe(false);
  });

  test("Core's status_mismatch is refused; a finished or unknown terminal is refused in main", async () => {
    const h = await setup({
      snapshot: [rec({ status: { state: "working" } }), rec({ address: "t2", state: "finished", status: null })],
      handlers: {
        "terminal.send": () => {
          throw new Refuse("status_mismatch", "t1 is working, not idle");
        },
      },
    });
    expect(await h.svc.act(send("idle"))).toEqual({ state: "refused", detail: "status_mismatch: t1 is working, not idle" });
    expect((await h.svc.act({ ...send("done"), terminal: `${CORE}/t2` })).detail).toBe("the terminal has finished");
    expect((await h.svc.act({ ...send("done"), terminal: `${CORE}/t9` })).detail).toBe("no such terminal");
  });

  test("aborting a send asks Core to cancel; Core's cancelled answer settles cancelled", async () => {
    const h = await setup({ snapshot: [rec({ status: { state: "idle" } })], handlers: { "terminal.send": () => HOLD } });
    const ac = new AbortController();
    const p = h.svc.act(send("idle"), { signal: ac.signal });
    const call = await h.core.waitFor("terminal.send");
    ac.abort();
    await h.core.waitFor("$/cancelRequest");
    h.core.refuse(call.id, "cancelled", "send cancelled before typing");
    expect((await p).state).toBe("cancelled");
  });

  test("interrupt reports what Core saw", async () => {
    const h = await setup({ snapshot: [rec({ status: { state: "working" } })] });
    expect(await h.svc.act({ type: "interrupt", terminal: K })).toEqual({ state: "done", detail: "esc: stopped" });
  });

  test("markSeen only raises herdr.seen, and never above Core's turn", async () => {
    const h = await setup({ snapshot: [rec({ status: { state: "done" }, turn: 4, labels: { "herdr.seen": "3" } })] });
    expect((await h.svc.act({ type: "markSeen", terminal: K, turn: 5 })).detail).toBe("turn 5 is above Core's turn 4");
    expect((await h.svc.act({ type: "markSeen", terminal: K, turn: 3 })).state).toBe("refused");
    expect((await h.svc.act({ type: "markSeen", terminal: K, turn: 4 })).state).toBe("done");
    expect(h.core.calls.filter((c) => c.method === "terminal.label").map((c) => c.params)).toEqual([{ terminal: "t1", labels: { "herdr.seen": "4" } }]);
  });

  test("a missing label is joined by the first markSeen", async () => {
    const h = await setup({ snapshot: [rec({ status: { state: "done" }, turn: 2 })] });
    expect((await h.svc.act({ type: "markSeen", terminal: K, turn: 2 })).state).toBe("done");
  });

  test("pin writes herdr.pinned, unpin writes it empty", async () => {
    const h = await setup({ snapshot: [rec({ status: { state: "idle" } })] });
    await h.svc.act({ type: "pin", terminal: K, pinned: true });
    await h.svc.act({ type: "pin", terminal: K, pinned: false });
    expect(h.core.calls.filter((c) => c.method === "terminal.label").map((c) => c.params.labels)).toEqual([{ "herdr.pinned": "1" }, { "herdr.pinned": "" }]);
  });

  test("an invalid payload throws and records nothing", async () => {
    const h = await setup();
    await expect(h.svc.act({ type: "run", argv: ["rm", "-rf", "/"] })).rejects.toBeInstanceOf(IntentError);
    await expect(h.svc.act({ ...approve(), keys: ["enter"] })).rejects.toBeInstanceOf(IntentError);
    expect(h.recorded).toEqual([]);
  });

  test("after a disconnect actions are refused in main or settle unknown, never retried", async () => {
    const h = await setup({ snapshot: [rec({ status: { state: "idle" } })], handlers: { "terminal.send": () => HOLD } });
    const p = h.svc.act(send("idle"));
    await h.core.waitFor("terminal.send");
    h.core.hangUp();
    expect((await p).state).toBe("unknown");
    expect((await h.svc.act(send("idle"))).detail).toBe("not connected to Core");
    expect(h.core.calls.filter((c) => c.method === "terminal.send")).toHaveLength(1);
  });
});

test("orphanSettlements: an action dispatched but never settled reads unknown after a restart", async () => {
  const store = new Store();
  for (const i of [
    { t: 1, source: "local", conn: "e1", kind: "connecting", attempt: 0 },
    { t: 2, source: "local", conn: "e1", kind: "hello", result: helloResult(CORE) },
    { t: 3, source: "local", conn: "e1", kind: "subscribed", result: { seq: 0, terminals: [rec()], channel: 1 } },
    { t: 4, source: "local", conn: "e1", kind: "terminal", result: rec() },
    { t: 5, kind: "user", phase: "dispatched", clientId: "old", action: { ...approve(), actionId: "x1" } },
  ] as CoreInput[])
    store.apply(i);
  expect(store.state.approvals[APPROVAL]?.state).toBe("in-flight");
  const orphans = orphanSettlements(store.state, 99);
  expect(orphans).toEqual([{ t: 99, kind: "user", phase: "settled", clientId: "old", actionId: "x1", outcome: { state: "unknown", detail: "Tremor stopped before this action settled; it may have happened" } }]);
  for (const o of orphans) store.apply(o);
  expect(store.state.actions.x1?.outcome?.state).toBe("unknown");
  expect(store.state.approvals[APPROVAL]?.state).toBe("unknown");
  expect(orphanSettlements(store.state, 100)).toEqual([]);
});
