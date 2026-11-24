// The chat's model switcher (owner request 16): lib/models.js and the helper's `models codex`.
// Claude's table is Claude Code 2.1.319's own /model picker and --help, captured in this lane's test session; the
// Codex list here comes from a fake app-server that speaks the 0.167.0 protocol (initialize, model/list).
import { test, expect, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { CLAUDE_MODELS, CLAUDE_EFFORTS, launchChoice, currentChoice, chipLabel, openSwitcher, switcherKey, pickModel, switchAllowed, switchSteps, findModel, switchBinding, switchStillFor, runSwitch } from "../adapters/models.js";
import { join } from "node:path";
const PACK = new URL("..", import.meta.url).pathname;

const ROOT = `/tmp/pdk-mo${process.pid}`;
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));
const HELPER = new URL("../helper/pdk-helper.py", import.meta.url).pathname;

test("Claude Code 2.1.319: its four picker models, five efforts, picker rows as it lists them", () => {
  expect(CLAUDE_MODELS.map((m) => [m.label, m.row])).toEqual([["Opus", 2], ["Fable", 3], ["Sonnet", 4], ["Haiku", 5]]);
  expect(CLAUDE_EFFORTS).toEqual(["low", "medium", "high", "xhigh", "max"]);
  expect(findModel(CLAUDE_MODELS, "haiku")?.id).toBe("claude-haiku-5-5");
  expect(findModel(CLAUDE_MODELS, "claude-sonnet-5-5-20261001")?.label).toBe("Sonnet");
  expect(findModel(CLAUDE_MODELS, "claude-opus-4-5")).toBeNull();
});

test("what runs now: a switch made here, else the transcript, else the launch command; unknown says so", () => {
  expect(launchChoice("claude", ["claude", "--model", "claude-haiku-5-5", "--effort=high"])).toEqual({ model: "claude-haiku-5-5", effort: "high" });
  expect(launchChoice("codex", ["codex", "-c", "features.hooks=false", "-m", "gpt-6-luna", "-c", 'model_reasoning_effort="low"'])).toEqual({ model: "gpt-6-luna", effort: "low" });
  expect(launchChoice("hermes", ["python3", "-c", "x", "chat", "-m", "claude-haiku-5-5"])).toEqual({ model: "claude-haiku-5-5", effort: null });
  const argv = ["claude", "--model", "haiku"];
  expect(currentChoice("claude", { argv })).toEqual({ model: "haiku", effort: null, from: "launch" });
  const meta = { model: "claude-sonnet-5-5", effort: "medium", contextPct: 4 };
  expect(currentChoice("claude", { meta, argv })).toEqual({ model: "claude-sonnet-5-5", effort: "medium", from: "transcript" });
  const applied = { model: "claude-fable-5-1", effort: "xhigh", metaAt: JSON.stringify(meta) };
  expect(currentChoice("claude", { meta, argv, applied }).from).toBe("set here");
  expect(currentChoice("claude", { meta: { ...meta, contextPct: 9 }, argv, applied }).from).toBe("transcript"); // a newer turn
  expect(currentChoice("claude", {})).toEqual({ model: null, effort: null, from: null });
  expect(chipLabel({ model: "claude-haiku-5-5", effort: "low" })).toBe("haiku-5-5 · low");
  expect(chipLabel({ model: "gpt-6-luna", effort: null })).toBe("gpt-6-luna");
  expect(chipLabel({ model: null, effort: null })).toBe("model unknown");
});

