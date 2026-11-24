// Final review F5 (reports/review-fable.md): Claude's session-only switch presses keys against Claude Code 2.1.319's
// picker rows. If a later Claude Code orders them otherwise, another model is set while the chat said the asked one
// was. After the next turn the chat now compares the transcript's model with the one asked for and says so when they
// differ (no retry), and the switcher's footer names the version its rows come from.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { switchVerdict, currentChoice, withBaseline, CLAUDE_VERSION } from "../adapters/models.js";
// The pure transcript parser (adapters/meta.js; shared/sessions.js exports it too).
import { metaFromLines } from "../adapters/meta.js";

const PACK = join(import.meta.dir, "..");
const before = { model: "claude-opus-5-5", effort: "medium", contextPct: 4 };
const applied = { address: "t1", pid: 7, model: "claude-haiku-5-5", effort: "low", metaAt: JSON.stringify(before) };

test("F5: after the next turn, a model other than the one asked for is said: 'Switched to X, not Y'", () => {
  expect(switchVerdict(applied, before)).toBeNull(); // the transcript hasn't moved on: nothing to judge yet
  expect(switchVerdict(applied, null)).toBeNull();
  // A picker in another order: the row pressed for Haiku was Sonnet's.
  expect(switchVerdict(applied, { model: "claude-sonnet-5-5", effort: "low", contextPct: 5 })).toBe("Switched to Sonnet, not Haiku");
  // The asked model ran (a dated or [1m] id is the same model): nothing to say.
  expect(switchVerdict(applied, { model: "claude-haiku-5-5", effort: "low", contextPct: 5 })).toBeNull();
  expect(switchVerdict(applied, { model: "claude-haiku-5-5[1m]", effort: "low", contextPct: 5 })).toBeNull();
  // A model the 2.1.319 table doesn't know is named by its id; so is Codex's.
  expect(switchVerdict(applied, { model: "claude-haiku-4-5-20251001", contextPct: 5 })).toBe("Switched to claude-haiku-4-5, not Haiku");
  const luna = { model: "gpt-6-luna", effort: "max", contextPct: 11 };
  expect(switchVerdict({ model: "gpt-6-terra", metaAt: JSON.stringify(luna) }, { ...luna, contextPct: 12 })).toBe("Switched to gpt-6-luna, not gpt-6-terra");
  expect(switchVerdict(null, { model: "claude-sonnet-5-5" })).toBeNull(); // no switch made here
});

