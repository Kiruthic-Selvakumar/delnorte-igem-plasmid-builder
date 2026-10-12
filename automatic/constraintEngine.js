// Automatic Design Mode -- constraint engine (Phase 4B).
//
// Generic machinery that reads designGrammar.js's typed RULES and checks a
// partial (in-progress) candidate against them, so architectureGeneration.js
// can prune a branch the moment a hard constraint proves it can never become
// valid -- instead of only discovering the same failure after fully
// assembling the candidate and running validateCandidate() (still done too,
// as the final authority; this engine's job is to avoid WASTING beam slots
// on partials already provably doomed, not to replace final validation).

import { rulesByType } from "./designGrammar.js";

/** @returns {{ok:true}|{ok:false, ruleId:string, reason:string}} */
export function checkIncompatibility(assignments, newRole, newPart, host) {
  if (!newPart) return { ok: true };
  for (const r of rulesByType("incompatibility")) {
    if (r.condition.host && r.condition.host !== host) continue;
    if (r.condition.partId && r.condition.partId === newPart.id) {
      return { ok: false, ruleId: r.id, reason: `${r.sourceReference} -- ${r.rationale}` };
    }
  }
  return { ok: true };
}

/** part_requires_part rules for a given assigned part. */
export function requiredPartnersFor(partId) {
  const rule = rulesByType("part_requires_part").find(r => r.condition.partId === partId);
  return rule ? { ruleId: rule.id, requiredIds: rule.consequence.requiresPartId } : null;
}

/** Given the FULL role->candidatePool map available to a search (host-curated
 * pools per role, before any pruning), determine whether a partner
 * requirement can possibly still be satisfied. If the role that would carry
 * the partner has ZERO chance of ever containing it (not merely "not yet
 * assigned"), the branch is provably doomed and can be pruned immediately
 * rather than discovered later via validateCandidate(). */
export function dependencyFeasibility(newPart, roleCandidatePools) {
  const req = requiredPartnersFor(newPart.id);
  if (!req) return { hasRequirement: false, feasible: true };
  const everAvailable = Object.values(roleCandidatePools).flat().map(p => p.id);
  const feasible = req.requiredIds.some(id => everAvailable.includes(id));
  return { hasRequirement: true, feasible, ruleId: req.ruleId, requiredIds: req.requiredIds };
}

function normHost(h) { return String(h || "").trim().toLowerCase(); }

/** Every host that ANY project template documents as accepting this exact
 * part id as a candidate for ANY role -- a real, per-part allow-list read
 * straight from data/templates.json, never inferred from a part's name,
 * type, or general biological knowledge. Build once per run and reuse; this
 * is the data source checkHostEligibility() below treats as authoritative. */
export function buildDocumentedHostsIndex(templates) {
  const index = {};
  for (const t of templates || []) {
    const h = normHost(t.host);
    for (const slot of t.slots) {
      for (const id of (slot.candidates || [])) {
        if (!index[id]) index[id] = new Set();
        index[id].add(h);
      }
    }
  }
  return index;
}

/**
 * Independent host-eligibility check (Phase 4C). Run at BOTH beam-search
 * pruning time and final hard validation, so it catches a cross-host part
 * regardless of whether retrieval-tier host filtering ran or was ablated
 * (see benchmark/ablation_analysis.mjs's ablateHostFiltering finding: without
 * this check, a V. natriegens design could pick up B.-subtilis-only parts
 * and validateCandidate() would still mark it valid).
 *
 * Two real, citable rejection grounds:
 *   1. a documented incompatibility rule (designGrammar.js's own
 *      "incompatibility" rules, via checkIncompatibility() -- reused, not
 *      duplicated).
 *   2. the part is documented in data/templates.json as a candidate for one
 *      or more OTHER hosts, and NEVER for this one -- host-specific-elsewhere.
 * If NEITHER project data source says anything about this part's host
 * applicability at all, the result is "unknown" (ok:true -- a pass, never a
 * rejection): absence of data is never treated as incompatibility.
 *
 * @param {object|null} part - a resolved role's part object. A user-supplied/
 *   novel anchor (id:null) is always "unknown" -- nothing in this project's
 *   data could document a host for a sequence that didn't exist in any
 *   catalog before this run.
 * @param {string} host
 * @param {Object<string,Set<string>>} documentedHostsIndex - from buildDocumentedHostsIndex().
 * @returns {{ok:boolean, status:"documented"|"unknown"|"incompatible"|"host_specific_elsewhere", reason:string}}
 */
export function checkHostEligibility(part, host, documentedHostsIndex) {
  if (!part) return { ok: true, status: "unknown", reason: "No part resolved for this role -- nothing to check." };

  const incompat = checkIncompatibility({}, null, part, host);
  if (!incompat.ok) return { ok: false, status: "incompatible", reason: incompat.reason };

  if (part.id == null) {
    return { ok: true, status: "unknown", reason: `"${part.name}" is a user-supplied sequence with no catalog id -- no project data could document a host for it either way.` };
  }
  const documented = documentedHostsIndex && documentedHostsIndex[part.id];
  if (!documented || documented.size === 0) {
    return { ok: true, status: "unknown", reason: `No project template documents any host for part id "${part.id}" -- host eligibility is unknown, not assumed compatible or incompatible.` };
  }
  if (documented.has(normHost(host))) {
    return { ok: true, status: "documented", reason: `data/templates.json documents part id "${part.id}" as a candidate for host "${host}".` };
  }
  return {
    ok: false, status: "host_specific_elsewhere",
    reason: `data/templates.json documents part id "${part.id}" ONLY for host(s) ${[...documented].join(", ")} -- never for "${host}" -- treated as host-ineligible rather than silently allowed.`,
  };
}

/** Builds the full, explainable constraint trace for a FINISHED candidate's
 * resolved assignments (role -> part|null) -- used by explain.js and the
 * "why this candidate" report, not by the search loop itself. */
export function buildConstraintTrace(assignments, host) {
  const satisfiedDependencies = [];
  const unsatisfiedDependencies = [];
  const incompatibilities = [];
  const presentIds = new Set(Object.values(assignments).filter(Boolean).map(p => p.id));

  for (const [role, part] of Object.entries(assignments)) {
    if (!part) continue;
    const req = requiredPartnersFor(part.id);
    if (req) {
      const satisfied = req.requiredIds.some(id => presentIds.has(id));
      (satisfied ? satisfiedDependencies : unsatisfiedDependencies).push({
        role, partId: part.id, ruleId: req.ruleId, requiredIds: req.requiredIds,
      });
    }
    const incompat = checkIncompatibility(assignments, role, part, host);
    if (!incompat.ok) incompatibilities.push({ role, partId: part.id, ruleId: incompat.ruleId, reason: incompat.reason });
  }
  return { satisfiedDependencies, unsatisfiedDependencies, incompatibilities };
}
