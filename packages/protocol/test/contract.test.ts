import { describe, expect, test } from "bun:test";
import { loadFixtures } from "../src/conformance.ts";
import {
  decodeTerminal,
  dialogOf,
  dialogOptions,
  fingerprintOf,
  keys,
  sameFingerprint,
  sendGuard,
  termKey,
  validateIntent,
  validateOpen,
  IntentError,
  type CoreInput,
  type CoreTerminal,
} from "../src/index.ts";

const KINDS = new Set(["connecting", "hello", "subscribed", "notification", "doc", "terminal", "closed", "offline", "user", "transcript", "fleet", "history-gap"]);
const EVENT_TYPES = new Set(["created", "lost", "restarted", "keep", "finished", "removed", "status", "turn", "title", "labels", "size", "foreground", "doc"]);
const fixtures = loadFixtures();
const C = "c0ffee0000000000000000000000000a";
const B = { app: "claude-code", state: "blocked", kind: "permission", msg: "approve Write: /tmp/x" };
const record = (over: Partial<CoreTerminal> = {}) =>
  ({ address: "t1", argv: ["claude"], status: B, status_ms: 100, turn: 1, parent: null, ...over }) as CoreTerminal;

describe("fixtures", () => {
  test("exist and every line is a well-formed CoreInput", () => {
    expect(fixtures.length).toBeGreaterThan(0);
    for (const f of fixtures)
      for (const i of f.inputs) {
        expect(KINDS.has(i.kind)).toBe(true);
        expect(Number.isInteger(i.t)).toBe(true);
        if (i.kind === "notification" && i.msg.method === "event") {
          expect(EVENT_TYPES.has(i.msg.params.type)).toBe(true);
          expect(Number.isInteger(i.msg.params.seq)).toBe(true);
        }
      }
  });

  test("dispatched user actions pass the IPC validator once actionId is stripped", () => {
    for (const f of fixtures)
      for (const i of f.inputs.filter((x): x is Extract<CoreInput, { kind: "user"; phase: "dispatched" }> => x.kind === "user" && x.phase === "dispatched")) {
        const { actionId: _, ...intent } = i.action;
        expect(validateIntent(intent)).toEqual(intent);
      }
  });

  test("the approval id in lifecycle-approval is the key builder's, from the fresh get's status_ms", () => {
    const f = fixtures.find((x) => x.name === "lifecycle-approval")!;
    expect(Object.keys(f.expected.digest.approvals)).toEqual([keys.approval(termKey(C, "t1"), 1794170357600)]);
  });
});

describe("approval fingerprint (exact, structural)", () => {
  const fp = fingerprintOf(C, record())!;
  test("matches the same record", () => expect(sameFingerprint(fp, fingerprintOf(C, record()))).toBe(true));
  test("a new blocked occurrence with the same words and turn differs by status_ms", () =>
    expect(sameFingerprint(fp, fingerprintOf(C, record({ status_ms: 200 })))).toBe(false));
  test("field boundaries cannot collide (review P2)", () => {
    const a = fingerprintOf(C, record({ status: { ...B, msg: "a|b", title: "c" } }))!;
    expect(sameFingerprint(a, fingerprintOf(C, record({ status: { ...B, msg: "a", title: "b|c" } })))).toBe(false);
  });
  test("a terminal that is no longer blocked has no fingerprint", () => expect(fingerprintOf(C, record({ status: { state: "working" } }))).toBeNull());
  test("no status time, no fingerprint", () => expect(fingerprintOf(C, record({ status_ms: null }))).toBeNull());
});

describe("dialogs come from Core's argv, not the program's self-report (review P10)", () => {
  test("claude by path", () => expect(dialogOf({ argv: ["/opt/homebrew/bin/claude", "--model", "x"] })).toBe("claude-code"));
  test("a shell claiming app=claude-code gets no buttons", () => {
    const d = dialogOf({ argv: ["sh", "-c", "printf ..."] });
    expect(d).toBe("unknown");
    expect(dialogOptions(d, "permission")).toEqual([]);
  });
  test("claude question prompts get no buttons", () => expect(dialogOptions("claude-code", "question")).toEqual([]));
});

describe("composer guard maps to Core's idle|working enum (review P1)", () => {
  test("idle", () => expect(sendGuard("idle")).toBe("idle"));
  test("working", () => expect(sendGuard("working")).toBe("working"));
  test("done sends without a guard", () => expect(sendGuard("done")).toBeNull());
  test("blocked is refused", () => expect(sendGuard("blocked")).toBe("refuse"));
});

test("decodeTerminal applies Core's omitted-field defaults (review P7)", () => {
  const t = decodeTerminal(C, { address: "t2", parent: "t1" } as CoreTerminal);
  expect(t.records).toEqual({});
  expect(t.foreground).toBeNull();
  expect(t.parentKey).toBe(`${C}/t1`);
});

describe("validateIntent rejects", () => {
  const ok = { type: "send", terminal: "c0ffee/t1", text: "hi", expectedStatus: "idle" };
  const cases: [string, unknown][] = [
    ["a non-object", "send"],
    ["an unknown intent", { type: "run", argv: ["rm", "-rf", "/"] }],
    ["an extra field", { ...ok, force: true }],
    ["a bad terminal key", { ...ok, terminal: "../../etc/passwd" }],
    ["oversize text", { ...ok, text: "x".repeat(64 * 1024 + 1) }],
    ["a status Core cannot guard and Tremor does not know", { ...ok, expectedStatus: "blocked" }],
    ["a forged approval id", { type: "approve", approvalId: "anything", option: "Approve" }],
    ["a fingerprint smuggled into approve", { type: "approve", approvalId: `approval:${C}/t1:1794170357600`, option: "Approve", fingerprint: {} }],
    ["keys smuggled as an option", { type: "approve", approvalId: `approval:${C}/t1:1794170357600`, option: "ctrl+c" }],
    ["the removed attach intent", { type: "attach", terminal: "c0ffee/t1", mode: "active", cols: 80, rows: 24 }],
  ];
  for (const [name, raw] of cases) test(name, () => expect(() => validateIntent(raw)).toThrow(IntentError));
  test("openTerminal with a bad mode", () => expect(() => validateOpen("c0ffee/t1", "takeover", 80, 24)).toThrow(IntentError));
});
