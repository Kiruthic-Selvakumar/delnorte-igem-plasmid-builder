// Phase 5B, item 12: CUSTOM PART ROLE-GENERALIZATION CHALLENGE.
//
// Extends (does not replace) Phase 5A's catalog_part_challenge.mjs: instead
// of testing only CDS anchors supplied by partId, this sweeps a real, held-
// out sequence for EVERY one of the 10 supported roles, registers it through
// automatic/customPartRegistry.js under a fake external-team name (never
// partId, never a catalog lookup), and runs it through runAutomaticDesign()
// against every host/goal-family combination that host actually supports.
//
// For each role that needs a companion CDS to be well-posed (see
// designGrammar.js's "<role>-requires-cds-target" rules, Phase 5B item 4),
// each combination is run TWICE: once with no additional context (expected
// to honestly ask for one) and once with a real, verified catalog CDS
// (sg_GFP) locked alongside it (expected to produce a complete design where
// the host/family combination permits it) -- this is what lets this
// benchmark report a meaningful "complete-design rate by role" rather than
// only ever observing the "needs context" branch.
//
// Outcome categories (fixed, per the Phase 5B spec):
//   complete_design            -- >=1 hard-valid candidate was produced
//   additional_context_required -- stage:"needsUserChoice", a real missing role was named
//   hard_rejected               -- a design was attempted but produced zero hard-valid
//                                  candidates (host incompatibility, dependency gaps, etc.)
//   unsupported_role_behavior   -- stage:"needsUserChoice" with requiredRole:null
//                                  (operator/other -- no design-grammar equivalent at all)
//   exception                   -- the call itself threw
//
// Usage: node benchmark/custom_part_role_challenge.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { runAutomaticDesign, createCustomPartRegistry, getSupportedFamiliesForHost, classifyProvenance } from "../automatic/index.js";
import { classifyFailure } from "./lib/evaluationHelpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const partsDoc = JSON.parse(readFileSync(path.join(REPO_ROOT, "data", "parts.json"), "utf-8"));
const templatesDoc = JSON.parse(readFileSync(path.join(REPO_ROOT, "data", "templates.json"), "utf-8"));
const registryCacheDoc = JSON.parse(readFileSync(path.join(REPO_ROOT, "data", "registry_cache.json"), "utf-8"));
const fullPartsById = {};
for (const p of partsDoc.parts) fullPartsById[p.id] = p;
const templates = templatesDoc.templates;

const HOSTS = [...new Set(templates.map(t => t.host))];
const HOST_FAMILY_PAIRS = [];
for (const host of HOSTS) {
  for (const family of getSupportedFamiliesForHost(host)) HOST_FAMILY_PAIRS.push({ host, familyId: family.id });
}

const LOCKED_CDS_ID = "sg_GFP";
const ROBUSTNESS_TRIALS = 200;

// Roles this project's design grammar defines a companion-CDS requirement
// for (Phase 5B item 4, roles B-E) plus F-H (origin/marker/orit), which the
// investigation in index.js's runAutomaticDesign shows transitively need one
// too (their own required-role set always pulls in "promoter"). Read
// directly here as a fixed list matching ROLE_CASES' own real behavior,
// documented rather than re-derived, since this file is a benchmark/report,
// not engine logic.
const NEEDS_CDS_PARTNER = ["promoter", "rbs", "terminator", "signal", "marker", "origin", "orit"];
const NOT_MODELED = ["operator", "other"];

// One systematic (deterministic, non-random) sample of real, resolved-
// sequence catalog parts per role -- large enough to see real variety, small
// enough to keep total runtime bounded. Stride chosen per role so every role
// contributes roughly 8-14 samples regardless of how many real parts that
// role has in the catalog.
function sampleForRole(role, targetCount) {
  const pool = partsDoc.parts.filter(p => p.type === role && p.seq && p.seq.length > 0);
  const stride = Math.max(1, Math.floor(pool.length / targetCount));
  return pool.filter((_, i) => i % stride === 0);
}

const ROLE_SAMPLES = {};
for (const role of [...NEEDS_CDS_PARTNER, "cds", ...NOT_MODELED]) {
  ROLE_SAMPLES[role] = sampleForRole(role, 12);
}

function classifyOutcome(result) {
  if (result.stage === "needsUserChoice") {
    return result.needsUserChoice.requiredRole === null ? "unsupported_role_behavior" : "additional_context_required";
  }
  if (result.ok && result.candidates.valid.length > 0) return "complete_design";
  return "hard_rejected";
}

