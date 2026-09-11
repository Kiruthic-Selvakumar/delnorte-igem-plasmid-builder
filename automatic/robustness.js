// Automatic Design Mode -- recommendation robustness (Phase 3).
//
// This is NOT a probability that any plasmid will work, and NOT "biological
// confidence". It measures exactly one thing: how stable the candidate
// RANKING is to reasonable perturbations of scoreCandidate()'s scoring
// weights. A "highly stable" recommendation means the same candidate keeps
// winning across a wide range of reasonable weight choices -- nothing more,
// nothing about wet-lab success.
//
// ALGORITHM
// ---------
// scoreCandidate() already separates "evidence" (the breakdown -- functional
// completeness, assembly feasibility, etc.) from "how it's combined" (the
// weights). That evidence does not change when the weights change, so this
// module never re-runs scoring: it takes the already-scored candidates
// (breakdown + baseline weights) and, for each of `trials` runs:
//   1. draws one multiplicative perturbation factor per PERTURBABLE dimension
//      (a dimension with a non-zero baseline weight -- see below) from
//      Uniform[1 - PERTURBATION_FRACTION, 1 + PERTURBATION_FRACTION], i.e.
//      +/-20% of that dimension's baseline weight by default;
//   2. multiplies each baseline weight by its factor (always yields a
//      strictly positive weight, since the factor is always > 0 -- weights
//      can never go negative by construction, not merely by a clamp);
//   3. renormalizes the perturbed weights to sum to 1 across the perturbable
//      dimensions (dimensions with a fixed baseline weight of 0, i.e.
//      verifiedPartSupport today, are held at 0 -- perturbation never grants
//      weight to a dimension the team deliberately zeroed out in Phase 2.5);
//   4. recomputes each candidate's score from ITS OWN breakdown under this
//      trial's weights via computeOverallScore() -- the exact same
//      null-exclusion/renormalization logic scoreCandidate() itself uses, so
//      a candidate with, say, registrySupport:null is scored on its other
//      available dimensions in every trial, exactly as at baseline. A null
//      dimension is NEVER converted to 0, in any trial.
//   5. ranks the candidates for this trial (score desc, candidateId asc to
//      break ties -- deterministic, never insertion order) and records each
//      candidate's rank.
//
// Why multiplicative-uniform-then-renormalize, not additive noise or a
// Dirichlet draw: it's the simplest scheme that (a) can never produce a
// negative weight without an explicit clamp, (b) treats every perturbable
// dimension symmetrically (no dimension is structurally more "wobbly" than
// another), and (c) keeps the perturbation's meaning easy to state in one
// sentence ("each active weight is randomly nudged by up to ~20% before
// renormalizing") for the UI. +/-20% (PERTURBATION_FRACTION = 0.2) is the
// team's own suggested default: a moderate range representing genuine
// disagreement about these weights without being so wide it manufactures
// instability that isn't really there.
//
// DETERMINISM
// -----------
// Uses mulberry32, a tiny, well-known, seeded 32-bit PRNG (no dependency) --
// the same (candidates, weights, trials, seed) always produces bit-identical
// output. This is required for reproducibility, not for any statistical
// property of the perturbation itself.

import { computeOverallScore, SCORE_WEIGHTS } from "./scoreCandidate.js";
import { rankCandidates } from "./ranking.js";

// Benchmarked (Node, this repo's real data, a typical ~5-7-valid-candidate
// run including the full runAutomaticDesign pipeline, not just this module)
// at 200/500/1000/2000 trials: all completed in under ~17ms, with no
// meaningful difference in wall-clock time between 500 and 1000 (single-digit
// ms either way). Since the cost is negligible either way, there's no reason
// to shrink below the team's own suggested upper default purely for
// performance -- 1000 trials measurably reduces Monte Carlo noise on
// topRankFrequency (standard error ~sqrt(p(1-p)/n), so 1000 vs 500 trials is
// a real ~1.4x precision improvement) at no perceptible UX cost, including in
// a browser. See the Phase 3 report for the actual benchmark numbers.
export const DEFAULT_TRIALS = 1000;
export const DEFAULT_SEED = 42;
export const PERTURBATION_FRACTION = 0.2; // +/-20%, team's suggested default

// Only dimensions with a non-zero baseline weight are perturbed.
// verifiedPartSupport (weight 0.00, see scoreCandidate.js's Phase 2.5 note)
// stays fixed at 0 in every trial -- perturbation must not accidentally
// re-activate a dimension the team deliberately zeroed for not discriminating
// between candidates.
export const PERTURBABLE_DIMENSIONS = Object.keys(SCORE_WEIGHTS).filter(d => SCORE_WEIGHTS[d] > 0);

// Stability-label thresholds on topRankFrequency (fraction of trials a
// candidate ranked #1). Round, documented, arbitrary-but-defensible cutoffs,
// not derived from a formal statistical test:
//   >= 0.90  "highly stable"             -- wins under nearly every reasonable weighting
//   >= 0.60  "moderately stable"         -- wins more often than not, but a real minority of
//                                           reasonable weightings would recommend something else
//   <  0.60  "sensitive to scoring weights" -- the ranking meaningfully depends on weight choice
export const STABILITY_THRESHOLDS = { highlyStable: 0.9, moderatelyStable: 0.6 };

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One perturbed, renormalized weight vector. Exported for direct testing. */
export function perturbWeights(baseWeights, rng, fraction = PERTURBATION_FRACTION) {
  const raw = {};
  let sum = 0;
  for (const dim of PERTURBABLE_DIMENSIONS) {
    const factor = 1 + (rng() * 2 - 1) * fraction; // Uniform[1-fraction, 1+fraction], always > 0 for fraction < 1
    const w = baseWeights[dim] * factor;
    raw[dim] = w;
    sum += w;
  }
  const perturbed = {};
  for (const dim of Object.keys(baseWeights)) {
    perturbed[dim] = PERTURBABLE_DIMENSIONS.includes(dim) ? (sum > 0 ? raw[dim] / sum : 0) : baseWeights[dim];
  }
  return perturbed;
}

