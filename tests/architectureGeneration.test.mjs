// node --test tests for Phase 4A: true part-first architecture generation
// (designRequirements.js + architectureGeneration.js), and the Discord
// acceptance test. Uses the same real data/parts.json + data/templates.json +
// data/registry_cache.json as the other test files. No literal DNA sequence
// is typed into this file.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { design } from "../designer.js";
import {
  runAutomaticDesign, planDesignRequirements, generateArchitectures,
  DEFAULT_BEAM_WIDTH, createRegistryClient, EMPTY_REGISTRY,
} from "../automatic/index.js";
// PHASE 4C: PROJECT_BASELINE_EXPRESSION_ROLES renamed to PROJECT_BASELINE_EXPRESSION_ROLES
// -- these roles are required only because every one of this project's 4
// CURRENT templates happens to declare them required, not because they are a
// universal requirement for all possible plasmids. See the Phase 4C report.
import { PROJECT_BASELINE_EXPRESSION_ROLES, CANONICAL_ROLE_ORDER } from "../automatic/designRequirements.js";
// Phase 4B: GOAL_CATEGORIES (an ad hoc keyword table) is replaced by
// designGrammar.js's ARCHITECTURE_FAMILIES (structured, provenanced,
// per-host-gated). This import, and the one test below that used
// GOAL_CATEGORIES, are updated accordingly -- see the Phase 4B report.
import { ARCHITECTURE_FAMILIES } from "../automatic/designGrammar.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const partsDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "parts.json"), "utf-8"));
const templatesDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "templates.json"), "utf-8"));
const registryCacheDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "registry_cache.json"), "utf-8"));
const partsById = {};
for (const p of partsDoc.parts) partsById[p.id] = p;
const templates = templatesDoc.templates;

describe("planDesignRequirements", () => {
  test("project-baseline required roles are present for every host, minus the anchor role", () => {
    const plan = planDesignRequirements({ anchorRole: "cds", host: "E. coli", goal: "", templates });
    for (const role of PROJECT_BASELINE_EXPRESSION_ROLES) assert.ok(plan.requiredRoles.includes(role));
    assert.ok(!plan.requiredRoles.includes("cds"));
  });

  test("B. subtilis: signal is promoted to required because BOTH its documented templates require it", () => {
    const plan = planDesignRequirements({ anchorRole: "cds", host: "B. subtilis", goal: "", templates });
    assert.ok(plan.requiredRoles.includes("signal"));
    assert.ok(plan.rationale.some(r => r.includes("signal") && r.includes("required")));
  });

  test("V. natriegens: rep is required (documented oriV/Rep trans-dependency)", () => {
    const plan = planDesignRequirements({ anchorRole: "cds", host: "V. natriegens", goal: "", templates });
    assert.ok(plan.requiredRoles.includes("rep"));
  });

  test("E. coli: signal is NOT required (its one template declares it optional with zero candidates)", () => {
    const plan = planDesignRequirements({ anchorRole: "cds", host: "E. coli", goal: "", templates });
    assert.ok(!plan.requiredRoles.includes("signal"));
  });

  test("a goal matching the 'secretion' category promotes signal to required, for a host where secretion is documented as supported", () => {
    const plan = planDesignRequirements({ anchorRole: "cds", host: "B. subtilis", goal: "we want secreted protein production", templates });
    assert.ok(plan.requiredRoles.includes("signal"));
    assert.equal(plan.goalInterpretation.category, "secretion");
    assert.ok(plan.rationale.some(r => r.includes("secretion")));
  });

  // PHASE 4B: this is the improvement over Phase 4A's ad hoc goal-category
  // system, which applied "secretion -> signal required" for ANY host, even
  // E. coli -- which has no documented signal peptide part anywhere in this
  // project's data. Families are now host-gated (designGrammar.js's
  // hostAvailability), so an unsupported host honestly declines rather than
  // silently inventing a requirement no catalog part can satisfy.
  test("a goal matching 'secretion' for a host where it is NOT documented as supported is honestly declined, not silently applied", () => {
    const plan = planDesignRequirements({ anchorRole: "cds", host: "E. coli", goal: "we want secreted protein production", templates });
    assert.ok(!plan.requiredRoles.includes("signal"));
    assert.equal(plan.family, null);
    assert.match(plan.familyStatus, /NOT documented as supported for host "E\. coli"/);
  });

  test("a goal matching no supported category makes no requirement adjustment, and says so", () => {
    const plan = planDesignRequirements({ anchorRole: "cds", host: "E. coli", goal: "improve crop yield under drought stress", templates });
    assert.equal(plan.goalInterpretation.recognized, false);
    assert.ok(plan.rationale.some(r => r.includes("did not match")));
    // baseline unaffected
    for (const role of PROJECT_BASELINE_EXPRESSION_ROLES) assert.ok(plan.requiredRoles.includes(role));
  });

  test("a host with no matching template falls back to the project-baseline set only, honestly noted", () => {
    const plan = planDesignRequirements({ anchorRole: "cds", host: "S. cerevisiae", goal: "", templates });
    assert.deepEqual(plan.requiredRoles.sort(), [...PROJECT_BASELINE_EXPRESSION_ROLES].sort());
    assert.ok(plan.rationale.some(r => r.includes("No template") && r.includes("S. cerevisiae")));
  });

  test("every architecture family's supported-host evidence cites a real project or Registry data source", () => {
    for (const fam of Object.values(ARCHITECTURE_FAMILIES)) {
      for (const avail of Object.values(fam.hostAvailability)) {
        if (!avail.supported) continue;
        assert.match(avail.sourceReference, /data\/(templates|parts|registry_cache)\.json/, `family "${fam.id}" host evidence must cite a real data file`);
      }
    }
  });
});

