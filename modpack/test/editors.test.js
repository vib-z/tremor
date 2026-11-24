// Review R4: the chat's read-only snippet editors are kept only for what the timeline draws. The real Chat view and
// ToolEditors run against a stub of the host modules whose EditorState counts what is made and released.
import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PACK = new URL("..", import.meta.url).pathname;
const ROOT = mkdtempSync(join(tmpdir(), "pdk-editors-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));
mkdirSync(`${ROOT}/lib`);
mkdirSync(`${ROOT}/chat`);

const HOST = /import\s*\{([^}]*)\}\s*from\s*"(?:gpui-kit|gpui-base|herdr)"/g;
const patch = (s) => s.replace(/from "(?:gpui-kit|gpui-base|herdr)"/g, 'from "../stub.js"');
const sources = [];
for (const dir of ["adapters", "shared"]) for (const n of readdirSync(join(PACK, dir)).filter((n) => n.endsWith(".js"))) sources.push([`lib/${n}`, readFileSync(join(PACK, dir, n), "utf8")]);
for (const n of readdirSync(join(PACK, "mods/pdk-chat")).filter((n) => n.endsWith(".js"))) sources.push([`chat/${n}`, readFileSync(join(PACK, "mods/pdk-chat", n), "utf8").replaceAll('"./lib/', '"../lib/')]);

// Every name the files take from the host, as a chainable no-op; EditorState counts.
const names = new Set();
for (const [, s] of sources) for (const m of s.matchAll(HOST)) for (const n of m[1].split(",")) { const k = n.trim().split(/\s+as\s+/)[0]; if (k) names.add(k); }
const SPECIAL = ["View", "EditorState", "counts", "theme"];
writeFileSync(`${ROOT}/stub.js`, `
const chain = () => new Proxy(function () {}, { get: (o, k) => (k === "then" || typeof k === "symbol" ? undefined : chain()), apply: () => chain() });
export const counts = { made: 0, live: 0 };
export class View {}
export const EditorState = { new: () => { counts.made++; counts.live++; let gone = false; return { set_value() {}, release() { if (!gone) { gone = true; counts.live--; } return true; } }; } };
export const theme = () => ({ foreground: "#ffffff", muted: "#999999", syntax: {} });
${[...names].filter((n) => !SPECIAL.includes(n)).map((n) => `export const ${n} = chain();`).join("\n")}
`);
for (const [p, s] of sources) writeFileSync(`${ROOT}/${p}`, patch(s));

const { counts } = await import(`${ROOT}/stub.js`);
const { Thread } = await import(`${ROOT}/lib/chat.js`);
const { ToolEditors } = await import(`${ROOT}/chat/tools.js`);
const Chat = (await import(`${ROOT}/chat/main.js`)).default;

// A Chat with only what syncEditors reads: its editors, its header focus handles, and a chat that is shown.
function chat() {
  const view = Object.create(Chat.prototype);
  view.editors = new ToolEditors();
  view.heads = new Map();
  view.shown = () => true;
  return view;
}
const session = (thread) => ({ address: "t1", src: { gen: 1, thread }, open: new Set(), collapsed: new Set(), unfolded: new Set(), follow: true });
// What a render records: the rows it drew (the newest `n`).
const draw = (s, n) => { const all = s.src.thread.rows(); s.lastFrom = Math.max(0, all.length - n); s.drawnRows = all.slice(s.lastFrom); };
const answer = (n) => ({ op: "add", entry: { key: `a${n}`, type: "assistant", text: `Step ${n}:\n\n\`\`\`js\nlet x = ${n};\n\`\`\`` } });

test("R4: 5,000 answers through a 3,000-entry thread hold editors for the drawn rows only", () => {
  const before = { ...counts };
  const view = chat();
  const s = session(new Thread());
  let n = 0;
  for (let batch = 0; batch < 10; batch++) {
    s.src.thread.apply(Array.from({ length: 500 }, () => answer(n++)));
    s.src.thread.trim(3000);
    draw(s, 20);
    view.syncEditors(s);
  }
  expect(view.editors.map.size).toBe(20);
  expect(counts.live - before.live).toBe(20);
  // Hidden, everything goes; shown again, the drawn rows get theirs back.
  view.shown = () => false;
  view.syncEditors(s);
  expect(view.editors.map.size).toBe(0);
  expect(counts.live - before.live).toBe(0);
});

test("R4: a folded group releases its open calls' editors and keeps them open; close releases all", () => {
  const before = { ...counts };
  const view = chat();
  const thread = new Thread().apply([
    { op: "add", entry: { key: "u1", type: "user", text: "Go" } },
    ...[1, 2].map((i) => ({ op: "add", entry: { key: `c${i}`, id: `c${i}`, type: "tool", name: "Bash", status: "ok", args: [{ key: "command", text: "ls\npwd", lang: "bash" }], output: "a\nb" } })),
    answer(1),
  ]);
  const s = session(thread);
  s.open.add("c1");
  draw(s, 10);
  view.syncEditors(s);
  expect(view.editors.map.size).toBe(3); // c1's command and result, the answer's block
  const group = s.drawnRows.find((r) => r.type === "work");
  s.collapsed.add(group.key);
  view.syncEditors(s);
  expect(view.editors.map.size).toBe(1);
  expect(s.open.has("c1")).toBe(true); // reopening the group restores the call as it was
  s.collapsed.delete(group.key);
  view.syncEditors(s);
  expect(view.editors.map.size).toBe(3);
  view.close();
  expect(view.editors.map.size).toBe(0);
  expect(counts.live - before.live).toBe(0);
});
