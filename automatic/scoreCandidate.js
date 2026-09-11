// Automatic Design Mode -- multi-objective scoring (Phase 2, weights revised
// and registrySupport made real in Phase 2.5).
//
// scoreCandidate() only runs over candidates that already passed
// validateCandidate() (see automatic/index.js) -- every sub-score below is
// therefore computed on a candidate that already has zero gaps and zero
// hard-rejected (missing/invalid-sequence or "placeholder"-provenance) parts.
// Two consequences of that, stated up front rather than left implicit:
//   - functionalCompleteness below deliberately measures completeness against
//     the template's FULL declared slot set (required + optional), not just the
//     required set validateCandidate already guarantees -- otherwise it would be
//     a constant 1.0 for every scored candidate and would carry no information.
//   - verifiedPartSupport is NO LONGER provably constant 1.0 as of Phase 4C.
//     Before Phase 4C, EVERY non-"verified" catalog part was hard-rejected, so
//     "fraction of resolved parts with evidence:verified" was tautologically
//     1.0 for anything that reached scoring. Phase 4C separated sequenceStatus
//     from provenanceStatus (see provenanceModel.js) so a hard-VALID candidate
//     can now legitimately contain a registry_recorded or user_supplied part
//     (data/parts.json's own evidence field for those is still "placeholder",
//     since that field only has two values) -- so this dimension now measures
//     something real: how much of the candidate is THIS PROJECT's own verified
//     catalog data vs. registry_recorded/user_supplied provenance. Its WEIGHT
//     is deliberately left at 0.00 in this same pass (see SCORE_WEIGHTS below)
//     -- fixing the hard-validation bug and separately re-deciding how much
//     scoring weight provenance mix should carry are two different decisions,
//     and this pass only does the first. See the Phase 4C report's
//     "remaining limitations" section.
//
// registrySupport is real as of Phase 2.5 (data/registry_cache.json, a small
// curated snapshot of actual iGEM Registry records -- see referenceComparison.js
// and the Phase 2.5 report for exactly which records and why). It measures
// documented STRUCTURAL/reference agreement only -- shared exact-sequence
// matches, architecture role-order similarity, and chassis agreement ONLY when
// a reference explicitly documents chassis. It is never a probability of
// experimental success, and Registry presence/age/usage is never treated as
// biological verification -- see registryClient.js's "establishedReference"
// note for the (purely data-provenance) meaning of that term.
//
// No sub-score here claims to predict biological function, expression, or
// wet-lab success. Each is a specific, named, documented, traceable computation
// over data/rules already in this repository.

import { compareToReferences, findExactRegistryMatches, roleOrderSimilarity } from "./referenceComparison.js";

const clamp01 = x => Math.max(0, Math.min(1, x));

// --- sub-score formulas, each documented individually --------------------

/** (# declared template slots that resolved to a real part) / (# declared template slots).
 * Counts required AND optional slots -- an optional slot with no available
 * candidate (e.g. ecoli_inducible's "signal" slot, which has zero candidates
 * today) permanently caps this below 1.0 for that architecture, which is
 * intentional: it reports how much of the FULL documented architecture is
 * actually realized, not just the bare minimum validateCandidate requires. */
function functionalCompleteness(candidate) {
  const total = candidate.originalTemplate.slots.length;
  const resolved = candidate.plan.order.length;
  return { value: total ? clamp01(resolved / total) : 0, resolved, total };
}

/** 1 - (restriction-site conflicts / resolved parts), floored at 0.
 * scanSites() (designer.js, reused via design()) is the only site-conflict
 * detector in this codebase; this sub-score is a direct, linear function of its
 * output -- not a new site-scanning implementation. */
function assemblyFeasibility(candidate) {
  const conflicts = candidate.plan.siteConflicts.length;
  const total = Math.max(1, candidate.plan.order.length);
  return { value: clamp01(1 - conflicts / total), conflicts, total };
}

/** (# resolved parts with evidence:"verified") / (# resolved parts).
 * See the file-level note: as of Phase 4C this is NO LONGER provably 1.0 for
 * every scored candidate -- a hard-valid candidate may legitimately contain a
 * registry_recorded or user_supplied part (data/parts.json's own evidence
 * field for those is still "placeholder", the schema's only non-"verified"
 * value). This now genuinely measures how much of the candidate is this
 * project's own curated catalog data vs. other (still-buildable) provenance. */
