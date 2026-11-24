import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { harness, evaluate, world } from "./parity-harness.js";
import { SLASH_KINDS } from "../adapters/slash-commands.js";

// Owner, 11 Nov: a pane's header shows its folder's own name, never a whole path cut at its end (the end is what tells
// panes apart). The whole path is the tooltip of the space the name sits in (the controls cover the name on hover)
// and the name's accessible name. The harness's home folder is /private-test.
function header(cwd) {
  const w = world();
  w.panes[0].cwd = cwd;
  const h = harness(w, { pane: "p1" });
  Object.assign(h.env, evaluate("shared/ui.js", h.env, "({ folderLabel, folderName, paneLabel })"), { SLASH_KINDS });
  const Pane = evaluate("mods/pdk-pane/main.js", h.env, "Pane");
  const v = new Pane();
  v.init({}, h.cx);
  v.render();
  const dir = h.byId("ph-dir-p1"), path = h.byId("ph-right-p1");
  return { text: dir.kids.join(""), aria: dir.props.accessibility_label, tooltip: path.props.tooltip, dir: dir.props, path: path.props };
}

test("the pane header shows the folder's own name; the whole path is its tooltip and accessible name", () => {
  const deep = header("/private-test/code/jobs/worktrees/core-client-1108");
  expect([deep.text, deep.tooltip, deep.aria]).toEqual(["core-client-1108", "~/code/jobs/worktrees/core-client-1108", "~/code/jobs/worktrees/core-client-1108"]);
  expect([header("/private-test").text, header("/private-test").tooltip]).toEqual(["~", "~"]);
  expect([header("/").text, header("/").tooltip]).toEqual(["/", "/"]);
  expect([header("/srv/app/").text, header("/srv/app/").tooltip]).toEqual(["app", "/srv/app/"]);
  const none = header(undefined);
  expect([none.text, "tooltip" in none.path]).toEqual(["", false]);
  // The name keeps its width and ends in an ellipsis only when it is itself too long; the space it sits in takes the
  // rest of the header, its right end where the name sits.
  expect([deep.dir.truncate, deep.dir.min_w, "flex_1" in deep.dir]).toEqual([true, 0, false]);
  expect([deep.path.flex_1, deep.path.justify_end]).toEqual([true, true]);
});

// The chat header has the same folder line (lead, 11 Nov): its header() rendered with the harness's stand-ins.
test("the chat header shows the folder's own name too; the whole path is its tooltip and accessible name", () => {
  const src = readFileSync(new URL("../mods/pdk-chat/main.js", import.meta.url), "utf8");
  const start = src.indexOf("  header(t, term, kind) {"), end = src.indexOf("\n  }\n", start) + 4;
  const w = world();
  w.panes[0].cwd = "/private-test/code/jobs/worktrees/core-client-1108";
  const h = harness(w);
  const env = { ...h.env, ...evaluate("shared/ui.js", h.env, "({ folderLabel, folderName, paneLabel })"), SUPPORT: {}, rawStatus: () => null,
    HEAD: Number(src.match(/^const HEAD = (\d+);/m)[1]) }; // the header's height, as main.js defines it
  const names = Object.keys(env).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k));
  const header = new Function(...names, `return ({ ${src.slice(start, end)} }).header`)(...names.map((k) => env[k]));
  header.call({ metaOf: () => null, choiceOf: () => ({ model: null }), hit: (desktop) => desktop }, h.env.theme(), w.terminals[0], "codex"); // hit: a desktop-wide view
  const dir = h.byId("chat-dir");
  expect([dir.kids.join(""), dir.props.tooltip, dir.props.accessibility_label]).toEqual(["core-client-1108", "~/code/jobs/worktrees/core-client-1108", "~/code/jobs/worktrees/core-client-1108"]);
  expect([dir.props.truncate, dir.props.min_w]).toEqual([true, 0]);
});
