// Automatic Design Mode -- "why this candidate?" explanation (Phase 4B, Step 10).
//
// Every line here is assembled from fields already present on the
// runAutomaticDesign() result -- nothing here is generated prose from an LLM,
// and no biological claim is added that isn't already traceable to
// requirementPlan.rationale, architecture.rationale, scoring breakdowns,
// registryComparison, robustness, or assemblyPlan. This module's only job is
// to select and phrase the RIGHT existing facts into a compact narrative.

import { classifyProvenance } from "./provenanceModel.js";

export function explainRecommendation(result, ctx = {}) {
  if (!result.ok || !result.recommended) return { lines: ["No recommendation to explain -- see stage/errors/reason."] };
  const { partsById = {} } = ctx;
  const anchorPart = result.characterized.input.anchorPart;
  // Phase 4C.1: a Registry-inserted part's id (e.g. "registry:BBa_J23100")
  // only exists in the recommended candidate's OWN resolvedPartsById (set by
  // architectureGeneration.js) -- never in the caller's plain partsById.
  // Without this merge, classifyProvenance() below sees "no part at all" for
  // a real, resolved Registry part and wrongly reports provenanceStatus:"n/a".
  const effectivePartsById = result.recommended.resolvedPartsById && Object.keys(result.recommended.resolvedPartsById).length
    ? { ...partsById, ...result.recommended.resolvedPartsById }
    : partsById;
  const resolvePart = o => (o.id ? effectivePartsById[o.id] : ((anchorPart && anchorPart.id === null) ? anchorPart : null));

  const lines = [];
  const rec = result.scoring.ranked.find(r => r.candidateId === result.recommended.candidateId);

  // Why this architecture family?
  if (result.requirementPlan) {
    lines.push({ q: "Why was this architecture family selected?", a: result.requirementPlan.familyStatus });
    lines.push({ q: "Why are these biological roles required?", a: result.requirementPlan.rationale.join(" ") });
  } else {
    lines.push({ q: "Why was this architecture family selected?", a: result.partFirstStatus || "Part-first generation was not used for this role; see the selected template's own rationale instead." });
  }

  // Why this template (if template-origin) or architecture (if beam-search)?
  if (result.architecture && result.architecture.ok) {
    lines.push({ q: "Which decisions were based on project templates?", a: result.architecture.rationale });
  }

  // Why these specific parts? Two SEPARATE provenance axes are reported,
  // never conflated (see provenanceModel.js's header): `retrieval` is WHERE
  // the search found this part (host_curated/family_recommended/registry_recorded/
  // catalog_fallback/locked); `provenanceStatus` is the Phase 4C build-
  // confidence classification (project_verified/registry_recorded/
  // user_supplied/placeholder) that hard validation actually gates on.
  const partLines = result.recommended.plan.order.map(o => {
    const retrieval = result.recommended.provenanceByRole?.[o.role] || (result.recommended.origin === "template" ? "host_curated" : "locked");
    const { provenanceStatus } = classifyProvenance(resolvePart(o));
    return `${o.name} (role: ${o.role}, retrieval: ${retrieval}, provenanceStatus: ${provenanceStatus || "n/a"})`;
  });
  lines.push({ q: `Why was each part selected (${result.recommended.templateLabel})?`, a: partLines.join("; ") });

  // Registry evidence
  if (rec && rec.registryComparison && rec.registryComparison.length) {
    const refLines = rec.registryComparison.map(c => `${c.referenceId} (${c.title}): role-order similarity ${(c.roleOrderSimilarity * 100).toFixed(0)}%, chassis ${c.chassisAgreement}${c.sharedExactParts.length ? `, shared parts: ${c.sharedExactParts.join(", ")}` : ""}`);
    lines.push({ q: "Which decisions were supported by Registry references?", a: refLines.join("; ") });
  } else {
    lines.push({ q: "Which decisions were supported by Registry references?", a: "None -- no role-relevant Registry reference construct was available for this run." });
  }
  lines.push({ q: "Which evidence is unknown?", a: rec ? Object.entries(rec.breakdown).filter(([, v]) => v === null).map(([k]) => k).join(", ") || "None -- every scored dimension had a value." : "n/a" });

  // Alternatives / why #2 lost
  if (result.comparison) {
    lines.push({ q: "What alternatives were considered, and why was #2 ranked below #1?", a: result.comparison.summary });
  }
  if (result.scoring.robustness?.recommended) {
    const r = result.scoring.robustness.recommended;
    lines.push({ q: "How stable is this recommendation?", a: `${(r.recommendationStability * 100).toFixed(0)}% top-rank frequency across ${result.scoring.robustness.trials} weight-perturbation trials (${r.stabilityLabel}). This is ranking-stability, not a probability of experimental success.` });
  }

  // Hard constraints that rejected others
  if (result.candidates.invalid.length) {
    const rejLines = result.candidates.invalid.map(c => `${c.candidateId}: ${c.validation.reasons.join("; ")}`);
    lines.push({ q: "What hard constraints rejected other candidates?", a: rejLines.join(" | ") });
  } else {
    lines.push({ q: "What hard constraints rejected other candidates?", a: "None were rejected in this run." });
  }

  // Assembly
  if (result.recommended.assemblyPlan) {
    const ap = result.recommended.assemblyPlan;
    lines.push({ q: "What assembly considerations affected the result?", a: `Method "${ap.method}": ${ap.feasible ? "feasible" : "NOT feasible"}, ${ap.fragmentCount} fragments, ${ap.conflicts.length} restriction-site conflict(s). ${ap.rationale.join(" ")}` });
  }

  return { lines };
}
