// What resolveSession reads, against a fake `herdr` (F4, F5): nothing at all for a remote terminal, only
// metadata for a local one (registries, the process start, held file names, and a rollout's first line through
// the helper's `first`, stubbed here per the helper contract in briefs/fixes-review-1.md), never a body.
import { test, expect, mock, beforeAll, beforeEach, afterAll } from "bun:test";
import { mkdirSync, cpSync, readdirSync, rmSync } from "node:fs";

const S = `/tmp/pdk-sb${process.pid}`;
const PACK = new URL("..", import.meta.url).pathname;
mkdirSync(`${S}/lib`, { recursive: true });
for (const dir of ["adapters", "shared"]) for (const f of readdirSync(`${PACK}${dir}`)) if (f.endsWith(".js")) cpSync(`${PACK}${dir}/${f}`, `${S}/lib/${f}`);
// The helper's command list as build-media's contract has it (`first` added), until the lead merges it.
cpSync(`${S}/lib/helper.js`, `${S}/lib/helper.js.orig`);
await Bun.write(`${S}/lib/helper.js`, (await Bun.file(`${S}/lib/helper.js.orig`).text()).replace('"rows"]', '"rows", "first", "tty"]'));
afterAll(() => rmSync(S, { recursive: true, force: true }));

const H = `${S}/u`;
let W;
const calls = () => W.calls.map((c) => c[0]);
// bun keeps the first `herdr` mock's export list for the whole run, so every test file mocks the same names and
// each dispatches to the fake of the file whose tests are running.
const HERDR = ["spaces", "panes", "terminals", "machines", "run", "hc", "notify", "readTextFile", "writeTextFile", "appHome", "home", "exec"];
mock.module("herdr", () => Object.fromEntries(HERDR.map((n) => [n, (...a) => globalThis.pdkHerdr[n](...a)])));
const fake = {
  home: () => H,
  appHome: () => `${S}/home`,
  readTextFile: async (p) => { W.calls.push(["file", p]); return W.files[p] ?? null; },
  exec: async (_cmd, args) => {
    const [, , , command, ...rest] = args;
    W.calls.push([command, ...rest]);
    const reply = W.helper[command]?.(...rest) ?? { error: `no ${command}` };
    return { code: reply.error ? 2 : 0, stdout: JSON.stringify(reply), stderr: "" };
  },
};
globalThis.pdkHerdr = fake;
beforeAll(() => { globalThis.pdkHerdr = fake; });
const { resolveSession } = await import(`${S}/lib/sessions.js`);

const ID = "e8b56472-cac4-4c54-9b5c-881c604da6c0";
const TH = "01a1bd47-5fc4-76f0-926e-e081542198de";
const START = "Mon Nov  9 09:15:30 2026";
const roll = `${H}/.codex/sessions/2026/11/09/rollout-2026-11-09T09-15-31-${TH}.jsonl`;
const term = (address, argv, extra = {}) => ({ address, state: "live", pid: 500, foreground: { pid: 101, argv, name: argv[0], cwd: "/w" }, status: "idle", labels: {}, ...extra });

beforeEach(() => {
  W = {
    calls: [],
    files: { [`${H}/.claude/sessions/101.json`]: JSON.stringify({ pid: 101, sessionId: ID, cwd: "/w", procStart: START }) },
    helper: {
      start: () => ({ start: START }),
      held: () => ({ alive: true, files: [roll, `${H}/.codex/thread-writer-locks/${TH}.lock`] }),
      first: (path) => (path === roll ? { line: JSON.stringify({ type: "session_meta", payload: { id: TH, source: "cli", cwd: "/w" } }) } : { missing: true }),
      read: () => { throw new Error("a transcript body was read"); },
    },
  };
});

test("F4: a terminal on another machine is refused before anything on this Mac is read", async () => {
  for (const argv of [["claude"], ["codex", "--no-daemon"], ["hermes"], ["grok"]]) {
    const b = await resolveSession(term("vps/t3", argv));
    expect(b.ok).toBe(false);
    expect(b.reason).toMatch(/another machine/);
  }
  // No machine-qualified address at all is no evidence of being local either.
  expect((await resolveSession(term(undefined, ["claude"]))).ok).toBe(false);
  // Local ids past t19 carry letters (t1b, t1g): they are this machine's, not another's (final-shots-harness-2).
  for (const address of ["t1b", "t1g", "t2a", "t19"]) {
    const local = await resolveSession(term(address, ["sleep"]));
    expect(local.reason ?? "").not.toMatch(/another machine/);
  }
  expect((await resolveSession(term("box/t1b", ["claude"]))).reason).toMatch(/another machine/);
  expect(W.calls).toEqual([]);
});

test("Claude: binds from its registry entry and the process start, nothing else", async () => {
  const b = await resolveSession(term("t3", ["claude"]));
  expect(b).toMatchObject({ ok: true, session: ID, start: START });
  expect(W.calls).toEqual([["file", `${H}/.claude/sessions/101.json`], ["start", "101"]]);
});

