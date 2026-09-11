// Automatic Design Mode -- Phase 6, item 12: low-risk exports for the
// selected/recommended candidate.
//
// Every field exported here is read directly off values this project's own
// pipeline already computed (validateCandidate/scoreCandidate/planAssembly/
// referenceComparison/robustness/plasmidMapData) -- nothing is fabricated,
// re-derived, or guessed for the sake of a "nicer" export. Coordinates come
// from computePlasmidMapSegments()'s own start/end (already used to draw the
// real map), so the GenBank FEATURES table is exactly as reliable as the
// on-screen map -- this is why GenBank is implemented at all (per the Phase
// 6 brief's own "only if feature coordinates can be represented reliably"
// condition). No SBOL is attempted (explicitly out of scope this phase).

import { computePlasmidMapSegments } from "./plasmidMapData.js";
import { buildWorkspaceParts } from "./workspaceHandoff.js";

function wrapSequence(seq, width) {
  const lines = [];
  for (let i = 0; i < seq.length; i += width) lines.push(seq.slice(i, i + width));
  return lines.join("\n");
}

/**
 * @param {object} candidate - a hard-valid runAutomaticDesign() candidate.
 * @param {object} [ctx] - {host, candidateLabel}
 * @returns {string} FASTA text -- header line + the full assembled sequence, wrapped at 70nt.
 */
export function exportFASTA(candidate, ctx = {}) {
  const host = ctx.host ? String(ctx.host).replace(/\s+/g, "_") : "unknown_host";
  const header = `>${ctx.candidateLabel || candidate.candidateId}|host=${host}|${candidate.plan.totalLength}bp|GC${candidate.plan.gc}%|assembly=${candidate.assemblyPlan ? candidate.assemblyPlan.method : "unspecified"}`;
  return `${header}\n${wrapSequence(candidate.plan.sequence, 70)}\n`;
}

// GenBank has a small, fixed vocabulary of standard feature keys; anything
// this project's own role vocabulary doesn't map cleanly to a standard key
// falls back to "misc_feature" -- never invented, never upgraded to imply a
// biological claim GenBank's own vocabulary doesn't already carry.
const ROLE_TO_GENBANK_FEATURE = {
  promoter: "promoter", rbs: "RBS", cds: "CDS", reporter: "CDS", rep: "CDS", marker: "CDS",
  terminator: "terminator", origin: "rep_origin", ori: "rep_origin", ori_shuttle: "rep_origin",
  operator: "misc_feature", signal: "misc_feature", orit: "misc_feature", other: "misc_feature",
};

