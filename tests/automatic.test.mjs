// node --test tests for Phase 1 of Automatic Design Mode.
//
// Uses the REAL data/parts.json + data/templates.json, same pattern as
// benchmark/run_benchmark.mjs, so these tests exercise the actual catalog rather
// than an invented one. Per CLAUDE.md, no literal DNA sequence is ever typed into
// this file -- the one "novel sequence" test derives its input from a real,
// already-verified catalog sequence at run time (a slice/splice of two regions of
// a real part), so the actual bases come from data/parts.json, not from this file.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { design } from "../designer.js";
import {
  characterizeInput,
  selectArchitecture,
  generateCandidates,
  validateCandidate,
  runAutomaticDesign,
} from "../automatic/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const partsDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "parts.json"), "utf-8"));
const templatesDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "templates.json"), "utf-8"));
const partsById = {};
for (const p of partsDoc.parts) partsById[p.id] = p;
const templates = templatesDoc.templates;

describe("characterizeInput", () => {
  test("known local part by id", () => {
    const r = characterizeInput({ partId: "sg_GFP", host: "E. coli", goal: "reporter expression", partsById });
    assert.equal(r.ok, true);
    assert.equal(r.input.mode, "local_part");
    assert.equal(r.input.anchorPart.id, "sg_GFP");
    assert.equal(r.input.role, "cds");
  });

  test("known local part by exact name text", () => {
    const r = characterizeInput({ text: "lacI", host: "E. coli", goal: "repressor test", partsById });
    assert.equal(r.ok, true);
    assert.equal(r.input.mode, "local_part");
    assert.equal(r.input.anchorPart.id, "sg_lacI");
  });

  test("exact name that matches multiple catalog parts (a real case: 'GFP' matches 3 SnapGene entries) is reported as ambiguous, not silently guessed", () => {
    const r = characterizeInput({ text: "GFP", host: "E. coli", goal: "reporter expression", partsById });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => /matches 3 parts/.test(e)));
  });

  test("novel raw DNA input with explicit role is accepted and marked placeholder evidence", () => {
    // Derive a sequence that is real (comes from data/parts.json) but does not
    // match any single catalog entry verbatim: splice two non-adjacent windows
    // of a real, verified part together. No new bases are invented or typed here.
    const source = partsById["sg_GFP"].seq;
    const novel = source.slice(0, 40) + source.slice(200, 260);
    assert.equal(partsDoc.parts.some(p => p.seq === novel), false, "test setup: spliced sequence must not equal any catalog entry");

    const r = characterizeInput({ text: novel, role: "cds", host: "E. coli", goal: "test anchor", partsById });
    assert.equal(r.ok, true);
    assert.equal(r.input.mode, "novel_sequence");
    assert.equal(r.input.anchorPart.evidence, "placeholder");
    assert.equal(r.input.anchorPart.seq, novel);
    assert.equal(r.input.anchorPart.type, "cds");
  });

  test("novel raw DNA input WITHOUT a role is rejected with an explicit error, not guessed", () => {
    const source = partsById["sg_GFP"].seq;
    const novel = source.slice(0, 40) + source.slice(200, 260);
    const r = characterizeInput({ text: novel, host: "E. coli", goal: "test anchor", partsById });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => /role/i.test(e)));
  });

  test("invalid DNA (an attempted paste with non-ACGTN characters) is rejected with a clear alphabet error", () => {
    const r = characterizeInput({ text: "ACGTACGTACGTACGTACGTACGTACGTACGTACGTXX", role: "cds", host: "E. coli", goal: "test", partsById });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => /A\/C\/G\/T\/N/.test(e)));
  });

  test("missing host and goal are both reported", () => {
    const r = characterizeInput({ partId: "sg_GFP", partsById });
    assert.equal(r.ok, false);
    assert.equal(r.errors.length, 2);
  });

  test("unknown part id is rejected", () => {
    const r = characterizeInput({ partId: "not_a_real_id", host: "E. coli", goal: "x", partsById });
    assert.equal(r.ok, false);
  });
});

