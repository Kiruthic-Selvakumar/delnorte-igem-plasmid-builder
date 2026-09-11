// Phase 5A, item 4: TEMPLATE-GUIDED VS AUTOMATIC BASELINE.
//
// Template-Guided Mode is the BASELINE here, not a strawman: it is exactly
// designer.js#design() called with the SAME template a real user of this
// project's original UI would have picked for a given host, and the SAME
// anchor CDS -- no scoring, no beam search, no Registry comparison, because
// Template-Guided Mode has none of those (that is the honest, structural
// difference being measured, not injected).
//
// Each of the project's 4 real templates is paired with the host/architecture
// family combination its own documented promoter/slots actually match (real
// data, not invented pairings -- see designGrammar.js's own family evidence
// citations for bsub_delnorte/bsub_secretion/ecoli_inducible/vnat_broadhost):
//   ecoli_inducible  <-> E. coli        / inducible_regulated_expression
//   vnat_broadhost   <-> V. natriegens  / inducible_regulated_expression
//   bsub_secretion   <-> B. subtilis    / secretion
//   bsub_delnorte    <-> B. subtilis    / inducible_regulated_expression
//
// For the same deterministic sample of real CDS anchors used by
// leave_one_out_challenge.mjs (stride 8 over the verified/sequenced CDS
// population), both pipelines are run and compared on: architecture
// completeness, hard constraint violations, assembly feasibility, Registry/
// reference support, number of alternatives considered, architecture
// evidence, and whether a template/backbone choice was required from the
// user. The verdict per case (automatic_better / equal / template_guided_better)
// is computed MECHANICALLY from these real, measured fields -- never asserted.
//
// Usage: node benchmark/template_vs_automatic.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { design } from "../designer.js";
import { runAutomaticDesign } from "../automatic/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const partsDoc = JSON.parse(readFileSync(path.join(REPO_ROOT, "data", "parts.json"), "utf-8"));
const templatesDoc = JSON.parse(readFileSync(path.join(REPO_ROOT, "data", "templates.json"), "utf-8"));
const registryCacheDoc = JSON.parse(readFileSync(path.join(REPO_ROOT, "data", "registry_cache.json"), "utf-8"));
const partsById = {};
for (const p of partsDoc.parts) partsById[p.id] = p;
const templates = templatesDoc.templates;
const templatesById = Object.fromEntries(templates.map(t => [t.id, t]));

const ROBUSTNESS_TRIALS = 200;
const SAMPLE_STRIDE = 8;

const PAIRINGS = [
  { templateId: "ecoli_inducible", host: "E. coli", familyId: "inducible_regulated_expression" },
  { templateId: "vnat_broadhost", host: "V. natriegens", familyId: "inducible_regulated_expression" },
  { templateId: "bsub_secretion", host: "B. subtilis", familyId: "secretion" },
  { templateId: "bsub_delnorte", host: "B. subtilis", familyId: "inducible_regulated_expression" },
];

const eligiblePool = partsDoc.parts.filter(p => p.type === "cds" && p.evidence === "verified" && p.seq);
const sample = eligiblePool.filter((_, i) => i % SAMPLE_STRIDE === 0);

function templateGuidedBaseline(template, anchorPart) {
  const plan = design(template, partsById, anchorPart);
  return {
    buildable: plan.buildable,
    gaps: plan.gaps.length,
    placeholders: plan.placeholders.length,
    order: plan.order.length,
    totalSlots: template.slots.length,
    completeness: template.slots.length ? +(plan.order.length / template.slots.length).toFixed(3) : null,
    siteConflicts: plan.siteConflicts.length,
    assemblyFeasible: plan.siteConflicts.length === 0,
    alternativesConsidered: 1, // Template-Guided Mode never generates alternatives -- the user chose this one template
    architectureEvidence: null, // not a concept Template-Guided Mode has at all
    registrySupportAvailable: false, // Template-Guided Mode has no Registry integration
    userInterventionRequired: true, // the user must pick a template/backbone -- that IS Template-Guided Mode
    totalLength: plan.totalLength,
  };
}

