import { test, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// The owner's rules: the pack's glyphs are chat, terminal, factory, sidebar toggle and search (2026-11-09 A, 17:40
// request 4); agents get their own marks in their Moshi colours and plain shells the terminal glyph (requests 5, 5b,
// 5c); one status system everywhere (request 7). The factory mod's folder belongs to the build-factory lane and is
// checked there.
const ROOT = new URL("..", import.meta.url).pathname;
const UI = readFileSync(join(ROOT, "shared/ui.js"), "utf8");
const ICONS = JSON.parse(UI.match(/export const ICONS = (\[[^\]]*\]);/)[1]);
const OWNED = ["mods", "shared", "adapters", "layouts"];
// Herdr's own add dialog rides along byte for byte (machine-add.test.js pins it): its svg() calls are Herdr's.
const SKIP = new Set([join(ROOT, "mods/pdk-factory"), join(ROOT, "mods/pdk-machine-add/stock.js")]);

function files(dir) {
  if (SKIP.has(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(js|json)$/.test(n) && !SKIP.has(p) ? [p] : [];
  });
}

// The top-level arguments of the call whose "(" is at `open`.
function args(src, open) {
  const out = [];
  let depth = 0, cur = "", quote = null;
  for (let i = open + 1; i < src.length; i++) {
    const c = src[i];
    if (quote) { cur += c; if (c === quote && src[i - 1] !== "\\") quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; cur += c; continue; }
    if ("([{".includes(c)) depth++;
    if (")]}".includes(c)) { if (depth === 0) { out.push(cur.trim()); return out; } depth--; }
    if (c === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  return out;
}

test("the pack ships exactly its five glyphs", () => {
  expect(ICONS).toEqual(["message-square", "square-terminal", "factory", "panel-left", "search", "list-tree", "bot", "monitor", "server", "settings", "git-branch", "caret-right", "caret-down", "square-slash", "layout-grid", "columns-2", "rows-2", "maximize-2", "minimize-2", "x", "plus", "minus", "chevrons-up-down", "check", "working", "working-dense", "working-still", "orbit", "layout-list"]);
  expect(readdirSync(join(ROOT, "icons")).filter((n) => n.endsWith(".svg")).sort()).toEqual(["bot.svg", "caret-down.svg", "caret-right.svg", "check.svg", "chevrons-up-down.svg", "columns-2.svg", "factory.svg", "git-branch.svg", "layout-grid.svg", "layout-list.svg", "list-tree.svg", "maximize-2.svg", "message-square.svg", "minimize-2.svg", "minus.svg", "monitor.svg", "orbit.svg", "panel-left.svg", "plus.svg", "rows-2.svg", "search.svg", "server.svg", "settings.svg", "square-slash.svg", "square-terminal.svg", "tremor-preview.svg", "working-dense.svg", "working-still.svg", "working.svg", "x.svg"]);
});

test("icon() and iconButton() draw nothing for any other name", () => {
  expect(UI).toMatch(/ICONS\.includes\(name\) \? svg\(iconPath\(name\)\)\.size\(size\)/);
  expect(UI).toMatch(/ICONS\.includes\(name\) \? svg\(iconPath\(name\)\)\.size\(glyph\)/);
});

test("no code asks for another icon, draws an svg itself, or uses a program icon", () => {
  const bad = [];
  for (const f of OWNED.flatMap((d) => files(join(ROOT, d)))) {
    const src = readFileSync(f, "utf8");
    const rel = f.slice(ROOT.length);
    if (rel !== "shared/ui.js" && /\bsvg\(/.test(src)) bad.push(`${rel}: svg()`);
    for (const m of src.matchAll(/\b(icon|iconButton)\(/g)) {
      if (src.slice(m.index - 9, m.index) === "function ") continue;
      const a = args(src, m.index + m[0].length - 1);
      const name = m[1] === "icon" ? a[0] : a[2];
      const literal = name?.match(/^"([^"]*)"$/)?.[1];
      // A literal must be one of the glyphs; anything computed must come from the toggles' own lists, the pane
      // header's controls (adapters/views.js paneControls) or the machine selector's entries (status.js
      // machineChoices), checked below.
      if (literal != null ? !ICONS.includes(literal) : !((rel === "mods/pdk-tabs/main.js" && name === "name") || (rel === "shared/ui.js" && name === "item.icon") || (rel === "mods/pdk-pane/main.js" && name === "c.glyph") || (rel === "mods/pdk-tree/main.js" && name === "shown.icon"))) bad.push(`${rel}: ${m[1]}(${name})`);
    }
    if (/program\??\.icon\b/.test(src)) bad.push(`${rel}: program icon`);
  }
  expect(bad).toEqual([]);
});

test("the toggles' computed icon names are chat and terminal, then grid and factory; the pane header's are shipped glyphs", async () => {
  const { AGENT_VIEWS, PLACE_VIEWS, paneControls } = await import("../adapters/views.js");
  expect([...AGENT_VIEWS, ...PLACE_VIEWS].map((v) => v.icon)).toEqual(["message-square", "square-terminal", "layout-grid", "factory"]);
  for (const v of [...AGENT_VIEWS, ...PLACE_VIEWS]) expect(ICONS).toContain(v.icon);
  for (const zoomed of [false, true]) for (const c of paneControls("p", zoomed)) expect(ICONS).toContain(c.glyph);
  const { machineChoices } = await import("../adapters/status.js");
  const known = [{ name: null, id: "", label: "This computer", state: null }, { name: "box", id: "box", label: "box", state: null }];
  expect(machineChoices(known, "all").map((m) => m.icon)).toEqual([null, "monitor", "server"]);
});

// The mono face must show text exactly: no face whose contextual alternates move glyphs (Geist Mono shifts "--"
// over the space before it). The data is right; this guards the font choice, the one place the bug can return.
test("mods draw mono text only through monoFont(), never in Geist Mono", () => {
  const faces = JSON.parse(UI.match(/export const MONO_FACES = (\[[^\]]*\]);/)[1]);
  expect(faces[0]).toBe("Menlo");
  expect(faces).not.toContain("Geist Mono");
  for (const f of OWNED.flatMap((d) => files(join(ROOT, d)))) {
    const src = readFileSync(f, "utf8");
    expect(src.includes('"Geist Mono"') && !f.endsWith("shared/ui.js"), f).toBe(false);
  }
});

// ---- Agent marks and status dots (requests 5, 5b, 5c and 7), against the real ui.js ----------------------------
// ui.js runs inside the app; here a copy of it imports recording stand-ins for gpui-kit, gpui-base and herdr, so
// what each marker draws is checked, not just its source text.
import { mkdirSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { afterAll } from "bun:test";
import { contrast, toHsl, fromHsl, glassGrounds, over } from "../adapters/tokens.js";

const LIB = `/tmp/pdk-ic${process.pid}`;
mkdirSync(LIB, { recursive: true });
afterAll(() => rmSync(LIB, { recursive: true, force: true }));
for (const dir of ["adapters", "shared"]) for (const f of readdirSync(join(ROOT, dir))) if (f.endsWith(".js")) cpSync(join(ROOT, dir, f), join(LIB, f));
writeFileSync(join(LIB, "stub-gpui.js"), `
const make = (kind, args) => {
  const el = { kind, args, ops: [] };
  const p = new Proxy(el, { get(o, k) {
    if (k in o || typeof k === "symbol" || k === "then") return o[k];
    return (...a) => { if (k === "when") { if (a[0]) a[1](p); return p; } o.ops.push([k, ...a]); return p; };
  } });
  return p;
};
export const div = () => make("div", []);
export const svg = (path) => make("svg", [path]);
export const h_flex = () => make("h_flex", []);
export const v_flex = () => make("v_flex", []);
export const Button = { new: (id) => make("Button", []).id(id) }, Toggle = { new: (id) => make("Toggle", []).id(id) }, Popover = { new: (id) => make("Popover", []).id(id) }, HoverCard = { new: (id) => make("HoverCard", []).id(id) };
export const Progress = { new: (id) => make("Progress", []).id(id) }, ProgressTrack = { new: () => make("ProgressTrack", []) }, ProgressIndicator = { new: () => make("ProgressIndicator", []) };
`);
writeFileSync(join(LIB, "stub-herdr.js"), `
export const state = { shared: {}, theme: {}, spaces: [] };
export const shared = (k) => state.shared[k];
export const setShared = (k, v) => { state.shared[k] = v; };
export const spaces = () => state.spaces;
export const home = () => "/h";
export const settings = () => ({});
export const fonts = () => [];
export const window = () => ({ platform: "macos" });
export const theme = () => state.theme;
export const keys = () => state.keys ?? [];
`);
writeFileSync(join(LIB, "ui.js"), UI.replace('from "gpui-kit"', 'from "./stub-gpui.js"').replace('from "gpui-base"', 'from "./stub-gpui.js"').replace('from "herdr"', 'from "./stub-herdr.js"'));
// A second mod's copy of ui.js: its own module state, the same shared store (pdk.focus.pointer).
writeFileSync(join(LIB, "ui-other.js"), readFileSync(join(LIB, "ui.js"), "utf8"));
const ui = await import(join(LIB, "ui.js"));
const other = await import(join(LIB, "ui-other.js"));
const { state } = await import(join(LIB, "stub-herdr.js"));
const op = (el, name) => el.ops.filter((o) => o[0] === name).at(-1)?.slice(1);
const child = (el) => op(el, "child")?.[0];

const THEMES = readdirSync(join(ROOT, "themes")).filter((n) => /^pdk-.*\.json$/.test(n)).map((n) => {
  const f = JSON.parse(readFileSync(join(ROOT, "themes", n), "utf8"));
  return { name: n.slice(0, -5), t: { ...f.colors, background: f.background } };
});
const dark = THEMES.find((x) => x.name === "pdk-t3-dark").t;

test("the marks are a closed list: the 14 Moshi agents, Grok and Kimi, plus the terminal and agent glyphs, one file each", () => {
  expect(Object.values(ui.AGENT_MARKS).map((m) => m.name)).toEqual(["Claude Code", "Codex", "Cursor", "Hermes", "OpenCode", "Gemini CLI", "Antigravity",
    "Qwen Code", "Qoder CLI", "Factory Droid", "GitHub Copilot", "Devin CLI", "Pi", "Goose", "Grok Build", "Kimi Code"]);
  const names = [...Object.keys(ui.AGENT_MARKS), ...ui.PLAIN_MARKS].map((k) => `${k}.svg`).sort();
  expect(readdirSync(join(ROOT, "icons/agents")).sort()).toEqual(names);
  for (const n of names) {
    const svgText = readFileSync(join(ROOT, "icons/agents", n), "utf8");
    expect(svgText, n).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]* viewBox="[\d.]+ [\d.]+ [\d.]+ [\d.]+"/);
    expect(svgText, n).not.toMatch(/<(script|image|foreignObject)\b|href=|url\(/); // a shape only, nothing it loads
  }
  for (const m of Object.values(ui.AGENT_MARKS)) expect(m.color).toMatch(/^#[0-9a-f]{6}$/);
});

test("each agent is matched by the pack's kind names, Herdr's program names and keys, and Moshi's names", () => {
  const cases = {
    claude: ["Claude Code", "claude", "claude-code"], codex: ["Codex"], cursor: ["Cursor Agent", "Cursor", "cursor-agent"], hermes: ["Hermes", "Hermes Agent"],
    opencode: ["OpenCode", "opencode"], gemini: ["Gemini CLI", "Gemini", "Google Gemini"], antigravity: ["Antigravity", "agy"], qwen: ["Qwen Code", "qwen"],
    qoder: ["Qoder CLI", "Qoder", "qodercli"], droid: ["Factory Droid", "droid"], copilot: ["GitHub Copilot", "Copilot", "github-copilot"],
    devin: ["Devin CLI", "devin"], pi: ["Pi", "pi"], goose: ["Goose", "goose"],
    grok: ["Grok Build", "Grok", "grok", "grok-build"], kimi: ["Kimi Code", "Kimi", "kimi", "kimi-code", "kimicodecli"],
  };
  for (const [key, words] of Object.entries(cases)) for (const w of words) expect(ui.markFor(w, true), w).toBe(key);
  // Herdr's own names reach the same marks through kindName for every kind the pack detects with a mark.
  const known = readFileSync(join(ROOT, "adapters/agents.js"), "utf8");
  for (const name of ["Claude Code", "Codex", "OpenCode", "Hermes", "Gemini CLI", "Cursor Agent", "GitHub Copilot", "Antigravity", "Qoder CLI", "Factory Droid", "Pi", "Grok Build", "Kimi Code"]) {
    expect(known.includes(`"${name}"`), name).toBe(true);
    expect(ui.PLAIN_MARKS).not.toContain(ui.markFor(name, true));
  }
  // An agent without a mark: the neutral glyph. Anything else: the terminal glyph, whatever its name.
  for (const w of ["Oh My Pi", "Amp", ""]) expect(ui.markFor(w, true)).toBe("agent");
  for (const w of ["zsh", "nvim", "Terminal", "", null]) expect(ui.markFor(w, false)).toBe("terminal");
});

// Owner, opt-in: "pdk.marks.mono" (Colours, "Monochrome agent marks") draws every agent mark in the text colour.
test("monochrome marks: brand colour while pdk.marks.mono is off, the theme's foreground while it is on; shells unchanged", () => {
  const claude = () => op(child(ui.kindMarker(dark, { agent: true, label: "Claude Code" }, 12, dark.muted, "m1")), "text_color");
  const shell = () => op(child(ui.kindMarker(dark, { agent: false, label: "zsh" }, 12, dark.dim, "m2")), "text_color");
  try {
    for (const off of [{}, { "pdk.marks.mono": false }]) {
      state.shared = off;
      expect(claude()).toEqual(["#d97757"]);
      expect(shell()).toEqual([dark.dim]);
    }
    state.shared = { "pdk.marks.mono": true };
    expect(claude()).toEqual([dark.foreground]);
    expect(shell()).toEqual([dark.dim]);
  } finally {
    state.shared = {};
  }
});

test("kindMarker draws the mark in its colour with the kind in words; shells get the terminal glyph, never `$`", () => {
  const m = ui.kindMarker(dark, { agent: true, label: "Claude Code" }, 12, dark.muted, "k1");
  expect(op(m, "id")).toEqual(["k1"]);
  expect(op(m, "tooltip")).toEqual(["Claude Code"]);
  expect(op(m, "accessibility_label")).toEqual(["Claude Code"]);
  expect(op(m, "role")).toEqual(["image"]);
  expect(child(m).args).toEqual(["pdk/icons/agents/claude.svg"]);
  expect(op(child(m), "text_color")).toEqual(["#d97757"]);
  expect(op(child(m), "size")).toEqual([12]);
  const sh = ui.kindMarker(dark, { agent: false, label: "zsh" }, 12, dark.dim, "k2");
  expect(child(sh).args).toEqual(["pdk/icons/agents/terminal.svg"]);
  expect(op(child(sh), "text_color")).toEqual([dark.dim]);
  expect(op(sh, "accessibility_label")).toEqual(["zsh"]);
  const omp = ui.kindMarker(dark, { agent: true, label: "Oh My Pi" }, 12, dark.muted, "k3");
  expect(child(omp).args).toEqual(["pdk/icons/agents/agent.svg"]);
  expect(op(omp, "tooltip")).toEqual(["Oh My Pi"]);
  expect(child(ui.kindMarker(dark, { agent: true, label: "Grok Build" }, 12, dark.muted, "k5")).args).toEqual(["pdk/icons/agents/grok.svg"]);
  expect(op(ui.kindMarker(dark, { agent: false, label: "" }, 12, dark.dim, "k4"), "tooltip")).toEqual(["Terminal"]);
  // The factory's old name draws the mark too, in the theme the app shows: no letters left anywhere.
  state.theme = dark;
  expect(ui.kindMonogram("Codex", true).args).toEqual(["pdk/icons/agents/codex.svg"]);
  expect(ui.kindMonogram("bash", false).args).toEqual(["pdk/icons/agents/terminal.svg"]);
  expect(UI).not.toMatch(/MONOGRAM|"Cl"|"Cx"/);
});

test("every mark keeps 3:1 on every ground of every pack theme, in its brand colour or the nearest shade of its hue", () => {
  const grounds = ["background", "surface", "canvas", "chrome", "raised", "popover", "hover", "selected"];
  const lum = (c) => contrast(c, "#000000"); // grows with luminance
  const hueGap = (a, b) => { const d = Math.abs(toHsl(a)[0] - toHsl(b)[0]) % 360; return Math.min(d, 360 - d); };
  for (const { name, t } of THEMES) {
    const light = lum(t.surface) > lum("#777777");
    for (const [key, { color: brand }] of Object.entries(ui.AGENT_MARKS)) {
      const c = ui.markColor(t, key);
      const opaque = ui.markGrounds(t); // a ground with alpha, over the surface it sits on
      // Glass adds the sidebar's real composites over the backdrop (fixes-panels, item 8).
      const glass = /^#[0-9a-f]{8}$/i.test(t.chrome ?? "") ? glassGrounds({ background: t.background, colors: t }).length : 0;
      expect(opaque.length).toBe(grounds.filter((g) => t[g]).length + glass);
      for (const g of opaque) expect(contrast(c, g), `${name} ${key} on ${g}`).toBeGreaterThanOrEqual(3);
      const passes = opaque.every((g) => contrast(brand, g) >= 3);
      if (passes) { expect(c, `${name} ${key}`).toBe(brand); continue; }
      if (key === "goose") { expect(c, `${name} goose`).toBe(t.foreground); continue; } // neutral: no hue to keep
      expect(c, `${name} ${key}`).not.toBe(t.foreground);
      expect(hueGap(c, brand), `${name} ${key} hue`).toBeLessThanOrEqual(3);
      expect(lum(c) < lum(brand), `${name} ${key}: darker on light, lighter on dark`).toBe(light);
    }
  }
  // Just enough: one lightness step back towards the brand misses 3:1 somewhere.
  const white = ["#ffffff"];
  const shade = ui.markShade("#ffcb6b", white);
  const [h, sat, l] = toHsl(shade);
  expect(contrast(shade, "#ffffff")).toBeGreaterThanOrEqual(3);
  expect(contrast(fromHsl([h, sat, l + 1]), "#ffffff")).toBeLessThan(3);
  expect(ui.markShade("#d97757", ["#000000"])).toBe("#d97757"); // already legible: the brand itself
  expect(ui.markShade("#d2d2d2", white)).toBeNull(); // neutral
  expect(ui.markShade("#7f4edb", ["#ffffff", "#777777", "#000000"])).toBeNull(); // nothing reads on all three: the caller falls back
  // A ground with alpha is judged over the surface it sits on.
  expect(ui.markColor({ ...dark, hover: "#ffffff20" }, "claude")).toBe("#d97757");
  const tinted = ui.markColor({ ...dark, selected: "#d9775790" }, "claude");
  expect(tinted).not.toBe("#d97757");
  expect(tinted).not.toBe(dark.foreground);
});

test("one status system (request 7, the contract's 7 px markers): the spinner working (turning), green dot done, yellow dot needs you, hollow ring idle; nothing else moves", () => {
  state.shared = {};
  const draw = (word, kind) => ui.statusMarker(dark, word, `s-${word}`, { kind });
  const working = draw("working");
  expect([child(working).kind, child(working).args, op(child(working), "text_color"), op(child(working), "size")])
    .toEqual(["svg", ["pdk/icons/working.svg"], [dark.foreground], [12]]); // the shared spinner in the text's ink (12 Nov)
  expect(op(child(working), "spin")).toEqual([ui.MOTION.spin]); // it turns (owner, 11 Nov); nothing else moves
  for (const word of ["done", "needs", "idle", "exited"]) expect(JSON.stringify(draw(word))).not.toContain('"spin"');
  const dot = (el) => ({ size: op(child(el), "size"), round: op(child(el), "rounded"), fill: op(child(el), "bg"), ring: op(child(el), "border_color") });
  expect(dot(draw("done"))).toEqual({ size: [7], round: [3.5], fill: [dark.done], ring: undefined });
  expect(dot(draw("needs"))).toEqual({ size: [7], round: [3.5], fill: [dark.blocked], ring: undefined });
  expect(dot(draw("idle"))).toEqual({ size: [7], round: [3.5], fill: undefined, ring: [dark.idle] });
  expect(op(child(draw("idle")), "border")).toEqual([1.2]);
  expect(op(draw("done"), "tooltip")).toEqual(["Done"]); // short for the pointer; the whole label for a screen reader
  // The words stay for the pointer and a screen reader.
  for (const [word, label] of [["done", "Done"], ["idle", "Idle"], ["working", "Working"]]) {
    expect(op(draw(word), "tooltip")?.[0], word).toMatch(new RegExp(label, "i"));
    expect(op(draw(word), "accessibility_label")?.[0], word).toMatch(new RegExp(label, "i"));
  }
  expect(op(draw("needs", "permission"), "accessibility_label")[0]).toMatch(/permission/);
  expect(ui.statusMarker(dark, null, "x")).toBeNull();
});

test("no flag glyph and no hex colour in the pack's mods and shared code but the marks' table", () => {
  const bad = [];
  for (const f of ["mods", "shared"].flatMap((d) => files(join(ROOT, d)))) {
    const rel = f.slice(ROOT.length);
    let src = readFileSync(f, "utf8");
    if (rel === "shared/ui.js") src = src.replace(/export const AGENT_MARKS = \{[\s\S]*?\n\};/, "");
    if (/#[0-9a-fA-F]{6}\b/.test(src)) bad.push(`${rel}: hex`);
    if (/flag(Glyph|-)|⚑|🚩/.test(src)) bad.push(`${rel}: flag`);
  }
  expect(bad).toEqual([]);
});

test("a pane's name beside its mark follows the sidebar's rule: Core's name, else the agent, the program or Terminal", () => {
  const claude = { address: "t3", foreground: { argv: ["claude"], name: "claude" } };
  const pane = (title, tab = "T2", extra = {}) => ({ pane: "p1", terminal: "t3", tab, title, cwd: "/h/code/tremor", program: { key: "claude", name: "Claude Code", agent: true }, ...extra });
  expect(ui.paneLabel(pane("✳ Review the plan"), { ...claude, name: "build-media" })).toBe("build-media"); // Core's name first
  // Never a title, a tab's name or the folder (owner, 11 Nov: "pane names must show agent names").
  for (const said of ["✳ Review the plan", "✳ ~/code/x", "claude", "t3", ""]) for (const tab of ["T1", "T2"]) expect(ui.paneLabel(pane(said, tab), claude), said).toBe("Claude Code");
  const shell = { address: "t9", foreground: { argv: ["-zsh"], name: "zsh" } };
  // A plain shell reads "Terminal" wherever it is, as the rows and tabs do (lead, 10 Nov); never its folder, "~" or
  // the tab's name. Core's own name for it still wins; another program reads its own name.
  expect(ui.paneLabel({ pane: "p9", terminal: "t9", tab: "T2", title: "zsh", cwd: "/h", program: { key: "shell", name: "zsh", shell: true } }, shell)).toBe("Terminal");
  const sh = (cwd) => ({ pane: "p9", terminal: "t9", tab: "T1", title: "zsh", cwd, program: { key: "shell", name: "zsh", shell: true } });
  expect(ui.paneLabel(sh("/repo/evals"), shell)).toBe("Terminal");
  expect(ui.paneLabel(sh(undefined), shell)).toBe("Terminal");
  expect(ui.paneLabel(sh("/repo/evals"), { ...shell, name: "probe" })).toBe("probe");
  expect(ui.paneLabel({ ...sh("/repo"), program: { key: "nvim", name: "Neovim" } }, { address: "t8", foreground: { argv: ["nvim"], name: "nvim" } })).toBe("Neovim");
  // Both headers draw that name.
  for (const f of ["mods/pdk-pane/main.js", "mods/pdk-chat/main.js"]) expect(readFileSync(join(ROOT, f), "utf8")).toMatch(/const name = paneLabel\(/);
});

test("every pack button shows keyboard focus: a Tab stop with a 3 px ring that moves nothing, pressed by Enter or Space", () => {
  let pressed = 0;
  const b = ui.textButton(dark, "b1", "Settle", "Settle workspace", () => { pressed++; });
  expect(op(b, "tab_index")).toEqual([0]);
  expect(op(b, "border")).toEqual([3]); // always there, in the clear: showing the ring changes no size
  expect(op(b, "border_color")[0]).toBe(`${dark.border.slice(0, 7)}00`);
  const styled = { ops: [] };
  const rec = new Proxy(styled, { get: (o, k) => (k === "ops" ? o.ops : (...a) => { o.ops.push([k, ...a]); return rec; }) });
  op(b, "focus")[0](rec);
  expect(styled.ops).toEqual([["border_color", `${dark.accent.slice(0, 7)}80`]]); // the accent at half strength (shadcn ring-ring/50)
  const key = op(b, "on_key_down")[0];
  const cx = { stop_propagation() {} };
  key({ key: "enter" }, cx); key({ key: "space" }, cx); key({ key: "a" }, cx);
  expect(pressed).toBe(2);
  const off = ui.textButton(dark, "b2", "Settle", "Can't settle", () => {}, { disabled: true });
  expect(op(off, "tab_index")).toBeUndefined();
  expect(op(off, "border")).toEqual([3]); // the same size as an enabled one
  expect(op(off, "opacity")).toEqual([0.5]);
  const ib = ui.iconButton(dark, "i1", "search", "Search", () => {});
  expect(op(ib, "tab_index")).toEqual([0]);
  expect(typeof op(ib, "focus")[0]).toBe("function");
});

// Owner, 11 Nov: every + and icon button a square target with its glyph centred. A font's +, ×, − and - sit on
// its baseline (measured 3 to 9 px low at 2x), so those draw as the pack's glyphs; words keep their sides.
test("a one-character button is square and draws +, ×, − and - as centred glyphs; the + button is the 24 px icon button", () => {
  for (const [c, name] of [["+", "plus"], ["×", "x"], ["−", "minus"], ["-", "minus"]]) {
    const b = ui.textButton(dark, "g", c, "Glyph", () => {}, { h: 28, size: ui.TYPE.lg });
    expect([op(b, "w"), op(b, "px"), child(b).args, op(child(b), "size")]).toEqual([[28], undefined, [`pdk/icons/${name}.svg`], [14]]);
  }
  for (const c of ["⋯", "↑"]) { // centred in their font already (measured): they stay text
    const b = ui.textButton(dark, "m", c, "More", () => {}, { h: 24 });
    expect([op(b, "w"), child(b)]).toEqual([[24], c]);
  }
  const words = ui.textButton(dark, "w", "Close", "Close", () => {});
  expect([op(words, "w"), op(words, "px"), op(words, "border"), child(words)]).toEqual([undefined, [3], [3], "Close"]); // 3 + 3 a side, as 4 + 2 were
  expect(op(ui.actionButton(dark, "in", "+", "Zoom in", () => {}), "px")).toEqual([0]);
  const plus = readFileSync(join(ROOT, "shared/plus.js"), "utf8");
  expect(plus).toMatch(/button\(t, id, \{ icon: "plus", label, variant: "ghost-muted", size: "xs", onPress \}\)\.rounded\(RADIUS\.sm\)/);
});

// Lead, 11 Nov: a button on a hovered or selected row or tab (a tab's ×, a tree row's × and fold caret) shows its own
// box under the pointer. Its hover is a see-through step of the foreground: `hover` over a resting canvas (within a
// shade), one step more over `hover` and over `selected`, in every pack theme.
test("a row's or tab's own buttons hover with a see-through step that shows on resting, hovered and selected grounds", () => {
  const lum = (x) => [1, 3, 5].reduce((s, i, k) => s + [0.2126, 0.7152, 0.0722][k] * parseInt(x.slice(i, i + 2), 16), 0);
  expect(ui.fgStep(dark, dark.hover)).toBe("#f5f5f515"); // 8% of #f5f5f5 over #000 is #141414, the token
  for (const { name, t } of THEMES) {
    const step = ui.fgStep(t, t.hover), canvas = over(t.canvas, t.surface.slice(0, 7));
    expect(Math.abs(lum(over(step, canvas)) - lum(over(t.hover, canvas))), `${name} at rest`).toBeLessThanOrEqual(1);
    const stepOf = (g) => Math.abs(lum(over(step, g)) - lum(g));
    const theirs = stepOf(canvas);
    for (const g of ["hover", "selected"]) expect(stepOf(over(t[g], canvas)), `${name} on ${g}`).toBeGreaterThan(Math.max(1, 0.75 * theirs));
  }
  const rec = () => { const o = { ops: [] }; const r = new Proxy(o, { get: (x, k) => (k === "ops" ? x.ops : (...a) => { x.ops.push([k, ...a]); return r; }) }); return r; };
  const close = rec(); op(ui.textButton(dark, "x", "×", "Close tab", () => {}, { h: 24 }), "hover")[0](close);
  expect(close.ops).toEqual([["bg", "#f5f5f515"], ["text_color", dark.foreground]]);
  const caret = ui.caretButton(dark, "c", false, "Expand", () => {}), hov = rec();
  op(caret, "hover")[0](hov);
  expect([hov.ops, op(caret, "active")]).toEqual([[["bg", "#f5f5f515"]], undefined]); // no pressed look (shadcn)
});

// The panes round's controls (combined round, 11 Nov): the pane header's split, expand, restore and close, and the
// Grid / Factory and Chat / Terminal segments, are the shared 24 px square icon button, its glyph centred, hovering
// with the see-through step, so the box shows on the pane header's `surface` as on canvas. A pressed one stays lit.
test("the icon button and the icon segments hover with the see-through step; a pressed one stays lit", () => {
  const step = ui.fgStep(dark, dark.hover);
  const close = ui.iconButton(dark, "ph-x", "x", "Close pane", () => {}, { size: 24, tip: false });
  expect([op(close, "size"), op(close, "items_center"), op(close, "justify_center"), child(close).args, op(pseudo(close, "hover"), "bg")])
    .toEqual([[24], [], [], ["pdk/icons/x.svg"], [step]]);
  const restore = ui.iconButton(dark, "ph-z", "minimize-2", "Restore", () => {}, { size: 24, pressed: true, tip: false });
  expect([op(restore, "bg"), op(pseudo(restore, "hover"), "bg")]).toEqual([[dark.selected], [dark.selected]]);
  for (const ground of [dark.canvas, dark.surface]) {
    const [grid, factory] = childrenOf(ui.segmentedChoice(dark, "place", [{ value: "grid", label: "Grid", icon: "layout-grid" },
      { value: "factory", label: "Factory", icon: "factory" }], "grid", () => {}, { variant: "navigation", ground })).map(child);
    expect([op(factory, "size"), op(factory, "bg"), op(pseudo(factory, "hover"), "bg"), op(pseudo(grid, "hover"), "bg")]).toEqual([[24], [ground], [step], [dark.selected]]);
  }
});

// ---- The shared contract of the design fix round (design-astra items 1, 6 and 12) -----------------------------
test("item 1: UI text is the system sans in every preset, Moshi too; mono only where a renderer asks", () => {
  expect(ui.uiFont()).toBe(".SystemUIFont");
  expect(UI).not.toMatch(/MONO_THEMES/);
});

test("item 6: idle marks dim through one helper that keeps 3:1 on their real ground; records draw the bot", () => {
  for (const { name, t } of THEMES) for (const g of ["chrome", "background", "surface"]) {
    const grounds = ui.groundOf(t, g);
    for (const key of Object.keys(ui.AGENT_MARKS)) {
      const c = ui.markColor(t, key);
      if (grounds.some((x) => contrast(c, x) < 3)) continue; // a neutral mark on the foreground fallback is left alone
      const d = ui.dimMark(c, grounds);
      for (const x of grounds) expect(contrast(d, x), `${name} ${g} ${key} on ${x}`).toBeGreaterThanOrEqual(3);
    }
  }
  // Glass (fixes-panels): marks keep 3:1 on the sidebar's real composites, not just chrome over the surface.
  for (const { name, t } of THEMES.filter((x) => /^#[0-9a-f]{8}$/i.test(x.t.chrome ?? ""))) {
    const real = ui.groundOf(t, "chrome");
    expect(real.length, name).toBeGreaterThan(1);
    for (const key of Object.keys(ui.AGENT_MARKS)) {
      const c = ui.markColor(t, key);
      if (c === t.foreground) continue;
      for (const x of real) expect(contrast(c, x), `${name} ${key} on ${x}`).toBeGreaterThanOrEqual(3);
    }
  }
  expect(ui.dimMark("#777777", "#808080")).toBe("#777777"); // already under 3:1: unchanged
  expect(ui.dimMark("#ffffff", "#000000")).toBe("#808080"); // plenty of room: half
  const idle = ui.kindMarker(dark, { agent: true, label: "Claude Code", idle: true, ground: "chrome" }, 14, dark.muted, "i1");
  expect(op(child(idle), "text_color")).toEqual([ui.dimMark(ui.markColor(dark, "claude"), ui.groundOf(dark, "chrome"))]);
  expect(op(child(idle), "text_color")[0]).not.toBe(ui.markColor(dark, "claude"));
  expect(op(child(ui.kindMarker(dark, { agent: true, label: "Claude Code" }, 14, dark.muted, "i2")), "text_color")).toEqual([ui.markColor(dark, "claude")]);
  const rec = ui.kindMarker(dark, { agent: true, label: "Claude Code", record: true }, 14, dark.muted, "r1");
  expect(child(rec).args).toEqual(["pdk/icons/agents/agent.svg"]);
  expect(op(child(rec), "text_color")).toEqual([dark.muted]);
  expect(op(rec, "tooltip")).toEqual(["Claude Code"]);
  expect(op(ui.kindMarker(dark, { record: true }, 14, dark.muted, "r2"), "tooltip")).toEqual(["Sub-agent"]);
});

test("item 12: one 10 px caret, right while folded and down while open, in a square 24 px target (owner, 11 Nov)", () => {
  expect(ui.foldMarker(dark, false).args).toEqual(["pdk/icons/caret-right.svg"]);
  expect(op(ui.foldMarker(dark, true), "size")).toEqual([10]);
  expect(ui.foldMarker(dark, true).args).toEqual(["pdk/icons/caret-down.svg"]);
  let n = 0;
  const b = ui.caretButton(dark, "c1", false, "Expand tab", () => { n++; });
  expect(op(b, "size")).toEqual([24]); // 7 + 10 + 7, its ring inside
  expect(op(b, "border")).toEqual([3]);
  expect(op(b, "accessibility_label")).toEqual(["Expand tab"]);
  op(b, "on_key_down")[0]({ key: "enter" }, { stop_propagation() {} });
  op(b, "on_click")[0]({}, { stop_propagation() {} });
  expect(n).toBe(2);
});

test("design-astra 11, 13, 14: media cards keep their action words; preview and switcher on the app's rows", () => {
  const media = readFileSync(join(ROOT, "mods/pdk-chat/media.js"), "utf8");
  // The tiles' words since the thread design (job 2026-11-11 design/chat-direction.md §6); Play stays the preview's action.
  for (const words of ['"Click to load preview"', '"Loading preview…"', '"File not found"', '"Preview unavailable"']) expect(media).toContain(words);
  expect(readFileSync(join(ROOT, "mods/pdk-preview/main.js"), "utf8")).toContain('"Play in default app"');
  expect(media).not.toMatch(/click to load it|opens in the browser|plays in the default app/);
  // (design-final-look F5, a reason that repeated the tile's heading, went with the old tile: its headings are fixed words now.)
  const preview = readFileSync(join(ROOT, "mods/pdk-preview/main.js"), "utf8");
  expect(preview).toMatch(/const HEAD = ROW\.two;/);
  expect(preview).toMatch(/const FOOT = ROW\.two;/);
  expect(preview).toMatch(/return actionButton\(t, id, /); // 28 px by the shared contract (design-system C5)
  expect(preview).toMatch(/this\.zoom === "fit" \? "Fit" : percent/);
  const chat = readFileSync(join(ROOT, "mods/pdk-chat/main.js"), "utf8");
  expect(chat).toMatch(/id\(`mdl-\$\{i\}`\)\.h\(ROW\.base\)/);
  expect(chat).toMatch(/id\("switch-foot"\)\.h\(ROW\.base\)/);
  expect(chat).toMatch(/const key = \(k\) => div\(\)\.h\(16\)/);
  expect(chat).not.toMatch(/\barc\(/); // the old blue ring is gone: the shared spinner
  expect(chat.indexOf("Worked · ")).toBeLessThan(chat.indexOf(".child(foldMarker(t, !folded))")); // caret after its words
});

// Consistency contract: exercise the real shared constructors and state callbacks, not matching source strings.
const childrenOf = (el) => el.ops.filter((o) => o[0] === "child").map((o) => o[1]).concat(op(el, "children")?.[0] ?? []);
function pseudo(el, name) {
  const out = { ops: [] }; let proxy;
  proxy = new Proxy(out, { get: (o, k) => k in o ? o[k] : (...a) => { o.ops.push([k, ...a]); return proxy; } });
  op(el, name)?.[0](proxy); return out;
}
const cxPress = { stop_propagation() {} };

test("C7 shared row states preserve selected fill and focus, without adding Tab stops; disabled has no interactive styles", () => {
  for (const { t } of THEMES) {
    const el = ui.rowStates(ui.fitLabel("row", "Full label"), t, { selected: true, ground: t.popover, focused: true });
    expect(op(el, "bg")).toEqual([t.selected]);
    expect(op(pseudo(el, "hover"), "bg")).toEqual([t.selected]);
    expect(op(el, "active")).toBeUndefined();
    expect(op(pseudo(el, "hover"), "border_color")).toEqual([t.accent]);
    expect(op(pseudo(el, "focus"), "border_color")).toEqual([t.accent]);
    expect(op(el, "tab_index")).toBeUndefined();
    const off = ui.rowStates(ui.fitLabel("off", "Unavailable"), t, { disabled: true });
    expect(op(off, "disabled")).toEqual([true]); expect(op(off, "text_color")).toEqual([t.dim]);
    for (const name of ["hover", "active", "focus", "tab_index", "cursor_pointer"]) expect(op(off, name)).toBeUndefined();
  }
});

test("C1 segmented choices: the contract's p2/gap2/r8 group of 24px toggles, raised choices versus selected navigation, and guarded activation", () => {
  const selected = [];
  const group = ui.segmentedChoice(dark, "glass", [{ value: false, label: "Off" }, { value: true, label: "On" }], true, (value) => selected.push(value), { label: "Glass" });
  expect(op(group, "p")).toEqual([2]); expect(op(group, "gap")).toEqual([2]); expect(op(group, "rounded")).toEqual([8]);
  for (const name of ["border", "bg"]) expect(op(group, name)).toBeUndefined();
  expect([op(group, "role"), op(group, "accessibility_label")]).toEqual([["group"], ["Glass"]]); // a group with its label
  const [offTip, onTip] = childrenOf(group); const [off, on] = [child(offTip), child(onTip)];
  expect([off.kind, op(offTip, "tooltip"), op(off, "accessibility_label")]).toEqual(["Toggle", undefined, ["Glass: Off"]]); // a worded item: no tooltip (T2), its name stays
  expect(op(off, "h")).toEqual([24]); expect([op(off, "px"), op(off, "border")]).toEqual([[8], [3]]); expect(op(off, "rounded")).toEqual([6]); // 8 + 3 a side, as 10 + 1 were
  expect(op(off, "border_color")).toEqual([`${dark.border.slice(0, 7)}00`]); // the 3 px edge is clear at rest
  expect(op(off, "bg")).toEqual([dark.surface]); expect(op(on, "bg")).toEqual([dark.raised]);
  expect(op(pseudo(on, "hover"), "bg")).toEqual([dark.raised]); expect(op(off, "active")).toBeUndefined();
  expect(op(on, "pressed")).toEqual([true]); expect(op(off, "pressed")).toEqual([false]); // each toggle's state
  expect(op(off, "accessibility_label")).toEqual(["Glass: Off"]);
  op(off, "on_change")[0](true, cxPress); op(on, "on_change")[0](false, cxPress); expect(selected).toEqual([false]); // the chosen one stays
  const disabled = child(childrenOf(ui.segmentedChoice(dark, "off", [{ value: 1, label: "One" }], 0, (v) => selected.push(v), { disabled: true }))[0]);
  for (const name of ["tab_index", "tab_stop", "on_change", "on_key_down"]) expect(op(disabled, name)).toBeUndefined();
  expect(selected).toEqual([false]);
  const nav = child(childrenOf(ui.segmentedChoice(dark, "view", [{ value: "tree", label: "Tree", icon: "list-tree" }], "tree", () => {}, { variant: "navigation" }))[0]);
  expect(op(nav, "w")).toBeUndefined(); expect(op(nav, "size")).toEqual([24]); expect(op(nav, "h")).toEqual([24]); // square (owner, 11 Nov; was 28 wide)
  expect(op(nav, "bg")).toEqual([dark.selected]);
  expect(op(child(nav), "size")).toEqual([14]); expect(op(pseudo(nav, "hover"), "bg")).toEqual([dark.selected]);
  const invalid = child(childrenOf(ui.segmentedChoice(dark, "safe", [{ value: "x", label: "Unknown", icon: "unshipped" }], "x", () => {}))[0]);
  expect(child(invalid)).toBe("Unknown"); // invalid art is a visible text choice, never an empty icon target
  expect(op(group, "on_key_down")).toBeUndefined(); // the keys are the items', so a container (the model switcher) keeps its own
});

// shadcn's toggle group (Radix roving focus, owner 11 Nov): one Tab stop per control, arrows between enabled items,
// wrapping, Home and End, a disabled item skipped and a disabled control no Tab stop. The handles are a stand-in for
// the app's: focus() moves the one focus, is_focused() answers it; made only in the key handler, never in render.
test("segments: one Tab stop, arrows move and wrap, Home and End, a disabled item skipped, Space and Enter choose", () => {
  let focused = null, made = 0, rendering = false;
  const cx = { stop_propagation() {}, notify() {}, focus_handle() { if (rendering) throw new Error("focus_handle in render"); const h = { focus: () => { focused = h; }, is_focused: () => focused === h }; made++; return h; } };
  const chosen = [];
  const items = [{ value: "a", label: "A" }, { value: "b", label: "B" }, { value: "c", label: "C", disabled: true }, { value: "d", label: "D" }];
  const view = {}; // the drawing view: its handles are its own
  const draw = (opts = {}) => { rendering = true; try { return childrenOf(ui.segmentedChoice(dark, "seg", items, "b", (v, e, cx2) => chosen.push([v, e, cx2 === cx]), { owner: view, ...opts })).map(child); } finally { rendering = false; } };
  const stops = (toggles) => toggles.flatMap((x, i) => (op(x, "tab_stop")?.[0] === true ? [i] : []));
  const key = (toggles, i, k) => op(toggles[i], "on_key_down")[0]({ key: k, modifiers: {} }, cx);
  const at = (toggles) => toggles.findIndex((x) => op(x, "track_focus")?.[0]?.is_focused());
  let g = draw();
  expect(stops(g)).toEqual([1]); // Tab reaches the control once, on the chosen item
  expect(op(g[2], "tab_index")).toBeUndefined(); expect(op(g[2], "on_key_down")).toBeUndefined(); // the disabled one is never focused
  key(g, 1, "right"); expect(made).toBe(4); g = draw(); expect([at(g), stops(g)]).toEqual([3, [3]]); // C is skipped; the stop follows focus
  key(g, 3, "right"); g = draw(); expect(at(g)).toBe(0); // wraps to the start
  key(g, 0, "left"); g = draw(); expect(at(g)).toBe(3); // and to the end
  key(g, 3, "up"); g = draw(); expect(at(g)).toBe(1);
  key(g, 1, "down"); g = draw(); expect(at(g)).toBe(3);
  key(g, 3, "home"); g = draw(); expect(at(g)).toBe(0);
  key(g, 0, "end"); g = draw(); expect([at(g), stops(g)]).toEqual([3, [3]]);
  expect(made).toBe(4); // kept by id across renders, never remade
  key(g, 3, "a"); key(g, 3, "tab"); g = draw(); expect(at(g)).toBe(3); // other keys pass on
  op(g[3], "on_change")[0](true, cx); expect(chosen).toEqual([["d", null, true]]); // Space or Enter is base Toggle's own click, which runs on_change
  op(g[1], "on_change")[0](false, cx); expect(chosen.length).toBe(1); // the chosen item stays chosen
  focused = null; g = draw(); expect(stops(g)).toEqual([1]); // once focus leaves, the stop is the chosen item again
  g = draw({ disabled: true }); expect(stops(g)).toEqual([]); for (const x of g) expect(op(x, "tab_index")).toBeUndefined(); // a disabled control is no Tab stop
  const none = childrenOf(ui.segmentedChoice(dark, "seg2", items, "c", () => {})).map(child); expect(stops(none)).toEqual([0]); // chosen disabled: the first enabled
});

test("C2 overlay header has 40px/12px/16px medium hierarchy, complete title and the explicit preview variant", () => {
  const trailing = ui.textButton(dark, "close", "Close", "Close", () => {});
  const head = ui.overlayHeader(dark, "head", "A long title", { trailing });
  expect(op(head, "h")).toEqual([40]); expect(op(head, "px")).toEqual([12]); expect(op(head, "gap")).toEqual([8]);
  const title = childrenOf(head)[0]; expect(op(title, "text_size")).toEqual([16]); expect(op(title, "font_medium")).toEqual([]);
  expect(op(title, "tooltip")).toBeUndefined(); expect(op(title, "accessibility_label")).toEqual(["A long title"]); expect(childrenOf(head)[1]).toBe(trailing);
  const doc = ui.overlayHeader(dark, "doc", "photo.png", { document: true, subtitle: "200×100", ground: dark.canvas });
  expect(op(doc, "gap")).toEqual([12]); expect(op(doc, "px")).toEqual([16]); expect(op(doc, "bg")).toEqual([dark.canvas]);
  expect(op(childrenOf(childrenOf(doc)[0])[0], "text_size")).toEqual([13]);
  expect(op(childrenOf(childrenOf(doc)[0])[1], "text_size")).toEqual([11]);
});

test("C15 overlay frame owns exactly one large shadow or delegates the complete frame to its host", () => {
  const own = ui.overlayFrame(dark, "own");
  expect(op(own, "bg")).toEqual([dark.popover]); expect(op(own, "rounded")).toEqual([8]); expect(op(own, "border")).toEqual([1]);
  expect(own.ops.filter((o) => o[0] === "shadow_lg").length).toBe(1);
  expect(op(own, "p")).toBeUndefined(); // header inset is not doubled by body padding
  const host = ui.overlayFrame(dark, "host", { hostFrame: true });
  for (const name of ["shadow_lg", "border", "rounded"]) expect(op(host, name)).toBeUndefined();
});

test("C5 actions keep geometry through neutral/filled/disabled states and keyboard/click callbacks", () => {
  let n = 0;
  for (const { t } of THEMES) {
    const b = ui.actionButton(t, "apply", "Apply", "Apply", () => n++);
    expect(op(b, "h")).toEqual([28]); expect(op(b, "px")).toEqual([12]); expect(op(b, "rounded")).toEqual([8]); expect(op(b, "text_size")).toEqual([12]);
    expect(op(b, "active")).toBeUndefined();
    const primary = ui.actionButton(t, "attach", "Attach", "Attach files", () => {}, { variant: "primary" });
    expect(op(primary, "bg")).toEqual([t.solid]); expect(op(primary, "text_color")).toEqual([t.solid_foreground]);
    expect(op(pseudo(primary, "hover"), "bg")).toEqual([t.solid]); expect(op(primary, "active")).toBeUndefined();
    op(b, "on_key_down")[0]({ key: "enter" }, cxPress); op(b, "on_key_down")[0]({ key: "space" }, cxPress); op(b, "on_click")[0]({}, cxPress);
    const off = ui.actionButton(t, "off", "Attach", "Unavailable", () => n++, { variant: "primary", disabled: true });
    expect(op(off, "bg")).toEqual([t.surface]); expect(op(off, "text_color")).toEqual([t.dim]);
    for (const name of ["hover", "active", "focus", "tab_index"]) expect(op(off, name)).toBeUndefined();
    op(off, "on_click")[0]({}, cxPress);
    const sendOff = ui.actionButton(t, "send-off", "↑", "Send unavailable", () => n++, { variant: "send", disabled: true });
    expect(op(sendOff, "bg")).toEqual([t.raised]); expect(op(sendOff, "text_color")).toEqual([t.dim]);
    expect(op(sendOff, "h")).toEqual([28]); expect(op(sendOff, "w")).toEqual([28]); expect(op(sendOff, "rounded")).toEqual([14]);
    for (const name of ["hover", "active", "focus", "tab_index"]) expect(op(sendOff, name)).toBeUndefined();
    op(sendOff, "on_click")[0]({}, cxPress);
  }
  expect(n).toBe(THEMES.length * 3);
  const play = ui.actionButton(dark, "play", "Play", "Play", () => {}, { variant: "play" });
  expect(op(play, "h")).toEqual([40]); expect(op(play, "px")).toEqual([20]); expect(op(play, "rounded")).toEqual([20]);
  const send = ui.actionButton(dark, "send", "↑", "Send", () => {}, { variant: "send" });
  expect(op(send, "h")).toEqual([28]); expect(op(send, "w")).toEqual([28]); expect(op(send, "rounded")).toEqual([14]);
  expect(op(send, "bg")).toEqual([dark.accent]); expect(op(pseudo(send, "hover"), "border_color")).toEqual([dark.accent_foreground]);
});

test("C7 data-card states retain surface, selected border and semantic fill", () => {
  const card = ui.interactionStyle(ui.fitLabel("card", "Data"), dark, { variant: "data", selected: true, selectedBorder: true, ground: dark.surface });
  expect(op(card, "bg")).toEqual([dark.surface]); expect(op(card, "border_color")).toEqual([dark.accent]);
  expect(op(pseudo(card, "hover"), "bg")).toEqual([dark.surface]); expect(op(pseudo(card, "hover"), "border_color")).toEqual([dark.accent]);
});

test("C8 field frame reserves one input border and follows only actual child focus; C14 keeps full labels", () => {
  const idle = ui.fieldFrame(ui.fitLabel("idle", "value"), dark);
  const focus = ui.fieldFrame(ui.fitLabel("focus", "value"), dark, { focused: true });
  const off = ui.fieldFrame(ui.fitLabel("off", "value"), dark, { focused: true, disabled: true });
  expect(op(idle, "border")).toEqual([1]); expect(op(idle, "border_color")).toEqual([dark.input]);
  expect(op(focus, "border_color")).toEqual([dark.accent]); expect(op(off, "border_color")).toEqual([dark.input]); expect(op(off, "text_color")).toEqual([dark.dim]);
  for (const f of [idle, focus, off]) for (const name of ["tab_index", "hover", "active", "focus"]) expect(op(f, name)).toBeUndefined();
  const full = "A complete long failure and its original path /tmp/example";
  const fit = ui.fitLabel("receipt", full); expect(op(fit, "id")).toEqual(["receipt"]); expect(op(fit, "min_w")).toEqual([0]);
  expect(op(fit, "truncate")).toEqual([]); expect(op(fit, "tooltip")).toBeUndefined(); expect(op(fit, "accessibility_label")).toEqual([full]); expect(child(fit)).toBe(full);
});

test("design-system C1, C4, C5, C8, C9, C10, C11, C12, C13, C14, C15 in chat, pane and preview use the shared parts", () => {
  const chat = readFileSync(join(ROOT, "mods/pdk-chat/main.js"), "utf8");
  const media = readFileSync(join(ROOT, "mods/pdk-chat/media.js"), "utf8");
  const pane = readFileSync(join(ROOT, "mods/pdk-pane/main.js"), "utf8");
  const preview = readFileSync(join(ROOT, "mods/pdk-preview/main.js"), "utf8");
  expect(chat).toMatch(/segmentedChoice\(t, "effort-group"/); // C1
  expect(chat).not.toMatch(/id\("effort-group"\)\.p\(/);
  expect(chat).toMatch(/workingText\(t, "chat-working-word", "Working"/); // C4: the shared working pair (12 Nov)
  expect(chat).toMatch(/statusMarker\(t, "needs", "chat-needs"\)/);
  expect(chat).toMatch(/actionButton\(t, "send", "↑", "Send"/); // C5, C13
  expect(chat).toMatch(/return actionButton\(t, id, label, label/);
  expect(media).toMatch(/focusRing\(v_flex\(\), t, press\)/);
  expect(preview).toMatch(/actionButton\(t, "play"/);
  expect(chat).toMatch(/fieldFrame\(v_flex\(\)\.id\("composer-box"\)/); // C8
  expect(readFileSync(join(ROOT, "layouts/tremor.json"), "utf8")).toMatch(/"focus": \{ "width": 1, "color": "accent" \}/);
  for (const src of [chat, pane]) expect(src).not.toMatch(/bg\(t\.background\)/); // C9
  expect(pane).toMatch(/\.child\(name\)\)\n\s+\.children\(\[statusMarker\(t, word, `ph-st-\$\{pane\}`\)\]\.filter\(Boolean\)\)/); // the status by the name (owner, 11 Nov)
  expect(pane).toMatch(/\.when\(!p\.zoomed, \(el\) => el\.absolute\(\)\.top\(0\)\.bottom\(0\)\.right\(0\)/); // C10: over the path, so nothing moves on hover
  expect(pane).not.toMatch(/\.when\(this\.hovered, \(el\) => el\n/);
  // C11: UI words never in terminal red. The code view's diff lines and counts are code, coloured as Herdr's own
  // Changes view colours them (ansi2 / ansi1), so its helpers are left out of this check.
  const ui = chat.slice(0, chat.indexOf("const shortPath")) + chat.slice(chat.indexOf("export default class"));
  for (const src of [ui, media]) expect(src).not.toMatch(/text_color\(t\.ansi1\)|bg\(t\.ansi1\)/);
  expect(chat).toMatch(/bg\(pct >= 80 \? t\.blocked : t\.muted\)/); // C12
  expect(media).toMatch(/const PLAY = 32;/); // C13
  for (const id of ["mdl-d-", "composer-hint"]) expect(chat).toContain(`fitLabel(\`${id}`.replace("\`composer", '"composer')); // C14
  expect(readFileSync(join(ROOT, "mods/pdk-chat/tools.js"), "utf8")).toContain("fitLabel(`tcd-"); // a tool call's detail, since the thread design
  expect(preview).toMatch(/fitLabel\("preview-name"/);
  expect(preview).toMatch(/fitLabel\("preview-note", note\)/);
  expect(chat).toMatch(/overlayFrame\(t, "model-switcher"\)/); // C15
  expect(chat).toMatch(/overlayFrame\(t, "slash-menu"\)/);
  expect(chat).not.toMatch(/shadow_md/);
});

// ---- The design system's components (spec section 1, the visual contract's values) ----

test("keys read as glyphs: one binding normalised once, multi-stroke kept, a trailing minus kept; unbound shows nothing", () => {
  expect(ui.keyGlyphs("cmd-shift-p")).toEqual([["⌘", "⇧", "P"]]);
  expect(ui.keyGlyphs("cmd-k cmd-t")).toEqual([["⌘", "K"], ["⌘", "T"]]);
  expect(ui.keyGlyphs("ctrl-alt-enter")).toEqual([["⌃", "⌥", "↵"]]);
  expect(ui.keyGlyphs("cmd--")).toEqual([["⌘", "-"]]);
  state.keys = [{ section: "global", keys: "cmd-t", action: "tab.new" }, { section: "layout:tremor", keys: "cmd-k", action: "mod.open:pdk-search" },
    { section: "global", keys: "cmd-p", action: "mod.open:pdk-search" }];
  expect(ui.shortcut("tab.new")).toEqual([["⌘", "T"]]);
  expect(ui.shortcut("mod.open:pdk-search")).toEqual([["⌘", "K"]]); // the layout's own binding first
  expect(ui.shortcut("app.nothing")).toBeNull();
  state.keys = [];
});

test("kbd: 20 px boxes, 4 px sides and corner, 12/500 muted on the foreground's 7% wash over its ground; plain is dim text", () => {
  const k = ui.kbd(dark, ["⌘", "T"]);
  const keyBoxes = childrenOf(childrenOf(k)[0]);
  expect(keyBoxes.map(child)).toEqual(["⌘", "T"]);
  expect([op(keyBoxes[0], "h"), op(keyBoxes[0], "min_w"), op(keyBoxes[0], "px"), op(keyBoxes[0], "rounded")]).toEqual([[20], [20], [4], [4]]);
  expect([op(keyBoxes[0], "text_size"), op(keyBoxes[0], "text_color")]).toEqual([[12], [dark.muted]]);
  expect(op(keyBoxes[0], "bg")).toEqual([ui.fgWash(dark, 0.07, dark.popover)]);
  expect(ui.fgWash({ foreground: "#f5f5f5", popover: "#111111", surface: "#0a0a0a" }, 0.07)).toBe("#212121"); // the contract's kbdWash
  const plain = childrenOf(childrenOf(ui.kbd(dark, [["⌘", "K"], ["⌘", "T"]], { plain: true }))[1])[0];
  expect(op(plain, "bg")).toBeUndefined(); expect(op(plain, "text_color")).toEqual([dark.dim]);
  expect(op(ui.kbd(dark, ["⌘", "T"]), "on_click")).toBeUndefined();
});

test("button: base Button, sizes 24/28/32, no key press of its own, disabled at .5 and out of the Tab order, presses stop", () => {
  let n = 0;
  const b = ui.button(dark, "go", { text: "Open", onPress: () => n++, size: "md", variant: "primary" });
  expect(b.kind).toBe("Button");
  expect([op(b, "h"), op(b, "px"), op(b, "border"), op(b, "rounded"), op(b, "bg")]).toEqual([[32], [11], [3], [6], [dark.accent]]); // 11 + 3 a side, as 12 + 2 were
  op(b, "on_key_down")[0]({ key: "enter" }, cxPress); expect(n).toBe(0); // activation is base's; the key only marks the keyboard
  expect(op(b, "tab_index")).toEqual([0]);
  op(b, "on_click")[0]({}, cxPress); expect(n).toBe(1);
  const off = ui.button(dark, "no", { text: "Open", onPress: () => n++, disabled: true });
  expect(op(off, "opacity")).toEqual([0.5]); expect(op(off, "tab_index")).toBeUndefined();
  op(off, "on_click")[0]({}, cxPress); expect(n).toBe(1);
  expect(op(ui.button(dark, "x", { text: "X", size: "xs" }), "h")).toEqual([24]);
  expect(op(ui.iconButton(dark, "i", "settings", "Settings", () => {}), "size")).toEqual([28]); // the spec's default
});

test("progress bar: base Progress announces the clamped value; the track fills its row, 4 high, input; unknown draws no fill", () => {
  const bar = ui.progressBar(dark, "p", 1.4, { color: dark.done, label: "Codex 7d" });
  expect(bar.kind).toBe("Progress"); expect(op(bar, "value")).toEqual([100]); expect(op(bar, "accessibility_label")).toEqual(["Codex 7d"]);
  expect([op(bar, "flex_1"), op(bar, "min_w")]).toEqual([[], [0]]);
  const track = child(bar); expect([op(track, "h"), op(track, "bg"), op(track, "w_full")]).toEqual([[4], [dark.input], []]);
  expect(op(child(track), "w")).toEqual(["100.0%"]); expect(op(child(track), "bg")).toEqual([dark.done]);
  const half = child(child(ui.progressBar(dark, "q", 0.49))); expect(op(half, "w")).toEqual(["49.0%"]);
  const unknown = ui.progressBar(dark, "u", null);
  expect(op(unknown, "value")).toBeUndefined(); expect(op(unknown, "indeterminate")).toEqual([true]); expect(child(child(unknown))).toBeUndefined();
});

test("tooltip, menu, popover and sidebar row follow the contract", () => {
  const trigger = ui.iconButton(dark, "t", "settings", "Settings", () => {});
  // The app's own tooltip on the trigger itself, its words then its keys (owner, 11 Nov: a HoverCard's card, which
  // blocks the mouse, lay over its trigger in the top bar and took the click).
  const tip = ui.tooltip(dark, "tip", trigger, "New tab", { keys: ["⌘", "T"] });
  expect([tip, op(tip, "tooltip")]).toEqual([trigger, ["New tab ⌘T"]]);
  expect(op(ui.tooltip(dark, "tip2", ui.iconButton(dark, "u", "settings", "Settings", () => {}, { tip: false }), "Settings"), "tooltip")).toEqual(["Settings"]);
  const frame = ui.menuFrame(dark, "m", []); expect([op(frame, "p"), op(frame, "rounded"), op(frame, "min_w"), op(frame, "role")]).toEqual([[4], [8], [160], ["menu"]]);
  let picked = 0;
  const item = ui.menuItem(dark, "mi", { text: "New workspace", keys: ["⌘", "N"], onPress: () => picked++ });
  expect(item.kind).toBe("Button"); expect([op(item, "h"), op(item, "px"), op(item, "rounded"), op(item, "text_size"), op(item, "role")]).toEqual([[28], [8], [4], [13], ["menu_item"]]);
  op(item, "on_click")[0]({}, cxPress); expect(picked).toBe(1);
  const danger = ui.menuItem(dark, "md", { text: "Close", destructive: true }); expect(op(danger, "text_color")).toEqual([dark.ansi1]);
  const pop = ui.popover(dark, "pp", { trigger, content: frame, open: true, onOpenChange: () => {} });
  expect(pop.kind).toBe("Popover"); expect(op(pop, "open")).toEqual([true]);
  expect(op(ui.popover(dark, "pq", { trigger, content: frame }), "open")).toBeUndefined(); // uncontrolled
  const ws = ui.sidebarRow(dark, "ws", { text: "tremor" }), agent = ui.sidebarRow(dark, "ag", { text: "Sidebar", kind: "agent", selected: true });
  expect([op(ws, "h"), op(ws, "pl"), op(ws, "gap"), op(ws, "rounded"), op(ws, "font_medium")]).toEqual([[28], [4], [4], [6], []]);
  expect([op(agent, "h"), op(agent, "pl"), op(agent, "pr"), op(agent, "gap"), op(agent, "bg"), op(agent, "font_medium")]).toEqual([[28], [16], [8], [8], [dark.selected], undefined]);
  expect(op(ui.sidebarRow(dark, "a2", { text: "Review", kind: "agent" }), "text_color")).toEqual([ui.softInk(dark)]);
  expect(op(agent, "tab_index")).toBeUndefined(); // the list owns focus
});

// The machine selector's menu (owner, 11 Nov): one of a choice marks the current one with the `selected` fill, as the
// chat's model menu does, and says "current" in its accessible name: a Button carries no checked state (gpui-kit limits
// `checked` to Checkbox, Switch and Radio; review RC05), so none is set. A note ("Sign in") is drawn after the words,
// dim, and is in the accessible name. An item without `checked` is a plain menu item, as before.
test("menuItem: a checked item in the selected fill, named current; no checked state on the Button; a note drawn dim and named", () => {
  const on = ui.menuItem(dark, "a", { text: "box", icon: "server", checked: true }), off = ui.menuItem(dark, "b", { text: "far", checked: false, note: "Sign in" });
  expect([on.kind, op(on, "role"), op(on, "checked"), op(on, "accessibility_label"), op(on, "bg"), op(on, "text_color"), op(pseudo(on, "hover"), "bg")])
    .toEqual(["Button", ["menu_item"], undefined, ["box, current"], [dark.selected], [dark.foreground], [dark.selected]]);
  expect([op(off, "role"), op(off, "checked"), op(off, "bg"), op(off, "accessibility_label"), op(pseudo(off, "hover"), "bg")])
    .toEqual([["menu_item"], undefined, undefined, ["far, Sign in"], [dark.hover]]);
  expect(op(ui.menuItem(dark, "c", { text: "box", note: "Sign in", checked: true }), "accessibility_label")).toEqual(["box, Sign in, current"]);
  const note = childrenOf(off).at(-1);
  expect([child(note), op(note, "text_size"), op(note, "text_color")]).toEqual(["Sign in", [11], [dark.dim]]);
  expect(op(ui.menuItem(dark, "c", { text: "Add machine", icon: "plus" }), "role")).toEqual(["menu_item"]);
});

// shadcn round (owner, 11 Nov: "match shadcn ... disabled opacity"): shadcn's disabled:opacity-50
// disabled:pointer-events-none. Every shared button-like control, disabled: half opacity, no hover or pressed change,
// no pointer cursor, nothing on a press or a key, not a Tab stop, still announced as disabled.
test("every disabled shared control draws at 0.5, does nothing on a press or a key, is no Tab stop and says it is disabled", () => {
  expect(ui.DISABLED).toBe(0.5);
  let n = 0;
  const go = () => n++;
  const seg = (icon) => child(childrenOf(ui.segmentedChoice(dark, "sg", [{ value: 1, label: "One", icon }], 0, go, { disabled: true }))[0]); // the Toggle in its tooltip wrapper
  const all = {
    text: ui.textButton(dark, "t", "Apply", "Apply", go, { disabled: true }),
    icon: ui.iconButton(dark, "i", "search", "Search", go, { disabled: true }),
    button: ui.button(dark, "b", { text: "Open", onPress: go, disabled: true }),
    menu: ui.menuItem(dark, "m", { text: "Rename", onPress: go, disabled: true }),
    action: ui.actionButton(dark, "a", "Attach", "Attach", go, { variant: "primary", disabled: true }),
    segText: seg(undefined), segIcon: seg("list-tree"),
  };
  for (const [name, el] of Object.entries(all)) {
    expect(op(el, "opacity"), name).toEqual([0.5]);
    expect(op(el, "disabled"), name).toEqual([true]);
    for (const k of ["hover", "active", "focus", "tab_index", "tab_stop", "cursor_pointer", "on_key_down", "on_change", "track_focus"]) expect(op(el, k), `${name} ${k}`).toBeUndefined();
    op(el, "on_click")?.[0]({}, cxPress); // a segment's Toggle has no on_click: it chooses through on_change, which a disabled one lacks
  }
  expect(n).toBe(0);
});

// shadcn round (owner, 11 Nov: "match shadcn ... pressed look"): shadcn's button has no active: style. No shared
// control changes its fill or ink while it is held; one switched on keeps its selected fill, which is state.
test("no shared control darkens while it is held; a switched-on one keeps its selected fill", () => {
  const items = (variant) => childrenOf(ui.segmentedChoice(dark, "sg", [{ value: 1, label: "One" }, { value: 2, label: "Two", icon: "list-tree" }], 1, () => {}, { variant })).map(child);
  const all = {
    text: ui.textButton(dark, "t", "Apply", "Apply", () => {}), icon: ui.iconButton(dark, "i", "search", "Search", () => {}),
    caret: ui.caretButton(dark, "c", false, "Expand", () => {}),
    ghost: ui.button(dark, "b", { text: "Open" }), primary: ui.button(dark, "p", { text: "Open", variant: "primary" }), outline: ui.button(dark, "o", { text: "Open", variant: "outline" }),
    menu: ui.menuItem(dark, "m", { text: "Rename" }),
    action: ui.actionButton(dark, "a", "Apply", "Apply", () => {}), solid: ui.actionButton(dark, "s", "Go", "Go", () => {}, { variant: "primary" }),
    send: ui.actionButton(dark, "sd", "↑", "Send", () => {}, { variant: "send" }), play: ui.actionButton(dark, "pl", "Play", "Play", () => {}, { variant: "play" }),
    choice: items("choice")[0], choiceOff: items("choice")[1], nav: items("navigation")[0], navOff: items("navigation")[1],
    row: ui.rowStates(ui.fitLabel("r", "Row"), dark, { selected: true }),
  };
  for (const [name, el] of Object.entries(all)) expect(op(el, "active"), name).toBeUndefined();
  // State stays: a pressed icon button, a chosen segment and a selected row keep their fill at rest and under the pointer.
  const on = ui.iconButton(dark, "on", "minimize-2", "Restore", () => {}, { pressed: true });
  for (const [el, fill] of [[on, dark.selected], [all.choice, dark.raised], [all.nav, dark.selected], [all.row, dark.selected]])
    expect([op(el, "bg"), op(pseudo(el, "hover"), "bg") ?? op(el, "bg")]).toEqual([[fill], [fill]]);
  expect(op(ui.button(dark, "bp", { text: "On", pressed: true }), "bg")).toEqual([dark.selected]);
});

// shadcn round (owner, 11 Nov: "match shadcn focus ring"): focus-visible:ring-[3px] ring-ring/50, so the ring shows
// for keyboard focus only. The pack's rule (focusRing): a press marks the pointer in one shared value and every
// control then declares no focus look; a key down or up on a focused control (Tab's key up lands on the control it
// moved to) clears it. setShared redraws every view, so a re-render here is what the app does next.
test("the 3 px ring shows after Tab, never after a press, and a press after Tab hides it", () => {
  state.shared = {};
  const cxKey = { stop_propagation() {}, notify() {}, focus_handle: () => ({ focus() {}, is_focused: () => false }) };
  const ring = `${dark.accent.slice(0, 7)}80`;
  const look = (el) => (op(el, "focus") ? pseudo(el, "focus").ops : null);
  const make = {
    icon: () => ui.iconButton(dark, "i", "search", "Search", () => {}),
    text: () => ui.textButton(dark, "t", "Apply", "Apply", () => {}),
    caret: () => ui.caretButton(dark, "c", false, "Expand", () => {}),
    button: () => ui.button(dark, "b", { text: "Open" }),
    segment: () => child(childrenOf(ui.segmentedChoice(dark, "sg", [{ value: 1, label: "One" }, { value: 2, label: "Two" }], 1, () => {}))[1]),
  };
  const want = { icon: ring, text: ring, caret: ring, button: ring, segment: ring };
  const press = (el) => op(el, "on_mouse_down")[1]({}, cxPress);
  const realNow = Date.now; let now = 1e9; Date.now = () => (now += 1000); // a second between inputs: no key held across a press
  for (const [name, draw] of Object.entries(make)) {
    state.shared = {};
    let el = draw();
    press(el); el = draw(); // a press first: no ring
    expect(look(el), `${name} after a press`).toBeNull();
    op(el, "on_key_up")[0]({ key: "tab" }, cxPress); el = draw(); // Tab lands on it
    expect(look(el), `${name} after Tab`).toEqual([["border_color", want[name]]]);
    press(el); el = draw(); // a press after Tab
    expect(look(el), `${name} pressed after Tab`).toBeNull();
    op(el, "on_key_down")[0]({ key: "right" }, cxKey); el = draw(); // an arrow key inside a group (a segment's moves focus too)
    expect(look(el), `${name} after an arrow`).toEqual([["border_color", want[name]]]);
    op(el, "on_mouse_down_out")[0]({}, cxPress); el = draw(); // a press anywhere else
    expect(look(el), `${name} after a press elsewhere`).toBeNull();
  }
  // The ring's width is in the box from the start: no control changes size or moves its glyph when it shows.
  for (const name of ["icon", "text", "caret", "button", "segment"]) expect(op(make[name](), "border"), name).toEqual([3]);
  Date.now = realNow;
  state.shared = {};
});

// shadcn round (lead, 11 Nov): no held look anywhere in the pack, not only in the shared components: the chat's
// fold rows, "show earlier", its tool and media cards no longer darken or change edge while held.
test("no pack code declares a held look", () => {
  const bad = OWNED.flatMap((d) => files(join(ROOT, d))).filter((f) => /\.active\(\(/.test(readFileSync(f, "utf8"))).map((f) => f.slice(ROOT.length));
  expect(bad).toEqual([]);
});

// The segments' focus handles are kept by control id; the pane header adds one id per pane, so the store is capped
// at 64 ids, the oldest dropped first. A dropped control makes its handles again on its next arrow key.
test("segment focus handles are kept for at most 64 controls per view, and replaced or dropped ones are released (review R3)", () => {
  let live = 0;
  const cx = { stop_propagation() {}, notify() {}, focus_handle: () => { live++; let on = true; return { focus() {}, is_focused: () => false, release() { if (on) { on = false; live--; } return true; } }; } };
  const view = {};
  const two = [{ value: 1, label: "One" }, { value: 2, label: "Two" }], three = [...two, { value: 3, label: "Three" }];
  const first = (id, items = two) => child(childrenOf(ui.segmentedChoice(dark, id, items, 1, () => {}, { owner: view }))[0]);
  const arrow = (id, items) => op(first(id, items), "on_key_down")[0]({ key: "right", modifiers: {} }, cx);
  arrow("cap-0");
  expect(op(first("cap-0"), "track_focus")).toBeDefined();
  for (let i = 1; i <= 65; i++) arrow(`cap-${i}`);
  expect(live).toBe(64 * 2); // 66 controls arrowed, the app holds 64 controls' handles
  expect(op(first("cap-0"), "track_focus")).toBeUndefined(); // dropped
  arrow("cap-0"); expect(op(first("cap-0"), "track_focus")).toBeDefined(); expect(live).toBe(64 * 2); // navigable again, still bounded
  arrow("cap-0", three); expect(live).toBe(64 * 2 + 1); // the items changed: the old two released, three made
  state.shared = {};
});


// Review R2: a closed overlay's handles are released by the app, and a reopened one is a new view of the same module.
// The handles belong to the view that drew the control: arrow, close, reopen draws and moves again; two views with
// the same id each keep their own, and closing either leaves the other working.
test("segment focus handles belong to their view: reopen and two copies with one id both work", () => {
  const app = () => { // one view's cx: its handles throw once the view is closed, as the app's do
    const mine = []; let focused = null;
    const cx = { stop_propagation() {}, notify() {}, focus_handle() { const h = { dead: false, focus() { if (h.dead) throw new Error("released"); focused = h; },
      is_focused() { if (h.dead) throw new Error("this focus handle has been released"); return focused === h; }, release() { h.dead = true; return true; } }; mine.push(h); return h; } };
    return { owner: {}, cx, close: () => mine.forEach((h) => h.release()), made: () => mine.length };
  };
  const items = [{ value: "a", label: "A" }, { value: "b", label: "B" }];
  const draw = (v) => childrenOf(ui.segmentedChoice(dark, "search-mode", items, "a", () => {}, { owner: v.owner })).map(child);
  const arrow = (v) => op(draw(v)[0], "on_key_down")[0]({ key: "right", modifiers: {} }, v.cx);
  const at = (v) => draw(v).findIndex((x) => op(x, "track_focus")?.[0]?.is_focused());
  const first = app(); arrow(first); expect(at(first)).toBe(1);
  first.close();
  const again = app(); // the overlay reopened: same module, new view
  expect(() => draw(again)).not.toThrow(); arrow(again); expect([at(again), again.made()]).toEqual([1, 2]);
  const other = app(); arrow(other); // a second copy with the same id at once
  expect(at(other)).toBe(1); expect(op(draw(other)[1], "track_focus")[0]).not.toBe(op(draw(again)[1], "track_focus")[0]);
  other.close(); expect(at(again)).toBe(1); // closing either leaves the other
  const third = app(); arrow(third); again.close(); expect(at(third)).toBe(1); // and the other way round
});

// Review R4 and its recheck (F1), the owner's rule: any Tab or Shift+Tab shows the ring at once and only a pointer
// press hides it. A Tab whose key-down a field owned lands here on its key-up, however soon after a press; another
// key's key-up counts only for a key-down seen after the latest press. Accepted limit: Tab held across a press.
test("Tab or Shift+Tab onto a control shows the ring at once, even right after a press on a field, in any mod", () => {
  const realNow = Date.now; let now = 3e9; Date.now = () => now;
  const ring = `${dark.accent.slice(0, 7)}80`;
  const draw = (u) => u.iconButton(dark, "i", "search", "Search", () => {});
  const shown = (u) => (op(draw(u), "focus") ? pseudo(draw(u), "focus").ops : null);
  const tab = (shift) => ({ key: "tab", modifiers: { shift } });
  try {
    for (const [here, there] of [[ui, ui], [ui, other], [other, ui]]) for (const shift of [false, true]) {
      const name = `${here === there ? "one mod" : "two mods"} shift=${shift}`;
      state.shared = {};
      op(draw(there), "on_mouse_down_out")[0]({}, cxPress); // a press on a field, seen by a control's outside listener
      expect(shown(here), `${name}: the press hides it`).toBeNull();
      now += 100; op(draw(here), "on_key_up")[0](tab(shift), cxPress); // Tab from the field lands here 100 ms later
      expect(shown(here), `${name}: Tab shows it`).toEqual([["border_color", ring]]);
      expect(shown(there), `${name}: in every mod`).toEqual([["border_color", ring]]);
      op(draw(here), "on_mouse_down")[1]({}, cxPress); // a press afterwards
      expect(shown(here), `${name}: a later press hides it`).toBeNull();
    }
    // Another key keeps exact timing: its key-down seen before the latest press, its key-up doesn't bring the ring back.
    state.shared = {};
    op(draw(ui), "on_key_down")[0]({ key: "a", modifiers: {} }, cxPress); now += 50;
    op(draw(ui), "on_mouse_down")[1]({}, cxPress); now += 50;
    op(draw(ui), "on_key_up")[0]({ key: "a", modifiers: {} }, cxPress);
    expect(shown(ui)).toBeNull();
  } finally { Date.now = realNow; state.shared = {}; }
});


// T3: pack menus have one focus. The keys are bound in PdkMenu, once per module load, and the frame answers each.
test("bindMenuKeys registers the seven menu keys in PdkMenu once; menuFrame declares the context and answers each action", () => {
  const bound = [], cx = { bind_keys: (l) => { bound.push(...l); return l.length; } };
  other.bindMenuKeys(cx); other.bindMenuKeys(cx);
  expect(bound).toEqual(["up", "down", "home", "end", "tab", "shift-tab", "escape"].map((k) => ({ keystroke: k, action: `pdk_menu_${k.replace("-", "_")}`, context: "PdkMenu" })));
  const menu = other.menuState({}, "m");
  const items = ["a", "b", "c"].map((id) => other.menuItem(dark, id, { text: id, menu }));
  other.menuItem(dark, "off", { text: "off", disabled: true, menu }); // skipped
  let closed = 0, at = null;
  const frame = other.menuFrame(dark, "m", items, { menu, close: () => closed++ });
  expect(op(frame, "key_context")).toEqual(["PdkMenu"]);
  const action = (k) => frame.ops.find((o) => o[0] === "on_action" && o[1] === `pdk_menu_${k.replace("-", "_")}`)[2];
  const kcx = { focus_handle: () => { const h = { focus: () => { at = h; }, is_focused: () => at === h }; return h; }, notify() {} };
  action("down")({}, kcx); // nothing focused yet: the first
  const hs = ["a", "b", "c"].map((id) => menu.handles.get(id));
  expect(menu.handles.has("off")).toBe(false);
  expect(at).toBe(hs[0]);
  action("down")({}, kcx); expect(at).toBe(hs[1]);
  action("end")({}, kcx); expect(at).toBe(hs[2]);
  action("down")({}, kcx); expect(at).toBe(hs[0]); // wraps
  action("up")({}, kcx); expect(at).toBe(hs[2]);
  action("home")({}, kcx); expect(at).toBe(hs[0]);
  for (const k of ["tab", "shift-tab", "escape"]) action(k)({}, kcx);
  expect(closed).toBe(3);
  // Drawn again, each item tracks its handle; none is a Tab stop.
  const again = ["a", "b", "c"].map((id) => other.menuItem(dark, id, { text: id, menu }));
  expect(again.map((it) => op(it, "track_focus")?.[0])).toEqual(hs);
  for (const it of again) { expect(op(it, "tab_index")).toBeUndefined(); expect(op(it, "tab_stop")).toEqual([false]); }
  expect(op(other.menuItem(dark, "plain", { text: "x" }), "tab_index")).toBeUndefined();
});

// T1: the default arrow on controls; the pointing hand is for links only. Chat's sites are its own job's, and Herdr's
// stock add-machine dialog rides along byte for byte.
test("no cursor_pointer in the pack's non-Chat source", () => {
  const hits = OWNED.flatMap((d) => files(join(ROOT, d))).filter((p) => !p.includes("/pdk-chat/") && !p.endsWith("pdk-machine-add/stock.js"))
    .filter((p) => readFileSync(p, "utf8").includes("cursor_pointer"));
  expect(hits).toEqual([]);
});

// T2: a tooltip never repeats a visible label.
test("a worded textButton has no tooltip, a one-character one does, an explicit tip is kept; worded segments have none", () => {
  expect(op(ui.textButton(dark, "w", "Refresh", "Refresh", () => {}), "tooltip")).toBeUndefined();
  expect(op(ui.textButton(dark, "w2", "Close", "Close Files and Changes", () => {}), "tooltip")).toBeUndefined();
  expect(op(ui.textButton(dark, "x", "×", "Close tab", () => {}), "tooltip")).toEqual(["Close tab"]);
  expect(op(ui.textButton(dark, "y", "Run", "Run", () => {}, { tip: "Run in a new tab" }), "tooltip")).toEqual(["Run in a new tab"]);
  expect(op(ui.actionButton(dark, "z", "Focus pane", "Focus pane", () => {}), "tooltip")).toBeUndefined();
  const seg = ui.segmentedChoice(dark, "mode", [{ value: "a", label: "Places" }, { value: "b", label: "Find", icon: "search" }, { value: "c", label: "Own", tooltip: "Own words" }], "a", () => {});
  const tips = seg.ops.filter((o) => o[0] === "children")[0][1].map((w) => op(w, "tooltip"));
  expect(tips).toEqual([undefined, ["mode: Find"], ["Own words"]]);
});