function rankOf(scoredList) {
  const withScores = scoredList.map(s => ({ candidateId: s.candidateId, score: s.score }));
  withScores.sort((a, b) => b.score - a.score || a.candidateId.localeCompare(b.candidateId));
  const rank = {};
  withScores.forEach((s, i) => { rank[s.candidateId] = i + 1; });
  return rank;
}

function mean(xs) { return xs.reduce((a, b) => a + b, 0) / xs.length; }
function stdDev(xs, m) { return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); }

/**
 * @param {object[]} scoredCandidates - already-scored, already-VALID candidates (e.g. runAutomaticDesign's
 *   `scoring.ranked`: each needs .candidateId, .breakdown, .overallScore, and optionally .paretoOptimal/.dominatedBy/.strongestIn).
 *   Invalid candidates must never be passed in -- this function does not re-validate.
 * @param {object} [options]
 * @param {number} [options.trials]
 * @param {number} [options.seed]
 * @param {Object<string,number>} [options.baseWeights] - defaults to SCORE_WEIGHTS.
 */
export function analyzeRankingRobustness(scoredCandidates, options = {}) {
  const trials = options.trials ?? DEFAULT_TRIALS;
  const seed = options.seed ?? DEFAULT_SEED;
  const baseWeights = options.baseWeights ?? SCORE_WEIGHTS;
  const rng = mulberry32(seed);

  if (!scoredCandidates.length) {
    return { trials, seed, perturbationFraction: PERTURBATION_FRACTION, perturbableDimensions: PERTURBABLE_DIMENSIONS, perCandidate: {}, recommended: null };
  }

  const ranksSeen = Object.fromEntries(scoredCandidates.map(c => [c.candidateId, []]));

  for (let t = 0; t < trials; t++) {
    const weights = perturbWeights(baseWeights, rng);
    const trialScored = scoredCandidates.map(c => ({ candidateId: c.candidateId, score: computeOverallScore(c.breakdown, weights).overallScore }));
    const ranks = rankOf(trialScored);
    for (const id of Object.keys(ranks)) ranksSeen[id].push(ranks[id]);
  }

  const n = trials;
  const perCandidate = {};
  for (const c of scoredCandidates) {
    const ranks = ranksSeen[c.candidateId];
    const m = mean(ranks);
    perCandidate[c.candidateId] = {
      topRankFrequency: +(ranks.filter(r => r === 1).length / n).toFixed(3),
      meanRank: +m.toFixed(2),
      rankStdDev: +stdDev(ranks, m).toFixed(2),
      worstRank: Math.max(...ranks),
      bestRank: Math.min(...ranks),
    };
  }

  // Baseline (unperturbed) ranking -- the recommendation itself is still
  // decided by scoreCandidate()'s baseline weights, exactly as before.
  // Robustness only characterizes how stable that choice is, never replaces it.
  // Phase 4C.1: reuses ranking.js's own rankCandidates() (score desc, then
  // Pareto-nondominated-before-dominated, then candidateId) instead of a
  // second, independent sort -- previously this module's own inline sort
  // (score + candidateId only, no Pareto tie-break) could silently disagree
  // with runAutomaticDesign()'s actual `recommended` about which candidate
  // was "top" whenever two candidates tied on score, one of which was
  // strictly Pareto-dominated by the other -- exactly the inconsistency a
  // manual browser test surfaced (recommended === beam__1, yet the SAME
  // result reported beam__1 as "dominated by ecoli_inducible__default").
  const baselineOrder = rankCandidates(scoredCandidates);
  const top = baselineOrder[0];
  const second = baselineOrder[1] || null;

  const recommendationStability = perCandidate[top.candidateId].topRankFrequency;
  const marginToSecond = second ? +(top.overallScore - second.overallScore).toFixed(1) : null;
  const stabilityLabel =
    recommendationStability >= STABILITY_THRESHOLDS.highlyStable ? "highly stable" :
    recommendationStability >= STABILITY_THRESHOLDS.moderatelyStable ? "moderately stable" :
    "sensitive to scoring weights";

  // Pareto relationship: reported, never folded into a number. Relies on
  // .paretoOptimal/.dominatedBy/.strongestIn already being present on each
  // scored candidate (computeParetoFront's output, attached upstream by
  // runAutomaticDesign) -- if absent, reported as null rather than guessed.
  const paretoStatus = top.paretoOptimal === undefined ? null : (top.paretoOptimal ? "pareto_optimal" : "dominated");
  const tradeoffAlternatives = scoredCandidates
    .filter(c => c.candidateId !== top.candidateId && c.paretoOptimal)
    .map(c => ({ candidateId: c.candidateId, strongestIn: c.strongestIn || [] }));

  return {
    trials, seed, perturbationFraction: PERTURBATION_FRACTION, perturbableDimensions: PERTURBABLE_DIMENSIONS,
    perCandidate,
    recommended: {
      candidateId: top.candidateId,
      recommendationStability,
      marginToSecond,
      stabilityLabel,
      paretoStatus,
      dominatedBy: top.dominatedBy || [],
      tradeoffAlternatives,
    },
  };
}
