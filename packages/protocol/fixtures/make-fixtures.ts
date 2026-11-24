// Writes packages/core/test/fixtures/<name>/{core.jsonl,expected.json}: `bun packages/core/test/fixtures/make-fixtures.ts`.
// Inputs come from helpers; every expected digest below is written by hand from the rules. Nothing here imports the engine.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL(".", import.meta.url));
const FEATURES = ["framed", "attach", "events", "status", "shell", "resize_notifications", "automatic_input"];

type J = Record<string, unknown>;
const rec = (address: string, o: J = {}): J => ({
  address, name: null, labels: {}, parent: null, state: "live", status: null, status_ms: null, reported: false, turn: 0, title: "",
  cwd: "/tmp/w", argv: ["sh"], exit_code: null, signal: null, reason: null, keep: false, created_ms: 0, finished_ms: null, cols: 80, rows: 24, pid: 1, ...o,
});
const term = (o: J): J => ({ state: "live", status: null, statusMs: null, records: {}, foreground: null, turn: 0, title: "", parentKey: null, gone: false, labels: {}, ...o });

function inputs(source = "local") {
  const lines: J[] = [];
  const s = (t: number, conn: string, kind: string, rest: J) => lines.push({ t, source, conn, kind, ...rest });
  return {
    lines,
    connecting: (t: number, conn: string, attempt: number) => s(t, conn, "connecting", { attempt }),
    hello: (t: number, conn: string, id: string) => s(t, conn, "hello", { result: { core: { id, name: "fixture" }, generation: 1, version: "0.1.19", features: FEATURES } }),
    subscribed: (t: number, conn: string, seq: number, terminals: J[]) => s(t, conn, "subscribed", { result: { seq, terminals, channel: 1 } }),
    doc: (t: number, conn: string, version: number, value: unknown) => s(t, conn, "doc", { name: "herdr-app", version, value }),
    event: (t: number, conn: string, seq: number, type: string, terminal: string, data: unknown) => s(t, conn, "notification", { msg: { method: "event", params: { seq, type, terminal, data } } }),
    heartbeat: (t: number, conn: string, seq: number) => s(t, conn, "notification", { msg: { method: "heartbeat", params: { seq } } }),
    missed: (t: number, conn: string, seq: number, terminals: J[]) => s(t, conn, "notification", { msg: { method: "missed", params: { seq, terminals } } }),
    get: (t: number, conn: string, result: J) => s(t, conn, "terminal", { result }),
    closed: (t: number, conn: string, attempt: number, retryInMs: number) => s(t, conn, "closed", { reason: "hc connect exited", attempt, retryInMs }),
    dispatched: (t: number, clientId: string, action: J) => lines.push({ t, kind: "user", phase: "dispatched", clientId, action }),
    settled: (t: number, clientId: string, actionId: string, state: string, detail: string) => lines.push({ t, kind: "user", phase: "settled", clientId, actionId, outcome: { state, detail } }),
    transcript: (t: number, terminal: string, file: string, line: number, entry: J) => lines.push({ t, kind: "transcript", terminal, file, line, entry }),
    fleet: (t: number, job: string, file: string, offset: number, line: string) => lines.push({ t, kind: "fleet", job, file, offset, line }),
    historyGap: (t: number, reason: string) => lines.push({ t, kind: "history-gap", reason }),
  };
}

const base = (o: J) => ({ sources: {}, terminals: {}, activity: [], messages: [], approvals: {}, actions: {}, cursors: {}, docs: { local: { "herdr-app": 1 } }, historyGapAt: null, ...o });

