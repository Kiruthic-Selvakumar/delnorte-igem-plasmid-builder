// node --test tests for Phase 2.5: the curated Registry cache, registrySupport
// scoring, and reference comparison.
//
// These tests validate data/registry_cache.json's STRUCTURE and PROVENANCE
// FIELDS (every record carries a sourceUrl under registry.igem.org, a uuid,
// and a fetchedAt), and exercise the scoring/comparison code against it. They
// do NOT re-hit the live Registry API -- that would make `node --test` flaky
// and network-dependent, which this project's existing tests deliberately
// avoid (see benchmark/README.md's own "frozen input" philosophy). The actual
// live retrieval, with fail-loud exact-ID verification against the official
// API, is scripts/refresh_registry_cache.mjs -- run that (and re-run these
// tests afterward) to re-verify against the live Registry.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { design } from "../designer.js";
import {
  runAutomaticDesign, scoreCandidate, rankCandidates, computeParetoFront,
  createRegistryClient, EMPTY_REGISTRY, generateCandidates,
} from "../automatic/index.js";
import { mapRegistryRole } from "../automatic/registryClient.js";
import { compareToReferences, findExactRegistryMatches, roleOrderSimilarity } from "../automatic/referenceComparison.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const partsDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "parts.json"), "utf-8"));
const templatesDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "templates.json"), "utf-8"));
const registryCacheDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "registry_cache.json"), "utf-8"));
const partsById = {};
for (const p of partsDoc.parts) partsById[p.id] = p;
const templates = templatesDoc.templates;