function runOne({ role, part, host, familyId, withCdsPartner }) {
  // Hold the real part out of partsById entirely -- reachable only via the
  // customPart registration path, exactly simulating an external team's part.
  const partsById = Object.fromEntries(Object.entries(fullPartsById).filter(([id]) => id !== part.id));
  const registry = createCustomPartRegistry();
  const reg = registry.registerCustomPart({ name: `RoleChallenge_${role}_${part.id}`, seq: part.seq, role, sourceTeam: "RoleChallengeBenchmark" });

  const record = {
    role, partId: part.id, partName: part.name, host, familyId, withCdsPartner,
    registrationSuccess: reg.ok,
  };
  if (!reg.ok) { record.outcome = "hard_rejected"; record.registrationErrors = reg.errors; return record; }

  record.provenance = classifyProvenance(reg.part);

  const opts = { customPart: reg.part, host, goalFamily: familyId, partsById, templates, registryCache: registryCacheDoc, maxCandidates: 6, beamWidth: 5, robustnessTrials: ROBUSTNESS_TRIALS };
  if (withCdsPartner) opts.additionalLockedComponents = [{ role: "cds", partId: LOCKED_CDS_ID }];

  let result, threw = false, error = null;
  try { result = runAutomaticDesign(opts); } catch (err) { threw = true; error = err.message; }

  if (threw) {
    record.outcome = "exception";
    record.error = error;
    return record;
  }

  record.outcome = classifyOutcome(result);
  record.anchorPreserved = result.characterized?.input?.anchorPart?.id === reg.part.id;
  if (record.outcome === "complete_design") {
    record.validCandidateCount = result.candidates.valid.length;
    record.assemblyFeasibleTop1 = !!(result.recommended && result.recommended.assemblyPlan && result.recommended.assemblyPlan.feasible);
    record.registryComparisonAvailable = !!(result.scoring.ranked.find(r => r.candidateId === result.recommended?.candidateId)?.registryComparison?.length);
  } else if (record.outcome === "hard_rejected") {
    record.failureCategory = classifyFailure(result);
    record.documentedHostViolation = result.ok
      ? result.candidates.invalid.some(c => c.validation.reasons.some(r => r.includes("host-ineligible")))
      : false;
  } else if (record.outcome === "additional_context_required") {
    record.requiredRole = result.needsUserChoice.requiredRole;
  }
  return record;
}

console.log("=".repeat(78));
console.log("CUSTOM PART ROLE-GENERALIZATION CHALLENGE (Phase 5B, item 12)");
console.log("=".repeat(78));

const records = [];
const t0 = Date.now();
for (const role of Object.keys(ROLE_SAMPLES)) {
  for (const part of ROLE_SAMPLES[role]) {
    for (const { host, familyId } of HOST_FAMILY_PAIRS) {
      if (NOT_MODELED.includes(role)) {
        records.push(runOne({ role, part, host, familyId, withCdsPartner: false }));
      } else if (NEEDS_CDS_PARTNER.includes(role)) {
        records.push(runOne({ role, part, host, familyId, withCdsPartner: false }));
        records.push(runOne({ role, part, host, familyId, withCdsPartner: true }));
      } else {
        // cds anchors are already well-posed alone (unchanged Phase 4A/4B behavior).
        records.push(runOne({ role, part, host, familyId, withCdsPartner: false }));
      }
    }
  }
}
const elapsedMs = Date.now() - t0;

const registrationSuccessRate = +(records.filter(r => r.registrationSuccess).length / records.length).toFixed(4);
const anchorPreservedRecords = records.filter(r => r.registrationSuccess && r.outcome !== "exception");
const anchorPreservationRate = anchorPreservedRecords.length
  ? +(anchorPreservedRecords.filter(r => r.anchorPreserved).length / anchorPreservedRecords.length).toFixed(4)
  : null;
const exceptionRate = +(records.filter(r => r.outcome === "exception").length / records.length).toFixed(4);

const byRole = {};
for (const role of Object.keys(ROLE_SAMPLES)) {
  const roleRecords = records.filter(r => r.role === role);
  const completeRecords = roleRecords.filter(r => r.outcome === "complete_design");
  const contextRecords = roleRecords.filter(r => r.outcome === "additional_context_required");
  const hardRejectedRecords = roleRecords.filter(r => r.outcome === "hard_rejected");
  byRole[role] = {
    totalRuns: roleRecords.length,
    completeDesignRate: +(completeRecords.length / roleRecords.length).toFixed(4),
    contextRequestRate: +(contextRecords.length / roleRecords.length).toFixed(4),
    hardRejectedRate: +(hardRejectedRecords.length / roleRecords.length).toFixed(4),
    unsupportedRoleBehaviorRate: +(roleRecords.filter(r => r.outcome === "unsupported_role_behavior").length / roleRecords.length).toFixed(4),
    documentedHostViolationRate: hardRejectedRecords.length
      ? +(hardRejectedRecords.filter(r => r.documentedHostViolation).length / hardRejectedRecords.length).toFixed(4)
      : null,
    assemblyFeasibleTop1Rate: completeRecords.length
      ? +(completeRecords.filter(r => r.assemblyFeasibleTop1).length / completeRecords.length).toFixed(4)
      : null,
    registryComparisonAvailableRate: completeRecords.length
      ? +(completeRecords.filter(r => r.registryComparisonAvailable).length / completeRecords.length).toFixed(4)
      : null,
  };
}

