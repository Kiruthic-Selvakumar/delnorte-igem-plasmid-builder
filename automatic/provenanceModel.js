// Automatic Design Mode -- evidence / provenance model (Phase 4C hardening pass).
//
// Two INDEPENDENT axes, deliberately never conflated:
//
//   sequenceStatus   -- do we actually have a real, syntactically valid DNA
//                       sequence resolved for this role at all?
//                         "resolved" -- a real ACGT(N) sequence is present
//                         "missing"  -- no sequence (gap, or a catalog part
//                                       with seq:null)
//                         "invalid"  -- a sequence is present but fails basic
//                                       DNA-alphabet validation
//
//   provenanceStatus -- WHERE did that resolved sequence/role assignment come
//                       from, and what does THIS PROJECT's own rules say
//                       about it? NEVER a claim of biological/wet-lab
//                       verification, no matter which value it takes:
//                         "project_verified" -- data/parts.json's own
//                             evidence:"verified" -- this project's own
//                             curated citation, per CLAUDE.md.
//                         "registry_recorded" -- exact sequence + role came
//                             from a real cached iGEM Registry record (see
//                             registryClient.js). Registry presence/age/usage
//                             is explicitly NOT project verification and NOT
//                             wet-lab validation -- see the Phase 2.5 report's
//                             provenance-vocabulary distinction, which this
//                             reuses rather than reinventing.
//                         "user_supplied" -- the user pasted a syntactically
//                             valid DNA sequence at runtime (characterizeInput.js's
//                             "novel_sequence" mode). Known, but NOT
//                             independently verified by this project.
//                         "placeholder" -- this project's own catalog marks
//                             the part evidence:"placeholder" (CLAUDE.md:
//                             never "verified" without a real source) -- the
//                             component itself is not resolved to this
//                             project's own standard, regardless of whether a
//                             sequence happens to be on file for it.
//
// THE PHASE 4B BUG THIS FIXES: raw user-supplied DNA and Registry-inserted
// parts were BOTH represented using data/parts.json's own 2-value
// evidence:"verified"|"placeholder" field (the only two values CLAUDE.md's
// schema rule allows THERE), and validateCandidate() hard-rejected ANY
// "placeholder"-evidence part -- so a perfectly valid, syntactically-checked,
// user-supplied sequence could never produce a certified-buildable candidate,
// directly contradicting the Discord requirement ("a whole plasmid is built
// around that input"). The fix is NOT to change data/parts.json's schema (it
// stays exactly evidence:"verified"|"placeholder", and designer.js#design() /
// Template-Guided Mode are completely untouched, still driven by that same
// 2-value field) -- it is to compute this richer, 4-value provenanceStatus
// ONLY within Automatic Design Mode's own candidate-evaluation layer, from
// the shape of a resolved role's part object, and to make HARD VALIDATION
// consult THIS model instead of the raw evidence field.

import { isValidDNA } from "./dna.js";

export const SEQUENCE_STATUSES = ["resolved", "missing", "invalid"];
export const PROVENANCE_STATUSES = ["project_verified", "registry_recorded", "user_supplied", "placeholder"];

/** Where a resolved part's sequence/role assignment came from -- see this
 * file's header for what each value does and does NOT mean. Structural
 * inference only, from fields these objects already carry (registryClient.js's
 * registryProvenance; customPartRegistry.js's customPartProvenance;
 * characterizeInput.js's id:null novel-sequence anchors; data/parts.json's
 * own evidence field) -- nothing here is guessed. */
function provenanceOf(part) {
  if (part.registryProvenance) return "registry_recorded";
  // Phase 5B: a registered custom (external) part -- checked BEFORE the
  // id===null check below, since a custom part has a real, stable
  // "userpart:<id>" id (never null) so it can be resolved via ordinary
  // partsById lookups everywhere else in the pipeline; this marker is the
  // ONLY thing that distinguishes it from a genuine catalog part.
  if (part.customPartProvenance) return "user_supplied";
  if (part.id === null) return "user_supplied"; // characterizeInput.js's "novel_sequence" (raw-paste) anchors are id:null
  if (part.evidence === "verified") return "project_verified";
  return "placeholder";
}

/**
 * @param {object|null} part - a resolved role's part object (a data/parts.json
 *   catalog part, a characterizeInput.js novel/user-supplied anchor, or a
 *   registryClient.js#getInsertableCandidates Registry-inserted part), or
 *   null for an unresolved/gapped role.
 * @returns {{sequenceStatus: "resolved"|"missing"|"invalid", provenanceStatus: string|null}}
 */
export function classifyProvenance(part) {
  if (!part) return { sequenceStatus: "missing", provenanceStatus: null };
  if (!part.seq) return { sequenceStatus: "missing", provenanceStatus: provenanceOf(part) };
  if (!isValidDNA(part.seq)) return { sequenceStatus: "invalid", provenanceStatus: provenanceOf(part) };
  return { sequenceStatus: "resolved", provenanceStatus: provenanceOf(part) };
}

/** Phase 4C hard-validation rule: reject a missing/invalid sequence, and
 * reject "placeholder" provenance (this project's own explicit "not yet
 * resolved to this project's standard" signal) -- but NEVER reject solely
 * for "registry_recorded" or "user_supplied" provenance. Those instead get a
 * confidence WARNING (see provenanceConfidenceNote below), never a rejection. */
export function isHardRejectedProvenance({ sequenceStatus, provenanceStatus }) {
  if (sequenceStatus !== "resolved") return true;
  return provenanceStatus === "placeholder";
}

/** A short, honest, non-alarming confidence note for a provenance that is not
 * project_verified -- always phrased as a DATA-PROVENANCE fact, never a
 * biological/wet-lab claim, and never upgraded/downgraded by anything other
 * than this fixed mapping. Returns null for project_verified/placeholder
 * (placeholder already gets its own rejection reason; project_verified needs
 * no extra caveat). */
export function provenanceConfidenceNote(provenanceStatus, name) {
  switch (provenanceStatus) {
    case "registry_recorded":
      return `"${name}" is registry_recorded: its sequence and role come from a real cached iGEM Registry record, not from this project's own curated verification. Registry presence/age/usage is not biological or wet-lab validation.`;
    case "user_supplied":
      return `"${name}" is user_supplied: a syntactically valid DNA sequence was provided and is used as-is, but it has not been independently verified by this project.`;
    default:
      return null;
  }
}
