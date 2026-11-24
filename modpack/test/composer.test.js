// The composer guard (D14, D35): Core's `--if` with the exact status, nothing while blocked, never forced.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { composerAction, sendArgs, sendOutcome, composerHint, draftKey, Drafts, SeenGate, SEEN_RETRY_MS } from "../adapters/composer.js";

test("idle and working send guarded by that exact status", () => {
  expect(sendArgs("t7", "hi", "idle")).toEqual(["send", "t7", "hi", "--if", "idle", "--json"]);
  expect(sendArgs("t7", "hi", "working")).toEqual(["send", "t7", "hi", "--if", "working", "--json"]);
});

test("blocked sends nothing; the person answers in the terminal", () => {
  expect(composerAction("blocked").send).toBe(false);
  expect(sendArgs("t7", "yes", "blocked")).toBeNull();
});

test("done, error and no status send unguarded (Core's guard has no such word); never --force", () => {
  for (const s of ["done", "error", null]) {
    const a = sendArgs("t7", "next", s);
    expect(a).toEqual(["send", "t7", "next", "--json"]);
    expect(a).not.toContain("--force");
  }
});

test("empty text or no target sends nothing", () => {
  expect(sendArgs("t7", "   ", "idle")).toBeNull();
  expect(sendArgs(null, "hi", "idle")).toBeNull();
});

test("outcomes: sent, or not sent with Core's reason (no retry)", () => {
  expect(sendOutcome({ code: 0 })).toEqual({ sent: true });
  expect(sendOutcome({ code: 1, stderr: JSON.stringify({ error: { message: "status is blocked, not idle" } }) })).toEqual({ sent: false, reason: "status is blocked, not idle" });
  expect(sendOutcome(null).sent).toBe(false);
});

// Owner, 11 Nov 2026: nothing under the field while a message can be sent; the reason when it cannot.
test("the line under the field is empty while sendable in every state and the reason when refused", () => {
  for (const raw of ["idle", "working", "done", "error", "unknown", null]) expect(composerHint(raw)).toBe("");
  expect(composerHint("blocked")).toMatch(/answer in the terminal/);
  expect(sendArgs("t7", "hi", "error")).toEqual(["send", "t7", "hi", "--json"]); // the send policy is unchanged
});

// PM review R1, acceptance: A→B→A, a session restart and a delayed A success keep the right drafts.
test("R1: drafts stay with their session; a late success clears only its own unchanged draft", () => {
  const d = new Drafts();
  const A = draftKey("t1", "sa", 11), B = draftKey("box/t2", "sb", 22);
  expect(A).toBe("t1|s:sa");
  expect(draftKey("t1", null, 11)).toBe("t1|p:11");
  let shown = { text: "for A", attach: ["/w"] };
  shown = d.swap(A, shown, B); // A -> B: B starts empty
  expect(shown).toEqual({ text: "", attach: [] });
  shown = { text: "for B", attach: [] };
  shown = d.swap(B, shown, A); // B -> A: A's draft is back
  expect(shown).toEqual({ text: "for A", attach: ["/w"] });
  // A sends, then the person goes to B and back before the answer arrives: still A, unchanged: cleared.
  const sentA = { ...shown };
  shown = d.swap(A, shown, B);
  expect(shown.text).toBe("for B");
  expect(d.finished(A, sentA, true, null, B, shown)).toBe(false); // B's draft is not touched
  shown = d.swap(B, shown, A);
  expect(shown).toEqual({ text: "", attach: [] }); // A's kept copy was the sent one, so it went
  // A sends, then edits before the answer: the edit stays.
  shown = { text: "second", attach: [] };
  const sent2 = { ...shown };
  shown = { text: "second, edited", attach: [] };
  expect(d.finished(A, sent2, true, null, A, shown)).toBe(false);
  // A failed send keeps the text and notes why, for A only.
  expect(d.finished(A, { text: "x", attach: [] }, false, "it was busy", A, { text: "x", attach: [] })).toBe(false);
  expect(d.note(A)).toBe("it was busy");
  expect(d.note(B)).toBeNull();
  // A restarted session is another key: the old draft isn't shown in the new one.
  const A2 = draftKey("t1", "sa2", 12);
  expect(d.swap(A, { text: "old session", attach: [] }, A2)).toEqual({ text: "", attach: [] });
  // The binding arriving turns the process key into the session key: the draft carries over.
  const P = draftKey("t3", null, 33), S = draftKey("t3", "s3", 33);
  expect(d.swap(P, { text: "typed early", attach: [] }, S)).toEqual({ text: "typed early", attach: [] });
});

