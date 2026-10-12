// Automatic Design Mode -- structural comparison against cached Registry
// reference constructs (Phase 2.5).
//
// Everything here reports STRUCTURAL/documented agreement, never a biological
// or experimental claim. In particular: "Registry-recorded" (this data came
// from a real Registry record) and "Registry-established" (createdReference:
// an older, higher-usage Registry record -- see automatic/registryClient.js's
// EMPTY_REGISTRY/cache provenance note for the exact rule) are NOT the same
// concept as this project's local "evidence:verified" -- a Registry-recorded
// or even Registry-established part/construct is never treated as biologically
// validated. Chassis/host agreement is reported as "unknown" whenever the
// Registry record itself documents no chassis, never silently coerced to a
// mismatch or a match.

import { mapRegistryRole } from "./registryClient.js";

// Registry chassis.scientificName strings use full binomial names (e.g.
// "Escherichia coli DH5[alpha]"); this project's host strings are short forms
// (e.g. "E. coli"). This table only expands OUR OWN host label to the
// scientific-name substring used to recognize it in Registry chassis data --
// it does not infer compatibility from a part's name or content, which is a
// different (and forbidden) thing. If a host has no entry here, chassis
// agreement is always reported "unknown" for it, never guessed.
const HOST_SCIENTIFIC_NAME_HINTS = {
  "E. coli": "escherichia coli",
  "B. subtilis": "bacillus subtilis",
  "V. natriegens": "vibrio natriegens",
};

function resolvePart(orderEntry, partsById, anchorPart) {
  return orderEntry.id ? partsById[orderEntry.id] : (anchorPart && anchorPart.id === null ? anchorPart : null);
}

/** Every candidate part whose sequence exactly matches a cached Registry part. */
export function findExactRegistryMatches(plan, partsById, anchorPart, registryClient) {
  if (!registryClient || !registryClient.available) return [];
  const matches = [];
  for (const o of plan.order) {
    const rec = resolvePart(o, partsById, anchorPart);
    if (!rec || !rec.seq) continue;
    const hit = registryClient.findPartBySequence(rec.seq);
    if (hit.ok) matches.push({ role: o.role, localName: o.name, registryId: hit.part.registryId, registryTitle: hit.part.title });
  }
  return matches;
}

/** Longest-common-subsequence based similarity in [0,1]: order-sensitive, but
 * tolerant of extra/missing roles on either side (an insertion/deletion does
 * not zero out the whole comparison the way exact-sequence equality would). */
export function roleOrderSimilarity(rolesA, rolesB) {
  if (!rolesA.length || !rolesB.length) return 0;
  const dp = Array.from({ length: rolesA.length + 1 }, () => new Array(rolesB.length + 1).fill(0));
  for (let i = 1; i <= rolesA.length; i++) {
    for (let j = 1; j <= rolesB.length; j++) {
      dp[i][j] = rolesA[i - 1] === rolesB[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[rolesA.length][rolesB.length] / Math.max(rolesA.length, rolesB.length);
}

function chassisAgreement(reference, host) {
  const allEntries = [
    ...(reference.chassis?.designedFor || []),
    ...(reference.chassis?.characterisedIn || []),
    ...(reference.chassis?.sourceOrganism || []),
  ];
  if (!allEntries.length) return { status: "unknown", detail: "This reference documents no chassis (designedFor/characterisedIn/sourceOrganism are all empty) -- absence of data, not evidence of incompatibility." };
  const hint = HOST_SCIENTIFIC_NAME_HINTS[host];
  if (!hint) return { status: "unknown", detail: `No scientific-name mapping is configured for host "${host}", so documented chassis entries here can't be compared to it.` };
  const names = allEntries.map(e => e.scientificName);
  const agree = names.some(n => n.toLowerCase().includes(hint));
  return agree
    ? { status: "agree", detail: `Reference documents chassis matching "${host}" (${names.join(", ")}).` }
    : { status: "mismatch", detail: `Reference documents chassis (${names.join(", ")}), none of which match "${host}".` };
}

/**
 * @param {object} candidate - a generateCandidates() entry (.plan required).
 * @param {object[]} references - cache.constructs entries (from registryClient's cache, or already role-filtered via findReferenceConstructs).
 * @param {object} context
 * @param {Object<string,object>} context.partsById
 * @param {object} [context.anchorPart]
 * @param {string} context.host
 * @param {object} context.registryClient
 * @returns {Array} one report per reference.
 */
export function compareToReferences(candidate, references, context) {
  const { partsById, anchorPart, host, registryClient } = context;
  const exactMatches = findExactRegistryMatches(candidate.plan, partsById, anchorPart, registryClient);
  const exactMatchIds = new Set(exactMatches.map(m => m.registryId));
  const candidateRoles = candidate.plan.order.map(o => o.role);

  return references.map(ref => {
    const referenceRoles = (ref.architectureRoles || []).map(mapRegistryRole).filter(Boolean);
    const shared = ref.knownParts ? ref.knownParts.filter(id => exactMatchIds.has(id)) : [];
    const missingFromCandidate = referenceRoles.filter(r => !candidateRoles.includes(r));
    const missingFromReference = candidateRoles.filter(r => !referenceRoles.includes(r));
    const chassis = chassisAgreement(ref, host);
    return {
      referenceId: ref.registryId,
      title: ref.title,
      sourceUrl: ref.sourceUrl,
      sharedExactParts: shared,
      candidateRoleSequence: candidateRoles,
      referenceRoleSequence: referenceRoles,
      roleOrderSimilarity: +roleOrderSimilarity(candidateRoles, referenceRoles).toFixed(2),
      chassisAgreement: chassis.status,
      chassisDetail: chassis.detail,
      structuralDifferences: {
        rolesOnlyInReference: missingFromCandidate,
        rolesOnlyInCandidate: missingFromReference,
      },
    };
  });
}
