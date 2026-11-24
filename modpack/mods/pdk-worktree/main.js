// Clone of Herdr App defaults/mods/worktree/main.js at 2405bf388c568c3ed479f05b8e405ccfa44b3f2c.
// Copyright Herdr contributors, Apache-2.0; see pdk/NOTICE.md and pdk/licenses/Apache-2.0.txt.
// Stock Git/worktree/submodule/remote logic retained. Pdk shared UI, captured target guards and explicit actions.
// Worktree dialog: { space, action: "new" | "open" | "remove" } or
// { folder, machine } for a repo without a space; optional { branch, tab, argv }.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar } from "gpui-base";
import { run, props, closeOverlay, theme, spaces, panes, exec, home, nextCommand } from "herdr";

import { TYPE, SPACE, ROW, RADIUS, overlayFrame, overlayHeader, actionButton, fieldFrame, rowStates, fitLabel, monoFont, statusMarker } from "./lib/ui.js";
const mono = (el) => { const f = monoFont(); return f ? el.font_family(f) : el; };

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s, all = panes()) {
  if (!s) return null;
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return all.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || null;
}

// Checkouts go to <ROOT>/<repo>/<branch, slashes as dashes>.
const ROOT = (home) => `${home}/.herdr/worktrees`;
// Home as ~ (git says C:/Users/x where Windows says C:\Users\x).
const tilde = (path, userHome) => {
  const [p, h] = [path, userHome].map((s) => s.replace(/\\/g, "/"));
  return p.startsWith(h) ? `~${p.slice(h.length)}` : path;
};
const slug = (branch) => branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
const ago = (s) => {
  const d = Date.now() / 1000 - s;
  return d < 3600 ? `${Math.max(1, Math.round(d / 60))}m` : d < 86400 ? `${Math.round(d / 3600)}h` : d < 86400 * 60 ? `${Math.round(d / 86400)}d` : `${Math.round(d / 86400 / 30)}mo`;
};

// Every checkout of a repo (`git worktree list`), the main one first, then
// the most recently committed: { path, branch, main, at }.
async function checkouts(repo, on) {
  const list = await git(repo.main, ["worktree", "list", "--porcelain"], on);
  if (!list.ok) return [];
  const refs = await git(repo.main, ["for-each-ref", "--format=%(refname:short)%09%(committerdate:unix)", "refs/heads"], on);
  const when = new Map(refs.out.split("\n").map((l) => l.split("\t")).map(([b, at]) => [b, Number(at) || 0]));
  const out = [];
  for (const block of list.out.split(/\n\n+/)) {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
    if (!path || lines.some((l) => l === "bare" || l.startsWith("prunable"))) continue;
    const branch = lines.find((l) => l.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? null;
    out.push({ path, branch, main: out.length === 0, at: branch ? (when.get(branch) ?? 0) : 0 });
  }
  return out.sort((a, b) => b.main - a.main || b.at - a.at);
}

// The space showing a checkout: its first terminal is in it (the deepest checkout wins).
function spaceOf(path, all, on, spaceList, paneList) {
  const inside = (p, dir) => p === dir || p.startsWith(dir + "/");
  return spaceList.find((s) => (s.machine ?? null) === (on ?? null) && (() => {
    const at = place(s, paneList)?.replace(/\\/g, "/");
    if (!at || !inside(at, path)) return false;
    return !all.some((c) => c.path !== path && c.path.length > path.length && inside(at, c.path));
  })());
}

async function git(cwd, args, on, timeout) {
  const r = await exec("git", args, { cwd, on, ...(timeout === undefined ? {} : { timeout }) });
  return { ok: r.code === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? r.stdout ?? "").trim() };
}

