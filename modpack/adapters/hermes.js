// Hermes Agent as it runs on this Mac (v0.23.0, NousResearch/hermes-agent@2bd378ed, MIT): how a Core terminal running
// Hermes is recognised, which session is its own, and how its state.db rows become chat rows. Every rule here was read
// from this lane's own sessions (modpack/test/fixtures/hermes/SOURCE.md, captured 2026-11-09): the installed build runs
// each chat turn inside the Hermes gateway daemon, writes no pid lease to runtime/active_sessions.json (it stayed `[]`
// with two live chats), and names a terminal's session in a per-tty breadcrumb,
// <HERMES_HOME>/terminal-sessions/tty-dev-<tty> = {session_id, cwd, ts} (hermes_cli/terminal_breadcrumbs.py:16-82).
// Pure: rows in, chat rows out.

import { userEntry, toolLabel } from "./chat.js";
import { inputChanges } from "./codeview.js";
import { refsFromInput } from "./media.js";

const no = (reason) => ({ ok: false, reason });
const parse = (text) => { try { return typeof text === "string" ? JSON.parse(text) : text ?? null; } catch { return null; } };

// Detection (agentKind in agents.js) and binding by the terminal's breadcrumb (bindHermesBreadcrumb in binding.js) were
// ported from this file by build-safety; this file keeps the row mapper.

// A terminal tool's result is JSON text {output, exit_code, error}; anything else is shown as it is.
export function toolOutcome(content) {
  const text = typeof content === "string" ? content : content == null ? "" : JSON.stringify(content);
  const o = parse(text);
  if (o && typeof o === "object" && !Array.isArray(o) && ("output" in o || "exit_code" in o || "error" in o)) {
    const output = typeof o.output === "string" ? o.output : o.output == null ? "" : JSON.stringify(o.output);
    const failed = (o.exit_code != null && o.exit_code !== 0) || (o.error != null && o.error !== "");
    // Hermes' approval verdict rides in the result ("Command was flagged ... and auto-approved by smart approval"): shown as its own line.
    const notes = [failed && o.error ? String(o.error) : "", typeof o.approval === "string" && o.approval ? `Approval: ${o.approval}` : ""].filter(Boolean);
    return { status: failed ? "error" : "ok", output: [output, ...notes].filter(Boolean).join("\n") };
  }
  return { status: "ok", output: text };
}

// A tool row carries the media its input names (a path field, a command string), as chat.js's rows do (media.js).
const tool = (key, id, name, input, at, ctx) => {
  const changes = inputChanges(name, input); // a write or patch call's own content, for the code view (codeview.js)
  const entry = { key, type: "tool", id, name, ...toolLabel(name, input), status: "pending", at, ...(changes ? { changes } : {}) };
  const refs = refsFromInput(input, ctx);
  return refs.length ? { ...entry, media: refs } : entry;
};

// One state.db `messages` row to chat events. Rows compaction retired (active 0) are not shown: Hermes itself shows
// the live rows only. A rejected or failed call is the tool row's own error; Hermes keeps approvals out of the store.
export function mapHermesRow(r, ctx = {}) {
  if (!r || r.active === 0 || r.active === false) return [];
  const at = typeof r.timestamp === "number" ? Math.round(r.timestamp * 1000) : null;
  if (r.role === "user") return [{ op: "add", entry: userEntry(`h${r.id}`, r.content, at) }].filter((e) => e.entry);
  if (r.role === "tool") {
    const { status, output } = toolOutcome(r.content);
    return r.tool_call_id ? [{ op: "result", id: r.tool_call_id, status, output }] : [];
  }
  if (r.role !== "assistant") return [];
  const out = [];
  if (typeof r.reasoning === "string" && r.reasoning.trim()) out.push({ op: "add", entry: { key: `h${r.id}:think`, type: "thinking", text: r.reasoning, at } });
  if (String(r.content ?? "").trim()) out.push({ op: "add", entry: { key: `h${r.id}`, type: "assistant", text: r.content, at } });
  const calls = parse(r.tool_calls);
  for (const c of Array.isArray(calls) ? calls : []) {
    const id = c.id ?? c.call_id;
    if (!id) continue;
    const name = c.function?.name ?? c.name ?? "tool";
    out.push({ op: "add", entry: tool(`h${r.id}:${id}`, id, name, parse(c.function?.arguments ?? c.arguments) ?? {}, at, ctx) });
  }
  return out;
}

