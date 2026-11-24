// Fabricated files in a temporary folder only: never a real job folder or the owner's transcripts.
import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, renameSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CoreInput, CoreTerminal } from "@tremor/protocol";
import { Store } from "../src/store/index.ts";
import { FleetAdapter, completeLines, position } from "../src/node/adapters/fleet.ts";
import { TranscriptAdapter, parseClaudeLine } from "../src/node/adapters/transcript.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const fresh = () => {
  const d = mkdtempSync(join(tmpdir(), "pdk-adapter-"));
  dirs.push(d);
  return d;
};

const C = "c0ffee000000000000000000000000ad";
const rec = (address: string, labels: Record<string, string>) =>
  ({ address, name: address, labels, parent: null, state: "live", status: null, status_ms: null, reported: true, turn: 0, title: "", cwd: "/", argv: ["claude"], exit_code: null, signal: null, reason: null, keep: false, created_ms: 1, finished_ms: null, cols: 80, rows: 24 }) as CoreTerminal;
function store() {
  const s = new Store();
  for (const i of [
    { t: 1, source: "local", conn: "e1", kind: "connecting", attempt: 0 },
    { t: 2, source: "local", conn: "e1", kind: "hello", result: { core: { id: C, name: "x" }, generation: 1, version: "0.1.19", features: [] } },
    { t: 3, source: "local", conn: "e1", kind: "subscribed", result: { seq: 0, channel: 1, terminals: [rec("t1", { "stampede.job": "j1", "stampede.role": "lead", "stampede.agent": "lead" }), rec("t2", { "stampede.job": "j1", "stampede.agent": "w1", "stampede.role": "worker" })] } },
  ] as CoreInput[])
    s.apply(i);
  return s;
}

