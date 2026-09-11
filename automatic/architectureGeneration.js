// Automatic Design Mode -- true, part-first, constraint-based architecture
// generation (Phase 4A: single-CDS-anchor beam search; Phase 4B: generalized
// to one-or-more LOCKED USER COMPONENTS, constraint-engine-pruned beam search,
// and a 3-tier part-retrieval hierarchy).
//
// LOCKED COMPONENTS (Phase 4B): a design may fix more than one user-specified
// component (e.g. a locked promoter AND a locked CDS for a promoter-anchored
// workflow -- see designRequirements.js/index.js for how that's derived).
// Every locked component's role is removed from the branching/retrieval loop
// entirely -- it is assigned once, up front, and never touched again. Exactly
// one locked component may be the designer.js "user_supplied" component
// (passed as design()'s userCds parameter, the only mechanism that accepts an
// arbitrary in-memory part not already in partsById, e.g. a novel raw
// sequence); every OTHER locked component must already exist in partsById
// (a real catalog part with a real id) and is placed via the ordinary
// single-candidate slot mechanism designer.js's fillTemplate() already
// supports -- no changes to designer.js were needed or made.
//
// CONSTRAINT-ENGINE PRUNING (Phase 4B, extended Phase 4C): before Phase 4B, an
// ori/rep incompatibility or an unreachable dependency was only discovered
// AFTER fully assembling a candidate, via validateCandidate(). Real pruning
// checks now run DURING branching, from constraintEngine.js, reading
// designGrammar.js's typed rules and data/templates.json's own per-host
// candidate lists:
//   1. checkHostEligibility -- a branch whose part is either (a) a documented
//      incompatibility (e.g. AmpR for V. natriegens) or (b) documented in
//      data/templates.json ONLY for a DIFFERENT host (Phase 4C -- this is
//      what the ablation study's ablateHostFiltering finding exposed: without
//      an INDEPENDENT check here, disabling retrieval-tier host filtering let
//      B.-subtilis-only parts leak into a V. natriegens design) is dropped
//      immediately, never added to the beam. Absent host documentation is
//      always "unknown", never treated as incompatible.
//   2. dependencyFeasibility -- a branch whose chosen part requires a cognate
//      partner (e.g. an oriV needing its Rep) is dropped immediately if that
//      partner is PROVABLY unreachable (not present in that role's own
//      candidate pool at all) -- not merely "not yet assigned".
// validateCandidate() ALSO re-runs checkHostEligibility as an UNCONDITIONAL
// final safety net (never gated by ablation.ablatePruning/ablateHostFiltering)
// -- this pruning only avoids wasting beam slots on partials already provably
// doomed, it never replaces final validation.
//
// PART-RETRIEVAL HIERARCHY (Phase 4B), per role, in order:
//   1. project-curated, host-documented parts (this host's own template
//      candidate lists for this role -- unchanged from Phase 4A).
//   2. Registry-recorded, insertable parts (registryClient.getInsertableCandidates,
//      Phase 4B -- only used when tier 1 is empty; always data/parts.json-style
//      evidence:"placeholder" (never "verified", see registryClient.js's own
//      note), but classified provenanceStatus:"registry_recorded" (Phase 4C,
//      see provenanceModel.js) -- NOT hard-rejected on that basis alone.
//   3. wide, host-undifferentiated local catalog -- ONLY for structural
//      backbone roles (FALLBACK_ELIGIBLE_ROLES), unchanged from Phase 4A's
//      bug-fixed behavior (never for purpose-specific roles like "signal"/
//      "reporter", to avoid the cross-host contamination bug fixed in 4A).
// Every retrieved part's tier is recorded on the candidate as `provenance`.

import { design } from "../designer.js";
import { validateCandidate } from "./candidateValidation.js";
import { CANONICAL_ROLE_ORDER } from "./designRequirements.js";
import { ARCHITECTURE_FAMILIES } from "./designGrammar.js";
import { dependencyFeasibility, checkHostEligibility, buildDocumentedHostsIndex } from "./constraintEngine.js";

export const DEFAULT_BEAM_WIDTH = 5;
export const DEFAULT_CANDIDATES_PER_ROLE = 3;

const FALLBACK_ELIGIBLE_ROLES = ["ori", "rep", "orit", "ori_shuttle", "marker", "promoter", "rbs", "terminator"];
const ROLE_TO_PART_TYPE = { ori: "origin", ori_shuttle: "origin", rep: "cds", reporter: "cds" };