test("the switcher's keys: ↑↓ model, ←→ effort within what the model takes, Enter apply, Esc cancel", () => {
  const codex = [
    { id: "gpt-6.1-sol", label: "GPT-6.1-Sol", efforts: ["low", "medium", "high", "xhigh", "max", "ultra"], defaultEffort: "low", isDefault: true },
    { id: "gpt-6-luna", label: "GPT-6-Luna", efforts: ["low", "medium", "high", "xhigh", "max"], defaultEffort: "medium", isDefault: false },
  ];
  let s = openSwitcher("codex", { model: "gpt-6.1-sol", effort: "ultra" }, codex);
  expect([s.mi, s.ei, s.current]).toEqual([0, 5, "gpt-6.1-sol"]);
  s = switcherKey(s, "down").s; // Luna has no ultra: its default instead
  expect([s.mi, s.models[s.mi].efforts[s.ei]]).toEqual([1, "medium"]);
  s = switcherKey(switcherKey(s, "right").s, "right").s;
  expect(s.models[s.mi].efforts[s.ei]).toBe("xhigh");
  expect(switcherKey(s, "down").s.mi).toBe(1); // the list stops at its ends
  expect(switcherKey(pickModel(s, 0), "left").s.ei).toBe(2);
  expect(switcherKey(s, "enter").action).toBe("apply");
  expect(switcherKey(s, "escape").action).toBe("cancel");
  // Unknown current model: the agent's default is highlighted, nothing is marked current.
  const u = openSwitcher("codex", { model: null, effort: null }, codex);
  expect([u.mi, u.current, u.models[u.mi].efforts[u.ei]]).toEqual([0, null, "low"]);
  // No list, or an agent that can't switch from here: nothing to apply, and why.
  expect(switcherKey(openSwitcher("codex", {}, null), "enter").action).toBeNull();
  expect(openSwitcher("hermes", {}).why).toMatch(/isn't supported/);
});

test("switch steps are the agents' own session-only paths, sent only at the prompt", () => {
  const sonnet = findModel(CLAUDE_MODELS, "sonnet");
  // Claude: the picker from its first row (it wraps), down to Sonnet (row 4), effort from Low up to High, then "s".
  expect(switchSteps("claude", sonnet, "high")).toEqual([{ send: "/model" }, { wait: 1500 },
    { keys: ["home", "down", "down", "down", "left", "left", "left", "left", "left", "right", "right", "s"] }]);
  expect(switchSteps("claude", sonnet, "ultra")).toBeNull();
  // A new model on a conversation with history: Claude asks first, and its Yes is chosen.
  expect(switchSteps("claude", sonnet, "high", { confirm: true }).slice(3)).toEqual([{ wait: 800 }, { keys: ["enter"] }]);
  const luna = { id: "gpt-6-luna", efforts: ["low", "medium", "high", "xhigh", "max"] };
  expect(switchSteps("codex", luna, "low")).toEqual([{ send: "/model gpt-6-luna --reasoning=low" }]);
  expect(switchSteps("codex", luna, "ultra")).toBeNull();
  expect(switchSteps("codex", { id: "gpt 6; rm", efforts: ["low"] }, "low")).toBeNull();
  expect(switchSteps("hermes", luna, "low")).toBeNull();
  expect(switchAllowed("idle").ok).toBe(true);
  expect(switchAllowed("done").ok).toBe(true);
  expect(switchAllowed("working")).toEqual({ ok: false, why: "Switch when it has finished its turn" });
  expect(switchAllowed("blocked").ok).toBe(false);
});

test("helper `models codex`: Codex's own app-server list, isolation flags on, hidden models left out", () => {
  const bin = `${ROOT}/bin`, home = `${ROOT}/home`;
  mkdirSync(bin, { recursive: true });
  mkdirSync(`${home}/.codex`, { recursive: true });
  writeFileSync(`${home}/.codex/config.toml`, 'model = "x"\n[mcp_servers.alpha]\ncommand = "a"\n[mcp_servers.beta-2]\n');
  // A fake app-server: records its argv, answers initialize and two pages of model/list.
  writeFileSync(`${bin}/codex`, `#!/usr/bin/python3 -I -S
import json, sys
open(${JSON.stringify(`${ROOT}/argv.json`)}, "w").write(json.dumps(sys.argv[1:]))
pages = {None: ([{"id": "gpt-6.1-sol", "displayName": "GPT-6.1-Sol", "description": "Latest workhorse.", "isDefault": True, "hidden": False,
  "defaultReasoningEffort": "low", "supportedReasoningEfforts": [{"reasoningEffort": "low", "description": "x"}, {"reasoningEffort": "ultra", "description": "y"}]},
  {"id": "secret", "hidden": True}], "p2"), "p2": ([{"id": "gpt-6-luna", "displayName": "GPT-6-Luna", "description": "Fast.", "supportedReasoningEfforts": [{"reasoningEffort": "max"}]}], None)}
for line in sys.stdin:
    m = json.loads(line)
    if m.get("method") == "initialize": print(json.dumps({"id": m["id"], "result": {"userAgent": "fake"}}), flush=True)
    elif m.get("method") == "model/list":
        data, nxt = pages[(m.get("params") or {}).get("cursor")]
        print(json.dumps({"id": m["id"], "result": {"data": data, "nextCursor": nxt}}), flush=True)
`);
  chmodSync(`${bin}/codex`, 0o755);
  const run = (path) => JSON.parse(Bun.spawnSync(["/usr/bin/python3", "-I", "-S", HELPER, "models", "codex"], { env: { HOME: home, PATH: path } }).stdout.toString());
  const r = run(`${bin}:/usr/bin:/bin`);
  expect(r.models.map((m) => [m.id, m.label, m.efforts, m.isDefault])).toEqual([["gpt-6.1-sol", "GPT-6.1-Sol", ["low", "ultra"], true], ["gpt-6-luna", "GPT-6-Luna", ["max"], false]]);
  const argv = JSON.parse(readFileSync(`${ROOT}/argv.json`, "utf8"));
  expect(argv.slice(0, 9)).toEqual(["app-server", "-c", "features.hooks=false", "-c", "notify=[]", "--disable", "plugins", "--disable", "apps"]);
  expect(argv.slice(9)).toEqual(["-c", "mcp_servers.alpha.enabled=false", "-c", "mcp_servers.beta-2.enabled=false"]);
  expect(run("/usr/bin:/bin")).toEqual({ error: "codex is not on this app's PATH" });
  expect(Bun.spawnSync(["/usr/bin/python3", "-I", "-S", HELPER, "models", "claude"]).exitCode).not.toBe(0);
}, 30000);

// Audit H2: a switch goes only to the agent and session its switcher opened for, checked before every dispatch.
test("H2: Apply is bound to its terminal, kind, process and session; a change stops it before the next step", async () => {
  const claude = switchBinding({ address: "t1", kind: "claude", pid: 11, start: "Mon 10:00", session: "sa", gen: 3 });
  // The audit's repro: a Claude switcher, then an idle Codex t2 is what the chat shows when Apply runs.
  expect(switchStillFor(claude, switchBinding({ address: "t2", kind: "codex", pid: 22, start: "Mon 10:01", session: "sb", gen: 4 }))).toBe(false);
  for (const change of [{ pid: 12 }, { start: "Mon 10:05" }, { session: "sa2" }, { gen: 4 }, { kind: "codex" }]) expect(switchStillFor(claude, { ...claude, ...change }), JSON.stringify(change)).toBe(false);
  expect(switchStillFor(claude, { ...claude })).toBe(true);
  expect(switchStillFor(switchBinding({ address: "t1", kind: "claude" }), switchBinding({ address: "t1", kind: "claude" }))).toBe(false); // no process: never
  // The steps stop at the first check that fails, including right after a wait.
  const steps = switchSteps("claude", findModel(CLAUDE_MODELS, "sonnet"), "low", { confirm: true });
  let now = { ...claude };
  const sent = [];
  const out = await runSwitch(steps, {
    still: () => (switchStillFor(claude, now) ? null : "the agent or its session changed"),
    dispatch: async (st) => { sent.push(st); return { sent: true }; },
    sleep: async () => { now = { ...claude, gen: 4 }; }, // the chat moved to another agent during the picker's wait
  });
  expect(out).toEqual({ sent: false, reason: "the agent or its session changed", at: 2 });
  expect(sent).toEqual([{ send: "/model" }]); // "/model" only: no picker keys reach anything
  // Unchanged: every step goes, in order; a failed dispatch stops the rest.
  const all = [];
  expect(await runSwitch(steps, { still: () => null, dispatch: async (st) => { all.push(st); return { sent: true }; }, sleep: async () => {} })).toEqual({ sent: true });
  expect(all.length).toBe(steps.filter((s) => !s.wait).length);
  expect(await runSwitch(steps, { still: () => null, dispatch: async () => ({ sent: false, reason: "busy" }), sleep: async () => {} })).toEqual({ sent: false, reason: "busy", at: 0 });
  // The chat binds the switcher when it opens, closes it on a new target or session, and runs through runSwitch.
  const src = readFileSync(join(PACK, "mods/pdk-chat/main.js"), "utf8");
  expect(src).toMatch(/bind: this\.switchFacts\(term\.address\)/);
  expect(src).toMatch(/leaveSession\(\) \{\n[\s\S]{0,200}?\n\s+if \(this\.switcher\) \{ this\.switcher = null;/);
  expect(src).toMatch(/if \(live !== this\.target\) \{\n\s+this\.target = live;\n\s+this\.leaveSession\(\);/); // a new target
  expect(src).toMatch(/if \(s\.address === this\.target\) this\.leaveSession\(\);/); // a new conversation
  expect(src).toMatch(/await runSwitch\(steps, \{ still, dispatch/);
});
