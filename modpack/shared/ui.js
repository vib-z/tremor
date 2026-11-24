// The pack's one small design system (spec section 1; values from the owner-approved visual contract,
// design-options/visual-contract.md, which wins where they differ): the scale, the derived inks, the agent marks and
// status markers, and the components every mod draws with. Installed into each mod as lib/ui.js. Colours are theme
// token names, except the agent marks' brand colours in AGENT_MARKS. No animation and no blur.
//
// Ported, not copied: shadcn/ui (shadcn-ui/ui@8ab2771, MIT: button, kbd, progress, toggle-group, dropdown-menu,
// popover, tooltip) and T3 Code (pingdotgg/t3code@3da48c1, MIT: ui/button, ui/kbd, ui/menu, ui/tooltip), as
// measured by herdr-t3 (JinJieBeWater/herdr-t3@e277ffa, docs/internals/t3-tokens.md, Apache-2.0). The glyphs are
// Lucide (ISC). See modpack/NOTICE.md.

import { div, svg } from "gpui-kit";
import { h_flex, v_flex, Button, Toggle, Progress, ProgressTrack, ProgressIndicator, Popover } from "gpui-base";
import { shared, setShared, home, fonts, window, theme, keys } from "herdr";
import { statusLabel, kindOrProgram } from "./status.js";
import { agentKind, kindName } from "./agents.js";
import { contrast, toHsl, fromHsl, glassGrounds } from "./tokens.js";

// ONE scale for every surface (owner 19:07, request 21). Use these names; never a bare px number for type, spacing
// or icon size (test/scale.test.js fails on one). Type: meta, secondary, body (the contract's 13), headings.
export const TYPE = { xs: 11, sm: 12, base: 13, lg: 16 };
// Spacing: a 4 px grid, plus the contract's named fine steps: half (segment padding), status (marker to word), mark
// (usage mark to text), pill (machine pill sides), inset (segment item sides), raise (a line of text lifted so its
// x-height, not its line box, sits on a bar's centre: a 12 or 13 px system x-height lies about 1.2 below the box's).
export const SPACE = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, raise: 1, half: 2, status: 5, mark: 6, pill: 7, inset: 10 };
// Icons sized to the text beside them: 12 with 11 and 12 px text, 14 with 13 (the default glyph), 16 with 16.
// Status markers are 7 px (the contract); one caret size.
export const ICON = { sm: 12, compact: 14, base: 14, lg: 16, dot: 7, caret: 10 };
export const iconFor = (text) => (text >= TYPE.lg ? ICON.lg : text >= TYPE.base ? ICON.base : ICON.sm);
// Row heights: compact controls; rows, menu items and tabs (workspace and agent rows are both 28 in the contract);
// the header's machine pills; section heads and two-line rows; the window header; `touch`: the least pressable size in
// a view under NARROW px wide (owner, 12 Nov: 44 px targets there, 24 to 28 on desktop).
export const ROW = { compact: 24, base: 28, nav: 28, agent: 28, pill: 34, two: 40, touch: 44, header: 54 };
export const NARROW = 768;
// Radii: + buttons, menu items and kbd; rows, tabs, pills and tooltips; menus and segment groups; bubbles.
export const RADIUS = { sm: 4, md: 6, lg: 8, xl: 16 };
// Disabled controls (shadcn's disabled:opacity-50 disabled:pointer-events-none): this opacity, no hover or pressed
// change, no pointer cursor, no action on a press or a key, not a Tab stop, and still announced as disabled.
export const DISABLED = 0.5;

// The pack's glyphs: chat, terminal, factory (owner, 2026-11-09 A), plus the sidebar toggle and search buttons
// (owner, 17:40 request 4), the sidebar's tree / agents view toggle (request 9b), this computer and another
// machine on the machine rows (request 19, as Herdr's own sidebar draws them), and the usage bar's sources and
// settings buttons (request 9b, lead's yes), the one fold caret, folded and open (design-astra item 12), the new
// menu's worktree glyph (C17), the "/" commands glyph (request 30; its pane header button is gone), the Grid view of the Grid /
// Factory toggle, the pane header's controls: split right, split down, expand, restore and close (owner, 11 Nov;
// the shapes stock Herdr's pane mod draws), and the glyphs a one-character button draws (CHAR_ICONS below; its ×
// the close control's x), and the machine selector's up-down chevrons (owner, 11 Nov; shadcn's sidebar switcher), and the file browser's tick (owner, 11 Nov).
// The Factory's Map / Board toggle: orbit (the Map) and layout-list (the Board) (owner, 14 Nov 2026).
// Agent marks (request 5) are a separate list.
export const ICONS = ["message-square", "square-terminal", "factory", "panel-left", "search", "list-tree", "bot", "monitor", "server", "settings", "git-branch", "caret-right", "caret-down", "square-slash", "layout-grid", "columns-2", "rows-2", "maximize-2", "minimize-2", "x", "plus", "minus", "chevrons-up-down", "check", "working", "working-dense", "working-still", "orbit", "layout-list"];

export const iconPath = (name) => `pdk/icons/${name}.svg`;

// One of the pack's glyphs tinted with `color`. Any other name draws nothing (the svg isn't installed either).
// With no colour the glyph takes its parent's ink, so it follows the parent's hover.
export const icon = (name, size, color) => (ICONS.includes(name) ? svg(iconPath(name)).size(size).flex_none().when(color != null, (el) => el.text_color(color)) : div());

// UI text is the system's sans in every preset, Moshi too (design-astra item 1: an all-mono UI reads broader and
// heavier than Moshi's own desktop app). As T3 Code does (t3code@3da48c1 apps/web/src/index.css:172: -apple-system
// first), it has real weights. GPUI's ".SystemUIFont" names it, and on macOS it resolves to .AppleSystemUIFont
// (herdr-app vendor/gpui-pre-macos/src/text_system.rs:282). A mod can't ask whether a family resolved, so elsewhere
// the layout's own face (Geist) stays. monoFont() is only for code, paths, branch and model ids, percentages and
// times, set on those runs by each renderer.
export const SYSTEM_UI = ".SystemUIFont";
export const uiFont = () => (window()?.platform === "macos" ? SYSTEM_UI : null);

// The pack's mono face: the first installed one without contextual alternates that move glyphs, so text shows
// exactly as written. Geist Mono shifts "--" one cell left over the space before it ("rg --files" reads
// "rg--files", seen in the sandbox 2026-11-09), and a mod can't turn font features off (gpui-kit has no
// font_features; herdr-app turns ligatures off for terminals only, src/settings.rs:381).
export const MONO_FACES = ["Menlo", "SF Mono", "Consolas", "DejaVu Sans Mono", "Liberation Mono", "JetBrains Mono"];
let mono = null;
export const monoFont = () => {
  if (mono) return mono;
  const have = fonts();
  const found = MONO_FACES.find((f) => have.includes(f));
  if (found) mono = found;
  return found ?? "JetBrains Mono";
};
export const withFont = (el) => {
  const f = uiFont();
  return f ? el.font_family(f) : el;
};

// The system's Reduce Motion, as the tree mod last read it through the helper.
export const reduceMotion = () => shared("pdk.reduceMotion") === true;