function normHost(h) { return String(h || "").trim().toLowerCase(); }
function partTypeForRole(role) { return ROLE_TO_PART_TYPE[role] || role; }

/** Every part id this host's own template(s) already document as a valid
 * candidate for this exact role -- a real, per-host, per-role allow-list read
 * straight from data/templates.json, never inferred or fabricated.
 *
 * `ablateHostFiltering` (Phase 4B Step 12 ablation-study hook ONLY, default
 * false, never set by runAutomaticDesign()'s normal path): when true, the
 * host check below is skipped, so a template's curated candidates are
 * treated as eligible for EVERY host, not just the one it actually
 * documents them for. This exists solely so benchmark/ablation_analysis.mjs
 * can measure what host-aware filtering actually buys this project (e.g.
 * whether a V. natriegens design would otherwise pick up an E.-coli-only
 * curated part) -- it must never be enabled outside that benchmark. */
function hostCuratedIdsForRole(role, host, templates, ablateHostFiltering) {
  const ids = new Set();
  for (const t of templates || []) {
    if (!ablateHostFiltering && normHost(t.host) !== normHost(host)) continue;
    for (const slot of t.slots) if (slot.role === role) for (const id of (slot.candidates || [])) ids.add(id);
  }
  return ids;
}

/** Mines {oriPartId: [requiredCognatePartIds]} from every template's `requires`
 * field -- real, already-documented cross-part dependencies, never invented. */
export function mineOriRequires(templates) {
  const map = {};
  for (const t of templates || []) {
    for (const slot of t.slots) {
      if (slot.requires) for (const [id, reqIds] of Object.entries(slot.requires)) map[id] = reqIds;
    }
  }
  return map;
}

const byEvidenceThenId = (a, b) => (a.evidence === "verified") !== (b.evidence === "verified")
  ? (a.evidence === "verified" ? -1 : 1)
  : a.id.localeCompare(b.id);

/** Resolves a family's recommendedPartIds entry (a mix of ordinary catalog
 * ids and "registry:<RegistryID>" ids, see designGrammar.js) into real,
 * usable part records -- the ONLY place a "registry:" id is translated back
 * into a Registry-insertable part, via the SAME adapter tier-2 retrieval
 * already uses (registryClient.getInsertableCandidates), never a new one. */
function resolveRecommendedParts(ids, role, partsById, registryClient) {
  const registryPool = registryClient && registryClient.available ? registryClient.getInsertableCandidates(role) : [];
  return ids
    .map(id => partsById[id] || registryPool.find(p => p.id === id))
    .filter(Boolean);
}

/** @returns {{list: object[], provenance: "family_recommended"|"host_curated"|"registry_recorded"|"catalog_fallback"}}
 * `ablation` (Phase 4B Step 12 hook ONLY, see generateArchitectures' own doc
 * comment; always {} on runAutomaticDesign()'s normal path):
 *   - ablateHostFiltering: see hostCuratedIdsForRole above.
 *   - ablateGoalRules: skips Tier 0 (the family's own recommendedPartIds)
 *     entirely, regardless of which family was selected.
 *   - ablateRegistryEvidence: skips Tier 2 (Registry-insertable parts), AND
 *     Tier 0's resolveRecommendedParts is also passed no registryClient, so a
 *     family recommendation that only resolves via a "registry:" id becomes
 *     unavailable too. */
function retrieveRoleCandidates(role, host, templates, partsById, registryClient, limit, family, ablation = {}) {
  const partType = partTypeForRole(role);
  const effectiveRegistryClient = ablation.ablateRegistryEvidence ? null : registryClient;

  // Tier 0: see the Phase 4B report / this function's doc comment for why
  // this tier exists and runs before the generic host-curated tier.
  const availability = !ablation.ablateGoalRules && family && family.hostAvailability[host];
  if (availability && availability.recommendedPartIds && availability.recommendedPartIds[role]) {
    const recommended = resolveRecommendedParts(availability.recommendedPartIds[role], role, partsById, effectiveRegistryClient).sort(byEvidenceThenId);
    if (recommended.length) return { list: recommended.slice(0, limit), provenance: "family_recommended" };
  }

  const curatedIds = hostCuratedIdsForRole(role, host, templates, ablation.ablateHostFiltering);
  const curated = [...curatedIds].map(id => partsById[id]).filter(p => p && p.type === partType).sort(byEvidenceThenId);
  if (curated.length) return { list: curated.slice(0, limit), provenance: "host_curated" };

  if (effectiveRegistryClient && effectiveRegistryClient.available) {
    const registryCandidates = effectiveRegistryClient.getInsertableCandidates(role);
    if (registryCandidates.length) return { list: registryCandidates.slice(0, limit), provenance: "registry_recorded" };
  }

  if (!FALLBACK_ELIGIBLE_ROLES.includes(role)) return { list: [], provenance: "catalog_fallback" };
  const wide = Object.values(partsById).filter(p => p.type === partType).sort(byEvidenceThenId);
  return { list: wide.slice(0, limit), provenance: wide.length ? "catalog_fallback" : "host_curated" };
}

