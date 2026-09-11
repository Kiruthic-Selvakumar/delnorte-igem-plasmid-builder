// node --test tests for Phase 2: scoreCandidate / rankCandidates / computeParetoFront /
// compareCandidates / registryClient. Uses the same real data/parts.json +
// data/templates.json as tests/automatic.test.mjs. No literal DNA sequence is
// typed into this file (see that file's header note for why).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  runAutomaticDesign, scoreCandidate, rankCandidates, computeParetoFront, compareCandidates,
  createRegistryClient, EMPTY_REGISTRY, generateCandidates,
} from "../automatic/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const partsDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "parts.json"), "utf-8"));
const templatesDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "templates.json"), "utf-8"));
const partsById = {};
for (const p of partsDoc.parts) partsById[p.id] = p;
const templates = templatesDoc.templates;

describe("scoreCandidate: deterministic and traceable", () => {
  test("scoring the same candidate twice yields identical results", () => {
    const ecoli = templates.find(t => t.id === "ecoli_inducible");
    const [candidate] = generateCandidates([ecoli], partsById["sg_GFP"], partsById, { maxCandidates: 1 });
    const ctx = { partsById, anchorPart: partsById["sg_GFP"], registryClient: createRegistryClient(EMPTY_REGISTRY), host: "E. coli", role: "cds" };
    const a = scoreCandidate(candidate, ctx);
    const b = scoreCandidate(candidate, ctx);
    assert.deepEqual(a, b);
  });

  test("every breakdown value is null or within [0,1], and every dimension has a note", () => {
    const ecoli = templates.find(t => t.id === "ecoli_inducible");
    const [candidate] = generateCandidates([ecoli], partsById["sg_GFP"], partsById, { maxCandidates: 1 });
    const scored = scoreCandidate(candidate, { partsById, anchorPart: partsById["sg_GFP"], registryClient: createRegistryClient(EMPTY_REGISTRY), host: "E. coli", role: "cds" });
    for (const [dim, value] of Object.entries(scored.breakdown)) {
      assert.ok(value === null || (value >= 0 && value <= 1), `${dim} = ${value} out of [0,1]`);
      assert.equal(typeof scored.notes[dim], "string");
      assert.ok(scored.notes[dim].length > 0);
    }
  });

  test("functionalCompleteness is traceable to plan.order.length / originalTemplate.slots.length", () => {
    const ecoli = templates.find(t => t.id === "ecoli_inducible");
    const [candidate] = generateCandidates([ecoli], partsById["sg_GFP"], partsById, { maxCandidates: 1 });
    const scored = scoreCandidate(candidate, { partsById, anchorPart: partsById["sg_GFP"], registryClient: createRegistryClient(EMPTY_REGISTRY), host: "E. coli", role: "cds" });
    const expected = candidate.plan.order.length / candidate.originalTemplate.slots.length;
    assert.equal(scored.breakdown.functionalCompleteness, expected);
  });

  test("registrySupport is null (not fabricated) when no Registry cache is loaded, and its weight is excluded from weightUsed", () => {
    const ecoli = templates.find(t => t.id === "ecoli_inducible");
    const [candidate] = generateCandidates([ecoli], partsById["sg_GFP"], partsById, { maxCandidates: 1 });
    const scored = scoreCandidate(candidate, { partsById, anchorPart: partsById["sg_GFP"], registryClient: createRegistryClient(EMPTY_REGISTRY), host: "E. coli", role: "cds" });
    assert.equal(scored.breakdown.registrySupport, null);
    // registrySupport's weight is 0.15 (Phase 2.5); excluded entirely (not multiplied by 0) when null,
    // so weightUsed is the remaining active weight: 0.30+0.30+0.00+0.15+0.10 = 0.85.
    assert.equal(scored.weightUsed, 0.85);
  });

  // PHASE 4C NOTE: verifiedPartSupport is no longer provably 1.0 for EVERY
  // scored candidate in general (a hard-valid candidate may now legitimately
  // contain a registry_recorded/user_supplied part -- see provenanceModel.js
  // and the Phase 4C report). It IS still exactly 1.0 for this specific test,
  // because generateCandidates() here (Pathway A, template-based, both real
  // catalog parts) can never produce a Registry-inserted or user-supplied
  // part -- that only happens via architectureGeneration.js's beam search
  // (Pathway B) or a novel-sequence anchor. See
  // tests/architectureGeneration.test.mjs for a case where this dimension
  // genuinely is <1.0.
  test("verifiedPartSupport is 1.0 for a template-pathway candidate built entirely from project-verified catalog parts", () => {
    const ecoli = templates.find(t => t.id === "ecoli_inducible");
    const candidates = generateCandidates([ecoli], partsById["sg_GFP"], partsById, { maxCandidates: 6 });
    for (const c of candidates.filter(c => c.validation.valid)) {
      const scored = scoreCandidate(c, { partsById, anchorPart: partsById["sg_GFP"] });
      assert.equal(scored.breakdown.verifiedPartSupport, 1);
    }
  });
});

