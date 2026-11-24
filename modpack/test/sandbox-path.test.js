// The sandbox's PATH (usage lane's incident: the real moshi ran once from a sandboxed app). Everything run through
// modpack/test/sandbox.sh, shells included, finds only $S/bin and the system's folders. Scratch files under
// /tmp/pdk-sp<pid> only; nothing outside the sandbox is read or written. Only the box test starts Cores: the
// sandbox's private one and box's (machine.sh), both stopped after their ids are read, and checked gone with pgrep.
import { test, expect, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync, existsSync, lstatSync } from "node:fs";

const SANDBOX = new URL("./sandbox.sh", import.meta.url).pathname;
const MACHINE = new URL("./machine.sh", import.meta.url).pathname;
const short = `sp${process.pid}`;
const S = `/tmp/pdk-${short}`;
const SAFE = `${S}/bin:/usr/bin:/bin:/usr/sbin:/sbin`;
const GUARDED = ["moshi", "codex", "claude", "grok", "herdr"];
afterAll(() => rmSync(S, { recursive: true, force: true }));

// The calling shell's PATH as a person has it (Homebrew and ~/.local/bin, where the real tools live): the sandbox
// must not pass it on.
const callerEnv = (extra = {}) => ({ HOME: process.env.HOME, PATH: `/opt/homebrew/bin:${process.env.HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`, ...extra });
const PROBE = `for c in ${GUARDED.join(" ")}; do p=$(command -v $c) && echo "FOUND $c $p"; done; echo "HC=$(command -v hc)"; echo "SESSION=$HC_SESSION"; echo "PATH=$PATH"`;
const run = (argv, env = callerEnv()) => {
  const r = Bun.spawnSync(["/bin/sh", SANDBOX, short, ...argv], { env, stdin: "ignore" });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
};
const line = (out, key) => out.split("\n").find((l) => l.startsWith(`${key}=`))?.slice(key.length + 1);

test("login, interactive and plain shells in the sandbox find no agent, moshi or herdr, and hc is the sandbox's", () => {
  for (const argv of [["/bin/zsh", "-l", "-c", PROBE], ["/bin/zsh", "-i", "-c", PROBE], ["/bin/zsh", "-lic", PROBE], ["/bin/zsh", "-c", PROBE], ["/bin/sh", "-l", "-c", PROBE]]) {
    const r = run(argv);
    const what = argv.slice(0, -1).join(" ");
    expect(r.out, what).not.toContain("FOUND");
    expect(line(r.out, "HC"), what).toBe(`${S}/bin/hc`);
    expect(line(r.out, "SESSION"), what).toBe(`pdk-${short}`);
    // path_helper (/etc/zprofile, /etc/profile) ran in the login shells; the scratch HOME's files set PATH back.
    expect(line(r.out, "PATH"), what).toBe(SAFE);
  }
});

test("a second run keeps one PATH line per file and the lines a scene added", () => {
  writeFileSync(`${S}/u/.zshrc`, `${readFileSync(`${S}/u/.zshrc`, "utf8")}alias scene=true\n`);
  run(["/usr/bin/true"]);
  for (const rc of [".zshenv", ".zprofile", ".zshrc", ".profile"]) {
    const text = readFileSync(`${S}/u/${rc}`, "utf8");
    expect(text.split("\n").filter((l) => l.includes("# pdk-sandbox")).length, rc).toBe(1);
  }
  expect(readFileSync(`${S}/u/.zshrc`, "utf8")).toContain("alias scene=true");
});

test("a command started in the background keeps a parent, so herdr-app never fills PATH from the login shell", async () => {
  // `( … & )` leaves the started program to launchd unless something waits for it (herdr-app core_bin.rs:52-64).
  const out = `${S}/ppid`;
  Bun.spawnSync(["/bin/sh", "-c", `( /bin/sh "${SANDBOX}" ${short} /bin/sh -c 'sleep 1; ps -o ppid= -p $$ > "${out}"' & )`], { env: callerEnv() });
  for (let i = 0; i < 40 && !existsSync(out); i++) await Bun.sleep(100);
  await Bun.sleep(200);
  expect(Number(readFileSync(out, "utf8").trim())).toBeGreaterThan(1);
});

test("PDK_ALLOW links one named program for that run only; off by default", () => {
  // A stand-in on the caller's PATH, so no real tool is linked or run.
  mkdirSync(`${S}/caller`, { recursive: true });
  writeFileSync(`${S}/caller/moshi`, "#!/bin/sh\necho stand-in\n");
  chmodSync(`${S}/caller/moshi`, 0o755);
  const env = callerEnv({ PATH: `${S}/caller:/usr/bin:/bin`, PDK_ALLOW: "moshi" });
  const on = run(["/bin/zsh", "-lic", PROBE], env);
  expect(on.out).toContain(`FOUND moshi ${S}/bin/moshi`);
  expect(on.out.match(/FOUND/g)).toHaveLength(1);
  expect(lstatSync(`${S}/bin/moshi`).isSymbolicLink()).toBe(true);
  // The next run without it: gone again.
  const off = run(["/bin/zsh", "-lic", PROBE]);
  expect(off.out).not.toContain("FOUND");
  expect(existsSync(`${S}/bin/moshi`)).toBe(false);
  // Only a plain name; never hc or herdr-app; never over a test double.
  for (const bad of ["../x", "hc", "herdr-app", "a b"]) expect(run(["/usr/bin/true"], callerEnv({ PDK_ALLOW: bad })).code).toBe(2);
  writeFileSync(`${S}/bin/claude`, "#!/bin/sh\n");
  expect(run(["/usr/bin/true"], callerEnv({ PDK_ALLOW: "claude" })).err).toMatch(/test double/);
  rmSync(`${S}/bin/claude`);
});

