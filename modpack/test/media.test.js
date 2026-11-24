// Media in the chat: what is detected where (text, tool inputs, inline image blocks, Codex parts and items), F6
// (Markdown and HTML images never reach the Markdown view), the large and missing cases, and the helper's media
// commands: previews into its own cache only, the allow-list, and every refusal. FIXTURES: media-fixture.py builds
// the media and the transcripts (from the verified Claude and Codex samples) under /tmp/pdk-m<pid>. `open` and
// `reveal` are tested only for refusals here: a test never opens an app.
import { test, expect, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, symlinkSync, chmodSync, rmSync, existsSync, statSync } from "node:fs";
import { refsFromText, refsFromInput, inlineImages, stripImages, neutraliseImages, codeRegions, PreviewQueue, STUCK_MS, addSlimmed, MAX_SLIM, fileRef, kindOf, resolvePath, MAX_REFS, LARGE_INLINE } from "../adapters/media.js";
import { Thread, feed, parseLines } from "../adapters/chat.js";

const TEST = import.meta.dir;
const ROOT = `/tmp/pdk-m${process.pid}`;
const HOME = `${ROOT}/u`;
const APP = `${ROOT}/home`;
const M = `${ROOT}/media`;
const CT = `${HOME}/.claude/projects/-w/media.jsonl`;
const XT = `${HOME}/.codex/sessions/2026/11/09/rollout-2026-11-09T09-30-00-01a1bd47-0000-7000-8000-000000000001.jsonl`;
mkdirSync(`${APP}/pdk/helper`, { recursive: true });
copyFileSync(`${TEST}/../helper/pdk-helper.py`, `${APP}/pdk/helper/pdk-helper.py`);
const built = Bun.spawnSync(["/usr/bin/python3", "-I", "-S", `${TEST}/media-fixture.py`, M, CT, XT, "/w"], { env: { PATH: "/usr/bin:/bin:/opt/homebrew/bin" } });
if (built.exitCode !== 0) throw new Error(built.stderr.toString());
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const helper = (...args) => {
  const r = Bun.spawnSync(["/usr/bin/python3", "-I", "-S", `${APP}/pdk/helper/pdk-helper.py`, ...args.map(String)], { env: { HOME, PATH: "/usr/bin:/bin" } });
  return { code: r.exitCode, ...JSON.parse(r.stdout.toString()) };
};
const records = (path) => {
  let off = 0;
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean).map((t) => { const r = [off, t]; off += Buffer.byteLength(t) + 1; return r; });
  return parseLines(lines).map((r) => ({ ...r, path }));
};
const media = (rows) => rows.flatMap((r) => (r.type === "work" ? r.items : [r])).map((e) => [e.type, (e.media ?? []).map((m) => `${m.src}:${m.kind}:${m.name}`)]);

test("text: absolute, ~, quoted, escaped, file:// and markdown paths; image URLs; relative ones only with the record's cwd", () => {
  const keys = (s, c) => refsFromText(s, c).map((r) => r.key);
  expect(keys("Saved to /tmp/a/shot.png.")).toEqual(["file:/tmp/a/shot.png"]);
  expect(keys("see `/tmp/my shot.png`, ![x](/a/b.JPG) and /a/c.png.bak")).toEqual(["file:/tmp/my shot.png", "file:/a/b.JPG"]);
  expect(keys("open file:///tmp/a%20b.pdf or https://example.com/x/cat.webp?s=1 then ~/Desktop/v.mov")).toEqual(["file:/tmp/a b.pdf", "url:https://example.com/x/cat.webp?s=1", "file:~/Desktop/v.mov"]);
  expect(keys("ffmpeg -i /tmp/in.mp4 /tmp/out\\ frame.png && open /tmp/r.html")).toEqual(["file:/tmp/in.mp4", "file:/tmp/out frame.png", "file:/tmp/r.html"]);
  expect(keys("wrote shots/v3/1-chat.png")).toEqual([]);
  expect(keys("wrote shots/v3/1-chat.png", { cwd: "/w" })).toEqual(["file:/w/shots/v3/1-chat.png"]);
  expect(keys("not media: /usr/bin/python3 a.txt https://example.com/page /x/run.sh /Applications/Calc.app")).toEqual([]);
  expect(refsFromText(Array.from({ length: 20 }, (_, i) => `/m/${i}.png`).join(" "))).toHaveLength(MAX_REFS);
  expect(refsFromInput({ file_path: "/tmp/x.PNG", content: "/tmp/not-from-content.png" }).map((r) => r.key)).toEqual(["file:/tmp/x.PNG"]);
  expect(resolvePath("/a/./b/../c.png")).toBe("/a/c.png");
  expect([kindOf("a.mp4"), kindOf("a.pdf"), kindOf("a.htm"), kindOf("a.heic"), kindOf("a.svg"), kindOf("a.exe")]).toEqual(["video", "pdf", "html", "image", null, null]);
});

