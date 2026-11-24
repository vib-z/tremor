// Views over one store: the session tree, an agent's chat, relay edges, the factory floor, open approvals.
// Pure and browser-safe. Display text is for display only; everything structured stays on `event`.

import type { ActivityEvent, ApprovalEntry, Attention, ChatItem, FactoryGraph, RelayEdge, Selectors, SessionNode, StoreState, TerminalKey, TerminalState } from "@tremor/protocol";

const TICKER = 50;
const EVIDENCE = 20;

/**
 * herdr-app's rules (docs/labels.md at 2405bf3): blocked or error needs you; working is working; otherwise
 * done when `turn > herdr.seen`, else idle. Without the label (a missing label is not 0), Tremor's own record
 * decides: the highest turn it marked seen; failing that, done only if it saw a turn end here.
 */
export function attention(state: StoreState, t: TerminalState, turnsSeen: Set<TerminalKey | null> = turnEnds(state)): Attention {
  if (t.gone || t.state === "finished") return "finished";
  const word = t.status?.state;
  if (word === "blocked" || word === "error") return "needs-you";
  if (word === "working") return "working";
  const seen = seenTurn(state, t);
  if (seen !== null) return t.turn > seen ? "done" : "idle";
  return turnsSeen.has(t.key) ? "done" : "idle";
}

/** Terminals Tremor saw end a turn: computed once per view, not once per terminal. */
const turnEnds = (state: StoreState) => new Set(state.activity.filter((e) => e.type === "turn").map((e) => e.terminal));

/** `herdr.seen` when it is a number, else the highest turn Tremor itself marked seen, else null. */
export function seenTurn(state: StoreState, t: TerminalState): number | null {
  const label = t.labels["herdr.seen"];
  if (label !== undefined && /^\d{1,15}$/.test(label)) return Number(label);
  let own: number | null = null;
  for (const a of Object.values(state.actions))
    if (a.action.type === "markSeen" && a.action.terminal === t.key && a.outcome?.state === "done") own = Math.max(own ?? 0, a.action.turn);
  return own;
}

const pinned = (t: TerminalState) => (t.labels["herdr.pinned"] ?? "") !== "";
const order = (a: TerminalState, b: TerminalState) => Number(pinned(b)) - Number(pinned(a)) || a.created_ms - b.created_ms || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

export function sessionTree(state: StoreState): SessionNode[] {
  const children = new Map<TerminalKey | null, TerminalState[]>();
  for (const t of Object.values(state.terminals)) {
    const parent = t.parentKey !== null && state.terminals[t.parentKey] ? t.parentKey : null;
    children.set(parent, [...(children.get(parent) ?? []), t]);
  }
  const visited = new Set<TerminalKey>();
  const turns = turnEnds(state);
  const node = (t: TerminalState): SessionNode => {
    visited.add(t.key);
    const workers = (children.get(t.key) ?? []).filter((c) => !visited.has(c.key)).sort(order).map(node);
    return { terminal: t.key, name: t.name ?? t.address, title: t.title, attention: attention(state, t, turns), pinned: pinned(t), workers, mock: t.mock };
  };
  return (children.get(null) ?? []).sort(order).map(node);
}

function involves(e: ActivityEvent, k: TerminalKey): boolean {
  if (e.terminal === k) return true;
  if (e.type === "message") return (e.from.kind === "terminal" || e.from.kind === "claimed") && e.from.terminal === k;
  if (e.type === "observation") return e.subject === k || e.about === k;
  return false;
}

