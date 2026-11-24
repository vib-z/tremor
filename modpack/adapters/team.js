// Who leads whom: one rule for every view that draws a team (the Factory Map, the sidebar).
//
// A terminal's team parent is Core's own parent link when it has one. A stampede relay job starts its workers with no
// Core parent (they must outlive a lead restart), so there the job's own labels stand in: a terminal labelled
// `stampede.job=<J>` with a role other than lead (and not the job's relay) is led by the live terminal of the same job,
// on the same machine, labelled `stampede.role=lead`. Pure: terminals in, a Map out.

const host = (address) => { const s = String(address ?? ""); const i = s.lastIndexOf("/"); return i < 0 ? "" : s.slice(0, i); };
const label = (t, k) => t?.labels?.[k] ?? null;

/** address → team parent address, for every live terminal that has one. */
export function teamParents(terminals = []) {
  const live = terminals.filter((t) => t && t.state !== "finished");
  const here = new Set(live.map((t) => t.address));
  const leads = new Map();
  for (const t of live) {
    const job = label(t, "stampede.job");
    if (job && label(t, "stampede.role") === "lead") leads.set(`${host(t.address)}|${job}`, t.address);
  }
  const out = new Map();
  for (const t of live) {
    if (t.parent && here.has(t.parent) && t.parent !== t.address) { out.set(t.address, t.parent); continue; }
    const job = label(t, "stampede.job"), role = label(t, "stampede.role");
    if (!job || role === "lead" || role === "relay") continue;
    const lead = leads.get(`${host(t.address)}|${job}`);
    if (lead && lead !== t.address) out.set(t.address, lead);
  }
  return out;
}