describe("fleet inbox.log", () => {
  test("position: same identity resumes, a smaller file is a truncation, another inode is a new file", () => {
    expect(position("1:2:3", 50, undefined)).toEqual({ file: "1:2:3", offset: 0 });
    expect(position("1:2:3", 50, { file: "1:2:3", offset: 20 })).toEqual({ file: "1:2:3", offset: 20 });
    expect(position("1:2:3", 10, { file: "1:2:3", offset: 20 })).toEqual({ file: "1:2:3#1", offset: 0 });
    expect(position("1:2:3", 10, { file: "1:2:3#1", offset: 20 })).toEqual({ file: "1:2:3#2", offset: 0 });
    expect(position("1:9:3", 50, { file: "1:2:3", offset: 20 })).toEqual({ file: "1:9:3", offset: 0 });
  });

  test("complete lines keep their byte offsets, multi-byte characters included; a partial line waits", () => {
    const b = new TextEncoder().encode("TURN w1 ✓ done\nREPORT r.md\nGONE w");
    expect(completeLines(b, 100)).toEqual({ lines: [{ offset: 100, text: "TURN w1 ✓ done" }, { offset: 117, text: "REPORT r.md" }], consumed: 29 });
  });

  test("lines become observations about the named agent for the job's lead; a restart resumes from the store's cursor", async () => {
    const dir = fresh();
    const s = store();
    const make = () => new FleetAdapter({ job: "j1", dir, emit: (i) => s.apply(i), cursor: () => s.state.cursors["fleet:j1"], now: () => 1000 });
    writeFileSync(join(dir, "inbox.log"), "REPORT reports/w1.md\nTURN w1 Finished\nQUESTION w1: which");
    expect(await make().poll()).toBe(2);
    appendFileSync(join(dir, "inbox.log"), " key?\n");
    const again = make(); // a restart: no memory, the store's cursor decides
    expect(await again.poll()).toBe(1);
    expect(await again.poll()).toBe(0);
    const obs = s.state.activity.filter((e) => e.type === "observation");
    expect(obs.map((e) => e.type === "observation" && [e.kind, e.subject, e.about])).toEqual([
      ["fleet-report", `${C}/t1`, null],
      ["fleet-turn", `${C}/t1`, `${C}/t2`],
      ["fleet-question", `${C}/t1`, `${C}/t2`],
    ]);
    expect(obs.every((e) => e.trust === "untrusted")).toBe(true);
  });

  test("a truncated inbox starts a new identity: its lines are new occurrences, nothing is lost or repeated", async () => {
    const dir = fresh();
    const s = store();
    const a = new FleetAdapter({ job: "j1", dir, emit: (i) => s.apply(i), cursor: () => s.state.cursors["fleet:j1"] });
    writeFileSync(join(dir, "inbox.log"), "TURN w1 one\nTURN w1 two\n");
    await a.poll();
    truncateSync(join(dir, "inbox.log"), 0);
    appendFileSync(join(dir, "inbox.log"), "GONE w1 exit\n");
    await a.poll();
    const keys = s.state.activity.filter((e) => e.type === "observation").map((e) => e.key);
    expect(keys).toHaveLength(3);
    expect(keys[2]).toMatch(/^fleet:j1:\d+:\d+:\d+#1:0$/);
    expect(s.state.cursors["fleet:j1"]?.file).toMatch(/#1$/);
  });

  test("a replaced file (another inode) starts from its beginning", async () => {
    const dir = fresh();
    const s = store();
    const a = new FleetAdapter({ job: "j1", dir, emit: (i) => s.apply(i), cursor: () => s.state.cursors["fleet:j1"] });
    writeFileSync(join(dir, "inbox.log"), "TURN w1 one\n");
    await a.poll();
    writeFileSync(join(dir, "inbox.next"), "TURN w1 fresh\n");
    renameSync(join(dir, "inbox.next"), join(dir, "inbox.log"));
    expect(await a.poll()).toBe(1);
    expect(s.state.activity.filter((e) => e.type === "observation")).toHaveLength(2);
  });

  test("no inbox yet is not an error", async () => {
    expect(await new FleetAdapter({ job: "j", dir: fresh(), emit: () => {}, cursor: () => undefined }).poll()).toBe(0);
  });
});

const line = (o: object) => `${JSON.stringify(o)}\n`;
const T = "2026-11-08T12:00:00.000Z";

describe("Claude Code transcript", () => {
  test("parses assistant text, tool use and result with their pairing id, and user turns; skips the rest", () => {
    expect(parseClaudeLine({ type: "assistant", uuid: "u1", timestamp: T, message: { role: "assistant", content: [{ type: "text", text: "On it." }] } })).toEqual({ role: "assistant", text: "On it.", id: "u1", sourceAt: Date.parse(T) });
    expect(parseClaudeLine({ type: "assistant", uuid: "u2", message: { content: [{ type: "tool_use", id: "toolu_9", name: "Bash", input: { command: "ls -la", description: "list" } }] } })).toEqual({ role: "tool-use", tool: "Bash", text: "ls -la", toolUseId: "toolu_9", id: "u2" });
    expect(parseClaudeLine({ type: "user", uuid: "u3", message: { content: [{ type: "tool_result", tool_use_id: "toolu_9", content: [{ type: "text", text: "a\nb" }] }] } })).toEqual({ role: "tool-result", text: "a\nb", toolUseId: "toolu_9", id: "u3" });
    expect(parseClaudeLine({ type: "user", message: { role: "user", content: '<hc from="t2 w1">done</hc>' } })).toEqual({ role: "user", text: '<hc from="t2 w1">done</hc>' });
    expect(parseClaudeLine({ type: "user", isMeta: true, message: { content: "Caveat: ..." } })).toBeNull();
    expect(parseClaudeLine({ type: "summary", summary: "x" })).toBeNull();
    expect(parseClaudeLine({ type: "assistant", message: { content: [{ type: "thinking", thinking: "..." }] } })).toBeNull();
    expect(parseClaudeLine({ type: "file-history-snapshot" })).toBeNull();
  });

  test("tails the file by line number, resumes from the store's cursor, and turns an hc tag into a claimed message", async () => {
    const dir = fresh();
    const path = join(dir, "session.jsonl");
    const s = store();
    const make = () => new TranscriptAdapter({ terminal: `${C}/t1`, path, emit: (i) => s.apply(i), cursor: () => s.state.cursors[`transcript:${C}/t1`] });
    writeFileSync(path, line({ type: "summary", summary: "x" }) + line({ type: "assistant", uuid: "a", message: { content: [{ type: "text", text: "Hi" }] } }) + '{"type":"user","mess');
    const a = make();
    expect(await a.poll()).toBe(1);
    appendFileSync(path, `age":{"content":"<hc from=\\"t2 w1\\">all done</hc>"}}\n`);
    expect(await a.poll()).toBe(1);
    const b = make(); // restart
    appendFileSync(path, line({ type: "assistant", uuid: "c", message: { content: [{ type: "text", text: "Thanks" }] } }));
    expect(await b.poll()).toBe(1);
    expect(s.state.activity.map((e) => e.type)).toEqual(["transcript", "message", "transcript"]);
    const msg = s.state.activity[1];
    expect(msg?.type === "message" && msg.from).toEqual({ kind: "claimed", terminal: `${C}/t2`, label: "t2 w1" });
    expect(s.state.cursors[`transcript:${C}/t1`]?.offset).toBe(4);
  });
});
