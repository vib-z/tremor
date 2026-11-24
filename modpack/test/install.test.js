// install.sh and uninstall.sh (M7), in scratch homes under /tmp/pdk-i<pid>. The live profile is only ever
// the target of a refusal: these tests never enumerate it or read/write its files.
import { test, expect, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, appendFileSync, readdirSync, lstatSync, readlinkSync, chmodSync } from "node:fs";

const PACK = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const ROOT = `/tmp/pdk-i${process.pid}`;
const REAL_HOME = Bun.spawnSync(["/bin/sh", "-c", 'eval echo "~$(id -un)"']).stdout.toString().trim();
const LIVE = `${REAL_HOME}/.config/herdr-app`;
mkdirSync(ROOT, { recursive: true });
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const sh = (script, home, env = {}) => {
  const r = Bun.spawnSync(["/bin/sh", `${PACK}/${script}`, ...[home].flat()], { env: { HOME: REAL_HOME, PATH: "/usr/bin:/bin:/usr/sbin", ...env } });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
};
const fresh = (name) => { const h = `${ROOT}/${name}/home`; mkdirSync(h, { recursive: true }); return h; };

test("installs the pack's own files only, and twice is the same as once", () => {
  const h = fresh("a");
  writeFileSync(`${h}/settings.json`, '{"zoom":1}');
  expect(sh("install.sh", h).code).toBe(0);
  for (const f of ["layouts/tremor.json", "themes/pdk-t3-dark.json", "themes/pdk-t3-light.json", "themes/pdk-moshi.json", "pdk/themes/pdk-moshi.json", "themes/pdk-t3-navy.json", "themes/pdk-moshi-amber.json", "pdk/themes/pdk-t3-blue-light.json",
    "mods/pdk-tree/main.js", "mods/pdk-chat/lib/chat.js", "mods/pdk-usage/main.js", "mods/pdk-usage/lib/tokens.js", "pdk/helper/pdk-helper.py", "pdk/helper/pdk-chat.py", "pdk/icons/factory.svg", "pdk/icons/tremor-preview.svg"]) expect(existsSync(`${h}/${f}`)).toBe(true);
  expect(existsSync(`${h}/mods/pdk-tokens`)).toBe(false); // the Colours editor is retired (spec section 5)
  // Herdr's add dialog as tremor's mod (owner, 11 Nov): stock.js is Herdr's file, main.js the two changes.
  for (const f of ["main.js", "stock.js", "mod.json", "lib/ui.js"]) expect(existsSync(`${h}/mods/pdk-machine-add/${f}`)).toBe(true);
  expect(readdirSync(`${h}/pdk/icons`).sort()).toEqual(["agents", "agents-colour", "bot.svg", "caret-down.svg", "caret-right.svg", "check.svg", "chevrons-up-down.svg", "columns-2.svg", "factory.svg", "git-branch.svg", "layout-grid.svg", "layout-list.svg", "list-tree.svg", "maximize-2.svg", "message-square.svg", "minimize-2.svg", "minus.svg", "monitor.svg", "orbit.svg", "panel-left.svg", "plus.svg", "rows-2.svg", "search.svg", "server.svg", "settings.svg", "square-slash.svg", "square-terminal.svg", "tremor-preview.svg", "working-dense.svg", "working-still.svg", "working.svg", "x.svg"]);
  expect(readdirSync(`${h}/pdk/icons/agents`).sort()).toEqual(readdirSync(`${PACK}/icons/agents`).sort());
  expect(readdirSync(`${h}/pdk/icons/agents-colour`).sort()).toEqual(readdirSync(`${PACK}/icons/agents-colour`).sort());
  const manifest = readFileSync(`${h}/.pdk-backup/manifest.sums`, "utf8");
  expect(sh("install.sh", h).code).toBe(0);
  expect(readFileSync(`${h}/.pdk-backup/manifest.sums`, "utf8")).toBe(manifest);
  expect(readFileSync(`${h}/settings.json`, "utf8")).toBe('{"zoom":1}');
}, 60000);

test("uninstall removes exactly what was installed; twice is a no-op", () => {
  const h = fresh("b");
  writeFileSync(`${h}/keys.json`, "{}");
  sh("install.sh", h);
  const r = sh("uninstall.sh", h);
  expect(r.code).toBe(0);
  expect(existsSync(`${h}/layouts/tremor.json`)).toBe(false);
  expect(existsSync(`${h}/mods/pdk-tree`)).toBe(false);
  expect(existsSync(`${h}/.pdk-backup`)).toBe(false);
  expect(readFileSync(`${h}/keys.json`, "utf8")).toBe("{}");
  const again = sh("uninstall.sh", h);
  expect(again.code).toBe(0);
  expect(again.out).toMatch(/Nothing to uninstall/);
}, 60000);

