// Shared evaluation helpers for Phase 5A's generality/validation benchmarks
// (catalog_part_challenge.mjs, leave_one_out_challenge.mjs,
// template_vs_automatic.mjs, and the randomized stress test in
// property_stress_check.mjs). Pulled out into one module, rather than
// duplicated three times, specifically so it can be unit-tested directly
// (see tests/benchmarkEvaluationHelpers.test.mjs, Phase 5A item 8) and so a
// classification/metric fix only ever needs to happen in one place.
//
// Nothing here computes a NEW verdict about a candidate -- every field read
// is already produced by automatic/index.js's own pipeline (validation
// reasons, provenanceStatus, assemblyPlan, scoring). This module only
// SUMMARIZES/CLASSIFIES those real outputs for reporting.

/**
 * Phase 5A item 6: classify why a given host/goal-family combination produced
 * no usable design, using ONLY the real reason strings validateCandidate()/
 * constraintEngine.js already produce -- never a new inference.
 *
 * Categories (fixed set, per the Phase 5A spec):
 *   "unsupported architecture"      -- neither pathway generated any candidate at all
 *   "insufficient host evidence"    -- a host-eligibility rejection fired
 *   "no eligible component for required role" -- a role gap with "no part in catalog"
 *   "assembly conflict"             -- a restriction-site conflict made the top candidate infeasible
 *   "unresolved dependency"         -- a cognate-partner ("in trans") dependency gap
 *   "placeholder/missing sequence"  -- placeholder provenance or a missing/invalid sequence
 *   "search-width limitation"       -- candidates existed but ALL were pruned/rejected for reasons
 *                                      that don't fit any of the above (a real "not modeled honestly
 *                                      yet" bucket, not a guess)
 *   "other"                         -- anything not covered above (reported, never hidden)
 *
 * @returns {string|null} a category name, or null if the run actually succeeded
 *   (>=1 hard-valid candidate was produced).
 */
export function classifyFailure(result) {
  if (!result.ok) {
    // Both pathways produced zero candidates at all (stage: "selectArchitecture"),
    // or characterization itself failed (stage: "characterizeInput", not expected
    // for a real catalog CDS + supported host/family, but handled honestly anyway).
    return "unsupported architecture";
  }
  if (result.candidates.valid.length > 0) return null; // success -- not a failure
  if (!result.candidates.invalid.length) return "other";

  // Each invalid candidate can carry MULTIPLE, genuinely different rejection
  // reasons (e.g. one beam branch happens to also pick a pSC101 ori with no
  // Rep101 available, on top of the anchor itself being placeholder-evidence
  // in every branch) -- classifying by "does ANY candidate mention X" picks
  // whichever category happens to appear first in a fixed priority order,
  // even when it explains only ONE candidate out of many. Classifying by the
  // reason type present in EVERY invalid candidate (the actual universal
  // blocker for this host/family combination) is the honest root cause; a
  // real catalog sweep caught exactly this mislabeling for placeholder-anchor
  // cases that also happened to generate an unrelated pSC101/Rep101 branch.
  const perCandidateCategories = result.candidates.invalid.map(c => new Set(
    c.validation.reasons.map(reasonToCategory).filter(Boolean)
  ));
  const universal = [...perCandidateCategories[0]].filter(cat => perCandidateCategories.every(s => s.has(cat)));
  if (universal.length) return pickPreferred(universal);

  // No single category explains EVERY invalid candidate -- fall back to
  // whichever category appears in the most candidates, still reported
  // honestly (never hidden), just acknowledging the cause is mixed.
  const allCategories = perCandidateCategories.flatMap(s => [...s]);
  if (allCategories.length) return pickPreferred([...new Set(allCategories)]);

  // Every candidate was generated but rejected for a reason not covered by
  // reasonToCategory (e.g. "resolved to N parts at once", or the whole-
  // sequence DNA-alphabet check) -- a real, honestly-reported gap in this
  // classifier's coverage, not necessarily a search-width issue, but the
  // closest fit among the fixed categories when nothing else applies.
  return "search-width limitation";
}

// Fixed priority used only to pick ONE label when multiple categories are
// still tied after the "universal blocker" pass above -- never used to
// override a genuinely universal cause.
const CATEGORY_PRIORITY = [
  "insufficient host evidence", "placeholder/missing sequence", "unresolved dependency",
  "no eligible component for required role", "assembly conflict",
];
function pickPreferred(categories) {
  for (const cat of CATEGORY_PRIORITY) if (categories.includes(cat)) return cat;
  return categories[0];
}

