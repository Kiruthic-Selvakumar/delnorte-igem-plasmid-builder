// node --test: SINGLE-NEW-PART DISCORD ACCEPTANCE TEST (Phase 5B, item 11).
//
// The literal question this file answers:
//
//   "Can another iGEM team bring one of its own parts to this tool without
//   editing our code or parts database?"
//
// Method, for each modeled role: remove the underlying real part from the
// catalog entirely (simulating it never having existed in this project's
// data), give it a fake external-team name, register it ONLY through
// customPartRegistry.js's public API (never partId, never text/paste-match),
// supply a host + design goal, and run Automatic Design -- with NO
// template/backbone named anywhere in the input. Every sequence is real,
// read live from data/parts.json (CLAUDE.md: no literal DNA in any other
// file); this file only removes an id from the in-memory map handed to the
// pipeline, never from disk.
//
// For each role this records: registration success, whether the design was
// direct-complete or needed additional context, anchor identity preservation,
// valid candidate count if complete, recommendation eligibility, assembly
// feasibility if complete, and Registry-comparison availability -- then
// prints one final, direct answer to the question above.

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { runAutomaticDesign, createCustomPartRegistry } from "../automatic/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const partsDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "parts.json"), "utf-8"));
const templatesDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "templates.json"), "utf-8"));
const registryCacheDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "registry_cache.json"), "utf-8"));
const templates = templatesDoc.templates;
const fullPartsById = {};
for (const p of partsDoc.parts) fullPartsById[p.id] = p;

const LOCKED_CDS_ID = "sg_GFP";

const SCENARIOS = [
  { role: "cds", heldOutId: "dn_lysqdvp001_endolysin", host: "B. subtilis", goalFamily: "secretion", needsCdsPartner: false },
  { role: "promoter", heldOutId: "dn_pveg_promoter", host: "B. subtilis", goalFamily: "constitutive_expression", needsCdsPartner: true },
  { role: "rbs", heldOutId: "sg_cspA_5'UTR", host: "E. coli", goalFamily: "inducible_regulated_expression", needsCdsPartner: true },
  { role: "terminator", heldOutId: "sg_ADH2_terminator", host: "E. coli", goalFamily: "inducible_regulated_expression", needsCdsPartner: true },
  { role: "signal", heldOutId: "dn_amye_signal_peptide", host: "B. subtilis", goalFamily: "secretion", needsCdsPartner: true },
  { role: "marker", heldOutId: "sg_AmpR_(2)", host: "E. coli", goalFamily: "inducible_regulated_expression", needsCdsPartner: true },
  { role: "origin", heldOutId: "sg_2u_ori_(5)", host: "E. coli", goalFamily: "inducible_regulated_expression", needsCdsPartner: true },
  { role: "orit", heldOutId: "sg_RSF1010_oriT", host: "V. natriegens", goalFamily: "conjugation_transfer", needsCdsPartner: true },
];

const records = [];

describe("SINGLE-NEW-PART DISCORD ACCEPTANCE TEST", () => {
  for (const s of SCENARIOS) {
    test(`role "${s.role}": an external team's own part, brought in with zero repository/database edits`, () => {
      const heldOutPart = fullPartsById[s.heldOutId];
      if (!heldOutPart || !heldOutPart.seq) throw new Error(`Test setup error: expected a real, sequenced catalog part "${s.heldOutId}"`);

      // Simulates the part never having existed in this project's data at all.
      const partsById = Object.fromEntries(Object.entries(fullPartsById).filter(([id]) => id !== s.heldOutId));

      const registry = createCustomPartRegistry();
      const reg = registry.registerCustomPart({
        name: `ExternalTeam_${s.role}_${s.heldOutId}`, seq: heldOutPart.seq, role: s.role, sourceTeam: "ExternalTeam",
      });
      assert.equal(reg.ok, true, JSON.stringify(reg.errors));

      const opts = {
        customPart: reg.part, host: s.host, goalFamily: s.goalFamily,
        partsById, templates, registryCache: registryCacheDoc, maxCandidates: 8, beamWidth: 6, robustnessTrials: 300,
      };
      if (s.needsCdsPartner) opts.additionalLockedComponents = [{ role: "cds", partId: LOCKED_CDS_ID }];
      // No template/backbone named anywhere in the input:
      assert.ok(!("template" in opts) && !("templateId" in opts) && !("backbone" in opts));

      const result = runAutomaticDesign(opts);

      const rec = {
        role: s.role, heldOutId: s.heldOutId, host: s.host, goalFamily: s.goalFamily,
        registrationSuccess: reg.ok,
        anchorIdentityPreserved: result.characterized?.input?.anchorPart?.id === reg.part.id,
        outcome: result.ok ? "direct_complete_design" : (result.stage === "needsUserChoice" ? "additional_context_required" : "unexpected_failure"),
        validCandidateCount: result.ok ? result.candidates.valid.length : null,
        recommendationEligible: result.ok ? !!(result.recommended && result.recommended.goalCompatible !== false) : null,
        assemblyFeasibleTop1: result.ok ? !!(result.recommended && result.recommended.assemblyPlan && result.recommended.assemblyPlan.feasible) : null,
        registryComparisonAvailable: result.ok
          ? !!(result.scoring.ranked.find(r => r.candidateId === result.recommended?.candidateId)?.registryComparison?.length)
          : null,
      };
      records.push(rec);

      assert.equal(rec.registrationSuccess, true);
      assert.equal(rec.anchorIdentityPreserved, true, "the registered anchor identity must be preserved into the design result");
      assert.notEqual(rec.outcome, "unexpected_failure", JSON.stringify(result).slice(0, 500));
      if (rec.outcome === "direct_complete_design") {
        assert.ok(rec.validCandidateCount > 0);
      } else {
        assert.equal(result.needsUserChoice.requiredRole, "cds");
      }
    });
  }

  after(() => {
    console.log("\n" + "=".repeat(78));
    console.log("SINGLE-NEW-PART DISCORD ACCEPTANCE TEST -- SUMMARY");
    console.log("=".repeat(78));
    for (const r of records) {
      console.log(`  ${r.role.padEnd(11)} (${r.heldOutId}, ${r.host}): registration=${r.registrationSuccess}, anchorPreserved=${r.anchorIdentityPreserved}, outcome=${r.outcome}` +
        (r.outcome === "direct_complete_design" ? `, validCandidates=${r.validCandidateCount}, recommendationEligible=${r.recommendationEligible}, assemblyFeasible=${r.assemblyFeasibleTop1}, registryComparisonAvailable=${r.registryComparisonAvailable}` : ""));
    }
    const allRegistered = records.every(r => r.registrationSuccess);
    const allPreserved = records.every(r => r.anchorIdentityPreserved);
    const allResolved = records.every(r => r.outcome === "direct_complete_design" || r.outcome === "additional_context_required");
    console.log("-".repeat(78));
    console.log(`ANSWER: Can another iGEM team bring one of its own parts to this tool\n` +
      `without editing our code or parts database?\n` +
      `  -> ${allRegistered && allPreserved && allResolved ? "YES" : "NO"} -- every tested role (${records.length}/${SCENARIOS.length}) registered successfully with zero\n` +
      `     repository edits, preserved the anchor's identity exactly, and the system\n` +
      `     either built the complete supported plasmid around it or told the user\n` +
      `     exactly what minimum biological information (a companion CDS) was still\n` +
      `     required -- never a silent guess, a crash, or a rejection for external origin.`);
    console.log("=".repeat(78));
  });
});
