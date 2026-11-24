import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapClaude, mapCodex } from "../adapters/chat.js";
import { stopCheck, interruptWords, questionsOf, pendingTool, hookEntry, VIEW_ONLY, ANSWER_GAP, NO_DETAILS } from "../adapters/interactions.js";
import { switchBinding } from "../adapters/models.js";

// Owner request 35: Stop, approvals, questions and hook events in the chat (inside the pack; no Core change).
const PACK = new URL("..", import.meta.url).pathname;
const chat = readFileSync(join(PACK, "mods/pdk-chat/main.js"), "utf8");
const adds = (out) => out.filter((e) => e.op === "add").map((e) => e.entry);

test("Stop: only the same terminal, process and session, still working on the same turn", () => {
  const bind = { ...switchBinding({ address: "t1", kind: "claude", pid: 11, start: "s", session: "sa", gen: 2 }), turn: 4 };
  const same = switchBinding({ address: "t1", kind: "claude", pid: 11, start: "s", session: "sa", gen: 2 });
  const got = (o = {}) => ({ status: { state: "working" }, turn: 4, ...o });
  expect(stopCheck(bind, same, got())).toBeNull();
  for (const change of [{ pid: 12 }, { session: "sb" }, { gen: 3 }, { start: "t" }, { kind: "codex" }]) expect(stopCheck(bind, { ...same, ...change }, got()), JSON.stringify(change)).toBe("the agent or its session changed");
  expect(stopCheck(bind, same, got({ status: { state: "done" } }))).toBe("it isn't working any more");
  expect(stopCheck(bind, same, got({ status: "blocked" }))).toBe("it isn't working any more");
  expect(stopCheck(bind, same, got({ turn: 5 }))).toBe("its turn moved on");
  expect(stopCheck(bind, same, null)).toBe("it isn't working any more");
  expect(interruptWords({ code: 0, stdout: '{"result":"stopped"}' })).toBe("Interrupted · Core reports: stopped");
  expect(interruptWords({ code: 0, stdout: '{"result":"still_working"}' })).toBe("Stop sent · Core reports: still working"); // the stand-in ignores its stop key
  expect(interruptWords({ code: 0, stdout: "not json" })).toBe("Stop sent · check the terminal");
  expect(interruptWords({ code: 1, stderr: "no such terminal" })).toBe("Not stopped: no such terminal");
  // Once per turn, one interrupt call, no retry; the button is the shared action button.
  const stop = chat.slice(chat.indexOf("  stop(cx) {"), chat.indexOf("  // `pdk-chat.call:<n>`"));
  expect(stop).toMatch(/s\.stopped\?\.address === t\.address && s\.stopped\.turn === t\.turn\) return;/); // kept with its agent
  expect(stop.match(/hc\(\["interrupt", bind\.address, "--json"\]\)/g)?.length).toBe(1);
  expect(stop).not.toMatch(/for \(|while \(|retry/);
  expect(chat).toMatch(/actionButton\(t, "stop", "Stop"/);
});

test("approvals and questions are shown, never answered: no key leaves the card", () => {
  const card = chat.slice(chat.indexOf('    if (raw === "blocked") {'), chat.indexOf('    if (raw === "error") {'));
  expect(card).not.toMatch(/hc\(|"keys"|sendArgs/);
  expect(card).toMatch(/Answer in the terminal/);
  // design-final-look F2: a plain line, a short tooltip and its reason in the accessible name (review UX10); the yellow
  // marker stays on the right.
  expect(card).toMatch(/\.tooltip\("Answer in terminal"\)\.accessibility_label\(`\$\{VIEW_ONLY\} \$\{ANSWER_GAP\}`\)\.child\(VIEW_ONLY\)/);
  expect(card).toMatch(/: div\(\)[^\n]*\.child\(NO_DETAILS\)/);
  expect(card).toMatch(/statusMarker\(t, "needs", "chat-needs"\)/);
  expect(VIEW_ONLY).toBe("View only here. Answer in the terminal to respond.");
  expect(ANSWER_GAP).toMatch(/can't press a key only while this exact prompt is still open/);
  expect(ANSWER_GAP).not.toMatch(/^Answered/);
  expect(NO_DETAILS).toMatch(/no structured request/);
});

test("Claude AskUserQuestion: the card's questions and choices come from the pending call, bounded", () => {
  const out = adds(mapClaude({ type: "assistant", uuid: "a1", timestamp: "2026-11-09T23:10:00Z", message: { role: "assistant", content: [
    { type: "tool_use", id: "q1", name: "AskUserQuestion", input: { questions: [
      { header: "Theme", question: "Which theme first?", multiSelect: false, options: [{ label: "Light", description: "The T3 light preset" }, { label: "Dark", description: "Its dark twin" }] },
      { header: "Scope", question: "What else?", multiSelect: true, options: Array.from({ length: 9 }, (_, i) => ({ label: `O${i}`, description: "" })) }] } }] } }));
  const q = out.find((e) => e.type === "tool");
  expect(q.questions[0]).toEqual({ header: "Theme", question: "Which theme first?", multi: false, options: [{ label: "Light", description: "The T3 light preset" }, { label: "Dark", description: "Its dark twin" }] });
  expect(q.questions[1].options.length).toBe(6);
  expect(q.questions[1].multi).toBe(true);
  expect(pendingTool([{ type: "user" }, q])).toBe(q);
  expect(pendingTool([q, { type: "assistant" }])).toBeNull(); // answered and talked past: nothing pending
  expect(pendingTool([{ ...q, status: "ok" }])).toBeNull();
  expect(questionsOf({ questions: [{ question: "" }] })).toEqual([]);
});

test("hook events: quiet rows from Claude's hook attachments and Stop summary, and Codex's hook prompts; display only", () => {
  const at = "2026-11-09T23:12:00Z";
  const ok = adds(mapClaude({ type: "attachment", uuid: "h1", timestamp: at, attachment: { type: "hook_success", hookName: "PostToolUse:Bash", hookEvent: "PostToolUse", toolUseID: "x", content: "" } }));
  expect(ok).toEqual([{ key: "h1", type: "hook", event: "PostToolUse", name: "Bash", outcome: "ok", at: Date.parse(at) }]);
  expect(hookEntry("k", { type: "hook_success", hookName: "UserPromptSubmit", hookEvent: "UserPromptSubmit" }, 1).name).toBe("");
  const blocked = adds(mapClaude({ type: "attachment", uuid: "h2", timestamp: at, attachment: { type: "hook_blocking_error", hookName: "PreToolUse:Write", hookEvent: "PreToolUse" } }));
  expect(blocked[0].outcome).toBe("blocked");
  const stop = adds(mapClaude({ type: "system", subtype: "stop_hook_summary", uuid: "h3", timestamp: at, hookCount: 2, hookErrors: [], preventedContinuation: false }));
  expect(stop[0]).toMatchObject({ event: "Stop", name: "2 hooks", outcome: "ok" });
  expect(adds(mapClaude({ type: "attachment", uuid: "h4", timestamp: at, attachment: { type: "skill_listing" } }))).toEqual([]); // other attachments stay skipped
  const cx = adds(mapCodex({ type: "event_msg", timestamp: at, payload: { type: "item_completed", item: { type: "HookPrompt", id: "hp1", fragments: [{ text: "Run the linter first\nmore", hookRunId: "r" }] } } }));
  expect(cx[0]).toMatchObject({ type: "hook", event: "Hook prompt", name: "Run the linter first" });
  expect(hookEntry("k", { type: "hook_cancelled" }, 1).outcome).toBe("cancelled");
  const row = chat.slice(chat.indexOf("const hookRow"), chat.indexOf("export default class"));
  expect(row).not.toMatch(/on_click|hc\(|run\(|exec\(/);
});

// Parity G6: one current-agent menu in the chat header; G11's chat part: focus return, selected stays selected, names elide.
test("G6: the agent menu offers what the terminal can do, says why not, keeps End apart and makes it deliberate", async () => {
  const { agentActions, endWords } = await import("../adapters/interactions.js");
  const pick = (f) => Object.fromEntries(agentActions(f).map((a) => [a.id, a.enabled ? true : a.why]));
  expect(pick({ hasPane: true, parent: null, working: false, children: 0 })).toEqual({ open: true, peek: true, keep: "It already has a pane",
    owner: "No owner: nothing started it", stop: "It isn't working", end: true });
  expect(pick({ hasPane: false, parent: "t1", working: true, children: 2 })).toEqual({ open: "It has no pane: peek at it or keep it as a tab", peek: true,
    keep: true, owner: true, stop: true, end: true });
  expect(agentActions({ children: 2 }).find((a) => a.id === "end")).toMatchObject({ label: "End terminal and 2 it started", destructive: true });
  expect(endWords("briefs", 1)).toBe("End briefs and the 1 agent it started? Press again to end.");
  const act = chat.slice(chat.indexOf("  agentAct(id, cx) {"), chat.indexOf("  agentMenuKey(key, cx) {"));
  expect(act).toMatch(/if \(!f \|\| f\.pid !== m\.pid\) \{ this\.agentMenu = \{ \.\.\.m, note: "That agent changed: nothing was done" \}/); // revalidated
  expect(act).toMatch(/if \(id === "end" && !m\.confirm\)/); // a second, deliberate press
  expect(act).toMatch(/run\("terminal\.kill", \{ terminal: m\.address \}\)/);
  expect(act).toMatch(/else if \(id === "stop"\) this\.stop\(cx\);/); // Stop interrupts, never closes
  const view = chat.slice(chat.indexOf("  agentMenuView(t) {"), chat.indexOf("  // Stop (owner request 35)"));
  expect(view).toMatch(/\.filter\(\(a\) => !a\.destructive\)[\s\S]*\.child\(div\(\)\.h\(1\)[\s\S]*\.filter\(\(a\) => a\.destructive\)/);
  expect(view).toMatch(/overlayFrame\(t, "agent-menu"\)/);
  expect(chat).toMatch(/fitLabel\("chat-name", name\)[\s\S]{0,600}statusMarker\(t, word, "chat-head-st"[\s\S]*segmentedChoice\(t, "chat-view", AGENT_VIEWS, "chat"[\s\S]{0,300}textButton\(t, "agent-menu-btn", "⋯"/); // the status by the name, the Chat / Terminal toggle in the middle, the menu at the right end (owner, 11 Nov)
});

test("G11 (chat): focus returns after the menu, the open chip stays selected, the name elides with its tooltip", () => {
  expect(chat.slice(chat.indexOf("  closeAgentMenu(cx) {"), chat.indexOf("  agentAct(id, cx) {"))).toMatch(/this\.input\.focus\(\)/);
  expect(chat).toMatch(/rowStates\(focusRing\(div\(\), t, [\s\S]{0,200}\{ selected: open, disabled: !switchable/);
  expect(chat).toMatch(/fitLabel\("chat-name", name\)/);
});

test("every accessibility role in the pack is one gpui knows (an unknown one fails the whole view)", async () => {
  const { readdirSync, statSync } = await import("node:fs");
  const typings = readFileSync(join(PACK, "mods/pdk-usage/gpui-kit.d.ts"), "utf8");
  const files = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? (n === "lib" ? [] : files(p)) : n.endsWith(".js") ? [p] : []; });
  const bad = [];
  for (const f of [...files(join(PACK, "mods")), ...files(join(PACK, "shared"))]) for (const m of readFileSync(f, "utf8").matchAll(/\.role\("([a-z_]+)"\)/g)) if (!typings.includes(`"${m[1]}"`)) bad.push(`${f.slice(PACK.length)}: ${m[1]}`);
  expect(bad).toEqual([]);
});

// Review UX10 (contract §7): every tooltip the chat writes is three words or fewer; a value shown in full (a name, a
// path) is one placeholder; the detail lives in the accessible name. textButton's label is its tooltip too.
test("the chat's tooltips are three words or fewer, the detail in accessible names", () => {
  const words = (x) => x.replace(/\S*\$\{[^}]*\}\S*/g, "V").trim().split(/\s+/).filter(Boolean).length;
  const lits = (re) => [...chat.matchAll(re)].flatMap((m) => m.slice(1).filter((x) => x != null));
  const str = '"([^"]*)"|`([^`]*)`';
  const tips = [...lits(/\.tooltip\("([^"]*)"\)/g), ...lits(/\.tooltip\(`([^`]*)`\)/g), ...lits(new RegExp(`\\.tooltip\\([^()"\`]*\\? (?:${str}) : (?:${str})\\)`, "g")),
    ...lits(/textButton\(t, [^,]+, "[^"]*", "([^"]*)"/g), ...lits(/textButton\(t, [^,]+, "[^"]*", `([^`]*)`/g)];
  expect(tips.length).toBeGreaterThan(10);
  expect(tips.filter((x) => words(x) > 3)).toEqual([]);
  // The long reasons the tooltips used to carry are still read out.
  for (const s of ["accessibility_label(`${VIEW_ONLY} ${ANSWER_GAP}`)", "accessibility_label(\"The transcript doesn't say how full the context is\")",
    "accessibility_label(`${pct}% of the model's context window used, from its last turn`)", "this name is the message's own claim`)"]) expect(chat).toContain(s);
});
