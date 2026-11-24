import { test, expect } from "bun:test";
import { harness, world } from "./parity-harness.js";
import { findRow, renameTarget, renameSave } from "../adapters/status.js";

// Rename in place (owner, 10 Nov: "Workspaces, tabs and panes on sidebar must be double tap to rename in line - keep
// it simple. Right click provides other options"; 23:50: "follow how herdr does it"): a double-click on a workspace or
// tab name, or F2, makes it a field; Enter or a click elsewhere saves through Herdr's own rename, Esc cancels. A pane
// row (11 Nov: "let's follow herdr core bits"; Core can't rename a running terminal) is never renamed.

function scene() {
  const w = world(), h = harness(w);
  // tab1 split: a shell beside its Codex, so it has a pane row under it.
  w.panes.push({ pane: "pz", tab: "tab1", terminal: "tz", cwd: "/repo/a", focused: false, program: { key: "shell", name: "zsh", shell: true } });
  w.terminals.push({ address: "tz", state: "live", records: {} });
  const tree = new h.Tree(); tree.init({}, h.cx); h.tasks.length = 0; // init's loops never end
  tree.render(h.cx);
  const row = (key) => findRow(tree.list, key);
  const field = tree.renameInput;
  const renames = () => h.calls.filter((c) => /\.rename$/.test(c[0]));
  w.hc = async (args) => { h.calls.push(["hc", args]); return { code: 0, stdout: "", stderr: "" }; };
  return { w, h, tree, row, field, renames };
}

test("the model: workspaces and tabs only, Herdr's own commands; unchanged saves nothing; empty is automatic", () => {
  const s = scene();
  const space = renameTarget(s.row("sp:A"), "Alpha"), tab = renameTarget(s.row("tb:tab1"), "Task 1");
  expect(space).toEqual({ key: "sp:A", kind: "space", id: "A", text: "Alpha" });
  expect(tab).toEqual({ key: "tb:tab1", kind: "tab", id: "tab1", text: "Task 1" });
  expect(renameTarget(s.row("pn:pz"), "Terminal")).toBeNull();
  expect(renameSave(space, "  Alpha 2 ")).toEqual(["space.rename", { id: "A", name: "Alpha 2" }]);
  expect(renameSave(tab, "Task 1")).toBeNull();
  expect(renameSave(tab, "")).toEqual(["tab.rename", { id: "tab1", name: "" }]);
});

test("start, save with Enter, cancel with Esc, save by leaving the field", () => {
  const s = scene();
  s.tree.startRename(s.row("sp:A"), s.h.cx);
  expect(s.tree.renaming).toMatchObject({ key: "sp:A", kind: "space", id: "A" });
  expect(s.field.value()).toBe("Alpha");
  // The keys are the field's while it is open: arrows don't move the tree's selection.
  const sel = s.tree.sel; s.tree.onKey({ key: "down" }, s.h.cx); expect(s.tree.sel).toBe(sel);
  s.field.set_value("Alpha 2"); s.field.events.submit({}, s.h.cx);
  expect(s.renames()).toEqual([["space.rename", { id: "A", name: "Alpha 2" }]]);
  expect(s.tree.renaming).toBeNull();

  s.h.calls.length = 0;
  s.tree.startRename(s.row("tb:tab1"), s.h.cx); s.field.set_value("Nope");
  s.tree.onKey({ key: "escape" }, s.h.cx);
  expect(s.renames()).toEqual([]); expect(s.tree.renaming).toBeNull();

  // Empty goes back to Herdr's automatic name; leaving the field (a blur, past the double-click's moment) saves.
  s.tree.startRename(s.row("tb:tab1"), s.h.cx); s.field.set_value("");
  s.tree.renaming.at -= 1000; s.field.events.blur({}, s.h.cx);
  expect(s.renames()).toEqual([["tab.rename", { id: "tab1", name: "" }]]);
});

test("one rename at a time; one whose row went away is dropped, not saved; a redraw keeps it", () => {
  const s = scene();
  s.tree.startRename(s.row("sp:A"), s.h.cx); s.field.set_value("A2");
  s.tree.startRename(s.row("sp:B"), s.h.cx); // starting another saves the first
  expect(s.renames()).toEqual([["space.rename", { id: "A", name: "A2" }]]);
  expect(s.tree.renaming.key).toBe("sp:B");
  s.tree.render(s.h.cx); expect(s.tree.renaming?.key).toBe("sp:B"); // an ordinary redraw
  s.w.spaces.splice(1, 1); s.tree.render(s.h.cx);           // Beta closed elsewhere
  expect(s.tree.renaming).toBeNull();
  expect(s.renames()).toHaveLength(1);
});