// The submodule repos git keeps for a checkout (nested ones too, checked out
// or not): { name, dir, pinned }. `config` is the args that read its
// .gitmodules; `pinned` is the commit its parent records ("" if none).
async function modules(gitDir, config, on, out = [], parent = "") {
  const keys = await git(gitDir, ["--git-dir", gitDir, "config", ...config, "-z", "--get-regexp", "^submodule\\..*\\.path$"], on);
  if (!keys.ok) return out; // no .gitmodules, or no submodules in it
  // -z: "key\nvalue" records ended by NUL, so names and paths may hold spaces.
  for (const record of keys.out.split("\0").filter(Boolean)) {
    const at = record.indexOf("\n");
    const name = record.slice("submodule.".length, at - ".path".length);
    const dir = `${gitDir}/modules/${name}`;
    if (!(await git(gitDir, ["--git-dir", dir, "rev-parse", "--git-dir"], on)).ok) continue; // never checked out
    const pinned = await git(gitDir, ["--git-dir", gitDir, "rev-parse", `HEAD:${record.slice(at + 1)}`], on);
    // Names are only unique within their parent: nested ones carry its name.
    out.push({ name: parent + name, dir, pinned: pinned.ok ? pinned.out : "" });
    if ((await git(gitDir, ["--git-dir", dir, "cat-file", "-e", "HEAD:.gitmodules"], on)).ok) await modules(dir, ["--blob", "HEAD:.gitmodules"], on, out, `${parent + name}/`);
  }
  return out;
}

// The worktree's submodules, and the names of those with commits that exist
// nowhere else: not on a remote, and not the commit the parent pins (git
// fetches that by hash, so it is often on no remote branch here).
async function submodules(top, on) {
  const gitDir = await git(top, ["rev-parse", "--absolute-git-dir"], on);
  if (!gitDir.ok) throw new Error(gitDir.err || "git rev-parse failed.");
  const mods = await modules(gitDir.out, ["--file", `${top}/.gitmodules`], on);
  const unpushed = [];
  for (const m of mods) {
    const local = await git(gitDir.out, ["--git-dir", m.dir, "rev-list", "-n1", "--all", "--not", "--remotes", ...(m.pinned ? [m.pinned] : [])], on);
    if (!local.ok) throw new Error(local.err || `Couldn't check submodule ${m.name}.`);
    if (local.out) unpushed.push(m.name);
  }
  return { mods, unpushed };
}

