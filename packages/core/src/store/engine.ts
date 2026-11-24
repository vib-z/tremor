// The normalized store: normalize turns one recorded CoreInput into events, reduce applies one event.
// Pure and browser-safe: no Node imports, no clock, no randomness. Rules: docs/spec.md sections 3 and 4.
//
// Idempotence is structural, so a log replayed onto its own result changes nothing:
// - a source accepts `connecting` once per connection id, `hello` and `subscribed` once per connection,
//   events only above `lastSeq`, and nothing from a retired connection;
// - activity is deduped by its occurrence key (`seen`), user inputs by action id, file lines by cursor;
// - a fresh terminal.get only ever moves `status_ms` forward, and only for the status it describes.

import {
  CORE_GENERATION,
  decodeTerminal,
  dialogOf,
  dialogOptions,
  fingerprintOf,
  gapText,
  keys,
  sameStatus,
  termKey,
  type ActivityEvent,
  type ApprovalState,
  type ConnId,
  type ConnectionState,
  type CoreInput,
  type CoreStatus,
  type CoreTerminal,
  type GapPart,
  type ObservationKind,
  type OutcomeState,
  type TremorEvent,
  type Party,
  type Provenance,
  type SourceId,
  type SourceState,
  type StoreEngine,
  type StoreState,
  type TerminalKey,
  type TerminalState,
  type UserAction,
} from "@tremor/protocol";

type Input<K extends CoreInput["kind"]> = Extract<CoreInput, { kind: K }>;
type SourceInput = Input<"connecting" | "hello" | "subscribed" | "notification" | "doc" | "terminal" | "closed" | "offline">;
type Ev = TremorEvent;
/** What every event needs besides its type and payload. */
type Env = Pick<ActivityEvent, "key" | "at" | "receivedAt" | "terminal" | "provenance" | "trust">;

const RETIRED_MAX = 32;

export function initial(): StoreState {
  return { sources: {}, terminals: {}, activity: [], seen: {}, approvals: {}, actions: {}, cursors: {}, docs: {}, historyGapAt: null };
}

// ---------------------------------------------------------------- normalize

export function normalize(state: StoreState, input: CoreInput): TremorEvent[] {
  switch (input.kind) {
    case "user":
      return input.phase === "dispatched" ? dispatched(state, input) : settled(state, input);
    case "transcript":
      return transcript(state, input);
    case "fleet":
      return fleet(state, input);
    case "history-gap":
      // Persistence found no recoverable base: history before this point is incomplete.
      return [{ ...env(keys.historyGap(input.t), input.t, input.t, null, { kind: "local", what: "persistence" }, "core"), type: "history.gap", reason: input.reason }];
    default:
      return fromSource(state, input);
  }
}

function fromSource(state: StoreState, input: SourceInput): Ev[] {
  const s = state.sources[input.source];
  const t = input.t;
  if (input.kind === "connecting") {
    if (s && (s.conn === input.conn || s.retired.includes(input.conn))) return [];
    return [...(s ? voidOpen(state, byCore(s.coreId), "the connection was replaced", t, asOf(s, input)) : []), connection(input, { state: "connecting", attempt: input.attempt })];
  }
  if (input.kind === "offline") {
    if (s && s.conn !== input.conn) return [];
    return [...(s ? voidOpen(state, byCore(s.coreId), "disconnected", t, asOf(s, input)) : []), connection(input, { state: "offline", reason: input.reason })];
  }
  if (!s || s.conn !== input.conn || s.retired.includes(input.conn)) return [];
  switch (input.kind) {
    case "hello":
      return hello(state, s, input);
    case "subscribed": {
      if (s.hello === null || s.lastSeq !== null || s.coreId === null) return [];
      const r = input.result;
      return [connection(input, { state: "live", since: t }), seqEvent(input, r.seq), ...reconcile(state, s, input, r.seq, r.terminals, gapText.whileDisconnected)];
    }
    case "closed":
      return [...voidOpen(state, byCore(s.coreId), "disconnected", t, asOf(s, input)), connection(input, { state: "reconnecting", attempt: input.attempt, retryInMs: input.retryInMs, reason: input.reason })];
    case "doc": {
      if (s.lastSeq === null || s.coreId === null) return [];
      const had = state.docs[input.source]?.[input.name];
      if (had && had.version > input.version) return [];
      const ev: Ev = { ...env(`doc:${input.source}:${input.name}`, t, t, null, { kind: "get", source: input.source, coreId: s.coreId, conn: input.conn }, "untrusted"), type: "doc", source: input.source, name: input.name, version: input.version, value: input.value };
      return [ev];
    }
    case "terminal":
      return freshGet(state, s, input);
    case "notification":
      return notification(state, s, input);
  }
}