test("inline images: Claude image blocks and Codex data URLs, counted in one order, a slimmed record's size kept", () => {
  const imgs = inlineImages({ a: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }], b: "data:image/jpeg;base64,AAAAAAAA",
    c: { type: "image", source: { type: "base64", data: "", pdk_bytes: 5 << 20 } }, d: "data:image/png;pdk-bytes=77;base64," });
  expect(imgs.map((i) => [i.mime, i.bytes])).toEqual([["image/png", 3], ["image/jpeg", 6], ["image/png", 5 << 20], ["image/png", 77]]);
});

test("F6: Markdown and HTML images leave the text as media; code is left alone; a remote one is never a local file", () => {
  const s = stripImages('A ![chart](https://x.example/c.png "t") B <img src="https://evil.example/pixel" alt="px"> `![no](https://x/y.png)` ![](rel/a.png)', { cwd: "/w" });
  expect(s.text).toBe("A chart B px `!\u200B[no](https://x/y.png)` "); // code looks the same; the space is zero-width
  expect(s.refs.map((r) => r.key)).toEqual(["url:https://x.example/c.png", "url:https://evil.example/pixel", "file:/w/rel/a.png"]);
  const t = feed(new Thread(), "claude", [{ type: "assistant", uuid: "a", message: { content: [{ type: "text", text: "Look: ![p](https://cdn.example/p.png)" }] } }]);
  const row = t.rows()[0];
  expect(row.text).toBe("Look: p");
  expect(row.media[0]).toMatchObject({ src: "url", kind: "image", host: "cdn.example" });
  expect(JSON.stringify(t.rows())).not.toContain("![");
});

test("Claude fixture: pasted images inline (the big one large), a path, a Read of an image, a video command, every kind in the answer", () => {
  const rows = feed(new Thread(), "claude", records(CT)).rows();
  const got = media(rows).filter(([, m]) => m.length);
  expect(got).toEqual([
    ["user", ["inline:image:PNG"]],
    ["user", ["file:image:mock.png"]],
    ["user", ["inline:image:PNG"]],
    ["tool", ["file:image:shot-wide.png"]], // the Read's inline copy is not shown twice
    ["tool", ["file:video:clip.mp4"]],
    ["assistant", ["file:image:chart.png", "file:video:clip.mp4", "file:pdf:report.pdf", "file:html:page.html", "url:image:reference.jpg", "file:image:huge-scan.png", "file:image:missing-frame.png"]],
  ]);
  const big = rows.find((r) => r.type === "user" && r.media?.[0]?.src === "inline");
  expect(big.media[0].large).toBe(true);
  expect(big.media[0].bytes).toBeGreaterThan(LARGE_INLINE);
});

test("Codex fixture: local_image and data-URL parts, an ImageView item, a command's paths, the answer's paths", () => {
  const rows = feed(new Thread(), "codex", records(XT)).rows();
  expect(media(rows).filter(([, m]) => m.length)).toEqual([
    ["user", ["file:image:tall.jpg", "inline:image:PNG"]],
    ["tool", ["file:image:tall.jpg"]],
    ["tool", ["file:image:tall.jpg", "file:image:square.png"]],
    ["assistant", ["file:image:square.png", "file:video:clip.mp4"]],
  ]);
  expect(rows.flatMap((r) => r.items ?? []).find((i) => i.name === "ImageView").verb).toBe("Viewed");
});

test("helper media: previews only into <app home>/pdk-cache/media, at most THUMB pixels; large waits for force; HTML is never rendered", () => {
  const img = helper("media", `${M}/shot-wide.png`, "thumb", 0);
  expect(img).toMatchObject({ kind: "image", srcWidth: 1600, srcHeight: 1000, width: 480, height: 300 });
  expect(img.image).toMatch(/^pdk-cache\/media\/[0-9a-f]{24}\.png$/);
  expect(existsSync(`${APP}/${img.image}`)).toBe(true);
  expect(helper("media", `${M}/report.pdf`, "thumb", 0)).toMatchObject({ kind: "pdf", height: 480 });
  if (existsSync(`${M}/clip.mp4`)) expect(helper("media", `${M}/clip.mp4`, "thumb", 0).image).toMatch(/^pdk-cache/);
  expect(helper("media", `${M}/page.html`, "thumb", 0)).toEqual({ code: 0, kind: "html", size: statSync(`${M}/page.html`).size, path: `${M}/page.html`, real: expect.any(String) });
  expect(helper("media", `${M}/huge-scan.png`, "thumb", 0)).toMatchObject({ large: true, kind: "image" });
  expect(helper("media", `${M}/missing-frame.png`, "thumb", 0)).toMatchObject({ code: 0, missing: true });
  // A copy of the helper outside an app home's pdk/helper writes nothing.
  const loose = Bun.spawnSync(["/usr/bin/python3", "-I", "-S", `${TEST}/../helper/pdk-helper.py`, "media", `${M}/small.png`, "thumb", "0"], { env: { HOME, PATH: "/usr/bin:/bin" } });
  expect(JSON.parse(loose.stdout.toString()).error).toBe("not installed");
}, 60000);