function automaticBaseline(host, familyId, anchorPart) {
  const result = runAutomaticDesign({ partId: anchorPart.id, host, goalFamily: familyId, partsById, templates, registryCache: registryCacheDoc, maxCandidates: 6, robustnessTrials: ROBUSTNESS_TRIALS });
  if (!result.ok || !result.recommended) {
    return { buildable: false, gaps: null, placeholders: null, order: null, totalSlots: null, completeness: null, siteConflicts: null, assemblyFeasible: false, alternativesConsidered: 0, architectureEvidence: null, registrySupportAvailable: false, userInterventionRequired: false, totalLength: null, noRecommendation: true };
  }
  const scoredRec = result.scoring.ranked.find(r => r.candidateId === result.recommended.candidateId);
  return {
    buildable: result.recommended.validation.valid,
    gaps: result.recommended.plan.gaps.length,
    placeholders: result.recommended.plan.placeholders.length,
    order: result.recommended.plan.order.length,
    totalSlots: result.recommended.originalTemplate ? result.recommended.originalTemplate.slots.length : result.recommended.plan.order.length,
    completeness: scoredRec.breakdown.functionalCompleteness,
    siteConflicts: result.recommended.assemblyPlan ? result.recommended.assemblyPlan.conflicts.length : null,
    assemblyFeasible: result.recommended.assemblyPlan ? result.recommended.assemblyPlan.feasible : null,
    alternativesConsidered: result.candidates.valid.length,
    architectureEvidence: scoredRec.breakdown.architectureEvidence,
    registrySupportAvailable: Array.isArray(scoredRec.registryComparison) && scoredRec.registryComparison.length > 0,
    userInterventionRequired: false, // host + goal family only -- no template/backbone named
    totalLength: result.recommended.plan.totalLength,
    overallScore: scoredRec.overallScore,
    paretoOptimal: scoredRec.paretoOptimal,
  };
}

/** Mechanical verdict -- buildability first (a construct that can't be built
 * is worse than one that can, full stop), then completeness, then assembly
 * feasibility as tie-breakers. Never a subjective call. */
function verdict(tg, auto) {
  if (tg.buildable !== auto.buildable) return auto.buildable ? "automatic_better" : "template_guided_better";
  if (!tg.buildable && !auto.buildable) return "equal"; // both fail to build -- neither wins
  const tgCompleteness = tg.completeness ?? 0, autoCompleteness = auto.completeness ?? 0;
  if (Math.abs(tgCompleteness - autoCompleteness) > 0.001) return autoCompleteness > tgCompleteness ? "automatic_better" : "template_guided_better";
  if (tg.assemblyFeasible !== auto.assemblyFeasible) return auto.assemblyFeasible ? "automatic_better" : "template_guided_better";
  return "equal";
}

console.log("=".repeat(78));
console.log("TEMPLATE-GUIDED VS AUTOMATIC BASELINE (Phase 5A, item 4)");
console.log("=".repeat(78));
console.log(`${sample.length} sampled anchors x ${PAIRINGS.length} template/host/family pairings = ${sample.length * PAIRINGS.length} comparisons`);
console.log();

const records = [];
const t0 = Date.now();
for (const { templateId, host, familyId } of PAIRINGS) {
  const template = templatesById[templateId];
  for (const anchor of sample) {
    const tg = templateGuidedBaseline(template, anchor);
    const auto = automaticBaseline(host, familyId, anchor);
    records.push({ templateId, host, familyId, anchorId: anchor.id, anchorName: anchor.name, templateGuided: tg, automatic: auto, verdict: verdict(tg, auto) });
  }
}
const elapsedMs = Date.now() - t0;

const verdictCounts = { automatic_better: 0, equal: 0, template_guided_better: 0 };
for (const r of records) verdictCounts[r.verdict]++;

