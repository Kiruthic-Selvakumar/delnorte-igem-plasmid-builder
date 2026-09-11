// Automatic Design Mode -- orchestrator and public entry point.
//
// Pipeline (Phase 4A): characterizeInput -> TWO parallel candidate-generation
// pathways, merged, both flowing through the SAME downstream evaluation:
//
//   Pathway A (Phase 1-3, unchanged): selectArchitecture() picks host/role-
//   compatible templates from data/templates.json as PRIOR/reference
//   architectures; generateCandidates() fills them (default + single-slot
//   swaps).
//
//   Pathway B (Phase 4A, new): planDesignRequirements() derives which roles a
//   plasmid built around this anchor needs (from the templates' own
//   documented structure + Registry corroboration + a small set of
//   recognized design goals -- see designRequirements.js), then
//   generateArchitectures() builds NEW architectures around the anchor via
//   bounded beam search (see architectureGeneration.js) -- no template
//   selection involved. Only enabled for role:"cds" today (see the Phase 4A
//   report for why other anchor roles aren't yet defensible).
//
// Both pathways' candidates are merged into one list and run through the
// IDENTICAL validateCandidate -> scoreCandidate -> rankCandidates ->
// computeParetoFront -> analyzeRankingRobustness pipeline from Phases 1-3,
// completely unchanged -- Phase 4A adds WHERE candidates come from, not how
// they're evaluated. Invalid candidates from either pathway are excluded the
// same way (never scored, never rankable, never outrank a valid one).
//
// Template-based generation failing (no host/role-compatible template) no
// longer hard-fails the whole pipeline by itself -- if beam search still
// produced at least one candidate, the run proceeds. Only a genuinely empty
// merged candidate list (both pathways unavailable/empty) is reported as a
// failure.

import { characterizeInput, toInternalRole } from "./characterizeInput.js";
import { selectArchitecture } from "./architectureSelection.js";
import { retrieveCandidateParts, generateCandidates } from "./candidateGeneration.js";
import { validateCandidate } from "./candidateValidation.js";
import { planDesignRequirements, CANONICAL_ROLE_ORDER } from "./designRequirements.js";
import { generateArchitectures, DEFAULT_BEAM_WIDTH, DEFAULT_CANDIDATES_PER_ROLE } from "./architectureGeneration.js";
import { scoreCandidate, SCORE_WEIGHTS, ACTIVE_DIMENSIONS } from "./scoreCandidate.js";
import { rankCandidates, computeParetoFront, compareCandidates } from "./ranking.js";
import { createRegistryClient, EMPTY_REGISTRY } from "./registryClient.js";
import { analyzeRankingRobustness, DEFAULT_TRIALS, DEFAULT_SEED } from "./robustness.js";
import { planAssembly, SUPPORTED_ASSEMBLY_METHODS } from "./assemblyPlanning.js";
import { explainRecommendation } from "./explain.js";
import { computePlasmidMapSegments, ROLE_TO_PART_TYPE } from "./plasmidMapData.js";
import { ARCHITECTURE_FAMILIES, getSupportedFamiliesForHost, matchFamilyByGoalText, rulesByType } from "./designGrammar.js";
import { classifyProvenance } from "./provenanceModel.js";
import { createCustomPartRegistry, normalizeCustomPartRole, SUPPORTED_CUSTOM_PART_ROLES } from "./customPartRegistry.js";
import { buildWorkspaceParts, buildWorkspaceHandoff, buildEffectivePartsById } from "./workspaceHandoff.js";
import { exportFASTA, exportJSONReport, exportGenBank } from "./exportFormats.js";

export {
  characterizeInput, selectArchitecture, retrieveCandidateParts, generateCandidates, validateCandidate,
  planDesignRequirements, CANONICAL_ROLE_ORDER, generateArchitectures, DEFAULT_BEAM_WIDTH, DEFAULT_CANDIDATES_PER_ROLE,
  scoreCandidate, SCORE_WEIGHTS, ACTIVE_DIMENSIONS, rankCandidates, computeParetoFront, compareCandidates,
  createRegistryClient, EMPTY_REGISTRY, analyzeRankingRobustness, DEFAULT_TRIALS, DEFAULT_SEED,
  planAssembly, SUPPORTED_ASSEMBLY_METHODS, explainRecommendation,
  computePlasmidMapSegments, ROLE_TO_PART_TYPE, ARCHITECTURE_FAMILIES, getSupportedFamiliesForHost,
  classifyProvenance,
  buildWorkspaceParts, buildWorkspaceHandoff, buildEffectivePartsById,
  exportFASTA, exportJSONReport, exportGenBank,
  createCustomPartRegistry, normalizeCustomPartRole, SUPPORTED_CUSTOM_PART_ROLES,
};

