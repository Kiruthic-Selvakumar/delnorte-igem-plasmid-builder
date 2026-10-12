// node --test for Phase 6, item 8: LOCK-CONSISTENCY REQUIREMENT.
//
// The Phase 5B report documented a known gap: designer.js#design() (used by
// Pathway A / generateCandidates()) only ever knows about the PRIMARY
// anchor -- it has no parameter for additionalLockedComponents at all, so a
// template's own default part for a locked role can silently remain in a
// Pathway-A candidate instead of the user's locked component. Phase 6 turns
// this into an explicit, checked eligibility fact (candidate.lockedComponentsCompatible)
// rather than a silent inconsistency, using the SAME "comparison only,
// excluded from recommendation/Pareto/robustness" mechanism goalCompatible:false
// already uses -- not scoring manipulation.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { runAutomaticDesign } from "../automatic/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const partsDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "parts.json"), "utf-8"));
const templatesDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "templates.json"), "utf-8"));
const partsById = {};
for (const p of partsDoc.parts) partsById[p.id] = p;
const templates = templatesDoc.templates;

describe("lockedComponentsCompatible", () => {
  test("a Pathway-A (template-matched) candidate that does NOT honor an additional lock is flagged lockedComponentsCompatible:false, not silently accepted", () => {
    const lockedMarker = "sg_AmpR_(2)"; // a real, verified marker, deliberately not ecoli_inducible's own default marker choice
    const result = runAutomaticDesign({
      partId: "sg_GFP", host: "E. coli", goalFamily: "inducible_regulated_expression",
      additionalLockedComponents: [{ role: "marker", partId: lockedMarker }],
      partsById, templates, maxCandidates: 8, beamWidth: 6,
    });
    assert.equal(result.ok, true);
    const templateCandidates = result.candidates.all.filter(c => c.origin === "template");
    assert.ok(templateCandidates.length > 0, "test setup: at least one Pathway-A candidate must be generated");
    for (const c of templateCandidates) {
      const hasLockedMarker = c.plan.order.some(o => o.role === "marker" && o.id === lockedMarker);
      if (!hasLockedMarker) {
        assert.equal(c.lockedComponentsCompatible, false);
        assert.deepEqual(c.missingLockedRoles, ["marker"]);
      }
    }
  });

  test("a Pathway-B (beam-search) candidate ALWAYS honors every lock -- lockedComponentsCompatible is always true", () => {
    const lockedMarker = "sg_AmpR_(2)";
    const result = runAutomaticDesign({
      partId: "sg_GFP", host: "E. coli", goalFamily: "inducible_regulated_expression",
      additionalLockedComponents: [{ role: "marker", partId: lockedMarker }],
      partsById, templates, maxCandidates: 8, beamWidth: 6,
    });
    const beamCandidates = result.candidates.all.filter(c => c.origin === "beam_search");
    assert.ok(beamCandidates.length > 0, "test setup: at least one beam-search candidate must be generated");
    for (const c of beamCandidates) {
      assert.equal(c.lockedComponentsCompatible, true);
      const markerEntry = c.plan.order.find(o => o.role === "marker");
      assert.equal(markerEntry.id, lockedMarker);
    }
  });

  test("a lock-incompatible candidate is excluded from recommendation, Pareto, and robustness competition, but remains visible", () => {
    const lockedMarker = "sg_AmpR_(2)";
    const result = runAutomaticDesign({
      partId: "sg_GFP", host: "E. coli", goalFamily: "inducible_regulated_expression",
      additionalLockedComponents: [{ role: "marker", partId: lockedMarker }],
      partsById, templates, maxCandidates: 8, beamWidth: 6, robustnessTrials: 200,
    });
    const lockIncompatibleScored = result.scoring.ranked.filter(r => r.candidate.lockedComponentsCompatible === false);
    assert.ok(lockIncompatibleScored.length > 0, "test setup: at least one lock-incompatible candidate must exist and still be scored");
    for (const r of lockIncompatibleScored) {
      assert.equal(r.eligibleForRecommendation, false);
      assert.deepEqual(r.dominatedBy, []);
      assert.deepEqual(r.strongestIn, []);
    }
    // The recommendation itself must always honor every lock.
    assert.equal(result.recommended.lockedComponentsCompatible, true);
    const recommendedMarker = result.recommended.plan.order.find(o => o.role === "marker");
    assert.equal(recommendedMarker.id, lockedMarker);
    // Robustness/comparison/Pareto are computed only from rankedEligible (the
    // recommendation pool) -- confirm no lock-incompatible candidate is a
    // member of that pool at all, so it can never be compared against as "#2"
    // or counted in the robustness trials.
    const eligibleIds = new Set(result.scoring.ranked.filter(r => r.eligibleForRecommendation).map(r => r.candidateId));
    for (const r of lockIncompatibleScored) assert.equal(eligibleIds.has(r.candidateId), false);
  });

  test("with NO additional locked components, every candidate is trivially lockedComponentsCompatible:true (no regression for the plain single-anchor case)", () => {
    const result = runAutomaticDesign({ partId: "sg_GFP", host: "E. coli", goalFamily: "inducible_regulated_expression", partsById, templates, maxCandidates: 6 });
    assert.equal(result.ok, true);
    for (const c of result.candidates.all) assert.equal(c.lockedComponentsCompatible, true);
  });
});
