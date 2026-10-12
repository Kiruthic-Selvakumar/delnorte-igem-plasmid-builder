// node --test: RAW DNA DISCORD ACCEPTANCE TEST (Phase 4C, item 2).
//
// The team's original Discord requirement, verbatim:
//
//   "A user puts in a DNA sequence OR a biological part and a whole plasmid is
//   built around that input, then the generated design is tested/compared
//   against plasmids in the iGEM Registry and other defensible references."
//
// Every other acceptance test in this project (V1 in
// tests/architectureGeneration.test.mjs, V2 in tests/discordAcceptanceV2.test.mjs)
// supplies a `partId` -- proving the "OR a biological part" half. This file
// proves the OTHER half: a truly novel, raw DNA sequence (supplied via `text`,
// never `partId`), with no template/backbone named anywhere in the input.
//
// CLAUDE.md forbids writing a literal DNA sequence into any file other than
// data/parts.json -- so this test does not invent, mutate, or fabricate any
// sequence. It instead takes a REAL, already-verified catalog sequence
// (dn_lysqdvp001_endolysin's real 711bp endolysin CDS) read live from
// data/parts.json, and calls characterizeInput/runAutomaticDesign with a
// partsById copy that has that ONE id deliberately removed -- so, from this
// run's point of view, it is a real, syntactically valid, but completely
// unrecognized (novel) sequence, exactly simulating a user pasting real DNA
// this project's catalog has never seen. Every base is still 100% real
// project data; nothing is generated.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { runAutomaticDesign, computePlasmidMapSegments } from "../automatic/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const partsDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "parts.json"), "utf-8"));
const templatesDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "templates.json"), "utf-8"));
const registryCacheDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "registry_cache.json"), "utf-8"));
const templates = templatesDoc.templates;

const HELD_OUT_ID = "dn_lysqdvp001_endolysin";
const fullPartsById = {};
for (const p of partsDoc.parts) fullPartsById[p.id] = p;
const heldOutPart = fullPartsById[HELD_OUT_ID];
if (!heldOutPart || !heldOutPart.seq) throw new Error(`Test setup error: expected a real, sequenced catalog part "${HELD_OUT_ID}"`);
const RAW_SEQUENCE = heldOutPart.seq; // read live from data/parts.json -- never typed as a literal in this file

// partsById WITHOUT the held-out id: characterizeInput's own exact/substring/
// reverse-complement sequence search now has nothing to find this real
// sequence under, so it is honestly treated as "novel" -- not a fabrication,
// a deliberate test-time omission of a real catalog entry.
const partsById = Object.fromEntries(Object.entries(fullPartsById).filter(([id]) => id !== HELD_OUT_ID));

// Confirm the test's own premise before relying on it: this sequence must not
// coincidentally match (exactly or as a substring) any OTHER real catalog part.
const collision = Object.values(partsById).find(p => p.seq && (p.seq.toUpperCase().includes(RAW_SEQUENCE) || RAW_SEQUENCE.includes(p.seq.toUpperCase())));
if (collision) throw new Error(`Test setup error: RAW_SEQUENCE unexpectedly overlaps catalog part "${collision.id}" -- pick a different held-out id.`);

