// node --test tests for the scoring-hardening pass: scoreCandidate()'s
// overallScore must be renormalized by weightUsed (the sum of weights for
// dimensions actually computable this run), so a candidate is never penalized
// merely because one dimension (almost always registrySupport, when no
// role/host-relevant Registry evidence exists) was unavailable and excluded.
//
// Uses the same real data/parts.json + data/templates.json + data/registry_cache.json
// as the other test files. No literal DNA sequence is typed into this file.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { design } from "../designer.js";
import {
  runAutomaticDesign, scoreCandidate, generateCandidates, createRegistryClient, EMPTY_REGISTRY,
} from "../automatic/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const partsDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "parts.json"), "utf-8"));
const templatesDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "templates.json"), "utf-8"));
const registryCacheDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "registry_cache.json"), "utf-8"));
const partsById = {};
for (const p of partsDoc.parts) partsById[p.id] = p;
const templates = templatesDoc.templates;

// A minimal synthetic architecture: exactly one declared slot (the anchor's
// own user_supplied cds slot), no backbone slots at all. This is the cleanest
// way to force every non-Registry dimension to its perfect (1.0) value
// simultaneously, to isolate and prove the renormalization fix in isolation:
//   functionalCompleteness = 1/1 declared slots resolved -> 1.0
//   assemblyFeasibility    = gibson, zero possible site conflicts -> 1.0
//   verifiedPartSupport    = the one resolved part is evidence:verified -> 1.0
//   architectureSupport    = zero non-anchor slots to deviate from -> 1.0 (by definition)
//   sequenceQuality        = anchor chosen below for GC in the 40-60% full-credit band -> 1.0
const SINGLE_SLOT_TEMPLATE = {
  id: "synthetic_single_slot", host: "E. coli", label: "single-slot synthetic (test-only)", assembly: "gibson",
  slots: [{ role: "cds", required: true, user_supplied: true, candidates: [] }],
};

// sg_ACP: real, evidence:verified, gc=48.7 (data/parts.json) -- squarely inside
// scoreCandidate's 40-60% full-credit GC band.
const PERFECT_ANCHOR = partsById["sg_ACP"];

describe("overallScore is renormalized by weightUsed, not penalized for missing Registry evidence", () => {
  test("a candidate perfect on every available dimension scores 100 even though registrySupport is null", () => {
    assert.ok(PERFECT_ANCHOR.gc >= 40 && PERFECT_ANCHOR.gc <= 60, "test setup: anchor must be in the full-credit GC band");
    const [candidate] = generateCandidates([SINGLE_SLOT_TEMPLATE], PERFECT_ANCHOR, partsById, { maxCandidates: 1 });
    assert.equal(candidate.validation.valid, true);

    const scored = scoreCandidate(candidate, {
      partsById, anchorPart: PERFECT_ANCHOR, host: "E. coli", role: "cds",
      registryClient: createRegistryClient(EMPTY_REGISTRY),
    });

    assert.equal(scored.breakdown.functionalCompleteness, 1);
    assert.equal(scored.breakdown.assemblyFeasibility, 1);
    assert.equal(scored.breakdown.verifiedPartSupport, 1);
    // Phase 4B renamed architectureSupport -> architectureEvidence (see that report).
    // No `templates` was passed in ctx here, so its template-role-order component is
    // excluded (null) and only curatedProvenanceFraction (1, template-origin candidate) counts.
    assert.equal(scored.breakdown.architectureEvidence, 1);
    assert.equal(scored.breakdown.sequenceQuality, 1);
    assert.equal(scored.breakdown.registrySupport, null);
    assert.equal(scored.weightUsed, 0.85); // registrySupport's 0.15 excluded, not zeroed
    assert.equal(scored.overallScore, 100); // the actual bug this pass fixes: this used to be 85
  });

  test("the pre-fix formula (weightedSum*100, no renormalization) would have produced 85 for the same candidate -- confirming this is a real, previously-present penalty", () => {
    const [candidate] = generateCandidates([SINGLE_SLOT_TEMPLATE], PERFECT_ANCHOR, partsById, { maxCandidates: 1 });
    const scored = scoreCandidate(candidate, {
      partsById, anchorPart: PERFECT_ANCHOR, host: "E. coli", role: "cds",
      registryClient: createRegistryClient(EMPTY_REGISTRY),
    });
    let oldFormulaScore = 0;
    for (const dim of Object.keys(scored.weights)) {
      if (scored.breakdown[dim] !== null) oldFormulaScore += scored.weights[dim] * scored.breakdown[dim];
    }
    oldFormulaScore = +(oldFormulaScore * 100).toFixed(1);
    assert.equal(oldFormulaScore, 85);
    assert.equal(scored.overallScore, 100);
    assert.ok(scored.overallScore > oldFormulaScore);
  });

  test("adding a Registry cache with no role-relevant reference (still null registrySupport, just for a different reason) does not change the score at all", () => {
    const [candidate] = generateCandidates([SINGLE_SLOT_TEMPLATE], PERFECT_ANCHOR, partsById, { maxCandidates: 1 });
    const noCache = scoreCandidate(candidate, { partsById, anchorPart: PERFECT_ANCHOR, host: "E. coli", role: "cds", registryClient: createRegistryClient(EMPTY_REGISTRY) });

    // A real, non-empty cache, but with only a promoter-role reference -- irrelevant to this candidate's "cds" role.
    const irrelevantCache = {
      schema_version: 1, provenance: "test-only synthetic cache, not written to disk, not the real data/registry_cache.json",
      parts: [], constructs: [{ registryId: "TEST_CONSTRUCT", uuid: "00000000-0000-0000-0000-000000000000", title: "test", architectureRoles: ["Promoter"], knownParts: [], chassis: { designedFor: [], characterisedIn: [], sourceOrganism: [] }, sourceUrl: "https://example.invalid" }],
    };
    const irrelevantCacheScored = scoreCandidate(candidate, { partsById, anchorPart: PERFECT_ANCHOR, host: "E. coli", role: "cds", registryClient: createRegistryClient(irrelevantCache) });

    assert.equal(noCache.breakdown.registrySupport, null);
    assert.equal(irrelevantCacheScored.breakdown.registrySupport, null);
    assert.equal(noCache.overallScore, irrelevantCacheScored.overallScore);
    assert.equal(noCache.overallScore, 100);
  });
});