test("R6: uninstall removes the preview cache's incoming folder too, leftovers included, never through a link", () => {
  const h = fresh("r6");
  sh("install.sh", h);
  mkdirSync(`${h}/pdk-cache/media`, { recursive: true });
  mkdirSync(`${h}/pdk-cache/incoming`, { recursive: true });
  writeFileSync(`${h}/pdk-cache/media/a.png`, "x");
  writeFileSync(`${h}/pdk-cache/incoming/left-by-a-failed-call.b64`, "eA==");
  expect(sh("uninstall.sh", h).code).toBe(0);
  expect(existsSync(`${h}/pdk-cache`)).toBe(false);
  // An incoming folder that is a link: refused, and what it points at stays.
  const g = fresh("r6l");
  sh("install.sh", g);
  mkdirSync(`${g}-outside`, { recursive: true });
  writeFileSync(`${g}-outside/keep.txt`, "mine");
  mkdirSync(`${g}/pdk-cache`, { recursive: true });
  symlinkSync(`${g}-outside`, `${g}/pdk-cache/incoming`);
  expect(sh("uninstall.sh", g).code).not.toBe(0);
  expect(readFileSync(`${g}-outside/keep.txt`, "utf8")).toBe("mine");
}, 60000);

test("the backup restores a file the install overwrote", () => {
  const h = fresh("c");
  mkdirSync(`${h}/layouts`, { recursive: true });
  writeFileSync(`${h}/layouts/tremor.json`, '{"mine":true}');
  sh("install.sh", h);
  expect(readFileSync(`${h}/layouts/tremor.json`, "utf8")).not.toBe('{"mine":true}');
  sh("install.sh", h); // a second install must not take the pack's own file as the baseline
  expect(sh("uninstall.sh", h).code).toBe(0);
  expect(readFileSync(`${h}/layouts/tremor.json`, "utf8")).toBe('{"mine":true}');
}, 60000);

test("a pack file changed since install: uninstall and reinstall refuse and change nothing", () => {
  const h = fresh("d");
  sh("install.sh", h);
  appendFileSync(`${h}/mods/pdk-tree/main.js`, "\n// my edit\n");
  const u = sh("uninstall.sh", h);
  expect(u.code).toBe(1);
  expect(u.out).toMatch(/mods\/pdk-tree\/main.js/);
  expect(existsSync(`${h}/layouts/tremor.json`)).toBe(true);
  expect(sh("install.sh", h).code).toBe(1);
  expect(readFileSync(`${h}/mods/pdk-tree/main.js`, "utf8")).toContain("// my edit");
}, 60000);

test("a theme the Colours editor changed: reinstall keeps it, uninstall saves it in pdk-state and removes the pack", () => {
  const h = fresh("g");
  sh("install.sh", h);
  const theme = JSON.parse(readFileSync(`${h}/themes/pdk-moshi.json`, "utf8"));
  expect(theme.colors.accent).not.toBe("#ff8800");
  theme.colors.accent = "#ff8800";
  const edited = JSON.stringify(theme, null, 2) + "\n";
  writeFileSync(`${h}/themes/pdk-moshi.json`, edited);
  const again = sh("install.sh", h);
  expect(again.code).toBe(0);
  expect(again.out).toMatch(/Kept your Colours edits in: themes\/pdk-moshi.json/);
  expect(readFileSync(`${h}/themes/pdk-moshi.json`, "utf8")).toBe(edited);
  // The pack's own copy, for the editor's reset, is the pack's.
  expect(readFileSync(`${h}/pdk/themes/pdk-moshi.json`, "utf8")).toBe(readFileSync(`${PACK}/themes/pdk-moshi.json`, "utf8"));
  const u = sh("uninstall.sh", h);
  expect(u.code).toBe(0);
  expect(u.out).toMatch(/Saved your Colours edits/);
  expect(existsSync(`${h}/themes/pdk-moshi.json`)).toBe(false);
  expect(existsSync(`${h}/themes/pdk-t3-dark.json`)).toBe(false);
  expect(existsSync(`${h}/mods/pdk-tokens`)).toBe(false);
  expect(existsSync(`${h}/pdk`)).toBe(false);
  expect(readFileSync(`${h}/pdk-state/themes/pdk-moshi.json`, "utf8")).toBe(edited);
  expect(sh("uninstall.sh", h).code).toBe(0);
}, 60000);

