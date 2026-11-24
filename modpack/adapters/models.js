// The chat's model switcher (owner request 16): what an agent offers, what it runs now, and how to switch it for
// this session only, never its saved default. Pure: plain data in, plain data out.

// Claude Code 2.1.319. Efforts from `claude --help`: "--effort <level> Effort level for the current session (low,
// medium, high, xhigh, max)". Models as its /model picker lists them, captured in this lane's test session on
// 2026-11-09 (row 1 is "Default (recommended)"); every one takes all five levels
// (https://code.claude.com/docs/en/model-config). `/model <name>` and `/effort <level>` save a new default to the
// user's settings, so the switch goes through the picker's "s to use this session only" instead (verified: "Set model
// to Haiku 5.5 for this session only with low effort", ~/.claude/settings.json untouched).
export const CLAUDE_VERSION = "2.1.319";
export const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
export const CLAUDE_MODELS = [
  { id: "claude-opus-5-5", alias: "opus", label: "Opus", description: "Best for everyday, complex tasks", row: 2 },
  { id: "claude-fable-5-1", alias: "fable", label: "Fable", description: "Most capable for your hardest and longest-running tasks", row: 3 },
  { id: "claude-sonnet-5-5", alias: "sonnet", label: "Sonnet", description: "Efficient for routine tasks", row: 4 },
  { id: "claude-haiku-5-5", alias: "haiku", label: "Haiku", description: "Fastest for quick answers", row: 5 },
].map((m) => ({ ...m, efforts: CLAUDE_EFFORTS }));
// How long the picker takes to open after "/model" before its keys go in (1.5 s worked in the test session), and to
// show its confirmation after "s".
export const PICKER_MS = 1500;
export const CONFIRM_MS = 800;
// Claude Code asks before a new model re-reads a conversation it has cached ("Switch model? Your next response will be
// slower and use more tokens", "1. Yes, switch to Sonnet 5.5" chosen); an effort-only change doesn't ask, and an
// Enter at its empty prompt sends nothing (all seen in the test session). The switcher says so before Apply.
export const CLAUDE_REREAD = "A new model re-reads this whole conversation: its next answer is slower and uses more tokens.";

const bare = (id) => String(id ?? "").replace(/\[1m\]$/i, "").replace(/-\d{8}$/, "");
// A model by id, alias or label in a list; null when the list doesn't have it.
export const findModel = (models, name) => {
  const n = bare(name).toLowerCase();
  return n ? models.find((m) => m.id.toLowerCase() === n || m.alias === n || m.label?.toLowerCase() === n) ?? null : null;
};

// The model and effort an agent was started with, from its argv; null where it didn't say. Other agents: a plain
// -m or --model, for the chip to show read-only.
export function launchChoice(kind, argv = []) {
  let model = null, effort = null;
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]), next = argv[i + 1];
    const val = (opt) => (a === opt ? next ?? null : a.startsWith(`${opt}=`) ? a.slice(opt.length + 1) : undefined);
    if (kind === "claude") {
      model = val("--model") ?? model;
      effort = val("--effort") ?? effort;
    } else if (kind === "codex") {
      model = val("-m") ?? val("--model") ?? model;
      const c = val("-c") ?? val("--config");
      const e = c?.match(/^model_reasoning_effort\s*=\s*"?([a-z]+)"?$/);
      const m = c?.match(/^model\s*=\s*"?([^"\s]+)"?$/);
      if (e) effort = e[1];
      if (m) model = m[1];
    } else {
      model = val("-m") ?? val("--model") ?? model; // shown, never switched
    }
  }
  return { model, effort };
}

// Whether the transcript has a turn newer than the one a switch here was applied at: the turn's identity (sessions.js
// metaFromLines `turn`), not its rounded numbers, which the next turn can repeat (review-audit-1109-recheck F5).
// Without a turn on either side, any change in what the transcript says. No baseline (Apply came before the chat's
// first read, review-fable-recheck "F5 edge"): not yet, until withBaseline gives it one.
const movedOn = (applied, meta) => (applied.metaAt == null || applied.metaAt === "null" ? false
  : meta?.turn != null || applied.turnAt != null ? (meta?.turn ?? null) !== (applied.turnAt ?? null)
  : JSON.stringify(meta ?? null) !== applied.metaAt);

// A switch applied with no baseline takes the first transcript read after it as one: the record it shows was written
// before the agent's next turn could start.
export const withBaseline = (applied, meta) => (applied && (applied.metaAt == null || applied.metaAt === "null") && meta
  ? { ...applied, metaAt: JSON.stringify(meta), turnAt: meta.turn ?? null } : applied);

// What runs now: a switch made here until the transcript moves on, else the transcript (agentMeta), else the
// launch argv. `from` says which; null fields are unknown.
export function currentChoice(kind, { meta = null, argv = [], applied = null } = {}) {
  if (applied && !movedOn(applied, meta)) return { model: applied.model, effort: applied.effort, from: "set here" };
  const launch = launchChoice(kind, argv);
  const model = meta?.model ?? launch.model;
  const effort = meta?.effort ?? launch.effort;
  return { model: model ?? null, effort: effort ?? null, from: meta?.model || meta?.effort ? "transcript" : model || effort ? "launch" : null };
}

// What a switch made here did, once the next turn's transcript names the model that ran (final review F5): Claude's
// switch presses keys against 2.1.319's picker rows, so a picker in another order sets another model. Null until the
// transcript moves on, or when it agrees; else the honest words. Nothing is retried.
export function switchVerdict(applied, meta, models = CLAUDE_MODELS) {
  if (!applied?.model || !meta?.model || !movedOn(applied, meta) || bare(meta.model) === bare(applied.model)) return null;
  const name = (id) => findModel(models, id)?.label ?? bare(id);
  return `Switched to ${name(meta.model)}, not ${name(applied.model)}`;
}

