// Media named in a transcript: image, video, PDF and HTML files by path, image URLs, and images held inline in
// a record (Claude `image` blocks with base64 `source`, Codex `data:image/...` URLs). Pure: text and records in,
// references out. A reference says where the media is; nothing here reads or loads it. The helper does that,
// only for a reference the transcript holds (pdk-helper.py `media`, `inline`).
//
// Where each format puts images: Claude user prompts and tool results carry `image` blocks
// (ZingerLittleBee/Heeler@7bfe7fa docs/research/claude-code-transcript-format.md:65-73, 476); Codex UserMessage
// parts `local_image {path}` and `image {image_url}`, and ImageView/ImageGeneration items with `path`
// (codex-rollout-format.md:132, 224-227; Sources/Heeler/Chat/Codex/CodexRolloutRecord.swift:95-96, 503-551).

export const KINDS = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", heic: "image", heif: "image",
  tif: "image", tiff: "image", bmp: "image",
  mp4: "video", mov: "video", m4v: "video", webm: "video",
  pdf: "pdf",
  html: "html", htm: "html",
};
const EXT = Object.keys(KINDS).join("|");
export const MAX_REFS = 8;
// An inline image over this many decoded bytes waits for a click before it is decoded and shown.
export const LARGE_INLINE = 2 * 1024 * 1024;

export const kindOf = (path) => KINDS[/\.([a-z0-9]+)$/i.exec(path ?? "")?.[1]?.toLowerCase()] ?? null;
export const baseName = (path) => String(path).split("/").filter(Boolean).at(-1) ?? String(path);

