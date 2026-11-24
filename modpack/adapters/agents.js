// Which agent runs in a terminal: the pack's one detector, for the tree, the tabs, the chat, the factory and the marks.
// Pure: plain data in, plain data out.

// Kinds the pack can recognise, verified or not, for honest reasons. The last four by the command Herdr starts
// them with (herdr-app@2405bf3 defaults/programs.json:11,15,20) and Factory's own launcher (Factory-AI/
// factory-zed-extension@6a5d674 extension.toml: cmd "./droid"), so their panes show their marks (ui.js AGENT_MARKS).
const KNOWN = {
  claude: "Claude Code", "claude-code": "Claude Code", codex: "Codex", grok: "Grok Build", pi: "Pi", omp: "Oh My Pi",
  opencode: "OpenCode", hermes: "Hermes", kimi: "Kimi Code", gemini: "Gemini CLI", "cursor-agent": "Cursor Agent",
  copilot: "GitHub Copilot", agy: "Antigravity", qodercli: "Qoder CLI", droid: "Factory Droid",
};

export const SHELLS = new Set(["zsh", "bash", "sh", "fish", "dash", "ksh", "tcsh", "nu", "-zsh", "-bash", "-sh", "-fish", "login"]);

const base = (s) => String(s ?? "").split("/").pop();

// The agent kind of a terminal: from what runs in it (argv, never the process name, which can be a
// version number), else the program's own 7501 `app` report. A terminal back at its shell is no agent,
// whatever it last reported. Null for anything else.
export function agentKind(terminal) {
  if (!terminal?.foreground || atShell(terminal)) return null;
  if (detectHermes(terminal)) return "hermes";
  const argv0 = base(terminal.foreground.argv?.[0]);
  const fromArgv = argv0 === "claude" ? "claude" : argv0 === "codex" ? "codex" : KNOWN[argv0] ? argv0 : null;
  if (fromArgv) return fromArgv;
  const app = terminal.report?.app ?? (typeof terminal.status === "object" ? terminal.status?.app : null) ?? null;
  if (app === "claude-code" || app === "claude") return "claude";
  if (app && KNOWN[app]) return app;
  return null;
}

export const kindName = (kind) => KNOWN[kind] ?? kind;

// Hermes 0.23.0 runs as its own Python launcher, not as `hermes` (qa-modpack's capture, test/fixtures/hermes on
// qa/modpack 10923d0): argv[0] is a python and its `-c` script names the install. Hermes is the `hermes` command,
// or a python in front that names the install or its CLI module, or a python in front of a terminal Core started
// as `hermes`. Rules from qa-modpack's adapters/hermes.js, with the python required for the last two.
export function detectHermes(terminal) {
  const fg = terminal?.foreground?.argv ?? [];
  const first = base(fg[0]);
  if (first === "hermes") return true;
  if (!first.startsWith("python")) return false;
  if (fg.some((a) => typeof a === "string" && (a.includes("/.hermes/hermes-agent") || a.includes("hermes_cli.main") || a.includes("hermes_cli/main.py")))) return true;
  return (terminal.argv ?? []).some((a) => base(a) === "hermes");
}

// A shell is in front.
export function atShell(terminal) {
  const fg = terminal?.foreground;
  if (!fg) return false;
  return SHELLS.has(base(fg.argv?.[0])) || SHELLS.has(fg.name);
}
