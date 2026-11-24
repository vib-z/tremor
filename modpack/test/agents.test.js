// The pack's agent detector (adapters/agents.js).
import { test, expect } from "bun:test";
import { agentKind, detectHermes } from "../adapters/agents.js";

const zsh = (pid, argv = ["/bin/zsh", "-l"]) => ({ pid, argv, name: "zsh" });
const T = (address, foreground, status, extra = {}) => ({ address, state: "live", pid: 500 + Number(address.slice(1)), foreground, status, records: {}, labels: {}, ...extra });

test("a terminal back at its shell is not an agent, whatever it last reported", () => {
  expect(agentKind(T("t1", zsh(10), "idle", { report: { app: "codex" } }))).toBeNull();
  expect(agentKind(T("t1", { pid: 1, argv: ["python3", "x.py"], name: "python3" }, "idle", { report: { app: "claude-code" } }))).toBe("claude");
});

test("Hermes 0.23.0 is recognised by its Python launcher", () => {
  // As captured by qa-modpack (test/fixtures/hermes/terminal-t3.json on qa/modpack 10923d0), the -c script clipped.
  const py = "/Users/x/.hermes/tools/python-3.14.9+20261021-darwin-arm64/bin/python3";
  const hermes = T("t3", { pid: 27388, name: "python3.14", argv: [py, "-I", "-c", "sys.path.insert(0, '/Users/x/.hermes/hermes-agent')", "chat", "-q", "hi"] }, null,
    { argv: ["/bin/sh", "-lic", '"$@"; exec "$0" -li', "/bin/sh", "hermes", "chat", "-q", "hi"] });
  expect(agentKind(hermes)).toBe("hermes");
  expect(detectHermes({ foreground: { argv: ["hermes", "chat"] } })).toBe(true);
  expect(detectHermes({ argv: ["/bin/zsh", "-lic", "x", "/bin/zsh", "hermes"], foreground: { argv: [py, "-m", "something"] } })).toBe(true);
  // Not Hermes: a python of the person's own, an editor on Hermes's files, the shell back in front.
  expect(detectHermes({ argv: ["/bin/zsh", "-l"], foreground: { argv: ["python3", "train.py"] } })).toBe(false);
  expect(detectHermes({ argv: ["/bin/zsh", "-l"], foreground: { argv: ["vim", "/Users/x/.hermes/hermes-agent/run.py"] } })).toBe(false);
  expect(agentKind(T("t3", zsh(503, ["/bin/zsh", "-li"]), null, { argv: hermes.argv }))).toBeNull();
});
