// Hermes on this Mac, from this lane's own captured sessions (fixtures/hermes/SOURCE.md): recognising the terminal,
// binding by the per-tty breadcrumb with freshness and folder checks, mapping real rows, and the helper's `rows`
// query against the real table shape.
import { test, expect } from "bun:test";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { mapHermesRow, toolOutcome } from "../adapters/hermes.js";
import { Thread } from "../adapters/chat.js";
import { lstartMs } from "../adapters/binding.js";

const FIX = join(import.meta.dir, "fixtures/hermes");
const rows = readFileSync(join(FIX, "messages.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const terminal = JSON.parse(readFileSync(join(FIX, "terminal-t3.json"), "utf8"));
const crumb = readFileSync(join(FIX, "tty-dev-ttys055.json"), "utf8");
const SESSION = "local-fd77ba7dbbb3120a3c876b5c082501f0de12a10231f91aff3d61b3bac8c10af5";
const CWD = "/Users/me/code/jobs/worktrees/core-client-1108-qa/modpack/.sandbox/qa/work/alpha";
const START = lstartMs("Mon Nov  9 09:00:21 2026");
const thread = (rs) => { const t = new Thread(); for (const r of rs) t.apply(mapHermesRow(r)); return t; };

test("captured rows: the prompt, the terminal call with its real output, the answer", () => {
  const t = thread(rows.filter((r) => r.session_id === SESSION && r.id <= 3471));
  const out = t.rows();
  expect(out.map((r) => r.type)).toEqual(["user", "work", "assistant"]);
  expect(out[0].text).toBe("List two files here, then say done.");
  const call = out[1].items[0];
  expect(call.verb).toBe("Ran");
  expect(call.detail).toBe("ls -1 | head -n 2");
  expect(call.status).toBe("ok");
  expect(call.output).toBe("alpha.txt\nbeta.md");
  expect(out[2].text).toBe("alpha.txt\nbeta.md\n\nDone.");
});

test("a flagged command keeps Hermes' own approval verdict as a line of the result (captured row 3474)", () => {
  const flagged = rows.find((r) => r.id === 3474);
  const o = toolOutcome(flagged.content);
  expect(o.status).toBe("ok");
  expect(o.output).toBe("exit=0\nApproval: Command was flagged (delete in root path) and auto-approved by smart approval.");
  const t = thread(rows.filter((r) => r.session_id === SESSION && r.id >= 3472));
  expect(t.rows().map((r) => r.type)).toEqual(["user", "work", "assistant"]);
});

test("a Hermes terminal call that names a media file carries it as media, resolved against the session's folder", () => {
  const row = { ...rows[1], tool_calls: JSON.stringify([{ id: "call_m", type: "function", function: { name: "terminal", arguments: JSON.stringify({ command: "ls -la /w/media/chart.png /w/media/clip.mp4" }) } }]) };
  const [e] = mapHermesRow(row, { cwd: "/w" });
  expect(e.entry.type).toBe("tool");
  expect(e.entry.media.map((m) => [m.kind, m.path])).toEqual([["image", "/w/media/chart.png"], ["video", "/w/media/clip.mp4"]]);
  expect(mapHermesRow(rows[1])[0].entry.media).toBeUndefined();
});

test("a failed terminal call reads as an error; a non-JSON result is shown as it is; retired rows are skipped", () => {
  expect(toolOutcome(JSON.stringify({ output: "x", exit_code: 1, error: null }))).toEqual({ status: "error", output: "x" });
  expect(toolOutcome(JSON.stringify({ output: "", exit_code: 0, error: "denied" }))).toEqual({ status: "error", output: "denied" });
  expect(toolOutcome("plain text")).toEqual({ status: "ok", output: "plain text" });
  expect(mapHermesRow({ ...rows[0], active: 0 })).toEqual([]);
  const t = thread([rows[1], { ...rows[2], content: JSON.stringify({ output: "boom", exit_code: 2, error: null }) }]);
  expect(t.entries[0].status).toBe("error");
});

test("the helper's `rows hermes` query runs against the real table shape and feeds the mapper", () => {
  const home = mkdtempSync(join(tmpdir(), "pdk-hermes-"));
  mkdirSync(join(home, ".hermes"));
  // The `messages` table as hermes_state_common.py:531-562 creates it (hermes-agent@2bd378ed, MIT), rows from the fixture.
  const cols = ["id", "session_id", "role", "content", "tool_call_id", "tool_calls", "tool_name", "effect_disposition", "timestamp", "token_count", "finish_reason", "reasoning", "reasoning_content", "observed", "_compressed_summary", "active", "compacted", "api_content", "display_kind", "display_metadata", "display_order", "message_uid", "tool_call_uids", "tool_call_uid"];
  const q = (v) => (v == null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  const sql = [
    "CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT NOT NULL, started_at REAL NOT NULL);",
    "CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id), role TEXT NOT NULL, content TEXT, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, effect_disposition TEXT, timestamp REAL NOT NULL, token_count INTEGER, finish_reason TEXT, reasoning TEXT, reasoning_content TEXT, reasoning_details TEXT, codex_reasoning_items TEXT, codex_message_items TEXT, platform_message_id TEXT, observed INTEGER DEFAULT 0, _compressed_summary INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, compacted INTEGER NOT NULL DEFAULT 0, api_content TEXT, display_kind TEXT, display_metadata TEXT, display_identity BLOB, display_order INTEGER, message_uid TEXT, absorbed_message_uids TEXT, tool_call_uids TEXT, tool_call_uid TEXT);",
    `INSERT INTO sessions VALUES ('${SESSION}', 'cli', 1794214824.26);`,
    ...rows.filter((r) => r.session_id === SESSION).map((r) => `INSERT INTO messages (${cols.join(",")}) VALUES (${cols.map((c) => q(r[c])).join(",")});`),
  ].join("\n");
  writeFileSync(join(home, "schema.sql"), sql);
  const made = spawnSync("/usr/bin/sqlite3", [join(home, ".hermes/state.db")], { input: sql, encoding: "utf8" });
  expect(made.status).toBe(0);
  const helper = join(import.meta.dir, "../helper/pdk-helper.py");
  const r = spawnSync("/usr/bin/python3", ["-I", "-S", helper, "rows", "hermes", SESSION, "0"], { encoding: "utf8", env: { HOME: home, PATH: "/usr/bin:/bin" } });
  expect(r.status).toBe(0);
  const reply = JSON.parse(r.stdout);
  expect(reply.rows.length).toBe(8);
  expect(reply.next).toBe(3475);
  const t = new Thread();
  for (const row of reply.rows) t.apply(mapHermesRow(row));
  const out = t.rows();
  expect(out.map((x) => x.type)).toEqual(["user", "work", "assistant", "user", "work", "assistant"]);
  expect(out[1].items[0].status).toBe("ok");
});

test("F9: a large Hermes session comes back in pages under 4 MiB, display text clipped, JSON never cut, an oversized row skipped in place", () => {
  const home = mkdtempSync(join(tmpdir(), "pdk-hermes-big-"));
  mkdirSync(join(home, ".hermes"));
  const sid = "local-big";
  const big = "x".repeat(100_000);
  const lines = [
    "CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT NOT NULL, started_at REAL NOT NULL);",
    "CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL NOT NULL, finish_reason TEXT, reasoning TEXT, active INTEGER NOT NULL DEFAULT 1);",
    `INSERT INTO sessions VALUES ('${sid}', 'cli', 1.0);`,
  ];
  for (let i = 1; i <= 80; i++) lines.push(`INSERT INTO messages (id, session_id, role, content, timestamp) VALUES (${i}, '${sid}', '${i % 2 ? "user" : "assistant"}', '${big}', ${i});`);
  const huge = JSON.stringify([{ id: "call_big", type: "function", function: { name: "terminal", arguments: JSON.stringify({ command: "y".repeat(3_000_000) }) } }]);
  lines.push(`INSERT INTO messages (id, session_id, role, content, tool_calls, timestamp) VALUES (81, '${sid}', 'assistant', '', '${huge}', 81);`);
  lines.push(`INSERT INTO messages (id, session_id, role, content, timestamp) VALUES (82, '${sid}', 'assistant', 'the end', 82);`);
  const made = spawnSync("/usr/bin/sqlite3", [join(home, ".hermes/state.db")], { input: lines.join("\n"), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  expect(made.status).toBe(0);
  const helper = join(import.meta.dir, "../helper/pdk-helper.py");
  const got = []; let after = 0, pages = 0;
  for (;;) {
    const r = spawnSync("/usr/bin/python3", ["-I", "-S", helper, "rows", "hermes", sid, String(after)], { encoding: "utf8", env: { HOME: home, PATH: "/usr/bin:/bin" }, maxBuffer: 64 * 1024 * 1024 });
    expect(r.status).toBe(0);
    expect(Buffer.byteLength(r.stdout)).toBeLessThanOrEqual(4 * 1024 * 1024);
    const reply = JSON.parse(r.stdout);
    pages++;
    got.push(...reply.rows);
    expect(reply.next).toBe(reply.rows.at(-1)?.id ?? after);
    if (!reply.more) break;
    after = reply.next;
    expect(pages).toBeLessThan(10);
  }
  expect(pages).toBeGreaterThan(1);
  expect(got.map((r) => r.id)).toEqual(Array.from({ length: 82 }, (_, i) => i + 1));
  expect(got[0].clipped).toBe(true);
  expect(got[0].content.length).toBeLessThan(100_000);
  const skipped = got.find((r) => r.id === 81);
  expect(skipped.skipped).toBe(true);
  expect(skipped.role).toBe("assistant");
  for (const r of got) if (r.tool_calls && !r.skipped) expect(() => JSON.parse(r.tool_calls)).not.toThrow();
  expect(got.at(-1).content).toBe("the end");
});
