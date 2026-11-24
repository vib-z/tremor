// The only `exec` in the pack: the pack's own read-only helper, with a fixed interpreter and flags.
// `-I -S` keeps Python away from anything in the current folder or site packages.

import { exec, appHome } from "herdr";
import { mkdir, writeFile, unlink } from "fs/promises";
import { chatCall } from "./chat-call.js";

const COMMANDS = new Set(["motion", "start", "tty", "held", "read", "rows", "first", "procs", "slim", "media", "inline", "open", "reveal", "fetch", "store", "keep", "realpath", "models", "names"]);

export async function helper(command, args = [], timeout = 15000) {
  if (!COMMANDS.has(command)) throw new Error(`helper: ${command}`);
  const script = `${appHome()}/pdk/helper/pdk-helper.py`;
  const r = await exec("/usr/bin/python3", ["-I", "-S", script, command, ...args.map(String)], { timeout });
  let reply = null;
  try { reply = JSON.parse(r.stdout); } catch { /* reported below */ }
  if (r.code !== 0 || !reply) throw new Error(reply?.error ?? (r.stderr.trim() || `helper ${command} failed`));
  return reply;
}

// A preview of one media reference (adapters/media.js): a file by path, an image inline in a transcript, or a
// remote image the person clicked (review G8).
// `variant`: "thumb" for the chat's tiles, "view" for the preview overlay. `force` loads a large file anyway.
// With `ref.on` (a remote agent's reference) the file or inline image is on that machine: see remotePreview.
export function mediaPreview(ref, variant, force = false) {
  if (ref?.on && ref.src !== "url") return remotePreview(ref, variant, force);
  if (ref?.src === "file") return helper("media", [ref.path, variant, force ? 1 : 0], 30000);
  if (ref?.src === "inline") return helper("inline", [ref.transcript, ref.offset, ref.index, variant], 30000);
  // Only ever after a person clicked that remote image (pdk-preview opens on the click): the helper downloads it.
  if (ref?.src === "url") return helper("fetch", [ref.url, variant], 35000);
  return Promise.reject(new Error("no local file"));
}

// A remote agent's media: that machine makes the preview (helper/pdk-chat.py `media` or `inline`, its own sips and
// qlmanage, nothing kept there) and answers its PNG as base64. The text goes into a file here, never on a command
// line, and the local helper's `store` keeps the PNG in this Mac's preview cache, keyed by machine and file, under
// the cache's limits. The answer has the local shape (image: a cache path for `image()`), plus `on`; an inline
// image has no `file` (its original stays there). A machine that can't be reached rejects with words a tile shows.
let incoming = 0;
async function remotePreview(ref, variant, force) {
  const on = ref.on;
  const [command, req] = ref.src === "file" ? ["media", { path: ref.path, variant, force: Boolean(force) }]
    : ref.src === "inline" ? ["inline", { path: ref.transcript, offset: ref.offset, index: ref.index, variant }] : [null];
  if (!command) throw new Error("no local file");
  const r = await chatCall(command, req, { on, timeout: 35000 });
  const { png, stamp, noTools, ...facts } = r;
  if (noTools) return { ...facts, reason: `can't make a preview on ${on}`, on };
  if (!png) return { ...facts, on };
  // ponytail: the PNG comes again on every refresh of a shown tile (once a minute); send the stamp first if that costs
  const dir = `${appHome()}/pdk-cache/incoming`;
  const id = `${Date.now().toString(36)}-${(++incoming).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/${id}.b64`, png);
  const kept = await helper("store", [id, on, stamp], 30000);
  return { ...facts, image: kept.image, width: kept.width, height: kept.height, on };
}

// The original of a remote agent's media file, copied into this Mac's preview cache so the preview's Open and Play
// act on it (review R3): {path}, the local copy's absolute path, which `open` and `reveal` take. The same kinds and
// rules as its preview, at most 25 MB; it comes in pieces of at most 2.8 MB, each one answer (pdk-chat.py `piece`),
// each written to pdk-cache/incoming as text, never on a command line; the helper's `keep` puts them together under
// the cache's limits. A copy already in the cache, for the same file unchanged, is used again. Rejects with words a
// preview shows: the file gone, too large (its size and the machine), changed while it was copied, the machine
// can't be reached.
const ORIGINAL_MAX = 25 * 1024 * 1024;
const PIECE = 2800000;
const COPY_MS = 120000; // one deadline for a whole copy (each piece also has its own call timeout)
const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
export async function mediaOriginal(ref) {
  if (!ref?.on || ref.src !== "file") throw new Error("only a file on another machine is copied here");
  const { on, path } = ref;
  const name = ref.name ?? String(path).split("/").pop();
  const ask = (offset, length) => chatCall("piece", { path, offset, length }, { on, timeout: 35000 });
  const head = await ask(0, 0);
  if (head.missing) throw new Error(`${name} is not on ${on} any more`);
  if (head.large || head.size > ORIGINAL_MAX) throw new Error(`${name} on ${on} is ${mb(head.size)}: only files up to 25 MB are copied to this Mac`);
  // Review R8: whatever that machine answers, the copy ends. The first answer's size is the total; each piece must
  // be for the offset asked, valid base64, more than nothing while bytes remain and no more than remain; at most the
  // pieces that size needs plus one; one deadline for the whole copy.
  const refused = (why) => new Error(`${name} from ${on} was refused: ${why}`);
  const size = head.size;
  if (!Number.isInteger(size) || size < 0) throw refused("its size is not a size");
  const id = `${Date.now().toString(36)}-${(++incoming).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const keep = (count) => helper("keep", [id, on, head.stamp, head.ext, size, count], 60000);
  const have = await keep(0);
  if (have.path) return { path: have.path };
  const dir = `${appHome()}/pdk-cache/incoming`;
  await mkdir(dir, { recursive: true });
  const written = [];
  const most = Math.ceil(size / PIECE) + 1;
  const deadline = Date.now() + COPY_MS;
  try {
    let offset = 0;
    do {
      if (written.length >= most) throw refused("it came in more pieces than its size allows");
      if (Date.now() > deadline) throw refused(`the copy took longer than ${COPY_MS / 1000} s`);
      const p = await ask(offset, PIECE);
      if (p.stamp !== head.stamp) throw new Error(`${name} changed on ${on} while it was copied`);
      if (p.offset !== offset) throw refused("a piece came for another place in the file");
      const data = p.data;
      if (typeof data !== "string" || data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw refused("a piece of it is not base64");
      const n = (data.length / 4) * 3 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
      if (n > size - offset) throw refused("a piece of it was longer than the file");
      if (n === 0 && offset < size) throw refused("a piece of it was empty");
      const file = `${dir}/${id}-${written.length}.b64`;
      written.push(file); // removed on any refusal, even when the write itself failed half way
      await writeFile(file, data);
      offset += n;
    } while (offset < size);
    return { path: (await keep(written.length)).path };
  } catch (e) {
    await Promise.all(written.map((f) => unlink(f).catch(() => null))); // keep removes them too when it ran
    throw e;
  }
}
