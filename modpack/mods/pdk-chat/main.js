// The chat for one agent: its own transcript as a T3-style timeline (messages, grouped tool work, claimed
// senders marked), what Core observes now (working, a blocked request shown verbatim), and a composer that
// sends through Core's guard. Shown in place of the tab by the Chat / Terminal toggle.
//
// Claude and Codex are read through one Feed per agent (lib/feed.js, owner 11 Nov 2026: per tab and per agent, on
// this Mac and on other machines); the other kinds keep the reader below (tick). The session is bound only from
// evidence (lib/binding.js); without it the pane says why and offers the terminal. Nothing is read while this view
// is hidden, and a late answer never lands on another agent or session (plan M5). Layout and sizes follow T3 Code's
// MessagesTimeline, TimelineUserMessageRow, TimelineWorkGroupRows and ComposerSurface (pingdotgg/t3code@3da48c1,
// MIT); see NOTICE.md.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea, TextView, v_virtual_list, Scrollbar, VirtualListScrollHandle } from "gpui-base";
import { terminals, machines, panes, agents, focused, theme, run, hc, shared, setShared, layout, nextCommand, window, openOverlay, settings } from "herdr";
import { TYPE, RADIUS, iconFor, ICON, ROW, SPACE, withFont, monoFont, kindMarker, statusMarker, foldMarker, spinner, workingText, NARROW, findNode, folderLabel, folderName, paneLabel, textButton, badge, focusRing, slashList,
  segmentedChoice, actionButton, fieldFrame, fitLabel, overlayFrame, clock, rowStates } from "./lib/ui.js";
import { SLASH_KINDS, NO_MENU, SAFETY_WORDS, commandsFor, sourceLine, slashQuery, openMenu, setQuery, menuKey, chatPick, startsSession, visibleRows } from "./lib/slash-commands.js";
import { displayWord, machineLabel } from "./lib/status.js";
import { AGENT_VIEWS, TABS_KEY, rememberChat, forgetTab } from "./lib/views.js";
import { agentKind, kindName } from "./lib/agents.js";
import { Thread, SUPPORT, parseLines, feed, MAPPERS, withFolders, fences } from "./lib/chat.js";
import { Cursor, RowCursor, ViewGate } from "./lib/reader.js";
import { sendArgs, sendOutcome, composerAction, composerHint, draftKey, Drafts, SeenGate, filesResult, pendingSend, stillPending } from "./lib/composer.js";
import { resolveSession } from "./lib/sessions.js";
import { Feed, feedSupports } from "./lib/feed.js";
import { chatCall } from "./lib/chat-call.js";
import { ToolEditors, toolRow, thinkingRow, snippet, drawnSnippets, groupFolded } from "./tools.js";
import { stopCheck, interruptWords, pendingTool, VIEW_ONLY, ANSWER_GAP, NO_DETAILS, agentActions, endWords } from "./lib/interactions.js";
import { currentChoice, chipLabel, openSwitcher, pickModel, switcherKey, switchAllowed, switchSteps, switchBinding, switchStillFor, runSwitch, switchVerdict, withBaseline, CLAUDE_VERSION, CLAUDE_REREAD } from "./lib/models.js";
import { helper } from "./lib/helper.js";
import { blockSize } from "./lib/factory.js";
import { MediaStore, mediaStrip, mediaRecords, mediaClass } from "./media.js";
import { MAX_REFS } from "./lib/media.js";
import { tailStart, listSizes, END_GAP, rangeAtEnd, followAfter } from "./lib/tail.js";
import { appearance } from "./lib/appear.js";
import { statePage, stateBlock } from "./states.js";

const COLUMN = 760;
const HEAD = 52; // the header's height (header)
const REBIND_MS = 5000; // the reader's re-bind (kinds without a Feed)
const KEEP = 8; // agents whose chat is kept while another is shown
// L1: the timeline's region and the composer are siblings in one column (GPUI Kit's message scroller), so the newest
// row always ends above the composer, 20 px over it, at any composer height and zoom. A plain scroll area's
// scroll_to_item landed exact only from offset 0 (measured), so the thread is the first item of a virtual list whose
// handle has scroll_to_bottom; the 20 px end gap is its second item and a 0 px end mark its third, the one that request
// reveals. Whether the mark is drawn says whether the newest row is in view, and so whether to follow (render, placed).

// The machine a terminal runs on: `rohan/t7` is rohan's, a local `t7` is this Mac's (null).
const machineOf = (address) => (String(address ?? "").includes("/") ? String(address).split("/")[0] : null);

const rawStatus = (t) => (typeof t?.status === "string" ? t.status : t?.status?.state ?? null);
// Effort levels in words (sentence case, as the agents' own pickers say them).
const EFFORT_WORDS = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max", ultra: "Ultra", minimal: "Minimal", none: "None" };
const effortWord = (e) => EFFORT_WORDS[e] ?? e;
// Codex's model list, asked of its app-server only when a switcher for Codex opens; kept for the app's run.
let codexModels = null;

// When the newest record from the agent itself (an answer, a tool step, a thought) was written. Not a turn's end
// record: one can land just after Core saw that turn end, and would pass for the next turn's (audit H4).
const answerAt = (thread) => {
  for (let i = thread.entries.length - 1; i >= 0; i--) {
    const e = thread.entries[i];
    if (["assistant", "tool", "thinking"].includes(e.type)) return e.at ?? null;
  }
  return null;
};

// A hook event the transcript records, as a quiet timestamped row: when, which event, which hook, how it ended.
const hookRow = (t, r) => h_flex().id(`hook-${r.key}`).w_full().h(ROW.compact).px(SPACE[1]).gap(SPACE[2]).items_center().text_size(TYPE.xs).text_color(t.dim)
  .role("note").accessibility_label(`Hook ${r.event} ${r.name}: ${r.outcome}`)
  .child(div().flex_none().font_family(monoFont()).child(r.at ? clock(r.at) : "--:--"))
  .child(div().flex_none().text_color(t.muted).child(`hook · ${r.event}`))
  .child(fitLabel(`hook-n-${r.key}`, r.name).flex_1().font_family(monoFont()))
  .child(div().flex_none().text_color(r.outcome === "blocked" || r.outcome === "error" ? t.foreground : t.dim).child(r.outcome));

// A row's anchor across a full tail's swap: its own key, or for a work group (keyed by its first call) its last call's.
const anchorOf = (r) => (r?.items ? r.items.at(-1)?.key : r?.key) ?? null;
const holds = (r, key) => Boolean(r) && (r.key === key || Boolean(r.items?.some((i) => i.key === key)));

// One read of a kind without a Feed, from the start (tick fills it).
const freshRead = () => ({ state: "finding", reason: null, binding: null, boundAt: 0, thread: new Thread(), mapState: {}, cursor: new Cursor(),
  rows: new RowCursor(), cut: false, skipped: 0, caughtUpAt: 0 });
const startOver = (src) => Object.assign(src, freshRead(), { gen: src.gen + 1 });

// What the chat keeps for one agent: where its conversation comes from and what a person opened in it. `src` is a
// Feed for Claude and Codex, else the reader's state; both are read the same way (state, reason, binding, thread,
// cut, skipped, meta, caughtUpAt, gen). A remote agent's files aren't on this Mac, so it gets no media reader.
function agentChat(address, kind) {
  const on = machineOf(address);
  const src = feedSupports(kind) ? new Feed({ address, kind, on, call: chatCall, records: on ? undefined : mediaRecords })
    : { legacy: true, gen: 1, meta: null, ...freshRead() };
  return { address, kind, src, gen: src.gen, open: new Set(), unfolded: new Set(), collapsed: new Set(), mediaClass: new Map(),
    showEarlier: false, stopped: null, applied: null, pending: [] };
}

// The timeline's rows, drawn in this view's own render so their handlers are allowed (a virtual list's item renderer
// takes none); the chat hands it the drawing function (Chat.timelineColumn).
class TimelineView extends View {
  init(p) { this.draw = p.draw; }
  update(p) { this.draw = p.draw; }
  render(cx) { return this.draw(cx); }
}