const LOCAL_ROLES = ["promoter", "operator", "rbs", "cds", "signal", "terminator", "marker", "origin", "orit", "other"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("registry_cache.json schema and provenance", () => {
  test("cache header carries source API and fetch timestamp", () => {
    assert.equal(registryCacheDoc.sourceApi, "https://api.registry.igem.org");
    assert.ok(!Number.isNaN(new Date(registryCacheDoc.fetchedAt).getTime()));
    assert.equal(registryCacheDoc.parts.length, 7);
    assert.equal(registryCacheDoc.constructs.length, 4);
  });

  test("every cached part has a well-formed schema and registry.igem.org provenance", () => {
    for (const p of registryCacheDoc.parts) {
      assert.ok(p.registryId && typeof p.registryId === "string");
      assert.match(p.uuid, UUID_RE);
      assert.ok(p.slug);
      assert.ok(p.title);
      assert.ok(p.role);
      assert.match(p.roleSO, /^SO:\d+$/);
      assert.ok(LOCAL_ROLES.includes(p.mappedLocalRole), `mappedLocalRole "${p.mappedLocalRole}" for ${p.registryId} must be one of this project's role vocabulary`);
      assert.match(p.sequence, /^[ACGTN]+$/);
      assert.equal(p.length, p.sequence.length);
      assert.ok(p.chassis && Array.isArray(p.chassis.designedFor) && Array.isArray(p.chassis.characterisedIn) && Array.isArray(p.chassis.sourceOrganism));
      assert.ok(p.compatibility && p.compatibility.rfc10 && p.compatibility.rfc1000);
      assert.equal(typeof p.usageCount, "number");
      assert.ok(!Number.isNaN(new Date(p.createdAt).getTime()));
      assert.ok(!Number.isNaN(new Date(p.updatedAt).getTime()));
      assert.match(p.sourceUrl, /^https:\/\/registry\.igem\.org\/parts\//);
      assert.ok(!Number.isNaN(new Date(p.fetchedAt).getTime()));
      assert.equal(p.provenanceStatus, "registry_recorded");
      assert.equal(typeof p.establishedReference, "boolean");
    }
  });

  test("every cached construct has a well-formed schema, ordered composition, and registry.igem.org provenance", () => {
    for (const c of registryCacheDoc.constructs) {
      assert.ok(c.registryId);
      assert.match(c.uuid, UUID_RE);
      assert.ok(c.title);
      assert.ok(typeof c.sequenceLength === "number" && c.sequenceLength > 0);
      assert.ok(c.chassis);
      assert.ok(Array.isArray(c.composition) && c.composition.length > 0);
      for (const comp of c.composition) {
        assert.ok(comp.componentRegistryId);
        assert.ok(comp.role);
        assert.match(comp.roleSO, /^SO:|^IGEM:/);
        assert.equal(typeof comp.start, "number");
        assert.equal(typeof comp.end, "number");
      }
      // composition is stored start-ascending (the refresh script sorts it) -- verify, since
      // downstream role-order comparisons depend on this being the real 5'->3' order.
      for (let i = 1; i < c.composition.length; i++) assert.ok(c.composition[i].start >= c.composition[i - 1].start);
      assert.deepEqual(c.knownParts, c.composition.map(x => x.componentRegistryId));
      assert.deepEqual(c.architectureRoles, c.composition.map(x => x.role));
      assert.match(c.sourceUrl, /^https:\/\/registry\.igem\.org\/parts\//);
      assert.ok(!Number.isNaN(new Date(c.fetchedAt).getTime()));
    }
  });

  test("no cached record's establishedReference silently claims biological verification -- provenanceStatus is always the distinct registry_recorded tag, never this project's local evidence:verified", () => {
    for (const p of registryCacheDoc.parts) {
      assert.equal(p.provenanceStatus, "registry_recorded");
      assert.notEqual(p.provenanceStatus, "verified");
    }
  });
});

describe("mapRegistryRole", () => {
  test("maps every cached construct's documented component role labels to this project's local vocabulary", () => {
    for (const c of registryCacheDoc.constructs) {
      for (const label of c.architectureRoles) {
        const mapped = mapRegistryRole(label);
        assert.ok(mapped === null || LOCAL_ROLES.includes(mapped), `"${label}" maps to "${mapped}", not a recognized local role`);
      }
    }
  });
});

describe("exact Registry part matching", () => {
  test("a real local catalog part (dn_b0034_rbs) exactly matches BBa_B0034's cached sequence", () => {
    const client = createRegistryClient(registryCacheDoc);
    const hit = client.findPartBySequence(partsById["dn_b0034_rbs"].seq);
    assert.equal(hit.ok, true);
    assert.equal(hit.part.registryId, "BBa_B0034");
  });

  test("a sequence with no cached match returns ok:false, not a guess", () => {
    const client = createRegistryClient(registryCacheDoc);
    const hit = client.findPartBySequence(partsById["sg_GFP"].seq);
    assert.equal(hit.ok, false);
  });

  test("findExactRegistryMatches finds dn_b0034_rbs's match when it appears in a candidate's resolved parts", () => {
    const client = createRegistryClient(registryCacheDoc);
    const fakePlan = { order: [{ role: "rbs", name: "dn_b0034_rbs", id: "dn_b0034_rbs", length: 12 }] };
    const matches = findExactRegistryMatches(fakePlan, partsById, null, client);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].registryId, "BBa_B0034");
  });
});

describe("chassis agreement: unknown vs mismatch vs agree", () => {
  test("every one of our 4 cached reference constructs documents no chassis, so chassis agreement is 'unknown' for all of them, never 'mismatch'", () => {
    const client = createRegistryClient(registryCacheDoc);
    const ecoli = templates.find(t => t.id === "ecoli_inducible");
    const [candidate] = generateCandidates([ecoli], partsById["sg_GFP"], partsById, { maxCandidates: 1 });
    const comparisons = compareToReferences(candidate, registryCacheDoc.constructs, { partsById, anchorPart: partsById["sg_GFP"], host: "E. coli", registryClient: client });
    assert.equal(comparisons.length, 4);
    for (const c of comparisons) assert.equal(c.chassisAgreement, "unknown");
  });
});

describe("roleOrderSimilarity", () => {
  test("identical role sequences score 1", () => {
    assert.equal(roleOrderSimilarity(["promoter", "rbs", "cds", "terminator"], ["promoter", "rbs", "cds", "terminator"]), 1);
  });
  test("a subsequence scores proportionally, not zero", () => {
    const s = roleOrderSimilarity(["origin", "marker", "promoter", "rbs", "cds", "terminator"], ["promoter", "rbs", "cds", "terminator"]);
    assert.ok(s > 0.5 && s < 1);
  });
  test("disjoint sequences score 0", () => {
    assert.equal(roleOrderSimilarity(["origin", "marker"], ["promoter", "terminator"]), 0);
  });
});

describe("registrySupport reflects real Registry evidence", () => {
  test("registrySupport is null with EMPTY_REGISTRY and non-null with the real cache, for the identical candidate", () => {
    const ecoli = templates.find(t => t.id === "ecoli_inducible");
    const [candidate] = generateCandidates([ecoli], partsById["sg_GFP"], partsById, { maxCandidates: 1 });
    const ctxBase = { partsById, anchorPart: partsById["sg_GFP"], host: "E. coli", role: "cds" };

    const withoutRegistry = scoreCandidate(candidate, { ...ctxBase, registryClient: createRegistryClient(EMPTY_REGISTRY) });
    const withRegistry = scoreCandidate(candidate, { ...ctxBase, registryClient: createRegistryClient(registryCacheDoc) });

    assert.equal(withoutRegistry.breakdown.registrySupport, null);
    assert.notEqual(withRegistry.breakdown.registrySupport, null);
    assert.ok(withRegistry.breakdown.registrySupport > 0, "ecoli_inducible's promoter->rbs->cds->terminator cassette shares role-order structure with the cached reporter-generator references");
    assert.ok(withRegistry.registryComparison.length === 4);
  });

  test("registrySupport does not affect any other sub-score (only overallScore and weightUsed change)", () => {
    const ecoli = templates.find(t => t.id === "ecoli_inducible");
    const [candidate] = generateCandidates([ecoli], partsById["sg_GFP"], partsById, { maxCandidates: 1 });
    const ctxBase = { partsById, anchorPart: partsById["sg_GFP"], host: "E. coli", role: "cds" };
    const withoutRegistry = scoreCandidate(candidate, { ...ctxBase, registryClient: createRegistryClient(EMPTY_REGISTRY) });
    const withRegistry = scoreCandidate(candidate, { ...ctxBase, registryClient: createRegistryClient(registryCacheDoc) });
    for (const dim of ["functionalCompleteness", "assemblyFeasibility", "verifiedPartSupport", "architectureEvidence", "sequenceQuality"]) {
      assert.equal(withoutRegistry.breakdown[dim], withRegistry.breakdown[dim]);
    }
  });
});

describe("Registry evidence cannot rescue a hard-invalid candidate", () => {
  test("bsub_delnorte's placeholder-laden default stays rejected and unscored, with or without the Registry cache loaded", () => {
    for (const cache of [EMPTY_REGISTRY, registryCacheDoc]) {
      const result = runAutomaticDesign({
        partId: "dn_lysqdvp001_endolysin", host: "B. subtilis", goal: "coral pathogen control",
        partsById, templates, maxCandidates: 6, registryCache: cache,
      });
      const delnorteInvalid = result.candidates.invalid.find(c => c.templateId === "bsub_delnorte" && c.variedSlot === null);
      assert.ok(delnorteInvalid, "must still be generated and rejected");
      assert.ok(!result.scoring.ranked.some(r => r.candidateId === delnorteInvalid.candidateId));
    }
  });

  test("the ecoli pSC101/Rep101 swap stays rejected and unscored with the real Registry cache loaded", () => {
    const result = runAutomaticDesign({
      partId: "sg_GFP", host: "E. coli", goal: "reporter expression",
      partsById, templates, maxCandidates: 6, registryCache: registryCacheDoc,
    });
    assert.equal(result.candidates.invalid.length, 1);
    assert.equal(result.candidates.invalid[0].candidateId, "ecoli_inducible__swap-ori-sg_pSC101_ori");
    assert.ok(!result.scoring.ranked.some(r => r.candidateId === "ecoli_inducible__swap-ori-sg_pSC101_ori"));
  });
});

describe("determinism with the real Registry cache loaded", () => {
  test("ranking order is identical across repeated runs of the same input", () => {
    const run = () => runAutomaticDesign({
      partId: "sg_GFP", host: "E. coli", goal: "reporter expression",
      partsById, templates, maxCandidates: 6, registryCache: registryCacheDoc,
    });
    const a = run(), b = run();
    assert.deepEqual(a.scoring.ranked.map(r => r.candidateId), b.scoring.ranked.map(r => r.candidateId));
    assert.deepEqual(a.scoring.ranked.map(r => r.overallScore), b.scoring.ranked.map(r => r.overallScore));
  });

  test("computeParetoFront over real Registry-backed scores is stable across repeated calls", () => {
    const ecoli = templates.find(t => t.id === "ecoli_inducible");
    const candidates = generateCandidates([ecoli], partsById["sg_GFP"], partsById, { maxCandidates: 6 }).filter(c => c.validation.valid);
    const score = c => ({ candidateId: c.candidateId, candidate: c, ...scoreCandidate(c, { partsById, anchorPart: partsById["sg_GFP"], host: "E. coli", role: "cds", registryClient: createRegistryClient(registryCacheDoc) }) });
    const front1 = computeParetoFront(candidates.map(score));
    const front2 = computeParetoFront(candidates.map(score));
    assert.deepEqual(front1, front2);
  });
});

describe("Phase 1 / Phase 2 / ECC regressions", () => {
  test("Template-Guided Mode's design() is unaffected by the Registry cache existing on disk", () => {
    const ecoli = templates.find(t => t.id === "ecoli_inducible");
    const plan = design(ecoli, partsById, partsById["sg_GFP"]);
    assert.equal(plan.buildable, true);
  });
});
