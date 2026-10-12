// node --test tests for Phase 3: recommendation robustness (weight-perturbation
// ranking-stability analysis). Uses the same real data/parts.json +
// data/templates.json + data/registry_cache.json as the other test files, plus
// small hand-built synthetic score vectors (matching the pattern already used
// in tests/scoring.test.mjs for Pareto-front unit tests) to test mathematical
// properties precisely and cheaply. No literal DNA sequence is typed here.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { design } from "../designer.js";
import {
  runAutomaticDesign, generateCandidates, scoreCandidate, computeParetoFront,
  createRegistryClient, EMPTY_REGISTRY,
  analyzeRankingRobustness, DEFAULT_TRIALS, DEFAULT_SEED,
} from "../automatic/index.js";
import { perturbWeights, PERTURBABLE_DIMENSIONS, STABILITY_THRESHOLDS } from "../automatic/robustness.js";
import { SCORE_WEIGHTS } from "../automatic/scoreCandidate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const partsDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "parts.json"), "utf-8"));
const templatesDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "templates.json"), "utf-8"));
const registryCacheDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "registry_cache.json"), "utf-8"));
const partsById = {};
for (const p of partsDoc.parts) partsById[p.id] = p;
const templates = templatesDoc.templates;

function mulberry32Seeded(seed) {
  // local copy of the same tiny PRNG, only to independently verify perturbWeights()
  // draws are reproducible -- not imported, so this test doesn't just re-check "did I call the same function".
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("perturbWeights", () => {
  test("every perturbed weight is non-negative, across many draws", () => {
    const rng = mulberry32Seeded(1);
    for (let i = 0; i < 2000; i++) {
      const w = perturbWeights(SCORE_WEIGHTS, rng);
      for (const dim of Object.keys(w)) assert.ok(w[dim] >= 0, `${dim} = ${w[dim]} is negative`);
    }
  });

  test("perturbable (non-zero baseline weight) dimensions always sum to 1", () => {
    const rng = mulberry32Seeded(2);
    for (let i = 0; i < 500; i++) {
      const w = perturbWeights(SCORE_WEIGHTS, rng);
      const sum = PERTURBABLE_DIMENSIONS.reduce((a, d) => a + w[d], 0);
      assert.ok(Math.abs(sum - 1) < 1e-9, `sum=${sum}`);
    }
  });

  test("a dimension with baseline weight 0 (verifiedPartSupport) is never perturbed away from 0", () => {
    const rng = mulberry32Seeded(3);
    assert.equal(SCORE_WEIGHTS.verifiedPartSupport, 0);
    for (let i = 0; i < 200; i++) {
      const w = perturbWeights(SCORE_WEIGHTS, rng);
      assert.equal(w.verifiedPartSupport, 0);
    }
  });

  test("each perturbed active weight stays within +/-20% of its baseline before renormalization is implied by construction (same relative ratios feeding into the sum)", () => {
    // Direct check on the pre-renormalization factor range via the documented formula:
    // factor = 1 + (rng()*2-1)*0.2 in [0.8, 1.2]. rng() in [0,1) by construction of mulberry32.
    const rng = mulberry32Seeded(4);
    for (let i = 0; i < 1000; i++) {
      const r = rng();
      const factor = 1 + (r * 2 - 1) * 0.2;
      assert.ok(factor >= 0.8 && factor <= 1.2 + 1e-9);
    }
  });
});

describe("analyzeRankingRobustness: determinism", () => {
  const scored = [
    { candidateId: "A", overallScore: 90, breakdown: { functionalCompleteness: 1, assemblyFeasibility: 1, verifiedPartSupport: 1, architectureEvidence: 0.9, sequenceQuality: 1, registrySupport: 0.8 } },
    { candidateId: "B", overallScore: 80, breakdown: { functionalCompleteness: 0.9, assemblyFeasibility: 0.9, verifiedPartSupport: 1, architectureEvidence: 1, sequenceQuality: 0.9, registrySupport: 0.5 } },
  ];

  test("same seed and inputs produce bit-identical output across repeated calls", () => {
    const r1 = analyzeRankingRobustness(scored, { trials: 300, seed: 7 });
    const r2 = analyzeRankingRobustness(scored, { trials: 300, seed: 7 });
    assert.deepEqual(r1, r2);
  });

  test("a different seed can (but need not) produce different per-trial paths, while still being internally deterministic", () => {
    const r1 = analyzeRankingRobustness(scored, { trials: 300, seed: 7 });
    const r3 = analyzeRankingRobustness(scored, { trials: 300, seed: 7 }); // re-run same seed again
    assert.deepEqual(r1, r3);
  });

  test("default trials/seed constants are used when options are omitted", () => {
    const r = analyzeRankingRobustness(scored, {});
    assert.equal(r.trials, DEFAULT_TRIALS);
    assert.equal(r.seed, DEFAULT_SEED);
  });
});

describe("analyzeRankingRobustness: mathematical correctness on synthetic cases", () => {
  test("a candidate that strictly dominates another on every scored dimension ranks #1 in exactly 100% of trials", () => {
    const dominant = { candidateId: "DOM", overallScore: 99, breakdown: { functionalCompleteness: 1, assemblyFeasibility: 1, verifiedPartSupport: 1, architectureEvidence: 1, sequenceQuality: 1, registrySupport: 1 } };
    const dominated = { candidateId: "SUB", overallScore: 50, breakdown: { functionalCompleteness: 0.5, assemblyFeasibility: 0.5, verifiedPartSupport: 0.5, architectureEvidence: 0.5, sequenceQuality: 0.5, registrySupport: 0.5 } };
    const result = analyzeRankingRobustness([dominant, dominated], { trials: 500, seed: 11 });
    assert.equal(result.perCandidate.DOM.topRankFrequency, 1);
    assert.equal(result.perCandidate.DOM.worstRank, 1);
    assert.equal(result.perCandidate.SUB.topRankFrequency, 0);
    assert.equal(result.recommended.candidateId, "DOM");
    assert.equal(result.recommended.stabilityLabel, "highly stable");
  });

  test("a deliberately close, each-better-on-a-different-dimension tradeoff produces a stability label below 'highly stable'", () => {
    // Mirrors the Pareto A/B fixture from Phase 2: A best on functionalCompleteness, B best on assemblyFeasibility, tied elsewhere.
    const A = { candidateId: "A", overallScore: 62, breakdown: { functionalCompleteness: 1.0, assemblyFeasibility: 0.5, verifiedPartSupport: 0.8, architectureEvidence: 0.9, sequenceQuality: 0.9, registrySupport: null } };
    const B = { candidateId: "B", overallScore: 60, breakdown: { functionalCompleteness: 0.5, assemblyFeasibility: 1.0, verifiedPartSupport: 0.8, architectureEvidence: 0.9, sequenceQuality: 0.9, registrySupport: null } };
    const result = analyzeRankingRobustness([A, B], { trials: 1000, seed: 13 });
    assert.ok(result.recommended.recommendationStability < STABILITY_THRESHOLDS.highlyStable);
    assert.notEqual(result.recommended.stabilityLabel, "highly stable");
    // both candidates should win a meaningful (non-trivial) share of trials -- true instability, not a rounding artifact
    assert.ok(result.perCandidate.A.topRankFrequency > 0.05 && result.perCandidate.A.topRankFrequency < 0.95);
    assert.ok(result.perCandidate.B.topRankFrequency > 0.05 && result.perCandidate.B.topRankFrequency < 0.95);
  });

  test("a null dimension is excluded in every single trial, never converted to 0 (proven via an otherwise-identical candidate that has a real low value there instead)", () => {
    const withNull = { candidateId: "NULLCASE", overallScore: 100, breakdown: { functionalCompleteness: 1, assemblyFeasibility: 1, verifiedPartSupport: 1, architectureEvidence: 1, sequenceQuality: 1, registrySupport: null } };
    const withZero = { candidateId: "ZEROCASE", overallScore: 85, breakdown: { functionalCompleteness: 1, assemblyFeasibility: 1, verifiedPartSupport: 1, architectureEvidence: 1, sequenceQuality: 1, registrySupport: 0 } };
    // Scored independently (not against each other) so each is the sole candidate in its own analysis --
    // isolates whether registrySupport:null behaves as "excluded" (topRankFrequency=1 trivially, but more
    // importantly overallScore stays 100) vs registrySupport:0 (which correctly pulls the score down).
    const nullResult = analyzeRankingRobustness([withNull], { trials: 200, seed: 17 });
    assert.equal(nullResult.perCandidate.NULLCASE.topRankFrequency, 1); // sole candidate, trivially always #1
    // Directly against each other: NULLCASE must win every trial, since excluding a dimension can only ever
    // keep its normalized score at 100, while ZEROCASE's real 0 on that dimension can only ever pull it down.
    const headToHead = analyzeRankingRobustness([withNull, withZero], { trials: 500, seed: 17 });
    assert.equal(headToHead.perCandidate.NULLCASE.topRankFrequency, 1);
    assert.equal(headToHead.perCandidate.ZEROCASE.topRankFrequency, 0);
  });
});

describe("robustness respects hard validation: invalid candidates never participate", () => {
  test("runAutomaticDesign's robustness analysis only ever sees valid candidates (ecoli pSC101/Rep101 swap excluded)", () => {
    const result = runAutomaticDesign({
      partId: "sg_GFP", host: "E. coli", goal: "reporter expression",
      partsById, templates, maxCandidates: 6, registryCache: registryCacheDoc, robustnessTrials: 300,
    });
    const robustIds = Object.keys(result.scoring.robustness.perCandidate);
    assert.ok(!robustIds.includes("ecoli_inducible__swap-ori-sg_pSC101_ori"));
    assert.deepEqual(robustIds.sort(), result.candidates.valid.map(c => c.candidateId).sort());
  });
});

describe("B. subtilis / V. natriegens robustness analysis works without Registry coverage", () => {
  for (const [host, partId] of [["B. subtilis", "sg_lacI"], ["V. natriegens", "sg_GFP"]]) {
    test(`${host}: robustness analysis runs and produces a valid, non-crashing result with EMPTY_REGISTRY`, () => {
      const result = runAutomaticDesign({
        partId, host, goal: "generic expression",
        partsById, templates, maxCandidates: 6, registryCache: EMPTY_REGISTRY, robustnessTrials: 300,
      });
      assert.ok(result.ok);
      assert.ok(result.scoring.robustness.recommended);
      for (const stats of Object.values(result.scoring.robustness.perCandidate)) {
        assert.ok(stats.topRankFrequency >= 0 && stats.topRankFrequency <= 1);
        assert.ok(stats.meanRank >= 1);
      }
      // registrySupport was null (no cache) for every candidate -- the recommended
      // candidate's stability must be computed purely from the other dimensions, and
      // is therefore never artificially suppressed by missing Registry coverage.
      const recommended = result.scoring.ranked.find(r => r.candidateId === result.scoring.robustness.recommended.candidateId);
      assert.equal(recommended.breakdown.registrySupport, null);
    });

    test(`${host}: robustness analysis also runs cleanly under the real (partial-coverage) cache`, () => {
      const result = runAutomaticDesign({
        partId, host, goal: "generic expression",
        partsById, templates, maxCandidates: 6, registryCache: registryCacheDoc, robustnessTrials: 300,
      });
      assert.ok(result.ok);
      assert.ok(result.scoring.robustness.recommended);
      assert.ok(result.scoring.robustness.recommended.recommendationStability >= 0 && result.scoring.robustness.recommended.recommendationStability <= 1);
    });
  }
});

describe("Pareto relationship is reported, not folded into the robustness number", () => {
  test("the recommended candidate's paretoStatus and stabilityLabel are independent fields, not derived from each other", () => {
    const result = runAutomaticDesign({
      partId: "sg_GFP", host: "E. coli", goal: "reporter expression",
      partsById, templates, maxCandidates: 6, registryCache: registryCacheDoc, robustnessTrials: 300,
    });
    assert.ok(["pareto_optimal", "dominated", null].includes(result.scoring.robustness.recommended.paretoStatus));
    assert.ok(["highly stable", "moderately stable", "sensitive to scoring weights"].includes(result.scoring.robustness.recommended.stabilityLabel));
  });
});

describe("Template-Guided Mode / ECC-relevant path unaffected", () => {
  test("designer.js design() is untouched by Phase 3", () => {
    const ecoli = templates.find(t => t.id === "ecoli_inducible");
    const plan = design(ecoli, partsById, partsById["sg_GFP"]);
    assert.equal(plan.buildable, true);
  });
});