// Review F7: a symlink below the target could lead anywhere. These links lead into another scratch folder,
// a stand-in for a profile the pack must not touch; the live profile is never a link target here.
test("a symlink anywhere below the target is refused before any read or write, by install and uninstall", () => {
  const away = `${ROOT}/away`;
  mkdirSync(`${away}/layouts`, { recursive: true });
  writeFileSync(`${away}/layouts/tremor.json`, '{"away":1}');
  mkdirSync(`${away}/bk`, { recursive: true });
  writeFileSync(`${away}/theme.json`, '{"away":2}');
  const snapshot = () => JSON.stringify([readdirSync(away).sort(), readFileSync(`${away}/layouts/tremor.json`, "utf8"), readdirSync(`${away}/bk`), readFileSync(`${away}/theme.json`, "utf8")]);
  const before = snapshot();
  const cases = {
    dir: (h) => symlinkSync(`${away}/layouts`, `${h}/layouts`),
    backup: (h) => symlinkSync(`${away}/bk`, `${h}/.pdk-backup`),
    leaf: (h) => { mkdirSync(`${h}/themes`, { recursive: true }); symlinkSync(`${away}/theme.json`, `${h}/themes/pdk-moshi.json`); },
    deep: (h) => { mkdirSync(`${h}/mods/pdk-tree`, { recursive: true }); symlinkSync(`${away}/bk`, `${h}/mods/pdk-tree/lib`); },
  };
  for (const [name, plant] of Object.entries(cases)) {
    const h = fresh(`link-${name}`);
    plant(h);
    const r = sh("install.sh", h);
    expect(r.code, name).toBe(1);
    expect(r.out, name).toMatch(/symbolic link/);
    expect(existsSync(`${h}/mods/pdk-chat`), name).toBe(false);
  }
  // Installed first, then a folder swapped for a link: uninstall refuses and removes or restores nothing.
  const h = fresh("link-after");
  writeFileSync(`${h}/keys.json`, "{}");
  expect(sh("install.sh", h).code).toBe(0);
  rmSync(`${h}/layouts`, { recursive: true });
  symlinkSync(`${away}/layouts`, `${h}/layouts`);
  const u = sh("uninstall.sh", h);
  expect(u.code).toBe(1);
  expect(u.out).toMatch(/symbolic link/);
  expect(existsSync(`${h}/mods/pdk-tree/main.js`)).toBe(true);
  expect(snapshot()).toBe(before);
}, 60000);

// Review F8: uninstall touches only folders its manifest owns.
test("uninstall leaves another mods/pdk-* folder alone, generated-looking files and empty folders included", () => {
  const h = fresh("owned");
  mkdirSync(`${h}/mods/pdk-other`, { recursive: true });
  writeFileSync(`${h}/mods/pdk-other/gpui-kit.d.ts`, "// someone's");
  writeFileSync(`${h}/mods/pdk-other/jsconfig.json`, "{}");
  mkdirSync(`${h}/mods/pdk-empty`, { recursive: true });
  expect(sh("install.sh", h).code).toBe(0);
  // The app writes these into every mod it loads; uninstall takes them from the pack's own folders.
  writeFileSync(`${h}/mods/pdk-tree/gpui-kit.d.ts`, "// generated");
  writeFileSync(`${h}/mods/pdk-tree/jsconfig.json`, "{}");
  expect(sh("uninstall.sh", h).code).toBe(0);
  expect(readFileSync(`${h}/mods/pdk-other/gpui-kit.d.ts`, "utf8")).toBe("// someone's");
  expect(existsSync(`${h}/mods/pdk-other/jsconfig.json`)).toBe(true);
  expect(existsSync(`${h}/mods/pdk-empty`)).toBe(true);
  expect(existsSync(`${h}/mods/pdk-tree`)).toBe(false);
}, 60000);

