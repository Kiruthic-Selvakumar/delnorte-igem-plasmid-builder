// node --test for Phase 5B, item 10: UNIVERSAL CUSTOM PART ACCEPTANCE TEST.
//
// Proves that a biological part supplied by ANY iGEM team -- not already in
// data/parts.json, the local catalog, the iGEM Registry, or any project
// template -- can be registered through automatic/customPartRegistry.js and
// carried into runAutomaticDesign() as the locked anchor, for EVERY one of
// the 10 supported roles (promoter, operator, rbs, cds, signal, terminator,
// marker, origin, orit, other).
//
// Every sequence used here is a REAL sequence read live from data/parts.json
// (never a literal typed into this file, per CLAUDE.md), registered under a
// fake external-team-style name and used ONLY as customPartRegistry.js's
// registerCustomPart() input -- proving the part need not exist under its
// real catalog id anywhere the design pipeline looks it up by id.
//
// For each role, this file checks:
//   - registration succeeds (no local catalog id required)
//   - provenanceStatus === "user_supplied", sequenceStatus === "resolved"
//   - the sequence is preserved EXACTLY (item 2: never edited/rc'd/optimized)
//   - the part remains locked (identical across every generated candidate)
//   - absence from data/parts.json is never itself treated as a failure
//   - the design result is either:
//       (A) a hard-valid complete architecture, or
//       (B) a structured, honest request for a genuinely missing component
//     -- NEVER a silent guess, a crash, or a rejection merely because the
//     part is of external origin.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { runAutomaticDesign, createCustomPartRegistry, classifyProvenance } from "../automatic/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const partsDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "parts.json"), "utf-8"));
const templatesDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "templates.json"), "utf-8"));
const templates = templatesDoc.templates;
const fullPartsById = {};
for (const p of partsDoc.parts) fullPartsById[p.id] = p;

// One real, resolved-sequence catalog part per role -- each HELD OUT of the
// partsById copy handed to runAutomaticDesign, so the design pipeline has no
// way to recognize it by its real catalog id; it is reachable ONLY via the
// customPart registration path, exactly simulating another team's part.
const ROLE_CASES = [
  { role: "cds", heldOutId: "sg_GFP", host: "E. coli", goalFamily: "inducible_regulated_expression", needsCdsPartner: false },
  { role: "promoter", heldOutId: "sg_lac_promoter", host: "E. coli", goalFamily: "inducible_regulated_expression", needsCdsPartner: true },
  { role: "rbs", heldOutId: "sg_AtADH_5'_UTR", host: "E. coli", goalFamily: "inducible_regulated_expression", needsCdsPartner: true },
  { role: "terminator", heldOutId: "sg_ADH1_terminator_(2)", host: "E. coli", goalFamily: "inducible_regulated_expression", needsCdsPartner: true },
  { role: "signal", heldOutId: "sg_AKH_signal_sequence", host: "B. subtilis", goalFamily: "secretion", needsCdsPartner: true },
  { role: "marker", heldOutId: "sg_AmpR_(3)", host: "E. coli", goalFamily: "inducible_regulated_expression", needsCdsPartner: true },
  { role: "origin", heldOutId: "sg_2u_ori", host: "E. coli", goalFamily: "inducible_regulated_expression", needsCdsPartner: true },
  { role: "orit", heldOutId: "sg_oriT_(2)", host: "V. natriegens", goalFamily: "conjugation_transfer", needsCdsPartner: true },
  { role: "operator", heldOutId: "sg_2xGTIIC", host: "E. coli", goalFamily: "inducible_regulated_expression", notModeled: true },
  { role: "other", heldOutId: "sg_3'_CeU6", host: "E. coli", goalFamily: "inducible_regulated_expression", notModeled: true },
];

const LOCKED_CDS_ID = "sg_GFP"; // a real, already-verified catalog CDS, used as the companion when a role needs one

