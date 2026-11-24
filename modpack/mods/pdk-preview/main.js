// The preview a media tile in the chat opens (pdk-chat/media.js openPreview), as a dialog: an image at fit or
// a zoom, a PDF's first page, a video's poster frame with Play, and for HTML and remote images what clicking
// does instead. Open hands the file to the default app and Reveal shows it in Finder, through the helper's
// allow-listed `open` and `reveal`; a remote image opens in the browser through the app's own open_url
// (http and https only). Nothing here plays, renders or fetches anything itself:
// - Herdr 0.1.14 has no video element (gpui-shell typings.rs: elements are div, svg, image, lists, text and
//   inputs; no video), so Play opens the default app.
// - image() reads only inside the app home (gpui-shell assets.rs:56-80) and the app has no HTTP client for it
//   (src/main.rs:155 sets assets, not a client; gpui app.rs:182 is the null client). A remote image is loaded when
//   this preview opens, which only a click on it does (review G8): the helper downloads that one https address
//   into its cache (`fetch`: image types, 25 MB, 20 s, https redirects only, no cookies or credentials).
// - HTML is never rendered: a page can run scripts and load remote content.
// A file on another machine (a reference with `on`, review R3) is never handed to this Mac's helper by its path: Open
// and Play first bring a copy here (mediaOriginal, at most 25 MB) and open that; Reveal and an HTML file's Open in
// browser are off, and the footer says where the file is.
// Esc closes it (a dialog), as does Close. Bindable commands, also `herdr-app do pdk-preview.<command>`: zoom-in,
// zoom-out, fit, actual, open, reveal, close.

import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, theme, nextCommand } from "herdr";
import { helper, mediaPreview, mediaOriginal } from "./lib/helper.js";
import { TYPE, RADIUS, SPACE, ROW, withFont, monoFont, actionButton, fitLabel } from "./lib/ui.js";
import { bytesLabel, KIND_WORD } from "./lib/media.js";

const STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
// The app's own rows (design-astra item 13): a two-line header and the footer at 40, buttons at 28.
const HEAD = ROW.two;
const FOOT = ROW.two;
const PAD = 24;

// A file on another machine (the chat's remote media refs carry the machine as `on`).
const remote = (ref) => ref?.src === "file" && Boolean(ref.on);