// Agent marks (owner 17:40 to 17:47, requests 5, 5b and 5c): each agent's own mark in the colour Moshi shows it in,
// from icons/agents/ (sources and licences: NOTICE.md). This table holds the pack's only hex colours: the marks'
// brand colours, sampled from the owner's screenshots (inputs-moshi-agent-icons-1740.png, -2-1746, -3-1747).
// `match`: the agent's words as the pack and Herdr name it (agents.js kindName, Herdr's programs.json names and
// keys), lower case with spaces and punctuation dropped.
export const AGENT_MARKS = {
  claude: { name: "Claude Code", color: "#d97757", match: ["claude", "claudecode"] },
  codex: { name: "Codex", color: "#03a27c", match: ["codex"] },
  cursor: { name: "Cursor", color: "#c691e8", match: ["cursor", "cursoragent"] },
  hermes: { name: "Hermes", color: "#fdd600", match: ["hermes", "hermesagent"] },
  opencode: { name: "OpenCode", color: "#ffcb6b", match: ["opencode"] },
  gemini: { name: "Gemini CLI", color: "#4184f3", match: ["gemini", "geminicli", "googlegemini"] },
  antigravity: { name: "Antigravity", color: "#3185fd", match: ["antigravity", "agy"] },
  qwen: { name: "Qwen Code", color: "#605beb", match: ["qwen", "qwencode"] },
  qoder: { name: "Qoder CLI", color: "#29da5b", match: ["qoder", "qodercli"] },
  droid: { name: "Factory Droid", color: "#cd4f0f", match: ["droid", "factorydroid"] },
  copilot: { name: "GitHub Copilot", color: "#7f4edb", match: ["copilot", "githubcopilot"] },
  devin: { name: "Devin CLI", color: "#21bf99", match: ["devin", "devincli"] },
  pi: { name: "Pi", color: "#6a9fcc", match: ["pi"] },
  goose: { name: "Goose", color: "#d2d2d2", match: ["goose"] },
  // Beyond Moshi's agent list (owner 2026-11-09, "use proper grok build icon"): Grok in the blue of the owner's
  // reference (inputs-grok-build-icon.png, as Moshi draws it), Kimi in the blue of its own file in Herdr
  // (herdr-app@2405bf3 defaults/icons/kimi.svg).
  grok: { name: "Grok Build", color: "#60b7ef", match: ["grok", "grokbuild"] },
  kimi: { name: "Kimi Code", color: "#1783ff", match: ["kimi", "kimicode", "kimicodecli"] },
};
// Beside the marks: the terminal glyph for a shell or any other program, and a neutral glyph for an agent without
// a mark of its own (Oh My Pi, Amp, ...), which then shows its name in words.
export const PLAIN_MARKS = ["terminal", "agent"];
export const markPath = (name) => `pdk/icons/agents/${name}.svg`;

const squash = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const MARK_OF = new Map(Object.entries(AGENT_MARKS).flatMap(([key, m]) => m.match.map((w) => [w, key])));
// The mark for what runs in a terminal, by its words: a key of AGENT_MARKS, else "agent" or "terminal".
export const markFor = (label, agent) => MARK_OF.get(squash(label)) ?? (agent ? "agent" : "terminal");

