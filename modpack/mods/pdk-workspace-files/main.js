// Clone: herdr-app@2405bf3 defaults/mods/files/main.js, Apache-2.0. Pinned target and shared utility shell.
// A lazy file browser for the focused pane's folder, with bounded read-only previews.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { spaces, exec, readTextFile, watchFolder, theme, settings, window, props, nextCommand } from "herdr";

import { captureWorkspace, workspaceCurrent, utilityKey } from "./lib/workspace.js";
import { utilityHeader, utilityContext, utilityError, closeUtility } from "./lib/workspace-dialog.js";
import { TYPE, SPACE, ROW, RADIUS, withFont, monoFont, rowStates, caretButton, actionButton, overlayFrame } from "./lib/ui.js";

function location() {
 const target=captureWorkspace(props()); return {cwd:target?.folder,on:target?.machine,space:target?.space};
}
const key=()=>workspaceCurrent(captureWorkspace(props()),spaces())?utilityKey(props()):null;
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const PER_FOLDER = 500, TOTAL = 5000;

async function directory(path, on) {
  const windowsDirectory = async () => {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Links keep directory attributes even when dangling; check their target.
    // Other reparse points (OneDrive's folders) have no LinkType and are folders.
    // PowerShell reads curly single quotes as quotes too, so they're doubled like '.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windowsDirectory();
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

export default class Files extends View {
  init(_props, cx) {
    this.target=captureWorkspace(props()); this.handle=cx.focus_handle(); this.handle.focus();
    this.saved = new Map();
    cx.spawn(async cx=>{for(;;){const c=await nextCommand(); if(c==="close")closeUtility(); else if(c==="refresh")this.refresh(cx); else if(c==="back")this.show(null); else if(c.startsWith("file:")){const path=c.slice(5); if(this.entriesFlat().some(e=>e.path===path && !e.dir))this.show(path,cx);} else if(c.startsWith("fold:")){const path=c.slice(5); if(this.entriesFlat().some(e=>e.path===path && e.dir))this.toggle(path,cx);} cx.notify();}});
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return this.context === context && key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    if(!workspaceCurrent(this.target,spaces())){this.error="This workspace is no longer available; close and reopen from its menu";this.watched=null;return;}
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { folders: this.folders, file: this.file });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.show(null); this.watched = null; this.error = null; this.limited = false;
      this.loading = false;
      if (saved?.file) this.show(saved.file, cx);
    }
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {};
        if (top?.code === 0) {
          const prefixResult=await exec("git",["rev-parse","--show-prefix"],{cwd,on});
          const prefix=prefixResult.code===0?prefixResult.stdout.trim():null;
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            if(prefix!==null && entry.slice(3).startsWith(prefix))marks[`${cwd}/${entry.slice(3+prefix.length)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }
        if (!this.current(context)) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  show(path, cx) {
    this.code?.release(); this.code = null; this.file = path; this.fileError = null;
    if (!path || !cx) return;
    const context = this.context, root = this.root, on = this.on;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (this.file !== path || !this.current(context)) return;
        if (text === null) { this.fileError = "This file is no longer available"; return; }
        if (text.includes("\0")) { this.fileError = "Binary file · no text preview"; return; }
        const t = theme(), ext = path.includes(".") ? path.split(".").pop() : "txt";
        this.code = EditorState.new({ language: LANG[ext] ?? ext, readonly: true,
          value: text.length > 400000 ? text.slice(0, 400000) + "\n… (file truncated)" : text,
          font_family: monoFont(), font_size: TYPE.sm,
          syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
      } catch { if (this.file === path && this.current(context)) this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; }
      finally { cx.notify(); }
    });
  }

  entriesFlat(prefix="",depth=0,out=[]) {
    if(out.length>=TOTAL || depth>40)return out;
    for(const entry of this.entries.get(prefix)??[]){if(out.length>=TOTAL)break;const path=prefix?`${prefix}/${entry.name}`:entry.name;out.push({...entry,path,depth});if(entry.dir&&this.folders.has(path))this.entriesFlat(path,depth+1,out);}
    return out;
  }
  row(entry,t,cx) {
    const path=entry.path,mark=this.marks[`${this.root}/${path}`],open=this.folders.has(path);
    return rowStates(h_flex().id(`file-${path}`).h(ROW.base).flex_none().pl(SPACE[2]+entry.depth*SPACE[4]).pr(SPACE[2]).gap(SPACE[2]).items_center().rounded(RADIUS.md),t,{selected:this.file===path,ground:t.canvas,color:t.foreground})
      .on_click((_e,cx)=>entry.dir?this.toggle(path,cx):this.show(path,cx)).tooltip(`${this.root}/${path}`)
      .child(h_flex().min_w(0).gap(SPACE[0]).items_center().child(div().min_w(0).truncate().text_size(TYPE.base).child(entry.name))
        .when(entry.dir,el=>el.child(caretButton(t,`browse-fold-${path}`,open,`${open?"Fold":"Open"} ${entry.name}`,()=>this.toggle(path,cx)))))
      .child(div().flex_1()).when(Boolean(mark),el=>el.child(div().text_size(TYPE.xs).text_color(mark==="A"?t.ansi2:mark==="D"||mark==="U"?t.ansi1:t.muted).child(mark)));
  }
  render(cx) {
    const t=theme(),valid=workspaceCurrent(this.target,spaces()),narrow=(this.width??880)<700;
    const list=v_flex().id("browse-files-tree").flex_1().min_w(0).min_h(0).overflow_y_scrollbar().p(SPACE[2])
      .children(this.entriesFlat().map(e=>this.row(e,t,cx)))
      .when(!this.entries.get("")?.length,el=>el.child(div().p(SPACE[3]).text_size(TYPE.sm).text_color(t.muted).child(this.loading?"Loading files…":this.root?"No files":"No folder")))
      .when(this.limited,el=>el.child(div().p(SPACE[2]).text_size(TYPE.xs).text_color(t.dim).child("Limited to 500 entries per folder and 5,000 total")));
    const preview=v_flex().h_full().flex_1().min_w(0).min_h(0).bg(t.canvas)
      .when(Boolean(this.file),el=>el.child(h_flex().h(ROW.base).px(SPACE[3]).gap(SPACE[2]).items_center()
        .when(narrow,el=>el.child(actionButton(t,"browse-back","Back","Back to files",()=>{this.show(null);cx.notify();})))
        .child(div().min_w(0).truncate().font_family(monoFont()).text_size(TYPE.xs).text_color(t.muted).tooltip(this.file).child(this.file))))
      .child(this.code?Editor.new(this.code).flex_1().min_h(0):div().p(SPACE[3]).text_size(TYPE.sm).text_color(t.muted).child(this.fileError || (this.file?"Loading file…":"Select a file for a read-only preview")));
    return withFont(overlayFrame(t,"pdk-workspace-files",{hostFrame:true})).size_full().on_size_change((size,cx)=>{if(this.width!==size.width){this.width=size.width;cx.notify();}}).bg(t.canvas).text_color(t.foreground).track_focus(this.handle)
      .on_key_down((e,cx)=>{if(e.key==="escape"){closeUtility();cx.stop_propagation();}})
      .child(utilityHeader(t,"files",this.target,null,()=>this.refresh(cx),false,this))
      .child(utilityContext(t,this.target,this.root,()=>this.refresh(cx),!valid))
      .when(Boolean(this.error)||!valid,el=>el.child(utilityError(t,"browse-error",valid?this.error:"This workspace is no longer available; close and reopen from its menu")))
      .child(narrow?(this.file?preview:list):h_flex().flex_1().min_h(0).child(div().w(240).h_full().flex_none().border_r(1).border_color(t.border).child(list)).child(preview));
  }
}
