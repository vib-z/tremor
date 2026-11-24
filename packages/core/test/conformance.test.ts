import { describe, expect, test } from "bun:test";
import { validateIntent, type CoreInput } from "@tremor/protocol";
import { conform, loadFixtures, replay } from "@tremor/protocol/conformance";
import { engine } from "../src/store/index.ts";

const shared = loadFixtures();
const fixture = (name: string) => shared.find((f) => f.name === name)!;

describe("conformance", () => {
  test("the contract ships lifecycle-approval", () => expect(shared.map((f) => f.name)).toContain("lifecycle-approval"));
  for (const f of shared) test(f.name, () => expect(conform(engine, f)).toEqual([]));
  test("a wrong expectation fails", () => {
    for (const f of shared) {
      const wrong = structuredClone(f);
      wrong.expected.digest.activity = wrong.expected.digest.activity.slice(1);
      wrong.expected.digest.historyGapAt = 1;
      expect(conform(engine, wrong).length).toBeGreaterThan(0);
    }
  });
});

// What v1.2 adds that the digest does not show (yet): checked here on the shared fixtures.
describe("contract v1.2 beyond the digest", () => {
  test("composer-send: each message carries the expectedStatus the composer saw, and so does its action", () => {
    const s = replay(engine, fixture("composer-send").inputs);
    const sent = s.activity.flatMap((e) => (e.type === "message" ? [[e.text, e.expectedStatus]] : []));
    expect(sent).toEqual([
      ["Run the tests", "idle"],
      ["Also lint", "working"],
      ["Thanks", "done"],
      ["One more", "idle"],
    ]);
    expect(Object.values(s.actions).map((a) => a.action.type === "send" && a.action.expectedStatus)).toEqual(["idle", "working", "done", "idle"]);
  });

  test("history-gap: the latest gap bounds history; an older one replayed never moves it back", () => {
    const f = fixture("history-gap");
    const gaps = f.inputs.filter((i) => i.kind === "history-gap");
    const s = replay(engine, [...f.inputs, ...gaps.slice(0, 1)]);
    expect(s.historyGapAt).toBe(gaps[1]!.t);
    expect(s.activity.some((e) => e.key.startsWith("history-gap"))).toBe(false);
  });

  test("approval-blocked-twice: the counted id passes the IPC validator, and dispatch inputs stay valid", () => {
    for (const i of fixture("approval-blocked-twice").inputs.filter((x): x is Extract<CoreInput, { kind: "user"; phase: "dispatched" }> => x.kind === "user" && x.phase === "dispatched")) {
      const { actionId: _, ...intent } = i.action;
      expect(validateIntent(intent)).toEqual(intent);
    }
  });
});