// Delimited spans may hold spaces: "…", '…', `…`, <…>, and a markdown target (…). Bare tokens end at
// whitespace or punctuation; a shell's `\ ` stays inside the token.
// The end of a path: whitespace, a closing mark, or a full stop or colon that ends the sentence ("a.png.bak" is
// not "a.png").
const END = String.raw`(?=$|[\s"'\x60<>()\[\]{}|;,!?]|[.:](?:\s|$))`;
const QUOTED = new RegExp(String.raw`["'\x60<(]((?:~|\.{1,2})?/[^"'\x60<>()\n]*?\.(?:${EXT}))[\x22'\x60>)]`, "gi");
const BARE = new RegExp(String.raw`(?:^|[\s=:,\[(])((?:~|\.{1,2})?(?:/(?:\\ |[^\s"'\x60<>()\[\]{}|;,])+)\.(?:${EXT}))${END}`, "gim");
const RELATIVE = new RegExp(String.raw`(?:^|[\s"'\x60(\[=])((?:[\w.-]+/)+[\w.-]+\.(?:${EXT}))${END}`, "gim");
const FILE_URL = /\bfile:\/\/(\/[^\s"'`<>()\[\]]+)/gi;
const WEB_URL = /\bhttps?:\/\/[^\s"'`<>()\[\]]+/gi;

const clean = (p) => p.replace(/\\ /g, " ");

// "/a/./b/../c" -> "/a/c"; relative against cwd (only when the record gives one). "~/x" stays "~/x" (the
// helper reads it in its own HOME) unless a home is given.
export function resolvePath(p, { home, cwd } = {}) {
  let s = clean(p);
  let root = "/";
  if (s.startsWith("~/")) { if (home) s = home + s.slice(1); else { root = "~/"; s = s.slice(2); } }
  else if (!s.startsWith("/")) { if (!cwd) return null; s = `${cwd}/${s}`; }
  const out = [];
  for (const part of s.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop(); else out.push(part);
  }
  return root + out.join("/");
}

export const fileRef = (path) => ({ key: `file:${path}`, src: "file", kind: kindOf(path), path, name: baseName(path) });

// An image URL, never fetched: it opens in the browser after a click. `image`: the text says it is one (a
// Markdown or HTML image), whatever its name ends in.
export function urlRef(url, { image = false } = {}) {
  let u;
  try { u = new URL(url.replace(/[.,;:!?]+$/, "")); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!image && kindOf(u.pathname) !== "image") return null;
  return { key: `url:${u.href}`, src: "url", kind: "image", url: u.href, host: u.host, name: baseName(decodeURIComponent(u.pathname)) };
}

// Every media reference in a piece of text, in order, once each, at most MAX_REFS.
export function refsFromText(text, ctx = {}) {
  if (typeof text !== "string" || !text) return [];
  const found = [];
  const seen = new Set();
  const push = (ref, at) => { if (ref?.kind && !seen.has(ref.key)) { seen.add(ref.key); found.push([at, ref]); } };
  for (const m of text.matchAll(FILE_URL)) {
    let p;
    try { p = decodeURIComponent(m[1]); } catch { continue; }
    if (kindOf(p)) push(fileRef(resolvePath(p, ctx)), m.index);
  }
  const stripped = text.replace(FILE_URL, (s) => " ".repeat(s.length)).replace(WEB_URL, (s) => " ".repeat(s.length));
  for (const m of text.matchAll(WEB_URL)) push(urlRef(m[0]), m.index);
  for (const re of [QUOTED, BARE]) {
    for (const m of stripped.matchAll(re)) {
      const p = resolvePath(m[1], ctx);
      if (p) push(fileRef(p), m.index);
    }
  }
  if (ctx.cwd) for (const m of stripped.matchAll(RELATIVE)) push(fileRef(resolvePath(m[1], ctx)), m.index);
  return found.sort((a, b) => a[0] - b[0]).map((x) => x[1]).slice(0, MAX_REFS);
}

// A tool call's input: its path fields as given, its command's paths. Not other free text (a Write's content).
const PATH_KEYS = ["file_path", "path", "filePath", "notebook_path", "image_path", "image", "saved_path"];
const TEXT_KEYS = ["command", "cmd", "url", "image_url"];
export function refsFromInput(input, ctx = {}) {
  const i = input && typeof input === "object" ? input : {};
  const refs = [];
  for (const k of PATH_KEYS) {
    const v = i[k];
    if (typeof v === "string" && kindOf(v)) { const p = resolvePath(v, ctx); if (p) refs.push(fileRef(p)); }
  }
  for (const k of TEXT_KEYS) {
    const v = Array.isArray(i[k]) ? i[k].join(" ") : i[k];
    refs.push(...refsFromText(v, ctx));
  }
  return mergeRefs(refs);
}

export function mergeRefs(...lists) {
  const seen = new Set();
  return lists.flat().filter((r) => r && !seen.has(r.key) && seen.add(r.key)).slice(0, MAX_REFS);
}

// Images held inside one record, in the order pdk-helper.py `inline` counts them: a depth-first walk in key
// order where a {type: "image", source: {type: "base64", data}} block counts once (not descended into) and a
// "data:image/...;base64," string counts once. `holder` is the block, or the object holding the string.
// A record the helper slimmed (`slim`) keeps the block with empty data and the size in `pdk_bytes`, or the
// URL as "data:image/png;pdk-bytes=N;base64,".
const DATA_URL = /^data:(image\/[\w.+-]+)((?:;[\w-]+=[^;,]*)*);base64,/i;
export function inlineImages(record) {
  const out = [];
  const walk = (v, holder) => {
    if (typeof v === "string") {
      const m = DATA_URL.exec(v);
      if (m) {
        const slim = /;pdk-bytes=(\d+)/.exec(m[2]);
        out.push({ holder, mime: m[1].toLowerCase(), bytes: slim ? Number(slim[1]) : b64bytes(v.length - m[0].length) });
      }
      return;
    }
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) { for (const x of v) walk(x, v); return; }
    const s = v.source;
    if (v.type === "image" && s && typeof s === "object" && s.type === "base64" && typeof s.data === "string") {
      out.push({ holder: v, mime: String(s.media_type ?? "image/png").toLowerCase(), bytes: Number.isFinite(s.pdk_bytes) ? s.pdk_bytes : b64bytes(s.data.length) });
      return;
    }
    for (const k of Object.keys(v)) walk(v[k], v);
  };
  walk(record, null);
  return out;
}
const b64bytes = (n) => Math.floor((n * 3) / 4);

// A reference to the index-th inline image of the record at `offset` in transcript `path`.
export function inlineRef(meta, index, img) {
  if (!meta?.path || !Number.isInteger(meta.offset)) return null;
  const ext = img.mime.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
  return {
    key: `inline:${meta.path}:${meta.offset}:${index}`, src: "inline", kind: "image",
    name: ext.toUpperCase(), mime: img.mime, bytes: img.bytes, large: img.bytes > LARGE_INLINE,
    transcript: meta.path, offset: meta.offset, index,
  };
}

// The inline images among `blocks` (a record's content, or one tool result's content), as references.
export function inlineRefsIn(blocks, images, meta) {
  if (!images.length) return [];
  const want = new Set(Array.isArray(blocks) ? blocks : [blocks]);
  const refs = [];
  images.forEach((img, i) => { if (want.has(img.holder)) refs.push(inlineRef(meta, i, img)); });
  return refs.filter(Boolean);
}

// For people: "1.2 MB", "840 KB", "312 B".
export function bytesLabel(n) {
  if (!Number.isFinite(n)) return "";
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

export const KIND_WORD = { image: "Image", video: "Video", pdf: "PDF", html: "HTML page" };

// F6 and review G2: no image may reach the app's Markdown view, which loads image URLs itself (gpui-base
// text/format/markdown.rs:850-860, html.rs:390 and 482; gpui-shell materialize/text_view.rs:150-172). Two steps:
// 1. Well-formed Markdown and HTML images are taken out (their alt text stays) and become media references: a
//    remote one previews only after a click, a local one is a tile. Best effort: it only decides what is offered.
// 2. Then every image start that is left is neutralised, so no image node can form, whatever the parser would
//    have made of it (a multi-line or escaped alt, a reference image, an <IMG> on its own line): outside code
//    "![" becomes "!\[" (an escaped bracket) and "<img" becomes "&lt;img"; inside code, where escapes would show,
//    a zero-width space goes between them. The text then holds no "![" and no "<img" at all, code or not.
const MD_IMAGE = /!\[((?:\\[\s\S]|[^\]\\])*)\]\(\s*<?([^\s)>]+)>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
const HTML_IMAGE = /<img\b[^>]*>/gi;
const ZWSP = "​";
const attr = (tag, name) => {
  const m = new RegExp(String.raw`\b${name}\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))`, "i").exec(tag);
  return m ? m[1] ?? m[2] ?? m[3] : null;
};
function targetRef(target, ctx) {
  if (!target) return null;
  if (/^https?:/i.test(target)) return urlRef(target, { image: true });
  let path = target;
  if (/^file:\/\//i.test(path)) { try { path = decodeURIComponent(path.slice(7)); } catch { return null; } }
  if (/^[a-z][\w+.-]*:/i.test(path) || !kindOf(path)) return null; // data:, other schemes, not media
  const p = resolvePath(path, ctx);
  return p ? fileRef(p) : null;
}

// Where Markdown shows code, as [start, end) pairs: fenced blocks (a line of up to three spaces and ``` or ~~~, to a
// closing fence of the same kind or the end of the text) and code spans (a run of backticks not escaped, to the
// next run of the same length). Neutralising does not depend on getting this right; only how code looks does.
export function codeRegions(text) {
  const out = [];
  let i = 0;
  let span = 0; // where plain text started, for spans
  const spans = (from, to) => {
    let k = from;
    while (k < to) {
      if (text[k] === "\\") { k += 2; continue; }
      if (text[k] !== "`") { k++; continue; }
      let n = 0;
      while (text[k + n] === "`") n++;
      let j = k + n;
      let close = -1;
      while (j < to) {
        if (text[j] === "`") {
          let m = 0;
          while (text[j + m] === "`") m++;
          if (m === n) { close = j; break; }
          j += m;
        } else j++;
      }
      if (close < 0) { k += n; continue; }
      out.push([k, close + n]);
      k = close + n;
    }
  };
  while (i < text.length) {
    const lineEnd = text.indexOf("\n", i) < 0 ? text.length : text.indexOf("\n", i);
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(text.slice(i, lineEnd));
    if (open) {
      spans(span, i);
      const fence = open[1];
      let j = lineEnd + 1;
      let end = text.length;
      while (j <= text.length) {
        const e = text.indexOf("\n", j) < 0 ? text.length : text.indexOf("\n", j);
        const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(text.slice(j, e));
        if (close && close[1][0] === fence[0] && close[1].length >= fence.length) { end = e; break; }
        if (e >= text.length) break;
        j = e + 1;
      }
      out.push([i, end]);
      i = end + 1;
      span = i;
      continue;
    }
    i = lineEnd + 1;
  }
  spans(span, text.length);
  return out.sort((a, b) => a[0] - b[0]);
}

export function neutraliseImages(text) {
  if (typeof text !== "string" || !/!\[|<img/i.test(text)) return text;
  const plain = (t) => t.replace(/!\[/g, "!\\[").replace(/<(img)/gi, "&lt;$1");
  const code = (t) => t.replace(/!\[/g, `!${ZWSP}[`).replace(/<(img)/gi, `<${ZWSP}$1`);
  let out = "";
  let at = 0;
  for (const [a, b] of codeRegions(text)) {
    out += plain(text.slice(at, a)) + code(text.slice(a, b));
    at = b;
  }
  return out + plain(text.slice(at));
}

export function stripImages(text, ctx = {}) {
  if (typeof text !== "string" || !/!\[|<img/i.test(text)) return { text, refs: [] };
  const refs = [];
  let out = "";
  let at = 0;
  const take = (part) => part
    .replace(MD_IMAGE, (_m, alt, target) => { refs.push(targetRef(target, ctx)); return alt.replace(/\\([\s\S])/g, "$1"); })
    .replace(HTML_IMAGE, (tag) => { refs.push(targetRef(attr(tag, "src"), ctx)); return attr(tag, "alt") ?? ""; });
  for (const [a, b] of codeRegions(text)) {
    out += take(text.slice(at, a)) + text.slice(a, b);
    at = b;
  }
  out += take(text.slice(at));
  return { text: neutraliseImages(out), refs: mergeRefs(refs.filter(Boolean)) };
}

// ---- Scheduling (review G1): pure, so it is tested without the app ----

const RETRY_MISSING_MS = 5000; // an agent often names a file just before it writes it
const REFRESH_MS = 60000; // a changed file gets a new preview
export const MAX_SLIM = 4; // oversized transcript lines tried per read; the rest stay "too large to show"
const PENDING_MS = 5000; // how long a preview command waits for the picked chat's tiles
const RUNNERS = 2; // jobs asked at once: each is one short helper run (sips or qlmanage under a time limit)
// A runner with no step for this long never woke (longer than any helper call's own limit, 35 s): it no longer counts.
export const STUCK_MS = 45000;

// What the helper said, turned into what a tile draws.
export function answer(r) {
  if (!r || r.error) return { state: "error", reason: r?.error ?? "no answer" };
  if (r.missing) return { state: "missing" };
  if (r.large) return { state: "large", size: r.size, kind: r.kind };
  if (r.kind === "html") return { state: "file", size: r.size, kind: r.kind };
  if (!r.image) return { state: "noposter", size: r.size ?? r.bytes, kind: r.kind, reason: r.reason };
  return { state: "ready", image: r.image, width: r.width, height: r.height, size: r.size ?? r.bytes, kind: r.kind,
    srcWidth: r.srcWidth, srcHeight: r.srcHeight, file: r.file ?? null };
}

// The chat's previews: what is known per reference, and the jobs still to ask the helper about. `scope()` is the
// chat's view and session token now (null while it is hidden or has no target). A job carries the token it was
// queued under; it is dropped unread when the token changed, and its answer is dropped when the token changed
// while it was out: a hidden or retargeted chat makes no further reads and keeps no late answers.
export class PreviewQueue {
  constructor(scope) {
    this.scope = scope;
    this.items = new Map();
    this.jobs = [];
    this.frame = []; // the tiles the last render drew, oldest first, and the view and session they were drawn for
    this.frameScope = null;
    this.frameAt = 0;
    this.pending = null;
    this.runners = new Set(); // {at}: when each runner last started a step
  }

  // Starts runners for the queued jobs, at most RUNNERS at a time; each asks for jobs until none is left, then ends.
  // The chat calls this from its 1 s loop, so no job waits on a short timer of its own: in the final shots at
  // 6ea3313 the two 150 ms polls that used to do this never woke after the chat opened, and every tile stayed
  // "Loading preview…" for good (reports/media-loading.md). A runner that never wakes stops counting after STUCK_MS.
  // `ask(ref, force)` is the helper call.
  drain(cx, ask, now = Date.now()) {
    for (const r of this.runners) if (now - r.at > STUCK_MS) this.runners.delete(r);
    for (let n = Math.min(RUNNERS - this.runners.size, this.jobs.length); n > 0; n--) {
      const r = { at: now };
      this.runners.add(r);
      cx.spawn(async (cx) => {
        try {
          while (this.runners.has(r)) {
            r.at = Date.now();
            if (!(await this.step(ask))) break;
            cx.notify();
          }
        } finally {
          this.runners.delete(r);
        }
      });
    }
  }

  drawn(ref, now = Date.now()) {
    const scope = this.scope();
    if (now - this.frameAt > 50 || scope !== this.frameScope) { this.frame = []; this.frameScope = scope; } // one render, one frame
    this.frameAt = now;
    if (!this.frame.some((r) => r.key === ref.key)) this.frame.push(ref);
  }

  // `preview` or `preview:<n>`: the n-th newest tile of the chat showing now. Sent right after a pick, before that
  // chat's tiles are drawn, it waits (`due`) for that chat and no other (review A1): it keeps the view and session it
  // was sent for and is dropped on a hide, another pick, a new session or after PENDING_MS. Sent while the chat is
  // hidden, it is dropped at once.
  target(c, now = Date.now()) {
    const scope = this.scope();
    if (scope == null) { this.pending = null; return null; }
    if (scope !== this.frameScope || !this.frame.length) { this.pending = { c, at: now, scope }; return null; }
    this.pending = null;
    return this.nth(c);
  }

  nth(c) {
    const n = Math.max(1, Number(String(c).split(":")[1] ?? 1) || 1);
    return this.frame[this.frame.length - n] ?? null;
  }

  // The waiting command {c, scope}, once its own chat's tiles were drawn after it; null otherwise. The caller checks
  // the scope again right before it opens anything.
  due(now = Date.now()) {
    const p = this.pending;
    if (!p) return null;
    if (now - p.at > PENDING_MS || this.scope() !== p.scope) { this.pending = null; return null; }
    if (this.frameScope === p.scope && this.frame.length && this.frameAt > p.at) { this.pending = null; return p; }
    return null;
  }

  state(ref, now = Date.now()) {
    let s = this.items.get(ref.key);
    const scope = this.scope();
    if (!s) {
      s = { state: ref.src === "url" ? "remote" : ref.large ? "large" : "loading", size: ref.bytes, at: now };
      this.items.set(ref.key, s);
      if (s.state === "loading" && scope != null) this.jobs.push({ ref, scope });
      else if (s.state === "loading") this.items.delete(ref.key); // asked again when it is drawn while shown
    } else if (!s.asking && scope != null && ((s.state === "missing" && now - s.at > RETRY_MISSING_MS) || (s.state === "ready" && now - s.at > REFRESH_MS))) {
      s.asking = true;
      this.jobs.push({ ref, scope });
    }
    return s;
  }

  // A click on a large placeholder: make its preview anyway.
  force(ref) {
    const scope = this.scope();
    if (scope == null) return;
    this.items.set(ref.key, { state: "loading", at: Date.now() });
    this.jobs.push({ ref, scope, force: true });
  }

  // Undo a job that will not be answered: a loading tile asks again next time it is drawn while shown.
  drop(job) {
    const s = this.items.get(job.ref.key);
    if (s?.state === "loading") this.items.delete(job.ref.key);
    else if (s) s.asking = false;
  }

  // One job: false when there was none. `ask(ref, force)` is the helper call; it runs only for a current job.
  async step(ask) {
    const job = this.jobs.shift();
    if (!job) return false;
    if (job.scope !== this.scope()) { this.drop(job); return true; }
    const r = await ask(job.ref, job.force).catch((e) => ({ error: String(e?.message ?? e) }));
    if (job.scope !== this.scope()) { this.drop(job); return true; }
    this.items.set(job.ref.key, { ...answer(r), at: Date.now() });
    return true;
  }
}

// The lines one read listed as too long, slimmed by the helper and added to `recs` in file order. Each try counts
// toward MAX_SLIM, answered or not; nothing is asked once `live()` is false, and nothing arriving after is kept.
export async function addSlimmed(recs, skipped, path, live, slim) {
  let unread = 0;
  let tried = 0;
  for (const [offset] of skipped ?? []) {
    if (tried >= MAX_SLIM || !live()) { unread++; continue; }
    tried++;
    const r = await slim(path, offset).catch(() => null);
    if (!live()) { unread++; continue; }
    if (r?.record) recs.push({ offset, record: r.record, path }); else unread++;
  }
  recs.sort((a, b) => a.offset - b.offset);
  recs.unread = unread;
  return recs;
}

// Claude Code writes "[Image #2]" into a prompt where an image was pasted. The chat shows the image itself, so the
// marker goes, but only as many markers as the same record has inline images, in order; any other bracketed text,
// and a marker with no image of its own, stays.
export function dropImageMarkers(text, images) {
  let left = images;
  return String(text ?? "").replace(/\[Image #\d+\][ \t]?/g, (m) => (left-- > 0 ? "" : m)).trim();
}
