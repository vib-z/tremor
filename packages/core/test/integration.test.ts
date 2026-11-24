// Against a real, private Herdr Core (test/private-core.ts): plain programs only (sh, printf, cat).
// Set TREMOR_SKIP_CORE=1 to skip where no hc is installed.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { digest, termKey, type CoreInput, type StreamFrame } from "@tremor/protocol";
import { conform } from "@tremor/protocol/conformance";
import { Store, engine } from "../src/store/index.ts";
import { ActionService, type ConfirmRequest } from "../src/node/actions.ts";
import { CoreSource, Recorder } from "../src/node/source.ts";
import { openStream } from "../src/node/streams.ts";
import { startPrivateCore, type PrivateCore } from "./private-core.ts";
import { until } from "./fake-core.ts";

const skip = process.env.TREMOR_SKIP_CORE === "1";
let pc: PrivateCore;
let n = 0;

beforeAll(async () => {
  if (!skip) pc = await startPrivateCore();
}, 30_000);
afterAll(async () => {
  await pc?.cleanup(); // a safety net: the last test already cleaned up and checked it
}, 30_000);

/** A source subscribed to one label of this run, its store and every input it recorded. */
async function live(over: { backoffMs?: number[] } = {}) {
  const label = `${pc.run}-${++n}`;
  const store = new Store();
  const inputs: CoreInput[] = [];
  const spawned: ReturnType<PrivateCore["connect"]>[] = [];
  const source = new CoreSource({
    connect: () => {
      const t = pc.connect();
      spawned.push(t);
      return t;
    },
    emit: (i) => {
      inputs.push(i);
      store.apply(i);
    },
    filter: { labels: { "tremor.test": label } },
    ...over,
  });
  source.start();
  await until(() => source.connection, 15_000, "subscribed");
  const run = (argv: string[], name: string) =>
    source.call<{ address: string }>("terminal.run", { argv, cwd: pc.root, name, no_parent: true, labels: { "tremor.test": label, "herdr.seen": "0" } });
  const key = (address: string) => termKey(pc.coreId, address);
  /** The recorded session replays to the live store's digest, and conforms (twice, doubled, restored). */
  const replays = () => conform(engine, { name: label, inputs, expected: { description: "live", digest: digest(store.state) } });
  return { label, store, inputs, spawned, source, run, key, replays };
}

