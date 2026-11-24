// Clone: herdr-app@2405bf3 defaults/mods/changes/main.js, Apache-2.0. Captured workspace; stock Git read/diff/add-all/commit logic.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list } from "gpui-base";
import { spaces, exec, readTextFile, watchFolder, theme, props, nextCommand, shared, setShared } from "herdr";

import { captureWorkspace, workspaceCurrent, utilityKey, READ } from "./lib/workspace.js";
import { utilityHeader, utilityContext, utilityError, closeUtility } from "./lib/workspace-dialog.js";
import { TYPE, SPACE, ROW, RADIUS, withFont, monoFont, rowStates, fieldFrame, actionButton, overlayFrame } from "./lib/ui.js";
function location(){const p=captureWorkspace(props());return {cwd:p?.repo,on:p?.machine};}
const key=()=>workspaceCurrent(captureWorkspace(props()),spaces())?utilityKey(props()):null;
const STATUS = ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"];
const countLines = (text) => text ? text.split("\n").length - Number(text.endsWith("\n")) : 0;

// Numbers each diff line once, so a frame only draws the rows on screen.
function diffRows(lines) {
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

export default class Changes extends View {
  init(_props, cx) {
    this.target=captureWorkspace(props()); this.draftKey=`pdk.changes.message:${utilityKey(props())}`;
    this.files = []; this.rows = []; this.diffWidth = 0; this.message = ""; this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Commit message" });
    this.input.on("change", (_e, cx) => {
      const hadMessage = Boolean(this.message.trim());
      this.message = this.input.value(); setShared(this.draftKey,this.message);
      if (hadMessage !== Boolean(this.message.trim())) cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.commit(cx));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.refresh(cx); this.handle.focus();
    cx.spawn(async cx=>{for(;;){const c=await nextCommand(); if(c==="close")closeUtility(); else if(c==="refresh")this.refresh(cx); else if(c.startsWith("file:"))this.pick(c.slice(5),cx); else if(c.startsWith("message:")){this.message=c.slice(8);this.input.set_value(this.message);setShared(this.draftKey,this.message);} else if(c==="commit")this.commit(cx); cx.notify();}});
    cx.timer.every(10000, (cx) => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          await watchFolder(root);
          if (this.watched === root) this.refresh(cx);
        }
      } catch { this.watched = null; }
    });
  }

  refresh(cx) {
    if(!workspaceCurrent(this.target,spaces())){this.error="This workspace is no longer available; close and reopen from its menu";this.watched=null;return;}
    if (this.loading || this.busy) return;
    const { cwd, on } = location(), context = key();
    if (context !== this.context) {
      this.context = context; this.root = null; this.files = []; this.open = null;
      this.setLines([]); this.message = shared(this.draftKey) ?? ""; this.input.set_value(this.message); this.error = null; this.note = null; this.watched = null; this.closed = false; this.limited = false;
    }
    if (!cwd) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        if (key() !== context) return;
        if (top.code !== 0) { this.root = null; this.files = []; this.setLines([]); this.open = null; this.error = "Not a git repository"; return; }
        const root = top.stdout.trim(), git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
        const status = await git(STATUS);
        if (status.code !== 0) throw new Error(status.stderr);
        const head = await git(["rev-parse", "--verify", "HEAD"]);
        const stats = {};
        const results = head.code === 0 ? [await git(["diff", "HEAD", "--numstat", "-z", "--no-renames"])] : [await git(["diff", "--cached", "--numstat", "-z", "--no-renames"]), await git(["diff", "--numstat", "-z", "--no-renames"])];
        for (const result of results) {
          if (result.code !== 0) throw new Error(result.stderr);
          for (const entry of result.stdout.split("\0")) {
            const [a, d, ...parts] = entry.split("\t");
            if (!parts.length) continue;
            const path = parts.join("\t"), old = stats[path] ?? { add: 0, del: 0 };
            stats[path] = { add: old.add + (Number(a) || 0), del: old.del + (Number(d) || 0), binary: a === "-" };
          }
        }
        const files = [];
        const entries = status.stdout.split("\0").filter(Boolean);
        for (const entry of entries.slice(0, 1000)) {
          const xy = entry.slice(0, 2), path = entry.slice(3), fresh = xy === "??";
          const conflict = xy.includes("U") || xy === "AA" || xy === "DD";
          const s = conflict ? "U" : xy.includes("D") ? "D" : fresh || xy.includes("A") ? "A" : "M";
          const stat = stats[path] ?? { add: 0, del: 0 };
          files.push({ path, status: s, fresh, conflict, ...stat });
        }
        if (key() !== context) return;
        this.root = root; this.on = on; this.seen = status.stdout; this.hasHead = head.code === 0; this.files = files; this.limited = entries.length > 1000; this.error = null;
        this.watch(root, cx);
        if (this.open && !files.some((f) => f.path === this.open)) { this.open = null; this.setLines([]); }
        // The first file's diff shows until you pick another.
        if (!this.open && !this.closed && files.length) this.open = files[0].path;
        if (this.open) {
          try { await this.load(this.open, context); }
          catch { if (key() === context) this.setLines(["Cannot preview this diff (too large or unreadable)"]); }
        }
      } catch (e) { if (key() === context) this.error = String(e); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  async load(path, context) {
    const file = this.files.find((f) => f.path === path), root = this.root, on = this.on;
    if (!file) return;
    let lines;
    if (file.fresh || (!this.hasHead && file.status === "A")) {
      const text = await readTextFile(`${root}/${path}`, { on }).catch(() => null);
      if (text === null) lines = ["Cannot preview this file (binary, too large, or unreadable)"];
      else if (text.includes("\0")) lines = ["Binary file · no text diff"];
      else {
        file.add = countLines(text);
        lines = [`@@ -0,0 +1,${file.add} @@`, ...text.slice(0, 400000).replace(/\n$/, "").split("\n").slice(0, 1500).map(l => `+${l}`)];
      }
    } else {
      const r = await exec("git", [...READ, "diff", ...(this.hasHead ? ["HEAD"] : []), "--no-ext-diff", "--no-textconv", "--no-color", "--", path], { cwd: root, on });
      if (r.code !== 0) throw new Error(r.stderr);
      const all = r.stdout.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
      lines = first < 0 ? [file.binary ? "Binary file changed" : "No text diff available"] : all.slice(first);
    }
    if(lines.length>1500)lines=[...lines.slice(0,1499),"… Diff limited to 1,500 lines"];
    if (key() === context && this.open === path) this.setLines(lines.slice(0, 1500).map(line => line.length > 4000 ? line.slice(0, 4000) + "… (line truncated)" : line));
  }

  setLines(lines) {
    this.rows = diffRows(lines);
    this.diffWidth = Math.max(300, ...lines.map(line => line.length * 8 + 96));
  }

  pick(path, cx) {
    this.open = this.open === path ? null : path; this.setLines([]); this.note = null;
    this.closed = !this.open;
    const context = this.context;
    if (this.open) cx.spawn(async (cx) => {
      try { await this.load(path, context); }
      catch (e) { if (key() === context && this.open === path) this.note = `Cannot preview this diff (too large or unreadable): ${e}`; }
      cx.notify();
    });
    cx.notify();
  }

  commit(cx) {
    if (!this.message.trim() || !this.root || !this.files.length || this.files.some(f=>f.conflict) || this.busy || this.loading || this.context !== key()) return;
    const root = this.root, on = this.on, context = this.context, message = this.message.trim(), seen = this.seen;
    this.busy = true; this.note = null;
    cx.spawn(async (cx) => {
      try {
        const git = (args) => exec("git", args, { cwd: root, on });
        // Before the first write: still this repository (not a parent one after its .git went), still the changes
        // on screen, and a name and email the person set. Git would otherwise invent one from the host name.
        const top = await git([...READ, "rev-parse", "--show-toplevel"]), now = await git([...READ, ...STATUS]);
        if (key() !== context || top.code !== 0 || top.stdout.trim() !== root || now.code !== 0 || now.stdout !== seen) throw new Error("The repository changed since this list was read; nothing was staged. Check the list again, then commit");
        for (const who of ["GIT_AUTHOR_IDENT", "GIT_COMMITTER_IDENT"]) {
          if ((await git([...READ, "-c", "user.useConfigOnly=true", "var", who])).code !== 0) throw new Error("Git has no name and email for you; nothing was staged. Set user.name and user.email, then commit");
        }
        for (const args of [["add", "-A"], ["-c", "user.useConfigOnly=true", "commit", "-m", message]]) {
          if(key()!==context)throw new Error("Captured workspace is no longer available; commit stopped");
          const r = await git(args);
          if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        }
        if (key() === context) { this.message = ""; this.input.set_value(""); setShared(this.draftKey,""); }
      } catch (e) { if (key() === context) this.note = `Commit failed: ${e}`; }
      finally { this.busy = false; this.refresh(cx); cx.notify(); }
    });
    cx.notify();
  }

  diffRow({ kind, number, text }, t, index) {
    if(kind==="@")return div().id(`diff-row-${index}`).w_full().px(SPACE[3]).h(SPACE[5]).flex_none().truncate().bg(t.raised).text_color(t.muted).child(text);
    return h_flex().id(`diff-row-${index}`).w_full().h(SPACE[5]).text_size(TYPE.sm).font_family(monoFont()).text_color(t.foreground).line_height(`${SPACE[5]}px`).flex_none().gap(SPACE[2]).when(kind==="+",e=>e.bg(t.ansi2+"18")).when(kind==="-",e=>e.bg(t.ansi1+"18"))
      .child(div().id(`diff-number-${index}`).w(SPACE[12]).flex_none().text_right().text_color(t.dim).child(number===undefined?"":String(number)))
      .child(div().id(`diff-sign-${index}`).w(SPACE[3]).flex_none().text_color(kind==="+"?t.ansi2:kind==="-"?t.ansi1:t.dim).child(kind==="+"||kind==="-"?kind:""))
      .child(div().id(`diff-text-${index}`).flex_1().min_w(0).text_color(t.foreground).child(text));
  }
  render(cx) {
    const t=theme(),valid=workspaceCurrent(this.target,spaces()),conflict=this.files.some(f=>f.conflict);
    const enabled=Boolean(valid&&this.message.trim()&&this.root&&this.files.length&&!conflict&&!this.busy&&!this.loading);
    const countLabel=`${this.files.length}${this.limited?"+":""} ${this.files.length===1&&!this.limited?"file":"files"}`;
    const add=this.files.reduce((n,f)=>n+f.add,0),del=this.files.reduce((n,f)=>n+f.del,0);
    return withFont(overlayFrame(t,"pdk-changes",{hostFrame:true})).size_full().min_h(0).bg(t.canvas).text_color(t.foreground).track_focus(this.handle)
      .on_key_down((e,cx)=>{if(e.key==="escape"){if(this.typing){this.typing=false;this.handle.focus();}else if(!this.busy)closeUtility();cx.stop_propagation();cx.notify();}})
      .child(utilityHeader(t,"changes",this.target,`${countLabel} · +${add} −${del}`,()=>this.refresh(cx),this.busy,this))
      .child(utilityContext(t,this.target,this.root,()=>this.refresh(cx),this.busy||!valid))
      .when(Boolean(this.error)||!valid,el=>el.child(utilityError(t,"changes-error",valid?this.error:"This workspace is no longer available; close and reopen from its menu")))
      .child(div().h(Math.min(this.files.length*ROW.base+SPACE[4],ROW.base*5+SPACE[4])).min_h(ROW.base+SPACE[4]).flex_none().relative().border_b(1).border_color(t.border)
        .child(v_flex().id("changes-list").absolute().inset_0().overflow_y_scroll().p(SPACE[2]).children(this.files.map(f=>
          rowStates(h_flex().id(`change-${f.path}`).h(ROW.base).flex_none().px(SPACE[2]).gap(SPACE[2]).items_center().rounded(RADIUS.md),t,{selected:this.open===f.path,ground:t.canvas,color:t.foreground})
            .on_click((_e,cx)=>this.pick(f.path,cx)).tooltip(f.path)
            .child(div().w(SPACE[4]).text_size(TYPE.xs).text_color(f.status==="A"?t.ansi2:f.status==="D"||f.status==="U"?t.ansi1:t.muted).child(f.status))
            .child(div().flex_1().min_w(0).truncate().text_size(TYPE.base).child(f.path))
            .when(f.add>0,el=>el.child(div().text_size(TYPE.xs).text_color(t.ansi2).child(`+${f.add}`)))
            .when(f.del>0,el=>el.child(div().text_size(TYPE.xs).text_color(t.ansi1).child(`−${f.del}`)))))
          .when(!this.files.length,el=>el.child(div().p(SPACE[2]).text_size(TYPE.sm).text_color(t.muted).child(this.loading?"Loading changes…":this.root?"No uncommitted changes":this.error?"":"No folder"))))
        .child(Scrollbar.vertical("changes-list").absolute().inset_0()))
      .when(this.limited,el=>el.child(div().px(SPACE[3]).text_size(TYPE.xs).text_color(t.dim).child("Showing the first 1,000 changed files")))
      .child(div().flex_1().min_h(0).relative().font_family(monoFont()).text_size(TYPE.sm).line_height(`${SPACE[5]}px`)
        .child(div().id("changes-diff-x").size_full().overflow_x_scrollbar().child(div().w_full().min_w(this.diffWidth).h_full()
          .child(v_virtual_list("changes-diff",this.rows.length,SPACE[5],i=>String(i),range=>this.rows.slice(range.start,range.end).map((row,i)=>this.diffRow(row,t,range.start+i))).size_full())))
        .child(Scrollbar.vertical("changes-diff").viewport_from_layout().absolute().inset_0())
        .when(!this.open&&this.files.length>0,el=>el.child(div().absolute().top(SPACE[2]).px(SPACE[3]).text_size(TYPE.sm).text_color(t.muted).child("Select a file to view its changes"))))
      .when(Boolean(this.note)||conflict,el=>el.child(utilityError(t,"changes-note",this.note||"Resolve merge conflicts before committing all changes")))
      .child(v_flex().h(88).flex_none().p(SPACE[3]).gap(SPACE[2]).border_t(1).border_color(t.border)
        .child(fieldFrame(div().id("commit-message").w_full().h(ROW.base).px(SPACE[3]).flex().items_center().rounded(RADIUS.lg),t,{focused:this.typing,disabled:this.busy})
          .on_mouse_down("left",(_e,cx)=>cx.stop_propagation()).child(Input.new(this.input).h_full().w_full().bg(t.surface).border_0().disabled(this.busy).text_size(TYPE.sm).text_color(t.foreground)))
        .child(h_flex().h(ROW.base).gap(SPACE[2]).items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(TYPE.xs).text_color(t.muted).tooltip("Stages and commits ALL changes in this repository, including untracked files; not only the selected file").child(`${countLabel} · Stages and commits all changes, including untracked files`))
          .child(actionButton(t,"commit",this.busy?"Committing…":"Commit all changes","Stage and commit every changed file in this repository",()=>this.commit(cx),{variant:"primary",disabled:!enabled}))));
  }
}
