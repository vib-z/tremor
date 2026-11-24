// Test the production mark colours against both painted chrome layers and every row overlay.
import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import { glassGrounds, contrast } from "../adapters/tokens.js";
const root = new URL("..", import.meta.url).pathname;
const tmp = mkdtempSync("/tmp/pdk-glass-marks-");
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
for (const dir of ["adapters", "shared"]) for (const f of readdirSync(join(root, dir))) if (f.endsWith(".js")) cpSync(join(root, dir, f), join(tmp, f));
writeFileSync(join(tmp, "stub-gpui.js"), "export const div = () => null; export const svg = () => null; export const h_flex = () => null; export const v_flex = () => null; export const Button = {}, Toggle = {}, Progress = {}, ProgressTrack = {}, ProgressIndicator = {}, HoverCard = {}, Popover = {};");
writeFileSync(join(tmp, "stub-herdr.js"), 'export const shared = () => null; export const setShared = () => {}; export const home = () => "/fixture"; export const settings = () => ({}); export const fonts = () => []; export const window = () => ({ platform: "macos" }); export const theme = () => ({}); export const spaces = () => []; export const keys = () => [];');
writeFileSync(join(tmp, "ui.js"), readFileSync(join(root, "shared/ui.js"), "utf8").replace('from "gpui-kit"', 'from "./stub-gpui.js"').replace('from "gpui-base"', 'from "./stub-gpui.js"').replace('from "herdr"', 'from "./stub-herdr.js"'));
const ui = await import(join(tmp, "ui.js"));
test("Glass defaults retain 3:1 brand marks and 4.5:1 text on the actual composed grounds", () => {
  for (const name of ["pdk-t3-glass-light", "pdk-t3-glass-dark"]) {
    const file = JSON.parse(readFileSync(join(root, "themes", `${name}.json`), "utf8"));
    const t = { ...file.colors, background: file.background };
    for (const ground of glassGrounds(file)) {
      for (const key of Object.keys(ui.AGENT_MARKS)) {
        const mark = ui.markColor(t, key);
        expect(contrast(mark, ground), `${name} ${key} on ${ground}`).toBeGreaterThanOrEqual(3);
        expect(contrast(ui.dimMark(mark, ui.groundOf(t, "chrome")), ground), `${name} idle ${key} on ${ground}`).toBeGreaterThanOrEqual(3);
      }
      for (const key of ["foreground", "muted", "dim"]) expect(contrast(t[key], ground), `${name} ${key} on ${ground}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});
