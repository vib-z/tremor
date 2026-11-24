import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { THEMES, GROUPS, TOKENS, tokenValue, withToken, themeText, normalHex, toHsl, fromHsl, contrast, takesAlpha, PRESET_SOURCES,
  BACKDROP, over, glassFails, glassChrome, isGlass, seeThrough, textGrounds } from "../adapters/tokens.js";
import { readdirSync, mkdtempSync, existsSync, rmSync } from "node:fs";

const dir = new URL("../themes/", import.meta.url);
const load = (name) => JSON.parse(readFileSync(new URL(`${name}.json`, dir), "utf8"));
const ALLOWED_TOP = ["background", "foreground", "selection", "cursor", "ansi", "colors"];

// The names herdr.d.ts documents for theme() (defaults/herdr.d.ts:270-274) plus the terminal's own two.
const HERDR_NAMES = ["background", "surface", "canvas", "chrome", "popover", "raised", "hover", "selected", "border", "input",
  "foreground", "muted", "dim", "accent", "accent_foreground", "solid", "solid_foreground", "selection", "working", "blocked",
  "done", "idle", "unknown", ...Array.from({ length: 16 }, (_, i) => `ansi${i}`)];

test("the token set is Herdr's own names, each in exactly one group", () => {
  for (const n of HERDR_NAMES) expect(TOKENS).toContain(n);
  expect(new Set(TOKENS).size).toBe(TOKENS.length);
  expect(GROUPS.map((g) => g.name)).toEqual(["Surfaces", "Text", "Accent", "States", "Terminal"]);
});

test("every pack theme defines every token, in the shape the app parses", () => {
  for (const name of THEMES) {
    const file = load(name);
    for (const k of Object.keys(file)) expect(ALLOWED_TOP).toContain(k);
    expect(file.ansi.length).toBe(16);
    for (const token of TOKENS) {
      const v = tokenValue(file, token);
      expect(normalHex(v, takesAlpha(token)), `${name} ${token}`).toBe(v);
    }
    // Nothing under colors that isn't a token: the editor shows every colour the theme sets.
    for (const k of Object.keys(file.colors)) expect(TOKENS).toContain(k);
  }
});

