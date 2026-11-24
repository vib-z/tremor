// The foot's usage (owner, 10 Nov 2026: always on, no sources on screen, per machine). The helper reads only what
// local tools print (fake tools here, speaking the real shapes in fixtures/usage), asking nobody, as CodeNotch does:
// Codex's app-server, Claude Code's own /usage in print mode, Moshi only for providers with neither (Grok). Every
// email is masked; Moshi's cost block, every id and the rest of /usage's answer are dropped. An agent that is not
// installed, signed out or has no limits gives no card and no words. Then the foot: per machine, per agent a line.
import { test, expect, afterAll, setDefaultTimeout } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, chmodSync, existsSync, renameSync, symlinkSync } from "node:fs";
import { basename, dirname } from "node:path";
import * as usage from "../mods/pdk-usage/usage.js";
import { footLines, countdown, isHigh, HIGH, mergeUsage, UsageReader, usageKeys } from "../mods/pdk-usage/usage.js";
import { harness, evaluate, world } from "./parity-harness.js";

const HELPER = new URL("../helper/pdk-usage.py", import.meta.url).pathname;
const FIX = new URL("./fixtures/usage/", import.meta.url).pathname;
const ROOT = `/tmp/pdk-u${process.pid}`;
const HOME = `${ROOT}/u`;
const SCRATCH = `${ROOT}/state/usage-scratch`;
mkdirSync(`${HOME}/.codex`, { recursive: true });
mkdirSync(`${ROOT}/work`, { recursive: true });
// Section headers name the servers to turn off; the values under them are never read or passed on.
writeFileSync(`${HOME}/.codex/config.toml`, '[mcp_servers.alpha]\ncommand = "do-not-pass-me"\n\n[mcp_servers.beta-2]\nurl = "x"\n[profiles.p]\n');
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));
// A slow machine (the full suite alongside) makes a read slower, never wrong: no test's outcome depends on how fast it is.
setDefaultTimeout(120000);

// A fake codex app-server: answers initialize, account/read and account/rateLimits/read with the fixtures.
writeFileSync(`${ROOT}/fake-codex.py`, `
import json, sys
fix = sys.argv[1]
for line in sys.stdin:
    m = json.loads(line)
    if m.get("method") == "initialize":
        print(json.dumps({"id": m["id"], "result": {"userAgent": "fake", "platformOs": "macos"}}), flush=True)
    elif m.get("method") == "account/read":
        print(open(fix + "codex-account.json").read().strip(), flush=True)
    elif m.get("method") == "account/rateLimits/read":
        assert m["params"] == {"excludeResetCreditDetails": True}
        print(open(fix + "codex-rate-limits.json").read().strip(), flush=True)
`);

// The fake claude records how /usage was asked (argv, folder) and prints $FAKE_USAGE (the captured answer by default).
const CLAUDE = `#!/bin/sh
printf '%s\\n' "$*" >> "${ROOT}/claude-invocations"
[ -n "$FAKE_SLEEP" ] && exec /bin/sleep "$FAKE_SLEEP"
if [ "$*" = "auth status --json" ]; then [ -n "$FAKE_SIGNED_OUT" ] && { echo '{"loggedIn":false}'; exit 1; }; /bin/cat "\${FAKE_AUTH:-${FIX}claude-auth-status.json}"; exit 0; fi
printf '%s\\n' "$@" > "${ROOT}/claude-argv"; /bin/pwd > "${ROOT}/claude-cwd"
[ -n "$FAKE_USAGE_EXIT" ] && exit "$FAKE_USAGE_EXIT"
/bin/cat "\${FAKE_USAGE:-${FIX}claude-usage.txt}"
`;
const TOOLS = {
  moshi: `#!/bin/sh\n[ "$*" = "usage" ] || exit 9\n[ -n "$FAKE_SLOW" ] && exec /bin/sleep 60\n/bin/cat "${FIX}moshi-usage.json"\n`,
  codex: `#!/bin/sh\nprintf '%s\\n' "$@" > "${ROOT}/codex-argv"\n[ -n "$FAKE_CODEX_SLEEP" ] && /bin/sleep "$FAKE_CODEX_SLEEP"\nexec /usr/bin/python3 -I -S "${ROOT}/fake-codex.py" "${FIX}"\n`,
  claude: CLAUDE,
  grok: `#!/bin/sh\necho "grok must not be run" >&2\nexit 9\n`,
};

