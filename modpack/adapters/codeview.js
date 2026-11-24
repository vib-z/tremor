// The chat's expanded code view (owner, with inputs-moshi-code-view-2257.png): what a file-changing tool call did,
// from the transcript record's own input or patch only (no file read from disk, no git). Claude Code's Write, Edit
// and MultiEdit, Hermes's write and patch calls where its records carry the same fields, and Codex's FileChange
// (add, delete, update with a unified diff). Bounded per record, so a render stays inside its 50 ms. Pure.
//
// diffRows is Herdr's own (herdrdev/herdr-app@2405bf3 defaults/mods/changes/main.js, Apache-2.0; NOTICE.md),
// unchanged: it numbers and classifies a unified diff's lines. The chat draws + and - as that view does (ansi2 and
// ansi1 tints), so a change reads the same in Herdr's Changes panel and here.

// Bounds per record: files drawn, lines kept per file, bytes read from an input, characters per line; and the lines
// shown before a file's "… +N lines" fold.
export const CODE = { files: 12, lines: 300, bytes: 200 * 1024, chars: 400, clamp: 20 };

// Herdr's diffRows (see above): "@" hunk rows, "-" / "+" / " " lines with their numbers, "" anything else.
export function diffRows(lines) {
  let old = 0, next = 0;
  return lines.map((line) => {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) { old = +match[1]; next = +match[2]; return { kind: "@", text: line }; }
    const kind = line[0];
    if (kind === "-") return { kind, number: old++, text: line.slice(1) || " " };
    if (kind === "+") return { kind, number: next++, text: line.slice(1) || " " };
    if (kind === " ") { old++; return { kind, number: next++, text: line.slice(1) || " " }; }
    return { kind: "", text: line };
  });
}

const str = (v) => (typeof v === "string" ? v : "");
const cut = (s) => (s.length > CODE.bytes ? { text: s.slice(0, CODE.bytes), cut: true } : { text: s, cut: false });
const linesOf = (s) => (s ? s.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n") : []);
const clip = (t) => (t.length > CODE.chars ? `${t.slice(0, CODE.chars)}…` : t);

// One file's rows, kept to CODE.lines; its counts are of every line read (inside CODE.bytes).
function file(path, rows, { kind = "update", truncated = false } = {}) {
  const add = rows.filter((r) => r.kind === "+").length, del = rows.filter((r) => r.kind === "-").length;
  const kept = rows.slice(0, CODE.lines).map((r) => ({ kind: r.kind, text: clip(r.text) }));
  return { path, kind, add, del, rows: kept, dropped: rows.length - kept.length, truncated };
}

// Old and new text as rows: shared leading and trailing lines stay as context, the rest is removed then added.
export function editRows(oldText, newText) {
  const a = linesOf(oldText), b = linesOf(newText);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  return [
    ...a.slice(0, head).map((text) => ({ kind: " ", text })),
    ...a.slice(head, a.length - tail).map((text) => ({ kind: "-", text })),
    ...b.slice(head, b.length - tail).map((text) => ({ kind: "+", text })),
    ...a.slice(a.length - tail).map((text) => ({ kind: " ", text })),
  ];
}

// Claude Code (and Hermes, by the same field names): Write's content, Edit's old and new string, MultiEdit's edits
// (one hunk row between them). Null when the call changes no file this way.
export function inputChanges(name, input) {
  const i = input && typeof input === "object" ? input : {};
  const path = str(i.file_path) || str(i.path) || str(i.filePath);
  if (!path) return null;
  if (Array.isArray(i.edits) && i.edits.length) {
    let left = CODE.bytes, truncated = false;
    const rows = [];
    for (const [k, e] of i.edits.entries()) {
      const o = str(e?.old_string), n = str(e?.new_string);
      if (o.length + n.length > left) { truncated = true; break; } // the rest isn't read
      left -= o.length + n.length;
      if (k) rows.push({ kind: "@", text: "…" });
      rows.push(...editRows(o, n));
    }
    return [file(path, rows, { truncated })];
  }
  if (typeof i.old_string === "string" || typeof i.new_string === "string") {
    const o = cut(str(i.old_string)), n = cut(str(i.new_string));
    return [file(path, editRows(o.text, n.text), { truncated: o.cut || n.cut })];
  }
  if (typeof i.content === "string" && /write|create|file/i.test(String(name ?? ""))) {
    const c = cut(i.content);
    return [file(path, linesOf(c.text).map((text) => ({ kind: "+", text })), { kind: "add", truncated: c.cut })];
  }
  return null;
}

// Codex's FileChange.changes, in either shape it is written: a map of path to {type: add|delete|update, content,
// unified_diff, move_path} (or {add: {content}}...), or a list of {path, kind, diff|content|unified_diff}.
export function codexChanges(changes) {
  const list = Array.isArray(changes) ? changes.map((c) => [c?.path, c])
    : changes && typeof changes === "object" ? Object.entries(changes) : [];
  return list.filter(([path]) => typeof path === "string" && path).slice(0, CODE.files).map(([path, c]) => {
    const tag = typeof c?.type === "string" ? c.type : typeof c?.kind === "string" ? c.kind : typeof c?.kind?.type === "string" ? c.kind.type
      : ["add", "delete", "update"].find((k) => c?.[k]) ?? "update";
    const body = c?.[tag] && typeof c[tag] === "object" ? c[tag] : c ?? {};
    if (tag === "add" || tag === "delete") {
      const t = cut(str(body.content) || str(c?.diff));
      const sign = tag === "add" ? "+" : "-";
      return file(path, linesOf(t.text).map((text) => ({ kind: sign, text })), { kind: tag, truncated: t.cut });
    }
    const d = cut(str(body.unified_diff) || str(c?.diff));
    const rows = diffRows(linesOf(d.text).filter((l) => !/^(\+\+\+|---)( |$)/.test(l))).filter((r) => r.kind);
    return file(str(body.move_path) ? `${path} → ${body.move_path}` : path, rows, { kind: "update", truncated: d.cut });
  });
}

// A summary for the row: files, added and removed lines over every file.
export const totals = (files) => files.reduce((s, f) => ({ add: s.add + f.add, del: s.del + f.del }), { add: 0, del: 0 });

// The rows a file shows: its first CODE.clamp until unfolded, then all it kept; and how many the fold hides.
export function shownRows(f, unfolded) {
  if (unfolded || f.rows.length <= CODE.clamp) return { rows: f.rows, hidden: 0 };
  return { rows: f.rows.slice(0, CODE.clamp), hidden: f.rows.length - CODE.clamp };
}
