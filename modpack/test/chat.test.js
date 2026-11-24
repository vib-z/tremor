// Every adapter against its fixtures: the two captured samples (Claude Code, Codex) and the documented-format
// samples (labelled CONSTRUCTED in their SOURCE.md). Plus pairing, grouping, claimed senders, and that
// account and system metadata never reach a row.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Thread, feed, parseLines, MAPPERS, SUPPORT, userEntry, mapClaude, mapHermes, mapOpenCode } from "../adapters/chat.js";

const FIX = join(import.meta.dir, "../../docs/modpack/research/fixtures");
const lines = (rel) => readFileSync(join(FIX, rel), "utf8").split("\n").filter(Boolean).map((t, i) => [i, t]);
const thread = (kind, rel) => feed(new Thread(), kind, parseLines(lines(rel)), {});
const json = (rel) => readFileSync(join(FIX, rel), "utf8").split("\n").filter(Boolean).map((t) => JSON.parse(t));

test("Claude Code (captured 2.1.319): prompt, two tool calls (one rejected), answer", () => {
  const rows = thread("claude", "claude-code/haiku-two-files.jsonl").rows();
  expect(rows.map((r) => r.type)).toEqual(["user", "work", "assistant"]);
  expect(rows[0].text).toBe("List two files here, then say done.");
  const [rejected, ok] = rows[1].items;
  expect(rejected.status).toBe("rejected");
  expect(rejected.verb).toBe("Run"); // F11: never "Ran" for a call that did not run
  expect(ok.status).toBe("ok");
  expect(ok.verb).toBe("Ran");
  expect(ok.output).toContain("alpha.txt");
  expect(rows[2].text).toBe("alpha.txt and beta.md\n\nDone.");
});

test("Claude Code: account and system metadata never reach a row", () => {
  const all = JSON.stringify(thread("claude", "claude-code/haiku-two-files.jsonl").entries);
  for (const secret of ["accountUuid", "organizationUuid", "session-owner", "api-request", "signature", "attachment"]) expect(all).not.toContain(secret);
});

test("Codex (captured 0.167.0): user, commentary, the command, final answer; developer and AGENTS.md items excluded", () => {
  const rows = thread("codex", "codex/rollout-luna-two-files.jsonl").rows();
  expect(rows.map((r) => r.type)).toEqual(["user", "assistant", "work", "assistant"]);
  expect(rows[0].text).toBe("List two files here, then say done.");
  expect(rows[1].phase).toBe("commentary");
  expect(rows[2].items[0].detail).toBe("rg --files | head -n 2");
  expect(rows[2].items[0].status).toBe("ok");
  expect(rows[3].text).toContain("done");
  const all = JSON.stringify(rows);
  for (const hidden of ["creator_account_id", "creator_user_id", "developer instructions", "owner AGENTS.md", "base_instructions"]) expect(all).not.toContain(hidden);
});

const DOCUMENTED = {
  grok: "grok/updates.jsonl",
  pi: "pi/session.jsonl",
  kimi: "kimi/wire.jsonl",
  gemini: "gemini/session.jsonl",
};
for (const [kind, rel] of Object.entries(DOCUMENTED)) {
  test(`${kind} (documented format, not captured): user, a paired tool call, the answer`, () => {
    const rows = thread(kind, rel).rows();
    expect(rows[0].type).toBe("user");
    expect(rows[0].text).toBe("List two files here, then say done.");
    const work = rows.find((r) => r.type === "work");
    expect(work.items.find((i) => i.type === "tool").status).toBe("ok");
    expect(rows.at(-1).type).toBe("assistant");
    expect(rows.at(-1).text).toContain("Done");
    expect(SUPPORT[kind].level).toBe("partial");
  });
}

test("hermes and opencode rows (documented, store rows): user, a paired tool call, the answer", () => {
  for (const [kind, rel] of [["hermes", "hermes/messages.jsonl"], ["opencode", "opencode/session_message.jsonl"]]) {
    const rows = feed(new Thread(), kind, json(rel), {}).rows();
    expect(rows[0].type).toBe("user");
    const tool = rows.find((r) => r.type === "work").items.find((i) => i.type === "tool");
    expect(tool.status).toBe("ok");
    expect(rows.at(-1).text).toContain("Done");
  }
});

test("Cursor Agent has no adapter and an unsupported label", () => {
  expect(MAPPERS["cursor-agent"]).toBeUndefined();
  expect(SUPPORT["cursor-agent"].level).toBe("unsupported");
});