function verifiedPartSupport(candidate, partsById, anchorPart) {
  const parts = candidate.plan.order;
  let verified = 0;
  for (const o of parts) {
    const rec = o.id ? partsById[o.id] : (anchorPart && anchorPart.id === null ? anchorPart : null);
    if (rec && rec.evidence === "verified") verified++;
  }
  return { value: parts.length ? clamp01(verified / parts.length) : 0, verified, total: parts.length };
}

// PHASE 4B FIX -- see the Phase 4B report's "Step 8" section for the full
// before/after writeup. The ORIGINAL definition ("does each resolved slot
// match its own synthetic template's default candidate") is provably a
// constant 1.0 for every architectureGeneration.js-generated candidate: a
// generated candidate's synthetic template has exactly ONE candidate per
// slot (whatever beam search already chose), so it always "matches its own
// default" -- rewarding a generated architecture merely for agreeing with
// itself, exactly the bug Phase 4B was asked to fix. Renamed
// architectureSupport -> architectureEvidence and redefined as the average of
// two components that are NOT tautological for either candidate origin, and
// do NOT re-use registrySupport's own VALUE (only its role-order-similarity
// ALGORITHM, imported from referenceComparison.js, applied to a DIFFERENT
// comparison set -- this project's own 4 templates, not the Registry cache --
// so Registry support is not double-counted):
//   1. templateRoleOrderAgreement: best (max) role-order similarity between
//      this candidate's resolved role sequence and each of the 4 real
//      data/templates.json templates' own role sequences. Meaningful for
//      BOTH origins: a template-pathway candidate trivially scores ~1.0
//      against its own template (expected -- it. e. is that template), while
//      a beam-search candidate has to actually resemble a real curated
//      architecture to score well here.
//   2. curatedProvenanceFraction: how much of the candidate's own resolved,
//      non-locked parts came from a genuinely curated source, AND how close
//      to that source's own top-documented choice. Two real, DIFFERENT
//      per-origin signals feed this, deliberately not the same tautology as
//      before:
//        - template-pathway: for each non-anchor resolved part, does it equal
//          its slot's own first-listed (top-documented) candidate (full
//          credit) or a later-listed-but-still-curated alternative (partial
//          credit)? This is the genuine default-vs-swap distinction the
//          ORIGINAL architectureSupport measured correctly for this origin --
//          preserved here, not discarded, since a first pass at this fix
//          mistakenly hardcoded 1.0 for every template-pathway candidate
//          regardless of default/swap, silently losing that real signal (see
//          the Phase 4B report for that caught-and-fixed mistake).
//        - beam-search: the real per-role provenance tier
//          architectureGeneration.js tracks (host_curated / registry_recorded
//          / catalog_fallback) -- a candidate that had to reach for a
//          Registry-sourced or wide-fallback part scores lower here than one
//          built entirely from host-curated, template-documented parts.
const PROVENANCE_CREDIT = { family_recommended: 1, host_curated: 1, locked: 1, registry_recorded: 0.4, catalog_fallback: 0.2 };
const SWAP_CREDIT = { default: 1, listed_alternative: 0.7, not_in_list: 0.3 };

function architectureEvidence(candidate, templates) {
  const candidateRoles = candidate.plan.order.map(o => o.role);

  let templateRoleOrderAgreement = null;
  if (templates && templates.length) {
    const sims = templates.map(t => roleOrderSimilarity(candidateRoles, t.slots.map(s => s.role)));
    templateRoleOrderAgreement = Math.max(...sims);
  }

  let curatedProvenanceFraction;
  if (candidate.origin !== "beam_search") {
    const slotsByRole = Object.fromEntries((candidate.originalTemplate?.slots || []).map(s => [s.role, s]));
    const nonAnchorParts = candidate.plan.order.filter(o => !slotsByRole[o.role]?.user_supplied);
    curatedProvenanceFraction = nonAnchorParts.length
      ? nonAnchorParts.reduce((sum, o) => {
          const candidates = slotsByRole[o.role]?.candidates || [];
          const status = candidates[0] === o.id ? "default" : candidates.includes(o.id) ? "listed_alternative" : "not_in_list";
          return sum + SWAP_CREDIT[status];
        }, 0) / nonAnchorParts.length
      : 1;
  } else if (!candidate.provenanceByRole) {
    curatedProvenanceFraction = 1;
  } else {
    const lockedRoleSet = new Set((candidate.lockedComponents || []).map(c => c.role));
    const scoredRoles = candidate.plan.order.map(o => o.role).filter(r => !lockedRoleSet.has(r));
    curatedProvenanceFraction = scoredRoles.length
      ? scoredRoles.reduce((sum, r) => sum + (PROVENANCE_CREDIT[candidate.provenanceByRole[r]] ?? 1), 0) / scoredRoles.length
      : 1;
  }

  const components = [templateRoleOrderAgreement, curatedProvenanceFraction].filter(v => v !== null);
  const value = components.length ? clamp01(components.reduce((a, b) => a + b, 0) / components.length) : null;
  return { value, templateRoleOrderAgreement, curatedProvenanceFraction };
}

