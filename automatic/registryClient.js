// Automatic Design Mode -- iGEM Registry abstraction (Phase 2).
//
// IMPORTANT: this module ships with NO Registry data. `EMPTY_REGISTRY` is the
// default cache -- zero parts, zero constructs -- and every function degrades
// gracefully (ok:false / available:false) rather than throwing or inventing a
// result. No Registry ID, sequence, host-compatibility claim, or reference
// construct anywhere in this codebase was fabricated to fill this gap.
//
// Why it's empty: live network access to the Registry was checked from this
// development environment before Phase 1 (parts.igem.org and synbiohub.org both
// returned HTTP 403 to a direct fetch), so this module cannot itself verify and
// load real records right now. See the Phase 2 report for the exact question
// asked back to the team about which verified records to load, and the schema
// below for the fields each one needs.
//
// Design choice: this client takes its cache as a plain data object (dependency
// injection), the same pattern already used for `partsById` throughout this
// codebase -- it does not fetch anything itself. That keeps it usable identically
// from Node (tests/benchmark, via a JSON object) and from the browser (index.html
// would `fetch("./data/registry_cache.json")` the same way it already fetches
// data/parts.json, once such a file exists and is approved) without duplicating
// fetch/parse logic here.
//
// Expected cache shape (data/registry_cache.json, once populated with verified
// records -- this file does not exist yet and this module does not create it):
//   {
//     schema_version: 1,
//     provenance: "<where these records came from, e.g. Registry API dump date/URL>",
//     parts: [
//       {
//         registryId,        // e.g. a BBa_XXXXXXX identifier
//         name, role,        // role uses this project's existing type vocabulary
//         seq,                // only if independently verified; else null
//         hosts,              // only if documented by the Registry entry itself
//         compositeOf,        // sub-part registryIds, only if it's a composite part
//         source, sourceUrl,  // provenance, required
//         evidence,           // "verified" | "placeholder", per CLAUDE.md's rule
//       }, ...
//     ],
//     constructs: [
//       {
//         registryId, name, host, purpose,
//         architectureRoles,  // ordered list of roles, as documented
//         knownParts,         // registryId list of parts it's composed of
//         source, sourceUrl,
//       }, ...
//     ],
//   }

export const EMPTY_REGISTRY = {
  schema_version: 1,
  provenance: "No verified iGEM Registry records are loaded. See the Phase 2 report for the specific records requested.",
  parts: [],
  constructs: [],
};

// Registry role labels (Title Case, as returned by the API's role.label field)
// -> this project's own local role vocabulary. Shared by registryClient and
// referenceComparison.js so there is exactly one mapping table, not two.
// A label with no entry maps to null (deliberately -- never guessed).
export const ROLE_LABEL_TO_LOCAL = {
  "Promoter": "promoter",
  "Ribosome Entry Site": "rbs",
  "CDS": "cds",
  "Terminator": "terminator",
  "Plasmid Vector": "origin",
  "selection_marker": "marker",
  "Signal Peptide": "signal",
  "Origin Of Replication": "origin",
};

export function mapRegistryRole(label) {
  return ROLE_LABEL_TO_LOCAL[label] ?? null;
}

function isInsertableRegistryPart(registryPart) {
  return !!(registryPart.sequence && /^[ACGTN]+$/.test(registryPart.sequence) && registryPart.mappedLocalRole);
}

function asInsertablePart(registryPart) {
  return {
    id: `registry:${registryPart.registryId}`,
    name: registryPart.title || registryPart.registryId,
    type: registryPart.mappedLocalRole,
    seq: registryPart.sequence,
    length: registryPart.length,
    gc: null,
    desc: `Registry-recorded part ${registryPart.registryId}${registryPart.title ? " — " + registryPart.title : ""}`,
    src: `iGEM Registry API (${registryPart.sourceUrl})`,
    evidence: "placeholder", // never "verified" -- see createRegistryClient()'s getInsertableCandidates note
    hosts: {},
    registryProvenance: {
      registryId: registryPart.registryId, uuid: registryPart.uuid, sourceUrl: registryPart.sourceUrl,
      establishedReference: registryPart.establishedReference, provenanceStatus: registryPart.provenanceStatus,
    },
  };
}

/**
 * @param {object} [cache] - a registry cache object shaped like EMPTY_REGISTRY. Missing/empty -> unavailable.
 */