describe.skipIf(skip)("on a private core", () => {
  test("the environment is the private one", () => {
    expect(Object.keys(pc.env).sort()).toEqual(["HC_SESSION", "HOME", "LANG", "PATH", "TERM", "USER", "XDG_CONFIG_HOME", "XDG_RUNTIME_DIR", "XDG_STATE_HOME"].filter((k) => k in pc.env).sort());
    expect(pc.env.HC_SOCKET).toBeUndefined();
    expect(pc.env.HC_SESSION).toBe(`pdk-${pc.run}`);
    expect(pc.root).toMatch(/^\/tmp\/pdk-[0-9a-f]{8}$/);
  });

  test("lifecycle in order: created, its status-free run, finished; the session replays", async () => {
    const h = await live();
    const { address } = await h.run(["sh", "-c", "sleep 0.3; echo hi; sleep 0.3"], "life");
    const k = h.key(address);
    await until(() => h.store.state.terminals[k]?.state === "finished", 15_000, "finished");
    const life = h.store.state.activity.filter((e) => e.terminal === k && e.type === "lifecycle");
    expect(life.map((e) => e.type === "lifecycle" && [e.phase, e.reason, e.exitCode])).toEqual([
      ["created", null, null],
      ["finished", "exited", 0],
    ]);
    expect(h.store.state.terminals[k]).toMatchObject({ state: "finished", reason: "exited", exit_code: 0, status: null, labels: { "tremor.test": h.label, "herdr.seen": "0" } });
    expect(h.inputs.map((i) => i.kind).slice(0, 3)).toEqual(["connecting", "hello", "subscribed"]);
    expect(h.inputs.some((i) => i.kind === "doc")).toBe(true);
    expect(h.replays()).toEqual([]);
    await h.source.stop();
  }, 30_000);

  test("killing hc connect mid-stream: reconnect on a new connection, no duplicate activity", async () => {
    const h = await live({ backoffMs: [200] });
    const script = 'for i in 1 2 3 4 5 6 7 8 9 10; do printf "\\033]7501;state=working\\033\\\\"; sleep 0.15; printf "\\033]7501;state=idle\\033\\\\"; sleep 0.15; done';
    const { address } = await h.run(["sh", "-c", script], "pulse");
    const k = h.key(address);
    await until(() => h.store.state.activity.filter((e) => e.terminal === k && e.type === "status").length >= 3, 15_000, "first statuses");
    h.spawned[0]!.kill("SIGKILL");
    await until(() => h.inputs.filter((i) => i.kind === "subscribed").length === 2, 15_000, "resubscribed");
    await until(() => h.store.state.terminals[k]?.state === "finished", 20_000, "finished");
    const conns = [...new Set(h.inputs.filter((i) => i.kind === "connecting").map((i) => (i as { conn: string }).conn))];
    expect(conns).toHaveLength(2);
    expect(h.inputs.find((i) => i.kind === "closed")).toMatchObject({ attempt: 1 });
    const keys = h.store.state.activity.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    const life = h.store.state.activity.filter((e) => e.terminal === k && e.type === "lifecycle").map((e) => e.type === "lifecycle" && e.phase);
    expect(life).toEqual(["created", "finished"]);
    // Whatever happened while disconnected is at most one gap per terminal, never replayed history.
    expect(h.store.state.activity.filter((e) => e.type === "observation" && e.kind === "gap").length).toBeLessThanOrEqual(1);
    expect(h.store.state.sources.local).toMatchObject({ connection: { state: "live" }, conn: conns[1], retired: [conns[0]] });
    expect(h.replays()).toEqual([]);
    await h.source.stop();
  }, 40_000);

  test("an observer attach receives the program's bytes, with credit for what was consumed", async () => {
    const h = await live();
    const { address } = await h.run(["sh", "-c", "for i in 1 2 3 4 5 6; do echo tick$i; sleep 0.25; done; sleep 2"], "ticker");
    const stream = await openStream({ connection: h.source.connection!, hello: h.source.hello!, terminal: h.key(address), address, mode: "observe", cols: 80, rows: 24 });
    let text = "";
    const frames: StreamFrame[] = [];
    stream.onFrame((f) => {
      frames.push(f);
      if (f.kind === "data") {
        text += new TextDecoder().decode(f.bytes);
        stream.consumed(f.seq);
      }
    });
    await until(() => text.includes("tick5"), 15_000, "ticks");
    stream.write(new TextEncoder().encode("typed by an observer\r"), "human");
    expect(stream.dropped).toBe(1);
    expect(stream.capabilities.resizeNotifications).toBe(true);
    expect(frames.map((f) => f.seq)).toEqual(frames.map((_, i) => i + 1));
    stream.close();
    await h.source.stop();
  }, 30_000);

  test("the approval path end to end: a plain program blocks via 7501, the person confirms, Enter answers it", async () => {
    const h = await live();
    // A plain sh script named claude, so Core's argv says Claude Code: its permission dialog answers Enter.
    mkdirSync(`${pc.root}/bin`, { recursive: true });
    const bin = `${pc.root}/bin/claude`;
    writeFileSync(
      bin,
      [
        "#!/bin/sh",
        "msg=$(printf 'approve Write: %s' \"$1\" | base64)",
        "printf '\\033]7501;state=working:app=claude-code\\033\\\\'",
        "sleep 0.3",
        "printf '\\033]7501;state=blocked:kind=permission:app=claude-code:msg=%s\\033\\\\' \"$msg\"",
        "IFS= read -r answer",
        "printf '\\033]7501;state=working:app=claude-code\\033\\\\'",
        "sleep 0.3",
        "printf '\\033]7501;state=done:app=claude-code\\033\\\\'",
        "sleep 3",
        "",
      ].join("\n"),
    );
    chmodSync(bin, 0o755);
    const recording = `${pc.root}/approval.jsonl`;
    const recorder = new Recorder(recording);
    const { address } = await h.run([bin, "/tmp/pdk-approval.txt"], "approver");
    const k = h.key(address);
    const opened = await until(() => Object.values(h.store.state.approvals).find((a) => a.request.terminal === k && a.state === "open"), 15_000, "approval");
    expect(opened.request).toMatchObject({ kind: "permission", msg: "approve Write: /tmp/pdk-approval.txt", dialog: "claude-code", options: [{ label: "Approve", keys: ["enter"] }, { label: "Deny", keys: ["esc"] }] });
    const confirms: ConfirmRequest[] = [];
    const svc = new ActionService({
      clientId: "it",
      store: h.store,
      core: h.source,
      confirmer: { confirm: async (r) => (confirms.push(r), true) },
      record: async (i) => {
        h.inputs.push(i);
        h.store.apply(i);
      },
    });
    const out = await svc.act({ type: "approve", approvalId: opened.request.id, option: "Approve" });
    expect(out.state).toBe("done");
    expect(confirms[0]?.action).toBe("Approve: approve Write: /tmp/pdk-approval.txt");
    expect(h.store.state.approvals[opened.request.id]?.state).toBe("sent");
    await until(() => h.store.state.terminals[k]?.status?.state === "done", 15_000, "done");
    // Single use: the same request cannot be approved again.
    expect((await svc.act({ type: "approve", approvalId: opened.request.id, option: "Approve" })).state).toBe("refused");
    for (const i of h.inputs) recorder.write(i);
    await recorder.close();
    expect(readFileSync(recording, "utf8").trim().split("\n")).toHaveLength(h.inputs.length);
    expect(h.replays()).toEqual([]);
    await h.source.stop();
  }, 40_000);

  test("a shell that claims to be Claude Code gets a request with no buttons", async () => {
    const h = await live();
    const msg = Buffer.from("approve Bash: rm -rf /").toString("base64");
    const { address } = await h.run(["sh", "-c", `printf '\\033]7501;state=blocked:kind=permission:app=claude-code:msg=${msg}\\033\\\\'; sleep 3`], "pretender");
    const req = await until(() => Object.values(h.store.state.approvals).find((a) => a.request.terminal === h.key(address)), 15_000, "request");
    expect(req.request).toMatchObject({ dialog: "unknown", options: [], msg: "approve Bash: rm -rf /" });
    const svc = new ActionService({ clientId: "it", store: h.store, core: h.source, confirmer: { confirm: async () => true }, record: async (i) => void h.store.apply(i) });
    expect((await svc.act({ type: "approve", approvalId: req.request.id, option: "Approve" })).state).toBe("refused");
    await h.source.stop();
  }, 30_000);

  test("cleanup: hello shows our core id, the core stops, only /tmp/pdk-<run> is removed", async () => {
    await pc.cleanup();
    expect(existsSync(pc.root)).toBe(false);
    expect(pc.stoppedPid).not.toBeNull();
    expect(() => process.kill(pc.stoppedPid as number, 0)).toThrow();
  }, 30_000);
});
