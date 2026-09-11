// Real B. subtilis / endolysin case study (Phase 4B, Step 13).
//
// This is the actual real-world design question the Dry Lab needs an answer
// to: "we have a real endolysin CDS (dn_lysqdvp001_endolysin, evidence:
// verified, 711bp) and want it secreted from B. subtilis -- what complete
// plasmid does Automatic Design Mode propose, and why?" No template/backbone
// is named in the input -- only the real part, the host, and the design
// intent (via the structured "secretion" architecture family).
//
// Produces a single machine-readable JSON report (benchmark/results/
// bsub_endolysin_case_study.json) covering: input, locked components,
// inferred architecture family, required roles, every generated candidate
// (valid AND rejected, with reasons), the recommendation, its full score
// breakdown, Registry comparison, Pareto status, recommendation robustness,
// assembly plan, and an explicit "limitations / unknown evidence" section.
//
// NO WET-LAB VALIDATION CLAIM IS MADE ANYWHERE IN THIS FILE OR ITS OUTPUT.
// This is a computational design proposal only -- it demonstrates that the
// engine can produce a complete, internally-consistent, evidence-traceable
// plasmid design around a real Dry Lab part; it is not a claim that the
// design has been (or would necessarily be) built or tested at the bench.
//
// Usage: node benchmark/bsub_endolysin_case_study.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { runAutomaticDesign } from "../automatic/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const partsDoc = JSON.parse(readFileSync(path.join(REPO_ROOT, "data", "parts.json"), "utf-8"));
const templatesDoc = JSON.parse(readFileSync(path.join(REPO_ROOT, "data", "templates.json"), "utf-8"));
const registryCacheDoc = JSON.parse(readFileSync(path.join(REPO_ROOT, "data", "registry_cache.json"), "utf-8"));
const partsById = {};
for (const p of partsDoc.parts) partsById[p.id] = p;
const templates = templatesDoc.templates;

const ANCHOR_ID = "dn_lysqdvp001_endolysin";
const anchor = partsById[ANCHOR_ID];
if (!anchor) throw new Error(`Expected real catalog part "${ANCHOR_ID}" to exist in data/parts.json`);

const input = {
  partId: ANCHOR_ID,
  role: "cds",
  host: "B. subtilis",
  goalFamily: "secretion", // structured design-goal selection -- "secreted expression of this endolysin"
  partsById, templates, registryCache: registryCacheDoc,
  maxCandidates: 8, beamWidth: 6, candidatesPerRole: 4,
  robustnessTrials: 1000, robustnessSeed: 20260910,
  assemblyMethod: "gibson",
};
// No template/backbone/architecture field anywhere in the input:
if ("template" in input || "templateId" in input || "backbone" in input) throw new Error("test setup error");

const result = runAutomaticDesign(input);

if (!result.ok || !result.recommended) {
  console.error("CASE STUDY FAILED TO PRODUCE A RECOMMENDATION:", JSON.stringify(result, null, 2).slice(0, 2000));
  process.exit(1);
}

const scoredRecommended = result.scoring.ranked.find(r => r.candidateId === result.recommended.candidateId);

function summarizeCandidate(c, scored) {
  return {
    candidateId: c.candidateId,
    origin: c.origin,
    templateLabel: c.templateLabel,
    valid: c.validation.valid,
    validationReasons: c.validation.reasons,
    validationWarnings: c.validation.warnings,
    roleOrder: c.plan.order.map(o => ({ role: o.role, name: o.name, id: o.id, length: o.length })),
    totalLength: c.plan.totalLength,
    gcPercent: c.plan.gc,
    provenanceByRole: c.provenanceByRole || null,
    assemblyPlan: c.assemblyPlan ? { method: c.assemblyPlan.method, feasible: c.assemblyPlan.feasible, fragmentCount: c.assemblyPlan.fragmentCount, conflicts: c.assemblyPlan.conflicts } : null,
    overallScore: scored ? scored.overallScore : null,
    scoreBreakdown: scored ? scored.breakdown : null,
    paretoOptimal: scored ? scored.paretoOptimal : null,
  };
}