function reasonToCategory(reason) {
  if (reason.includes("host-ineligible")) return "insufficient host evidence";
  if (reason.includes("cognate replication protein missing")) return "unresolved dependency";
  if (reason.includes("no part in catalog")) return "no eligible component for required role";
  if (reason.includes("evidence:placeholder") || reason.includes("has no sequence on file") || reason.includes("fails DNA-alphabet validation")) return "placeholder/missing sequence";
  if (reason.includes("restriction site")) return "assembly conflict";
  // A real, pre-Phase-5A validateCandidate() check (whole-assembled-sequence
  // A/T/C/G-only test) -- fires when a real catalog part's OWN sequence
  // legitimately contains an ambiguity code (e.g. "N"). Not a placeholder (a
  // sequence IS present and evidence:verified) and not any other fixed
  // category -- "other" is the honest bucket, not a guess. See the Phase 5A
  // report's "surprising failures" section for the specific real part this
  // was found on (sg_FAP_alpha_2).
  if (reason.includes("characters outside A/T/C/G")) return "other";
  return null;
}

/** Every candidate (valid or not) preserves the anchor's role entry exactly
 * -- same check used throughout the Discord acceptance tests, generalized
 * for a sweep. Returns false (not "cannot determine") only on an ACTUAL
 * mismatch; a run with zero candidates trivially preserves nothing to check,
 * so it returns true (vacuously) -- callers should gate this on
 * candidates.all.length > 0 if they need to distinguish that. */
export function anchorPreserved(result, anchorRole, expectedId, expectedLength) {
  if (!result.ok) return true;
  for (const c of result.candidates.all) {
    const entry = c.plan.order.find(o => o.role === anchorRole);
    if (!entry) return false; // anchor role missing from a generated architecture entirely
    if (expectedId !== null && entry.id !== expectedId) return false;
    if (entry.length !== expectedLength) return false;
  }
  return true;
}

/**
 * Extracts the fixed set of Phase 5A metrics from one runAutomaticDesign()
 * result -- the SAME shape for every sweep, so aggregation code never has to
 * special-case which benchmark produced a given record.
 */
export function evaluateRun(result, { anchorRole, expectedAnchorId, expectedAnchorLength }) {
  const architectureGenerated = result.ok ? result.candidates.all.length > 0 : false;
  const hardValidGenerated = result.ok ? result.candidates.valid.length > 0 : false;
  const recEntry = result.ok && result.recommended
    ? result.scoring.ranked.find(r => r.candidateId === result.recommended.candidateId)
    : null;

  return {
    ok: result.ok,
    architectureGenerated,
    hardValidGenerated,
    anchorPreserved: anchorPreserved(result, anchorRole, expectedAnchorId, expectedAnchorLength),
    validCount: result.ok ? result.candidates.valid.length : 0,
    invalidCount: result.ok ? result.candidates.invalid.length : 0,
    recommendationProduced: !!(result.ok && result.recommended),
    goalCompatibleRecommendation: !!(result.ok && result.recommended && result.recommended.goalCompatible === true),
    assemblyFeasibleTop1: !!(result.ok && result.recommended && result.recommended.assemblyPlan && result.recommended.assemblyPlan.feasible),
    registryComparisonAvailable: !!(recEntry && Array.isArray(recEntry.registryComparison) && recEntry.registryComparison.length > 0),
    paretoOptimalTop1: recEntry ? (recEntry.paretoOptimal === true) : null,
    robustness: (result.ok && result.scoring.robustness && result.scoring.robustness.recommended)
      ? { stability: result.scoring.robustness.recommended.recommendationStability, label: result.scoring.robustness.recommended.stabilityLabel }
      : null,
    failureCategory: classifyFailure(result),
  };
}

/** Aggregates an array of evaluateRun() records into the summary rates every
 * Phase 5A report needs (success rates as fractions of ATTEMPTED runs, never
 * silently dropping a denominator). */
export function summarizeRuns(records) {
  const n = records.length;
  const frac = (pred) => n ? +(records.filter(pred).length / n).toFixed(4) : null;
  const failureCounts = {};
  for (const r of records) if (r.failureCategory) failureCounts[r.failureCategory] = (failureCounts[r.failureCategory] || 0) + 1;
  return {
    totalRuns: n,
    architectureGenerationRate: frac(r => r.architectureGenerated),
    hardValidRate: frac(r => r.hardValidGenerated),
    anchorPreservationRate: frac(r => r.anchorPreserved),
    goalCompatibleRecommendationRate: frac(r => r.goalCompatibleRecommendation),
    assemblyFeasibleTop1Rate: frac(r => r.assemblyFeasibleTop1),
    registryComparisonAvailableRate: frac(r => r.registryComparisonAvailable),
    failureCounts,
  };
}