function candidatesForRoleStep(role, partial, host, templates, partsById, registryClient, oriRequires, limit, family, ablation) {
  if (role === "rep") {
    const oriId = partial.assignments.ori && partial.assignments.ori.id;
    const preferredIds = oriRequires[oriId] || [];
    const preferred = preferredIds.map(id => partsById[id]).filter(Boolean);
    if (preferred.length) return { list: preferred, provenance: "host_curated" };
  }
  return retrieveRoleCandidates(role, host, templates, partsById, registryClient, limit, family, ablation);
}

/** Transparent preliminary pruning score -- see Phase 4A/4B report for the
 * placeholder-penalty rationale (avoiding a doomed-but-positively-scored
 * branch crowding out a safe "omit this optional role" alternative). */
function partialScore(partial, requiredRoles, optionalRoles) {
  let score = 0;
  for (const role of requiredRoles) {
    const p = partial.assignments[role];
    if (p) score += p.evidence === "verified" ? 1 : 0.3;
  }
  for (const role of optionalRoles) {
    const p = partial.assignments[role];
    if (p) score += p.evidence === "verified" ? 0.3 : -0.5;
  }
  return score;
}

function signatureOf(partial, roles) {
  return roles.map(r => (partial.assignments[r] ? partial.assignments[r].id : "-")).join("|");
}

/**
 * @param {object} opts
 * @param {object} opts.requirementPlan - from planDesignRequirements().
 * @param {object[]} [opts.lockedComponents] - [{role, part}], Phase 4B. Every role here is fixed, never branched.
 * @param {object} [opts.anchorPart] - Phase 4A backward-compat single-anchor form; equivalent to
 *   lockedComponents=[{role: requirementPlan.anchorRole, part: anchorPart}] when lockedComponents is omitted.
 * @param {string} opts.host
 * @param {Object<string,object>} opts.partsById
 * @param {object[]} [opts.templates]
 * @param {object} [opts.registryClient] - from createRegistryClient(); enables tier-2 Registry-insertable retrieval.
 * @param {number} [opts.beamWidth]
 * @param {number} [opts.candidatesPerRole]
 * @param {number} [opts.maxCandidates]
 * @param {object} [opts.ablation] - Phase 4B Step 12 ablation-study hooks ONLY, all default false/off and
 *   NEVER set by runAutomaticDesign()'s normal path -- see benchmark/ablation_analysis.mjs, the only caller
 *   that ever sets these: {ablateHostFiltering, ablateGoalRules, ablateRegistryEvidence, ablatePruning}.
 * @param {object} [opts.stats] - Phase 4B Step 12/15 instrumentation ONLY: if provided, this object is
 *   mutated in place with {partialsConsidered, prunedByIncompatibility, prunedByDependency, beamSizeByStage}
 *   so benchmark/ablation_analysis.mjs and the performance benchmark can report real search-effort numbers
 *   without changing this function's return shape.
 * @returns {Array} full candidates (candidateId, templateId, templateLabel, assembly, variedSlot, originalTemplate,
 *   plan, validation, origin, fallbackRoles, provenanceByRole, constraintTrace).
 */