test("helper inline and slim: the image comes from the transcript line itself; an oversized line comes back without its image data", () => {
  const recs = records(CT);
  const paste = recs.find((r) => r.record.message?.content?.[0]?.text?.startsWith("[Image #2]"));
  const r = helper("inline", CT, paste.offset, 0, "thumb");
  expect(r).toMatchObject({ mime: "image/png", width: 96, height: 64 });
  expect(r.file.startsWith(`${APP}/pdk-cache/media/`) || r.file.startsWith(`/private${APP}/pdk-cache/media/`)).toBe(true);
  const big = recs.find((r) => r.record.message?.content?.[0]?.text?.startsWith("[Image #1]"));
  const slim = helper("slim", CT, big.offset);
  expect(slim.record.message.content[1].source.data).toBe("");
  expect(slim.record.message.content[1].source.pdk_bytes).toBeGreaterThan(LARGE_INLINE);
  expect(JSON.stringify(slim).length).toBeLessThan(64 * 1024);
  expect(helper("inline", CT, big.offset + 1, 0, "thumb").error).toBe("not a line start");
  expect(helper("inline", CT, paste.offset, 9, "thumb").error).toBe("no such image");
  expect(helper("inline", "/etc/hosts", 0, 0, "thumb").error).toBe("path not allowed");
}, 60000);

test("open and reveal refuse anything but a regular, non-executable media file: apps, bundles, folders, scripts, links to them", () => {
  mkdirSync(`${ROOT}/x/Fake.app/Contents`, { recursive: true });
  writeFileSync(`${ROOT}/x/run.sh`, "#!/bin/sh\necho hi\n");
  writeFileSync(`${ROOT}/x/looks.png`, "#!/bin/sh\necho hi\n");
  chmodSync(`${ROOT}/x/looks.png`, 0o755);
  mkdirSync(`${ROOT}/x/dir.png`);
  symlinkSync(`${ROOT}/x/Fake.app`, `${ROOT}/x/app-link.png`);
  symlinkSync(`${ROOT}/x/run.sh`, `${ROOT}/x/script-link.png`);
  for (const cmd of ["open", "reveal", "media"]) {
    const args = (p) => (cmd === "media" ? [cmd, p, "thumb", 0] : [cmd, p]);
    expect(helper(...args(`${ROOT}/x/Fake.app`)).error).toBe("not a media file");
    expect(helper(...args(`${ROOT}/x/run.sh`)).error).toBe("not a media file");
    expect(helper(...args("/bin/ls")).error).toBe("not a media file");
    expect(helper(...args(`${ROOT}/x/looks.png`)).error).toBe("executable file");
    expect(helper(...args(`${ROOT}/x/dir.png`)).error).toBe("not a regular file");
    expect(helper(...args(`${ROOT}/x/app-link.png`)).error).toBe("not a media file"); // judged by where it really points
    expect(helper(...args(`${ROOT}/x/script-link.png`)).error).toBe("not a media file");
    expect(helper(...args("relative/a.png")).error).toBe("path not allowed");
    expect(helper(...args("https://example.com/a.png")).error).toBe("path not allowed");
  }
  expect(helper("open", `${ROOT}/x/none.png`)).toMatchObject({ code: 0, missing: true });
  expect(helper("open").error).toBe("usage");
}, 60000);


// Review G2: whatever the Markdown parser would make of it, no image can form: the text the view gets holds no "!["
// and no "<img" at all, in code or out of it.
const ADVERSARIAL = [
  "![a\nb](https://x.example/1.png)", // alt over two lines
  "![a\\]b](https://x.example/2.png)", // escaped bracket in the alt
  "![alt][ref]\n\n[ref]: https://x.example/3.png", // reference image
  "![shortcut]\n\n[shortcut]: https://x.example/4.png",
  "[![nested](https://x.example/5.png)](https://x.example/page)",
  "\\`![escaped tick](https://x.example/6.png)`", // the backtick is escaped: not a code span
  "``code ![in](https://x/7.png)`` and ![out](https://x.example/8.png)",
  "<IMG SRC=https://x.example/9.png>", "<img\nsrc=\"https://x.example/10.png\">", "<Img/src=https://x.example/11.png>",
  "<div>\n```\n<img src=https://x.example/12.png>\n```\n</div>", // an HTML block, not a fence, to the parser
  "```\nunclosed fence ![x](https://x.example/13.png)",
  "    indented code ![x](https://x.example/14.png)",
  "> quoted ![q](https://x.example/15.png)", "- item ![i](https://x.example/16.png)",
  "!![double](https://x.example/17.png)", "\\![escaped bang](https://x.example/18.png)",
  "![a](<https://x.example/19 space.png>)", "![a](https://x.example/20.png 'title')",
];