// Audit H3 and the shared contract (Files attach builds on it): a delayed pick lands only in the draft that asked.
test("H3: drafts.origin/attachTo: a late pick goes to its origin draft, never the one shown; gone after a restart or a clear", () => {
  const d = new Drafts();
  const A = draftKey("t1", "sa", 11), B = draftKey("t2", "sb", 22);
  let shown = d.swap(null, { text: "", attach: [] }, A);
  const fromA = d.origin(A); // "+" opened while A shows
  shown = d.swap(A, shown, B); // the person moves to B before the picker answers (the audit's repro)
  expect(d.attachTo(fromA, ["/fake/A-folder"])).toBe(true);
  expect(d.shown).toEqual({ key: B, attach: [] }); // B is untouched
  expect(shown.attach).toEqual([]);
  shown = d.swap(B, shown, A);
  expect(shown.attach).toEqual(["/fake/A-folder"]); // A has it on return
  // Shown origin: the chips appear in the shown draft at once, each path once.
  expect(d.attachTo(d.origin(A), ["/x", "/x", "/fake/A-folder"])).toBe(true);
  expect(d.shown.attach).toEqual(["/fake/A-folder", "/x"]);
  expect(d.shown.attach).toBe(shown.attach); // the chat's chips are the drafts' own
  // A restart on the same terminal retires A: a pick opened before it is discarded.
  const stale = d.origin(A);
  const A2 = draftKey("t1", "sa2", 12);
  shown = d.swap(A, shown, A2);
  expect(d.attachTo(stale, ["/late"])).toBe(false);
  expect(d.kept.has(A)).toBe(false);
  expect(shown.attach).toEqual([]);
  // A send that clears the draft retires its generation too.
  const before = d.origin(A2);
  shown = { text: "go", attach: d.shown.attach };
  expect(d.finished(A2, { text: "go", attach: [] }, true, null, A2, shown)).toBe(true);
  expect(d.attachTo(before, ["/after-send"])).toBe(false);
  expect(d.attachTo(d.origin(A2), ["/new"])).toBe(true);
  // The process key turning into the session key keeps the token valid.
  const P = draftKey("t3", null, 33), S = draftKey("t3", "s3", 33);
  shown = d.swap(A2, shown, P);
  const early = d.origin(P);
  shown = d.swap(P, shown, S);
  expect(d.attachTo(early, ["/early"])).toBe(true); // asked before the binding: lands in the session's draft
  expect(d.shown).toEqual({ key: S, attach: ["/early"] });
  expect(d.kept.has(P)).toBe(false);
  shown = d.swap(S, shown, draftKey("t3", "s4", 34)); // that session restarts: the early token is void too
  expect(d.attachTo(early, ["/later"])).toBe(false);
  expect(d.attachTo(null, ["/x"])).toBe(false);
});