// A fake launchctl: the helper's only way into a Mac's desktop session. `managername` says $FAKE_SESSION (Aqua, the
// desktop, by default); `bootstrap` reads the job's real plist and starts it, as launchd would, in an environment that
// differs from the caller's only by $FAKE_DESKTOP_ENV (what the desktop session has, e.g. the open keychain);
// `bootout` unloads it, then kills it, as launchd does; it exits 3 when the job is not loaded and 5 when
// $FAKE_BOOTOUT_FAIL is set (in the helper's env, or the job's through $FAKE_DESKTOP_ENV). `print` lists the loaded jobs. $FAKE_NO_DESKTOP refuses bootstrap, as a Mac with nobody logged in does. Every
// call is logged, with the job's folder mode and argv, to $FAKE_CALLS: one file per read, which the job and its cleaner
// inherit, so a cleaner that ends late never writes into a later test's calls. Loaded jobs are files in $FAKE_LAUNCHD.
const LAUNCHCTL = `${ROOT}/fake-launchctl.py`, LAUNCHD = `${ROOT}/launchd`, TMP = `${ROOT}/tmp`;
mkdirSync(TMP, { recursive: true });
writeFileSync(LAUNCHCTL, `#!/usr/bin/python3 -I -S
import json, os, plistlib, signal, subprocess, sys
state, cmd = os.environ["FAKE_LAUNCHD"], sys.argv[1:]
os.makedirs(state, exist_ok=True)
def log(**o):
    with open(os.environ["FAKE_CALLS"], "a") as f: f.write(json.dumps(dict(cmd=cmd[0], **o)) + "\\n")
if cmd[0] == "print":
    log(); print("services = {"); [print(f"\\t0\\t-\\t{f}") for f in sorted(os.listdir(state))]; print("}"); sys.exit(0)
if cmd == ["managername"]:
    log(); print(os.environ.get("FAKE_SESSION", "Aqua")); sys.exit(0)
if cmd[0] == "bootstrap":
    job = plistlib.load(open(cmd[2], "rb"))
    log(domain=cmd[1], label=job["Label"], mode=oct(os.stat(os.path.dirname(cmd[2])).st_mode & 0o777), session=job["LimitLoadToSessionType"],
        argv=job["ProgramArguments"], env=sorted(job["EnvironmentVariables"]))
    if os.environ.get("FAKE_NO_DESKTOP"):
        print("Bootstrap failed: 125: Domain does not support specified action", file=sys.stderr); sys.exit(125)
    env = dict(job["EnvironmentVariables"], FAKE_LAUNCHD=state, FAKE_CALLS=os.environ["FAKE_CALLS"], FAKE_IN_JOB="1", **json.loads(os.environ.get("FAKE_DESKTOP_ENV", "{}")))
    p = subprocess.Popen(job["ProgramArguments"], env=env, start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    open(os.path.join(state, job["Label"]), "w").write(str(p.pid)); sys.exit(0)
if cmd[0] == "bootout":
    label = cmd[1].split("/", 2)[2]; log(target=cmd[1], by="job" if os.environ.get("FAKE_IN_JOB") else "helper", failed=bool(os.environ.get("FAKE_BOOTOUT_FAIL")))
    if os.environ.get("FAKE_BOOTOUT_FAIL"):
        print("Boot-out failed: 5: Input/output error", file=sys.stderr); sys.exit(5)
    try: pid = int(open(os.path.join(state, label)).read()); os.remove(os.path.join(state, label))
    except FileNotFoundError: print("Boot-out failed: 3: No such process", file=sys.stderr); sys.exit(3)
    try: os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError: pass
    sys.exit(0)
sys.exit(64)
`);
chmodSync(LAUNCHCTL, 0o755);
// The helper run as the remote bootstrap runs it: its own text, handed over as SOURCE, so the desktop job runs that
// same text. The text is patched, never the module: the fake launchctl (no test ever reaches this Mac's real launchd),
// `mac` false for a Linux machine, `hop` and `work` seconds for the desktop read and the whole helper.
const HARNESS = `import json, sys
src = open(sys.argv[1], encoding="utf-8").read()
for old, new in json.loads(sys.argv[2]):
    assert src.count(old) == 1, old
    src = src.replace(old, new)
assert "/bin/launchctl" not in src
path, sys.argv = sys.argv[1], ["pdk-usage.py", "read", sys.argv[3]]
exec(compile(src, "pdk-usage.py", "exec"), {"__name__": "__main__", "__file__": path, "SOURCE": src})`;
// Observation only (they change nothing the helper does): each timed call writes, to $FAKE_BUDGET, when it started
// (`at`, seconds from START, read before its time is cut), the time it was given and its deadline; the hop also its
// cap and when its wait ends (`until`). The job gets no $FAKE_BUDGET, so it writes nothing.
const TRACE = [
  ["START = time.time()\n", `START = time.time()\ndef TRACE(o):\n    p = os.environ.get("FAKE_BUDGET")\n    p and open(p, "a").write(json.dumps(o) + "\\n")\n`],
  ["    timeout = left(timeout, end)\n", `    _at = time.time() - START\n    timeout = left(timeout, end)\n    TRACE({"call": " ".join(map(os.path.basename, argv[:2])), "at": _at, "timeout": timeout, "end": WORK_SECONDS if end is None else end})\n`],
  ["    deadline = time.time() + left(timeout)\n", `    _at = time.time() - START\n    _t = left(timeout)\n    deadline = time.time() + _t\n    TRACE({"call": "codex rpc", "at": _at, "timeout": _t, "end": WORK_SECONDS})\n`],
  ["    seconds = left(HOP_SECONDS)\n", `    _at = time.time() - START\n    seconds = left(HOP_SECONDS)\n`],
  ["    hop_end = min(time.time() + seconds, START + WORK_SECONDS)", `    hop_end = min(time.time() + seconds, START + WORK_SECONDS); TRACE({"call": "hop", "at": _at, "timeout": seconds, "end": WORK_SECONDS, "cap": HOP_SECONDS, "until": hop_end - START})`],
  ["        while time.time() < hop_end:", `        TRACE({"call": "hop wait", "until": hop_end - START})\n        while time.time() < hop_end:`],
];
const patches = ({ mac = true, hop = 40, work = 70 } = {}) => [['LAUNCHCTL = "/bin/launchctl"', `LAUNCHCTL = ${JSON.stringify(LAUNCHCTL)}`],
  ['MACOS = sys.platform == "darwin"', `MACOS = ${mac ? "True" : "False"}`], ["HOP_SECONDS = 40", `HOP_SECONDS = ${hop}`], ["WORK_SECONDS = 70\n", `WORK_SECONDS = ${work}\n`], ...TRACE];
const helperArgv = (opts) => ["/usr/bin/python3", "-I", "-S", "-c", HARNESS, HELPER, JSON.stringify(patches(opts)), SCRATCH];
// Each read's launchctl calls go to a file of its own (fakeEnv() starts one); calls() reads the latest.
let LOG = "", BUDGET = "", logs = 0;
const fakeEnv = () => ({ TMPDIR: TMP, FAKE_LAUNCHD: LAUNCHD, FAKE_CALLS: (LOG = `${ROOT}/launchctl-calls-${++logs}`), FAKE_BUDGET: (BUDGET = `${ROOT}/budget-${logs}`) });
const traced = (trace, sub) => trace.find((r) => r.call === `${basename(LAUNCHCTL)} ${sub}`); // the fake's own name
const budget = () => lines(BUDGET);
// The shared deadline, from the helper's own clock: every timed call was given at most what was left of its deadline
// when it started, so none gets fresh time after the cutoff.
const withinDeadline = (trace) => {
  expect(trace.length).toBeGreaterThan(0);
  for (const r of trace.filter((x) => "timeout" in x)) expect(r.timeout, r.call).toBeLessThanOrEqual(Math.max(0, r.end - r.at) + 1e-9);
};
// Only whole lines: a test that polls may read a log the fake has just created, or is still writing.
const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").slice(0, -1).map((l) => JSON.parse(l)) : []);
const calls = () => lines(LOG);
// What a desktop-session read may leave: a loaded job or its private folder (only those: macOS keeps its own files in
// TMPDIR too). Nothing, after any read.
const leftovers = () => [...(existsSync(LAUNCHD) ? readdirSync(LAUNCHD) : []), ...readdirSync(TMP)].filter((f) => /^(dev\.tremor\.usage\.|pdk-usage-)/.test(f));
const settled = async (ms = 30000) => { for (const end = Date.now() + ms; leftovers().length && Date.now() < end;) await Bun.sleep(50); return leftovers(); };

// A PATH holding only the named fake tools.
function bin(tools) {
  const dir = `${ROOT}/bin-${tools.join("-") || "none"}`;
  mkdirSync(dir, { recursive: true });
  for (const t of tools) {
    writeFileSync(`${dir}/${t}`, TOOLS[t]);
    chmodSync(`${dir}/${t}`, 0o755);
  }
  return dir;
}

function read(path, env = {}, opts = {}) {
  for (const f of ["codex-argv", "claude-argv", "claude-cwd", "claude-invocations"]) rmSync(`${ROOT}/${f}`, { force: true });
  const r = Bun.spawnSync(helperArgv(opts), { cwd: `${ROOT}/work`, env: { HOME, PATH: path, ...fakeEnv(), ...env } });
  const out = r.stdout.toString();
  expect(r.exitCode).toBe(0);
  return { reply: JSON.parse(out), out, err: r.stderr.toString() };
}
const byProvider = (reply) => Object.fromEntries(reply.cards.map((c) => [c.provider, c]));

const NOW = Date.parse("2026-11-09T17:57:30Z"); // when the reference was read
const ALL = ["codex", "claude", "moshi", "grok"];


