// Phase 5A, item 2: LEAVE-ONE-OUT RAW-DNA CHALLENGE.
//
// Directly tests the Discord requirement's "a DNA sequence" half (as opposed
// to "a biological part", already exhaustively covered by
// catalog_part_challenge.mjs): "Can an arbitrary DNA sequence be provided and
// have a plasmid constructed around it?"
//
// For a defensible, deterministic, representative SUBSET of real, verified,
// sequenced CDS records (systematic sampling, stride 8, over the full
// evidence:verified CDS population -- not hand-picked, not random-without-a-seed):
//   1. remove that exact part id from the partsById passed into the pipeline
//      (so its real sequence is genuinely unrecognized by the run -- the SAME
//      technique tests/rawDnaDiscordAcceptance.test.mjs and Phase 4C's own
//      case study use; no sequence is ever fabricated, every base is read
//      live from data/parts.json);
//   2. submit ONLY its real sequence via `text`, role:"cds", a real host, a
//      real supported architecture family -- no partId, no template/backbone;
//   3. confirm characterizeInput() actually treated it as "novel_sequence"
//      (a collision with some OTHER real catalog part would invalidate the
//      test for that specific case -- reported honestly, not silently skipped);
//   4. run the exact same (host, family) combination in normal catalog-known
//      mode (partId, full catalog) for direct comparison, per the task's
//      explicit "whether generation differs materially" requirement.
//
// Usage: node benchmark/leave_one_out_challenge.mjs

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
const fullPartsById = {};
for (const p of partsDoc.parts) fullPartsById[p.id] = p;
const templates = templatesDoc.templates;

const ROBUSTNESS_TRIALS = 200;
const SAMPLE_STRIDE = 8; // deterministic systematic sample -- every 8th eligible part, not hand-picked

const HOSTS = [...new Set(templates.map(t => t.host))];
const HOST_FAMILY_PAIRS = [];
for (const host of HOSTS) {
  for (const family of getSupportedFamiliesForHost(host)) HOST_FAMILY_PAIRS.push({ host, familyId: family.id });
}

const eligiblePool = partsDoc.parts.filter(p => p.type === "cds" && p.evidence === "verified" && p.seq);
const sample = eligiblePool.filter((_, i) => i % SAMPLE_STRIDE === 0);

console.log("=".repeat(78));
console.log("LEAVE-ONE-OUT RAW-DNA CHALLENGE (Phase 5A, item 2)");
console.log("=".repeat(78));
console.log(`${eligiblePool.length} eligible verified/sequenced CDS records; systematic sample (stride ${SAMPLE_STRIDE}) = ${sample.length} parts x ${HOST_FAMILY_PAIRS.length} host/family combos x 2 modes (raw-DNA held-out, catalog-known) = ${sample.length * HOST_FAMILY_PAIRS.length * 2} runs`);
console.log();

const records = [];
let collisionCount = 0;
const t0 = Date.now();

for (const part of sample) {
  const partsById = Object.fromEntries(Object.entries(fullPartsById).filter(([id]) => id !== part.id));
  // Collision guard: does this part's sequence coincidentally exactly-match or
  // substring-match some OTHER real catalog part? (findBySequence checks both
  // directions.) If so, this specific case cannot test "novel_sequence" honestly.
  const collision = Object.values(partsById).find(p => p.seq && (p.seq.toUpperCase().includes(part.seq.toUpperCase()) || part.seq.toUpperCase().includes(p.seq.toUpperCase())));

  for (const { host, familyId } of HOST_FAMILY_PAIRS) {
    if (collision) {
      collisionCount++;
      records.push({ partId: part.id, partName: part.name, host, familyId, skipped: true, skipReason: `sequence collides with real catalog part "${collision.id}" -- cannot test as novel_sequence` });
      continue;
    }

    let rawResult, catalogResult;
    try {
      rawResult = runAutomaticDesign({ text: part.seq, role: "cds", host, goalFamily: familyId, partsById, templates, registryCache: registryCacheDoc, maxCandidates: 6, robustnessTrials: ROBUSTNESS_TRIALS });
    } catch (err) {
      records.push({ partId: part.id, partName: part.name, host, familyId, threw: true, error: err.message });
      continue;
    }
    try {
      catalogResult = runAutomaticDesign({ partId: part.id, host, goalFamily: familyId, partsById: fullPartsById, templates, registryCache: registryCacheDoc, maxCandidates: 6, robustnessTrials: ROBUSTNESS_TRIALS });
    } catch (err) {
      records.push({ partId: part.id, partName: part.name, host, familyId, threw: true, error: `catalog-mode comparison run threw: ${err.message}` });
      continue;
    }

    const treatedAsUserSupplied = rawResult.ok && rawResult.characterized.input.mode === "novel_sequence";
    const rawEval = evaluateRun(rawResult, { anchorRole: "cds", expectedAnchorId: null, expectedAnchorLength: part.length });
    const catalogEval = evaluateRun(catalogResult, { anchorRole: "cds", expectedAnchorId: part.id, expectedAnchorLength: part.length });

    // "Materially different" (item 2's explicit comparison ask): does the raw-DNA
    // path reach the same hard-valid/assembly-feasible/goal-compatible outcome as
    // normal catalog-known mode for the IDENTICAL (part, host, family)? A
    // difference is only expected when the anchor's own catalog evidence would
    // have mattered (it never does for a CDS anchor -- see provenanceModel.js --
    // so these should normally match).
    const materiallyDifferent = rawEval.hardValidGenerated !== catalogEval.hardValidGenerated
      || rawEval.assemblyFeasibleTop1 !== catalogEval.assemblyFeasibleTop1
      || rawEval.goalCompatibleRecommendation !== catalogEval.goalCompatibleRecommendation;

    records.push({
      partId: part.id, partName: part.name, host, familyId, threw: false, skipped: false,
      treatedAsUserSupplied,
      raw: rawEval,
      catalog: catalogEval,
      materiallyDifferent,
    });
  }
}
const elapsedMs = Date.now() - t0;