test("G2: no '![' and no '<img' survive, in code or out, for every adversarial form", () => {
  for (const s of ADVERSARIAL) {
    for (const out of [stripImages(s, { cwd: "/w" }).text, neutraliseImages(s)]) {
      expect(out).not.toMatch(/!\[/);
      expect(out).not.toMatch(/<img/i);
    }
  }
  // Outside code the image start is escaped (shown as written); inside code only a zero-width space is added.
  expect(neutraliseImages("x ![a]\n\n[a]: u")).toBe("x !\\[a]\n\n[a]: u");
  expect(neutraliseImages("`![a](u)`")).toBe("`!​[a](u)`");
  expect(neutraliseImages("<IMG src=u>")).toBe("&lt;IMG src=u>");
  expect(neutraliseImages("plain text, no images")).toBe("plain text, no images");
  // The well-formed ones still become media.
  expect(stripImages("![a\nb](https://x.example/1.png)").refs.map((r) => r.key)).toEqual(["url:https://x.example/1.png"]);
  expect(stripImages("![a\\]b](https://x.example/2.png)").text).toBe("a]b");
});

test("G2: code regions follow Markdown's rules closely enough for display (fences, spans, escapes, unclosed)", () => {
  const regions = (t) => codeRegions(t).map(([a, b]) => t.slice(a, b));
  expect(regions("a `b` c ``d ` e`` f")).toEqual(["`b`", "``d ` e``"]);
  expect(regions("\\`not code` x")).toEqual([]);
  expect(regions("x\n```js\ncode\n```\ny")).toEqual(["```js\ncode\n```"]);
  expect(regions("x\n~~~\nopen to the end")).toEqual(["~~~\nopen to the end"]);
  expect(regions("`unclosed")).toEqual([]);
});


// Review G1: previews and slim reads belong to the view and session that asked; hidden or retargeted, nothing more
// is read and nothing late is kept.
test("G1: a queued preview is dropped unread when the chat is hidden or retargeted, and asked again when drawn", async () => {
  let scope = "1:1";
  const q = new PreviewQueue(() => scope);
  const asked = [];
  const ask = async (ref) => { asked.push(ref.key); return { kind: "image", image: "x.png", width: 2, height: 2 }; };
  q.state(fileRef("/m/a.png"));
  scope = null; // hidden
  expect(await q.step(ask)).toBe(true);
  expect(asked).toEqual([]);
  expect(q.state(fileRef("/m/b.png")).state).toBe("loading");
  expect(q.jobs).toHaveLength(0); // nothing queued while hidden
  scope = "2:1"; // shown again (a new view generation)
  q.state(fileRef("/m/a.png"));
  await q.step(ask);
  expect(asked).toEqual(["file:/m/a.png"]);
  expect(q.items.get("file:/m/a.png").state).toBe("ready");
});

test("G1: an answer that arrives after a retarget is not kept", async () => {
  let scope = "1:1";
  const q = new PreviewQueue(() => scope);
  q.state(fileRef("/m/c.png"));
  const step = q.step(async () => { scope = "1:2"; return { kind: "image", image: "late.png", width: 1, height: 1 }; });
  await step;
  expect(q.items.get("file:/m/c.png")).toBeUndefined();
});

// reports/media-loading.md: in the final shots at 6ea3313 the two 150 ms preview polls never woke after the chat
// opened, so no preview was ever asked for and every tile stayed "Loading preview…". Previews wait on no timer of
// their own now: the chat's 1 s loop drains the queue.
const settle = () => new Promise((r) => setTimeout(r, 0));
test("media-loading: queued previews are asked with no timer of their own, two at a time, and the runners end", async () => {
  const q = new PreviewQueue(() => "1:1");
  const tasks = [];
  const cx = { spawn: (body) => { tasks.push(body(cx)); }, sleep: () => new Promise(() => {}), notify: () => {} }; // a sleep never wakes
  const asked = [];
  let inFlight = 0;
  let most = 0;
  const ask = async (ref) => {
    asked.push(ref.key); inFlight++; most = Math.max(most, inFlight);
    await settle(); inFlight--;
    return { kind: "image", image: `${ref.key}.png`, width: 2, height: 2 };
  };
  for (const n of ["a", "b", "c", "d", "e"]) q.state(fileRef(`/m/${n}.png`));
  q.drain(cx, ask);
  expect(q.runners.size).toBe(2);
  await Promise.all(tasks);
  expect(asked).toHaveLength(5);
  expect(most).toBe(2);
  expect([...q.items.values()].every((s) => s.state === "ready")).toBe(true);
  expect(q.runners.size).toBe(0); // done: nothing left running
  q.drain(cx, ask); // nothing queued: no runner starts
  expect(tasks).toHaveLength(2);
});

test("media-loading: a runner that never wakes stops counting after STUCK_MS; one that wakes late takes no more jobs", async () => {
  const q = new PreviewQueue(() => "1:1");
  const cx = { spawn: (body) => { body(cx); }, notify: () => {} };
  const hung = [];
  const never = () => new Promise((resolve) => hung.push(() => resolve({ kind: "image", image: "late.png", width: 1, height: 1 })));
  for (const n of ["a", "b", "c"]) q.state(fileRef(`/m/${n}.png`));
  const t0 = Date.now();
  q.drain(cx, never, t0);
  expect(hung).toHaveLength(2);
  q.drain(cx, never, t0 + 1000);
  expect(hung).toHaveLength(2); // both still count
  q.drain(cx, never, t0 + STUCK_MS + 5000);
  expect(hung).toHaveLength(3); // the two that never answered no longer count: c is asked
  q.state(fileRef("/m/d.png"));
  hung[0]();
  await settle();
  expect(q.items.get("file:/m/a.png").state).toBe("ready"); // its answer is kept (same view and session)
  expect(hung).toHaveLength(3); // but it took no more jobs: d waits for a counted runner
  expect(q.jobs.map((j) => j.ref.key)).toEqual(["file:/m/d.png"]);
});

test("media-loading: the chat's previews have no polling loop of their own; its 1 s loop pumps them", () => {
  const media = readFileSync(`${TEST}/../mods/pdk-chat/media.js`, "utf8");
  expect(media).not.toMatch(/cx\.sleep\(/);
  expect(media).toMatch(/this\.drain\(cx, \(ref, force\) => mediaPreview\(ref, "thumb", force\)\);/);
  const chat = readFileSync(`${TEST}/../mods/pdk-chat/main.js`, "utf8");
  const loop = chat.slice(chat.indexOf("await cx.sleep(1000);"), chat.indexOf("await this.tick(cx)"));
  expect(loop).toMatch(/this\.media\.pump\(cx\);/);
  expect(chat).toMatch(/new MediaStore\(\(\) =>/);
});

test("G1: slim reads stop when the chat goes away mid-read; every try counts toward MAX_SLIM", async () => {
  const skipped = Array.from({ length: 8 }, (_, i) => [i * 10, 5]);
  let calls = 0;
  const failing = async () => { calls++; return null; };
  const r = await addSlimmed([], skipped, "/t.jsonl", () => true, failing);
  expect(calls).toBe(MAX_SLIM);
  expect(r.unread).toBe(8);
  calls = 0;
  let alive = true;
  const hides = async (path, offset) => { calls++; alive = false; return { record: { type: "user", n: offset } }; };
  const r2 = await addSlimmed([], skipped, "/t.jsonl", () => alive, hides);
  expect(calls).toBe(1); // nothing asked after the view went away
  expect(r2).toHaveLength(0); // and the answer that came back after is not kept
  expect(r2.unread).toBe(8);
});

// ---- Review G4, G5, G6, G8 on the helper ----

const { readdirSync, lstatSync, renameSync, unlinkSync, realpathSync } = await import("node:fs");
const CACHE = `${APP}/pdk-cache/media`;
const cacheFiles = () => (existsSync(CACHE) ? readdirSync(CACHE) : []);

test("G4: a linked cache folder (or a linked pdk-cache) is refused; nothing is written or pruned outside", () => {
  helper("media", `${M}/small.png`, "thumb", 0); // the cache exists
  const outside = `${ROOT}/outside`;
  mkdirSync(outside, { recursive: true });
  writeFileSync(`${outside}/sentinel`, "keep");
  renameSync(CACHE, `${ROOT}/cache-aside`);
  symlinkSync(outside, CACHE);
  expect(helper("media", `${M}/tall.jpg`, "thumb", 0).error).toBe("cache folder is not a plain folder");
  expect(readdirSync(outside)).toEqual(["sentinel"]);
  unlinkSync(CACHE);
  renameSync(`${APP}/pdk-cache`, `${ROOT}/pdk-cache-aside`);
  symlinkSync(outside, `${APP}/pdk-cache`);
  expect(helper("media", `${M}/tall.jpg`, "thumb", 0).error).toBe("cache folder is not a plain folder");
  expect(readdirSync(outside)).toEqual(["sentinel"]);
  unlinkSync(`${APP}/pdk-cache`);
  renameSync(`${ROOT}/pdk-cache-aside`, `${APP}/pdk-cache`);
  mkdirSync(CACHE, { recursive: true });
  // A link planted inside the cache is removed as a link by the next prune; what it points to stays.
  symlinkSync(`${outside}/sentinel`, `${CACHE}/planted.png`);
  helper("media", `${M}/square.png`, "thumb", 0);
  expect(existsSync(`${CACHE}/planted.png`)).toBe(false);
  expect(readFileSync(`${outside}/sentinel`, "utf8")).toBe("keep");
}, 60000);

test("realpath: the canonical path inside the app home, an error outside it or through a link out of it", () => {
  mkdirSync(`${APP}/themes`, { recursive: true });
  // The reply build-modpack's Colours reads: exactly {path} or {error}.
  const inside = helper("realpath", `${APP}/themes/pdk-t3-dark.json`);
  expect(Object.keys(inside).sort()).toEqual(["code", "path"]);
  expect(inside.code).toBe(0);
  expect(inside.path.endsWith("/home/themes/pdk-t3-dark.json")).toBe(true);
  expect(Object.keys(helper("realpath", "/etc/hosts")).sort()).toEqual(["code", "error"]);
  symlinkSync(`${ROOT}/outside/sentinel`, `${APP}/themes/linked.json`);
  expect(helper("realpath", `${APP}/themes/linked.json`).error).toBe("outside the app home");
  expect(helper("realpath", "/etc/hosts").error).toBe("outside the app home");
  // The canonical app home itself is answered (recheck G4: Colours compares against it); its parent is not.
  expect(helper("realpath", APP)).toEqual({ code: 0, path: realpathSync(APP) });
  expect(helper("realpath", `${APP}/..`).error).toBe("outside the app home");
  expect(helper("realpath", "themes/x.json").error).toBe("path not allowed");
});

test("G5: a failed inline image leaves no original behind, and the quota holds after a failure", () => {
  // A record whose inline "PNG" is not an image.
  const bad = `${HOME}/.claude/projects/-w/bad.jsonl`;
  writeFileSync(bad, JSON.stringify({ type: "user", message: { content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from("not an image at all").toString("base64") } }] } }) + "\n");
  mkdirSync(CACHE, { recursive: true });
  for (let i = 0; i < 405; i++) writeFileSync(`${CACHE}/old-${String(i).padStart(3, "0")}.png`, "x");
  const r = helper("inline", bad, 0, 0, "thumb");
  expect(r.error).toBe("no preview");
  expect(cacheFiles().some((f) => f.endsWith("-src.png") && !existsSync(`${CACHE}/${f.replace("-src", "")}`) && statSync(`${CACHE}/${f}`).size < 64)).toBe(false);
  expect(cacheFiles().filter((f) => lstatSync(`${CACHE}/${f}`).isFile()).length).toBeLessThanOrEqual(400);
}, 60000);