test("every source by default: Codex app-server, Claude /usage, Moshi only for other providers", () => {
  const { reply, out } = read(bin(ALL));
  expect(reply.cards.map((c) => [c.provider, c.source])).toEqual([["codex", "Codex app-server"], ["claude-code", "Claude Code /usage"], ["grok", "Moshi hook"]]);
  const by = byProvider(reply);
  expect(by.codex).toMatchObject({ plan: "Prolite", email: "o•••@e•••.com" });
  expect(by.codex.windows).toEqual([{ label: "7d", used: 94, resetsAt: 1794386625000, mins: 10080 }]);
  expect(by["claude-code"]).toMatchObject({ plan: "Max 20x", email: "o•••@e•••.com" });
  expect(by["claude-code"].windows).toEqual([
    { label: "7d", used: 34, resetsAt: Date.parse("2026-11-14T14:00:00Z"), mins: 10080 },
    { label: "Fable", used: 22, resetsAt: Date.parse("2026-11-14T14:00:00Z"), mins: 10080 },
  ]);
  expect(by.grok).toMatchObject({ plan: "Grok", email: "o•••@e•••.com", host: "Fixture-MBP.local", capturedAt: Date.parse("2026-11-09T07:05:37.178Z") });
  // Moshi's own Codex and Claude figures never stand in for the clean ones; its cost block and ids never pass.
  for (const gone of ["Pro 5x", "Ultra", "owner.name", "example.com", "cost", "estimatedCostUsd", "acct-fixture", "accountId", "chatgptAccountId", "balance"]) expect(out).not.toContain(gone);
  // Only /usage's limit lines leave the helper; what it says about local sessions does not.
  for (const gone of ["contributing", "requests", "sessions on this machine", "Top skills", "fixture-skill", "subscription"]) expect(out).not.toContain(gone);
  expect(reply.sources).toMatchObject([{ name: "Codex app-server", provider: "codex", ok: true }, { name: "Claude Code /usage", provider: "claude-code", ok: true }, { name: "Moshi hook", provider: null, ok: true }]);
});

test("Claude's /usage is read with no flag, CodeNotch's way, from one fixed scratch folder", () => {
  read(bin(["claude"]));
  expect(readFileSync(`${ROOT}/claude-argv`, "utf8").trim().split("\n")).toEqual(["--print", "--no-session-persistence", "--strict-mcp-config", "--setting-sources", "project,local", "/usage"]);
  expect(readFileSync(`${ROOT}/claude-cwd`, "utf8").trim()).toBe(SCRATCH);
  expect(existsSync(SCRATCH)).toBe(true);
});

test("a missing Claude Code is absent; a signed-out one is installed but unavailable, /usage not run; neither has words", () => {
  for (const [path, env, ok] of [[bin(["codex"]), {}, null], [bin([]), {}, null], [bin(["codex", "claude"]), { FAKE_SIGNED_OUT: "1" }, false]]) {
    const { reply, out } = read(path, env);
    expect(reply.cards.some((c) => c.provider === "claude-code")).toBe(false);
    expect(reply.sources[1]).toMatchObject({ name: "Claude Code /usage", provider: "claude-code", ok });
    for (const words of ["PATH", "navailable", "not found", "signed in", "note"]) expect(out).not.toContain(words);
  }
  expect(readFileSync(`${ROOT}/claude-invocations`, "utf8").trim()).toBe("auth status --json");
  expect(read(bin([])).reply.cards).toEqual([]);
});

test("Codex's app-server is started with the isolation flags; its config values are never passed on", () => {
  read(bin(ALL));
  const argv = readFileSync(`${ROOT}/codex-argv`, "utf8").trim().split("\n");
  expect(argv[0]).toBe("app-server");
  for (const flag of ["features.hooks=false", "notify=[]", "plugins", "apps", "mcp_servers.alpha.enabled=false", "mcp_servers.beta-2.enabled=false"]) expect(argv).toContain(flag);
  expect(argv.join(" ")).not.toContain("do-not-pass-me");
  expect(argv.join(" ")).not.toContain("profiles");
});

test("a source that fails gives no card and is marked failed, so the foot keeps its last good values; Moshi never fills in", () => {
  const { reply } = read(bin(ALL), { FAKE_USAGE_EXIT: "1" });
  expect(reply.cards.map((c) => c.provider)).toEqual(["codex", "grok"]);
  expect(reply.sources[1]).toMatchObject({ name: "Claude Code /usage", provider: "claude-code", ok: false });
});

test("Claude's /usage lines: the session window, h:mm and on-the-hour resets in their own zone, a week with no reset", () => {
  const { reply } = read(bin(["claude"]), { FAKE_USAGE: `${FIX}claude-usage-session.txt` });
  const w = byProvider(reply)["claude-code"].windows;
  expect(w.map((x) => [x.label, x.used, x.mins])).toEqual([["5h", 38, 300], ["7d", 4, 10080], ["Opus", 61, 10080]]);
  // No year is printed: the one nearest to now.
  const y = new Date().getUTCFullYear();
  const near = (iso) => [y - 1, y, y + 1].map((n) => Date.parse(`${n}${iso}`)).sort((a, b) => Math.abs(a - Date.now()) - Math.abs(b - Date.now()))[0];
  expect(w[0].resetsAt).toBe(near("-09-07T07:59:00Z")); // 2:59pm in Asia/Jakarta (UTC+7)
  expect(w[1].resetsAt).toBe(near("-09-13T22:00:00Z")); // 5am on the 14th in Jakarta
  expect(w[2].resetsAt).toBe(null); // the percentage stays when no reset is printed
});

test("without Moshi: Grok is never run and has no card", () => {
  const { reply } = read(bin(["codex", "claude", "grok"]));
  expect(reply.cards.map((c) => c.provider)).toEqual(["codex", "claude-code"]);
  expect(reply.sources[2]).toEqual({ name: "Moshi hook", provider: null, ok: null });
});

test("yellow at or above 80%, from the theme's blocked token; normal bars on done", () => {
  expect(HIGH).toBe(80);
  expect([79.9, 80, 94].map(isHigh)).toEqual([false, true, true]);
  const main = readFileSync(new URL("../mods/pdk-usage/main.js", import.meta.url), "utf8");
  expect(main).toContain("high ? t.blocked : t.done");
  expect(main).not.toMatch(/#[0-9a-fA-F]{3,8}\b/); // no hex: theme tokens only
});

test("the reset countdown", () => {
  const at = (s) => Date.parse(s);
  expect(countdown(at("2026-11-14T14:00:00Z"), NOW)).toBe("4d 20h");
  expect(countdown(at("2026-11-11T08:44:00Z"), NOW)).toBe("1d 14h");
  expect(countdown(at("2026-11-10T12:28:20.746Z"), NOW)).toBe("18h 30m");
  expect(countdown(NOW + 12 * 60000 + 5000, NOW)).toBe("12m");
  expect(countdown(NOW + 30000, NOW)).toBe("<1m");
  expect(countdown(NOW + 3600000, NOW)).toBe("1h 0m");
  expect([countdown(NOW - 1, NOW), countdown(null, NOW)]).toEqual([null, null]);
});

test("the foot's lines: per agent with limits its 7d window as option A writes it; another window says which", () => {
  const { reply } = read(bin(ALL));
  const lines = footLines(reply, NOW);
  expect(lines.map((l) => [l.name, l.text, l.fill, l.high])).toEqual([
    ["Claude Code", "34% · resets 4d 20h", 0.34, false], ["Codex", "94% · resets 1d 14h", 0.94, true], ["Grok Build", lines[2].text, 0.79, false]]);
  expect(lines[2].text).toMatch(/^79%( · resets \S+( \S+)?)?$/); // Moshi's 7d window; its reset is relative to the fixture
  const session = { cards: [{ provider: "claude-code", source: "Claude Code /usage", windows: [{ label: "Opus", used: 61 }, { label: "5h", used: 38, resetsAt: NOW + 3600000 }] }] };
  expect(footLines(session, NOW)[0].text).toBe("5h 38% · resets 1h 0m"); // 7d, else 5h, else the first reported
  expect(footLines({ cards: [{ provider: "codex", windows: [] }] }, NOW)).toEqual([]);
  expect(footLines(null, NOW)).toEqual([]);
  // Installed but unavailable: its mark and "-", no bar; a value kept from before a failed read: "stale", no reset.
  const sources = [{ name: "Codex app-server", provider: "codex", ok: false }, { name: "Claude Code /usage", provider: "claude-code", ok: null }];
  expect(footLines({ cards: [], sources }, NOW).map((l) => [l.name, l.text, l.fill])).toEqual([["Codex", "-", null]]);
  const kept = mergeUsage({ cards: [sample({ windows: [{ label: "7d", used: 25, resetsAt: NOW + 3600000 }] })] }, { cards: [], sources });
  expect(footLines(kept, NOW).map((l) => [l.text, l.stale])).toEqual([["25% · stale", true]]);
  expect(footLines(mergeUsage(kept, { cards: [sample()], sources: [{ ...sources[0], ok: true }] }), NOW)[0].stale).toBe(false); // fresh clears it
});

// ---- Settings (spec section 5): Herdr's own ----

test("the gear runs Herdr's own Settings; tremor has no settings popover, Help overlay, theme list or Colours", () => {
  const main = readFileSync(new URL("../mods/pdk-usage/main.js", import.meta.url), "utf8");
  expect(main).toContain('run("app.settings")');
  expect(main).not.toMatch(/openOverlay|pdk-tokens|"settings"\)|"help"|theme:|glass:o|machines:o|claude:on|Off by default|against your home|"plug"/);
  expect(existsSync(new URL("../mods/pdk-usage/settings.js", import.meta.url))).toBe(false);
  expect(existsSync(new URL("../mods/pdk-tokens", import.meta.url))).toBe(false);
});

