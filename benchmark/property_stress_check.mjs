// Phase 5A, item 3: RANDOMIZED / PROPERTY-BASED STRESS TEST.
//
// Samples many random, but always REAL and always VALID, input configurations
// (a real catalog CDS anchor, a real host, an architecture family actually
// supported for that host, a supported assembly method) using a small, fixed,
// deterministic seeded PRNG (mulberry32 -- the same algorithm
// automatic/robustness.js already uses, reimplemented locally here rather
// than exported from that module, since it is a private implementation
// detail there), and checks a fixed list of invariants that must NEVER fail,
// across every single trial. This is NOT a fuzzer looking for crashes (though
// any thrown exception is also recorded as a failure) -- it is checking
// specific, named CORRECTNESS properties this project has already committed
// to (Phase 4C/4C.1's hard-validation and goal-compatibility rules).
//
// Usage: node benchmark/property_stress_check.mjs [--trials=500]
//
// Named "..._check.mjs", not "..._test.mjs": Node's test runner (node --test)
// auto-discovers any file ending in "_test.mjs"/"-test.mjs"/".test.mjs" as a
// test file -- this script has no describe()/test() blocks of its own (it IS
// the thing being run, not a unit test), and running it as an implicit test
// under `node --test` accidentally added ~2000 real design-generation trials
// (tens of seconds) to every canonical test-suite run. Renamed to keep
// `node --test` fast and correctly scoped to tests/*.test.mjs only -- this
// was caught and fixed during this same phase, see the Phase 5A report.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { runAutomaticDesign, getSupportedFamiliesForHost, computePlasmidMapSegments, classifyProvenance, SUPPORTED_ASSEMBLY_METHODS } from "../automatic/index.js";
import { checkHostEligibility, buildDocumentedHostsIndex } from "../automatic/constraintEngine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const partsDoc = JSON.parse(readFileSync(path.join(REPO_ROOT, "data", "parts.json"), "utf-8"));
const templatesDoc = JSON.parse(readFileSync(path.join(REPO_ROOT, "data", "templates.json"), "utf-8"));
const registryCacheDoc = JSON.parse(readFileSync(path.join(REPO_ROOT, "data", "registry_cache.json"), "utf-8"));
const partsById = {};
for (const p of partsDoc.parts) partsById[p.id] = p;
const templates = templatesDoc.templates;
const documentedHostsIndex = buildDocumentedHostsIndex(templates);

const TRIALS = +(process.argv.find(a => a.startsWith("--trials="))?.split("=")[1]) || 2000;
const SEED = 20260910; // fixed, documented, reproducible
const DETERMINISM_RECHECK_STRIDE = 25; // re-run every Nth trial a second time to check ranking determinism, keeps the sweep fast

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const pick = arr => arr[Math.floor(rng() * arr.length)];

const eligibleCdsParts = partsDoc.parts.filter(p => p.type === "cds");
const HOSTS = [...new Set(templates.map(t => t.host))];

function sampleConfig() {
  const anchor = pick(eligibleCdsParts);
  const host = pick(HOSTS);
  const families = getSupportedFamiliesForHost(host);
  const family = pick(families);
  const assemblyMethod = pick(SUPPORTED_ASSEMBLY_METHODS);
  return { anchor, host, family, assemblyMethod };
}

// --- Properties -------------------------------------------------------------
// Each returns a violation STRING (falsy = property held) rather than
// throwing, so one trial's violation never aborts the sweep.

function checkLockedAnchorNeverChanges(result, anchor) {
  if (!result.ok) return null;
  for (const c of result.candidates.all) {
    const entry = c.plan.order.find(o => o.role === "cds");
    if (!entry || entry.id !== anchor.id || entry.length !== anchor.length) {
      return `candidate ${c.candidateId} has anchor entry ${JSON.stringify(entry)}, expected id=${anchor.id} length=${anchor.length}`;
    }
  }
  return null;
}

function checkRecommendedIsHardValid(result) {
  if (!result.ok || !result.recommended) return null;
  return result.recommended.validation.valid === true ? null : `recommended candidate ${result.recommended.candidateId} has validation.valid=false`;
}