// Phase 5B, item 4.I: "operator" and "other" have no internal design-grammar
// role at all (see CANONICAL_ROLE_ORDER in designGrammar.js) -- no template
// slot, no baseline/family requirement, no dependency rule is ever defined
// for them. Registration of a custom part under either role must still
// succeed (item 5: registration success is independent of design-problem
// sufficiency) -- but pretending a complete architecture could be derived
// around one would mean silently inventing what "well-posed" means for a
// role this project's design grammar does not model at all. So these two
// roles always short-circuit straight to the same structured, non-error
// continuation used for a genuinely underdetermined design (see
// runAutomaticDesign below), rather than attempting selectArchitecture/beam
// search at all.
const ROLES_NOT_MODELED_FOR_DESIGN = ["operator", "other"];

// Phase 5B, item 4 (B-E): roles whose design-grammar rules declare they need
// a companion "cds" to be well-posed (see designGrammar.js's
// "<role>-requires-cds-target" rules) -- read from the SAME declared rule
// data planDesignRequirements() already draws on, not a separate hardcoded
// list.
function rolesRequiringCds() {
  return new Set(rulesByType("role_requires_role").filter(r => r.consequence.requires === "cds").map(r => r.condition.role));
}

// A CDS anchor alone is always well-posed for part-first generation. Any OTHER
// anchor role (promoter, rbs, terminator, ...) is well-posed ONLY when a CDS
// is ALSO supplied as an additional locked component -- per the Phase 4B
// report's "multiple input roles" investigation: a promoter alone never says
// which gene to express, and this codebase has no defensible rule for
// guessing one. Once a CDS is locked (anchor or additional), the "which gene"
// question is answered by the user, not guessed, and beam search can proceed
// for any anchor role on equal footing. If no CDS is locked at all, the
// non-cds-anchor case still correctly falls back to template-matching only
// (which itself honestly reports "unsupported" for any role no template
// accepts as user_supplied -- unchanged Phase 1 behavior).
function partFirstIsWellPosed(role, additionalLockedComponents) {
  return role === "cds" || additionalLockedComponents.some(c => c.role === "cds");
}

/**
 * Phase 4C.1, item 3: does this Pathway-A (template-matched) candidate belong
 * to a DIFFERENT architecture family than the one the user explicitly
 * selected? Uses ONLY real, already-existing project data: the template's
 * own documented `.label` (verbatim from data/templates.json, e.g. "E. coli
 * inducible expression") matched against designGrammar.js's own goalAliases
 * table -- the SAME table free-text goal interpretation already uses, via
 * matchFamilyByGoalText(). No new inference rule, no guessed biology, and a
 * template whose label matches no family at all is treated as neutral
 * (compatible), since nothing in the project's own data asserts a conflict.
 *
 * A concrete, real example this fixes: a user explicitly selects "Constitutive
 * expression"; Pathway A still (correctly, independently of any goal) offers
 * "E. coli inducible expression" as a template-matched alternative. Before
 * this fix, that inducible candidate competed in the SAME ranked/Pareto pool
 * as the constitutive one and could out-rank or "dominate" it -- silently
 * ignoring the user's explicit goal. Now it is marked goalCompatible:false
 * and excluded from the recommendation/Pareto competition (see
 * runAutomaticDesign below), while remaining visible in the candidate list
 * for comparison.
 *
 * @returns {string|null} the conflicting family's id, or null if compatible/neutral.
 */
function templateGoalConflict(template, selectedFamilyId) {
  if (!selectedFamilyId) return null;
  const match = matchFamilyByGoalText(template.label);
  if (!match || match.family.id === selectedFamilyId) return null;
  return match.family.id;
}