// Review G4: uninstall saves an edited theme with cp, which would write through a link at the saved file itself.
test("a symlink at the saved theme's own file is refused before anything is saved or removed", () => {
  const away = `${ROOT}/away-g4`;
  mkdirSync(away, { recursive: true });
  writeFileSync(`${away}/sentinel.json`, "untouched");
  const h = fresh("g4");
  sh("install.sh", h);
  const theme = JSON.parse(readFileSync(`${h}/themes/pdk-moshi.json`, "utf8"));
  expect(theme.colors.accent).not.toBe("#ff8800");
  theme.colors.accent = "#ff8800";
  const edited = JSON.stringify(theme, null, 2) + "\n";
  writeFileSync(`${h}/themes/pdk-moshi.json`, edited);
  mkdirSync(`${h}/pdk-state/themes`, { recursive: true });
  symlinkSync(`${away}/sentinel.json`, `${h}/pdk-state/themes/pdk-moshi.json`);
  const u = sh("uninstall.sh", h);
  expect(u.code).toBe(1);
  expect(u.out).toMatch(/symbolic link/);
  expect(readFileSync(`${away}/sentinel.json`, "utf8")).toBe("untouched");
  expect(readFileSync(`${h}/themes/pdk-moshi.json`, "utf8")).toBe(edited);
  expect(existsSync(`${h}/mods/pdk-tree/main.js`)).toBe(true);
}, 60000);

// Review G5: uninstall removes the chat's media cache, and only that: settled workspaces and saved edits stay.
test("uninstall removes pdk-cache/media and keeps pdk-state; a linked cache is refused", () => {
  const h = fresh("g5");
  sh("install.sh", h);
  mkdirSync(`${h}/pdk-cache/media/ab`, { recursive: true });
  writeFileSync(`${h}/pdk-cache/media/ab/thumb.png`, "png");
  mkdirSync(`${h}/pdk-state/themes`, { recursive: true });
  writeFileSync(`${h}/pdk-state/settled.json`, "[]");
  writeFileSync(`${h}/pdk-state/themes/pdk-t3-dark.json`, "{}");
  expect(sh("uninstall.sh", h).code).toBe(0);
  expect(existsSync(`${h}/pdk-cache`)).toBe(false);
  expect(readFileSync(`${h}/pdk-state/settled.json`, "utf8")).toBe("[]");
  expect(readFileSync(`${h}/pdk-state/themes/pdk-t3-dark.json`, "utf8")).toBe("{}");

  const away = `${ROOT}/away-g5`;
  mkdirSync(`${away}/media`, { recursive: true });
  writeFileSync(`${away}/media/keep.png`, "sentinel");
  const l = fresh("g5-link");
  sh("install.sh", l);
  symlinkSync(away, `${l}/pdk-cache`);
  const u = sh("uninstall.sh", l);
  expect(u.code).toBe(1);
  expect(u.out).toMatch(/symbolic link/);
  expect(readFileSync(`${away}/media/keep.png`, "utf8")).toBe("sentinel");
}, 60000);

test("an interrupted install is cleaned up by uninstall, and a later install completes", () => {
  const h = fresh("e");
  mkdirSync(`${h}/themes`, { recursive: true });
  writeFileSync(`${h}/themes/pdk-t3-dark.json`, '{"old":1}');
  const r = sh("install.sh", h, { PDK_INSTALL_STOP_AFTER: "20" });
  expect(r.code).toBe(3);
  expect(existsSync(`${h}/.pdk-backup/pending.sums`)).toBe(true);
  expect(sh("uninstall.sh", h).code).toBe(0);
  expect(readFileSync(`${h}/themes/pdk-t3-dark.json`, "utf8")).toBe('{"old":1}');
  expect(existsSync(`${h}/mods`) ? readdirSync(`${h}/mods`).filter((m) => m.startsWith("pdk-")) : []).toEqual([]);
  expect(sh("install.sh", h, { PDK_INSTALL_STOP_AFTER: "5" }).code).toBe(3);
  expect(sh("install.sh", h).code).toBe(0);
  expect(sh("uninstall.sh", h).code).toBe(0);
  expect(readFileSync(`${h}/themes/pdk-t3-dark.json`, "utf8")).toBe('{"old":1}');
}, 60000);

test("the live profile, anything inside it, anything holding it, and any alias to it are refused, untouched", () => {
  symlinkSync(LIVE, `${ROOT}/alias`);
  mkdirSync(`${ROOT}/via`, { recursive: true });
  symlinkSync(`${REAL_HOME}/.config`, `${ROOT}/via/cfg`);
  for (const target of [LIVE, `${LIVE}/`, `${LIVE}/sub/dir`, `${REAL_HOME}/.config`, `${ROOT}/alias`, `${ROOT}/via/cfg/herdr-app`, `${ROOT}/alias/mods`]) {
    for (const script of ["install.sh", "uninstall.sh"]) {
      const r = sh(script, target);
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/live Herdr profile/);
    }
  }
  // A changed HOME does not hide the real profile.
  const r = sh("install.sh", LIVE, { HOME: `${ROOT}/fakehome` });
  expect(r.code).toBe(1);
}, 60000);

