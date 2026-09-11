// Automatic Design Mode -- assembly-aware planning (Phase 4B).
//
// Reuses designer.js's own scanSites()/gibsonPrimers()/ENZYMES unchanged --
// nothing about restriction-site detection or primer design is reimplemented
// here. This module only decides WHICH enzymes apply to a given method
// (via designGrammar.js's assembly_constraint rules, the same ones design()
// itself is built from) and packages the result into an explainable report.
//
// Method support is deliberately asymmetric and says so:
//   - gibson: FULL support. Every real template in this project uses gibson,
//     and designer.js's gibsonPrimers() is a real, tested primer-design
//     function for it.
//   - golden gate / biobrick: enzyme-conflict detection only (scanSites()
//     with the right enzyme set, per designGrammar.js's own
//     assembly_constraint rules). No project template ever uses either
//     method, so there is no tested precedent for real junction/overhang
//     primer design for them here -- primerSupport:false, and the rationale
//     says exactly why, rather than fabricating a primer scheme.
//
// No empirical cloning-success probability is computed anywhere in this
// file. `complexityProxy` is explicitly labeled a proxy (fragment count on a
// normalized scale), not a probability of anything.

import { scanSites, gibsonPrimers } from "../designer.js";
import { rulesByType } from "./designGrammar.js";

const METHOD_ENZYMES = Object.fromEntries(rulesByType("assembly_constraint").map(r => [r.condition.method, r.consequence.enzymes]));

export const SUPPORTED_ASSEMBLY_METHODS = Object.keys(METHOD_ENZYMES);

const METHOD_SUPPORT_NOTE = {
  gibson: "Full support: every real template in this project uses gibson, and designer.js's gibsonPrimers() generates real 20bp-anneal + 20bp-overlap primers for every junction.",
  goldengate: "Restriction-site conflict detection only (BsaI/BsmBI, via designer.js's scanSites()). No project template currently uses Golden Gate, so junction/overhang primer design has no tested precedent in this codebase and is NOT implemented here -- reported as a limitation, not faked.",
};

function resolvedPartsWithSeq(plan, partsById, anchorPart) {
  return plan.order.map(o => (o.id ? partsById[o.id] : anchorPart)).filter(p => p && p.seq);
}

// Phase 4C.1, item 6: names EXACTLY which resolved part(s) have no sequence
// on file, instead of the old vague "one or more resolved parts" -- so the
// UI/rationale can identify the real cause instead of leaving the user to
// guess. A missing `rec` entirely (o.id resolves to nothing at all in
// partsById) is reported as "no catalog record", distinct from a real
// catalog/anchor record whose own .seq is null/empty.
function partsMissingSequence(plan, partsById, anchorPart) {
  return plan.order
    .map(o => ({ o, rec: o.id ? partsById[o.id] : anchorPart }))
    .filter(({ rec }) => !rec || !rec.seq)
    .map(({ o, rec }) => ({ role: o.role, name: o.name, id: o.id, reason: rec ? "seq is null/empty in its catalog record" : "no catalog record found for this id" }));
}

/**
 * @param {object} plan - a candidate's .plan (from design()).
 * @param {string} method - one of SUPPORTED_ASSEMBLY_METHODS.
 * @param {object} ctx
 * @param {Object<string,object>} ctx.partsById
 * @param {object} [ctx.anchorPart]
 * @returns {{method, feasible, fragmentCount, junctionCount, conflicts, primers, primerSupport, complexityProxy, rationale, missingSequenceParts}}
 */
export function planAssembly(plan, method, ctx = {}) {
  const { partsById, anchorPart } = ctx;
  const rationale = [];

  if (!METHOD_ENZYMES[method]) {
    return {
      method, feasible: false, fragmentCount: plan.order.length, junctionCount: null,
      conflicts: [], primers: [], primerSupport: false, complexityProxy: null, missingSequenceParts: [],
      rationale: [`Unsupported assembly method "${method}" -- no assembly_constraint rule exists for it (see designGrammar.js RULES). Supported: ${SUPPORTED_ASSEMBLY_METHODS.join(", ")}.`],
    };
  }

  const enzymes = METHOD_ENZYMES[method];
  const parts = resolvedPartsWithSeq(plan, partsById, anchorPart);
  const conflicts = scanSites(parts, enzymes);
  const fragmentCount = parts.length;
  const primerSupport = method === "gibson";
  const missingSequenceParts = partsMissingSequence(plan, partsById, anchorPart);

  rationale.push(METHOD_SUPPORT_NOTE[method] || `No documented support note for method "${method}".`);

  let primers = [];
  if (primerSupport && parts.length === plan.order.length) {
    primers = gibsonPrimers(parts);
    rationale.push(`${primers.length} Gibson primer pair(s) generated (designer.js#gibsonPrimers, unmodified).`);
  } else if (primerSupport) {
    const named = missingSequenceParts.map(m => `"${m.name}" (role: ${m.role}${m.id ? `, id: ${m.id}` : ""}) -- ${m.reason}`).join("; ");
    rationale.push(`Primers not generated: ${missingSequenceParts.length} resolved part(s) have no sequence on file, so junctions cannot be computed: ${named}.`);
  } else {
    rationale.push(`Primer/junction design not generated for "${method}" -- see the support note above.`);
  }

  const feasible = conflicts.length === 0;
  if (!feasible) rationale.push(`${conflicts.length} restriction-site conflict(s) found for method "${method}" (enzymes: ${enzymes.join(", ") || "none"}) -- see conflicts.`);
  else if (enzymes.length) rationale.push(`No ${enzymes.join("/")} sites found internal to any part -- no method-specific conflicts.`);
  else rationale.push("Gibson assembly uses homology overlaps, not a fixed restriction-enzyme set, so there is no enzyme-conflict check for this method (by design, see designGrammar.js's assembly-gibson-enzymes rule).");

  // Proxy only, explicitly labeled: a simple, normalized function of fragment
  // count, NOT an empirical prediction of cloning/assembly success probability.
  const complexityProxy = +(fragmentCount / 10).toFixed(2);

  return { method, feasible, fragmentCount, junctionCount: fragmentCount, conflicts, primers, primerSupport, complexityProxy, rationale, missingSequenceParts };
}
