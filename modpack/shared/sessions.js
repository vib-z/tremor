// Gathers the evidence binding.js decides on, for one terminal: only session-identifying metadata (D32, F5).
// Claude's sessions/<pid>.json, Codex's held files and the first line of each held rollout (the helper's `first`:
// one line, at most 64 KiB, nothing after it), Grok's registry, Hermes's record for the process's terminal device,
// launch arguments and labels. Never a transcript body, never a folder listing.
//
// Only terminals on this Mac (F4). A remote terminal's pid names a process on its own machine, so a file or a
// process here that matches it belongs to something else: it is refused before anything here is read.

import { readTextFile, home } from "herdr";
import { helper } from "./helper.js";
import { agentKind, kindName } from "./agents.js";
import * as B from "./binding.js";
import { metaFromLines, META_SOURCE as SOURCE } from "./meta.js";

// Moved to adapters/meta.js (pure, for the chat feed too); still exported here.
export { metaFromLines, claudeWindow } from "./meta.js";

const read = (path) => readTextFile(path).catch(() => null);
// The process's start as `ps` has it, or null when it is gone (liveness and identity in one answer).
const startOf = (pid) => helper("start", [pid]).then((r) => r?.start ?? null, () => null);
// Core addresses this core's own terminals `t7`; terminals of a machine it added are `rohan/t7`
// (herdr-core schema/README.md:142-146). Local ids run past t19 with letters (t1b, t1g), so a local id is "t" plus
// letters and digits with no machine prefix; anything with a "/" is another machine's.
const LOCAL = /^t[0-9a-z]+$/;

export async function resolveSession(t) {
  const kind = agentKind(t);
  const pid = t?.foreground?.pid ?? null;
  const argv = t?.foreground?.argv ?? [];
  const tag = (b, extra = {}) => ({ ...b, kind, pid, ...extra });
  if (!LOCAL.test(String(t?.address ?? ""))) return tag({ ok: false, reason: "it runs on another machine: chat binds only terminals on this Mac" });
  if (!kind) return { ok: false, kind: null, reason: "not a known agent" };
  if (!pid) return tag({ ok: false, reason: "no foreground process" });
  const h = home();
  if (kind === "claude") {
    const [registryText, start] = await Promise.all([read(`${h}/.claude/sessions/${pid}.json`), startOf(pid)]);
    return tag(B.bindClaude({ home: h, pid, start, registryText }), { start });
  }
  if (kind === "codex") {
    // The same process before and after its files are read: a pid reused meanwhile would hold another's files.
    const start = await startOf(pid);
    const held = await helper("held", [pid]).catch(() => null);
    const heads = {};
    const rollouts = (held?.files ?? []).filter((f) => B.rolloutName(f) && !f.endsWith(".zst")).slice(0, 9);
    if (rollouts.length <= 8) {
      for (const path of rollouts) {
        const r = await helper("first", [path]).catch(() => null);
        heads[path] = typeof r?.line === "string" ? r.line : null;
      }
    }
    const after = await startOf(pid);
    if (!start || after !== start) return tag({ ok: false, reason: "the Codex process changed while its files were read" }, { start: null });
    return tag(B.bindCodex({ home: h, argv, held: held?.files ?? null, heads }), { start });
  }
  if (kind === "grok") {
    const [registryText, start] = await Promise.all([read(`${h}/.grok/active_sessions.json`), startOf(pid)]);
    return tag(B.bindGrok({ home: h, pid, startEpochMs: B.lstartMs(start), registryText }), { start });
  }
  if (kind === "hermes") {
    const [start, tty] = await Promise.all([startOf(pid), helper("tty", [pid]).then((r) => ({ tty: r?.tty ?? null }), (e) => ({ error: e?.message ?? String(e) }))]);
    if (tty.error) return tag({ ok: false, reason: `can't read this Hermes's terminal device (${tty.error})` }, { start });
    const breadcrumbText = tty.tty ? await read(B.breadcrumbPath(h, tty.tty)) : null;
    const cwd = t.foreground.cwd ?? t.cwd ?? null;
    return tag(B.bindHermesBreadcrumb({ pid, tty: tty.tty, startEpochMs: B.lstartMs(start), cwd, breadcrumbText }), { start });
  }
  if (kind === "opencode") return tag(B.bindOpenCode({ argv }));
  if (kind === "pi" || kind === "omp") {
    const start = await startOf(pid);
    return tag(B.bindPi({ home: h, pid, start, labels: t.labels }), { start });
  }
  if (kind === "kimi") return tag(B.bindKimi());
  if (kind === "gemini") return tag(B.bindGemini());
  return tag({ ok: false, reason: `${kindName(kind)}: no structured session source` });
}