function hello(state: StoreState, s: SourceState, input: Input<"hello">): Ev[] {
  if (s.hello !== null || s.lastSeq !== null) return [];
  const r = input.result;
  if (r.generation !== CORE_GENERATION) return []; // the source refuses it and goes offline
  const out: Ev[] = [];
  const old = s.coreId;
  if (old !== null && old !== r.core.id) {
    // A different core answered: the old core's terminals are history now. hello has no seq, so 0.
    const prov: Provenance = { kind: "core", source: s.id, coreId: r.core.id, conn: input.conn, seq: 0 };
    out.push(...voidOpen(state, byCore(old), "a different core answered", input.t, prov));
    for (const term of sorted(state.terminals))
      if (term.coreId === old && !term.gone) {
        out.push({ ...env(`gone:${term.key}`, input.t, input.t, term.key, prov, "core"), type: "terminal.gone", reason: `core ${r.core.id} answered instead of ${old}` });
        if (term.state === "live")
          out.push(observation(keys.gap(old, input.conn, 0, term.address, "gone" satisfies GapPart), input.t, input.t, term.key, prov, "core", "gap", term.key, null, gapText.gone(r.core.id)));
      }
  }
  out.push({ ...env(`hello:${input.conn}`, input.t, input.t, null, { kind: "core", source: s.id, coreId: r.core.id, conn: input.conn, seq: 0 }, "core"), type: "core.hello", source: s.id, conn: input.conn, hello: r });
  return out;
}

/** Snapshot (subscribe reply or `missed`) against stored state: matching facts add nothing, differences are gaps. */
function reconcile(state: StoreState, s: SourceState, input: SourceInput, seq: number, records: CoreTerminal[], why: string): Ev[] {
  const coreId = s.coreId as string;
  const t = input.t;
  const prov: Provenance = { kind: "snapshot", source: s.id, coreId, conn: input.conn, seq };
  const known = sorted(state.terminals).filter((x) => x.coreId === coreId && !x.gone);
  const out: Ev[] = [];
  const present = new Set<string>();
  for (const r of records) {
    const k = termKey(coreId, r.address);
    present.add(k);
    const before = state.terminals[k];
    out.push({ ...env(`upsert:${k}`, t, t, k, prov, "core"), type: "terminal.upsert", record: r });
    const diff = before ? differences(before, r) : known.length > 0 ? { part: "appeared" as const, texts: [gapText.appeared] } : null;
    if (diff) out.push(observation(keys.gap(coreId, input.conn, seq, r.address, diff.part), t, t, k, prov, "core", "gap", k, null, gapText.join(why, diff.texts)));
  }
  for (const x of known)
    if (!present.has(x.key)) {
      out.push(observation(keys.gap(coreId, input.conn, seq, x.address, "removed" satisfies GapPart), t, t, x.key, prov, "core", "gap", x.key, null, gapText.join(why, [gapText.removed])));
      out.push({ ...env(`removed:${x.key}`, t, t, x.key, prov, "core"), type: "terminal.removed" });
    }
  return out;
}