const sample = (extra = {}) => ({ provider: "codex", source: "Codex app-server", host: "test-host", capturedAt: NOW,
  windows: [{ label: "7d", used: 25, resetsAt: NOW + 3.5 * 86400000 }], ...extra });

test("R15: overlapping reads of one machine and another foot run only one read", async () => {
  const state = new Map();
  let finish, calls = 0;
  const fetch = () => { calls++; return new Promise((r) => { finish = r; }); };
  const a = new UsageReader((k) => state.get(k), (k, v) => state.set(k, v), fetch, () => NOW);
  const b = new UsageReader((k) => state.get(k), (k, v) => state.set(k, v), fetch, () => NOW);
  const first = a.read();
  expect(a.read()).toBe(first);
  expect(await b.read()).toBeNull();
  expect(calls).toBe(1);
  expect(state.get(usageKeys().reader).inFlight).toBe(true);
  finish({ cards: [sample()], sources: [], readAt: NOW });
  await first;
  expect(state.get(usageKeys().data).cards).toHaveLength(1);
  expect(state.get(usageKeys().reader).inFlight).toBe(false);
});

test("each machine has its own reply: box's read never lands in this computer's", async () => {
  const state = new Map(), get = (k) => state.get(k), set = (k, v) => state.set(k, v);
  await new UsageReader(get, set, async () => ({ cards: [sample({ windows: [{ label: "7d", used: 49 }] })], sources: [], readAt: NOW }), () => NOW, "").read();
  await new UsageReader(get, set, async () => ({ cards: [sample({ windows: [{ label: "7d", used: 71 }] })], sources: [], readAt: NOW }), () => NOW, "box").read();
  expect(footLines(state.get(usageKeys("").data), NOW).map((l) => l.text)).toEqual(["49%"]);
  expect(footLines(state.get(usageKeys("box").data), NOW).map((l) => l.text)).toEqual(["71%"]);
  expect(new UsageReader(get, set, null, () => NOW + 5 * 60000, "box").stale()).toBe(true);
  expect(new UsageReader(get, set, null, () => NOW + 60000, "box").stale()).toBe(false);
});

test("R15: expired owning generation cannot overwrite a newer result", async () => {
  const state = new Map();
  let finish, now = NOW;
  const get = (k) => state.get(k), set = (k, v) => state.set(k, v);
  const old = new UsageReader(get, set, () => new Promise((r) => { finish = r; }), () => now);
  const first = old.read();
  now += 100001;
  const fresh = new UsageReader(get, set, async () => ({ cards: [sample({ plan: "new" })], sources: [], readAt: now }), () => now);
  await fresh.read();
  finish({ cards: [sample({ plan: "old" })], sources: [], readAt: NOW });
  expect(await first).toBeNull();
  expect(state.get(usageKeys().data).cards[0].plan).toBe("new");
});

test("R15: a failed source or helper keeps its last good values; a source with nothing to read clears them", async () => {
  const previous = { cards: [sample(), sample({ provider: "claude-code", source: "Claude Code /usage" })], sources: [], readAt: NOW };
  const partial = mergeUsage(previous, { cards: [], sources: [{ name: "Codex app-server", ok: false }, { name: "Claude Code /usage", ok: null }], readAt: NOW + 1 });
  expect(partial.cards.map((c) => [c.provider, c.stale])).toEqual([["codex", true]]);
  const state = new Map([[usageKeys().data, previous]]);
  await new UsageReader((k) => state.get(k), (k, v) => state.set(k, v), async () => { throw new Error("helper failed"); }, () => NOW + 2).read();
  expect(state.get(usageKeys().data).cards.map((c) => c.capturedAt)).toEqual([NOW, NOW]);
  expect(mergeUsage(previous, { cards: [], sources: [], readAt: NOW + 3 }).cards).toEqual([]);
});

test("H11: guard the effective CODEX_HOME, including quoted dotted names and commented headers", () => {
  const alt = `${ROOT}/alt-codex`;
  mkdirSync(alt, { recursive: true });
  writeFileSync(`${alt}/config.toml`, '[mcp_servers."remote"]\ncommand="never-run"\n[mcp_servers.commented] # valid TOML\ncommand="never-run"\n');
  const { reply } = read(bin(ALL), { CODEX_HOME: alt });
  if (!existsSync(`${ROOT}/codex-argv`)) {
    expect(byProvider(reply).codex).toBeUndefined();
    return;
  }
  const args = readFileSync(`${ROOT}/codex-argv`, "utf8").trim().split("\n");
  const flags = args.flatMap((a,i) => args[i-1] === "-c" ? [a] : []);
  const disabled = Object.assign({}, ...flags.filter(f => f.startsWith("mcp_servers.")).map(f => Bun.TOML.parse(f).mcp_servers));
  expect(disabled["remote"]?.enabled).toBe(false);
  expect(disabled.commented?.enabled).toBe(false);
  expect(disabled.alpha).toBeUndefined();
});

test("H11: an unprovable active-profile or unexpressible server refuses before Codex exec: no card; installed, so unavailable", () => {
  for (const config of ['profile="safe"\n[profiles.safe.mcp_servers.alpha]\ncommand="never"\n', '[mcp_servers."literal.dot"]\ncommand="never"\n', 'x = { invalid']) {
    const alt = `${ROOT}/refused-codex`; mkdirSync(alt,{recursive:true}); writeFileSync(`${alt}/config.toml`,config);
    const {reply}=read(bin(ALL),{CODEX_HOME:alt});
    expect(existsSync(`${ROOT}/codex-argv`)).toBe(false);
    expect(byProvider(reply).codex).toBeUndefined();
    expect(reply.sources[0]).toMatchObject({ name: "Codex app-server", provider: "codex", ok: false, account: null });
    expect(byProvider(mergeUsage({cards:[sample({provider:"codex",source:"Codex app-server"})]},reply)).codex.stale).toBe(true);
  }
});

// ---- The foot and the per-machine read, through the mod's own code ----

function foot(store = {}, machines = null) {
  const h = harness(world(2));
  if (machines) h.world.machines = machines;
  Object.assign(h.env, usage, { appHome: () => `${ROOT}/app` });
  for (const [k, v] of Object.entries(store)) h.store.set(k, v);
  const Usage = evaluate("mods/pdk-usage/main.js", h.env, "Usage"), v = new Usage();
  v.init({}, h.cx);
  return { h, v };
}
const words = (n) => typeof n === "string" ? [n] : (n?.kids ?? []).flatMap(words);

