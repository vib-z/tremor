import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { appearance, SLOW_MS } from "../adapters/appear.js";

const base = { address: "t1", agent: true, kindName: "Claude Code", supported: true, note: null, program: null, state: "live", reason: null, rows: 0, pending: 0, stale: false, since: null, now: 10000, machine: null };
const look = (f) => appearance({ ...base, ...f });
const STATES = ["finding", "unbound", "waiting", "live", "offline", "error"];

test("a conversation on screen is never replaced: with rows there is no page and no block that stands instead of them", () => {
  for (const state of STATES) for (const stale of [false, true]) for (const machine of [null, "rohan"]) {
    const a = look({ state, stale, machine, rows: 3, reason: "why" });
    expect(a.page).toBeNull();
    expect(a.composer).toBe(true);
    expect(a.block?.id).not.toBe("empty");
  }
  expect(look({ rows: 3 }).block).toBeNull();
  expect(look({ rows: 0, pending: 1, state: "finding" }).block).toBeNull(); // what was just sent counts as content
});

test("pages only where there is no conversation to show", () => {
  expect(look({ address: null }).page.id).toBe("none");
  expect(look({ agent: false, program: "zsh" }).page).toMatchObject({ id: "shell", action: "terminal" });
  expect(look({ agent: false, program: "zsh" }).page.body).toContain("zsh");
  expect(look({ supported: false, note: "No transcript." }).page).toMatchObject({ id: "unsupported", header: true, body: "No transcript.", action: "terminal" });
  for (const state of STATES) expect(look({ state }).page).toBeNull();
});

test("loading says content is coming, and after SLOW_MS what it is waiting for", () => {
  const first = look({ state: "finding", since: 10000, now: 10000 + SLOW_MS - 1 });
  expect(first.block).toMatchObject({ id: "loading", tone: "loading", detail: null, action: null });
  expect(first.composer).toBe(true);
  expect(look({ state: "finding", since: 10000, now: 10000 + SLOW_MS }).block.detail).toBeTruthy();
  expect(look({ state: "finding", since: 10000, now: 10000 + SLOW_MS, machine: "rohan" }).block.detail).toContain("rohan");
  expect(look({ state: "live", rows: 2, stale: true }).block).toMatchObject({ id: "loading", tone: "loading" });
});

test("empty is said plainly; a failure says what to do and offers it", () => {
  expect(look({ state: "waiting" }).block).toMatchObject({ id: "empty", tone: "info", action: null });
  expect(look({ state: "live" }).block).toMatchObject({ id: "empty", tone: "info" });
  for (const rows of [0, 4]) {
    const e = look({ state: "error", reason: "the helper refused", rows }).block;
    expect(e).toMatchObject({ id: "error", tone: "error", action: "retry" });
    expect(e.detail).toContain("the helper refused");
    expect(e.detail).toMatch(/Try again/);
  }
  expect(look({ state: "offline", machine: "rohan", rows: 4 }).block).toMatchObject({ id: "offline", tone: "loading" });
  expect(look({ state: "offline", machine: "rohan" }).block.line).toContain("rohan");
  expect(look({ state: "unbound", reason: "no registry entry" }).block).toMatchObject({ id: "unbound", action: "terminal" });
});

test("the composer: not for a local session that can't be proven and has nothing on screen, else always", () => {
  expect(look({ state: "unbound", reason: "x" }).composer).toBe(false);
  expect(look({ state: "unbound", reason: "x", machine: "rohan" }).composer).toBe(true);
  expect(look({ state: "unbound", reason: "x", rows: 2 }).composer).toBe(true);
  for (const state of STATES.filter((s) => s !== "unbound")) expect(look({ state }).composer).toBe(true);
});

test("no words about internals reach a person", () => {
  const words = [];
  for (const state of STATES) for (const rows of [0, 2]) for (const machine of [null, "rohan"]) {
    const b = look({ state, rows, machine, reason: "why", since: 0 }).block;
    if (b) words.push(b.line, b.detail ?? "");
  }
  for (const w of words) expect(w).not.toMatch(/evidence|session records|registry|undefined|null/);
});

test("the chat asks appearance once per render and draws only what it answers", () => {
  const chat = readFileSync(new URL("../mods/pdk-chat/main.js", import.meta.url), "utf8");
  expect((chat.match(/appearance\(\{/g) ?? []).length).toBe(1);
  expect(chat).toContain("if (look.page) return root(");
  expect(chat).toContain("stateBlock(t, a.block, a.ctx)");
  expect(chat).not.toMatch(/Finding \$\{|No session evidence|No messages yet|Reading stopped/); // the words live in lib/appear.js
});

test("the feed's reason is shown as given, after our own words, and a missing one adds nothing", () => {
  for (const rows of [0, 2]) for (const state of ["error", "unbound"]) {
    const d = look({ state, rows, reason: "the helper refused" }).block.detail;
    expect(d.endsWith(" Reason: the helper refused.")).toBe(true);
    expect(d.indexOf("Reason:")).toBeGreaterThan(0);
    expect(look({ state, rows, reason: "it stopped." }).block.detail.endsWith("Reason: it stopped.")).toBe(true);
    expect(look({ state, rows, reason: null }).block.detail).not.toMatch(/Reason|null/);
  }
});