export function createRegistryClient(cache) {
  const parts = (cache && Array.isArray(cache.parts)) ? cache.parts : [];
  const constructs = (cache && Array.isArray(cache.constructs)) ? cache.constructs : [];
  const available = parts.length > 0 || constructs.length > 0;
  const unavailableReason = "No verified iGEM Registry records are loaded yet.";

  return {
    available,
    provenance: (cache && cache.provenance) || EMPTY_REGISTRY.provenance,

    fetchPart(registryId) {
      if (!available) return { ok: false, reason: unavailableReason };
      const part = parts.find(p => p.registryId === registryId);
      return part ? { ok: true, part } : { ok: false, reason: `No Registry part with id "${registryId}" in the loaded cache.` };
    },

    searchParts(query) {
      if (!available) return { ok: false, reason: unavailableReason, results: [] };
      const q = String(query || "").trim().toLowerCase();
      if (!q) return { ok: true, results: [] };
      return { ok: true, results: parts.filter(p => (p.title || "").toLowerCase().includes(q) || (p.registryId || "").toLowerCase().includes(q)) };
    },

    // role: this project's LOCAL role vocabulary (e.g. "promoter"), not the
    // Registry's own Title-Case label -- translated via mapRegistryRole so
    // callers never need to know the Registry's own vocabulary.
    findPartsByRole(role, opts = {}) {
      if (!available) return { ok: false, reason: unavailableReason, results: [] };
      const results = parts.filter(p => mapRegistryRole(p.role) === role);
      return { ok: true, results };
    },

    // Filters by architectural role relevance only (does a reference contain
    // >=1 part in the requested role). Chassis/host relevance is deliberately
    // NOT filtered here -- most cached references have no documented chassis at
    // all, and silently dropping them would convert "undocumented" into "no
    // match" (a false negative). Host/chassis agreement is instead reported,
    // explicitly including "unknown", by compareToReferences() downstream.
    findReferenceConstructs(opts = {}) {
      if (!available) return { ok: false, reason: unavailableReason, constructs: [] };
      const results = constructs.filter(c =>
        !opts.role || (c.architectureRoles || []).some(label => mapRegistryRole(label) === opts.role)
      );
      return { ok: true, constructs: results };
    },

    // Not one of the Registry's own documented endpoints -- a local lookup over
    // the already-fetched cache, needed for the "exact Registry match" support
    // signal (see referenceComparison.js). Exact, case-insensitive sequence
    // equality only; never a fuzzy/partial match.
    findPartBySequence(seq) {
      if (!available || !seq) return { ok: false, reason: unavailableReason };
      const S = String(seq).toUpperCase();
      const hit = parts.find(p => p.sequence && p.sequence.toUpperCase() === S);
      return hit ? { ok: true, part: hit } : { ok: false, reason: "No exact sequence match in the loaded cache." };
    },

    fetchComposition(registryId) {
      if (!available) return { ok: false, reason: unavailableReason };
      const construct = constructs.find(c => c.registryId === registryId);
      if (!construct) return { ok: false, reason: `No Registry construct with id "${registryId}" in the loaded cache.` };
      const composition = (construct.knownParts || []).map(id => parts.find(p => p.registryId === id) || { registryId: id, name: null, note: "referenced but not itself in the loaded cache" });
      return { ok: true, construct, composition };
    },

    // --- Phase 4B: Registry parts as CANDIDATE parts (not just comparison) ---
    //
    // A cached Registry part is insertable into a real candidate ONLY when it
    // carries a real sequence, a documented (mapped) local role, and full
    // provenance -- all 7 of this project's currently-cached parts qualify,
    // nothing else does (the cache has no other parts). Adapted (via
    // asInsertablePart, above) into a part-shaped record identical in shape
    // to a data/parts.json entry so designer.js's design()/fillTemplate()
    // need no special-casing to use it -- but its `evidence` field is ALWAYS
    // "placeholder", never "verified": per CLAUDE.md, "verified" means this
    // project's own curated evidence, and Registry presence/age/usage is
    // explicitly NOT that (see the Phase 2.5 report's provenance-terminology
    // distinction).
    //
    // PHASE 4C UPDATE: validateCandidate() no longer treats this raw 2-value
    // `evidence` field as the hard-rejection gate. automatic/provenanceModel.js
    // classifies a part like this one as provenanceStatus:"registry_recorded"
    // (a distinct, non-"placeholder" status) -- a candidate containing it is
    // hard-VALID as long as every other constraint passes, carrying an
    // honest "not project-verified, not wet-lab validation" warning instead
    // of a rejection. See the Phase 4C report for the full rationale.
    getInsertableCandidates(role) {
      if (!available) return [];
      return parts.filter(p => p.mappedLocalRole === role && isInsertableRegistryPart(p)).map(asInsertablePart);
    },
  };
}