test("F5: the chat shows the verdict for the agent's own process, and the switcher's footer names the version", () => {
  const src = readFileSync(join(PACK, "mods/pdk-chat/main.js"), "utf8");
  expect(src).toMatch(/const verdict = switchVerdict\(this\.appliedFor\(term\), this\.metaOf\(term\)\);/);
  expect(src).toMatch(/\.when\(Boolean\(verdict\) && !note, \(el\) => el\.child\(div\(\)\.id\("switch-verdict"\)[^\n]*\.child\(verdict\)\)\)/);
  expect(src).toMatch(/appliedFor\(term\) \{\n\s+const a = this\.agents\.get\(term\?\.address\)\?\.applied;\n\s+return a && a\.address === term\?\.address && a\.pid === \(term\?\.foreground\?\.pid \?\? null\) \? a : null;/);
  // The footer shows where the list comes from (for Claude, "As Claude Code 2.1.319 lists them"), not only in a tooltip.
  expect(src).toMatch(/const source = s\.kind === "claude" \? `As Claude Code \$\{CLAUDE_VERSION\} lists them`/);
  const foot = src.slice(src.indexOf('.id("switch-foot")'), src.indexOf('"switch-apply"'));
  expect(foot).toMatch(/\.child\(fitLabel\("switch-source", source\)/);
  expect(CLAUDE_VERSION).toBe("2.1.319");
});

// review-audit-1109-recheck F5: the next turn can round to the same numbers. Before Apply the transcript says Opus,
// medium, 40,000 input; Haiku/medium is asked for; the next answer is Opus again, medium, 41,000 input. Both read 4%.
const answer = (id, input) => JSON.stringify({ type: "assistant", uuid: `u-${id}`, effort: "medium",
  message: { id, model: "claude-opus-5-5", usage: { input_tokens: input, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } });

test("F5 recheck: a new turn with the same rounded model, effort and context still ends 'set here' and is said", () => {
  const first = [0, answer("msg_01before", 40000)];
  const before = metaFromLines("claude", [first]);
  const after = metaFromLines("claude", [first, [900, answer("msg_02after", 41000)]]);
  expect([before.contextPct, after.contextPct]).toEqual([4, 4]);
  const applied = { address: "t1", pid: 7, model: "claude-haiku-5-5", effort: "medium", metaAt: JSON.stringify(before), turnAt: before.turn };
  // No new turn yet: the switch made here is what runs, and nothing is said.
  expect(currentChoice("claude", { meta: before, applied })).toEqual({ model: "claude-haiku-5-5", effort: "medium", from: "set here" });
  expect(switchVerdict(applied, before)).toBeNull();
  // The next turn ran Opus: the chip says so, and so does the verdict.
  expect(currentChoice("claude", { meta: after, applied })).toEqual({ model: "claude-opus-5-5", effort: "medium", from: "transcript" });
  expect(switchVerdict(applied, after)).toBe("Switched to Opus, not Haiku");
  // Codex: a new turn_context is a new turn, at its own place in the rollout.
  const ctx = JSON.stringify({ type: "turn_context", payload: { model: "gpt-6-luna", effort: "max" } });
  const tc = JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { total_tokens: 110000 }, model_context_window: 1e6 } } });
  const c1 = metaFromLines("codex", [[0, ctx], [100, tc]]), c2 = metaFromLines("codex", [[0, ctx], [100, tc], [200, ctx], [300, tc]]);
  expect(c1.turn).not.toBe(c2.turn);
  expect(switchVerdict({ model: "gpt-6-terra", metaAt: JSON.stringify(c1), turnAt: c1.turn }, c2)).toBe("Switched to gpt-6-luna, not gpt-6-terra");
  // The chat keeps the turn it applied at.
  const src = readFileSync(join(PACK, "mods/pdk-chat/main.js"), "utf8");
  expect(src).toMatch(/if \(s0\) s0\.applied = \{ address: bind\.address, pid: bind\.pid, model: model\.id, effort, metaAt, turnAt \}/);
});

// review-fable-recheck "F5 edge": Apply in the chat's first second, before its first transcript read, keeps no
// baseline (metaAt "null"). The first read then shows the record from before the switch: not a new turn.
test("F5 edge: Apply before the first transcript read: the first record read is not a new turn", () => {
  const old = metaFromLines("claude", [[0, answer("msg_01before", 40000)]]);
  const applied = { address: "t1", pid: 7, model: "claude-haiku-5-5", effort: "medium", metaAt: "null", turnAt: null };
  expect(switchVerdict(applied, old)).toBeNull();
  expect(currentChoice("claude", { meta: old, applied }).from).toBe("set here");
  // That first read becomes the baseline, so the next turn is still judged.
  const based = withBaseline(applied, old);
  expect(based).toMatchObject({ metaAt: JSON.stringify(old), turnAt: "msg_01before" });
  expect(withBaseline(based, null)).toBe(based); // a baseline is set once
  const next = metaFromLines("claude", [[0, answer("msg_01before", 40000)], [900, answer("msg_02after", 41000)]]);
  expect(withBaseline(based, next)).toBe(based);
  expect(switchVerdict(based, next)).toBe("Switched to Opus, not Haiku");
  expect(currentChoice("claude", { meta: next, applied: based }).from).toBe("transcript");
  // The chat gives a switch its baseline from its own reads, for the same terminal and process.
  const src = readFileSync(join(PACK, "mods/pdk-chat/main.js"), "utf8");
  expect(src).toMatch(/if \(s\.applied\) s\.applied = withBaseline\(s\.applied, s\.src\.meta\);/); // kept per agent: its address and process (appliedFor)
});