test("G6: a huge unterminated line is refused without reading it all; slim's answer fits its byte budget with multibyte text", () => {
  const t = `${HOME}/.claude/projects/-w/g6.jsonl`;
  const cjk = "漢".repeat(8000);
  writeFileSync(t, JSON.stringify({ type: "user", message: { content: Array.from({ length: 400 }, () => ({ type: "text", text: cjk })) } }) + "\n");
  const r = Bun.spawnSync(["/usr/bin/python3", "-I", "-S", `${APP}/pdk/helper/pdk-helper.py`, "slim", t, "0"], { env: { HOME, PATH: "/usr/bin:/bin" } });
  const text = r.stdout.toString();
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(4 * 1024 * 1024);
  const reply = JSON.parse(text);
  expect(reply.record?.message?.content?.length === 400 || reply.error === "record too large").toBe(true);
  // 49 MiB with no newline: refused as too long, bounded.
  const huge = `${HOME}/.claude/projects/-w/huge.jsonl`;
  writeFileSync(huge, "x".repeat(49 * 1024 * 1024));
  const t0 = Date.now();
  expect(helper("slim", huge, 0).error).toBe("line too long");
  expect(helper("inline", huge, 0, 0, "thumb").error).toBe("line too long");
  expect(Date.now() - t0).toBeLessThan(10000);
}, 60000);

