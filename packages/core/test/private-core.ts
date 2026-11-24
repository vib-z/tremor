// The only way tests reach Herdr Core: a private core in a scrubbed environment under /tmp/pdk-<run>.
// Every hc process, cleanup included, gets exactly HOME, USER, PATH, TERM, LANG plus HC_SESSION and the
// three XDG folders below, and never HC_SOCKET (docs/core-protocol.md, D13). Before `hc server stop`, a
// `hello` in the same environment must show the core id this helper started and found in its own state.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { Connection, spawnTransport } from "../src/node/rpc.ts";

const ROOT = /^\/tmp\/pdk-[0-9a-f]{8}$/;

export interface PrivateCore {
  run: string;
  root: string;
  env: Record<string, string>;
  coreId: string;
  /** `hc <args>` in the private environment. */
  hc(args: string[], input?: string): { status: number | null; stdout: string; stderr: string };
  /** `hc connect` in the private environment. */
  connect(): ReturnType<typeof spawnTransport>;
  cleanup(): Promise<void>;
  /** The core's pid, once cleanup saw it exit. */
  readonly stoppedPid: number | null;
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export function privateEnv(run: string): Record<string, string> {
  const root = `/tmp/pdk-${run}`;
  const env: Record<string, string> = {};
  for (const k of ["HOME", "USER", "PATH", "TERM", "LANG"]) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }
  return { ...env, HC_SESSION: `pdk-${run}`, XDG_STATE_HOME: `${root}/state`, XDG_RUNTIME_DIR: root, XDG_CONFIG_HOME: `${root}/config` };
}

async function helloId(env: Record<string, string>): Promise<string> {
  const t = spawnTransport("hc", ["connect"], env);
  const c = new Connection(t);
  try {
    return (await c.hello({ generation: 1 }, { signal: AbortSignal.timeout(15_000) })).core.id;
  } finally {
    c.close();
  }
}

function stateId(root: string, run: string): string | null {
  const path = `${root}/state/herdr-core/pdk-${run}/core.json`;
  if (!existsSync(path)) return null;
  const j = JSON.parse(readFileSync(path, "utf8")) as { id?: string; info?: { id?: string } };
  return j.id ?? j.info?.id ?? null;
}

export async function startPrivateCore(): Promise<PrivateCore> {
  const run = randomBytes(4).toString("hex");
  const root = `/tmp/pdk-${run}`;
  if (!ROOT.test(root) || existsSync(root)) throw new Error(`refusing to use ${root}`);
  mkdirSync(`${root}/state`, { recursive: true, mode: 0o700 });
  mkdirSync(`${root}/config`, { mode: 0o700 }); // empty: no socket override, no notes
  const env = privateEnv(run);
  if ("HC_SOCKET" in env) throw new Error("HC_SOCKET must not be set");
  // The first hc call auto-starts this session's core in our state folder.
  const coreId = await helloId(env);
  if (stateId(root, run) !== coreId) throw new Error(`core ${coreId} is not the one in ${root}: refusing to go on`);
  const hc = (args: string[], input?: string) => {
    const r = spawnSync("hc", args, { env, encoding: "utf8", timeout: 30_000, ...(input === undefined ? {} : { input }) });
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
  let cleaned = false;
  let stoppedPid: number | null = null;
  return {
    run,
    root,
    env,
    coreId,
    hc,
    connect: () => spawnTransport("hc", ["connect"], env),
    async cleanup() {
      if (cleaned) return;
      cleaned = true;
      const id = await helloId(env);
      if (id !== coreId || stateId(root, run) !== coreId) throw new Error(`cleanup: hello answered ${id}, expected ${coreId}; not stopping anything`);
      const status = JSON.parse(hc(["server", "status"]).stdout) as { core?: { id?: string }; pid?: number };
      if (status.core?.id !== coreId || typeof status.pid !== "number") throw new Error(`cleanup: server status shows ${status.core?.id}; not stopping anything`);
      const stop = hc(["server", "stop"]);
      if (stop.status !== 0) throw new Error(`hc server stop failed: ${stop.stderr}`);
      for (let i = 0; i < 100 && alive(status.pid); i++) await new Promise((r) => setTimeout(r, 50));
      if (alive(status.pid)) throw new Error(`core pid ${status.pid} still running after stop`);
      stoppedPid = status.pid;
      if (!ROOT.test(root)) throw new Error(`refusing to delete ${root}`);
      rmSync(root, { recursive: true, force: true });
    },
    get stoppedPid() {
      return stoppedPid;
    },
  };
}
