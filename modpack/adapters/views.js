// The work area's views and a pane's controls. Pure: plain data in, plain data out.
//
// The work area is a stack of three views (layouts/tremor.json "work-body"): "main", the shown tab's panes as they
// are split; "chat", the focused agent; "factory". Two toggles pick between them (owner, 11 Nov): Chat / Terminal on
// each agent's own bar (the pane header, and the chat's header), Grid / Factory in the tab bar, "with Grid as the
// split pane view". So Terminal and Grid both show "main", and a segment is lit exactly while its view is on screen.

export const STACK = "work-body";
const VIEW_OF = { chat: "chat", main: "main", grid: "main", factory: "factory" };

// The toggles' segments as the shared segmentedChoice takes them: icons only, the word in the tooltip and the name.
export const AGENT_VIEWS = [
  { value: "chat", label: "Chat", icon: "message-square", tooltip: "Chat" },
  { value: "main", label: "Terminal", icon: "square-terminal", tooltip: "Terminal" },
];
export const PLACE_VIEWS = [
  { value: "grid", label: "Grid", icon: "layout-grid", tooltip: "Grid" },
  { value: "factory", label: "Factory", icon: "factory", tooltip: "Factory" },
];

// The segment of `views` whose view the stack shows (`shown`; nothing shown yet counts as "main"), or null.
export const litSegment = (views, shown) => views.find((v) => VIEW_OF[v.value] === (VIEW_OF[shown] ?? "main"))?.value ?? null;

// The view a press on segment `value` selects while `shown` shows; null for a lit segment or an unknown one.
export function pressView(shown, value) {
  const view = VIEW_OF[value] ?? null;
  return view === (VIEW_OF[shown] ?? "main") ? null : view;
}

// How a pane header's hover controls look (owner, 11 Nov): "clean", the earlier text buttons, or "normal", the same
// four as icons. One shared key, set from Cmd+K; absent or anything else is clean.
export const HOVER_KEY = "pdk.pane.hover";
export const hoverStyle = (value) => (value === "normal" ? "normal" : "clean");

// The pane header's controls, left to right: the glyph or the text each draws, its words (three at most), Herdr's
// own command and arguments for this pane, and `key`, the action its shortcut is bound to. An expanded (zoomed)
// pane offers Restore, pressed. Clean draws each one's `text` as a text button; Normal, its glyph as an icon button.
export function paneControls(pane, zoomed, style) {
  const right = { id: "ph-r", glyph: "columns-2", label: "Split right", text: "Split →", command: "pane.split", args: { direction: "right", pane }, key: "pane.split:right" };
  const down = { id: "ph-d", glyph: "rows-2", label: "Split down", text: "Split ↓", command: "pane.split", args: { direction: "down", pane }, key: "pane.split:down" };
  const zoom = { id: "ph-z", glyph: zoomed ? "minimize-2" : "maximize-2", label: zoomed ? "Restore" : "Expand", text: zoomed ? "Restore" : "Expand", command: "pane.zoom", args: { pane }, key: "pane.zoom", pressed: Boolean(zoomed) };
  const close = { id: "ph-x", glyph: "x", label: "Close pane", text: "Close", command: "pane.close", args: { pane }, key: "pane.close" };
  const controls = [right, down, zoom, close];
  return hoverStyle(style) === "clean" ? controls : controls.map(({ text, ...icon }) => icon);
}

// Chat or Terminal per tab (owner, 11 Nov 2026): `pdk.chat.tabs` is { <tab id>: <terminal address> }, the tabs that
// show Chat and the agent each shows; a tab not in it shows its panes. The chat writes its tab's entry for a pick or
// a pane's Chat press, Terminal and Grid remove it, and the tab bar follows it when the shown tab changes.
export const TABS_KEY = "pdk.chat.tabs";
export const PICK_FRESH_MS = 2000; // a pick this new was made for the tab just shown (a sidebar click on its agent)

export const rememberChat = (entries, tab, address) => ({ ...(entries ?? {}), [tab]: address });
export const forgetTab = (entries, tab) => Object.fromEntries(Object.entries(entries ?? {}).filter(([id]) => id !== tab));

// What the tab bar does when the shown tab becomes `tab` while the stack shows `view`. `tabs`: the tab ids that
// exist; `live(address)`: the terminal is still there; `pick`: the chat's last pick ({ address, at }) and `pickTab`
// the tab its pane is in. Entries of tabs that are gone, or whose agent is gone, are dropped. Factory is left alone.
// A tab with an entry shows Chat with its agent, unless a pick just made in this tab names another; a tab without one
// shows its panes, unless Chat is on screen and a pick just made in this tab asked for it, or Chat was chosen since
// the tab bar last looked (`asked`, with `focus`: the focused terminal, which Chat then shows). A tab bar draws only
// when the window does, so it can see the new tab and a Chat chosen there in one look.
// -> { entries, select: "chat" | "main" | null, pick: address to pick | null }
export function followTab({ entries, tab, view, tabs, live, pick = null, pickTab = null, now = Date.now(), asked = false, focus = null }) {
  const kept = Object.fromEntries(Object.entries(entries ?? {}).filter(([id, address]) => tabs.includes(id) && live(address)));
  if (!tab || view === "factory") return { entries: kept, select: null, pick: null };
  const fresh = Boolean(pick && now - pick.at < PICK_FRESH_MS && pickTab === tab && live(pick.address));
  const chosen = fresh && (view === "chat" || kept[tab]) ? pick.address : kept[tab] ?? (asked && view === "chat" && focus && live(focus) ? focus : null);
  if (!chosen) return { entries: kept, select: view === "chat" ? "main" : null, pick: null };
  return { entries: { ...kept, [tab]: chosen }, select: view === "chat" ? null : "chat", pick: fresh ? null : chosen };
}

// Between tab changes, the shown tab's entry follows what is on screen: Chat shown with no entry records the agent it
// shows (`focus`, the focused terminal; a pick is recorded by the chat itself), the panes shown drop it. Factory and
// an unknown tab leave it alone. -> the entries, or null when nothing changes.
export function keepTab({ entries, tab, view, focus = null, live }) {
  const had = entries ?? {};
  if (!tab) return null;
  if (view === "chat" && !had[tab] && focus && live(focus)) return rememberChat(had, tab, focus);
  if (view === "main" && had[tab]) return forgetTab(had, tab);
  return null;
}
