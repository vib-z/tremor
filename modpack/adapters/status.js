// One reading of agent status for the tree, the tabs, the pane header and the factory.
// Pure: takes the app's live lists as plain data, so `bun test` runs it.
//
// Adapted from Herdr App's shipped `agents` mod (herdrdev/herdr-app@2405bf3, defaults/mods/agents/main.js:31-58,
// 175-184: the lead rule, the tab title rule, sub-agents by `parent`), from herdr-t3's status rule
// (JinJieBeWater/herdr-t3@e277ffa, mods/t3-agents/tree.js: error needs the person, a waiting parent is at work)
// and from herdr-agents-tree's 7501 `records` rows (h0ru5/herdr-agents-tree@d8ea4b9, mods/agents-tree/main.js:103-123).
// All three Apache-2.0; see modpack/NOTICE.md. Changed: one display word per row, records nested by their
// `a/b` ids (herdr-core status.rs: `clear` removes a record and its children) instead of transcript metadata,
// and an "exited" word for a terminal that reported once and is back at its shell.

// Display words. `needs` is blocked or error: the person has to act.
export const RANK = { needs: 4, done: 3, working: 2, idle: 1, exited: 0 };

const LABEL = {
  working: "Working",
  needs: "Needs you",
  done: "Done, not seen yet",
  idle: "Idle",
  exited: "Exited",
};

// The status at a row's right end as option A writes it (visual contract), beside its marker: the sidebar and Cmd+K.
export const STATUS_WORD = { working: "Working", idle: "Ready", done: "Done", needs: "Needs you" };

// A raw Core word or an agents() word to a display word; null when nothing was reported.
export function displayWord(raw) {
  if (raw === "blocked" || raw === "error") return "needs";
  if (raw === "working" || raw === "done" || raw === "idle") return raw;
  return null;
}

// What a status icon announces: the word, and for needs-you the program's own kind.
export function statusLabel(word, kind) {
  if (!word) return "No status reported";
  const base = LABEL[word] ?? word;
  if (word === "needs" && kind) return `${base}: ${kind}`;
  return base;
}

// The most urgent of several display words.
export function topWord(words) {
  let top = null;
  for (const w of words) if (w && (top == null || RANK[w] > RANK[top])) top = w;
  return top;
}

// A sub-agent without a pane isn't in agents(): its raw word. It is never "done": it reports to its parent,
// and the parent's done is the news (shipped agents mod, kidStatus).
export function kidWord(k, listed) {
  const raw = k.status === "error" ? "error" : listed.get(k.address)?.status ?? k.status;
  const w = displayWord(raw);
  return w === "done" ? "idle" : w;
}

// The shipped lead rule: per tab, its first agent pane, else its focused terminal, else its first terminal.
// `key`: the tab a pane is in (its tab id, or its workspace and tab where tab ids repeat: paneHomes).
export function leadPanes(panes, key = (p) => p.tab) {
  const leads = new Map();
  for (const p of panes) {
    if (!p.terminal) continue;
    const current = leads.get(key(p));
    if (!current || (!current.program?.agent && (p.program?.agent || (!current.focused && p.focused)))) leads.set(key(p), p);
  }
  return leads;
}

