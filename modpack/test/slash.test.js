import { test, expect, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SLASH_DATA } from "../adapters/slash-data.js";
import {
  SLASH_KINDS, commandsFor, customEntries, safetyOf, slashQuery, filterCommands, openMenu, setQuery, menuKey, chatPick,
  startsSession, terminalKeys, terminalInsert, visibleRows, UNTYPEABLE,
} from "../adapters/slash-commands.js";

// Owner request 30: "/" commands in the chat and terminal views like Moshi (reports/slash-commands.md).
const PACK = new URL("..", import.meta.url).pathname;
const ROOT = `/tmp/pdk-sl${process.pid}`;
mkdirSync(ROOT, { recursive: true });
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));
const py = (args, env = {}) => Bun.spawnSync(["/usr/bin/python3", "-I", "-S", ...args], { env: { PATH: "/usr/bin:/bin", ...env } });

test("sources: the generator parses each agent's own pinned source, at its version", async () => {
  writeFileSync(`${ROOT}/c.md`, [
    "| Command | Purpose |", "| :- | :- |",
    "| `/clear [name]` | Start a new conversation with empty context. Pass a name. Aliases: `/reset`, `/new` |",
    "| `/advisor [model\\|off]` | Enable or disable the [advisor tool](https://x), which consults a model. Requires Claude Code v2.1.260 or later |",
    "| `/future` | Something new. These forms require Claude Code v9.0.0 or later |",
    "| `/debug` | **[Skill](https://x).** Turn on debug logging. |",
  ].join("\n"));
  writeFileSync(`${ROOT}/c.rs`, `pub enum SlashCommand {
    // order
    Model,
    #[strum(serialize = "setup-default-sandbox")]
    ElevateSandbox,
    #[strum(to_string = "stop", serialize = "clean")]
    Stop,
    DebugConfig,
    Rollout,
    #[strum(serialize = "debug-m-drop")]
    MemoryDrop,
}
impl SlashCommand {
    pub fn description(self) -> &'static str {
        match self {
            SlashCommand::Model => "choose what model to use",
            SlashCommand::ElevateSandbox => "set up elevated agent sandbox",
            SlashCommand::Stop => {
                "stop all background terminals"
            }
            SlashCommand::DebugConfig | SlashCommand::Rollout => "show config layers",
            SlashCommand::MemoryDrop => "DO NOT USE",
        }
    }
}`);
  writeFileSync(`${ROOT}/c.py`, `from dataclasses import dataclass
X = 1
COMMAND_REGISTRY: list[CommandDef] = [
    CommandDef("start", "Platform pings", "Session", gateway_only=True),
    CommandDef("new", "Start a new session", "Session", aliases=("reset",), args_hint="[name]", busy_handler=f"{X}"),
    CommandDef("clear", f"Clear screen", "Session", cli_only=True),
]`);
  const r = py([`${PACK}test/slash-gen.py`, `${ROOT}/c.md`, `${ROOT}/c.rs`, `${ROOT}/c.py`, "2.1.321"]);
  expect(r.exitCode).toBe(0);
  writeFileSync(`${ROOT}/data.js`, r.stdout.toString());
  const { SLASH_DATA: d } = await import(`${ROOT}/data.js`);
  expect(d.claude.commands).toEqual([
    { name: "clear", args: "[name]", description: "Start a new conversation with empty context.", aliases: ["reset", "new"], type: "builtin" },
    { name: "advisor", args: "[model|off]", description: "Enable or disable the advisor tool, which consults a model.", aliases: [], type: "builtin" },
    { name: "debug", args: "", description: "Turn on debug logging.", aliases: [], type: "skill" },
  ]); // /future needs a later Claude Code than the installed one
  expect(d.codex.commands.map((c) => [c.name, c.aliases, c.description])).toEqual([
    ["model", [], "Choose what model to use"], ["setup-default-sandbox", [], "Set up elevated agent sandbox"],
    ["stop", ["clean"], "Stop all background terminals"], ["debug-config", [], "Show config layers"],
  ]); // Rollout is a debug build's; "DO NOT USE" is left out
  expect(d.hermes.commands.map((c) => [c.name, c.aliases, c.args])).toEqual([["new", ["reset"], "[name]"], ["clear", [], ""]]); // gateway-only left out
  for (const k of ["claude", "codex", "hermes"]) expect(d[k]).toMatchObject({ version: expect.any(String), source: expect.stringMatching(/^https:\/\//), licence: expect.any(String) });
}, 30000);

test("the shipped tables: Claude Code 2.1.321, Codex 0.167.0, Hermes 0.23.0, from their sources, names a terminal can type", () => {
  expect([SLASH_DATA.claude.version, SLASH_DATA.codex.version, SLASH_DATA.hermes.version]).toEqual(["2.1.321", "0.167.0", "0.23.0"]);
  expect(SLASH_DATA.codex.source).toContain("rust-v0.167.0");
  expect(SLASH_DATA.hermes.source).toContain("v0.23.0");
  const names = (k) => SLASH_DATA[k].commands.map((c) => c.name);
  expect(names("claude")).toEqual(expect.arrayContaining(["clear", "model", "effort", "exit", "compact", "resume"]));
  expect(SLASH_DATA.claude.commands.find((c) => c.name === "clear").aliases).toEqual(["reset", "new"]);
  expect(names("codex").slice(0, 3)).toEqual(["model", "presets", "daybreak"]); // the popup's own order
  expect(names("codex")).not.toContain("rollout");
  expect(names("hermes")).not.toContain("start"); // gateway-only
  for (const k of SLASH_KINDS) for (const c of SLASH_DATA[k].commands) {
    expect(c.description.length, `${k} /${c.name}`).toBeGreaterThan(0);
    expect(c.description).not.toMatch(/\n/);
  }
  expect(commandsFor("grok")).toEqual([]); // no sourced list: no menu
  expect(readFileSync(`${PACK}NOTICE.md`, "utf8")).toMatch(/slash-data\.js[\s\S]*slash-data\.js[\s\S]*slash-data\.js/);
});

test("custom commands and skills: names only, never marked safe; the helper lists names and opens no file", () => {
  const H = `${ROOT}/home`, P = `${ROOT}/proj`;
  for (const d of [`${H}/.claude/commands/git`, `${H}/.claude/skills/alpha`, `${H}/.claude/skills/no-skill-file`, `${P}/.claude/commands`, `${H}/.codex/prompts`]) mkdirSync(d, { recursive: true });
  writeFileSync(`${H}/.claude/commands/cm.md`, "SECRET CONTENT");
  writeFileSync(`${H}/.claude/commands/git/push.md`, "x");
  writeFileSync(`${H}/.claude/skills/alpha/SKILL.md`, "x");
  writeFileSync(`${P}/.claude/commands/ship.md`, "x");
  writeFileSync(`${H}/.codex/prompts/fix.md`, "x");
  const run = (kind) => JSON.parse(py([`${PACK}helper/pdk-helper.py`, "names", kind, P], { HOME: H }).stdout.toString());
  const claude = run("claude");
  expect(claude.names).toEqual([
    { name: "ship", scope: "project", type: "command" }, { name: "cm", scope: "user", type: "command" },
    { name: "git:push", scope: "user", type: "command" }, { name: "alpha", scope: "user", type: "skill" },
  ]);
  expect(JSON.stringify(claude)).not.toContain("SECRET");
  expect(run("codex").names).toEqual([{ name: "prompts:fix", scope: "user", type: "command" }]);
  const list = commandsFor("claude", claude.names);
  const cm = list.find((c) => c.name === "cm");
  expect(cm).toMatchObject({ custom: true, description: "Your command", safety: "custom" });
  expect(list.find((c) => c.name === "alpha").safety).toBe("skill");
  expect(customEntries("claude", [{ name: "bad name; rm" }, { name: "ok" }]).map((c) => c.name)).toEqual(["ok"]);
  expect(customEntries("hermes", [{ name: "x" }])).toEqual([]); // Hermes's own state is not read
  const helperSrc = readFileSync(`${PACK}helper/pdk-helper.py`, "utf8");
  const fn = helperSrc.slice(helperSrc.indexOf("def names("), helperSrc.indexOf("def main("));
  expect(fn).not.toMatch(/\bopen\(/);
}, 30000);

test("safety classes: the switcher, new session, ends, destructive, writes, custom", () => {
  const s = (k, n) => commandsFor(k).find((c) => c.name === n)?.safety;
  expect([s("claude", "model"), s("claude", "effort"), s("codex", "model")]).toEqual(["switcher", "switcher", "switcher"]);
  expect([s("claude", "clear"), s("codex", "new"), s("codex", "resume"), s("hermes", "new")]).toEqual(["session", "session", "session", "session"]);
  expect([s("claude", "exit"), s("codex", "quit")]).toEqual(["ends", "ends"]);
  expect([s("codex", "delete"), s("hermes", "undo"), s("codex", "stop")]).toEqual(["destructive", "destructive", "destructive"]);
  expect([s("codex", "init"), s("claude", "config")]).toEqual(["writes", "writes"]);
  expect(safetyOf({ name: "clear", custom: true, type: "command" })).toBe("custom"); // a custom one named like a built-in is still custom
  expect(startsSession("claude", "/clear")).toBe(true);
  expect(startsSession("claude", "/reset now")).toBe(true); // an alias
  expect(startsSession("codex", "/model")).toBe(false);
  expect(startsSession("claude", "please /clear")).toBe(false);
});

test("the chat's trigger, filter and keys: leading slash only; prefix first; Enter inserts with a space, never sends", () => {
  expect(slashQuery("/")).toBe("");
  expect(slashQuery("/Mo")).toBe("mo");
  for (const no of ["", "hi /mo", "/model ", "/model\nx", "//x", " /x"]) expect(slashQuery(no), no).toBeNull();
  const list = commandsFor("claude");
  const f = filterCommands(list, "re").map((c) => c.name);
  expect(f.slice(0, 3).every((n) => n.startsWith("re"))).toBe(true);
  expect(filterCommands(list, "quit")[0].name).toBe("exit"); // an alias finds its command
  expect(filterCommands(list, "clear")[0].name).toBe("clear"); // the exact name first
  let m = openMenu(list, "clea");
  expect(m.shown[0].name).toBe("clear");
  m = menuKey(m, "up").m;
  expect(m.i).toBe(m.shown.length - 1); // wraps
  m = menuKey(m, "down").m;
  expect(m.i).toBe(0);
  expect(menuKey(m, "escape").action).toBe("close");
  expect(menuKey(m, "enter").action).toBe("insert");
  expect(menuKey(setQuery(m, "zzzz"), "enter").action).toBeNull();
  expect(chatPick(m.shown[0])).toEqual({ text: "/clear " });
  expect(chatPick(list.find((c) => c.name === "model"))).toEqual({ switcher: true });
  expect(visibleRows({ shown: list, i: 30 }, 8).rows).toContain(list[30]);
  // The chat: Enter picks while the menu is open and sends otherwise; the menu's keys sit on the composer box only.
  const chat = readFileSync(`${PACK}mods/pdk-chat/main.js`, "utf8");
  expect(chat).toMatch(/this\.input\.on\("submit", \(e, cx\) => \{ if \(e\?\.shift\) return; if \(this\.slash\) this\.slashPick\(cx\); else this\.send\(cx\); \}\);/);
  const pick = chat.slice(chat.indexOf("  slashPick("), chat.indexOf("  slashCommand("));
  expect(pick).not.toMatch(/\bsend\(|hc\(/); // a pick never sends
  expect(pick).toMatch(/this\.openModels\(term/);
  expect(chat).toMatch(/\.on_key_down\(\(e, cx\) => this\.slashKeyDown\(e, cx\)\)/);
});

test("the terminal: exactly the pane it opened for, at its prompt, typed by hc keys, never Enter", () => {
  const target = { pane: "p1", terminal: "t3", pid: 41, kind: "claude" };
  const at = (o = {}) => ({ terminal: "t3", pid: 41, kind: "claude", status: "idle", ...o });
  const clear = commandsFor("claude").find((c) => c.name === "clear");
  const go = terminalInsert(clear, target, at());
  expect(go).toEqual({ args: ["keys", "t3", "/", "c", "l", "e", "a", "r", "space", "--json"] });
  expect(go.args).not.toContain("enter");
  for (const status of ["done", "error", null]) expect(terminalInsert(clear, target, at({ status })).args).toBeDefined();
  expect(terminalInsert(clear, target, at({ status: "working" })).why).toMatch(/working/);
  expect(terminalInsert(clear, target, at({ status: "blocked" })).why).toMatch(/waiting for you/);
  for (const other of [null, at({ terminal: "t4" }), at({ pid: 42 }), at({ kind: "codex" })]) expect(terminalInsert(clear, target, other).why).toMatch(/another program/);
  // What hc keys can't type (verified on a stand-in: ":" "_" have no key; capitals come out lower case).
  expect(terminalKeys({ name: "prompts:fix" })).toBeNull();
  expect(terminalKeys({ name: "my_cmd" })).toBeNull();
  expect(terminalKeys({ name: "Ship" })).toBeNull();
  expect(terminalInsert({ name: "prompts:fix" }, target, at()).why).toBe(UNTYPEABLE);
  for (const k of SLASH_KINDS) for (const c of commandsFor(k)) expect(terminalKeys(c), `${k} /${c.name}`).not.toBeNull(); // every built-in types
});

test("no key theft: no '/' binding anywhere, the pane bar has no commands button, the popup's keys are its own", () => {
  const files = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)]));
  for (const f of [...files(`${PACK}mods`), ...files(`${PACK}layouts`)]) {
    const src = readFileSync(f, "utf8");
    expect(/bind_keys/.test(src) && /keystroke:\s*"\/"/.test(src), f).toBe(false);
  }
  const pane = readFileSync(`${PACK}mods/pdk-pane/main.js`, "utf8");
  expect(pane).not.toMatch(/on_key_down|bind_keys/);
  expect(pane).not.toMatch(/slash|Commands/); // owner, 11 Nov: no Commands button on the pane bar; the chat's composer opens the list on "/"
  const popup = readFileSync(`${PACK}mods/pdk-slash/main.js`, "utf8");
  expect(popup).toMatch(/terminalInsert\(entry, this\.target, now\)/);
  expect(popup).not.toMatch(/"enter"|clipboard|paste|hc\(\["send"/);
  // design-final-look F6: the filter is the palette's inset field (shared fieldFrame, accent only on focus), not a divider row.
  expect(popup).toMatch(/fieldFrame\(h_flex\(\)\.h\(ROW\.base \+ SPACE\[2\]\)[^\n]*\{ focused: this\.inputFocused \}/);
  expect(popup).not.toMatch(/border_b\(1\)/);
});