test("the foot: per machine its label, then per agent its mark, percent, reset and a full-width bar; no names, short tooltips", () => {
  const { reply } = read(bin(["codex", "claude"]));
  const box = { ...reply, cards: reply.cards.map((c) => ({ ...c, windows: [{ ...c.windows[0], used: c.provider === "codex" ? 18 : 71 }] })) };
  const { h, v } = foot({ [usageKeys("").data]: reply, [usageKeys("box").data]: box });
  const text = words(v.bar(h.env.theme()));
  expect(text.filter((w) => /%/.test(w)).map((w) => w.replace(/ · resets .*/, ""))).toEqual(["34%", "94%", "71%", "18%"]);
  expect(text).toContain("This computer"); expect(text).toContain("box");
  for (const gone of ["Claude", "Codex", "navailable", "ncomplete", "Age unknown", "PATH", "timed out"]) expect(text.join(" ")).not.toContain(gone);
  // The bars fill the foot's width (no fixed pixel width) and the block takes the height its lines need.
  const bars = h.elements.filter((e) => String(e.props.id).startsWith("ub-"));
  expect(bars).toHaveLength(4);
  for (const b of bars) { expect(b.props.w_full).toBe(true); expect(b.props.w).toBeUndefined(); }
  // 1 edge + 12 + per machine (14 label + 8 + 25 per line, the second 8 below) + 12 between + 12 (the contract)
  expect(h.calls).toContainEqual(["layout.resize", { id: "usage", px: 1 + 12 + 2 * (14 + 8 + 25 + 8 + 25) + 12 + 12 }]);
  const bar = h.elements.find((e) => String(e.props.id).startsWith("ub-"));
  expect([bar.kind, bar.props.value]).toEqual(["Progress", 34]);
  for (const e of h.elements) if (typeof e.props.tooltip === "string") expect(e.props.tooltip.split(/\s+/).length, e.props.tooltip).toBeLessThanOrEqual(3);
  expect(h.elements.some((e) => e.props.id === "usage-sources")).toBe(false);
});

test("the machine filter: one machine shows only its group; All, or a machine no longer known, shows every machine", () => {
  const { reply } = read(bin(["codex", "claude"]));
  for (const [filter, labels] of [["box", ["box"]], ["", ["This computer"]], ["all", ["This computer", "box"]], ["gone", ["This computer", "box"]], [undefined, ["This computer", "box"]]]) {
    const { h, v } = foot({ [usageKeys("").data]: reply, [usageKeys("box").data]: reply, ...(filter === undefined ? {} : { "pdk.machine.filter": filter }) });
    const text = words(v.bar(h.env.theme()));
    expect(["This computer", "box"].filter((l) => text.includes(l))).toEqual(labels);
  }
});

test("with no data at all the foot is the gear alone", () => {
  const { h, v } = foot({ [usageKeys("").data]: { cards: [], sources: [] } });
  expect(words(v.bar(h.env.theme()))).toEqual([]);
  expect(h.elements.some((e) => e.props.id === "usage-settings")).toBe(true);
  expect(h.calls).toContainEqual(["layout.resize", { id: "usage", px: 40 }]);
});

test("another machine is read there: the same helper and parser through exec on that machine, this computer as before", async () => {
  const { h } = foot();
  const runs = [];
  h.env.readTextFile = async (path) => readFileSync(new URL(`../helper/${basename(path)}`, import.meta.url), "utf8");
  h.env.exec = async (command, args, opts) => {
    runs.push({ command, opts });
    // Stand in for that machine: its own home and PATH.
    const r = Bun.spawnSync([command === "python3" ? "/usr/bin/python3" : command, ...(command === "python3" ? args : [HELPER, ...args.slice(3)])], { cwd: HOME, env: { HOME, PATH: bin(["codex", "claude"]) } });
    return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
  };
  const fetchUsage = evaluate("mods/pdk-usage/main.js", h.env, "fetchUsage");
  const remote = await fetchUsage("box");
  expect(runs[0]).toMatchObject({ command: "python3", opts: { on: "box" } });
  expect(remote.cards.map((c) => [c.provider, c.windows[0].used])).toEqual([["codex", 94], ["claude-code", 34]]);
  expect(readFileSync(`${ROOT}/claude-cwd`, "utf8").trim()).toBe(`${HOME}/.config/herdr-app/pdk-state/usage-scratch`);
  await fetchUsage(null);
  expect(runs[1].command).toBe("/usr/bin/python3");
  expect(runs[1].opts.on).toBeUndefined();
});

test("UX02: an offline machine chosen keeps the foot to itself: it shows nothing, never another machine's usage", () => {
  const { reply } = read(bin(["codex", "claude"]));
  const store = { [usageKeys("").data]: reply, [usageKeys("box").data]: reply, "pdk.machine.filter": "box" };
  // box disconnects while it is chosen: still known (machines() reports it unavailable), so the filter stays on box.
  const { h, v } = foot(store, [{ id: "core-box", name: "box", state: "disconnected", target: "host", session: "s" }]);
  const text = words(v.bar(h.env.theme()));
  expect(text).toEqual([]); // the gear alone: not "This computer" and its 51%
  expect(h.elements.some((e) => e.props.id === "usage-settings")).toBe(true);
  // Connected again, box shows its own; All shows both.
  const back = foot(store);
  expect(words(back.v.bar(back.h.env.theme())).filter((w) => ["This computer", "box"].includes(w))).toEqual(["box"]);
});

test("UX06: a kept value is only ever its own account's; a failed read for another account, or a sign-out, clears it", () => {
  const first = read(bin(["claude"])).reply;
  const card = first.cards.find((c) => c.provider === "claude-code");
  expect(card.account).toMatch(/^[0-9a-f]{16}$/); // a hash: never the address
  // The person signs in as someone else, and that account's /usage then fails.
  writeFileSync(`${ROOT}/other-auth.json`, JSON.stringify({ loggedIn: true, email: "someone.else@example.org", subscriptionType: "pro" }));
  const { reply: other, out } = read(bin(["claude"]), { FAKE_AUTH: `${ROOT}/other-auth.json`, FAKE_USAGE_EXIT: "1" });
  expect(other.sources[1]).toMatchObject({ name: "Claude Code /usage", ok: false });
  expect(other.sources[1].account).toMatch(/^[0-9a-f]{16}$/);
  expect(other.sources[1].account).not.toBe(card.account);
  expect(out).not.toContain("someone.else"); expect(out).not.toContain("example.org");
  expect(mergeUsage(first, other).cards.some((c) => c.provider === "claude-code")).toBe(false); // cleared: "Can't read"
  // The same account failing keeps its value, stale; a read that learned nothing keeps it; a sign-out clears it.
  const same = read(bin(["claude"]), { FAKE_USAGE_EXIT: "1" }).reply;
  expect(same.sources[1].account).toBe(card.account);
  expect(mergeUsage(first, same).cards.find((c) => c.provider === "claude-code")).toMatchObject({ stale: true, account: card.account });
  const unknown = { cards: [], sources: [{ name: "Claude Code /usage", provider: "claude-code", ok: false, account: null }] };
  expect(mergeUsage(first, unknown).cards.find((c) => c.provider === "claude-code").stale).toBe(true);
  const out2 = read(bin(["claude"]), { FAKE_SIGNED_OUT: "1" }).reply;
  expect(out2.sources[1].account).toBe("");
  expect(mergeUsage(first, out2).cards.some((c) => c.provider === "claude-code")).toBe(false);
});