// "Unjustified rejection rate": a hard_rejected record whose failureCategory
// is NOT one of the real, evidence-backed categories evaluationHelpers.js
// already knows how to name (i.e. classifyFailure fell back to a vague
// catch-all with no documented cause) -- per item 12, a legitimate
// additional-context request is NEVER counted as a rejection at all here,
// so this only ever looks at the hard_rejected bucket.
const JUSTIFIED_CATEGORIES = ["insufficient host evidence", "placeholder/missing sequence", "unresolved dependency", "no eligible component for required role", "assembly conflict"];
const hardRejectedAll = records.filter(r => r.outcome === "hard_rejected");
const unjustifiedRejections = hardRejectedAll.filter(r => !JUSTIFIED_CATEGORIES.includes(r.failureCategory));
const unjustifiedRejectionRate = hardRejectedAll.length ? +(unjustifiedRejections.length / hardRejectedAll.length).toFixed(4) : null;

console.log(`${records.length} runs across ${Object.keys(ROLE_SAMPLES).length} roles x ${HOST_FAMILY_PAIRS.length} host/family combinations, completed in ${elapsedMs} ms.`);
console.log();
console.log("--- Overall metrics ---");
console.log(`  registration success rate: ${registrationSuccessRate}`);
console.log(`  anchor preservation rate:  ${anchorPreservationRate}`);
console.log(`  exception rate:            ${exceptionRate}`);
console.log(`  unjustified rejection rate (of hard_rejected only): ${unjustifiedRejectionRate}`);
console.log();
console.log("--- Per-role breakdown ---");
for (const [role, m] of Object.entries(byRole)) {
  console.log(`  ${role.padEnd(11)} runs=${m.totalRuns} complete=${m.completeDesignRate} context=${m.contextRequestRate} hardRejected=${m.hardRejectedRate} unsupportedRoleBehavior=${m.unsupportedRoleBehaviorRate}` +
    ` hostViolation=${m.documentedHostViolationRate ?? "n/a"} assemblyFeasible=${m.assemblyFeasibleTop1Rate ?? "n/a"} registryCompare=${m.registryComparisonAvailableRate ?? "n/a"}`);
}
console.log();
const exceptions = records.filter(r => r.outcome === "exception");
console.log(exceptions.length ? `!!! ${exceptions.length} run(s) THREW an exception -- see custom_part_role_challenge.json's "exceptions" records.` : "No run threw an exception.");
const anchorMismatches = anchorPreservedRecords.filter(r => !r.anchorPreserved);
console.log(anchorMismatches.length ? `!!! ${anchorMismatches.length} run(s) FAILED anchor preservation.` : "Anchor preservation held in every single run.");
const regFailures = records.filter(r => !r.registrationSuccess);
console.log(regFailures.length ? `!!! ${regFailures.length} registration(s) FAILED -- see custom_part_role_challenge.json's "registrationFailures".` : "Every registration attempt succeeded.");

mkdirSync(path.join(__dirname, "results"), { recursive: true });
const outPath = path.join(__dirname, "results", "custom_part_role_challenge.json");
writeFileSync(outPath, JSON.stringify({
  meta: {
    title: "Custom Part Role-Generalization Challenge (Phase 5B, item 12)",
    generatedAt: new Date().toISOString(),
    robustnessTrialsUsed: ROBUSTNESS_TRIALS,
    hostFamilyPairsTested: HOST_FAMILY_PAIRS,
    rolesTested: Object.keys(ROLE_SAMPLES),
    samplesPerRole: Object.fromEntries(Object.entries(ROLE_SAMPLES).map(([r, arr]) => [r, arr.length])),
    totalRuns: records.length,
    elapsedMs,
  },
  overall: { registrationSuccessRate, anchorPreservationRate, exceptionRate, unjustifiedRejectionRate },
  byRole,
  exceptions,
  anchorMismatches,
  registrationFailures: regFailures,
  allRecords: records,
}, null, 2));
console.log(`\nWrote ${path.relative(REPO_ROOT, outPath)}`);
