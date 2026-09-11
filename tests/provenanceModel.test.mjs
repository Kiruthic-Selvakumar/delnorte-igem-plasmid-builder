// node --test for Phase 4C: the evidence/provenance model (provenanceModel.js)
// and the independent host-eligibility check (constraintEngine.js). Real
// project data throughout; no literal DNA sequence is typed into this file.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { classifyProvenance, isHardRejectedProvenance, provenanceConfidenceNote } from "../automatic/provenanceModel.js";
import { checkHostEligibility, buildDocumentedHostsIndex } from "../automatic/constraintEngine.js";
import { createRegistryClient } from "../automatic/registryClient.js";
import { validateCandidate } from "../automatic/candidateValidation.js";
import { runAutomaticDesign } from "../automatic/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const partsDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "parts.json"), "utf-8"));
const templatesDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "templates.json"), "utf-8"));
const registryCacheDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "registry_cache.json"), "utf-8"));
const partsById = {};
for (const p of partsDoc.parts) partsById[p.id] = p;
const templates = templatesDoc.templates;
const registryClient = createRegistryClient(registryCacheDoc);

describe("classifyProvenance", () => {
  test("a real, evidence:verified catalog part is project_verified / resolved", () => {
    const c = classifyProvenance(partsById["sg_GFP"]);
    assert.deepEqual(c, { sequenceStatus: "resolved", provenanceStatus: "project_verified" });
  });

  test("a real, evidence:placeholder catalog part with a real sequence is placeholder / resolved (NOT missing)", () => {
    const part = partsById["dn_perr_promoter"]; // real seq on file, identity not confirmed -- see data/parts.json's own src note
    assert.ok(part && part.seq, "test setup: expected this part to carry a real sequence");
    const c = classifyProvenance(part);
    assert.deepEqual(c, { sequenceStatus: "resolved", provenanceStatus: "placeholder" });
  });

  test("a catalog part with seq:null is placeholder / missing", () => {
    const part = partsById["dn_pvsv105_ori"];
    assert.ok(part && !part.seq, "test setup: expected this part to have no sequence on file");
    const c = classifyProvenance(part);
    assert.deepEqual(c, { sequenceStatus: "missing", provenanceStatus: "placeholder" });
  });

  test("a user-supplied novel anchor (id:null) is user_supplied / resolved", () => {
    const novelAnchor = { id: null, name: "user-supplied sequence", type: "cds", seq: "ATGACTTTAATT", evidence: "placeholder", hosts: {} };
    const c = classifyProvenance(novelAnchor);
    assert.deepEqual(c, { sequenceStatus: "resolved", provenanceStatus: "user_supplied" });
  });

  test("a real Registry-inserted part is registry_recorded / resolved", () => {
    const registryPart = registryClient.getInsertableCandidates("promoter").find(p => p.id === "registry:BBa_J23100");
    assert.ok(registryPart, "test setup: expected the real cached BBa_J23100 to be insertable");
    const c = classifyProvenance(registryPart);
    assert.deepEqual(c, { sequenceStatus: "resolved", provenanceStatus: "registry_recorded" });
  });

  test("a gap (null part) is missing, with no provenanceStatus", () => {
    assert.deepEqual(classifyProvenance(null), { sequenceStatus: "missing", provenanceStatus: null });
  });
});

describe("isHardRejectedProvenance", () => {
  test("rejects missing and invalid sequenceStatus regardless of provenanceStatus", () => {
    assert.equal(isHardRejectedProvenance({ sequenceStatus: "missing", provenanceStatus: "user_supplied" }), true);
    assert.equal(isHardRejectedProvenance({ sequenceStatus: "invalid", provenanceStatus: "registry_recorded" }), true);
  });
  test("rejects placeholder provenance even when sequence is resolved", () => {
    assert.equal(isHardRejectedProvenance({ sequenceStatus: "resolved", provenanceStatus: "placeholder" }), true);
  });
  test("does NOT reject registry_recorded or user_supplied provenance when sequence is resolved -- the Phase 4C fix", () => {
    assert.equal(isHardRejectedProvenance({ sequenceStatus: "resolved", provenanceStatus: "registry_recorded" }), false);
    assert.equal(isHardRejectedProvenance({ sequenceStatus: "resolved", provenanceStatus: "user_supplied" }), false);
    assert.equal(isHardRejectedProvenance({ sequenceStatus: "resolved", provenanceStatus: "project_verified" }), false);
  });
});