test("F5: Codex reads each held rollout's first line through `first` only, never `read`", async () => {
  const b = await resolveSession(term("t3", ["codex", "--no-daemon"]));
  expect(b).toMatchObject({ ok: true, session: TH, start: START });
  expect(calls()).toEqual(["start", "held", "first", "start"]);
  expect(W.calls.find((c) => c[0] === "first")).toEqual(["first", roll]);
});

test("F5: no whole first line within `first`'s limit binds nothing, and nothing more is read", async () => {
  W.helper.first = () => ({ error: "no whole first line within 64 KiB" });
  const b = await resolveSession(term("t3", ["codex", "--no-daemon"]));
  expect(b.ok).toBe(false);
  expect(calls()).not.toContain("read");
});

test("F4: a pid reused while Codex's files were read binds nothing", async () => {
  const starts = [START, "Mon Nov  9 09:16:02 2026"];
  W.helper.start = () => ({ start: starts.shift() ?? null });
  const b = await resolveSession(term("t3", ["codex", "--no-daemon"]));
  expect(b.ok).toBe(false);
  expect(b.reason).toMatch(/changed while its files were read/);
});

// qa-modpack's capture of a real Hermes 0.23.0 pane (test/fixtures/hermes/terminal-t3.json on qa/modpack 10923d0):
// the app's shell wrapper in argv, Hermes's own Python launcher in front (its -c script clipped as captured).
const QA_CWD = "/Users/me/code/jobs/worktrees/core-client-1108-qa/modpack/.sandbox/qa/work/alpha";
const hermesPane = {
  address: "t3", state: "live", pid: 27385, status: null, reported: false, labels: {}, cwd: QA_CWD,
  argv: ["/bin/sh", "-lic", '"$@"; exec "$0" -li', "/bin/sh", "hermes", "chat", "--safe-mode", "-t", "terminal", "--provider", "anthropic", "-m", "claude-haiku-5-5", "-q", "List two files here, then say done."],
  foreground: {
    pid: 27388, name: "python3.14", cwd: QA_CWD,
    argv: ["/Users/me/.hermes/tools/python-3.14.9+20261021-darwin-arm64/bin/python3", "-I", "-c", "import os, re, sys\nos.environ.pop('PYTHONHOME', None)\nsys.path.insert(0, '/Users/me/.hermes/hermes-agent')\n\u2026", "chat", "--safe-mode", "-t", "terminal", "--provider", "anthropic", "-m", "claude-haiku-5-5", "-q", "List two files here, then say done."],
  },
};
const CRUMB = '{"session_id": "local-fd77ba7dbbb3120a3c876b5c082501f0de12a10231f91aff3d61b3bac8c10af5", "cwd": "' + QA_CWD + '", "ts": 1794214824.711264}';

test("F4: Hermes 0.23.0 is found by its Python launcher and bound by its terminal's record, never a pid lease", async () => {
  W.helper.start = () => ({ start: "Mon Nov  9 09:00:21 2026" });
  W.helper.tty = () => ({ tty: "ttys055" });
  W.files[`${H}/.hermes/terminal-sessions/tty-dev-ttys055`] = CRUMB;
  const b = await resolveSession(hermesPane);
  expect(b).toMatchObject({ ok: true, kind: "hermes", session: "local-fd77ba7dbbb3120a3c876b5c082501f0de12a10231f91aff3d61b3bac8c10af5" });
  expect(W.calls).toEqual([["start", "27388"], ["tty", "27388"], ["file", `${H}/.hermes/terminal-sessions/tty-dev-ttys055`]]);
  // The same tty, a newer process that Hermes has not recorded yet: the old record is refused.
  W.helper.start = () => ({ start: "Mon Nov  9 09:07:00 2026" });
  expect((await resolveSession(hermesPane)).reason).toMatch(/earlier process on this terminal/);
  // No tty (a daemon), the tty read failing, or the process gone: nothing binds.
  W.helper.start = () => ({ start: "Mon Nov  9 09:00:21 2026" });
  W.helper.tty = () => ({ tty: null });
  expect((await resolveSession(hermesPane)).reason).toMatch(/no terminal device/);
  W.helper.tty = () => ({ error: "ps failed" });
  expect((await resolveSession(hermesPane)).reason).toMatch(/can't read this Hermes's terminal device \(ps failed\)/);
  W.helper.tty = () => ({ tty: "ttys055" });
  W.helper.start = () => ({ start: null });
  expect((await resolveSession(hermesPane)).reason).toMatch(/gone/);
  // On another machine: refused before any of that is read.
  W.calls = [];
  expect((await resolveSession({ ...hermesPane, address: "vps/t3" })).reason).toMatch(/another machine/);
  expect(W.calls).toEqual([]);
});
