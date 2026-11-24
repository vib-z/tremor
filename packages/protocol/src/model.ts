// The normalized model: inputs, events, state. Pure data; no I/O.
//
// Pipeline: Node I/O records everything it sees as CoreInput lines (the same shape golden fixtures
// use) -> normalize(state, input) -> TremorEvent[] -> reduce(state, event) -> StoreState.
// Everything after the I/O seam is deterministic, so TypeScript and the Swift port can be proven
// against the same fixtures. Hardened after plan review round 1 (reports/review-plan.md P1-P12).

import type { CoreForeground, CoreHello, CoreNotification, CoreStatus, CoreSubscribed, CoreTerminal } from "./wire.ts";

/** `<coreId>/<address>`; address may itself be `machine/t7`. */
export type TerminalKey = string;
/** A Core connection source this client manages (`local` for the desktop's own `hc connect`). */
export type SourceId = string;
/** A connection id, unique across app runs (main generates a random one per connection). */
export type ConnId = string;
/** A file's identity across renames and truncation: `<dev>:<ino>:<birthtimeMs>`, plus `#<n>` after a truncation. */
export type FileId = string;

// ---------------------------------------------------------------- user intents and outcomes

/**
 * What the chat composer saw. Main maps it to Core's guard: idle -> `if: "idle"`, working -> `if: "working"`,
 * done, error and none -> no guard (Core itself refuses to type into a blocked program without `force`,
 * which Tremor never sets). A blocked agent cannot be messaged; it is answered by an approval or a takeover.
 */
export type ComposerStatus = "idle" | "working" | "done" | "error" | "none";

/** A person's action as the renderer asks for it. Main assigns actionId and checks it against its own state. */
export type UserIntent =
  | { type: "send"; terminal: TerminalKey; text: string; expectedStatus: ComposerStatus }
  | { type: "interrupt"; terminal: TerminalKey }
  /** The renderer names a request and an option label only; main holds the fingerprint and the keys. */
  | { type: "approve"; approvalId: string; option: string }
  | { type: "markSeen"; terminal: TerminalKey; turn: number }
  | { type: "pin"; terminal: TerminalKey; pinned: boolean };

export type UserAction = UserIntent & { actionId: string };

/**
 * done: Core reports it happened. refused: Core or main refused before any input (nothing typed).
 * voided: an approval whose fingerprint no longer matched (nothing typed). cancelled: cancelled before
 * any input was typed. unknown: it may or may not have happened (transport broke, timeout, crash between
 * dispatch and settle); never retried automatically.
 */
export type OutcomeState = "done" | "refused" | "voided" | "cancelled" | "unknown";
export interface UserOutcome {
  state: OutcomeState;
  detail: string;
}

export interface TranscriptEntry {
  role: "assistant" | "user" | "tool-use" | "tool-result";
  text: string;
  tool?: string;
  /** The source's own entry id (Claude Code `uuid`), when it has one. */
  id?: string;
  /** Pairs a tool-result with its tool-use (Claude Code `tool_use_id`). */
  toolUseId?: string;
  /** The source's own timestamp, if it has one; `at` on the event stays the receive time otherwise. */
  sourceAt?: number;
}

// ---------------------------------------------------------------- inputs (the I/O seam)

export type CoreInput =
  | { t: number; source: SourceId; conn: ConnId; kind: "connecting"; attempt: number }
  | { t: number; source: SourceId; conn: ConnId; kind: "hello"; result: CoreHello }
  | { t: number; source: SourceId; conn: ConnId; kind: "subscribed"; result: CoreSubscribed }
  | { t: number; source: SourceId; conn: ConnId; kind: "notification"; msg: CoreNotification }
  /** A doc.get result main made after every subscribe, `doc` event and `missed` (read-only; Tremor never writes `herdr-app`). */
  | { t: number; source: SourceId; conn: ConnId; kind: "doc"; name: string; version: number; value: unknown }
  /** A fresh terminal.get main made (on every blocked status, before an approval card can exist). */
  | { t: number; source: SourceId; conn: ConnId; kind: "terminal"; result: CoreTerminal }
  | { t: number; source: SourceId; conn: ConnId; kind: "closed"; reason: string; attempt: number; retryInMs: number }
  | { t: number; source: SourceId; conn: ConnId; kind: "offline"; reason: string }
  /** Written to the log before main calls Core: a crash after this and before `settled` reads as unknown. */
  | { t: number; kind: "user"; phase: "dispatched"; clientId: string; action: UserAction }
  | { t: number; kind: "user"; phase: "settled"; clientId: string; actionId: string; outcome: UserOutcome }
  | { t: number; kind: "transcript"; terminal: TerminalKey; file: FileId; line: number; entry: TranscriptEntry }
  | { t: number; kind: "fleet"; job: string; file: FileId; offset: number; line: string }
  /** Persistence recovered with no valid checkpoint: earlier history is incomplete (spec section 4). */
  | { t: number; kind: "history-gap"; reason: string };

// ---------------------------------------------------------------- events