test("a message another terminal typed is a claim, never a verified sender", () => {
  const e = userEntry("k", '<hc from="t7">please review the table</hc>', 0);
  expect(e.claimedFrom).toBe("t7");
  expect(e.text).toBe("please review the table");
  expect(userEntry("k", "plain text", 0).claimedFrom).toBeUndefined();
});

test("a result read before its call still pairs; reading the same records twice adds nothing", () => {
  const t = new Thread();
  t.apply([{ op: "result", id: "x", status: "error", output: "boom" }]);
  t.apply([{ op: "add", entry: { key: "c", type: "tool", id: "x", name: "Bash", verb: "Ran", detail: "ls", status: "pending" } }]);
  expect(t.entries[0].status).toBe("error");
  const once = thread("claude", "claude-code/haiku-two-files.jsonl");
  const n = once.entries.length;
  feed(once, "claude", parseLines(lines("claude-code/haiku-two-files.jsonl")), {});
  expect(once.entries.length).toBe(n);
});

test("unknown record types, torn lines and sidechains are dropped, never shown raw", () => {
  const t = feed(new Thread(), "claude", parseLines([[0, '{"type":"brand-new-thing","text":"x"}'], [1, '{"type":"user","mess'],
    [2, JSON.stringify({ type: "user", uuid: "s", isSidechain: true, message: { content: "sub-agent internals" } })]]), {});
  expect(t.entries).toEqual([]);
  expect(mapClaude({ type: "user", uuid: "r", message: { content: "<system-reminder>hidden</system-reminder>" } })).toEqual([]);
});


test("F11: a pending call reads in the present (Write), a finished one in the past (Wrote), a failed one never in the past", () => {
  const t = new Thread();
  const call = (id) => ({ type: "assistant", uuid: `a${id}`, message: { content: [{ type: "tool_use", id, name: "Write", input: { file_path: "/w/notes.txt" } }] } });
  const res = (id, extra) => ({ type: "user", uuid: `u${id}`, message: { content: [{ type: "tool_result", tool_use_id: id, content: "x", ...extra }] } });
  feed(t, "claude", [call("p"), call("k"), res("k"), call("e"), res("e", { is_error: true })]);
  const [p, k, e] = t.entries;
  expect([p.verb, p.status]).toEqual(["Write", "pending"]);
  expect([k.verb, k.status]).toEqual(["Wrote", "ok"]);
  expect([e.verb, e.status]).toEqual(["Write", "error"]);
  const codex = feed(new Thread(), "codex", [{ type: "event_msg", payload: { type: "item_started", item: { type: "CommandExecution", id: "c1", command: ["/bin/zsh", "-lc", "make"] } } }]);
  expect(codex.entries[0].verb).toBe("Run");
});

test("F9: Hermes and OpenCode rows with bad JSON, or that the helper skipped, become a notice; nothing throws or vanishes", () => {
  expect(() => mapHermes({ id: 1, role: "assistant", content: "", tool_calls: '[{"id":"c1","function":{"name":"x","arguments":"{\\"a' })).not.toThrow();
  const bad = mapHermes({ id: 1, role: "assistant", content: "ok", tool_calls: "{not json" });
  expect(bad.map((e) => e.entry.type)).toEqual(["assistant", "notice"]);
  expect(mapHermes({ id: 2, role: "assistant", content: "", tool_calls: '{"id":"c1"}' })[0].entry.type).toBe("notice");
  expect(mapHermes({ id: 3, role: "user", skipped: true })[0].entry.text).toContain("too large");
  // A skipped tool result still ends its call.
  const t = feed(new Thread(), "hermes", [{ id: 4, role: "assistant", content: "", tool_calls: '[{"id":"c9","function":{"name":"terminal","arguments":"{\\"command\\":\\"ls\\"}"}}]' },
    { id: 5, role: "tool", tool_call_id: "c9", skipped: true }]);
  expect(t.entries[0].status).toBe("ok");
  expect(mapOpenCode({ id: "m1", type: "assistant", data: "{broken" })[0].entry.type).toBe("notice");
  expect(mapOpenCode({ seq: 7, skipped: true })[0].entry.text).toContain("too large");
  expect(mapOpenCode({ id: "m2", type: "assistant", data: JSON.stringify({ content: [{ type: "text", text: "fine" }] }) })[0].entry.text).toBe("fine");
});

test("Claude Code's local commands: the caveat is never shown, the output is a quiet notice, the command its own row", async () => {
  const { userEntry } = await import("../adapters/chat.js");
  expect(userEntry("a", "<local-command-caveat>The command below was run directly in Claude Code, not sent to you.</local-command-caveat>", 1)).toBeNull();
  expect(userEntry("b", "<local-command-stdout>Set model to `Haiku 5.5` for this session only with `low` effort</local-command-stdout>", 2))
    .toEqual({ key: "b", type: "notice", text: "Set model to Haiku 5.5 for this session only with low effort", at: 2 });
  expect(userEntry("c", "<local-command-stdout></local-command-stdout>", 3)).toBeNull();
  expect(userEntry("d", "<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args></command-args>", 4)).toMatchObject({ type: "user", text: "/model" });
  expect(userEntry("e", "Say hi", 5)).toMatchObject({ type: "user", text: "Say hi" });
});

