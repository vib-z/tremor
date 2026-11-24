// What the chat shows in place of a conversation, or under one, while it is loading, empty, away or failed. Pure:
// plain facts in, what to draw out (mods/pdk-chat/states.js draws it). One rule above the rest (owner, 12 Nov 2026:
// "the chat disappears and takes long to show up"): once there are rows, nothing here ever takes their place.
//
// facts
//   address    the terminal the chat shows, or null
//   agent      the terminal reports an agent kind
//   kindName   the agent's name as a person reads it ("Claude Code")
//   supported  tremor can read this kind's transcript
//   note       why not, in the kind's own words (adapters/chat.js SUPPORT)
//   program    the program a plain terminal runs, if the app names it
//   state      the feed's: "finding" | "unbound" | "waiting" | "live" | "offline" | "error" (adapters/feed.js)
//   reason     the feed's words for unbound, offline and error
//   rows       how many timeline rows there are to draw
//   pending    messages sent from here and not yet in the transcript
//   stale      the rows belong to the conversation before a start-over whose first read has not landed
//   since      when the current wait began (ms), or null
//   now        ms
//   machine    the other machine's label, or null on this computer
// -> { page, block, composer }
//   page      { id, title, body, action, header } | null   the whole body: "none", "shell", "unsupported"
//   block     { id, tone, line, detail, action } | null    the thread's last item: "loading", "empty", "unbound",
//             "offline", "error"; tone "loading" | "info" | "error"; action "terminal" | "retry" | null
//   composer  whether the composer is drawn

export const SLOW_MS = 3000; // a wait this long says what it is waiting for

const page = (id, title, body, action = null, header = false) => ({ page: { id, title, body, action, header }, block: null, composer: false });
const block = (id, tone, line, detail = null, action = null) => ({ id, tone, line, detail, action });

export function appearance(f) {
  if (!f.address) return page("none", "No agent selected", "Pick an agent in the sidebar or focus its pane to see its chat here.");
  if (!f.agent) return page("shell", "Not an agent", `${f.program ?? "This terminal"} isn't an agent. Chat shows agents; open the terminal to use it.`, "terminal");
  if (!f.supported) return page("unsupported", `Chat can't read ${f.kindName}`, f.note ?? "Open the terminal to follow it.", "terminal", true);
  const has = (f.rows ?? 0) + (f.pending ?? 0) > 0;
  const slow = f.since != null && f.now - f.since >= SLOW_MS;
  // A local session that can't be proven has nowhere to send from here; another machine's still takes a message.
  const composer = f.state !== "unbound" || Boolean(f.machine) || has;
  const b = has ? under(f) : instead(f, slow);
  return { page: null, block: b, composer };
}

// The feed's reason, as given, after our own words.
const why = (r) => (r ? ` Reason: ${r}${/[.!?]$/.test(r) ? "" : "."}` : "");

// With a conversation on screen: it stays, and at most one block under it says what is going on.
function under(f) {
  if (f.state === "error") return block("error", "error", "Reading stopped", `What was read stays here. Try again, or open Terminal above to follow the agent there.${why(f.reason)}`, "retry");
  if (f.state === "offline") return block("offline", "loading", `Reconnecting to ${f.machine ?? "the machine"}…`, "What was read stays here.");
  if (f.stale) return block("loading", "loading", "Loading the new conversation…");
  if (f.state === "unbound") return block("unbound", "info", "Chat can't follow this session right now", `What was read stays here. Follow the agent in its terminal.${why(f.reason)}`, "terminal");
  return null;
}

// With nothing to show yet: say that content is coming, that there is none, or what to do.
function instead(f, slow) {
  if (f.state === "finding") return block("loading", "loading", "Loading conversation…", slow ? (f.machine ? `Still reading from ${f.machine}.` : "Still looking for this agent's session.") : null);
  if (f.state === "waiting") return block("empty", "info", "No messages yet", "Messages show here once the conversation starts.");
  if (f.state === "unbound") return block("unbound", "info", "Chat can't show this session", `Follow the agent in its terminal.${why(f.reason)}`, "terminal");
  if (f.state === "offline") return block("offline", "loading", `Connecting to ${f.machine ?? "the machine"}…`, "It keeps trying on its own.", "retry");
  if (f.state === "error") return block("error", "error", "Couldn't read the conversation", `Try again, or open Terminal above to follow the agent there.${why(f.reason)}`, "retry");
  return block("empty", "info", "No messages yet");
}
