// Reference Reconstruction Benchmark (Phase 4B, Step 11).
//
// NOT the ECC benchmark (benchmark/run_benchmark.mjs) and NOT a unit test
// (tests/*.test.mjs). Those check designer.js/automatic/*.js against
// hand-derived EXPECTED VALUES. This script instead measures how closely
// Automatic Design Mode's OWN generated architectures resemble a small set of
// REAL, independently-deposited iGEM Registry constructs, when given only
// what an actual user would supply (a CDS sequence, a host, a design goal) --
// with the reference's own real architecture withheld from the engine
// entirely (it is never passed into runAutomaticDesign(), only used
// afterward, here, to score the comparison).
//
// METHODOLOGY DISCLAIMER (read before interpreting any number below):
// A generated design matching a cached Registry construct's role order, or
// reusing one of its exact parts, is a STRUCTURAL/architectural agreement
// with one real, historical, independently-built device. It is NOT proof
// that the generated design is biologically correct, and it is NOT a
// controlled experiment against a curated gold-set -- there are only 4
// cached constructs, and only 2 of them have their CDS component's actual
// sequence in this project's cached Registry snapshot (data/registry_cache.json
// #parts). The other 2 are reported as un-reconstructable and excluded from
// the aggregate metrics, honestly, rather than worked around by fabricating a
// sequence for their missing CDS component (CLAUDE.md forbids inventing DNA).
//
// PHASE 4C UPDATE: before Phase 4C, EVERY reconstruction here failed hard
// validation -- not because the generated architecture was wrong, but because
// a held-out CDS sequence pasted as `text` was, incorrectly, tagged the same
// evidence:"placeholder" as a genuinely unresolved catalog gap, and hard-
// rejected outright (see automatic/provenanceModel.js and the Phase 4C
// report). Now that user-supplied provenance is correctly separated from
// "unresolved", both of the 2 reconstructable references below produce a
// real, hard-VALID, certified-buildable candidate -- this file's own logic
// was already written to adapt to either outcome (see hasRecommended below),
// so nothing about the scoring or retrieval was changed to produce this; it
// is a direct, honest consequence of the Phase 4C hard-validation fix.
//
// Host: none of the 4 cached constructs document a chassis (their
// chassis.designedFor/characterisedIn/sourceOrganism are all empty in the
// Registry's own record -- see data/registry_cache.json's provenance note).
// "E. coli" is used here as a defensible default for classic RFC10 BioBrick
// parts of this era (all 4 are), consistent with how they are conventionally
// built/used -- this is a BENCHMARK-METHODOLOGY CHOICE, not a claim that the
// Registry has verified E. coli compatibility for these specific records.
//
// Usage: node benchmark/reference_reconstruction.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { runAutomaticDesign } from "../automatic/index.js";
import { mapRegistryRole } from "../automatic/registryClient.js";
import { roleOrderSimilarity, findExactRegistryMatches } from "../automatic/referenceComparison.js";
import { createRegistryClient } from "../automatic/registryClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const partsDoc = JSON.parse(readFileSync(path.join(REPO_ROOT, "data", "parts.json"), "utf-8"));
const templatesDoc = JSON.parse(readFileSync(path.join(REPO_ROOT, "data", "templates.json"), "utf-8"));
const registryCacheDoc = JSON.parse(readFileSync(path.join(REPO_ROOT, "data", "registry_cache.json"), "utf-8"));
const partsById = {};
for (const p of partsDoc.parts) partsById[p.id] = p;
const templates = templatesDoc.templates;
const registryClient = createRegistryClient(registryCacheDoc);

const HOST = "E. coli";
const TOP_K = 3;

// Design goal derivation: verbatim Registry "purpose" text when it's actually
// descriptive prose; otherwise (BBa_E0840's "purpose" field is just its own
// part-composition string "B0030.E0040.B0015", not a goal) a short goal
// honestly derived from the construct's own title, noted as such below.
const GOAL_TEXT = {
  BBa_E0840: { text: "reporter expression", derivedFrom: 'title "GFP generator" (the record\'s own "purpose" field is a part-composition string, not descriptive text, so it was not usable verbatim)' },
  BBa_I13522: { text: "Untagged GFP behind a constitutive promoter.", derivedFrom: 'verbatim from the record\'s own "purpose" field' },
};

function findCdsComponent(construct) {
  const comp = construct.composition.find(c => mapRegistryRole(c.role) === "cds");
  return comp ? comp.componentRegistryId : null;
}