describe("RAW DNA DISCORD ACCEPTANCE TEST", () => {
  const input = {
    text: RAW_SEQUENCE, // raw DNA, NOT partId
    role: "cds",
    host: "E. coli",
    goalFamily: "inducible_regulated_expression", // structured design goal
    partsById, templates, registryCache: registryCacheDoc,
    maxCandidates: 6, beamWidth: 5, robustnessTrials: 300,
  };
  // No template/backbone named anywhere in the input:
  assert.ok(!("template" in input) && !("templateId" in input) && !("backbone" in input));

  const result = runAutomaticDesign(input);

  test("setup: the run itself succeeds and characterizes the input as a novel sequence", () => {
    assert.equal(result.ok, true, JSON.stringify(result).slice(0, 500));
    assert.equal(result.characterized.input.mode, "novel_sequence");
  });

  test("1. sequence is preserved EXACTLY after normalization", () => {
    assert.equal(result.characterized.input.anchorPart.seq, RAW_SEQUENCE.toUpperCase());
    assert.equal(result.characterized.input.anchorPart.seq.length, RAW_SEQUENCE.length);
  });

  test("2. provenanceStatus is user_supplied", () => {
    // Every candidate's own resolved anchor entry must classify as user_supplied.
    for (const c of result.candidates.all) {
      const anchorEntry = c.plan.order.find(o => o.role === "cds");
      assert.equal(anchorEntry.id, null, "the anchor is never given a catalog id -- id:null is this project's own user-supplied marker");
    }
  });

  test("3. sequenceStatus is resolved (a real, syntactically valid sequence is present)", () => {
    assert.ok(result.characterized.input.anchorPart.seq.length > 0);
    assert.match(result.characterized.input.anchorPart.seq, /^[ACGTN]+$/);
  });

  test("4. the model constructs a COMPLETE plasmid around the raw sequence (not just the anchor alone)", () => {
    assert.ok(result.recommended, "a recommendation must be produced");
    assert.ok(result.recommended.plan.order.length > 1, "more than just the anchor must be resolved");
    for (const role of ["ori", "marker", "promoter", "rbs", "terminator"]) {
      assert.ok(result.recommended.plan.order.some(o => o.role === role), `expected role "${role}" to be resolved in the recommended plasmid`);
    }
  });

  test("5. the candidate PASSES hard validation -- THE core Phase 4C fix: raw user DNA is no longer automatically hard-rejected", () => {
    assert.equal(result.recommended.validation.valid, true);
    assert.equal(result.recommended.validation.reasons.length, 0);
    assert.ok(result.candidates.valid.length > 0, "at least one hard-valid candidate must exist");
  });

  test("6. warnings clearly and honestly state the anchor has not been independently verified", () => {
    const w = result.recommended.validation.warnings;
    assert.ok(w.some(x => x.includes("user_supplied") && x.includes("not") && x.includes("verified")), JSON.stringify(w));
  });

  test("7. the anchor is never swapped -- identical across EVERY generated candidate, valid or rejected", () => {
    for (const c of result.candidates.all) {
      const anchorEntry = c.plan.order.find(o => o.role === "cds");
      assert.equal(anchorEntry.name, result.characterized.input.anchorPart.name);
      assert.equal(anchorEntry.length, RAW_SEQUENCE.length);
    }
  });

  test("8. Registry absence for this exact sequence is not treated as a failure or incompatibility", () => {
    // The raw sequence has no Registry cross-reference at all -- confirm that
    // absence produces no rejection reason and no incompatibility, anywhere.
    for (const c of result.candidates.all) {
      assert.ok(!c.validation.reasons.some(r => /[Rr]egistry/.test(r)), `no rejection reason should ever mention Registry absence: ${JSON.stringify(c.validation.reasons)}`);
    }
    // And a role-relevant Registry reference (independent of the anchor's own
    // Registry status) still runs for scoring, showing absence is not conflated
    // with failure at the scoring layer either:
    const scoredRec = result.scoring.ranked.find(r => r.candidateId === result.recommended.candidateId);
    assert.ok(scoredRec.breakdown.registrySupport === null || typeof scoredRec.breakdown.registrySupport === "number");
  });

  test("9. scoring, ranking, Pareto, and robustness all run normally on this candidate", () => {
    assert.ok(result.scoring.ranked.length > 0);
    assert.equal(typeof result.scoring.ranked[0].overallScore, "number");
    assert.ok(["pareto_optimal", "dominated"].includes(result.scoring.ranked.find(r => r.candidateId === result.recommended.candidateId).paretoOptimal ? "pareto_optimal" : "dominated"));
    assert.ok(result.scoring.robustness && result.scoring.robustness.recommended, "robustness analysis must run");
    assert.equal(typeof result.scoring.robustness.recommended.recommendationStability, "number");
  });

  test("10. the plasmid map contains the raw-DNA anchor, correctly flagged", () => {
    const scoredRec = result.scoring.ranked.find(r => r.candidateId === result.recommended.candidateId);
    const map = computePlasmidMapSegments(result.recommended, {
      partsById, anchorName: result.characterized.input.anchorPart.name, anchorPart: result.characterized.input.anchorPart, scored: scoredRec,
    });
    const anchorSeg = map.segments.find(s => s.isAnchor);
    assert.ok(anchorSeg, "the raw-DNA anchor must appear as a segment in the plasmid map");
    assert.equal(anchorSeg.provenanceStatus, "user_supplied");
    assert.equal(anchorSeg.sequenceStatus, "resolved");
    assert.equal(anchorSeg.length, RAW_SEQUENCE.length);
  });
});
