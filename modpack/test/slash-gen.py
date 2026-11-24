"""Builds adapters/slash-data.js, the built-in "/" command tables (owner request 30), from each agent's own pinned
source. Nothing fetched is run: Claude's command reference is read as Markdown, Codex's SlashCommand enum as Rust
text, Hermes's COMMAND_REGISTRY through Python's ast (never imported).

    python3 -I -S modpack/test/slash-gen.py <claude-commands.md> <codex slash_command.rs> <hermes commands.py> \
        <claude version> > modpack/adapters/slash-data.js

The sources, at the versions the data names:
    https://code.claude.com/docs/en/commands.md (the reference for the installed Claude Code)
    https://raw.githubusercontent.com/openai/codex/rust-v0.167.0/codex-rs/tui/src/slash_command.rs
    https://raw.githubusercontent.com/NousResearch/hermes-agent/v0.23.0/hermes_cli/commands.py
"""
import ast
import json
import re
import sys


def ver(v):
    return tuple(int(x) for x in re.findall(r"\d+", v)[:3])


def plain(md):
    """Markdown to one line of text: links to their words, no emphasis or code marks."""
    s = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", md)
    s = s.replace("**", "").replace("`", "").replace("\\|", "|")
    return re.sub(r"\s+", " ", s).strip()


def first_sentence(text, limit=140):
    m = re.match(r"(.+?[.!?])(\s|$)", text)
    s = (m.group(1) if m else text).strip()
    return s if len(s) <= limit else s[:limit - 1].rstrip() + "…"


def parse_claude(md, version):
    """Rows of the Commands table: `| \\`/name args\\` | purpose |`. A row whose purpose says it needs a later
    Claude Code than `version` is left out; bundled skills are marked."""
    out = []
    for line in md.splitlines():
        m = re.match(r"^\| `/([a-z0-9][a-z0-9:_-]*)((?: [^`]*)?)` \| (.*) \|\s*$", line)
        if not m:
            continue
        name, args, purpose = m.group(1), m.group(2).strip().replace("\\|", "|"), m.group(3)
        need = [ver(v) for v in re.findall(r"(?:Requires Claude Code v|v)(\d+\.\d+\.\d+) or later", purpose)]
        need += [ver(v) for v in re.findall(r"Requires Claude Code v(\d+\.\d+\.\d+)(?! or)", purpose)]
        if need and max(need) > ver(version):
            continue
        skill = purpose.lstrip().startswith("**[Skill]")
        text = plain(re.sub(r"^\*\*\[Skill\]\([^)]*\)\.\*\*\s*", "", purpose.strip()))
        aliases = []
        a = re.search(r"Alias(?:es)?: ((?:`/[a-z0-9:_-]+`(?:, )?)+)", purpose)
        if a:
            aliases = re.findall(r"`/([a-z0-9:_-]+)`", a.group(1))
        out.append({"name": name, "args": args, "description": first_sentence(text), "aliases": aliases,
                    "type": "skill" if skill else "builtin"})
    return out


def kebab(variant):
    return re.sub(r"(?<!^)(?=[A-Z])", "-", variant).lower()


