// Automatic Design Mode -- Phase 6, item 3: candidate -> downstream workspace handoff.
//
// "Use This Design" converts a hard-valid Automatic Design candidate into the
// SAME normalized plasmid-representation shape Template-Guided Mode's own
// `parts` state array already uses (index.html's App()) -- {srcId, name,
// type, role, seq, len} per part -- so the EXISTING, unmodified Map/Parts/
// Sequence/Delivery views and Assemble button in index.html can display and
// operate on it with ZERO new rendering code. This module does only the pure,
// unit-testable conversion; index.html's App() owns the actual React state
// assignment (setParts/setHost/etc.), since that requires component state
// this module has no business holding.
//
// Every sequence returned here is read directly off the candidate's own
// already-validated plan/resolved parts -- nothing is re-derived, re-
// optimized, or reverse-complemented. A hard-valid candidate (the only kind
// this is ever called on) has already passed validateCandidate(), so every
// resolved part is guaranteed to have sequenceStatus:"resolved" -- this
// module does not re-check that, it only NAMES which source each sequence
// came from (see buildEffectivePartsById's header).

import { ROLE_TO_PART_TYPE } from "./plasmidMapData.js";
import { classifyProvenance } from "./provenanceModel.js";

/** The SAME "virtual/merged partsById" pattern used throughout this project
 * (registryClient.js's Registry-inserted parts, customPartRegistry.js's
 * custom parts, architectureGeneration.js's per-candidate resolvedPartsById):
 * a candidate's own resolvedPartsById (Registry/custom extras beam search
 * resolved specifically for THIS candidate) is merged on top of the caller's
 * plain catalog partsById, exactly mirroring assemblyPlanning.js's and
 * plasmidMapData.js's own merge. */
export function buildEffectivePartsById(candidate, partsById) {
  return candidate.resolvedPartsById && Object.keys(candidate.resolvedPartsById).length
    ? { ...partsById, ...candidate.resolvedPartsById }
    : partsById;
}

/**
 * @param {object} candidate - a hard-valid runAutomaticDesign() candidate (candidate.validation.valid === true).
 * @param {object} ctx
 * @param {Object<string,object>} ctx.partsById - the plain catalog (data/parts.json shape), same as passed to runAutomaticDesign.
 * @param {object} [ctx.anchorPart] - characterized.input.anchorPart, needed to resolve a raw/novel (id:null) anchor's sequence.
 * @returns {Array<{srcId: string|null, name: string, type: string, role: string, seq: string|null, len: number, locked: boolean, provenanceStatus: string|null, sequenceStatus: string}>}
 */
export function buildWorkspaceParts(candidate, ctx = {}) {
  const { partsById = {}, anchorPart } = ctx;
  const effectivePartsById = buildEffectivePartsById(candidate, partsById);
  const lockedNames = new Set((candidate.lockedComponents || []).map(c => c.part && c.part.name).filter(Boolean));
  // Same fix as plasmidMapData.js's computePlasmidMapSegments: resolve ANY
  // locked component (anchor OR an additional locked component, e.g. a
  // custom CDS locked alongside a custom promoter anchor) from
  // candidate.lockedComponents's own real part objects first -- none of
  // them are ever present in the plain catalog or in
  // candidate.resolvedPartsById (see that file's comment for why).
  const lockedPartsById = {};
  for (const lc of candidate.lockedComponents || []) if (lc.part) lockedPartsById[String(lc.part.id)] = lc.part;

  return candidate.plan.order.map(o => {
    const rec = (o.id != null && lockedPartsById[String(o.id)]) ? lockedPartsById[String(o.id)]
      : (anchorPart && o.id === anchorPart.id) ? anchorPart
      : (o.id != null ? effectivePartsById[o.id] : null);
    const seq = rec && rec.seq ? rec.seq : null;
    const { sequenceStatus, provenanceStatus } = classifyProvenance(rec);
    return {
      srcId: o.id,
      name: o.name,
      type: (rec && rec.type) || ROLE_TO_PART_TYPE[o.role] || o.role,
      role: o.role,
      seq,
      len: seq ? seq.length : 0,
      locked: o.name === (anchorPart && anchorPart.name) || lockedNames.has(o.name),
      provenanceStatus,
      sequenceStatus,
    };
  });
}

/**
 * Full handoff bundle: workspace-shaped parts plus the scalar fields the
 * Phase 6 spec calls out (total bp, GC, host, assembly method) -- everything
 * a caller needs to populate Template-Guided's App()-level state in one call,
 * without re-deriving any of it from the candidate a second time.
 *
 * @param {object} candidate
 * @param {object} ctx - see buildWorkspaceParts; also accepts ctx.host, ctx.assemblyMethod.
 */
export function buildWorkspaceHandoff(candidate, ctx = {}) {
  const parts = buildWorkspaceParts(candidate, ctx);
  return {
    parts,
    totalBp: candidate.plan.totalLength,
    gc: candidate.plan.gc,
    assembledSequence: candidate.plan.sequence,
    host: ctx.host || null,
    assemblyMethod: ctx.assemblyMethod || (candidate.assemblyPlan && candidate.assemblyPlan.method) || null,
  };
}
