import { test, expect, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, chmodSync } from "node:fs";

// Audit H11: one bounded, TOML-aware guard turns off every MCP server a helper's Codex child would load, from the
// config layers that child reads, or refuses so that Codex never starts. Shared by pdk-helper.py and pdk-usage.py.
const GUARD = new URL("../helper/codex_guard.py", import.meta.url).pathname;
const HELPER = new URL("../helper/pdk-helper.py", import.meta.url).pathname;
const ROOT = `/tmp/pdk-cg${process.pid}`;
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));
let n = 0;

// The guard as the helpers call it, on a fresh home with `config` as its config.toml; `extra` adds files.
function flags(config, { env = {}, extra = {}, cwd } = {}) {
  const dir = `${ROOT}/${++n}`;
  mkdirSync(`${dir}/home/.codex`, { recursive: true });
  mkdirSync(`${dir}/work`, { recursive: true });
  if (config != null) writeFileSync(`${dir}/home/.codex/config.toml`, config);
  for (const [p, text] of Object.entries(extra)) { mkdirSync(`${dir}/${p}`.replace(/\/[^/]+$/, ""), { recursive: true }); writeFileSync(`${dir}/${p}`, text); }
  const e = { HOME: `${dir}/home`, PATH: "/usr/bin:/bin", ...Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v.replace("$DIR", dir)])) };
  const r = Bun.spawnSync(["/usr/bin/python3", "-I", "-S", GUARD, "flags", cwd ? cwd.replace("$DIR", dir) : `${dir}/work`], { env: e });
  return JSON.parse(r.stdout.toString());
}
const off = (...names) => ({ flags: names.flatMap((x) => ["-c", `mcp_servers.${x}.enabled=false`]) });

test("H11: the audit's two missed forms, and every other way TOML can name a server", () => {
  expect(flags('[mcp_servers."alpha"]\ncommand = "a"\n')).toEqual(off("alpha")); // quoted name (the audit's repro)
  expect(flags('[mcp_servers.alpha] # note\ncommand = "a"\n')).toEqual(off("alpha")); // header comment (the audit's repro)
  expect(flags("[ mcp_servers . 'beta' ]\r\nurl = 'x'\r\n")).toEqual(off("beta"));
  expect(flags('mcp_servers.gamma.command = "x"\n')).toEqual(off("gamma"));
  expect(flags('[mcp_servers]\ndelta = { command = "x", args = ["-y", "{"] }\n"eps" = {}\n')).toEqual(off("delta", "eps"));
  expect(flags('mcp_servers = { zeta = { command = "x" }, "eta" = {} }\n')).toEqual(off("eta", "zeta"));
  expect(flags('[mcp_servers.theta.env]\nKEY = "v"\n[mcp_servers.theta]\n')).toEqual(off("theta"));
  expect(flags('model = "o4"\n[tui]\nx = 1\n')).toEqual(off());
  expect(flags(null)).toEqual(off()); // no config: nothing to turn off
});

test("H11: strings and arrays that look like headers are skipped whole", () => {
  expect(flags('note = """\n[mcp_servers.fake]\n"""\n[mcp_servers.real]\n')).toEqual(off("real"));
  expect(flags("note = '''\n[mcp_servers.fake]'''\n")).toEqual(off());
  expect(flags('list = [\n  "[mcp_servers.fake]",\n  { a = 1 },\n]\n')).toEqual(off());
  expect(flags('s = "a # [mcp_servers.fake]" # [mcp_servers.fake2]\n')).toEqual(off());
});

test("H11: the child's own CODEX_HOME, the system and project layers, and the active profile", () => {
  // CODEX_HOME wins over HOME: the usage helper's child got a different one (the audit's wrong scan path).
  expect(flags("[mcp_servers.home_one]\n", { env: { CODEX_HOME: "$DIR/ch" }, extra: { "ch/config.toml": "[mcp_servers.ch_one]\n" } })).toEqual(off("ch_one"));
  expect(flags("[mcp_servers.x]\n", { env: { CODEX_HOME: "relative/dir" } }).error).toMatch(/no absolute CODEX_HOME/);
  // A project layer in the child's folder or above it counts too.
  expect(flags("[mcp_servers.a]\n", { extra: { "work/.codex/config.toml": "[mcp_servers.proj]\n", "work/sub/.keep": "" }, cwd: "$DIR/work/sub" })).toEqual(off("a", "proj"));
  // The active profile may not bring servers of its own; another profile's are not loaded.
  expect(flags('profile = "work"\n[profiles.work.mcp_servers.x]\ncommand = "a"\n').error).toMatch(/active profile 'work' names MCP servers/);
  expect(flags('profile = "work"\n[profiles.home.mcp_servers.x]\n[mcp_servers.a]\n')).toEqual(off("a"));
});

test("H11: anything it can't read for certain refuses (fail closed)", () => {
  for (const bad of [
    '[mcp_servers."a.b"]\n', // a name an override can't name
    '[mcp_servers."a b"]\n',
    "[mcp_servers.alpha\n", // a broken header
    'a = "x\n[mcp_servers.hidden]\nb = "\n', // an unclosed string must not hide a header
    'a = """never closed\n',
    "x = { a = 1,\n b = 2 }\n", // an inline table across lines
    "[[mcp_servers]]\nname = 'x'\n",
    "just words\n",
    'a = 1 b = 2\n',
  ]) expect(flags(bad).error, bad).toMatch(/^Codex's config can't be checked: /);
});

test("H11: the helper's `models codex` never starts Codex when the guard refuses", () => {
  const dir = `${ROOT}/helper`;
  mkdirSync(`${dir}/bin`, { recursive: true });
  mkdirSync(`${dir}/home/.codex`, { recursive: true });
  writeFileSync(`${dir}/home/.codex/config.toml`, '[mcp_servers."a b"]\ncommand = "x"\n');
  writeFileSync(`${dir}/bin/codex`, `#!/bin/sh\ntouch ${dir}/ran\n`);
  chmodSync(`${dir}/bin/codex`, 0o755);
  const r = JSON.parse(Bun.spawnSync(["/usr/bin/python3", "-I", "-S", HELPER, "models", "codex"], { env: { HOME: `${dir}/home`, PATH: `${dir}/bin:/usr/bin:/bin` } }).stdout.toString());
  expect(r.error).toMatch(/^Codex's config can't be checked, so Codex wasn't started: /);
  expect(existsSync(`${dir}/ran`)).toBe(false);
});
