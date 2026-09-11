// Automatic Design Mode -- design requirement planning (Phase 4A, rebuilt on
// the formal design grammar in Phase 4B).
//
// PHASE 4B CHANGE: Phase 4A's ad hoc GOAL_CATEGORIES keyword table is
// replaced by designGrammar.js's ARCHITECTURE_FAMILIES -- structured,
// provenanced, per-host-gated design intents, selectable either explicitly
// (opts.goalFamily, what a structured UI dropdown sends) or, as a fallback,
// by free-text keyword match against the SAME family objects (never a
// separate, looser rule set). This is why tests/architectureGeneration.test.mjs's
// one direct import of GOAL_CATEGORIES had to change -- see the Phase 4B
// report for the full explanation; the underlying claim it checked
// (every category's evidence cites real project data) is unchanged, just
// checked against ARCHITECTURE_FAMILIES now.
//
// Everything else about HOW requirements are derived is unchanged from Phase
// 4A: project-baseline roles from designGrammar.js's RULES (role_required,
// derived from all 4 templates), host-specific required/optional roles from
// the intersection/union of that host's own template(s), Registry constructs
// as corroborating evidence only. A selected architecture family layers its
// own requiredRoleAdditions/optionalRoleAdditions on top, ONLY when that
// family is documented as supported for the requested host (designGrammar.js's
// hostAvailability) -- never silently applied for an unsupported host.
//
// PHASE 4C TERMINOLOGY FIX: this set was previously named
// UNIVERSAL_REQUIRED_ROLES, which overstated what it actually is. These roles
// are required ONLY because every one of this project's 4 CURRENT templates
// happens to declare them required (see designGrammar.js's "baseline-*-required"
// rules) -- they are NOT a claim that ori/marker/promoter/rbs/terminator are
// universal requirements for all possible biological plasmids (a plasmid with
// no selectable marker, or one relying on chromosomal integration instead of
// an origin of replication, is a perfectly real, different kind of
// architecture this project simply has no template for yet). Renamed to
// PROJECT_BASELINE_EXPRESSION_ROLES to say exactly that.

import { CANONICAL_ROLE_ORDER, RULES, rulesByType, ARCHITECTURE_FAMILIES, getSupportedFamiliesForHost, matchFamilyByGoalText } from "./designGrammar.js";

export { CANONICAL_ROLE_ORDER };
export const PROJECT_BASELINE_EXPRESSION_ROLES = rulesByType("role_required")
  .filter(r => !r.condition.host)
  .map(r => r.condition.role);

function normHost(h) { return String(h || "").trim().toLowerCase(); }

/**
 * @param {object} opts
 * @param {string} opts.anchorRole
 * @param {string} opts.host
 * @param {string} [opts.goal] - free text, used only as a fallback when goalFamily is omitted.
 * @param {string} [opts.goalFamily] - an ARCHITECTURE_FAMILIES key, from a structured UI selection. Takes precedence over goal text.
 * @param {object[]} opts.templates - data/templates.json's `.templates` array.
 * @param {object[]} [opts.registryConstructs] - data/registry_cache.json's `.constructs`, optional.
 * @param {boolean} [opts.ablateGoalRules] - Phase 4B Step 12 ablation-study hook ONLY, default false,
 *   never set by runAutomaticDesign()'s normal path (see benchmark/ablation_analysis.mjs, the only
 *   caller that ever sets this true): when true, architecture-family selection is skipped entirely --
 *   requiredRoles/optionalRoles reflect only the project-baseline + host-intersection rules below, with none
 *   of a family's own requiredRoleAdditions/optionalRoleAdditions/recommendedPartIds ever applied.
 * @returns {{anchorRole, requiredRoles, optionalRoles, rationale, family, familyStatus, goalInterpretation, supportedGoalCategories, supportedFamiliesForHost}}
 */
