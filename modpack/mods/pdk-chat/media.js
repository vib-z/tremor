// Media in the chat: a strip of compact tiles under a row for the images, videos, PDFs and HTML files its record
// names (lib/media.js finds them), and the preview overlay a click opens (mods/pdk-preview). Previews are PNGs
// the helper makes in <app home>/pdk-cache/media (Herdr's image() reads only inside the app home: gpui-shell
// assets.rs:56-80). A remote image is fetched only after a click on it, by the helper into that cache (review G8);
// the mod fetches nothing and the app has no HTTP client for images (src/main.rs:155, gpui app.rs:182). Large files
// and large inline images wait for a click; a missing file says so.

import { div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { openOverlay } from "herdr";
import { helper, mediaPreview } from "./lib/helper.js";
import { TYPE, RADIUS, ROW, SPACE, monoFont, focusRing } from "./lib/ui.js";
import { parseLines } from "./lib/chat.js";
import { bytesLabel, KIND_WORD, PreviewQueue, addSlimmed } from "./lib/media.js";

// What the helper said about each reference, and the jobs still to ask about (lib/media.js PreviewQueue: a job
// runs only while the chat shows the view and session it was queued for, review G1).
export class MediaStore extends PreviewQueue {
  // From the chat's 1 s loop: a preview command waiting for the picked chat's tiles, then the jobs the last render
  // queued (lib/media.js PreviewQueue.drain; no polling of its own).
  pump(cx) {
    const waiting = this.due();
    // Re-checked right before opening: still the chat (view and session) the command was sent for.
    if (waiting && waiting.scope === this.scope() && waiting.scope === this.frameScope) {
      const ref = this.nth(waiting.c);
      if (ref) { this.act(ref); cx.notify(); }
    }
    this.drain(cx, (ref, force) => mediaPreview(ref, "thumb", force));
  }

  // `pdk-chat.preview` (the newest tile) or `pdk-chat.preview:<n>` (the n-th newest) of the chat showing now: what a
  // click on it does. Right after a pick it waits for that chat's tiles (lib/media.js PreviewQueue.target).
  command(c) {
    const ref = this.target(c);
    if (!ref) return false;
    this.act(ref);
    return true;
  }

  // What a click on this tile does.
  act(ref) {
    const s = this.state(ref);
    if (s.state === "large") this.force(ref); else openPreview(ref, s);
    return true;
  }
}

// Records of one read: its whole lines, plus the lines too long for it, slimmed by the helper (inline image data
// replaced by its size), in file order, tagged with the transcript's path for media.js inlineRef. `live()` is the
// read's own gate: checked before and after every helper call (G1).
export function mediaRecords(path, got, live) {
  const recs = parseLines(got.lines ?? []).map((r) => ({ ...r, path }));
  return addSlimmed(recs, got.skipped, path, live, (p, offset) => helper("slim", [p, offset]));
}

export function openPreview(ref, s) {
  const { asking: _a, ...info } = s ?? {};
  openOverlay({ mod: "pdk-preview", kind: "dialog", width: 0.86, height: 0.88, props: { ref, info } });
}

const kindWord = (ref, s) => (ref.src === "inline" ? "Pasted image" : ref.src === "url" ? "Remote image" : KIND_WORD[s.kind ?? ref.kind] ?? "File");
// The caption's kind: an HTML file is "HTML" there, its body says "HTML page" (review 6).
const captionKind = (ref, s) => ((s.kind ?? ref.kind) === "html" && ref.src === "file" ? "HTML" : kindWord(ref, s));
// A reason that only says there is no preview adds nothing under "Preview unavailable" (review 6).
const GENERIC = /^\s*(no preview|preview unavailable|no answer)\.?\s*$/i;
const where = (ref) => (ref.src === "url" ? ref.url : ref.src === "inline" ? "inside the transcript" : ref.path);

// What a screen reader hears: the kind, the name, the machine and the state, in full.
function describe(ref, s) {
  const what = `${kindWord(ref, s)} ${ref.name}${ref.on ? ` on ${ref.on}` : ""}`;
  if (s.state === "missing") return `${what}: file not found at ${where(ref)}`;
  if (s.state === "remote") return `${what} from ${ref.host}: not loaded. Click to load preview`;
  if (s.state === "large") return `${what}, ${bytesLabel(s.size)}: not loaded. Click to load preview`;
  if (s.state === "loading") return `${what}: loading preview`;
  if (s.state === "error") return `${what}: preview unavailable${s.reason ? `, ${s.reason}` : ""}. Open preview`;
  if ((s.kind ?? ref.kind) === "video") return `Open video preview: ${ref.name}${ref.on ? ` on ${ref.on}` : ""}`;
  return `${what}${s.size ? `, ${bytesLabel(s.size)}` : ""}. Open preview. ${where(ref)}`;
}

// The image area's envelope (design chat-direction.md section 6, review 2): one reference gets the single frame,
// min(320, lane) at 8:5; two to eight get the grid frame, min(240, lane) at 8:5. An HTML file is a compact tile from the start. The
// class is the one the row had when it first showed media, so a tile never shrinks while more stream in.
export const SINGLE_W = SPACE[8] * 10, GRID_W = SPACE[12] * 5;
export const mediaClass = (refs) => (refs.length > 1 ? "grid" : "single");
function envelope(ref, s, cls, lane) {
  if ((s.kind ?? ref.kind) === "html") return { w: Math.min(GRID_W, lane), h: ROW.base * 2 };
  const w = Math.min(cls === "single" ? SINGLE_W : GRID_W, lane);
  return { w, h: Math.round((w * 5) / 8) };
}

// A strip of tiles for one row, once each by reference, in source order. `rowKey` keeps element ids unique when two
// rows name the same file; `lane` is the width the row's owner gives (a user bubble's 80%, the column for the agent).
export function mediaStrip(t, refs, store, rowKey, align = "start", { lane = SINGLE_W, cls = mediaClass(refs) } = {}) {
  const seen = new Set();
  const once = refs.filter((r) => (seen.has(r.key) ? false : seen.add(r.key)));
  const tiles = once.map((ref, i) => {
    store.drawn(ref);
    const st = store.state(ref), env = envelope(ref, st, cls, lane);
    return { w: env.w, el: tile(t, ref, st, store, `media-${rowKey}-${i}`, env) };
  });
  // Rows laid out here, as many tiles as the lane takes: a wrapping row is measured shorter than it draws, which
  // left the thread's end short of its last tiles (L1).
  const rows = [];
  for (const x of tiles) {
    const row = rows.at(-1);
    if (row && row.w + SPACE[2] + x.w <= lane) { row.items.push(x.el); row.w += SPACE[2] + x.w; } else rows.push({ w: x.w, items: [x.el] });
  }
  return v_flex().w_full().gap(SPACE[2])
    .children(rows.map((r) => h_flex().w_full().gap(SPACE[2]).items_start().when(align === "end", (el) => el.justify_end()).children(r.items)));
}

// The body's words in the reserved frame: a heading at 12 px, and below it a second line at 11 (two lines at most).
const words = (t, big, small) => v_flex().size_full().gap(SPACE[1]).items_center().justify_center().px(SPACE[3]).bg(t.canvas)
  .child(div().w_full().text_center().truncate().text_size(TYPE.sm).text_color(t.muted).child(big))
  .when(Boolean(small), (el) => el.child(div().w_full().text_center().text_size(TYPE.xs).line_height(`${LINE}px`).max_h(2 * LINE).overflow_hidden().text_color(t.muted).child(small)));

function tile(t, ref, s, store, id, { w, h }) {
  const label = describe(ref, s);
  const kind = s.kind ?? ref.kind;
  const ready = s.state === "ready" && s.width && s.height;
  let body;
  if (ready) {
    // Contained in the frame, never cropped or stretched, and never past the cached preview's own pixels.
    const k = Math.min(w / s.width, h / s.height, 1);
    body = div().relative().size_full().flex().items_center().justify_center().bg(t.canvas)
      .child(image(s.image).w(Math.max(1, Math.round(s.width * k))).h(Math.max(1, Math.round(s.height * k))))
      .when(kind === "video", (el) => el.child(playMarker(t)));
  } else if (s.state === "missing") body = words(t, "File not found", ref.on ?? "");
  else if (s.state === "loading") body = words(t, ref.on ? `Loading from ${ref.on}…` : "Loading preview…", "");
  else if (s.state === "remote" || s.state === "large") body = words(t, "Click to load preview", s.state === "large" ? bytesLabel(s.size) : "");
  else if (kind === "html") body = words(t, "HTML page", "Open in browser");
  else if (kind === "video") body = v_flex().relative().size_full().gap(SPACE[2]).items_center().justify_center().bg(t.canvas)
    .child(disc(t)).child(div().text_size(TYPE.xs).text_color(t.muted).child("No poster frame"));
  else body = words(t, "Preview unavailable", GENERIC.test(s.reason ?? "") ? "" : s.reason ?? "");
  // The file's name keeps at least half the caption (review 6): the size goes first when it can't fit, then the host
  // or machine shortens; their full words are in the tile's accessible name.
  const room = w - 2 * SPACE[2];
  const place = ref.on ?? (ref.src === "url" ? ref.host : null);
  const sized = Boolean(s.size) && s.state !== "missing" && w >= GRID_W;
  const caption = h_flex().h(ROW.compact).flex_none().px(SPACE[2]).gap(SPACE[2]).items_center().border_t(1).border_color(t.border).text_size(TYPE.xs)
    .child(div().flex_none().text_color(t.muted).child(captionKind(ref, s)))
    .when(Boolean(place), (el) => el.child(div().flex_shrink_1().min_w(0).max_w(Math.floor(room / 4)).truncate().text_color(t.muted).child(place)))
    .child(div().flex_1().min_w(Math.floor(room / 2)).truncate().text_color(t.foreground).child(ref.name))
    .when(sized, (el) => el.child(div().flex_none().font_family(monoFont()).text_color(t.dim).child(bytesLabel(s.size))));
  const frame = (el) => el.id(id).w(w).flex_none().rounded(RADIUS.lg).border_color(t.border).bg(t.surface).overflow_hidden()
    .accessibility_label(label).child(div().w_full().h(h).flex_none().child(body)).child(caption);
  // A missing file is a note, not a button: nothing to open.
  if (s.state === "missing") return frame(v_flex().border(2)).role("note");
  // A data card (design-system C5): a Tab stop whose border is the ring; hover muted, focused accent.
  const press = (_e, cx) => { if (s.state === "large") { store.force(ref); cx.notify(); } else openPreview(ref, s); };
  return frame(focusRing(v_flex(), t, press)).cursor_pointer().hover((st) => st.border_color(t.muted))
    .role("button").tooltip(kind === "video" ? "Play video" : "Open preview")
    .on_click((e, cx) => { cx.stop_propagation(); press(e, cx); });
}

// An 11 px line's height, for the two lines an error's explanation may take.
const LINE = SPACE[3] + SPACE.half;

const PLAY = 32; // SPACE[8]: the video marker's disc (design-system C13)

// A video's play disc: a triangle as text on a solid disc, named for screen readers by its tile. It opens the
// preview, whose own action plays the video in the default app: the mod API has no video player.
const disc = (t) => div().size(PLAY).flex_none().rounded(PLAY / 2).flex().items_center().justify_center().bg(t.solid).opacity(0.85)
  .text_size(TYPE.lg).text_color(t.solid_foreground).child("▶");
function playMarker(t) {
  return div().absolute().top(0).left(0).size_full().flex().items_center().justify_center().child(disc(t));
}
