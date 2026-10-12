// Automatic Design Mode -- plasmid map data (Phase 4B, Step 9).
//
// Pure data computation for the circular plasmid visualization -- no SVG, no
// React, so it's directly unit-testable and so AutomaticModeUI.jsx's
// PlasmidCircularMap component has nothing to compute itself beyond drawing
// whatever this returns. Every bp coordinate is derived from the candidate's
// REAL plan.order (role, name, id, length) and plan.totalLength -- nothing
// here is hard-coded, and no strand/orientation is invented: every segment is
// "forward" because designer.js's assembly model concatenates every part in
// one forward orientation and has no per-part reverse-strand representation
// at all (see designer.js/design()) -- this is the actual ground truth of
// this project's assembly model, not an assumption made here.

import { classifyProvenance } from "./provenanceModel.js";

export const ROLE_TO_PART_TYPE = { ori: "origin", ori_shuttle: "origin", rep: "cds", reporter: "cds" };

/**
 * @param {object} candidate - a scored/generated candidate (.plan required; .provenanceByRole, .origin, .lockedComponents optional).
 * @param {object} ctx
 * @param {Object<string,object>} ctx.partsById
 * @param {string} [ctx.anchorName] - the name of the part to highlight as the user's anchor/locked component.
 * @param {object} [ctx.anchorPart] - the real anchor part object (from characterizeInput's input.anchorPart),
 *   needed (Phase 4C) to classify a user-supplied/novel anchor's provenance correctly -- without it, a
 *   user-supplied anchor (id:null) cannot be told apart from a genuine unresolved gap.
 * @param {object} [ctx.scored] - the scoreCandidate() result for this candidate, for Registry exact-match lookup (registryExactMatches).
 * @param {object[]} [ctx.siteConflicts] - defaults to candidate.plan.siteConflicts.
 * @returns {{totalBp: number, label: string, segments: Array}}
 */
export function computePlasmidMapSegments(candidate, ctx = {}) {
  const { partsById = {}, anchorName, anchorPart, scored } = ctx;
  const order = candidate.plan.order;
  const total = candidate.plan.totalLength;
  const lockedNames = new Set((candidate.lockedComponents || []).map(c => c.part && c.part.name).filter(Boolean));
  // Phase 6: resolve any locked component (anchor OR an additional locked
  // component, e.g. a Phase 5B custom CDS locked alongside a custom
  // promoter anchor) directly from candidate.lockedComponents's own real
  // part objects -- ALL of them (not just the anchor) are baked into the
  // beam search's initialAssignments before anything is tracked as
  // "resolved", so none of them are ever in candidate.resolvedPartsById,
  // and a custom (non-catalog) one is never in the caller's plain partsById
  // either. Only Pathway B (beam search) candidates carry lockedComponents
  // at all; Pathway A (template-matched) candidates fall through to the
  // anchorPart/effectivePartsById checks below, which is correct for them
  // (see checkLockedComponentsCompatible's own comment in index.js for why
  // Pathway A can never actually incorporate a non-catalog additional lock).
  const lockedPartsById = {};
  for (const lc of candidate.lockedComponents || []) if (lc.part) lockedPartsById[String(lc.part.id)] = lc.part;
  const siteConflicts = ctx.siteConflicts || candidate.plan.siteConflicts || [];
  // Phase 4C.1: a Registry-inserted part's id (e.g. "registry:BBa_J23100")
  // only exists in this candidate's OWN resolvedPartsById (set by
  // architectureGeneration.js) -- never in the caller's plain partsById.
  // Without this merge, such a segment's `rec` lookup below silently fails
  // and the map wrongly reports it as an unresolved gap.
  const effectivePartsById = candidate.resolvedPartsById && Object.keys(candidate.resolvedPartsById).length
    ? { ...partsById, ...candidate.resolvedPartsById }
    : partsById;

  let bp = 0;
  const segments = order.map((o, i) => {
    const start = bp + 1;
    const end = bp + o.length;
    bp += o.length;
    // Phase 6 fix: see lockedPartsById's own comment above -- this fixes a
    // real, previously undetected gap where a custom-part-anchored (or
    // custom-locked) design's map/exports showed that part as an unresolved
    // "missing sequence" segment.
    const rec = (o.id != null && lockedPartsById[String(o.id)]) ? lockedPartsById[String(o.id)]
      : (anchorPart && o.id === anchorPart.id) ? anchorPart
      : (o.id ? effectivePartsById[o.id] : null);
    const type = (rec && rec.type) || ROLE_TO_PART_TYPE[o.role] || o.role;
    const isAnchor = o.name === anchorName;
    const isLocked = lockedNames.has(o.name);
    const evidence = rec ? rec.evidence : (o.id === null ? "placeholder" : null);
    // Phase 4C: sequenceStatus/provenanceStatus is the DATA-PROVENANCE/build-
    // confidence axis (project_verified/registry_recorded/user_supplied/
    // placeholder) -- deliberately separate from `provenance` below, which is
    // the RETRIEVAL-TIER axis (host_curated/family_recommended/registry_recorded/
    // catalog_fallback/locked, i.e. WHERE the search found this part). See
    // provenanceModel.js's header for why these two axes are never conflated.
    const { sequenceStatus, provenanceStatus } = classifyProvenance(rec);
    const provenance = candidate.provenanceByRole?.[o.role] || (candidate.origin === "template" ? "host_curated" : isAnchor || isLocked ? "locked" : null);
    const registryMatch = (scored && scored.registryExactMatches) ? scored.registryExactMatches.find(m => m.localName === o.name) || null : null;
    const conflicts = siteConflicts.filter(c => c.part === o.name);
    return {
      index: i, role: o.role, name: o.name, id: o.id, length: o.length, type,
      start, end, strand: "forward",
      angleStart: total ? (start - 1) / total * 360 : 0,
      angleEnd: total ? end / total * 360 : 0,
      isAnchor, isLocked, evidence, sequenceStatus, provenanceStatus, provenance, registryMatch,
      restrictionConflicts: conflicts,
    };
  });

  return { totalBp: total, label: candidate.templateLabel, segments };
}