/** Heuristic proxy, NOT a prediction of expression/function/folding: extreme GC
 * content is a well-known practical hazard for synthesis, PCR, and sequencing
 * in standard molecular biology lab practice, independent of what the sequence
 * encodes. Full credit for 40-60% GC (plan.gc, already computed by design());
 * linear falloff to zero credit at <=20% or >=80% GC. */
function sequenceQuality(candidate) {
  const gcPct = candidate.plan.gc;
  const dist = Math.abs(gcPct - 50);
  let value;
  if (dist <= 10) value = 1;
  else if (dist >= 30) value = 0;
  else value = 1 - (dist - 10) / 20;
  return { value: clamp01(value), gc: gcPct };
}

/** Registry/reference support -- real as of Phase 2.5, backed by
 * data/registry_cache.json. Only computed when a registry client with loaded
 * records is supplied; returns `null` (not 0, not fabricated) when
 * unavailable, or when the cache has no reference construct sharing the
 * candidate's role.
 *
 * Blends up to four independently-computable, defensible signals -- each
 * skipped (not zeroed) when not computable for this candidate/reference set:
 *   1. exactMatchFraction: fraction of the candidate's own resolved parts
 *      whose sequence exactly matches a cached Registry part.
 *   2. sharedKnownPartsScore: of those exact matches, the best fraction that
 *      also appear in a role-relevant reference construct's documented
 *      composition (knownParts). Requires >=1 exact match to be computable.
 *   3. roleOrderSimilarity: best (max) longest-common-subsequence similarity
 *      between the candidate's role sequence and any role-relevant
 *      reference's documented role sequence. Needs no exact part match --
 *      this is the signal most likely to be available even for a candidate
 *      built entirely from parts the Registry has never seen.
 *   4. chassisScore: 1 if any role-relevant reference explicitly documents a
 *      chassis matching the candidate's host, 0 if relevant references
 *      document chassis but none match, and simply OMITTED (not 0) when no
 *      relevant reference documents any chassis at all -- undocumented data
 *      is never converted into a mismatch.
 * The full per-reference comparison (see referenceComparison.js) is returned
 * alongside the scalar so the caller can show exactly why. */
function registrySupport(candidate, ctx) {
  const { registryClient, host, role, partsById, anchorPart } = ctx;
  if (!registryClient || !registryClient.available) {
    return { value: null, reason: "no verified Registry records loaded", comparisons: [], exactMatches: [] };
  }
  const relevant = registryClient.findReferenceConstructs({ role });
  if (!relevant.ok || !relevant.constructs.length) {
    return { value: null, reason: `no reference construct in the loaded cache documents role "${role}"`, comparisons: [], exactMatches: [] };
  }

  const comparisons = compareToReferences(candidate, relevant.constructs, { partsById, anchorPart, host, registryClient });
  const exactMatches = findExactRegistryMatches(candidate.plan, partsById, anchorPart, registryClient);
  const exactMatchFraction = candidate.plan.order.length ? exactMatches.length / candidate.plan.order.length : 0;

  const sharedFractions = comparisons.map(c => c.sharedExactParts.length).filter(n => n > 0).map(n => n / Math.max(1, exactMatches.length));
  const sharedKnownPartsScore = sharedFractions.length ? Math.max(...sharedFractions) : null;

  const roleOrderSims = comparisons.map(c => c.roleOrderSimilarity);
  const bestRoleOrderSimilarity = roleOrderSims.length ? Math.max(...roleOrderSims) : null;

  const chassisStatuses = comparisons.map(c => c.chassisAgreement);
  const chassisScore = chassisStatuses.includes("agree") ? 1 : chassisStatuses.includes("mismatch") ? 0 : null;

  const components = [exactMatchFraction, sharedKnownPartsScore, bestRoleOrderSimilarity, chassisScore].filter(v => v !== null);
  const value = components.length ? clamp01(components.reduce((a, b) => a + b, 0) / components.length) : null;

  return { value, exactMatchFraction, sharedKnownPartsScore, bestRoleOrderSimilarity, chassisScore, matchedReferenceCount: relevant.constructs.length, comparisons, exactMatches };
}

