// The model, effort and context use a transcript states, from its records. Pure (no `herdr`): the chat feed takes
// them from the lines it has read anyway (adapters/feed.js), the tree from its own read (shared/sessions.js).
// A field is null when the transcript doesn't say it; nothing is guessed.

export const META_SOURCE = { claude: "Claude Code transcript", codex: "Codex rollout" };

// Context windows by model id, from Anthropic's model table (Claude Code's bundled claude-api skill, 2.1.319,
// "Current Models (cached: 2026-10-06)"). A Claude transcript names the model but not its window, so a model
// missing here gets no percentage.
const CLAUDE_WINDOW = {
  "claude-fable-5-1": 1e6, "claude-mythos-5-1": 1e6, "claude-fable-5": 1e6, "claude-opus-5-5": 1e6, "claude-opus-5": 1e6,
  "claude-opus-4-8": 1e6, "claude-opus-4-7": 1e6, "claude-opus-4-6": 1e6, "claude-sonnet-5-5": 1e6, "claude-sonnet-5": 1e6,
  "claude-sonnet-4-6": 1e6, "claude-haiku-5-5": 1e6, "claude-haiku-4-5": 2e5,
};
// "claude-haiku-4-5-20251001" is claude-haiku-4-5; a "[1m]" choice in the id says nothing the table doesn't.
export const claudeWindow = (model) => CLAUDE_WINDOW[String(model ?? "").replace(/\[1m\]$/i, "").replace(/-\d{8}$/, "")] ?? null;

const count = (n) => (Number.isFinite(n) && n >= 0 ? n : null);
const pct = (used, window) => (used != null && window > 0 && used <= window ? Math.round((used / window) * 100) : null);

// The records that can say any of it: Claude's main-thread assistant messages with usage from a real request
// ("<synthetic>" made none); Codex's turn_context (model, effort) and token_count (context).
const claudeUsage = (o) => o?.type === "assistant" && o.isSidechain !== true && o.message?.usage && typeof o.message.model === "string" && !o.message.model.startsWith("<");
const codexModel = (o) => o?.type === "turn_context" && typeof o.payload?.model === "string";
const codexCount = (o) => o?.type === "event_msg" && o.payload?.type === "token_count" && Boolean(o.payload.info);

// The newest model and context use in records ({offset, record}, oldest first).
// Claude: the last main-thread assistant message's usage (input + cache writes + cache reads: what the request
// held). Codex: the last token_count's `last_token_usage.total_tokens`, which Codex's own status line takes as
// the live context (openai/codex@4f9e717 codex-rs/tui/src/token_usage.rs:37-38; `total_token_usage` sums every
// request), against its `model_context_window`; the model from the last turn_context. `turn`: which turn that is (the
// request's message id, or the record's place in the file), so a new turn shows even when its numbers round the same.
export function metaFromRecords(kind, records) {
  let model = null, effort = null, used = null, window = null, turn = null;
  for (let i = records.length - 1; i >= 0; i--) {
    const o = records[i].record;
    if (kind === "claude") {
      if (!claudeUsage(o)) continue;
      const m = o.message;
      const parts = [m.usage.input_tokens, m.usage.cache_creation_input_tokens ?? 0, m.usage.cache_read_input_tokens ?? 0].map(count);
      model = m.model;
      turn = typeof m.id === "string" ? m.id : typeof o.uuid === "string" ? o.uuid : records[i].offset;
      effort = typeof o.effort === "string" ? o.effort : null; // Claude Code records the turn's effort level
      used = parts.includes(null) ? null : parts.reduce((a, b) => a + b, 0);
      window = claudeWindow(model);
      break;
    }
    if (kind === "codex") {
      if (codexCount(o) && used == null && window == null) {
        used = count(o.payload.info.last_token_usage?.total_tokens);
        window = count(o.payload.info.model_context_window);
      }
      if (codexModel(o) && model == null) {
        model = o.payload.model;
        turn = typeof o.payload.turn_id === "string" ? o.payload.turn_id : records[i].offset;
        effort = typeof o.payload.effort === "string" ? o.payload.effort : null;
      }
      if ((used != null || window != null) && model != null) break;
    }
  }
  return { model, effort, contextPct: pct(used, window), turn };
}

// The same from transcript lines ([offset, text] pairs, oldest first); a line that is not JSON is passed over.
export function metaFromLines(kind, lines) {
  const records = [];
  for (const [offset, text] of lines) {
    try { records.push({ offset, record: JSON.parse(text) }); } catch { /* torn or not JSON */ }
  }
  return metaFromRecords(kind, records);
}

// The few records metaFromRecords needs, kept across reads instead of the whole conversation: the newest of each
// kind that counts, in file order. `kept` from earlier reads, `records` just read.
export function metaKeep(kind, kept, records) {
  const all = [...kept, ...records];
  const last = (is) => all.findLast((r) => is(r.record));
  const keep = kind === "claude" ? [last(claudeUsage)] : kind === "codex" ? [last(codexModel), last(codexCount)] : [];
  return keep.filter(Boolean).sort((a, b) => a.offset - b.offset);
}