// The repo a folder belongs to: its main checkout and name, and whether
// the folder is itself a linked worktree. null outside git.
async function repoOf(folder, on) {
  const top = await git(folder, ["rev-parse", "--show-toplevel"], on);
  const common = await git(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"], on);
  if (!top.ok || !common.ok) return null;
  const main = common.out.endsWith("/.git") ? common.out.slice(0, -5) : common.out;
  return { top: top.out, main, name: main.split("/").pop(), linked: main !== top.out };
}

export default class Worktree extends View {
  init(_props, cx) {
    this.captured = { space: props()?.space ?? null, machine: Object.prototype.hasOwnProperty.call(props() ?? {}, "machine") ? props().machine ?? null : this.space()?.machine ?? null };
    this.on = this.captured.machine;
    this.userHome = this.on ? null : home();
    this.opening = props()?.action === "open";
    this.text = props()?.branch ?? "";
    this.list = undefined; // open: the checkouts, once read
    this.at = 0;
    this.input = InputState.new({ value: this.text, placeholder: this.opening ? "filter worktrees" : "branch name" });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); this.error = ""; this.at = 0; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.opening ? this.open(this.shown()[this.at]) : this.go(cx));
    this.inputFocused = false;
    this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.inputFocused = false; cx.notify(); });
    if (props()?.action !== "remove") {
      this.input.focus();
      cx.timer.after(600, () => this.input.focus());
    }
    this.busy = false;
    this.error = "";
    this.repo = undefined; // undefined: looking, null: not in git
    this.dirty = false;
    this.unpushed = [];
    this.handle = cx.focus_handle();
    cx.spawn(async (cx) => { for (;;) {
      const c = await nextCommand();
      if (c === "cancel") this.close();
      else if (c === "go") this.opening ? this.open(this.shown()[this.at]) : this.go(cx);
      else if (c.startsWith("text:")) { this.text = c.slice(5); this.input.set_value(this.text); this.at = 0; }
      else if (c.startsWith("key:")) this.key({ key: c.slice(4) }, cx);
      cx.notify();
    } });
    if (props()?.action === "remove") this.handle.focus();
    cx.spawn(async (cx) => {
      try {
        if (this.on) {
          let result;
          try { result = await exec("sh", ["-c", 'printf %s "$HOME"'], { on: this.on }); } catch {}
          if (!result || result.code !== 0 || !result.stdout.trim()) result = await exec("powershell.exe", ["-NoProfile", "-Command", "[Console]::Write($HOME)"], { on: this.on });
          if (result.code !== 0 || !result.stdout.trim()) throw new Error("Could not find the remote home folder.");
          this.userHome = result.stdout.trim().replace(/\\/g, "/");
        }
        if (!this.valid()) throw new Error("Workspace is no longer available on the captured machine.");
        this.folder = props()?.folder || place(this.space()) || this.userHome;
        // The repo is set last: Enter does nothing until the warnings it consents to are known.
        const repo = await repoOf(this.folder, this.on);
        if (repo && props().action === "remove") {
          this.dirty = (await git(repo.top, ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"], this.on)).out !== "";
          this.unpushed = (await submodules(repo.top, this.on)).unpushed;
        }
        if (repo && this.opening) this.list = await checkouts(repo, this.on);
        this.repo = repo;
        cx.notify();
        if (props().branch && !this.opening && props().action !== "remove") await this.work(cx);
      } catch (error) { this.repo = null; this.error = String(error); cx.notify(); }
    });
  }

  space() {
    const p = props() ?? {};
    return spaces().find((s) => s.id === p.space && (!this.captured || (s.machine ?? null) === this.captured.machine)) ?? (!p.space && p.folder ? { folder: p.folder, machine: p.machine ?? null, name: "" } : undefined);
  }

  valid() {
    return !this.captured.space || Boolean(this.space());
  }

  close() {
    closeOverlay(props().overlay);
    if (props().returnCommand) run(props().returnCommand);
  }

  go(cx) {
    if (this.busy || !this.repo || !this.valid() || props().action === "remove" && (!this.repo.linked || !this.captured.space)) return;
    cx.spawn(async (cx) => this.work(cx));
  }

  async work(cx) {
    if (this.busy || !this.repo || !this.valid() || props().action === "remove" && (!this.repo.linked || !this.captured.space)) return;
    this.busy = true;
    this.error = "";
    cx.notify();
    try { this.error = props().action === "remove" ? await this.remove() : await this.create(); }
    catch (error) { this.error = String(error); }
    this.busy = false;
    if (!this.error) this.close();
    cx.notify();
  }

  async create() {
    if (!this.valid()) return "Workspace is no longer available on the captured machine.";
    const branch = this.text.trim();
    if (!branch) return "Type a branch name.";
    const path = `${ROOT(this.userHome)}/${this.repo.name}/${slug(branch)}`;
    const exists = (await git(this.repo.main, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], this.on)).ok;
    const add = exists ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path, "HEAD"];
    const r = await git(this.repo.top, add, this.on, 600_000);
    if (!r.ok) return r.err || "git worktree add failed.";
    if (!this.valid()) return `Worktree created at ${path}; original workspace closed. Open the worktree from its repository.`;
    const p = props();
    // Leave spaces unnamed so they follow the checkout folder and nest under the repo.
    run("space.new", { folder: path, machine: this.on, tab: p.tab, argv: p.argv });
    return "";
  }

  shown() {
    const f = this.text.trim().toLowerCase();
    return (this.list ?? []).filter((c) => !f || `${c.branch ?? ""} ${c.path}`.toLowerCase().includes(f));
  }

  open(c) {
    if (!c || !this.valid()) return;
    this.close();
    const s = spaceOf(c.path, this.list, this.on, spaces(), panes());
    if (s) run("space.select", { id: s.id });
    else run("space.new", { folder: c.path, machine: this.on });
  }

  async remove() {
    const s = this.space();
    if (!this.captured.space) return "Open Remove worktree from its workspace menu.";
    if (!s || !this.valid() || !this.repo.linked || place(s) !== this.folder) return "This linked worktree is no longer available.";
    const current = await repoOf(this.folder, this.on);
    if (!current || !current.linked || current.top !== this.repo.top || current.main !== this.repo.main) return "Checkout changed. Open its menu again.";
    const status = await git(this.repo.top, ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"], this.on);
    if (!status.ok) return status.err || "git status failed.";
    // git refuses a worktree with submodules unless forced, because their
    // history goes with it. The popup already showed what's at risk; only
    // risk that appeared since it opened gets one more warning.
    const { mods, unpushed } = await submodules(this.repo.top, this.on);
    const changed = (status.out && !this.dirty) || unpushed.some((name) => !this.unpushed.includes(name));
    this.dirty ||= status.out !== "";
    this.unpushed = [...new Set([...this.unpushed, ...unpushed])];
    if (changed) return "It changed since this opened. Enter again removes it anyway.";
    // Terminals first: a shell sitting in the folder keeps it busy on Windows.
    if (!this.valid() || place(this.space()) !== this.folder) return "Workspace changed while checking the worktree.";
    run("space.close", { id: s.id, confirmed: true });
    const force = this.dirty || mods.length > 0;
    const r = await git(this.repo.main, ["worktree", "remove", ...(force ? ["--force"] : []), this.repo.top], this.on, 600_000);
    return r.ok ? "" : r.err || "git worktree remove failed.";
  }

  key(e, cx) {
    if (e.key === "escape") return this.close();
    if (this.opening) {
      const n = this.shown().length;
      if (e.key === "enter") this.open(this.shown()[this.at]);
      else if ((e.key === "down" || e.key === "up") && n) this.at = (this.at + (e.key === "down" ? 1 : n - 1)) % n;
      else return;
      cx.stop_propagation();
      return cx.notify();
    }
    if (e.key === "enter" && props()?.action === "remove") return this.go(cx);
  }

  field(t, search = false) {
    return fieldFrame(Input.new(this.input), t, { focused: this.inputFocused, disabled: this.busy }).disabled(this.busy)
      .h(search ? SPACE[8] + SPACE[1] : ROW.base).px(search ? SPACE[3] : SPACE[2]).items_center().rounded(search ? RADIUS.lg : RADIUS.md).text_size(TYPE.base);
  }

  renderOpen(t) {
    const rows = this.shown(), all = this.list ?? [], r = this.repo;
    const row = (c, i) => {
      const there = spaceOf(c.path, all, this.on, spaces(), panes());
      const label = c.branch ?? "detached";
      return rowStates(v_flex(), t, { selected: this.at === i, ground: t.popover, color: t.foreground }).id(`wt-${i}`)
        .h(ROW.two).px(SPACE[3]).gap(SPACE[1]).justify_center().rounded(RADIUS.md).flex_none()
        .role("list_box_option").aria_selected(this.at === i).accessibility_label(`${label}, ${c.path}${c.main ? ", main checkout" : ""}${there ? ", open" : ""}`).tooltip(c.path)
        .on_click(() => this.open(c))
        .child(h_flex().min_w(0).h(SPACE[4]).line_height(`${SPACE[4]}px`).flex_none().gap(SPACE[2]).items_center()
          .child(fitLabel(`wt-name-${i}`, label).flex_1().text_size(TYPE.base).font_medium())
          .when(c.main || there, (el) => el.child(div().h(SPACE[4]).px(SPACE[1]).flex_none().rounded(RADIUS.sm).bg(t.raised).text_size(TYPE.xs).text_color(t.muted).child(c.main ? "main checkout" : "current")))
          .when(!there && c.at > 0, (el) => el.child(mono(div()).text_size(TYPE.xs).text_color(t.dim).child(ago(c.at)))))
        .child(mono(fitLabel(`wt-path-${i}`, tilde(c.path, this.userHome ?? ""))).h(SPACE[3]).line_height(`${SPACE[3]}px`).flex_none().text_size(TYPE.xs).text_color(t.dim));
    };
    return overlayFrame(t, "pdk-worktree-open", { hostFrame: true }).size_full().track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .child(overlayHeader(t, "worktree-header", `Open worktree${r ? ` of ${r.name}` : ""}`, { trailing: div().text_size(TYPE.xs).text_color(t.dim).child(`${rows.length}/${all.length}`) }))
      .child(v_flex().flex_1().min_h(0).p(SPACE[3]).gap(SPACE[2])
        .child(mono(fitLabel("worktree-context", `${this.on ?? "This computer"} · ${this.folder ?? "Looking for repository…"}`)).text_size(TYPE.xs).text_color(t.dim))
        .when(r === undefined || r && this.list === undefined, (el) => el.child(div().text_size(TYPE.sm).text_color(t.muted).child("Reading worktrees…")))
        .when(r === null, (el) => el.child(div().text_size(TYPE.sm).text_color(t.muted).child(`${this.folder ?? "This folder"} is not in a Git repository.`)))
        .when(Boolean(r && this.list), (el) => el.child(this.field(t, true))
          .child(v_flex().id("wt-list").role("list_box").flex_1().min_h(0).gap(SPACE[1]).overflow_y_scrollbar().children(rows.map(row))
            .when(!rows.length, (el) => el.child(div().h(ROW.base).text_size(TYPE.sm).text_color(t.dim).child("No matching worktrees.")))))
        .when(Boolean(this.error), (el) => el.child(fitLabel("worktree-error", this.error).text_size(TYPE.sm).text_color(t.blocked))))
      .child(h_flex().h(ROW.two).px(SPACE[3]).gap(SPACE[2]).items_center().border_t(1).border_color(t.border)
        .child(div().flex_1().text_size(TYPE.xs).text_color(t.dim).child("↑↓ choose · Enter open · Esc close"))
        .child(actionButton(t, "worktree-cancel", "Cancel", "Close worktree list", () => this.close()))
        .child(actionButton(t, "worktree-open", "Open", "Open selected worktree", () => this.open(rows[this.at]), { variant: "primary", disabled: !this.valid() || !rows[this.at] })));
  }

  render() {
    const t = theme();
    if (this.opening) return this.renderOpen(t);
    const remove = props()?.action === "remove", s = this.space(), r = this.repo;
    const title = remove ? `Remove worktree ${props().capturedName ?? s?.name ?? ""}?` : `New worktree${r ? ` of ${r.name}` : ""}`;
    const detail = r === undefined ? "Reading repository…" : r === null ? `${this.folder ?? "This folder"} is not in a Git repository.`
      : remove ? !this.captured.space ? "Open Remove worktree from its workspace menu." : !r.linked ? "This is the repository's main checkout, not a worktree."
        : `Closes ${props().capturedName ?? s?.name ?? "this workspace"} and deletes the checkout below. The branch stays.`
        : `Creates a workspace in ${tilde(ROOT(this.userHome), this.userHome)}/${r.name}/. Existing branches are checked out; a new branch starts here.`;
    const blocked = !r || !this.valid() || remove && (!r.linked || !this.captured.space);
    return overlayFrame(t, "pdk-worktree", { hostFrame: true }).size_full().track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .child(overlayHeader(t, "worktree-header", title))
      .child(v_flex().flex_1().min_h(0).p(SPACE[3]).gap(SPACE[2]).overflow_y_scrollbar()
        .child(div().text_size(TYPE.sm).text_color(t.muted).child(!this.valid() ? "Workspace is no longer available on the captured machine." : detail))
        .child(mono(fitLabel("worktree-path", `${this.on ?? "This computer"} · ${r?.top ?? this.folder ?? ""}`)).text_size(TYPE.xs).text_color(t.dim))
        .when(remove && this.dirty, (el) => el.child(div().text_size(TYPE.sm).text_color(t.blocked).child("Uncommitted changes will be lost.")))
        .when(remove && this.unpushed.length > 0, (el) => el.child(div().text_size(TYPE.sm).text_color(t.blocked).child(`Submodule ${this.unpushed.join(", ")} has unpushed commits that will be lost.`)))
        .when(!remove && !blocked, (el) => el.child(this.field(t)))
        .when(Boolean(this.error), (el) => el.child(fitLabel("worktree-error", this.error).text_size(TYPE.sm).text_color(t.blocked))))
      .child(h_flex().h(ROW.two).px(SPACE[3]).gap(SPACE[2]).items_center().justify_end().border_t(1).border_color(t.border)
        .when(this.busy, (el) => el.child(statusMarker(t, "working", "worktree-busy")).child(div().text_size(TYPE.sm).text_color(t.muted).child("Working…")))
        .child(actionButton(t, "worktree-cancel", "Cancel", "Cancel worktree action", () => this.close()))
        .child(actionButton(t, "worktree-go", remove ? "Remove worktree" : "Create worktree", remove ? title : "Create worktree and workspace", (_e, cx) => this.go(cx), { variant: "primary", disabled: blocked || this.busy })));
  }
}