test("the composer's picked folders follow the text as typed paths, quoted when they hold a space", async () => {
  const { withFolders } = await import("../adapters/chat.js");
  expect(withFolders("  look here ", ["/Users/me/code/app"])).toBe("look here /Users/me/code/app");
  expect(withFolders("", ["/Users/me/My Docs", '/tmp/a"b'])).toBe('"/Users/me/My Docs" "/tmp/a\\"b"');
  expect(withFolders("only text", [])).toBe("only text");
  expect(withFolders("", [])).toBe("");
});

// Mapper gaps (remote-chat-plan-3 "What was learned" 1 and 4), from records written here.
const rec = (o) => ({ timestamp: "2026-11-11T22:00:00Z", ...o });
const run = (kind, records) => feed(new Thread(), kind, records.map(rec), {}).rows();
const reasoning = (item) => rec({ type: "event_msg", payload: { type: "item_completed", item: { type: "Reasoning", id: "r1", ...item } } });

test("Codex reasoning: a summary that says something first, else the plain content; never encrypted content", () => {
  const think = (item) => run("codex", [reasoning(item)]).flatMap((r) => r.items ?? []).map((i) => i.text);
  expect(think({ summary_text: ["Plan the change", { type: "text", text: "then test" }], raw_content: ["raw"] })).toEqual(["Plan the change\nthen test"]);
  expect(think({ summary_text: [], raw_content: [{ type: "text", text: "plain thought" }] })).toEqual(["plain thought"]);
  expect(think({ summary_text: ["  "], raw_content: ["only this"] })).toEqual(["only this"]);
  expect(think({ summary: [{ type: "summary_text", text: "older shape" }] })).toEqual(["older shape"]);
  expect(think({ summary_text: [], encrypted_content: "gAAAAB..." })).toEqual([]);
});

test("Claude: a string-form user record that is Claude Code's own (isMeta, isCompactSummary) is not a person's message", () => {
  const rows = run("claude", [
    { type: "user", uuid: "u1", message: { content: "a real prompt" } },
    { type: "user", uuid: "u2", isMeta: true, message: { content: "Caveat: the messages below were generated by the user" } },
    { type: "user", uuid: "u3", isCompactSummary: true, message: { content: "This session is being continued from a previous conversation." } },
    { type: "user", uuid: "u4", isCompactSummary: true, message: { content: [{ type: "text", text: "Summary in blocks" }] } },
  ]);
  expect(rows.map((r) => [r.type, r.text])).toEqual([["user", "a real prompt"]]);
});

test("compaction is one quiet notice (Claude compact_boundary, Codex context_compacted), never the summary as a message", () => {
  const claude = run("claude", [
    { type: "user", uuid: "u1", message: { content: "before" } },
    { type: "system", uuid: "s1", subtype: "compact_boundary", compactMetadata: { trigger: "auto", preTokens: 160000 } },
    { type: "system", uuid: "s1", subtype: "compact_boundary" }, // read twice: still one
    { type: "user", uuid: "u2", isCompactSummary: true, message: { content: "Summary: ..." } },
    { type: "system", uuid: "s2", subtype: "informational", content: "not shown" },
  ]);
  expect(claude.map((r) => [r.type, r.text])).toEqual([["user", "before"], ["notice", "Context compacted"]]);
  const codex = run("codex", [{ type: "event_msg", payload: { type: "context_compacted" } }]);
  expect(codex.map((r) => [r.type, r.text])).toEqual([["notice", "Context compacted"]]);
});

// Round 2 (owner, 11 Nov 2026 23:08): a call opens to its arguments, code, diffs and result.
import { callArgs, resultFields, langOf, ARG_LIMIT, RESULT_LIMIT } from "../adapters/chat.js";
const one = (recs) => feed(new Thread(), "claude", recs.map((record, i) => ({ offset: i, record })), {}).entries.filter((e) => e.type === "tool");
const use = (id, name, input) => ({ type: "assistant", uuid: `a-${id}`, message: { content: [{ type: "tool_use", id, name, input }] } });
const res = (id, content, extra = {}) => ({ type: "user", uuid: `u-${id}`, message: { content: [{ type: "tool_result", tool_use_id: id, content, ...extra }] } });