// Each pane's workspace (owner, 14 Nov: studio-mac chosen showed no workspaces). Herdr 0.1.15 ids a tab made from
// a `herdr.tab` label "<machine>/<label>", with no workspace in it: two native Core jobs on one machine, each with a
// "main" tab, both list "studio-mac/main", and a pane carries only its tab id. A pane is in the workspace listing
// its tab, or, where several do, the one its terminal's `herdr.space` label names (a machine's labels omit its
// prefix), else the first. By pane id; the tree, the tab bar and the factory hang panes under tabs through it.
export function paneHomes(spaces, panes, terminals) {
  const byAddress = new Map(terminals.map((t) => [t.address, t]));
  const listing = new Map();
  for (const s of spaces) for (const t of s.tabs) listing.set(t.id, [...(listing.get(t.id) ?? []), s]);
  return new Map(panes.map((p) => {
    const all = listing.get(p.tab) ?? [];
    const label = byAddress.get(p.terminal)?.labels?.["herdr.space"];
    return [p.pane, (all.find((s) => label != null && (s.machine ? `${s.machine}/${label}` : label) === s.id) ?? all[0])?.id ?? null];
  }));
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

// The shipped row title: a tab someone named, else the agent's own telling title, else the program.
export function rowTitle(tab, pane) {
  const prog = pane?.program?.name;
  const live = clean(pane?.title);
  const telling = live && live !== prog && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== pane?.program?.key;
  if ((tab.name === prog || !tab.named) && telling) return live;
  if (!tab.named) return prog || tab.name;
  return tab.name;
}

// Live sub-agents of `address`, depth first, each with the thin tree lines in front of it.
export function subTree(all, address, lead = [], seen = new Set()) {
  if (seen.has(address)) return [];
  seen.add(address);
  const kids = all.filter((k) => k.parent === address && k.state === "live" && !seen.has(k.address));
  return kids.flatMap((k, i) => {
    const last = i === kids.length - 1;
    return [{ terminal: k, lines: [...lead, last ? "└" : "├"] }, ...subTree(all, k.address, [...lead, last ? " " : "│"], seen)];
  });
}

// A terminal's in-process sub-agents from its 7501 records, nested by `parent/child` ids.
export function recordRows(terminal, lead = []) {
  const records = terminal?.records ?? {};
  const ids = Object.keys(records).sort();
  const childrenOf = (parent) => ids.filter((id) => {
    const cut = id.lastIndexOf("/");
    const p = cut < 0 ? null : id.slice(0, cut);
    // A child whose parent record is gone hangs under the terminal.
    return parent === null ? p === null || !records[p] : p === parent;
  });
  const walk = (parent, lines) => {
    const kids = childrenOf(parent);
    return kids.flatMap((id, i) => {
      const last = i === kids.length - 1;
      const r = records[id];
      const word = displayWord(r?.state);
      return [
        { id, title: r?.title || r?.app || "in-process sub-agent", word: word === "done" ? "idle" : word, kind: r?.kind ?? null, lines: [...lines, last ? "└" : "├"] },
        ...walk(id, [...lines, last ? " " : "│"]),
      ];
    });
  };
  return walk(null, lead);
}

// Words of everything under a row: live sub-agents and every record, all the way down.
export function underWords(all, address, listed) {
  const words = [];
  for (const s of subTree(all, address)) {
    words.push(kidWord(s.terminal, listed));
    for (const r of recordRows(s.terminal)) words.push(r.word);
  }
  const own = all.find((t) => t.address === address);
  for (const r of recordRows(own)) words.push(r.word);
  return words;
}

// A row's word with what's under it: needs-you anywhere first, then its own unseen done, then busy or
// waiting on working sub-agents, else its own (herdr-t3 treeStatus).
export function treeWord(own, under) {
  if (own == null && !under.some(Boolean)) return own;
  if (own === "needs" || under.includes("needs")) return "needs";
  if (own !== "done" && under.includes("working")) return "working";
  return own ?? topWord(under);
}

// A terminal that reported once and now shows its shell with no status: its agent exited.
export function exited(terminal, pane) {
  return Boolean(terminal?.reported) && terminal?.status == null && Boolean(pane?.program?.shell);
}

// The whole sidebar model: workspaces in Herdr's order, under each its tabs' leads (and any other agent
// pane of the tab), under each lead its sub-agents by `parent` and its records.
export function buildTree({ spaces, panes, terminals, agents }) {
  const listed = new Map(agents.map((a) => [a.address, a]));
  const byAddress = new Map(terminals.map((t) => [t.address, t]));
  const leads = leadPanes(panes);
  // Every terminal shown nested somewhere gets no row of its own.
  const nested = new Set();
  for (const t of terminals) for (const s of subTree(terminals, t.address)) nested.add(s.terminal.address);

  const leadRow = (tab, pane, many) => {
    const t = byAddress.get(pane.terminal);
    const a = listed.get(pane.terminal);
    const own = a ? displayWord(a.status) : t ? displayWord(t.status) : null;
    const word = exited(t, pane) ? "exited" : own;
    const subs = subTree(terminals, pane.terminal).map((s) => ({
      address: s.terminal.address,
      name: s.terminal.name || s.terminal.template || s.terminal.program?.name || s.terminal.address,
      program: s.terminal.program ?? null,
      word: kidWord(s.terminal, listed),
      kind: s.terminal.report?.kind ?? null,
      lines: s.lines,
      pane: panes.find((p) => p.terminal === s.terminal.address)?.pane ?? null,
      records: recordRows(s.terminal, s.lines.map((l) => (l === "└" ? " " : l === "├" ? "│" : l))),
    }));
    const records = recordRows(t);
    // The lead's own records come after its sub-agents, at the same level: the last sub-agent branches on.
    if (records.length && subs.length) {
      for (const sub of subs) {
        if (sub.lines[0] === "└") sub.lines = ["├", ...sub.lines.slice(1)];
        else if (sub.lines[0] === " ") sub.lines = ["│", ...sub.lines.slice(1)];
        sub.records = sub.records.map((r) => ({ ...r, lines: r.lines[0] === " " ? ["│", ...r.lines.slice(1)] : r.lines }));
      }
    }
    const under = [...subs.flatMap((s) => [s.word, ...s.records.map((r) => r.word)]), ...records.map((r) => r.word)];
    return {
      address: pane.terminal,
      pane: pane.pane,
      tab: tab.id,
      name: many ? rowTitle({ ...tab, named: false }, pane) : rowTitle(tab, pane),
      program: pane.program ?? null,
      agent: Boolean(pane.program?.agent || a),
      focused: pane.focused,
      word: word === "exited" ? word : treeWord(own, under),
      ownWord: word,
      kind: t?.report?.kind ?? null,
      title: t?.report?.title || t?.title || "",
      subs,
      records,
    };
  };

  return spaces.map((s) => {
    const rows = [];
    for (const tab of s.tabs) {
      const tabPanes = panes.filter((p) => p.tab === tab.id && p.terminal);
      const lead = leads.get(tab.id);
      if (!lead) continue;
      const agentPanes = tabPanes.filter((p) => p !== lead && p.program?.agent && !nested.has(p.terminal));
      const many = agentPanes.length > 0;
      if (!nested.has(lead.terminal)) rows.push(leadRow(tab, lead, many));
      for (const p of agentPanes) rows.push(leadRow(tab, p, true));
    }
    return {
      id: s.id,
      name: s.name,
      active: s.active,
      machine: s.machine ?? null,
      folder: s.folder,
      word: topWord(rows.map((r) => r.word).filter((w) => w !== "exited")),
      rows,
    };
  });
}

// ---- The sidebar as Herdr's own hierarchy: workspace → tab → pane (owner, 2026-11-09 B) ----
//
// Each terminal appears once. A pane sits under its tab; a Core sub-agent sits under its parent, whether it has
// no pane (a background `hc run --parent`) or a pane in the same tab; a sub-agent with a pane in another tab
// sits in that tab. A terminal's 7501 records hang under it, nested by their `a/b` ids. Words roll up: a row
// with something needing you under it needs you, a parent waiting on working children is working (treeWord).

// In-process records as nested nodes.
export function recordTree(terminal) {
  const records = terminal?.records ?? {};
  const ids = Object.keys(records).sort();
  const parentOf = (id) => {
    const cut = id.lastIndexOf("/");
    const p = cut < 0 ? null : id.slice(0, cut);
    return p && records[p] ? p : null;
  };
  const under = (parent) => ids.filter((id) => parentOf(id) === parent).map((id) => {
    const r = records[id];
    const w = displayWord(r?.state);
    return { type: "rec", id, owner: terminal.address, title: r?.title || r?.app || "in-process sub-agent", word: w === "done" ? "idle" : w, kind: r?.kind ?? null, items: under(id) };
  });
  return under(null);
}

const wordsUnder = (items) => items.flatMap((n) => [n.word, ...wordsUnder(n.items)]);

// What to call what runs in a terminal: the agent kind when one is detected (Hermes under its Python launcher is
// Hermes, not Python), else the program's name.
export const kindOrProgram = (kind, program, fallback) => kind || program?.name || fallback || "Terminal";

// A pane's own words: Core's name for it, else what runs there: the agent ("Claude Code"), a program ("Neovim"), a
// shell "Terminal" (owner, 10 Nov: never a folder, "/" or a terminal id; the lead: a shell row is "Terminal").
// A pane row's name (owner, 11 Nov: "let's follow herdr core bits"): the name the terminal was started with when Core
// has one, else what it runs as Herdr reports it (the agent, "Terminal" for a shell). Never a title, folder, id or a
// name of ours: Core can't rename a running terminal, so a pane row isn't renamed.
function paneName(term, pane, kind, agent) {
  return term?.name || kindOrProgram(kind, agent || !pane?.program?.shell ? pane?.program : null);
}

// A tab's lead agent (sidebar mapping, owner-approved 05c691346ef8), literally: among the tab's live agent panes,
// nested ones too, the first in pane order that started another live agent pane in this tab (Core's `parent`), else
// the first in pane order. The focused pane never decides; an agent back at its shell leads nothing, and an agent
// it started that survives can lead (review N1, N2).
const liveAgent = (n) => n.type === "pane" && n.agent && n.ownWord !== "exited";
export function leadOf(items) {
  const found = [];
  const walk = (list) => { for (const n of list) { if (n.type !== "pane") continue; if (n.pane && !n.mod && liveAgent(n)) found.push(n); walk(n.items); } };
  walk(items);
  found.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  // "Started another agent in this tab": a live child agent with its own pane here. A paneless sub-agent doesn't
  // count (the approved case 3: Claude leads while Codex has research-chat under it).
  return found.find((n) => n.items.some((c) => c.pane && liveAgent(c))) ?? found[0] ?? null;
}

// The tab's rows without its lead: a lead found nested (under the shell its parent returned to) is lifted out.
function without(items, lead) {
  return items.filter((n) => n !== lead).map((n) => (n.items?.length ? { ...n, items: without(n.items, lead) } : n));
}

// What a tab is called in every view (the sidebar, the tab bar, the factory's zones). Its lead agent's mark shows
// the kind, so the words are a name someone gave: the tab's (owner request 14), else Core's name for its lead
// terminal (`own`). A tab nobody named is called by its agent ("Claude Code"), else `plain` (a program's name, a
// shell's "Terminal"): never a terminal id ("t1") or a folder ("/") (owner, 10 Nov). The kind stays in `kind` (the
// mark's words), the tooltip and the accessible name. `badge` stays null for callers that still draw one.
// Herdr's terminal.open names its tab "shell" (0.1.15): the app's default, not a name someone gave, so it counts as
// unnamed (the lead's after-shots: a plain shell is "Terminal" everywhere).
const APP_TAB_NAMES = new Set(["shell"]);
const namedTab = (tab) => tab.named !== false && !APP_TAB_NAMES.has(tab.name);
export function tabLabel(tab, lead, { plain = "Terminal", own = null } = {}) {
  if (!lead) { const text = namedTab(tab) ? tab.name : plain; return { text, badge: null, kind: null, aria: `Tab ${text}` }; }
  const kind = lead.kindName || lead.program?.name || lead.name;
  if (namedTab(tab)) return { text: tab.name, badge: null, kind, aria: `${kind}, lead agent of tab ${tab.name}` };
  const text = own || kind;
  return { text, badge: null, kind, aria: text === kind ? `${kind}, lead agent of this tab` : `${text}: ${kind}, lead agent of this tab` };
}

// Fitting a header into a width (the factory's zones; a G9-style estimate): the badge never clips; the extras
// (listed most-wanted first) drop from the end before the name gives way; then the name truncates (`nameMax`, px).
// Text is estimated at 0.6 em a character, the mono width, so real text never runs past the estimate.
// `need`: the room that shows name and badge whole, for a zone to grow to. Only when the name is down to a few
// characters does the badge truncate too (`badgeMax`, px; its full words go in the tooltip and accessible name).
export function fitHead({ room, fixed = 0, name, nameSize = 12, badge = null, extras = [], small = 11, gap = 6 }) {
  const w = (s, size) => String(s ?? "").length * size * 0.6;
  const fullBadgeW = badge ? w(badge, small) + 10 + gap : 0;
  const extraW = (list) => list.reduce((sum, e) => sum + w(e, small) + gap, 0);
  const nameW = w(name, nameSize);
  const need = Math.ceil(fixed + nameW + fullBadgeW);
  const kept = [...extras];
  while (kept.length && fixed + nameW + fullBadgeW + extraW(kept) > room) kept.pop();
  const left = Math.max(0, room - fixed - fullBadgeW - extraW(kept));
  const minName = Math.min(nameW, w("xxxxx", nameSize));
  if (left >= minName) return { extras: kept, nameMax: nameW > left ? Math.floor(left) : null, badgeMax: null, badgeW: fullBadgeW, nameW, need };
  // Last resort: a few characters of the name, the badge truncated in what is left.
  const badgeMax = Math.max(0, Math.floor(room - fixed - minName - gap));
  return { extras: kept, nameMax: Math.floor(minName), badgeMax, badgeW: Math.min(fullBadgeW, badgeMax + gap), nameW, need };
}

// Every tab's label and lead, for the tab bar and the factory board (the same rule as the sidebar's rows).
export function tabHeads(model) {
  const heads = new Map();
  for (const s of model) for (const t of s.tabs) heads.set(t.id, { ...t.label, lead: t.lead ? { pane: t.lead.pane, address: t.lead.address } : null });
  return heads;
}

// `kindOf(terminal)`: the detected agent kind's name, or null (the mods pass agents.js's agentKind and kindName).
// Every tab is a row, one Herdr hides from its own lists too: the pack keeps no second list of tabs (owner, 10 Nov).
export function buildPaneTree({ spaces, panes, terminals, agents, kindOf = () => null }) {
  const listed = new Map(agents.map((a) => [a.address, a]));
  const byAddress = new Map(terminals.map((t) => [t.address, t]));
  const paneOf = new Map(panes.filter((p) => p.terminal).map((p) => [p.terminal, p]));
  const paneOrder = new Map(panes.map((p, i) => [p.pane, i]));
  // A tab by its workspace too: tab ids repeat across workspaces (paneHomes), so a pane's place is both.
  const homes = paneHomes(spaces, panes, terminals);
  const where = (p) => `${homes.get(p.pane)}\n${p.tab}`;
  const leads = leadPanes(panes, where);
  const repeated = new Set(spaces.flatMap((s) => s.tabs.map((t) => t.id)).filter((id, i, all) => all.indexOf(id) !== i));

  // The pane a terminal hangs from: up its Core parents, through paneless ones, to the first with a pane.
  const anchor = (address) => {
    const seen = new Set();
    let at = byAddress.get(address)?.parent;
    while (at && !seen.has(at)) {
      seen.add(at);
      if (paneOf.has(at)) return paneOf.get(at);
      const t = byAddress.get(at);
      if (!t || t.state !== "live") return null;
      at = t.parent;
    }
    return null;
  };

  const node = (address, place, seen) => {
    seen.add(address);
    const t = byAddress.get(address);
    const p = paneOf.get(address) ?? null;
    const a = listed.get(address);
    let own;
    if (p) own = exited(t, p) ? "exited" : a ? displayWord(a.status) : t ? displayWord(t.status) : null;
    else own = t ? kidWord(t, listed) : null;
    const kids = terminals.filter((k) => k.parent === address && k.state === "live" && !seen.has(k.address)
      && (!paneOf.has(k.address) || where(paneOf.get(k.address)) === place));
    const items = [...kids.map((k) => node(k.address, place, seen)), ...recordTree(t)];
    const under = wordsUnder(items);
    const kind = t ? kindOf(t) : null;
    return {
      type: "pane",
      key: p ? `pn:${p.pane}` : `tm:${address}`,
      pane: p?.pane ?? null,
      order: p ? paneOrder.get(p.pane) : Infinity,
      address,
      name: p ? paneName(t, p, kind, Boolean(kind || p.program?.agent || t?.program?.agent || a || t?.report)) : t?.name || kindOrProgram(kind, t?.program),
      program: p?.program ?? t?.program ?? null,
      kindName: kind,
      agent: Boolean(kind || p?.program?.agent || t?.program?.agent || a || t?.report),
      focused: Boolean(p?.focused),
      sub: Boolean(t?.parent && byAddress.has(t.parent)),
      word: own === "exited" ? own : treeWord(own, under),
      ownWord: own,
      // When Core last saw its status change (`hc get` status_ms), for the row's relative time; null when unknown.
      statusAt: t?.status_ms ?? null,
      pinned: Boolean(a?.pinned),
      kind: t?.report?.kind ?? null,
      items,
    };
  };

  return spaces.map((s) => {
    const tabs = s.tabs.map((tab) => {
      const seen = new Set();
      const place = `${s.id}\n${tab.id}`;
      const inTab = panes.filter((p) => where(p) === place);
      const items = [];
      for (const p of inTab) {
        if (!p.terminal) {
          items.push({ type: "pane", key: `pn:${p.pane}`, pane: p.pane, address: null, name: p.title || p.mod || "Panel", program: null, agent: false, focused: p.focused, mod: true, word: null, items: [] });
          continue;
        }
        const up = anchor(p.terminal);
        if (seen.has(p.terminal) || (up && where(up) === place)) continue;
        items.push(node(p.terminal, place, seen));
      }
      // An agent-led tab is one row: the lead's own pane row folds into it, and the lead's sub-agents and the
      // tab's other panes hang under it (sidebar mapping, owner-approved 05c691346ef8).
      const pick = leads.get(place);
      const lead = leadOf(items);
      const label = tabLabel(tab, lead, { plain: (!pick?.program?.shell && pick?.program?.name) || "Terminal", own: lead && byAddress.get(lead.address)?.name });
      // One row per agent or terminal (owner, 10 Nov): a tab of one pane with no agent leading it (a shell, a
      // program) is that pane's row too; only a tab of two or more panes keeps child rows.
      const rest = lead ? without(items, lead) : items.length === 1 && !items[0].items.length ? [] : items;
      return {
        type: "tab",
        // A tab id another workspace lists too gets its workspace in the key: a row's key is drawn once.
        key: repeated.has(tab.id) ? `tb:${s.id}|${tab.id}` : `tb:${tab.id}`,
        id: tab.id,
        space: s.id,
        name: label.text,
        badge: label.badge,
        label,
        tabName: tab.name,
        lead,
        active: tab.active,
        word: topWord([...(lead ? [lead] : []), ...items].map((n) => n.word).filter((w) => w !== "exited")),
        leadWord: lead ? lead.ownWord : null,
        changedAt: tab.changed_at ?? null,
        items: lead ? [...lead.items, ...rest] : rest,
      };
    });
    return {
      type: "space",
      key: `sp:${s.id}`,
      id: s.id,
      name: s.name,
      active: s.active,
      machine: s.machine ?? null,
      folder: s.folder,
      word: topWord(tabs.map((t) => t.word)),
      tabs,
    };
  });
}

// The drawable rows, depth first, honouring folds (a Set of keys): workspaces, their tabs, the rows under a tab with
// thin-line glyphs: │ continues, ├ branches, └ ends, " " nothing.
export function treeRows(spaces, folded = new Set()) {
  const out = [];
  const walk = (items, lines, ctx) => items.forEach((n, i) => {
    const last = i === items.length - 1;
    const key = n.type === "rec" ? `rc:${n.owner}#${n.id}` : n.key;
    out.push({ ...ctx, type: n.type, key, node: n, lines: [...lines, last ? "└" : "├"] });
    if (n.items.length && !folded.has(key)) walk(n.items, [...lines, last ? " " : "│"], ctx);
  });
  for (const s of spaces) {
    out.push({ type: "space", key: s.key, node: s, space: s, lines: [] });
    if (folded.has(s.key)) continue;
    for (const tab of s.tabs) {
      out.push({ type: "tab", key: tab.key, node: tab, space: s, tab, lines: [] });
      if (!folded.has(tab.key)) walk(tab.items, [], { space: s, tab });
    }
  }
  return out;
}

// Machines (owner 17:37, request 1), from the app's own data only: the spaces' `machine`, `machines()` and
// `hc machine ls --json` (`listed`; temporary ones left out, as the default sidebar does, herdr-app
// defaults/mods/spaces/main.js:120). This computer first, then the others by name. `id` is the hide-list key ("" for
// this computer, as the filter names it). `state`: words for one that doesn't answer yet (the default sidebar's, spaces/main.js:294-322).
export function machineList({ spaces = [], machines = [], listed = [] }) {
  const names = new Set();
  for (const s of spaces) if (s.machine) names.add(s.machine);
  for (const m of machines) if (m.name) names.add(m.name);
  for (const m of listed) if (m.name && !m.temporary) names.add(m.name);
  const state = (name) => {
    const layout = machines.find((m) => m.name === name)?.layout;
    const entry = listed.find((m) => m.name === name);
    if (entry?.state && entry.state !== "connected") return entry.state.replace(/_/g, " ");
    if (layout === "loading" || (!layout && entry?.state === "connected")) return "loading";
    if (layout === "unavailable") return "unavailable";
    return null;
  };
  return [null, ...[...names].sort()].map((name) => ({ name, id: name ?? "", label: machineLabel(name), state: name ? state(name) : null, entry: listed.find((m) => m.name === name) ?? null }));
}

// Every agent a tab holds, once: its lead (whose own children are already in the tab's items) and the items.
export const tabAgents = (tab) => [...(tab.lead ? [{ ...tab.lead, items: [] }] : []), ...tab.items];

// What a fold hides, counted (request 8a): needs you, working, done, in that order; idle and zeros left out.
export function rollup(nodes) {
  const n = { needs: 0, working: 0, done: 0 };
  const walk = (list) => { for (const x of list) { const w = x.type === "rec" ? x.word : x.ownWord; if (w in n) n[w]++; walk(x.items ?? []); } };
  walk(nodes);
  return ["needs", "working", "done"].filter((w) => n[w]).map((word) => ({ word, n: n[word] }));
}
const ROLLUP_WORDS = { needs: (n) => `${n} need${n === 1 ? "s" : ""} you`, working: (n) => `${n} working`, done: (n) => `${n} done` };
export const rollupWords = (counts) => counts.map((c) => ROLLUP_WORDS[c.word](c.n)).join(", ");

// A row's own agent word.
export const ownWord = (n) => (n.type === "rec" ? n.word : n.ownWord ?? null);

// A workspace's git, read as Herdr 0.1.15's own spaces mod reads it.
// The ref-only reads (Herdr 0.1.15 stock spaces/main.js check()), each { code, stdout, stderr }: in parallel,
// `rev-parse --path-format=absolute --show-toplevel` and `--git-common-dir`, then, in a repo, `symbolic-ref -q HEAD`
// and `rev-list --left-right --count HEAD...@{upstream}`. They never scan the worktree or wake its index watch.
export const GIT_READS = {
  top: ["rev-parse", "--path-format=absolute", "--show-toplevel"],
  common: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
  branch: ["symbolic-ref", "-q", "HEAD"],
  counts: ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
};

// One place's git from those answers: null when git says it isn't a repo, { unknown } when it couldn't say, else the
// branch ("detached" without one) and how far ahead and behind its upstream (0 and 0 without one). No "edits not
// committed": only `git status` knows, and it scans the worktree (stock 0.1.15 dropped the mark too).
export function parseGit({ top, common, branch, counts }) {
  if (top?.code !== 0 || common?.code !== 0) return /not a git repository/i.test(top?.code !== 0 ? top?.stderr : common?.stderr) ? null : { unknown: true };
  const [ahead, behind] = counts?.code === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : [0, 0];
  return { branch: branch?.code === 0 ? branch.stdout.trim().replace(/^refs\/heads\//, "") : "detached", ahead: ahead || 0, behind: behind || 0 };
}

// What the row shows after the name: "feat/x", "↑2", "↓1"; "git ?" when git couldn't answer (a machine away); nothing
// for a folder that isn't a repo (null) or not asked yet (undefined).
export function gitTail(g) {
  if (g == null) return null;
  if (g.unknown) return { branch: "git ?", ahead: null, behind: null, aria: "Git status unknown: the machine didn't answer" };
  const words = [`branch ${g.branch}`, g.ahead && `${g.ahead} ahead`, g.behind && `${g.behind} behind`].filter(Boolean);
  return { branch: g.branch, ahead: g.ahead ? `\u2191${g.ahead}` : null, behind: g.behind ? `\u2193${g.behind}` : null, aria: words.join(", ") };
}

// Rename in place (owner, 10 Nov: "double tap to rename in line"; 11 Nov: "let's follow herdr core bits"): what a
// sidebar row renames, its name as drawn. Herdr names workspaces and tabs (a single-pane tab's row is its tab), so only
// those, by its own commands with the captured id. Any other row (a pane, a record, a sub-agent) has none.
export function renameTarget(row, text) {
  if (row?.type === "space") return { key: row.key, kind: "space", id: row.space.id, text };
  if (row?.type === "tab") return { key: row.key, kind: "tab", id: row.tab.id, text };
  return null;
}

// The command saving `typed` runs: none when the name is unchanged; an empty name goes back to Herdr's automatic one.
export function renameSave(target, typed) {
  const name = String(typed ?? "").trim();
  if (!target || name === target.text) return null;
  return [`${target.kind}.rename`, { id: target.id, name }];
}

// The tree's keys (PM review R3, R8): arrows move through the rows drawn; Enter does what a click does; left and
// right fold. Null: the key isn't the tree's.
export function keyAction(key, row) {
  if (key === "down") return { move: 1 };
  if (key === "up") return { move: -1 };
  if (key === "home") return { move: -Infinity };
  if (key === "end") return { move: Infinity };
  if (!row) return null;
  if (key === "enter") return { activate: true };
  const foldable = ["space", "tab"].includes(row.type) || ((row.type === "pane" || row.type === "rec") && row.node?.items?.length > 0);
  if ((key === "left" || key === "right" || key === "space") && foldable) return { fold: key === "space" ? "toggle" : key === "right" ? "open" : "close" };
  return null;
}


// What a sidebar row says and offers, as data the tree mod draws (after Claude Desktop's tree and Moshi's rows):
// a name, then a caret right after it as its fold control (requests 6), never one on the left. Workspace rows are
// bold with a solid caret and a `+`; a tab or child row is its mark then its name (status at the right end)
// (request 8c), every name in one ink (visual contract). A folded row counts what its fold hides (8a).
// `click`: what a click on the row does ("fold", "show" its tab, "focus-lead", "focus").
export function rowSpec(row, folded = new Set()) {
  const open = !folded.has(row.key);
  const caret = (solid, label) => ({ open, solid, label: `${open ? "Collapse" : "Expand"} ${label}` });
  const counts = (nodes) => (open ? [] : rollup(nodes));
  const fold = open ? "expanded" : "collapsed";
  if (row.type === "space") {
    const s = row.space;
    const name = s.name || "~";
    const roll = counts(s.tabs.flatMap(tabAgents));
    return {
      key: row.key, text: name, strong: true, child: false, click: "fold",
      caret: caret(true, `workspace ${name}`),
      // Folded, a workspace row is its name, caret and counts only, as Moshi's (owner request 37): the branch comes
      // back when it opens. No + of its own: the sidebar has one + (spec §3).
      plus: null,
      git: open,
      rollup: roll,
      aria: `Workspace ${name}, ${fold}${roll.length ? `: ${rollupWords(roll)}` : ""}`,
    };
  }
  if (row.type === "tab") {
    const tab = row.tab;
    const shown = tab.active && row.space.active;
    const lead = tab.lead ? { pane: tab.lead.pane, address: tab.lead.address } : null;
    const roll = counts(tab.items);
    const word = lead ? tab.leadWord : null;
    return {
      key: row.key, pinned: Boolean(tab.lead?.pinned), text: tab.name, badge: tab.badge ?? null, strong: false, child: false, shown, lead,
      // The name of an agent-led row focuses its lead's pane (and shows the tab); the caret folds.
      click: lead ? "focus-lead" : "show",
      // A caret only when rows hang under it (the lead's review: none on a row with nothing under it).
      caret: tab.items.length ? caret(false, `tab ${tab.tabName ?? tab.name}`) : null,
      plus: null,
      // The lead's own state on the left; what the fold hides, counted on the right.
      word, rollup: roll,
      mark: { agent: Boolean(tab.lead), label: tab.label?.kind ?? "Terminal" },
      // The lead's own time from Core, else when the tab last changed state (the app's, since it started).
      at: tab.lead?.statusAt ?? tab.changedAt ?? null,
      aria: `${tab.label?.aria ?? `Tab ${tab.name}`}${shown ? ", shown" : ""}${tab.items.length ? `, ${fold}` : ""}${roll.length ? `: ${rollupWords(roll)}` : ""}`,
    };
  }
  if (row.type === "pane") {
    const n = row.node;
    const kind = n.kindName || n.program?.name || (n.mod ? "Panel" : n.sub ? "Sub-agent" : "Terminal");
    const what = n.mod ? "panel" : !n.pane ? "sub-agent without a pane" : n.sub ? "sub-agent pane" : "pane";
    const roll = counts(n.items);
    const word = ownWord(n);
    return {
      key: row.key, pinned: Boolean(n.pinned), text: n.name, strong: false, child: true, click: "focus",
      caret: n.items.length ? caret(false, `sub-agents of ${n.name}`) : null,
      plus: null, word, rollup: roll,
      mark: n.mod ? null : { agent: n.agent, label: kind },
      at: n.statusAt ?? null,
      aria: `${what[0].toUpperCase()}${what.slice(1)} ${n.name}, ${kind}${roll.length ? `: ${rollupWords(roll)}` : ""}`,
    };
  }
  const rec = row.node;
  const roll = counts(rec.items);
  return {
    key: row.key, text: rec.title, strong: false, child: true, click: "focus",
    caret: rec.items.length ? caret(false, `records under ${rec.title}`) : null,
    plus: null, word: rec.word, rollup: roll,
    // A record, not an agent Core observes: the neutral agent glyph, never a brand mark (design item 6).
    mark: { agent: true, record: true, label: "In-process record" },
    at: null,
    aria: `In-process sub-agent ${rec.title}${roll.length ? `: ${rollupWords(roll)}` : ""}`,
  };
}

// The row a key names, for commands that act like a click on it ("pdk-tree.pick:<key>"). A lead agent's pane is
// drawn as its tab's row, so "pn:<lead pane>" names that row.
export const findRow = (rows, key) => rows.find((r) => r.key === key) ?? rows.find((r) => r.type === "tab" && r.tab.lead && `pn:${r.tab.lead.pane}` === key) ?? null;

// Whether a tab row shows the selected highlight: its lead's pane has focus, or (folded, or a tab of one pane with no
// rows under it) any pane of the tab does. A fold is never undone for focus (sidebar mapping, case 8).
export function tabRowOn(tab, focus, open) {
  if (!focus || focus.tab !== tab.id) return false;
  return !open || (tab.lead ? focus.pane === tab.lead.pane : !tab.items.length);
}

// Where the window's own controls end on the left: after macOS's traffic lights when the layout draws no title
// bar (the shipped tabs mod's rule), else a 10px margin. The sidebar head and, while the sidebar is hidden, the tab
// bar both put the sidebar toggle here, so it never moves on screen (owner request 16).
// The window buttons span 54 px from their x (three 14 px buttons, 6 apart: AppKit's, as gpui-pre-macos window.rs
// lays them out); what follows them starts 12 later, the pack's SPACE[3] (owner, 11 Nov: the top bar lines up).
export const LIGHTS = { span: 54, gap: 12 };
export function lightsInset(w, root, zoom = 1) {
  const lights = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights;
  return lights ? (root.traffic_lights[0] + LIGHTS.span + LIGHTS.gap) / (zoom || 1) : LIGHTS.gap;
}

// Machines (owner 17:37, request 1). A space's machine is `SpaceInfo.machine` (herdr.d.ts: null for this computer);
// the list is `machines()` plus `hc machine ls --json`. Nothing here invents one. The tree, the tab bar and the
// factory name a machine through this one function, so they read the same.
export const machineLabel = (name) => (name ? String(name) : "This computer");
// Shared state (app home, `shared()`). `filter` (spec §2): which machine's work the window shows, "all" (the
// default), "" for this computer or a machine's exact name; pdk-tree.machine:<all|local|name> writes it, the tree,
// tab bar, palette, factory and foot read it. `hidden` and `level` are the old hide list and machine level: nothing
// in the tree writes them any more.
export const MACHINE_KEYS = { hidden: "pdk.machines.hidden", level: "pdk.machines.level", filter: "pdk.machine.filter" };

// The filter in force: a stored value naming a machine that is known (machineList's ids), else "all".
export function machineFilter(value, known = []) {
  return typeof value === "string" && value !== "all" && known.some((m) => m.id === value) ? value : "all";
}

// The machine selector's entries (owner, 11 Nov: "a minimal dropdown with icons", Add machine in it): All, then this
// computer and each machine by name, the filter's own one chosen. With only this computer there is nothing to filter:
// This computer alone, chosen, so the selector still shows and holds Add machine. A machine that doesn't answer says
// Offline (spec §2), one still loading doesn't; one that needs a login says "Sign in" (Herdr 0.1.15 item 3), and
// choosing it opens Herdr's own Settings at Machines (`login`), where 0.1.15 shows `hc machine login <name>` with
// Copy. Glyphs: none for All, the monitor for this computer, the server for any other (Herdr's machine list can't
// tell a cloud from a computer). `aria`: the words for the trigger's tooltip and accessible name. `kind`: "all",
// "this" or "machine", which a name can't fake (a machine may be called "all").
export function machineChoices(known = [], filter = "all") {
  const one = known.length < 2;
  const entry = (m) => {
    const login = m.state === "needs login", offline = Boolean(m.state) && m.state !== "loading";
    return { kind: m.name ? "machine" : "this", value: m.id, label: m.label, aria: m.label, chosen: one || filter === m.id, login, note: login ? "Sign in" : offline ? "Offline" : undefined, icon: m.name ? "server" : "monitor" };
  };
  return one ? known.slice(0, 1).map(entry)
    : [{ kind: "all", value: "all", label: "All", aria: "All machines", chosen: filter === "all", login: false, note: undefined, icon: null }, ...known.map(entry)];
}

// Whether a workspace on `machine` (null for this computer) shows under `filter`.
export const inFilter = (filter, machine) => filter === "all" || (machine ?? "") === filter;

// Herdr's own context menu (spec §5) for a workspace ("space": { id }), a tab ("tab": { id, space }) or a pane
// ("pane": { pane, terminal }), with its target captured when it opens, at the sizes Herdr's own mods open it.
export const nativeMenu = (tab, target) => ({ mod: "menu", kind: "popup", width: 200, ...(tab === "space" ? { height: 260 } : {}), props: { tab, target } });

// The native reconnect predicate, deliberately exact: ordinary offline/auth failures must not reset identity.
export const rebuiltMachine = (m) => m?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(m.why ?? "");

// Native reconnect args preserve the captured transport, session and temporary semantics.
export function reconnectArgs(m) {
  return ["machine", "add", ...(m.via ? ["--via", m.target] : [m.target]), "--name", m.name,
    ...(m.session ? ["--session", m.session] : []), ...(m.temporary ? ["--temp"] : [])];
}

export function moveWorkspace(spaces, id, over) {
  const a = spaces.find((s) => s.id === id), b = spaces.find((s) => s.id === over);
  return a && b && a.id !== b.id && (a.machine ?? null) === (b.machine ?? null)
    ? { id, index: spaces.findIndex((s) => s.id === over) + 1 } : null;
}