function genbankDate() {
  const d = new Date();
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${String(d.getUTCDate()).padStart(2, "0")}-${months[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

/**
 * @param {object} candidate
 * @param {object} ctx - {partsById, anchorPart, anchorName, host, scored, candidateLabel}
 * @returns {string} a GenBank flat-file (LOCUS/DEFINITION/FEATURES/ORIGIN), forward-strand only --
 *   this project's own assembly model has no per-part reverse-strand representation (see
 *   plasmidMapData.js's header), so no feature is ever emitted on the complement strand.
 */
export function exportGenBank(candidate, ctx = {}) {
  const mapData = computePlasmidMapSegments(candidate, ctx);
  const total = mapData.totalBp;
  const name = (ctx.candidateLabel || candidate.candidateId).replace(/[^A-Za-z0-9_.]/g, "_").slice(0, 16) || "plasmid";

  const locus = `LOCUS       ${name.padEnd(16)}  ${String(total).padStart(6)} bp    DNA     circular SYN ${genbankDate()}`;
  const definition = `DEFINITION  Automatic Design candidate ${candidate.candidateId}${ctx.host ? `, host ${ctx.host}` : ""} -- computationally designed, not independently wet-lab verified.`;
  const accession = `ACCESSION   .`;
  const version = `VERSION     .`;
  const source = [
    `SOURCE      synthetic DNA construct`,
    `  ORGANISM  synthetic DNA construct`,
  ].join("\n");

  const featureLines = [`FEATURES             Location/Qualifiers`];
  featureLines.push(`     source          1..${total}`);
  featureLines.push(`                     /organism="synthetic DNA construct"`);
  featureLines.push(`                     /mol_type="other DNA"`);
  for (const seg of mapData.segments) {
    const key = ROLE_TO_GENBANK_FEATURE[seg.role] || "misc_feature";
    featureLines.push(`     ${key.padEnd(16)}${seg.start}..${seg.end}`);
    featureLines.push(`                     /label="${seg.name.replace(/"/g, "'")}"`);
    featureLines.push(`                     /note="role=${seg.role}; provenance=${seg.provenanceStatus || "unknown"}${seg.isAnchor ? "; user-supplied anchor" : seg.isLocked ? "; locked component" : ""}"`);
  }

  const seq = (candidate.plan.sequence || "").toLowerCase();
  const originLines = [`ORIGIN`];
  for (let i = 0; i < seq.length; i += 60) {
    const pos = String(i + 1).padStart(9);
    const chunk = seq.slice(i, i + 60);
    const blocks = [];
    for (let j = 0; j < chunk.length; j += 10) blocks.push(chunk.slice(j, j + 10));
    originLines.push(`${pos} ${blocks.join(" ")}`);
  }

  return [locus, definition, accession, version, source, ...featureLines, ...originLines, "//"].join("\n") + "\n";
}

/**
 * @param {object} runResult - the FULL runAutomaticDesign() result (not just the candidate) --
 *   needed for host/goal/requirementPlan/robustness/scoring context.
 * @param {object} candidate - the specific candidate being exported (usually runResult.recommended).
 * @param {object} [ctx] - {partsById, anchorPart}
 * @returns {object} a plain JSON-serializable design report -- see the Phase 6 brief's exact field list.
 */
export function exportJSONReport(runResult, candidate, ctx = {}) {
  const scored = runResult.scoring.ranked.find(r => r.candidateId === candidate.candidateId) || null;
  const mapData = computePlasmidMapSegments(candidate, { ...ctx, scored, anchorName: ctx.anchorPart ? ctx.anchorPart.name : undefined });
  // Sequences come from buildWorkspaceParts()'s own resolution (anchor +
  // ALL locked components, catalog, Registry, or custom) -- reused here
  // rather than re-derived a second time, so this report can never drift
  // from what the "Use This Design" handoff itself would produce. Segment
  // order matches plan.order exactly (both iterate the same array), so
  // zipping by index is safe.
  const workspaceParts = buildWorkspaceParts(candidate, ctx);

  return {
    candidateId: candidate.candidateId,
    generatedAt: new Date().toISOString(),
    host: runResult.characterized.input.host,
    goal: runResult.characterized.input.goal || null,
    goalFamily: runResult.requirementPlan && runResult.requirementPlan.family ? runResult.requirementPlan.family.id : null,
    assemblyMethod: candidate.assemblyPlan ? candidate.assemblyPlan.method : null,
    totalBp: candidate.plan.totalLength,
    gc: candidate.plan.gc,
    origin: candidate.origin,
    goalCompatible: candidate.goalCompatible !== false,
    lockedComponentsCompatible: candidate.lockedComponentsCompatible !== false,
    parts: mapData.segments.map((seg, i) => ({
      order: seg.index,
      name: seg.name,
      role: seg.role,
      type: seg.type,
      id: seg.id,
      startBp: seg.start,
      endBp: seg.end,
      length: seg.length,
      seq: workspaceParts[i] ? workspaceParts[i].seq : null,
      provenanceStatus: seg.provenanceStatus,
      sequenceStatus: seg.sequenceStatus,
      isAnchor: seg.isAnchor,
      isLocked: seg.isLocked,
      registryExactMatch: seg.registryMatch || null,
    })),
    validation: candidate.validation,
    scoreBreakdown: scored ? { overallScore: scored.overallScore, weights: scored.weights, breakdown: scored.breakdown, notes: scored.notes, paretoOptimal: scored.paretoOptimal ?? null } : null,
    registryComparison: scored ? scored.registryComparison || [] : [],
    robustness: (runResult.scoring.robustness && runResult.scoring.robustness.perCandidate && runResult.scoring.robustness.perCandidate[candidate.candidateId])
      ? runResult.scoring.robustness.perCandidate[candidate.candidateId]
      : null,
    assembly: candidate.assemblyPlan ? { method: candidate.assemblyPlan.method, feasible: candidate.assemblyPlan.feasible, fragmentCount: candidate.assemblyPlan.fragmentCount, conflicts: candidate.assemblyPlan.conflicts, rationale: candidate.assemblyPlan.rationale } : null,
    modelLimitations: [
      "This report describes a computationally generated design that passes this project's own design constraints -- it is NOT experimentally validated and is not a prediction of wet-lab success.",
      "Registry presence (where shown) reflects a cached iGEM Registry record, not independent verification by this project.",
      "User-supplied sequences are used exactly as provided and have not been independently verified.",
      "Ranking/robustness figures measure sensitivity of the ranking to scoring-weight perturbation, not biological probability.",
      "Unknown host compatibility is reported as unknown, never inferred as compatible or incompatible.",
    ],
  };
}