describe("generateArchitectures: bounded beam search", () => {
  const requirementPlan = planDesignRequirements({ anchorRole: "cds", host: "E. coli", goal: "reporter expression", templates });

  test("candidate count is bounded by beamWidth, not a Cartesian product", () => {
    const withWidth3 = generateArchitectures({ requirementPlan, anchorPart: partsById["sg_GFP"], host: "E. coli", partsById, templates, beamWidth: 3 });
    assert.ok(withWidth3.length <= 3);
    const withWidth8 = generateArchitectures({ requirementPlan, anchorPart: partsById["sg_GFP"], host: "E. coli", partsById, templates, beamWidth: 8 });
    assert.ok(withWidth8.length <= 8);
  });

  test("beam width is configurable and actually changes output size", () => {
    const small = generateArchitectures({ requirementPlan, anchorPart: partsById["sg_GFP"], host: "E. coli", partsById, templates, beamWidth: 1 });
    assert.equal(small.length, 1);
  });

  test("the anchor is present, unmodified, in every generated candidate's assembled order", () => {
    const anchor = partsById["sg_GFP"];
    const candidates = generateArchitectures({ requirementPlan, anchorPart: anchor, host: "E. coli", partsById, templates, beamWidth: 5 });
    assert.ok(candidates.length > 0);
    for (const c of candidates) {
      const anchorEntry = c.plan.order.find(o => o.role === "cds");
      assert.ok(anchorEntry, "anchor's cds slot must be present");
      assert.equal(anchorEntry.id, anchor.id);
      assert.equal(anchorEntry.length, anchor.length);
    }
  });

  test("candidates are host-aware: no B. subtilis-only part appears in an E. coli-anchored architecture", () => {
    const candidates = generateArchitectures({ requirementPlan, anchorPart: partsById["sg_GFP"], host: "E. coli", partsById, templates, beamWidth: 5 });
    for (const c of candidates) {
      for (const o of c.plan.order) {
        // dn_* B. subtilis-specific parts (pUB110 ori, AmyE signal, PerR/PkatA promoters, etc.)
        // must never appear in an E. coli architecture's resolved parts.
        assert.ok(!/^dn_(pub110|amye|perr|pkata|rbs_st7)/.test(o.id || ""), `unexpected B. subtilis-flavored part "${o.id}" in an E. coli candidate`);
      }
    }
  });

  test("an optional role whose only local candidate is placeholder-evidence is omitted rather than dooming every candidate", () => {
    const bsubPlan = planDesignRequirements({ anchorRole: "cds", host: "B. subtilis", goal: "secreted expression", templates });
    assert.ok(bsubPlan.optionalRoles.includes("reporter"));
    const candidates = generateArchitectures({
      requirementPlan: bsubPlan, anchorPart: partsById["dn_lysqdvp001_endolysin"], host: "B. subtilis", partsById, templates, beamWidth: 5,
    });
    assert.ok(candidates.some(c => c.validation.valid), "at least one valid candidate must survive despite the placeholder-only reporter option");
    for (const c of candidates.filter(cc => cc.validation.valid)) {
      assert.ok(!c.plan.order.some(o => o.name === "sfGFP CDS"), "the placeholder-evidence reporter must never appear in a VALID candidate");
    }
  });
});

