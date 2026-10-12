// node --test for Phase 6, items 3 + 12: the candidate -> downstream
// workspace handoff (automatic/workspaceHandoff.js) and the low-risk export
// formats (automatic/exportFormats.js). No literal DNA sequence is typed
// into this file -- every sequence is read live from data/parts.json or
// produced by runAutomaticDesign() from real project data.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { runAutomaticDesign, buildWorkspaceParts, buildWorkspaceHandoff, exportFASTA, exportJSONReport, exportGenBank, createCustomPartRegistry } from "../automatic/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const partsDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "parts.json"), "utf-8"));
const templatesDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "templates.json"), "utf-8"));
const partsById = {};
for (const p of partsDoc.parts) partsById[p.id] = p;
const templates = templatesDoc.templates;

describe("buildWorkspaceParts / buildWorkspaceHandoff", () => {
  test("every order entry becomes a workspace part with an exact, non-null resolved sequence for a hard-valid candidate", () => {
    const result = runAutomaticDesign({ partId: "sg_GFP", host: "E. coli", goalFamily: "inducible_regulated_expression", partsById, templates, maxCandidates: 6 });
    const cand = result.recommended;
    const workspaceParts = buildWorkspaceParts(cand, { partsById, anchorPart: result.characterized.input.anchorPart });
    assert.equal(workspaceParts.length, cand.plan.order.length);
    for (let i = 0; i < workspaceParts.length; i++) {
      assert.equal(workspaceParts[i].name, cand.plan.order[i].name);
      assert.equal(workspaceParts[i].role, cand.plan.order[i].role);
      assert.ok(workspaceParts[i].seq, `part "${workspaceParts[i].name}" must have a resolved sequence`);
      assert.equal(workspaceParts[i].len, workspaceParts[i].seq.length);
    }
  });

  test("the anchor's exact sequence is preserved identically into the workspace part (Phase 6 item 3's core requirement)", () => {
    const result = runAutomaticDesign({ partId: "sg_GFP", host: "E. coli", goalFamily: "inducible_regulated_expression", partsById, templates, maxCandidates: 6 });
    const cand = result.recommended;
    const anchorPart = result.characterized.input.anchorPart;
    const workspaceParts = buildWorkspaceParts(cand, { partsById, anchorPart });
    const anchorWorkspacePart = workspaceParts.find(p => p.name === anchorPart.name);
    assert.equal(anchorWorkspacePart.seq, anchorPart.seq);
    assert.equal(anchorWorkspacePart.locked, true);
  });

  test("a raw/novel (id:null) anchor's sequence is still resolved correctly (not silently dropped as a gap)", () => {
    const heldOutId = "sg_lac_promoter";
    const heldOut = partsById[heldOutId];
    const partsByIdMinusOne = Object.fromEntries(Object.entries(partsById).filter(([id]) => id !== heldOutId));
    const cdsAnchor = "sg_GFP";
    const promoterLocked = { role: "promoter", customPart: undefined }; // not used directly; anchor itself is the novel one below
    const result = runAutomaticDesign({
      text: heldOut.seq, role: "promoter", host: "E. coli", goalFamily: "inducible_regulated_expression",
      additionalLockedComponents: [{ role: "cds", partId: cdsAnchor }],
      partsById: partsByIdMinusOne, templates, maxCandidates: 6, beamWidth: 5,
    });
    assert.equal(result.ok, true, JSON.stringify(result).slice(0, 400));
    const cand = result.recommended;
    const anchorPart = result.characterized.input.anchorPart;
    assert.equal(anchorPart.id, null);
    const workspaceParts = buildWorkspaceParts(cand, { partsById: partsByIdMinusOne, anchorPart });
    const anchorWorkspacePart = workspaceParts.find(p => p.role === "promoter");
    assert.equal(anchorWorkspacePart.seq, heldOut.seq.toUpperCase());
    assert.equal(anchorWorkspacePart.locked, true);
  });

  test("an additional locked (non-anchor) component is also preserved exactly and flagged locked", () => {
    const lockedCds = "sg_GFP";
    const promoterAnchor = partsById["sg_araBAD_promoter_(2)"];
    const result = runAutomaticDesign({
      partId: promoterAnchor.id, role: "promoter", host: "E. coli", goal: "regulated expression",
      additionalLockedComponents: [{ role: "cds", partId: lockedCds }],
      partsById, templates, maxCandidates: 6, beamWidth: 5,
    });
    const beamCand = result.candidates.all.find(c => c.origin === "beam_search" && c.validation.valid);
    assert.ok(beamCand);
    const workspaceParts = buildWorkspaceParts(beamCand, { partsById, anchorPart: result.characterized.input.anchorPart });
    const cdsWorkspacePart = workspaceParts.find(p => p.role === "cds");
    assert.equal(cdsWorkspacePart.seq, partsById[lockedCds].seq.toUpperCase());
    assert.equal(cdsWorkspacePart.locked, true);
  });

  test("buildWorkspaceHandoff bundles totals/host/assembly method consistent with the candidate's own plan", () => {
    const result = runAutomaticDesign({ partId: "sg_GFP", host: "E. coli", goalFamily: "inducible_regulated_expression", partsById, templates, maxCandidates: 6, assemblyMethod: "gibson" });
    const cand = result.recommended;
    const handoff = buildWorkspaceHandoff(cand, { partsById, anchorPart: result.characterized.input.anchorPart, host: result.characterized.input.host, assemblyMethod: "gibson" });
    assert.equal(handoff.totalBp, cand.plan.totalLength);
    assert.equal(handoff.gc, cand.plan.gc);
    assert.equal(handoff.assembledSequence, cand.plan.sequence);
    assert.equal(handoff.host, "E. coli");
    assert.equal(handoff.assemblyMethod, "gibson");
    assert.equal(handoff.parts.length, cand.plan.order.length);
  });

  test("a custom (external) part anchor's exact sequence survives the handoff unchanged", () => {
    const registry = createCustomPartRegistry();
    const heldOutId = "sg_lac_promoter";
    const heldOut = partsById[heldOutId];
    const { part: customPromoter } = registry.registerCustomPart({ name: "OtherTeam_Promoter", seq: heldOut.seq, role: "promoter" });
    const partsByIdMinusOne = Object.fromEntries(Object.entries(partsById).filter(([id]) => id !== heldOutId));
    const result = runAutomaticDesign({
      customPart: customPromoter, host: "E. coli", goalFamily: "inducible_regulated_expression",
      additionalLockedComponents: [{ role: "cds", partId: "sg_GFP" }],
      partsById: partsByIdMinusOne, templates, maxCandidates: 6, beamWidth: 5,
    });
    assert.equal(result.ok, true);
    const cand = result.recommended;
    const workspaceParts = buildWorkspaceParts(cand, { partsById: partsByIdMinusOne, anchorPart: customPromoter });
    const anchorWorkspacePart = workspaceParts.find(p => p.name === "OtherTeam_Promoter");
    assert.equal(anchorWorkspacePart.seq, heldOut.seq.toUpperCase());
    assert.equal(anchorWorkspacePart.provenanceStatus, "user_supplied");
  });

  test("Phase 5B item 6's own example -- custom promoter anchor + custom CDS locked together -- both survive the handoff with exact sequences", () => {
    const registry = createCustomPartRegistry();
    const promoterHeldOutId = "sg_lac_promoter";
    const cdsHeldOutId = "sg_GFP";
    const promoterSeq = partsById[promoterHeldOutId].seq;
    const cdsSeq = partsById[cdsHeldOutId].seq;
    const { part: customPromoter } = registry.registerCustomPart({ name: "OtherTeam_Promoter", seq: promoterSeq, role: "promoter" });
    const { part: customCds } = registry.registerCustomPart({ name: "OtherTeam_CDS", seq: cdsSeq, role: "cds" });
    const partsByIdMinusTwo = Object.fromEntries(Object.entries(partsById).filter(([id]) => id !== promoterHeldOutId && id !== cdsHeldOutId));

    const result = runAutomaticDesign({
      customPart: customPromoter, host: "E. coli", goalFamily: "inducible_regulated_expression",
      additionalLockedComponents: [{ role: "cds", customPart: customCds }],
      partsById: partsByIdMinusTwo, templates, maxCandidates: 6, beamWidth: 5,
    });
    assert.equal(result.ok, true, JSON.stringify(result).slice(0, 400));
    const cand = result.recommended;
    assert.equal(cand.lockedComponentsCompatible, true);

    const workspaceParts = buildWorkspaceParts(cand, { partsById: partsByIdMinusTwo, anchorPart: customPromoter });
    const promoterPart = workspaceParts.find(p => p.role === "promoter");
    const cdsPart = workspaceParts.find(p => p.role === "cds");
    assert.equal(promoterPart.seq, promoterSeq.toUpperCase());
    assert.equal(cdsPart.seq, cdsSeq.toUpperCase());
    assert.equal(promoterPart.locked, true);
    assert.equal(cdsPart.locked, true);

    const jsonReport = exportJSONReport(result, cand, { partsById: partsByIdMinusTwo, anchorPart: customPromoter });
    const jsonCdsPart = jsonReport.parts.find(p => p.role === "cds");
    assert.equal(jsonCdsPart.seq, cdsSeq.toUpperCase());
  });
});