test("the sandbox's own program sees exactly its environment, and its exit code comes back", () => {
  const r = run(["/bin/sh", "-c", 'printf "%s|%s|%s" "$PATH" "$HOME" "$HERDR_APP_HOME"; exit 7']);
  expect(r.code).toBe(7);
  expect(r.out).toBe(`${SAFE}|${S}/u|${S}/home`);
});

// Box (machine.sh), a second private Core under $S/mb. Stop order: the sandbox Core first (else it starts box's again
// through via-box), then machine.sh stop, then pgrep. `hc server status` starts a Core that isn't running, so it is
// asked only while the socket exists.
const M = `${S}/mb`;
const MSAFE = `${M}/bin:/usr/bin:/bin:/usr/sbin:/sbin`;
const alive = () => Bun.spawnSync(["/usr/bin/pgrep", "-f", `pdk-${short}`]).stdout.toString().trim();
const stopped = [];
function stopCores() {
  if (existsSync(`${S}/herdr-core/pdk-${short}.sock`)) {
    const id = JSON.parse(run(["hc", "server", "status", "--json"]).out).core.id;
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    stopped.push(`sandbox ${id}`);
    run(["hc", "server", "stop"]);
  }
  const m = run(["/bin/sh", MACHINE, "stop"]).out.match(/stopping machine core ([0-9a-f]{32})/);
  if (m) stopped.push(`box ${m[1]}`);
}
const until = async (ok, ms = 8000) => { for (let t = 0; t < ms && !ok(); t += 100) await Bun.sleep(100); return ok(); };

test("box: its shells, its own shell under `hc run --on box`, and a program run on it find only box's bin", async () => {
  try {
    const add = run(["/bin/sh", MACHINE, "add", "box"]);
    expect(add.out).toContain('"state":"connected"');
    for (const rc of [".profile", ".zshenv", ".zprofile", ".zshrc"]) expect(readFileSync(`${M}/u/${rc}`, "utf8")).toContain(`export PATH="${MSAFE}" # pdk-sandbox`);
    // Box's shells through its own way in, the via script box's Core runs behind.
    for (const sh of ["/bin/sh -l -c", "/bin/zsh -l -c", "/bin/zsh -i -c", "/bin/zsh -lic"]) {
      const out = Bun.spawnSync([`${S}/via-box`, `${sh} '${PROBE}'`], { env: callerEnv(), stdin: "ignore" }).stdout.toString();
      expect(out, sh).not.toContain("FOUND");
      expect([line(out, "HC"), line(out, "SESSION"), line(out, "PATH")], sh).toEqual([`${M}/bin/hc`, "pdk-mb", MSAFE]);
    }
    // A terminal on box: with no program, `hc run --on box` starts box's own login shell (/bin/sh -l); it gets the
    // probe typed in. And a program `hc run --on box` starts directly.
    const shell = JSON.parse(run(["hc", "run", "--on", "box", "--bg", "--json", "--name", "probe-shell"]).out);
    expect(shell.address).toMatch(/^box\/t\d+$/);
    expect(await until(() => JSON.parse(run(["hc", "get", shell.address, "--json"]).out || "{}").foreground?.argv?.[0] === "/bin/sh")).toBe(true);
    run(["hc", "send", shell.address, `{ ${PROBE}; } > ${M}/u/shell.out 2>&1`]);
    run(["hc", "keys", shell.address, "enter"]);
    run(["hc", "run", "--on", "box", "--bg", "--json", "--name", "probe-prog", "--", "/bin/sh", "-c", `{ ${PROBE}; } > ${M}/u/prog.out 2>&1`]);
    for (const f of ["shell.out", "prog.out"]) {
      const path = `${M}/u/${f}`;
      expect(await until(() => existsSync(path) && readFileSync(path, "utf8").includes("PATH=")), f).toBe(true);
      const out = readFileSync(path, "utf8");
      expect(out, f).not.toContain("FOUND");
      expect([line(out, "HC"), line(out, "SESSION"), line(out, "PATH")], f).toEqual([`${M}/bin/hc`, "pdk-mb", MSAFE]);
    }
  } finally {
    stopCores();
    expect(await until(() => alive() === "")).toBe(true);
    // A second stop finds no socket and starts nothing.
    expect(run(["/bin/sh", MACHINE, "stop"]).out).toContain("no machine core running");
    expect(alive()).toBe("");
    expect(stopped.map((s) => s.split(" ")[0])).toEqual(["sandbox", "box"]);
  }
}, 120000);