const report = {
  meta: {
    title: "Real B. subtilis / endolysin case study -- Automatic Design Mode (Phase 4B)",
    generatedAt: new Date().toISOString(),
    disclaimer: "Computational design proposal ONLY. No wet-lab validation, no claim of experimental success, no claim that this design has been built or tested. All 'evidence'/'verified'/'provenance' fields describe DATA PROVENANCE (a real catalog record, a real cached Registry record, a real project template) -- never biological/experimental confirmation.",
  },
  input: {
    anchorPartId: ANCHOR_ID,
    anchorPartName: anchor.name,
    anchorEvidence: anchor.evidence,
    anchorLengthBp: anchor.length,
    host: input.host,
    goalFamily: input.goalFamily,
    assemblyMethod: input.assemblyMethod,
    noTemplateOrBackboneNamed: true,
  },
  lockedComponents: result.lockedComponents,
  requirementPlan: result.requirementPlan,
  generationSummary: result.generationSummary,
  partFirstStatus: result.partFirstStatus,
  candidates: {
    valid: result.candidates.valid.map(c => summarizeCandidate(c, result.scoring.ranked.find(r => r.candidateId === c.candidateId))),
    rejected: result.candidates.invalid.map(c => summarizeCandidate(c, null)),
  },
  recommendation: {
    candidateId: result.recommended.candidateId,
    roleOrder: result.recommended.plan.order.map(o => ({ role: o.role, name: o.name, id: o.id, length: o.length })),
    totalLengthBp: result.recommended.plan.totalLength,
    gcPercent: result.recommended.plan.gc,
    recommendationNote: result.recommendationNote,
    scoreBreakdown: scoredRecommended.breakdown,
    scoreNotes: scoredRecommended.notes,
    overallScore: scoredRecommended.overallScore,
    weightUsed: scoredRecommended.weightUsed,
    paretoOptimal: scoredRecommended.paretoOptimal,
    strongestIn: scoredRecommended.strongestIn,
    dominatedBy: scoredRecommended.dominatedBy,
    registryComparison: scoredRecommended.registryComparison,
    comparisonToRunnerUp: result.comparison,
  },
  robustness: result.scoring.robustness,
  assemblyPlan: result.recommended.assemblyPlan,
  explanation: result.explanation,
  limitationsAndUnknownEvidence: {
    unscoredDimensions: Object.entries(scoredRecommended.breakdown).filter(([, v]) => v === null).map(([k]) => k),
    placeholderEvidenceParts: result.recommended.plan.order.filter(o => { const rec = o.id ? partsById[o.id] : null; return rec && rec.evidence === "placeholder"; }).map(o => o.name),
    registryPartsUsed: result.recommended.plan.order.filter(o => o.id && String(o.id).startsWith("registry:")).map(o => o.name),
    hostChassisNoteForRegistryComparison: (scoredRecommended.registryComparison || []).map(r => ({ referenceId: r.referenceId, chassisAgreement: r.chassisAgreement, chassisDetail: r.chassisDetail })),
    assemblyMethodCaveat: result.recommended.assemblyPlan.method === "gibson"
      ? "Gibson assembly is fully supported (real primer design via designer.js#gibsonPrimers) -- no caveat."
      : `Method "${result.recommended.assemblyPlan.method}" has conflict-detection support only -- see assemblyPlan.rationale.`,
    explicitStatement: "This design has NOT been synthesized or tested. Recommendation robustness (see 'robustness' above) measures RANKING STABILITY under scoring-weight perturbation only -- it is explicitly NOT a probability of experimental/wet-lab success.",
  },
};

mkdirSync(path.join(__dirname, "results"), { recursive: true });
const outPath = path.join(__dirname, "results", "bsub_endolysin_case_study.json");
writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log("=".repeat(78));
console.log("B. SUBTILIS / ENDOLYSIN CASE STUDY (Phase 4B, Step 13)");
console.log("=".repeat(78));
console.log(`Anchor: ${anchor.name} (${anchor.length} bp, evidence:${anchor.evidence}) -- host B. subtilis, goal family "secretion"`);
console.log(`Architecture family selected: ${result.requirementPlan.family.label}`);
console.log(`Required roles: ${result.requirementPlan.requiredRoles.join(", ")}`);
console.log(`Candidates generated: ${result.candidates.valid.length} valid, ${result.candidates.invalid.length} rejected`);
console.log(`Recommended: ${report.recommendation.roleOrder.map(o => o.name).join(" -> ")}`);
console.log(`  ${report.recommendation.totalLengthBp} bp, GC ${report.recommendation.gcPercent}%, overallScore ${report.recommendation.overallScore}/100, Pareto-optimal: ${report.recommendation.paretoOptimal}`);
console.log(`  Assembly (${report.assemblyPlan.method}): feasible=${report.assemblyPlan.feasible}, ${report.assemblyPlan.fragmentCount} fragments`);
console.log(`  Registry comparison: ${scoredRecommended.registryComparison.map(r => `${r.referenceId} (role-order similarity ${r.roleOrderSimilarity})`).join(", ") || "none available"}`);
console.log(`  Recommendation robustness: ${(result.scoring.robustness.recommended.recommendationStability * 100).toFixed(0)}% top-rank frequency over ${result.scoring.robustness.trials} weight-perturbation trials (${result.scoring.robustness.recommended.stabilityLabel})`);
console.log(`  Unscored dimensions: ${report.limitationsAndUnknownEvidence.unscoredDimensions.join(", ") || "none"}`);
console.log();
console.log("This is a computational design proposal ONLY -- no wet-lab claim is made. See the full machine-readable report:");
console.log(`Wrote ${path.relative(REPO_ROOT, outPath)}`);
