// One rule for who leads whom: Core's parent, else a stampede relay job's lead (its workers have no Core parent).
import { test, expect } from "bun:test";
import { teamParents } from "../adapters/team.js";

const t = (address, { parent = null, job = null, role = null, state = "live" } = {}) =>
  ({ address, parent, state, labels: { ...(job ? { "stampede.job": job } : {}), ...(role ? { "stampede.role": role } : {}) } });

test("Core's parent wins; a relay job's workers are led by its lead (real shape: hc-5a4f…, parent null)", () => {
  const ps = teamParents([
    t("t7v", { job: "hc-5a4f", role: "relay" }),
    t("t7w", { job: "hc-5a4f", role: "lead" }),
    t("t10g", { job: "hc-5a4f", role: "worker" }), t("t129", { job: "hc-5a4f", role: "worker" }),
    t("t123", { job: "hc-cc6f", role: "lead" }), t("t125", { parent: "t123", job: "hc-cc6f", role: "helper" }),
    t("t200"), t("t201", { parent: "t200" }),
  ]);
  expect(Object.fromEntries(ps)).toEqual({ t10g: "t7w", t129: "t7w", t125: "t123", t201: "t200" });
});

test("no lead, a finished lead, another machine's lead, or a gone Core parent: no team parent", () => {
  expect(teamParents([t("a", { job: "j", role: "worker" })]).size).toBe(0);
  expect(teamParents([t("l", { job: "j", role: "lead", state: "finished" }), t("w", { job: "j", role: "worker" })]).size).toBe(0);
  expect(teamParents([t("m1/l", { job: "j", role: "lead" }), t("w", { job: "j", role: "worker" })]).size).toBe(0);
  expect(Object.fromEntries(teamParents([t("m1/l", { job: "j", role: "lead" }), t("m1/w", { job: "j", role: "worker" })]))).toEqual({ "m1/w": "m1/l" });
  expect(teamParents([t("x", { parent: "gone" })]).size).toBe(0);
});