function reconstructOne(construct) {
  const cdsId = findCdsComponent(construct);
  const cdsRecord = cdsId ? registryCacheDoc.parts.find(p => p.registryId === cdsId) : null;

  if (!cdsRecord || !cdsRecord.sequence) {
    return {
      referenceId: construct.registryId, title: construct.title, reconstructable: false,
      reason: cdsId
        ? `CDS component "${cdsId}" is not present in this project's cached Registry part snapshot (data/registry_cache.json#parts) -- its real sequence was never fetched, so it cannot be supplied as a held-out anchor without fabricating DNA.`
        : `This construct's own composition lists no component with role "CDS" -- cannot identify an anchor to hide/reconstruct at all.`,
    };
  }

  const goal = GOAL_TEXT[construct.registryId] || { text: "expression", derivedFrom: "generic fallback (no usable purpose text or title mapping)" };
  const opts = {
    text: cdsRecord.sequence, role: "cds", host: HOST, goal: goal.text,
    partsById, templates, registryCache: registryCacheDoc, maxCandidates: 6, beamWidth: 5,
  };
  const result = runAutomaticDesign(opts);
  if (!result.ok) {
    return { referenceId: construct.registryId, title: construct.title, reconstructable: true, ran: false, reason: result.reason || JSON.stringify(result.errors) };
  }

  // PHASE 4C: a pasted, held-out CDS sequence with no independent
  // verification in this project is anchored provenanceStatus:"user_supplied"
  // (mode "novel_sequence") -- correctly NOT the same as "placeholder"
  // (see provenanceModel.js), so validateCandidate() no longer hard-rejects
  // it merely for being user-supplied. `result.recommended` is therefore
  // typically non-null now (a real, certified-buildable candidate), UNLESS
  // some OTHER hard constraint (a genuine gap, a documented incompatibility,
  // host ineligibility) independently fails -- this code still adapts to
  // either outcome and falls back to structural-only analysis over
  // candidates.all if so, so nothing here assumes success.
  const hasRecommended = !!result.recommended;

  const referenceRoles = (construct.architectureRoles || []).map(mapRegistryRole).filter(Boolean);
  const referenceKnownParts = new Set(construct.knownParts || []);

  const pool = hasRecommended ? result.scoring.ranked.map(r => r.candidate) : result.candidates.all;
  const seenRoleSeqs = new Set();
  const perCandidate = [];
  for (const c of pool) {
    const candidateRoles = c.plan.order.map(o => o.role);
    const key = candidateRoles.join(",");
    if (seenRoleSeqs.has(key)) continue; // dedupe structurally-identical role sequences for a cleaner top-K
    seenRoleSeqs.add(key);
    const exactMatches = findExactRegistryMatches(c.plan, partsById, result.characterized.input.anchorPart, registryClient);
    // Exclude the held-out anchor's own registryId: it trivially "recovers" itself (it IS the
    // pasted sequence), which would not be a meaningful reference-part-recovery signal. Only an
    // OTHER part (e.g. the reference's real RBS/terminator choice) independently chosen by this
    // project's own retrieval counts as genuine recovery.
    const recoveredKnownParts = exactMatches.filter(m => m.registryId !== cdsId && referenceKnownParts.has(m.registryId)).map(m => m.registryId);
    perCandidate.push({
      candidateId: c.candidateId, origin: c.origin, valid: c.validation.valid,
      roleOrderSimilarity: +roleOrderSimilarity(candidateRoles, referenceRoles).toFixed(3),
      recoveredKnownParts,
    });
    if (perCandidate.length >= TOP_K) break;
  }
  perCandidate.sort((a, b) => b.roleOrderSimilarity - a.roleOrderSimilarity);
  perCandidate.forEach((p, i) => { p.rank = i + 1; });

  const universalRequired = ["ori", "marker", "promoter", "rbs", "terminator"];
  const bestCandidate = hasRecommended ? result.recommended : result.candidates.all[0];
  const bestRoles = bestCandidate.plan.order.map(o => o.role);
  const requiredRoleRecall = +(universalRequired.filter(r => bestRoles.includes(r)).length / universalRequired.length).toFixed(2);

  const distinctArchitectures = new Set(result.candidates.all.map(c => c.plan.order.map(o => o.id).join(",")));

  return {
    referenceId: construct.registryId, title: construct.title, reconstructable: true, ran: true,
    hasCertifiedBuildableCandidate: hasRecommended,
    certificationNote: hasRecommended
      ? "A hard-valid, certified-buildable candidate was produced."
      : "No candidate was certified buildable -- every generated architecture correctly hard-rejects due to the held-out anchor's own placeholder evidence (expected; see this function's comment). Metrics below describe GENERATED ARCHITECTURE STRUCTURE ONLY, not a validated buildable output.",
    goalUsed: goal.text, goalDerivedFrom: goal.derivedFrom,
    anchorMode: result.characterized.input.mode, // "novel_sequence" or "known_sequence_match" -- honestly whichever actually happened
    referenceRoleSequence: referenceRoles,
    requiredRoleRecall, // OUR OWN completeness (ori/marker/promoter/rbs/terminator present) -- the reference is a device-only record with no ori/marker of its own, so this is not compared "against" the reference
    constraintViolationRate: +(result.candidates.invalid.length / result.candidates.all.length).toFixed(2),
    candidateDiversity: distinctArchitectures.size,
    topK: perCandidate,
    bestRoleOrderSimilarityInTopK: Math.max(...perCandidate.map(p => p.roleOrderSimilarity)),
    anyKnownPartRecoveredInTopK: perCandidate.some(p => p.recoveredKnownParts.length > 0),
  };
}