export function planDesignRequirements(opts) {
  const { anchorRole, host, goal, goalFamily, templates, registryConstructs, ablateGoalRules = false } = opts;
  const rationale = [];

  const required = new Set(PROJECT_BASELINE_EXPRESSION_ROLES);
  const optional = new Set();
  rationale.push(`Project-baseline required roles {${PROJECT_BASELINE_EXPRESSION_ROLES.join(", ")}} -- required:true and non-user_supplied in every one of the ${templates.length} templates CURRENTLY in data/templates.json, independent of host. Not a claim these are universal requirements for all possible plasmids.`);

  const hostTemplates = templates.filter(t => normHost(t.host) === normHost(host));
  if (hostTemplates.length) {
    const requiredSets = hostTemplates.map(t => new Set(t.slots.filter(s => s.required && !s.user_supplied).map(s => s.role)));
    const hostRequiredIntersection = [...requiredSets[0]].filter(role => requiredSets.every(s => s.has(role)));
    for (const role of hostRequiredIntersection) {
      if (!required.has(role)) {
        required.add(role);
        rationale.push(`"${role}" added as required for host "${host}": required:true in all ${hostTemplates.length} of its documented template(s) (${hostTemplates.map(t => t.id).join(", ")}).`);
      }
    }
    const optionalUnion = new Set(hostTemplates.flatMap(t => t.slots.filter(s => !s.required && !s.user_supplied).map(s => s.role)));
    for (const role of optionalUnion) {
      if (!required.has(role)) {
        optional.add(role);
        rationale.push(`"${role}" offered as optional for host "${host}": declared optional in at least one of its documented template(s).`);
      }
    }
  } else {
    rationale.push(`No template in data/templates.json documents host "${host}" -- falling back to the cross-host project-baseline required-role set only, with no host-specific optional roles (none are known).`);
  }

  if (registryConstructs && registryConstructs.length) {
    const cassetteRoles = ["promoter", "rbs", "terminator"];
    const corroborating = registryConstructs.filter(c => cassetteRoles.every(r => (c.architectureRoles || []).some(label => label.toLowerCase().includes(r) || (r === "rbs" && label.toLowerCase().includes("ribosome")))));
    if (corroborating.length) {
      rationale.push(`${corroborating.length} cached Registry reference construct(s) (${corroborating.map(c => c.registryId).join(", ")}) independently show the same promoter/rbs/terminator pattern around a CDS -- corroborating evidence only, does not by itself add or remove a role.`);
    }
  }

  // --- Architecture family selection (Phase 4B) ---
  const supportedFamiliesForHost = getSupportedFamiliesForHost(host);
  let family = null, familyStatus, matchedKeyword = null, goalRecognized = false, matchedCategory = null;

  if (ablateGoalRules) {
    familyStatus = "Design-goal-specific rules are ABLATED for this run (benchmark/ablation_analysis.mjs) -- architecture-family selection is skipped entirely regardless of what goal/goalFamily was supplied; requiredRoles/optionalRoles reflect only the project-baseline + host-intersection rules above.";
  } else if (goalFamily && ARCHITECTURE_FAMILIES[goalFamily]) {
    const f = ARCHITECTURE_FAMILIES[goalFamily];
    const avail = f.hostAvailability[host];
    if (avail && avail.supported) {
      family = f; goalRecognized = true; matchedCategory = f.id;
      familyStatus = `Structured design goal "${f.label}" selected explicitly and is supported for host "${host}": ${avail.evidence} (${avail.sourceReference}).`;
    } else {
      familyStatus = `Structured design goal "${f.label}" was selected but is NOT documented as supported for host "${host}" -- ${avail ? avail.evidence : "no evidence at all for this host"}. Falling back to the baseline required-role set only; not silently applying this family's role additions.`;
    }
  } else {
    const match = matchFamilyByGoalText(goal);
    if (match) {
      const avail = match.family.hostAvailability[host];
      matchedKeyword = match.matchedKeyword;
      if (avail && avail.supported) {
        family = match.family; goalRecognized = true; matchedCategory = match.family.id;
        familyStatus = `Goal text matched family "${match.family.label}" (keyword "${matchedKeyword}") and it is supported for host "${host}": ${avail.evidence} (${avail.sourceReference}).`;
      } else {
        familyStatus = `Goal text matched family "${match.family.label}" (keyword "${matchedKeyword}"), but it is NOT documented as supported for host "${host}" -- ${avail ? avail.evidence : "no evidence at all for this host"}. Falling back to the baseline required-role set only.`;
      }
    } else if (String(goal || "").trim()) {
      familyStatus = `Goal text did not match any supported structured category (${Object.keys(ARCHITECTURE_FAMILIES).join(", ")}) -- used as a human-readable label only, no requirement adjustment made rather than guessing.`;
    } else {
      familyStatus = "No design goal supplied -- baseline required-role set only.";
    }
  }

  if (family) {
    for (const role of family.requiredRoleAdditions) {
      if (!required.has(role)) { required.add(role); optional.delete(role); rationale.push(`Family "${family.label}" adds "${role}" as required. ${family.hostAvailability[host].evidence} (${family.hostAvailability[host].sourceReference})`); }
    }
    for (const role of family.optionalRoleAdditions) {
      if (!required.has(role) && !optional.has(role)) { optional.add(role); rationale.push(`Family "${family.label}" adds "${role}" as optional. ${family.hostAvailability[host].evidence} (${family.hostAvailability[host].sourceReference})`); }
    }
  }
  rationale.push(familyStatus);

  required.delete(anchorRole);
  optional.delete(anchorRole);

  const orderIndex = r => { const i = CANONICAL_ROLE_ORDER.indexOf(r); return i === -1 ? CANONICAL_ROLE_ORDER.length : i; };
  const requiredRoles = [...required].sort((a, b) => orderIndex(a) - orderIndex(b));
  const optionalRoles = [...optional].sort((a, b) => orderIndex(a) - orderIndex(b));

  return {
    anchorRole,
    requiredRoles,
    optionalRoles,
    rationale,
    family: family ? { id: family.id, label: family.label } : null,
    familyStatus,
    goalInterpretation: { recognized: goalRecognized, category: matchedCategory, matchedKeyword },
    supportedGoalCategories: Object.keys(ARCHITECTURE_FAMILIES),
    supportedFamiliesForHost: supportedFamiliesForHost.map(f => ({ id: f.id, label: f.label })),
  };
}