/** One chat row for an activity, as seen from `viewer` (whose chat it is). Turn counters are not rows. */
export function chatItem(e: ActivityEvent, viewer: TerminalKey | null): ChatItem | null {
  const base = { key: e.key, at: e.at, trust: e.trust, event: e, mock: e.mock === true };
  switch (e.type) {
    case "turn":
      return null;
    case "transcript":
      return { ...base, kind: "transcript", text: e.entry.text, ...(e.entry.toolUseId === undefined ? {} : { toolUseId: e.entry.toolUseId }) };
    case "message": {
      const incoming = e.from.kind !== "person" && e.to.kind === "terminal" && e.to.terminal === viewer;
      return { ...base, kind: incoming ? "message-in" : "message-out", text: e.text, sender: e.via === "composer" ? "proven" : "claimed" };
    }
    case "status": {
      const s = e.status;
      const what = e.gone ? "gone" : `${s?.state ?? "cleared"}${typeof s?.progress === "number" ? ` ${s.progress}%` : ""}${s?.title ? ` · ${s.title}` : ""}${s?.msg ? `: ${s.msg}` : ""}`;
      return { ...base, kind: "bubble", text: e.record === null ? what : `${e.record}: ${what}` };
    }
    case "lifecycle": {
      const how = [e.reason, e.exitCode === null ? null : `exit ${e.exitCode}`, e.signal === null ? null : `signal ${e.signal}`].filter((x) => x !== null).join(", ");
      return { ...base, kind: "observation", text: how ? `${e.phase} (${how})` : e.phase };
    }
    case "observation":
      return { ...base, kind: "observation", text: e.text };
    case "approval.request":
      return { ...base, kind: "approval", text: e.request.msg };
    case "approval.resolved":
      return { ...base, kind: "approval", text: `${e.outcome}: ${e.detail}` };
    case "action":
      return { ...base, kind: "action", text: e.action.type };
    case "action.settled":
      return { ...base, kind: "action", text: `${e.outcome.state}: ${e.outcome.detail}` };
  }
}

export function chat(state: StoreState, terminal: TerminalKey): ChatItem[] {
  const out: ChatItem[] = [];
  for (const e of state.activity)
    if (involves(e, terminal)) {
      const item = chatItem(e, terminal);
      if (item) out.push(item);
    }
  return out;
}

/** Proven messages, claimed messages and observations, each its own edge kind; never merged. */
export function relayEdges(state: StoreState, sinceMs: number): RelayEdge[] {
  const edges = new Map<string, RelayEdge>();
  const add = (from: RelayEdge["from"], to: RelayEdge["to"], kind: RelayEdge["kind"], e: ActivityEvent) => {
    const id = `${kind}|${from}|${to}`;
    const edge = edges.get(id) ?? { from, to, kind, count: 0, lastAt: 0, evidence: [] };
    edges.set(id, { ...edge, count: edge.count + 1, lastAt: Math.max(edge.lastAt, e.at), evidence: [e.key, ...edge.evidence].slice(0, EVIDENCE) });
  };
  for (const e of state.activity) {
    if (e.at < sinceMs) continue;
    if (e.type === "message" && e.to.kind === "terminal") {
      if (e.via === "composer" && e.from.kind === "person") add("person", e.to.terminal, "message", e);
      else if (e.from.kind === "claimed" && e.from.terminal !== null) add(e.from.terminal, e.to.terminal, "claimed-message", e);
    } else if (e.type === "observation" && e.kind !== "gap" && e.about !== null && e.about !== e.subject) {
      // `about` is who it concerns, `subject` who it was for; no recorded recipient ends at the rail.
      add(e.about, e.subject ?? "observation-rail", "observation", e);
    }
  }
  return [...edges.values()].sort((a, b) => b.lastAt - a.lastAt || (`${a.kind}${a.from}${a.to}` < `${b.kind}${b.from}${b.to}` ? -1 : 1));
}

export function factory(state: StoreState, sinceMs: number): FactoryGraph {
  const turns = turnEnds(state);
  const nodes = Object.values(state.terminals)
    .sort(order)
    .map((t) => ({ terminal: t.key, lead: t.parentKey !== null && state.terminals[t.parentKey] ? t.parentKey : null, attention: attention(state, t, turns), label: t.name ?? t.address, mock: t.mock }));
  const edges = relayEdges(state, sinceMs);
  const ticker: ChatItem[] = [];
  for (let i = state.activity.length - 1; i >= 0 && ticker.length < TICKER; i--) {
    const e = state.activity[i] as ActivityEvent;
    const item = e.at >= sinceMs ? chatItem(e, e.terminal) : null;
    if (item) ticker.push(item);
  }
  return { nodes, rail: edges.some((e) => e.to === "observation-rail"), edges, ticker };
}

/** Requests a person can still act on or is acting on (in flight), oldest first. */
export function openApprovals(state: StoreState): ApprovalEntry[] {
  return Object.values(state.approvals)
    .filter((a) => a.state === "open" || a.state === "in-flight")
    .sort((a, b) => a.createdAt - b.createdAt || (a.request.id < b.request.id ? -1 : 1));
}

export const selectors: Selectors = { sessionTree, chat, relayEdges, factory, openApprovals };
