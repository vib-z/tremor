// ActionService: a person's intent from the renderer, checked by main against its own state, recorded,
// then carried out on Core. Every path records `dispatched` before any Core call and `settled` after.
// Nothing is ever retried: an outcome Tremor cannot be sure of is `unknown`.

import { fingerprintOf, sameFingerprint, sameStatus, sendGuard, validateIntent, type CoreInput, type CoreStatus, type CoreTerminal, type StoreState, type TerminalKey, type TerminalState, type UserAction, type UserOutcome } from "@tremor/protocol";
import { randomBytes } from "node:crypto";
import type { Store } from "../store/store.ts";
import { CallAborted, RpcError, TransportError, type CallOptions } from "./rpc.ts";

/** What a person is asked to confirm, in main, outside the renderer. */
export interface ConfirmRequest {
  kind: "approve" | "takeover";
  terminal: TerminalKey;
  terminalName: string;
  /** The exact action, for example `Approve: approve Write: /tmp/x` (the program's words, shown verbatim). */
  action: string;
}

/** The desktop lane supplies Touch ID or a native dialog. Resolves true only when the person confirmed. */
export interface Confirmer {
  confirm(request: ConfirmRequest): Promise<boolean>;
}

/** The Core calls actions need (CoreSource has them). */
export interface CoreCalls {
  readonly coreId: string | null;
  call<T>(method: string, params: unknown, opts?: CallOptions): Promise<T>;
  /** A fresh terminal.get, recorded as a `terminal` input. */
  getTerminal(address: string, opts?: CallOptions): Promise<CoreTerminal>;
}

export interface ActionServiceOptions {
  clientId: string;
  store: Store;
  /** Applies an input to the store and appends it to the log; resolves once a `dispatched` input is on disk. */
  record: (input: CoreInput) => Promise<void>;
  core: CoreCalls;
  confirmer: Confirmer;
  /** How long a sent approval waits for the terminal to leave the request before reading `unknown`. */
  statusWaitMs?: number;
  newActionId?: () => string;
  now?: () => number;
}

const outcome = (state: UserOutcome["state"], detail: string): UserOutcome => ({ state, detail });

/** Core's error, a broken transport or an abandoned call, as an outcome. Only Core's own refusal proves nothing was typed. */
export function outcomeOf(e: unknown): UserOutcome {
  if (e instanceof RpcError) return e.kind === "cancelled" ? outcome("cancelled", "cancelled before anything was typed") : outcome("refused", `${e.kind}: ${e.message}`);
  if (e instanceof CallAborted) return e.sent ? outcome("unknown", "given up before Core answered; it may have happened") : outcome("cancelled", "cancelled before it was sent");
  if (e instanceof TransportError) return outcome("unknown", `the connection broke before Core answered: ${e.message}`);
  return outcome("unknown", `failed before Core answered: ${(e as Error).message}`);
}

export class ActionService {
  /** Approval requests already taken by an action: single use, for the life of this process. */
  private readonly reserved = new Set<string>();
  private readonly o: Required<ActionServiceOptions>;

  constructor(opts: ActionServiceOptions) {
    this.o = { statusWaitMs: 5000, newActionId: () => randomBytes(8).toString("hex"), now: Date.now, ...opts };
  }

  /** Throws IntentError for a payload that is not a valid intent (nothing is recorded); otherwise always settles. */
  async act(raw: unknown, opts: CallOptions = {}): Promise<UserOutcome> {
    const intent = validateIntent(raw);
    const action = { ...intent, actionId: this.o.newActionId() } as UserAction;
    if (action.type === "approve") return this.approve(action, opts);
    await this.dispatch(action);
    try {
      return await this.settle(action.actionId, await this.carryOut(action, opts));
    } catch (e) {
      return this.settle(action.actionId, outcomeOf(e));
    }
  }

  private async carryOut(a: Exclude<UserAction, { type: "approve" }>, opts: CallOptions): Promise<UserOutcome> {
    const check = this.terminal(a.terminal, a.type === "send" || a.type === "interrupt");
    if (typeof check === "string") return outcome("refused", check);
    const t = check;
    switch (a.type) {
      case "send": {
        if (t.status?.state === "blocked") return outcome("refused", "a blocked agent cannot be messaged: answer its request or take over");
        const guard = sendGuard(a.expectedStatus);
        if (guard === "refuse") return outcome("refused", "a blocked agent cannot be messaged");
        await this.o.core.call("terminal.send", { terminal: t.address, text: a.text, ...(guard === null ? {} : { if: guard }) }, opts);
        return outcome("done", guard === null ? "sent without a guard" : `sent if ${guard}`);
      }
      case "interrupt": {
        const r = await this.o.core.call<{ outcome: string; key: string }>("terminal.interrupt", { terminal: t.address }, opts);
        return outcome("done", `${r.key}: ${r.outcome}`);
      }
      case "markSeen": {
        if (a.turn > t.turn) return outcome("refused", `turn ${a.turn} is above Core's turn ${t.turn}`);
        const label = t.labels["herdr.seen"];
        const current = label !== undefined && /^\d{1,15}$/.test(label) ? Number(label) : null;
        if (current !== null && current >= a.turn) return outcome("refused", `herdr.seen is already ${current}: it is only raised`);
        await this.o.core.call("terminal.label", { terminal: t.address, labels: { "herdr.seen": String(a.turn) } }, opts);
        return outcome("done", `herdr.seen=${a.turn}`);
      }
      case "pin":
        await this.o.core.call("terminal.label", { terminal: t.address, labels: { "herdr.pinned": a.pinned ? "1" : "" } }, opts);
        return outcome("done", a.pinned ? "pinned" : "unpinned");
    }
  }

