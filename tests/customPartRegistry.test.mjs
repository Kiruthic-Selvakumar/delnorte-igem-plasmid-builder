// node --test for Phase 5B, item 7: deterministic unit tests for the
// session-local custom (external) part registry (automatic/customPartRegistry.js).
// No literal DNA sequence is typed into this file -- every sequence used here
// is read from data/parts.json (a real, already-catalogued part), used only
// to exercise the registry's own logic (never written back to any file).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { createCustomPartRegistry, normalizeCustomPartRole, SUPPORTED_CUSTOM_PART_ROLES } from "../automatic/customPartRegistry.js";
import { classifyProvenance } from "../automatic/provenanceModel.js";
import { runAutomaticDesign } from "../automatic/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const partsDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "parts.json"), "utf-8"));
const templatesDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "templates.json"), "utf-8"));
const partsById = {};
for (const p of partsDoc.parts) partsById[p.id] = p;
const templates = templatesDoc.templates;

const REAL_CDS_SEQ = partsById["sg_GFP"].seq;
const REAL_PROMOTER_SEQ = partsById["sg_lac_promoter"].seq;

describe("normalizeCustomPartRole", () => {
  test("accepts every supported role verbatim, case-insensitively, with surrounding whitespace", () => {
    for (const role of SUPPORTED_CUSTOM_PART_ROLES) {
      assert.equal(normalizeCustomPartRole(role), role);
      assert.equal(normalizeCustomPartRole(` ${role.toUpperCase()} `), role);
    }
  });

  test("accepts the one real internal/UI spelling alias ('ori' -> 'origin') without inferring anything from sequence", () => {
    assert.equal(normalizeCustomPartRole("ori"), "origin");
    assert.equal(normalizeCustomPartRole("ORI"), "origin");
  });

  test("returns null for an unrecognized role rather than guessing", () => {
    assert.equal(normalizeCustomPartRole("chaperone"), null);
    assert.equal(normalizeCustomPartRole(""), null);
    assert.equal(normalizeCustomPartRole(undefined), null);
  });
});

describe("registerCustomPart", () => {
  test("registers a real held-out sequence under a fake external-team name and returns a fully-shaped part object", () => {
    const registry = createCustomPartRegistry();
    const res = registry.registerCustomPart({ name: "OtherTeam_ReporterX", seq: REAL_CDS_SEQ, role: "cds", sourceTeam: "OtherTeam", description: "A reporter CDS from another team." });
    assert.equal(res.ok, true);
    assert.equal(res.duplicateOfId, null);
    const part = res.part;
    assert.ok(part.id.startsWith("userpart:cds-"));
    assert.equal(part.name, "OtherTeam_ReporterX");
    assert.equal(part.type, "cds");
    assert.equal(part.seq, REAL_CDS_SEQ.toUpperCase());
    assert.equal(part.length, REAL_CDS_SEQ.length);
    assert.equal(part.evidence, "placeholder"); // never "verified" -- CLAUDE.md
    assert.ok(part.customPartProvenance);
    assert.equal(part.customPartProvenance.sourceTeam, "OtherTeam");
  });

  test("classifies a registered custom part as provenanceStatus:user_supplied, sequenceStatus:resolved -- never project_verified or registry_recorded", () => {
    const registry = createCustomPartRegistry();
    const { part } = registry.registerCustomPart({ name: "OtherTeam_Origin", seq: partsById["sg_pBBR1_oriV"].seq, role: "origin" });
    const cls = classifyProvenance(part);
    assert.equal(cls.sequenceStatus, "resolved");
    assert.equal(cls.provenanceStatus, "user_supplied");
  });

  test("never invents a Registry ID -- registryIdClaimed is null unless the caller explicitly supplies one, and is stored as a claim, not a verified match", () => {
    const registry = createCustomPartRegistry();
    const { part: withoutClaim } = registry.registerCustomPart({ name: "A", seq: REAL_CDS_SEQ, role: "cds" });
    assert.equal(withoutClaim.customPartProvenance.registryIdClaimed, null);
    const { part: withClaim } = registry.registerCustomPart({ name: "B", seq: REAL_PROMOTER_SEQ, role: "promoter", registryIdClaimed: "BBa_FAKE123" });
    assert.equal(withClaim.customPartProvenance.registryIdClaimed, "BBa_FAKE123");
    assert.equal(withClaim.evidence, "placeholder"); // a claimed id never upgrades evidence
  });

  test("rejects registration with a clear error when name is missing", () => {
    const registry = createCustomPartRegistry();
    const res = registry.registerCustomPart({ seq: REAL_CDS_SEQ, role: "cds" });
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => /name/i.test(e)));
  });

  test("rejects registration with a clear error when role is unrecognized -- never guesses a role from sequence", () => {
    const registry = createCustomPartRegistry();
    const res = registry.registerCustomPart({ name: "A", seq: REAL_CDS_SEQ, role: "not-a-real-role" });
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => /role/i.test(e)));
  });

  test("rejects registration with a clear error when the sequence is not valid DNA", () => {
    const registry = createCustomPartRegistry();
    const res = registry.registerCustomPart({ name: "A", seq: "not dna at all !!", role: "cds" });
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => /DNA/i.test(e)));
  });

  test("duplicate detection: re-registering the exact same (sequence, role) -- even under a different name -- returns the SAME entry rather than creating a redundant one", () => {
    const registry = createCustomPartRegistry();
    const first = registry.registerCustomPart({ name: "TeamA_Gene", seq: REAL_CDS_SEQ, role: "cds" });
    const second = registry.registerCustomPart({ name: "TeamB_SameGeneDifferentName", seq: REAL_CDS_SEQ, role: "cds" });
    assert.equal(second.duplicateOfId, first.part.id);
    assert.equal(second.part.id, first.part.id);
    assert.equal(registry.listCustomParts().length, 1);
  });

  test("the SAME sequence registered under a DIFFERENT declared role must NOT silently merge into the same entry", () => {
    const registry = createCustomPartRegistry();
    const asCds = registry.registerCustomPart({ name: "TeamA_X", seq: REAL_CDS_SEQ, role: "cds" });
    const asPromoter = registry.registerCustomPart({ name: "TeamA_X", seq: REAL_CDS_SEQ, role: "promoter" });
    assert.notEqual(asCds.part.id, asPromoter.part.id);
    assert.equal(asPromoter.duplicateOfId, null);
    assert.equal(registry.listCustomParts().length, 2);
  });

  test("id generation is deterministic: the same {name, role, sequence} always yields the same id, even across separate registry instances", () => {
    const a = createCustomPartRegistry().registerCustomPart({ name: "SameName", seq: REAL_CDS_SEQ, role: "cds" });
    const b = createCustomPartRegistry().registerCustomPart({ name: "SameName", seq: REAL_CDS_SEQ, role: "cds" });
    assert.equal(a.part.id, b.part.id);
  });

  test("custom part ids never collide with the real catalog's id namespace or the Registry-insertion namespace", () => {
    const registry = createCustomPartRegistry();
    const { part } = registry.registerCustomPart({ name: "X", seq: REAL_CDS_SEQ, role: "cds" });
    assert.ok(part.id.startsWith("userpart:"));
    assert.equal(partsById[part.id], undefined);
    assert.ok(!part.id.startsWith("registry:"));
  });
});

