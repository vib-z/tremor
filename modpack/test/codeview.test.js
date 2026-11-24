import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapClaude, mapCodex } from "../adapters/chat.js";
import { mapHermesRow } from "../adapters/hermes.js";
import { CODE, diffRows, editRows, inputChanges, codexChanges, totals, shownRows } from "../adapters/codeview.js";

// The chat's expanded code view (owner, inputs-moshi-code-view-2257.png): from each record's own input or patch.
const PACK = new URL("..", import.meta.url).pathname;
const toolOf = (out) => out.find((e) => e.op === "add" && e.entry?.type === "tool")?.entry;
const claude = (name, input) => toolOf(mapClaude({ type: "assistant", uuid: "u1", timestamp: "2026-11-09T22:57:00Z", cwd: "/w",
  message: { role: "assistant", content: [{ type: "tool_use", id: "tu1", name, input }] } }));
const codex = (changes) => toolOf(mapCodex({ type: "event_msg", timestamp: "2026-11-09T22:57:00Z",
  payload: { type: "item_completed", item: { type: "FileChange", id: "fc1", status: "completed", changes } } }));

test("Claude Write: every line added, from the call's own content", () => {
  const e = claude("Write", { file_path: "/w/briefs/pm-parity.md", content: "# Brief\n\n## Goal\nShip it.\n" });
  expect(e.changes).toEqual([{ path: "/w/briefs/pm-parity.md", kind: "add", add: 4, del: 0, dropped: 0, truncated: false,
    rows: [{ kind: "+", text: "# Brief" }, { kind: "+", text: "" }, { kind: "+", text: "## Goal" }, { kind: "+", text: "Ship it." }] }]);
  expect(claude("Read", { file_path: "/w/a.md" }).changes).toBeUndefined(); // reading changes nothing
});

test("Claude Edit and MultiEdit: shared lines stay as context, the rest is removed then added", () => {
  const e = claude("Edit", { file_path: "/w/a.js", old_string: "a\nb\nc\nd", new_string: "a\nB\nC\nd" });
  expect(e.changes[0].rows).toEqual([{ kind: " ", text: "a" }, { kind: "-", text: "b" }, { kind: "-", text: "c" }, { kind: "+", text: "B" }, { kind: "+", text: "C" }, { kind: " ", text: "d" }]);
  expect([e.changes[0].add, e.changes[0].del]).toEqual([2, 2]);
  const m = claude("MultiEdit", { file_path: "/w/a.js", edits: [{ old_string: "x", new_string: "y" }, { old_string: "p", new_string: "" }] });
  expect(m.changes[0].rows).toEqual([{ kind: "-", text: "x" }, { kind: "+", text: "y" }, { kind: "@", text: "…" }, { kind: "-", text: "p" }]);
  expect(editRows("same", "same")).toEqual([{ kind: " ", text: "same" }]);
});

test("Codex FileChange: add, delete and update (a unified diff), in the map and the list shapes", () => {
  const diff = "--- a/src/x.rs\n+++ b/src/x.rs\n@@ -1,3 +1,3 @@\n fn a() {}\n-fn b() {}\n+fn b() -> u8 { 1 }\n fn c() {}\n";
  const map = codex({ "/w/src/x.rs": { type: "update", unified_diff: diff, move_path: null }, "/w/new.txt": { type: "add", content: "one\ntwo\n" },
    "/w/old.txt": { type: "delete", content: "gone\n" } });
  expect(map.changes.map((f) => [f.path, f.kind, f.add, f.del])).toEqual([["/w/src/x.rs", "update", 1, 1], ["/w/new.txt", "add", 2, 0], ["/w/old.txt", "delete", 0, 1]]);
  expect(map.changes[0].rows.map((r) => r.kind)).toEqual(["@", " ", "-", "+", " "]); // no ---/+++ headers
  expect(map.detail).toBe("/w/src/x.rs, /w/new.txt, /w/old.txt");
  const list = codex([{ path: "/w/a.md", kind: { type: "add" }, diff: "hi\n" }, { path: "/w/b.md", kind: "update", diff: "@@ -1 +1 @@\n-x\n+y\n", move_path: null }]);
  expect(list.changes.map((f) => [f.path, f.add, f.del])).toEqual([["/w/a.md", 1, 0], ["/w/b.md", 1, 1]]);
  expect(codexChanges({ "/w/a": { update: { unified_diff: "@@ -1 +1 @@\n-a\n+b\n", move_path: "/w/b" } } })[0].path).toBe("/w/a → /w/b");
  // diffRows is Herdr's own: numbers from the hunk header.
  expect(diffRows(["@@ -10,2 +20,2 @@", " k", "-o", "+n"]).map((r) => r.number)).toEqual([undefined, 20, 11, 21]);
});

test("Hermes: a write or patch call's own content, by the same field names", () => {
  const out = mapHermesRow({ id: 7, role: "assistant", content: "", timestamp: 1, tool_calls: JSON.stringify([
    { id: "c1", function: { name: "write_file", arguments: JSON.stringify({ path: "/w/n.md", content: "a\nb" }) } },
    { id: "c2", function: { name: "patch", arguments: JSON.stringify({ path: "/w/n.md", old_string: "a", new_string: "A" }) } }]) });
  const tools = out.filter((e) => e.entry?.type === "tool").map((e) => e.entry);
  expect(tools.map((t) => [t.changes?.[0].add, t.changes?.[0].del])).toEqual([[2, 0], [1, 1]]);
});

