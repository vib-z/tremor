// Structured chat from agents' own transcripts: one mapper per format, and one thread that pairs tool calls
// with their results, groups tool work between messages and drops nothing it can't explain as a row.
// Pure: records in, rows out. Unknown record types are ignored, never shown raw. Account and system
// metadata (Claude session-owner and api-request lines, Codex session_meta creator ids, developer and
// injected AGENTS.md items) are never mapped.
//
// Formats: Claude Code and Codex from captured owned samples (docs/modpack/research/fixtures), with Heeler's
// format notes (ZingerLittleBee/Heeler@7bfe7fa docs/research/claude-code-transcript-format.md and
// codex-rollout-format.md, Apache-2.0) and herdr-claude-chat's reader rules (adamentwistle/herdr-claude-chat@824654ab
// mods/claude-chat/tail.py, MIT: lines skipped, reminders stripped). Grok, Pi and OpenCode from Heeler's notes;
// Hermes, Kimi and Gemini from their upstream sources (chat-adapters.md). See modpack/NOTICE.md and MATRIX.md.
//
// Rows carry `media`: references to the images, videos, PDFs and HTML files their own record names (media.js).

import { mapHermesRow } from "./hermes.js";
import { refsFromText, refsFromInput, inlineImages, inlineRefsIn, mergeRefs, fileRef, kindOf, resolvePath, stripImages, dropImageMarkers } from "./media.js";
import { inputChanges, codexChanges } from "./codeview.js";
import { hookEntry, questionsOf } from "./interactions.js";

const OUTPUT_LIMIT = 4000; // kinds without a rich call (below)
const COMPACTED = "Context compacted";
const clip = (s, n = OUTPUT_LIMIT) => (s.length > n ? s.slice(0, n) + "\n…" : s);

// What an open tool call shows, for Claude Code and Codex (owner, 11 Nov 2026: tool calls open to "arguments, code,
// diffs, and the tool result", as highlighted snippets): `args`, the call's arguments in their own order, each
// { key, text, lang } and cut at ARG_LIMIT; `output` cut at RESULT_LIMIT; `outputLang`, how to highlight it; `summary`,
// one line for the collapsed row. Cut exactly at the ceilings, so a view can say when a field reached one.
export const ARG_LIMIT = 8000, RESULT_LIMIT = 16000, SUMMARY_LIMIT = 120;
const EXT_LANG = { js: "js", mjs: "js", cjs: "js", jsx: "jsx", ts: "ts", tsx: "tsx", mts: "ts", cts: "ts", py: "python", rs: "rust",
  go: "go", rb: "ruby", sh: "bash", bash: "bash", zsh: "bash", json: "json", jsonc: "jsonc", yaml: "yaml", yml: "yaml", toml: "toml",
  md: "markdown", html: "html", htm: "html", css: "css", c: "c", h: "c", cpp: "cpp", hpp: "cpp", java: "java", swift: "swift",
  sql: "sql", vue: "vue", svelte: "svelte", lua: "lua", kt: "kotlin" };
// A file's language by its extension, else null (plain text).
export const langOf = (path) => EXT_LANG[/\.([a-z0-9]+)$/i.exec(String(path ?? ""))?.[1]?.toLowerCase()] ?? null;
const pathIn = (i) => ["file_path", "path", "filePath", "notebook_path"].map((k) => i?.[k]).find((v) => typeof v === "string" && v) ?? null;

// The arguments, in order; keys a file change already shows (its old and new text, its edits, a write's content) are
// left out. A command reads as bash, a written file's content as that file's language, other strings as text,
// anything else as pretty JSON.
export function callArgs(input, changes = null) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  const path = pathIn(input);
  const shown = new Set(changes?.length ? ["old_string", "new_string", "edits", "content"] : []);
  return Object.entries(input).filter(([k, v]) => !shown.has(k) && v !== undefined).map(([key, v]) => {
    if (typeof v === "string") return { key, text: v.slice(0, ARG_LIMIT), lang: key === "command" || key === "cmd" ? "bash" : key === "content" && path ? langOf(path) : null };
    let text;
    try { text = JSON.stringify(v, null, 2); } catch { text = String(v); }
    return { key, text: String(text).slice(0, ARG_LIMIT), lang: "json" };
  });
}

