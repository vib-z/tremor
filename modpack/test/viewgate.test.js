import { test, expect } from "bun:test";
import { ViewGate } from "../adapters/reader.js";

// Review F5: a closed chat reads nothing, and an answer that started before a hide is never applied.
test("no read starts while the chat is hidden or has no target", () => {
  const g = new ViewGate();
  expect(g.start(false, "t1")).toBe(null);
  expect(g.start(true, null)).toBe(null);
  expect(g.start(true, "t1")).not.toBe(null);
});

test("an answer is used only while the same view is still shown", () => {
  const g = new ViewGate();
  const tok = g.start(true, "t1");
  expect(g.valid(tok, true, "t1")).toBe(true);
  expect(g.valid(tok, false, "t1")).toBe(false);
});

test("a hide and a show of the same target in between makes the answer stale", () => {
  const g = new ViewGate();
  const tok = g.start(true, "t1");
  g.observe(false, "t1");
  g.observe(true, "t1");
  expect(g.valid(tok, true, "t1")).toBe(false);
  expect(g.valid(g.start(true, "t1"), true, "t1")).toBe(true);
});

test("a new target makes the answer stale", () => {
  const g = new ViewGate();
  const tok = g.start(true, "t1");
  expect(g.valid(tok, true, "t2")).toBe(false);
});

test("the chat's reading loop checks the gate around every await", async () => {
  const src = await Bun.file(new URL("../mods/pdk-chat/main.js", import.meta.url)).text();
  const tick = src.slice(src.indexOf("  async tick(cx) {"), src.indexOf("  // herdr.seen"));
  const awaits = [...tick.matchAll(/await /g)].length;
  expect(awaits).toBeGreaterThan(0);
  // Each await is preceded by a `live()` check on its line or the line before, and followed by one.
  const lines = tick.split("\n");
  lines.forEach((line, i) => {
    if (!/await /.test(line)) return;
    expect(`${lines[i - 1]}\n${line}`, `before: ${line.trim()}`).toMatch(/live\(\)/);
    expect(lines[i + 1], `after: ${line.trim()}`).toMatch(/if \(!live\(\)\) return;/);
  });
});