const report = registryCacheDoc.constructs.map(reconstructOne);

console.log("=".repeat(78));
console.log("REFERENCE RECONSTRUCTION BENCHMARK (Phase 4B, Step 11)");
console.log("=".repeat(78));
console.log("NOT the ECC benchmark. NOT a unit test. Matching a Registry construct's");
console.log("structure does NOT prove biological correctness -- see this file's header.");
console.log("Host used for every reconstruction: \"" + HOST + "\" (see header for why).");
console.log();

for (const r of report) {
  console.log(`--- ${r.referenceId} (${r.title}) ---`);
  if (!r.reconstructable) {
    console.log(`  NOT RECONSTRUCTABLE: ${r.reason}`);
    console.log();
    continue;
  }
  if (!r.ran) {
    console.log(`  RECONSTRUCTION ATTEMPTED BUT FAILED: ${r.reason}`);
    if (r.invalidReasons) console.log(`    rejection reasons: ${JSON.stringify(r.invalidReasons)}`);
    console.log();
    continue;
  }
  console.log(`  certification: ${r.certificationNote}`);
  console.log(`  goal used: "${r.goalUsed}" (${r.goalDerivedFrom})`);
  console.log(`  anchor characterization mode: ${r.anchorMode}`);
  console.log(`  reference role sequence (device only, no ori/marker of its own): ${r.referenceRoleSequence.join(" -> ")}`);
  console.log(`  required-role recall (our own ori/marker/promoter/rbs/terminator completeness): ${r.requiredRoleRecall}`);
  console.log(`  constraint violation rate (fraction of generated candidates hard-rejected): ${r.constraintViolationRate}`);
  console.log(`  candidate diversity (distinct architectures generated, valid + hard-rejected): ${r.candidateDiversity}`);
  console.log(`  top-${TOP_K} role-order similarity to reference: ${r.topK.map(p => p.roleOrderSimilarity).join(", ")} (best: ${r.bestRoleOrderSimilarityInTopK})`);
  console.log(`  any exact known-part recovered in top-${TOP_K}: ${r.anyKnownPartRecoveredInTopK}`);
  if (r.topK.some(p => p.recoveredKnownParts.length)) {
    console.log(`    recovered: ${JSON.stringify(r.topK.map(p => p.recoveredKnownParts))}`);
  }
  console.log();
}

const reconstructable = report.filter(r => r.reconstructable && r.ran);
console.log("=".repeat(78));
console.log(`SUMMARY: ${reconstructable.length}/${report.length} cached constructs were reconstructable from this project's cached Registry data.`);
if (reconstructable.length) {
  const meanSim = +(reconstructable.reduce((s, r) => s + r.bestRoleOrderSimilarityInTopK, 0) / reconstructable.length).toFixed(3);
  const meanRecall = +(reconstructable.reduce((s, r) => s + r.requiredRoleRecall, 0) / reconstructable.length).toFixed(3);
  console.log(`  mean best-in-top-${TOP_K} role-order similarity: ${meanSim}`);
  console.log(`  mean required-role recall: ${meanRecall}`);
  console.log(`  known-part recovery achieved for: ${reconstructable.filter(r => r.anyKnownPartRecoveredInTopK).map(r => r.referenceId).join(", ") || "none"}`);
  console.log(`  certified-buildable candidate produced for: ${reconstructable.filter(r => r.hasCertifiedBuildableCandidate).map(r => r.referenceId).join(", ") || "none -- see the certification notes above for the specific reason each one failed"}`);
}
console.log(`  not reconstructable (CDS sequence not cached): ${report.filter(r => !r.reconstructable).map(r => r.referenceId).join(", ")}`);
console.log("=".repeat(78));

mkdirSync(path.join(__dirname, "results"), { recursive: true });
const outPath = path.join(__dirname, "results", "reference_reconstruction.json");
writeFileSync(outPath, JSON.stringify({ host: HOST, topK: TOP_K, report }, null, 2));
console.log(`Wrote ${path.relative(REPO_ROOT, outPath)}`);
