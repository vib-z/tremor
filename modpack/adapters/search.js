// The Cmd+K palette's model (mods/pdk-search; owner 17:40 request 4b, 17:52 request 8b). Every machine, workspace,
// tab, agent and pane as one row, named as the sidebar names them (buildPaneTree), grouped by kind, and the app
// command a pick runs. Pure: the mod passes in the live data.

import { buildPaneTree, machineLabel } from "./status.js";

// Agents first, as the visual contract's palette lists them (one destination per running agent), then panes,
// workspaces and machines.
export const KINDS = ["tab", "agent", "pane", "workspace", "machine"];
export const KIND_TITLE = { machine: "Machines", workspace: "Workspaces", tab: "Tabs", agent: "Agents", pane: "Panes" };
const KIND_WORD = { machine: "Machine", workspace: "Workspace", tab: "Tab", agent: "Agent", pane: "Pane" };

// Machines are this computer (null) and the ones Herdr reports: `machines()` and each space's `machine`
// (herdr.d.ts:113-136). None is invented. This computer first, the others by name, as the default sidebar orders them.
export function machineNames(machines, spaces) {
  const remote = new Set([...machines.map((m) => m?.name), ...spaces.map((s) => s.machine)].filter(Boolean));
  return [null, ...[...remote].sort()];
}

export function searchRows({ spaces, panes, terminals, agents, machines = [], kindOf = () => null }) {
  const model = buildPaneTree({ spaces, panes, terminals, agents, kindOf });
  const paneOf = new Map(panes.filter((p) => p.terminal).map((p) => [p.terminal, p.pane]));
  const names = machineNames(machines, spaces);
  const multi = names.length > 1;
  // A row's place, as the tree shows it: the machine only when there are two or more.
  const where = (m, ...parts) => [multi ? machineLabel(m) : null, ...parts].filter(Boolean).join(" › ");
  const out = Object.fromEntries(KINDS.map((k) => [k, []]));
  const add = (kind, row) => {
    // `what`: the kind, in words. Where a row has a `mark`, the kind is drawn as that mark, not as text (owner request
    // 14); it stays in the accessible name and in what typing matches.
    const words = [row.label, row.what, row.mark?.label, row.detail].filter(Boolean);
    const aria = `${KIND_WORD[kind]} ${row.label}${row.what && row.what !== row.label ? `, ${row.what}` : ""}`
      + `${row.detail ? `, in ${row.detail}` : ""}${row.command ? "" : ", nothing to show"}`;
    out[kind].push({ kind, what: null, mark: null, ...row, hay: words.join(" ").toLowerCase(), aria });
  };

  for (const m of names) {
    const mine = model.filter((s) => (s.machine ?? null) === m);
    const n = mine.length;
    // A machine with nothing to list says why: still loading, unavailable (offline), or empty.
    const layout = machines.find((x) => (x?.name ?? null) === m)?.layout;
    const empty = layout === "loading" ? "Loading…" : layout === "unavailable" ? "Unavailable" : "No workspaces";
    add("machine", {
      key: `mc:${m ?? ""}`, label: machineLabel(m), detail: n ? `${n} workspace${n === 1 ? "" : "s"}` : empty,
      target:{id:m,machine:m}, command: n ? { name: "space.select", args: { id: mine[0].id } } : null,
    });
  }
  for (const s of model) {
    const space = s.name || "~";
    add("workspace", { key: `sp:${s.id}`, target:{id:s.id,space:s.id,machine:s.machine??null,name:s.name,folder:spaces.find(x=>x.id===s.id)?.folder}, label: space, detail: where(s.machine), command: { name: "space.select", args: { id: s.id } } });
    for (const tab of s.tabs) {
      // The tab's name as the sidebar gives it, beside its lead's mark, no badge; a tab of plain shells: the terminal
      // mark. A tab of one pane is one row, as in the sidebar: that pane has no row of its own.
      const lead = tab.lead;
      const first = tab.items.find((n) => n.type === "pane" && n.address && !n.mod);
      const who = lead ? lead.kindName || lead.program?.name || "Agent" : null;
      add("tab", {
        key: tab.key, word: lead ? tab.leadWord : null, target:{id:tab.id,space:s.id,machine:s.machine??null,name:tab.name,folder:spaces.find(x=>x.id===s.id)?.folder}, label: lead ? tab.label?.text ?? tab.badge ?? lead.name : tab.name, what: lead ? `${who}, lead agent of this tab` : null,
        mark: lead ? { agent: true, label: who } : { agent: false, label: first?.program?.name || "Terminal" },
        // An agent-led tab focuses its lead's pane, as a click on its row in the tree does.
        detail: where(s.machine, space), command: lead?.pane ? { name: "pane.focus", args: { pane: lead.pane } } : { name: "tab.select", args: { id: tab.id } },
      });
      // One destination per running agent (assessment rank 7): the lead's own row is its tab's row, as in the tree,
      // which a search for its kind ("claude") finds by the mark's words. In-process sub-agents (7501 records) are
      // agents too, under their owner's pane, as the tree shows them.
      const nodes = [];
      const walk = (items) => { for (const n of items) { nodes.push(n); walk(n.items); } };
      walk(tab.items);
      const detail = where(s.machine, space, tab.tabName ?? tab.name);
      const kindAt = new Map([...(tab.lead ? [tab.lead] : []), ...nodes].filter((n) => n.type === "pane").map((n) => [n.address, n.kindName || n.program?.name || null]));
      for (const n of nodes) {
        if (n.type === "rec") {
          const pane = paneOf.get(n.owner);
          const command = pane ? { name: "pane.focus", args: { pane } } : { name: "terminal.peek", args: { terminal: n.owner } };
          // A neutral record glyph; the owner kind remains searchable and in the accessible name.
          const owner = kindAt.get(n.owner) ?? "Agent";
          add("agent", { key: `rc:${n.owner}#${n.id}`, word: n.word, target:{id:n.owner,space:s.id,machine:s.machine??null,terminal:n.owner,pane,name:n.title,folder:spaces.find(x=>x.id===s.id)?.folder}, label: n.title, what: `${owner} in-process sub-agent`, mark: { agent: true, label: owner, record: true }, detail, command });
          continue;
        }
        const kind = n.agent ? "agent" : "pane";
        // A pane shows its tab and takes focus (pane.focus selects the tab and its space); a sub-agent without a pane
        // is peeked, as a click on it in the tree does.
        const command = n.pane ? { name: "pane.focus", args: { pane: n.pane } } : n.address ? { name: "terminal.peek", args: { terminal: n.address } } : null;
        const what = n.kindName || n.program?.name || (n.mod ? "panel" : null);
        const mark = n.mod ? null : { agent: n.agent, label: what || (n.agent ? "Agent" : "Terminal") };
        add(kind, { key: n.key, word: n.ownWord ?? null, target:{id:n.address||n.pane,space:s.id,machine:s.machine??null,terminal:n.address,pane:n.pane,name:n.name,folder:spaces.find(x=>x.id===s.id)?.folder}, label: n.name, what, mark, detail, command });
      }
    }
  }
  return KINDS.flatMap((k) => out[k]);
}

