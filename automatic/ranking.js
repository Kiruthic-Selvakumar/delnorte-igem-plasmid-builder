// Automatic Design Mode -- ranking, Pareto front, and pairwise comparison (Phase 2).
//
// Operates purely on the output of scoreCandidate() -- it never re-derives a
// sub-score itself. Dominance/Pareto checks use the sub-score vector
// (ACTIVE_DIMENSIONS), never the collapsed `overallScore`, so a single weighted
// number is never the only lens on the candidate set (per the design brief's
// explicit "do not force everything into one scalar score").

import { ACTIVE_DIMENSIONS } from "./scoreCandidate.js";

/**
 * Deterministic ranking policy (Phase 4C.1 -- made explicit after a manual
 * browser test found a Pareto-dominated candidate recommended over a tied,
 * Pareto-nondominated one, purely by candidateId luck):
 *   1. higher overallScore wins;
 *   2. on a tie, Pareto-nondominated (.paretoOptimal === true) is preferred
 *      over Pareto-dominated -- a candidate strictly worse-or-equal on every
 *      scored dimension than some other tied candidate should never be
 *      preferred over it;
 *   3. only if BOTH the score and Pareto standing tie (or Pareto standing
 *      is not yet known -- .paretoOptimal is undefined, e.g. a caller that
 *      hasn't run computeParetoFront yet), fall back to candidateId, for
 *      determinism (never insertion order, an accident of
 *      generateCandidates()'s traversal, not a real ranking criterion).
 * Pareto membership is used ONLY as a tie-break ORDERING signal here, never
 * folded into a numeric score -- overallScore itself is completely unchanged.
 */
export function rankCandidates(scored) {
  return [...scored].sort((a, b) => {
    if (b.overallScore !== a.overallScore) return b.overallScore - a.overallScore;
    const aOptimal = a.paretoOptimal === true, bOptimal = b.paretoOptimal === true;
    if (aOptimal !== bOptimal) return aOptimal ? -1 : 1;
    return a.candidateId.localeCompare(b.candidateId);
  });
}

function dominates(a, b, dimensions) {
  let strictlyBetterSomewhere = false;
  for (const d of dimensions) {
    const av = a.breakdown[d], bv = b.breakdown[d];
    if (av === null || bv === null) continue; // dimension not scored for one side -> ignored for dominance, not treated as 0
    if (av < bv) return false;
    if (av > bv) strictlyBetterSomewhere = true;
  }
  return strictlyBetterSomewhere;
}

/**
 * @param {object[]} scored - scoreCandidate() results, each also carrying candidateId.
 * @param {string[]} [dimensions] - defaults to every active (non-Registry) dimension.
 * @returns {Array<{candidateId:string, paretoOptimal:boolean, dominatedBy:string[], strongestIn:string[]}>}
 */
export function computeParetoFront(scored, dimensions = ACTIVE_DIMENSIONS) {
  return scored.map(s => {
    const dominators = scored.filter(o => o.candidateId !== s.candidateId && dominates(o, s, dimensions));
    const paretoOptimal = dominators.length === 0;
    const strongestIn = paretoOptimal
      ? dimensions.filter(d => s.breakdown[d] !== null && s.breakdown[d] === Math.max(...scored.map(o => (o.breakdown[d] === null ? -Infinity : o.breakdown[d]))))
      : [];
    return { candidateId: s.candidateId, paretoOptimal, dominatedBy: dominators.map(d => d.candidateId), strongestIn };
  });
}

/** Explains why `winner` outranks `loser` in terms of the actual sub-scores
 * that drove the difference, not just "the number was bigger" -- and, per
 * Phase 4C.1, NEVER claims a dimension "drove" the ranking when that
 * dimension's values are actually identical (or when overallScore itself is
 * tied and something else -- Pareto standing, then candidateId -- broke the
 * tie; see rankCandidates()'s own tie-break policy, applied consistently
 * here). Manual browser testing surfaced exactly this: "outranks ... driven
 * mainly by functionalCompleteness (86% vs 86%)" -- a false claim, since 86%
 * vs 86% is not a difference at all. */
export function compareCandidates(winner, loser, dimensions = ACTIVE_DIMENSIONS) {
  const deltas = dimensions
    .filter(d => winner.breakdown[d] !== null && loser.breakdown[d] !== null)
    .map(d => ({ dimension: d, winner: winner.breakdown[d], loser: loser.breakdown[d], delta: winner.breakdown[d] - loser.breakdown[d] }));
  // Only a REAL difference (non-zero delta) may ever be cited as a driver.
  const realDeltas = deltas.filter(d => Math.abs(d.delta) > 1e-9);
  const biggest = realDeltas.length ? [...realDeltas].sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))[0] : null;

  const scoreTied = Math.abs(winner.overallScore - loser.overallScore) < 1e-9;

  let summary;
  if (biggest) {
    summary = scoreTied
      ? `${winner.candidateId} and ${loser.candidateId} are tied on displayed overall score (${winner.overallScore} vs ${loser.overallScore}); ${winner.candidateId} is listed first because it scores higher on ${biggest.dimension} (${(biggest.winner * 100).toFixed(0)}% vs ${(biggest.loser * 100).toFixed(0)}%)${winner.paretoOptimal !== undefined ? `, and it is ${winner.paretoOptimal ? "Pareto-nondominated" : "Pareto-dominated"} while ${loser.candidateId} is ${loser.paretoOptimal ? "Pareto-nondominated" : "Pareto-dominated"}` : ""}.`
      : `${winner.candidateId} outranks ${loser.candidateId} (overall ${winner.overallScore} vs ${loser.overallScore}), driven mainly by ${biggest.dimension} (${(biggest.winner * 100).toFixed(0)}% vs ${(biggest.loser * 100).toFixed(0)}%).`;
  } else if (scoreTied) {
    // Overall score AND every comparable sub-score are identical -- the real
    // tie-break must be Pareto standing (see rankCandidates) or, failing
    // that, candidateId. Never invent a dimension that "caused" this.
    const paretoBroke = winner.paretoOptimal !== undefined && winner.paretoOptimal !== loser.paretoOptimal;
    summary = paretoBroke
      ? `${winner.candidateId} and ${loser.candidateId} are tied on displayed overall score (${winner.overallScore} vs ${loser.overallScore}) and on every comparable sub-score; ${winner.candidateId} is listed first because it is Pareto-nondominated and ${loser.candidateId} is Pareto-dominated.`
      : `${winner.candidateId} and ${loser.candidateId} are tied on displayed overall score (${winner.overallScore} vs ${loser.overallScore}) and on every comparable sub-score; ${winner.candidateId} is listed first only by the deterministic candidateId tie-break, not because either candidate is actually better.`;
  } else {
    summary = `${winner.candidateId} outranks ${loser.candidateId} (overall ${winner.overallScore} vs ${loser.overallScore}); no single comparable sub-score differs, so the overall-score difference comes from a dimension excluded from one side (see weightUsed) rather than any one dimension "driving" it.`;
  }
  return { deltas, summary };
}