describe("selectArchitecture", () => {
  test("E. coli + cds role selects ecoli_inducible", () => {
    const characterized = characterizeInput({ partId: "sg_GFP", host: "E. coli", goal: "reporter expression", partsById });
    const arch = selectArchitecture(characterized, templates, partsById);
    assert.equal(arch.ok, true);
    assert.equal(arch.selected.template.id, "ecoli_inducible");
    assert.equal(arch.selected.gapCount, 0);
  });

  test("B. subtilis + cds role finds both bsub templates as options, and reports placeholder counts honestly", () => {
    const characterized = characterizeInput({ partId: "sg_GFP", host: "B. subtilis", goal: "generic expression", partsById });
    const arch = selectArchitecture(characterized, templates, partsById);
    assert.equal(arch.ok, true);
    const ids = [arch.selected.template.id, ...arch.alternatives.map(a => a.template.id)].sort();
    assert.deepEqual(ids, ["bsub_delnorte", "bsub_secretion"]);
    // With a generic (non-default) CDS, the fully-verified generic backbone should win.
    assert.equal(arch.selected.template.id, "bsub_secretion");
    assert.equal(arch.selected.placeholderCount, 0);
    const delnorte = arch.alternatives.find(a => a.template.id === "bsub_delnorte");
    assert.ok(delnorte.placeholderCount > 0, "bsub_delnorte must honestly report its remaining placeholder backbone parts");
  });

  test("B. subtilis + the project's own default gene prefers bsub_delnorte (its documented default)", () => {
    const characterized = characterizeInput({ partId: "dn_lysqdvp001_endolysin", host: "B. subtilis", goal: "coral pathogen control", partsById });
    const arch = selectArchitecture(characterized, templates, partsById);
    assert.equal(arch.ok, true);
    assert.equal(arch.selected.template.id, "bsub_delnorte");
    assert.equal(arch.selected.defaultMatch, true);
  });

  test("unsupported host is reported, not silently coerced", () => {
    const characterized = characterizeInput({ partId: "sg_GFP", host: "S. cerevisiae", goal: "x", partsById });
    const arch = selectArchitecture(characterized, templates, partsById);
    assert.equal(arch.ok, false);
    assert.ok(/S\. cerevisiae/.test(arch.reason));
  });

  test("unsupported role (no user_supplied slot for it) is reported, not silently coerced", () => {
    const characterized = characterizeInput({ partId: "sg_ori", host: "E. coli", goal: "x", partsById });
    // sg_ori is catalogued type "origin" (mapped to the internal role "ori" -- see
    // characterizeInput.js's TYPE_TO_INTERNAL_ROLE, Phase 5B); no template today has a
    // user_supplied slot for that role.
    const arch = selectArchitecture(characterized, templates, partsById);
    assert.equal(arch.ok, false);
    assert.equal(characterized.input.role, "ori");
    assert.ok(/ori/.test(arch.reason));
  });
});