// PM review R2: only the shown, caught-up, bound chat marks a turn seen; a failed write retries; leaving resets.
test("R2/H4: a turn is marked seen only when its own answer was read and drawn in this visit; failures retry", () => {
  const g = new SeenGate();
  g.observe([{ address: "t1", turn: 2, status_ms: -3000 }]); // Core said turn 3 began working 4 s before it ended
  // Turn 3 ended at 1000 (Core's status_ms); its last record was written at 990.
  const drawn = (o = {}) => ({ at: 1500, answerAt: 990, readAt: 1200, ...o });
  const f = (o = {}) => ({ address: "t1", session: "s1", turn: 3, seen: 2, shown: true, foreground: true, endedAt: 1000, drawn: drawn(), now: 1000, ...o });
  expect(g.decide(f({ drawn: drawn({ at: 900 }), now: 1000 }))).toBeNull(); // the visit starts: a render before it doesn't count
  expect(g.decide(f({ shown: false, now: 2000 }))).toBeNull();
  expect(g.decide(f({ foreground: false, now: 2000 }))).toBeNull();
  expect(g.decide(f({ session: null, now: 2000 }))).toBeNull(); // no transcript bound
  expect(g.decide(f({ drawn: null, now: 2000 }))).toBeNull(); // nothing drawn
  expect(g.decide(f({ endedAt: null, now: 2000 }))).toBeNull(); // when the turn ended is unknown
  expect(g.decide(f({ drawn: drawn({ readAt: 999 }), now: 2000 }))).toBeNull(); // read before the turn ended
  expect(g.decide(f({ now: 2000 }))).toEqual({ turn: 3, visit: g.visits });
  expect(g.decide(f({ now: 2100 }))).toBeNull(); // one write at a time
  const t1 = { turn: 3, visit: g.visits };
  g.result(t1, false, 2200); // the label write failed: not latched
  expect(g.decide(f({ now: 2300 }))).toBeNull(); // waits before retrying
  const t2 = g.decide(f({ now: 2200 + SEEN_RETRY_MS + 1 }));
  expect(t2).toEqual({ turn: 3, visit: g.visits });
  g.result(t2, true, 9000);
  expect(g.decide(f({ now: 9100 }))).toBeNull(); // written for this visit
  // Another client marks it unread; leaving and coming back needs a render in the new visit.
  g.leave();
  expect(g.decide(f({ now: 9500 }))).toBeNull();
  expect(g.decide(f({ drawn: drawn({ at: 9600 }), now: 9700 }))).toEqual({ turn: 3, visit: g.visits });
});

// Audit H4's counterexamples: uncertain unread stays unread, and a late write from one visit changes no other.
test("H4: an old answer or an unchanged end of file never clears a new turn; a stale visit's result is ignored", () => {
  const g = new SeenGate();
  g.observe([{ address: "t1", turn: 7, status_ms: 190000 }, { address: "t2", turn: 7, status_ms: 190000 }]); // turn 8 began
  const f = (o = {}) => ({ address: "t1", session: "s1", turn: 8, seen: 7, shown: true, foreground: true, endedAt: 200000, now: 210000, ...o });
  g.decide(f({ drawn: null, now: 1 })); // the visit began
  // One old row from an earlier turn, re-read to an unchanged end of file after turn 8 ended: still unread.
  expect(g.decide(f({ drawn: { at: 209000, answerAt: 1000, readAt: 208000 } }))).toBeNull();
  // A record written after Core saw the turn end belongs to a later one: not this turn's answer either.
  expect(g.decide(f({ drawn: { at: 209000, answerAt: 203000, readAt: 208000 } }))).toBeNull();
  expect(g.decide(f({ drawn: { at: 209000, answerAt: 199000, readAt: 208000 } }))).toEqual({ turn: 8, visit: g.visits });
  // A's write is still out when the person moves to B: A's late success must not latch B.
  const fromA = { turn: 8, visit: g.visits };
  const b = (o = {}) => f({ address: "t2", session: "s2", drawn: { at: 210400, answerAt: 199000, readAt: 208000 }, now: 210500, ...o });
  expect(g.decide(b())).toBeNull(); // B's visit starts at 210500; the last render predates it
  g.result(fromA, true, 210600);
  expect(g.written).toBeNull();
  expect(g.decide(b({ drawn: { at: 211000, answerAt: 199000, readAt: 208000 }, now: 211500 }))).toEqual({ turn: 8, visit: g.visits }); // B writes its own
});