test("a double-click on a workspace or tab name opens the field; one click does what it did; a pane row never renames", async () => {
  const s = scene();
  await s.h.flushRows(s.tree);
  // A click on a name: the name's handler, then the row's unless the name stopped it (as GPUI bubbles it).
  const click = (row, n) => {
    let stopped = false; const cx = { ...s.h.cx, stop_propagation: () => { stopped = true; } };
    s.h.byId(`${row}-name`).props.on_click({ click_count: n }, cx);
    if (!stopped) s.h.byId(row).props.on_click({ click_count: n }, cx);
  };
  const folded = s.tree.folded.has("sp:A");
  click("sp:A", 1); expect(s.tree.renaming).toBeNull();                 // one click folds, at once, as before
  expect(s.tree.folded.has("sp:A")).toBe(!folded);
  click("sp:A", 2); expect(s.tree.renaming?.key).toBe("sp:A");          // the second: the field, the fold put back
  expect(s.tree.folded.has("sp:A")).toBe(folded);
  s.tree.onKey({ key: "escape" }, s.h.cx);
  await s.h.flushRows(s.tree);
  s.h.calls.length = 0; click("tb:tab1", 1); expect(s.h.calls.some((c) => c[0] === "pane.focus" || c[0] === "tab.select")).toBe(true);
  click("tb:tab1", 2); expect(s.tree.renaming?.key).toBe("tb:tab1");
  s.tree.onKey({ key: "escape" }, s.h.cx);
  await s.h.flushRows(s.tree);
  s.h.calls.length = 0; click("pn:pz", 2); expect(s.tree.renaming).toBeNull(); // a pane: a double-click is a click
  expect(s.h.calls.some((c) => c[0] === "pane.focus")).toBe(true);
  // The field is drawn in the row, in the row's type.
  s.tree.startRename(s.row("sp:A"), s.h.cx); await s.h.flushRows(s.tree);
  const input = s.h.elements.findLast((e) => e.kind === "Input");
  expect(input.props).toMatchObject({ text_size: 13, font_medium: true, accessibility_label: "Name" });
  expect(s.h.byId("sp:A-rename").props.h).toBe(24);
});

test("F2 renames the selected row; right-click still opens Herdr's menu on a workspace, a tab and a pane", () => {
  const s = scene();
  s.tree.sel = "tb:tab1"; s.tree.nav = s.tree.list; s.tree.onKey({ key: "f2", }, { ...s.h.cx, stop_propagation: () => {} });
  expect(s.tree.renaming?.key).toBe("tb:tab1");
  s.tree.onKey({ key: "escape" }, { ...s.h.cx, stop_propagation: () => {} });
  // The Enter or Esc that ended it goes no further (no activate on the row).
  s.h.calls.length = 0; s.tree.onKey({ key: "enter" }, { ...s.h.cx, stop_propagation: () => {} }); expect(s.h.calls).toEqual([]);
  for (const [key, tab] of [["sp:A", "space"], ["tb:tab1", "tab"], ["pn:pz", "pane"]]) {
    s.tree.openContext(s.row(key));
    expect(s.h.overlays.at(-1)).toMatchObject({ mod: "menu", props: { tab } });
  }
});

test("a pane row: F2 does what a click does, nothing is written to its terminal", () => {
  const s = scene();
  const cx = { ...s.h.cx, stop_propagation: () => {} };
  s.tree.nav = s.tree.list; s.tree.sel = "pn:pz"; s.tree.onKey({ key: "f2" }, cx);
  expect(s.tree.renaming).toBeNull();
  expect(s.h.calls.some((c) => c[0] === "pane.focus")).toBe(true);
  expect(s.h.calls.filter((c) => c[0] === "hc")).toEqual([]);
});

// Review UX16: leaving the field (a click or Tab elsewhere) saves and leaves the focus where the person went; only Enter
// and Esc hand it back to the tree. The one blur Herdr causes right after a double-click whose first click showed a tab
// keeps the field; a blur with no such click pending saves at once.
test("blur paths: leaving saves without taking focus; Enter and Esc refocus the tree; the double-click's pane focus keeps the field", async () => {
  const s = scene();
  const focus = [];
  s.tree.handle.focus = () => focus.push("tree"); s.field.focus = () => focus.push("field");
  const blur = () => s.field.events.blur({}, s.h.cx);
  // F2 then a click elsewhere at once: saved, focus left alone.
  s.tree.startRename(s.row("sp:A"), s.h.cx); s.field.set_value("Alpha 2"); focus.length = 0;
  blur();
  expect(s.renames()).toEqual([["space.rename", { id: "A", name: "Alpha 2" }]]); expect(focus).toEqual([]); expect(s.tree.renaming).toBeNull();
  // Enter and Esc: the tree takes the keyboard back.
  s.tree.startRename(s.row("sp:A"), s.h.cx); focus.length = 0; s.tree.onKey({ key: "escape" }, s.h.cx); expect(focus).toEqual(["tree"]);
  s.tree.startRename(s.row("sp:A"), s.h.cx); s.field.set_value("Alpha 3"); focus.length = 0; s.field.events.submit({}, s.h.cx); expect(focus).toEqual(["tree"]);
  // A double-click on a tab name: its first click showed the tab (Herdr focuses its pane a moment later).
  await s.h.flushRows(s.tree);
  const click = (row, n) => { let stopped = false; const cx = { ...s.h.cx, stop_propagation: () => { stopped = true; } };
    s.h.byId(`${row}-name`).props.on_click({ click_count: n }, cx); if (!stopped) s.h.byId(row).props.on_click({ click_count: n }, cx); };
  click("tb:tab1", 1); click("tb:tab1", 2); expect(s.tree.renaming?.key).toBe("tb:tab1");
  s.field.set_value("Review"); s.h.calls.length = 0; focus.length = 0;
  blur();                                     // Herdr's own focus move: the field takes the keyboard back, nothing saved
  expect(focus).toEqual(["field"]); expect(s.tree.renaming?.key).toBe("tb:tab1"); expect(s.renames()).toEqual([]);
  blur();                                     // then the person clicks elsewhere: saved, focus left there
  expect(s.renames()).toEqual([["tab.rename", { id: "tab1", name: "Review" }]]); expect(focus).toEqual(["field"]);
  // Past the moment, even that first blur is the person leaving.
  click("tb:tab1", 1); click("tb:tab1", 2); s.tree.renaming.at -= 1000; s.field.set_value("Later"); focus.length = 0;
  blur(); expect(s.tree.renaming).toBeNull(); expect(focus).toEqual([]);
});