const tgBuildableRate = +(records.filter(r => r.templateGuided.buildable).length / records.length).toFixed(4);
const autoBuildableRate = +(records.filter(r => r.automatic.buildable).length / records.length).toFixed(4);
const meanAlternativesAuto = +(records.reduce((s, r) => s + r.automatic.alternativesConsidered, 0) / records.length).toFixed(2);
const autoRegistryRate = +(records.filter(r => r.automatic.registrySupportAvailable).length / records.length).toFixed(4);

console.log(`Completed ${records.length} comparisons in ${elapsedMs} ms.`);
console.log();
console.log("--- Buildability (the most basic, objective comparison) ---");
console.log(`  Template-Guided buildable rate: ${tgBuildableRate}`);
console.log(`  Automatic buildable (top-1) rate: ${autoBuildableRate}`);
console.log();
console.log("--- Other measured differences ---");
console.log(`  mean alternatives considered by Automatic: ${meanAlternativesAuto} (Template-Guided always considers exactly 1 -- the template the user picked)`);
console.log(`  Automatic Registry-comparison-available rate: ${autoRegistryRate} (Template-Guided Mode has no Registry integration at all: 0)`);
console.log(`  user template/backbone choice required: Template-Guided ALWAYS; Automatic NEVER`);
console.log();
console.log("--- Verdict distribution (mechanical: buildability > completeness > assembly feasibility) ---");
console.log(`  automatic_better:       ${verdictCounts.automatic_better} / ${records.length}`);
console.log(`  equal:                  ${verdictCounts.equal} / ${records.length}`);
console.log(`  template_guided_better: ${verdictCounts.template_guided_better} / ${records.length}`);
if (verdictCounts.template_guided_better > 0) {
  console.log(`\n  NOTE: ${verdictCounts.template_guided_better} case(s) where Template-Guided did AS WELL OR BETTER -- see template_vs_automatic.json's templateGuidedBetterOrEqualRecords for exactly which, not hidden.`);
}

const templateGuidedBetterOrEqualRecords = records.filter(r => r.verdict !== "automatic_better");
const perTemplateBreakdown = {};
for (const { templateId } of PAIRINGS) {
  const subset = records.filter(r => r.templateId === templateId);
  perTemplateBreakdown[templateId] = {
    n: subset.length,
    templateGuidedBuildableRate: +(subset.filter(r => r.templateGuided.buildable).length / subset.length).toFixed(4),
    automaticBuildableRate: +(subset.filter(r => r.automatic.buildable).length / subset.length).toFixed(4),
    verdicts: { automatic_better: subset.filter(r => r.verdict === "automatic_better").length, equal: subset.filter(r => r.verdict === "equal").length, template_guided_better: subset.filter(r => r.verdict === "template_guided_better").length },
  };
}
console.log();
console.log("--- Per-template breakdown ---");
for (const [id, b] of Object.entries(perTemplateBreakdown)) console.log(`  ${id}: TG buildable ${b.templateGuidedBuildableRate}, Automatic buildable ${b.automaticBuildableRate}, verdicts ${JSON.stringify(b.verdicts)}`);

mkdirSync(path.join(__dirname, "results"), { recursive: true });
const outPath = path.join(__dirname, "results", "template_vs_automatic.json");
writeFileSync(outPath, JSON.stringify({
  meta: { title: "Template-Guided vs Automatic Baseline (Phase 5A, item 4)", generatedAt: new Date().toISOString(), robustnessTrialsUsed: ROBUSTNESS_TRIALS, sampleStride: SAMPLE_STRIDE, sampleSize: sample.length, pairings: PAIRINGS, totalComparisons: records.length, elapsedMs },
  summary: { tgBuildableRate, autoBuildableRate, meanAlternativesAuto, autoRegistryRate, verdictCounts, perTemplateBreakdown },
  templateGuidedBetterOrEqualRecords,
  allRecords: records,
}, null, 2));
console.log(`\nWrote ${path.relative(REPO_ROOT, outPath)}`);