/** One gap per terminal: its part names the first difference, its text all of them. */
function differences(before: TerminalState, r: CoreTerminal): { part: GapPart; texts: string[] } | null {
  const parts: [GapPart, string][] = [];
  if (before.state !== r.state) parts.push(["state", gapText.state(r)]);
  if (!sameStatus(before.status, r.status ?? null)) parts.push(["status", gapText.status(r)]);
  else if (before.turn !== r.turn) parts.push(["turn", gapText.turn(r)]);
  const first = parts[0];
  return first ? { part: first[0], texts: parts.map((p) => p[1]) } : null;
}

function freshGet(state: StoreState, s: SourceState, input: Input<"terminal">): Ev[] {
  if (s.lastSeq === null || s.coreId === null) return [];
  const r = input.result;
  const k = termKey(s.coreId, r.address);
  const stored = state.terminals[k];
  // Only a record of the status we hold can date it; a stale or early get changes nothing.
  if (!stored || stored.gone || r.status_ms === null || !sameStatus(stored.status, r.status ?? null)) return [];
  if (stored.status_ms !== null && r.status_ms < stored.status_ms) return [];
  const prov: Provenance = { kind: "get", source: s.id, coreId: s.coreId, conn: input.conn };
  const out: Ev[] = [];
  if (stored.status_ms !== r.status_ms) out.push({ ...env(`patch:${k}`, input.t, input.t, k, prov, "core"), type: "terminal.patch", patch: { status_ms: r.status_ms } });
  const fp = fingerprintOf(s.coreId, r);
  const kind = r.status?.kind;
  if (fp && kind) {
    // Core keeps status_ms while the word stays `blocked`, so a new blocked status can share it: the same
    // status under it is the same occurrence (nothing new); a different one is the next occurrence, n.
    const under = Object.values(state.approvals).filter((a) => a.request.terminal === k && a.request.fingerprint.statusMs === fp.statusMs);
    const id = keys.approval(k, fp.statusMs, under.length);
    if (!under.some((a) => sameStatus(a.request.fingerprint.status, fp.status)) && !state.seen[id]) {
      const dialog = dialogOf(r);
      out.push({
        ...env(id, fp.statusMs, input.t, k, prov, "untrusted"),
        type: "approval.request",
        request: { id, terminal: k, kind, msg: r.status?.msg ?? "", dialog, options: dialogOptions(dialog, kind), fingerprint: fp },
      });
    }
  }
  return out;
}

