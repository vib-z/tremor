// The only surface the Electron renderer gets (through contextBridge), and main's validator for it.
// No arbitrary Core method, command, path or shell string crosses this boundary. A valid payload is not
// proof that a person acted: approvals and terminal takeover are confirmed by main itself (Touch ID or a
// native dialog showing the exact action), outside the renderer.

import type { ComposerStatus, TremorEvent, StoreState, TerminalKey, UserIntent, UserOutcome } from "./model.ts";

export type StoreUpdate = { kind: "snapshot"; state: StoreState } | { kind: "events"; events: TremorEvent[] };

/** Negotiated per stream from `hello.features` and the attach reply. */
export interface StreamCapabilities {
  automaticInput: boolean;
  resizeNotifications: boolean;
}

/** Delivered in Core's order. A `resize` must be applied before any later `data`. */
export type StreamFrame =
  | { kind: "data"; seq: number; bytes: Uint8Array }
  | { kind: "resize"; seq: number; cols: number; rows: number }
  | { kind: "close"; seq: number; reason: string; exitCode: number | null; signal: number | null };

export interface TerminalStream {
  readonly mode: "observe" | "active";
  readonly capabilities: StreamCapabilities;
  onFrame(listener: (frame: StreamFrame) => void): () => void;
  /** Call once the emulator has consumed a data frame (its write callback); main turns it into CREDIT. */
  consumed(seq: number): void;
  /**
   * active mode only; main drops every write from an observer (Core ignores observer input anyway).
   * `automatic` (terminal query replies) is sent as AUTOMATIC_INPUT only when negotiated, else as DATA.
   */
  write(bytes: Uint8Array, source: "human" | "automatic"): void;
  /** active mode only. */
  resize(cols: number, rows: number): void;
  close(): void;
}

export interface TremorApi {
  readonly version: string;
  /** A snapshot first, then events in order; the renderer replays events through the same reducer. */
  subscribe(listener: (update: StoreUpdate) => void): () => void;
  act(intent: UserIntent): Promise<UserOutcome>;
  /** `active` (takeover) makes main ask the person to confirm (Touch ID or a native dialog) before attaching as an active viewer. */
  openTerminal(terminal: TerminalKey, mode: "observe" | "active", cols: number, rows: number): Promise<TerminalStream>;
}

export const LIMITS = { text: 64 * 1024, option: 32, cols: 1000, rows: 500, writeBytes: 64 * 1024 } as const;

/** `<coreId>/<address>`: core ids are hex or word characters; addresses `t7` or `machine/t7`. */
export const TERMINAL_KEY = /^[A-Za-z0-9_-]{1,64}\/(?:[A-Za-z0-9._-]{1,64}\/)?t[0-9a-z]{1,16}$/;
export const APPROVAL_ID = /^approval:[A-Za-z0-9_-]{1,64}\/(?:[A-Za-z0-9._-]{1,64}\/)?t[0-9a-z]{1,16}:[0-9]{1,16}(?::[0-9]{1,6})?$/;
const COMPOSER: readonly ComposerStatus[] = ["idle", "working", "done", "error", "none"];

export class IntentError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
function str(o: Record<string, unknown>, k: string, re: RegExp | null, max: number): string {
  const v = o[k];
  if (typeof v !== "string" || v.length === 0 || v.length > max || (re && !re.test(v))) throw new IntentError(`bad ${k}`);
  return v;
}
function int(o: Record<string, unknown>, k: string, min: number, max: number): number {
  const v = o[k];
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw new IntentError(`bad ${k}`);
  return v;
}
function exactKeys(o: Record<string, unknown>, allowed: string[]): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) throw new IntentError(`unexpected field ${k}`);
}

/**
 * Main calls this on every act() payload, then checks the result against its own state (the terminal exists,
 * the approval is open and the option is one of its own, the seen turn is not above Core's turn).
 * Returns a fresh object holding only known fields.
 */
export function validateIntent(raw: unknown): UserIntent {
  if (!isObj(raw)) throw new IntentError("not an object");
  const terminal = () => str(raw, "terminal", TERMINAL_KEY, 200);
  switch (raw.type) {
    case "send": {
      exactKeys(raw, ["type", "terminal", "text", "expectedStatus"]);
      const expectedStatus = raw.expectedStatus as ComposerStatus;
      if (!COMPOSER.includes(expectedStatus)) throw new IntentError("bad expectedStatus");
      return { type: "send", terminal: terminal(), text: str(raw, "text", null, LIMITS.text), expectedStatus };
    }
    case "interrupt":
      exactKeys(raw, ["type", "terminal"]);
      return { type: "interrupt", terminal: terminal() };
    case "approve":
      exactKeys(raw, ["type", "approvalId", "option"]);
      return { type: "approve", approvalId: str(raw, "approvalId", APPROVAL_ID, 300), option: str(raw, "option", /^[A-Za-z ]+$/, LIMITS.option) };
    case "markSeen":
      exactKeys(raw, ["type", "terminal", "turn"]);
      return { type: "markSeen", terminal: terminal(), turn: int(raw, "turn", 0, 1e9) };
    case "pin":
      exactKeys(raw, ["type", "terminal", "pinned"]);
      if (typeof raw.pinned !== "boolean") throw new IntentError("bad pinned");
      return { type: "pin", terminal: terminal(), pinned: raw.pinned };
    default:
      throw new IntentError("unknown intent");
  }
}

/** Main's check for openTerminal arguments. */
export function validateOpen(terminal: unknown, mode: unknown, cols: unknown, rows: unknown): { terminal: TerminalKey; mode: "observe" | "active"; cols: number; rows: number } {
  const o = { terminal, mode, cols, rows } as Record<string, unknown>;
  if (mode !== "observe" && mode !== "active") throw new IntentError("bad mode");
  return { terminal: str(o, "terminal", TERMINAL_KEY, 200), mode, cols: int(o, "cols", 2, LIMITS.cols), rows: int(o, "rows", 2, LIMITS.rows) };
}
