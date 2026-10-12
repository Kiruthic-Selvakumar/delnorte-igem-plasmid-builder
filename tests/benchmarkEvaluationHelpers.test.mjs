// node --test for Phase 5A, item 8: deterministic tests for the benchmark
// evaluation logic itself (benchmark/lib/evaluationHelpers.mjs), not for the
// design engine (already covered elsewhere). Real project data throughout;
// no literal DNA sequence is typed into this file.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { runAutomaticDesign } from "../automatic/index.js";
import { classifyFailure, anchorPreserved, evaluateRun, summarizeRuns } from "../benchmark/lib/evaluationHelpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const partsDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "parts.json"), "utf-8"));
const templatesDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "templates.json"), "utf-8"));
const registryCacheDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "registry_cache.json"), "utf-8"));
const partsById = {};
for (const p of partsDoc.parts) partsById[p.id] = p;
const templates = templatesDoc.templates;

describe("classifyFailure", () => {
  test("returns null (not a failure) for a real, successful run", () => {
    const result = runAutomaticDesign({ partId: "sg_GFP", host: "E. coli", goalFamily: "inducible_regulated_expression", partsById, templates, registryCache: registryCacheDoc, maxCandidates: 6 });
    assert.equal(classifyFailure(result), null);
  });

  test("classifies a genuinely placeholder-evidence anchor as 'placeholder/missing sequence', not a coincidental unrelated category", () => {
    const result = runAutomaticDesign({ partId: "dn_sfgfp_cds", host: "E. coli", goalFamily: "inducible_regulated_expression", partsById, templates, registryCache: registryCacheDoc, maxCandidates: 6 });
    assert.equal(result.candidates.valid.length, 0, "test setup: this anchor must be evidence:placeholder and hard-reject every candidate");
    assert.equal(classifyFailure(result), "placeholder/missing sequence");
  });

  test("classifies a host-restricted anchor as 'insufficient host evidence' for a host it is not documented for", () => {
    const result = runAutomaticDesign({ partId: "sg_pBBR1_Rep", host: "E. coli", goalFamily: "inducible_regulated_expression", partsById, templates, registryCache: registryCacheDoc, maxCandidates: 6 });
    assert.equal(result.candidates.valid.length, 0, "test setup: sg_pBBR1_Rep is documented only for V. natriegens");
    assert.equal(classifyFailure(result), "insufficient host evidence");
  });

  test("prefers the UNIVERSAL rejection reason over one that only affects a minority of generated candidates", () => {
    // dn_sfgfp_cds (placeholder anchor) also, for some host/family combos, generates
    // a beam branch that separately fails a cognate-dependency check (pSC101/Rep101) --
    // the anchor's OWN placeholder-ness affects every candidate and must win.
    const result = runAutomaticDesign({ partId: "dn_sfgfp_cds", host: "E. coli", goal: "reporter expression", partsById, templates, maxCandidates: 6 });
    const reasonSets = result.candidates.invalid.map(c => c.validation.reasons.join(" | "));
    assert.ok(reasonSets.every(r => r.includes("evidence:placeholder")), "test setup: every invalid candidate must mention the placeholder anchor");
    assert.ok(reasonSets.some(r => r.includes("cognate replication protein missing")), "test setup: at least one candidate must ALSO carry an unrelated dependency failure");
    assert.equal(classifyFailure(result), "placeholder/missing sequence");
  });

  test("returns 'unsupported architecture' when the run itself failed (stage !== done)", () => {
    const result = { ok: false, stage: "selectArchitecture", reason: "no template" };
    assert.equal(classifyFailure(result), "unsupported architecture");
  });

  test("returns 'search-width limitation' when no reason text maps to any fixed category (the documented, honest catch-all)", () => {
    const result = { ok: true, candidates: { valid: [], invalid: [{ candidateId: "x", validation: { valid: false, reasons: ["Role \"ori\" resolved to 2 parts at once -- inconsistent architecture data for this template."] } }] } };
    assert.equal(classifyFailure(result), "search-width limitation");
  });

  test("returns 'other' specifically for the real whole-sequence 'characters outside A/T/C/G' rejection", () => {
    const result = { ok: true, candidates: { valid: [], invalid: [{ candidateId: "x", validation: { valid: false, reasons: ["Assembled sequence contains characters outside A/T/C/G -- invalid DNA."] } }] } };
    assert.equal(classifyFailure(result), "other");
  });
});

