// What the foot shows, from the helper's reply (helper/pdk-usage.py), one reply per machine. Pure: no app calls, so
// the tests import it. Every number on screen is one a local tool printed on that machine.

export const HIGH = 80; // at or above: the bar takes the theme's `blocked` (yellow) token
export const POLL_MS = 5 * 60000; // one read per machine every 5 minutes, as CodeNotch
export const USAGE_KEY = "pdk.usage";
export const READER_KEY = "pdk.usage.reader";
// A machine's own keys: "" is this computer (adapters/status.js machineList `id`).
export const usageKeys = (id = "") => ({ data: `${USAGE_KEY}@${id}`, reader: `${READER_KEY}@${id}` });

// A failed source must not erase its last good values: they stay, marked stale (spec section 4). A source that
// answered is authoritative and its fresh values clear the mark; one not installed leaves nothing behind. The helper
// only sends cards that have limits.
// A kept value is only ever its own account's (review UX06): the failed source's `account` (a hash, never the address)
// must be the kept card's; one that learned nothing (a timeout before the account read) keeps it, a different account
// or a known sign-out ("") clears it.
export function mergeUsage(previous, reply) {
  const failed = new Map((reply.sources ?? []).filter((s) => s.ok === false).map((s) => [s.name, s]));
  const same = (s, c) => s.account == null || s.account === c.account;
  const keep = (previous?.cards ?? []).filter((c) => c.windows?.length && (reply.error || (failed.has(c.source) && same(failed.get(c.source), c))));
  return { ...reply, cards: [...(reply.cards ?? []).map((c) => ({ ...c, stale: false })), ...keep.map((c) => ({ ...c, stale: true }))] };
}

// The machine filter (spec section 2: "all", "" for this computer, or a machine's exact name), as the header writes
// it; a name no longer known is All, as the header reads it (adapters/status.js machineFilter on the tree's branch).
export const FILTER_KEY = "pdk.machine.filter";
export const filtered = (list, value) => (typeof value === "string" && value !== "all" && list.some((m) => m.id === value) ? list.filter((m) => m.id === value) : list);

// One reader per machine, owned by the foot. A shared synchronous claim + generation checks protect against another
// loaded foot reading the same machine at once.
export class UsageReader {
  constructor(get, set, fetch, now = Date.now, id = "") { this.get = get; this.set = set; this.fetch = fetch; this.now = now; this.keys = usageKeys(id); }
  stale() { return this.now() - (this.get(this.keys.data)?.readAt ?? 0) >= POLL_MS; }
  read() {
    if (this.flight) return this.flight;
    const { data, reader } = this.keys;
    const state = this.get(reader);
    if (state?.inFlight && this.now() - state.startedAt < 100000) return Promise.resolve(null);
    const generation = (state?.generation ?? 0) + 1;
    this.set(reader, { generation, startedAt: this.now(), inFlight: true });
    this.flight = (async () => {
      let reply;
      try {
        reply = await this.fetch();
        if (!Array.isArray(reply?.cards)) throw new Error("No usage reply");
      } catch (e) { reply = { readAt: this.now(), cards: [], sources: [], error: String(e?.message ?? e) }; }
      if (this.get(reader)?.generation !== generation) return null;
      const merged = mergeUsage(this.get(data), reply);
      this.set(data, merged);
      return merged;
    })().finally(() => {
      this.flight = null;
      if (this.get(reader)?.generation === generation) this.set(reader, { ...this.get(reader), inFlight: false });
    });
    return this.flight;
  }
}

// The provider's words, as the pack names agent kinds (adapters/agents.js KNOWN): the mark's label, never shown.
const NAMES = { codex: "Codex", "claude-code": "Claude Code", claude: "Claude Code", grok: "Grok Build", kimi: "Kimi Code", antigravity: "Antigravity" };
export const providerName = (p) => NAMES[p] ?? String(p ?? "Unknown");

export const isHigh = (used) => typeof used === "number" && used >= HIGH;

// Time left to a reset: "4d 20h", "18h 35m", "12m"; "<1m" in the last minute; null after it or without one.
export function countdown(resetsAt, now) {
  if (typeof resetsAt !== "number" || resetsAt <= now) return null;
  const m = Math.floor((resetsAt - now) / 60000);
  if (m < 1) return "<1m";
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}

// The foot's lines for one machine (option A, spec section 4): per agent with limits its 7d window, else its 5h one,
// else the first it reported: "49% · resets 1d 11h", a window other than 7d named first. A value kept from before a
// failed read says "stale" instead of a reset it can't vouch for. An installed provider with nothing to show is its
// mark and "-" with no bar; one not installed has no line. Never a made-up 0%.
// Claude Code installed but unread is never a bare "-" (owner, 11 Nov 2026): "Sign in" when its read knew it was
// signed out (account ""), else "Can't read". Codex and Grok keep "-".
const unread = (s) => (s.provider !== "claude-code" ? "-" : s.account === "" ? "Sign in" : "Can't read");
export function footLines(reply, now) {
  const lines = (reply?.cards ?? []).filter((c) => c.windows?.length).map((c) => {
    const w = c.windows.find((x) => x.label === "7d") ?? c.windows.find((x) => x.label === "5h") ?? c.windows[0];
    const reset = c.stale ? null : countdown(w.resetsAt, now);
    const window = w.label === "7d" ? "" : `${w.label} `;
    return { key: `${c.provider}:${c.email ?? c.plan ?? ""}`, provider: c.provider, name: providerName(c.provider),
      fill: Math.max(0, Math.min(100, w.used)) / 100, high: isHigh(w.used), stale: Boolean(c.stale),
      text: `${window}${Math.round(w.used)}%${c.stale ? " · stale" : reset ? ` · resets ${reset}` : ""}`,
      words: `${Math.round(w.used)}% used, ${w.label} window${c.stale ? ", stale" : reset ? `, resets in ${reset}` : ""}` };
  });
  const shown = new Set(lines.map((l) => l.provider));
  for (const s of reply?.sources ?? []) {
    if (s.ok !== false || !s.provider || shown.has(s.provider)) continue;
    shown.add(s.provider);
    const text = unread(s);
    lines.push({ key: `${s.provider}:unavailable`, provider: s.provider, name: providerName(s.provider), fill: null, high: false, stale: false, text, words: text === "-" ? "unavailable" : text });
  }
  return lines.sort((a, b) => a.name.localeCompare(b.name));
}