test("--live: only the live profile itself, and only with the flag; inside it, holding it, or another home stays refused", () => {
  for (const script of ["install.sh", "uninstall.sh"]) {
    // Without the flag the live profile is refused (above); with it, any other home is refused.
    const other = fresh(`live-other-${script}`);
    const r = sh(script, ["--live", other]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/--live is only for the live Herdr profile itself/);
    for (const target of [`${LIVE}/sub/dir`, `${REAL_HOME}/.config`]) {
      const s = sh(script, ["--live", target]);
      expect(s.code).toBe(1);
      expect(s.out).toMatch(/live Herdr profile/);
    }
  }
  // The accept path, without touching the real profile: $HOME/.config/herdr-app is a live profile too, so a sandbox
  // HOME gives a live profile of its own. Install and uninstall with --live go through; without it, refused.
  const home = `${ROOT}/livehome`, prof = `${home}/.config/herdr-app`;
  mkdirSync(prof, { recursive: true });
  writeFileSync(`${prof}/settings.json`, '{"zoom":1}');
  expect(sh("install.sh", prof, { HOME: home }).out).toMatch(/live Herdr profile/);
  const inst = sh("install.sh", ["--live", prof], { HOME: home });
  expect(inst.code, inst.out).toBe(0);
  expect(readFileSync(`${prof}/layouts/tremor.json`, "utf8")).toContain("pdk");
  const un = sh("uninstall.sh", ["--live", prof], { HOME: home });
  expect(un.code, un.out).toBe(0);
  expect(readFileSync(`${prof}/settings.json`, "utf8")).toBe('{"zoom":1}');
}, 120000);

test("a home whose window socket accepts a connection is refused, answering or not", async () => {
  const h = fresh("f");
  const server = Bun.listen({ unix: `${h}/herdr-app.sock`, socket: { data() {} } });
  try {
    for (const script of ["install.sh", "uninstall.sh"]) {
      const r = sh(script, h);
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/window is running/);
    }
  } finally {
    server.stop(true);
  }
  expect(sh("install.sh", h).code).toBe(0);
}, 60000);

// The pack's Cmd+K (search-palette brief): merged into keys.json as one block for `layout:tremor`, and taken out again
// byte for byte. The app reads keys.json as the whole key set (herdr-app@2405bf3 src/keys.rs:166-182).
const DEFAULT_KEYS = readFileSync(`${PACK}/keys.herdr-0.1.14.macos.json`, "utf8");
const OURS = { "cmd-k": "mod.open:pdk-search", "cmd-p": "mod.open:pdk-search" };

test("keys: an absent keys.json is created from Herdr's defaults plus Cmd+K, and uninstall leaves it absent", () => {
  const h = fresh("k1");
  const r = sh("install.sh", h);
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/added Cmd\+K and Cmd\+P .*makes the whole file yours/);
  const made = JSON.parse(readFileSync(`${h}/keys.json`, "utf8"));
  expect(made).toEqual({ ...JSON.parse(DEFAULT_KEYS), "layout:tremor": OURS });
  // Herdr's own Cmd+P and Cmd+Shift+P stay; nothing in global or terminal is Cmd+K.
  expect(made.global["cmd-p"]).toBe("mod.open:picker");
  expect(made.global["cmd-k"] ?? made.terminal["cmd-k"]).toBe(undefined);
  expect(sh("uninstall.sh", h).code).toBe(0);
  expect(existsSync(`${h}/keys.json`)).toBe(false);
}, 60000);

test("keys: an existing file is backed up, merged once however often install runs, and restored byte for byte", () => {
  const h = fresh("k2");
  writeFileSync(`${h}/keys.json`, DEFAULT_KEYS);
  expect(sh("install.sh", h).code).toBe(0);
  const merged = readFileSync(`${h}/keys.json`, "utf8");
  expect(JSON.parse(merged)["layout:tremor"]).toEqual(OURS);
  expect(merged.startsWith(DEFAULT_KEYS.slice(0, DEFAULT_KEYS.lastIndexOf("}") - 3))).toBe(true);
  expect(readFileSync(`${h}/.pdk-backup/keys/original`, "utf8")).toBe(DEFAULT_KEYS);
  const again = sh("install.sh", h);
  expect(again.out).toMatch(/already there/);
  expect(readFileSync(`${h}/keys.json`, "utf8")).toBe(merged);
  expect(sh("uninstall.sh", h).code).toBe(0);
  expect(readFileSync(`${h}/keys.json`, "utf8")).toBe(DEFAULT_KEYS);
}, 60000);