// --- weights -----------------------------------------------------------
//
// REVISED in Phase 2.5. Before -> after, and why:
//   functionalCompleteness  0.30 -> 0.30  unchanged: deterministic, discriminates today.
//   assemblyFeasibility     0.30 -> 0.30  unchanged: deterministic, discriminates today.
//   architectureSupport     0.15 -> 0.15  unchanged magnitude, REDEFINED as architectureEvidence
//                            in Phase 4B (see that function's own comment) -- the original
//                            definition was provably a constant 1.0 for every
//                            architectureGeneration.js-generated candidate (it measured
//                            "does this candidate match its own synthetic template's
//                            default", which is tautologically always true for a generated
//                            template with one candidate per slot). Weight magnitude kept
//                            unchanged because the fix restores genuine discrimination at
//                            the same importance level, not a new level of importance.
//   sequenceQuality         0.10 -> 0.10  unchanged: minor, explicitly-labeled proxy.
//   verifiedPartSupport     0.15 -> 0.00  DROPPED. Provably constant (1.0) for every
//                            candidate that reaches scoring today, since validateCandidate()
//                            already hard-rejects placeholder-evidence parts. Giving it real
//                            weight would inflate every candidate's score identically and
//                            change nothing about the ranking -- weight without discrimination
//                            is exactly what the team asked not to do. Kept in the breakdown
//                            (still computed for real) so it starts discriminating again with
//                            zero code change if that hard gate is ever relaxed.
//   registrySupport         0.00 -> 0.15  RAISED, now that data/registry_cache.json makes it a
//                            real, computed signal (Phase 2.5) instead of a placeholder. Given
//                            equal weight to architectureSupport, not to functionalCompleteness/
//                            assemblyFeasibility -- those two are complete, deterministic facts
//                            about the candidate itself; registrySupport is comparison against a
//                            small (7 parts, 4 constructs), curated, structural-only reference
//                            set, so it's weighted as a real but secondary signal, never able to
//                            singlehandedly flip a ranking the deterministic dimensions disagree
//                            with. Still excluded from the weighted sum entirely (not multiplied
//                            by 0) on any run where it's null -- see weightUsed below.
// Sum across the five active dimensions: 1.00.
//
// SCORING-HARDENING PASS (post-Phase 2.5): overallScore is renormalized by
// weightUsed (100 * weightedSum / weightUsed), not left as a raw weighted sum.
// Before this pass, a candidate with a perfect 1.0 on every available
// dimension but registrySupport:null scored 85, not 100 -- an unintended
// penalty for Registry evidence merely being unavailable (e.g. every current
// B. subtilis/V. natriegens candidate, since the cache has no role-relevant
// reference for either host). Renormalizing fixes that: missing evidence is
// excluded from the average, never converted into a lower score.
export const SCORE_WEIGHTS = {
  functionalCompleteness: 0.30,
  assemblyFeasibility: 0.30,
  verifiedPartSupport: 0.00,
  architectureEvidence: 0.15,
  sequenceQuality: 0.10,
  registrySupport: 0.15,
};

export const ACTIVE_DIMENSIONS = ["functionalCompleteness", "assemblyFeasibility", "verifiedPartSupport", "architectureEvidence", "sequenceQuality", "registrySupport"];

function explain(name, detail) {
  switch (name) {
    case "functionalCompleteness": return `${detail.resolved}/${detail.total} declared architecture slots resolved (required + optional).`;
    case "assemblyFeasibility": return `${detail.conflicts} restriction-site conflict(s) across ${detail.total} resolved part(s).`;
    case "verifiedPartSupport": return `${detail.verified}/${detail.total} resolved parts are evidence:verified (weight 0.00 -- see file header: Phase 4C means this can now be <1.0 for a hard-valid candidate containing a registry_recorded/user_supplied part; weight left at 0 pending a deliberate decision on how much this should count).`;
    case "architectureEvidence":
      return `${detail.templateRoleOrderAgreement != null ? (detail.templateRoleOrderAgreement * 100).toFixed(0) + "% role-order agreement with the best-matching of the 4 real templates" : "template role-order not compared"}` +
        `, ${(detail.curatedProvenanceFraction * 100).toFixed(0)}% of resolved parts drawn from curated (non-fallback) sources.`;
    case "sequenceQuality": return `Assembled sequence is ${detail.gc}% GC (heuristic proxy: full credit 40-60%, linear falloff to 0 outside 20-80% -- a synthesis/PCR practicality proxy, not a function prediction).`;
    case "registrySupport":
      if (detail.value === null) return `Not scored: ${detail.reason}.`;
      return `Registry-recorded structural support from ${detail.matchedReferenceCount} role-relevant reference construct(s): ` +
        `${detail.exactMatchFraction != null ? (detail.exactMatchFraction * 100).toFixed(0) + "% exact-sequence part matches" : "no exact matches"}` +
        `${detail.sharedKnownPartsScore != null ? `, ${(detail.sharedKnownPartsScore * 100).toFixed(0)}% of those shared with a reference's known composition` : ""}` +
        `${detail.bestRoleOrderSimilarity != null ? `, best role-order similarity ${(detail.bestRoleOrderSimilarity * 100).toFixed(0)}%` : ""}` +
        `${detail.chassisScore != null ? `, documented chassis ${detail.chassisScore === 1 ? "agrees" : "mismatches"}` : ", chassis unknown for every relevant reference"}` +
        `. Structural/documented support only -- not a probability of experimental success.`;
    default: return "";
  }
}