// An agent message cut at its fenced code blocks, in order: { md } for the words, { code, lang } for each block (the
// opening fence's language, or null). A fence still open at the end (a message still arriving) is a block with what
// has arrived. Fences inside a longer fence are part of its code.
export function fences(text) {
  const parts = [];
  const re = /^(`{3,}|~{3,})([^\n`]*)\n([\s\S]*?)(?:\n\1[ \t]*(?:\n|$)|$(?![\s\S]))/gm;
  let at = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > at) parts.push({ md: text.slice(at, m.index) });
    parts.push({ code: m[3], lang: m[2].trim().split(/\s+/)[0] || null });
    at = re.lastIndex;
    if (m[0] === "") re.lastIndex++;
  }
  if (at < text.length) parts.push({ md: text.slice(at) });
  return parts.filter((p) => p.code !== undefined || p.md.trim());
}

// Claude Code's Read result numbers its lines ("    12→text" or "12\ttext"): the file's own text is what is shown.
const NUMBERED = /^\s*\d+(?:→|\t)/;
const unnumber = (text) => {
  const lines = text.split("\n");
  return lines.some(Boolean) && lines.every((l) => !l || NUMBERED.test(l)) ? lines.map((l) => l.replace(NUMBERED, "")).join("\n") : text;
};
const isJson = (text) => { const t = text.trim(); if (!/^[[{]/.test(t)) return false; try { JSON.parse(t); return true; } catch { return false; } };
// The first line that says something, for the collapsed row.
const firstLine = (text) => (String(text ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "").slice(0, SUMMARY_LIMIT) || null;

// A rich call's result fields from its recorded output: a read shows the file's text in its language, JSON as JSON.
// The summary is the record's own exit code when it failed with one, else the first line (none for a read, whose first
// line is the file's own text, nor for JSON, whose first line is a brace).
export function resultFields(t, output, exit = null) {
  const read = /^read$/i.test(String(t.name ?? "")) && pathIn(t.input);
  const out = (read ? unnumber(output) : output).replace(/\n$/, "").slice(0, RESULT_LIMIT); // a last line break draws an empty line
  const outputLang = read ? langOf(read) : isJson(out) ? "json" : null;
  const summary = exit != null && exit !== 0 ? `Exit ${exit}` : read || outputLang === "json" ? null : firstLine(out);
  return { output: out, outputLang, summary };
}
const textOf = (content) => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((b) => (typeof b === "string" ? b : b?.text ?? b?.content?.text ?? (typeof b?.content === "string" ? b.content : ""))).filter(Boolean).join("\n");
};

// <hc from="t7">…</hc>: a message another terminal typed in through herdr-core. Core records no sender, so
// it is a claim (D17, D24), shown as such.
const HC = /^\s*<hc\b[^>]*?\bfrom="?([^"\s>]+)"?[^>]*>([\s\S]*?)(?:<\/hc>\s*)?$/;
const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
const COMMAND = /<command-name>\s*(\/?[^<\s]+)\s*<\/command-name>/;