test("keys: the person's own edits after install survive uninstall; only the pack's block goes", () => {
  const h = fresh("k3");
  writeFileSync(`${h}/keys.json`, '{\n  "global": { "cmd-t": "tab.new" }\n}\n');
  sh("install.sh", h);
  const text = readFileSync(`${h}/keys.json`, "utf8");
  writeFileSync(`${h}/keys.json`, text.replace('"cmd-t": "tab.new"', '"cmd-t": "tab.new", "cmd-y": "pane.zoom"'));
  expect(sh("uninstall.sh", h).code).toBe(0);
  expect(readFileSync(`${h}/keys.json`, "utf8")).toBe('{\n  "global": { "cmd-t": "tab.new", "cmd-y": "pane.zoom" }\n}\n');
}, 60000);

test("keys: a Cmd+K the person already uses is reported and kept; the file is not touched", () => {
  for (const [name, text, where] of [
    ["k4", '{"global": {"cmd-k": "app.palette"}}', "global"],
    ["k5", '{"terminal": {"cmd-k": "send:\\u000c"}}', "terminal"],
    ["k6", '{"layout:tremor": {"cmd-k": "tab.new"}}', "layout:tremor"],
  ]) {
    const h = fresh(name);
    writeFileSync(`${h}/keys.json`, text);
    const r = sh("install.sh", h);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`cmd-k is already bound in "${where}"`);
    const got = JSON.parse(readFileSync(`${h}/keys.json`, "utf8"));
    expect(got[where]["cmd-k"]).toBe(JSON.parse(text)[where]["cmd-k"]);
    if (where !== "layout:tremor") expect(got["layout:tremor"]).toEqual({ "cmd-p": "mod.open:pdk-search" });
    expect(sh("uninstall.sh", h).code).toBe(0);
    expect(readFileSync(`${h}/keys.json`, "utf8")).toBe(text);
  }
  // Their own layout:tremor section without Cmd+K: reported, not rewritten.
  const h = fresh("k7");
  writeFileSync(`${h}/keys.json`, '{"layout:tremor": {"cmd-j": "tab.new"}}');
  expect(sh("install.sh", h).out).toMatch(/has its own "layout:tremor" section/);
  expect(readFileSync(`${h}/keys.json`, "utf8")).toBe('{"layout:tremor": {"cmd-j": "tab.new"}}');
  // An empty object and a file that isn't JSON.
  const e = fresh("k8");
  writeFileSync(`${e}/keys.json`, "{}");
  sh("install.sh", e);
  expect(JSON.parse(readFileSync(`${e}/keys.json`, "utf8"))).toEqual({ "layout:tremor": OURS });
  sh("uninstall.sh", e);
  expect(readFileSync(`${e}/keys.json`, "utf8")).toBe("{}");
  const bad = fresh("k9");
  writeFileSync(`${bad}/keys.json`, "{ not json");
  const r = sh("install.sh", bad);
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/not a JSON object, left as it is/);
  expect(readFileSync(`${bad}/keys.json`, "utf8")).toBe("{ not json");
}, 120000); // ten install and uninstall runs of about 6 s each: 60 s timed out under a loaded machine (final fix round)

test("keys: the pack's block edited by hand stops uninstall before anything is removed", () => {
  const h = fresh("k10");
  writeFileSync(`${h}/keys.json`, DEFAULT_KEYS);
  sh("install.sh", h);
  const text = readFileSync(`${h}/keys.json`, "utf8");
  writeFileSync(`${h}/keys.json`, text.replace('"cmd-k": "mod.open:pdk-search"', '"cmd-k": "mod.open:pdk-search", "cmd-j": "tab.new"'));
  const r = sh("uninstall.sh", h);
  expect(r.code).toBe(1);
  expect(r.out).toMatch(/block was edited since install, nothing removed/);
  expect(existsSync(`${h}/layouts/tremor.json`)).toBe(true);
  // Taken out by hand, uninstall goes ahead and leaves their file alone.
  writeFileSync(`${h}/keys.json`, DEFAULT_KEYS);
  expect(sh("uninstall.sh", h).code).toBe(0);
  expect(readFileSync(`${h}/keys.json`, "utf8")).toBe(DEFAULT_KEYS);
  expect(existsSync(`${h}/layouts/tremor.json`)).toBe(false);
}, 60000);