describe("exportFASTA", () => {
  test("produces a header line and the full assembled sequence, wrapped, with no characters lost", () => {
    const result = runAutomaticDesign({ partId: "sg_GFP", host: "E. coli", goalFamily: "inducible_regulated_expression", partsById, templates, maxCandidates: 6 });
    const cand = result.recommended;
    const fasta = exportFASTA(cand, { host: "E. coli" });
    const lines = fasta.trim().split("\n");
    assert.ok(lines[0].startsWith(">"));
    const seqOnly = lines.slice(1).join("");
    assert.equal(seqOnly, cand.plan.sequence);
  });
});

describe("exportJSONReport", () => {
  test("includes every field the Phase 6 brief requires, with exact sequences and real scoring/validation data", () => {
    const result = runAutomaticDesign({ partId: "sg_GFP", host: "E. coli", goalFamily: "inducible_regulated_expression", partsById, templates, registryCache: undefined, maxCandidates: 6 });
    const cand = result.recommended;
    const report = exportJSONReport(result, cand, { partsById, anchorPart: result.characterized.input.anchorPart });
    for (const key of ["candidateId", "host", "goal", "assemblyMethod", "totalBp", "parts", "validation", "scoreBreakdown", "registryComparison", "robustness", "modelLimitations"]) {
      assert.ok(key in report, `report is missing "${key}"`);
    }
    assert.equal(report.candidateId, cand.candidateId);
    assert.equal(report.parts.length, cand.plan.order.length);
    for (const p of report.parts) assert.ok(p.seq, `part "${p.name}" must have an exported sequence`);
    assert.ok(Array.isArray(report.modelLimitations) && report.modelLimitations.length > 0);
    assert.ok(!JSON.stringify(report).includes("undefined"));
  });

  test("is fully JSON-serializable (no functions, no circular references)", () => {
    const result = runAutomaticDesign({ partId: "sg_GFP", host: "E. coli", goalFamily: "inducible_regulated_expression", partsById, templates, maxCandidates: 6 });
    const cand = result.recommended;
    const report = exportJSONReport(result, cand, { partsById, anchorPart: result.characterized.input.anchorPart });
    assert.doesNotThrow(() => JSON.stringify(report));
  });
});