test("rich calls: arguments in order, typed, and cut at their ceiling", () => {
  expect(callArgs({ command: "rg --files\n| head", description: "List", timeout: 5000 })).toEqual([
    { key: "command", text: "rg --files\n| head", lang: "bash" }, { key: "description", text: "List", lang: null }, { key: "timeout", text: "5000", lang: "json" }]);
  expect(callArgs({ file_path: "/w/a.py", content: "x = 1" })).toEqual([{ key: "file_path", text: "/w/a.py", lang: null }, { key: "content", text: "x = 1", lang: "python" }]);
  // What the diff shows is not repeated.
  expect(callArgs({ file_path: "/w/a.py", old_string: "a", new_string: "b" }, [{ path: "/w/a.py" }]).map((a) => a.key)).toEqual(["file_path"]);
  expect(callArgs({ q: { nested: [1, 2] } })[0]).toEqual({ key: "q", text: '{\n  "nested": [\n    1,\n    2\n  ]\n}', lang: "json" });
  expect(callArgs({ command: "x".repeat(ARG_LIMIT + 50) })[0].text.length).toBe(ARG_LIMIT);
  expect([langOf("a/b.TSX"), langOf("Makefile"), langOf("x.rs")]).toEqual(["tsx", null, "rust"]);
});

test("rich results: 16,000 characters, JSON and read files highlighted, a one-line summary", () => {
  const [run, read, mcp, fail, big] = one([
    use("r1", "Bash", { command: "npm test" }), res("r1", "\n\n  12 passed\nall good"),
    use("r2", "Read", { file_path: "/w/src/main.js" }), res("r2", "     1→const a = 1;\n     2→export default a;"),
    use("r3", "mcp__github__search_issues", { query: "bug" }), res("r3", '{"total": 3, "items": []}'),
    use("r4", "Bash", { command: "false" }), res("r4", "boom", { is_error: true }),
    use("r5", "Bash", { command: "yes" }), res("r5", "y\n".repeat(20000)),
  ]);
  expect([run.rich, run.status, run.summary, run.outputLang]).toEqual([true, "ok", "12 passed", null]);
  expect([read.output, read.outputLang, read.summary]).toEqual(["const a = 1;\nexport default a;", "js", null]); // the file's own text
  expect([mcp.outputLang, mcp.summary, mcp.args[0], mcp.done, mcp.detail]).toEqual(["json", null, { key: "query", text: "bug", lang: null }, "Called", "github.search_issues"]);
  expect([fail.status, fail.summary]).toEqual(["error", "boom"]);
  expect(big.output.length).toBe(RESULT_LIMIT);
  expect(resultFields({ name: "Shell" }, "ok\n", 2).summary).toBe("Exit 2"); // what the record states
  expect(resultFields({ name: "Shell" }, "x".repeat(300)).summary.length).toBe(120);
});

test("the captured samples carry arguments and results", () => {
  const c = thread("claude", "claude-code/haiku-two-files.jsonl").entries.filter((e) => e.type === "tool");
  expect(c.map((t) => [t.rich, t.status, t.args.map((a) => [a.key, a.lang])])).toEqual([
    [true, "rejected", [["command", "bash"], ["description", null]]], [true, "ok", [["command", "bash"], ["description", null]]]]);
  expect(c[1].summary).toBe("alpha.txt");
  const x = thread("codex", "codex/rollout-luna-two-files.jsonl").entries.filter((e) => e.type === "tool");
  expect(x.every((t) => t.rich && t.args[0]?.key === "command" && t.args[0].lang === "bash")).toBe(true);
  expect(x.at(-1).status).toBe("ok");
  // Other kinds keep what they had.
  expect(thread("pi", "pi/session.jsonl").entries.filter((e) => e.type === "tool").every((t) => !t.rich)).toBe(true);
});

import { fences } from "../adapters/chat.js";
test("an agent message is cut at its fenced code blocks, an unfinished one included", () => {
  expect(fences("Before:\n\n```js\nlet a = 1;\n```\n\nAfter.")).toEqual([{ md: "Before:\n\n" }, { code: "let a = 1;", lang: "js" }, { md: "\nAfter." }]);
  expect(fences("No code here.")).toEqual([{ md: "No code here." }]);
  expect(fences("Streaming:\n```py\nx = 1\ny =")).toEqual([{ md: "Streaming:\n" }, { code: "x = 1\ny =", lang: "py" }]);
  expect(fences("````md\n```js\ninner\n```\n````")).toEqual([{ code: "```js\ninner\n```", lang: "md" }]);
  expect(fences("```\nplain\n```")).toEqual([{ code: "plain", lang: null }]);
});
