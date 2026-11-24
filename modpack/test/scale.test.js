import { test, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// One scale everywhere (owner 19:07, request 21): type, spacing and icon sizes come from shared/ui.js's TYPE, SPACE
// and ICON (and ROW for row heights), never a bare px number. Every surface has moved, so no file is exempt.
const ROOT = new URL("..", import.meta.url).pathname;
const UI = readFileSync(join(ROOT, "shared/ui.js"), "utf8");
const scale = (name) => Object.values(JSON.parse(UI.match(new RegExp(`export const ${name} = (\\{[^}]*\\});`))[1].replace(/(\w+):/g, '"$1":')));
// Bare numbers must sit on the 4 px grid; the contract's fine steps (half, status, mark, pill, inset) only by name.
const GRID = new Set(scale("SPACE").filter((v) => v % 4 === 0));
const ICONS = new Set(scale("ICON"));

function files(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : n.endsWith(".js") ? [p] : [];
  });
}

// The scale's own definitions are the one place numbers belong.
const DEFINES = /^export const (TYPE|SPACE|ICON|ROW|RADIUS) =/;

// A scale-specific syntax walk, not JS execution: tokenise strings/comments separately, pair delimiters,
// resolve named bindings and propagate glyph roles through local helper parameters. Unknown computations fail
// closed. This keeps the standalone Bun check free of undeclared parser dependencies.
function glyphViolations(rel, src) {
  const tokens = [], atom = /[\p{L}_$][\p{L}\p{N}_$]*|\d+(?:\.\d+)?|===|!==|==|!=|>=|<=|=>|\.\.\.|\?\.|\?\?|\|\||&&|[^\s]/uy;
  let offset = 0, line = 1;
  const advance = (n = 1) => { line += src.slice(offset, offset + n).split("\n").length - 1; offset += n; };
  const lex = (interpolation = false) => {
    let braces = 0;
    while (offset < src.length) {
      const c = src[offset], at = line;
      if (/\s/.test(c)) { advance(); continue; }
      if (src.startsWith("//", offset)) { while (offset < src.length && src[offset] !== "\n") advance(); continue; }
      if (src.startsWith("/*", offset)) { const end = src.indexOf("*/", offset + 2); advance((end < 0 ? src.length : end + 2) - offset); continue; }
      // A regexp in expression position is data too; its parentheses/braces are not call structure.
      if (c === "/" && (!tokens.length || ["=", "(", "[", "{", ",", ":", "return", "=>", "!", "?", "||", "&&"].includes(tokens.at(-1).value))) {
        let j = offset + 1, bracket = false;
        for (; j < src.length && src[j] !== "\n"; j++) {
          if (src[j] === "\\") { j++; continue; }
          if (src[j] === "[") bracket = true;
          if (src[j] === "]") bracket = false;
          if (src[j] === "/" && !bracket) break;
        }
        if (src[j] === "/") {
          j++; while (/[a-z]/i.test(src[j] ?? "") && j < src.length) j++;
          tokens.push({ value: src.slice(offset, j), line: at, literal: true }); advance(j - offset); continue;
        }
      }
      if (c === '"' || c === "'") {
        const start = offset; advance();
        while (offset < src.length && src[offset] !== c) advance(src[offset] === "\\" ? Math.min(2, src.length - offset) : 1);
        if (offset < src.length) advance();
        tokens.push({ value: src.slice(start, offset), line: at, literal: true }); continue;
      }
      if (c === "`") {
        tokens.push({ value: "`template`", line: at, literal: true }); advance();
        while (offset < src.length && src[offset] !== "`") {
          if (src[offset] === "\\") advance(Math.min(2, src.length - offset));
          else if (src.startsWith("${", offset)) {
            const first = line; advance(2); tokens.push({ value: "(", line: first }); lex(true); tokens.push({ value: ")", line });
          } else advance();
        }
        if (offset < src.length) advance(); continue;
      }
      if (c === "}" && interpolation && braces === 0) { advance(); return; }
      if (c === "{") braces++;
      if (c === "}") braces--;
      atom.lastIndex = offset; const m = atom.exec(src);
      tokens.push({ value: m[0], line: at }); advance(m[0].length);
    }
  };
  lex();
  const v = (i) => tokens[i]?.value, pair = new Map(), stack = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].literal) continue;
    if (["(", "[", "{"].includes(v(i))) stack.push(i);
    else if ([")", "]", "}"].includes(v(i))) { const open = stack.pop(); pair.set(open, i); pair.set(i, open); }
  }
  const split = (a, b) => {
    const result = []; let start = a;
    for (let i = a; i < b; i++) {
      if (["(", "[", "{"].includes(v(i))) i = pair.get(i) ?? i;
      else if (v(i) === ",") { result.push([start, i]); start = i + 1; }
    }
    if (start < b) result.push([start, b]); return result;
  };
  const unwrap = (a, b) => { while (v(a) === "(" && pair.get(a) === b - 1) { a++; b--; } return [a, b]; };
  const expressionEnd = (start) => {
    let i = start;
    for (; i < tokens.length; i++) {
      if (["(", "[", "{"].includes(v(i))) i = pair.get(i) ?? i;
      else if ([";", ",", "}"].includes(v(i))) break;
    }
    return i;
  };
  const bindings = new Map(), aliases = new Map(), functions = [], declarations = new Set();
  const scope = (at) => [...pair].filter(([a, b]) => v(a) === "{" && a < at && at < b).sort((a, b) => (a[1] - a[0]) - (b[1] - b[0]))[0] ?? [-1, tokens.length];
  const binding = (name, at) => (bindings.get(name) ?? []).filter((d) => d.scope[0] < at && at < d.scope[1]).sort((a, b) => (a.scope[1] - a.scope[0]) - (b.scope[1] - b.scope[0]) || b.at - a.at)[0];
  const defineFunction = (name, a, b, body, last) => {
    const params = split(a, b).map(([x, y]) => ({ name: /^[\p{L}_$]/u.test(v(x) ?? "") ? v(x) : null,
      fallback: v(x + 1) === "=" ? [x + 2, y] : null }));
    const defaults = new Map();
    for (let i = a; i < b; i++) if (v(i + 1) === "=") {
      let j = i + 2; while (j < b && ![",", "}"].includes(v(j))) { if (["(", "[", "{"].includes(v(j))) j = pair.get(j); j++; }
      defaults.set(v(i), [i + 2, j]);
    }
    functions.push({ name, params, defaults, start: body, end: last });
  };
  const apiNames = new Set(["ICON", "iconFor", "icon", "kindMarker", "kindIcon", "iconButton"]);
  for (let i = 0; i < tokens.length; i++) {
    if (["const", "let", "var"].includes(v(i)) && v(i + 1) === "{" && v(pair.get(i + 1) + 1) === "=")
      for (const [a] of split(i + 2, pair.get(i + 1))) if (apiNames.has(v(a))) aliases.set(v(a + 1) === ":" ? v(a + 2) : v(a), v(a));
    if (v(i) === "import" && v(i + 1) === "{") for (const [a, b] of split(i + 2, pair.get(i + 1))) {
      const name = v(a); aliases.set(b - a === 3 && v(a + 1) === "as" ? v(a + 2) : name, name);
    }
    if (["const", "let", "var"].includes(v(i)) && v(i + 2) === "=") {
      const name = v(i + 1), a = i + 3, b = expressionEnd(a); bindings.set(name, [...(bindings.get(name) ?? []), { value: [a, b], at: i, scope: scope(i) }]);
      let p = a; if (v(p) === "async") p++;
      const lastParam = v(p) === "(" ? pair.get(p) : p;
      if (v(lastParam + 1) === "=>") defineFunction(name, v(p) === "(" ? p + 1 : p, v(p) === "(" ? lastParam : p + 1, lastParam + 2, b);
    }
    if (v(i) === "function" && v(i + 2) === "(") {
      const close = pair.get(i + 2); declarations.add(i + 2);
      defineFunction(v(i + 1), i + 3, close, close + 1, pair.get(close + 1));
    }
  }
  const canonical = (name, at, seen = new Set()) => {
    if (seen.has(name)) return name; seen.add(name);
    if (aliases.has(name) && aliases.get(name) !== name) return canonical(aliases.get(name), at, seen);
    const bound = binding(name, at), value = bound?.value;
    if (value) {
      const [a, b] = unwrap(...value);
      if (b - a === 1 && /^[\p{L}_$]/u.test(v(a))) return canonical(v(a), bound.at, seen);
      const member = v(a + 1) === "." && b - a === 3 ? v(a + 2)
        : v(a + 1) === "[" && pair.get(a + 1) === b - 1 ? v(a + 2)?.replace(/^["']|["']$/g, "") : null;
      if (apiNames.has(member)) return member;
    }
    return name;
  };
  const roles = new Map(Object.entries({ icon: [[1, "icon"]], kindMarker: [[2, "icon"]], kindIcon: [[2, "icon"]], iconButton: [[5, "options"]] }).map(([name, entries]) => [name, new Map(entries)]));
  const context = (at) => functions.filter((f) => f.start <= at && at <= f.end).sort((a, b) => a.end - a.start - (b.end - b.start))[0];
  const constrain = (name, at, role) => {
    const f = context(at), index = f?.params.findIndex((p) => p.name === name) ?? -1;
    if (index >= 0) {
      if (!roles.has(f.name)) roles.set(f.name, new Map()); roles.get(f.name).set(index, role);
      return { parameter: true, fallback: f.params[index].fallback };
    }
    return f?.defaults.has(name) ? { parameter: true, fallback: f.defaults.get(name) } : null;
  };
  const icon = (a, b, at, literal = false, seen = new Set()) => {
    [a, b] = unwrap(a, b); if (a >= b) return false;
    const word = v(a), key = `${a}:${b}`; if (seen.has(key)) return false; seen = new Set(seen).add(key);
    if (b - a === 1) {
      if (/^\d/.test(word)) return literal && ICONS.has(Number(word));
      const p = constrain(word, at, "icon");
      if (p) return !p.fallback || icon(...p.fallback, at, true, seen);
      const bound = binding(word, at); return Boolean(bound && icon(...bound.value, bound.at, literal, seen));
    }
    if (canonical(word, at) === "ICON" && !context(at)?.params.some((p) => p.name === word) && (!binding("ICON", at) || rel === "shared/ui.js") && ((v(a + 1) === "." && b - a === 3) || (v(a + 1) === "[" && pair.get(a + 1) === b - 1))) {
      const name = v(a + 2)?.replace(/^["']|["']$/g, ""); return ["sm", "base", "lg", "dot", "caret"].includes(name);
    }
    if (canonical(word, at) === "iconFor" && v(a + 1) === "(" && pair.get(a + 1) === b - 1) return true;
    // The Factory Map's disc mark scales with its disc, 10 to 40 px (lead's allowance, 14 Nov 2026): DISC_MARK(...) there only.
    if (rel === "mods/pdk-factory/map.js" && word === "DISC_MARK" && v(a + 1) === "(" && pair.get(a + 1) === b - 1) return true;
    for (let i = a; i < b; i++) {
      if (["(", "[", "{"].includes(v(i))) i = pair.get(i) ?? i;
      else if (v(i) === "?") {
        let depth = 0;
        for (let j = i + 1; j < b; j++) {
          if (["(", "[", "{"].includes(v(j))) j = pair.get(j) ?? j;
          else if (v(j) === "?") depth++;
          else if (v(j) === ":" && depth-- === 0) return icon(i + 1, j, at, literal, seen) && icon(j + 1, b, at, literal, seen);
        }
      }
    }
    return false;
  };
  const options = (a, b, at, seen = new Set()) => {
    [a, b] = unwrap(a, b); const key = `${a}:${b}`; if (seen.has(key)) return false; seen = new Set(seen).add(key);
    if (b - a === 1) {
      const p = constrain(v(a), at, "options"); if (p) return !p.fallback || options(...p.fallback, at, seen);
      const bound = binding(v(a), at); return Boolean(bound && options(...bound.value, bound.at, seen));
    }
    if (v(a) !== "{" || pair.get(a) !== b - 1) return false;
    return split(a + 1, b - 1).every(([x, y]) => v(x) === "..." ? options(x + 1, y, at, seen)
      : v(x)?.replace(/^["']|["']$/g, "") === "glyph" ? icon(v(x + 1) === ":" ? x + 2 : x, y, at) : true);
  };
  const calls = [];
  for (let i = 0; i < tokens.length; i++) {
    if (v(i + 1) === "(" && !declarations.has(i + 1)) calls.push({ name: canonical(v(i), i), args: split(i + 2, pair.get(i + 1)), at: i });
    // A glyph painted directly through svg().size(): follow its argument back through the helper too.
    if (v(i) === "size" && v(i - 1) === "." && v(i - 2) === ")" && v(pair.get(i - 2) - 1) === "svg")
      calls.push({ name: "painted-svg", args: split(i + 2, pair.get(i + 1)), at: i });
  }
  roles.set("painted-svg", new Map([[0, "paint"]]));
  const errors = new Set();
  const checkCalls = (report) => {
    for (const c of calls) for (const [index, role] of roles.get(c.name) ?? []) {
      const arg = c.args[index]; if (!arg) continue;
      const ok = role === "options" ? options(...arg, c.at) : icon(...arg, c.at, role === "paint");
      if (!ok && report) errors.add(`${rel}:${tokens[c.at].line} ${c.name} ${role}: use a provable ICON or iconFor value`);
    }
  };
  for (let i = 0; i <= functions.length; i++) checkCalls(false);
  checkCalls(true);
  for (let i = 0; i < tokens.length; i++) if (v(i)?.replace(/^["']|["']$/g, "") === "glyph" && [":", "="].includes(v(i + 1))) {
    let j = i + 2; while (j < tokens.length && ![",", "}", ")", ";"].includes(v(j))) { if (["(", "[", "{"].includes(v(j))) j = pair.get(j); j++; }
    if (!icon(i + 2, j, i, v(i + 1) === "=")) errors.add(`${rel}:${tokens[i].line} glyph: use ICON`);
  }
  return [...errors];
}

export function violations(rel, src) {
  const bad = [];
  src.split("\n").forEach((line, i) => {
    if (DEFINES.test(line)) return;
    const at = `${rel}:${i + 1}`;
    for (const m of line.matchAll(/\.text_size\(\s*(\d+(?:\.\d+)?)\s*\)/g)) bad.push(`${at} text_size(${m[1]}): use TYPE`);
    if (/\bTYPE\.md\b/.test(line)) bad.push(`${at} TYPE.md: use TYPE.lg or TYPE.base`);
    for (const m of line.matchAll(/\.(gap|gap_x|gap_y|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr)\(\s*(\d+(?:\.\d+)?)\s*\)/g))
      if (!GRID.has(Number(m[2]))) bad.push(`${at} ${m[1]}(${m[2]}): off the 4 px grid`);
    for (const m of line.matchAll(/\bsize:\s*(\d+(?:\.\d+)?)/g)) bad.push(`${at} size: ${m[1]}: use ICON`);
  });
  return [...bad, ...glyphViolations(rel, src)];
}

test("the scale is the contract's: type 11/12/13/16, a 4 px grid plus named fine steps, icons tied to the text, 7 px markers", () => {
  expect(scale("TYPE").slice(0, 4)).toEqual([11, 12, 13, 16]);
  expect([...GRID]).toEqual([0, 4, 8, 12, 16, 20, 24, 32, 40, 48]);
  const named = JSON.parse(UI.match(/export const SPACE = (\{[^}]*\});/)[1].replace(/(\w+):/g, '"$1":'));
  expect(Object.fromEntries(Object.entries(named).filter(([k]) => !/^\d+$/.test(k)))).toEqual({ raise: 1, half: 2, status: 5, mark: 6, pill: 7, inset: 10 }); // tab (the machine tabs' inset) went with the tabs; raise: text on a bar's centre line
  expect(scale("ICON")).toEqual([12, 14, 14, 16, 7, 10]);
  expect(scale("ROW")).toEqual([24, 28, 28, 28, 34, 40, 44, 54]); // 44: a narrow view's touch size (owner, 12 Nov); // tabs (36, the machine tabs' track) went with the tabs
});

test("every surface takes type, spacing and icon sizes from the scale", () => {
  const bad = [];
  for (const d of ["mods", "shared"]) for (const f of files(join(ROOT, d))) {
    const rel = f.slice(ROOT.length);
    if (rel.includes("/lib/")) continue;
    if (rel === "mods/pdk-machine-add/stock.js") continue; // Herdr's own file, byte for byte; machine-add.test.js pins it
    bad.push(...violations(rel, readFileSync(f, "utf8")));
  }
  expect(bad).toEqual([]);
});

test("the checker catches what it should", () => {
  expect(violations("x.js", "el.text_size(14).gap(6).px(8)")).toEqual(["x.js:1 text_size(14): use TYPE", "x.js:1 gap(6): off the 4 px grid"]);
  expect(violations("x.js", "icon(\"search\", 15, t.dim)").length).toBe(1);
  expect(violations("x.js", "el.text_size(TYPE.base).gap(SPACE[2]).p(12)")).toEqual([]);
  expect(violations("x.js", "export const TYPE = { xs: 11 };")).toEqual([]);
});

// Audit H7: use the real call sites as well as aliases, balanced expressions, defaults and wrapper calls.
test("H7: actual 15px overrides and indirect glyph sizes cannot evade the scale guard", () => {
  const examples = [
    'iconButton(t, "id", "panel-left", "Toggle", click, { glyph: 15 })',
    'function button({ glyph = 15 } = {}) { return svg(path).size(glyph); }',
    'const px = 15; icon("search", (px), t.dim);',
    'const paint = kindMarker; paint(t, kind, (15), c, id);',
    'const paint = ui.kindMarker; paint(t, kind, 15, c, id);',
    'const paint = ui["kindMarker"]; paint(t, kind, 15, c, id);',
    'const {kindMarker: paint} = ui; paint(t, kind, 15, c, id);',
    'import { icon as paint } from "./ui.js"; paint("search", 15, c);',
    'const opts = { glyph: (15) }; iconButton(t, id, name, label, click, opts);',
    'const n = () => 15; icon("search", n(), c);',
    'const wrap = (s) => kindMarker(t, kind, s, c, id); wrap(15);',
    'const alias = ICON.base + 1; icon("search", alias, c);',
    'const n = 15; function other() { const n = ICON.base; } icon("search", n, c);',
    'function wrap(s = 15) { return icon("search", s, c); } wrap();',
    'const ICON = {base: 15}; icon("search", ICON.base, c);',
    'function paint(ICON) { icon("search", ICON.base, c); } paint({base:15});',
    'const px = 15; const node = `UI ${icon("search", px, c)}`;',
  ];
  for (const source of examples) expect(violations("repro.js", source).length, source).toBeGreaterThan(0);
  // pdk-tree's sidebar toggle is the shared button() now (no glyph option); the tab bar's still passes one.
  for (const rel of ["mods/pdk-tabs/main.js"]) {
    const line = readFileSync(join(ROOT, rel), "utf8").split("\n").find((s) => /glyph:/.test(s) && /sidebar-(toggle|show)/.test(s));
    expect(violations(rel, line)).toEqual([]);
    expect(line).toContain("glyph: ICON.base");
  }
});

test("H7: named scale aliases and helper propagation remain valid", () => {
  for (const source of [
    'const px = ICON.base; icon("search", (px), c);',
    'const {kindMarker: paint} = ui; paint(t, kind, ICON.base, c, id);',
    'const paint = ui.kindMarker; paint(t, kind, ICON.base, c, id);',
    'const paint = kindMarker; paint(t, kind, iconFor(TYPE.sm), c, id);',
    'import { ICON as I, icon as paint } from "./ui.js"; const n = I.base; paint("search", n, c);',
    'const wrap = (s) => kindMarker(t, kind, s, c, id); wrap(ICON.base);',
    'const options = { glyph: ICON.base }; iconButton(t, id, name, label, click, options);',
    'const px = ICON.base; const node = `UI ${icon("search", px, c)}`;',
    'const pattern = /icon(search,15)|glyph:15/; icon("search", ICON.base, c);',
    '// glyph: 15\nconst prose = "icon(search, 15)"; icon("search", ICON.base, c);',
  ]) expect(violations("valid.js", source), source).toEqual([]);
});

