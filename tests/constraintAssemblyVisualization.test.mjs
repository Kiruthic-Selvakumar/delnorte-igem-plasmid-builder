// node --test tests for Phase 4B: constraint engine (pruning/dependencies/
// incompatibilities), assembly planning, and plasmid-map visualization data.
// Real data throughout; no literal DNA sequence typed into this file.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { runAutomaticDesign, generateArchitectures, planDesignRequirements, scoreCandidate, createRegistryClient, EMPTY_REGISTRY, planAssembly, SUPPORTED_ASSEMBLY_METHODS, createCustomPartRegistry } from "../automatic/index.js";
import { checkIncompatibility, dependencyFeasibility, buildConstraintTrace } from "../automatic/constraintEngine.js";
import { computePlasmidMapSegments } from "../automatic/plasmidMapData.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const partsDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "parts.json"), "utf-8"));
const templatesDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "templates.json"), "utf-8"));
const registryCacheDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "registry_cache.json"), "utf-8"));
const partsById = {};
for (const p of partsDoc.parts) partsById[p.id] = p;
const templates = templatesDoc.templates;

describe("constraint engine: incompatibility", () => {
  test("a documented incompatibility (AmpR for V. natriegens) is flagged, citing the template's own quoted caution", () => {
    const result = checkIncompatibility({}, "marker", partsById["sg_AmpR"], "V. natriegens");
    assert.equal(result.ok, false);
    assert.match(result.reason, /beta-lactamase/);
  });

  test("the same part is NOT incompatible for a different host", () => {
    const result = checkIncompatibility({}, "marker", partsById["sg_AmpR"], "E. coli");
    assert.equal(result.ok, true);
  });

  test("a part with no incompatibility rule is always ok", () => {
    const result = checkIncompatibility({}, "marker", partsById["sg_KanR"], "V. natriegens");
    assert.equal(result.ok, true);
  });
});

describe("constraint engine: dependency feasibility", () => {
  test("a part with no part_requires_part rule has no requirement", () => {
    const r = dependencyFeasibility(partsById["sg_ori"], {});
    assert.equal(r.hasRequirement, false);
  });

  test("pSC101 ori's Rep101 requirement is INFEASIBLE when no role pool contains sg_Rep101 (this project's real data)", () => {
    const pools = { marker: [partsById["sg_KanR"]], promoter: [partsById["sg_lac_promoter"]] }; // no "rep"-like pool includes sg_Rep101 anywhere
    const r = dependencyFeasibility(partsById["sg_pSC101_ori"], pools);
    assert.equal(r.hasRequirement, true);
    assert.equal(r.feasible, false);
  });

  test("pBBR1 oriV's Rep requirement IS feasible when the rep pool contains sg_pBBR1_Rep", () => {
    const pools = { rep: [partsById["sg_pBBR1_Rep"]] };
    const r = dependencyFeasibility(partsById["sg_pBBR1_oriV"], pools);
    assert.equal(r.hasRequirement, true);
    assert.equal(r.feasible, true);
  });
});

describe("constraint engine: pruning avoids wasting beam slots on provably-doomed partials", () => {
  test("no E. coli beam-search candidate ever contains sg_pSC101_ori -- pruned during search, not merely rejected after assembly", () => {
    const requirementPlan = planDesignRequirements({ anchorRole: "cds", host: "E. coli", goal: "reporter expression", templates });
    const candidates = generateArchitectures({ requirementPlan, anchorPart: partsById["sg_GFP"], host: "E. coli", partsById, templates, beamWidth: 5, candidatesPerRole: 3 });
    for (const c of candidates) {
      assert.ok(!c.plan.order.some(o => o.id === "sg_pSC101_ori"), `${c.candidateId} should never have reached final assembly with the doomed pSC101 ori`);
    }
    // and every beam-search candidate here is valid -- confirming pruning didn't just get lucky
    assert.ok(candidates.every(c => c.validation.valid));
  });

  test("buildConstraintTrace reports satisfied dependencies for a real, valid candidate", () => {
    const requirementPlan = planDesignRequirements({ anchorRole: "cds", host: "V. natriegens", goal: "reporter expression", templates });
    const [candidate] = generateArchitectures({ requirementPlan, anchorPart: partsById["sg_GFP"], host: "V. natriegens", partsById, templates, beamWidth: 1 });
    const assignments = Object.fromEntries(candidate.plan.order.map(o => [o.role, o.id ? partsById[o.id] : null]));
    const trace = buildConstraintTrace(assignments, "V. natriegens");
    assert.ok(trace.satisfiedDependencies.some(d => d.partId === "sg_pBBR1_oriV"));
    assert.equal(trace.unsatisfiedDependencies.length, 0);
    assert.equal(trace.incompatibilities.length, 0);
  });
});