// ---- Claude on a Mac reached over ssh (owner, 11 Nov 2026: "every machine must show Claude usage by default whenever
// Claude is installed there"). Over ssh the login keychain is closed and Claude reads as signed out; the same read
// runs once more as a one-off job in that Mac's desktop session. Doubles: the fake claude is signed out where
// FAKE_SIGNED_OUT is set (the ssh side) and signed in where it isn't (the job's own environment); the fake launchctl.

const OVER_SSH = { FAKE_SIGNED_OUT: "1", FAKE_SESSION: "Background" };
const claudeLine = (reply) => footLines(reply, NOW).find((l) => l.provider === "claude-code");

test("a Mac reached over ssh, signed out there and signed in on its desktop, shows Claude's percentages, through the remote bootstrap", async () => {
  const { h } = foot();
  const fake = (src) => src.replace('LAUNCHCTL = "/bin/launchctl"', `LAUNCHCTL = ${JSON.stringify(LAUNCHCTL)}`);
  h.env.readTextFile = async (path) => fake(readFileSync(new URL(`../helper/${basename(path)}`, import.meta.url), "utf8"));
  expect(await h.env.readTextFile("pdk-usage.py")).not.toContain("/bin/launchctl"); // never the real launchd
  rmSync(`${ROOT}/claude-invocations`, { force: true });
  const env = { HOME, PATH: bin(["claude"]), ...fakeEnv(), ...OVER_SSH };
  h.env.exec = async (command, args, opts) => {
    const r = Bun.spawnSync(["/usr/bin/python3", ...args], { cwd: HOME, env });
    return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
  };
  const reply = await evaluate("mods/pdk-usage/main.js", h.env, "fetchUsage")("studio-mac");
  expect(claudeLine(reply)).toMatchObject({ text: "34% · resets 4d 20h", fill: 0.34 });
  expect(reply.cards[0]).toMatchObject({ plan: "Max 20x", email: "o•••@e•••.com" });
  // auth status over ssh (signed out), then the job: auth status and /usage, with the helper's own flags, nothing else.
  expect(readFileSync(`${ROOT}/claude-invocations`, "utf8").trim().split("\n")).toEqual(["auth status --json", "auth status --json", "--print --no-session-persistence --strict-mcp-config --setting-sources project,local /usage"]);
  const [ask, swept, boot, ...outs] = calls();
  expect([ask.cmd, swept.cmd, boot.cmd]).toEqual(["managername", "print", "bootstrap"]); // the sweep's look first
  expect(boot).toMatchObject({ domain: `gui/${process.getuid()}`, session: "Aqua", mode: "0o700", env: ["HOME", "PATH"] });
  expect(boot.label).toMatch(/^dev\.tremor\.usage\.\d{10}\.[0-9a-f]{16}$/); // its time, for the sweep
  expect(Math.abs(Number(boot.label.split(".")[3]) - Date.now() / 1000)).toBeLessThan(60);
  // The helper's own text in that private folder, in its Claude-only mode: the folder under TMPDIR, made for this read.
  expect(boot.argv.slice(1, 3).concat(boot.argv[4])).toEqual(["-I", "-S", "claude"]);
  expect(boot.argv[3]).toMatch(new RegExp(`^${TMP}/pdk-usage-${boot.label.split(".")[3]}-[^/]+/claude\\.py$`));
  expect(boot.argv.slice(5, 9)).toEqual([`${HOME}/.config/herdr-app/pdk-state/usage-scratch`, `${bin(["claude"])}/claude`, dirname(boot.argv[3]), boot.label]);
  expect(Number(boot.argv[9])).toBeLessThanOrEqual(40); // its time, within the helper's
  expect(Number(boot.argv[10])).toBeGreaterThan(1); // the helper's pid: the job stops waiting when it is gone
  // Booted out by the helper once it took the answer (and maybe by the job itself, which then finds it gone).
  expect(outs.length).toBeGreaterThan(0);
  for (const o of outs) expect(o).toMatchObject({ cmd: "bootout", target: `gui/${process.getuid()}/${boot.label}` });
  expect(await settled()).toEqual([]);
});

test("no desktop session (bootstrap refused): Sign in, at once, one try; signed out everywhere: Sign in, never a dash", () => {
  let t = Date.now();
  const refused = read(bin(["claude"]), { ...OVER_SSH, FAKE_NO_DESKTOP: "1" }).reply;
  expect(Date.now() - t).toBeLessThan(20000); // at once: far from the 40 s it would wait for a job
  expect(calls().map((c) => c.cmd)).toEqual(["managername", "print", "bootstrap", "bootout"]);
  expect(refused.sources[1]).toMatchObject({ provider: "claude-code", ok: false, account: "" });
  expect(claudeLine(refused)).toMatchObject({ text: "Sign in", fill: null });
  expect(leftovers()).toEqual([]);
  const everywhere = read(bin(["claude"]), { ...OVER_SSH, FAKE_DESKTOP_ENV: JSON.stringify({ FAKE_SIGNED_OUT: "1" }) }).reply;
  expect(claudeLine(everywhere)).toMatchObject({ text: "Sign in", fill: null });
  expect(readFileSync(`${ROOT}/claude-invocations`, "utf8").trim().split("\n")).toEqual(["auth status --json", "auth status --json"]); // no /usage
  expect(leftovers()).toEqual([]);
});

test("the job and its folder are gone after a read that succeeds, fails or times out; two reads at once each get their own", async () => {
  read(bin(["claude"]), OVER_SSH);
  expect(leftovers()).toEqual([]);
  const failed = read(bin(["claude"]), { ...OVER_SSH, FAKE_DESKTOP_ENV: JSON.stringify({ FAKE_USAGE_EXIT: "1" }) }).reply;
  expect(failed.sources[1]).toMatchObject({ ok: false, account: expect.stringMatching(/^[0-9a-f]{16}$/) });
  expect(claudeLine(failed).text).toBe("Can't read");
  expect(leftovers()).toEqual([]);
  // The job hangs: the read gives up after its timeout and the job is killed with its folder.
  const t = Date.now();
  const hung = read(bin(["claude"]), { ...OVER_SSH, FAKE_DESKTOP_ENV: JSON.stringify({ FAKE_SLEEP: "30" }) }, { hop: 1 }).reply;
  expect(Date.now() - t).toBeLessThan(20000); // gave up at its 1 s, never waited for the job's 30 s
  expect(hung.sources[1]).toMatchObject({ ok: false, account: null });
  expect(claudeLine(hung).text).toBe("Can't read");
  expect(leftovers()).toEqual([]);
  // Two at once: their own label and folder, both answered.
  const env = { HOME, PATH: bin(["claude"]), ...fakeEnv(), ...OVER_SSH }; // one log for both
  const both = await Promise.all([0, 1].map(async () => {
    const p = Bun.spawn(helperArgv(), { cwd: `${ROOT}/work`, env, stdout: "pipe" });
    return JSON.parse(await new Response(p.stdout).text());
  }));
  expect(both.map((r) => claudeLine(r).text)).toEqual(["34% · resets 4d 20h", "34% · resets 4d 20h"]);
  const labels = calls().filter((c) => c.cmd === "bootstrap").map((c) => c.label);
  expect(new Set(labels).size).toBe(2);
  expect(leftovers()).toEqual([]);
});

