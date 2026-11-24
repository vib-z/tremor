// Request 38, the pack renamed to tremor: a fresh install shows the tremor layout, and installing over a pdk-era
// install (main f9060bd's own installer, from git, into a scratch home under /tmp/pdk-t<pid>) is clean, or is
// refused before anything changes. The live profile is never a target here.
import { test, expect, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, statSync } from "node:fs";

const PACK = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const ROOT = `/tmp/pdk-t${process.pid}`;
const OLD = `${ROOT}/old/modpack`;
const REAL_HOME = Bun.spawnSync(["/bin/sh", "-c", 'eval echo "~$(id -un)"']).stdout.toString().trim();
mkdirSync(`${ROOT}/old`, { recursive: true });
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));
const unpacked = Bun.spawnSync(["/bin/sh", "-c", 'git -C "$1" archive --prefix=modpack/ f9060bd:modpack | tar -x -C "$2"', "sh", `${PACK}/..`, `${ROOT}/old`]);

const run = (pack, script, home) => {
  const r = Bun.spawnSync(["/bin/sh", `${pack}/${script}`, home], { env: { HOME: REAL_HOME, PATH: "/usr/bin:/bin:/usr/sbin" } });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
};
const fresh = (name) => { const h = `${ROOT}/${name}/home`; mkdirSync(h, { recursive: true }); return h; };
const keys = (h) => JSON.parse(readFileSync(`${h}/keys.json`, "utf8"));
const files = (h) => Object.fromEntries(readdirSync(h, { recursive: true }).map(String).filter((f) => statSync(`${h}/${f}`).isFile()).sort()
  .map((f) => [f, Bun.hash(readFileSync(`${h}/${f}`)).toString()]));
const OURS = { "cmd-k": "mod.open:pdk-search", "cmd-p": "mod.open:pdk-search" };
const BASE = '{\n  "global": {\n    "cmd-j": "tab.new"\n  }\n}\n';

test("the pdk-era pack unpacks from main f9060bd", () => {
  expect(unpacked.exitCode).toBe(0);
  expect(existsSync(`${OLD}/layouts/pdk.json`)).toBe(true);
});

test("a fresh install shows the tremor layout and binds Cmd+K / Cmd+P for it", () => {
  const h = fresh("fresh");
  const r = run(PACK, "install.sh", h);
  expect(r.code).toBe(0);
  expect(r.out).toContain("Installed tremor into");
  expect(r.out).toContain("herdr-app do layout.switch --name tremor");
  expect(readdirSync(`${h}/layouts`)).toEqual(["tremor.json"]);
  expect(readFileSync(`${h}/layouts/tremor.json`, "utf8")).toBe(readFileSync(`${PACK}/layouts/tremor.json`, "utf8"));
  expect(keys(h)["layout:tremor"]).toEqual(OURS);
  expect(keys(h)["layout:pdk"]).toBeUndefined();
  expect(run(PACK, "uninstall.sh", h).out).toContain("Uninstalled tremor from");
}, 60000);

for (const own of [true, false]) test(`over a pdk-era install: layouts/pdk.json and its layout:pdk block go, tremor's come; uninstall restores the keys (own keys.json: ${own})`, () => {
  const h = fresh(`upgrade-${own}`);
  if (own) writeFileSync(`${h}/keys.json`, BASE);
  expect(run(OLD, "install.sh", h).code).toBe(0);
  expect(existsSync(`${h}/layouts/pdk.json`)).toBe(true);
  expect(keys(h)["layout:pdk"]).toEqual(OURS);
  const r = run(PACK, "install.sh", h);
  expect(r.code).toBe(0);
  expect(readdirSync(`${h}/layouts`)).toEqual(["tremor.json"]);
  expect(keys(h)["layout:pdk"]).toBeUndefined();
  expect(keys(h)["layout:tremor"]).toEqual(OURS);
  if (own) expect(readFileSync(`${h}/keys.json`, "utf8")).toBe(BASE.replace(/\n}\n$/, ',\n  "layout:tremor": {\n    "cmd-k": "mod.open:pdk-search",\n    "cmd-p": "mod.open:pdk-search"\n  }\n}\n'));
  const manifest = readFileSync(`${h}/.pdk-backup/manifest.sums`, "utf8");
  expect(manifest).not.toContain("layouts/pdk.json");
  expect(existsSync(`${h}/.pdk-backup/known.sums`)).toBe(false);
  expect(run(PACK, "install.sh", h).code).toBe(0);
  expect(readFileSync(`${h}/.pdk-backup/manifest.sums`, "utf8")).toBe(manifest);
  expect(run(PACK, "uninstall.sh", h).code).toBe(0);
  if (own) expect(readFileSync(`${h}/keys.json`, "utf8")).toBe(BASE);
  else expect(existsSync(`${h}/keys.json`)).toBe(false);
  expect(existsSync(`${h}/layouts/tremor.json`)).toBe(false);
  expect(existsSync(`${h}/.pdk-backup`)).toBe(false);
}, 60000);

test("over a pdk-era install whose layouts/pdk.json was changed: refused, nothing changes, the old checkout's uninstall named", () => {
  const h = fresh("edited-layout");
  expect(run(OLD, "install.sh", h).code).toBe(0);
  writeFileSync(`${h}/layouts/pdk.json`, readFileSync(`${h}/layouts/pdk.json`, "utf8") + "\n");
  const before = files(h);
  const r = run(PACK, "install.sh", h);
  expect(r.code).toBe(1);
  expect(r.out).toContain("these files of the earlier install were changed since it was installed, nothing changed: layouts/pdk.json");
  expect(r.out).toContain("run uninstall.sh from the old checkout first");
  expect(files(h)).toEqual(before);
}, 60000);

test("over a pdk-era install whose layout:pdk block was edited: refused, nothing changes; the old uninstall says what to restore", () => {
  const h = fresh("edited-keys");
  writeFileSync(`${h}/keys.json`, BASE);
  expect(run(OLD, "install.sh", h).code).toBe(0);
  writeFileSync(`${h}/keys.json`, readFileSync(`${h}/keys.json`, "utf8").replace('"cmd-p": "mod.open:pdk-search"', '"cmd-p": "mod.open:pdk-search",\n    "cmd-y": "tab.new"'));
  const before = files(h);
  const r = run(PACK, "install.sh", h);
  expect(r.code).toBe(1);
  expect(r.out).toContain(`keys.json: the earlier install's "layout:pdk" block was edited since install, nothing changed`);
  expect(r.out).toContain("run uninstall.sh from the old checkout first");
  expect(files(h)).toEqual(before);
  const old = run(OLD, "uninstall.sh", h);
  expect(old.code).toBe(1);
  expect(old.out).toContain('take the search keys out of "layout:pdk" yourself');
}, 60000);