describe("B. subtilis / V. natriegens candidates are not penalized solely for missing Registry chassis coverage", () => {
  test("bsub_secretion's default candidate: chassis is excluded (null) for every relevant reference, never coerced to a mismatch, when scored against the real cache", () => {
    const result = runAutomaticDesign({
      partId: "sg_lacI", host: "B. subtilis", goal: "generic expression",
      partsById, templates, maxCandidates: 6, registryCache: registryCacheDoc,
    });
    const bsubSecretion = result.scoring.ranked.find(r => r.candidate.templateId === "bsub_secretion" && r.candidate.variedSlot === null);
    assert.ok(bsubSecretion, "bsub_secretion's default candidate must be valid and scored");
    for (const comparison of bsubSecretion.registryComparison) {
      assert.equal(comparison.chassisAgreement, "unknown");
    }
  });

  test("bsub_secretion's overallScore under the real (partial-coverage) cache is never lower than the pre-fix formula would have given it", () => {
    const result = runAutomaticDesign({
      partId: "sg_lacI", host: "B. subtilis", goal: "generic expression",
      partsById, templates, maxCandidates: 6, registryCache: registryCacheDoc,
    });
    const bsubSecretion = result.scoring.ranked.find(r => r.candidate.templateId === "bsub_secretion" && r.candidate.variedSlot === null);
    let oldFormulaScore = 0;
    for (const dim of Object.keys(bsubSecretion.weights)) {
      if (bsubSecretion.breakdown[dim] !== null) oldFormulaScore += bsubSecretion.weights[dim] * bsubSecretion.breakdown[dim];
    }
    oldFormulaScore = +(oldFormulaScore * 100).toFixed(1);
    assert.ok(bsubSecretion.overallScore >= oldFormulaScore);
  });

  test("vnat_broadhost's default candidate: chassis is likewise excluded (null), never a mismatch, under the real cache", () => {
    const result = runAutomaticDesign({
      partId: "sg_GFP", host: "V. natriegens", goal: "generic expression",
      partsById, templates, maxCandidates: 6, registryCache: registryCacheDoc,
    });
    const vnat = result.scoring.ranked.find(r => r.candidate.templateId === "vnat_broadhost" && r.candidate.variedSlot === null);
    assert.ok(vnat, "vnat_broadhost's default candidate must be valid and scored");
    for (const comparison of vnat.registryComparison) {
      assert.equal(comparison.chassisAgreement, "unknown");
    }
    // Same non-regression guarantee as B. subtilis above.
    let oldFormulaScore = 0;
    for (const dim of Object.keys(vnat.weights)) {
      if (vnat.breakdown[dim] !== null) oldFormulaScore += vnat.weights[dim] * vnat.breakdown[dim];
    }
    oldFormulaScore = +(oldFormulaScore * 100).toFixed(1);
    assert.ok(vnat.overallScore >= oldFormulaScore);
  });
});

describe("rankings within a host remain deterministic under the renormalized formula", () => {
  for (const [host, partId] of [["E. coli", "sg_GFP"], ["B. subtilis", "sg_lacI"], ["V. natriegens", "sg_GFP"]]) {
    test(`${host}: repeated runs produce identical ranking and identical (renormalized) scores`, () => {
      const run = () => runAutomaticDesign({ partId, host, goal: "reporter expression", partsById, templates, maxCandidates: 6, registryCache: registryCacheDoc });
      const a = run(), b = run();
      assert.deepEqual(a.scoring.ranked.map(r => r.candidateId), b.scoring.ranked.map(r => r.candidateId));
      assert.deepEqual(a.scoring.ranked.map(r => r.overallScore), b.scoring.ranked.map(r => r.overallScore));
    });
  }
});

describe("Template-Guided Mode / ECC-relevant path unaffected", () => {
  test("designer.js design() is untouched by this pass", () => {
    const ecoli = templates.find(t => t.id === "ecoli_inducible");
    const plan = design(ecoli, partsById, partsById["sg_GFP"]);
    assert.equal(plan.buildable, true);
  });
});
