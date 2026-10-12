// Automatic Design Mode -- input-normalization layer.
//
// characterizeInput() turns whatever the user gave us (an existing catalog part,
// a pasted DNA sequence, plus host/goal) into one normalized shape the rest of the
// Automatic Design pipeline (selectArchitecture / generateCandidates /
// validateCandidate) can rely on, OR a clear, explainable rejection.
//
// Hard rule this module exists to enforce (CLAUDE.md + the design brief, §2):
// if a raw sequence is supplied and it doesn't match anything in the local
// catalog, its biological role is NOT guessed -- the caller must supply it.
//
// No DNA is ever fabricated here. A "novel_sequence" anchor's `seq` field is
// exactly what the caller passed in (normalized for case/whitespace only), and it
// is always tagged evidence:"placeholder" -- it has no citable source, so per
// CLAUDE.md it can never be marked "verified".

import { rc } from "../designer.js";
import { normalizeDNA, isValidDNA, looksLikeAttemptedDNA } from "./dna.js";

const gc = seq => seq.length ? 100 * [...seq].filter(c => c === "G" || c === "C").length / seq.length : 0;

// Phase 5B: this project's OWN internal beam-search role vocabulary
// (designGrammar.js's CANONICAL_ROLE_ORDER) spells the origin-of-replication
// role "ori", while the UI/catalog TYPE vocabulary (data/parts.json's `type`
// field, AutomaticModeUI.jsx's TYPE_OPTIONS, customPartRegistry.js's
// SUPPORTED_CUSTOM_PART_ROLES) spells it "origin" -- every other role name is
// already spelled identically in both vocabularies. Without this mapping, an
// "origin"-typed anchor (catalog OR custom) silently fails to match ANY
// host-required-role/family rule (all of which key on "ori"), a real,
// pre-existing gap this phase's custom-origin support surfaced. Applied
// uniformly to every characterizeInput() mode, not just custom parts, since
// the same bug affects a catalog origin part selected as an anchor too.
export const TYPE_TO_INTERNAL_ROLE = { origin: "ori" };
export const toInternalRole = type => TYPE_TO_INTERNAL_ROLE[type] || type;

function findByExactName(catalog, name) {
  const q = name.trim().toLowerCase();
  return catalog.filter(p => (p.name || "").toLowerCase() === q);
}

function findByFuzzyName(catalog, name, limit = 5) {
  const q = name.trim().toLowerCase();
  return catalog
    .filter(p => (p.name || "").toLowerCase().includes(q))
    .slice(0, limit);
}

function findBySequence(catalog, normalizedSeq) {
  const rcSeq = rc(normalizedSeq);
  for (const p of catalog) {
    if (!p.seq) continue;
    const S = p.seq.toUpperCase();
    if (S === normalizedSeq) return { part: p, kind: "exact", position: 0 };
  }
  for (const p of catalog) {
    if (!p.seq) continue;
    const S = p.seq.toUpperCase();
    const i = S.indexOf(normalizedSeq);
    if (i >= 0) return { part: p, kind: "substring_plus_strand", position: i };
    const j = S.indexOf(rcSeq);
    if (j >= 0) return { part: p, kind: "substring_minus_strand", position: j };
  }
  return null;
}

/**
 * @param {object} opts
 * @param {string} [opts.partId] - id of a part already picked from the local catalog.
 * @param {string} [opts.text] - free text: either a part name/id to look up, or a pasted DNA sequence.
 * @param {string} [opts.role] - biological role (promoter|rbs|cds|terminator|marker|origin|signal|operator|orit|other).
 *   Required whenever the anchor can't be resolved to a known catalog part.
 * @param {object} [opts.customPart] - Phase 5B: a part object already produced by
 *   customPartRegistry.js's registerCustomPart() (id, name, type, seq, ..., customPartProvenance).
 *   When supplied, this is used directly as the anchor -- no partId/text lookup is performed.
 *   Its declared `type` is authoritative (already an explicit human declaration at registration
 *   time), so it is never overridden the way a mismatched opts.role can override a catalog part's type.
 * @param {string} opts.host - target chassis/host, must match a host string present in the loaded templates.
 * @param {string} [opts.goal] - free-text design goal/purpose. Not biologically interpreted here --
 *   selectArchitecture/designRequirements only use it as a human-readable rationale input or, via a small
 *   fixed keyword match, to select a structured architecture family (see designGrammar.js). Required UNLESS
 *   opts.goalFamily (a structured, Step-3 UI dropdown selection) is supplied instead.
 * @param {string} [opts.goalFamily] - an ARCHITECTURE_FAMILIES id (Phase 4B structured goal selection);
 *   satisfies the goal requirement on its own, with or without free-text opts.goal also present.
 * @param {Object<string,object>} opts.partsById - the parts catalog, id -> part record (data/parts.json shape).
 * @returns {{ok:true, warnings:string[], input:object}|{ok:false, errors:string[], warnings:string[]}}
 */