// A message with the folders picked by the composer's "+" after it, as typed paths (quoted when they hold a space):
// what each agent reads as a path in a prompt. Nothing is uploaded or read here.
export function withFolders(text, paths = []) {
  const word = (p) => (/[\s"]/.test(p) ? `"${String(p).replace(/(["\\])/g, "\\$1")}"` : String(p));
  return [String(text ?? "").trim(), ...paths.filter(Boolean).map(word)].filter(Boolean).join(" ");
}

// Claude Code's own records of a local command (/model, /effort, ...): a caveat for the model, never shown; the
// command's output, shown as a quiet notice ("Set model to Haiku 5.5 for this session only with low effort").
const CAVEAT = /<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g;
const LOCAL_OUT = /^\s*<local-command-(stdout|stderr)>([\s\S]*?)<\/local-command-\1>\s*$/;

export function userEntry(key, raw, at) {
  let text = String(raw ?? "").replace(REMINDER, "").replace(CAVEAT, "").trim();
  const local = LOCAL_OUT.exec(text);
  if (local) {
    const said = local[2].replace(/\x1b\[[0-9;]*m/g, "").replace(/`/g, "").trim();
    return said ? { key, type: "notice", text: said, at } : null;
  }
  const cmd = COMMAND.exec(text);
  if (cmd) text = cmd[1].startsWith("/") ? cmd[1] : `/${cmd[1]}`;
  if (!text) return null;
  const hc = HC.exec(text);
  if (hc) return { key, type: "user", text: hc[2].trim(), claimedFrom: hc[1], at };
  return { key, type: "user", text, at };
}

// A short label for a tool call: the command, the file, the pattern, else the tool's name. `doing` is how a call
// reads until it succeeds ("Write notes.txt" while it waits or after it failed), `done` once it has ("Wrote").
export function toolLabel(name, input) {
  const i = input && typeof input === "object" ? input : {};
  const first = (...ks) => ks.map((k) => i[k]).find((v) => typeof v === "string" && v.trim());
  const say = (doing, done, detail) => ({ doing, done, verb: doing, detail });
  const cmd = first("command", "cmd");
  if (cmd) return say("Run", "Ran", cmd.split("\n")[0]);
  const file = first("file_path", "path", "filePath", "notebook_path");
  if (file) return /write|create/i.test(name) ? say("Write", "Wrote", file) : /edit|patch|replace/i.test(name) ? say("Edit", "Edited", file) : say("Read", "Read", file);
  const pattern = first("pattern", "query", "q");
  if (pattern) return /web/i.test(name) ? say("Search the web", "Searched the web", pattern) : say("Search", "Searched", pattern);
  const url = first("url");
  if (url) return say("Fetch", "Fetched", url);
  const desc = first("description", "prompt", "title");
  if (desc) return say(name, name, desc.split("\n")[0]);
  return say(name || "Tool", name || "Tool", "");
}

// A rich call's words (design chat-direction.md §4): `going` while it runs ("Running"), `done` once it has, `doing` when
// it failed or was refused. A tool the families don't name is "Called" with its exact name; a sub-agent's task is
// "Delegated" with its description.
const GOING = { View: "Viewing", "Generate an image": "Generating an image", Run: "Running", Read: "Reading", Write: "Writing", Edit: "Editing", Search: "Searching", "Search the web": "Searching the web", Fetch: "Fetching" };
function richLabel(name, input) {
  const l = toolLabel(name, input);
  const n = String(name ?? "");
  if (/^mcp__/.test(n)) return { doing: "Call", done: "Called", going: "Calling", verb: "Call", detail: n.replace(/^mcp__(.+?)__/, "$1.") };
  if (/^(Task|Agent)$/.test(n)) return { ...l, doing: "Delegate", done: "Delegated", going: "Delegating", verb: "Delegate" };
  // A search names its path too; the pattern is what it looked for.
  if (/^(Grep|Glob)$/.test(n) && typeof input?.pattern === "string") return { doing: "Search", done: "Searched", going: "Searching", verb: "Search", detail: input.pattern };
  if (GOING[l.doing]) return { ...l, going: GOING[l.doing] };
  return { doing: "Call", done: "Called", going: "Calling", verb: "Call", detail: String(name || "tool").replace(/^mcp__([^_]+)__/, "$1.") };
}

const withMedia = (entry, refs) => (entry && refs?.length ? { ...entry, media: refs } : entry);
// A file-changing call also carries what it changed, from its own input (adapters/codeview.js; the code view).
// `rich`: Claude Code and Codex calls, which carry what an open call shows (callArgs, resultFields).
const tool = (key, id, name, input, at, ctx = {}, rich = false) => {
  const changes = inputChanges(name, input);
  const questions = name === "AskUserQuestion" ? questionsOf(input) : []; // shown on the question card (interactions.js)
  const extra = rich ? { rich: true, args: callArgs(input, changes), ...(pathIn(input) ? { input: { path: pathIn(input) } } : {}) } : {};
  return withMedia({ key, type: "tool", id, name, ...(rich ? richLabel(name, input) : toolLabel(name, input)), status: "pending", at, ...(changes ? { changes } : {}), ...(questions.length ? { questions } : {}), ...extra },
    refsFromInput(input, ctx));
};
const relabel = (entry, doing, done) => ({ ...entry, doing, done, verb: doing, ...(entry.rich ? { going: GOING[doing] ?? `${doing}…` } : {}) });
const result = (id, status, output, media, exit = null) => ({ op: "result", id, status, output: String(output ?? "").slice(0, RESULT_LIMIT + 4096), ...(media?.length ? { media } : {}), ...(exit != null ? { exit } : {}) });
const add = (entry) => (entry ? { op: "add", entry } : null);

// ---- Claude Code (verified) ----
const CLAUDE_SKIP = new Set(["session-owner", "api-request", "api-request-blob", "api-request-shape", "attachment", "queue-operation",
  "last-prompt", "atis-latch", "tools-used", "cost-state", "summary", "file-history-snapshot", "file-history-delta", "custom-title",
  "agent-name", "mode", "bridge-session", "pr-link", "system"]);

export function mapClaude(o, _state, meta) {
  if (!o || o.isSidechain) return [];
  const at = Date.parse(o.timestamp) || null;
  // Hook events, as quiet rows (owner request 35): a hook's attachment, and the Stop hooks' summary. Display only.
  if (o.type === "attachment" && /^hook_/.test(String(o.attachment?.type ?? ""))) return [add(hookEntry(o.uuid ?? `hook:${at}`, o.attachment, at))];
  if (o.type === "system" && o.subtype === "stop_hook_summary") {
    const n = Number(o.hookCount) || (Array.isArray(o.hookInfos) ? o.hookInfos.length : 0);
    return [add(hookEntry(o.uuid ?? `stophooks:${at}`, { type: o.preventedContinuation ? "hook_stopped_continuation" : o.hookErrors?.length ? "hook_non_blocking_error" : "hook_success",
      hookEvent: "Stop", hookName: `${n} hook${n === 1 ? "" : "s"}` }, at))];
  }
  // Where Claude Code compacted the context: one quiet notice. The summary it then injects is not a person's message.
  if (o.type === "system" && o.subtype === "compact_boundary") return [add({ key: o.uuid ?? `compact:${at}`, type: "notice", text: COMPACTED, at })];
  if (CLAUDE_SKIP.has(o.type)) return [];
  const ctx = { cwd: o.cwd };
  const injected = o.isMeta || o.isCompactSummary; // Claude Code's own text in a user record: never a person's message
  if (o.type === "user") {
    const c = o.message?.content;
    if (typeof c === "string") return injected ? [] : [add(userEntry(o.uuid, c, at))].filter(Boolean);
    if (!Array.isArray(c)) return [];
    const out = [];
    const images = inlineImages(o);
    for (const b of c) {
      if (b?.type === "tool_result") {
        const rejected = o.toolDenialKind || o.permissionDecision?.decision === "reject" || b.permissionDecision?.decision === "reject";
        out.push(result(b.tool_use_id, rejected ? "rejected" : b.is_error ? "error" : "ok", textOf(b.content), inlineRefsIn(b.content, images, meta)));
      } else if (b?.type === "text" && !injected) {
        const e = userEntry(`${o.uuid}:${out.length}`, b.text, at);
        if (e) out.push(add(e));
      }
    }
    // A pasted image: its blocks go with the prompt's last text, or stand as a prompt of their own.
    const pasted = injected ? [] : inlineRefsIn(c, images, meta);
    if (pasted.length) {
      const last = out.findLast((e) => e?.op === "add");
      if (last) last.entry = withMedia(last.entry.type === "user" ? { ...last.entry, text: dropImageMarkers(last.entry.text, pasted.length) } : last.entry, pasted);
      else out.push(add({ key: `${o.uuid}:img`, type: "user", text: "", media: pasted, at }));
    }
    return out;
  }
  if (o.type === "assistant") {
    const out = [];
    (o.message?.content ?? []).forEach((b, i) => {
      const key = `${o.uuid}:${i}`;
      if (b?.type === "text" && b.text?.trim()) out.push(add({ key, type: "assistant", text: b.text, at }));
      else if (b?.type === "thinking" && b.thinking?.trim()) out.push(add({ key, type: "thinking", text: b.thinking, at }));
      else if (b?.type === "tool_use") out.push(add(tool(key, b.id, b.name, b.input, at, ctx, true)));
    });
    if (o.isApiErrorMessage) out.push(add({ key: `${o.uuid}:err`, type: "notice", text: "The model returned an error", at }));
    return out;
  }
  return [];
}

// ---- Codex (verified) ----
// A Reasoning item's words: a summary that says something, else its plain content (summary_text and raw_content are
// lists of strings or text blocks in today's rollouts; summary and content in older ones). Encrypted content is never
// read.
const reasoningText = (it) => {
  const summary = textOf(it.summary_text ?? it.summary);
  return summary.trim() ? summary : textOf(it.raw_content ?? it.content);
};

// Codex writes some folders as file:// URLs (CommandExecution.cwd in the captured rollout, line 19).
const folder = (c) => {
  if (typeof c !== "string") return undefined;
  if (!c.startsWith("file://")) return c;
  try { return decodeURIComponent(c.slice(7)); } catch { return undefined; }
};

export function mapCodex(o, state = {}, meta) {
  if ((o?.type === "session_meta" || o?.type === "turn_context") && typeof o.payload?.cwd === "string") state.cwd = folder(o.payload.cwd);
  if (!o || o.type !== "event_msg") return [];
  const p = o.payload ?? {};
  const at = Date.parse(o.timestamp) || null;
  const ctx = { cwd: state.cwd };
  if (p.type === "task_complete") return [{ op: "turn-end", key: `end:${p.turn_id}`, at }];
  if (p.type === "context_compacted") return [add({ key: `compact:${o.timestamp ?? at}`, type: "notice", text: COMPACTED, at })];
  if (p.type === "turn_aborted") return [add({ key: `abort:${p.turn_id ?? at}`, type: "notice", text: "Turn interrupted", at })];
  if (p.type !== "item_completed" && p.type !== "item_started") return [];
  const it = p.item ?? {};
  const done = p.type === "item_completed";
  if (it.type === "UserMessage" && done) {
    // Attachments: local_image parts name a file, image parts hold a data URL.
    const parts = Array.isArray(it.content) ? it.content : [];
    const files = parts.filter((x) => x?.type === "local_image" && typeof x.path === "string" && kindOf(x.path)).map((x) => fileRef(resolvePath(x.path, ctx)));
    const media = mergeRefs(files, inlineRefsIn(parts.filter((x) => x?.type === "image"), inlineImages(o), meta));
    const text = textOf(parts.filter((x) => x?.type === "text"));
    const e = userEntry(it.id, text, at) ?? (media.length ? { key: it.id, type: "user", text: "", at } : null);
    return [add(withMedia(e, media))].filter(Boolean);
  }
  if (it.type === "AgentMessage" && done) {
    const text = textOf(it.content);
    return text.trim() ? [add({ key: it.id, type: "assistant", text, phase: it.phase ?? null, at })] : [];
  }
  if (it.type === "Reasoning" && done) {
    const text = reasoningText(it);
    return text.trim() ? [add({ key: it.id, type: "thinking", text, at })] : [];
  }
  if (it.type === "CommandExecution") {
    const cmd = Array.isArray(it.command) ? it.command.at(-1) : it.command;
    const out = [add(tool(it.id, it.id, "Shell", { command: cmd }, at, { cwd: folder(it.cwd) ?? state.cwd }, true))];
    if (done) {
      const st = it.status === "declined" ? "rejected" : it.status === "failed" || (it.exit_code ?? 0) !== 0 ? "error" : "ok";
      out.push(result(it.id, st, it.aggregated_output, null, typeof it.exit_code === "number" ? it.exit_code : null));
    }
    return out;
  }
  if (it.type === "FileChange") {
    // changes: a map of path to its change, or a list of {path, ...}; both read the same (codeview.js codexChanges).
    const changes = codexChanges(it.changes);
    const files = changes.map((c) => c.path.split(" → ")[0]);
    const out = [add(withMedia({ ...relabel(tool(it.id, it.id, "Edit", {}, at, {}, true), "Edit", "Edited"), detail: files.join(", ") || "files", ...(changes.length ? { changes } : {}) },
      mergeRefs(files.filter(kindOf).map((f) => resolvePath(f, ctx)).filter(Boolean).map(fileRef))))];
    if (done) out.push(result(it.id, it.status === "failed" ? "error" : it.status === "declined" ? "rejected" : "ok", ""));
    return out;
  }
  if (it.type === "McpToolCall") {
    const out = [add(tool(it.id, it.id, `${it.server ?? "mcp"}.${it.tool ?? "tool"}`, it.arguments, at, ctx, true))];
    if (done) out.push(result(it.id, it.status === "failed" || it.error ? "error" : "ok", textOf(it.result?.content) || it.error?.message || ""));
    return out;
  }
  if (it.type === "ImageView" || it.type === "ImageGeneration") {
    // An image the agent looked at, or one it made and saved.
    const path = it.saved_path ?? it.savedPath ?? it.path;
    const view = it.type === "ImageView";
    const entry = { ...relabel(tool(it.id, it.id, it.type, {}, at, {}, true), view ? "View" : "Generate an image", view ? "Viewed" : "Generated an image"), detail: path ?? it.revised_prompt ?? "" };
    const out = [add(withMedia(entry, typeof path === "string" && kindOf(path) ? [fileRef(resolvePath(path, ctx))] : []))];
    if (done || view) out.push(result(it.id, it.status === "failed" ? "error" : "ok", ""));
    return out;
  }
  if (it.type === "HookPrompt" && done) {
    const text = (Array.isArray(it.fragments) ? it.fragments : []).map((f) => f?.text ?? "").join(" ").trim();
    return [add(hookEntry(it.id ?? `hook:${at}`, { type: "hook_additional_context", hookEvent: "Hook prompt", hookName: text.split("\n")[0] }, at))];
  }
  if (it.type === "WebSearch") {
    return [add({ ...tool(it.id, it.id, "WebSearch", { query: it.query }, at, {}, true) }), ...(done ? [result(it.id, "ok", "")] : [])];
  }
  return [];
}

// ---- Grok Build (partial: documented, not verified here) ----
export function mapGrok(o, state) {
  const u = o?.params?.update;
  if (!u) return [];
  const at = (o.timestamp ?? 0) * 1000 || null;
  const prompt = o.params?._meta?.promptId ?? u._meta?.promptIndex ?? "p";
  const chunk = (type) => {
    const k = `${type}:${prompt}:${state.run ?? 0}`;
    if (state.last !== type) state.run = (state.run ?? 0) + 1;
    state.last = type;
    return { op: "append", key: `${type}:${prompt}:${state.run}`, type, text: u.content?.text ?? "", at, _k: k };
  };
  switch (u.sessionUpdate) {
    case "user_message_chunk": return [chunk("user")];
    case "agent_message_chunk": return [chunk("assistant")];
    case "agent_thought_chunk": return [chunk("thinking")];
    case "tool_call": state.last = "tool"; return [add(tool(`tool:${u.toolCallId}`, u.toolCallId, u.title ?? "tool", u.rawInput, at))];
    case "tool_call_update":
      if (u.status === "completed" || u.status === "failed") return [result(u.toolCallId, u.status === "failed" ? "error" : "ok", textOf((u.content ?? []).map((c) => c.content ?? c)))];
      return [];
    case "turn_completed": state.last = null; return [{ op: "turn-end", key: `end:${u.prompt_id}`, at }];
    default: return [];
  }
}

// ---- Pi and Oh My Pi (partial) ----
export function mapPi(o) {
  if (o?.type !== "message") return [];
  const m = o.message ?? {};
  const at = Date.parse(o.timestamp) || null;
  if (m.role === "user") return [add(userEntry(o.id, textOf(m.content), at))].filter(Boolean);
  if (m.role === "toolResult") return [result(m.toolCallId, m.isError ? "error" : "ok", textOf(m.content))];
  if (m.role !== "assistant") return [];
  return (m.content ?? []).map((b, i) => {
    const key = `${o.id}:${i}`;
    if (b.type === "text" && b.text?.trim()) return add({ key, type: "assistant", text: b.text, at });
    if (b.type === "thinking" && b.thinking?.trim()) return add({ key, type: "thinking", text: b.thinking, at });
    if (b.type === "toolCall") return add(tool(key, b.id, b.name, b.arguments, at));
    return null;
  }).filter(Boolean);
}

// ---- Kimi Code (partial, source only) ----
const args = (s) => { try { return typeof s === "string" ? JSON.parse(s) : s; } catch { return {}; } };
// A JSON text field from a store row: its value, or `bad` when it is not JSON (never thrown, never dropped silently).
const BAD = Symbol("bad");
const parsed = (s) => { if (typeof s !== "string") return s ?? null; try { return JSON.parse(s); } catch { return BAD; } };
const unreadable = (key, at, what) => add({ key: `bad:${key}`, type: "notice", text: `${what} tremor could not read was left out`, at });
const tooLarge = (key, at) => add({ key: `big:${key}`, type: "notice", text: "A record too large to show was skipped", at });
export function mapKimi(o, state) {
  const at = o?.time ?? null;
  if (o?.type === "turn.ended") return [{ op: "turn-end", key: `end:${o.turnId}`, at }];
  if (o?.type !== "context.append_message") return [];
  const m = o.message ?? {};
  state.n = (state.n ?? 0) + 1;
  const key = `k${state.n}`;
  if (m.role === "user") return [add(userEntry(key, textOf(m.content), at))].filter(Boolean);
  if (m.role === "tool") return [result(m.toolCallId, m.isError ? "error" : "ok", textOf(m.content))];
  if (m.role !== "assistant") return [];
  const out = [];
  (m.content ?? []).forEach((p, i) => {
    if (p.type === "text" && p.text?.trim()) out.push(add({ key: `${key}:${i}`, type: "assistant", text: p.text, at }));
    if (p.type === "think" && p.think?.trim()) out.push(add({ key: `${key}:${i}`, type: "thinking", text: p.think, at }));
  });
  for (const c of m.toolCalls ?? []) out.push(add(tool(`${key}:${c.id}`, c.id, c.name ?? c.function?.name, args(c.arguments ?? c.function?.arguments), at)));
  return out;
}

// ---- Gemini CLI (partial, source only) ----
export function mapGemini(o) {
  if (!o) return [];
  if (o.$patch) return (o.$patch.toolCalls ?? []).filter((c) => c.result).map((c) => result(c.id, c.status === "error" ? "error" : "ok", textOf((c.result ?? []).map((r) => r.functionResponse?.response?.output ?? ""))));
  if (o.$rewindTo) return [add({ key: `rewind:${o.$rewindTo}`, type: "notice", text: "Rewound to an earlier message", at: null })];
  const at = Date.parse(o.timestamp) || null;
  if (o.type === "user") return [add(userEntry(o.id, textOf(o.content), at))].filter(Boolean);
  if (o.type !== "gemini") return [];
  const out = [];
  const text = textOf(o.content);
  if (text.trim()) out.push(add({ key: o.id, type: "assistant", text, at }));
  for (const c of o.toolCalls ?? []) {
    out.push(add(tool(`${o.id}:${c.id}`, c.id, c.name, c.args, at)));
    if (c.result) out.push(result(c.id, c.status === "error" ? "error" : "ok", textOf(c.result.map((r) => r.functionResponse?.response?.output ?? ""))));
  }
  return out;
}

// ---- Hermes (rows from state.db, shapes captured from real 0.23.0 sessions by qa-modpack: hermes.js) ----
// Around qa-modpack's mapper (F9): a row the helper skipped keeps its place, and tool calls that are not JSON say so.
export function mapHermes(r) {
  const at = r?.timestamp ? r.timestamp * 1000 : null;
  if (r?.skipped) {
    // A tool's result still ends its call.
    return r.role === "tool" && r.tool_call_id ? [result(r.tool_call_id, "ok", "(output too large to show)")] : [tooLarge(`h${r.id}`, at)];
  }
  const out = mapHermesRow(r);
  if (r?.role === "assistant" && r.active !== 0 && r.active !== false) {
    const calls = parsed(r.tool_calls);
    if (calls === BAD || (calls != null && !Array.isArray(calls))) out.push(unreadable(`h${r.id}`, at, "A tool call"));
  }
  return out;
}

// ---- OpenCode (partial; rows from opencode.db) ----
export function mapOpenCode(r) {
  const at = r?.time_created ?? null;
  if (r?.skipped) return [tooLarge(r.id ?? r.seq, at)];
  const d = parsed(r?.data) ?? {};
  if (d === BAD || typeof d !== "object") return [unreadable(r?.id ?? r?.seq, at, "A record")];
  if (r?.type === "user") return [add(userEntry(r.id, d.text, at))].filter(Boolean);
  if (r?.type === "idle") return [{ op: "turn-end", key: `end:${r.id}`, at }];
  if (r?.type !== "assistant") return [];
  const out = [];
  (d.content ?? []).forEach((c, i) => {
    const key = `${r.id}:${i}`;
    if (c.type === "text" && c.text?.trim()) out.push(add({ key, type: "assistant", text: c.text, at }));
    else if (c.type === "reasoning" && c.text?.trim()) out.push(add({ key, type: "thinking", text: c.text, at }));
    else if (c.type === "tool") {
      out.push(add(tool(key, c.id, c.name, c.state?.input, at)));
      const st = c.state?.status;
      if (st === "completed" || st === "error") out.push(result(c.id, st === "error" ? "error" : "ok", textOf(c.state?.content ?? c.state?.output)));
    }
  });
  return out;
}

export const MAPPERS = { claude: mapClaude, codex: mapCodex, grok: mapGrok, pi: mapPi, omp: mapPi, kimi: mapKimi, gemini: mapGemini, hermes: mapHermes, opencode: mapOpenCode };

// What the pack can say about each kind's chat (see MATRIX.md for the evidence).
export const SUPPORT = {
  claude: { level: "verified", note: "Format verified against a captured Claude Code 2.1.319 transcript" },
  codex: { level: "verified", note: "Format verified against a captured Codex 0.167.0 rollout" },
  grok: { level: "partial", note: "Format from documentation; not verified on this Mac" },
  pi: { level: "partial", note: "Format from documentation; needs Heeler's Pi extension to find the session" },
  omp: { level: "partial", note: "Format from documentation; needs Heeler's Pi extension to find the session" },
  opencode: { level: "partial", note: "Store from documentation; only sessions started with -s" },
  hermes: { level: "partial", note: "Rows and the per-terminal session record captured from real Hermes 0.23.0 sessions on this Mac; Hermes reports no status (no OSC 7501)" },
  kimi: { level: "partial", note: "Format from Kimi source; its session can't be located without listing" },
  gemini: { level: "partial", note: "Format from Gemini source; its session file can't be located without listing" },
  "cursor-agent": { level: "unsupported", note: "Cursor Agent keeps no documented transcript for an interactive session" },
};

// A tool call takes its result. An image the result holds inline shows only when the call names no image
// file (a Read of a .png shows the file, not the transcript's copy of it).
function takeResult(t, r) {
  Object.assign(t, { status: r.status }, t.rich ? resultFields(t, r.output, r.exit ?? null) : { output: clip(r.output) });
  if (t.done) t.verb = r.status === "ok" ? t.done : t.doing;
  if (r.media?.length && !t.media?.some((m) => m.kind === "image")) t.media = mergeRefs(t.media ?? [], r.media);
}

// An assistant message as the chat shows it: Markdown with its images taken out, as media (F6). Kept until the
// text changes (chunks append to it).
function shown(e) {
  if (e[SHOWN]?.from !== e.text) {
    const s = stripImages(e.text, { cwd: e.cwd });
    const row = s.refs.length || s.text !== e.text ? { ...e, text: s.text, media: mergeRefs(s.refs, e.media ?? []) } : null;
    Object.defineProperty(e, SHOWN, { value: { from: e.text, row }, writable: true, configurable: true });
  }
  return e[SHOWN].row ?? e;
}
const SHOWN = Symbol("shown"); // not enumerable: never copied into a row or serialised

// One conversation: entries by key in first-seen order, tool results paired by id (a result that comes before
// its call waits for it), chunks appended.
export class Thread {
  constructor() {
    this.entries = [];
    this.byKey = new Map();
    this.tools = new Map();
    this.early = new Map();
  }

  apply(events) {
    for (const e of events) {
      if (!e) continue;
      if (e.op === "add") this.put(e.entry);
      else if (e.op === "append") {
        const have = this.byKey.get(e.key);
        if (have) have.text += e.text;
        else this.put({ key: e.key, type: e.type, text: e.text, at: e.at });
      } else if (e.op === "result") {
        const t = this.tools.get(e.id);
        if (t) takeResult(t, e);
        else this.early.set(e.id, e);
      } else if (e.op === "turn-end") this.put({ key: e.key, type: "turn-end", at: e.at });
    }
    return this;
  }

  put(entry) {
    if (!entry || this.byKey.has(entry.key)) {
      // The same item again (an item_started then item_completed): keep the first place, take new fields.
      if (entry && entry.type === "tool") {
        const have = this.byKey.get(entry.key);
        if (have.status === "pending" && entry.status !== "pending") Object.assign(have, entry);
      }
      return;
    }
    this.entries.push(entry);
    this.byKey.set(entry.key, entry);
    if (entry.type === "tool") {
      this.tools.set(entry.id, entry);
      const r = this.early.get(entry.id);
      if (r) { takeResult(entry, r); this.early.delete(entry.id); }
    }
  }

  // Keeps memory bounded on a long session: past `limit` entries the oldest third goes (with its tool calls and any
  // result still waiting for a call). True when something went.
  trim(limit) {
    if (this.entries.length <= limit) return false;
    for (const e of this.entries.splice(0, Math.floor(this.entries.length / 3))) {
      this.byKey.delete(e.key);
      if (e.type === "tool") this.tools.delete(e.id);
    }
    while (this.early.size > limit) this.early.delete(this.early.keys().next().value);
    return true;
  }

  // Timeline rows: user and assistant messages, and the tool work and thinking between them as one group.
  rows() {
    const rows = [];
    let group = null;
    for (const e of this.entries) {
      if (e.type === "tool" || e.type === "thinking") {
        if (!group) { group = { type: "work", key: `work:${e.key}`, items: [] }; rows.push(group); }
        group.items.push(e);
        continue;
      }
      group = null;
      if (e.type === "turn-end") continue;
      rows.push(e.type === "assistant" ? shown(e) : e);
    }
    return rows;
  }
}

// Parse JSONL lines into records; a line that is not JSON is skipped (a torn line, never shown raw).
export function parseLines(lines) {
  const out = [];
  for (const [offset, text] of lines) {
    try { out.push({ offset, record: JSON.parse(text) }); } catch { /* skipped */ }
  }
  return out;
}

// Feed records through a kind's mapper into a thread. A record read from a file comes as {offset, record, path};
// its offset and path let an inline image be found again (media.js inlineRef). User and assistant rows get the
// media their text names, relative paths against the record's own cwd.
export function feed(thread, kind, records, state = {}) {
  const map = MAPPERS[kind];
  if (!map) return thread;
  for (const r of records) {
    const rec = r.record ?? r;
    const events = map(rec, state, r.record ? { offset: r.offset, path: r.path } : null);
    for (const e of events) {
      const en = e?.op === "add" ? e.entry : null;
      if (en && (en.type === "user" || en.type === "assistant") && en.text) {
        const cwd = rec?.cwd ?? state.cwd;
        const refs = refsFromText(en.text, { cwd });
        if (refs.length || (cwd && en.type === "assistant")) e.entry = { ...en, ...(cwd && en.type === "assistant" ? { cwd } : {}), media: mergeRefs(refs, en.media ?? []) };
      }
    }
    thread.apply(events);
  }
  return thread;
}
