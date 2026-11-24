// The tree model (lead rule, sub-agents, records, exited). The factory board's model is in factory-board.test.js.
import { test, expect } from "bun:test";
import { buildTree, treeWord, recordRows, displayWord } from "../adapters/status.js";

const prog = (agent, shell = false) => ({ agent, shell, name: agent ? "Claude Code" : "zsh", key: agent ? "claude" : "shell" });

test("the tree: a tab's lead, its sub-agents on lines, its records after them, a needs-you below rolls up", () => {
  const tree = buildTree({
    spaces: [{ id: "s", name: "app", tabs: [{ id: "tb", name: "lead", named: true }] }],
    panes: [{ pane: "p", terminal: "t1", tab: "tb", program: prog(true), focused: true }],
    terminals: [
      { address: "t1", state: "live", status: "working", records: { r1: { state: "working", title: "Explore" }, "r1/r2": { state: "idle", title: "Read" } } },
      { address: "t2", state: "live", status: "blocked", parent: "t1", name: "worker" },
    ],
    agents: [{ address: "t1", status: "working" }],
  });
  const lead = tree[0].rows[0];
  expect(lead.name).toBe("lead");
  expect(lead.subs.map((s) => [s.name, s.word, s.lines])).toEqual([["worker", "needs", ["├"]]]);
  expect(lead.records.map((r) => [r.title, r.lines])).toEqual([["Explore", ["└"]], ["Read", [" ", "└"]]]);
  expect(lead.word).toBe("needs");
  expect(tree[0].word).toBe("needs");
});

test("status words: blocked and error need the person; a waiting parent is at work; exited after a report", () => {
  expect(displayWord("error")).toBe("needs");
  expect(treeWord("idle", ["working"])).toBe("working");
  expect(treeWord("done", ["working"])).toBe("done");
  const tree = buildTree({
    spaces: [{ id: "s", name: "x", tabs: [{ id: "tb", name: "2", named: false }] }],
    panes: [{ pane: "p", terminal: "t1", tab: "tb", program: prog(false, true) }],
    terminals: [{ address: "t1", state: "live", status: null, reported: true }],
    agents: [],
  });
  expect(tree[0].rows[0].word).toBe("exited");
  expect(recordRows({ records: { "a/b": { state: "idle" } } })[0].lines).toEqual(["└"]);
});