test("product-inspired families ship both appearances with readable accents and a complete AAA terminal palette", () => {
  for (const family of ["indigo-graphite", "paper-ink", "quiet-canvas", "cobalt-desk", "forge-slate", "studio-ash"]) {
    for (const mode of ["light", "dark"]) {
      const id = `pdk-${family}-${mode}`;
      expect(THEMES).toContain(id);
      const f = load(id), src = PRESET_SOURCES[id];
      expect(src.source).toMatch(/^https:\/\//);
      expect(src.license).toBe("MIT");
      expect(readFileSync(new URL(`../licenses/${src.licenseFile}`, import.meta.url), "utf8")).toContain("Permission is hereby granted");
      for (const g of textGrounds(f)) expect(contrast(f.colors.accent, g), `${id} accent on ${g}`).toBeGreaterThanOrEqual(4.5);
      for (const [i, c] of f.ansi.entries()) expect(contrast(c, f.background), `${id} ANSI ${i}`).toBeGreaterThanOrEqual(7);
      expect(contrast(f.foreground, f.background), id).toBeGreaterThanOrEqual(7);
    }
  }
});

test("text reads at WCAG AA (4.5:1) on every surface it sits on, in every theme", () => {
  for (const name of THEMES) {
    const f = load(name);
    const v = (t) => tokenValue(f, t);
    // Each panel, and each row or chip surface over it (an overlay with alpha is composited over every panel).
    for (const text of ["foreground", "muted", "dim"]) {
      for (const bg of textGrounds(f)) expect(contrast(v(text), bg), `${name}: ${text} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(v("accent_foreground"), v("accent")), `${name}: accent text`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(v("solid_foreground"), v("solid")), `${name}: solid text`).toBeGreaterThanOrEqual(4.5);
    // Markers are graphics: 3:1 against the sidebar and the panes (WCAG 1.4.11).
    for (const s of ["working", "blocked", "done", "idle"]) {
      for (const bg of ["chrome", "canvas", "background", "surface"]) expect(contrast(v(s), v(bg)), `${name}: ${s} on ${bg}`).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(v("terminal_foreground"), v("background")), `${name}: terminal text`).toBeGreaterThanOrEqual(7);
  }
});

test("moshi has charcoal panels, a bright green accent and muted green highlights", () => {
  const f = load("pdk-moshi");
  const [h, s, l] = toHsl(tokenValue(f, "accent"));
  expect(h).toBeGreaterThan(90);
  expect(h).toBeLessThan(150);
  expect(s).toBeGreaterThan(40);
  expect(l).toBeGreaterThan(50);
  // Owner 22:54: charcoal canvas/cards from the reference, not near-black green panels.
  expect(tokenValue(f, "background")).toBe("#1e1e1e");
  expect(tokenValue(f, "surface")).toBe("#131416");
  expect(tokenValue(f, "raised")).toBe("#21341e");
  expect(tokenValue(f, "selected")).toBe(tokenValue(f, "raised"));
  // The selected row, the active tab and toggle, the user bubble (raised), the composer and pane focus (input),
  // hovers and text selection are green; structural borders stay quiet charcoal.
  for (const t of ["selected", "raised", "hover", "selection", "ring"]) {
    const [hh, ss] = toHsl(tokenValue(f, t));
    expect(hh, t).toBeGreaterThan(90);
    expect(hh, t).toBeLessThan(150);
    expect(ss, t).toBeGreaterThan(25);
  }
});

test("withToken changes one token where the app reads it, and nothing else", () => {
  const f = load("pdk-moshi");
  const a = withToken(f, "accent", "#FF8800");
  expect(a.colors.accent).toBe("#ff8800");
  expect(f.colors.accent).toBe("#5ec269");
  expect(withToken(f, "terminal_foreground", "#123456").foreground).toBe("#123456");
  expect(withToken(f, "ansi10", "#010203").ansi[10]).toBe("#010203");
  expect(withToken(f, "hover", "#ffffff10").colors.hover).toBe("#ffffff10");
  // The terminal palette takes #rrggbb only (herdr-app src/settings.rs:193-195).
  expect(() => withToken(f, "ansi1", "#ffffff10")).toThrow();
  // Mods append alpha to the other tokens themselves, so those stay opaque.
  expect(() => withToken(f, "blocked", "#ffb23e80")).toThrow();
  expect(() => withToken(f, "accent", "green")).toThrow();
  const back = JSON.parse(themeText(a));
  for (const t of TOKENS) if (t !== "accent") expect(tokenValue(back, t)).toBe(tokenValue(f, t));
});

test("HSL round-trips within one step per channel", () => {
  for (const hex of ["#74f066", "#1b4ed8", "#000000", "#ffffff", "#c2410c", "#82987f"]) {
    const back = fromHsl(toHsl(hex));
    for (const i of [1, 3, 5]) expect(Math.abs(parseInt(back.slice(i, i + 2), 16) - parseInt(hex.slice(i, i + 2), 16))).toBeLessThanOrEqual(3);
  }
  expect(fromHsl([120, 100, 50], "80")).toBe("#00ff0080");
});

// themes-more (owner 11:09 and 11:10): every palette tried in testing ships as a preset theme.
test("every preset keeps the colour it was tried with, and every pdk theme file is a pack theme", () => {
  for (const [name, src] of Object.entries(PRESET_SOURCES)) {
    expect(THEMES).toContain(name);
    expect(tokenValue(load(name), src.token), name).toBe(src.value);
  }
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
  expect(files).toEqual([...THEMES].sort());
});

test("presets are whole themes, not one token changed: they differ from their base beyond the tried colour", () => {
  const base = { "pdk-t3-blue-light": "pdk-t3-light", "pdk-t3-navy": "pdk-t3-dark", "pdk-t3-magenta": "pdk-t3-dark", "pdk-moshi-forest": "pdk-moshi", "pdk-moshi-amber": "pdk-moshi" };
  for (const [name, from] of Object.entries(base)) {
    const changed = TOKENS.filter((t) => tokenValue(load(name), t) !== tokenValue(load(from), t));
    expect(changed.length, name).toBeGreaterThan(5);
  }
});

const SURFACES = ["background", "surface", "canvas", "chrome", "popover", "raised", "selected", "hover"];
const changedFrom = (name, from) => TOKENS.filter((t) => tokenValue(load(name), t) !== tokenValue(load(from), t));

// Owner 17:46-17:51 (requests 5b and 7): a green dot is done, a yellow dot needs you, a hollow grey ring is idle.
test("status: done is green, blocked yellow and idle a neutral grey, each 3:1 on every surface of every theme", () => {
  for (const name of THEMES) {
    const f = load(name);
    const v = (t) => tokenValue(f, t);
    const [dh, ds] = toHsl(v("done"));
    const [bh, bs] = toHsl(v("blocked"));
    expect(dh, `${name} done hue`).toBeGreaterThanOrEqual(100);
    expect(dh, `${name} done hue`).toBeLessThanOrEqual(160);
    expect(ds, `${name} done saturation`).toBeGreaterThanOrEqual(40);
    expect(bh, `${name} blocked hue`).toBeGreaterThanOrEqual(40);
    expect(bh, `${name} blocked hue`).toBeLessThanOrEqual(60);
    expect(bs, `${name} blocked saturation`).toBeGreaterThanOrEqual(80);
    expect(toHsl(v("idle"))[1], `${name} idle saturation`).toBeLessThanOrEqual(8);
    for (const s of ["done", "blocked", "idle"]) {
      for (const bg of textGrounds(f)) expect(contrast(v(s), bg), `${name}: ${s} on ${bg}`).toBeGreaterThanOrEqual(3);
    }
    // Mods also write notes in blocked (pdk-chat, pdk-tree, pdk-factory): it stays readable text on the panels.
    for (const bg of ["background", "surface", "popover"]) expect(contrast(v("blocked"), v(bg)), `${name}: blocked text on ${bg}`).toBeGreaterThanOrEqual(4.5);
  }
});

// Owner 17:38 (request 3a): only the sidebar blue, the rest neutral. The two edits as they were tried; rows and chips
// are neutral overlays (black on light, white on dark) so a selected row lightens or darkens the blue instead of
// sitting on it as a grey patch, and dim moves just enough to stay AA on them.
test("the blue-sidebar presets are their base theme with a blue chrome; everything else stays neutral", () => {
  const neutral = (hex) => toHsl(hex.slice(0, 7))[1] <= 8;
  for (const [name, from] of [["pdk-t3-blue-sidebar-light", "pdk-t3-light"], ["pdk-t3-blue-sidebar-dark", "pdk-t3-dark"]]) {
    const changed = changedFrom(name, from);
    expect(changed, name).toContain("chrome");
    for (const t of changed.filter((t) => t !== "chrome")) {
      expect(["raised", "hover", "selected", "muted", "dim"], `${name} ${t}`).toContain(t);
      expect(neutral(tokenValue(load(name), t)), `${name} ${t}`).toBe(true);
    }
    for (const t of ["raised", "hover", "selected"]) expect(tokenValue(load(name), t), `${name} ${t}`).toMatch(/^#(000000|ffffff)[0-9a-f]{2}$/);
    const [h, s] = toHsl(tokenValue(load(name), "chrome"));
    expect(h, name).toBeGreaterThan(200);
    expect(h, name).toBeLessThan(240);
    expect(s, name).toBeGreaterThan(30);
  }
});

// Owner 17:37 (request 2): the frosted variant. Its text is checked over what the layout paints behind the sidebar.
test("the glass presets: translucent chrome over the blue-sidebar look, AA over the backdrop's darkest and lightest", () => {
  for (const [name, from] of [["pdk-t3-glass-light", "pdk-t3-blue-sidebar-light"], ["pdk-t3-glass-dark", "pdk-t3-blue-sidebar-dark"]]) {
    const f = load(name);
    expect(isGlass(f), name).toBe(true);
    expect(tokenValue(f, "chrome").slice(0, 7)).toBe(tokenValue(load(from), "chrome"));
    // Beyond chrome only neutral greys move: stronger text, so glass can be more see-through, and T3's opaque row and
    // chip surfaces, which read as solid pills on the glass and keep its text AA without costing see-through.
    for (const t of changedFrom(name, from).filter((t) => t !== "chrome")) {
      expect(["muted", "dim", "idle", "raised", "hover", "selected"], `${name} ${t}`).toContain(t);
      expect(toHsl(tokenValue(f, t))[1], `${name} ${t}`).toBeLessThanOrEqual(8);
    }
    expect(glassFails(f), name).toEqual([]);
    expect(tokenValue(f, "chrome")).toBe(name.endsWith("light") ? "#eef2ffb3" : "#101828b3");
    expect(seeThrough(f), name).toBe(9);
  }
});

test("the Glass toggle on every pack theme: on passes over the backdrop at the least alpha that does, off is opaque again", () => {
  for (const name of THEMES) {
    const f = load(name);
    const value = glassChrome(f, true);
    const on = withToken(f, "chrome", value);
    expect(isGlass(on), name).toBe(true);
    expect(glassFails(on), name).toEqual([]);
    const a = parseInt(value.slice(7), 16);
    if (a > 1) expect(glassFails(withToken(f, "chrome", value.slice(0, 7) + (a - 1).toString(16).padStart(2, "0"))).length, name).toBeGreaterThan(0);
    expect(withToken(on, "chrome", glassChrome(on, false)).colors.chrome, name).toBe(tokenValue(f, "chrome").slice(0, 7));
  }
  // The checks do fail: T3 light's own dim text on a quarter-opaque sidebar over the backdrop's darkest.
  expect(glassFails(withToken(load("pdk-t3-light"), "chrome", "#fcfcfc40")).some((x) => x.startsWith("dim on"))).toBe(true);
  expect(over("#ffffff80", "#000000")).toBe("#808080");
});

test("the worst case behind the glass: the layout paints the indexed backdrop under the root only, inside BACKDROP's bounds", () => {
  const png = readFileSync(new URL("../backgrounds/busy.png", import.meta.url));
  expect(png[25], "colour type 3: every colour on the image is in its palette").toBe(3);
  let at = 8, palette = null;
  while (at < png.length && !palette) {
    const len = png.readUInt32BE(at), kind = png.toString("latin1", at + 4, at + 8);
    if (kind === "PLTE") palette = png.subarray(at + 8, at + 8 + len);
    at += 12 + len;
  }
  const lo = parseInt(BACKDROP.darkest.slice(1, 3), 16), hi = parseInt(BACKDROP.lightest.slice(1, 3), 16);
  expect(BACKDROP.darkest).toBe("#" + lo.toString(16).repeat(3));
  expect(BACKDROP.lightest).toBe("#" + hi.toString(16).repeat(3));
  expect(palette.length).toBeGreaterThanOrEqual(3 * 8);
  for (const c of palette) {
    expect(c).toBeGreaterThanOrEqual(lo);
    expect(c).toBeLessThanOrEqual(hi);
  }
  // The root paints the image; the sidebar column paints chrome under pdk-tree's chrome (the two layers glassGrounds
  // counts); the work column is opaque canvas, so the backdrop shows only behind the sidebar.
  const layout = JSON.parse(readFileSync(new URL("../layouts/tremor.json", import.meta.url), "utf8"));
  const node = (id) => layout.children.find((c) => c.id === id);
  expect(layout.background).toEqual({ image: BACKDROP.image, fit: "cover" });
  expect(node("sidebar").background).toBe("chrome");
  expect(node("work").background).toBe("canvas");
  expect(readFileSync(new URL("../mods/pdk-tree/main.js", import.meta.url), "utf8")).toMatch(/\.bg\(t\.chrome\)/);
});

test("install puts the backdrop where the layout reads it, and uninstall removes it", () => {
  const pack = new URL("..", import.meta.url).pathname;
  const home = mkdtempSync("/tmp/pdk-g");
  const run = (s) => Bun.spawnSync(["/bin/sh", `${pack}${s}`, home], { env: { HOME: process.env.HOME, PATH: "/usr/bin:/bin:/usr/sbin" } }).exitCode;
  try {
    expect(run("install.sh")).toBe(0);
    expect(readFileSync(`${home}/${BACKDROP.image}`).equals(readFileSync(new URL("../backgrounds/busy.png", import.meta.url)))).toBe(true);
    expect(run("uninstall.sh")).toBe(0);
    expect(existsSync(`${home}/pdk`)).toBe(false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 60000);