export function generateArchitectures(opts) {
  const {
    requirementPlan, host, partsById, templates, registryClient,
    beamWidth = DEFAULT_BEAM_WIDTH, candidatesPerRole = DEFAULT_CANDIDATES_PER_ROLE, maxCandidates,
    ablation = {},
  } = opts;
  const stats = opts.stats || null;
  if (stats) Object.assign(stats, { partialsConsidered: 0, prunedByIncompatibility: 0, prunedByHostIneligibility: 0, prunedByDependency: 0, beamSizeByStage: [] });

  const lockedComponents = opts.lockedComponents && opts.lockedComponents.length
    ? opts.lockedComponents
    : [{ role: requirementPlan.anchorRole, part: opts.anchorPart }];
  const userSuppliedComponent = lockedComponents.find(c => c.role === requirementPlan.anchorRole) || lockedComponents[0];
  const bakedLockedComponents = lockedComponents.filter(c => c !== userSuppliedComponent);
  for (const c of bakedLockedComponents) {
    if (!c.part || c.part.id == null || !partsById[c.part.id]) {
      throw new Error(`Locked component for role "${c.role}" must be an existing catalog part (have an id present in partsById) -- only the anchor role ("${requirementPlan.anchorRole}") may be a novel/raw-sequence part.`);
    }
  }

  const oriRequires = mineOriRequires(templates);
  const documentedHostsIndex = buildDocumentedHostsIndex(templates);
  const family = requirementPlan.family ? ARCHITECTURE_FAMILIES[requirementPlan.family.id] : null;
  const orderIndex = r => { const i = CANONICAL_ROLE_ORDER.indexOf(r); return i === -1 ? CANONICAL_ROLE_ORDER.length : i; };
  const lockedRoles = new Set(lockedComponents.map(c => c.role));
  const requiredRoles = [...new Set([...requirementPlan.requiredRoles, ...lockedComponents.map(c => c.role)])];
  const supportingRoles = [...new Set([...requiredRoles, ...requirementPlan.optionalRoles])]
    .filter(r => !lockedRoles.has(r))
    .sort((a, b) => orderIndex(a) - orderIndex(b));
  const fullRoleOrder = [...new Set([...supportingRoles, ...lockedRoles])].sort((a, b) => orderIndex(a) - orderIndex(b));

  // Precomputed once, ignoring per-partial ori->rep nudging, purely to answer
  // "could role X EVER contain part Y" for dependencyFeasibility pruning.
  const allRoleCandidatePools = {};
  for (const role of supportingRoles) allRoleCandidatePools[role] = retrieveRoleCandidates(role, host, templates, partsById, registryClient, 100, family, ablation).list;

  const initialAssignments = Object.fromEntries(lockedComponents.map(c => [c.role, c.part]));
  const initialProvenance = Object.fromEntries(lockedComponents.map(c => [c.role, "locked"]));
  let beam = [{ assignments: initialAssignments, provenanceByRole: initialProvenance, fallbackRoles: [] }];

  for (const role of supportingRoles) {
    const isRequired = requiredRoles.includes(role);
    const nextBeam = [];
    for (const partial of beam) {
      const { list: candidates, provenance } = candidatesForRoleStep(role, partial, host, templates, partsById, registryClient, oriRequires, candidatesPerRole, family, ablation);
      let survivedPruning = 0;
      for (const part of candidates) {
        if (stats) stats.partialsConsidered++;
        if (!ablation.ablatePruning) {
          // checkHostEligibility subsumes checkIncompatibility (a documented
          // incompatibility rule) AND adds the Phase 4C host-specific-
          // elsewhere check -- run UNCONDITIONALLY here (never gated by
          // ablation.ablateHostFiltering, which only ablates the retrieval
          // TIER's host filtering, a separate mechanism) so a cross-host part
          // is pruned during search regardless of that flag; validateCandidate()
          // re-checks this independently at the end as the final safety net.
          const hostCheck = checkHostEligibility(part, host, documentedHostsIndex);
          if (!hostCheck.ok) {
            if (stats) { if (hostCheck.status === "incompatible") stats.prunedByIncompatibility++; else stats.prunedByHostIneligibility = (stats.prunedByHostIneligibility || 0) + 1; }
            continue; // pruned: documented incompatibility or host-specific-elsewhere, never added to the beam
          }
          const depFeasibility = dependencyFeasibility(part, allRoleCandidatePools);
          if (depFeasibility.hasRequirement && !depFeasibility.feasible) { if (stats) stats.prunedByDependency++; continue; } // pruned: cognate partner provably unreachable
        }
        survivedPruning++;
        nextBeam.push({
          assignments: { ...partial.assignments, [role]: part },
          provenanceByRole: { ...partial.provenanceByRole, [role]: provenance },
          fallbackRoles: provenance === "catalog_fallback" ? [...partial.fallbackRoles, role] : partial.fallbackRoles,
        });
      }
      // Robustness fix: fall back to "no part assigned" (a reportable gap,
      // not a silently vanished branch) whenever EVERY retrieved candidate
      // for this role got pruned, not only when retrieval found literally
      // nothing. Without this, a required role where retrieval finds N>0
      // candidates but a hard constraint (incompatibility/host-eligibility/
      // dependency) rejects ALL of them would drop this partial from the
      // beam with no trace -- discovered via benchmark/ablation_analysis.mjs's
      // ablateHostFiltering case, where a widened-but-still-pruned candidate
      // pool for one role could empty the ENTIRE beam with no explanation.
      if (!isRequired || candidates.length === 0 || survivedPruning === 0) {
        nextBeam.push({ assignments: { ...partial.assignments, [role]: null }, provenanceByRole: partial.provenanceByRole, fallbackRoles: partial.fallbackRoles });
      }
    }
    for (const p of nextBeam) p.score = partialScore(p, requiredRoles, requirementPlan.optionalRoles);
    nextBeam.sort((a, b) => b.score - a.score);
    const seen = new Set();
    beam = [];
    for (const p of nextBeam) {
      const sig = signatureOf(p, supportingRoles);
      if (seen.has(sig)) continue;
      seen.add(sig);
      beam.push(p);
      if (beam.length >= beamWidth) break;
    }
    if (stats) stats.beamSizeByStage.push({ role, beamSize: beam.length, nextBeamBeforeTrim: nextBeam.length });
  }

  const cap = maxCandidates || beamWidth;
  const out = [];
  let n = 0;
  for (const partial of beam) {
    if (out.length >= cap) break;
    n++;
    const slots = fullRoleOrder.map(role => {
      if (role === userSuppliedComponent.role) return { role, required: true, user_supplied: true, candidates: [] };
      const part = partial.assignments[role];
      return { role, required: requiredRoles.includes(role), candidates: part ? [part.id] : [] };
    });
    const syntheticTemplate = {
      id: `generated_${n}`,
      host,
      label: `Generated architecture #${n}`,
      assembly: "gibson",
      slots,
      generated: true,
    };
    // fillTemplate()/design() resolve every slot candidate id via partsById --
    // a Registry-inserted part's id (e.g. "registry:BBa_J23100") only exists
    // in the object retrieveRoleCandidates already returned, never in the
    // caller's own partsById. Merge every assignment's real part object in by
    // id before calling design(), so the lookup always succeeds regardless of
    // which retrieval tier it came from -- design() itself is not modified.
    const partsByIdWithResolved = { ...partsById };
    for (const part of Object.values(partial.assignments)) if (part) partsByIdWithResolved[part.id] = part;
    const plan = design(syntheticTemplate, partsByIdWithResolved, userSuppliedComponent.part);
    const validation = validateCandidate(plan, { anchorPart: userSuppliedComponent.part, partsById: partsByIdWithResolved, host, documentedHostsIndex });
    // Phase 4C.1: every OTHER consumer of this candidate (assemblyPlanning.js,
    // explain.js, plasmidMapData.js) only ever receives the CALLER's original
    // partsById (data/parts.json), which never contains a Registry-inserted
    // "registry:<id>" entry -- that mapping only ever existed in this
    // function's own local partsByIdWithResolved, above. Without it, those
    // consumers silently treat a real, resolved Registry part as if it had no
    // sequence at all (a real bug found via manual browser testing: Gibson
    // primer generation reported "no sequence on file" for a promoter that, in
    // fact, has one). Expose only the EXTRA entries (never already in the
    // caller's own partsById) so every downstream consumer can merge them in.
    const resolvedPartsById = {};
    for (const part of Object.values(partial.assignments)) {
      if (part && part.id != null && !partsById[part.id]) resolvedPartsById[part.id] = part;
    }
    out.push({
      candidateId: `beam__${n}`,
      templateId: syntheticTemplate.id,
      templateLabel: syntheticTemplate.label,
      assembly: syntheticTemplate.assembly,
      variedSlot: null,
      originalTemplate: syntheticTemplate,
      plan,
      validation,
      origin: "beam_search",
      fallbackRoles: partial.fallbackRoles,
      provenanceByRole: partial.provenanceByRole,
      lockedComponents,
      resolvedPartsById,
    });
  }
  return out;
}