describe("rankCandidates", () => {
  test("sorts descending by overallScore, ties broken by candidateId", () => {
    const scored = [
      { candidateId: "b", overallScore: 50 },
      { candidateId: "a", overallScore: 50 },
      { candidateId: "c", overallScore: 90 },
    ];
    const ranked = rankCandidates(scored);
    assert.deepEqual(ranked.map(r => r.candidateId), ["c", "a", "b"]);
  });
});

describe("computeParetoFront", () => {
  const A = { candidateId: "A", breakdown: { functionalCompleteness: 1.0, assemblyFeasibility: 0.5, verifiedPartSupport: 0.8, architectureEvidence: 0.9, sequenceQuality: 0.9, registrySupport: null } };
  const B = { candidateId: "B", breakdown: { functionalCompleteness: 0.5, assemblyFeasibility: 1.0, verifiedPartSupport: 0.8, architectureEvidence: 0.9, sequenceQuality: 0.9, registrySupport: null } };
  const C = { candidateId: "C", breakdown: { functionalCompleteness: 0.3, assemblyFeasibility: 0.3, verifiedPartSupport: 0.8, architectureEvidence: 0.9, sequenceQuality: 0.9, registrySupport: null } };

  test("A and B are non-dominated (each best in a different dimension); C is dominated by both", () => {
    const front = computeParetoFront([A, B, C]);
    const byId = Object.fromEntries(front.map(f => [f.candidateId, f]));
    assert.equal(byId.A.paretoOptimal, true);
    assert.equal(byId.B.paretoOptimal, true);
    assert.equal(byId.C.paretoOptimal, false);
    assert.deepEqual(byId.C.dominatedBy.sort(), ["A", "B"]);
  });

  test("strongestIn correctly names the dimension(s) each Pareto-optimal candidate leads on", () => {
    const front = computeParetoFront([A, B, C]);
    const byId = Object.fromEntries(front.map(f => [f.candidateId, f]));
    assert.ok(byId.A.strongestIn.includes("functionalCompleteness"));
    assert.ok(!byId.A.strongestIn.includes("assemblyFeasibility"));
    assert.ok(byId.B.strongestIn.includes("assemblyFeasibility"));
    assert.ok(!byId.B.strongestIn.includes("functionalCompleteness"));
    assert.deepEqual(byId.C.strongestIn, []);
  });
});

describe("compareCandidates", () => {
  test("explains the winner using the single largest sub-score delta", () => {
    const winner = { candidateId: "A", overallScore: 80, breakdown: { functionalCompleteness: 1.0, assemblyFeasibility: 0.5, verifiedPartSupport: 0.8, architectureEvidence: 0.9, sequenceQuality: 0.9, registrySupport: null } };
    const loser = { candidateId: "C", overallScore: 40, breakdown: { functionalCompleteness: 0.3, assemblyFeasibility: 0.3, verifiedPartSupport: 0.8, architectureEvidence: 0.9, sequenceQuality: 0.9, registrySupport: null } };
    const { deltas, summary } = compareCandidates(winner, loser);
    assert.equal(deltas.length, 5); // registrySupport excluded from both (null), so 5 of the 6 active dimensions are comparable
    const biggest = [...deltas].sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))[0];
    assert.equal(biggest.dimension, "functionalCompleteness");
    assert.match(summary, /functionalCompleteness/);
    assert.match(summary, /A outranks C/);
  });
});

describe("registryClient (empty by default -- no fabricated data)", () => {
  test("EMPTY_REGISTRY produces an unavailable client that never throws and never invents a result", () => {
    const client = createRegistryClient(EMPTY_REGISTRY);
    assert.equal(client.available, false);
    assert.deepEqual(client.fetchPart("BBa_ANYTHING"), { ok: false, reason: "No verified iGEM Registry records are loaded yet." });
    assert.deepEqual(client.searchParts("promoter"), { ok: false, reason: "No verified iGEM Registry records are loaded yet.", results: [] });
    assert.deepEqual(client.findReferenceConstructs({ host: "E. coli" }), { ok: false, reason: "No verified iGEM Registry records are loaded yet.", constructs: [] });
  });

  test("createRegistryClient() with no argument behaves identically to EMPTY_REGISTRY", () => {
    const client = createRegistryClient();
    assert.equal(client.available, false);
  });
});