const attempted = records.filter(r => !r.skipped && !r.threw);
const threwRecords = records.filter(r => r.threw);
const skippedRecords = records.filter(r => r.skipped);
const notTreatedAsUserSupplied = attempted.filter(r => !r.treatedAsUserSupplied);
const materiallyDifferentRecords = attempted.filter(r => r.materiallyDifferent);

const rawSummary = summarizeRuns(attempted.map(r => r.raw));
const catalogSummary = summarizeRuns(attempted.map(r => r.catalog));

console.log(`Completed ${records.length} run-pairs in ${elapsedMs} ms (${collisionCount} skipped as sequence collisions).`);
console.log();
console.log("--- Raw-DNA (held-out, user_supplied) mode ---");
console.log(`  architecture-generation success rate: ${rawSummary.architectureGenerationRate}`);
console.log(`  hard-valid success rate:              ${rawSummary.hardValidRate}`);
console.log(`  anchor preservation rate:              ${rawSummary.anchorPreservationRate}`);
console.log(`  goal-compatible recommendation rate:   ${rawSummary.goalCompatibleRecommendationRate}`);
console.log(`  assembly-feasible top-1 rate:          ${rawSummary.assemblyFeasibleTop1Rate}`);
console.log(`  treated as novel_sequence (user_supplied): ${attempted.length - notTreatedAsUserSupplied.length}/${attempted.length}`);
console.log();
console.log("--- Catalog-known (partId, full catalog) mode, SAME (part,host,family) pairs ---");
console.log(`  hard-valid success rate: ${catalogSummary.hardValidRate}`);
console.log(`  assembly-feasible top-1 rate: ${catalogSummary.assemblyFeasibleTop1Rate}`);
console.log();
console.log(`Materially different outcome between raw-DNA and catalog-known modes: ${materiallyDifferentRecords.length}/${attempted.length}`);
if (materiallyDifferentRecords.length) {
  console.log("  (see leave_one_out_challenge.json's materiallyDifferentRecords for exactly which ones and why)");
}
console.log();
console.log(threwRecords.length ? `!!! ${threwRecords.length} run(s) THREW an exception.` : "No run threw an exception.");
console.log(notTreatedAsUserSupplied.length ? `!!! ${notTreatedAsUserSupplied.length} run(s) were NOT treated as novel_sequence despite the held-out setup.` : "Every non-collision run was correctly treated as novel_sequence/user_supplied.");

mkdirSync(path.join(__dirname, "results"), { recursive: true });
const outPath = path.join(__dirname, "results", "leave_one_out_challenge.json");
writeFileSync(outPath, JSON.stringify({
  meta: {
    title: "Leave-One-Out Raw-DNA Challenge (Phase 5A, item 2)",
    generatedAt: new Date().toISOString(),
    robustnessTrialsUsed: ROBUSTNESS_TRIALS,
    sampleStride: SAMPLE_STRIDE,
    eligiblePoolSize: eligiblePool.length,
    sampleSize: sample.length,
    hostFamilyPairsTested: HOST_FAMILY_PAIRS,
    totalRunPairs: records.length,
    collisionCount,
    elapsedMs,
  },
  rawSummary,
  catalogSummary,
  materiallyDifferentRecords,
  notTreatedAsUserSupplied,
  threwRecords,
  skippedRecords,
  allRecords: records,
}, null, 2));
console.log(`\nWrote ${path.relative(REPO_ROOT, outPath)}`);