// The recheck's repro (review-audit-1109-recheck H4): a short gap between turns, and the answer never changed.
test("H4: a new turn needs a record written after the previous turn; an unchanged answer or an unseen start keeps it unread", () => {
  const g = new SeenGate();
  const f = (o = {}) => ({ address: "t1", session: "s1", shown: true, foreground: true, ...o });
  g.observe([{ address: "t1", turn: 6, status_ms: 190000 }]); // turn 7 began working at 190000
  g.decide(f({ turn: 7, seen: 6, endedAt: 200000, drawn: null, now: 100 })); // the visit began
  const t7 = g.decide(f({ turn: 7, seen: 6, endedAt: 200000, drawn: { at: 200400, answerAt: 199000, readAt: 200300 }, now: 200500 }));
  expect(t7).toEqual({ turn: 7, visit: g.visits });
  g.result(t7, true, 200600); // acknowledged
  // Turn 8 ends a second later; the newest agent record is still turn 7's.
  const t8 = (drawn) => f({ turn: 8, seen: 7, endedAt: 201000, drawn, now: 202000 });
  expect(g.decide(t8({ at: 201900, answerAt: 199000, readAt: 201800 }))).toBeNull();
  expect(g.decide(t8({ at: 201900, answerAt: 200900, readAt: 201800 }))).toBeNull(); // too close to turn 7's end to tell
  // Turn 9 began at 205000 and wrote its own answer: marked.
  g.observe([{ address: "t1", turn: 8, status_ms: 205000 }]);
  expect(g.decide(f({ turn: 9, seen: 7, endedAt: 230000, drawn: { at: 231000, answerAt: 229000, readAt: 230500 }, now: 231500 }))).toEqual({ turn: 9, visit: g.visits });
  // A chat opened on a turn whose predecessor the gate never saw: it can't tell, so the turn stays unread.
  const h = new SeenGate();
  expect(h.decide(f({ address: "t9", turn: 4, seen: 3, endedAt: 50000, drawn: { at: 0, answerAt: 49000, readAt: 50500 }, now: 0 }))).toBeNull();
  expect(h.decide(f({ address: "t9", turn: 4, seen: 3, endedAt: 50000, drawn: { at: 51000, answerAt: 49000, readAt: 50500 }, now: 51500 }))).toBeNull();
  // Turns skipped between observations: turn 3's time says nothing about turn 5's start.
  h.observe([{ address: "t8", turn: 3, status_ms: 1000 }, { address: "t8", turn: 5, status_ms: 9000 }]);
  expect(h.floor("t8", 5)).toBeNull();
  expect(h.floor("t8", 6)).toBe(9000);
});

test("H4: the render receipt is taken only while the newest rows are in view, and turn-end records are no answer", () => {
  const chat = readFileSync(new URL("../mods/pdk-chat/main.js", import.meta.url), "utf8");
  expect(chat).toMatch(/this\.drawn = this\.shown\(\) && rows\.length && following && !s\.showEarlier\n/); // only while it follows its end
  expect(chat).toMatch(/if \(\["assistant", "tool", "thinking"\]\.includes\(e\.type\)\) return e\.at/);
  expect(chat).toMatch(/async tick\(cx\) \{\n\s+this\.seen\.observe\(terminals\(\)\);/);
});

import { pendingSend, stillPending, PENDING_MS } from "../adapters/composer.js";
test("a sent message shows as pending until the transcript records it, or 15 s pass", () => {
  const u = (text) => ({ type: "user", text });
  const before = [u("yes"), { type: "assistant", text: "yes" }];
  const p = pendingSend("  yes ", before, 1000);
  expect(p.text).toBe("yes");
  expect(stillPending(p, before, 2000)).toBe(true); // the earlier "yes" is not this one
  expect(stillPending(p, [...before, u("no")], 2000)).toBe(true);
  expect(stillPending(p, [...before, u("yes")], 2000)).toBe(false); // recorded
  expect(stillPending(p, before, 1000 + PENDING_MS)).toBe(false); // given up
  // A "/" command is recorded by its name.
  const c = pendingSend("/model haiku", [], 0);
  expect(stillPending(c, [u("/model")], 10)).toBe(false);
  expect(stillPending(c, [u("/models")], 10)).toBe(true);
});