test("bounds: files, lines kept, bytes read and line length per record; the counts still say what was read", () => {
  const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`/w/f${i}`, { type: "add", content: "x" }]));
  expect(codexChanges(many).length).toBe(CODE.files);
  const long = inputChanges("Write", { file_path: "/w/big", content: Array.from({ length: 1000 }, (_, i) => `line ${i}`).join("\n") })[0];
  expect([long.rows.length, long.dropped, long.add]).toEqual([CODE.lines, 1000 - CODE.lines, 1000]);
  const huge = inputChanges("Write", { file_path: "/w/huge", content: "y".repeat(CODE.bytes + 10) })[0];
  expect(huge.truncated).toBe(true);
  expect(huge.rows[0].text.length).toBe(CODE.chars + 1); // clipped, with "…"
  const edits = inputChanges("MultiEdit", { file_path: "/w/m", edits: [{ old_string: "a", new_string: "b" }, { old_string: "z".repeat(CODE.bytes), new_string: "" }] })[0];
  expect([edits.truncated, edits.rows.length]).toEqual([true, 2]); // the second edit isn't read
});

test("the fold and the row: 20 lines then '… +N lines'; consecutive calls of one tool read as one row", () => {
  const f = inputChanges("Write", { file_path: "/w/a", content: Array.from({ length: 50 }, (_, i) => `${i}`).join("\n") })[0];
  expect(shownRows(f, false)).toMatchObject({ hidden: 30 });
  expect(shownRows(f, false).rows.length).toBe(CODE.clamp);
  expect(shownRows(f, true)).toMatchObject({ hidden: 0 });
  expect(shownRows(f, true).rows.length).toBe(50);
  expect(totals([...inputChanges("Write", { file_path: "/w/1.md", content: "x\ny" }), ...inputChanges("Write", { file_path: "/w/2.md", content: "x\ny" })])).toEqual({ add: 4, del: 0 });
});

test("the chat draws it with the shared parts: one header per call, Enter toggles call and fold, + and − in Herdr's ansi tints, no hex", () => {
  const chat = readFileSync(join(PACK, "mods/pdk-chat/main.js"), "utf8");
  const tools = readFileSync(join(PACK, "mods/pdk-chat/tools.js"), "utf8");
  expect(chat).toMatch(/g\.items\.map\(\(i\) => \(i\.type === "thinking" \? thinkingRow\(t, i, ctx\)/); // design §4: calls are never merged
  expect(tools).toMatch(/focusRing\(h_flex\(\), t, toggle\)\.id\(`tc-\$\{e\.key\}`\)/);
  expect(tools).toMatch(/focusRing\(h_flex\(\), t, unfold\)\.id\(`cvm-\$\{id\}`\)/);
  expect(tools).toMatch(/el\.bg\(tint\(t\.ansi2\)\)\)\.when\(r\.kind === "-", \(el\) => el\.bg\(tint\(t\.ansi1\)\)\)/);
  expect(tools).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  expect(readFileSync(join(PACK, "NOTICE.md"), "utf8")).toMatch(/defaults\/mods\/changes\/main\.js[^\n]*codeview\.js/);
});

test("an open code view counts in the timeline's tail, so the newest rows still fit", async () => {
  const { tailStart } = await import("../adapters/tail.js");
  const rows = Array.from({ length: 10 }, (_, i) => ({ type: "assistant", text: `answer ${i}` }));
  const plain = tailStart(rows, { column: 700, height: 600 });
  const open = tailStart(rows, { column: 700, height: 600, extra: (r) => (r === rows[9] ? 400 : 0) });
  expect(open).toBeGreaterThan(plain); // fewer rows drawn when the newest one is tall
  // The chat keeps an opened call where it is instead (design §3): opening stops following.
  const chat = readFileSync(join(PACK, "mods/pdk-chat/main.js"), "utf8");
  expect(chat).toMatch(/read\(s, _key\) \{\n\s+s\.follow = false;/);
  // L1: the rows are one retained child view, the first item of a virtual list sized by its measured height, then the
  // 20 px end gap and a 0 px end mark (R9); while it follows, every render holds the list at its end with the list
  // handle's own scroll_to_bottom, and each placed frame decides whether it still follows.
  expect(chat).toMatch(/if \(following\) \{ this\.tlScroll\.scroll_to_bottom\(\);/);
  expect(chat).toMatch(/v_virtual_list\("chat-tl", 3, listSizes\(listH, this\.tlH \?\? 0\)/);
  expect(chat).toMatch(/\.track_scroll\(this\.tlScroll\)\.size_full\(\)/);
  expect(chat).toMatch(/this\.placed\(s, range, cx\)/);
  // The composer is under the timeline's region in the same column, never over it, and nothing measures it for the list.
  expect(chat).toMatch(/v_flex\(\)\.id\("chat-foot"\)\.flex_none\(\)/);
  expect(chat).not.toMatch(/footH|tlEnd/);
});
