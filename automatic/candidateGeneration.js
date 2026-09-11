// Automatic Design Mode -- candidate construction.
//
// generateCandidates() produces a bounded set of complete plasmid candidates for
// an anchor part across one or more compatible architectures (as chosen by
// selectArchitecture()), by reusing designer.js's own design() unchanged -- it
// never reimplements slot-filling. Variation is achieved by reordering a slot's
// `candidates` list so a specific alternative becomes first-present (design()'s
// own "first present candidate wins" rule then does the actual picking), not by
// duplicating that rule here.
//
// Pruning strategy (kept simple and explainable, per the design brief §6):
//   1. Each compatible template's own default resolution (its slot candidates in
//      their as-authored order) is always included first -- this is exactly what
//      Template-Guided Mode would produce for the same template + anchor.
//   2. Then, one supporting-part slot at a time, swap in each other *present*
//      candidate for that slot (holding every other slot at its default) and
//      re-run design(). This is a bounded "single-swap neighborhood" around each
//      template's default, not a cartesian product over all slots at once, so
//      candidate count grows linearly (not combinatorially) with the number of
//      (slot, alternative) pairs available.
//   3. Stop once `maxCandidates` total candidates have been generated (defaults
//      first, then swaps in template/slot/candidate order).
import { design } from "../designer.js";
import { validateCandidate } from "./candidateValidation.js";
import { buildDocumentedHostsIndex } from "./constraintEngine.js";

export function retrieveCandidateParts(template, partsById) {
  const bySlot = {};
  for (const slot of template.slots) {
    if (slot.user_supplied) continue;
    bySlot[slot.role] = {
      required: !!slot.required,
      candidates: (slot.candidates || []).map(id => partsById[id]).filter(Boolean),
      missingIds: (slot.candidates || []).filter(id => !partsById[id]),
    };
  }
  return bySlot;
}

function withSlotSwappedFirst(template, role, altId) {
  return {
    ...template,
    slots: template.slots.map(s =>
      s.role === role && !s.user_supplied
        ? { ...s, candidates: [altId, ...s.candidates.filter(id => id !== altId)] }
        : s
    ),
  };
}

function buildCandidate(id, templateMeta, template, anchorPart, partsById, variedSlot, documentedHostsIndex) {
  const plan = design(template, partsById, anchorPart);
  const validation = validateCandidate(plan, { anchorPart, partsById, host: templateMeta.host, documentedHostsIndex });
  return {
    candidateId: id,
    templateId: templateMeta.id,
    templateLabel: templateMeta.label,
    assembly: templateMeta.assembly,
    variedSlot, // null for a template's own default, else {role, fromId, toId}
    originalTemplate: templateMeta, // the unmodified, as-authored template (used by scoreCandidate's architectureSupport)
    plan,
    validation,
    origin: "template", // vs. "beam_search" from architectureGeneration.js -- see Phase 4A report
  };
}

/**
 * @param {object[]} templates - candidate architectures (already host/role-filtered by selectArchitecture).
 * @param {object} anchorPart - the anchor part record (from characterizeInput's input.anchorPart).
 * @param {Object<string,object>} partsById - the parts catalog.
 * @param {{maxCandidates?: number}} [opts]
 * @returns {Array} generated candidates, each with an attached .validation (valid + invalid included).
 */
export function generateCandidates(templates, anchorPart, partsById, opts = {}) {
  const maxCandidates = opts.maxCandidates || 6;
  const out = [];

  // buildDocumentedHostsIndex needs the FULL, cross-host template list to
  // detect "documented only for a DIFFERENT host" -- `templates` here has
  // already been host-filtered by selectArchitecture(), so every entry in it
  // shares one host and could never reveal that signal on its own. Falls
  // back to `templates` itself if the caller has no wider list (still
  // correct, just less informative -- no host-eligibility rejection is
  // possible from a single-host index, only "documented"/"unknown").
  const documentedHostsIndex = buildDocumentedHostsIndex(opts.allTemplates || templates);

  for (const template of templates) {
    if (out.length >= maxCandidates) break;
    out.push(buildCandidate(`${template.id}__default`, template, template, anchorPart, partsById, null, documentedHostsIndex));
  }

  outer:
  for (const template of templates) {
    for (const slot of template.slots) {
      if (slot.user_supplied || !slot.required) continue;
      const present = (slot.candidates || []).filter(id => partsById[id]);
      if (present.length < 2) continue;
      const defaultId = present[0];
      for (const altId of present.slice(1)) {
        if (out.length >= maxCandidates) break outer;
        const variant = withSlotSwappedFirst(template, slot.role, altId);
        out.push(buildCandidate(
          `${template.id}__swap-${slot.role}-${altId}`,
          template, variant, anchorPart, partsById,
          { role: slot.role, fromId: defaultId, toId: altId },
          documentedHostsIndex
        ));
      }
    }
  }

  return out;
}