describe("provenanceConfidenceNote", () => {
  test("registry_recorded and user_supplied get an honest, non-alarming confidence note; others get none", () => {
    assert.match(provenanceConfidenceNote("registry_recorded", "X"), /not.*(project's own|independently).*verif/i);
    assert.match(provenanceConfidenceNote("user_supplied", "X"), /not been independently verified/);
    assert.equal(provenanceConfidenceNote("project_verified", "X"), null);
    assert.equal(provenanceConfidenceNote("placeholder", "X"), null);
  });
  test("never phrases a note as a biological/wet-lab claim", () => {
    for (const status of ["registry_recorded", "user_supplied"]) {
      const note = provenanceConfidenceNote(status, "X");
      assert.doesNotMatch(note, /wet.?lab (success|validated)|proven to (work|function)/i);
    }
  });
});

describe("Phase 4C item 3: a real cached Registry part with an exact sequence survives candidate validation", () => {
  test("registry:BBa_J23100 (constitutive promoter) is hard-VALID via validateCandidate when every other constraint is satisfied", () => {
    const result = runAutomaticDesign({
      partId: "sg_GFP", host: "E. coli", goalFamily: "constitutive_expression",
      partsById, templates, registryCache: registryCacheDoc, maxCandidates: 6, beamWidth: 5,
    });
    assert.equal(result.ok, true);
    const withRegistryPromoter = result.candidates.all.find(c => c.plan.order.some(o => o.id === "registry:BBa_J23100"));
    assert.ok(withRegistryPromoter, "expected a generated candidate to use the real cached Registry promoter");
    assert.equal(withRegistryPromoter.validation.valid, true, JSON.stringify(withRegistryPromoter.validation.reasons));
    assert.ok(result.candidates.valid.includes(withRegistryPromoter));
  });

  test("the Registry part is represented honestly: registry_recorded, never re-labeled project_verified", () => {
    const registryPart = registryClient.getInsertableCandidates("promoter").find(p => p.id === "registry:BBa_J23100");
    assert.equal(registryPart.evidence, "placeholder"); // data/parts.json's own 2-value schema -- unchanged
    assert.equal(classifyProvenance(registryPart).provenanceStatus, "registry_recorded"); // the honest, distinct Phase 4C classification
  });
});

describe("Phase 4C item 4: independent host-eligibility check", () => {
  const documentedHostsIndex = buildDocumentedHostsIndex(templates);

  test("a documented incompatibility (AmpR for V. natriegens) is still rejected via checkHostEligibility", () => {
    const r = checkHostEligibility(partsById["sg_AmpR"], "V. natriegens", documentedHostsIndex);
    assert.equal(r.ok, false);
    assert.equal(r.status, "incompatible");
    assert.match(r.reason, /beta-lactamase/);
  });

  test("a part documented ONLY for a different host (B. subtilis's PkatA promoter, used for V. natriegens) is rejected as host_specific_elsewhere, citing data/templates.json", () => {
    const r = checkHostEligibility(partsById["dn_pkata_promoter"], "V. natriegens", documentedHostsIndex);
    assert.equal(r.ok, false);
    assert.equal(r.status, "host_specific_elsewhere");
    assert.match(r.reason, /data\/templates\.json/);
    assert.match(r.reason, /b\. subtilis/i);
  });

  test("the same part IS eligible for the host it's actually documented for", () => {
    const r = checkHostEligibility(partsById["dn_pkata_promoter"], "B. subtilis", documentedHostsIndex);
    assert.equal(r.ok, true);
    assert.equal(r.status, "documented");
  });

  test("missing host documentation (a part no template lists at all) is UNKNOWN, never treated as incompatible", () => {
    const undocumented = { id: "sg_GFP", name: "GFP", evidence: "verified", seq: partsById["sg_GFP"].seq }; // GFP is a real anchor, never a template slot candidate
    const r = checkHostEligibility(undocumented, "E. coli", documentedHostsIndex);
    assert.equal(r.ok, true);
    assert.equal(r.status, "unknown");
  });

  test("a user-supplied anchor (id:null) is always unknown -- no project data could document a host for it", () => {
    const r = checkHostEligibility({ id: null, name: "user-supplied sequence" }, "E. coli", documentedHostsIndex);
    assert.equal(r.ok, true);
    assert.equal(r.status, "unknown");
  });

  test("a null part (gap) is unknown, never a rejection", () => {
    const r = checkHostEligibility(null, "E. coli", documentedHostsIndex);
    assert.equal(r.ok, true);
    assert.equal(r.status, "unknown");
  });
});

describe("Phase 4C item 4: end-to-end -- the ablation-study cross-host leakage is now caught by validation", () => {
  const baseOpts = { partId: "sg_GFP", role: "cds", host: "V. natriegens", goal: "broad host range plasmid", partsById, templates, maxCandidates: 6, beamWidth: 5 };

  test("with retrieval-tier host filtering AND constraint-engine pruning BOTH deliberately disabled, every B.-subtilis-only candidate is still hard-rejected by validateCandidate", () => {
    const result = runAutomaticDesign({ ...baseOpts, ablation: { ablateHostFiltering: true, ablatePruning: true } });
    const beamOnly = result.candidates.all.filter(c => c.origin === "beam_search");
    assert.ok(beamOnly.length > 0, "test setup: expected beam search to still run");
    const crossHostIds = ["dn_pub110_ori", "dn_pkata_promoter", "dn_amye_signal_peptide", "dn_ermc_resistance_ermr", "dn_rbs_st7", "dn_rrnb_t1_terminator"];
    for (const c of beamOnly) {
      const usesCrossHostPart = c.plan.order.some(o => crossHostIds.includes(o.id));
      if (usesCrossHostPart) {
        assert.equal(c.validation.valid, false, `${c.candidateId} uses a B.-subtilis-only part and must be hard-rejected`);
        assert.ok(c.validation.reasons.some(r => r.includes("host-ineligible")), JSON.stringify(c.validation.reasons));
      }
    }
    // And no cross-host part survives into the actual recommendation:
    for (const id of crossHostIds) assert.ok(!result.recommended.plan.order.some(o => o.id === id), `recommended candidate must never contain B.-subtilis-only part "${id}"`);
  });

  test("missing host metadata remains unknown, not incompatible, in the same end-to-end run", () => {
    const result = runAutomaticDesign({ ...baseOpts, ablation: { ablateHostFiltering: true, ablatePruning: true } });
    // sg_GFP itself (the anchor) is never documented for any host in any template, yet must never be
    // the cause of a host-ineligibility rejection anywhere:
    for (const c of result.candidates.all) {
      assert.ok(!c.validation.reasons.some(r => r.includes("GFP") && r.includes("host-ineligible")));
    }
  });

  test("normal host-aware retrieval (ablation off) still behaves the same as before Phase 4C -- no cross-host part is even generated", () => {
    const result = runAutomaticDesign(baseOpts);
    const beamOnly = result.candidates.all.filter(c => c.origin === "beam_search");
    for (const c of beamOnly) {
      assert.ok(!c.plan.order.some(o => ["dn_pub110_ori", "dn_pkata_promoter", "dn_amye_signal_peptide"].includes(o.id)));
    }
    assert.ok(beamOnly.some(c => c.validation.valid), "normal retrieval must still produce valid candidates");
  });
});