test("not installed (no claude, no ~/.claude): no Claude row; ~/.claude but no claude found: the row says Can't read", () => {
  const none = read(bin(["codex"])).reply;
  expect(none.sources[1]).toMatchObject({ provider: "claude-code", ok: null });
  expect(claudeLine(none)).toBeUndefined();
  expect(footLines(none, NOW).map((l) => l.provider)).toEqual(["codex"]); // Codex as before
  const home = `${ROOT}/u-dot`;
  mkdirSync(`${home}/.claude`, { recursive: true });
  const dot = read(bin([]), { HOME: home }).reply;
  expect(dot.sources[1]).toMatchObject({ provider: "claude-code", ok: false, account: null });
  expect(claudeLine(dot)).toMatchObject({ text: "Can't read", fill: null });
  expect(calls()).toEqual([]);
});

test("Claude in its installer's folder, not on PATH, is found and read", () => {
  const home = `${ROOT}/u-local`;
  mkdirSync(`${home}/.local/bin`, { recursive: true });
  writeFileSync(`${home}/.local/bin/claude`, CLAUDE); chmodSync(`${home}/.local/bin/claude`, 0o755);
  expect(claudeLine(read(bin([]), { HOME: home }).reply).text).toBe("34% · resets 4d 20h");
});

test("no hop where it can't help: a Linux machine, or a Mac's own desktop session, signed out is Sign in with no job", () => {
  for (const [env, opts] of [[OVER_SSH, { mac: false }], [{ FAKE_SIGNED_OUT: "1" }, {}]]) {
    const { reply } = read(bin(["claude"]), env, opts);
    expect(claudeLine(reply).text).toBe("Sign in");
    expect(calls().map((c) => c.cmd)).toEqual(opts.mac === false ? [] : ["managername"]);
    expect(readFileSync(`${ROOT}/claude-invocations`, "utf8").trim()).toBe("auth status --json");
  }
});

test("Codex and Grok keep their dash; only Claude has words, and those are short", () => {
  const sources = [{ name: "Codex app-server", provider: "codex", ok: false, account: "" }, { name: "Claude Code /usage", provider: "claude-code", ok: false, account: "" },
    { name: "x", provider: "grok", ok: false }];
  expect(footLines({ cards: [], sources }, NOW).map((l) => [l.name, l.text, l.words])).toEqual([["Claude Code", "Sign in", "Sign in"], ["Codex", "-", "unavailable"], ["Grok Build", "-", "unavailable"]]);
  for (const l of footLines({ cards: [], sources: [{ ...sources[1], account: null }] }, NOW)) expect(l.text.split(" ").length).toBeLessThanOrEqual(3);
});

test("RP04: a helper killed mid-read (kill -9) leaves nothing: the job removes its folder and boots itself out", async () => {
  const env = { HOME, PATH: bin(["claude"]), ...fakeEnv(), ...OVER_SSH, FAKE_DESKTOP_ENV: JSON.stringify({ FAKE_SLEEP: "1" }) };
  const helper = Bun.spawn(helperArgv({ hop: 20 }), { cwd: `${ROOT}/work`, env, stdout: "ignore", stderr: "ignore" });
  let boot;
  for (const end = Date.now() + 30000; !boot && Date.now() < end; await Bun.sleep(20)) boot = calls().find((c) => c.cmd === "bootstrap");
  for (const end = Date.now() + 30000; !existsSync(`${LAUNCHD}/${boot.label}`) && Date.now() < end;) await Bun.sleep(20);
  const job = Number(readFileSync(`${LAUNCHD}/${boot.label}`, "utf8"));
  expect(leftovers().length).toBe(2); // loaded, with its folder
  helper.kill(9);
  await helper.exited;
  expect(await settled()).toEqual([]);
  expect(calls().filter((c) => c.cmd === "bootout" && c.target.endsWith(boot.label))).toEqual([{ cmd: "bootout", target: `gui/${process.getuid()}/${boot.label}`, by: "job", failed: false }]);
  const ended = () => { try { process.kill(job, 0); return false; } catch { return true; } };
  for (const end = Date.now() + 30000; !ended() && Date.now() < end;) await Bun.sleep(50); // reaped, however busy
  expect(ended()).toBe(true);
});

test("RP04: one deadline for the whole helper: everything slow, or a slow Codex then a hung desktop read, ends in time and leaves nothing", async () => {
  const work = 4;
  // Codex, Claude and Moshi all hang. Codex's 6 s answer is cut at the 4 s deadline (its own limit is 20 s); every read
  // after it starts at the cutoff and gets nothing more: their own limits (15, 20, 20 s) would have added up to 61 s.
  let t = Date.now();
  const all = read(bin(["codex", "claude", "moshi"]), { FAKE_CODEX_SLEEP: "6", FAKE_SLEEP: "60", FAKE_SLOW: "1" }, { work }).reply;
  expect(all.sources.map((s) => s.ok)).toEqual([false, false, false]);
  const trace = budget();
  withinDeadline(trace);
  const codex = trace.find((r) => r.call === "codex rpc");
  expect(Math.abs(codex.timeout - Math.min(20, work - codex.at))).toBeLessThan(0.01); // all that was left, not its 20 s
  const after = trace.filter((r) => r.at > codex.at && r.end === work);
  expect(after.map((r) => r.call)).toEqual(["claude auth", "claude --print", "moshi usage", "scutil --get"]); // the host name too: it falls back to the kernel's
  for (const r of after) expect(r.timeout, r.call).toBeLessThan(0.05); // nothing past the cutoff
  expect(Date.now() - t).toBeLessThan(60000); // scheduling only: the budget above is the proof
  // Codex answers late (1.5 s), Claude is signed out over ssh and its desktop job hangs, Moshi would hang: the job gets
  // only what is left, is booted out and its folder removed, and the helper is done well inside the app's 90 s. The
  // deadline here leaves room for the hop to start however busy the machine is (at load 26 a 4 s one did not).
  const work2 = 12;
  t = Date.now();
  const hop = read(bin(["codex", "claude", "moshi"]), { ...OVER_SSH, FAKE_CODEX_SLEEP: "1.5", FAKE_SLOW: "1", FAKE_DESKTOP_ENV: JSON.stringify({ FAKE_SLEEP: "60" }) }, { work: work2 });
  expect(byProvider(hop.reply).codex.windows[0].used).toBe(94); // a good read before the deadline is kept
  expect(hop.reply.sources[1]).toMatchObject({ provider: "claude-code", ok: false, account: null });
  const trace2 = budget();
  withinDeadline(trace2);
  // The hop is given exactly what was left of the deadline (less than its 40 s cap), and its wait, sweep and bootstrap
  // included, ends by that same cutoff.
  const h2 = trace2.find((r) => r.call === "hop");
  expect(Math.abs(h2.timeout - Math.min(h2.cap, h2.end - h2.at))).toBeLessThan(0.01);
  expect(h2.timeout).toBeLessThan(h2.cap);
  expect(h2.until).toBeLessThanOrEqual(h2.end + 1e-6);
  expect(trace2.find((r) => r.call === "hop wait").until).toBe(h2.until); // the bound the wait really uses, after the sweep and bootstrap
  // The job is handed what is left of the hop when its plist is written: no more, and never past the hop's end.
  const boot = calls().find((c) => c.cmd === "bootstrap");
  const handed = Number(boot.argv[9]), bootAt = traced(trace2, "bootstrap").at;
  expect(handed).toBeGreaterThan(0);
  expect(bootAt + handed).toBeLessThanOrEqual(h2.until + 0.05); // to the tenth it is printed with
  // Teardown has its own 10 s after the cutoff (CLEANUP_SECONDS), and the helper's bootout stays inside it.
  const teardown = traced(trace2, "bootout");
  expect(teardown.end).toBe(work2 + 10);
  expect(Date.now() - t).toBeLessThan(60000); // scheduling only
  expect(calls().filter((c) => c.cmd === "bootout").map((c) => c.by)).toContain("helper"); // the job, at its own deadline, may too
  expect(leftovers()).toEqual([]);
});

