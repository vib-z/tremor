// Cloned from herdr-app@2405bf3 defaults/mods/files/main.js, Apache-2.0.
// Copyright herdr-app contributors. See NOTICE.md and licenses/Apache-2.0.txt.
// Changes: pin the originating chat's folder/machine; remove git, watchers and content previews;
// add bounded multi-selection of files and folders, a step up to any folder on that machine, Attach, cancellation
// and keyboard navigation on the shared scale.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Checkbox } from "gpui-base";
import { props, theme, exec, run, openOverlay, closeOverlay, nextCommand } from "herdr";
import { TYPE, SPACE, ROW, ICON, RADIUS, icon, withFont, monoFont, actionButton, caretButton, rowStates, overlayHeader } from "./lib/ui.js";
import { utilityError } from "./lib/workspace-dialog.js";
import { boundedAttachments } from "./lib/composer.js";
import { LIST_SCRIPT, parseDirectory, FileTree, absolute, SHOWN } from "./model.js";

// The stock files mod's fixed POSIX listing script, unchanged; the path is always an argument.
// This is this mod's ONLY exec capability. No file contents, git, agent or other program is read/run.
async function directory(path, on) {
  const r = await exec("sh", ["-c", LIST_SCRIPT, "files", path], { on });
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder (a POSIX shell is required)");
  return parseDirectory(r.stdout);
}
const KEYS = ["up", "down", "home", "end", "space", "enter", "right", "escape"], LIMIT = "At most 16 paths and 16,384 characters";
export default class Files extends View {
  init(_props, cx) {
    if(props()?.mode==="browse") {
      const p=props(); this.routed=true; if(p.overlay)closeOverlay(p.overlay);
      openOverlay({mod:"pdk-workspace-files",kind:"dialog",width:880,height:640,props:{...p,overlay:undefined}}); return;
    }
    const source = props()?.source;
    this.request = source;
    this.tree = new FileTree(source?.cwd ?? "", source?.on ?? null);
    this.entries = this.tree.entries; this.folders = this.tree.folders;
    this.pending = new Set(); this.context = {}; this.error = null;
    this.handle = cx.focus_handle(); this.handle.focus();
    if (!source?.id || !source?.origin || !boundedAttachments([this.tree.root])) this.error = "No originating folder is available";
    else this.refresh(cx);
    cx.spawn(async cx => {
      for (;;) {
        const c = await nextCommand();
        if (c === "attach") this.attach(cx);
        else if (c === "cancel") this.close();
        else if (c === "refresh") this.refresh(cx);
        else if (c === "focus") this.handle.focus();
        else if (c === "parent") this.up(cx);
        else if (c.startsWith("pick:")) { if (!this.tree.pick(c.slice(5))) this.error = "Choose a listed file or folder; at most 16 paths and 16,384 characters"; }
        else if (c.startsWith("fold:")) this.toggle(c.slice(5), cx);
        else if (KEYS.includes(c)) this.key(c, cx);
        cx.notify();
      }
    });
  }
  current(context) { return this.context === context; } // pinned origin, independent of later focus
  async loadFolder(path, context) {
    const entries = await directory(path ? absolute(this.tree.root, path) : this.tree.root, this.tree.on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    this.tree.loaded(path, entries);
  }
  refresh(cx) {
    if (this.loading || !this.request?.id || !boundedAttachments([this.tree.root])) return;
    const context = this.context; this.loading = true; this.tree.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) { if (!this.current(context)) return; await this.loadFolder(path, context); }
        if (this.current(context)) this.error = null;
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.current(context)) this.loading = false; cx.notify(); }
    });
  }
  toggle(path, cx) {
    if (this.tree.fold(path) && !this.entries.has(path) && !this.pending.has(path)) {
      const context = this.context; this.pending.add(path);
      cx.spawn(async cx => {
        try { await this.loadFolder(path, context); }
        catch (e) { if (this.current(context)) this.error = String(e); }
        finally { this.pending.delete(path); cx.notify(); }
      });
    }
    cx.notify();
  }
  // The listing starts over one level up; ticks are absolute paths and stay.
  up(cx) {
    if (!this.tree.up()) return;
    this.context = {}; this.loading = false; this.pending.clear(); this.error = null;
    this.refresh(cx); cx.notify();
  }
  tick(path) { if (!this.tree.pick(path)) this.error = LIMIT; }
  // Space ticks the row; Enter opens a folder or ticks a file; Right opens a closed folder.
  key(key, cx) {
    if (key === "escape") return this.close();
    const row = this.tree.rows()[this.tree.at];
    if (["up", "down", "home", "end"].includes(key)) this.tree.move(key);
    else if (key === "space") { if (row) this.tick(row.path); }
    else if (key === "right") { if (row?.dir && !row.open) this.toggle(row.path, cx); }
    else if (row?.dir) this.toggle(row.path, cx);
    else if (row) this.tick(row.path);
    cx.notify();
  }
  attach(cx) {
    const paths = this.tree.paths();
    if (!paths?.length || !this.request) return;
    run(`pdk-chat.attach:${JSON.stringify({ id: this.request.id, origin: this.request.origin, on: this.tree.on, paths })}`);
    this.close(false); cx.notify();
  }
  close(cancel = true) {
    if (cancel && this.request) run(`pdk-chat.attach-cancel:${this.request.id}`);
    this.context = null;
    if (props()?.overlay) closeOverlay(props().overlay);
  }
  row(t, entry, index, cx) {
    const selected = this.tree.ticked(entry.path), active = index === this.tree.at;
    const act = () => { this.tree.at = index; if (entry.dir) this.toggle(entry.path, cx); else { this.tick(entry.path); cx.notify(); } };
    return rowStates(h_flex().id(`file-${entry.path}`).h(ROW.base).flex_none().pl(SPACE[2] + entry.depth * SPACE[4]).pr(SPACE[2]).gap(SPACE[2]).items_center().rounded(RADIUS.md), t, { selected: active || selected, focused: active && this.handle.is_focused(), ground: t.popover, color: t.foreground })
      .on_click((_e, cx) => { this.handle.focus(); act(); })
      .accessibility_label(`${entry.name}, ${selected ? "selected " : ""}${entry.dir ? "folder" : "file"}`).tooltip(absolute(this.tree.root, entry.path))
      // gpui-base's Checkbox carries the ticked state to a screen reader; the check is the pack's centred Lucide glyph.
      .child(Checkbox.new(`tick-${entry.path}`).checked(selected).accessibility_label(`Tick ${entry.name}`)
        .size(ICON.lg).flex_none().flex().items_center().justify_center().rounded(RADIUS.sm).border(1)
        .border_color(selected || (active && this.handle.is_focused()) ? t.accent : t.dim).when(selected, el => el.bg(t.accent))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => cx.stop_propagation())
        .on_change((_v, cx) => { this.handle.focus(); this.tree.at = index; this.tick(entry.path); cx.notify(); })
        .when(selected, el => el.child(icon("check", ICON.sm, t.accent_foreground))))
      .child(h_flex().min_w(0).gap(SPACE[0]).items_center()
        .child(div().min_w(0).truncate().text_size(TYPE.base).text_color(t.foreground).child(entry.name))
        .when(entry.dir, el => el.child(caretButton(t, `fold-${entry.path}`, entry.open, `${entry.open ? "Fold" : "Open"} ${entry.name}`, () => this.toggle(entry.path, cx)))))
      .child(div().flex_1());
  }
  render(cx) {
    if(this.routed)return div();
    const t = theme(), all = this.tree.rows();
    this.tree.at = Math.max(0, Math.min(this.tree.at, all.length-1));
    this.tree.top = Math.max(0, Math.min(this.tree.top, all.length-SHOWN));
    const rows = all.slice(this.tree.top, this.tree.top+SHOWN), count = this.tree.selected.size;
    return withFont(v_flex()).id("pdk-files").size_full().min_h(0).bg(t.popover).text_color(t.foreground).track_focus(this.handle)
      // Row keys act only while the browser itself has the keys: a key from a focused control inside it (a row's
      // Checkbox, Up, Cancel, Attach) is that control's alone, so a box ticks once and Enter on a folder's box ticks it.
      .on_key_down((e, cx) => { if (["cmd-enter", "ctrl-enter"].includes(e.keystroke)) { cx.stop_propagation(); this.attach(cx); } else if (e.key === "escape" || (KEYS.includes(e.key) && this.handle.is_focused())) { cx.stop_propagation(); this.key(e.key,cx); } })
      .child(overlayHeader(t, "files-head", "Attach files", { trailing: div().min_w(0).truncate().text_right().text_size(TYPE.sm).text_color(t.muted).tooltip(this.tree.on ?? "This computer").child(this.tree.on ?? "This computer") }))
      .child(h_flex().px(SPACE[3]).py(SPACE[1]).gap(SPACE[2]).items_center()
        .child(actionButton(t, "files-up", "Up", "Up one folder", () => this.up(cx), { disabled: this.tree.root === "/" }))
        .child(div().flex_1().min_w(0).overflow_hidden().whitespace_nowrap().text_ellipsis_start().text_size(TYPE.xs).font_family(monoFont()).text_color(t.dim).tooltip(this.tree.root).child(this.tree.root)))
      .child(v_flex().id("files-tree").flex_1().min_h(0).overflow_hidden().px(SPACE[2])
        .on_scroll_wheel((e,cx) => { const steps = Math.trunc(-e.delta.y / ROW.base); for (let i=0;i<Math.min(Math.abs(steps),SHOWN);i++) this.tree.move(steps<0?"up":"down"); cx.notify(); })
        .children(rows.map((r,i) => this.row(t,r,this.tree.top+i,cx)))
        .when(Boolean(this.error),el=>el.child(utilityError(t,"attach-files-error",this.error)))
        .when(!this.error && !all.length, el=>el.child(div().p(SPACE[2]).text_size(TYPE.sm).text_color(t.muted).child(this.loading?"Loading files…":"No files")))
        .when(this.tree.limited, el => el.child(div().p(SPACE[2]).text_size(TYPE.xs).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total"))))
      .child(div().px(SPACE[3]).text_size(TYPE.xs).text_color(t.dim).child("Adds paths to your draft; does not upload files."))
      .child(div().px(SPACE[3]).py(SPACE[1]).text_size(TYPE.xs).text_color(t.dim).child("↑↓ move · Space tick · Enter or → open · Tab controls · Esc cancel"))
      .child(h_flex().h(ROW.two).flex_none().px(SPACE[3]).gap(SPACE[2]).items_center().border_t(1).border_color(t.border)
        .child(div().flex_1().text_size(TYPE.xs).font_family(monoFont()).text_color(t.dim).child(`${count}/16 selected`))
        .child(actionButton(t,"files-cancel","Cancel","Cancel attaching files",()=>this.close()))
        .child(actionButton(t,"files-attach",`Attach (${count})`,`Attach ${count} paths to the originating draft`,()=>this.attach(cx),{variant:"primary",disabled:!count})));
  }
}