  /** Reserve, confirm, record, re-read, compare, press, watch. Never retried. */
  private async approve(a: Extract<UserAction, { type: "approve" }>, opts: CallOptions): Promise<UserOutcome> {
    const refuse = async (why: string) => {
      await this.dispatch(a);
      return this.settle(a.actionId, outcome("refused", why));
    };
    const entry = this.state.approvals[a.approvalId];
    if (!entry) return refuse("no such request");
    if (entry.state !== "open") return refuse("the request is no longer open");
    const option = entry.request.options.find((o) => o.label === a.option);
    if (!option) return refuse("not one of this request's options");
    // Taken by an action still being confirmed: refused here and not recorded, because a recorded approve
    // of an open request would take it in flight for this action instead of the first one.
    if (this.reserved.has(a.approvalId)) return outcome("refused", "the request was already used");
    this.reserved.add(a.approvalId);

    const req = entry.request;
    const fp = req.fingerprint;
    const name = this.state.terminals[req.terminal]?.name ?? fp.address;
    const confirmed = await this.o.confirmer.confirm({ kind: "approve", terminal: req.terminal, terminalName: name, action: `${option.label}: ${req.msg}` }).catch(() => false);
    await this.dispatch(a);
    const settle = (o: UserOutcome) => this.settle(a.actionId, o);
    if (!confirmed) return settle(outcome("refused", "the person did not confirm"));
    const now = this.state.approvals[a.approvalId];
    if (now?.state !== "in-flight" || now.actionId !== a.actionId) return settle(outcome("voided", "the request changed while it was being confirmed"));
    if (this.o.core.coreId !== fp.coreId) return settle(outcome("voided", "not connected to the core that showed this request"));

    let fresh: CoreTerminal;
    try {
      fresh = await this.o.core.getTerminal(fp.address, opts);
    } catch (e) {
      return settle(outcome("refused", `could not re-read the terminal, nothing was typed: ${(e as Error).message}`));
    }
    if (!sameFingerprint(fp, fingerprintOf(fp.coreId, fresh))) return settle(outcome("voided", "the terminal no longer shows this request; nothing was typed"));

    const left = this.watchLeaving(req.terminal, fp.status);
    try {
      await this.o.core.call("terminal.keys", { terminal: fp.address, keys: option.keys }, opts);
    } catch (e) {
      left.cancel();
      // keys has no guard and no cancellation: once sent, only Core's refusal proves nothing was typed.
      return settle(outcomeOf(e));
    }
    const moved = await left.within(this.o.statusWaitMs);
    return settle(
      moved
        ? outcome("done", `typed ${option.keys.join(" ")}; the terminal then left this request (which client answered is not proven)`)
        : outcome("unknown", `typed ${option.keys.join(" ")}; the status did not change within ${this.o.statusWaitMs / 1000} s`),
    );
  }

  /** Resolves true once the terminal's status is no longer the request's (or it stopped), else false after the wait. */
  private watchLeaving(key: TerminalKey, status: CoreStatus) {
    const moved = () => {
      const t = this.state.terminals[key];
      return !t || t.gone || t.state !== "live" || !sameStatus(t.status, status);
    };
    let unsubscribe = () => {};
    let done = (_: boolean) => {};
    const result = new Promise<boolean>((resolve) => {
      done = (v) => {
        unsubscribe();
        resolve(v);
      };
      unsubscribe = this.o.store.subscribe(() => moved() && done(true));
    });
    return {
      cancel: () => unsubscribe(),
      within: (ms: number) => {
        if (moved()) done(true);
        const timer = setTimeout(() => done(false), ms);
        return result.finally(() => clearTimeout(timer));
      },
    };
  }

  /** The terminal named by an intent, or why it cannot be acted on. */
  private terminal(key: TerminalKey, mustBeLive: boolean): TerminalState | string {
    const t = this.state.terminals[key];
    if (!t || t.gone) return "no such terminal";
    if (this.o.core.coreId === null) return "not connected to Core";
    if (t.coreId !== this.o.core.coreId) return "the terminal is not on the connected core";
    if (mustBeLive && t.state !== "live") return "the terminal has finished";
    return t;
  }

  private get state(): StoreState {
    return this.o.store.state;
  }

  private dispatch(action: UserAction): Promise<void> {
    return this.o.record({ t: this.o.now(), kind: "user", phase: "dispatched", clientId: this.o.clientId, action });
  }

  private async settle(actionId: string, o: UserOutcome): Promise<UserOutcome> {
    await this.o.record({ t: this.o.now(), kind: "user", phase: "settled", clientId: this.o.clientId, actionId, outcome: o });
    return o;
  }
}

/** After a restart: every action recorded as dispatched but never settled reads `unknown`. Record these inputs. */
export function orphanSettlements(state: StoreState, t: number): CoreInput[] {
  return Object.entries(state.actions)
    .filter(([, a]) => a.outcome === null)
    .map(([actionId, a]) => ({ t, kind: "user", phase: "settled", clientId: a.clientId, actionId, outcome: outcome("unknown", "Tremor stopped before this action settled; it may have happened") }));
}
