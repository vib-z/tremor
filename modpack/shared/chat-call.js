// The chat feed's transport (adapters/feed.js): call(command, request, { on, timeout }) -> reply.
//
// One helper process per call: helper/pdk-chat.py, `probe` or `tail` with the request as one JSON argument. Here it
// runs from the app's folder; on another machine (`on`) its text goes as the argument of that machine's own
// `python3 -I -S -c`, the route the usage foot uses (mods/pdk-usage), so nothing is installed or written there.

import { exec, appHome, readTextFile } from "herdr";

const SCRIPT = () => `${appHome()}/pdk/helper/pdk-chat.py`;
const CALLS = new Set(["probe", "tail", "slim", "media", "inline", "piece"]);
let source = null; // the helper's text, read once for every remote call

function helperText() {
  source ??= readTextFile(SCRIPT()).then((t) => {
    if (!t) throw new Error("the chat helper is missing: install tremor again");
    return t;
  });
  return source.catch((e) => { source = null; throw e; });
}

// Exec's own rejection for a remote call: the machine could not be reached or could not start python3.
function routeFailed(e, on) {
  const said = String(e?.message ?? e);
  if (/python3/i.test(said) && /not found|no such file|not installed|cannot find|can't find/i.test(said)) return new Error(`${on} has no python3, which the chat needs there`);
  return Object.assign(new Error(`${on} can't be reached`, { cause: said }), { offline: true });
}

export async function chatCall(command, request, { on = null, timeout = 15000 } = {}) {
  if (!CALLS.has(command)) throw new Error(`chat call: ${command}`);
  const json = JSON.stringify(request);
  let r;
  if (on) {
    const text = await helperText();
    try { r = await exec("python3", ["-I", "-S", "-c", text, command, json], { on, timeout }); } catch (e) { throw routeFailed(e, on); }
    if (r.code === 127) throw new Error(`${on} has no python3, which the chat needs there`);
  } else r = await exec("/usr/bin/python3", ["-I", "-S", SCRIPT(), command, json], { timeout });
  let reply = null;
  try { reply = JSON.parse(r.stdout); } catch { /* said below */ }
  if (r.code !== 0 || !reply || typeof reply !== "object") throw new Error(reply?.error ?? (String(r.stderr ?? "").trim().split("\n").pop() || `the chat helper's ${command} failed`));
  return reply;
}