function checkRecommendedIsGoalCompatible(result) {
  if (!result.ok || !result.recommended) return null;
  return result.recommended.goalCompatible !== false ? null : `recommended candidate ${result.recommended.candidateId} has goalCompatible=false`;
}

function checkNoHostIneligiblePartInAnyValidCandidate(result, host) {
  if (!result.ok) return null;
  for (const c of result.candidates.valid) {
    for (const o of c.plan.order) {
      if (!o.id) continue;
      const part = partsById[o.id] || (c.resolvedPartsById && c.resolvedPartsById[o.id]);
      if (!part) continue;
      const check = checkHostEligibility(part, host, documentedHostsIndex);
      if (!check.ok) return `valid candidate ${c.candidateId} contains host-ineligible part "${o.id}" (${check.status}): ${check.reason}`;
    }
  }
  return null;
}

function checkUnknownHostNeverTreatedAsIncompatible(anchor, host) {
  // Direct, pipeline-independent property check on checkHostEligibility itself:
  // status "unknown" must always carry ok:true, by construction.
  const r = checkHostEligibility(anchor, host, documentedHostsIndex);
  return (r.status === "unknown" && r.ok !== true) ? `checkHostEligibility returned status=unknown but ok=${r.ok} for part ${anchor.id}/${host}` : null;
}

function checkRegistryRecordedNeverBecomesProjectVerified(result) {
  if (!result.ok) return null;
  for (const c of result.candidates.all) {
    for (const o of c.plan.order) {
      if (!o.id) continue;
      const part = (c.resolvedPartsById && c.resolvedPartsById[o.id]) || partsById[o.id];
      if (!part || !part.registryProvenance) continue;
      const classification = classifyProvenance(part);
      if (classification.provenanceStatus !== "registry_recorded") {
        return `part "${o.id}" has registryProvenance but classifyProvenance() returned "${classification.provenanceStatus}", not "registry_recorded"`;
      }
    }
  }
  return null;
}

function checkNoPlaceholderPartInAnyValidCandidate(result) {
  if (!result.ok) return null;
  for (const c of result.candidates.valid) {
    for (const o of c.plan.order) {
      const part = o.id ? ((c.resolvedPartsById && c.resolvedPartsById[o.id]) || partsById[o.id]) : null;
      const classification = classifyProvenance(part);
      if (classification.provenanceStatus === "placeholder") return `valid candidate ${c.candidateId} contains placeholder-provenance part "${o.id}"`;
    }
  }
  return null;
}

function checkBpCoordinatesSumToTotalLength(result) {
  if (!result.ok || !result.recommended) return null;
  const scoredRec = result.scoring.ranked.find(r => r.candidateId === result.recommended.candidateId);
  const map = computePlasmidMapSegments(result.recommended, { partsById: { ...partsById, ...(result.recommended.resolvedPartsById || {}) }, anchorName: result.characterized.input.anchorPart.name, anchorPart: result.characterized.input.anchorPart, scored: scoredRec });
  if (!map.segments.length) return "no segments produced for a recommended candidate";
  if (map.segments[0].start !== 1) return `first segment starts at ${map.segments[0].start}, expected 1`;
  if (map.segments.at(-1).end !== map.totalBp) return `last segment ends at ${map.segments.at(-1).end}, totalBp is ${map.totalBp}`;
  for (let i = 1; i < map.segments.length; i++) {
    if (map.segments[i].start !== map.segments[i - 1].end + 1) return `segment ${i} starts at ${map.segments[i].start}, expected ${map.segments[i - 1].end + 1} (gap/overlap)`;
  }
  if (map.totalBp !== result.recommended.plan.totalLength) return `map.totalBp (${map.totalBp}) !== plan.totalLength (${result.recommended.plan.totalLength})`;
  return null;
}

function rankingSignature(result) {
  if (!result.ok) return null;
  return JSON.stringify(result.scoring.ranked.map(r => [r.candidateId, r.overallScore]));
}

// --- Main sweep --------------------------------------------------------------