test("RP04: a failed bootout is not dropped: the helper keeps the job's files and says so; the job removes them and itself", async () => {
  const { reply, err } = read(bin(["claude"]), { ...OVER_SSH, FAKE_BOOTOUT_FAIL: "1" });
  const label = calls().find((c) => c.cmd === "bootstrap").label;
  expect(claudeLine(reply).text).toBe("34% · resets 4d 20h");
  expect(err).toMatch(/^pdk-usage: dev\.tremor\.usage\.\d+\.[0-9a-f]{16} not booted out \(exit 5\); its cleaner or the next read's sweep removes it and \S+pdk-usage-/);
  expect(await settled()).toEqual([]);
  expect(calls().filter((c) => c.cmd === "bootout" && c.target.endsWith(label)).map((c) => [c.by, c.failed]).sort()).toEqual([["helper", true], ["job", false]]);
});

// ---- RP04 remaining: something always owns the teardown. The job's cleaner retries its bootout and keeps the folder
// as the record when it cannot; the next desktop read sweeps jobs and folders older than any read can live.

const OLD = () => Math.floor(Date.now() / 1000) - 1000; // well past STALE_SECONDS (300)
const plant = (at, hex) => { // a leftover as an earlier read would leave it: a loaded job and its folder
  mkdirSync(LAUNCHD, { recursive: true });
  writeFileSync(`${LAUNCHD}/dev.tremor.usage.${at}.${hex}`, "999999");
  mkdirSync(`${TMP}/pdk-usage-${at}-${hex.slice(0, 8)}`, { mode: 0o700 });
  writeFileSync(`${TMP}/pdk-usage-${at}-${hex.slice(0, 8)}/claude.py`, "");
  return [`dev.tremor.usage.${at}.${hex}`, `pdk-usage-${at}-${hex.slice(0, 8)}`];
};

test("RP04: helper killed and the job's own bootout failing: the folder stays as the record, the next read's sweep clears it", async () => {
  const env = { HOME, PATH: bin(["claude"]), ...fakeEnv(), ...OVER_SSH, FAKE_DESKTOP_ENV: JSON.stringify({ FAKE_SLEEP: "1", FAKE_BOOTOUT_FAIL: "1" }) };
  const helper = Bun.spawn(helperArgv({ hop: 20 }), { cwd: `${ROOT}/work`, env, stdout: "ignore", stderr: "ignore" });
  let boot;
  for (const end = Date.now() + 30000; !boot && Date.now() < end; await Bun.sleep(20)) boot = calls().find((c) => c.cmd === "bootstrap");
  for (const end = Date.now() + 30000; !existsSync(`${LAUNCHD}/${boot.label}`) && Date.now() < end;) await Bun.sleep(20);
  helper.kill(9);
  await helper.exited;
  // The job's cleaner tries three times, each failing (the flag reached the job), and keeps the folder.
  for (const end = Date.now() + 30000; calls().filter((c) => c.by === "job").length < 3 && Date.now() < end;) await Bun.sleep(50);
  await Bun.sleep(300);
  expect(calls().filter((c) => c.cmd === "bootout" && c.target.endsWith(boot.label))).toEqual(Array(3).fill({ cmd: "bootout", target: `gui/${process.getuid()}/${boot.label}`, by: "job", failed: true }));
  const left = leftovers().sort();
  expect(left).toHaveLength(2); // still loaded, and its folder: nothing is lost track of
  expect(left[0]).toBe(boot.label);
  // Once it is older than any read can live, the next desktop read (on any account state) clears both.
  const old = OLD(), agedLabel = boot.label.replace(/\.(\d+)\./, `.${old}.`);
  writeFileSync(`${LAUNCHD}/${agedLabel}`, readFileSync(`${LAUNCHD}/${boot.label}`)); rmSync(`${LAUNCHD}/${boot.label}`);
  const folder = left[1], aged = folder.replace(/^pdk-usage-\d+-/, `pdk-usage-${old}-`);
  renameSync(`${TMP}/${folder}`, `${TMP}/${aged}`);
  expect(claudeLine(read(bin(["claude"]), OVER_SSH).reply).text).toBe("34% · resets 4d 20h");
  expect(calls().filter((c) => c.cmd === "bootout" && c.by === "helper").map((c) => c.target)).toContain(`gui/${process.getuid()}/${agedLabel}`);
  expect(await settled()).toEqual([]);
});

test("RP04: the sweep leaves a young job and folder alone (another read's), and clears only this user's old ones", async () => {
  const at = OLD(), link = `pdk-usage-${at}-link`;
  const young = plant(Math.floor(Date.now() / 1000) - 5, "a".repeat(16));
  const old = plant(at, "b".repeat(16));
  symlinkSync(`${ROOT}/work`, `${TMP}/${link}`); // never followed or removed
  read(bin(["claude"]), OVER_SSH);
  expect(leftovers().sort()).toEqual([...young, link].sort());
  expect(existsSync(`${ROOT}/work`)).toBe(true);
  for (const f of old) expect(leftovers()).not.toContain(f);
  rmSync(`${LAUNCHD}/${young[0]}`); rmSync(`${TMP}/${young[1]}`, { recursive: true }); rmSync(`${TMP}/${link}`);
});

test("RP08: an old folder another read sweeps away while this one looks at it is skipped; the read still returns its usage", () => {
  const at = OLD(), gone = `${TMP}/pdk-usage-${at}-racing`, other = plant(at, "c".repeat(16));
  mkdirSync(gone, { mode: 0o700 });
  // The other read removes it between this read's listing and its look at the folder.
  const race = ["            st = os.lstat(path)", "            shutil.rmtree(path) if path.endswith('-racing') else None\n            st = os.lstat(path)"];
  const r = Bun.spawnSync(["/usr/bin/python3", "-I", "-S", "-c", HARNESS, HELPER, JSON.stringify([...patches(), race]), SCRATCH],
    { cwd: `${ROOT}/work`, env: { HOME, PATH: bin(["claude"]), ...fakeEnv(), ...OVER_SSH } });
  expect(r.exitCode).toBe(0);
  expect(claudeLine(JSON.parse(r.stdout.toString())).text).toBe("34% · resets 4d 20h");
  expect(existsSync(gone)).toBe(false);
  for (const f of other) expect(leftovers()).not.toContain(f); // the rest of the sweep went on
});

// Owner, 11 Nov: "when tooltip opens, click doesn't work". The gear's tooltip (words and key) is the app's own, on
// the gear itself, with no HoverCard whose card could lie over a control; a press opens Settings, tooltip or not.
test("the gear's tooltip is on the gear itself and a press opens Settings while it shows", () => {
  const { h, v } = foot({ [usageKeys("").data]: { cards: [], sources: [] } });
  h.world.keys = [{ section: "global", keys: "cmd-,", action: "app.settings" }];
  h.elements.length = 0; v.bar(h.env.theme());
  expect(h.elements.some((e) => e.kind === "HoverCard")).toBe(false);
  const gear = h.byId("usage-settings");
  expect(gear.props.tooltip).toBe("Settings ⌘,");
  gear.props.on_click({}, { ...h.cx, stop_propagation: () => {} });
  expect(h.calls.at(-1)?.[0]).toBe("app.settings");
});
