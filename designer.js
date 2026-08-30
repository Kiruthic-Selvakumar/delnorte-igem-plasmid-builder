// Plasmid designer: template-driven slot filling + build validation.
// No sequence is ever generated. Every base comes from parts.json.

export const ENZYMES = {
  BsaI:   "GGTCTC", BsmBI: "CGTCTC", EcoRI: "GAATTC",
  XbaI:   "TCTAGA", SpeI:  "ACTAGT", PstI:  "CTGCAG",
};

const rc = s => s.split("").reverse()
  .map(c => ({A:"T",T:"A",G:"C",C:"G",N:"N"}[c] || "N")).join("");

const gc = s => s.length ? 100 * [...s].filter(c => c === "G" || c === "C").length / s.length : 0;

// Wallace rule under 14bp, else Marmur-Doty. Good enough for Gibson anneals.
const tm = s => s.length < 14
  ? 2 * [...s].filter(c => c === "A" || c === "T").length + 4 * [...s].filter(c => c === "G" || c === "C").length
  : 64.9 + 0.41 * gc(s) - 650 / s.length;

/** Fill a template's slots from the parts catalog. Returns ordered parts + gaps. */
export function fillTemplate(template, partsById, userCds) {
  const chosen = [], gaps = [], picks = [];
  for (const slot of template.slots) {
    if (slot.user_supplied) {
      if (userCds) { const p = { ...userCds, role: slot.role }; chosen.push(p); picks.push([slot, p]); }
      else if (slot.required) gaps.push({ role: slot.role, reason: "no CDS provided" });
      continue;
    }
    const hit = slot.candidates.map(id => partsById[id]).find(Boolean);
    if (hit) { const p = { ...hit, role: slot.role }; chosen.push(p); picks.push([slot, p]); }
    else if (slot.required) {
      gaps.push({ role: slot.role, reason: "no part in catalog", missing: slot.candidates });
    }
  }

  // Some replicons only fire in trans: pBBR1 oriV needs pBBR1 Rep, RSF1010 oriV
  // needs RepA/B/C, pSC101 needs Rep101. Keyed by the part actually chosen, since
  // a sibling candidate in the same slot may carry no such requirement.
  const present = new Set(chosen.map(p => p.id));
  for (const [slot, part] of picks) {
    const needed = slot.requires && slot.requires[part.id];
    if (!needed) continue;
    const missing = needed.filter(id => !present.has(id));
    if (missing.length) {
      gaps.push({ role: slot.role, reason: "cognate replication protein missing", missing });
    }
  }

  return { parts: chosen, gaps };
}

/** Flag enzyme sites inside parts that would break the chosen assembly method. */
export function scanSites(parts, enzymeNames) {
  const problems = [];
  for (const p of parts) {
    if (!p.seq) continue;                 // placeholder part: nothing to scan
    for (const name of enzymeNames) {
      const site = ENZYMES[name];
      for (const pattern of new Set([site, rc(site)])) {
        let i = p.seq.indexOf(pattern);
        while (i !== -1) {
          problems.push({ part: p.name, enzyme: name, position: i });
          i = p.seq.indexOf(pattern, i + 1);
        }
      }
    }
  }
  return problems;
}

/** Gibson primers: 20bp anneal + 20bp tail matching the upstream neighbor. */
export function gibsonPrimers(parts, anneal = 20, overlap = 20) {
  return parts.map((p, i) => {
    const prev = parts[(i - 1 + parts.length) % parts.length];
    const next = parts[(i + 1) % parts.length];
    const fwd = prev.seq.slice(-overlap) + p.seq.slice(0, anneal);
    const rev = rc(next.seq.slice(0, overlap) + p.seq.slice(-anneal));
    return {
      part: p.name, role: p.role,
      fwd, fwd_tm: +tm(p.seq.slice(0, anneal)).toFixed(1),
      rev, rev_tm: +tm(p.seq.slice(-anneal)).toFixed(1),
    };
  });
}

/** Full design. Returns everything needed to order and build. */
export function design(template, partsById, userCds) {
  const { parts, gaps } = fillTemplate(template, partsById, userCds);
  const enzymes = template.assembly === "goldengate" ? ["BsaI", "BsmBI"]
                : template.assembly === "biobrick"   ? ["EcoRI", "XbaI", "SpeI", "PstI"]
                : [];
  const seq = parts.map(p => p.seq).join("");
  const placeholders = parts.filter(p => p.evidence !== "verified").map(p => p.name);
  return {
    buildable: gaps.length === 0 && placeholders.length === 0,
    order: parts.map(p => ({ role: p.role, name: p.name, id: p.id, length: p.length })),
    gaps,
    placeholders,
    siteConflicts: scanSites(parts, enzymes),
    // no primers without a real sequence to anneal to - matches `buildable` above
    primers: (gaps.length || placeholders.length) ? [] : gibsonPrimers(parts),
    totalLength: seq.length,
    gc: +gc(seq).toFixed(1),
    sequence: seq,
  };
}
