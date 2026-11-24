// A live store: one state, inputs applied in place, listeners told the events. Main owns one; the
// renderer can use it too or replay events with `reduce`. Browser-safe.

import type { CoreInput, TremorEvent, StoreState } from "@tremor/protocol";
import { apply, applyInputs, initial, own } from "./engine.ts";

export type StoreListener = (update: { kind: "events"; events: TremorEvent[] } | { kind: "snapshot"; state: StoreState }) => void;

export class Store {
  private s: StoreState;
  private readonly listeners = new Set<StoreListener>();

  constructor(state: StoreState = initial()) {
    this.s = own(state);
  }

  /** The live state: read it, never edit it. */
  get state(): StoreState {
    return this.s;
  }

  apply(input: CoreInput): TremorEvent[] {
    const events = applyInputs(this.s, [input]);
    if (events.length > 0) this.tell({ kind: "events", events });
    return events;
  }

  /** An event that has no input (persistence's `history.gap`). */
  applyEvent(event: TremorEvent): void {
    apply(this.s, event);
    this.tell({ kind: "events", events: [event] });
  }

  /** Swaps the whole state (after retention pruned it); listeners get a snapshot. */
  replace(state: StoreState): void {
    this.s = own(state);
    this.tell({ kind: "snapshot", state: this.s });
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private tell(update: Parameters<StoreListener>[0]): void {
    for (const l of this.listeners) l(update);
  }
}
