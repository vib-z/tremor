// The pack's one colour-token set: Herdr's own theme colour names (`theme()` in herdr.d.ts), every one defined
// by each of the pack's themes, grouped as the token editor shows them. Pure, so `bun test` runs it.
//
// A theme file (`themes/<name>.json`, herdr-app src/settings.rs:103-112) keeps the terminal palette at its top
// level (background, foreground, selection, cursor, ansi[16]) and every other colour under `colors`. The token
// `terminal_foreground` is the file's top-level `foreground`; the token `foreground` is the panels' text.

export const THEMES = ["pdk-t3-light", "pdk-t3-dark", "pdk-moshi", "pdk-t3-blue-light", "pdk-t3-navy", "pdk-t3-magenta", "pdk-moshi-forest", "pdk-moshi-amber",
  "pdk-t3-blue-sidebar-light", "pdk-t3-blue-sidebar-dark", "pdk-t3-glass-light", "pdk-t3-glass-dark",
  "pdk-indigo-graphite-light", "pdk-indigo-graphite-dark", "pdk-paper-ink-light", "pdk-paper-ink-dark", "pdk-quiet-canvas-light", "pdk-quiet-canvas-dark", "pdk-cobalt-desk-light", "pdk-cobalt-desk-dark", "pdk-forge-slate-light", "pdk-forge-slate-dark", "pdk-studio-ash-light", "pdk-studio-ash-dark"];

