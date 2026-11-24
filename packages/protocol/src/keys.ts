// Deterministic rules both platforms implement identically; fixtures prove them.

import type { CoreStatus, CoreTerminal, SendGuard } from "./wire.ts";
import type { ActivityEvent, ApprovalOption, ComposerStatus, ConnId, DialogKind, FileId, Fingerprint, Party, StoreState, TerminalKey, TerminalState } from "./model.ts";

export const termKey = (coreId: string, address: string): TerminalKey => `${coreId}/${address}`;

/** Occurrence keys. Never built from content or turn numbers, so distinct occurrences never merge. */
export const keys = {
  /** Any activity derived from one Core notification (status, turn, lifecycle). A suffix separates several from one event. */
  core: (coreId: string, conn: ConnId, seq: number, part = "") => `core:${coreId}:${conn}:${seq}${part ? `:${part}` : ""}`,
  /** A difference found when a snapshot (subscribe reply or `missed`, identified by its seq) is reconciled against stored state. */
  gap: (coreId: string, conn: ConnId, snapshotSeq: number, address: string, part: string) => `gap:${coreId}:${conn}:${snapshotSeq}:${address}:${part}`,
  user: (clientId: string, actionId: string) => `user:${clientId}:${actionId}`,
  settled: (clientId: string, actionId: string) => `user:${clientId}:${actionId}:settled`,
  transcript: (file: FileId, line: number) => `tx:${file}:${line}`,
  fleet: (job: string, file: FileId, offset: number) => `fleet:${job}:${file}:${offset}`,
  /**
   * One per blocked occurrence. Core moves `status_ms` only when the status word changes, so two blocked
   * statuses in a row share it: `n` counts the distinct blocked statuses already seen under that `status_ms`
   * (0 for the first, which keeps the short form).
   */
  approval: (t: TerminalKey, statusMs: number, n = 0) => `approval:${t}:${statusMs}${n > 0 ? `:${n}` : ""}`,
  approvalResolved: (approvalId: string, how: string) => `${approvalId}:${how}`,
  /** An open request voided by a later status, a disconnect or `missed`. */
  voided: (approvalId: string) => `${approvalId}:voided`,
  /** Key part for activity about a child 7501 record. */
  record: (id: string) => `rec:${id}`,
  historyGap: (t: number) => `history-gap:${t}`,
};

/** The first difference a reconciled snapshot found for one terminal (the gap key's part). */
export type GapPart = "state" | "status" | "turn" | "appeared" | "removed" | "gone";

/** Gap observation texts, exactly; fixtures check them, so every platform builds them here. */
export const gapText = {
  whileDisconnected: "while disconnected",
  whileMissed: "while events were missed",
  /** `<why>: <part>; <part>`: one gap per terminal, its key part the first difference. */
  join: (why: string, parts: string[]) => `${why}: ${parts.join("; ")}`,
  state: (r: Pick<CoreTerminal, "state" | "reason" | "exit_code">) =>
    r.state === "finished" ? `finished (${r.reason ?? "no reason"}${r.exit_code === null ? "" : `, exit ${r.exit_code}`})` : "live again",
  status: (r: Pick<CoreTerminal, "status">) => `status now ${r.status?.state ?? "none"}`,
  turn: (r: Pick<CoreTerminal, "turn">) => `turn now ${r.turn}`,
  appeared: "started",
  removed: "no longer in Core's records",
  gone: (newCoreId: string) => `its core went away: core ${newCoreId} answered instead`,
};

/** Core's whole-terminal replies omit empty `records` and absent `foreground`. */
export function decodeTerminal(coreId: string, r: CoreTerminal, mock = false): TerminalState {
  return {
    ...r,
    records: r.records ?? {},
    foreground: r.foreground ?? null,
    key: termKey(coreId, r.address),
    coreId,
    parentKey: r.parent === null ? null : termKey(coreId, r.parent),
    gone: false,
    mock,
  };
}

const STATUS_FIELDS = ["state", "kind", "msg", "title", "app", "progress"] as const;

/** Exact equality of two status records; a missing field equals null. */
export function sameStatus(a: CoreStatus | null, b: CoreStatus | null): boolean {
  if (a === null || b === null) return a === b;
  return STATUS_FIELDS.every((f) => (a[f] ?? null) === (b[f] ?? null));
}

/** The approval fingerprint of a fresh terminal.get. Null unless blocked with a known status time. */
export function fingerprintOf(coreId: string, t: CoreTerminal): Fingerprint | null {
  if (!t.status || t.status.state !== "blocked" || t.status_ms === null) return null;
  return { coreId, address: t.address, turn: t.turn, statusMs: t.status_ms, status: t.status };
}

export const sameFingerprint = (a: Fingerprint, b: Fingerprint | null): boolean =>
  b !== null && a.coreId === b.coreId && a.address === b.address && a.turn === b.turn && a.statusMs === b.statusMs && sameStatus(a.status, b.status);

/** From Core's record of what was started (argv), never from the program's self-reported `app`. */
export function dialogOf(t: Pick<CoreTerminal, "argv">): DialogKind {
  const bin = (t.argv[0] ?? "").split("/").pop();
  return bin === "claude" ? "claude-code" : "unknown";
}