function notification(state: StoreState, s: SourceState, input: Input<"notification">): Ev[] {
  if (s.lastSeq === null || s.coreId === null) return [];
  const coreId = s.coreId;
  const m = input.msg;
  const t = input.t;
  if (m.method === "heartbeat") return m.params.seq > s.lastSeq ? [seqEvent(input, m.params.seq)] : [];
  if (m.params.seq <= s.lastSeq) return [];
  if (m.method === "missed")
    return [seqEvent(input, m.params.seq), ...reconcile(state, s, input, m.params.seq, m.params.terminals, gapText.whileMissed), ...voidOpen(state, byCore(coreId), "events were missed", t, { kind: "snapshot", source: s.id, coreId, conn: input.conn, seq: m.params.seq })];
  const p = m.params;
  const out: Ev[] = [seqEvent(input, p.seq)];
  if (p.type === "doc" || p.terminal === undefined) return out;
  const k = termKey(coreId, p.terminal);
  const term = state.terminals[k];
  const prov: Provenance = { kind: "core", source: s.id, coreId, conn: input.conn, seq: p.seq };
  const key = keys.core(coreId, input.conn, p.seq);
  const d = (p.data ?? {}) as Record<string, unknown>;
  const e = (trust: ActivityEvent["trust"], at = t) => env(key, at, t, k, prov, trust);
  const lifecycle = (phase: "created" | "lost" | "restarted" | "finished" | "removed", at: number, r: { reason?: unknown; exit_code?: unknown; signal?: unknown }): Ev => ({
    ...e("core", at),
    type: "lifecycle",
    phase,
    reason: (r.reason as string | null | undefined) ?? null,
    exitCode: (r.exit_code as number | null | undefined) ?? null,
    signal: (r.signal as number | null | undefined) ?? null,
  });
  const patch = (patch: Partial<CoreTerminal>): Ev => ({ ...e("core"), key: `patch:${k}`, type: "terminal.patch", patch });
  const voids = (why: string) => voidOpen(state, byTerminal(k), why, t, prov);

  if (p.type === "created" || p.type === "restarted") {
    const r = p.data as CoreTerminal;
    out.push({ ...e("core"), key: `upsert:${k}`, type: "terminal.upsert", record: r });
    if (p.type === "restarted") out.push(lifecycle("restarted", t, r), ...voids("the program restarted"));
    else out.push(lifecycle("created", r.created_ms ?? t, r));
    return out;
  }
  if (p.type === "labels" && d.record && typeof d.record === "object") {
    out.push({ ...e("core"), key: `upsert:${k}`, type: "terminal.upsert", record: d.record as CoreTerminal });
    return out;
  }
  if (!term || term.gone) return out;
  switch (p.type) {
    case "status": {
      const root = (d.status ?? null) as CoreStatus | null;
      const records = (d.records ?? {}) as Record<string, CoreStatus>;
      out.push(patch({ status: root, records, reported: (d.reported as boolean | undefined) ?? true }));
      if (root !== null && !sameStatus(term.status, root)) out.push({ ...e("untrusted"), type: "status", status: root, turn: term.turn, record: null });
      for (const id of [...new Set([...Object.keys(term.records), ...Object.keys(records)])].sort()) {
        const was = term.records[id] ?? null;
        const now = records[id] ?? null;
        if (now === null) out.push({ ...e("untrusted"), key: keys.core(coreId, input.conn, p.seq, keys.record(id)), type: "status", status: null, turn: term.turn, record: id, gone: true });
        else if (!sameStatus(was, now)) out.push({ ...e("untrusted"), key: keys.core(coreId, input.conn, p.seq, keys.record(id)), type: "status", status: now, turn: term.turn, record: id });
      }
      out.push(...voidOpen(state, (a) => a.request.terminal === k && !sameStatus(a.request.fingerprint.status, root), "a later status", t, prov));
      return out;
    }
    case "turn":
      out.push(patch({ turn: d.turn as number }), { ...e("core"), type: "turn", turn: d.turn as number, state: (d.state as string | null | undefined) ?? null });
      return out;
    case "lost":
      out.push(patch({ reason: (d.reason as string | null) ?? null, exit_code: (d.exit_code as number | null) ?? null, signal: (d.signal as number | null) ?? null, finished_ms: null, pid: null, foreground: null }), lifecycle("lost", t, d), ...voids("the program was lost"));
      return out;
    case "finished": {
      const finishedMs = (d.finished_ms as number | null | undefined) ?? null;
      out.push(
        patch({ state: "finished", reason: (d.reason as string | null) ?? null, exit_code: (d.exit_code as number | null) ?? null, signal: (d.signal as number | null) ?? null, finished_ms: finishedMs, foreground: null }),
        lifecycle("finished", finishedMs ?? t, d),
        ...voids("the program finished"),
      );
      return out;
    }
    case "removed":
      out.push(lifecycle("removed", t, {}), ...voids("the terminal was removed"), { ...e("core"), key: `removed:${k}`, type: "terminal.removed" });
      return out;
    case "title":
      out.push(patch({ title: (d.title as string | undefined) ?? "" }));
      return out;
    case "labels":
      out.push(patch({ labels: (d.labels as Record<string, string> | undefined) ?? {} }));
      return out;
    case "keep":
      out.push(patch({ keep: d.keep === true }));
      return out;
    case "size":
      out.push(patch({ cols: d.cols as number, rows: d.rows as number }));
      return out;
    case "foreground":
      out.push(patch({ foreground: p.data === null ? null : (p.data as CoreTerminal["foreground"]) ?? null }));
      return out;
  }
  return out;
}

// ---------------------------------------------------------------- user, transcript, fleet