export default class Preview extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.ref = p.ref ?? null;
    this.info = p.info ?? {};
    this.view = null;
    this.zoom = "fit";
    this.note = null;
    this.jobs = [];
    cx.spawn(async (cx) => {
      for (;;) {
        const job = this.jobs.shift();
        if (!job) { await cx.sleep(100); continue; }
        if (job.from) {
          this.note = `Bringing it from ${job.from.on}…`;
          this.busy = true;
          cx.notify();
          const copy = await mediaOriginal(job.from).catch((e) => ({ error: String(e?.message ?? e) }));
          this.busy = false;
          if (copy?.error || !copy?.path) { this.note = copy?.error ?? `Could not bring it from ${job.from.on}`; cx.notify(); continue; }
          job.path = copy.path;
        }
        const r = await helper(job.command, [job.path]).catch((e) => ({ error: String(e?.message ?? e) }));
        this.note = r?.ok ? null : `Could not ${job.command === "reveal" ? "show it in Finder" : "open it"}: ${r?.error ?? "no answer"}`;
        cx.notify();
      }
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "zoom-in" || c === "zoom-out") this.zoom = this.step(c === "zoom-in" ? 1 : -1);
        else if (c === "fit") this.zoom = "fit";
        else if (c === "actual") this.zoom = 1;
        else if (c === "open" || c === "reveal") this.act(c);
        else if (c === "close") this.dismiss();
        cx.notify();
      }
    });
    const ref = this.ref;
    const wants = ref && !["missing", "file"].includes(this.info.state) && ref.kind !== "html";
    if (wants) {
      this.loading = true;
      cx.spawn(async (cx) => {
        this.view = await mediaPreview(ref, "view", true).catch((e) => ({ error: String(e?.message ?? e) }));
        this.loading = false;
        cx.notify();
      });
    }
  }

  dismiss() { closeOverlay(props()?.overlay); }

  // Open or reveal, run by the task init started (a click's context ends with the click). A remote file is opened
  // from the copy brought here, never by its own path; it has nothing to reveal here, and a page is not copied.
  act(command) {
    const ref = this.ref;
    if (remote(ref)) {
      if (command === "open" && this.kind() !== "html") this.jobs.push({ command, from: ref });
      return;
    }
    const path = ref?.src === "inline" ? this.view?.file : ref?.path;
    if (path) this.jobs.push({ command, path });
  }

  kind() {
    return this.view?.kind ?? this.info.kind ?? this.ref?.kind;
  }

  // The shared action button (design-system C5): 28 px, a Tab stop with the accent ring, Enter and Space press it.
  button(t, id, label, onClick, { primary = false, disabled = false, hint } = {}) {
    return actionButton(t, id, label, hint ? `${label}: ${hint}` : label, (_e, cx) => onClick(cx), { variant: primary ? "primary" : "neutral", disabled }).flex_none();
  }

  // The natural size of what is shown. Fit is the image element's own "contain" (gpui img.rs:140), so it needs
  // no measuring; a zoom is that size times the step, scrolled.
  frame() {
    const v = this.view;
    return { w: this.info.srcWidth ?? v?.srcWidth ?? v?.width, h: this.info.srcHeight ?? v?.srcHeight ?? v?.height };
  }

  zoomTo(cx, next) { this.zoom = next; cx.notify(); }

  // From Fit, in goes to 100% and out to 50%; then one step at a time.
  step(dir) {
    if (this.zoom === "fit") return dir > 0 ? 1 : 0.5;
    const now = this.zoom;
    return dir > 0 ? STEPS.find((s) => s > now + 1e-6) ?? STEPS.at(-1) : [...STEPS].reverse().find((s) => s < now - 1e-6) ?? STEPS[0];
  }

  body(t) {
    const ref = this.ref;
    const kind = this.view?.kind ?? this.info.kind ?? ref?.kind;
    const message = (big, small) => v_flex().flex_1().min_h(0).items_center().justify_center().gap(SPACE[2]).px(SPACE[8]).bg(t.canvas)
      .child(div().text_size(TYPE.lg).font_medium().text_color(t.foreground).child(big))
      .child(div().max_w(560).text_center().text_size(TYPE.sm).text_color(t.muted).child(small));
    if (!ref) return message("Nothing to show", "This preview was opened without a file.");
    if (ref.src === "url" && this.loading) return message(`Loading from ${ref.host}…`, ref.url);
    if (ref.src === "url" && this.view?.error) return message(`Could not load the image from ${ref.host}`, `${this.view.error}. Open in browser tries it there.`);
    if (this.info.state === "missing") return message("Not found", `Nothing is at ${ref.path} now. It may have been moved, renamed or not written yet.`);
    if (kind === "html") return message("HTML page", remote(ref) ? `Not shown here, and it is on ${ref.on}: open it on that machine.` : "Not shown here: a page can run scripts and load remote content. Open shows it in your browser.");
    if (this.loading) return message("Loading preview…", ref.path ?? "From the transcript");
    if (this.view?.error) return message("No preview", this.view.error);
    if (!this.view?.image) return message(kind === "video" ? "No poster frame" : "No preview", kind === "video" ? "Quick Look made no poster for this video. Play opens it in your default app." : this.view?.reason ?? "");
    const f = this.frame();
    const fit = this.zoom === "fit";
    const dw = Math.max(1, Math.round((f.w ?? this.view.width) * (fit ? 1 : this.zoom)));
    const dh = Math.max(1, Math.round((f.h ?? this.view.height) * (fit ? 1 : this.zoom)));
    // Fit: the picture at its own size, capped at the body's on both axes and drawn contained in that box (an
    // image with no size takes its natural one: gpui img.rs:349-375; contain is its default fit, :140), centred.
    // Zoomed: its size times the step, from the top left, scrolled.
    return v_flex().id(fit ? "canvas-fit" : "canvas").flex_1().min_h(0).bg(t.canvas).p(PAD)
      .when(fit, (el) => el.items_center().justify_center())
      .when(!fit, (el) => el.overflow_scroll())
      .child(div().relative().flex_none().when(fit, (el) => el.max_w("100%").max_h("100%")).when(!fit, (el) => el.w(dw).h(dh))
        .child(fit ? image(this.view.image).max_w("100%").max_h("100%") : image(this.view.image).w(dw).h(dh))
        .when(kind === "video", (el) => el.child(div().absolute().top(0).left(0).size_full().flex().items_center().justify_center()
          .child(actionButton(t, "play", "▶ Play", "Play in the default app: Herdr has no in-app video player", () => this.act("open"), { variant: "play" })))));
  }

  render(cx) {
    const t = theme();
    const ref = this.ref ?? {};
    const v = this.view ?? {};
    const kind = v.kind ?? this.info.kind ?? ref.kind;
    const f = this.frame();
    const zoomable = Boolean(v.image) && kind !== "video";
    const percent = this.zoom === "fit" ? "" : `${Math.round(this.zoom * 100)}%`;
    const size = v.size ?? this.info.size ?? ref.bytes;
    const dims = f.w && f.h ? `${f.w} × ${f.h}` : null;
    const what = ref.src === "inline" ? "Pasted image" : ref.src === "url" ? "Remote image" : KIND_WORD[kind] ?? "File";
    // Sizes and the path are metadata, in mono after the kind's word (design-astra item 1).
    const meta = [dims, size ? bytesLabel(size) : null].filter(Boolean).join(" · ");
    const where = ref.src === "url" ? ref.url : ref.src === "inline" ? "Inside the transcript (no file of its own)" : ref.path;
    const away = remote(ref);
    const local = ref.src === "file" && !away && this.info.state !== "missing";
    const openLabel = ref.src === "url" ? "Open in browser" : kind === "video" ? "Play in default app" : kind === "html" ? "Open in browser" : "Open in default app";
    const canOpen = ref.src === "url" || local || (away && kind !== "html" && this.info.state !== "missing") || (ref.src === "inline" && Boolean(v.file));
    // The footer's words, worked out once for the label and its tooltip (design-system C14).
    const note = this.note ?? (away ? `This file is on ${ref.on}${kind === "html" ? "" : `: ${kind === "video" ? "Play" : "Open"} brings a copy to this Mac first`}.` : ref.src === "url" ? `Loaded from ${ref.host} because you opened it; nothing remote loads before a click.` : kind === "video" ? "Plays in your default app: Herdr has no in-app video player." : "");
    return withFont(v_flex()).id("preview-root").size_full().bg(t.popover)
      .child(h_flex().h(HEAD).flex_none().px(SPACE[4]).gap(SPACE[3]).items_center().border_b(1).border_color(t.border)
        .child(v_flex().flex_1().min_w(0).gap(SPACE[0])
          .child(fitLabel("preview-name", ref.name ?? "Preview").text_size(TYPE.base).font_medium().text_color(t.foreground))
          .child(h_flex().id("preview-meta").min_w(0).gap(SPACE[1]).text_size(TYPE.xs).text_color(t.dim).when(Boolean(where), (el) => el.tooltip(where))
            .child(div().flex_none().child(what))
            .when(Boolean(meta || where), (el) => el.child(div().flex_1().min_w(0).truncate().font_family(monoFont()).child(`· ${[meta, where].filter(Boolean).join(" · ")}`)))))
        .when(zoomable, (el) => el.child(h_flex().flex_none().gap(SPACE[1]).items_center()
          .child(this.button(t, "fit", "Fit", (cx) => this.zoomTo(cx, "fit"), { disabled: this.zoom === "fit" }))
          .child(this.button(t, "out", "−", (cx) => this.zoomTo(cx, this.step(-1)), { hint: "Zoom out" }))
          // Never an empty readout: "Fit" while fitted, else the percentage in mono (design-astra item 13).
          .child(div().w(48).text_center().text_size(TYPE.sm).text_color(t.muted).when(this.zoom !== "fit", (el) => el.font_family(monoFont()))
            .role("status").accessibility_label(this.zoom === "fit" ? "Zoom: fit to the window" : `Zoom ${percent}`).child(this.zoom === "fit" ? "Fit" : percent))
          .child(this.button(t, "in", "+", (cx) => this.zoomTo(cx, this.step(1)), { hint: "Zoom in" }))
          .child(this.button(t, "actual", "100%", (cx) => this.zoomTo(cx, 1), { hint: "Actual size" })))))
      .child(v_flex().id("preview-body").flex_1().min_h(0).min_w(0).overflow_hidden().child(this.body(t)))
      .child(h_flex().h(FOOT).flex_none().px(SPACE[4]).gap(SPACE[2]).items_center().border_t(1).border_color(t.border)
        .child(fitLabel("preview-note", note).flex_1().text_size(TYPE.xs).text_color(this.note && !this.busy ? t.blocked : t.dim))
        .child(this.button(t, "open", openLabel, (cx) => (ref.src === "url" ? cx.open_url(ref.url) : this.act("open")), { primary: true, disabled: !canOpen }))
        .child(this.button(t, "reveal", "Reveal in Finder", () => this.act("reveal"),
          { disabled: !local, hint: away ? `The file is on ${ref.on}, not on this Mac` : ref.src === "inline" ? "It has no file of its own: it is inside the transcript" : ref.src === "url" ? "A remote image has no file here" : undefined }))
        .child(this.button(t, "close", "Close", () => this.dismiss())));
  }
}
