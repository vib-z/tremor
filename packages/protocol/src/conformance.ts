// Golden-fixture conformance: any StoreEngine (the TypeScript store, and the Swift port through its own
// runner over the same files) must replay every fixture to its expected digest, and replaying the
// same inputs again, in any chunking, must change nothing.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CoreInput, StoreEngine, StoreState } from "./model.ts";
import { canonicalJson, digest, type Digest } from "./keys.ts";

export const FIXTURES_DIR = fileURLToPath(new URL("../fixtures", import.meta.url));

export interface Fixture {
  name: string;
  inputs: CoreInput[];
  expected: { description: string; digest: Digest };
}

export function loadFixtures(dir = FIXTURES_DIR): Fixture[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({
      name: d.name,
      inputs: readFileSync(join(dir, d.name, "core.jsonl"), "utf8")
        .split("\n")
        .filter((l) => l.trim() !== "")
        .map((l) => JSON.parse(l) as CoreInput),
      expected: JSON.parse(readFileSync(join(dir, d.name, "expected.json"), "utf8")),
    }));
}

export function replay(engine: StoreEngine, inputs: CoreInput[], from: StoreState = engine.initial()): StoreState {
  let state = from;
  for (const input of inputs) for (const event of engine.normalize(state, input)) state = engine.reduce(state, event);
  return state;
}

export const digestJson = (s: StoreState): string => canonicalJson(digest(s));

/** The checks every engine must pass for one fixture. Returns failures; empty means it conforms. */
export function conform(engine: StoreEngine, f: Fixture): string[] {
  const failures: string[] = [];
  const want = canonicalJson(f.expected.digest);
  const once = replay(engine, f.inputs);
  if (digestJson(once) !== want) failures.push(`${f.name}: digest\n got  ${digestJson(once)}\n want ${want}`);
  // The whole log delivered again (a restart that replays its log onto a restored checkpoint) changes nothing.
  const twice = replay(engine, f.inputs, once);
  if (digestJson(twice) !== want) failures.push(`${f.name}: replaying every input again changed the digest\n got  ${digestJson(twice)}`);
  // Every input delivered twice in a row (duplicate delivery) changes nothing.
  const doubled = replay(engine, f.inputs.flatMap((i) => [i, i]));
  if (digestJson(doubled) !== want) failures.push(`${f.name}: duplicated inputs changed the digest\n got  ${digestJson(doubled)}`);
  // Restoring from any intermediate state, serialised as JSON, then replaying the rest gives the same digest.
  for (const cut of [1, Math.floor(f.inputs.length / 2), f.inputs.length - 1]) {
    const mid = JSON.parse(JSON.stringify(replay(engine, f.inputs.slice(0, cut)))) as StoreState;
    const end = replay(engine, f.inputs.slice(cut), mid);
    if (digestJson(end) !== want) failures.push(`${f.name}: restore at input ${cut} then replay changed the digest`);
  }
  return failures;
}