function dispatched(state: StoreState, input: Extract<CoreInput, { kind: "user"; phase: "dispatched" }>): Ev[] {
  const a = input.action;
  const key = keys.user(input.clientId, a.actionId);
  if (state.actions[a.actionId] || state.seen[key]) return [];
  const prov: Provenance = { kind: "user", clientId: input.clientId, actionId: a.actionId };
  if (a.type === "send")
    return [{ ...env(key, input.t, input.t, a.terminal, prov, "user"), type: "message", from: { kind: "person", clientId: input.clientId }, to: { kind: "terminal", terminal: a.terminal }, text: a.text, via: "composer", expectedStatus: a.expectedStatus }];
  return [{ ...env(key, input.t, input.t, actionTerminal(state, a), prov, "user"), type: "action", action: a, phase: "dispatched" }];
}

function settled(state: StoreState, input: Extract<CoreInput, { kind: "user"; phase: "settled" }>): Ev[] {
  const entry = state.actions[input.actionId];
  if (!entry || entry.outcome !== null) return [];
  const prov: Provenance = { kind: "user", clientId: input.clientId, actionId: input.actionId };
  const terminal = actionTerminal(state, entry.action);
  const out: Ev[] = [{ ...env(keys.settled(input.clientId, input.actionId), input.t, input.t, terminal, prov, "user"), type: "action.settled", actionId: input.actionId, outcome: input.outcome }];
  for (const a of sorted(state.approvals))
    if (a.actionId === input.actionId && a.state === "in-flight")
      out.push({
        ...env(keys.approvalResolved(a.request.id, input.actionId), input.t, input.t, a.request.terminal, prov, "user"),
        type: "approval.resolved",
        approvalId: a.request.id,
        outcome: APPROVAL_OUTCOME[input.outcome.state],
        actionId: input.actionId,
        detail: input.outcome.detail,
      });
  return out;
}

/** What an approval becomes when the action that took it in flight settles. */
const APPROVAL_OUTCOME: Record<OutcomeState, Exclude<ApprovalState, "open" | "in-flight">> = { done: "sent", refused: "refused", voided: "voided", cancelled: "refused", unknown: "unknown" };

const actionTerminal = (state: StoreState, a: UserAction): TerminalKey | null => (a.type === "approve" ? (state.approvals[a.approvalId]?.request.terminal ?? null) : a.terminal);

function transcript(state: StoreState, input: Input<"transcript">): Ev[] {
  const adapter = `transcript:${input.terminal}`;
  const cur = state.cursors[adapter];
  const key = keys.transcript(input.file, input.line);
  if ((cur && cur.file === input.file && cur.offset >= input.line) || state.seen[key]) return [];
  const prov: Provenance = { kind: "transcript", file: input.file, line: input.line };
  // The entry's own time when it has one (display order only: it is the program's word), else receive time.
  const at = input.entry.sourceAt ?? input.t;
  const base = env(key, at, input.t, input.terminal, prov, "untrusted");
  const cursor: Ev = { ...base, key: `cursor:${adapter}`, type: "cursor", adapter, file: input.file, offset: input.line };
  const tag = input.entry.role === "user" ? parseTag(input.entry.text) : null;
  if (!tag) return [{ ...base, type: "transcript", entry: input.entry }, cursor];
  const from = tag.attrs.from;
  if (from !== undefined) {
    const sender: Party = { kind: "claimed", terminal: claimedTerminal(input.terminal, from), label: from };
    return [{ ...base, type: "message", from: sender, to: { kind: "terminal", terminal: input.terminal }, text: tag.body, via: "hc-tag" }, cursor];
  }
  // A tag without a sender is hc's own note about a child: an observation, not a message.
  return [observation(key, at, input.t, input.terminal, prov, "untrusted", "hc-note", input.terminal, claimedTerminal(input.terminal, tag.body), tag.body), cursor];
}

