// Herdr Core wire types: the subset Tremor reads. Source: herdr-core schema/released.openrpc.json
// (protocol generation 1, hc 0.1.19) and schema/README.md. See docs/core-protocol.md.

/** One OSC 7501 record. Words are the program's own; nothing is translated. */
export interface CoreStatus {
  /** idle, working, done, blocked or error (as reported). */
  state: string;
  /** permission, question or auth (blocked only, when the program said). */
  kind?: string | null;
  msg?: string;
  /** 0..100 (working or blocked, when the program said). */
  progress?: number | null;
  title?: string;
  app?: string;
}

export interface CoreForeground {
  pid: number;
  name: string;
  argv: string[];
  cwd: string;
}

export interface CoreTerminal {
  /** `t7`, or `machine/t7` for a terminal on an added machine. Stable for the record's life. */
  address: string;
  name: string | null;
  labels: Record<string, string>;
  /** The terminal that started it, set once at start. */
  parent: string | null;
  state: "live" | "finished";
  status: CoreStatus | null;
  status_ms: number | null;
  /** Omitted by Core when empty: decode as {}. */
  records?: Record<string, CoreStatus>;
  reported: boolean;
  /** Rises each time the status leaves `working`. */
  turn: number;
  title: string;
  cwd: string;
  argv: string[];
  /** Omitted by Core when absent: decode as null. */
  foreground?: CoreForeground | null;
  exit_code: number | null;
  signal: number | null;
  reason: string | null;
  keep: boolean;
  created_ms: number;
  finished_ms: number | null;
  cols: number;
  rows: number;
  pid?: number | null;
  template?: string | null;
  screen?: string;
}

export interface CoreHello {
  core: { id: string; name: string };
  generation: number;
  version: string;
  features: string[];
  methods?: string[];
  framed?: boolean;
}

export interface CoreSubscribed {
  seq: number;
  terminals: CoreTerminal[];
  channel: number | null;
}

export type CoreEventType =
  | "created"
  | "lost"
  | "restarted"
  | "keep"
  | "finished"
  | "removed"
  | "status"
  | "turn"
  | "title"
  | "labels"
  | "size"
  | "foreground"
  | "doc";

export interface CoreEventParams {
  seq: number;
  type: CoreEventType;
  /** Absent on `doc` events. */
  terminal?: string;
  /** Set on `doc` events from an added machine. */
  machine?: string;
  data: unknown;
}

export type CoreNotification =
  | { method: "event"; params: CoreEventParams }
  | { method: "heartbeat"; params: { seq: number } }
  | { method: "missed"; params: { seq: number; terminals: CoreTerminal[] } };

/** `turn` event data. `state` is null when a working status is cleared or the program exits. */
export interface CoreTurnData {
  turn: number;
  state: string | null;
}

/** `terminal.send {if}` accepts only these two words (IdleOrWorking in the schema). */
export type SendGuard = "idle" | "working";

/** JSON-RPC error data: `kind` is stable (not_found, conflict, unavailable, ...). */
export interface CoreErrorData {
  kind: string;
  hint?: string;
}

export const CORE_GENERATION = 1;