function write(name: string, description: string, lines: J[], digest: J) {
  const dir = join(OUT, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "core.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  writeFileSync(join(dir, "expected.json"), JSON.stringify({ description, digest }, null, 2) + "\n");
}

// ---------------------------------------------------------------- missed-twice-records
{
  const A = "a1000000000000000000000000000001", T = 1794300000000, k = (a: string) => `${A}/${a}`;
  const i = inputs();
  const W = { app: "claude-code", state: "working" }, D = { app: "claude-code", state: "done" };
  const lbl = { "tremor.test": "f1" };
  const t1 = (o: J = {}) => rec("t1", { name: "lead", labels: lbl, status: W, status_ms: T - 5000, reported: true, title: "Build", argv: ["claude"], created_ms: T - 9000, ...o });
  i.connecting(T, "e1", 0);
  i.hello(T + 10, "e1", A);
  i.subscribed(T + 20, "e1", 10, [t1()]);
  i.doc(T + 25, "e1", 1, { spaces: [] });
  i.event(T + 1000, "e1", 11, "status", "t1", { status: W, records: { build: { state: "working" } }, reported: true });
  i.event(T + 2000, "e1", 12, "status", "t1", { status: W, records: { build: { state: "done" }, test: { state: "working", progress: 40 } }, reported: true });
  i.missed(T + 3000, "e1", 20, [t1({ status: D, status_ms: T + 2500, turn: 1, records: { test: { state: "working", progress: 40 } } })]);
  i.doc(T + 3010, "e1", 2, { spaces: [{ id: "s1" }] });
  i.event(T + 3020, "e1", 15, "title", "t1", { title: "stale" });
  i.event(T + 4000, "e1", 21, "status", "t1", { status: D, records: { test: { state: "working", progress: 60 } }, reported: true });
  i.event(T + 5000, "e1", 22, "status", "t1", { status: D, records: {}, reported: true });
  i.missed(T + 6000, "e1", 30, [t1({ status: D, status_ms: T + 2500, turn: 1 }), rec("t2", { name: "helper", parent: "t1", labels: lbl, argv: ["sh", "-c", "true"], created_ms: T + 5500 })]);
  i.doc(T + 6010, "e1", 2, { spaces: [{ id: "s1" }] });
  i.event(T + 7000, "e1", 31, "status", "t1", { status: { app: "claude-code", state: "idle" }, records: {}, reported: true });
  i.heartbeat(T + 8000, "e1", 31);
  write(
    "missed-twice-records",
    "Two `missed` snapshots in one connection give two gaps keyed by their own seq: the first finds a changed status (one gap, no status activity), the second a terminal that appeared. Child 7501 records change, get added and disappear (status activity per record id, `gone` when it went); a root status that did not change adds no activity. An event at or below the missed seq is dropped. Documents are re-read after each missed; an older version never replaces a newer one.",
    i.lines,
    base({
      sources: { local: { connection: "live", coreId: A, conn: "e1", lastSeq: 31 } },
      terminals: {
        [k("t1")]: term({ status: { app: "claude-code", state: "idle" }, statusMs: T + 2500, turn: 1, title: "Build", labels: lbl }),
        [k("t2")]: term({ parentKey: k("t1"), labels: lbl }),
      },
      activity: [
        `status core:${A}:e1:11:rec:build ${T + 1000} working@build||`,
        `status core:${A}:e1:12:rec:build ${T + 2000} done@build||`,
        `status core:${A}:e1:12:rec:test ${T + 2000} working@test||`,
        `observation gap:${A}:e1:20:t1:status ${T + 3000} gap:${k("t1")}>:while events were missed: status now done`,
        `status core:${A}:e1:21:rec:test ${T + 4000} working@test||`,
        `status core:${A}:e1:22:rec:test ${T + 5000} null@test gone||`,
        `observation gap:${A}:e1:30:t2:appeared ${T + 6000} gap:${k("t2")}>:while events were missed: started`,
        `status core:${A}:e1:31 ${T + 7000} idle||`,
      ],
      docs: { local: { "herdr-app": 2 } },
    }),
  );
}

// ---------------------------------------------------------------- kept-lost-restarted
{
  const B = "b2000000000000000000000000000002", T = 1794310000000, k = (a: string) => `${B}/${a}`;
  const i = inputs();
  const lbl = { "tremor.test": "f2" };
  i.connecting(T, "e1", 0);
  i.hello(T + 10, "e1", B);
  i.subscribed(T + 20, "e1", 0, []);
  i.doc(T + 25, "e1", 0, null);
  i.event(T + 100, "e1", 1, "created", "t1", rec("t1", { name: "keeper", labels: lbl, keep: true, argv: ["sh", "-c", "sleep 600"], created_ms: T + 100, pid: 100 }));
  i.event(T + 200, "e1", 2, "status", "t1", { status: { state: "working" }, records: {}, reported: true });
  i.event(T + 300, "e1", 3, "foreground", "t1", { pid: 100, name: "sleep", argv: ["sleep", "600"], cwd: "/tmp/w" });
  i.event(T + 400, "e1", 4, "status", "t1", { status: null, records: {}, reported: true });
  i.event(T + 401, "e1", 5, "turn", "t1", { turn: 1, state: null });
  i.event(T + 402, "e1", 6, "lost", "t1", { reason: "signaled", exit_code: null, signal: 9, finished_ms: null });
  i.event(T + 2000, "e1", 7, "restarted", "t1", rec("t1", { name: "keeper", labels: lbl, keep: true, argv: ["/bin/zsh"], created_ms: T + 100, pid: 101, status_ms: T + 400, reported: true, turn: 1 }));
  i.event(T + 2100, "e1", 8, "foreground", "t1", { pid: 101, name: "zsh", argv: ["/bin/zsh"], cwd: "/tmp/w" });
  i.event(T + 3000, "e1", 9, "lost", "t1", { reason: "signaled", exit_code: null, signal: 15, finished_ms: null });
  i.event(T + 3100, "e1", 10, "keep", "t1", { keep: true });
  i.heartbeat(T + 4000, "e1", 10);
  write(
    "kept-lost-restarted",
    "A kept terminal: its working program dies (status cleared, then a turn whose state is null, then `lost`, which clears the foreground and keeps it live), Core restarts it with a shell (`restarted` replaces the record), and it is lost again in the same turn: two loss occurrences, two activities.",
    i.lines,
    base({
      sources: { local: { connection: "live", coreId: B, conn: "e1", lastSeq: 10 } },
      terminals: { [k("t1")]: term({ statusMs: T + 400, turn: 1, labels: lbl }) },
      activity: [
        `lifecycle core:${B}:e1:1 ${T + 100} created:::`,
        `status core:${B}:e1:2 ${T + 200} working||`,
        `turn core:${B}:e1:5 ${T + 401} 1:null`,
        `lifecycle core:${B}:e1:6 ${T + 402} lost:signaled::9`,
        `lifecycle core:${B}:e1:7 ${T + 2000} restarted:::`,
        `lifecycle core:${B}:e1:9 ${T + 3000} lost:signaled::15`,
      ],
      docs: { local: { "herdr-app": 0 } },
    }),
  );
}

// ---------------------------------------------------------------- core-changed
{
  const C1 = "c3000000000000000000000000000031", C2 = "c3000000000000000000000000000032", T = 1794320000000;
  const i = inputs();
  const lbl = { "tremor.test": "f3", "herdr.seen": "1" };
  i.connecting(T, "e1", 0);
  i.hello(T + 10, "e1", C1);
  i.subscribed(T + 20, "e1", 5, [
    rec("t1", { name: "lead", labels: lbl, status: { state: "idle" }, status_ms: T - 100, reported: true, turn: 1, created_ms: T - 1000 }),
    rec("t2", { name: "helper", labels: lbl, parent: "t1", state: "finished", reason: "exited", exit_code: 0, finished_ms: T - 50, created_ms: T - 900, pid: null }),
  ]);
  i.doc(T + 25, "e1", 4, { a: 1 });
  i.closed(T + 1000, "e1", 1, 500);
  i.connecting(T + 1500, "e2", 1);
  i.hello(T + 1510, "e2", C2);
  i.subscribed(T + 1520, "e2", 0, [rec("t1", { name: "fresh", labels: { "tremor.test": "f3" }, created_ms: T + 1400 })]);
  i.doc(T + 1525, "e2", 1, { b: 2 });
  i.event(T + 2000, "e2", 1, "status", "t1", { status: { state: "working" }, records: {}, reported: true });
  i.event(T + 2500, "e1", 6, "status", "t1", { status: { state: "done" }, records: {}, reported: true });
  write(
    "core-changed",
    "After a reconnect a different core id answers: the old core's terminals are kept as history and marked gone (one gap for the live one, none for the finished one), its documents are dropped (the new core's versions start again), and the new core's t1 is a different terminal. A late line from the retired connection is dropped.",
    i.lines,
    base({
      sources: { local: { connection: "live", coreId: C2, conn: "e2", lastSeq: 1 } },
      terminals: {
        [`${C1}/t1`]: term({ status: { state: "idle" }, statusMs: T - 100, turn: 1, gone: true, labels: lbl }),
        [`${C1}/t2`]: term({ state: "finished", parentKey: `${C1}/t1`, gone: true, labels: lbl }),
        [`${C2}/t1`]: term({ status: { state: "working" }, labels: { "tremor.test": "f3" } }),
      },
      activity: [`observation gap:${C1}:e2:0:t1:gone ${T + 1510} gap:${C1}/t1>:its core went away: core ${C2} answered instead`, `status core:${C2}:e2:1 ${T + 2000} working||`],
    }),
  );
}

// ---------------------------------------------------------------- status-while-disconnected
{
  const D = "d4000000000000000000000000000004", T = 1794330000000, k = `${D}/t1`;
  const i = inputs();
  const lbl = { "tremor.test": "f4" };
  i.connecting(T, "e1", 0);
  i.hello(T + 10, "e1", D);
  i.subscribed(T + 20, "e1", 3, [rec("t1", { labels: lbl, status: { app: "codex", state: "working" }, status_ms: T - 200, reported: true, turn: 2, created_ms: T - 5000 })]);
  i.doc(T + 25, "e1", 1, {});
  i.event(T + 500, "e1", 4, "title", "t1", { title: "Refactor" });
  i.closed(T + 1000, "e1", 1, 500);
  i.connecting(T + 1500, "e2", 1);
  i.hello(T + 1510, "e2", D);
  i.subscribed(T + 1520, "e2", 9, [rec("t1", { labels: lbl, status: { app: "codex", state: "done" }, status_ms: T + 1200, reported: true, turn: 3, title: "Refactor", created_ms: T - 5000 })]);
  i.doc(T + 1525, "e2", 1, {});
  i.event(T + 1530, "e1", 5, "status", "t1", { status: { app: "codex", state: "done" }, records: {}, reported: true });
  i.event(T + 1600, "e2", 9, "title", "t1", { title: "already applied" });
  write(
    "status-while-disconnected",
    "The status changed while disconnected (working, then done one turn later): the snapshot gives exactly one gap and the new facts, no invented status or turn activity. A late line from the retired connection and an event at the snapshot's own seq are dropped.",
    i.lines,
    base({
      sources: { local: { connection: "live", coreId: D, conn: "e2", lastSeq: 9 } },
      terminals: { [k]: term({ status: { app: "codex", state: "done" }, statusMs: T + 1200, turn: 3, title: "Refactor", labels: lbl }) },
      activity: [`observation gap:${D}:e2:9:t1:status ${T + 1520} gap:${k}>:while disconnected: status now done`],
    }),
  );
}

// ---------------------------------------------------------------- approval-voids
{
  const E = "e5000000000000000000000000000005", T = 1794340000000, k = `${E}/t1`;
  const i = inputs();
  const lbl = { "tremor.test": "f5" };
  const argv = ["/usr/local/bin/claude", "--model", "x"];
  const bash = { app: "claude-code", state: "blocked", kind: "permission", msg: "approve Bash: ls" };
  const write2 = { app: "claude-code", state: "blocked", kind: "permission", msg: "approve Write: /tmp/b" };
  const ask = { app: "claude-code", state: "blocked", kind: "question", msg: "Which file?" };
  const W = { app: "claude-code", state: "working" };
  const t1 = (o: J) => rec("t1", { name: "agent", labels: lbl, argv, created_ms: T + 100, pid: 7, reported: true, ...o });
  i.connecting(T, "e1", 0);
  i.hello(T + 10, "e1", E);
  i.subscribed(T + 20, "e1", 0, []);
  i.doc(T + 25, "e1", 1, {});
  i.event(T + 100, "e1", 1, "created", "t1", t1({ reported: false }));
  i.event(T + 200, "e1", 2, "status", "t1", { status: bash, records: {}, reported: true });
  i.get(T + 250, "e1", t1({ status: bash, status_ms: T + 200 }));
  i.event(T + 300, "e1", 3, "status", "t1", { status: W, records: {}, reported: true });
  i.dispatched(T + 400, "fx", { type: "approve", approvalId: `approval:${k}:${T + 200}`, option: "Approve", actionId: "a1" });
  i.settled(T + 410, "fx", "a1", "refused", "the request is no longer open");
  i.event(T + 500, "e1", 4, "status", "t1", { status: write2, records: {}, reported: true });
  i.event(T + 501, "e1", 5, "turn", "t1", { turn: 1, state: "blocked" });
  i.get(T + 550, "e1", t1({ status: write2, status_ms: T + 500, turn: 1 }));
  i.closed(T + 1000, "e1", 1, 500);
  i.connecting(T + 1500, "e2", 1);
  i.hello(T + 1510, "e2", E);
  i.subscribed(T + 1520, "e2", 5, [t1({ status: write2, status_ms: T + 500, turn: 1 })]);
  i.doc(T + 1525, "e2", 1, {});
  i.get(T + 1550, "e2", t1({ status: write2, status_ms: T + 500, turn: 1 }));
  i.event(T + 2000, "e2", 6, "status", "t1", { status: W, records: {}, reported: true });
  i.event(T + 2100, "e2", 7, "status", "t1", { status: ask, records: {}, reported: true });
  i.event(T + 2101, "e2", 8, "turn", "t1", { turn: 2, state: "blocked" });
  i.get(T + 2150, "e2", t1({ status: ask, status_ms: T + 2100, turn: 2 }));
  i.missed(T + 3000, "e2", 20, [t1({ status: ask, status_ms: T + 2100, turn: 2 })]);
  i.heartbeat(T + 3500, "e2", 20);
  const fp = (turn: number, statusMs: number, status: J) => ({ coreId: E, address: "t1", turn, statusMs, status });
  write(
    "approval-voids",
    "Three approval requests, each opened by a fresh terminal.get, each voided while open: by a later status, by a disconnect, and by `missed`. Approving the voided one is a refused action that leaves it voided. After the reconnect the same blocked occurrence (same status_ms) does not reopen: its id is spent. A Claude question gets a request with no buttons.",
    i.lines,
    base({
      sources: { local: { connection: "live", coreId: E, conn: "e2", lastSeq: 20 } },
      terminals: { [k]: term({ status: ask, statusMs: T + 2100, turn: 2, labels: lbl }) },
      activity: [
        `lifecycle core:${E}:e1:1 ${T + 100} created:::`,
        `status core:${E}:e1:2 ${T + 200} blocked|permission|approve Bash: ls`,
        `approval.request approval:${k}:${T + 200} ${T + 200} claude-code:permission`,
        `status core:${E}:e1:3 ${T + 300} working||`,
        `approval.resolved approval:${k}:${T + 200}:voided ${T + 300} voided`,
        `action user:fx:a1 ${T + 400} approve`,
        `action.settled user:fx:a1:settled ${T + 410} refused`,
        `status core:${E}:e1:4 ${T + 500} blocked|permission|approve Write: /tmp/b`,
        `turn core:${E}:e1:5 ${T + 501} 1:blocked`,
        `approval.request approval:${k}:${T + 500} ${T + 500} claude-code:permission`,
        `approval.resolved approval:${k}:${T + 500}:voided ${T + 1000} voided`,
        `status core:${E}:e2:6 ${T + 2000} working||`,
        `status core:${E}:e2:7 ${T + 2100} blocked|question|Which file?`,
        `turn core:${E}:e2:8 ${T + 2101} 2:blocked`,
        `approval.request approval:${k}:${T + 2100} ${T + 2100} claude-code:question`,
        `approval.resolved approval:${k}:${T + 2100}:voided ${T + 3000} voided`,
      ],
      approvals: {
        [`approval:${k}:${T + 200}`]: { state: "voided", msg: "approve Bash: ls", dialog: "claude-code", fingerprint: fp(0, T + 200, bash), options: ["Approve=enter", "Deny=esc"] },
        [`approval:${k}:${T + 500}`]: { state: "voided", msg: "approve Write: /tmp/b", dialog: "claude-code", fingerprint: fp(1, T + 500, write2), options: ["Approve=enter", "Deny=esc"] },
        [`approval:${k}:${T + 2100}`]: { state: "voided", msg: "Which file?", dialog: "claude-code", fingerprint: fp(2, T + 2100, ask), options: [] },
      },
      actions: { a1: "refused" },
    }),
  );
}

// ---------------------------------------------------------------- finished-absent
{
  const G = "f6000000000000000000000000000006", T = 1794350000000;
  const i = inputs();
  const lbl = { "tremor.test": "f6" };
  const t1 = rec("t1", { name: "lead", labels: lbl, status: { state: "idle" }, status_ms: T - 10, reported: true, turn: 1, created_ms: T - 500 });
  i.connecting(T, "e1", 0);
  i.hello(T + 10, "e1", G);
  i.subscribed(T + 20, "e1", 2, [t1, rec("t2", { labels: lbl, parent: "t1", state: "finished", reason: "exited", exit_code: 0, finished_ms: T - 20, created_ms: T - 400, pid: null })]);
  i.doc(T + 25, "e1", 2, {});
  i.closed(T + 1000, "e1", 1, 500);
  i.connecting(T + 1500, "e2", 1);
  i.hello(T + 1510, "e2", G);
  i.subscribed(T + 1520, "e2", 7, [t1]);
  i.doc(T + 1525, "e2", 2, {});
  write(
    "finished-absent",
    "A finished terminal is absent from the next snapshot (Core pruned or removed it while Tremor was away): it leaves the store with one gap, as a `removed` event would have. The unchanged terminal adds nothing.",
    i.lines,
    base({
      sources: { local: { connection: "live", coreId: G, conn: "e2", lastSeq: 7 } },
      terminals: { [`${G}/t1`]: term({ status: { state: "idle" }, statusMs: T - 10, turn: 1, labels: lbl }) },
      activity: [`observation gap:${G}:e2:7:t2:removed ${T + 1520} gap:${G}/t2>:while disconnected: no longer in Core's records`],
      docs: { local: { "herdr-app": 2 } },
    }),
  );
}

// ---------------------------------------------------------------- transcript-fleet
{
  const H = "a7000000000000000000000000000007", T = 1794360000000, k = (a: string) => `${H}/${a}`;
  const F = "16777220:12345:1794359000000", L0 = "16777220:999:1794350000000", L1 = `${L0}#1`;
  const i = inputs();
  i.connecting(T, "e1", 0);
  i.hello(T + 10, "e1", H);
  i.subscribed(T + 20, "e1", 4, [
    rec("t1", { name: "lead", labels: { "stampede.job": "job1", "stampede.agent": "lead", "stampede.role": "lead" }, status: { state: "idle" }, status_ms: T - 50, reported: true, created_ms: T - 900 }),
    rec("t2", { name: "build-core", labels: { "stampede.job": "job1", "stampede.agent": "build-core", "stampede.role": "worker" }, created_ms: T - 800 }),
  ]);
  i.doc(T + 25, "e1", 1, {});
  i.transcript(T + 100, k("t1"), F, 1, { role: "assistant", text: "Starting the build.", id: "u1", sourceAt: T + 90 });
  i.transcript(T + 110, k("t1"), F, 2, { role: "tool-use", text: "ls packages", tool: "Bash", toolUseId: "toolu_1", id: "u2", sourceAt: T + 100 });
  i.transcript(T + 120, k("t1"), F, 3, { role: "tool-result", text: "core protocol", toolUseId: "toolu_1", id: "u3", sourceAt: T + 110 });
  i.transcript(T + 130, k("t1"), F, 4, { role: "user", text: '<hc from="t2 build-core">done: wrote the engine</hc>', id: "u4" });
  i.transcript(T + 131, k("t1"), F, 4, { role: "user", text: '<hc from="t2 build-core">done: wrote the engine</hc>', id: "u4" });
  i.transcript(T + 140, k("t1"), F, 5, { role: "user", text: "<hc>t2 build-core exited (exit 0). Read: hc read t2</hc>", id: "u5" });
  i.transcript(T + 150, k("t1"), F, 3, { role: "tool-result", text: "core protocol", toolUseId: "toolu_1", id: "u3", sourceAt: T + 110 });
  // Byte lengths by hand: 22, 35, 38 (then a truncation), 33, 29; each line plus its newline.
  i.fleet(T + 200, "job1", L0, 0, "REPORT reports/core.md");
  i.fleet(T + 210, "job1", L0, 23, "TURN build-core Finished the engine");
  i.fleet(T + 220, "job1", L0, 59, "QUESTION build-core: which key format?");
  i.fleet(T + 230, "job1", L0, 0, "REPORT reports/core.md");
  i.fleet(T + 300, "job1", L1, 0, "GONE build-core prompt_input_exit");
  i.fleet(T + 310, "job1", L1, 34, "BLOCKED build-core permission");
  write(
    "transcript-fleet",
    "A lead's transcript: assistant text, a tool use and its result paired by toolUseId (at is the entry's own time when it has one), a user turn starting with an `<hc from>` tag (a message whose sender is only claimed), and hc's own note (an observation about the child). Repeated lines add nothing. The job's inbox.log: REPORT, TURN and QUESTION lines as observations about the agent they name and for the job's lead (resolved by stampede labels only), a repeated line dropped by its offset, then a truncation that starts a new file identity at offset 0; a line kind the slice does not know moves the cursor only.",
    i.lines,
    base({
      sources: { local: { connection: "live", coreId: H, conn: "e1", lastSeq: 4 } },
      terminals: {
        [k("t1")]: term({ status: { state: "idle" }, statusMs: T - 50, labels: { "stampede.job": "job1", "stampede.agent": "lead", "stampede.role": "lead" } }),
        [k("t2")]: term({ labels: { "stampede.job": "job1", "stampede.agent": "build-core", "stampede.role": "worker" } }),
      },
      activity: [
        `transcript tx:${F}:1 ${T + 90} assistant:::Starting the build.`,
        `transcript tx:${F}:2 ${T + 100} tool-use:Bash:toolu_1:ls packages`,
        `transcript tx:${F}:3 ${T + 110} tool-result::toolu_1:core protocol`,
        `message tx:${F}:4 ${T + 130} hc-tag`,
        `observation tx:${F}:5 ${T + 140} hc-note:${k("t1")}>${k("t2")}:t2 build-core exited (exit 0). Read: hc read t2`,
        `observation fleet:job1:${L0}:0 ${T + 200} fleet-report:${k("t1")}>:REPORT reports/core.md`,
        `observation fleet:job1:${L0}:23 ${T + 210} fleet-turn:${k("t1")}>${k("t2")}:TURN build-core Finished the engine`,
        `observation fleet:job1:${L0}:59 ${T + 220} fleet-question:${k("t1")}>${k("t2")}:QUESTION build-core: which key format?`,
        `observation fleet:job1:${L1}:0 ${T + 300} fleet-gone:${k("t1")}>${k("t2")}:GONE build-core prompt_input_exit`,
      ],
      messages: [{ key: `tx:${F}:4`, from: `claimed:${k("t2")}:t2 build-core`, to: `terminal:${k("t1")}`, via: "hc-tag", text: "done: wrote the engine" }],
      cursors: { [`transcript:${k("t1")}`]: { file: F, offset: 5 }, "fleet:job1": { file: L1, offset: 64 } },
    }),
  );
}

// ---------------------------------------------------------------- approval-single-use
{
  const J0 = "b8000000000000000000000000000008", T = 1794370000000, k = `${J0}/t1`;
  const i = inputs();
  const lbl = { "tremor.test": "f8" };
  const a = { app: "claude-code", state: "blocked", kind: "permission", msg: "approve Edit: a.ts" };
  const b = { app: "claude-code", state: "blocked", kind: "permission", msg: "approve Edit: b.ts" };
  const W = { app: "claude-code", state: "working" };
  const t1 = (o: J) => rec("t1", { labels: lbl, argv: ["claude"], created_ms: T + 100, reported: true, ...o });
  const B1 = `approval:${k}:${T + 200}`, B2 = `approval:${k}:${T + 2000}`;
  i.connecting(T, "e1", 0);
  i.hello(T + 10, "e1", J0);
  i.subscribed(T + 20, "e1", 0, []);
  i.doc(T + 25, "e1", 1, {});
  i.event(T + 100, "e1", 1, "created", "t1", t1({ reported: false }));
  i.event(T + 200, "e1", 2, "status", "t1", { status: a, records: {}, reported: true });
  i.get(T + 250, "e1", t1({ status: a, status_ms: T + 200 }));
  i.dispatched(T + 300, "fx", { type: "approve", approvalId: B1, option: "Approve", actionId: "a1" });
  i.dispatched(T + 301, "fx", { type: "approve", approvalId: B1, option: "Approve", actionId: "a2" });
  i.settled(T + 302, "fx", "a2", "refused", "already used");
  i.event(T + 800, "e1", 3, "status", "t1", { status: W, records: {}, reported: true });
  i.closed(T + 900, "e1", 1, 500);
  i.settled(T + 950, "fx", "a1", "unknown", "the connection closed during terminal.keys");
  i.connecting(T + 1500, "e2", 1);
  i.hello(T + 1510, "e2", J0);
  i.subscribed(T + 1520, "e2", 3, [t1({ status: W, status_ms: T + 800 })]);
  i.doc(T + 1525, "e2", 1, {});
  i.event(T + 2000, "e2", 4, "status", "t1", { status: b, records: {}, reported: true });
  i.event(T + 2001, "e2", 5, "turn", "t1", { turn: 1, state: "blocked" });
  i.get(T + 2050, "e2", t1({ status: b, status_ms: T + 2000, turn: 1 }));
  i.dispatched(T + 2100, "fx", { type: "approve", approvalId: B2, option: "Deny", actionId: "a3" });
  i.settled(T + 2200, "fx", "a3", "refused", "the person declined the confirmation");
  i.dispatched(T + 2300, "fx", { type: "approve", approvalId: B2, option: "Approve", actionId: "a4" });
  i.settled(T + 2301, "fx", "a4", "refused", "the request is no longer open");
  const fp = (turn: number, statusMs: number, status: J) => ({ coreId: J0, address: "t1", turn, statusMs, status });
  write(
    "approval-single-use",
    "A request taken in flight by one action is single use: a second approve leaves it with the first; a later status and a disconnect do not void it under its action; it ends as that action settles (unknown after a broken transport). A declined confirmation settles refused and spends the request; approving it again changes nothing.",
    i.lines,
    base({
      sources: { local: { connection: "live", coreId: J0, conn: "e2", lastSeq: 5 } },
      terminals: { [k]: term({ status: b, statusMs: T + 2000, turn: 1, labels: lbl }) },
      activity: [
        `lifecycle core:${J0}:e1:1 ${T + 100} created:::`,
        `status core:${J0}:e1:2 ${T + 200} blocked|permission|approve Edit: a.ts`,
        `approval.request ${B1} ${T + 200} claude-code:permission`,
        `action user:fx:a1 ${T + 300} approve`,
        `action user:fx:a2 ${T + 301} approve`,
        `action.settled user:fx:a2:settled ${T + 302} refused`,
        `status core:${J0}:e1:3 ${T + 800} working||`,
        `action.settled user:fx:a1:settled ${T + 950} unknown`,
        `approval.resolved ${B1}:a1 ${T + 950} unknown`,
        `status core:${J0}:e2:4 ${T + 2000} blocked|permission|approve Edit: b.ts`,
        `turn core:${J0}:e2:5 ${T + 2001} 1:blocked`,
        `approval.request ${B2} ${T + 2000} claude-code:permission`,
        `action user:fx:a3 ${T + 2100} approve`,
        `action.settled user:fx:a3:settled ${T + 2200} refused`,
        `approval.resolved ${B2}:a3 ${T + 2200} refused`,
        `action user:fx:a4 ${T + 2300} approve`,
        `action.settled user:fx:a4:settled ${T + 2301} refused`,
      ],
      approvals: {
        [B1]: { state: "unknown", msg: "approve Edit: a.ts", dialog: "claude-code", fingerprint: fp(0, T + 200, a), options: ["Approve=enter", "Deny=esc"] },
        [B2]: { state: "refused", msg: "approve Edit: b.ts", dialog: "claude-code", fingerprint: fp(1, T + 2000, b), options: ["Approve=enter", "Deny=esc"] },
      },
      actions: { a1: "unknown", a2: "refused", a3: "refused", a4: "refused" },
    }),
  );
}
// ---------------------------------------------------------------- approval-blocked-twice
{
  const K0 = "b9000000000000000000000000000009", T = 1794380000000, k = `${K0}/t1`;
  const i = inputs();
  const lbl = { "tremor.test": "f9" };
  const W = { app: "claude-code", state: "working" };
  const A = { app: "claude-code", state: "blocked", kind: "permission", msg: "approve Bash: ls" };
  const B = { app: "claude-code", state: "blocked", kind: "permission", msg: "approve Write: /tmp/b" };
  const t1 = (o: J) => rec("t1", { labels: lbl, argv: ["claude"], created_ms: T + 100, reported: true, ...o });
  // Core moves status_ms only when the word changes: blocked A then blocked B share T+300.
  const R0 = `approval:${k}:${T + 300}`, R1 = `approval:${k}:${T + 300}:1`;
  i.connecting(T, "e1", 0);
  i.hello(T + 10, "e1", K0);
  i.subscribed(T + 20, "e1", 0, []);
  i.doc(T + 25, "e1", 1, {});
  i.event(T + 100, "e1", 1, "created", "t1", t1({ reported: false }));
  i.event(T + 200, "e1", 2, "status", "t1", { status: W, records: {}, reported: true });
  i.event(T + 300, "e1", 3, "status", "t1", { status: A, records: {}, reported: true });
  i.event(T + 301, "e1", 4, "turn", "t1", { turn: 1, state: "blocked" });
  i.get(T + 350, "e1", t1({ status: A, status_ms: T + 300, turn: 1 }));
  i.event(T + 400, "e1", 5, "status", "t1", { status: B, records: {}, reported: true });
  i.get(T + 450, "e1", t1({ status: B, status_ms: T + 300, turn: 1 }));
  i.get(T + 460, "e1", t1({ status: B, status_ms: T + 300, turn: 1 }));
  i.get(T + 470, "e1", t1({ status: A, status_ms: T + 300, turn: 1 }));
  i.dispatched(T + 500, "fx", { type: "approve", approvalId: R1, option: "Approve", actionId: "a1" });
  i.event(T + 600, "e1", 6, "status", "t1", { status: W, records: {}, reported: true });
  i.settled(T + 610, "fx", "a1", "done", "typed enter; the terminal then left this request");
  i.heartbeat(T + 700, "e1", 6);
  const fp = (status: J) => ({ coreId: K0, address: "t1", turn: 1, statusMs: T + 300, status });
  write(
    "approval-blocked-twice",
    "Blocked A, then blocked B with no other word between: Core keeps one status_ms for both, so the second request takes the occurrence counter (`approval:<t>:<ms>:1`). B's status voids A; B's fresh get opens its own request; a repeated get of B and a late get of A open nothing. B is approved: its later status does not void it under its action, which settles it sent.",
    i.lines,
    base({
      sources: { local: { connection: "live", coreId: K0, conn: "e1", lastSeq: 6 } },
      terminals: { [k]: term({ status: W, statusMs: T + 300, turn: 1, labels: lbl }) },
      activity: [
        `lifecycle core:${K0}:e1:1 ${T + 100} created:::`,
        `status core:${K0}:e1:2 ${T + 200} working||`,
        `status core:${K0}:e1:3 ${T + 300} blocked|permission|approve Bash: ls`,
        `turn core:${K0}:e1:4 ${T + 301} 1:blocked`,
        `approval.request ${R0} ${T + 300} claude-code:permission`,
        `status core:${K0}:e1:5 ${T + 400} blocked|permission|approve Write: /tmp/b`,
        `approval.resolved ${R0}:voided ${T + 400} voided`,
        `approval.request ${R1} ${T + 300} claude-code:permission`,
        `action user:fx:a1 ${T + 500} approve`,
        `status core:${K0}:e1:6 ${T + 600} working||`,
        `action.settled user:fx:a1:settled ${T + 610} done`,
        `approval.resolved ${R1}:a1 ${T + 610} sent`,
      ],
      approvals: {
        [R0]: { state: "voided", msg: "approve Bash: ls", dialog: "claude-code", fingerprint: fp(A), options: ["Approve=enter", "Deny=esc"] },
        [R1]: { state: "sent", msg: "approve Write: /tmp/b", dialog: "claude-code", fingerprint: fp(B), options: ["Approve=enter", "Deny=esc"] },
      },
      actions: { a1: "done" },
    }),
  );
}

// ---------------------------------------------------------------- history-gap
{
  const L0 = "a0100000000000000000000000000010", T = 1794390000000, k = `${L0}/t1`;
  const i = inputs();
  const lbl = { "tremor.test": "f10" };
  i.connecting(T, "e1", 0);
  i.hello(T + 10, "e1", L0);
  i.subscribed(T + 20, "e1", 2, [rec("t1", { labels: lbl, status: { state: "idle" }, status_ms: T - 10, reported: true, turn: 1, created_ms: T - 500 })]);
  i.doc(T + 25, "e1", 1, {});
  i.historyGap(T + 1000, "no usable checkpoint");
  i.event(T + 2000, "e1", 3, "status", "t1", { status: { state: "working" }, records: {}, reported: true });
  i.historyGap(T + 3000, "log 4 is missing");
  write(
    "history-gap",
    "Persistence recovered without a usable base and logged a `history-gap` input; a later recovery logged another. Each sets `historyGapAt` (history before it is incomplete); the latest bounds it, and a replayed older gap never moves it back. A gap is a state event: no activity, nothing invented.",
    i.lines,
    base({
      sources: { local: { connection: "live", coreId: L0, conn: "e1", lastSeq: 3 } },
      terminals: { [k]: term({ status: { state: "working" }, statusMs: T - 10, turn: 1, labels: lbl }) },
      activity: [`status core:${L0}:e1:3 ${T + 2000} working||`],
      historyGapAt: T + 3000,
    }),
  );
}

// ---------------------------------------------------------------- composer-send
{
  const M0 = "c0110000000000000000000000000011", T = 1794400000000, k = `${M0}/t1`;
  const i = inputs();
  const lbl = { "tremor.test": "f11", "herdr.seen": "1" };
  i.connecting(T, "e1", 0);
  i.hello(T + 10, "e1", M0);
  i.subscribed(T + 20, "e1", 0, [rec("t1", { labels: lbl, argv: ["claude"], status: { app: "claude-code", state: "idle" }, status_ms: T - 10, reported: true, turn: 1, created_ms: T - 500 })]);
  i.doc(T + 25, "e1", 1, {});
  i.dispatched(T + 100, "fx", { type: "send", terminal: k, text: "Run the tests", expectedStatus: "idle", actionId: "a1" });
  i.settled(T + 150, "fx", "a1", "done", "sent if idle");
  i.event(T + 200, "e1", 1, "status", "t1", { status: { app: "claude-code", state: "working" }, records: {}, reported: true });
  i.dispatched(T + 300, "fx", { type: "send", terminal: k, text: "Also lint", expectedStatus: "working", actionId: "a2" });
  i.settled(T + 400, "fx", "a2", "done", "sent if working");
  i.event(T + 500, "e1", 2, "status", "t1", { status: { app: "claude-code", state: "done" }, records: {}, reported: true });
  i.event(T + 501, "e1", 3, "turn", "t1", { turn: 2, state: "done" });
  i.dispatched(T + 600, "fx", { type: "send", terminal: k, text: "Thanks", expectedStatus: "done", actionId: "a3" });
  i.settled(T + 650, "fx", "a3", "done", "sent without a guard");
  i.dispatched(T + 700, "fx", { type: "send", terminal: k, text: "One more", expectedStatus: "idle", actionId: "a4" });
  i.settled(T + 750, "fx", "a4", "refused", "status_mismatch: t1 is done, not idle");
  const msg = (a: string, text: string, expectedStatus: string) => ({ key: `user:fx:${a}`, from: "person:fx", to: `terminal:${k}`, via: "composer", text, expectedStatus });
  write(
    "composer-send",
    "Composer sends to an idle, a working and a done agent, and one whose guard Core refused: each is a proven message from the person, recorded when it was dispatched, with its outcome settled after. Each message carries the expectedStatus the composer saw, and the digest shows it.",
    i.lines,
    base({
      sources: { local: { connection: "live", coreId: M0, conn: "e1", lastSeq: 3 } },
      terminals: { [k]: term({ status: { app: "claude-code", state: "done" }, statusMs: T - 10, turn: 2, labels: lbl }) },
      activity: [
        `message user:fx:a1 ${T + 100} composer`,
        `action.settled user:fx:a1:settled ${T + 150} done`,
        `status core:${M0}:e1:1 ${T + 200} working||`,
        `message user:fx:a2 ${T + 300} composer`,
        `action.settled user:fx:a2:settled ${T + 400} done`,
        `status core:${M0}:e1:2 ${T + 500} done||`,
        `turn core:${M0}:e1:3 ${T + 501} 2:done`,
        `message user:fx:a3 ${T + 600} composer`,
        `action.settled user:fx:a3:settled ${T + 650} done`,
        `message user:fx:a4 ${T + 700} composer`,
        `action.settled user:fx:a4:settled ${T + 750} refused`,
      ],
      messages: [msg("a1", "Run the tests", "idle"), msg("a2", "Also lint", "working"), msg("a3", "Thanks", "done"), msg("a4", "One more", "idle")],
      actions: { a1: "done", a2: "done", a3: "done", a4: "refused" },
    }),
  );
}
console.log("written");