/** core: Core's own records (who started what, when, its lifecycle). user: a person's action here.
 *  untrusted: anything a program, file or plugin wrote, including Core status `msg`, `title` and `app`. */
export type Trust = "core" | "user" | "untrusted";

export type Provenance =
  | { kind: "core"; source: SourceId; coreId: string; conn: ConnId; seq: number }
  | { kind: "snapshot"; source: SourceId; coreId: string; conn: ConnId; seq: number }
  | { kind: "get"; source: SourceId; coreId: string; conn: ConnId }
  | { kind: "transcript"; file: FileId; line: number }
  | { kind: "user"; clientId: string; actionId: string }
  | { kind: "fleet"; job: string; file: FileId; offset: number }
  | { kind: "plugin"; id: string; rev: string }
  | { kind: "mock"; fixture: string }
  /** Something this client itself concluded (persistence recovery). */
  | { kind: "local"; what: string };

export type ConnectionState =
  | { state: "connecting"; attempt: number }
  | { state: "live"; since: number }
  | { state: "reconnecting"; attempt: number; retryInMs: number; reason: string }
  | { state: "offline"; reason: string }
  | { state: "mock" };

/**
 * Who said something. `claimed`: text that names a sender (an `<hc from="t7 review">` tag in a transcript)
 * without proof; shown as a message with an unverified sender, never as a proven edge.
 */
export type Party =
  | { kind: "terminal"; terminal: TerminalKey }
  | { kind: "person"; clientId: string }
  | { kind: "claimed"; terminal: TerminalKey | null; label: string }
  | { kind: "unknown"; label: string };

export type ObservationKind = "hc-note" | "fleet-report" | "fleet-turn" | "fleet-question" | "fleet-gone" | "plugin" | "gap";

export interface ApprovalOption {
  label: string;
  /** Exactly the keys main will press (terminal.keys). */
  keys: string[];
}

/** Exact, structural: compared field by field, never by hash. */
export interface Fingerprint {
  coreId: string;
  address: string;
  turn: number;
  statusMs: number;
  status: CoreStatus;
}

/**
 * Which dialog a blocked terminal shows, decided by main from Core's record of what it started
 * (`argv[0]` basename), never from the program's self-reported `app`. `unknown`: no buttons; answer in the terminal.
 */
export type DialogKind = "claude-code" | "unknown";

export interface ApprovalRequest {
  /** `approval:<terminalKey>:<status_ms>[:<n>]`: one per blocked occurrence (keys.approval). */
  id: string;
  terminal: TerminalKey;
  /** permission, question or auth, as reported (untrusted). */
  kind: string;
  /** The action as the program reported it, for example `approve Write: /path` (untrusted text, shown verbatim). */
  msg: string;
  dialog: DialogKind;
  options: ApprovalOption[];
  fingerprint: Fingerprint;
}

export type ApprovalState = "open" | "in-flight" | "sent" | "voided" | "expired" | "refused" | "unknown";

interface Envelope {
  /**
   * Activity: a dedupe key naming the occurrence (keys.ts): a Core event `core:<coreId>:<conn>:<seq>`, a user
   * action, a file line by file identity. Core never replays events, so a reconnect brings a snapshot, which
   * is reconciled against stored state into explicit `gap` observations, never into repeated activity.
   * State events: not deduped.
   */
  key: string;
  /** ms since the epoch: the fact's own time where Core gives one (created_ms, finished_ms, status_ms), else the input's receive time. */
  at: number;
  /** The input's receive time (`t`), always. */
  receivedAt: number;
  terminal: TerminalKey | null;
  provenance: Provenance;
  trust: Trust;
  mock?: true;
}

export type StateEvent = Envelope &
  (
    | { type: "connection"; source: SourceId; conn: ConnId; connection: ConnectionState }
    | { type: "core.hello"; source: SourceId; conn: ConnId; hello: CoreHello }
    | { type: "core.seq"; source: SourceId; conn: ConnId; seq: number }
    | { type: "terminal.upsert"; record: CoreTerminal }
    | { type: "terminal.patch"; patch: Partial<CoreTerminal> }
    | { type: "terminal.removed" }
    | { type: "terminal.gone"; reason: string }
    | { type: "cursor"; adapter: string; file: FileId; offset: number }
    | { type: "doc"; source: SourceId; name: string; version: number; value: unknown }
    /** Persistence found no recoverable base: history before this point is incomplete (spec section 4). */
    | { type: "history.gap"; reason: string }
  );

export type ActivityEvent = Envelope &
  (
    /** `record` null is the root 7501 record; otherwise a record id from `records` (`gone` when it disappeared). */
    | { type: "status"; status: CoreStatus | null; turn: number; record: string | null; gone?: true }
    | { type: "turn"; turn: number; state: string | null }
    | { type: "lifecycle"; phase: "created" | "lost" | "restarted" | "finished" | "removed"; reason: string | null; exitCode: number | null; signal: number | null }
    /** `expectedStatus`: what the composer saw (composer sends only). */
    | { type: "message"; from: Party; to: Party; text: string; via: "hc-tag" | "composer"; expectedStatus?: ComposerStatus }
    | { type: "observation"; subject: TerminalKey | null; about: TerminalKey | null; kind: ObservationKind; text: string }
    | { type: "transcript"; entry: TranscriptEntry }
    | { type: "approval.request"; request: ApprovalRequest }
    | { type: "approval.resolved"; approvalId: string; outcome: Exclude<ApprovalState, "open" | "in-flight">; actionId: string | null; detail: string }
    | { type: "action"; action: UserAction; phase: "dispatched" }
    | { type: "action.settled"; actionId: string; outcome: UserOutcome }
  );