// ---- The tree's agents view (request 9a): the model and how much of its context window is used ----------------
// From the transcript the chat binds for the terminal (resolveSession above), its last META_TAIL bytes only, read
// through the helper's `read` as the chat reads. One answer per terminal is kept for META_MS and a read already
// under way is shared, so calling this from a view's task every few seconds costs one read per terminal at most.
// It is async and never awaited by a render: a view keeps the last answer in its own state.
// {model, effort, contextPct, source}; null: nothing bound (another machine, not Claude or Codex, no session yet,
// the read failed).
// A field is null when the transcript doesn't say it; nothing is guessed.
export const META_TAIL = 512 * 1024;
export const META_MS = 10000;
const META_KEEP = 64; // terminals remembered; the oldest goes first

const metaCache = new Map(); // address -> {key, at, value, session, pending, waiters}
const sessionOf = (b) => (b?.ok ? b.session ?? b.path ?? null : null);
const DROP = Symbol("dropped");

// The model, effort and context use for one terminal, for a view that asks (audit H5): `token.live()` says the
// asking view is still shown for this target and session, and is checked before the bind, before the transcript
// read starts and after it; a read in flight goes on only while some asker is live, and a dropped one is not kept.
// `token.session` (the asker's bound session, if it has one) keeps a cached answer from another session from being
// used; without it the session is resolved again before a cached answer is reused. A read in flight is for one
// expected session (audit H5): an asker expecting another never joins it, and when the terminal turns out to be in
// another session than expected, nothing is read or kept. No token: nothing is read.
export async function agentMeta(terminal, token) {
  const live = typeof token?.live === "function" ? token.live : null;
  const address = terminal?.address;
  const kind = agentKind(terminal);
  if (!live || !address || !SOURCE[kind] || !LOCAL.test(String(address)) || !live()) return null;
  const key = `${kind}|${terminal.foreground?.pid ?? ""}`;
  const had = metaCache.get(address);
  const expect = token.session; // undefined: whichever session the terminal is in now
  if (had?.key === key) {
    if (had.pending && had.expect === expect) { had.waiters.push(live); const v = await had.pending; return live() ? v : null; }
    if (!had.pending && Date.now() - had.at < META_MS) {
      const session = token.session !== undefined ? token.session : sessionOf(await resolveSession(terminal).catch(() => null));
      if (!live()) return null;
      if (session === had.session) return had.value;
    }
  }
  const entry = { key, expect, at: 0, value: null, session: null, pending: null, waiters: [live] };
  metaCache.delete(address);
  metaCache.set(address, entry);
  if (metaCache.size > META_KEEP) metaCache.delete(metaCache.keys().next().value);
  const anyLive = () => entry.waiters.some((w) => w());
  entry.pending = (async () => {
    const b = await resolveSession(terminal).catch(() => null);
    if (!anyLive()) return DROP;
    if (expect !== undefined && sessionOf(b) !== expect) return DROP; // not the session its askers show
    if (!b?.ok || !b.path) return { value: null, session: sessionOf(b) };
    const r = await helper("read", [b.path, -META_TAIL, META_TAIL, 1, 4096]).catch(() => null);
    if (!anyLive()) return DROP;
    if (!r || r.error || r.missing) return { value: null, session: sessionOf(b) };
    return { value: { ...metaFromLines(kind, r.lines ?? []), source: SOURCE[kind] }, session: sessionOf(b) };
  })().then((res) => {
    if (res === DROP) { if (metaCache.get(address) === entry) metaCache.delete(address); return null; }
    Object.assign(entry, { value: res.value, session: res.session, at: Date.now(), pending: null, waiters: [] });
    return res.value;
  });
  const v = await entry.pending;
  return live() ? v : null;
}
