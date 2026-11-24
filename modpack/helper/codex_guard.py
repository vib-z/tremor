"""The one guard that turns off Codex's MCP servers for a helper's own Codex child (audit H11), shared by
pdk-helper.py (`models codex`) and pdk-usage.py. Python 3.9 has no tomllib, so this reads only what can name an MCP
server in TOML: table headers, dotted keys and inline tables, with bare, "basic" and 'literal' key parts, and comments.
Strings, multi-line strings and arrays are skipped whole. Anything it can't read for certain refuses (fail closed),
and the caller must then not start Codex.

Where Codex looks, as the child will see it: $CODEX_HOME/config.toml (else $HOME/.codex/config.toml, from the env the
child gets), the system layers /etc/codex/config.toml and /etc/codex/managed_config.toml, and a .codex/config.toml in
the child's working folder or any folder above it. The effective profile is the top-level `profile` key; MCP servers
under that profile refuse (an override can't be proven to reach them).

Load it by path (python -I keeps the script's folder off sys.path):
    spec = importlib.util.spec_from_file_location("codex_guard", os.path.join(os.path.dirname(__file__), "codex_guard.py"))
or run `python3 -I -S codex_guard.py flags [cwd]` for {"flags": [...]} or {"error": "..."}.
"""
import json
import os
import re
import sys

MAX_BYTES = 1 << 20
MAX_LEVELS = 64
NAME = re.compile(r"^[A-Za-z0-9_-]+$")
BARE = re.compile(r"[A-Za-z0-9_-]+")
ESCAPES = {"b": "\b", "t": "\t", "n": "\n", "f": "\f", "r": "\r", '"': '"', "\\": "\\"}


class Refused(Exception):
    pass


def _ws(s, i):
    while i < len(s) and s[i] in " \t":
        i += 1
    return i


def _basic(s, i):
    """A "basic" string from s[i] == '"': (text, index after it)."""
    out, i = [], i + 1
    while i < len(s):
        c = s[i]
        if c == '"':
            return "".join(out), i + 1
        if c in "\r\n":
            raise Refused("an unclosed string")
        if c == "\\":
            e = s[i + 1:i + 2]
            if e in ESCAPES:
                out.append(ESCAPES[e])
                i += 2
            elif e in ("u", "U"):
                n = 4 if e == "u" else 8
                h = s[i + 2:i + 2 + n]
                if len(h) != n or not re.match(r"^[0-9A-Fa-f]+$", h):
                    raise Refused("a bad escape in a key")
                out.append(chr(int(h, 16)))
                i += 2 + n
            else:
                raise Refused("a bad escape in a key")
            continue
        out.append(c)
        i += 1
    raise Refused("an unclosed string")


def _key(s, i):
    """A dotted key from s[i]: (parts, index after it and its spaces)."""
    parts = []
    while True:
        i = _ws(s, i)
        if i < len(s) and s[i] == '"':
            part, i = _basic(s, i)
        elif i < len(s) and s[i] == "'":
            j = s.find("'", i + 1)
            if j < 0:
                raise Refused("an unclosed string")
            part, i = s[i + 1:j], j + 1
        else:
            m = BARE.match(s, i)
            if not m:
                raise Refused("a key it can't read")
            part, i = m.group(0), m.end()
        parts.append(part)
        i = _ws(s, i)
        if i < len(s) and s[i] == ".":
            i += 1
            continue
        return parts, i