describe("anchorPreserved", () => {
  test("true for a real, successful run where the anchor never changes", () => {
    const result = runAutomaticDesign({ partId: "sg_GFP", host: "E. coli", goal: "reporter expression", partsById, templates, maxCandidates: 6 });
    assert.equal(anchorPreserved(result, "cds", "sg_GFP", partsById.sg_GFP.length), true);
  });

  test("false when a candidate's anchor role entry has the wrong id", () => {
    const fakeResult = { ok: true, candidates: { all: [{ candidateId: "x", plan: { order: [{ role: "cds", id: "WRONG_ID", length: 720 }] } }] } };
    assert.equal(anchorPreserved(fakeResult, "cds", "sg_GFP", 720), false);
  });

  test("false when a candidate's anchor role entry has the wrong length", () => {
    const fakeResult = { ok: true, candidates: { all: [{ candidateId: "x", plan: { order: [{ role: "cds", id: "sg_GFP", length: 1 }] } }] } };
    assert.equal(anchorPreserved(fakeResult, "cds", "sg_GFP", 720), false);
  });

  test("true (vacuously) for a failed run -- nothing was generated to violate anchor preservation", () => {
    assert.equal(anchorPreserved({ ok: false }, "cds", "sg_GFP", 720), true);
  });
});

describe("evaluateRun", () => {
  test("produces the full fixed metric shape for a real successful run", () => {
    const result = runAutomaticDesign({ partId: "sg_GFP", host: "E. coli", goalFamily: "inducible_regulated_expression", partsById, templates, registryCache: registryCacheDoc, maxCandidates: 6 });
    const rec = evaluateRun(result, { anchorRole: "cds", expectedAnchorId: "sg_GFP", expectedAnchorLength: partsById.sg_GFP.length });
    assert.equal(rec.ok, true);
    assert.equal(rec.architectureGenerated, true);
    assert.equal(rec.hardValidGenerated, true);
    assert.equal(rec.anchorPreserved, true);
    assert.equal(rec.recommendationProduced, true);
    assert.equal(rec.goalCompatibleRecommendation, true);
    assert.equal(typeof rec.assemblyFeasibleTop1, "boolean");
    assert.equal(typeof rec.registryComparisonAvailable, "boolean");
    assert.ok(rec.paretoOptimalTop1 === true || rec.paretoOptimalTop1 === false);
    assert.ok(rec.robustness && typeof rec.robustness.stability === "number");
    assert.equal(rec.failureCategory, null);
  });

  test("produces a coherent failure record for a real failing run, without throwing", () => {
    const result = runAutomaticDesign({ partId: "dn_sfgfp_cds", host: "B. subtilis", goalFamily: "secretion", partsById, templates, registryCache: registryCacheDoc, maxCandidates: 6 });
    const rec = evaluateRun(result, { anchorRole: "cds", expectedAnchorId: "dn_sfgfp_cds", expectedAnchorLength: partsById.dn_sfgfp_cds.length });
    assert.equal(rec.hardValidGenerated, false);
    assert.equal(rec.recommendationProduced, false);
    assert.equal(rec.failureCategory, "placeholder/missing sequence");
  });
});

describe("summarizeRuns", () => {
  test("computes rates as fractions of the full record count, never dropping the denominator", () => {
    const records = [
      { architectureGenerated: true, hardValidGenerated: true, anchorPreserved: true, goalCompatibleRecommendation: true, assemblyFeasibleTop1: true, registryComparisonAvailable: true, failureCategory: null },
      { architectureGenerated: true, hardValidGenerated: false, anchorPreserved: true, goalCompatibleRecommendation: false, assemblyFeasibleTop1: false, registryComparisonAvailable: false, failureCategory: "placeholder/missing sequence" },
    ];
    const summary = summarizeRuns(records);
    assert.equal(summary.totalRuns, 2);
    assert.equal(summary.architectureGenerationRate, 1);
    assert.equal(summary.hardValidRate, 0.5);
    assert.deepEqual(summary.failureCounts, { "placeholder/missing sequence": 1 });
  });

  test("handles an empty record list without dividing by zero", () => {
    const summary = summarizeRuns([]);
    assert.equal(summary.totalRuns, 0);
    assert.equal(summary.architectureGenerationRate, null);
    assert.deepEqual(summary.failureCounts, {});
  });
});