test("keys: a keys.json that is a symlink is refused by install and uninstall; its target is untouched", () => {
  const h = fresh("k11");
  const outside = `${ROOT}/k11/outside.json`;
  writeFileSync(outside, DEFAULT_KEYS);
  symlinkSync(outside, `${h}/keys.json`);
  const r = sh("install.sh", h);
  expect(r.code).toBe(1);
  expect(r.out).toMatch(/symbolic links.*keys\.json/);
  expect(existsSync(`${h}/layouts/tremor.json`)).toBe(false);
  rmSync(`${h}/keys.json`);
  writeFileSync(`${h}/keys.json`, DEFAULT_KEYS);
  sh("install.sh", h);
  rmSync(`${h}/keys.json`);
  symlinkSync(outside, `${h}/keys.json`);
  const u = sh("uninstall.sh", h);
  expect(u.code).toBe(1);
  expect(u.out).toMatch(/symbolic links.*keys\.json/);
  expect(readFileSync(outside, "utf8")).toBe(DEFAULT_KEYS);
}, 60000);


// Snapshot only our scratch target, including link identity and file modes: refusal must precede staging/journals.
function scratchSnapshot(root, rel = "") {
  const p = rel ? `${root}/${rel}` : root, st = lstatSync(p);
  const entry = [rel, st.mode & 0o777, st.isSymbolicLink() ? readlinkSync(p) : st.isFile() ? Bun.hash(readFileSync(p)).toString() : "directory"];
  return [entry, ...(st.isDirectory() ? readdirSync(p).sort().flatMap((n) => scratchSnapshot(root, rel ? `${rel}/${n}` : n)) : [])];
}

for (const operation of ["merge", "unmerge"]) test(`H1: keys ${operation} refuses an outside temp symlink before any target changes`, () => {
  const h = fresh(`h1-${operation}`), outside = `${ROOT}/h1-${operation}/sentinel.json`;
  writeFileSync(`${h}/keys.json`, '{"global":{"cmd-t":"tab.new"}}');
  if (operation === "unmerge") {
    expect(sh("install.sh", h).code).toBe(0);
    const keys = readFileSync(`${h}/keys.json`, "utf8");
    writeFileSync(`${h}/keys.json`, keys.replace('"cmd-t":"tab.new"', '"cmd-t":"tab.new","cmd-y":"pane.zoom"'));
  }
  writeFileSync(outside, "outside sentinel: preserve bytes, inode and mode"); chmodSync(outside, 0o640);
  const stat = lstatSync(outside), content = readFileSync(outside);
  symlinkSync(outside, `${h}/keys.json.pdk-tmp`);
  const before = scratchSnapshot(h), r = sh(operation === "merge" ? "install.sh" : "uninstall.sh", h);
  expect(r.code).toBe(1);
  expect(r.out).toMatch(/keys\.json\.pdk-tmp/);
  expect(readFileSync(outside)).toEqual(content);
  expect(lstatSync(outside).ino).toBe(stat.ino);
  expect(lstatSync(outside).mode).toBe(stat.mode);
  expect(scratchSnapshot(h)).toEqual(before);
}, 60000);

const keysSource = readFileSync(`${PACK}/install-lib.sh`, "utf8").split("keys_file() {")[1].split("<<'PY'\n")[1].split("\nPY\n")[0];
const keysOnly = (operation, h, attack = null) => {
  const code = `import os,sys
source, operation, home, pack, outside = sys.argv[1:]
real_open = os.open
injected = False
def open_exclusive(name, flags, mode=0o777, *, dir_fd=None):
    global injected
    if isinstance(name, str) and name.endswith(".pdk-tmp"):
        assert flags & os.O_EXCL and flags & os.O_NOFOLLOW, "temporary create must be exclusive and no-follow"
    if outside and name == "keys.json.pdk-tmp":
        os.symlink(outside, name, dir_fd=dir_fd)
        injected = True
    return real_open(name, flags, mode, dir_fd=dir_fd)
os.open = open_exclusive
sys.argv = ["keys_file", operation, home, pack, home + "/.pdk-backup"]
try:
    exec(compile(source, "keys_file", "exec"))
finally:
    print("LATE_TEMP_INJECTED=" + str(injected))
`;
  const r = Bun.spawnSync(["/usr/bin/python3", "-I", "-S", "-c", code, keysSource, operation, h, PACK, attack ?? ""], { env: { HOME: ROOT, PATH: "/usr/bin:/bin" } });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
};
for (const operation of ["merge", "unmerge"]) test(`H1: exclusive no-follow ${operation} create rejects a temp link inserted after preflight`, () => {
  const h = fresh(`h1-late-${operation}`), outside = `${ROOT}/h1-late-${operation}/sentinel`;
  writeFileSync(`${h}/keys.json`, '{"global":{"cmd-t":"tab.new"}}');
  chmodSync(`${h}/keys.json`, 0o600);
  if (operation === "unmerge") expect(keysOnly("merge", h).code).toBe(0);
  const before = readFileSync(`${h}/keys.json`);
  writeFileSync(outside, "late outside sentinel"); chmodSync(outside, 0o640);
  const stat = lstatSync(outside), r = keysOnly(operation, h, outside);
  expect(r.code).toBe(1);
  expect(r.out).toContain("LATE_TEMP_INJECTED=True");
  expect(r.out).toMatch(/FileExistsError/);
  expect(readFileSync(outside, "utf8")).toBe("late outside sentinel");
  expect(lstatSync(outside).ino).toBe(stat.ino);
  expect(lstatSync(outside).mode).toBe(stat.mode);
  expect(readFileSync(`${h}/keys.json`)).toEqual(before);
  expect(lstatSync(`${h}/keys.json`).mode & 0o777).toBe(0o600);
  // A failed exclusive create must not unlink the pre-existing path it did not create.
  expect(readlinkSync(`${h}/keys.json.pdk-tmp`)).toBe(outside);
});