// The presets beyond the three: palettes tried during testing, each finished into a whole theme (themes-more).
// Each keeps the colour it came from.
export const PRESET_SOURCES = {
  "pdk-t3-blue-light": { token: "chrome", value: "#eef2ff", from: "Colours edit on T3 light (shots v3/modpack/5-colours-after-light, qa 18)" },
  "pdk-t3-navy": { token: "chrome", value: "#101828", from: "Colours edit on T3 dark (shots v3/modpack/5-colours-after-dark, qa 18)" },
  "pdk-t3-magenta": { token: "accent", value: "#ff00aa", from: "build-media's Colours edit on T3 dark (shots v3/media/11 to 13)" },
  "pdk-moshi-forest": { token: "chrome", value: "#111311", from: "Owner charcoal/green retune, inputs-moshi-desktop-1752.png pixel (400,300); original Colours trial chrome was #0b2412" },
  "pdk-moshi-amber": { token: "accent", value: "#ff8800", from: "Colours edit on Moshi saved live in the G4 check; install.test.js's edit" },
  // Owner 17:37-17:38 (requests 2 and 3a): the same two edits kept as they were tried, only the sidebar blue.
  "pdk-t3-blue-sidebar-light": { token: "chrome", value: "#eef2ff", from: "Colours edit on T3 light, chrome only (shots v3/modpack/5-colours-after-light)" },
  "pdk-t3-blue-sidebar-dark": { token: "chrome", value: "#101828", from: "Colours edit on T3 dark, chrome only (shots v3/modpack/5-colours-after-dark)" },
  "pdk-t3-glass-light": { token: "chrome", value: "#eef2ffb3", from: "Design polish: quiet Glass over T3 Blue sidebar light" },
  "pdk-t3-glass-dark": { token: "chrome", value: "#101828b3", from: "Design polish: quiet Glass over T3 Blue sidebar dark" },
  // Product-inspired presets: public sources and MIT palette adaptations, checked 2026-11-09.
  "pdk-indigo-graphite-light": {"token": "accent", "value": "#3058db", "name": "Indigo Graphite light", "from": "Linear inspired; adapted to the pack surfaces, not an official theme", "reference": "https://linear.app/brand", "source": "https://github.com/radix-ui/colors", "license": "MIT", "licenseFile": "MIT-radix-colors.txt", "terminalSource": "https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/src/themes/presets.ts"},
  "pdk-indigo-graphite-dark": {"token": "accent", "value": "#9eb1ff", "name": "Indigo Graphite dark", "from": "Linear inspired; adapted to the pack surfaces, not an official theme", "reference": "https://linear.app/brand", "source": "https://github.com/radix-ui/colors", "license": "MIT", "licenseFile": "MIT-radix-colors.txt", "terminalSource": "https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/src/themes/presets.ts"},
  "pdk-paper-ink-light": {"token": "accent", "value": "#21201c", "name": "Paper Ink light", "from": "Notion inspired; adapted to the pack surfaces, not an official theme", "reference": "https://www.notion.com/help/customize-and-style-your-content", "source": "https://github.com/radix-ui/colors", "license": "MIT", "licenseFile": "MIT-radix-colors.txt", "terminalSource": "https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/src/themes/presets.ts"},
  "pdk-paper-ink-dark": {"token": "accent", "value": "#eeeeec", "name": "Paper Ink dark", "from": "Notion inspired; adapted to the pack surfaces, not an official theme", "reference": "https://www.notion.com/help/customize-and-style-your-content", "source": "https://github.com/radix-ui/colors", "license": "MIT", "licenseFile": "MIT-radix-colors.txt", "terminalSource": "https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/src/themes/presets.ts"},
  "pdk-quiet-canvas-light": {"token": "accent", "value": "#181818", "name": "Quiet Canvas light", "from": "ChatGPT inspired; adapted to the pack surfaces, not an official theme", "reference": "https://openai.com/brand/", "source": "https://github.com/openai/apps-sdk-ui/blob/main/src/styles/variables-primitive.css", "license": "MIT", "licenseFile": "MIT-openai-apps-sdk-ui.txt", "terminalSource": "https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/src/themes/presets.ts"},
  "pdk-quiet-canvas-dark": {"token": "accent", "value": "#ededed", "name": "Quiet Canvas dark", "from": "ChatGPT inspired; adapted to the pack surfaces, not an official theme", "reference": "https://openai.com/brand/", "source": "https://github.com/openai/apps-sdk-ui/blob/main/src/styles/variables-primitive.css", "license": "MIT", "licenseFile": "MIT-openai-apps-sdk-ui.txt", "terminalSource": "https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/src/themes/presets.ts"},
  "pdk-cobalt-desk-light": {"token": "accent", "value": "#0053fd", "name": "Cobalt Desk light", "from": "Hermes Agent inspired; adapted to the pack surfaces, not an official theme", "reference": "https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/src/themes/presets.ts", "source": "https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/src/themes/presets.ts", "license": "MIT", "licenseFile": "MIT-hermes-agent.txt", "terminalSource": "https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/src/themes/presets.ts"},
  "pdk-cobalt-desk-dark": {"token": "accent", "value": "#6395fe", "name": "Cobalt Desk dark", "from": "Hermes Agent inspired; adapted to the pack surfaces, not an official theme", "reference": "https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/src/themes/presets.ts", "source": "https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/src/themes/presets.ts", "license": "MIT", "licenseFile": "MIT-hermes-agent.txt", "terminalSource": "https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/src/themes/presets.ts"},
  "pdk-forge-slate-light": {"token": "accent", "value": "#0964d0", "name": "Forge Slate light", "from": "GitHub inspired; adapted to the pack surfaces, not an official theme", "reference": "https://primer.style/product/primitives/color/", "source": "https://github.com/primer/primitives/tree/main/src/tokens/base/color", "license": "MIT", "licenseFile": "MIT-primer-primitives.txt", "terminalSource": "https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/src/themes/presets.ts"},
  "pdk-forge-slate-dark": {"token": "accent", "value": "#58a6ff", "name": "Forge Slate dark", "from": "GitHub inspired; adapted to the pack surfaces, not an official theme", "reference": "https://primer.style/product/primitives/color/", "source": "https://github.com/primer/primitives/tree/main/src/tokens/base/color", "license": "MIT", "licenseFile": "MIT-primer-primitives.txt", "terminalSource": "https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/src/themes/presets.ts"},
  "pdk-studio-ash-light": {"token": "accent", "value": "#3154da", "name": "Studio Ash light", "from": "Zed inspired; adapted to the pack surfaces, not an official theme", "reference": "https://github.com/zed-industries/zed/blob/main/assets/themes/one/one.json", "source": "https://github.com/zed-industries/zed/blob/main/assets/themes/one/one.json", "license": "MIT", "licenseFile": "MIT-zed-one.txt", "terminalSource": "https://github.com/zed-industries/zed/blob/main/assets/themes/one/one.json"},
  "pdk-studio-ash-dark": {"token": "accent", "value": "#7ab1e9", "name": "Studio Ash dark", "from": "Zed inspired; adapted to the pack surfaces, not an official theme", "reference": "https://github.com/zed-industries/zed/blob/main/assets/themes/one/one.json", "source": "https://github.com/zed-industries/zed/blob/main/assets/themes/one/one.json", "license": "MIT", "licenseFile": "MIT-zed-one.txt", "terminalSource": "https://github.com/zed-industries/zed/blob/main/assets/themes/one/one.json"},
};