describe("a registered custom part's TYPE-vocabulary role reaches runAutomaticDesign correctly (regression: origin/ori mismatch)", () => {
  // customPartRegistry.js registers roles in the external TYPE vocabulary
  // ("origin"), while the internal beam-search role vocabulary spells it
  // "ori" (see characterizeInput.js's TYPE_TO_INTERNAL_ROLE). A custom origin
  // part used as the PRIMARY ANCHOR goes through characterizeInput.js
  // directly and was already covered elsewhere -- this specifically covers
  // the OTHER path: a custom origin part supplied as an ADDITIONAL LOCKED
  // COMPONENT (e.g. via the UI's "register custom part" option in the
  // additional-locked-components section), which bypasses characterizeInput.js
  // entirely and must be mapped in automatic/index.js's own
  // additionalLockedComponents loop instead.
  test("a custom part registered under role 'origin' and locked as an ADDITIONAL component resolves to the internal 'ori' role, not a dangling 'origin' role", () => {
    const registry = createCustomPartRegistry();
    const { part: customOrigin } = registry.registerCustomPart({ name: "OtherTeam_Ori", seq: partsById["sg_2u_ori"].seq, role: "origin" });
    assert.equal(customOrigin.type, "origin"); // stored in the external TYPE spelling, as registered

    const result = runAutomaticDesign({
      partId: "sg_GFP", host: "E. coli", goalFamily: "inducible_regulated_expression",
      additionalLockedComponents: [{ role: "origin", customPart: customOrigin }],
      partsById, templates, maxCandidates: 6, beamWidth: 5,
    });

    assert.equal(result.stage, "done", JSON.stringify(result).slice(0, 400));
    assert.equal(result.ok, true);
    assert.ok(result.candidates.valid.length > 0);
    // The custom origin must actually occupy the "ori" role slot in every
    // BEAM-SEARCH candidate -- not be silently ignored as an unrecognized
    // role. Pathway-A (template-matched) candidates are deliberately excluded
    // from this check: generateCandidates() (Pathway A) only ever knows about
    // the PRIMARY anchor, never additionalLockedComponents -- a pre-existing
    // Phase 4B limitation (see architectureGeneration.test.mjs's own
    // "promoter-anchored workflow" test, which filters the same way), not
    // something this fix changes or needs to change.
    const beamCandidates = result.candidates.all.filter(c => c.origin === "beam_search");
    assert.ok(beamCandidates.length > 0, "at least one beam-search candidate must be generated to exercise the lock");
    for (const c of beamCandidates) {
      const oriEntry = c.plan.order.find(o => o.role === "ori");
      assert.equal(oriEntry.id, customOrigin.id, "the custom origin must fill the internal 'ori' role, not be dropped");
    }
  });
});

describe("getCustomPart / listCustomParts / removeCustomPart", () => {
  test("getCustomPart resolves a registered part by id; returns null for an unknown id", () => {
    const registry = createCustomPartRegistry();
    const { part } = registry.registerCustomPart({ name: "X", seq: REAL_CDS_SEQ, role: "cds" });
    assert.equal(registry.getCustomPart(part.id), part);
    assert.equal(registry.getCustomPart("userpart:cds-doesnotexist"), null);
  });

  test("listCustomParts reflects every distinct registration in this session", () => {
    const registry = createCustomPartRegistry();
    registry.registerCustomPart({ name: "X", seq: REAL_CDS_SEQ, role: "cds" });
    registry.registerCustomPart({ name: "Y", seq: REAL_PROMOTER_SEQ, role: "promoter" });
    assert.equal(registry.listCustomParts().length, 2);
  });

  test("removeCustomPart deletes a registration and is idempotent (false on a second call)", () => {
    const registry = createCustomPartRegistry();
    const { part } = registry.registerCustomPart({ name: "X", seq: REAL_CDS_SEQ, role: "cds" });
    assert.equal(registry.removeCustomPart(part.id), true);
    assert.equal(registry.getCustomPart(part.id), null);
    assert.equal(registry.removeCustomPart(part.id), false);
  });
});