console.log("=".repeat(78));
console.log("RANDOMIZED / PROPERTY-BASED STRESS TEST (Phase 5A, item 3)");
console.log("=".repeat(78));
console.log(`${TRIALS} trials, seed=${SEED}, determinism re-check every ${DETERMINISM_RECHECK_STRIDE}th trial.`);
console.log();

const violations = [];
const errors = [];
let determinismChecks = 0, determinismViolations = 0;

const t0 = Date.now();
for (let i = 0; i < TRIALS; i++) {
  const { anchor, host, family, assemblyMethod } = sampleConfig();
  const opts = { partId: anchor.id, host, goalFamily: family.id, assemblyMethod, partsById, templates, registryCache: registryCacheDoc, maxCandidates: 6, robustnessTrials: 100, robustnessSeed: SEED };

  let result;
  try {
    result = runAutomaticDesign(opts);
  } catch (err) {
    errors.push({ trial: i, anchor: anchor.id, host, family: family.id, assemblyMethod, error: err.message });
    continue;
  }

  const checks = [
    ["locked anchor never changes", checkLockedAnchorNeverChanges(result, anchor)],
    ["hard-invalid candidate never becomes recommendation", checkRecommendedIsHardValid(result)],
    ["goal-incompatible candidate never wins recommendation", checkRecommendedIsGoalCompatible(result)],
    ["documented cross-host incompatibility never survives validation", checkNoHostIneligiblePartInAnyValidCandidate(result, host)],
    ["missing host evidence never becomes an incompatibility", checkUnknownHostNeverTreatedAsIncompatible(anchor, host)],
    ["Registry-recorded never becomes project_verified", checkRegistryRecordedNeverBecomesProjectVerified(result)],
    ["unresolved placeholder never becomes valid", checkNoPlaceholderPartInAnyValidCandidate(result)],
    ["generated bp coordinates always sum to total plasmid length", checkBpCoordinatesSumToTotalLength(result)],
  ];
  for (const [property, violation] of checks) {
    if (violation) violations.push({ trial: i, property, anchor: anchor.id, host, family: family.id, assemblyMethod, violation });
  }

  if (i % DETERMINISM_RECHECK_STRIDE === 0) {
    determinismChecks++;
    let result2;
    try { result2 = runAutomaticDesign(opts); } catch (err) { errors.push({ trial: i, phase: "determinism-recheck", error: err.message }); continue; }
    if (rankingSignature(result) !== rankingSignature(result2)) {
      determinismViolations++;
      violations.push({ trial: i, property: "ranking becomes nondeterministic under the same inputs/seed", anchor: anchor.id, host, family: family.id, assemblyMethod, violation: "two identical runs produced different rankings" });
    }
  }
}
const elapsedMs = Date.now() - t0;

console.log(`Completed ${TRIALS} trials in ${elapsedMs} ms (${(elapsedMs / TRIALS).toFixed(2)} ms/trial). ${determinismChecks} determinism re-checks performed.`);
console.log();
console.log(`Exceptions thrown: ${errors.length}`);
console.log(`Property violations: ${violations.length}`);
if (violations.length) {
  const byProperty = {};
  for (const v of violations) byProperty[v.property] = (byProperty[v.property] || 0) + 1;
  console.log("--- Violations by property ---");
  for (const [prop, count] of Object.entries(byProperty)) console.log(`  ${prop}: ${count}`);
} else {
  console.log("No property violations found across all trials.");
}

mkdirSync(path.join(__dirname, "results"), { recursive: true });
const outPath = path.join(__dirname, "results", "property_stress_check.json");
writeFileSync(outPath, JSON.stringify({
  meta: { title: "Randomized/Property-Based Stress Test (Phase 5A, item 3)", generatedAt: new Date().toISOString(), trials: TRIALS, seed: SEED, determinismRecheckStride: DETERMINISM_RECHECK_STRIDE, determinismChecks, elapsedMs },
  violationCount: violations.length,
  errorCount: errors.length,
  violations,
  errors,
}, null, 2));
console.log(`\nWrote ${path.relative(REPO_ROOT, outPath)}`);