describe("end-to-end: ranking on real data (ecoli_inducible + sg_GFP)", () => {
  const result = runAutomaticDesign({ partId: "sg_GFP", host: "E. coli", goal: "reporter expression", partsById, templates, maxCandidates: 6 });

  test("ranked list is sorted descending, and its length equals the number of valid candidates", () => {
    assert.equal(result.scoring.ranked.length, result.candidates.valid.length);
    for (let i = 1; i < result.scoring.ranked.length; i++) {
      assert.ok(result.scoring.ranked[i - 1].overallScore >= result.scoring.ranked[i].overallScore);
    }
  });

  test("invalid candidates never appear in the ranked/scored list", () => {
    const invalidIds = new Set(result.candidates.invalid.map(c => c.candidateId));
    assert.ok(invalidIds.size > 0, "test setup: this scenario is expected to produce at least one invalid candidate (the pSC101/Rep101 swap)");
    for (const row of result.scoring.ranked) assert.equal(invalidIds.has(row.candidateId), false);
  });

  test("recommended candidate is exactly the top of the ranked list, not merely the first generated", () => {
    assert.equal(result.recommended.candidateId, result.scoring.ranked[0].candidateId);
  });

  // PHASE 4B: this scenario now also includes architectureGeneration.js's
  // beam-search pathway (merged into runAutomaticDesign in Phase 4A, but only
  // able to produce valid E. coli candidates after Phase 4A's host-aware-
  // retrieval bugfix, and only able to score competitively with the template
  // default after Phase 4B's architectureEvidence redefinition -- see the
  // Phase 4B report's Step 8). On real data, beam search independently
  // reconstructs the SAME fully-host-curated architecture as
  // ecoli_inducible's own default (same real backbone parts, same canonical
  // role order), so it now LEGITIMATELY TIES the template default on every
  // score dimension and is equally Pareto-optimal -- it is no longer the
  // template's "sole" Pareto-optimal design, and correctly so: this is
  // exactly the "genuinely different, non-template-locked architecture that
  // competes on equal footing" Phase 4B was asked to deliver, not a bug.
  // What's still true and still tested: every SINGLE-SLOT SWAP (which
  // deviates from ecoli_inducible's own documented top-listed choice for one
  // role) is correctly dominated by both the template default AND every
  // beam-search candidate.
  test("every single-slot swap is dominated by the (possibly multiple, now legitimately tied) best-evidenced candidates", () => {
    const swapRows = result.scoring.ranked.filter(r => r.candidate.variedSlot !== null);
    const nonSwapRows = result.scoring.ranked.filter(r => r.candidate.variedSlot === null);
    assert.ok(swapRows.length > 0 && nonSwapRows.length > 0);
    for (const row of nonSwapRows) assert.equal(row.paretoOptimal, true);
    for (const row of swapRows) {
      assert.equal(row.paretoOptimal, false);
      assert.ok(row.dominatedBy.length > 0);
      assert.ok(row.dominatedBy.includes("ecoli_inducible__default"));
    }
  });

  test("comparison explains the gap between the top candidate and a dominated single-slot swap by name", () => {
    const top = result.scoring.ranked[0];
    const swap = result.scoring.ranked.find(r => r.candidate.variedSlot !== null);
    assert.ok(top && swap);
    const { summary } = compareCandidates(top, swap);
    assert.match(summary, /architectureEvidence/);
  });
});

describe("Phase 1 behavior unchanged by Phase 2 additions", () => {
  test("selectArchitecture still picks ecoli_inducible for a generic CDS on E. coli", () => {
    const result = runAutomaticDesign({ partId: "sg_GFP", host: "E. coli", goal: "reporter expression", partsById, templates, maxCandidates: 6 });
    assert.equal(result.architecture.selected.template.id, "ecoli_inducible");
  });

  test("bsub_delnorte's default candidate is still hard-rejected for placeholder evidence (never scored, never recommended)", () => {
    const result = runAutomaticDesign({ partId: "dn_lysqdvp001_endolysin", host: "B. subtilis", goal: "coral pathogen control", partsById, templates, maxCandidates: 6 });
    const delnorteInvalid = result.candidates.invalid.find(c => c.templateId === "bsub_delnorte" && c.variedSlot === null);
    assert.ok(delnorteInvalid, "bsub_delnorte's default must still be generated and still rejected");
    assert.ok(!result.scoring.ranked.some(r => r.candidateId === delnorteInvalid.candidateId));
  });
});