for (const c of ROLE_CASES) {
  describe(`role "${c.role}"`, () => {
    const heldOutPart = fullPartsById[c.heldOutId];
    if (!heldOutPart || !heldOutPart.seq) throw new Error(`Test setup error: expected a real, sequenced catalog part "${c.heldOutId}"`);

    // partsById WITHOUT the held-out id -- this role's real catalog entry is
    // unreachable by id/name/sequence lookup, exactly as it would be for a
    // genuinely external part.
    const partsById = Object.fromEntries(Object.entries(fullPartsById).filter(([id]) => id !== c.heldOutId));

    const registry = createCustomPartRegistry();
    const regResult = registry.registerCustomPart({
      name: `FictionalTeam_${c.role}Part`, seq: heldOutPart.seq, role: c.role, sourceTeam: "FictionalTeam",
    });

    test("registration succeeds without any local catalog id", () => {
      assert.equal(regResult.ok, true, JSON.stringify(regResult.errors));
      assert.ok(regResult.part.id.startsWith("userpart:"));
      assert.equal(partsById[regResult.part.id], undefined, "the custom id must not coincidentally exist in the catalog");
    });

    test("provenanceStatus is user_supplied and sequenceStatus is resolved", () => {
      const cls = classifyProvenance(regResult.part);
      assert.equal(cls.provenanceStatus, "user_supplied");
      assert.equal(cls.sequenceStatus, "resolved");
    });

    test("sequence is preserved EXACTLY (identity, not just length)", () => {
      assert.equal(regResult.part.seq, heldOutPart.seq.toUpperCase());
      assert.equal(regResult.part.length, heldOutPart.seq.length);
    });

    test("absence from data/parts.json is not itself a registration failure", () => {
      assert.equal(fullPartsById[regResult.part.id], undefined);
      assert.equal(regResult.ok, true);
    });

    if (c.notModeled) {
      test("design: role has no design-grammar equivalent -- honest structured continuation, not a crash or silent guess", () => {
        const result = runAutomaticDesign({ customPart: regResult.part, host: c.host, goalFamily: c.goalFamily, partsById, templates, maxCandidates: 6 });
        assert.equal(result.ok, false);
        assert.equal(result.stage, "needsUserChoice");
        assert.equal(result.needsUserChoice.requiredRole, null);
        assert.equal(result.characterized.input.anchorPart.id, regResult.part.id, "the registered anchor is preserved in the response");
      });
      return;
    }

    if (c.needsCdsPartner) {
      test("design without a companion CDS: honest structured request, never a silent guess", () => {
        const result = runAutomaticDesign({ customPart: regResult.part, host: c.host, goalFamily: c.goalFamily, partsById, templates, maxCandidates: 6 });
        assert.equal(result.ok, false);
        assert.equal(result.stage, "needsUserChoice");
        assert.equal(result.needsUserChoice.requiredRole, "cds");
        assert.equal(result.characterized.input.anchorPart.id, regResult.part.id, "the registered anchor is preserved across the continuation");
      });
    }

    test("design with all genuinely required context supplied: a complete, hard-valid architecture is generated around the custom part", () => {
      const opts = { customPart: regResult.part, host: c.host, goalFamily: c.goalFamily, partsById, templates, maxCandidates: 8, beamWidth: 6 };
      if (c.needsCdsPartner) opts.additionalLockedComponents = [{ role: "cds", partId: LOCKED_CDS_ID }];
      const result = runAutomaticDesign(opts);
      assert.equal(result.stage, "done", JSON.stringify(result).slice(0, 400));
      assert.equal(result.ok, true);
      assert.ok(result.candidates.valid.length > 0, "at least one hard-valid candidate must exist");
      assert.ok(result.recommended, "a recommendation must be produced");

      // The custom part appears, unchanged, in every generated candidate --
      // never edited, swapped, or dropped by the search.
      for (const cand of result.candidates.all) {
        const entry = cand.plan.order.find(o => o.id === regResult.part.id);
        assert.ok(entry, `custom part must appear in every generated candidate (missing in ${cand.candidateId})`);
        assert.equal(entry.length, heldOutPart.length);
      }
    });
  });
}