// G8: a local https server with a certificate made for the test (no network). The shipped helper trusts only the
// system's certificates (Apple's Python ignores SSL_CERT_FILE), so a test driver runs its main() with the test
// certificate trusted for that one process; the helper's code is unchanged.
test("G8 fetch: only https, image types, 25 MB, https redirects, no cookies or credentials sent", async () => {
  const tls = `${ROOT}/tls`;
  mkdirSync(tls, { recursive: true });
  Bun.spawnSync(["/usr/bin/openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", `${tls}/k.pem`, "-out", `${tls}/c.pem`, "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"]);
  writeFileSync(`${tls}/server.py`, `
import http.server, json, ssl, sys, time
png = open(sys.argv[1], "rb").read()
log = open(sys.argv[2], "a")
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        log.write(json.dumps({"path": self.path, "headers": dict(self.headers)}) + "\\n"); log.flush()
        p = self.path
        def send(code, ctype, body, extra=()):
            self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body)))
            self.send_header("Set-Cookie", "track=1")
            for k, v in extra: self.send_header(k, v)
            self.end_headers(); self.wfile.write(body)
        if p == "/ok.png": send(200, "image/png", png)
        elif p == "/page": send(200, "text/html", b"<html></html>")
        elif p == "/fake.png": send(200, "image/png", b"not really a png")
        elif p == "/to-http": send(302, "text/plain", b"", [("Location", "http://127.0.0.1:%d/ok.png" % self.server.server_port)])
        elif p == "/to-https": send(302, "text/plain", b"", [("Location", "https://127.0.0.1:%d/ok.png" % self.server.server_port)])
        elif p == "/slow-head.png":
            time.sleep(6); send(200, "image/png", png)
        elif p == "/drip.png":
            self.send_response(200); self.send_header("Content-Type", "image/png"); self.send_header("Content-Length", "100"); self.end_headers()
            for _ in range(40):
                self.wfile.write(b"x"); self.wfile.flush(); time.sleep(0.25)
        elif p.startswith("/hop"):
            n = int(p[4:]); time.sleep(0.9)
            send(302, "text/plain", b"", [("Location", "https://127.0.0.1:%d/%s" % (self.server.server_port, "hop%d" % (n + 1) if n < 3 else "ok.png"))])
        elif p == "/big.png":
            self.send_response(200); self.send_header("Content-Type", "image/png"); self.send_header("Content-Length", str(30 << 20)); self.end_headers()
            self.wfile.write(b"x" * 1024)
        else: send(404, "text/plain", b"no")
s = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); ctx.load_cert_chain(sys.argv[3], sys.argv[4])
s.socket = ctx.wrap_socket(s.socket, server_side=True)
print(s.server_port, flush=True)
s.serve_forever()
`);
  const log = `${tls}/requests.jsonl`;
  const server = Bun.spawn(["/usr/bin/python3", "-I", "-S", `${tls}/server.py`, `${M}/small.png`, log, `${tls}/c.pem`, `${tls}/k.pem`], { stdout: "pipe" });
  const port = Number((new TextDecoder().decode((await server.stdout.getReader().read()).value)).trim());
  const base = `https://127.0.0.1:${port}`;
  writeFileSync(`${tls}/drive.py`, [
    "import runpy, ssl, sys",
    "g = runpy.run_path(sys.argv[1], run_name='pdk_helper_under_test')",
    "ctx = ssl.create_default_context(cafile=sys.argv[2])",
    "ssl._create_default_https_context = lambda *a, **k: ctx",
    "import os",
    "if os.environ.get('PDK_TEST_SECONDS'): g['fetch'].__globals__['REMOTE_SECONDS'] = float(os.environ['PDK_TEST_SECONDS'])",
    "g['main'](sys.argv[3:])",
  ].join("\n"));
  const fetchVia = (...args) => {
    const r = Bun.spawnSync(["/usr/bin/python3", "-I", "-S", `${tls}/drive.py`, `${APP}/pdk/helper/pdk-helper.py`, `${tls}/c.pem`, "fetch", ...args], { env: { HOME, PATH: "/usr/bin:/bin", ...(fetchVia.seconds ? { PDK_TEST_SECONDS: String(fetchVia.seconds) } : {}) } });
    return { code: r.exitCode, ...JSON.parse(r.stdout.toString()) };
  };
  try {
    const ok = fetchVia(`${base}/ok.png`, "view");
    expect(ok).toMatchObject({ mime: "image/png", width: 96, height: 64, host: "127.0.0.1" });
    expect(ok.image).toMatch(/^pdk-cache\/media\//);
    expect(fetchVia(`${base}/to-https`, "view").width).toBe(96);
    expect(fetchVia(`${base}/page`, "view").error).toBe("not an image (text/html)");
    expect(fetchVia(`${base}/to-http`, "view").error).toContain("non-https");
    expect(fetchVia(`${base}/big.png`, "view").error).toBe("over 25 MB");
    expect(fetchVia(`${base}/fake.png`, "view").error).toBe("no preview");
    expect(cacheFiles().filter((f) => f.endsWith("-src.png") && statSync(`${CACHE}/${f}`).size < 32)).toEqual([]); // the fake is gone
    const before = readFileSync(log, "utf8").split("\n").filter(Boolean).length;
    expect(fetchVia(`http://127.0.0.1:${port}/ok.png`, "view").error).toBe("only an https address without credentials");
    expect(fetchVia(`https://u:p@127.0.0.1:${port}/ok.png`, "view").error).toBe("only an https address without credentials");
    expect(fetchVia("file:///etc/hosts", "view").error).toBe("only an https address without credentials");
    expect(readFileSync(log, "utf8").split("\n").filter(Boolean).length).toBe(before); // refused before any request
    // A second click on the same image is served from the cache: no new request.
    fetchVia(`${base}/ok.png`, "view");
    expect(readFileSync(log, "utf8").split("\n").filter(Boolean).length).toBe(before);
    // Recheck G8: one hard deadline for the whole download, here 2 s instead of 20 (the driver sets it): a server
    // that is slow to answer, one that drips the body, and a chain of slow redirects each stop at the deadline.
    fetchVia.seconds = 2;
    for (const path of ["slow-head.png", "drip.png", "hop1"]) {
      const t0 = Date.now();
      expect(fetchVia(`${base}/${path}`, "view").error).toBe("took too long");
      const took = Date.now() - t0;
      expect(took).toBeGreaterThanOrEqual(1900);
      expect(took).toBeLessThan(4000);
    }
    fetchVia.seconds = 0;
    for (const line of readFileSync(log, "utf8").split("\n").filter(Boolean)) {
      const h = Object.fromEntries(Object.entries(JSON.parse(line).headers).map(([k, v]) => [k.toLowerCase(), v]));
      expect(h.cookie).toBeUndefined();
      expect(h.authorization).toBeUndefined();
    }
  } finally {
    server.kill();
  }
}, 90000);



// QA final: `pdk-chat.preview[:n]` acts on the chat showing now. Sent right after a pick, before that chat's tiles
// are drawn, it waits for them instead of opening the previous chat's tile.
test("preview command right after a pick waits for the picked chat's tiles", () => {
  let scope = "1:1";
  const q = new PreviewQueue(() => scope);
  q.drawn(fileRef("/old/a.png"), 1000);
  q.drawn(fileRef("/old/b.png"), 1001);
  expect(q.target("preview", 1500)?.key).toBe("file:/old/b.png"); // same chat: its newest tile
  scope = "2:1"; // a pick: a new session for the new target
  expect(q.target("preview:1", 2000)).toBeNull(); // not the old chat's tile
  expect(q.due(2100)).toBeNull(); // nothing drawn for the new chat yet
  q.drawn(fileRef("/new/x.png"), 2200);
  q.drawn(fileRef("/new/y.png"), 2201);
  const p = q.due(2300);
  expect(p).toEqual({ c: "preview:1", at: 2000, scope: "2:1" });
  expect(q.nth(p.c)?.key).toBe("file:/new/y.png");
  // A command nobody can serve is dropped after a while.
  scope = "3:1";
  q.target("preview", 3000);
  expect(q.due(9000)).toBeNull();
  expect(q.pending).toBeNull();
});


// Review A1: a waiting preview command belongs to the chat it was sent for, and to no other.
test("A1: a second pick before the tiles arrive drops the waiting command; the next chat's tile is not opened", () => {
  let scope = "1:1";
  const q = new PreviewQueue(() => scope);
  q.drawn(fileRef("/a/1.png"), 1000);
  scope = "2:1"; // pick B
  expect(q.target("preview", 2000)).toBeNull(); // waits for B
  scope = "3:1"; // pick C before B's tiles were drawn
  q.drawn(fileRef("/c/1.png"), 2500);
  expect(q.due(2600)).toBeNull(); // not C's tile
  expect(q.pending).toBeNull();
});

test("A1: a hide (or a hide and a show) drops the waiting command; one sent while hidden is never kept", () => {
  let scope = "2:1";
  const q = new PreviewQueue(() => scope);
  expect(q.target("preview", 1000)).toBeNull();
  scope = null; // hidden
  expect(q.due(1100)).toBeNull();
  expect(q.pending).toBeNull();
  scope = "2:3"; // shown again: a new view generation
  q.drawn(fileRef("/b/1.png"), 1200);
  expect(q.due(1300)).toBeNull();
  // Sent while hidden: dropped at once, nothing waits for the next show.
  scope = null;
  expect(q.target("preview", 2000)).toBeNull();
  expect(q.pending).toBeNull();
  scope = "2:5";
  q.drawn(fileRef("/b/2.png"), 2100);
  expect(q.due(2200)).toBeNull();
});

test("A1: a new session of the same chat drops the waiting command", () => {
  let scope = "4:1";
  const q = new PreviewQueue(() => scope);
  expect(q.target("preview", 1000)).toBeNull();
  scope = "5:1"; // the chat's session changed (a /clear, a new process)
  q.drawn(fileRef("/s/1.png"), 1100);
  expect(q.due(1200)).toBeNull();
});

import { dropImageMarkers } from "../adapters/media.js";
test("a pasted image's marker goes only when its own record has the image", () => {
  expect(dropImageMarkers("[Image #2] Use this palette.", 1)).toBe("Use this palette.");
  expect(dropImageMarkers("[Image #1] and [Image #2] both", 1)).toBe("and [Image #2] both"); // one image: one marker
  expect(dropImageMarkers("[Image #2] Use this palette.", 0)).toBe("[Image #2] Use this palette."); // no image of its own
  expect(dropImageMarkers("See [Figure 2] and [image #3]", 2)).toBe("See [Figure 2] and [image #3]"); // other brackets stay
});
