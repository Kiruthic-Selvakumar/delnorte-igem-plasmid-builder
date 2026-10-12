// Phase 5A, item 1: CATALOG-WIDE PART CHALLENGE.
//
// Tests whether Automatic Design Mode generalizes beyond the handful of
// anchors used during development, by running the FULL pipeline for EVERY
// real CDS in data/parts.json against EVERY host/architecture-family
// combination that is actually supported for that host (via
// getSupportedFamiliesForHost() -- the same, real, already-vetted support
// table the engine itself uses; an unsupported combination is never attempted
// in the first place, so it can never be miscounted as a failure).
//
// No template/backbone is ever supplied -- every run is partId + host +
// goalFamily only, exactly the Discord-requirement shape.
//
// robustnessTrials is reduced from the default 1000 to 200 PURELY for sweep
// speed across ~6000 runs (see the benchmark below) -- this changes the
// PRECISION of the stability estimate, not its meaning; 200 trials is still
// far more than enough to distinguish "highly stable" from "sensitive to
// scoring weights" for reporting purposes here. No other engine behavior is
// altered to produce this benchmark.
//
// Usage: node benchmark/catalog_part_challenge.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { runAutomaticDesign, getSupportedFamiliesForHost } from "../automatic/index.js";
import { evaluateRun, summarizeRuns } from "./lib/evaluationHelpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const partsDoc = JSON.parse(readFileSync(path.join(REPO_ROOT, "data", "parts.json"), "utf-8"));
const templatesDoc = JSON.parse(readFileSync(path.join(REPO_ROOT, "data", "templates.json"), "utf-8"));
const registryCacheDoc = JSON.parse(readFileSync(path.join(REPO_ROOT, "data", "registry_cache.json"), "utf-8"));
const partsById = {};
for (const p of partsDoc.parts) partsById[p.id] = p;
const templates = templatesDoc.templates;

const ROBUSTNESS_TRIALS = 200;

// Every host this project's own template data documents, paired with every
// architecture family ACTUALLY supported for that host -- both real,
// already-computed facts, never guessed here.
const HOSTS = [...new Set(templates.map(t => t.host))];
const HOST_FAMILY_PAIRS = [];
for (const host of HOSTS) {
  for (const family of getSupportedFamiliesForHost(host)) {
    HOST_FAMILY_PAIRS.push({ host, familyId: family.id, familyLabel: family.label });
  }
}

// "Eligible as an Automatic Design anchor" (item 1) for a CDS: every real CDS
// record in the catalog, evidence:verified or not -- placeholder-evidence
// CDS anchors are DELIBERATELY included (not filtered out) so the sweep also
// honestly captures the "anchor itself is unresolved" failure mode, rather
// than only ever testing the easy cases.
const eligibleCdsParts = partsDoc.parts.filter(p => p.type === "cds");

console.log("=".repeat(78));
console.log("CATALOG-WIDE PART CHALLENGE (Phase 5A, item 1)");
console.log("=".repeat(78));
console.log(`${eligibleCdsParts.length} eligible CDS anchors x ${HOST_FAMILY_PAIRS.length} supported host/family combinations = ${eligibleCdsParts.length * HOST_FAMILY_PAIRS.length} runs`);
console.log(`Host/family combinations tested: ${HOST_FAMILY_PAIRS.map(p => `${p.host}/${p.familyId}`).join(", ")}`);
console.log();

const records = [];
const t0 = Date.now();
for (const part of eligibleCdsParts) {
  for (const { host, familyId, familyLabel } of HOST_FAMILY_PAIRS) {
    let result, threw = false, error = null;
    try {
      result = runAutomaticDesign({
        partId: part.id, host, goalFamily: familyId,
        partsById, templates, registryCache: registryCacheDoc,
        maxCandidates: 6, robustnessTrials: ROBUSTNESS_TRIALS,
      });
    } catch (err) {
      threw = true; error = err.message;
    }
    if (threw) {
      records.push({ partId: part.id, partName: part.name, partEvidence: part.evidence, host, familyId, familyLabel, threw: true, error, failureCategory: "other" });
      continue;
    }
    const evalRec = evaluateRun(result, { anchorRole: "cds", expectedAnchorId: part.id, expectedAnchorLength: part.length });
    records.push({ partId: part.id, partName: part.name, partEvidence: part.evidence, host, familyId, familyLabel, threw: false, ...evalRec });
  }
}
const elapsedMs = Date.now() - t0;

const summary = summarizeRuns(records);
const threwRecords = records.filter(r => r.threw);
const failedRecords = records.filter(r => !r.threw && r.failureCategory);
const anchorMismatches = records.filter(r => !r.threw && !r.anchorPreserved);

console.log(`Completed ${records.length} runs in ${elapsedMs} ms (${(elapsedMs / records.length).toFixed(2)} ms/run average).`);
console.log();
console.log("--- Aggregate metrics (fractions of ALL attempted runs) ---");
console.log(`  architecture generation rate: ${summary.architectureGenerationRate}`);
console.log(`  hard-valid rate:              ${summary.hardValidRate}`);
console.log(`  anchor preservation rate:     ${summary.anchorPreservationRate}`);
console.log(`  goal-compatible recommendation rate: ${summary.goalCompatibleRecommendationRate}`);
console.log(`  assembly-feasible top-1 rate: ${summary.assemblyFeasibleTop1Rate}`);
console.log(`  Registry comparison available rate: ${summary.registryComparisonAvailableRate}`);
console.log();
console.log("--- Failure categories (count) ---");
for (const [cat, count] of Object.entries(summary.failureCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${cat}: ${count}`);
}
if (Object.keys(summary.failureCounts).length === 0) console.log("  (none -- every attempted combination produced at least one hard-valid candidate)");
console.log();
if (threwRecords.length) {
  console.log(`!!! ${threwRecords.length} run(s) THREW an exception (crash, not a modeled failure) -- see catalog_part_challenge.json's "threw" records.`);
} else {
  console.log("No run threw an exception.");
}
console.log(anchorMismatches.length ? `!!! ${anchorMismatches.length} run(s) FAILED anchor preservation -- see catalog_part_challenge.json.` : "Anchor preservation held in every single run.");

mkdirSync(path.join(__dirname, "results"), { recursive: true });
const outPath = path.join(__dirname, "results", "catalog_part_challenge.json");
writeFileSync(outPath, JSON.stringify({
  meta: {
    title: "Catalog-Wide Part Challenge (Phase 5A, item 1)",
    generatedAt: new Date().toISOString(),
    robustnessTrialsUsed: ROBUSTNESS_TRIALS,
    hostFamilyPairsTested: HOST_FAMILY_PAIRS,
    totalEligibleCdsAnchors: eligibleCdsParts.length,
    totalRuns: records.length,
    elapsedMs,
  },
  summary,
  failedRecords, // only the interesting ones -- full record list is large but reproducible from this script
  threwRecords,
  anchorMismatches,
  // Full per-run records included too, for anyone who wants to slice the data differently --
  // this is a benchmark artifact, not something re-parsed by the engine itself.
  allRecords: records,
}, null, 2));
console.log(`\nWrote ${path.relative(REPO_ROOT, outPath)}`);