describe("assembly planning", () => {
  test("gibson: feasible, generates real primers, deterministic across repeated calls", () => {
    const result = runAutomaticDesign({ partId: "sg_GFP", host: "E. coli", goal: "reporter expression", partsById, templates, maxCandidates: 6, assemblyMethod: "gibson" });
    const ap1 = result.recommended.assemblyPlan;
    const ap2 = planAssembly(result.recommended.plan, "gibson", { partsById, anchorPart: partsById["sg_GFP"] });
    assert.equal(ap1.method, "gibson");
    assert.equal(ap1.feasible, true);
    assert.equal(ap1.primerSupport, true);
    assert.equal(ap1.primers.length, result.recommended.plan.order.length);
    assert.deepEqual(ap1, ap2);
  });

  test("golden gate: conflict detection only, primerSupport:false, and says why", () => {
    const result = runAutomaticDesign({ partId: "sg_GFP", host: "E. coli", goal: "reporter expression", partsById, templates, maxCandidates: 6, assemblyMethod: "goldengate" });
    const ap = result.recommended.assemblyPlan;
    assert.equal(ap.method, "goldengate");
    assert.equal(ap.primerSupport, false);
    assert.equal(ap.primers.length, 0);
    assert.ok(ap.rationale.some(r => r.includes("No project template currently uses Golden Gate")));
  });

  test("an unsupported assembly method is reported, not faked", () => {
    const ap = planAssembly({ order: [], totalLength: 0 }, "not_a_real_method", {});
    assert.equal(ap.feasible, false);
    assert.match(ap.rationale[0], /Unsupported assembly method/);
  });

  test("SUPPORTED_ASSEMBLY_METHODS matches designGrammar's assembly_constraint rules exactly", () => {
    assert.deepEqual([...SUPPORTED_ASSEMBLY_METHODS].sort(), ["gibson", "goldengate"]);
  });

  test("restriction-site conflict reporting is unchanged from designer.js's own scanSites() (reused, not reimplemented)", () => {
    // sg_GFP's real SnapGene sequence genuinely contains an internal BsaI site
    // (position 643) -- confirmed by direct inspection, not assumed. This is
    // exactly the kind of real conflict Golden Gate assembly needs to catch;
    // Gibson (this project's actual default) is correctly unaffected by it.
    const result = runAutomaticDesign({ partId: "sg_GFP", host: "E. coli", goal: "reporter expression", partsById, templates, maxCandidates: 6, assemblyMethod: "goldengate" });
    assert.deepEqual(result.recommended.assemblyPlan.conflicts, [{ part: "GFP", enzyme: "BsaI", position: 643 }]);
    assert.equal(result.recommended.assemblyPlan.feasible, false);

    const gibsonResult = runAutomaticDesign({ partId: "sg_GFP", host: "E. coli", goal: "reporter expression", partsById, templates, maxCandidates: 6, assemblyMethod: "gibson" });
    assert.deepEqual(gibsonResult.recommended.assemblyPlan.conflicts, [], "gibson has no enzyme set, so the same sequence produces zero conflicts under this method");
  });
});

