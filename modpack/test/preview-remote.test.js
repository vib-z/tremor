// Review R3: the preview never hands a file on another machine to this Mac's helper. Open and Play bring a copy
// here first (shared/helper.js mediaOriginal, stubbed); Reveal and an HTML file's open are off. The real pdk-preview
// view runs against a stub of the host modules and of the helper.
import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PACK = new URL("..", import.meta.url).pathname;
const ROOT = mkdtempSync(join(tmpdir(), "pdk-preview-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));
mkdirSync(`${ROOT}/lib`);
mkdirSync(`${ROOT}/preview`);

const HOST = /import\s*\{([^}]*)\}\s*from\s*"(?:gpui-kit|gpui-base|herdr)"/g;
const patch = (s) => s.replace(/from "(?:gpui-kit|gpui-base|herdr)"/g, 'from "../stub.js"');
const sources = [];
for (const dir of ["adapters", "shared"]) for (const n of readdirSync(join(PACK, dir)).filter((n) => n.endsWith(".js"))) sources.push([`lib/${n}`, readFileSync(join(PACK, dir, n), "utf8")]);
sources.push(["preview/main.js", readFileSync(join(PACK, "mods/pdk-preview/main.js"), "utf8").replaceAll('"./lib/helper.js"', '"../helper-stub.js"').replaceAll('"./lib/', '"../lib/')]);
const names = new Set();
for (const [, s] of sources) for (const m of s.matchAll(HOST)) for (const n of m[1].split(",")) { const k = n.trim().split(/\s+as\s+/)[0]; if (k) names.add(k); }
const SPECIAL = ["View", "props", "nextCommand", "theme"];
writeFileSync(`${ROOT}/stub.js`, `
const chain = () => new Proxy(function () {}, { get: (o, k) => (k === "then" || typeof k === "symbol" ? undefined : chain()), apply: () => chain() });
export class View {}
export const props = () => globalThis.previewProps;
export const nextCommand = () => new Promise(() => {});
export const theme = () => ({});
${[...names].filter((n) => !SPECIAL.includes(n)).map((n) => `export const ${n} = chain();`).join("\n")}
`);
// The helper: every call recorded; mediaOriginal answers what the test sets.
writeFileSync(`${ROOT}/helper-stub.js`, `
export const calls = [];
export const helper = async (command, args) => { calls.push([command, ...args]); return { ok: true }; };
export const mediaPreview = async () => ({ kind: "video" });
export const mediaOriginal = (ref) => { calls.push(["mediaOriginal", ref.on, ref.path]); return globalThis.original(ref); };
`);
for (const [p, s] of sources) writeFileSync(`${ROOT}/${p}`, patch(s));
const { calls } = await import(`${ROOT}/helper-stub.js`);
const Preview = (await import(`${ROOT}/preview/main.js`)).default;

// A preview of `ref`, with the tasks init starts kept so the test runs the job queue itself.
function preview(ref, info = { state: "ready", kind: ref.kind }) {
  globalThis.previewProps = { ref, info };
  const tasks = [];
  const view = new Preview();
  view.init(globalThis.previewProps, { spawn: (f) => tasks.push(f), notify() {} });
  // The job queue: runs until it has slept `n` times with nothing to do.
  view.drain = async (n = 3) => {
    let idle = 0;
    await tasks[0]({ notify() {}, sleep: async () => { if (++idle > n) throw new Error("idle"); } }).catch(() => {});
  };
  return view;
}
const REMOTE = { src: "file", on: "box", path: "/home/me/out/clip.mp4", name: "clip.mp4", kind: "video", key: "k1" };

test("R3: Open on a remote file brings a copy here and opens that; the remote path never reaches the helper", async () => {
  calls.length = 0;
  let done;
  globalThis.original = () => new Promise((resolve) => { done = resolve; });
  const view = preview(REMOTE);
  view.act("open");
  const run = view.drain();
  await Promise.resolve(); await Promise.resolve();
  expect(view.note).toBe("Bringing it from box…");
  done({ path: "/app/pdk-cache/media/abc.mp4" });
  await run;
  expect(calls).toContainEqual(["mediaOriginal", "box", REMOTE.path]);
  expect(calls).toContainEqual(["open", "/app/pdk-cache/media/abc.mp4"]);
  expect(calls.some((c) => c[0] !== "mediaOriginal" && c.includes(REMOTE.path))).toBe(false);
  expect(view.note).toBe(null);
});

test("R3: a copy that can't come shows its words; Reveal and an HTML file's open do nothing for a remote file", async () => {
  calls.length = 0;
  globalThis.original = async () => { throw new Error("clip.mp4 on box is 27.3 MB: only files up to 25 MB are copied to this Mac"); };
  const view = preview(REMOTE);
  view.act("open");
  await view.drain();
  expect(view.note).toBe("clip.mp4 on box is 27.3 MB: only files up to 25 MB are copied to this Mac");
  calls.length = 0;
  view.act("reveal");
  const page = preview({ ...REMOTE, path: "/home/me/out/page.html", name: "page.html", kind: "html" });
  page.act("open");
  await view.drain();
  await page.drain();
  expect(calls).toEqual([]);
});