describe("generateCandidates / validateCandidate", () => {
  test("generates multiple candidates for ecoli_inducible, bounded by maxCandidates", () => {
    const ecoli = templates.find(t => t.id === "ecoli_inducible");
    const anchor = partsById["sg_GFP"];
    const candidates = generateCandidates([ecoli], anchor, partsById, { maxCandidates: 4 });
    assert.equal(candidates.length, 4);
    assert.equal(candidates[0].variedSlot, null, "first candidate must be the template's own default");
    assert.ok(candidates.slice(1).every(c => c.variedSlot !== null));
  });

  test("every candidate role-order is complete for a fully-backed template and gaps are empty", () => {
    const ecoli = templates.find(t => t.id === "ecoli_inducible");
    const anchor = partsById["sg_GFP"];
    const [defaultCandidate] = generateCandidates([ecoli], anchor, partsById, { maxCandidates: 1 });
    assert.deepEqual(defaultCandidate.plan.gaps, []);
    assert.equal(defaultCandidate.validation.valid, true);
    const roles = defaultCandidate.plan.order.map(o => o.role);
    for (const requiredRole of ["ori", "marker", "promoter", "rbs", "cds", "terminator"]) {
      assert.ok(roles.includes(requiredRole), `expected role ${requiredRole} in order`);
    }
  });

  test("candidate missing a required role is rejected with an explainable reason", () => {
    const noCds = generateCandidates(
      [templates.find(t => t.id === "ecoli_inducible")],
      null, // no anchor supplied -> required user_supplied cds slot cannot resolve
      partsById,
      { maxCandidates: 1 }
    );
    assert.equal(noCds[0].validation.valid, false);
    assert.ok(noCds[0].validation.reasons.some(r => /role "cds"/.test(r)));
  });

  test("bsub_delnorte's default candidate is hard-rejected for its placeholder-evidence parts, honestly naming them", () => {
    const delnorte = templates.find(t => t.id === "bsub_delnorte");
    const anchor = partsById["dn_lysqdvp001_endolysin"];
    const [defaultCandidate] = generateCandidates([delnorte], anchor, partsById, { maxCandidates: 1 });
    assert.equal(defaultCandidate.plan.buildable, false);
    assert.equal(defaultCandidate.validation.valid, false);
    assert.ok(defaultCandidate.plan.placeholders.length > 0);
    for (const name of defaultCandidate.plan.placeholders) {
      assert.ok(defaultCandidate.validation.reasons.some(r => r.includes(name)));
    }
  });
});

describe("runAutomaticDesign (end-to-end orchestration)", () => {
  test("full pipeline for a known part on E. coli returns a recommended valid candidate, and correctly rejects the one biologically-invalid slot-swap", () => {
    const result = runAutomaticDesign({
      partId: "sg_GFP", host: "E. coli", goal: "reporter expression",
      partsById, templates, maxCandidates: 6,
    });
    assert.equal(result.ok, true);
    assert.equal(result.architecture.selected.template.id, "ecoli_inducible");
    assert.ok(result.candidates.all.length > 1, "should generate more than one candidate");
    assert.ok(result.recommended);
    // ecoli_inducible's 3rd ori candidate (sg_pSC101_ori) requires sg_Rep101 in trans,
    // which no ecoli_inducible slot ever supplies -- the single-slot-swap candidate that
    // tries it should be the one and only rejected candidate here, for exactly that reason.
    assert.equal(result.candidates.invalid.length, 1);
    assert.equal(result.candidates.invalid[0].candidateId, "ecoli_inducible__swap-ori-sg_pSC101_ori");
    assert.ok(result.candidates.invalid[0].validation.reasons.some(r => /cognate replication protein missing/.test(r)));
  });

  test("full pipeline surfaces both valid (bsub_secretion) and invalid (bsub_delnorte) candidates for B. subtilis without hiding placeholders", () => {
    const result = runAutomaticDesign({
      partId: "sg_GFP", host: "B. subtilis", goal: "generic expression",
      partsById, templates, maxCandidates: 6,
    });
    assert.equal(result.ok, true);
    const templateIdsGenerated = new Set(result.candidates.all.map(c => c.templateId));
    assert.ok(templateIdsGenerated.has("bsub_secretion"));
    assert.ok(templateIdsGenerated.has("bsub_delnorte"));
    assert.ok(result.candidates.valid.some(c => c.templateId === "bsub_secretion"));
    assert.ok(result.candidates.invalid.some(c => c.templateId === "bsub_delnorte"));
    // no candidate's placeholder parts are ever silently marked verified
    for (const c of result.candidates.all) {
      for (const name of c.plan.placeholders) {
        const part = Object.values(partsById).find(p => p.name === name);
        if (part) assert.notEqual(part.evidence, "verified");
      }
    }
  });
});

describe("Template-Guided Mode regression (unaffected by Automatic Mode additions)", () => {
  test("designer.js design() still produces the same buildable result for ecoli_inducible + sg_GFP", () => {
    const ecoli = templates.find(t => t.id === "ecoli_inducible");
    const plan = design(ecoli, partsById, partsById["sg_GFP"]);
    assert.equal(plan.buildable, true);
    assert.deepEqual(plan.gaps, []);
    assert.equal(plan.order.map(o => o.id).includes("sg_GFP"), true);
  });
});