class _Reader:
    """Walks a config's text once and collects every full key path that names a table or a key."""

    def __init__(self, text):
        self.s = text
        self.i = 0
        self.paths = []
        self.profile = None

    def run(self):
        table = []
        s = self.s
        while self.i < len(s):
            self.i = self._skip_blank(self.i)
            if self.i >= len(s):
                break
            c = s[self.i]
            if c == "[":
                array = s.startswith("[[", self.i)
                parts, j = _key(s, self.i + (2 if array else 1))
                close = "]]" if array else "]"
                if not s.startswith(close, j):
                    raise Refused("a table header it can't read")
                self.i = self._line_end(j + len(close))
                if array and parts[0] in ("mcp_servers", "profiles"):
                    raise Refused("an array of tables where MCP servers live")
                table = parts
                self.paths.append(table)
                continue
            parts, j = _key(s, self.i)
            if j >= len(s) or s[j] != "=":
                raise Refused("a line that is not a key = value")
            full = table + parts
            self.paths.append(full)
            j = _ws(s, j + 1)
            if full == ["profile"]:
                if j < len(s) and s[j] == '"':
                    self.profile, k = _basic(s, j)
                elif j < len(s) and s[j] == "'" and s.find("'", j + 1) > 0:
                    k = s.find("'", j + 1)
                    self.profile, k = s[j + 1:k], k + 1
                else:
                    raise Refused("a profile that is not a plain string")
                self.i = self._line_end(k)
                continue
            self.i = self._line_end(self._value(j, full))
        return self

    def _skip_blank(self, i):
        s = self.s
        while i < len(s):
            if s[i] in " \t\r\n":
                i += 1
            elif s[i] == "#":
                while i < len(s) and s[i] != "\n":
                    i += 1
            else:
                break
        return i

    def _line_end(self, i):
        """Only spaces and a comment may follow a value or a header on its line."""
        s = self.s
        i = _ws(s, i)
        if i < len(s) and s[i] == "#":
            while i < len(s) and s[i] != "\n":
                i += 1
        if i < len(s) and s[i] not in "\r\n":
            raise Refused("more after a value on one line")
        return i

    def _string(self, i):
        s = self.s
        for q in ('"""', "'''"):
            if s.startswith(q, i):
                j = i + 3
                while True:
                    k = s.find(q, j)
                    if k < 0:
                        raise Refused("an unclosed multi-line string")
                    if q == '"""':
                        bs = 0
                        while k - 1 - bs >= i + 3 and s[k - 1 - bs] == "\\":
                            bs += 1
                        if bs % 2:
                            j = k + 1
                            continue
                    k += 3
                    while s.startswith(q[0], k):  # up to two quotes may close it
                        k += 1
                    return k
        if s[i] == '"':
            return _basic(s, i)[1]
        j = s.find("'", i + 1)
        if j < 0 or "\n" in s[i:j]:
            raise Refused("an unclosed string")
        return j + 1

    def _value(self, i, path):
        """Skips one value from s[i]; an inline table's keys join `path`."""
        s = self.s
        if i >= len(s):
            raise Refused("a key with no value")
        c = s[i]
        if c in "\"'":
            return self._string(i)
        if c == "{":
            return self._inline(i, path)
        if c == "[":
            return self._array(i)
        m = re.compile(r"[A-Za-z0-9_+\-.:]+").match(s, i)  # numbers, booleans, dates
        if not m:
            raise Refused("a value it can't read")
        return m.end()

    def _array(self, i):
        s, i = self.s, i + 1
        while True:
            i = self._skip_blank(i)
            if i >= len(s):
                raise Refused("an unclosed array")
            if s[i] == "]":
                return i + 1
            i = self._skip_blank(self._value(i, None))
            if i < len(s) and s[i] == ",":
                i += 1
            elif i < len(s) and s[i] != "]":
                raise Refused("an array it can't read")

    def _inline(self, i, path):
        s, i = self.s, _ws(self.s, i + 1)
        if i < len(s) and s[i] == "}":
            return i + 1
        while True:
            parts, j = _key(s, i)
            if j >= len(s) or s[j] != "=":
                raise Refused("an inline table it can't read")
            full = (path or []) + parts
            if path is not None:
                self.paths.append(full)
            j = _ws(s, self._value(_ws(s, j + 1), full if path is not None else None))
            if j < len(s) and s[j] == ",":
                i = _ws(s, j + 1)
                continue
            if j < len(s) and s[j] == "}":
                return j + 1
            raise Refused("an inline table it can't read")  # TOML keeps an inline table on one line


def server_names(text):
    """What one config says: the MCP server names it defines, its top-level profile, and the profiles that define
    MCP servers of their own. Raises Refused."""
    r = _Reader(text).run()
    names, scoped = set(), set()
    for p in r.paths:
        if p[0] == "mcp_servers" and len(p) >= 2:
            names.add(p[1])
        if len(p) >= 3 and p[0] == "profiles" and p[2] == "mcp_servers":
            scoped.add(p[1])
    for n in names:
        if not NAME.match(n):
            raise Refused("an MCP server name an override can't name")
    return names, r.profile, scoped


def _read(path):
    try:
        with open(path, "rb") as f:
            data = f.read(MAX_BYTES + 1)
    except FileNotFoundError:
        return None
    except OSError as e:
        raise Refused("can't read %s (%s)" % (path, e.strerror))
    if len(data) > MAX_BYTES:
        raise Refused("%s is too large to check" % path)
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise Refused("%s is not UTF-8" % path)


def config_files(env, cwd):
    """Every config layer the child Codex would read, user layer first."""
    home = env.get("CODEX_HOME") or (os.path.join(env["HOME"], ".codex") if env.get("HOME") else None)
    if not home or not os.path.isabs(home):
        raise Refused("no absolute CODEX_HOME or HOME for the child")
    files = [os.path.join(home, "config.toml"), "/etc/codex/config.toml", "/etc/codex/managed_config.toml"]
    d = os.path.abspath(cwd or os.getcwd())
    for _ in range(MAX_LEVELS):
        files.append(os.path.join(d, ".codex", "config.toml"))
        up = os.path.dirname(d)
        if up == d:
            break
        d = up
    seen, out = set(), []
    for f in files:
        real = os.path.realpath(f)
        if real not in seen:
            seen.add(real)
            out.append(f)
    return out


def mcp_off_flags(env, cwd=None):
    """`-c mcp_servers.<name>.enabled=false` for every MCP server any layer defines. Raises Refused, also when a
    profile some layer selects defines MCP servers of its own."""
    names, chosen, scoped = set(), set(), set()
    for path in config_files(env, cwd):
        text = _read(path)
        if text is None:
            continue
        found, profile, own = server_names(text)
        names |= found
        scoped |= own
        if profile is not None:
            chosen.add(profile)
    if chosen & scoped:
        raise Refused("the active profile %r names MCP servers" % sorted(chosen & scoped)[0])
    flags = []
    for n in sorted(names):
        flags += ["-c", "mcp_servers.%s.enabled=false" % n]
    return flags


if __name__ == "__main__":
    if sys.argv[1:2] != ["flags"]:
        sys.exit("usage: codex_guard.py flags [cwd]")
    try:
        print(json.dumps({"flags": mcp_off_flags(dict(os.environ), sys.argv[2] if len(sys.argv) > 2 else None)}))
    except Refused as e:
        print(json.dumps({"error": "Codex's config can't be checked: %s" % e}))
