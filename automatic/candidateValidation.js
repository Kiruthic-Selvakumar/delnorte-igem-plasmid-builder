// Automatic Design Mode -- hard-constraint validation for one generated candidate.
//
// Reuses designer.js's own design()/fillTemplate() output rather than
// reimplementing gap/site-conflict logic: validateCandidate() is applied to the
// `plan` object design() already returns (see candidateGeneration.js). Gap
// detection (missing required roles) and the whole-sequence DNA-alphabet check
// are unchanged from Phase 1-4B.
//
// PHASE 4C CHANGE: per-role provenance is no longer judged by data/parts.json's
// raw 2-value `evidence` field (which conflated "a real, syntactically valid
// user-supplied/Registry-recorded sequence" with "a genuinely unresolved
// catalog gap" -- both were "placeholder", both were hard-rejected). Each
// resolved role's part is now classified via provenanceModel.js's
// sequenceStatus/provenanceStatus model, and ONLY "missing"/"invalid"
// sequence or "placeholder" provenance is hard-rejected -- "registry_recorded"
// and "user_supplied" provenance instead produce an explicit, honest
// confidence WARNING and are otherwise treated as buildable. See
// provenanceModel.js's header for the full rationale.
//
// Hard failures are returned as `reasons` and mean the candidate is rejected
// outright, per the design brief §7: "Hard failures should NOT merely lower a
// score. Invalid designs should be removed from the candidate set." Restriction-
// site conflicts are reported as `warnings`, not hard failures, to stay consistent
// with Template-Guided Mode's own existing behavior (site conflicts are shown but
// do not block "buildable" there either).
//
// No host-incompatibility check is implemented here as of Phase 4B -- see
// constraintEngine.js's checkHostEligibility (Phase 4C) for the independent
// host-constraint check now layered on top of this, both in beam-search
// pruning AND as a final hard-validation gate.

import { classifyProvenance, isHardRejectedProvenance, provenanceConfidenceNote } from "./provenanceModel.js";
import { checkHostEligibility } from "./constraintEngine.js";

const DNA_ONLY = /^[ATCG]*$/;

/** The real part object behind one plan.order entry -- a real catalog id
 * looks itself up in partsById (this also correctly resolves Registry-
 * inserted "registry:<id>" parts, since architectureGeneration.js merges
 * those into its own partsById copy before calling design()); id:null is
 * this project's own convention for "the anchor/user-supplied slot". */
function resolvePart(orderEntry, partsById, anchorPart) {
  if (orderEntry.id) return (partsById && partsById[orderEntry.id]) || null;
  return (anchorPart && anchorPart.id === null) ? anchorPart : null;
}

export function validateCandidate(plan, { anchorPart, partsById, host, documentedHostsIndex } = {}) {
  const reasons = [];
  const warnings = [];

  for (const g of plan.gaps) {
    reasons.push(`Missing required role "${g.role}": ${g.reason}${g.missing ? ` (candidate id(s) considered: ${g.missing.join(", ")})` : ""}.`);
  }

  if (!DNA_ONLY.test(plan.sequence || "")) {
    reasons.push("Assembled sequence contains characters outside A/T/C/G -- invalid DNA.");
  }

  const roleCounts = new Map();
  for (const o of plan.order) roleCounts.set(o.role, (roleCounts.get(o.role) || 0) + 1);
  for (const [role, count] of roleCounts) {
    if (count > 1) reasons.push(`Role "${role}" resolved to ${count} parts at once -- inconsistent architecture data for this template.`);
  }

  for (const o of plan.order) {
    const part = resolvePart(o, partsById, anchorPart);
    const classification = classifyProvenance(part);
    if (isHardRejectedProvenance(classification)) {
      if (classification.sequenceStatus === "missing") {
        reasons.push(`Part "${o.name}" has no sequence on file -- cannot be hard-validated as buildable.`);
      } else if (classification.sequenceStatus === "invalid") {
        reasons.push(`Part "${o.name}" has a sequence that fails DNA-alphabet validation -- cannot be hard-validated as buildable.`);
      } else {
        reasons.push(`Part "${o.name}" is evidence:placeholder (not yet resolved to this project's own verification standard) -- cannot be hard-validated as buildable.`);
      }
      continue;
    }
    const note = provenanceConfidenceNote(classification.provenanceStatus, o.name);
    if (note) warnings.push(note);

    // Phase 4C: independent host-eligibility check, run here as the final
    // hard-validation gate regardless of whether retrieval-tier host
    // filtering ran or was ablated -- see constraintEngine.js#checkHostEligibility.
    if (host && part) {
      const hostCheck = checkHostEligibility(part, host, documentedHostsIndex);
      if (!hostCheck.ok) reasons.push(`Part "${o.name}" is host-ineligible for "${host}": ${hostCheck.reason}`);
    }
  }

  for (const c of plan.siteConflicts) {
    warnings.push(`Restriction site conflict: ${c.enzyme} site inside "${c.part}" at position ${c.position.toLocaleString()}.`);
  }

  return { valid: reasons.length === 0, reasons, warnings };
}
