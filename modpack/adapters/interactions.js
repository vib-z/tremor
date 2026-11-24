// What the chat does about a running turn, a permission prompt, a question and hook events (owner request 35;
// reports/chat-interactions.md). Pure: plain data in, plain data out.
//
// Stop presses the agent's stop key with Core's own `hc interrupt`, once, for exactly the terminal, process and
// session the control was drawn for, and only while Core still says it is working on that turn.
//
// Approvals and questions are shown, not answered. Core has no way to press a key only while one exact prompt is
// still open (`hc keys` takes no precondition; `hc send --if` knows idle and working only and always adds Enter), so
// a key sent after any re-read could land on the next prompt, which Claude also answers "1" for Yes. By the owner's
// rule (no Core change; display-only when it can't be race-safe), the cards say what is asked and point to the
// terminal (VIEW_ONLY, with ANSWER_GAP as its tooltip). The gap is recorded in reports/chat-interactions-build.md for audit-1109.md.

import { switchStillFor } from "./models.js";

export const VIEW_ONLY = "View only here. Answer in the terminal to respond.";
// Why, in the line's tooltip (design-final-look F2).
export const ANSWER_GAP = "Herdr can't press a key only while this exact prompt is still open, so a key sent from here could answer a different one.";
export const NO_DETAILS = "This agent reports no structured request (no question or action record), so only its own words show.";

// Whether Stop may press now. `bind`: the switcher's binding plus `turn`, captured when Stop was pressed; `now`:
// the same facts again, and `got`, Core's fresh `hc get` of that terminal. Null when it may, else why not.
export function stopCheck(bind, now, got) {
  if (!switchStillFor(bind, now)) return "the agent or its session changed";
  const status = typeof got?.status === "string" ? got.status : got?.status?.state ?? got?.state ?? null;
  if (status !== "working") return "it isn't working any more";
  if (got?.turn !== bind.turn) return "its turn moved on";
  return null;
}

// What Core said `hc interrupt` did, in words for the chat. Its JSON is reported as is; anything else is unknown.
export function interruptWords(r) {
  if (r?.code !== 0) return `Not stopped: ${String(r?.stderr || r?.stdout || "hc interrupt failed").trim().slice(0, 160)}`;
  let o = null;
  try { o = JSON.parse(r.stdout); } catch { o = null; }
  const what = o?.result ?? o?.effect ?? o?.outcome ?? o?.status ?? null;
  if (!what) return "Stop sent · check the terminal";
  const said = String(typeof what === "string" ? what : JSON.stringify(what)).replace(/_/g, " ").slice(0, 120);
  // "Interrupted" only when Core saw it take effect; otherwise its own words ("still working").
  return /still|no effect|unchanged|timeout/i.test(said) || !/stop|interrupt|idle|done|cancel/i.test(said) ? `Stop sent · Core reports: ${said}` : `Interrupted · Core reports: ${said}`;
}

// Claude's AskUserQuestion input, bounded: up to 4 questions of up to 6 options, each a label and a description.
export function questionsOf(input) {
  const qs = Array.isArray(input?.questions) ? input.questions : [];
  const s = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
  return qs.slice(0, 4).map((q) => ({
    header: s(q?.header, 40), question: s(q?.question, 300), multi: q?.multiSelect === true,
    options: (Array.isArray(q?.options) ? q.options : []).slice(0, 6).map((o) => ({ label: s(o?.label, 80), description: s(o?.description, 200) })),
  })).filter((q) => q.question);
}

// The newest tool call still waiting for its result: what a permission prompt or a question is about.
export function pendingTool(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.type === "tool") return e.status === "pending" ? e : null;
    if (e.type === "user" || e.type === "assistant") return null;
  }
  return null;
}

// A hook event as a quiet row: its event, the hook's name and how it ended. Display only: nothing is run.
const OUTCOME = { hook_success: "ok", hook_non_blocking_error: "error", hook_blocking_error: "blocked", hook_cancelled: "cancelled",
  hook_stopped_continuation: "stopped", hook_additional_context: "added context", hook_error_during_execution: "error" };
export function hookEntry(key, a, at) {
  const event = typeof a?.hookEvent === "string" ? a.hookEvent : typeof a?.hookName === "string" ? a.hookName.split(":")[0] : "Hook";
  const raw = typeof a?.hookName === "string" ? a.hookName : typeof a?.command === "string" ? a.command : "";
  const name = raw === event ? "" : raw.startsWith(`${event}:`) ? raw.slice(event.length + 1) : raw; // "PreToolUse:Bash" reads "Bash"
  return { key, type: "hook", event, name: name.slice(0, 120), outcome: OUTCOME[a?.type] ?? String(a?.type ?? "").replace(/^hook_/, "").replace(/_/g, " "), at };
}

// The chat header's one current-agent menu (parity G6, design-parity S03/S04/S20/S25): what this agent's terminal
// can do here, each with why not when it can't. `f`: {hasPane, parent, working, children} as Core reports them.
// Stop interrupts the turn, never closes; End terminal is apart and names what else ends with it.
export function agentActions(f) {
  const n = f.children ?? 0;
  return [
    { id: "open", label: "Open in terminal", why: f.hasPane ? null : "It has no pane: peek at it or keep it as a tab" },
    { id: "peek", label: "Peek", why: null },
    { id: "keep", label: "Keep as tab", why: f.hasPane ? "It already has a pane" : null },
    { id: "owner", label: "Focus owner", why: f.parent ? null : "No owner: nothing started it" },
    { id: "stop", label: "Stop turn", why: f.working ? null : "It isn't working" },
    { id: "end", label: n ? `End terminal and ${n} it started` : "End terminal", why: null, destructive: true },
  ].map((a) => ({ ...a, enabled: !a.why }));
}

// What End terminal will end, named, for its second, deliberate press.
export const endWords = (name, n) => `End ${name}${n ? ` and the ${n} agent${n === 1 ? "" : "s"} it started` : ""}? Press again to end.`;