describe("exportGenBank", () => {
  test("produces a well-formed GenBank flat file with a matching LOCUS length and one feature per part plus source", () => {
    const result = runAutomaticDesign({ partId: "sg_GFP", host: "E. coli", goalFamily: "inducible_regulated_expression", partsById, templates, maxCandidates: 6 });
    const cand = result.recommended;
    const gb = exportGenBank(cand, { partsById, anchorPart: result.characterized.input.anchorPart, host: "E. coli" });
    assert.match(gb, /^LOCUS/);
    assert.match(gb, new RegExp(`${cand.plan.totalLength} bp`));
    assert.match(gb, /FEATURES\s+Location\/Qualifiers/);
    assert.match(gb, /source\s+1\.\.\d+/);
    assert.ok(gb.trim().endsWith("//"));
    // one feature block per real part, matching plan.order length
    const featureBlocks = (gb.match(/\/label="/g) || []).length;
    assert.equal(featureBlocks, cand.plan.order.length);
  });

  test("the ORIGIN section, once de-formatted, reconstructs the exact assembled sequence", () => {
    const result = runAutomaticDesign({ partId: "sg_GFP", host: "E. coli", goalFamily: "inducible_regulated_expression", partsById, templates, maxCandidates: 6 });
    const cand = result.recommended;
    const gb = exportGenBank(cand, { partsById, anchorPart: result.characterized.input.anchorPart, host: "E. coli" });
    const originBlock = gb.slice(gb.indexOf("ORIGIN") + "ORIGIN".length, gb.lastIndexOf("//"));
    const reconstructed = originBlock.replace(/[^acgtACGT]/g, "").toUpperCase();
    assert.equal(reconstructed, cand.plan.sequence);
  });
});
