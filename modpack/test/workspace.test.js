// The pure helpers of the one-tap "+" (adapters/workspace.js, spec §3); the flow itself is in plus.test.js.
import { test, expect } from "bun:test";
import { resolveFolder, folderChoices, defaultAgent, workspaceName, newMachine } from "../adapters/workspace.js";

test("resolveFolder: focused pane on that machine, else its last folder, else its home; never another machine's", () => {
  const lastFolders = { "": "/Users/v/code/tremor", box: "/home/v/evals" };
  // The focused pane's folder, only when that pane is on the machine asked about.
  expect(resolveFolder({ machine: null, focusedPane: { machine: null, cwd: "/Users/v/code/demo" }, lastFolders, home: "/Users/v" })).toBe("/Users/v/code/demo");
  expect(resolveFolder({ machine: "box", focusedPane: { machine: "box", cwd: "/srv/api" }, lastFolders, home: "/home/v" })).toBe("/srv/api");
  expect(resolveFolder({ machine: "box", focusedPane: { machine: null, cwd: "/Users/v/code/demo" }, lastFolders, home: "/home/v" })).toBe("/home/v/evals");
  expect(resolveFolder({ machine: "", focusedPane: { machine: "box", cwd: "/srv/api" }, lastFolders, home: "/Users/v" })).toBe("/Users/v/code/tremor");
  // No last folder there: its home. "" and null both mean this computer.
  expect(resolveFolder({ machine: "box", lastFolders: { "": "/Users/v/x" }, home: "/home/v" })).toBe("/home/v");
  expect(resolveFolder({ machine: "", lastFolders: { "": "/Users/v/x" } })).toBe("/Users/v/x");
  // Never "" or "/" (the owner's "/" workspace on box), never a relative path: the next answer instead.
  expect(resolveFolder({ machine: "box", focusedPane: { machine: "box", cwd: "/" }, lastFolders: { box: "" }, home: "/home/v" })).toBe("/home/v");
  expect(resolveFolder({ machine: "box", focusedPane: { machine: "box", cwd: "~/x" }, home: "/" })).toBeNull();
  // "/" only for root.
  expect(resolveFolder({ machine: "box", focusedPane: { machine: "box", cwd: "/" }, home: "/root" })).toBe("/");
  // Nothing known: null, and the caller opens a folder picker.
  expect(resolveFolder({ machine: "box" })).toBeNull();
  expect(resolveFolder()).toBeNull();
});

test("folderChoices: that machine's default folder comes first; another machine's is ignored; unset or invalid keeps the order", () => {
  const args = { machine: "box", focusedPane: { machine: "box", cwd: "/srv/api" }, lastFolders: { box: "/home/v/evals" }, home: "/home/v" };
  expect(folderChoices({ ...args, defaults: { box: "/home/v/work" } })).toEqual(["/home/v/work", "/srv/api", "/home/v/evals", "/home/v"]);
  expect(folderChoices({ ...args, defaults: { "": "/Users/v/work" } })).toEqual(["/srv/api", "/home/v/evals", "/home/v"]);
  expect(folderChoices({ ...args, defaults: { box: "work" } })).toEqual(["/srv/api", "/home/v/evals", "/home/v"]);
  expect(folderChoices(args)).toEqual(["/srv/api", "/home/v/evals", "/home/v"]);
  // "/" only for root.
  expect(folderChoices({ ...args, defaults: { box: "/" } })[0]).toBe("/srv/api");
  expect(folderChoices({ ...args, home: "/root", defaults: { box: "/" } })[0]).toBe("/");
  // "" and null both mean this computer.
  expect(folderChoices({ machine: null, defaults: { "": "/Users/v/work" }, home: "/Users/v" })).toEqual(["/Users/v/work", "/Users/v"]);
});

test("defaultAgent: the last-used installed agent, else Claude Code, else Codex, else the first installed, else null", () => {
  const claude = { key: "claude", name: "Claude Code", run: ["claude"], installed: true };
  const codex = { key: "codex", name: "Codex", run: ["codex", "--no-daemon"], installed: true };
  const pi = { key: "pi", name: "Pi", run: ["pi"], installed: true };
  expect(defaultAgent({ known: [claude, codex, pi], lastUsed: "pi" })).toBe(pi);
  expect(defaultAgent({ known: [codex, claude], lastUsed: null })).toBe(claude);
  expect(defaultAgent({ known: [codex, { ...pi, installed: false }], lastUsed: "pi" })).toBe(codex);
  expect(defaultAgent({ known: [{ ...claude, installed: false }, codex] })).toBe(codex);
  expect(defaultAgent({ known: [{ ...claude, run: [] }, pi] })).toBe(pi);
  expect(defaultAgent({ known: [{ ...pi, installed: false }] })).toBeNull();
  expect(defaultAgent({ known: [] })).toBeNull();
  expect(defaultAgent()).toBeNull();
});

test("folderChoices in order, without duplicates; the machine; the name, Home and numbered", () => {
  expect(folderChoices({ machine: "", focusedPane: { machine: "", cwd: "/a" }, lastFolders: { "": "/a", box: "/b" }, home: "/h" })).toEqual(["/a", "/h"]);
  expect(newMachine("box", [])).toBe("box");
  expect(newMachine("", [{ active: true, machine: "box" }])).toBe("");
  expect(newMachine("all", [{ active: true, machine: "box" }])).toBe("box");
  expect(newMachine("all", [])).toBe("");
  expect(workspaceName("/Users/v/code/evals/")).toBe("evals");
  expect(workspaceName("/Users/v", { home: "/Users/v/" })).toBe("Home");
  expect(workspaceName("/x/evals", { taken: ["evals", "evals 2", "other"] })).toBe("evals 3");
});