export default class Chat extends View {
  init(_props, cx) {
    this.target = null;
    this.agents = new Map(); // address -> agentChat
    this.editors = new ToolEditors(); // the open calls' read-only snippets, of the session shown only (tools.js)
    // The timeline: a retained child view (TimelineView) drawing the rows, as the one item of a virtual list whose handle
    // has scroll_to_bottom (render, L1). Made here, where cx.new is allowed, so the first render already has it.
    this.tlScroll = VirtualListScrollHandle.new();
    this.tlRev = 0;
    this.tlDraw = (cx) => this.timelineColumn(cx);
    this.tl = cx.new(TimelineView, { draw: this.tlDraw, rev: 0 });
    this.heads = new Map(); // the opened calls' header focus handles, by session and row
    this.chosen = null;
    this.lastFocus = undefined;
    this.lastPickAt = null;
    this.lastPick = null;
    this.width = 900;
    this.height = 700;
    this.agentMenu = null; // the header's agent menu while open: {address, pid, name, i, confirm, note} (parity G6)
    this.menuFocus = cx.focus_handle();
    this.drafts = new Drafts(); // what is typed, per agent session (PM review R1)
    this.draftKey = null;
    this.fileRequests = new Map(); this.fileSequence = 0;
    this.sendingKeys = new Set();
    this.seen = new SeenGate(); // when a finished turn may be marked seen (PM review R2)
    this.seenTurn = new Map();
    this.switcher = null; // the model switcher while it is open (lib/models.js openSwitcher)
    this.switchNote = null;
    this.switchFocus = cx.focus_handle();
    this.composerH = 96;
    // Previews run only for the view and session they were asked for (review G1): hidden or retargeted, none.
    this.media = new MediaStore(() => (this.shown() && this.cur() ? `${this.target}:${this.cur().src.gen}:${this.view.observe(this.shown(), this.target)}` : null));
    this.input = TextareaState.new({ placeholder: "Message the agent", rows: 1 });
    this.input.set_auto_grow(1, 8);
    // Enter inserts the highlighted "/" command while the menu is open (request 30), else sends.
    this.input.on("submit", (e, cx) => { if (e?.shift) return; if (this.slash) this.slashPick(cx); else this.send(cx); });
    this.input.on("change", (_e, cx) => {
      if (this.drafts.note(this.draftKey)) this.drafts.notes.delete(this.draftKey);
      this.slashFollow(cx);
      cx.notify();
    });
    this.slash = null; // the "/" menu while the draft is a command being typed: lib/slash-commands.js openMenu
    this.inputFocused = false; // the composer's frame turns accent only while the textarea has the keyboard (C8)
    this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.inputFocused = false; cx.notify(); });
    this.slashNames = null; // {key, names} custom command and skill names for the agent shown (names only)
    this.view = new ViewGate();
    cx.spawn(async (cx) => {
      this.acx = cx; // the child timeline's way to have this view draw again (its size or following changed)
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") this.input.focus();
        else if (c === "attach-open") this.openAttachments(cx);
        else if (c.startsWith("attach:")) this.receiveFiles(c.slice(7), cx);
        else if (c.startsWith("attach-cancel:")) this.fileRequests.delete(c.slice(14));
        else if (c === "preview" || c.startsWith("preview:")) { this.updateTarget(); this.media.command(c); cx.notify(); } // the chat a pick just chose
        else if (c === "models" || c.startsWith("models:")) this.modelsCommand(c, cx); // the switcher by command (and key bindings)
        else if (c === "slash" || c.startsWith("slash:")) this.slashCommand(c, cx); // the "/" menu by command (and key bindings)
        else if (c.startsWith("code:")) this.codeCommand(c.slice(5), cx); // the code view by command (how the sandbox drives it)
        else if (c.startsWith("call:")) this.callCommand(c.slice(5), cx); // a call opened or closed as a click would (the sandbox)
        else if (c.startsWith("group:")) this.groupCommand(c.slice(6), cx); // a work group folded or opened, likewise
        else if (c === "stop") this.stop(cx); // Stop by command (and key bindings), as its button
        else if (c.startsWith("send:")) { this.updateTarget(); this.syncDraft(); this.input.set_value(c.slice(5)); this.send(cx); } // as Send, with this text (how the sandbox drives it)
        else if (c === "agent" || c.startsWith("agent:")) this.agentCommand(c, cx); // the agent menu by command (and key bindings)
      }
    });
    cx.spawn(async (cx) => {
      for (;;) {
        await cx.sleep(1000);
        this.view.observe(this.shown(), this.target);
        if (!this.shown()) { this.seen.leave(); continue; } // nothing is read while hidden (M5); a hidden chat's visit ends
        this.media.pump(cx); // previews the last render asked for (media.js MediaStore.pump)
        await this.tick(cx).catch((e) => { const src = this.cur()?.src; if (src?.legacy) Object.assign(src, { state: "error", reason: String(e?.message ?? e) }); });
        cx.notify();
      }
    });
  }

  // The shown draft's chips (folders picked with "+", sent with the message) belong to the drafts, so a late pick
  // reaches its own draft through drafts.attachTo and never the one shown when it lands (audit H3).
  get attach() { return this.drafts.shown.attach; }
  set attach(v) { this.drafts.shown.attach = v; }

  // The agent shown, and what the chat keeps for it.
  cur() {
    return this.agents.get(this.target) ?? null;
  }

  // What the chat keeps for this terminal's agent, made the first time it is shown (nothing is read until the loop
  // steps it) and kept while another is shown, so coming back reads nothing again. Another kind in the same terminal
  // starts afresh. At most KEEP agents: the one shown least recently goes (prune drops those whose terminal is gone).
  agentFor(term) {
    const kind = agentKind(term);
    if (!kind || !MAPPERS[kind]) return null;
    let s = this.agents.get(term.address);
    if (s && s.kind !== kind) { s.src.close?.(); this.agents.delete(term.address); s = null; }
    if (!s) s = agentChat(term.address, kind);
    // The Map's order is the order they were last shown (agentFor is asked for the agent shown only).
    this.agents.delete(term.address);
    this.agents.set(term.address, s);
    for (const [address, old] of this.agents) { if (this.agents.size <= KEEP) break; old.src.close?.(); this.agents.delete(address); }
    // A new conversation (another process, session or file): what was opened in the old one goes with it.
    if (s.src.gen !== s.gen) {
      Object.assign(s, { gen: s.src.gen, open: new Set(), unfolded: new Set(), collapsed: new Set(), mediaClass: new Map(), showEarlier: false, applied: null, pending: [] });
      if (s.address === this.target) this.leaveSession();
    }
    // The full tail took the short read's place (the same gen): a work group's key comes from its first call and
    // earlier calls may have joined it, so a group opened or folded by its key keeps that under its new key.
    if (s.thread && s.thread !== s.src.thread) {
      const groups = s.src.thread.rows().filter((r) => r.type === "work");
      for (const set of [s.open, s.collapsed]) for (const k of [...set]) {
        const g = k.startsWith("work:") ? groups.find((x) => holds(x, k.slice(5))) : null;
        if (g && g.key !== k) { set.delete(k); set.add(g.key); }
      }
    }
    s.thread = s.src.thread;
    return s;
  }

  // One step of the shown agent's Feed (lib/feed.js): at most one read in flight. Its answer is awaited in a task of
  // its own, so a tail that waits for the file to grow never holds this loop. The Feed drops a late answer itself, and
  // asks `shown` again before each call: once Chat is hidden or shows another agent, nothing more is read for this one.
  stepFeed(s, t, cx) {
    const p = s.src.step(t, { shown: () => this.shown() && this.target === s.address });
    if (!p) return;
    cx.spawn(async (cx) => {
      if (!(await p)) return;
      // A switch applied before the first read takes this read as its baseline (F5 edge).
      if (s.applied) s.applied = withBaseline(s.applied, s.src.meta);
      if (s === this.cur()) this.syncEditors(s); // a result that arrived for an open call
      cx.notify();
    });
  }

  // An agent whose terminal is gone goes at once, with its feed.
  prune() {
    const live = new Set(terminals().map((t) => t.address));
    for (const [address, s] of this.agents) if (!live.has(address)) { s.src.close?.(); this.agents.delete(address); }
  }

  // Chat per tab (lib/views.js): a pick or a pane's Chat press is remembered for its tab once Chat shows it there,
  // once per pick, so Terminal pressed right after is never undone. A focus change alone writes nothing: on a tab
  // switch, the tab bar decides what the new tab shows.
  rememberTab() {
    const address = this.remember;
    const tab = focused()?.tab;
    if (!address || address !== this.target || !this.shown() || !tab || panes().find((p) => p.terminal === address)?.tab !== tab) return;
    this.remember = null;
    const had = shared(TABS_KEY) ?? {};
    if (had[tab] !== address) setShared(TABS_KEY, rememberChat(had, tab, address));
  }

  // The "/" menu, the agent menu and the switcher belong to the agent and session they opened for (audit H2).
  leaveSession() {
    this.drawn = null;
    this.slash = null;
    this.agentMenu = null;
    if (this.switcher) { this.switcher = null; this.switchNote = "Model switcher closed: the agent or its session changed"; }
    this.seen?.leave();
  }

  shown() {
    return findNode(layout(), "work-body")?.active === "chat";
  }

  // The terminal's machine can't be reached now: what Core knows of its process (so its kind) may be gone with it.
  away(address) {
    const on = machineOf(address);
    return Boolean(on) && machines().some((m) => m.name === on && m.layout === "unavailable");
  }

  // The agent this chat shows: the focused terminal, or an agent picked in the tree or by a pane's Chat button,
  // whichever came last. A pick is new when its time or its address differs from the last one taken, so two picks
  // in one millisecond both count (review R2).
  updateTarget() {
    const f = focused()?.terminal ?? null;
    if (f !== this.lastFocus) { this.lastFocus = f; this.chosen = f; }
    const pick = shared("pdk.chat.pick");
    // A pick made before this view started (an app start, a reload) was for a view that no longer exists: the chat
    // starts on the focused agent, and the tab bar picks again for a tab that remembers another.
    if (!this.pickSeen) { this.pickSeen = true; if (pick) { this.lastPickAt = pick.at; this.lastPick = pick.address; } }
    if (pick && (pick.at !== this.lastPickAt || pick.address !== this.lastPick)) { this.lastPickAt = pick.at; this.lastPick = pick.address; this.chosen = pick.address; this.remember = pick.address; }
    const term = this.chosen ? terminals().find((t) => t.address === this.chosen) : null;
    const live = term ? this.chosen : null;
    if (live !== this.target) {
      this.target = live;
      this.leaveSession();
      const s = this.agents.get(live);
      if (s) { s.follow = true; s.toEnd = true; } // a chat shown again opens at its newest row
    }
    if (term) this.agentFor(term);
    return live;
  }

  async tick(cx) {
    this.seen.observe(terminals()); // every terminal's turns, so a turn's start is known when its chat is opened (H4)
    const address = this.updateTarget();
    this.rememberTab();
    this.prune();
    this.syncEditors(this.cur()); // the open calls' snippets for the session shown (tools.js), none for any other
    if (!address) return;
    const t = terminals().find((x) => x.address === address);
    const s = this.cur();
    if (!s) return;
    // Nothing is read from a machine that is away; back, the feed is proven and read at once, not after its backoff.
    if (this.away(address)) { s.away = true; return; }
    if (s.away) { s.away = false; s.src.kick?.(); }
    if (!s.src.legacy) { this.stepFeed(s, t, cx); this.markSeen(t, s); return; }
    // The reader, for the kinds without a Feed. Review F5: shown, same agent, same conversation, checked before and
    // after every await; a stale answer is dropped.
    const src = s.src, gen = src.gen;
    const token = this.view.start(this.shown(), address);
    const live = () => gen === src.gen && this.agents.get(address) === s && this.view.valid(token, this.shown(), this.target);
    const pid = t?.foreground?.pid ?? null;
    // Bind, and re-check now and then: a new process or a new session (/clear, /new) starts over.
    if (!src.binding || src.binding.pid !== pid || Date.now() - src.boundAt > REBIND_MS) {
      if (!live()) return;
      const b = await resolveSession(t);
      if (!live()) return;
      const changed = src.binding?.ok && (!b.ok || b.session !== src.binding.session || b.path !== src.binding.path || b.pid !== src.binding.pid);
      if (changed) startOver(src);
      Object.assign(src, { binding: b, boundAt: Date.now(), state: b.ok ? (src.caughtUpAt ? "live" : "finding") : "unbound", reason: b.ok ? null : b.reason });
      cx.notify();
      if (changed) return;
    }
    const b = src.binding;
    if (!b?.ok) return;
    const failed = (reason) => { Object.assign(src, { state: "error", reason }); };
    if (b.path) {
      for (let i = 0; i < 4; i++) {
        const q = src.cursor.request();
        if (!live()) return;
        const r = await helper("read", [b.path, q.offset, q.max, q.align, q.headLen]).catch((e) => ({ error: String(e?.message ?? e) }));
        if (!live()) return;
        const got = src.cursor.accept(r);
        if (got.error) return failed(got.error);
        if (got.missing) { src.state = "waiting"; return; }
        if (got.reset) { Object.assign(src, { thread: new Thread(), mapState: {}, cut: false, gen: src.gen + 1 }); continue; }
        if (got.cut) src.cut = true;
        if (!live()) return;
        const recs = await mediaRecords(b.path, got, live); // lines too long to read come back slimmed (media.js)
        if (!live()) return; // live() includes gen === src.gen
        src.skipped += recs.unread;
        feed(src.thread, b.kind, recs, src.mapState);
        Object.assign(src, { state: "live", reason: null });
        if (!got.more) { src.caughtUpAt = Date.now(); break; }
      }
    } else if (b.store) {
      if (!live()) return;
      const r = await helper("rows", [b.store, b.session, src.rows.after]).catch((e) => ({ error: String(e?.message ?? e) }));
      if (!live()) return;
      const got = src.rows.accept(r);
      if (got.error) return failed(got.error);
      feed(src.thread, b.kind, got.rows, src.mapState);
      Object.assign(src, { state: "live", reason: null, caughtUpAt: Date.now() });
    }
    this.markSeen(t, s);
  }

  // herdr.seen (Herdr's docs/labels.md: raised by a client in which a person has read the turn): only once the bound
  // session's chat is shown in a window in front and a read caught up after the turn was noticed (lib/composer.js
  // SeenGate); latched only when the label write succeeded.
  markSeen(t, s) {
    const b = s.src.binding;
    const drawn = this.drawn?.address === s.address && this.drawn.gen === s.src.gen ? this.drawn : null; // this session's last render receipt
    const token = this.seen.decide({ address: t?.address, session: b?.ok ? b.session ?? b.path ?? null : null, turn: t?.turn ?? 0,
      seen: Number(t?.labels?.["herdr.seen"] ?? -1), shown: this.shown(), foreground: Boolean(window()?.active),
      endedAt: t?.status_ms ?? null, drawn, now: Date.now() });
    if (!token) return;
    hc(["label", t.address, `herdr.seen=${token.turn}`]).then((r) => this.seen.result(token, r?.code === 0, Date.now()), () => this.seen.result(token, false, Date.now()));
  }

  // The composer shows the draft of the agent session in view (PM review R1).
  syncDraft() {
    const t = terminals().find((x) => x.address === this.target);
    const b = this.cur()?.src.binding;
    const key = t ? draftKey(t.address, b?.ok && b.pid === (t.foreground?.pid ?? null) ? b.session ?? b.path ?? null : null, t.foreground?.pid) : null;
    if (key === this.draftKey) return;
    const next = this.drafts.swap(this.draftKey, { text: this.input.value(), attach: this.attach }, key);
    this.draftKey = key;
    if (next.text !== this.input.value()) this.input.set_value(next.text);
    this.attach = next.attach;
  }

  attachmentOrigin() {
    if (!this.shown()) return null;
    this.updateTarget(); this.syncDraft();
    const term = terminals().find(t => t.address === this.target);
    const origin = this.drafts.origin(this.draftKey);
    if (!term || !origin || !composerAction(rawStatus(term)).send) return null;
    const pane = panes().find(p => p.terminal === term.address);
    return { origin, address: term.address, pid: term.foreground?.pid ?? null,
      cwd: pane?.cwd || term.cwd, on: term.address.includes("/") ? term.address.split("/")[0] : null };
  }
  // "+" opens the file browser on the agent's own machine, in its folder (owner, 11 Nov 2026): files and folders.
  openAttachments(cx) {
    const source = this.attachmentOrigin();
    if (!source) return;
    if (typeof source.cwd !== "string" || !source.cwd.startsWith("/")) { this.drafts.notes.set(source.origin.key, "Files unavailable: no absolute POSIX folder for this agent."); cx.notify(); return; }
    const request = { ...source, id: `${Date.now()}-${++this.fileSequence}` };
    if (this.fileRequests.size >= 8) this.fileRequests.delete(this.fileRequests.keys().next().value);
    this.fileRequests.set(request.id, request);
    openOverlay({ mod: "pdk-files", kind: "window", key: "pdk-files", width: 640, height: 560, props: { source: request } });
    cx.notify();
  }
  receiveFiles(text, cx) {
    if (text.length > 65536) return;
    let result; try { result = JSON.parse(text); } catch { return; }
    const request = this.fileRequests.get(result?.id);
    if (!request) return;
    this.fileRequests.delete(result.id); // one result per opened browser
    const paths = filesResult(request, result), term = terminals().find(t => t.address === request.address);
    this.syncDraft();
    if (paths && term && (term.foreground?.pid ?? null) === request.pid && !this.drafts.attachTo(request.origin, paths)) {
      const key = this.drafts.moved.get(request.origin.key) ?? request.origin.key;
      this.drafts.notes.set(key, "Files not attached: the original draft changed or its attachment limit was reached.");
    }
    cx.notify();
  }
  // Terminal: this tab shows its panes from now on (lib/views.js).
  openTerminal() {
    const tab = focused()?.tab;
    if (tab && (shared(TABS_KEY) ?? {})[tab]) setShared(TABS_KEY, forgetTab(shared(TABS_KEY), tab));
    this.remember = null;
    const p = panes().find((x) => x.terminal === this.target);
    run("layout.select", { stack: "work-body", child: "main" });
    if (p) run("pane.focus", { pane: p.pane });
    else if (this.target) run("terminal.peek", { terminal: this.target });
  }

  // Try again (the state block's button): the session is proven and read again from the loop's next step.
  retry(cx) {
    const src = this.cur()?.src;
    if (!src) return;
    if (src.legacy) src.boundAt = 0; else src.kick();
    cx.notify();
  }

  // A send belongs to the draft it came from: its result clears that draft only if unchanged, or keeps it with why.
  send(cx) {
    this.syncDraft();
    const key = this.draftKey;
    if (!key || this.sendingKeys.has(key)) return;
    const t = terminals().find((x) => x.address === this.target);
    const s = this.cur();
    const sent = { text: this.input.value(), attach: [...this.attach] };
    const args = sendArgs(this.target, withFolders(sent.text, sent.attach), rawStatus(t));
    if (!args) return;
    this.sendingKeys.add(key);
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await hc(args).catch((e) => ({ code: 1, stderr: String(e?.message ?? e) }));
      const out = sendOutcome(r);
      if (out.sent && s) s.pending.push(pendingSend(args[2], s.src.thread.entries, Date.now())); // shown at once (lib/composer.js)
      // /clear, /new, /resume...: bind again now. So too after any send while the feed isn't live: a Codex that just
      // started its thread binds with its first message, not up to REPROBE_MS later.
      if (out.sent && s) { s.follow = true; s.toEnd = true; } // what was sent is shown at the end
      if (out.sent && s && (startsSession(agentKind(t), sent.text) || s.src.state !== "live")) { if (s.src.legacy) s.src.boundAt = 0; else s.src.kick(); }
      this.sendingKeys.delete(key);
      this.syncDraft();
      const clear = this.drafts.finished(key, sent, out.sent, out.sent ? null : `Not sent: ${out.reason}. Your text is kept.`, this.draftKey, { text: this.input.value(), attach: this.attach });
      if (clear) { this.input.set_value(""); this.attach = []; }
      cx.notify();
    });
  }

  // The model, effort and context use, from the lines the Feed read (lib/feed.js meta) for this terminal's process.
  metaOf(term) {
    const src = this.agents.get(term?.address)?.src;
    return src?.binding?.pid === (term?.foreground?.pid ?? null) ? src.meta ?? null : null;
  }

  // A switch made here, for this terminal's process.
  appliedFor(term) {
    const a = this.agents.get(term?.address)?.applied;
    return a && a.address === term?.address && a.pid === (term?.foreground?.pid ?? null) ? a : null;
  }

  choiceOf(term, kind) {
    return currentChoice(kind, { meta: this.metaOf(term), argv: term?.foreground?.argv ?? [], applied: this.appliedFor(term) });
  }

  // Codex's list from its own app-server through the helper (`models codex`), once per app run; asked only when a
  // person opens Codex's switcher. A failure is kept a minute, then asked again.
  loadCodexModels(cx) {
    if (codexModels && (codexModels.list || codexModels.busy || Date.now() - codexModels.at < 60000)) return;
    codexModels = { list: null, error: null, busy: true, at: Date.now() };
    cx.spawn(async (cx) => {
      const r = await helper("models", ["codex"], 30000).catch((e) => ({ error: String(e?.message ?? e) }));
      codexModels = { list: r?.models?.length ? r.models : null, error: r?.models?.length ? null : r?.error ?? "Codex listed no models", busy: false, at: Date.now() };
      if (this.switcher?.kind === "codex" && codexModels.list) this.switcher = { ...openSwitcher("codex", this.switcher.choice, codexModels.list), choice: this.switcher.choice, bind: this.switcher.bind };
      cx.notify();
    });
  }

  // What a switch would go to now (lib/models.js switchBinding): the terminal, its kind and process, and the chat's
  // bound session and generation for it. Null when the terminal is gone.
  switchFacts(address) {
    const t = terminals().find((x) => x.address === address);
    if (!t) return null;
    const pid = t.foreground?.pid ?? null;
    const src = this.target === address ? this.cur()?.src : null;
    const b = src?.binding?.pid === pid ? src.binding : null;
    return switchBinding({ address, kind: agentKind(t), pid, start: b?.start ?? null, session: b?.ok ? b.session ?? b.path ?? null : null, gen: src?.gen ?? 0 });
  }

  openModels(term, kind, cx) {
    if (kind === "codex") this.loadCodexModels(cx);
    const choice = this.choiceOf(term, kind);
    this.switcher = { ...openSwitcher(kind, choice, codexModels?.list ?? null), choice, bind: this.switchFacts(term.address) };
    this.switchNote = null;
    this.switchFocus.focus();
    cx.notify();
  }

  // `pdk-chat.models` opens or closes the switcher for the agent shown; `pdk-chat.models:<key>` presses up, down, left,
  // right, enter or escape in it.
  modelsCommand(c, cx) {
    this.updateTarget();
    const term = terminals().find((x) => x.address === this.target);
    const kind = agentKind(term);
    if (!term || (kind !== "claude" && kind !== "codex")) return;
    if (c === "models") { if (this.switcher) this.closeModels(cx); else this.openModels(term, kind, cx); return; }
    if (this.switcher) this.switcherKeyDown({ key: c.slice("models:".length) }, term, cx);
  }

  hasHistory() {
    return Boolean(this.cur()?.src.thread.rows().some((r) => r.type === "user" || r.type === "assistant"));
  }

  // Claude asks before a new model re-reads a conversation it has (lib/models.js CLAUDE_REREAD).
  rereads(s, model) {
    return s.kind === "claude" && model.id !== s.current && this.hasHistory();
  }

  closeModels(cx) {
    this.switcher = null;
    this.input.focus();
    cx.notify();
  }

  switcherKeyDown(e, term, cx) {
    const key = { up: "up", down: "down", left: "left", right: "right", enter: "enter", escape: "escape" }[e?.key];
    if (!key || !this.switcher) return;
    cx.stop_propagation();
    const { s, action } = switcherKey(this.switcher, key);
    this.switcher = { ...s, choice: this.switcher.choice, bind: this.switcher.bind };
    if (action === "cancel") this.closeModels(cx);
    else if (action === "apply") this.applySwitch(term, cx);
    else cx.notify();
  }

  // Switch the agent for this session only, with its own commands through Core (lib/models.js switchSteps): typed
  // only while it sits at its prompt; never retried. What runs now shows "set here" until its transcript moves on.
  // The switch goes only to the agent and session the switcher opened for (audit H2), checked before every step and
  // after every wait (lib/models.js runSwitch); the first line also needs the agent at its prompt.
  applySwitch(term, cx) {
    const s = this.switcher;
    const bind = s?.bind;
    const still = () => (switchStillFor(bind, this.switchFacts(bind?.address)) ? null : "the agent or its session changed");
    if (!bind || term?.address !== bind.address || still()) { this.closeModels(cx); this.switchNote = "Not switched: the agent or its session changed"; cx.notify(); return; }
    const model = s.models[s.mi];
    const effort = model?.efforts?.[s.ei] ?? null;
    const allowed = switchAllowed(rawStatus(term));
    // The Yes goes whenever the conversation has history: the transcript names the last turn's model, which a switch
    // made since may have changed, and an Enter at Claude's empty prompt sends nothing.
    const steps = model ? switchSteps(bind.kind, model, effort, { confirm: bind.kind === "claude" && this.hasHistory() }) : null;
    if (!allowed.ok || !steps) { this.switchNote = allowed.why ?? "This switch can't be sent"; cx.notify(); return; }
    const metaAt = JSON.stringify(this.metaOf(term) ?? null), turnAt = this.metaOf(term)?.turn ?? null;
    const words = `${model.label}${effort ? ` · ${effortWord(effort)}` : ""}`;
    const s0 = this.agents.get(bind.address); // the switch is kept with its agent, whichever is shown when it lands
    this.closeModels(cx);
    this.switchNote = `Switching to ${words}…`;
    cx.spawn(async (cx) => {
      const dispatch = async (st) => {
        const now = terminals().find((x) => x.address === bind.address);
        const args = st.send ? sendArgs(bind.address, st.send, rawStatus(now)) : ["keys", bind.address, ...st.keys, "--json"];
        if (!args) return { sent: false, reason: "it is not at its prompt" };
        return sendOutcome(await hc(args).catch((e) => ({ code: 1, stderr: String(e?.message ?? e) })));
      };
      const out = await runSwitch(steps, { still, dispatch, sleep: (ms) => cx.sleep(ms) });
      if (!out.sent) { this.switchNote = `Not switched: ${out.reason}${out.at > 0 ? " (stopped part way; check the terminal)" : ""}`; cx.notify(); return; }
      if (s0) s0.applied = { address: bind.address, pid: bind.pid, model: model.id, effort, metaAt, turnAt };
      this.switchNote = `Sent to ${kindName(bind.kind)}: ${words} for this session only`;
      cx.notify();
    });
  }

  // ---- "/" commands (owner request 30) ----

  slashKind() {
    const kind = agentKind(terminals().find((x) => x.address === this.target));
    return SLASH_KINDS.includes(kind) ? kind : null;
  }

  // The draft decides: "/" and a name being typed opens or filters the menu; anything else closes it.
  slashFollow(cx) {
    const q = slashQuery(this.input.value());
    const kind = this.slashKind();
    if (q == null || !kind) { this.slash = null; return; }
    this.loadSlashNames(kind, cx);
    const list = commandsFor(kind, this.slashNames?.key === this.slashKey(kind) ? this.slashNames.names : []);
    this.slash = this.slash && this.slash.kind === kind && this.slash.all.length === list.length ? { ...setQuery(this.slash, q), kind } : { ...openMenu(list, q), kind };
  }

  slashKey(kind) {
    const t = terminals().find((x) => x.address === this.target);
    return `${kind}|${t?.address}|${t?.cwd ?? ""}`;
  }

  // Custom command and skill names, once per agent and folder (the helper lists names; it never opens a file).
  loadSlashNames(kind, cx) {
    const key = this.slashKey(kind);
    if (this.slashNames?.key === key) return;
    const cwd = terminals().find((x) => x.address === this.target)?.cwd ?? "";
    this.slashNames = { key, names: [] };
    if (machineOf(this.target)) return; // custom names are read only on this Mac: a remote agent lists its built-ins
    cx.spawn(async (cx) => {
      const r = await helper("names", [kind, cwd || "-"]).catch(() => null);
      if (this.slashNames?.key !== key) return;
      this.slashNames = { key, names: r?.names ?? [] };
      if (this.slash) this.slashFollow(cx);
      cx.notify();
    });
  }

  slashKeyDown(e, cx) {
    if (!this.slash) return;
    const key = { up: "up", down: "down", tab: "tab", escape: "escape" }[e?.key];
    if (!key) return;
    cx.stop_propagation();
    this.slashPress(key, cx);
  }

  slashPress(key, cx) {
    const { m, action } = menuKey(this.slash, key);
    this.slash = { ...m, kind: this.slash.kind };
    if (action === "close") this.slash = null; // the draft stays as typed
    else if (action === "insert") return this.slashPick(cx);
    cx.notify();
  }

  // Inserts the highlighted command and a space (never sends); /model and /effort open the session-only switcher.
  slashPick(cx, i = this.slash?.i) {
    const entry = this.slash?.shown[i];
    if (!entry) return;
    const pick = chatPick(entry);
    this.slash = null;
    const term = terminals().find((x) => x.address === this.target);
    if (pick.switcher && (agentKind(term) === "claude" || agentKind(term) === "codex")) {
      this.input.set_value("");
      this.openModels(term, agentKind(term), cx);
      return;
    }
    this.input.set_value(pick.text ?? `/${entry.name} `);
    this.input.focus();
    cx.notify();
  }

  // `pdk-chat.slash` starts a command in an empty draft; `pdk-chat.slash:<key>` presses up, down, tab, enter or
  // escape in the menu; `pdk-chat.slash:query:<text>` makes the draft "/<text>" (how the sandbox drives it).
  slashCommand(c, cx) {
    this.updateTarget();
    if (c === "slash") { if (!this.input.value()) this.input.set_value("/"); this.input.focus(); this.slashFollow(cx); cx.notify(); return; }
    const arg = c.slice("slash:".length);
    if (arg.startsWith("query:")) { this.input.set_value(`/${arg.slice(6)}`); this.input.focus(); this.slashFollow(cx); cx.notify(); return; }
    if (!this.slash) return;
    if (arg === "enter") this.slashPick(cx);
    else this.slashPress(arg, cx);
  }

  slashView(t) {
    const m = this.slash;
    return overlayFrame(t, "slash-menu").absolute().left(0).right(0).bottom(this.composerH + SPACE[2])
      .child(slashList(t, m, visibleRows(m), { id: "slash", source: sourceLine(m.kind), words: SAFETY_WORDS,
        onPick: (i, _e, cx) => { this.slash = { ...this.slash, i }; this.slashPick(cx, i); } }));
  }

  // ---- drawing ----

  // The shared action button (design-system C5): a Tab stop with the accent ring, Enter and Space press it.
  button(t, id, label, _glyph, action, primary = false) {
    return actionButton(t, id, label, label, (_e, cx) => action(cx), { variant: primary ? "primary" : "neutral" });
  }

  header(t, term, kind) {
    const pane = panes().find((p) => p.terminal === term.address);
    // The mark says what runs (the detected kind: Hermes under its Python launcher reads Hermes), the text says which
    // pane it is (owner request 14). Under it, as Moshi's header has it: the model, how full its context is, the folder.
    const name = paneLabel(pane, term);
    const support = SUPPORT[kind];
    // The app's own word when it lists the agent (done turns idle once seen), as the tree shows it.
    const word = displayWord(agents().find((a) => a.address === term.address)?.status ?? rawStatus(term));
    const meta = this.metaOf(term);
    const choice = this.choiceOf(term, kind);
    const pct = meta?.contextPct;
    const folder = folderLabel(pane?.cwd ?? term.cwd);
    const BAR = 40;
    // Clipped, so in a narrow view its meta line gives way under the toggle instead of running into it.
    const who = h_flex().id("chat-head-left").flex_1().min_w(0).overflow_hidden().gap(SPACE[2]).items_center()
      .child(kindMarker(t, { agent: true, label: kindName(kind) }, iconFor(TYPE.lg), t.muted, "chat-kind"))
      .child(v_flex().flex_1().min_w(0).gap(SPACE[1])
        .child(h_flex().gap(SPACE[2]).items_center().min_w(0)
          // How the transcript is read is a detail (PM review R19): in the name's tooltip, not a badge; a partial
          // format keeps its own line under the header.
          // The name elides first, its full words in the tooltip (design-parity G11).
          .child(fitLabel("chat-name", name).text_size(TYPE.lg).font_medium().text_color(t.foreground)
            .tooltip(name).accessibility_label(`${name} · ${kindName(kind)}${support ? ` · ${support.level === "verified" ? "chat from its own transcript" : support.level === "partial" ? "partly readable transcript" : "transcript not readable"}` : ""}`))
          // The status sits by the name, as in the pane header and the tabs (owner, 11 Nov).
          .children([statusMarker(t, word, "chat-head-st", { kind: term.report?.kind })].filter(Boolean)))
        .child(h_flex().h(14).gap(SPACE[2]).items_center().min_w(0).text_size(TYPE.xs).font_family(monoFont()).text_color(t.dim)
          .child(div().id("chat-model").flex_none().text_color(choice.model ? t.muted : t.dim)
            .tooltip(choice.model ? `Model ${choice.model}` : "Model unknown")
            .accessibility_label(choice.model ? `Model ${choice.model}, from its ${choice.from === "launch" ? "launch command" : choice.from === "set here" ? "switch made here" : "transcript"}` : "The transcript and launch command don't name the model")
            .child(choice.model ? chipLabel({ model: choice.model }) : "model unknown"))
          .child(pct == null
            ? div().id("chat-ctx").flex_none().tooltip("Context unknown").accessibility_label("The transcript doesn't say how full the context is").child("context unknown")
            : h_flex().id("chat-ctx").flex_none().gap(SPACE[1]).items_center().tooltip(`${pct}% context used`)
              .accessibility_label(`${pct}% of the model's context window used, from its last turn`)
              .child(div().w(BAR).h(4).rounded(2).bg(t.border).child(div().w(Math.max(2, Math.round((BAR * Math.min(100, pct)) / 100))).h(4).rounded(2).bg(pct >= 80 ? t.blocked : t.muted)))
              .child(div().text_color(t.muted).child(`${pct}%`)))
          // The folder's own name (owner, 11 Nov: a whole path cut at its end lost the part that tells agents apart); the
          // whole path is its tooltip and accessible name, as the pane header's.
          .when(Boolean(folder), (el) => el.child(div().id("chat-dir").min_w(0).truncate().tooltip(folder).accessibility_label(folder).child(folderName(pane?.cwd ?? term.cwd))))));
    // Three parts, as the pane header (owner, 11 Nov): who this is, the Chat / Terminal toggle in the bar's exact
    // middle (the two sides share the width evenly), and the one current-agent menu (parity G6) at the right end.
    // Here Chat is lit, and Terminal shows this agent's pane.
    return h_flex().h(HEAD).flex_none().px(SPACE[4]).gap(SPACE[2]).items_center().border_b(1).border_color(t.border).bg(t.canvas)
      .child(who)
      .child(segmentedChoice(t, "chat-view", AGENT_VIEWS, "chat", () => this.openTerminal(),
        { variant: "navigation", label: "Show this agent as", ground: t.canvas, owner: this, hit: this.hit(ROW.compact) }).flex_none())
      .child(h_flex().id("chat-head-right").flex_1().min_w(this.hit(ROW.compact)).justify_end().items_center()
        .child(textButton(t, "agent-menu-btn", "⋯", "Agent actions", (_e, cx) => (this.agentMenu ? this.closeAgentMenu(cx) : this.openAgentMenu(cx)),
          { h: this.hit(ROW.compact), size: TYPE.lg, pressed: Boolean(this.agentMenu) })));
  }

  tiles(e) {
    return Boolean(e.media?.length);
  }

  // A row's media as its tiles take it: a remote agent's files and pasted images carry its machine (`on`), so their
  // previews are made there and kept in this Mac's cache (lib/helper.js mediaPreview). A web image stays a click-load.
  refsOf(e) {
    const on = machineOf(this.target);
    return on ? e.media.map((r) => (r.src === "url" ? r : { ...r, on, key: `${on}|${r.key}` })) : e.media;
  }

  // The strip under a row, in the frame class the row had when it first showed media (media.js mediaClass), so tiles
  // never shrink while more stream in. `lane`: the width its owner gives.
  strip(t, e, align, lane) {
    const s = this.cur();
    let cls = s.mediaClass.get(e.key);
    if (!cls) { cls = mediaClass(e.media); s.mediaClass.set(e.key, cls); }
    return mediaStrip(t, this.refsOf(e), this.media, e.key, align, { lane, cls });
  }

  // The column's width now.
  column() {
    return Math.min(COLUMN, this.width - 2 * this.inset());
  }

  // One side inset for the thread and the composer (design review 5): 16 below 760 + 2 x 32, else 32.
  inset() {
    return this.width < COLUMN + 2 * SPACE[8] ? SPACE[4] : SPACE[8];
  }

  userRow(t, e) {
    const max = this.column() * 0.8;
    return v_flex().w_full().items_end().gap(SPACE[1])
      .when(Boolean(e.claimedFrom), (el) => el.child(h_flex().id(`claim-${e.key}`).gap(SPACE[1]).items_center().text_size(TYPE.xs).text_color(t.dim)
        .tooltip("Unverified sender").accessibility_label(`Claimed sender ${e.claimedFrom}, unverified: herdr-core records no sender, this name is the message's own claim`)
        .child(`From ${e.claimedFrom} · unverified sender`)))
      .when(Boolean(e.text), (el) => el.child(div().max_w(max).px(SPACE[4]).py(SPACE[2]).rounded(RADIUS.xl).bg(t.raised).text_size(TYPE.lg).line_height("22px").text_color(t.foreground).child(e.text)))
      .when(this.tiles(e), (el) => el.child(div().w(Math.round(this.column() * 0.8)).mt(e.text ? SPACE[1] : 0).child(this.strip(t, e, "end", Math.round(this.column() * 0.8))))); // 8 below the bubble
  }

  // Words as markdown; each fenced block as a highlighted snippet under its language (until its editor is made, in
  // the loop, the block shows as markdown draws it).
  assistantRow(t, e) {
    const parts = e.text.includes("```") ? fences(e.text) : [{ md: e.text }];
    const s = this.cur();
    const md = (text, i) => TextView.markdown(`md-${e.key}${i ? `-${i}` : ""}`, text).selectable(true).on_link_click(() => {});
    return v_flex().w_full().gap(SPACE[2]).text_size(TYPE.lg).text_color(t.foreground)
      .children(parts.map((p, i) => {
        if (p.code === undefined) return md(p.md, i);
        const ed = s && this.editors.get(`${this.scope(s)}|${e.key}|f${i}`);
        if (!ed) return md(`\`\`\`${p.lang ?? ""}\n${p.code}\n\`\`\``, i);
        return v_flex().w_full().gap(SPACE[1])
          .when(Boolean(p.lang), (el) => el.child(div().h(ROW.compact).flex().items_center().text_size(TYPE.xs).text_color(t.muted).font_family(monoFont()).child(p.lang)))
          .child(snippet(t, `fc-${e.key}-${i}`, p.code, ed));
      }))
      .when(this.tiles(e), (el) => el.child(this.strip(t, e, "start", this.column())));
  }

  // ---- tool calls and thoughts (tools.js; design chat-direction.md sections 4 and 5) ----

  // What tools.js draws a call with: this session's open keys and editors, and the handlers that open and close.
  // The chat block's size now. A size callback describes the layout before a resize, so the first render after one
  // drew for the old width (12 Nov: a 390 view kept desktop targets). As Factory does, the size comes from the window
  // and the layout (in unzoomed units); the measured box stays the fallback where the layout has no chat block.
  // `window` here is GPUI's, not herdr's window() imported above.
  fit() {
    const slot = blockSize(layout(), "chat", globalThis.window?.viewport_size?.(), settings().zoom || 1);
    this.laid = Boolean(slot);
    if (slot) { this.width = slot.width; this.height = slot.height; }
  }

  // A pressable box's height: `desktop` at NARROW px of view width and over, else ROW.touch (owner, 12 Nov).
  hit(desktop) {
    return this.width < NARROW ? ROW.touch : desktop;
  }

  toolCtx(s) {
    return { open: s.open, unfolded: s.unfolded, editors: this.editors, scope: this.scope(s), width: this.column(), hit: this.hit(ROW.compact),
      viewport: this.height - 52 - 170, toggle: (e, cx) => this.toggleCall(s, e, cx), close: (e, cx, refocus) => this.closeCall(s, e, cx, refocus),
      focusOf: (key) => this.heads.get(`${this.scope(s)}|${key}`) ?? null };
  }

  // The editors of one session's open calls are keyed by its address and conversation.
  scope(s) {
    return `${s.address}#${s.src.gen}`;
  }

  // A call opens with its snippets made here, in the handler; it closes with them released. Opening one never closes
  // another, and the timeline stops following so what was opened stays in place (read).
  toggleCall(s, e, cx) {
    if (s.open.has(e.key)) return this.closeCall(s, e, cx);
    s.open.add(e.key);
    // Its header gets a focus handle now, in the handler, so Escape inside the detail can give the keyboard back to it.
    const head = `${this.scope(s)}|${e.key}`;
    if (!this.heads.has(head)) this.heads.set(head, cx.focus_handle());
    this.read(s, e.key);
    this.editors.sync(this.scope(s), e, theme());
    cx.notify();
  }

  // Reading: what a person opened stays where it is (no follow).
  read(s, _key) {
    s.follow = false;
  }

  closeCall(s, e, cx, refocus = false) {
    s.open.delete(e.key);
    if (refocus) this.heads.get(`${this.scope(s)}|${e.key}`)?.focus(); // Escape: back to its own header, nothing moves
    this.editors.drop(this.scope(s), e.key);
    cx.notify();
  }

  // Editors exist for exactly what the last render drew (review R4): the fenced code of its answers and the parts of
  // its open calls in groups drawn open. A row trimmed or scrolled out, a folded group, a hidden chat and another
  // session release theirs; what a person opened stays as plain keys (s.open), so it comes back as it was. From
  // handlers only: the loop, a read's answer, a fold.
  syncEditors(s) {
    const scope = s && this.shown() ? this.scope(s) : null;
    this.editors.reconcile(scope, scope ? drawnSnippets(s.drawnRows ?? [], s.open, s.collapsed) : new Map(), theme());
    for (const k of [...this.heads.keys()]) if (!scope || !k.startsWith(`${scope}|`) || !s.open.has(k.slice(scope.length + 1))) this.heads.delete(k);
  }

  // The host closes this copy: every editor goes with it.
  close() {
    this.editors.release();
    this.heads.clear();
    this.tl?.release();
    this.tlScroll?.release();
  }

  // ---- the current-agent menu (parity G6): what this agent's terminal can do, from the chat header ----

  agentFacts(address) {
    const t = terminals().find((x) => x.address === address);
    if (!t) return null;
    const live = terminals().filter((x) => x.parent === address);
    return { hasPane: panes().some((p) => p.terminal === address), parent: t.parent ?? null, working: rawStatus(t) === "working", children: live.length, pid: t.foreground?.pid ?? null };
  }

  // Opened for one terminal and process, captured now; every action checks them again before it runs.
  openAgentMenu(cx) {
    const t = terminals().find((x) => x.address === this.target);
    if (!t) return;
    const pane = panes().find((p) => p.terminal === t.address);
    this.agentMenu = { address: t.address, pid: t.foreground?.pid ?? null, name: paneLabel(pane, t), i: 0, confirm: false, note: null };
    this.menuFocus.focus();
    cx.notify();
  }

  closeAgentMenu(cx) {
    this.agentMenu = null;
    this.input.focus(); // focus goes back where it was before the menu (design-parity G11)
    cx.notify();
  }

  agentAct(id, cx) {
    const m = this.agentMenu;
    const f = m && this.agentFacts(m.address);
    if (!f || f.pid !== m.pid) { this.agentMenu = { ...m, note: "That agent changed: nothing was done" }; cx.notify(); return; }
    const a = agentActions(f).find((x) => x.id === id);
    if (!a?.enabled) return;
    if (id === "end" && !m.confirm) { this.agentMenu = { ...m, confirm: true, note: endWords(m.name, f.children) }; cx.notify(); return; }
    if (id === "open") this.openTerminal();
    else if (id === "peek") run("terminal.peek", { terminal: m.address });
    else if (id === "keep") run("terminal.keep", { terminal: m.address, place: "tab" });
    else if (id === "owner") run("agent.focus", { terminal: f.parent });
    else if (id === "stop") this.stop(cx);
    else if (id === "end") run("terminal.kill", { terminal: m.address });
    this.closeAgentMenu(cx);
  }

  agentMenuKey(key, cx) {
    const m = this.agentMenu;
    if (!m) return;
    const list = agentActions(this.agentFacts(m.address) ?? {});
    if (key === "escape") return this.closeAgentMenu(cx);
    if (key === "up" || key === "down") { this.agentMenu = { ...m, i: (m.i + (key === "up" ? list.length - 1 : 1)) % list.length, confirm: false, note: null }; cx.notify(); return; }
    if (key === "enter" || key === "space") this.agentAct(list[m.i].id, cx);
  }

  // `pdk-chat.agent` opens or closes the menu; `pdk-chat.agent:<key>` presses up, down, enter or escape in it.
  agentCommand(c, cx) {
    this.updateTarget();
    if (c === "agent") { if (this.agentMenu) this.closeAgentMenu(cx); else this.openAgentMenu(cx); return; }
    this.agentMenuKey(c.slice("agent:".length), cx);
  }

  agentMenuView(t) {
    const m = this.agentMenu;
    const list = agentActions(this.agentFacts(m.address) ?? {});
    const row = (a, i) => rowStates(focusRing(h_flex(), t, (_e, cx) => this.agentAct(a.id, cx), !a.enabled), t,
      { selected: i === m.i, disabled: !a.enabled, ground: t.popover, color: t.foreground }) // disabled rows read dim
      .id(`am-${a.id}`).h(ROW.base).px(SPACE[2]).gap(SPACE[2]).items_center().rounded(RADIUS.md).text_size(TYPE.base)
      .role("menu_item").accessibility_label(a.why ? `${a.label}: ${a.why}` : a.label)
      .on_click((_e, cx) => { cx.stop_propagation(); this.agentAct(a.id, cx); })
      .child(div().flex_none().child(a.label))
      .when(Boolean(a.why), (el) => el.child(fitLabel(`am-why-${a.id}`, a.why).flex_1().text_size(TYPE.sm).text_color(t.dim)));
    return overlayFrame(t, "agent-menu").absolute().top(ROW.two + SPACE[2]).right(SPACE[4]).w(280).p(SPACE[1]).gap(SPACE[1])
      .track_focus(this.menuFocus).on_key_down((e, cx) => {
        const key = { up: "up", down: "down", enter: "enter", escape: "escape" }[e?.key];
        if (key) { cx.stop_propagation(); this.agentMenuKey(key, cx); }
      })
      .role("menu").accessibility_label(`${m.name}: agent actions`)
      .children(list.filter((a) => !a.destructive).map((a) => row(a, list.indexOf(a))))
      .child(div().h(1).mx(SPACE[1]).bg(t.border)) // End terminal stands apart
      .children(list.filter((a) => a.destructive).map((a) => row(a, list.indexOf(a))))
      .when(Boolean(m.note), (el) => el.child(div().px(SPACE[2]).py(SPACE[1]).text_size(TYPE.sm).text_color(m.confirm ? t.foreground : t.dim).child(m.note)));
  }

  // Stop (owner request 35): Core's `hc interrupt` on exactly the terminal, process and session shown, only while
  // Core still says it is working on the same turn (lib/interactions.js stopCheck). Once per turn; never retried.
  stop(cx) {
    const t = terminals().find((x) => x.address === this.target);
    const s = this.cur();
    if (!t || !s || rawStatus(t) !== "working" || s.stopped?.address === t.address && s.stopped.turn === t.turn) return;
    const bind = { ...this.switchFacts(t.address), turn: t.turn };
    s.stopped = { address: t.address, turn: t.turn, words: "Stopping…" };
    cx.notify();
    cx.spawn(async (cx) => {
      const got = await hc(["get", bind.address, "--json"]).then((r) => { try { return JSON.parse(r.stdout); } catch { return null; } }, () => null);
      const why = stopCheck(bind, this.switchFacts(bind.address), got);
      if (why) { s.stopped = { ...s.stopped, words: `Not stopped: ${why}` }; cx.notify(); return; }
      const r = await hc(["interrupt", bind.address, "--json"]).catch((e) => ({ code: 1, stderr: String(e?.message ?? e) }));
      s.stopped = { ...s.stopped, words: interruptWords(r) };
      cx.notify();
    });
  }

  // `pdk-chat.call:<n>` opens or closes the n-th call of the chat shown (1 is the first), as a click on its header.
  callCommand(n, cx) {
    this.updateTarget();
    const s = this.cur();
    const e = s?.src.thread.entries.filter((x) => x.type === "tool" || x.type === "thinking")[Number(n) - 1];
    if (!e) return;
    for (const g of s.src.thread.rows()) if (g.type === "work" && g.items.includes(e)) s.collapsed.delete(g.key); // its group shows
    this.toggleCall(s, e, cx);
  }

  // `pdk-chat.group:<n>` folds or opens the n-th work group of the chat shown, as a click on its header.
  groupCommand(n, cx) {
    this.updateTarget();
    const s = this.cur();
    const groups = s?.src.thread.rows().filter((r) => r.type === "work") ?? [];
    const g = groups[Number(n) - 1];
    if (!g) return;
    const folded = groupFolded(g, g === groups.at(-1), s.open, s.collapsed);
    if (folded) { s.collapsed.delete(g.key); s.open.add(g.key); } else { s.collapsed.add(g.key); s.open.delete(g.key); }
    this.syncEditors(s);
    cx.notify();
  }

  // `pdk-chat.code:open` expands every code row of the chat shown, `:close` folds them, `:unfold` opens their files'
  // "… +N lines" folds.
  codeCommand(what, cx) {
    this.updateTarget();
    const s = this.cur();
    if (!s) return;
    const all = s.src.thread.rows();
    const rows = all.filter((r) => r.type === "work").flatMap((g) => g.items).filter((r) => r.changes);
    for (const r of rows) {
      if (what === "open") { s.open.add(r.key); this.read(s, r.key); for (const g of all) if (g.type === "work" && g.items.some((i) => i.key === r.key)) s.collapsed.delete(g.key); }
      else if (what === "close") s.open.delete(r.key);
      else if (what === "unfold") r.changes.forEach((_f, k) => s.unfolded.add(`${r.key}:${k}`));
    }
    this.syncEditors(s);
    cx.notify();
  }

  workGroup(t, g, last) {
    const n = g.items.length;
    const { open, collapsed } = this.cur();
    // An older group of more than three folds, unless it was opened or holds a call opened by hand; a person's own fold
    // or open always wins (design chat-direction.md section 7).
    const folded = groupFolded(g, last, open, collapsed);
    const failed = g.items.filter((i) => i.status === "error" || i.status === "rejected").length;
    // Folded, the group keeps one strip of its media, once each in source order, at most MAX_REFS: folding the words
    // never hides fresh images. Open, each call owns its own.
    const media = folded ? [...new Map(g.items.flatMap((i) => i.media ?? []).map((r) => [r.key, r])).values()].slice(0, MAX_REFS) : [];
    return v_flex().w_full().gap(SPACE[0])
      // The shared caret 4 px after its words, as every fold in the pack (design-astra item 12).
      .child(focusRing(h_flex(), t, (_e, cx) => {
        if (folded) { collapsed.delete(g.key); open.add(g.key); } else { collapsed.add(g.key); open.delete(g.key); }
        this.read(this.cur(), g.key);
        this.syncEditors(this.cur());
        cx.notify();
      }).id(`wg-${g.key}`).h(this.hit(ROW.compact)).px(SPACE[1]).gap(SPACE[1]).items_center().rounded(RADIUS.md).cursor_pointer().text_size(TYPE.xs).text_color(t.dim)
        .hover((s) => s.text_color(t.muted))
        .role("button").accessibility_label(`${folded ? "Show" : "Hide"} ${n} steps`)
        .on_click((_e, cx) => {
          if (folded) { collapsed.delete(g.key); open.add(g.key); } else { collapsed.add(g.key); open.delete(g.key); }
          this.read(this.cur(), g.key);
          this.syncEditors(this.cur());
          cx.notify();
        })
        .child(`Worked · ${n} step${n === 1 ? "" : "s"}${failed ? ` · ${failed} not completed` : ""}`)
        .child(foldMarker(t, !folded)))
      .when(media.length > 0, (el) => el.child(div().mt(SPACE[1]).child(this.strip(t, { key: g.key, media }, "start", this.column()))))
      .when(!folded, (el) => {
        const ctx = this.toolCtx(this.cur());
        return el.children(g.items.map((i) => (i.type === "thinking" ? thinkingRow(t, i, ctx)
          : toolRow(t, i, ctx, this.tiles(i) ? div().ml(SPACE[6]).mt(SPACE[1]).mb(SPACE[1]).child(this.strip(t, i, "start", this.column() - SPACE[6])) : null))));
      });
  }

  observedRow(t, term) {
    const raw = rawStatus(term);
    const r = term.report ?? {};
    const s = this.agents.get(term.address);
    if (raw === "working") {
      // Spinner, the live word, then what it works on, all at the left where the eye is (owner, 12 Nov). The one
      // shimmer in Chat: the work-group head and tool rows keep a spinner at most.
      return h_flex().id("chat-working").w_full().h(ROW.base).gap(SPACE[2]).items_center().text_size(TYPE.base)
        .role("status").accessibility_label(r.title ? `Working: ${r.title}` : "Working")
        .child(spinner(t, iconFor(TYPE.base)))
        .child(workingText(t, "chat-working-word", "Working", { size: TYPE.base }))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(r.title ? `· ${r.title}` : ""))
        .when(s?.stopped?.address === term.address && s.stopped.turn === term.turn, (el) => el.child(div().flex_none().text_size(TYPE.xs).text_color(t.dim).child(s.stopped.words)));
    }
    if (raw === "blocked") {
      // Approvals and questions are shown, not answered (lib/interactions.js VIEW_ONLY): what is asked, then the terminal.
      const kind = r.kind ?? "question";
      const agentKind_ = agentKind(term);
      const pending = agentKind_ === "claude" || agentKind_ === "codex" ? pendingTool(s?.src.thread.entries ?? []) : null;
      const questions = kind === "question" ? pending?.questions ?? [] : [];
      return v_flex().id("blocked").w_full().p(SPACE[3]).gap(SPACE[2]).rounded(RADIUS.lg).border(1).border_color(t.blocked).bg(t.blocked + "14")
        .role("alert").accessibility_label(`Needs you: ${kind}. ${r.msg ?? ""}`)
        .child(h_flex().gap(SPACE[2]).items_center()
          .child(div().flex_1().min_w(0).text_size(TYPE.base).font_medium().text_color(t.foreground).child(kind === "permission" ? "Needs your permission" : kind === "auth" ? "Needs you to sign in" : "Has a question for you"))
          .child(statusMarker(t, "needs", "chat-needs")))
        // Core's words, unless the question below says the same.
        .when(!(questions.length && questions[0].question === r.msg), (el) => el.child(div().text_size(TYPE.base).text_color(t.foreground).child(r.msg || "The agent did not say what it is asking.")))
        // The action a permission prompt is about, from the agent's own pending call.
        .when(kind === "permission" && Boolean(pending), (el) => el.child(h_flex().h(ROW.compact).px(SPACE[2]).gap(SPACE[2]).items_center().rounded(RADIUS.md).bg(t.surface)
          .text_size(TYPE.sm).child(div().flex_none().text_color(t.muted).child(pending.verb)).child(fitLabel("blocked-action", pending.detail ?? "").flex_1().font_family(monoFont()).text_color(t.dim))))
        // A question's own choices, as the agent offers them (read only).
        .children(questions.map((q, qi) => v_flex().id(`bq-${qi}`).gap(SPACE[1])
          .child(h_flex().gap(SPACE[2]).items_center()
            .when(Boolean(q.header), (el) => el.child(badge(t, q.header, `bq-h-${qi}`)))
            .child(div().flex_1().min_w(0).text_size(TYPE.sm).font_medium().text_color(t.foreground).child(q.question)))
          // A choice grows to wrap its description rather than lose the question (design section 7).
          .children(q.options.map((o, oi) => h_flex().id(`bq-${qi}-${oi}`).min_h(ROW.compact).px(SPACE[2]).py(SPACE.half).gap(SPACE[2]).items_start().rounded(RADIUS.md).bg(t.surface).text_size(TYPE.sm)
            .child(div().flex_none().font_family(monoFont()).text_color(t.dim).child(String(oi + 1))).child(div().flex_none().text_color(t.foreground).child(o.label))
            .child(div().id(`bq-d-${qi}-${oi}`).flex_1().min_w(0).text_color(t.dim).child(o.description ?? ""))))
          .child(div().text_size(TYPE.xs).text_color(t.dim).child(`${q.multi ? "Several can be picked. " : ""}"Other" takes your own words.`))))
        .child(h_flex().gap(SPACE[2]).items_center()
          .child(this.button(t, "answer", "Answer in the terminal", "square-terminal", () => this.openTerminal(), true))
          .child(pending || agentKind_ === "claude" || agentKind_ === "codex"
            ? div().id("answer-why").flex_1().min_w(0).text_size(TYPE.xs).text_color(t.dim).tooltip("Answer in terminal").accessibility_label(`${VIEW_ONLY} ${ANSWER_GAP}`).child(VIEW_ONLY)
            : div().flex_1().min_w(0).text_size(TYPE.xs).text_color(t.dim).child(NO_DETAILS)));
    }
    if (raw === "error") {
      return h_flex().w_full().h(ROW.base).gap(SPACE[2]).items_center().text_size(TYPE.sm).text_color(t.foreground)
        .child(div().flex_1().min_w(0).child("The agent reported an error. Open Terminal above to see it and reply.")).child(div().size(ICON.dot).flex_none().rounded(ICON.dot / 2).bg(t.blocked)); // ANSI red is the terminal's (C11)
    }
    return null;
  }

  composer(t, term, kind, cx) {
    const raw = rawStatus(term);
    const action = composerAction(raw);
    const empty = !this.input.value().trim() && !this.attach.length;
    const can = action.send && !empty && !this.sendingKeys.has(this.draftKey);
    const hint = composerHint(raw);
    const note = this.drafts.note(this.draftKey);
    const choice = this.choiceOf(term, kind);
    // The model the next turn ran, when it isn't the one a switch here asked for (F5): said, never retried.
    const verdict = switchVerdict(this.appliedFor(term), this.metaOf(term));
    const switchable = (kind === "claude" || kind === "codex") && !term.address.includes("/");
    const chipWords = chipLabel(choice);
    const chipTip = switchable ? `${chipWords}${choice.from ? `, from its ${choice.from === "launch" ? "launch command" : choice.from === "set here" ? "switch made here" : "transcript"}` : ""}. Switch model and effort for this session`
      : `${chipWords}. Switching models from chat isn't supported for ${kindName(kind)}`;
    const open = Boolean(this.switcher);
    const stopped = this.agents.get(term.address)?.stopped;
    return v_flex().w_full().max_w(COLUMN).gap(SPACE[2]).relative()
      .child(fieldFrame(v_flex().id("composer-box").w_full().rounded(RADIUS.xl).p(SPACE[1]), t, { focused: this.inputFocused, disabled: !action.send })
        .on_key_down((e, cx) => this.slashKeyDown(e, cx))
        .on_size_change((size, cx) => { if (Math.abs(size.height - this.composerH) > 1) { this.composerH = size.height; cx.notify(); } })
        .when(this.attach.length > 0, (el) => el.child(h_flex().flex_wrap().gap(SPACE[2]).px(SPACE[2]).pt(SPACE[2]).children(this.attach.map((path, i) =>
          h_flex().id(`att-${i}`).h(this.hit(ROW.compact)).pl(SPACE[2]).pr(SPACE[1]).gap(SPACE[1]).items_center().rounded(RADIUS.md).bg(t.raised).max_w(260)
            .tooltip(`${term.address.includes("/") ? term.address.split("/")[0] : "This computer"}: ${path}`).accessibility_label(`Attached path ${path} on ${term.address.includes("/") ? term.address.split("/")[0] : "This computer"}`)
            .child(div().min_w(0).truncate().text_size(TYPE.xs).font_family(monoFont()).text_color(t.muted).child(`${term.address.includes("/") ? term.address.split("/")[0]+": " : ""}${folderLabel(path).split("/").pop() || path}`))
            .child(textButton(t, `att-x-${i}`, "×", `Remove ${path}`, (_e, cx) => { this.attach.splice(i, 1); cx.notify(); }, { h: this.hit(ROW.compact), size: TYPE.base })))))) // 24 at least (WCAG 2.5.8)
        .child(Textarea.new(this.input).w_full().text_size(TYPE.lg).bg(t.surface).border_0().px(SPACE[3]).py(SPACE[2]).disabled(!action.send)
          .accessibility_label("Message"))
        .child(h_flex().min_h(36).px(SPACE[1]).gap(SPACE[1]).items_center()
          .child(textButton(t, "attach", "+", "Attach files", (_e,cx) => this.openAttachments(cx), { h: this.hit(ROW.base), size: TYPE.lg, disabled: !action.send })) // a square 28 target (C13), 44 when narrow
          // Open stays selected on hover, with pressed and focus states that move nothing (design-parity S04, G11).
          .child(rowStates(focusRing(div(), t, (_e, cx) => { if (this.switcher) this.closeModels(cx); else this.openModels(term, kind, cx); }, !switchable), t,
            { selected: open, disabled: !switchable, ground: t.surface, color: t.muted }).id("model-chip").h(this.hit(ROW.base)).px(SPACE[2]).flex_shrink_1().min_w(0).overflow_hidden().flex().items_center().rounded(ROW.base / 2).text_size(TYPE.xs).font_family(monoFont())
            .role("button").accessibility_label(chipTip).tooltip(switchable ? "Switch model" : "Can't switch here").disabled(!switchable)
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_click((_e, cx) => { cx.stop_propagation(); if (!switchable) return; if (open) this.closeModels(cx); else this.openModels(term, kind, cx); })
            .child(div().min_w(0).truncate().child(chipWords))) // gives way before Stop and Send in a narrow view
          .child(fitLabel("composer-hint", hint).flex_1().pl(SPACE[1]).text_size(TYPE.xs).text_color(action.send ? t.dim : t.blocked))
          // Disabled Send is raised/dim (design-system Inputs/State A); the shared helper's surface would vanish on the composer.
          // Stop while it works (owner request 35): once per turn, Core's own interrupt (stop()).
          .when(raw === "working", (el) => el.child(actionButton(t, "stop", "Stop", "Stop: interrupt its turn (Core presses its stop key)", (_e, cx) => this.stop(cx),
            { disabled: stopped?.address === term.address && stopped.turn === term.turn, h: this.hit(ROW.base) })))
          .child(actionButton(t, "send", "↑", "Send", (_e, cx) => this.send(cx), { variant: "send", disabled: !can, h: this.hit(ROW.base) }).when(!can, (el) => el.bg(t.raised)))))
      .when(open, (el) => el.child(this.switcherView(t, term)))
      .when(Boolean(this.slash) && !open, (el) => el.child(this.slashView(t)))
      .when(!this.slashKind() && this.input.value().startsWith("/"), (el) => el.child(div().px(SPACE[2]).text_size(TYPE.xs).text_color(t.dim).child(NO_MENU)))
      .when(Boolean(note), (el) => el.child(h_flex().gap(SPACE[2]).items_center().px(SPACE[2]).text_size(TYPE.xs).text_color(t.blocked)
        .child(div().size(ICON.dot).flex_none().rounded(ICON.dot / 2).bg(t.blocked)).child(div().child(note))))
      .when(Boolean(verdict) && !note, (el) => el.child(div().id("switch-verdict").px(SPACE[2]).text_size(TYPE.xs).text_color(t.blocked).child(verdict)))
      .when(Boolean(this.switchNote) && !verdict && !note, (el) => el.child(div().px(SPACE[2]).text_size(TYPE.xs).text_color(t.dim).child(this.switchNote)));
  }

  // The switcher, above the composer as Moshi draws it: the effort levels the highlighted model takes, the models
  // with their own one-line descriptions and the current one marked, the keys. It holds the keyboard while open.
  switcherView(t, term) {
    const s = this.switcher;
    const model = s.models[s.mi];
    const efforts = model?.efforts ?? [];
    const loading = s.kind === "codex" && !s.models.length && codexModels?.busy;
    const why = loading ? null : s.models.length ? null : s.kind === "codex" ? `Codex's model list isn't available${codexModels?.error ? `: ${codexModels.error}` : ""}` : s.why;
    const source = s.kind === "claude" ? `As Claude Code ${CLAUDE_VERSION} lists them` : s.kind === "codex" ? "As Codex's app-server lists them" : "";
    const key = (k) => div().h(16).px(SPACE[1]).flex().items_center().rounded(RADIUS.sm).border(1).border_color(t.border).font_family(monoFont()).text_color(t.muted).child(k);
    const legend = (k, words) => h_flex().gap(SPACE[1]).items_center().child(key(k)).child(words);
    return overlayFrame(t, "model-switcher").absolute().left(0).right(0).bottom(this.composerH + SPACE[2])
      .track_focus(this.switchFocus).on_key_down((e, cx) => this.switcherKeyDown(e, term, cx))
      .role("dialog").accessibility_label("Switch model and effort for this session")
      .when(efforts.length > 0, (el) => el.child(h_flex().px(SPACE[3]).py(SPACE[2]).border_b(1).border_color(t.border)
        .child(segmentedChoice(t, "effort-group", efforts.map((e) => ({ value: e, label: effortWord(e), tooltip: `${effortWord(e)} effort` })), efforts[s.ei],
          (v, _e, cx) => { this.switcher = { ...this.switcher, ei: efforts.indexOf(v) }; this.switchFocus.focus(); cx.notify(); }, { label: "Effort", ground: t.popover, owner: this }))))
      .child(v_flex().id("model-list").py(SPACE[1]).role("list_box").accessibility_label("Models").children(s.models.map((m, i) => {
        const on = i === s.mi;
        return h_flex().id(`mdl-${i}`).h(ROW.base).px(SPACE[3]).gap(SPACE[2]).items_center().cursor_pointer().when(on, (el) => el.bg(t.selected)).hover((st) => st.bg(on ? t.selected : t.hover))
          .role("list_box_option").accessibility_label(`${m.label}${m.id === s.current ? ", current" : ""}: ${m.description}`)
          .on_click((_e, cx) => { this.switcher = { ...pickModel(this.switcher, i), choice: this.switcher.choice }; this.switchFocus.focus(); cx.notify(); })
          .child(div().flex_none().text_size(TYPE.base).text_color(t.foreground).when(on, (el) => el.font_medium()).child(m.label))
          .when(m.id === s.current, (el) => el.child(badge(t, "current", `cur-${i}`)))
          .child(fitLabel(`mdl-d-${i}`, m.description).flex_1().text_size(TYPE.sm).text_color(t.dim));
      })))
      .when(Boolean(model) && this.rereads(s, model), (el) => el.child(div().px(SPACE[3]).py(SPACE[2]).border_t(1).border_color(t.border).text_size(TYPE.sm).text_color(t.muted).child(CLAUDE_REREAD)))
      .when(loading, (el) => el.child(div().px(SPACE[3]).py(SPACE[2]).text_size(TYPE.sm).text_color(t.dim).child("Asking Codex for its models…")))
      .when(Boolean(why), (el) => el.child(div().px(SPACE[3]).py(SPACE[2]).text_size(TYPE.sm).text_color(t.dim).child(why)))
      // The keys stay in sight (design-astra item 14); where the list comes from fills the rest, clipped first: for
      // Claude the version its picker rows were taken from, which its keys depend on (final review F5).
      .child(h_flex().id("switch-foot").h(ROW.base).px(SPACE[3]).gap(SPACE[3]).items_center().border_t(1).border_color(t.border).text_size(TYPE.xs).text_color(t.dim)
        .when(Boolean(source), (el) => el.tooltip(source))
        .child(legend("↑↓", "model")).child(legend("←→", "effort")).child(legend("↵", "apply")).child(legend("esc", "cancel"))
        .child(fitLabel("switch-source", source).flex_1().text_right())
        .child(textButton(t, "switch-apply", "Apply", "This session only", (_e, cx) => this.applySwitch(term, cx), { disabled: !s.models.length, h: 24 })));
  }

  // A frame placed the list (its renderer's call): following stops when the reader scrolled the end out of view and
  // starts again once it is back in view (lib/tail.js followAfter). The chat draws again after layout to hold, or stop
  // holding, the end: cx.notify() is refused inside the renderer.
  placed(s, range, cx) {
    const atEnd = rangeAtEnd(range);
    if (atEnd == null) return;
    const next = followAfter(s.follow !== false, { atEnd, wasAtEnd: s.atEnd, scrolled: s.scrolled });
    s.atEnd = atEnd; s.scrolled = false;
    if (next === (s.follow !== false)) return;
    s.follow = next;
    cx.spawn(async (cx) => { await cx.sleep(0); this.acx?.notify(); });
  }

  // The timeline's rows, drawn by the child view in its own render (so their handlers belong to it). What it needs
  // from the chat's render is in this.tlArgs.
  timelineColumn(cx) {
    const a = this.tlArgs;
    if (!a) return div();
    const { t, s, src, term, kind, address } = a;
    const all = src.thread.rows();
    // Newest at the bottom (design chat-direction.md section 3): while it follows, the timeline holds the newest rows of
    // about three screens (lib/tail.js). While a person reads (a wheel or a key in the timeline, a call or group opened,
    // Show earlier), the rows drawn stay as they are, at both ends, so nothing moves under them; "Show the latest only"
    // and a send follow again.
    const following = s.follow !== false;
    // While reading, the window is held by an entry of its last row (a work group's own key changes when earlier
    // calls join it): the full tail taking the short read's place puts earlier rows in front, and the same indexes
    // would point at other rows.
    if (!following && s.lastKey && !holds(all[(s.lastTo ?? 0) - 1], s.lastKey)) {
      const at = all.findIndex((r) => holds(r, s.lastKey));
      if (at >= 0) { s.lastFrom = (s.lastFrom ?? 0) + at + 1 - s.lastTo; s.lastTo = at + 1; }
    }
    const view = this.height - 52 - (SUPPORT[kind]?.level === "partial" ? 28 : 0) - 170;
    // The last two rows are always drawn: a newest work group taller than the estimate still shows (its calls are
    // one-line headers until opened).
    const tail = s.showEarlier ? 0 : following ? Math.min(tailStart(all, { column: this.column(), height: view * 3 }), Math.max(0, all.length - 2))
      : Math.min(s.lastFrom ?? 0, all.length);
    const from = tail;
    if (following) { s.lastFrom = from; s.lastTo = all.length; s.lastKey = anchorOf(all.at(-1)); }
    const rows = following ? all.slice(from) : all.slice(from, Math.max(from, s.lastTo ?? all.length));
    s.drawnRows = rows; // what the editors are kept for (syncEditors)
    let lastWork = -1;
    rows.forEach((r, i) => { if (r.type === "work") lastWork = i; });
    const support = SUPPORT[kind];
    const items = [];
    const kinds = []; // what each item is, for the gap above it (design section 3)
    // The render receipt for unread (audit H4): the newest agent record this render shows and when the read it came
    // from caught up, only while the timeline follows its end.
    this.drawn = this.shown() && rows.length && following && !s.showEarlier
      ? { address, gen: src.gen, at: Date.now(), answerAt: answerAt(src.thread), readAt: src.caughtUpAt || null } : null;
    if (src.cut && (from === 0 || s.showEarlier)) items.push(div().w_full().text_center().text_size(TYPE.xs).text_color(t.dim).child("Earlier messages are not loaded (long session)."));
    if (from > 0 || s.showEarlier || !following) {
      const latest = s.showEarlier || !following;
      const label = latest ? "Show the latest only" : `Show ${from} earlier`;
      const press = (_e, cx) => { if (latest) { s.showEarlier = false; s.follow = true; s.toEnd = true; } else { s.showEarlier = true; s.follow = false; } cx.notify(); };
      items.push(h_flex().w_full().justify_center().child(focusRing(div(), t, press)
        .id("earlier").px(SPACE[3]).h(ROW.compact).flex().items_center().rounded(RADIUS.md).cursor_pointer()
        .text_size(TYPE.xs).text_color(t.muted).hover((st) => st.bg(t.hover)).role("button").accessibility_label(label)
        .on_click(press).child(label)));
    }
    while (kinds.length < items.length) kinds.push("notice");
    rows.forEach((r, i) => {
      kinds.push(r.type);
      if (r.type === "user") items.push(this.userRow(t, r));
      else if (r.type === "assistant") items.push(this.assistantRow(t, r));
      else if (r.type === "work") items.push(this.workGroup(t, r, i === lastWork && i >= rows.length - 2));
      else if (r.type === "notice") items.push(div().w_full().text_center().text_size(TYPE.xs).text_color(t.dim).child(r.text));
      else if (r.type === "hook") items.push(hookRow(t, r)); // display only (owner request 35)
      else kinds.pop();
    });
    if (src.skipped) items.push(div().w_full().text_center().text_size(TYPE.xs).text_color(t.dim).child(`${src.skipped} record${src.skipped === 1 ? "" : "s"} too large to show ${src.skipped === 1 ? "was" : "were"} skipped.`));
    s.pending = s.pending.filter((p) => stillPending(p, src.thread.entries, Date.now()));
    // With nothing to show yet, the state block stands where the first message will (lib/appear.js).
    const instead = a.block && rows.length === 0 && !s.pending.length;
    if (instead) items.push(stateBlock(t, a.block, a.ctx));
    // What was sent and not yet recorded: the last user rows, dim, "Sending…" (lib/composer.js stillPending).
    // The user bubble's own shape, its words muted, and "Sending…" under it (design section 7: dimmed once, not twice).
    s.pending.forEach((p, i) => items.push(v_flex().id(`pending-${i}`).w_full().items_end().gap(SPACE[1])
      .role("status").accessibility_label(`Sending: ${p.text}`)
      .child(div().max_w(this.column() * 0.8).px(SPACE[4]).py(SPACE[2]).rounded(RADIUS.xl).bg(t.raised).text_size(TYPE.lg).line_height("22px").text_color(t.muted).child(p.text))
      .child(div().text_size(TYPE.xs).line_height(`${SPACE[3] + SPACE.half}px`).text_color(t.muted).child("Sending…"))));
    while (kinds.length < items.length) kinds.push(kinds.length >= items.length - s.pending.length ? "user" : "notice");
    const observed = this.observedRow(t, term);
    if (observed) items.push(observed);
    if (a.block && !instead) items.push(stateBlock(t, a.block, a.ctx)); // under a conversation: what is going on with it

    while (kinds.length < items.length) kinds.push("status"); // the working line, the blocked card, the state block
    // One gap above each row by what meets there (design section 3): after a user message 16, before one 24, between
    // an answer and work 12, between answers, notices and hooks 8; the working line and blocked card 16.
    const gap = (prev, cur) => (prev == null ? 0 : cur === "user" ? SPACE[6] : prev === "user" ? SPACE[4]
      : (prev === "assistant" && cur === "work") || (prev === "work" && cur === "assistant") ? SPACE[3]
      : ["assistant", "notice", "hook"].includes(prev) && ["assistant", "notice", "hook"].includes(cur) ? SPACE[2] : SPACE[4]);
    // The thread is one column, at least the viewport tall with its rows at the bottom, that a retained child view
    // draws (TimelineView) as the one item of a virtual list (render); its measured height is that item's size.
    const inset = this.inset();
    const wrap = (el, i) => h_flex().id(`tl-${i}`).w_full().flex_none().justify_center().px(inset).pt(gap(kinds[i - 1], kinds[i]))
      .child(v_flex().w_full().max_w(COLUMN).child(el));
    // Following changed under the child (Show the latest only): the parent draws again to hold the end.
    if (following !== this.tlFollowing) { this.tlFollowing = following; cx.spawn(async (cx) => { await cx.sleep(0); this.acx?.notify(); }); }
    // Its measured height is in window pixels; the list's sizes are in the layout's unzoomed units.
    return v_flex().id("tl-column").w_full().min_h(Math.max(0, (this.listH ?? 0) - END_GAP)).justify_end()
      .on_size_change((size) => { const h = size.height / (settings().zoom || 1); if (Math.abs(h - (this.tlH ?? 0)) > 0.5) { this.tlH = h; this.acx?.notify(); } })
      .children(items.map(wrap));
  }

  render(cx) {
    this.fit(); // first: everything below sizes from this.width
    const t = theme();
    const address = this.updateTarget();
    this.rememberTab();
    this.syncDraft();
    const shownGen = this.view.observe(this.shown(), this.target);
    const root = (el) => withFont(v_flex()).id("chat-root").size_full().bg(t.canvas).on_size_change((size, cx) => { if (!this.laid && (Math.abs(size.width - this.width) > 1 || Math.abs(size.height - this.height) > 1)) { this.width = size.width; this.height = size.height; cx.notify(); } }).relative().child(el).when(Boolean(this.agentMenu), (r) => r.child(this.agentMenuView(t)));
    const term = address ? terminals().find((x) => x.address === address) : null;
    // A terminal whose machine is away keeps the kind its chat was shown with, so its conversation stays (owner's
    // agents mostly run on another machine); a local terminal that became a plain shell still shows the shell page.
    const away = this.away(address);
    const kind = agentKind(term) ?? (away ? this.agents.get(address)?.kind ?? null : null);
    const s = kind && MAPPERS[kind] ? this.cur() : null;
    const src = s?.src ?? null;
    // Shown again, or another agent: its feed is stepped in this pass, not at the loop's next turn.
    if (shownGen !== this.stepped) { this.stepped = shownGen; if (this.shown() && s && !s.src.legacy && !away) this.stepFeed(s, term, cx); }
    // What stands in place of the conversation, or under it (lib/appear.js): decided once, drawn by states.js.
    const waiting = Boolean(src) && (src.state === "finding" || Boolean(src.stale));
    if (s) s.since = waiting ? s.since ?? Date.now() : null;
    const on = machineOf(address);
    const look = appearance({ address, agent: Boolean(kind), kindName: kind ? kindName(kind) : null, supported: Boolean(kind && MAPPERS[kind]), note: SUPPORT[kind]?.note ?? null,
      program: term?.program?.name ?? null, state: away && src ? "offline" : src?.state ?? null, reason: src?.reason ?? null, rows: src ? src.thread.entries.filter((e) => e.type !== "turn-end").length : 0,
      pending: s?.pending.length ?? 0, stale: Boolean(src?.stale), since: s?.since ?? null, now: Date.now(), machine: on ? machineLabel(on) : null });
    const ctx = { act: (action, cx) => (action === "retry" ? this.retry(cx) : this.openTerminal()), hit: (desktop) => this.hit(desktop) };
    if (look.page) return root(look.page.header ? v_flex().size_full().child(this.header(t, term, kind)).child(statePage(t, look.page, ctx)) : statePage(t, look.page, ctx));
    const head = this.header(t, term, kind);

    // The child view draws the rows (timelineColumn); this render keeps the list at the end while it follows.
    this.tlArgs = { t, s, src, term, kind, address, block: look.block, ctx };
    const following = s.follow !== false;
    const support = SUPPORT[kind];
    const inset = this.inset();
    // The view the list's sizes are made for: the timeline's region (the column less the header and the composer),
    // measured once laid out; until then the chat's height less the header (and the partial support line), so the first
    // render already draws rows. The list's own box fills the region (size_full), so it never waits for this.
    const listH = this.tlView ?? Math.max(0, Math.floor(this.height) - HEAD - (support?.level === "partial" ? ROW.base : 0));
    this.listH = listH;
    // Following, the list is held at its end by the list's own scroll_to_bottom (exact at any offset; a plain
    // scroll area's scroll_to_item isn't, L1). The child draws again with what changed.
    if (following) { this.tlScroll.scroll_to_bottom(); s.toEnd = false; }
    if (this.tl) cx.spawn(async (cx) => { await cx.sleep(0); this.tl?.set_props({ draw: this.tlDraw, rev: ++this.tlRev }); }); // after this render, never in it
    const reading = (cx) => { if (s.follow !== false) { s.follow = false; cx.notify(); } };
    const timeline = v_flex().id("timeline").size_full().role("log")
      .on_size_change((size, cx) => { const h = Math.floor(size.height / (settings().zoom || 1)); if (h !== this.tlView) { this.tlView = h; cx.notify(); } })
      .on_scroll_wheel(() => { s.scrolled = true; }) // the next placed frame decides, from where the list is (placed)
      .on_key_down((e, cx) => { if (["up", "pageup", "home"].includes(e?.key)) reading(cx); })
      .when(Boolean(this.tl && listH), (el) => el
        .child(v_virtual_list("chat-tl", 3, listSizes(listH, this.tlH ?? 0), (i) => ["thread", "end", "mark"][i],
          (range, cx) => { this.placed(s, range, cx); return [div().size_full().child(this.tl), div().id("tl-end").size_full(), div().id("tl-mark").size_full()].slice(range.start, range.end); })
          .track_scroll(this.tlScroll).size_full())
        .child(Scrollbar.vertical("chat-tl").absolute().inset_0()));

    return root(v_flex().size_full().min_h(0)
      .child(head)
      .when(support?.level === "partial", (el) => el.child(h_flex().h(ROW.base).flex_none().px(SPACE[4]).gap(SPACE[2]).items_center().border_b(1).border_color(t.border)
        .text_size(TYPE.xs).text_color(t.muted).child(div().size(ICON.dot).flex_none().rounded(ICON.dot / 2).bg(t.blocked)).child(`Partial support: ${support.note}.`)))
      // The timeline's region takes what the composer leaves and clips at its edge; the composer sits under it, in the
      // same column, so the list never runs under the composer (L1).
      .child(div().flex_1().min_h(0).relative().overflow_hidden().child(timeline))
      .child(v_flex().id("chat-foot").flex_none().w_full().bg(t.canvas)
        // The composer stays through loading, a dropped machine and a failed read: Core delivers what is sent.
        .when(look.composer, (el) => el.child(h_flex().w_full().flex_none().justify_center().px(inset).pb(SPACE[4]).pt(SPACE[1]).child(this.composer(t, term, kind, cx))))));
  }
}
