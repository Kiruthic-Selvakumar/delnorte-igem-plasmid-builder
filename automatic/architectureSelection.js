// Automatic Design Mode -- architecture selection.
//
// selectArchitecture() picks which of data/templates.json's architectures fits a
// characterized anchor part, instead of making the user choose a template/backbone
// up front. It reuses designer.js's own fillTemplate() to measure fit (gap count,
// placeholder count) against the REAL current catalog -- it never invents
// compatibility facts beyond what template.slots/candidates and parts.json already
// encode.
//
// A template is a candidate architecture for an anchor iff it has at least one
// `user_supplied: true` slot whose `role` equals the anchor's role -- that is the
// only kind of slot any template currently defines as "designed to receive an
// externally supplied part". Today that means role "cds" only, for all 4
// templates; if the team later adds a user_supplied slot for another role, this
// function picks it up automatically with no code change.

import { fillTemplate } from "../designer.js";

function anchorSlots(template, role) {
  return template.slots.filter(s => s.user_supplied && s.role === role);
}

function evaluate(template, anchorPart, role, partsById) {
  const { gaps } = fillTemplate(template, partsById, anchorPart);
  const slots = anchorSlots(template, role);
  const defaultMatch = slots.some(s => (s.candidates || []).includes(anchorPart.id));
  // placeholders among the BACKBONE only (the anchor's own evidence is scored
  // separately downstream by validateCandidate/scoreCandidate, not here).
  const backboneParts = [];
  for (const slot of template.slots) {
    if (slot.user_supplied) continue;
    const hit = (slot.candidates || []).map(id => partsById[id]).find(Boolean);
    if (hit) backboneParts.push(hit);
  }
  const placeholderCount = backboneParts.filter(p => p.evidence !== "verified").length;
  return { template, gapCount: gaps.length, gaps, defaultMatch, placeholderCount };
}

function rank(a, b) {
  if (a.gapCount !== b.gapCount) return a.gapCount - b.gapCount;
  if (a.defaultMatch !== b.defaultMatch) return a.defaultMatch ? -1 : 1;
  if (a.placeholderCount !== b.placeholderCount) return a.placeholderCount - b.placeholderCount;
  return 0; // stable: keep templates.json array order
}

function describe(ev) {
  const bits = [];
  bits.push(ev.gapCount === 0 ? "backbone fully resolved" : `${ev.gapCount} backbone role(s) still missing a catalog part (${ev.gaps.map(g => g.role).join(", ")})`);
  bits.push(ev.defaultMatch ? "anchor matches this template's own default candidate for the role" : "anchor is not this template's documented default for the role");
  bits.push(ev.placeholderCount === 0 ? "all backbone parts are evidence:verified" : `${ev.placeholderCount} backbone part(s) are evidence:placeholder (not yet buildable)`);
  return bits.join("; ");
}

/**
 * @param {{input: object}} characterized - the .input from a successful characterizeInput() call.
 * @param {object[]} templates - data/templates.json's `.templates` array (all of them; not pre-filtered).
 * @param {Object<string,object>} partsById - the parts catalog.
 * @returns {{ok:true, selected:object, alternatives:object[], rationale:string}|{ok:false, reason:string}}
 */
export function selectArchitecture(characterized, templates, partsById) {
  const { host, role, anchorPart } = characterized.input;
  const hostNorm = String(host).trim().toLowerCase();

  const hostMatches = templates.filter(t => String(t.host).trim().toLowerCase() === hostNorm);
  if (!hostMatches.length) {
    const supportedHosts = [...new Set(templates.map(t => t.host))];
    return {
      ok: false,
      reason: `No architecture is defined for host "${host}". Supported hosts today: ${supportedHosts.join(", ")}.`,
    };
  }

  const roleCompatible = hostMatches.filter(t => anchorSlots(t, role).length > 0);
  if (!roleCompatible.length) {
    const supportedRolesForHost = [...new Set(
      hostMatches.flatMap(t => t.slots.filter(s => s.user_supplied).map(s => s.role))
    )];
    const supportedRolesAnywhere = [...new Set(
      templates.flatMap(t => t.slots.filter(s => s.user_supplied).map(s => s.role))
    )];
    return {
      ok: false,
      reason: `No template for host "${host}" currently defines a user-suppliable slot for role "${role}". ` +
        (supportedRolesForHost.length
          ? `Supported roles for ${host}: ${supportedRolesForHost.join(", ")}.`
          : `No architecture for ${host} currently accepts a user-supplied anchor of any role.`) +
        ` (Roles supported by at least one host today: ${supportedRolesAnywhere.join(", ")}.)`,
    };
  }

  const evaluated = roleCompatible.map(t => evaluate(t, anchorPart, role, partsById));
  const ranked = [...evaluated].sort(rank);
  const best = ranked[0];
  const alternatives = ranked.slice(1);

  const rationale = `Selected "${best.template.label}" (${best.template.id}) for host "${host}", role "${role}": ${describe(best)}.` +
    (alternatives.length
      ? ` Considered ${alternatives.length} alternative(s) for the same host/role: ` +
        alternatives.map(a => `"${a.template.label}" (${a.template.id}) -- ${describe(a)}`).join("; ") + "."
      : "");

  return {
    ok: true,
    selected: { template: best.template, gapCount: best.gapCount, gaps: best.gaps, defaultMatch: best.defaultMatch, placeholderCount: best.placeholderCount, explanation: describe(best) },
    alternatives: alternatives.map(a => ({ template: a.template, gapCount: a.gapCount, gaps: a.gaps, defaultMatch: a.defaultMatch, placeholderCount: a.placeholderCount, explanation: describe(a) })),
    rationale,
  };
}