export const GROUPS = [
  { name: "Surfaces", tokens: ["background", "surface", "canvas", "chrome", "popover", "raised", "hover", "selected", "border", "input"] },
  { name: "Text", tokens: ["foreground", "muted", "dim"] },
  { name: "Accent", tokens: ["accent", "accent_foreground", "solid", "solid_foreground", "ring", "selection"] },
  { name: "States", tokens: ["working", "blocked", "done", "idle", "unknown"] },
  { name: "Terminal", tokens: ["terminal_foreground", "cursor", ...Array.from({ length: 16 }, (_, i) => `ansi${i}`)] },
];

export const TOKENS = GROUPS.flatMap((g) => g.tokens);

const TOP = { background: "background", terminal_foreground: "foreground", selection: "selection", cursor: "cursor" };
const ansiIndex = (token) => (/^ansi(\d|1[0-5])$/.test(token) ? Number(token.slice(4)) : -1);

// Palette fields take #rrggbb only (settings.rs:193-195); `colors` also take #rrggbbaa (settings.rs:199-203), but
// the pack lets only the overlay tokens (raised, hover, selected, border, input) and chrome (Glass, below) carry
// alpha: mods add their own alpha to the others (`t.blocked + "14"`). An overlay with alpha tints whatever it sits on.
const ALPHA = new Set(["raised", "hover", "selected", "border", "input", "chrome"]);
export const takesAlpha = (token) => ALPHA.has(token);

export function tokenValue(file, token) {
  if (token in TOP) return file[TOP[token]] ?? null;
  const i = ansiIndex(token);
  if (i >= 0) return file.ansi?.[i] ?? null;
  return file.colors?.[token] ?? null;
}

// A new theme file with one token changed; the input is never modified.
export function withToken(file, token, value) {
  const hex = normalHex(value, takesAlpha(token));
  if (!hex) throw new Error(`${token}: ${value} is not a colour`);
  const next = { ...file, ansi: [...(file.ansi ?? [])], colors: { ...(file.colors ?? {}) } };
  if (token in TOP) next[TOP[token]] = hex;
  else if (ansiIndex(token) >= 0) next.ansi[ansiIndex(token)] = hex;
  else next.colors[token] = hex;
  return next;
}

export const themeText = (file) => JSON.stringify(file, null, 2) + "\n";

// "#AbC123" or "abc123" to "#abc123"; 8 digits only where alpha is allowed; null when not a colour.
export function normalHex(value, alpha = true) {
  const h = String(value ?? "").trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{6}$/.test(h) || (alpha && /^[0-9a-f]{8}$/.test(h))) return `#${h}`;
  return null;
}

const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

// Hue 0..360, saturation and lightness 0..100, for the editor's sliders. Alpha stays with the caller.
export function toHsl(hex) {
  const [r, g, b] = rgbOf(hex);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round(h * 60) % 360, Math.round(s * 100), Math.round(l * 100)];
}

export function fromHsl([h, s, l], alpha = "") {
  const S = s / 100, L = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n) => L - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return "#" + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("") + alpha;
}