export function characterizeInput(opts) {
  const { partId, text, role: requestedRole, host, goal, goalFamily, partsById, customPart } = opts || {};
  const errors = [];
  const warnings = [];
  const catalog = Object.values(partsById || {});

  if (!host || !String(host).trim()) errors.push("Host/chassis is required.");
  if ((!goal || !String(goal).trim()) && !goalFamily) errors.push("A design goal/purpose (free text) or a structured goalFamily selection is required.");

  let anchor = null;       // resolved part-shaped record
  let mode = null;         // "local_part" | "known_sequence_match" | "novel_sequence" | "custom_part"
  let matchNote = null;

  if (customPart) {
    // Phase 5B: an already-registered custom (external) part, supplied directly by the
    // caller (AutomaticModeUI.jsx's "Register Custom Part" flow) -- not looked up by
    // partId/text at all. Its sequence and declared role are used exactly as registered.
    anchor = customPart;
    mode = "custom_part";
    matchNote = customPart.customPartProvenance?.sourceTeam
      ? `registered custom part supplied by ${customPart.customPartProvenance.sourceTeam}`
      : "registered custom part supplied by the user this session";
  } else if (partId) {
    const p = partsById && partsById[partId];
    if (!p) errors.push(`No catalog part with id "${partId}".`);
    else { anchor = p; mode = "local_part"; matchNote = "selected directly from the local catalog"; }
  } else if (text && text.trim()) {
    const raw = text.trim();
    const normalized = normalizeDNA(raw);
    if (isValidDNA(normalized) && normalized.length > 0) {
      const hit = findBySequence(catalog, normalized);
      if (hit) {
        anchor = hit.part;
        mode = "known_sequence_match";
        matchNote = hit.kind === "exact"
          ? "exact sequence match to a local catalog part"
          : `found ${hit.kind === "substring_minus_strand" ? "on the minus strand (reverse complement)" : "on the plus strand"} of a local catalog part at position ${hit.position + 1}`;
      } else if (requestedRole) {
        mode = "novel_sequence";
        matchNote = "no match in the local catalog; treated as a novel user-supplied sequence";
        anchor = {
          id: null,
          name: "user-supplied sequence",
          type: requestedRole,
          seq: normalized,
          length: normalized.length,
          gc: +gc(normalized).toFixed(1),
          desc: `User-supplied ${requestedRole} sequence`,
          src: "Supplied by the user at runtime; no catalog or Registry cross-reference.",
          evidence: "placeholder",
          hosts: {},
        };
      } else {
        errors.push(
          "This sequence does not match any part in the local catalog, and its biological role cannot be reliably inferred. " +
          "Please specify a role (promoter, rbs, cds, terminator, marker, origin, signal, operator, orit, or other)."
        );
      }
    } else if (looksLikeAttemptedDNA(raw)) {
      errors.push("Input looks like an attempted DNA sequence but contains characters other than A/C/G/T/N.");
    } else {
      const exact = findByExactName(catalog, raw);
      if (exact.length === 1) {
        anchor = exact[0]; mode = "local_part"; matchNote = `matched by exact name "${raw}"`;
      } else if (exact.length > 1) {
        errors.push(
          `"${raw}" matches ${exact.length} parts with that exact name in the catalog (ids: ${exact.map(p => p.id).join(", ")}). ` +
          "Select one by id, or paste its sequence directly."
        );
      } else {
        const byId = partsById && partsById[raw];
        if (byId) {
          anchor = byId; mode = "local_part"; matchNote = `matched by id "${raw}"`;
        } else {
          const fuzzy = findByFuzzyName(catalog, raw);
          errors.push(
            `No local part found matching "${raw}".` +
            (fuzzy.length ? ` Did you mean: ${fuzzy.map(p => `${p.name} (${p.id})`).join(", ")}?` : "")
          );
        }
      }
    }
  } else {
    errors.push("Provide either a known local part (by id) or a DNA sequence to characterize.");
  }

  if (errors.length) return { ok: false, errors, warnings };

  let role = requestedRole || anchor.type;
  if (requestedRole && anchor.type && requestedRole !== anchor.type && mode !== "novel_sequence" && mode !== "custom_part") {
    warnings.push(`Anchor part "${anchor.name}" is catalogued as type "${anchor.type}", but role "${requestedRole}" was requested explicitly -- using "${requestedRole}".`);
  }
  role = toInternalRole(role);

  return {
    ok: true,
    warnings,
    input: {
      mode,
      matchNote,
      role,
      host: String(host).trim(),
      goal: goal ? String(goal).trim() : "",
      goalFamily: goalFamily || null,
      anchorPart: anchor,
    },
  };
}