/**
 * Phase 6, item 8 (lock-consistency requirement): does this candidate's own
 * generated plan.order actually contain EVERY additional locked component,
 * at its correct role, as the EXACT same part (matched by id -- including
 * id:null for a raw/novel anchor, which is always the SAME object reference
 * every time, so this is never a false match)? Pathway B (beam search)
 * candidates satisfy this by construction (lockedComponents are baked into
 * `initialAssignments` and never branched -- see architectureGeneration.js),
 * so they are never checked here. Pathway A (template-matched) candidates
 * are built by generateCandidates()/designer.js#design(), which only ever
 * knows about the PRIMARY anchor (passed as `userCds`) -- it has NO
 * parameter for additional locked components at all, so a template's own
 * default part for a locked role can silently remain in a Pathway-A
 * candidate instead of the user's locked component. This was already
 * documented as a known gap in the Phase 5B report; this function turns it
 * into an explicit, checked eligibility fact instead of a silent
 * inconsistency.
 * @returns {{compatible: boolean, missingRoles: string[]}}
 */
function checkLockedComponentsCompatible(candidate, additionalLockedComponents) {
  if (!additionalLockedComponents.length) return { compatible: true, missingRoles: [] };
  const missingRoles = additionalLockedComponents
    .filter(lock => !candidate.plan.order.some(o => o.role === lock.role && o.id === lock.part.id))
    .map(lock => lock.role);
  return { compatible: missingRoles.length === 0, missingRoles };
}

/**
 * @param {object} opts - see characterizeInput() for partId/text/role/host/goal/partsById.
 * @param {object[]} opts.templates - data/templates.json's `.templates` array.
 * @param {number} [opts.maxCandidates]
 * @param {object} [opts.registryCache] - see automatic/registryClient.js; defaults to EMPTY_REGISTRY (no records).
 * @param {number} [opts.robustnessTrials] - see automatic/robustness.js; defaults to DEFAULT_TRIALS.
 * @param {number} [opts.robustnessSeed] - defaults to DEFAULT_SEED (deterministic).
 * @param {number} [opts.beamWidth] - see automatic/architectureGeneration.js; defaults to DEFAULT_BEAM_WIDTH.
 * @param {number} [opts.candidatesPerRole] - defaults to DEFAULT_CANDIDATES_PER_ROLE.
 * @param {string} [opts.goalFamily] - an ARCHITECTURE_FAMILIES id from a structured UI selection (Phase 4B), takes precedence over free-text opts.goal.
 * @param {{role:string, partId:string}[]} [opts.additionalLockedComponents] - Phase 4B: extra user-locked
 *   components beyond the primary anchor (e.g. a locked CDS when the primary anchor is a promoter). Each
 *   MUST reference an existing catalog part (a real id in opts.partsById) -- see architectureGeneration.js's
 *   header for why (only the primary anchor may be a novel/raw-sequence part). Never swapped during search.
 * @param {string} [opts.assemblyMethod] - defaults to "gibson"; see automatic/assemblyPlanning.js.
 */