// Where marks are drawn: a mark's colour must keep 3:1 on each of these (WCAG 1.4.11, non-text contrast).
const GROUNDS = ["background", "surface", "canvas", "chrome", "raised", "popover", "hover", "selected"];
const solid = (c, under) => {
  const h = String(c ?? "");
  if (!/^#[0-9a-f]{8}$/i.test(h) || !/^#[0-9a-f]{6}/i.test(under ?? "")) return h.slice(0, 7);
  const a = parseInt(h.slice(7, 9), 16) / 255;
  return "#" + [1, 3, 5].map((i) => Math.round(parseInt(h.slice(i, i + 2), 16) * a + parseInt(under.slice(i, i + 2), 16) * (1 - a)).toString(16).padStart(2, "0")).join("");
};
// The grounds a mark sits on in the theme `t`, as opaque colours: one with alpha is laid over the surface. A
// translucent (Glass) chrome adds what the sidebar really shows: chrome painted twice over the backdrop's darkest
// and lightest corners, and over the canvas, each bare and under a row (adapters/tokens.js glassGrounds; fixes-panels).
const glassy = (t) => /^#[0-9a-f]{8}$/i.test(String(t.chrome ?? ""));
const glassOf = (t) => glassGrounds({ background: t.background, colors: t });
export const markGrounds = (t) => {
  const own = GROUNDS.map((g) => t[g]).filter(Boolean).map((g) => solid(g, t.surface)).filter((g) => /^#[0-9a-f]{6}$/i.test(g));
  return glassy(t) ? [...own, ...glassOf(t)] : own;
};
const legible = (c, grounds) => grounds.every((g) => contrast(c, g) >= 3);
// A brand colour, or where it misses 3:1 on any of `grounds` (#rrggbb), the nearest shade of the same hue and
// saturation that keeps 3:1 on all of them: darker on light grounds, lighter on dark ones, by HSL lightness one
// step at a time from the brand's own. Null for a neutral colour (no hue to keep) or when no shade passes. Pure.
export function markShade(brand, grounds) {
  if (legible(brand, grounds)) return brand;
  const [h, s, l] = toHsl(brand);
  if (s < 10) return null;
  for (let d = 1; d <= 100; d++) {
    for (const step of [-d, d]) {
      const L = l + step;
      if (L < 0 || L > 100) continue;
      const c = fromHsl([h, s, L]);
      if (legible(c, grounds)) return c;
    }
  }
  return null;
}
const shades = new Map(); // per mark and theme grounds: worked out once
// A mark's colour on the theme `t` (owner 5c, lead's rule 2026-11-09): its brand colour, else its own hue made
// darker or lighter just enough to read on every ground. Only a neutral mark (Goose's white) takes the foreground.
export function markColor(t, key) {
  const brand = AGENT_MARKS[key]?.color;
  if (!brand) return t.foreground;
  const grounds = markGrounds(t);
  const id = `${key}|${grounds.join()}`;
  if (!shades.has(id)) {
    if (shades.size > 512) shades.clear();
    shades.set(id, markShade(brand, grounds) ?? t.foreground);
  }
  return shades.get(id);
}

// An idle mark, quieter but still legible (design-astra item 6): `color` laid over its real ground at the lowest
// opacity, down to half, that keeps 3:1 there. `grounds`: one #rrggbb or a list (groundOf); a translucent ground
// gives several, and the dimmed colour, worked out on the first, must keep 3:1 on every one. A colour already under
// 3:1 on any stays as it is. Pure; one treatment for the tree, factory and every other surface, for opacity(0.5).
export function dimMark(color, grounds) {
  const c = String(color ?? "").slice(0, 7);
  const gs = [grounds].flat().map((g) => String(g ?? "").slice(0, 7));
  if (!/^#[0-9a-f]{6}$/i.test(c) || !gs.length || !gs.every((g) => /^#[0-9a-f]{6}$/i.test(g)) || !legible(c, gs)) return color;
  for (let a = 50; a < 100; a += 5) {
    const d = solid(c + Math.round((a / 100) * 255).toString(16).padStart(2, "0"), gs[0]);
    if (legible(d, gs)) return d;
  }
  return c;
}
// What a mark on theme token `name` really sits on, as opaque colours: the token, or one with alpha laid over the
// surface; a Glass chrome, the sidebar's real composites (glassGrounds).
export const groundOf = (t, name) => (name === "chrome" && glassy(t) ? glassOf(t) : [solid(t[name] ?? t.surface, t.surface)]);

// The contract's derived inks. softInk: ordinary row and usage text (#ddd in T3 dark), the theme's own terminal
// foreground, distinct from `foreground`. fgWash: the foreground laid over its real ground at `alpha` (the kbd's 7%).
export const softInk = (t) => t.terminal_foreground ?? t.foreground;
export function fgWash(t, alpha = 0.07, ground = t.popover) {
  const fg = String(t.foreground ?? "").slice(0, 7), under = solid(ground ?? t.surface, t.surface);
  if (!/^#[0-9a-f]{6}$/i.test(fg) || !/^#[0-9a-f]{6}$/i.test(under)) return t.raised;
  return solid(fg + Math.round(alpha * 255).toString(16).padStart(2, "0"), under);
}
// fgStep: `token` (hover, selected) as a see-through step, for a button on a row or tab that may itself be hovered or
// selected (owner, 11 Nov: its box fully visible on every ground). The foreground at the alpha that lays `token`'s
// lightness over canvas: on a resting ground it reads as `token`, on a hovered or selected one a step more. A
// translucent token already is such a step.
export function fgStep(t, token) {
  const fg = String(t.foreground ?? "").slice(0, 7), c = String(token ?? ""), under = solid(t.canvas ?? t.surface, t.surface);
  if (/^#[0-9a-f]{8}$/i.test(c) || ![fg, c, under].every((x) => /^#[0-9a-f]{6}$/i.test(x))) return c;
  const lum = (x) => [1, 3, 5].reduce((s, i, k) => s + [0.2126, 0.7152, 0.0722][k] * parseInt(x.slice(i, i + 2), 16), 0);
  const a = Math.min(1, Math.max(0, (lum(c) - lum(under)) / (lum(fg) - lum(under))));
  return fg + Math.round(a * 255).toString(16).padStart(2, "0");
}

// An in-process record (a sub-agent its parent reported, not an agent seen on its own) draws the neutral bot glyph
// everywhere, whatever kind its parent says it is (design-astra item 6).
export const RECORD_MARK = "agent";

// What runs in a terminal: its mark (an agent's in its colour; the terminal or agent glyph in `color`), with the
// kind in words for the pointer and a screen reader. `record`: the bot glyph. `idle` with `ground` (a theme token
// name, the row's real background): the mark dimmed by dimMark; leave it off for a selected row.
export function kindMarker(t, { agent, label, record = false, idle = false, ground = "surface" }, size, color, id) {
  const words = label || (record ? "Sub-agent" : agent ? "Agent" : "Terminal");
  const mark = record ? RECORD_MARK : markFor(label, agent);
  const base = AGENT_MARKS[mark] ? (shared("pdk.marks.mono") === true ? t.foreground : markColor(t, mark)) : color;
  return h_flex().id(id).size(Math.max(14, size + 2)).flex_none().items_center().justify_center()
    .tooltip(words).accessibility_label(words).role("image")
    .child(svg(markPath(mark)).size(size).flex_none().text_color(idle ? dimMark(base, groundOf(t, ground)) : base));
}
// Kept for callers written before markers (same arguments).
export const kindIcon = kindMarker;
// An agent's own mark alone, in its colour, with no box and no tooltip (the usage foot: the line's accessible name
// says whose it is).
export function agentMark(t, label, size = ICON.sm) {
  const mark = markFor(label, true);
  const base = AGENT_MARKS[mark] ? (shared("pdk.marks.mono") === true ? t.foreground : markColor(t, mark)) : t.foreground;
  return svg(markPath(mark)).size(size).flex_none().text_color(base);
}
// The factory's unit piece still asks for this by name (build-factory moves it to kindMarker, machines-factory
// brief). It draws the mark too, never letters, in the theme the app shows. Delete when nothing imports it.
export const kindMonogram = (label, agent = true) => {
  const mark = markFor(label, agent);
  return svg(markPath(mark)).size(16).flex_none().text_color(AGENT_MARKS[mark] ? markColor(theme(), mark) : theme().muted);
};

// The words for what runs in a terminal: the app's program name (text, never its icon).
export const kindLabel = (program, fallback) => program?.name || fallback || "Terminal";

// The detected agent kind's name for a terminal, or null.
export const kindOf = (terminal) => {
  const k = agentKind(terminal);
  return k ? kindName(k) : null;
};

// A pane's own name, for the text beside its mark: the sidebar's rule (adapters/status.js paneName; owner, 11 Nov:
// "pane names must show agent names"), so a pane reads the same in its row and its header. The name the terminal
// was started with when Core has one, else what runs there as Herdr reports it: the agent ("Claude Code"), a
// program ("Neovim"), "Terminal" for a shell. Never a title, a tab's name, a folder or an id.
export function paneLabel(pane, terminal) {
  const kind = kindOf(terminal);
  const agent = Boolean(kind || pane?.program?.agent || terminal?.program?.agent || pane?.status || terminal?.report);
  return terminal?.name || kindOrProgram(kind, agent || !pane?.program?.shell ? pane?.program : null);
}

// The words for what runs in a terminal: its agent kind when one is detected, else the program's name.
export const agentLabel = (terminal, program, fallback) => kindOrProgram(kindOf(terminal), program, fallback);

// The shared working pair (owner, 12 Nov: live highlights on the status, a modern spinner, the same in Chat and
// Factory). Native motion only: a timer would redraw the whole window (the mod manual).
// MOTION: one turn of the spinner; one letter of the working text's sweep (ms).
export const MOTION = { spin: 800, step: 90 };
// The spinner for a working state, `size` px, in `color`: a faint track ring (the same ink at a quarter, inside the
// glyph) with a round-capped quarter arc turning on it. At 7 px and under, a denser drawing of it, so the stroke
// survives. With Reduce Motion on, three still dots and no motion call at all (a still ring reads as stuck: owner,
// 11 Nov). It carries no label: its caller names the state.
export function spinner(t, size = ICON.sm, { color = t.foreground } = {}) {
  const still = reduceMotion();
  const ring = svg(iconPath(still ? "working-still" : size <= ICON.dot ? "working-dense" : "working")).size(size).flex_none().text_color(color);
  return still ? ring : ring.spin(MOTION.spin);
}
// Steps of rest after each sweep.
const REST = 6;
// A status word that reads as live: `text` with a highlight sweeping its letters, left to right. Each letter is a
// cell: the letter in `muted`, and over it the same letter in `foreground` on the one frame the peak is on it, at
// half strength on the frames just before and after. Every overlay's frame list has the same length and step, and
// all views share one clock, so the cells stay in step. No gradient: two tokens in three flat steps. With Reduce
// Motion on, the plain word in `foreground`. `id` must be stable across renders; `text` is its accessible name.
export function workingText(t, id, text, { size = TYPE.sm } = {}) {
  const word = String(text ?? "");
  const box = h_flex().id(id).flex_none().items_center().text_size(size).role("status").accessibility_label(word);
  if (reduceMotion()) return box.text_color(t.foreground).child(word);
  const letters = [...word];
  // Frame f puts the peak on letter f - 1: it enters just before the first letter and leaves just after the last,
  // so the half-strength copies come and go too; then the rest.
  const length = letters.length + 2 + REST;
  const lane = (i, near) => Array.from({ length }, (_, f) => (near(f - 1 - i) ? letters[i] : ""));
  const over = (list) => div().absolute().top(0).left(0).text_color(t.foreground).frames(list, MOTION.step);
  return box.text_color(t.muted).children(letters.map((ch, i) => div().relative().flex_none().child(ch)
    .child(over(lane(i, (d) => d === 0)))
    .child(over(lane(i, (d) => Math.abs(d) === 1)).opacity(0.5))));
}

// Inline status, one system everywhere (owner 17:51, request 7, as Moshi shows it; sizes from the visual contract):
// working the spinner (7 px in a dense box, else 12), done (not yet seen) a green dot, needs you a yellow dot, idle a hollow ring (1.2), exited a
// short quiet bar, all 7 px. Green and yellow are the theme's `done` and `blocked`. The accessible name says the
// word; the tooltip too, which is one or two words, or `tip` where a surface names the state its own way (the tree's
// row word). `id` must be stable across renders. Null when nothing was reported.
export function statusMarker(t, word, id, { kind = null, size = 12, tip = null } = {}) {
  if (!word) return null;
  const label = statusLabel(word, kind);
  const shape = word === "working" ? spinner(t, size <= ICON.dot ? ICON.dot : ICON.sm)
    : word === "needs" ? div().size(ICON.dot).rounded(ICON.dot / 2).bg(t.blocked)
    : word === "done" ? div().size(ICON.dot).rounded(ICON.dot / 2).bg(t.done)
    : word === "idle" ? div().size(ICON.dot).rounded(ICON.dot / 2).border(1.2).border_color(t.idle ?? t.dim)
    : div().w(ICON.dot).h(1.5).bg(t.dim);
  return h_flex().id(id).size(size + 2).flex_none().items_center().justify_center()
    .tooltip(tip ?? label.split(/[,:]/)[0]).accessibility_label(label).role("image").child(shape);
}
export const statusIcon = statusMarker;

// The one fold caret (design-astra item 12): a 10 px triangle, pointing right while folded and down while open,
// drawn the same in every face (a text glyph's box changes with the font). Put it 4 px after its text.
export const foldMarker = (t, open, color) => svg(iconPath(open ? "caret-down" : "caret-right")).size(ICON.caret).flex_none().text_color(color ?? t.dim);
// The caret as its own fold control: a square 24 px target (owner, 11 Nov; was 18 wide), the caret in its middle
// and its clear ring inside, so with no gap it sits 7 px after the text. A Tab stop; Enter or Space folds, as a click does.
export function caretButton(t, id, open, label, onToggle, { color } = {}) {
  return focusRing(div(), t, onToggle, false, { stop: true }).id(id).size(ROW.compact).flex_none().flex().items_center().justify_center()
    .rounded(RADIUS.sm).hover((el) => el.bg(fgStep(t, t.hover)))
    .role("button").accessibility_label(label).tooltip(label)
    .on_click((e, cx) => { cx.stop_propagation(); onToggle(e, cx); })
    .child(foldMarker(t, open, color));
}

// The informational badge (design-system audit C18): 16 tall, 4 px inset, 11 px muted text on `raised`. Its one use
// today is the chat's current-model badge. Two selected looks stay apart: navigation (tree rows, the Tree / Agents
// and Chat / Terminal switches, Tab / Pane) fills the chosen one with `selected`; a choice between values (Off / On,
// effort) raises the chosen one to `raised` with foreground text. Neither is boxed or inverted.
export const badge = (t, text, id) => div().id(id).flex_none().h(16).px(SPACE[1]).flex().items_center().rounded(RADIUS.sm)
  .bg(t.raised).text_size(TYPE.xs).text_color(t.muted).child(text);

// Keyboard focus on a pack button (shadcn's focus-visible:ring-[3px] ring-ring/50; owner, 11 Nov): a Tab stop
// whose ring shows only when focus came from the keyboard. The ring is RING px of border, always there in the clear,
// so showing it moves nothing; drawn inside the box, as a mod can draw nothing outside it that depends on focus (no
// spread shadow, no outline, no focus style on a child). Enter and Space press it. A disabled button is not a Tab stop.
//
// The app has no keyboard-only focus style (gpui-kit exposes GPUI's focus() but not its focus_visible()), so the
// pack keeps the last input's kind in one shared value, POINTER, that every mod reads: a press on a pack control, or
// anywhere while a ring may show, sets it; a key down or up on a focused pack control clears it (a Tab's key up lands
// on the control it moved to, so Tab from a field or the terminal counts). While it is set, no control declares its
// focus style. setShared redraws every mod's views, so each flip repaints at once; it only flips when the kind changes.
// Exported for a roving list (the tree) that keeps one focus and draws its own row ring: byPointer to read the
// switch, pointed and keyed to note its presses and keys.
export const RING = 3;
const POINTER = "pdk.focus.pointer";
export const byPointer = () => shared(POINTER) === true;
export const keyed = () => { if (byPointer()) setShared(POINTER, false); };
// The owner's rule (11 Nov): any Tab or Shift+Tab shows the ring at once, and only a pointer press hides it. A Tab's
// key-up that lands on a pack control counts too: its key-down belonged to a field, the terminal or another mod, and
// focus moved here. Any other key's key-up counts only as the end of a key pressed after the latest press, timed
// exactly from a key-down a pack control saw (review R4).
// Known limit, accepted by the owner: a Tab held across a press and then released brings the ring back.
let pressAt = -Infinity;
const downAt = new Map();
export const pointed = () => { pressAt = Date.now(); if (!byPointer()) setShared(POINTER, true); };
const keyDown = (e) => { downAt.set(e?.key, Date.now()); keyed(); };
const keyUp = (e) => {
  const down = downAt.get(e?.key);
  downAt.delete(e?.key);
  if (e?.key === "tab" || (down != null && down > pressAt)) keyed();
};
const clear = (c) => `${String(c).slice(0, 7)}00`;
const half = (c) => `${String(c).slice(0, 7)}80`;
// The listeners and the focus look, for any focusable control: `ink` is the ring's colour (a 1 px edge takes the
// whole accent), `onKey` the control's own keys.
function keyboardFocus(el, ink, onKey) {
  const shown = !byPointer();
  return el.when(shown, (e) => e.focus((st) => st.border_color(ink)).on_mouse_down_out(() => pointed()))
    .on_key_down((e, cx) => { keyDown(e); onKey?.(e, cx); }).on_key_up((e) => keyUp(e));
}
// `stop`: a press stops at the control (buttons in draggable chrome), in the same handler that notes the pointer.
export function focusRing(el, t, onPress, disabled = false, { stop = false } = {}) {
  const ringed = el.border(RING).border_color(clear(t.border))
    .on_mouse_down("left", (_e, cx) => { pointed(); if (stop) cx.stop_propagation(); });
  if (disabled) return ringed;
  return keyboardFocus(ringed.tab_index(0), half(t.accent), (e, cx) => { if (e?.key === "enter" || e?.key === "space") { cx.stop_propagation(); onPress(e, cx); } });
}
// The ring's 1 px over the old 2 px border comes off a worded button's sides, so no button changes size.
const GROW = RING - 2; // 2: the old border

// A one-character button is square (owner, 11 Nov: every + and icon button a square target). A font sets "+", "×",
// "−" and "-" on its baseline, not the box's middle (measured 3 to 9 px low at 2x, 11 Nov), so those draw as the
// pack's centred Lucide glyphs, as stock Herdr draws its own "+", one icon step under the text size so they keep the
// font glyph's size (16 px text: 14).
const CHAR_ICONS = { "+": "plus", "×": "x", "−": "minus", "-": "minus" };
const oneChar = (text) => typeof text === "string" && [...text].length === 1;

// A compact text button: words, and the same words for a screen reader. A tooltip only for a one-character text
// (×, +, -, □), or `tip` when the caller has something the words don't say: a tooltip never repeats a visible label.
export function textButton(t, id, text, label, onClick, { disabled = false, pressed, color, h = 20, size = TYPE.xs, tip = null } = {}) {
  const one = oneChar(text);
  return focusRing(div(), t, onClick, disabled, { stop: true }).id(id).h(h).when(one, (el) => el.w(h)).when(!one, (el) => el.px(SPACE[1] - GROW))
    .flex_none().flex().items_center().justify_center().rounded(RADIUS.sm).text_size(size).font_medium()
    .text_color(disabled ? t.dim : color ?? t.muted).when(disabled, (el) => el.opacity(DISABLED))
    .when(!disabled, (el) => el.hover((s) => s.bg(fgStep(t, t.hover)).text_color(t.foreground)))
    .when(pressed === true, (el) => el.bg(t.selected).text_color(t.foreground))
    .role("button").accessibility_label(label).when(Boolean(tip ?? (one ? label : null)), (el) => el.tooltip(tip ?? label)).disabled(disabled)
    .on_click((e, cx) => { cx.stop_propagation(); if (!disabled) onClick(e, cx); })
    .child(CHAR_ICONS[text] ? svg(iconPath(CHAR_ICONS[text])).size(size >= TYPE.lg ? ICON.base : ICON.sm).flex_none() : text);
}

// An icon-only button: a square target with a nonshrinking glyph, ghost-muted (muted, foreground on hover), a
// tooltip for the pointer and the same words for a screen reader. Legacy sizes 20/24/28/32 keep working; 24 and
// below take the + button's 4 px corner, larger the row's 6. `tip: false`: no plain tooltip, for a button wrapped in
// the rich `tooltip` that shows its keys. Its hover is fgStep's see-through step, so the box shows on any ground (the
// pane header's `surface` too, where `hover` is a fainter step than on canvas); a pressed one stays lit under the pointer.
export function iconButton(t, id, name, label, onClick, { size = ROW.base, glyph = ICON.base, color, disabled = false, pressed, tip = true } = {}) {
  return focusRing(div(), t, onClick, disabled, { stop: true }).id(id).size(size).flex_none().flex().items_center().justify_center().rounded(size <= ROW.compact ? RADIUS.sm : RADIUS.md)
    .text_color(disabled ? t.dim : color ?? t.muted).when(disabled, (el) => el.opacity(DISABLED))
    .when(!disabled, (el) => el.hover((s) => s.bg(pressed === true ? t.selected : fgStep(t, t.hover)).text_color(t.foreground)))
    .when(pressed === true, (el) => el.bg(t.selected).text_color(t.foreground))
    .role("button").accessibility_label(label).when(tip, (el) => el.tooltip(label)).disabled(disabled)
    .on_click((e, cx) => { cx.stop_propagation(); if (!disabled) onClick(e, cx); })
    .child(ICONS.includes(name) ? svg(iconPath(name)).size(glyph).flex_none() : div());
}

// ---- Components (spec section 1, second table; anatomy from the visual contract) ------------------------------

// Key words as glyphs (spec section 7): one binding string from keys(), "cmd-shift-p" or a multi-stroke "cmd-k cmd-t",
// as strokes of key glyphs: [["⌘", "⇧", "P"]], [["⌘", "K"], ["⌘", "T"]]. A trailing "-" is the minus key.
const GLYPHS = { cmd: "⌘", shift: "⇧", alt: "⌥", ctrl: "⌃", enter: "↵", escape: "Esc", tab: "⇥", space: "Space",
  backspace: "⌫", delete: "⌦", up: "↑", down: "↓", left: "←", right: "→" };
export const keyGlyphs = (binding) => String(binding ?? "").trim().split(/\s+/).filter(Boolean)
  .map((stroke) => stroke.split(/-(?!$)/).map((k) => GLYPHS[k.toLowerCase()] ?? (k.length === 1 ? k.toUpperCase() : k[0].toUpperCase() + k.slice(1))));
// The keys bound to an app or mod command right now, as keyGlyphs strokes; a layout's own binding before a global
// one. Null when nothing is bound: show no shortcut rather than a made-up one.
export function shortcut(action, { layout = "tremor" } = {}) {
  const all = keys() ?? [];
  const hit = all.find((k) => k.section === `layout:${layout}` && k.action === action) ?? all.find((k) => k.section === "global" && k.action === action);
  return hit ? keyGlyphs(hit.keys) : null;
}

// Keys as T3 and shadcn draw them: one 20 px box per key (min-width 20, 4 px sides and gap, 4 px corner), 12 px medium
// sans in muted ink on the foreground's 7% wash over its real `ground`. `plain`: the menu form, dim text, no box,
// same baseline. `keys`: glyph strings, or keyGlyphs strokes (a gap between strokes). Never interactive.
export function kbd(t, keys, { plain = false, ground = t.popover } = {}) {
  const strokes = (keys ?? []).length && Array.isArray(keys[0]) ? keys : [keys ?? []];
  const wash = plain ? null : fgWash(t, 0.07, ground);
  const key = (k) => div().h(ROW.compact - SPACE[1]).min_w(ROW.compact - SPACE[1]).flex_none().flex().items_center().justify_center()
    .when(!plain, (el) => el.px(SPACE[1]).rounded(RADIUS.sm).bg(wash))
    .text_size(TYPE.sm).font_medium().text_color(plain ? t.dim : t.muted).child(k);
  const words = strokes.map((s) => s.join("")).join(" ");
  return h_flex().flex_none().gap(SPACE[2]).items_center().role("image").accessibility_label(words)
    .children(strokes.map((s) => h_flex().gap(SPACE[1]).items_center().children(s.map(key))));
}

// A button (shadcn/T3 button): Button.new, so activation and keyboard come from base, never a second handler here.
// Sizes xs 24 / sm 28 / md 32, sides 8 / 12 / 12, gap 8, corner 6. ghost: transparent, hover fill; ghost-muted:
// muted ink, foreground on hover; outline: the input edge; primary: accent with white ink. Disabled: DISABLED, no Tab stop.
// No pressed look (shadcn has none): a held button looks as it does under the pointer; `pressed` (switched on) keeps
// its `selected` fill. Presses stop there, so a button in draggable chrome never moves the window.
const BUTTON = { xs: { h: ROW.compact, px: SPACE[2] }, sm: { h: ROW.base, px: SPACE[3] }, md: { h: SPACE[8], px: SPACE[3] } };
export function button(t, id, { text, icon: iconName = null, label = text, onPress, variant = "ghost", size = "sm", disabled = false, pressed = false } = {}) {
  const dims = BUTTON[size] ?? BUTTON.sm, primary = variant === "primary";
  const ink = primary ? t.accent_foreground : variant === "ghost-muted" ? t.muted : t.foreground;
  const fill = primary ? t.accent : pressed ? t.selected : null;
  const outline = variant === "outline";
  return Button.new(id).h(dims.h).when(Boolean(text), (el) => el.px(dims.px - (outline ? 0 : GROW))).when(!text, (el) => el.w(dims.h))
    .flex_none().flex().items_center().justify_center().gap(SPACE[2]).rounded(RADIUS.md)
    .border(outline ? 1 : RING).border_color(outline ? t.input : clear(t.border))
    .text_size(TYPE.base).text_color(pressed ? t.foreground : ink).when(Boolean(fill), (el) => el.bg(fill))
    .accessibility_label(label ?? "").selected(pressed).disabled(disabled)
    .when(disabled, (el) => el.opacity(DISABLED))
    .when(!disabled, (el) => keyboardFocus(el.tab_index(0)
      .hover((st) => st.bg(primary ? t.accent : t.hover).text_color(primary ? ink : t.foreground)), outline ? t.accent : half(t.accent)))
    .on_mouse_down("left", (_e, cx) => { pointed(); cx.stop_propagation(); })
    .on_click((e, cx) => { cx.stop_propagation(); if (!disabled) onPress?.(e, cx); })
    .when(Boolean(iconName), (el) => el.child(ICONS.includes(iconName) ? svg(iconPath(iconName)).size(ICON.base).flex_none() : iconName))
    .when(Boolean(text), (el) => el.child(div().min_w(0).truncate().child(text)));
}

// A sidebar row (the contract's workspace and agent rows): 28 high, 6 px corner. workspace: 4 px sides and gap,
// 13/500 foreground; agent: 16 px in (plus 16 a level) and 8 px right, gap 8, 13/400 in softInk. Hover fills
// `hover`, selected fills `selected` with foreground ink (agents stay 400). Not a Tab stop and no button inside:
// the list owns focus and its roving keys. `trailing` (time, status) gives way to `actions` when the caller passes
// them, from its own hover or focus state (chain .on_hover on the row). `active` brightens the text.
export function sidebarRow(t, id, { icon = null, text, active = false, selected = false, depth = 0, trailing = null, actions = null, onPress, kind = "workspace" } = {}) {
  const agent = kind === "agent";
  return h_flex().id(id).h(agent ? ROW.agent : ROW.nav).flex_none().min_w(0).items_center().rounded(RADIUS.md)
    .when(agent, (el) => el.pl(SPACE[4] * (depth + 1)).pr(SPACE[2]).gap(SPACE[2]))
    .when(!agent, (el) => el.pl(SPACE[1] + SPACE[4] * depth).pr(SPACE[1]).gap(SPACE[1]))
    .text_size(TYPE.base).when(!agent, (el) => el.font_medium())
    .text_color(selected || active || !agent ? t.foreground : softInk(t)).when(selected, (el) => el.bg(t.selected))
    .hover((st) => st.bg(selected ? t.selected : t.hover).text_color(t.foreground))
    .role("list_item").aria_selected(selected).accessibility_label(String(text ?? ""))
    .on_click((e, cx) => onPress?.(e, cx))
    .when(icon != null, (el) => el.child(icon))
    .child(div().flex_1().min_w(0).truncate().child(String(text ?? "")))
    .when((actions ?? trailing) != null, (el) => el.child(h_flex().flex_none().gap(SPACE[2]).items_center().child(actions ?? trailing)));
}

// A tremor menu (T3 ui/menu, shadcn dropdown-menu), only for menus Herdr has no native form of: popover ground,
// 1 px edge, 8 px corner, 4 px inside, min 160 wide, shadow_lg. One focus: no item is a Tab stop. Up and Down move
// between enabled items and wrap, Home and End jump, Enter presses through the item's Button, Escape, Tab and Shift-Tab
// close it through `close(cx)` (the caller's: it knows where focus goes back). The keys are bound under the frame's
// `PdkMenu` context (bindMenuKeys), because the kit's Root binds Tab and the host binds Escape in `Overlay`, both
// ahead of any key handler; the frame's on_key_down does the same if a host refused the bindings.
// Roving focus as segmentedChoice: `menu` (menuState(owner, id)) keeps each item's handle by id, made in a key handler
// (never in render), for as long as the view lives; menuItem notes the enabled items in drawing order.
export const MENU_KEYS = ["up", "down", "home", "end", "tab", "shift-tab", "escape"];
const menuAction = (key) => `pdk_menu_${key.replace("-", "_")}`;
let menuBound = false; // once per module load: the keymap is the app's
export function bindMenuKeys(cx) {
  if (menuBound) return;
  try { menuBound = cx.bind_keys(MENU_KEYS.map((keystroke) => ({ keystroke, action: menuAction(keystroke), context: "PdkMenu" }))) > 0; } catch {}
}
const MENUS = new WeakMap();
export function menuState(owner, id) {
  let mine = MENUS.get(owner);
  if (!mine) MENUS.set(owner, (mine = new Map()));
  if (!mine.has(id)) mine.set(id, { handles: new Map(), order: [] });
  return mine.get(id);
}
export function menuFrame(t, id, children, { menu = null, close = null, onMove = null } = {}) {
  const order = menu ? menu.order : [];
  if (menu) menu.order = []; // the next render notes its items again
  const press = (key, cx) => {
    if (key === "escape" || key === "tab" || key === "shift-tab") { close?.(cx); return; }
    const n = order.length;
    if (!menu || !n) return;
    for (const item of order) if (!menu.handles.has(item)) menu.handles.set(item, cx.focus_handle());
    const at = order.findIndex((item) => menu.handles.get(item).is_focused?.());
    const to = key === "home" ? 0 : key === "end" ? n - 1 : key === "down" ? (at + 1) % n : at < 0 ? n - 1 : (at - 1 + n) % n;
    menu.handles.get(order[to]).focus();
    onMove?.(order[to], cx);
    cx.notify?.();
  };
  let el = withFont(v_flex()).id(id).min_w(160).p(SPACE[1]).gap(SPACE[0])
    .bg(t.popover).border(1).border_color(t.border).rounded(RADIUS.lg).shadow_lg().role("menu").key_context("PdkMenu");
  for (const key of MENU_KEYS) el = el.on_action(menuAction(key), (_e, cx) => press(key, cx));
  return el.on_key_down((e, cx) => {
    const key = e?.keystroke ?? e?.key;
    if (!MENU_KEYS.includes(key)) return;
    cx.stop_propagation(); press(key, cx);
  }).children(children ?? []);
}
// One item: 28 high, 8 px sides and gap, 4 px corner, 13 px softInk on the popover, foreground on `hover` when
// pointed at or focused; an icon 14; its keys pushed right in the plain kbd form; destructive in the theme's red.
// `checked` (true or false): one of a choice, the current one in the `selected` fill and foreground, as the chat's
// model menu marks its current model, and "current" in its accessible name: a Button carries no checked state (gpui-kit
// limits `checked` to Checkbox, Switch and Radio; review RC05). `note`: a word after the text, 11 px `dim`, also in
// the accessible name.
// No item is a Tab stop (base Button is one by default); `menu` (menuState) gives it its roving handle.
export function menuItem(t, id, { text, icon: iconName = null, keys: shortcutKeys = [], onPress, disabled = false, destructive = false, checked, note, menu = null } = {}) {
  const ink = destructive ? t.ansi1 : softInk(t), on = checked === true;
  if (menu && !disabled) menu.order.push(id);
  const handle = menu && !disabled ? menu.handles.get(id) : null;
  return Button.new(id).when(!disabled, (el) => el.tab_stop(false)).when(Boolean(handle), (el) => el.track_focus(handle)).h(ROW.base).w_full().flex_none().flex().items_center().px(SPACE[2]).gap(SPACE[2]).rounded(RADIUS.sm)
    .text_size(TYPE.base).text_color(on ? t.foreground : ink).role("menu_item")
    .accessibility_label([String(text ?? ""), note, on ? "current" : null].filter(Boolean).join(", ")).disabled(disabled)
    .when(on, (el) => el.bg(t.selected))
    .when(disabled, (el) => el.opacity(DISABLED))
    .when(!disabled, (el) => el
      .hover((st) => st.bg(on ? t.selected : t.hover).text_color(destructive ? ink : t.foreground))
      .focus((st) => st.bg(on ? t.selected : t.hover).text_color(destructive ? ink : t.foreground)))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((e, cx) => { cx.stop_propagation(); if (!disabled) onPress?.(e, cx); })
    .when(Boolean(iconName), (el) => el.child(ICONS.includes(iconName) ? svg(iconPath(iconName)).size(ICON.base).flex_none() : iconName))
    .child(div().flex_1().min_w(0).truncate().child(String(text ?? "")))
    .when(Boolean(note), (el) => el.child(div().flex_none().text_size(TYPE.xs).text_color(t.dim).child(note)))
    .when((shortcutKeys ?? []).length > 0, (el) => el.child(kbd(t, shortcutKeys, { plain: true })));
}

// A surface anchored to `trigger` and opened by a press (base Popover: anchoring, outside press, Esc and focus are
// its own). Controlled when `open` is given, with `onOpenChange(open, cx)`. Never stack it over a Herdr overlay.
export function popover(t, id, { trigger, content, open, onOpenChange } = {}) {
  const el = Popover.new(id).trigger(trigger).content(content);
  return open === undefined ? el : el.open(Boolean(open)).on_open_change((value, cx) => onOpenChange?.(value, cx));
}

// A tooltip with its keys: the app's own tooltip on the trigger, its words then the keys in their glyphs ("Search
// ⌘K"). Not the base HoverCard any more (owner, 11 Nov: "when tooltip opens, click doesn't work"): a HoverCard draws
// its card in a Popup whose host blocks the mouse (gpui-kit base popup.rs:190-196, positioner.rs:413-415), and the
// window clamps a card anchored above a trigger in the 40 px top bar down over it, so the press lands on the card. The
// native tooltip goes away on a press, never opens while a button is held and takes no pointer events (gpui
// elements/div.rs:3207-3219, 3748-3750). At most three words besides the keys; give the trigger the same words as its
// accessible name. `id` is unused now (the trigger keeps its own); callers keep the call as it was.
// shadcn's inverted chip waits on the app (shadcn round, 11 Nov): a Popup clamps into the window and never flips
// (base positioner.rs:31-33, 211-229), the app sets no least window or pane size, so no anchor keeps a card off a
// trigger near an edge; a HoverCard can't be closed from a script (shell popover.rs:224-232 refuses `open`).
export function tooltip(t, id, trigger, text, { keys: shortcutKeys = [] } = {}) {
  const strokes = (shortcutKeys ?? []).length && Array.isArray(shortcutKeys[0]) ? shortcutKeys : [shortcutKeys ?? []];
  const keyText = strokes.map((s) => s.join("")).join(" ").trim();
  return trigger.tooltip(keyText ? `${text} ${keyText}` : String(text ?? ""));
}

// A progress bar (shadcn progress): base Progress announces the value; the track fills its row (flex 1, min width
// 0), 4 high, a capsule in `input`, the fill in `color`. A null fraction is unknown: announced as such, no fill and no
// made-up 0%. The fraction is clamped to 0..1.
export function progressBar(t, id, fraction, { color = t.accent, label = "Usage" } = {}) {
  const known = typeof fraction === "number" && Number.isFinite(fraction);
  const pct = known ? Math.max(0, Math.min(1, fraction)) * 100 : 0;
  return Progress.new(id).flex_1().min_w(0).w_full().accessibility_label(label)
    .when(known, (el) => el.value(pct)).when(!known, (el) => el.indeterminate(true))
    .child(ProgressTrack.new().w_full().h(SPACE[1]).rounded(SPACE.half).overflow_hidden().bg(t.input)
      .when(known, (el) => el.child(ProgressIndicator.new().h_full().w(`${pct.toFixed(1)}%`).rounded(SPACE.half).bg(color))));
}

// Consistency contract C1-C18. These build on the existing focus/button helpers; they do not own view state.
// `choice` uses raised for a persistent choice; `navigation`/ordinary rows use selected. No outer segment box.
// Style-only: no click/key handlers or Tab stops, so a roving list keeps its container's keyboard architecture.
// Pass `focused` only for the real roving focus row; standalone controls get their handle through focusRing. Its
// 1 px edge is the ring here (action buttons, rows): the whole accent, only for keyboard focus (focusRing's rule).
// `ring` (RING): a clear edge that wide, so the ring is focusRing's 3 px at half strength (segment items).
// No pressed look (shadcn's button has no active: style): nothing changes fill or ink while it is held; a selected
// one keeps its selected fill, which is state, not a press.
// `hoverFill`: an unselected item's hover fill (segments pass fgStep's step; rows keep `hover`).
export function interactionStyle(el, t, { selected = false, disabled = false, focused = false,
  variant = "neutral", ground = t.canvas, color = t.muted, selectedBorder = false, hoverFill = t.hover, ring = 1 } = {}) {
  const choice = variant === "choice", filled = variant === "primary" || variant === "play", send = variant === "send", data = variant === "data";
  const picked = choice ? t.raised : t.selected;
  const base = disabled && send ? t.raised : disabled && filled ? t.surface : send ? t.accent : filled ? t.solid : data ? ground : selected ? picked : ground;
  const ink = disabled ? t.dim : send ? t.accent_foreground : filled ? t.solid_foreground : selected ? t.foreground : color;
  const edge = data || filled || variant === "action" ? t.border : clear(t.border);
  const fixedEdge = focused || selected && selectedBorder ? t.accent : null;
  const ringed = el.bg(base).text_color(ink).border(ring).border_color(!disabled && fixedEdge ? fixedEdge : edge).disabled(disabled);
  if (disabled) return ringed;
  return ringed
    .hover((s) => s.bg(data || filled || send ? base : selected ? picked : hoverFill)
      .text_color(filled || send ? ink : t.foreground).border_color(fixedEdge ?? (send ? t.accent_foreground : data || filled ? t.muted : edge)))
    .when(!byPointer(), (e) => e.focus((s) => s.border_color(ring > 1 ? half(t.accent) : t.accent)));
}
export const rowStates = interactionStyle;

// Text that may not fit: one line, an ellipsis, and the whole of it in the accessible name. No automatic tooltip
// (spec section 7: tooltips are three words at most, never a row's metadata).
export const fitLabel = (id, fullText) => {
  const words = String(fullText ?? "");
  return div().id(id).min_w(0).truncate().accessibility_label(words).child(words);
};

// items: { value, label, icon?, tooltip?, disabled? }. onChange(value, event, cx); event is null for a toggle's change.

// The contract's segments: the group p2/gap2/r8, each item 24 high (icon items square, was 28 wide; text items 10 px sides, 12 px
// text) with a 6 px corner; a view (navigation) takes `selected`, a choice between values `raised`. An unchosen item
// hovers with fgStep's see-through step, as the icon button does, so it shows on the pane header's `surface` as on
// canvas.
// One Tab stop, as shadcn's toggle group (Radix roving focus, owner 11 Nov): the focused item, else the chosen one,
// else the first enabled. Left / Up and Right / Down move between enabled items and wrap, Home and End go to the
// ends, Space or Enter chooses (base Toggle's own keyboard click). A disabled item is skipped; a disabled control is
// no Tab stop. Each item is a base Toggle, so it is announced as a toggle with its state, in a group named `label`.
// Focus handles can't be made in render, so the first arrow key makes them (an event handler may). They belong to the
// view that draws the control (`owner`, the caller's `this`): the app releases a view's handles when it closes and a
// reopened overlay is a new view of the same module, so they are kept per view (a WeakMap, gone with the view) and
// by the control's id within it. With no owner, arrows still choose nothing and focus stays put. A view keeps at most
// ROVING_MAX controls' handles, the oldest dropped first; a dropped control makes its handles again on its next arrow.
// Replaced (the items changed) or dropped handles are released at once, so a view holds at most ROVING_MAX
// controls' handles in the app too, not only in this map.
const ROVING = new WeakMap(), ROVING_MAX = 64;
const releaseAll = (hs) => hs?.forEach((h) => h.release?.());
const STEP = { right: 1, down: 1, left: -1, up: -1 };
// `hit`: each item's pressable size (ROW.touch in a narrow view); its glyph and words stay as they are.
// `again`: a press on the lit item reaches onChange too (the Map's lit "Collapsed" folds an open team).
export function segmentedChoice(t, id, items, value, onChange, { variant = "choice", disabled = false, label = id, ground = t.surface, owner = null, hit = ROW.compact, again = false } = {}) {
  const off = (item) => disabled || item.disabled === true;
  const live = items.flatMap((item, i) => (off(item) ? [] : [i]));
  const kept = owner ? ROVING.get(owner)?.get(id) : null;
  const handles = kept?.length === items.length ? kept : null;
  const stop = (handles && live.find((i) => handles[i].is_focused())) ?? live.find((i) => items[i].value === value) ?? live[0];
  // Enter and Space belong to the item: GPUI's own recorder on the same element notes the key-down first (div.rs
  // paint_mouse_listeners before paint_keyboard_listeners) and the Toggle chooses on the key-up, once; stopping both
  // here keeps them from a parent's handler (the model switcher's Enter applies), which would run first with the old value.
  const activation = (e) => e?.key === "enter" || e?.key === "space";
  const roam = (from) => (e, cx) => {
    keyDown(e);
    if (activation(e)) { cx.stop_propagation(); return; }
    const k = live.indexOf(from), n = live.length;
    const to = e?.key === "home" ? live[0] : e?.key === "end" ? live[n - 1] : STEP[e?.key] ? live[(k + STEP[e.key] + n) % n] : null;
    if (to == null || e.modifiers?.platform || e.modifiers?.control || e.modifiers?.alt) return;
    cx.stop_propagation();
    if (!owner) return;
    let mine = ROVING.get(owner);
    if (!mine) ROVING.set(owner, (mine = new Map()));
    let hs = mine.get(id);
    if (hs?.length !== items.length) {
      releaseAll(hs); hs = items.map(() => cx.focus_handle()); mine.delete(id); mine.set(id, hs);
      if (mine.size > ROVING_MAX) { const [old, gone] = mine.entries().next().value; releaseAll(gone); mine.delete(old); }
    }
    hs[to].focus(); cx.notify();
  };
  return h_flex().id(id).p(SPACE.half).gap(SPACE.half).items_center().rounded(RADIUS.lg).role("group").accessibility_label(label)
    .children(items.map((item, i) => {
      const no = off(item), picked = item.value === value, tip = item.tooltip ?? `${label}: ${item.label}`;
      const press = (e, cx) => { if (!no && (again || !picked)) onChange(item.value, e, cx); };
      const drawn = ICONS.includes(item.icon);
      const toggle = focusRing(Toggle.new(`${id}-${item.value}`), t, press, no, { stop: true }).h(hit).flex_none()
        .when(drawn, (el) => el.size(hit)).when(!drawn, (el) => el.px(SPACE.inset - RING + 1).text_size(TYPE.sm).font_medium())
        .rounded(RADIUS.md).pressed(picked).accessibility_label(tip).when(no, (el) => el.opacity(DISABLED))
        .when(!no, (el) => el.tab_stop(i === stop).on_key_down(roam(i)).on_key_up((e, cx) => { keyUp(e); if (activation(e)) cx.stop_propagation(); })
          .on_change((_on, cx) => press(null, cx))
          .when(Boolean(handles), (it) => it.track_focus(handles[i])))
        .child(drawn ? svg(iconPath(item.icon)).size(ICON.base).flex_none() : item.label);
      // base Toggle takes no tooltip (gpui-kit shell materialize/components/tooltip.rs:172-176), so it goes on a wrapper,
      // and only for an icon item or one with its own `tooltip`: a worded item says it already (its accessible name stays).
      return div().id(`${id}-${item.value}-tip`).flex_none().when(drawn || item.tooltip != null, (el) => el.tooltip(tip))
        .child(interactionStyle(toggle, t, { selected: picked, disabled: no, variant: variant === "navigation" ? "neutral" : "choice", ground, hoverFill: fgStep(t, t.hover), ring: RING }));
    }));
}

// A frame owns elevation only when the host does not. Body padding belongs to the caller: menu p4/g4,
// inspector p12/g8. Keep headers outside that body, so their 12 px inset is not doubled.
export function overlayFrame(t, id, { hostFrame = false } = {}) {
  return withFont(v_flex()).id(id).min_w(0).min_h(0).bg(t.popover)
    .when(!hostFrame, (el) => el.rounded(RADIUS.lg).border(1).border_color(t.border).shadow_lg().overflow_hidden());
}

// Standalone title 15/medium, h40/px12/g8. Preview's document variant uses 13/11 and px16, preserving h40.
// `trailing` and `subtitle` may be existing elements; metadata typography stays with its caller.
export function overlayHeader(t, id, title, { trailing = null, document = false, subtitle = null, ground = t.popover } = {}) {
  const words = fitLabel(`${id}-title`, title).flex_1().text_size(document ? TYPE.base : TYPE.lg).font_medium().text_color(t.foreground);
  return h_flex().id(id).h(ROW.two).flex_none().px(document ? SPACE[4] : SPACE[3]).gap(document ? SPACE[3] : SPACE[2]).items_center()
    .bg(ground).border_b(1).border_color(t.border)
    .child(document ? v_flex().flex_1().min_w(0).child(words)
      .when(subtitle != null, (el) => el.child(typeof subtitle === "string"
        ? fitLabel(`${id}-subtitle`, subtitle).text_size(TYPE.xs).text_color(t.dim) : subtitle)) : words)
    .when(trailing != null, (el) => el.child(trailing));
}

// Neutral action / solid primary h28/px12/R8. Play is h40/px20/capsule20; Send is the 28 px accent circle.
// `h`: a taller pressable box (ROW.touch in a narrow view); the words stay their size.
export function actionButton(t, id, text, label, onPress, { variant = "neutral", disabled = false, h = null } = {}) {
  const play = variant === "play", send = variant === "send";
  const tall = h ?? (play ? ROW.two : ROW.base);
  const base = textButton(t, id, text, label, onPress, { disabled, h: tall, size: play || send ? TYPE.lg : TYPE.sm })
    .px(play ? SPACE[5] : oneChar(text) ? SPACE[0] : SPACE[3]).gap(SPACE[2]).rounded(play || send ? tall / 2 : RADIUS.lg);
  return interactionStyle(base, t, { disabled, variant: variant === "neutral" ? "action" : variant, ground: t.surface, color: t.foreground });
}

// Caller supplies the actual child Input/Textarea focus fact and the same disabled state as the child. This
// only frames it: no extra focus handle, hover ring or Tab stop, and no second outline inside the composer.
export function fieldFrame(el, t, { focused = false, disabled = false, ground = t.surface } = {}) {
  return el.border(1).border_color(!disabled && focused === true ? t.accent : t.input)
    .bg(disabled ? t.surface : ground).text_color(disabled ? t.dim : t.foreground).disabled(disabled);
}

// A folder for people: ~ for home.
export function folderLabel(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}
// A folder's own name, the last part of its path: what tells two panes apart where a whole path cut at its end did
// not (owner, 11 Nov). "~" for the home folder, "/" for the root; the whole path is folderLabel's.
export function folderName(cwd) {
  const f = folderLabel(cwd);
  return f === "~" || f === "/" ? f : f.split("/").filter(Boolean).pop() ?? "";
}

// "4m", "2h", "3d"; "<1m" under a minute.
export function since(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const hrs = Math.floor(m / 60);
  return hrs < 24 ? `${hrs}h` : `${Math.floor(hrs / 24)}d`;
}

export const clock = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
};

// Find a node of the shown layout by id.
export function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

// The "/" command list (owner request 30), the same in the chat's popover and the pane's popup: 28 px rows with
// the command in mono, its argument hint, one line of description and a quiet safety label; a footer with the keys
// (the shared kbd) and, in its tooltip, where the list comes from. `view`: {start, rows} (adapters/slash-commands.js visibleRows);
// `blocked(entry)`: why a row can't be picked here, or null. Rows pick on click; keys belong to the caller.
export function slashList(t, m, view, { id, onPick, blocked = () => null, source = "", note = null, words = {} }) {
  const row = (c, k) => {
    const i = view.start + k;
    const on = i === m.i;
    const why = blocked(c);
    const label = words[c.safety] ?? null;
    return h_flex().id(`${id}-r${i}`).h(ROW.base).flex_none().px(SPACE[3]).gap(SPACE[2]).items_center()
      .when(on, (el) => el.bg(t.selected)).hover((st) => st.bg(on ? t.selected : t.hover))
      .role("list_box_option").accessibility_label(`/${c.name}: ${c.description}${label ? `, ${label}` : ""}${why ? `. ${why}` : ""}`)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((e, cx) => { cx.stop_propagation(); onPick(i, e, cx); })
      .child(div().flex_none().text_size(TYPE.sm).font_family(monoFont()).text_color(why ? t.dim : t.foreground).when(on && !why, (el) => el.font_medium()).child(`/${c.name}`))
      .when(Boolean(c.args), (el) => el.child(div().flex_none().max_w(160).truncate().text_size(TYPE.xs).font_family(monoFont()).text_color(t.dim).child(c.args)))
      .child(div().flex_1().min_w(0).truncate().text_size(TYPE.sm).text_color(t.dim).child(c.description))
      .when(Boolean(label), (el) => el.child(badge(t, label, `${id}-b${i}`)));
  };
  const legend = (k, w) => h_flex().gap(SPACE[1]).items_center().child(kbd(t, [k])).child(w);
  return div().flex().flex_col().id(id).w_full().role("list_box").accessibility_label("Commands")
    .child(div().flex().flex_col().py(SPACE[1]).children(view.rows.map(row)))
    .when(m.shown.length === 0, (el) => el.child(div().h(ROW.base).px(SPACE[3]).flex().items_center().text_size(TYPE.sm).text_color(t.dim).child(`No command matches “/${m.query}”`)))
    .when(Boolean(note), (el) => el.child(div().px(SPACE[3]).py(SPACE[1]).text_size(TYPE.xs).text_color(t.blocked).child(note)))
    .child(h_flex().id(`${id}-foot`).h(ROW.base).px(SPACE[3]).gap(SPACE[3]).items_center().border_t(1).border_color(t.border).text_size(TYPE.xs).text_color(t.dim)
      .when(Boolean(source), (el) => el.accessibility_label(source))
      .child(legend("↑↓", "move")).child(legend("↵", "insert")).child(legend("Esc", "close"))
      .child(div().flex_1()).child(div().flex_none().child(`${m.shown.length} of ${m.all.length}`)));
}