/**
 * @param {object} candidate - one entry from generateCandidates()'s output (must carry .originalTemplate, added in Phase 2).
 * @param {object} ctx
 * @param {Object<string,object>} ctx.partsById
 * @param {object} [ctx.anchorPart]
 * @param {object} [ctx.registryClient] - from createRegistryClient(); omitted/unavailable -> registrySupport is null.
 * @param {string} [ctx.host]
 * @param {string} [ctx.role]
 */
/**
 * Pure function: turns a breakdown (dimension -> value|null) plus a weight
 * vector into a renormalized 0-100 score. Extracted so Phase 3's
 * robustness.js can recompute a candidate's score under many perturbed
 * weight vectors WITHOUT re-running the expensive part of scoring (Registry
 * comparison, site-conflict scanning, etc.) on every trial -- the underlying
 * evidence (breakdown) doesn't change under a weight perturbation, only how
 * it's combined. This is also, not incidentally, the single source of truth
 * for the renormalization fix: a dimension with a null value is excluded
 * from both the numerator and the denominator, never treated as 0.
 */
export function computeOverallScore(breakdown, weights) {
  let weightedSum = 0;
  let weightUsed = 0;
  for (const dim of Object.keys(weights)) {
    const value = breakdown[dim];
    if (value !== null && value !== undefined) {
      weightedSum += weights[dim] * value;
      weightUsed += weights[dim];
    }
  }
  return {
    overallScore: weightUsed > 0 ? +((weightedSum / weightUsed) * 100).toFixed(1) : 0,
    weightUsed: +weightUsed.toFixed(2),
  };
}

export function scoreCandidate(candidate, ctx = {}) {
  const { partsById, anchorPart, templates } = ctx;

  const fc = functionalCompleteness(candidate);
  const af = assemblyFeasibility(candidate);
  const vp = verifiedPartSupport(candidate, partsById, anchorPart);
  const ae = architectureEvidence(candidate, templates);
  const sq = sequenceQuality(candidate);
  const rs = registrySupport(candidate, ctx);

  const raw = { functionalCompleteness: fc, assemblyFeasibility: af, verifiedPartSupport: vp, architectureEvidence: ae, sequenceQuality: sq, registrySupport: rs };

  const breakdown = {};
  const notes = {};
  for (const dim of Object.keys(SCORE_WEIGHTS)) {
    breakdown[dim] = raw[dim].value;
    notes[dim] = explain(dim, raw[dim]);
  }

  // Renormalized by weightUsed (the sum of weights actually computable this
  // run), NOT left as a raw weighted sum -- a candidate must never be
  // penalized merely because one dimension (most commonly registrySupport,
  // when no relevant Registry evidence exists for this host/role) was
  // unavailable and excluded. Perfect scores on every AVAILABLE dimension
  // yield 100, whether or not registrySupport participated.
  const { overallScore, weightUsed } = computeOverallScore(breakdown, SCORE_WEIGHTS);

  return {
    overallScore,
    weightUsed, // sum of weights for dimensions actually scored this run: 1.00 when registrySupport is scored, 0.85 when it's null (its 0.15 excluded, never zeroed)
    weights: { ...SCORE_WEIGHTS },
    breakdown,
    notes,
    registryComparison: rs.comparisons || [],
    registryExactMatches: rs.exactMatches || [], // per-part {role, localName, registryId, registryTitle} -- used by the plasmid map's provenance display
  };
}