// Every word typed must appear in the row: its name, what runs there (also when drawn as a mark), its place.
export function filterRows(rows, query) {
  const words = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return words.length ? rows.filter((r) => words.every((w) => r.hay.includes(w))) : rows;
}

// The drawn list: a heading before each kind that has rows.
export function groupRows(rows) {
  const out = [];
  for (const kind of KINDS) {
    const mine = rows.filter((r) => r.kind === kind);
    if (mine.length) out.push({ head: true, kind, key: `hd:${kind}`, label: KIND_TITLE[kind], count: mine.length }, ...mine);
  }
  return out;
}

// The first drawn row, so that `at` (an index into the list) is in the `count` rows shown. A heading right above
// the selected row comes along when there is room.
export function keepInView(total, at, top, count) {
  const max = Math.max(0, total - count);
  let t = Math.max(0, Math.min(top, max));
  if (at < 0) return t;
  if (at < t) t = Math.max(0, at - 1);
  if (at >= t + count) t = at - count + 1;
  return Math.max(0, Math.min(t, max));
}

// Live updates may reorder results. Only a deliberate move/query/click changes the chosen identity.
// Once a chosen result disappears, even its return needs another deliberate selection.
export class SearchSelection {
  constructor() { this.reset(); }
  reset() { this.key = null; this.missing = false; }
  choose(key) { this.key = key; this.missing = false; }
  current(rows) {
    if (this.missing) return null;
    if (this.key == null) this.key = rows.find((r) => r.command)?.key ?? null;
    const row = rows.find((r) => r.key === this.key && r.command) ?? null;
    if (!row && this.key != null) this.missing = true;
    return row;
  }
  move(rows, by) {
    const picks = rows.filter((r) => r.command);
    this.current(picks);
    if (!picks.length) return;
    const at = this.missing ? -1 : picks.findIndex((r) => r.key === this.key);
    const next = at < 0 ? (by < 0 ? picks.length - 1 : 0) : (at + by % picks.length + picks.length) % picks.length;
    this.choose(picks[next].key);
  }
  // Page Down / Up: the first pickable row of the next group, or of this group's start / the one before. Past the
  // last group Page Down lands on the last row, before the first Page Up on the first; a list without headings is one
  // group, so they go to its ends.
  jump(rows, by) {
    const picks = rows.filter((r) => r.command);
    this.current(picks);
    if (!picks.length) return;
    const starts = [];
    let fresh = true;
    for (const r of rows) {
      if (r.head) fresh = true;
      else if (r.command && fresh) { starts.push(picks.indexOf(r)); fresh = false; }
    }
    const at = this.missing ? -1 : picks.findIndex((r) => r.key === this.key);
    const to = by > 0 ? (starts.find((i) => i > at) ?? picks.length - 1) : (starts.findLast((i) => i < at) ?? 0);
    this.choose(picks[to].key);
  }
}

// Native picker earlier/new/close flows, without losing the five-kind search model.
export function placeList(rows,query,showEarlier,snapshot) {
 const quiet=new Set(snapshot.spaces.filter(s=>!s.status).flatMap(s=>s.tabs.map(t=>t.id)));
 const tabs=rows.filter(r=>r.kind==="tab"&&quiet.has(r.target.id));
 const visible=rows.filter(r=>r.kind!=="tab"||!quiet.has(r.target.id)||showEarlier||query.trim());
 const list=groupRows(filterRows(visible.map(r=>r.kind==="machine"&&!r.command?{...r,command:{name:"actions"}}:r),query));
 if(tabs.length&&!query.trim())list.push({kind:"earlier",key:"earlier",label:`${showEarlier?"Hide":"Show"} earlier tabs`,detail:String(tabs.length),aria:"Earlier quiet tabs",command:{name:"earlier"}});
 return list;
}