// The chip's words: "haiku-5-5 · low", "gpt-6-luna · max"; "model unknown" when nothing says.
export function chipLabel(choice) {
  const model = choice?.model ? bare(choice.model).replace(/^claude-/, "") : null;
  if (!model) return choice?.effort ? `model unknown · ${choice.effort}` : "model unknown";
  return choice.effort ? `${model} · ${choice.effort}` : model;
}

// The switcher for one agent: its models (Claude's table, Codex's own list), whether it can switch from here, and
// the highlighted model and effort, starting at what runs now.
export function openSwitcher(kind, choice, codexModels = null) {
  const models = kind === "claude" ? CLAUDE_MODELS : kind === "codex" ? codexModels ?? [] : [];
  const why = kind === "claude" || kind === "codex" ? (models.length ? null : "Codex's model list isn't available") : "Switching models from chat isn't supported for this agent";
  const cur = findModel(models, choice?.model);
  const mi = Math.max(0, cur ? models.indexOf(cur) : models.findIndex((m) => m.isDefault));
  const efforts = models[mi]?.efforts ?? [];
  const ei = Math.max(0, efforts.indexOf(choice?.effort ?? models[mi]?.defaultEffort ?? ""));
  return { kind, models, mi, ei, current: cur?.id ?? null, why };
}

// The switcher with model `mi` highlighted: the effort keeps its name when that model takes it, else the model's
// default, else its first level.
export function pickModel(s, mi) {
  const to = Math.min(s.models.length - 1, Math.max(0, mi));
  const name = s.models[s.mi]?.efforts?.[s.ei];
  const next = s.models[to]?.efforts ?? [];
  const ei = next.includes(name) ? next.indexOf(name) : Math.max(0, next.indexOf(s.models[to]?.defaultEffort ?? ""));
  return { ...s, mi: to, ei };
}

// One key in the switcher: ↑↓ model, ←→ effort, Enter apply, Esc cancel.
export function switcherKey(s, key) {
  const efforts = (i) => s.models[i]?.efforts ?? [];
  if (key === "escape") return { s, action: "cancel" };
  if (key === "enter") return { s, action: s.why || !s.models.length ? null : "apply" };
  if (key === "up" || key === "down") return { s: pickModel(s, s.mi + (key === "up" ? -1 : 1)), action: null };
  if (key === "left" || key === "right") {
    const ei = Math.min(efforts(s.mi).length - 1, Math.max(0, s.ei + (key === "left" ? -1 : 1)));
    return { s: { ...s, ei }, action: null };
  }
  return { s, action: null };
}

// Whether a switch may be sent now, from the agent's raw Core status: only at its prompt.
export function switchAllowed(raw) {
  if (raw === "working") return { ok: false, why: "Switch when it has finished its turn" };
  if (raw === "blocked") return { ok: false, why: "It is waiting for you: answer in the terminal first" };
  return { ok: true, why: null };
}

const SAFE = /^[A-Za-z0-9._:-]+$/;
// What to send for a session-only switch, as Core calls: a line to type ({send}), a pause ({wait} ms), keys to
// press ({keys}). Claude: its picker, from its first row, down to the model, effort from the lowest level up, then
// "s" (this session only). Codex 0.167.0: `/model <id> --reasoning=<level>`, which applies inline arguments to
// the session only (openai/codex rust-v0.167.0 codex-rs/tui/src/chatwidget/model_command.rs:1). Null if unsafe.
// `confirm`: Claude's model changes and its conversation has history, so its "Switch model?" question gets its Yes.
export function switchSteps(kind, model, effort, { confirm = false } = {}) {
  if (!model || !SAFE.test(model.id) || (effort && !/^[a-z]+$/.test(effort))) return null;
  if (kind === "claude") {
    const idx = CLAUDE_EFFORTS.indexOf(effort);
    if (!model.row || idx < 0) return null;
    return [{ send: "/model" }, { wait: PICKER_MS },
      { keys: ["home", ...Array(model.row - 1).fill("down"), ...Array(CLAUDE_EFFORTS.length).fill("left"), ...Array(idx).fill("right"), "s"] },
      ...(confirm ? [{ wait: CONFIRM_MS }, { keys: ["enter"] }] : [])];
  }
  if (kind === "codex") {
    if (effort && !model.efforts?.includes(effort)) return null;
    return [{ send: effort ? `/model ${model.id} --reasoning=${effort}` : `/model ${model.id}` }];
  }
  return null;
}

// What a switch is for (audit H2): the terminal, its agent kind, its process (pid and start), its bound session and
// the chat's session generation, all as they were when the switcher opened.
export const switchBinding = ({ address = null, kind = null, pid = null, start = null, session = null, gen = null } = {}) => ({ address, kind, pid, start, session, gen });

// Whether a switch may still go out: the same terminal, agent kind, process and session as when it opened.
export function switchStillFor(bind, now) {
  if (!bind?.address || bind.pid == null || !now) return false;
  return ["address", "kind", "pid", "start", "session", "gen"].every((k) => bind[k] === now[k]);
}

// A switch's steps in order: before every dispatch, so after every wait too, `still()` must give null (else the
// reason it can't go), or nothing more is sent. `dispatch(step)` resolves {sent, reason}. Never retried.
export async function runSwitch(steps, { still, dispatch, sleep }) {
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    if (st.wait) { await sleep(st.wait); continue; }
    const why = still();
    if (why) return { sent: false, reason: why, at: i };
    const out = await dispatch(st);
    if (!out?.sent) return { sent: false, reason: out?.reason ?? "not sent", at: i };
  }
  return { sent: true };
}