describe("multiple input roles investigation (item 7)", () => {
  test("role 'cds' is always well-posed as the sole locked component", () => {
    const result = runAutomaticDesign({ partId: "sg_GFP", host: "E. coli", goal: "reporter expression", partsById, templates, maxCandidates: 6 });
    assert.equal(result.generationSummary.beamSearch > 0, true);
  });

  // PHASE 4B: a non-cds anchor WITHOUT a locked CDS is still honestly declined
  // (not fabricated) -- unchanged in spirit from Phase 4A, message updated
  // since Phase 4B generalizes the underlying rule (see the next tests).
  //
  // PHASE 5B, item 5: this "decline" is now a structured, resumable
  // continuation (stage:"needsUserChoice") rather than a bare failure --
  // origin's own required-role set still (correctly) pulls in "promoter",
  // which designGrammar.js's "promoter-requires-cds-target" rule says is
  // itself underdetermined without a cds. The registered anchor is preserved
  // (characterized.input.anchorPart, unchanged) and requirementPlan is now
  // populated (the provisional plan computed to reach this determination),
  // not left null.
  test("a non-cds anchor role (origin) with NO locked CDS asks for the missing information rather than guessing", () => {
    const result = runAutomaticDesign({ partId: "sg_ori", host: "E. coli", goal: "x", partsById, templates, maxCandidates: 6 });
    assert.equal(result.ok, false); // no template accepts a user-supplied "origin" anchor either (Phase 1 behavior, unchanged)
    assert.equal(result.stage, "needsUserChoice");
    assert.equal(result.needsUserChoice.requiredRole, "cds");
    assert.equal(result.characterized.input.anchorPart.id, "sg_ori");
    assert.ok(result.requirementPlan.requiredRoles.includes("promoter"));
  });

  // PHASE 4B, Step 4: LOCKED COMPONENTS. A promoter anchor alone can never say
  // which gene to express -- Phase 4A correctly declined this case entirely.
  // Phase 4B instead asks for (rather than guesses) the missing CDS via
  // additionalLockedComponents, and once supplied, a real part-first design
  // problem becomes well-posed.
  test("a promoter-anchored workflow works once a locked CDS is supplied, and both locked parts appear unchanged in every candidate", () => {
    const promoterAnchor = partsById["sg_araBAD_promoter_(2)"];
    const lockedCds = partsById["sg_GFP"];
    const result = runAutomaticDesign({
      partId: promoterAnchor.id, role: "promoter", host: "E. coli", goal: "regulated expression",
      additionalLockedComponents: [{ role: "cds", partId: lockedCds.id }],
      partsById, templates, maxCandidates: 6, beamWidth: 5,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.lockedComponents.map(c => c.partId).sort(), [promoterAnchor.id, lockedCds.id].sort());
    const beamCandidates = result.candidates.all.filter(c => c.origin === "beam_search");
    assert.ok(beamCandidates.length > 0);
    for (const c of beamCandidates) {
      const promoterEntry = c.plan.order.find(o => o.role === "promoter");
      const cdsEntry = c.plan.order.find(o => o.role === "cds");
      assert.equal(promoterEntry.id, promoterAnchor.id);
      assert.equal(cdsEntry.id, lockedCds.id);
    }
    assert.ok(result.candidates.valid.some(c => c.origin === "beam_search"));
  });

  test("an RBS-anchored workflow works once a locked CDS is supplied", () => {
    const rbsAnchor = partsById["sg_RBS_(2)"];
    const lockedCds = partsById["sg_GFP"];
    const result = runAutomaticDesign({
      partId: rbsAnchor.id, role: "rbs", host: "E. coli", goal: "reporter expression",
      additionalLockedComponents: [{ role: "cds", partId: lockedCds.id }],
      partsById, templates, maxCandidates: 6, beamWidth: 5,
    });
    assert.equal(result.ok, true);
    const beamCandidates = result.candidates.all.filter(c => c.origin === "beam_search");
    assert.ok(beamCandidates.length > 0);
    for (const c of beamCandidates) {
      assert.equal(c.plan.order.find(o => o.role === "rbs").id, rbsAnchor.id);
      assert.equal(c.plan.order.find(o => o.role === "cds").id, lockedCds.id);
    }
  });

  test("a locked component must be a real catalog part -- an unknown id fails loudly rather than silently ignoring it", () => {
    const result = runAutomaticDesign({
      partId: "sg_araBAD_promoter_(2)", role: "promoter", host: "E. coli", goal: "regulated expression",
      additionalLockedComponents: [{ role: "cds", partId: "not_a_real_part_id" }],
      partsById, templates, maxCandidates: 6,
    });
    assert.equal(result.ok, false);
    assert.equal(result.stage, "characterizeInput");
    assert.ok(result.errors.some(e => e.includes("not_a_real_part_id")));
  });
});

describe("structured design goal (Step 3): goalFamily materially changes retrieval, not just the requirement plan", () => {
  test("constitutive_expression for E. coli retrieves the Registry-recorded constitutive promoter (BBa_J23100), not the host-curated INDUCIBLE promoters", () => {
    const result = runAutomaticDesign({
      partId: "sg_GFP", host: "E. coli", goalFamily: "constitutive_expression",
      partsById, templates, registryCache: registryCacheDoc, maxCandidates: 6, beamWidth: 5,
    });
    assert.equal(result.ok, true);
    assert.equal(result.requirementPlan.family.id, "constitutive_expression");
    const withRegistryPromoter = result.candidates.all.find(c => c.plan.order.some(o => o.id === "registry:BBa_J23100"));
    assert.ok(withRegistryPromoter, "expected at least one generated candidate to use the family-recommended constitutive promoter");
    // PHASE 4C CHANGE: this candidate is now hard-VALID. Before Phase 4C, every
    // Registry-recorded part was tagged evidence:"placeholder" (data/parts.json's
    // own 2-value schema has no other option) and validateCandidate() hard-rejected
    // ANY placeholder evidence -- conflating "a real, cited iGEM Registry sequence"
    // with "a genuinely unresolved catalog gap". provenanceModel.js now classifies
    // this part's provenanceStatus as "registry_recorded" (not "placeholder"), which
    // is explicitly NOT a hard-rejection ground -- it instead produces an honest
    // confidence warning. See the Phase 4C report for the full rationale.
    assert.equal(withRegistryPromoter.validation.valid, true);
    assert.ok(withRegistryPromoter.validation.warnings.some(w => w.includes("registry_recorded") && w.includes("not") && w.includes("verification")));
  });

  test("an unsupported host for a requested family is honestly declined, and does not use that family's recommendedPartIds at all", () => {
    const result = runAutomaticDesign({
      partId: "sg_pBBR1_Rep", role: "cds", host: "V. natriegens", goalFamily: "constitutive_expression",
      partsById, templates, registryCache: registryCacheDoc, maxCandidates: 6, beamWidth: 5,
    });
    assert.equal(result.requirementPlan.family, null);
    assert.match(result.requirementPlan.familyStatus, /NOT documented as supported for host "V\. natriegens"/);
  });
});

describe("existing downstream model is reused, not duplicated, for beam-search-origin candidates", () => {
  test("beam-search candidates flow through the same validateCandidate/scoreCandidate/Pareto/robustness pipeline as template candidates", () => {
    const result = runAutomaticDesign({
      partId: "sg_GFP", host: "E. coli", goal: "reporter expression",
      partsById, templates, registryCache: registryCacheDoc, maxCandidates: 6, beamWidth: 5, robustnessTrials: 300,
    });
    const beamRanked = result.scoring.ranked.filter(r => r.candidate.origin === "beam_search");
    assert.ok(beamRanked.length > 0, "at least one beam-search candidate must reach scoring");
    for (const r of beamRanked) {
      assert.equal(typeof r.overallScore, "number");
      assert.ok(r.registryComparison.length > 0, "Registry/reference comparison must run on generated candidates too");
      assert.ok(result.scoring.robustness.perCandidate[r.candidateId], "robustness analysis must cover beam-search candidates too");
      assert.ok(["pareto_optimal", undefined, true, false].includes(r.paretoOptimal) || typeof r.paretoOptimal === "boolean");
    }
  });
});

// ============================================================================
// DISCORD ACCEPTANCE TEST
// ============================================================================
// This is the explicit, named acceptance test for the team's original Discord
// requirement:
//
//   "A user puts in a DNA sequence or biological part and a whole plasmid is
//   built around that input, then the generated design is tested/compared
//   against plasmids in the iGEM Registry and other defensible references."
//
// It supplies ONLY a biological part, a role, a host, and a goal -- no
// template or backbone is named anywhere in the input -- and verifies every
// clause of the requirement end to end.
describe("DISCORD ACCEPTANCE TEST", () => {
  test("given only an anchor + role + host + goal (no template/backbone named), a complete plasmid is built around the anchor, with alternatives, hard rejection, and Registry comparison", () => {
    const input = {
      partId: "dn_lysqdvp001_endolysin", // a biological part (no `text`/raw-sequence field either)
      role: "cds",
      host: "B. subtilis",
      goal: "secreted expression",
      partsById, templates, registryCache: registryCacheDoc,
      maxCandidates: 6, beamWidth: 5, robustnessTrials: 300,
      // NOTE: deliberately no template/backbone/architecture field anywhere in this input.
    };
    assert.ok(!("template" in input) && !("templateId" in input) && !("backbone" in input), "test setup: the input must not name a template/backbone");

    const result = runAutomaticDesign(input);
    assert.equal(result.ok, true);

    // 1. the anchor remains unchanged
    const anchor = partsById["dn_lysqdvp001_endolysin"];
    for (const c of result.candidates.valid) {
      const anchorEntry = c.plan.order.find(o => o.role === "cds");
      assert.equal(anchorEntry.id, anchor.id);
      assert.equal(anchorEntry.length, anchor.length);
    }

    // 2. required surrounding roles were inferred (not template-selected)
    assert.ok(result.requirementPlan);
    for (const role of ["ori", "marker", "promoter", "rbs", "signal", "terminator"]) {
      assert.ok(result.requirementPlan.requiredRoles.includes(role), `expected "${role}" to be inferred as required`);
    }

    // 3. supporting parts were actually chosen (not left empty)
    const beamCandidate = result.candidates.all.find(c => c.origin === "beam_search");
    assert.ok(beamCandidate);
    assert.ok(beamCandidate.plan.order.length > 1, "more than just the anchor must be resolved");

    // 4. a complete candidate was produced
    assert.ok(result.candidates.valid.some(c => c.origin === "beam_search"), "at least one VALID, part-first-generated complete plasmid candidate");

    // 5. multiple alternatives can be produced
    const beamCandidates = result.candidates.all.filter(c => c.origin === "beam_search");
    assert.ok(beamCandidates.length > 1, "beam search must produce more than one alternative architecture");
    const distinctArchitectures = new Set(beamCandidates.map(c => c.plan.order.map(o => o.id).join(",")));
    assert.ok(distinctArchitectures.size > 1, "alternatives must be meaningfully different, not copies");

    // 6. hard-invalid designs are rejected (not silently included)
    // (bsub_delnorte's placeholder-laden template-based default is still generated and still rejected)
    const delnorteInvalid = result.candidates.invalid.find(c => c.templateId === "bsub_delnorte");
    assert.ok(delnorteInvalid, "a known-invalid design must still be generated and still rejected");
    assert.ok(!result.scoring.ranked.some(r => r.candidateId === delnorteInvalid.candidateId));

    // 7. Registry/reference comparison runs on the generated (beam-search) candidate
    const scoredBeam = result.scoring.ranked.find(r => r.candidate.origin === "beam_search");
    assert.ok(scoredBeam, "at least one beam-search candidate must be scored/ranked");
    assert.ok(Array.isArray(scoredBeam.registryComparison) && scoredBeam.registryComparison.length > 0);

    // Also confirm the whole downstream model (unchanged from Phases 1-3) still ran:
    assert.ok(result.recommended);
    assert.ok(result.scoring.robustness.recommended);
    assert.ok(["pareto_optimal", "dominated"].includes(result.scoring.robustness.recommended.paretoStatus) || result.scoring.robustness.recommended.paretoStatus === null);
  });
});

describe("Template-Guided Mode / ECC-relevant path unaffected by Phase 4A", () => {
  test("designer.js design() is untouched", () => {
    const ecoli = templates.find(t => t.id === "ecoli_inducible");
    const plan = design(ecoli, partsById, partsById["sg_GFP"]);
    assert.equal(plan.buildable, true);
  });
});