/** `<hc from="t7 review" reach="...">text</hc>` at the start of a user turn. Unauthenticated: anyone can type one. */
export function parseTag(text: string): { attrs: Record<string, string>; body: string } | null {
  const m = /^\s*<hc((?:\s+[a-z_]+="[^"]*")*)\s*>([\s\S]*?)<\/hc>/.exec(text);
  if (!m) return null;
  const attrs: Record<string, string> = {};
  for (const a of (m[1] ?? "").matchAll(/([a-z_]+)="([^"]*)"/g)) attrs[a[1] as string] = a[2] as string;
  return { attrs, body: m[2] ?? "" };
}

/** The address a tag or note names first (`t7 review`, `rohan/t7`), as a key on the recipient's core. */
function claimedTerminal(recipient: TerminalKey, label: string): TerminalKey | null {
  const token = label.trim().split(/\s+/)[0] ?? "";
  if (!/^(?:[A-Za-z0-9._-]+\/)?t[1-9][0-9a-z]*$/.test(token)) return null;
  const slash = recipient.indexOf("/");
  const coreId = recipient.slice(0, slash);
  const machine = recipient.slice(slash + 1).split("/");
  return token.includes("/") || machine.length < 2 ? `${coreId}/${token}` : `${coreId}/${machine[0]}/${token}`;
}

const FLEET: Record<string, ObservationKind> = { REPORT: "fleet-report", TURN: "fleet-turn", QUESTION: "fleet-question", GONE: "fleet-gone" };

function fleet(state: StoreState, input: Input<"fleet">): Ev[] {
  const adapter = `fleet:${input.job}`;
  const cur = state.cursors[adapter];
  const key = keys.fleet(input.job, input.file, input.offset);
  if ((cur && cur.file === input.file && cur.offset > input.offset) || state.seen[key]) return [];
  const prov: Provenance = { kind: "fleet", job: input.job, file: input.file, offset: input.offset };
  const cursor: Ev = { ...env(`cursor:${adapter}`, input.t, input.t, null, prov, "untrusted"), type: "cursor", adapter, file: input.file, offset: input.offset + utf8Length(input.line) + 1 };
  const [word = "", second = ""] = input.line.trim().split(/\s+/);
  const kind = FLEET[word];
  if (!kind) return [cursor];
  // Who it is about (the agent named on the line) and who it was for (the job's lead): label hints only.
  const about = word === "REPORT" ? null : byLabels(state, { "stampede.agent": second.replace(/:$/, "") }, input.job);
  const lead = byLabels(state, { "stampede.role": "lead" }, input.job);
  return [observation(key, input.t, input.t, lead ?? about, prov, "untrusted", kind, lead, about, input.line.trim()), cursor];
}

/** The newest live-or-finished terminal carrying these labels (and the job's, when it has one). */
function byLabels(state: StoreState, want: Record<string, string>, job: string): TerminalKey | null {
  let best: TerminalState | null = null;
  for (const t of sorted(state.terminals)) {
    if (t.gone || (t.labels["stampede.job"] !== undefined && t.labels["stampede.job"] !== job)) continue;
    if (!Object.entries(want).every(([k, v]) => v !== "" && t.labels[k] === v)) continue;
    if (!best || t.created_ms > best.created_ms) best = t;
  }
  return best?.key ?? null;
}

const utf8Length = (s: string): number => new TextEncoder().encode(s).length;

// ---------------------------------------------------------------- event helpers

const env = (key: string, at: number, receivedAt: number, terminal: TerminalKey | null, provenance: Provenance, trust: ActivityEvent["trust"]): Env => ({ key, at, receivedAt, terminal, provenance, trust });

function observation(key: string, at: number, receivedAt: number, terminal: TerminalKey | null, prov: Provenance, trust: ActivityEvent["trust"], kind: ObservationKind, subject: TerminalKey | null, about: TerminalKey | null, text: string): Ev {
  return { ...env(key, at, receivedAt, terminal, prov, trust), type: "observation", kind, subject, about, text };
}

function connection(input: SourceInput, c: ConnectionState): Ev {
  return { ...env(`conn:${input.source}:${input.conn}:${c.state}`, input.t, input.t, null, { kind: "core", source: input.source, coreId: "", conn: input.conn, seq: 0 }, "core"), type: "connection", source: input.source, conn: input.conn, connection: c };
}

function seqEvent(input: SourceInput, seq: number): Ev {
  return { ...env(`seq:${input.source}:${input.conn}:${seq}`, input.t, input.t, null, { kind: "core", source: input.source, coreId: "", conn: input.conn, seq }, "core"), type: "core.seq", source: input.source, conn: input.conn, seq };
}

/** Where a source stood when a disconnect voided its approvals. */
const asOf = (s: SourceState, input: SourceInput): Provenance => ({ kind: "core", source: s.id, coreId: s.coreId ?? "", conn: s.conn ?? input.conn, seq: s.lastSeq ?? 0 });

type ApprovalFilter = (a: StoreState["approvals"][string]) => boolean;
const byCore = (coreId: string | null): ApprovalFilter => (a) => coreId !== null && a.request.fingerprint.coreId === coreId;
const byTerminal = (k: TerminalKey): ApprovalFilter => (a) => a.request.terminal === k;

/** Open requests only: one in flight is settled by its action, never voided under it. */
function voidOpen(state: StoreState, which: ApprovalFilter, why: string, t: number, prov: Provenance): Ev[] {
  return sorted(state.approvals)
    .filter((a) => a.state === "open" && which(a))
    .map((a) => ({ ...env(keys.approvalResolved(a.request.id, "voided"), t, t, a.request.terminal, prov, "core"), type: "approval.resolved" as const, approvalId: a.request.id, outcome: "voided" as const, actionId: null, detail: why }));
}

/** Map values in key order, so every platform emits the same events in the same order. */
function sorted<V>(m: Record<string, V>): V[] {
  return Object.keys(m)
    .sort()
    .map((k) => m[k] as V);
}

// ---------------------------------------------------------------- reduce

/** Pure: copies only the collections this event can touch. */
export function reduce(state: StoreState, e: TremorEvent): StoreState {
  const s: StoreState = { ...state };
  switch (e.type) {
    case "connection":
    case "core.hello":
    case "core.seq":
      s.sources = { ...s.sources };
      if (e.type === "core.hello") s.docs = { ...s.docs };
      break;
    case "terminal.upsert":
    case "terminal.patch":
    case "terminal.removed":
    case "terminal.gone":
      s.terminals = { ...s.terminals };
      break;
    case "cursor":
      s.cursors = { ...s.cursors };
      break;
    case "doc":
      s.docs = { ...s.docs };
      break;
    case "history.gap":
      break;
    default:
      if (s.seen[e.key]) return state;
      s.activity = [...s.activity];
      s.seen = { ...s.seen };
      s.approvals = { ...s.approvals };
      s.actions = { ...s.actions };
  }
  apply(s, e);
  return s;
}

/**
 * Applies an event to a state whose collections the caller owns (a private copy): nested entries are
 * always replaced, never edited, so states that share entries stay correct. The fast path for replays.
 */
export function apply(s: StoreState, e: TremorEvent): void {
  switch (e.type) {
    case "connection": {
      const src = s.sources[e.source] ?? newSource(e.source);
      const c = e.connection;
      const next: SourceState = { ...src, connection: c };
      if (c.state === "connecting" && src.conn !== e.conn) Object.assign(next, { retired: retire(src.retired, src.conn), conn: e.conn, lastSeq: null, hello: null });
      else if (c.state === "reconnecting" || c.state === "offline") Object.assign(next, { retired: retire(src.retired, e.conn), conn: src.conn ?? e.conn });
      s.sources[e.source] = next;
      return;
    }
    case "core.hello": {
      const src = s.sources[e.source] ?? newSource(e.source);
      // A different core: its documents are another core's, and versions start again.
      if (src.coreId !== null && src.coreId !== e.hello.core.id) s.docs[e.source] = {};
      s.sources[e.source] = { ...src, hello: e.hello, coreId: e.hello.core.id };
      return;
    }
    case "core.seq": {
      const src = s.sources[e.source];
      if (src) s.sources[e.source] = { ...src, lastSeq: e.seq };
      return;
    }
    case "terminal.upsert": {
      const k = e.terminal as TerminalKey;
      s.terminals[k] = decodeTerminal(k.slice(0, k.indexOf("/")), e.record, e.mock === true);
      return;
    }
    case "terminal.patch": {
      const t = e.terminal === null ? undefined : s.terminals[e.terminal];
      if (t) s.terminals[t.key] = { ...t, ...e.patch, records: e.patch.records ?? t.records, foreground: e.patch.foreground === undefined ? t.foreground : e.patch.foreground };
      return;
    }
    case "terminal.removed":
      if (e.terminal !== null) delete s.terminals[e.terminal];
      return;
    case "terminal.gone": {
      const t = e.terminal === null ? undefined : s.terminals[e.terminal];
      if (t) s.terminals[t.key] = { ...t, gone: true };
      return;
    }
    case "cursor":
      s.cursors[e.adapter] = { file: e.file, offset: e.offset };
      return;
    case "doc":
      s.docs[e.source] = { ...s.docs[e.source], [e.name]: { version: e.version, value: e.value } };
      return;
    case "history.gap":
      // The latest gap bounds what is complete; an older one replayed never moves it back.
      s.historyGapAt = Math.max(s.historyGapAt ?? e.at, e.at);
      return;
  }
  if (s.seen[e.key]) return;
  s.activity.push(e);
  s.seen[e.key] = true;
  switch (e.type) {
    case "approval.request":
      s.approvals[e.request.id] = { request: e.request, state: "open", createdAt: e.at, resolvedAt: null, actionId: null };
      return;
    case "approval.resolved": {
      const a = s.approvals[e.approvalId];
      if (a && (a.state === "open" || a.state === "in-flight")) s.approvals[e.approvalId] = { ...a, state: e.outcome, resolvedAt: e.at };
      return;
    }
    case "action": {
      const clientId = e.provenance.kind === "user" ? e.provenance.clientId : "";
      s.actions[e.action.actionId] = { action: e.action, clientId, dispatchedAt: e.at, outcome: null };
      if (e.action.type === "approve") {
        const option = e.action.option;
        const a = s.approvals[e.action.approvalId];
        // Single use: only an open request, and only for one of its own options.
        if (a && a.state === "open" && a.request.options.some((o) => o.label === option)) s.approvals[a.request.id] = { ...a, state: "in-flight", actionId: e.action.actionId };
      }
      return;
    }
    case "message":
      if (e.via === "composer" && e.provenance.kind === "user" && e.to.kind === "terminal")
        // The composer's send, as an action entry (logs from before v1.2 carry no expected status: "none").
        s.actions[e.provenance.actionId] = {
          action: { type: "send", terminal: e.to.terminal, text: e.text, expectedStatus: e.expectedStatus ?? "none", actionId: e.provenance.actionId },
          clientId: e.provenance.clientId,
          dispatchedAt: e.at,
          outcome: null,
        };
      return;
    case "action.settled": {
      const a = s.actions[e.actionId];
      if (a) s.actions[e.actionId] = { ...a, outcome: e.outcome };
      return;
    }
  }
}

const newSource = (id: SourceId): SourceState => ({ id, connection: { state: "connecting", attempt: 0 }, coreId: null, conn: null, lastSeq: null, retired: [], hello: null });

function retire(list: ConnId[], conn: ConnId | null): ConnId[] {
  return conn === null || list.includes(conn) ? list : [...list, conn].slice(-RETIRED_MAX);
}

export const engine: StoreEngine = { initial, normalize, reduce };

/** Normalizes and applies inputs onto a state the caller owns (see `apply`). Returns the events applied. */
export function applyInputs(state: StoreState, inputs: Iterable<CoreInput>): TremorEvent[] {
  const all: TremorEvent[] = [];
  for (const input of inputs)
    for (const e of normalize(state, input)) {
      apply(state, e);
      all.push(e);
    }
  return all;
}

/** A deep, private copy of a state, safe to `apply` onto. */
export const own = (s: StoreState): StoreState => structuredClone(s);