export function runAutomaticDesign(opts) {
  const characterized = characterizeInput(opts);
  if (!characterized.ok) {
    return { stage: "characterizeInput", ok: false, errors: characterized.errors, warnings: characterized.warnings };
  }

  const anchorPart = characterized.input.anchorPart;
  const role = characterized.input.role;
  const host = characterized.input.host;
  const assemblyMethod = opts.assemblyMethod || "gibson";

  // Phase 5B, item 6/7: an additional locked component may now be a real
  // catalog part (by id, unchanged) OR a directly-supplied custom (external)
  // part object already produced by customPartRegistry.js's
  // registerCustomPart() -- never written to data/parts.json. Either way it
  // becomes a real entry in the EFFECTIVE partsById map used for the rest of
  // this run, so every downstream consumer (selectArchitecture,
  // generateCandidates, generateArchitectures, scoreCandidate,
  // planAssembly, explainRecommendation, computePlasmidMapSegments) resolves
  // it exactly like an ordinary catalog part via ordinary partsById lookups,
  // with zero special-casing -- the same pattern registryClient.js's
  // Registry-inserted parts already use via candidate.resolvedPartsById.
  const customPartsById = {};
  if (characterized.input.mode === "custom_part") customPartsById[anchorPart.id] = anchorPart;
  const additionalLockedComponents = [];
  for (const spec of opts.additionalLockedComponents || []) {
    let part;
    if (spec.customPart) {
      part = spec.customPart;
      customPartsById[part.id] = part;
    } else {
      part = opts.partsById[spec.partId];
    }
    if (!part) {
      return { stage: "characterizeInput", ok: false, errors: [`Locked component for role "${spec.role}": no catalog part with id "${spec.partId}", and no customPart object was supplied.`], warnings: [] };
    }
    // Same origin/ori TYPE_TO_INTERNAL_ROLE mapping characterizeInput.js
    // applies to the primary anchor -- a caller (the UI's custom-part
    // registration form, or a future integration) may reasonably supply
    // spec.role in the external TYPE spelling ("origin"); the engine's own
    // role machinery is keyed entirely on the internal spelling ("ori").
    additionalLockedComponents.push({ role: toInternalRole(spec.role), part });
  }
  const effectivePartsById = Object.keys(customPartsById).length ? { ...opts.partsById, ...customPartsById } : opts.partsById;
  const lockedComponents = [{ role, part: anchorPart }, ...additionalLockedComponents];

  // Phase 5B, item 4.I: "operator"/"other" have no design-grammar role
  // equivalent at all -- registration already succeeded (characterizeInput
  // ran above), but pretending a complete architecture could be derived
  // around one would fabricate what "well-posed" means for an unmodeled
  // role. Report this as a structured continuation, not a bare error, and
  // stop before attempting selectArchitecture/beam search.
  if (ROLES_NOT_MODELED_FOR_DESIGN.includes(role)) {
    return {
      stage: "needsUserChoice", ok: false, characterized, requirementPlan: null, partFirstStatus: null,
      needsUserChoice: {
        requiredRole: null,
        reason: `Role "${role}" was registered successfully, but this project's design grammar does not yet define what a complete architecture around a bare "${role}" part requires (no template slot, baseline requirement, or dependency rule targets this role). Additional biological role/context is required before a plasmid can be generated -- this is not a rejection of the part itself.`,
      },
    };
  }

  // Pathway A: template-based (Phase 1-3, unchanged). A failure here no
  // longer aborts the whole run by itself -- see file header.
  const architecture = selectArchitecture(characterized, opts.templates, effectivePartsById);
  const templateCandidates = architecture.ok
    ? generateCandidates([architecture.selected.template, ...architecture.alternatives.map(a => a.template)], anchorPart, effectivePartsById, { maxCandidates: opts.maxCandidates, allTemplates: opts.templates })
    : [];

  // Pathway B: true part-first generation (Phase 4A/4B), cds anchors only.
  const registryClient = createRegistryClient(opts.registryCache || EMPTY_REGISTRY);
  let requirementPlan = null;
  let beamCandidates = [];
  let partFirstStatus;
  if (partFirstIsWellPosed(role, additionalLockedComponents)) {
    requirementPlan = planDesignRequirements({
      anchorRole: role, host, goal: characterized.input.goal, goalFamily: opts.goalFamily,
      templates: opts.templates, registryConstructs: (opts.registryCache || EMPTY_REGISTRY).constructs,
      ablateGoalRules: !!(opts.ablation && opts.ablation.ablateGoalRules), // Phase 4B Step 12 benchmark hook only, default false
    });
    beamCandidates = generateArchitectures({
      requirementPlan, lockedComponents, host, partsById: effectivePartsById, templates: opts.templates, registryClient,
      beamWidth: opts.beamWidth, candidatesPerRole: opts.candidatesPerRole, maxCandidates: opts.beamWidth,
      ablation: opts.ablation, stats: opts.stats, // Phase 4B Step 12/15 benchmark hooks only, undefined/off by default
    });
    partFirstStatus = `Generated ${beamCandidates.length} candidate(s) by beam search around ${lockedComponents.length} locked component(s) -- see requirementPlan for the derived role plan.`;
  } else {
    partFirstStatus = `Part-first true architecture generation for a "${role}" anchor requires a locked CDS (additionalLockedComponents: [{role:"cds", partId:...}]) -- this codebase has no defensible rule for guessing which gene a "${role}" alone should express. Falling back to template-matching only.`;
  }

  // Phase 5B, item 5: is this design genuinely underdetermined without a
  // companion "cds"? Derived structurally from designGrammar.js's own
  // "<role>-requires-cds-target" rules (item 4, roles B-E) plus whatever this
  // host/goal's OWN baseline+family required-role set would otherwise pull
  // in (e.g. an origin/marker-anchored design still needs a promoter, which
  // itself requires a cds) -- never a separate guess about biology. A family
  // that explicitly names its own recommended cds (none do today, but the
  // mechanism is honored if one ever does) satisfies this without asking.
  const cdsAlreadyDetermined = role === "cds" || additionalLockedComponents.some(c => c.role === "cds");
  if (!cdsAlreadyDetermined && !architecture.ok) {
    const provisionalPlan = planDesignRequirements({
      anchorRole: role, host, goal: characterized.input.goal, goalFamily: opts.goalFamily,
      templates: opts.templates, registryConstructs: (opts.registryCache || EMPTY_REGISTRY).constructs,
    });
    const impliedRoles = new Set([role, ...provisionalPlan.requiredRoles]);
    const needsCds = [...rolesRequiringCds()].some(r => impliedRoles.has(r))
      && !(provisionalPlan.family && provisionalPlan.family.id && ARCHITECTURE_FAMILIES[provisionalPlan.family.id]?.hostAvailability?.[host]?.recommendedPartIds?.cds);
    if (needsCds) {
      return {
        stage: "needsUserChoice", ok: false, characterized, requirementPlan: provisionalPlan, partFirstStatus,
        needsUserChoice: {
          requiredRole: "cds",
          reason: `Your ${role} "${anchorPart.name}" has been registered and locked. To construct a complete expression plasmid, select or register the CDS that this ${role} should ` +
            (role === "promoter" ? "control." : role === "rbs" ? "initiate translation of." : role === "terminator" ? "terminate transcription of." : role === "signal" ? "be fused to for secretion." :
              `pair with (this project's baseline/goal requirements for this design imply a "${[...rolesRequiringCds()].find(r => impliedRoles.has(r))}" role, which in turn needs a specified gene).`),
        },
      };
    }
  }

  // Phase 4C.1, item 3: tag every Pathway-A candidate's goal-compatibility
  // against whichever family was actually selected/applied (requirementPlan.family
  // is null when no structured goal was chosen OR the chosen one wasn't
  // supported for this host -- in either case nothing is excluded). Beam-
  // search (Pathway B) candidates are always goalCompatible:true -- they were
  // built explicitly FOR the selected family (or for no family) by
  // construction, so a conflict is structurally impossible for them.
  const selectedFamilyId = requirementPlan && requirementPlan.family ? requirementPlan.family.id : null;
  for (const c of templateCandidates) {
    const conflict = templateGoalConflict(c.originalTemplate, selectedFamilyId);
    c.goalCompatible = !conflict;
    if (conflict) c.conflictingFamily = conflict;
    // Phase 6, item 8: see checkLockedComponentsCompatible's own comment.
    const lockCheck = checkLockedComponentsCompatible(c, additionalLockedComponents);
    c.lockedComponentsCompatible = lockCheck.compatible;
    if (!lockCheck.compatible) c.missingLockedRoles = lockCheck.missingRoles;
  }
  for (const c of beamCandidates) { c.goalCompatible = true; c.lockedComponentsCompatible = true; }

  const candidates = [...templateCandidates, ...beamCandidates];
  if (!candidates.length) {
    return {
      stage: "selectArchitecture", ok: false, characterized, requirementPlan, partFirstStatus,
      reason: architecture.ok ? "No candidates were generated by either pathway." : architecture.reason,
    };
  }

  const valid = candidates.filter(c => c.validation.valid);
  const invalid = candidates.filter(c => !c.validation.valid);

  // Assembly plan per valid candidate (Phase 4B, Step 7) -- cheap (scanSites
  // is O(parts x enzymes)), attached directly so downstream (scoring UI,
  // visualization, explanation) can read candidate.assemblyPlan.
  // Phase 4C.1: merge in any Registry-inserted parts architectureGeneration.js
  // resolved for THIS candidate specifically (see its own comment) -- without
  // this, assemblyPlanning.js can't see a Registry part's real sequence and
  // incorrectly reports "no sequence on file" for a part that has one.
  for (const c of valid) {
    const assemblyPartsById = c.resolvedPartsById && Object.keys(c.resolvedPartsById).length
      ? { ...effectivePartsById, ...c.resolvedPartsById }
      : effectivePartsById;
    c.assemblyPlan = planAssembly(c.plan, assemblyMethod, { partsById: assemblyPartsById, anchorPart });
  }

  const scoreCtx = { partsById: effectivePartsById, anchorPart, registryClient, host: characterized.input.host, role: characterized.input.role, templates: opts.templates };
  // Every valid candidate is scored for real, INCLUDING goal-incompatible
  // ones -- they remain visible for comparison (per the Phase 4C.1 spec),
  // just excluded from the recommendation/Pareto competition below. Scores
  // themselves are never manipulated based on goal-compatibility.
  const scored = valid.map(c => ({ candidateId: c.candidateId, candidate: c, ...scoreCandidate(c, scoreCtx) }));

  // Phase 4C.1, items 3+4: Pareto dominance and ranking are computed ONLY
  // over the goal-compatible ("eligible") subset -- a candidate documented as
  // belonging to a conflicting architecture family must never dominate, out-
  // rank, or become the recommendation for the family the user actually
  // selected. Goal-incompatible candidates are still scored and still shown
  // (appended after the eligible ones, own section below), just never part of
  // this competition. rankCandidates() then applies the full, explicit,
  // deterministic policy: overallScore desc -> Pareto-nondominated preferred
  // on a tie -> candidateId as the final, deterministic tie-break.
  // Phase 6, item 8: a candidate that does not honor the full user lock set
  // is excluded from the same competition as a goal-incompatible one, for
  // the same reason -- it must never dominate, out-rank, or become the
  // recommendation over a candidate that actually preserves what the user
  // asked to keep fixed. It remains visible (comparison-only, per the spec).
  const isEligible = c => c.goalCompatible !== false && c.lockedComponentsCompatible !== false;
  const eligibleScored = scored.filter(s => isEligible(s.candidate));
  const ineligibleScored = scored.filter(s => !isEligible(s.candidate));

  const paretoByCandidateId = Object.fromEntries(computeParetoFront(eligibleScored).map(p => [p.candidateId, p]));
  const eligibleWithPareto = eligibleScored.map(s => ({ ...s, ...paretoByCandidateId[s.candidateId], eligibleForRecommendation: true }));
  const rankedEligible = rankCandidates(eligibleWithPareto);
  // Ineligible candidates were never compared for dominance against the
  // eligible set, so paretoOptimal is deliberately left unset (unknown/not
  // applicable) rather than false -- dominatedBy/strongestIn default to
  // empty arrays only so existing UI/consumers reading `.length` never throw.
  const rankedIneligible = [...ineligibleScored]
    .map(s => ({ ...s, dominatedBy: [], strongestIn: [], eligibleForRecommendation: false }))
    .sort((a, b) => b.overallScore - a.overallScore || a.candidateId.localeCompare(b.candidateId));

  const rankedWithPareto = [...rankedEligible, ...rankedIneligible];
  // The recommendation/comparison/robustness pool is the eligible set --
  // falling back to the ineligible set only in the (rare) case where NO
  // goal-compatible candidate exists at all, so a recommendation is still
  // produced rather than silently withheld; recommendationNote below makes
  // this explicit either way.
  const recommendedPool = rankedEligible.length ? rankedEligible : rankedIneligible;

  const recommended = recommendedPool[0] ? recommendedPool[0].candidate : null;
  const comparison = recommendedPool.length > 1 ? compareCandidates(recommendedPool[0], recommendedPool[1]) : null;
  const robustness = analyzeRankingRobustness(recommendedPool, { trials: opts.robustnessTrials, seed: opts.robustnessSeed });

  const result = {
    stage: "done",
    ok: true,
    characterized,
    architecture,
    requirementPlan,
    partFirstStatus,
    lockedComponents: lockedComponents.map(c => ({ role: c.role, partName: c.part.name, partId: c.part.id })),
    generationSummary: { templateBased: templateCandidates.length, beamSearch: beamCandidates.length },
    candidates: { all: candidates, valid, invalid },
    scoring: {
      weights: SCORE_WEIGHTS,
      dimensions: ACTIVE_DIMENSIONS,
      registryStatus: registryClient.available ? "loaded" : "not available -- no verified Registry records loaded (see Phase 2 report)",
      ranked: rankedWithPareto,
      robustness,
    },
    recommended,
    recommendationNote: !recommended
      ? "No hard-valid candidate was generated for this input."
      : rankedEligible.length
        ? "Top-ranked by scoreCandidate()'s weighted multi-objective formula among goal-compatible candidates (see `scoring` for the full breakdown, weights, and Pareto status) -- not a prediction of experimental success."
        : `No candidate compatible with the selected goal ("${requirementPlan?.family?.label}") passed hard validation -- this is the best available candidate overall, but it does NOT match the requested design goal; see its goalCompatible/conflictingFamily fields.`,
    comparison,
  };
  result.explanation = explainRecommendation(result, { partsById: effectivePartsById });
  return result;
}