export type TremorEvent = StateEvent | ActivityEvent;

// ---------------------------------------------------------------- state

export interface SourceState {
  id: SourceId;
  connection: ConnectionState;
  coreId: string | null;
  conn: ConnId | null;
  /** Highest seq applied on `conn`; events at or below it are dropped. */
  lastSeq: number | null;
  /** Connections this source has moved past; any later input from them is dropped (bounded, most recent 32). */
  retired: ConnId[];
  hello: CoreHello | null;
}

/** A terminal as stored: Core's record with defaults applied (records {}, foreground null). */
export interface TerminalState extends Omit<CoreTerminal, "records" | "foreground"> {
  records: Record<string, CoreStatus>;
  foreground: CoreForeground | null;
  key: TerminalKey;
  coreId: string;
  parentKey: TerminalKey | null;
  /** Its core went away (a different core id answered); kept as history. */
  gone: boolean;
  mock: boolean;
}

export interface ApprovalEntry {
  request: ApprovalRequest;
  state: ApprovalState;
  createdAt: number;
  resolvedAt: number | null;
  /** The action that took it in flight, if any (single use). */
  actionId: string | null;
}

export interface ActionEntry {
  action: UserAction;
  clientId: string;
  dispatchedAt: number;
  /** null while in flight; an action still null after a restart is shown as unknown. */
  outcome: UserOutcome | null;
}

export interface StoreState {
  sources: Record<SourceId, SourceState>;
  terminals: Record<TerminalKey, TerminalState>;
  /** Ordered by application order. */
  activity: ActivityEvent[];
  /** Dedupe index over activity keys (bounded with the activity retention window). */
  seen: Record<string, true>;
  approvals: Record<string, ApprovalEntry>;
  actions: Record<string, ActionEntry>;
  /** Adapter read positions, advanced only by the inputs that carry them. */
  cursors: Record<string, { file: FileId; offset: number }>;
  /** Core documents read with doc.get, per source (read-only; `herdr-app` holds herdr-app's spaces, tabs and splits). */
  docs: Record<SourceId, Record<string, { version: number; value: unknown }>>;
  /** Set when persistence could not recover a base: earlier history is incomplete. */
  historyGapAt: number | null;
}

// ---------------------------------------------------------------- derived views (selectors, implemented in @tremor/core/store)

export type Attention = "needs-you" | "working" | "done" | "idle" | "finished";

export interface SessionNode {
  terminal: TerminalKey;
  name: string;
  title: string;
  attention: Attention;
  pinned: boolean;
  workers: SessionNode[];
  mock: boolean;
}

export interface ChatItem {
  key: string;
  at: number;
  kind: "transcript" | "message-in" | "message-out" | "bubble" | "observation" | "approval" | "action";
  trust: Trust;
  /** Display text; never parsed back. Everything structured is on `event`. */
  text: string;
  /** For messages: whether the sender is proven (composer) or only claimed (hc tag). */
  sender?: "proven" | "claimed";
  /** For tool-use and tool-result transcript items: the pair they belong to. */
  toolUseId?: string;
  /** The activity this item shows, unchanged: role, tool, record id, approval id, outcome, evidence. */
  event: ActivityEvent;
  mock: boolean;
}

export interface RelayEdge {
  from: TerminalKey | "person";
  /** An observation with no recorded recipient ends at the observation rail, never at an invented terminal. */
  to: TerminalKey | "observation-rail";
  kind: "message" | "claimed-message" | "observation";
  count: number;
  lastAt: number;
  /** Activity keys behind this edge, most recent first, at most 20: what the Inspector opens. */
  evidence: string[];
}

export interface FactoryGraph {
  nodes: { terminal: TerminalKey; lead: TerminalKey | null; attention: Attention; label: string; mock: boolean }[];
  /** True when any edge ends at the observation rail. */
  rail: boolean;
  edges: RelayEdge[];
  /** Most recent activity first, bounded. */
  ticker: ChatItem[];
}

export interface Selectors {
  sessionTree(state: StoreState): SessionNode[];
  chat(state: StoreState, terminal: TerminalKey): ChatItem[];
  relayEdges(state: StoreState, sinceMs: number): RelayEdge[];
  factory(state: StoreState, sinceMs: number): FactoryGraph;
  openApprovals(state: StoreState): ApprovalEntry[];
}

/** The store API both platforms implement. normalize never executes anything: user inputs are records of what main did. */
export interface StoreEngine {
  initial(): StoreState;
  normalize(state: StoreState, input: CoreInput): TremorEvent[];
  reduce(state: StoreState, event: TremorEvent): StoreState;
}
