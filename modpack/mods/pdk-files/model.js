// Directory tree, bounds and lazy expansion cloned from herdr-app@2405bf3 defaults/mods/files/main.js.
// Apache-2.0; see NOTICE.md and licenses/Apache-2.0.txt. Changes: pinned machine, multi-select of files and folders,
// a parent step and keyboard window. Selections are absolute paths, so they survive a step up.
import { boundedAttachments } from "./lib/composer.js";
export const PER_FOLDER = 500, TOTAL = 5000, SHOWN = 12;
export const LIST_SCRIPT = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
export const absolute = (root, relative) => `${root.replace(/\/$/, "")}/${relative}`;
export function parseDirectory(stdout) {
  const fields = String(stdout).split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length && out.length <= PER_FOLDER; i += 2) {
    const name = fields[i + 1];
    if (!name || name === "." || name === ".." || name === ".git" || name.includes("/") || /[\x00-\x1f\x7f]/.test(name)) continue;
    out.push({ name, dir: fields[i] === "d" });
  }
  return out;
}
export class FileTree {
  constructor(root, on = null) { this.root = root; this.on = on; this.entries = new Map(); this.folders = new Set(); this.selected = new Set(); this.at = 0; this.top = 0; this.limited = false; }
  loaded(path, entries) {
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a,b) => Number(b.dir)-Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }
  rows(prefix = "", depth = 0, out = []) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      out.push({ ...entry, path, depth, open: this.folders.has(path) });
      if (entry.dir && this.folders.has(path)) this.rows(path, depth+1, out);
    }
    return out;
  }
  fold(path) {
    if (!this.rows().some(r => r.path === path && r.dir)) return false;
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path+"/")) { this.folders.delete(folder); this.entries.delete(folder); }
      return false;
    }
    this.folders.add(path); return true;
  }
  ticked(path) { return this.selected.has(absolute(this.root, path)); }
  pick(path) {
    if (!this.rows().some(r => r.path === path)) return false;
    const full = absolute(this.root, path);
    if (this.selected.has(full)) { this.selected.delete(full); return true; }
    if (!boundedAttachments([...this.selected, full])) return false;
    this.selected.add(full); return true;
  }
  paths() { return boundedAttachments([...this.selected]); }
  // One level up, to the root at most; the listing starts over there.
  up() {
    if (this.root === "/") return false;
    this.root = this.root.replace(/\/+$/, "").replace(/\/[^/]*$/, "") || "/";
    this.entries.clear(); this.folders.clear(); this.at = 0; this.top = 0; this.limited = false;
    return true;
  }
  move(key) {
    const rows = this.rows();
    if (key === "home") this.at = 0;
    else if (key === "end") this.at = Math.max(0, rows.length-1);
    else this.at = Math.max(0, Math.min(rows.length-1, this.at + (key === "up" ? -1 : 1)));
    if (this.at < this.top) this.top = this.at;
    if (this.at >= this.top+SHOWN) this.top = this.at-SHOWN+1;
  }
}