test("H1: successful atomic key replacement preserves permissions and leaves no temp files", () => {
  const h = fresh("h1-atomic"); writeFileSync(`${h}/keys.json`, "{}\n"); chmodSync(`${h}/keys.json`, 0o600);
  const inode = lstatSync(`${h}/keys.json`).ino;
  expect(keysOnly("merge", h).code).toBe(0);
  expect(lstatSync(`${h}/keys.json`).isSymbolicLink()).toBe(false);
  expect(lstatSync(`${h}/keys.json`).ino).not.toBe(inode);
  expect(lstatSync(`${h}/keys.json`).mode & 0o777).toBe(0o600);
  expect(keysOnly("unmerge", h).code).toBe(0);
  expect(readFileSync(`${h}/keys.json`, "utf8")).toBe("{}\n");
  expect(lstatSync(`${h}/keys.json`).mode & 0o777).toBe(0o600);
  expect(readdirSync(h).some((n) => n.endsWith(".pdk-tmp"))).toBe(false);
  expect(readdirSync(`${h}/.pdk-backup/keys`).some((n) => n.endsWith(".pdk-tmp"))).toBe(false);
});

test("an upgrade from a pack that shipped the Colours editor retires it and replaces the old machine-add clone; nothing else of the person's moves", () => {
  const h = fresh("tokens"), old = `${ROOT}/old-pack`;
  Bun.spawnSync(["/bin/cp", "-R", PACK, old]);
  rmSync(`${old}/test`, { recursive: true, force: true });
  const retired = { "pdk-tokens": "Colours", "pdk-machine-add": "Add a machine" };
  for (const [mod, title] of Object.entries(retired)) {
    mkdirSync(`${old}/mods/${mod}`, { recursive: true });
    writeFileSync(`${old}/mods/${mod}/main.js`, "export default class Retired {}\n");
    writeFileSync(`${old}/mods/${mod}/mod.json`, `{ "title": "${title}" }\n`);
  }
  const before = Bun.spawnSync(["/bin/sh", `${old}/install.sh`, h], { env: { HOME: REAL_HOME, PATH: "/usr/bin:/bin:/usr/sbin" } });
  expect(before.exitCode, before.stderr.toString()).toBe(0);
  for (const mod of Object.keys(retired)) expect(existsSync(`${h}/mods/${mod}/main.js`)).toBe(true);
  expect(sh("install.sh", h).code).toBe(0);
  // pdk-tokens' files go (step 6: unchanged files the pack no longer ships); an emptied folder may stay, which Herdr
  // ignores. pdk-machine-add is shipped again (owner, 11 Nov): the old clone's main.js becomes the new one.
  const left = Bun.spawnSync(["/usr/bin/find", `${h}/mods/pdk-tokens`, "-type", "f"]).stdout.toString().trim();
  expect(left).toBe("");
  expect(readFileSync(`${h}/mods/pdk-machine-add/main.js`, "utf8")).toBe(readFileSync(`${PACK}/mods/pdk-machine-add/main.js`, "utf8"));
  expect(existsSync(`${h}/mods/pdk-usage/main.js`)).toBe(true);
  expect(sh("uninstall.sh", h).code).toBe(0);
}, 60000);
