// Minimal DNA alphabet helpers for Automatic Design Mode's input characterization.
//
// Deliberately NOT shared with index.html's PartCombo search box (asDNA/revcomp):
// that helper answers a different question ("does this look like a pasted sequence
// worth searching the catalog for", a permissive length-floored heuristic for a
// search-as-you-type box) from what characterizeInput() needs ("is this string
// valid DNA, with an explicit, explainable error if not" -- see CLAUDE.md/§2:
// "produce clear errors for unsupported or incomplete input"). Reverse-complement
// itself IS shared -- see automatic/characterizeInput.js, which imports designer.js's
// exported rc() rather than reimplementing it here.
//
// No sequence is ever generated here, and none is embedded as a literal in this
// file: every base this module ever touches came from a user paste at runtime or
// from data/parts.json, per CLAUDE.md's hard rule.

const DNA_ALPHABET = /^[ACGTN]*$/;

export function normalizeDNA(raw) {
  return String(raw || "").toUpperCase().replace(/\s+/g, "");
}

export function isValidDNA(seq) {
  return seq.length > 0 && DNA_ALPHABET.test(seq);
}

// Heuristic only, used to decide whether a bad paste deserves a "that's not valid
// DNA" error (helpful) vs. falling through to "no part found by that name" (also
// helpful, for a plain name/id query). Majority-ACGTN-letters-at-a-plausible-length
// is attempted-DNA; anything shorter or more heterogeneous is treated as text.
export function looksLikeAttemptedDNA(raw) {
  const letters = String(raw || "").replace(/[^A-Za-z]/g, "");
  if (letters.length < 15) return false;
  const dnaChars = (letters.match(/[ACGTNacgtn]/g) || []).length;
  return dnaChars / letters.length > 0.9;
}