// WCAG 2 contrast ratio of two opaque colours.
export function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = rgbOf(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// `top` (#rrggbb or #rrggbbaa) painted over the opaque `bottom`, as 8-bit #rrggbb. Blended on the encoded values, as
// gpui's Metal renderer does: a BGRA8Unorm drawable with source-over blending (vendor/gpui-pre-apple/src/
// metal_renderer.rs:178,1333-1335; shaders.metal converts to linear light only for gradients).
export function over(top, bottom) {
  const a = top.length === 9 ? parseInt(top.slice(7), 16) / 255 : 1;
  const b = rgbOf(bottom);
  return "#" + rgbOf(top).map((t, i) => Math.round((a * t + (1 - a) * b[i]) * 255).toString(16).padStart(2, "0")).join("");
}

// Glass (owner 17:37, request 2): the sidebar's chrome with alpha, over a busy backdrop the layout paints.
// herdr-app 0.1.14 opens an opaque window (src/main.rs:205-228 sets no window_background; gpui's default is Opaque,
// vendor/gpui-pre/src/platform.rs:2737-2746) and gpui has no backdrop filter, so the desktop never shows through and
// nothing is blurred. The layout's root paints BACKDROP; the work column paints canvas over it, so only the sidebar
// shows it. The sidebar paints chrome twice (the layout's sidebar column, then pdk-tree over it), so glass text is
// checked on chrome over chrome over the backdrop's darkest and lightest corners: every palette channel of the
// indexed image lies between them, so nothing the image shows, scaled or not, is darker or lighter.
export const BACKDROP = { image: "pdk/backgrounds/busy.png", darkest: "#404040", lightest: "#c0c0c0" };
const READS = ["foreground", "muted", "dim"];
const MARKS = ["working", "blocked", "done", "idle"];

// What text sits on: each panel, and each row or chip surface (raised, hover, selected) over it, as opaque colours.
const PANELS = ["background", "surface", "canvas", "chrome", "popover"];
const OVERLAYS = ["raised", "hover", "selected"];
export function textGrounds(file, panels = PANELS.map((t) => tokenValue(file, t).slice(0, 7))) {
  return panels.flatMap((p) => [p, ...OVERLAYS.map((o) => over(tokenValue(file, o), p))]);
}

// What glass text sits on: the sidebar over each backdrop extreme and the tab bar (chrome over the work column's
// canvas), each bare and under a row or chip.
export function glassGrounds(file) {
  const chrome = tokenValue(file, "chrome");
  return textGrounds(file, [over(chrome, over(chrome, BACKDROP.darkest)), over(chrome, over(chrome, BACKDROP.lightest)), over(chrome, tokenValue(file, "canvas"))]);
}

// Each text token under 4.5:1 or marker under 3:1 on a glass ground; empty when the glass passes.
export function glassFails(file) {
  const v = (t) => tokenValue(file, t);
  return glassGrounds(file).flatMap((g) => [
    ...READS.filter((t) => contrast(v(t), g) < 4.5).map((t) => `${t} on ${g}`),
    ...MARKS.filter((t) => contrast(v(t), g) < 3).map((t) => `${t} on ${g}`),
  ]);
}

export const isGlass = (file) => tokenValue(file, "chrome")?.length === 9;
const withAlpha = (file, a) => withToken(file, "chrome", tokenValue(file, "chrome").slice(0, 7) + a.toString(16).padStart(2, "0"));

// The Glass toggle: the chrome value with the most see-through alpha at which every check still passes (searched down
// from opaque, so every alpha above it passes too), or opaque chrome for off. Null when even opaque chrome fails.
export function glassChrome(file, on) {
  if (!on) return tokenValue(file, "chrome").slice(0, 7);
  if (glassFails(withAlpha(file, 255)).length) return null;
  let a = 255;
  while (a > 1 && !glassFails(withAlpha(file, a - 1)).length) a--;
  return tokenValue(withAlpha(file, a), "chrome");
}

// How much of the backdrop the sidebar shows through its two chrome layers, in percent.
export const seeThrough = (file) => (isGlass(file) ? Math.round((1 - parseInt(tokenValue(file, "chrome").slice(7), 16) / 255) ** 2 * 100) : 0);