def parse_codex(rs):
    """The SlashCommand enum in its presentation order, with strum's names, the description() table, and
    is_visible() for a macOS release build. Debug commands ("DO NOT USE") are left out."""
    body = re.search(r"pub enum SlashCommand \{(.*?)\n\}", rs, re.S).group(1)
    variants, attrs = [], ""
    for raw in body.splitlines():
        line = raw.strip()
        if not line or line.startswith("//"):
            continue
        if line.startswith("#["):
            attrs += line
            continue
        v = line.rstrip(",")
        to_string = re.search(r'to_string = "([^"]+)"', attrs)
        serial = re.findall(r'serialize = "([^"]+)"', attrs)
        name = to_string.group(1) if to_string else (max(serial, key=len) if serial else kebab(v))
        variants.append({"variant": v, "name": name, "aliases": [s for s in serial if s != name]})
        attrs = ""
    desc = {}
    table = re.search(r"pub fn description\(self\) -> &'static str \{\s*match self \{(.*?)\n        \}\n    \}", rs, re.S).group(1)
    for arm in re.finditer(r"((?:SlashCommand::\w+\s*\|?\s*)+)=>\s*\{?\s*\"((?:[^\"\\]|\\.)*)\"", table):
        for v in re.findall(r"SlashCommand::(\w+)", arm.group(1)):
            desc[v] = json.loads('"%s"' % arm.group(2))
    hidden = {"Rollout", "TestApproval"}  # is_visible(): debug builds only; Copy and App show on macOS
    out = []
    for v in variants:
        d = desc.get(v["variant"])
        if v["variant"] in hidden or d is None or d == "DO NOT USE":
            continue
        out.append({"name": v["name"], "args": "", "description": d[0].upper() + d[1:], "aliases": v["aliases"], "type": "builtin"})
    return out


def lit(node):
    """A literal's value; an f-string's literal parts joined (its fields can't be known without running it)."""
    if isinstance(node, ast.JoinedStr):
        return "".join(v.value for v in node.values if isinstance(v, ast.Constant))
    return ast.literal_eval(node)


def parse_hermes(py):
    """COMMAND_REGISTRY's CommandDef(...) entries with literal arguments, as its CLI autocomplete offers them:
    gateway-only commands are left out."""
    tree = ast.parse(py)
    reg = None
    for node in ast.walk(tree):
        target = node.target if isinstance(node, ast.AnnAssign) else (node.targets[0] if isinstance(node, ast.Assign) else None)
        if isinstance(target, ast.Name) and target.id == "COMMAND_REGISTRY":
            reg = node.value
    out = []
    for call in reg.elts:
        if not (isinstance(call, ast.Call) and getattr(call.func, "id", None) == "CommandDef"):
            raise SystemExit("an entry that is not CommandDef(...)")
        pos = [lit(a) for a in call.args[:2]]
        kw = {k.arg: lit(k.value) for k in call.keywords if k.arg in ("gateway_only", "args_hint", "aliases")}
        name, description = pos[0], pos[1]
        if not isinstance(name, str) or not isinstance(description, str):
            raise SystemExit("a CommandDef whose name or description is not a literal")
        if kw.get("gateway_only"):
            continue
        out.append({"name": name, "args": kw.get("args_hint", ""), "description": description,
                    "aliases": list(kw.get("aliases", ())), "type": "builtin"})
    return out


def main(argv):
    claude_md, codex_rs, hermes_py, claude_version = argv
    data = {
        "claude": {"agent": "Claude Code", "version": claude_version,
                   "source": "https://code.claude.com/docs/en/commands", "licence": "Anthropic documentation; first sentences quoted",
                   "commands": parse_claude(open(claude_md, encoding="utf-8").read(), claude_version)},
        "codex": {"agent": "Codex", "version": "0.167.0",
                  "source": "https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/tui/src/slash_command.rs", "licence": "Apache-2.0",
                  "commands": parse_codex(open(codex_rs, encoding="utf-8").read())},
        "hermes": {"agent": "Hermes", "version": "0.23.0",
                   "source": "https://github.com/NousResearch/hermes-agent/blob/v0.23.0/hermes_cli/commands.py", "licence": "MIT",
                   "commands": parse_hermes(open(hermes_py, encoding="utf-8").read())},
    }
    print("// Generated by modpack/test/slash-gen.py from each agent's own pinned source (see SLASH_DATA[kind].source);")
    print("// do not edit by hand. Names, argument hints, aliases and one-line descriptions only.")
    print("export const SLASH_DATA = " + json.dumps(data, indent=1, ensure_ascii=False) + ";")


if __name__ == "__main__":
    main(sys.argv[1:])