/**
 * Buttons per dialog and request kind. Claude Code's permission prompt: Enter takes the highlighted first
 * option (Yes; verified live 2026-11-08), Esc declines. Question and auth prompts get no buttons.
 */
export function dialogOptions(dialog: DialogKind, kind: string | null | undefined): ApprovalOption[] {
  if (dialog === "claude-code" && kind === "permission")
    return [
      { label: "Approve", keys: ["enter"] },
      { label: "Deny", keys: ["esc"] },
    ];
  return [];
}

/** The composer's guard. `refuse`: never type (blocked). null: no `if` (Core still refuses a blocked program). */
export function sendGuard(shown: ComposerStatus | "blocked"): SendGuard | null | "refuse" {
  if (shown === "blocked") return "refuse";
  if (shown === "idle" || shown === "working") return shown;
  return null;
}

export const partyString = (p: Party): string =>
  p.kind === "terminal" ? `terminal:${p.terminal}` : p.kind === "person" ? `person:${p.clientId}` : p.kind === "claimed" ? `claimed:${p.terminal ?? "-"}:${p.label}` : `unknown:${p.label}`;

/** One line per activity payload, so fixtures check what each event says, not only that it exists. */
export function activitySummary(e: ActivityEvent): string {
  switch (e.type) {
    case "status":
      return `${e.status?.state ?? "null"}${e.record ? `@${e.record}` : ""}${e.gone ? " gone" : ""}|${e.status?.kind ?? ""}|${e.status?.msg ?? ""}`;
    case "turn":
      return `${e.turn}:${e.state ?? "null"}`;
    case "lifecycle":
      return `${e.phase}:${e.reason ?? ""}:${e.exitCode ?? ""}:${e.signal ?? ""}`;
    case "message":
      return e.via;
    case "observation":
      return `${e.kind}:${e.subject ?? ""}>${e.about ?? ""}:${e.text}`;
    case "transcript":
      return `${e.entry.role}:${e.entry.tool ?? ""}:${e.entry.toolUseId ?? ""}:${e.entry.text}`;
    case "approval.request":
      return `${e.request.dialog}:${e.request.kind}`;
    case "approval.resolved":
      return e.outcome;
    case "action":
      return e.action.type;
    case "action.settled":
      return e.outcome.state;
  }
}

/** A projection of state that fixtures assert on, covering everything safety-relevant. */
export interface Digest {
  sources: Record<string, { connection: string; coreId: string | null; conn: string | null; lastSeq: number | null }>;
  terminals: Record<
    string,
    {
      state: string;
      status: CoreStatus | null;
      statusMs: number | null;
      records: Record<string, CoreStatus>;
      foreground: string | null;
      turn: number;
      title: string;
      parentKey: string | null;
      gone: boolean;
      labels: Record<string, string>;
    }
  >;
  /** `<type> <key> <at> <summary>` in application order. */
  activity: string[];
  messages: { key: string; from: string; to: string; via: string; text: string; expectedStatus?: string }[];
  approvals: Record<string, { state: string; msg: string; dialog: string; fingerprint: Fingerprint; options: string[] }>;
  actions: Record<string, string>;
  cursors: Record<string, { file: string; offset: number }>;
  docs: Record<string, Record<string, number>>;
  historyGapAt: number | null;
}

export function digest(s: StoreState): Digest {
  const d: Digest = { sources: {}, terminals: {}, activity: [], messages: [], approvals: {}, actions: {}, cursors: { ...s.cursors }, docs: {}, historyGapAt: s.historyGapAt };
  for (const [id, v] of Object.entries(s.sources)) d.sources[id] = { connection: v.connection.state, coreId: v.coreId, conn: v.conn, lastSeq: v.lastSeq };
  for (const [k, v] of Object.entries(s.terminals))
    d.terminals[k] = {
      state: v.state,
      status: v.status,
      statusMs: v.status_ms,
      records: v.records,
      foreground: v.foreground ? `${v.foreground.name}@${v.foreground.cwd}` : null,
      turn: v.turn,
      title: v.title,
      parentKey: v.parentKey,
      gone: v.gone,
      labels: v.labels,
    };
  for (const e of s.activity) {
    d.activity.push(`${e.type} ${e.key} ${e.at} ${activitySummary(e)}`);
    if (e.type === "message") d.messages.push({ key: e.key, from: partyString(e.from), to: partyString(e.to), via: e.via, text: e.text, ...(e.expectedStatus ? { expectedStatus: e.expectedStatus } : {}) });
  }
  for (const [k, v] of Object.entries(s.approvals))
    d.approvals[k] = { state: v.state, msg: v.request.msg, dialog: v.request.dialog, fingerprint: v.request.fingerprint, options: v.request.options.map((o) => `${o.label}=${o.keys.join("+")}`) };
  for (const [k, v] of Object.entries(s.actions)) d.actions[k] = v.outcome?.state ?? "pending";
  for (const [src, docs] of Object.entries(s.docs)) d.docs[src] = Object.fromEntries(Object.entries(docs).map(([n, x]) => [n, x.version]));
  return d;
}

/** JSON with object keys sorted at every level, no whitespace, undefined fields dropped: the digest comparison format. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, x]) => `${JSON.stringify(k)}:${canonicalJson(x)}`)
      .join(",")}}`;
  return JSON.stringify(v);
}