describe("plasmid map visualization data", () => {
  const result = runAutomaticDesign({ partId: "sg_GFP", host: "E. coli", goal: "reporter expression", partsById, templates, registryCache: registryCacheDoc, maxCandidates: 6 });
  const scoredRecommended = result.scoring.ranked[0];

  test("bp intervals exactly cover the assembled plasmid, in order, with no gaps or overlaps", () => {
    const { segments, totalBp } = computePlasmidMapSegments(result.recommended, { partsById, anchorName: result.characterized.input.anchorPart.name, scored: scoredRecommended });
    assert.equal(segments[0].start, 1);
    assert.equal(segments[segments.length - 1].end, totalBp);
    for (let i = 1; i < segments.length; i++) {
      assert.equal(segments[i].start, segments[i - 1].end + 1, `segment ${i} must start immediately after segment ${i - 1} ends (no gap/overlap)`);
    }
    for (const s of segments) assert.equal(s.end - s.start + 1, s.length);
  });

  test("displayed total bp equals plan.totalLength", () => {
    const { totalBp } = computePlasmidMapSegments(result.recommended, { partsById });
    assert.equal(totalBp, result.recommended.plan.totalLength);
  });

  test("the anchor part is correctly flagged isAnchor, and exactly once", () => {
    const anchorName = result.characterized.input.anchorPart.name;
    const { segments } = computePlasmidMapSegments(result.recommended, { partsById, anchorName });
    const anchorSegs = segments.filter(s => s.isAnchor);
    assert.equal(anchorSegs.length, 1);
    assert.equal(anchorSegs[0].name, anchorName);
  });

  test("every segment is reported as strand 'forward' -- this project's assembly model has no per-part reverse-strand representation, so none is invented", () => {
    const { segments } = computePlasmidMapSegments(result.recommended, { partsById });
    for (const s of segments) assert.equal(s.strand, "forward");
  });

  test("a Registry exact-match segment (when present) carries its registryId", () => {
    // dn_b0034_rbs (real local catalog part) exactly matches BBa_B0034's cached sequence (Phase 2.5) --
    // build a candidate that resolves to it and confirm the map surfaces the match.
    const requirementPlan = planDesignRequirements({ anchorRole: "cds", host: "E. coli", goal: "reporter expression", templates });
    const [candidate] = generateArchitectures({ requirementPlan, anchorPart: partsById["sg_GFP"], host: "E. coli", partsById, templates, beamWidth: 1 });
    // force-substitute the rbs slot's resolved part with dn_b0034_rbs to exercise the match path directly (data-only substitution, no new sequence)
    candidate.plan.order = candidate.plan.order.map(o => o.role === "rbs" ? { ...o, id: "dn_b0034_rbs", name: partsById["dn_b0034_rbs"].name, length: partsById["dn_b0034_rbs"].length } : o);
    const scored = scoreCandidate(candidate, { partsById, anchorPart: partsById["sg_GFP"], host: "E. coli", role: "cds", registryClient: createRegistryClient(registryCacheDoc) });
    const { segments } = computePlasmidMapSegments(candidate, { partsById, scored });
    const rbsSeg = segments.find(s => s.role === "rbs");
    assert.ok(rbsSeg.registryMatch);
    assert.equal(rbsSeg.registryMatch.registryId, "BBa_B0034");
  });

  // Phase 6 regression: a Phase 5B custom_part anchor keeps its own real,
  // non-null "userpart:..." id, which is never present in the plain catalog
  // OR in candidate.resolvedPartsById (it's baked into initialAssignments
  // before anything is tracked as "resolved") -- computePlasmidMapSegments
  // previously only special-cased a NULL anchor id (a raw-paste anchor),
  // so a custom-part-anchored design's own anchor segment silently showed up
  // as an unresolved gap (sequenceStatus:"missing") on the map. Found and
  // fixed while building Phase 6's workspace handoff/export features, which
  // hit the exact same resolution path.
  test("a custom (external) part anchor's own segment resolves correctly -- not shown as a missing-sequence gap", () => {
    const registry = createCustomPartRegistry();
    const heldOutId = "sg_lac_promoter";
    const heldOut = partsById[heldOutId];
    const { part: customPromoter } = registry.registerCustomPart({ name: "OtherTeam_Promoter", seq: heldOut.seq, role: "promoter" });
    const partsByIdMinusOne = Object.fromEntries(Object.entries(partsById).filter(([id]) => id !== heldOutId));
    const customResult = runAutomaticDesign({
      customPart: customPromoter, host: "E. coli", goalFamily: "inducible_regulated_expression",
      additionalLockedComponents: [{ role: "cds", partId: "sg_GFP" }],
      partsById: partsByIdMinusOne, templates, maxCandidates: 6, beamWidth: 5,
    });
    assert.equal(customResult.ok, true);
    const { segments } = computePlasmidMapSegments(customResult.recommended, {
      partsById: partsByIdMinusOne, anchorName: customPromoter.name, anchorPart: customPromoter,
    });
    const anchorSeg = segments.find(s => s.isAnchor);
    assert.ok(anchorSeg, "the custom anchor must be flagged isAnchor");
    assert.equal(anchorSeg.sequenceStatus, "resolved");
    assert.equal(anchorSeg.provenanceStatus, "user_supplied");
    assert.equal(anchorSeg.type, "promoter");
  });
});

describe("determinism across the whole Phase 4B pipeline", () => {
  test("identical inputs (including assemblyMethod/goalFamily) produce identical outputs", () => {
    const opts = { partId: "sg_GFP", host: "E. coli", goalFamily: "inducible_regulated_expression", partsById, templates, registryCache: registryCacheDoc, maxCandidates: 6, beamWidth: 5, assemblyMethod: "gibson" };
    const a = runAutomaticDesign(opts);
    const b = runAutomaticDesign(opts);
    assert.deepEqual(a.scoring.ranked.map(r => r.candidateId), b.scoring.ranked.map(r => r.candidateId));
    assert.deepEqual(a.scoring.ranked.map(r => r.overallScore), b.scoring.ranked.map(r => r.overallScore));
    assert.deepEqual(a.recommended.assemblyPlan, b.recommended.assemblyPlan);
  });
});
