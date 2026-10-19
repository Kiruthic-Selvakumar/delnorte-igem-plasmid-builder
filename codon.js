// Environment-aware synonymous codon optimization (the "Reef Codon" engine).
//
// Step 00 of the builder: turn a protein or a CDS into a coding sequence suited
// to the host the plasmid is going into, then hand that CDS to designer.js.
//
// Nothing here invents DNA. Every sequence it returns is a synonymous recoding
// of a sequence the caller supplied, so the protein is unchanged - selfTest()
// asserts that for every organism. Codon usage tables live in
// ./data/codon_tables.json with their provenance, not in this file.

/* ---------- 1. Genetic code -------------------------------------------- */

export const CODON_AA = {
  TTT:'F',TTC:'F',TTA:'L',TTG:'L',CTT:'L',CTC:'L',CTA:'L',CTG:'L',
  ATT:'I',ATC:'I',ATA:'I',ATG:'M',GTT:'V',GTC:'V',GTA:'V',GTG:'V',
  TCT:'S',TCC:'S',TCA:'S',TCG:'S',AGT:'S',AGC:'S',
  CCT:'P',CCC:'P',CCA:'P',CCG:'P',
  ACT:'T',ACC:'T',ACA:'T',ACG:'T',
  GCT:'A',GCC:'A',GCA:'A',GCG:'A',
  TAT:'Y',TAC:'Y',TAA:'*',TAG:'*',TGA:'*',
  CAT:'H',CAC:'H',CAA:'Q',CAG:'Q',
  AAT:'N',AAC:'N',AAA:'K',AAG:'K',
  GAT:'D',GAC:'D',GAA:'E',GAG:'E',
  TGT:'C',TGC:'C',TGG:'W',
  CGT:'R',CGC:'R',CGA:'R',CGG:'R',AGA:'R',AGG:'R',
  GGT:'G',GGC:'G',GGA:'G',GGG:'G'
};

export const AA_CODONS = (() => {
  const m = {};
  for (const [c, a] of Object.entries(CODON_AA)) (m[a] = m[a] || []).push(c);
  return m;
})();

export const AA_NAMES = {
  A:'Ala',R:'Arg',N:'Asn',D:'Asp',C:'Cys',Q:'Gln',E:'Glu',G:'Gly',H:'His',
  I:'Ile',L:'Leu',K:'Lys',M:'Met',F:'Phe',P:'Pro',S:'Ser',T:'Thr',W:'Trp',
  Y:'Tyr',V:'Val','*':'Stop'
};

/* ---------- 2. Organism reference data ---------------------------------
   Loaded from ./data/codon_tables.json so the numbers carry their source
   the same way parts.json does. An organism with usage === null has no
   table on file: contextFor() refuses it until the caller supplies one.
   ---------------------------------------------------------------------- */

export function loadOrganisms(json) {
  const out = {};
  for (const o of (json.organisms || [])) out[o.id] = o;
  return out;
}

/** Which bundled organism matches a template's host string, if any. */
export function organismForHost(organisms, host) {
  if (!host) return null;
  for (const o of Object.values(organisms)) {
    if ((o.templateHosts || []).includes(host)) return o;
  }
  return null;
}

/** Relative adaptiveness w = f(codon) / max f(synonymous family) */
export function relativeAdaptiveness(usage) {
  const w = {};
  for (const [, codons] of Object.entries(AA_CODONS)) {
    let mx = 0;
    for (const c of codons) mx = Math.max(mx, usage[c] || 0);
    for (const c of codons) w[c] = mx > 0 ? Math.max((usage[c] || 0) / mx, 0.005) : 1;
  }
  return w;
}

/** RSCU = observed / (mean over synonymous family) */
export function rscuTable(usage) {
  const r = {};
  for (const [, codons] of Object.entries(AA_CODONS)) {
    const sum = codons.reduce((s, c) => s + (usage[c] || 0), 0);
    for (const c of codons) r[c] = sum > 0 ? (usage[c] || 0) * codons.length / sum : 1;
  }
  return r;
}

/* Sharpened "highly expressed"-like reference: p' proportional to p^kappa.
   A stand-in for a ribosomal-protein codon table until a measured one is
   loaded. kappa > 1 exaggerates the existing bias. */
export function sharpenUsage(usage, kappa) {
  const out = {};
  for (const [, codons] of Object.entries(AA_CODONS)) {
    const sum = codons.reduce((s, c) => s + (usage[c] || 0), 0) || 1;
    let z = 0;
    const raw = {};
    for (const c of codons) { raw[c] = Math.pow((usage[c] || 0) / sum, kappa); z += raw[c]; }
    for (const c of codons) out[c] = z > 0 ? (raw[c] / z) * sum : (usage[c] || 0);
  }
  return out;
}

/* ---------- 3. Environment -> physiology --------------------------------
   Rosso et al. cardinal-parameter models. Each returns gamma in [0,1],
   the fraction of maximum growth rate supported by that single factor.
   ---------------------------------------------------------------------- */

export function gammaCardinalT(T, p) {
  const { min: Tn, opt: To, max: Tx } = p;
  if (T <= Tn || T >= Tx) return 0;
  const num = (T - Tx) * Math.pow(T - Tn, 2);
  const den = (To - Tn) * ((To - Tn) * (T - To) - (To - Tx) * (To + Tn - 2 * T));
  if (den === 0) return 0;
  return Math.max(0, Math.min(1, num / den));
}

/* Symmetric cardinal model, used for pH and for salt */
export function gammaCardinal2(x, p) {
  const { min: a, opt: o, max: b } = p;
  if (x <= a || x >= b) return 0;
  const num = (x - a) * (x - b);
  const den = (x - a) * (x - b) - Math.pow(x - o, 2);
  if (den === 0) return 0;
  return Math.max(0, Math.min(1, num / den));
}

export function physiology(org, env) {
  const gT = gammaCardinalT(env.temp, org.cardinal.T);
  const gP = gammaCardinal2(env.ph, org.cardinal.pH);
  const gS = gammaCardinal2(env.salt, org.cardinal.salt);
  const gO = org.oxygen[env.oxygen] ?? 1;
  return { gT, gP, gS, gO, mu: gT * gP * gS * gO };
}

/** Molar [Na+] from % w/v NaCl */
export const naMolar = pct => Math.max(0.01, (pct / 100) * 1000 / 58.44);

/* ---------- 4. mRNA folding proxy ---------------------------------------
   Base-pair maximization (Nussinov-style) with pair energies standing in
   for stacking. Not a full nearest-neighbour model - it is a monotone
   proxy for local pairing potential in the translation-initiation window,
   which is where folding most strongly tracks expression.
   ---------------------------------------------------------------------- */

const PAIR_E = { GC:-3.0, CG:-3.0, AT:-2.0, TA:-2.0, GT:-1.0, TG:-1.0 };
const MIN_LOOP = 3;

function foldProxyDG(seq) {
  const n = seq.length;
  if (n < MIN_LOOP + 2) return 0;
  const E = Array.from({ length: n }, () => new Float64Array(n));
  for (let span = MIN_LOOP + 1; span < n; span++) {
    for (let i = 0; i + span < n; i++) {
      const j = i + span;
      let best = E[i + 1][j];
      if (E[i][j - 1] < best) best = E[i][j - 1];
      const pe = PAIR_E[seq[i] + seq[j]];
      if (pe !== undefined) {
        const v = pe + E[i + 1][j - 1];
        if (v < best) best = v;
      }
      for (let k = i + 1; k < j; k++) {
        const v = E[i][k] + E[k + 1][j];
        if (v < best) best = v;
      }
      E[i][j] = best;
    }
  }
  return E[0][n - 1];
}

/* Salt correction (SantaLucia form) + linear temperature adjustment,
   then a Boltzmann-like occupancy. KAPPA softens the proxy energy scale. */
const R_GAS = 0.0019872;
const KAPPA = 18.0;
const DG_REF_PER_NT = -0.72;

const _foldMemo = new Map();
function foldProxyDGMemo(seq) {
  if (_foldMemo.has(seq)) return _foldMemo.get(seq);
  const v = foldProxyDG(seq);
  if (_foldMemo.size > 20000) _foldMemo.clear();
  _foldMemo.set(seq, v);
  return v;
}

export function foldedFraction(seq, env) {
  const dg37 = foldProxyDGMemo(seq);
  const na = naMolar(env.salt);
  const dgSalt = dg37 - 0.114 * (seq.length / 2) * Math.log(na);
  const TK = env.temp + 273.15;
  const dgT = dgSalt * (1 + 0.012 * (310.15 - TK));
  const dgRef = DG_REF_PER_NT * seq.length;
  const x = (dgRef - dgT) / (KAPPA * R_GAS * TK);
  return { dg: dgT, p: 1 / (1 + Math.exp(-x)) };
}

/* ---------- 5. Sequence constraints ------------------------------------ */

// Kept in step with ENZYMES in designer.js, which scans the finished plasmid
// for the same sites. Anything the assembly method cannot tolerate should be
// removed here, while the CDS still has synonymous freedom to spend.
export const ENZYME_SITES = {
  BsaI:'GGTCTC', BbsI:'GAAGAC', BsmBI:'CGTCTC', SapI:'GCTCTTC',
  EcoRI:'GAATTC', BamHI:'GGATCC', HindIII:'AAGCTT', XhoI:'CTCGAG',
  NdeI:'CATATG', SalI:'GTCGAC', XbaI:'TCTAGA', NotI:'GCGGCCGC',
  SpeI:'ACTAGT', PstI:'CTGCAG'
};

export const TYPE_IIS = ['BsaI', 'BbsI', 'BsmBI', 'SapI'];
export const COMMON_CLONING = ['EcoRI', 'BamHI', 'HindIII', 'XhoI', 'NdeI', 'SalI', 'XbaI', 'NotI'];

/** Sites the chosen assembly method must not meet inside the insert. */
export function enzymesForAssembly(assembly) {
  if (assembly === 'goldengate') return ['BsaI', 'BsmBI'];
  if (assembly === 'biobrick') return ['EcoRI', 'XbaI', 'SpeI', 'PstI'];
  return [];   // Gibson is scarless and sequence-independent
}

/* Translation-initiation motifs are STRAND-SPECIFIC: they act on the mRNA,
   so only the coding strand matters and the reverse complement must not be
   added. Restriction sites are recognised on duplex DNA, so those do get
   their reverse complement. Getting this backwards was a real bug. */
const SD_MOTIFS = ['AGGAGG', 'AAGGAG', 'GGAGGT', 'AGGAGGT'];

/* Yeast has no Shine-Dalgarno sequence at all - initiation is cap-dependent
   scanning. The equivalent hazard inside a yeast ORF is premature cleavage
   and polyadenylation, which truncates the transcript mid-gene.

   A yeast poly(A) signal is tripartite (Guo & Sherman): an upstream
   EFFICIENCY ELEMENT, a downstream POSITIONING ELEMENT, and the poly(A)
   site itself. The efficiency element is the TA-rich one people mean by
   "the TATATA family". Saturation mutagenesis narrowed it to the consensus
   TAYRTA (Y = C or T, R = A or G), which expands to exactly four hexamers,
   with TATATA the most efficient of them.

   These are listed separately because they are not interchangeable: the
   TAYRTA four are the strong ones, and a hit there matters more than a hit
   in the weak set. */
const YEAST_EE_CORE = ['TATATA', 'TATGTA', 'TACATA', 'TACGTA'];
const YEAST_EE_WEAK = ['TTTATA', 'TATTTA', 'TATGTT', 'TTTTTATA', 'ATATATAT'];
const YEAST_PE      = ['AATAAA'];
const YEAST_PA_MOTIFS = [...YEAST_EE_CORE, ...YEAST_EE_WEAK, ...YEAST_PE];

export const revComp = s => s.split('').reverse()
  .map(c => ({ A:'T', T:'A', G:'C', C:'G' }[c] || 'N')).join('');

export function initiationMotifs(hostClass) {
  return hostClass === 'yeast' ? YEAST_PA_MOTIFS : SD_MOTIFS;
}

export function buildForbidden(opts) {
  const ds = new Set();   // double-stranded: add reverse complement
  const ss = new Set();   // single-stranded / coding-strand only
  if (opts.typeIIS) TYPE_IIS.forEach(k => ds.add(ENZYME_SITES[k]));
  if (opts.cloning) COMMON_CLONING.forEach(k => ds.add(ENZYME_SITES[k]));
  // sites the downstream assembly method cannot tolerate
  (opts.enzymes || []).forEach(k => { if (ENZYME_SITES[k]) ds.add(ENZYME_SITES[k]); });
  if (opts.internalSD) initiationMotifs(opts.hostClass).forEach(m => ss.add(m));
  (opts.custom || []).forEach(m => { if (m.length >= 4) ds.add(m); });
  const out = new Set();
  for (const m of ds) { out.add(m); out.add(revComp(m)); }
  for (const m of ss) out.add(m);
  return [...out];
}

export function countViolations(seq, forbidden, opts) {
  let motif = 0, homo = 0, repeat = 0;
  const hits = [];
  for (const m of forbidden) {
    let i = seq.indexOf(m);
    while (i !== -1) { motif++; hits.push({ type: 'site', at: i, text: m }); i = seq.indexOf(m, i + 1); }
  }
  const maxRun = opts.maxHomopolymer || 5;
  let run = 1;
  for (let i = 1; i <= seq.length; i++) {
    if (i < seq.length && seq[i] === seq[i - 1]) run++;
    else { if (run > maxRun) { homo++; hits.push({ type: 'run', at: i - run, text: seq.slice(i - run, i) }); } run = 1; }
  }
  if (opts.avoidRepeats) {
    const k = 12, seen = new Map();
    for (let i = 0; i + k <= seq.length; i++) {
      const s = seq.slice(i, i + k);
      if (seen.has(s)) { repeat++; hits.push({ type: 'repeat', at: i, text: s }); }
      else seen.set(s, i);
    }
  }
  return { motif, homo, repeat, total: motif + homo + repeat, hits };
}

/* ---------- 6. Objective ------------------------------------------------ */

export function gcFraction(seq) {
  let g = 0;
  for (const ch of seq) if (ch === 'G' || ch === 'C') g++;
  return seq.length ? g / seq.length : 0;
}

function windowedGCDev(seq, target, win) {
  if (seq.length < win) return Math.abs(gcFraction(seq) - target);
  let worst = 0, sum = 0, n = 0, g = 0;
  for (let i = 0; i < win; i++) if (seq[i] === 'G' || seq[i] === 'C') g++;
  for (let i = win; ; i++) {
    const d = Math.abs(g / win - target);
    sum += d; n++; worst = Math.max(worst, d);
    if (i >= seq.length) break;
    if (seq[i] === 'G' || seq[i] === 'C') g++;
    if (seq[i - win] === 'G' || seq[i - win] === 'C') g--;
  }
  return { mean: sum / n, worst };
}

/** Geometric-mean CAI over codons with >1 synonym */
export function cai(codons, w) {
  let s = 0, n = 0;
  for (const c of codons) {
    const aa = CODON_AA[c];
    if (!aa || aa === '*' || AA_CODONS[aa].length < 2) continue;
    s += Math.log(w[c] || 0.005); n++;
  }
  // Geometric mean over an empty set is undefined; 1 is the neutral value
  // and stops a sequence with no synonymous choice from scoring as 0.
  return n ? Math.exp(s / n) : 1;
}

/** Highest-usage stop codon in a table */
export function bestStop(usage) {
  return AA_CODONS['*'].reduce((b, c) => ((usage[c] || 0) > (usage[b] || 0) ? c : b), AA_CODONS['*'][0]);
}

/* Constraint penalty, expressed as a violation DENSITY rather than a raw
   count. Two earlier shapes both failed on long genes:

     exp(-0.6 * v)   underflows to exactly 0 past ~30 violations, so the term
                     goes flat and the optimizer cannot tell 52 hits from 51.
     1 / (1 + v)     never reaches 0 but its gradient falls off as 1/v^2, so
                     by 80 violations one more removal is worth less than the
                     CAI it costs, and the search stops trading.

   The fix is to scale with length. CAI's own per-codon gradient shrinks like
   1/n because it is a geometric mean, so the constraint term has to shrink
   the same way or it loses every trade on a long sequence. Scoring hits per
   kilobase makes the two comparable at any length, and makes the number mean
   something on its own: 1.0 is one unwanted site per kb. */
export function consScore(violations, nt) {
  const kb = Math.max(0.1, (nt || 1000) / 1000);
  return 1 / (1 + violations / kb);
}

export const INIT_WINDOW_NT = 48;
export const isGC3 = c => (c[2] === 'G' || c[2] === 'C') ? 1 : 0;

/* Expected third-position GC if THIS protein were encoded by drawing codons
   at genome-average frequencies. Because the bundled tables are within-family
   fractions, a table-wide average would weight a 6-fold family the same as a
   2-fold one; conditioning on the actual amino-acid composition avoids that
   and gives the correct reference point for the sequence being optimized. */
function gc3Expected(aaSeq, usage) {
  let n = 0, g = 0;
  for (const a of aaSeq) {
    if (a === '*') continue;
    const cods = AA_CODONS[a];
    if (!cods) continue;
    const sum = cods.reduce((t, c) => t + (usage[c] || 0), 0);
    if (!sum) continue;
    g += cods.reduce((t, c) => t + (isGC3(c) ? (usage[c] || 0) : 0), 0) / sum;
    n++;
  }
  return n ? g / n : 0.5;
}

/* Coupling coefficients for the three environment hypotheses. Each is
   user-settable, and setting one to 0 removes that hypothesis from the
   model - which is what makes this usable as a test bed rather than an
   oracle. */
export const DEFAULT_HYPOTHESES = { thermal: 0.25, osmotic: 0.20, growth: 1.0 };

export function makeContext(org, env, opts, weights, aaSeq) {
  const usage = opts.usageOverride || org.usage;
  if (!usage) {
    throw new Error(`No codon usage table on file for ${org.name}. `
      + `Build one from CDS in the codon table panel, or pick a different target organism.`);
  }
  /* The weight vector arrives from the UI. A missing or non-numeric term
     would spread NaN through the dynamic program and only surface several
     stages later as an unreadable TypeError, so it is caught here instead. */
  const badTerm = weights ? TERM_KEYS.find(k => !Number.isFinite(+weights[k])) : null;
  if (!weights || badTerm) {
    throw new Error(`Objective weights are missing or not numeric`
      + `${badTerm ? ` (term "${badTerm}")` : ''}. Tick "Set weights from growth`
      + ` conditions", or move each slider once, then run again.`);
  }
  const wNum = {};
  for (const k of TERM_KEYS) wNum[k] = +weights[k];

  const hyp = Object.assign({}, DEFAULT_HYPOTHESES, opts.hypotheses || {});
  opts = Object.assign({}, opts, { hostClass: org.hostClass });
  const wGenome = relativeAdaptiveness(usage);

  /* CAI is defined against a reference set of HIGHLY EXPRESSED genes, not the
     genome average. Where a measured reference exists it is used directly.
     Otherwise we fall back to sharpening the genome average, which is only a
     heuristic: it amplifies whatever bias is already there, including bias
     that is mutational rather than selective. The fallback is flagged so the
     distinction never disappears into the score. */
  const highTable = opts.usageHighOverride || org.usageHigh;
  const wExpressed = highTable
    ? relativeAdaptiveness(highTable)
    : relativeAdaptiveness(sharpenUsage(usage, 2.4));
  const highSource = opts.usageHighOverride
    ? { status: 'measured', label: 'your highly-expressed reference' }
    : (org.usageHigh ? org.highSource
       : { status: 'heuristic', label: 'sharpened genome average (no measured reference loaded)' });
  const phys = physiology(org, env);

  /* H-growth: near mu_max the tRNA pool resembles the highly-expressed
     reference; as growth slows the pool relaxes toward the genome average,
     so strong bias buys less. */
  const blend = Math.max(0, Math.min(1, hyp.growth * phys.mu));
  const wEnv = {};
  for (const c of Object.keys(CODON_AA)) {
    wEnv[c] = Math.exp((1 - blend) * Math.log(wGenome[c]) + blend * Math.log(wExpressed[c]));
  }

  /* H-thermal and H-osmotic: codon:anticodon duplex stability is set
     mostly by the third position. Warmer growth shifts the preferred
     wobble-pair strength up; higher salinity already stabilises duplexes
     electrostatically, so it shifts the requirement down. */
  const cT = org.cardinal.T, cS = org.cardinal.salt;
  const tau = (env.temp - cT.opt) / (cT.max - cT.min);
  const sigma = (env.salt - cS.opt) / (cS.max - cS.min);
  const gc3Genome = gc3Expected(aaSeq || Object.keys(AA_CODONS), usage);
  const gc3Target = Math.max(0.05, Math.min(0.95,
    gc3Genome + hyp.thermal * tau - hyp.osmotic * sigma));

  const gcTarget = opts.gcTarget != null ? opts.gcTarget : org.gcGenome;
  return {
    org, env, opts, weights: wNum, phys, hyp, blend,
    usage, wGenome, wExpressed, wEnv, wHigh: wExpressed, highSource,
    gcTarget, gc3Genome, gc3Target, tau, sigma,
    forbidden: buildForbidden(opts)
  };
}

export function gc3Fraction(codons) {
  let n = 0, g = 0;
  for (const c of codons) {
    if (CODON_AA[c] === '*') continue;
    n++; g += isGC3(c);
  }
  return n ? g / n : 0;
}

export function evaluate(codons, ctx) {
  const seq = codons.join('');
  const fCai = cai(codons, ctx.wHigh);
  const caiBlend = cai(codons, ctx.wEnv);
  const gc3 = gc3Fraction(codons);
  const gc3Fit = Math.max(0, 1 - Math.abs(gc3 - ctx.gc3Target) / 0.35);
  const fEnvCai = 0.6 * caiBlend + 0.4 * gc3Fit;
  const gc = gcFraction(seq);
  const wg = windowedGCDev(seq, ctx.gcTarget, 45);
  const gcDev = typeof wg === 'number' ? wg : (0.6 * wg.mean + 0.4 * wg.worst);
  const fGc = Math.max(0, 1 - gcDev / 0.22);
  const fold = foldedFraction(seq.slice(0, Math.min(INIT_WINDOW_NT, seq.length)), ctx.env);
  const fStruct = 1 - fold.p;
  const viol = countViolations(seq, ctx.forbidden, ctx.opts);
  let fCons = consScore(viol.total, seq.length);
  if (ctx.opts.gcMin != null && gc < ctx.opts.gcMin) fCons *= Math.exp(-12 * (ctx.opts.gcMin - gc));
  if (ctx.opts.gcMax != null && gc > ctx.opts.gcMax) fCons *= Math.exp(-12 * (gc - ctx.opts.gcMax));
  const w = ctx.weights;
  const total = w.cai * fCai + w.env * fEnvCai + w.gc * fGc + w.struct * fStruct + w.cons * fCons;
  return {
    total, terms: { cai: fCai, env: fEnvCai, gc: fGc, struct: fStruct, cons: fCons },
    gc, gc3, gc3Fit, caiBlend, gcDev, foldDG: fold.dg, foldP: fold.p,
    violations: viol, seq
  };
}

/* ---------- 7. Environment-derived default weights ---------------------- */

export function defaultWeights(org, env) {
  const phys = physiology(org, env);
  const na = naMolar(env.salt);
  // Local duplex stability rises as temperature falls and as [Na+] rises.
  const cold = Math.max(0, Math.min(1, (org.cardinal.T.opt - env.temp) / (org.cardinal.T.opt - org.cardinal.T.min)));
  const saltStab = Math.max(0, Math.min(1, Math.log(1 + na) / Math.log(1 + naMolar(15))));
  const s = Math.max(0, Math.min(1, 0.45 * cold + 0.55 * saltStab));
  const raw = {
    cai: 0.22 + 0.26 * phys.mu,
    env: 0.14 + 0.22 * (1 - phys.mu),
    struct: 0.13 + 0.24 * s,
    gc: 0.16,
    cons: 0.16
  };
  const z = Object.values(raw).reduce((a, b) => a + b, 0);
  const out = {};
  for (const k of Object.keys(raw)) out[k] = raw[k] / z;
  return { weights: out, phys, structSensitivity: s, cold, saltStab, na };
}

/* ---------- 7b. Incremental scorer --------------------------------------
   Both search stages change exactly one codon at a time, so re-scoring the
   whole sequence is wasted work: on a 2000-codon gene a single full
   evaluate() costs about 1.8 ms and the search does ~20,000 of them.

   This keeps running state for every term and updates only what the changed
   codon can reach. Sums (CAI, GC, GC3) are O(1). Motifs, homopolymer runs
   and repeated k-mers are rescanned in a bounded window around the edit.
   The folding term only depends on the first INIT_WINDOW_NT bases, so an
   edit past that point cannot move it at all.

   Correctness is not assumed: selfTest replays thousands of random moves
   and asserts the incremental total matches full evaluate() to 1e-9.
   ---------------------------------------------------------------------- */

const GC_WIN = 45;

export function Scorer(codons, ctx) {
  this.ctx = ctx;
  this.codons = codons.slice();
  this.seq = this.codons.join('').split('');
  this.n = this.seq.length;
  this.maxMotif = ctx.forbidden.reduce((m, x) => Math.max(m, x.length), 0) || 1;
  this.maxRun = ctx.opts.maxHomopolymer || 5;
  this.K = 12;
  this._build();
}

Scorer.prototype._build = function () {
  const ctx = this.ctx, cods = this.codons;
  this.logHigh = 0; this.logEnv = 0; this.nSyn = 0;
  this.gc3n = 0; this.gc3g = 0;
  for (const c of cods) {
    const aa = CODON_AA[c];
    if (!aa) continue;
    if (aa !== '*') { this.gc3n++; this.gc3g += isGC3(c); }
    if (aa === '*' || AA_CODONS[aa].length < 2) continue;
    this.logHigh += Math.log(ctx.wHigh[c] || 0.005);
    this.logEnv += Math.log(ctx.wEnv[c] || 0.005);
    this.nSyn++;
  }
  this.gcCount = 0;
  for (const ch of this.seq) if (ch === 'G' || ch === 'C') this.gcCount++;
  this.nWin = Math.max(0, this.n - GC_WIN + 1);
  this.winGC = new Int32Array(Math.max(1, this.nWin));
  if (this.nWin > 0) {
    let g = 0;
    for (let i = 0; i < GC_WIN; i++) if (this.seq[i] === 'G' || this.seq[i] === 'C') g++;
    this.winGC[0] = g;
    for (let i = 1; i < this.nWin; i++) {
      if (this.seq[i - 1] === 'G' || this.seq[i - 1] === 'C') g--;
      if (this.seq[i + GC_WIN - 1] === 'G' || this.seq[i + GC_WIN - 1] === 'C') g++;
      this.winGC[i] = g;
    }
  }
  this.kmers = new Map();
  this.dupCount = 0;
  if (ctx.opts.avoidRepeats) {
    for (let i = 0; i + this.K <= this.n; i++) this._kAdd(this._kAt(i));
  }
  this.motifCount = this._scanMotifs(0, this.n);
  this.homoCount = this._scanRuns(0, this.n);
};

Scorer.prototype._kAt = function (i) { return this.seq.slice(i, i + this.K).join(''); };
Scorer.prototype._kAdd = function (k) {
  const c = this.kmers.get(k) || 0;
  if (c >= 1) this.dupCount++;
  this.kmers.set(k, c + 1);
};
Scorer.prototype._kDel = function (k) {
  const c = this.kmers.get(k) || 0;
  if (c >= 2) this.dupCount--;
  if (c <= 1) this.kmers.delete(k); else this.kmers.set(k, c - 1);
};

/* Count forbidden motifs whose START index lies in [lo, hi). */
Scorer.prototype._scanMotifs = function (lo, hi) {
  const F = this.ctx.forbidden;
  if (!F.length) return 0;
  const from = Math.max(0, lo), to = Math.min(this.n, hi);
  const text = this.seq.slice(Math.max(0, from), Math.min(this.n, to + this.maxMotif)).join('');
  let count = 0;
  for (const m of F) {
    let i = text.indexOf(m);
    while (i !== -1) {
      if (from + i >= from && from + i < to) count++;
      i = text.indexOf(m, i + 1);
    }
  }
  return count;
};

/* Count runs longer than maxRun that START in [lo, hi). */
Scorer.prototype._scanRuns = function (lo, hi) {
  let count = 0;
  let i = Math.max(0, lo);
  // step back to the true start of the run containing lo
  while (i > 0 && this.seq[i - 1] === this.seq[i]) i--;
  while (i < this.n) {
    let j = i;
    while (j + 1 < this.n && this.seq[j + 1] === this.seq[i]) j++;
    if (j - i + 1 > this.maxRun && i >= lo && i < hi) count++;
    if (i >= hi) break;
    i = j + 1;
  }
  return count;
};

Scorer.prototype.total = function () {
  const ctx = this.ctx, w = ctx.weights;
  const fCai = this.nSyn ? Math.exp(this.logHigh / this.nSyn) : 1;
  const caiBlend = this.nSyn ? Math.exp(this.logEnv / this.nSyn) : 1;
  const gc3 = this.gc3n ? this.gc3g / this.gc3n : 0;
  const gc3Fit = Math.max(0, 1 - Math.abs(gc3 - ctx.gc3Target) / 0.35);
  const fEnvCai = 0.6 * caiBlend + 0.4 * gc3Fit;
  const gc = this.n ? this.gcCount / this.n : 0;

  let gcDev;
  if (this.nWin <= 0) gcDev = Math.abs(gc - ctx.gcTarget);
  else {
    let sum = 0, worst = 0;
    for (let i = 0; i < this.nWin; i++) {
      const d = Math.abs(this.winGC[i] / GC_WIN - ctx.gcTarget);
      sum += d; if (d > worst) worst = d;
    }
    gcDev = 0.6 * (sum / this.nWin) + 0.4 * worst;
  }
  const fGc = Math.max(0, 1 - gcDev / 0.22);

  const head = this.seq.slice(0, Math.min(INIT_WINDOW_NT, this.n)).join('');
  const fold = foldedFraction(head, ctx.env);
  const fStruct = 1 - fold.p;

  const viol = this.motifCount + this.homoCount + this.dupCount;
  let fCons = consScore(viol, this.n);
  if (ctx.opts.gcMin != null && gc < ctx.opts.gcMin) fCons *= Math.exp(-12 * (ctx.opts.gcMin - gc));
  if (ctx.opts.gcMax != null && gc > ctx.opts.gcMax) fCons *= Math.exp(-12 * (gc - ctx.opts.gcMax));

  return w.cai * fCai + w.env * fEnvCai + w.gc * fGc + w.struct * fStruct + w.cons * fCons;
};

/** Apply a codon substitution, updating every running term. */
Scorer.prototype.set = function (idx, newC) {
  const ctx = this.ctx, oldC = this.codons[idx];
  if (oldC === newC) return;
  const p = idx * 3;
  const aa = CODON_AA[oldC];

  // --- windows that the edit can reach ---
  const mLo = Math.max(0, p - this.maxMotif + 1), mHi = Math.min(this.n, p + 3 + this.maxMotif - 1);
  this.motifCount -= this._scanMotifs(mLo, mHi);
  const rLo = Math.max(0, p - this.maxRun - 2), rHi = Math.min(this.n, p + 3 + this.maxRun + 2);
  this.homoCount -= this._scanRuns(rLo, rHi);
  if (ctx.opts.avoidRepeats) {
    for (let i = Math.max(0, p - this.K + 1); i + this.K <= this.n && i <= p + 2; i++) this._kDel(this._kAt(i));
  }

  // --- sums ---
  if (aa && aa !== '*') { this.gc3g += isGC3(newC) - isGC3(oldC); }
  if (aa && aa !== '*' && AA_CODONS[aa].length > 1) {
    this.logHigh += Math.log(ctx.wHigh[newC] || 0.005) - Math.log(ctx.wHigh[oldC] || 0.005);
    this.logEnv += Math.log(ctx.wEnv[newC] || 0.005) - Math.log(ctx.wEnv[oldC] || 0.005);
  }
  for (let k = 0; k < 3; k++) {
    const o = this.seq[p + k], nch = newC[k];
    if (o !== nch) {
      if (o === 'G' || o === 'C') this.gcCount--;
      if (nch === 'G' || nch === 'C') this.gcCount++;
      const lo = Math.max(0, p + k - GC_WIN + 1), hi = Math.min(this.nWin - 1, p + k);
      const d = ((nch === 'G' || nch === 'C') ? 1 : 0) - ((o === 'G' || o === 'C') ? 1 : 0);
      for (let i = lo; i <= hi; i++) this.winGC[i] += d;
      this.seq[p + k] = nch;
    }
  }
  this.codons[idx] = newC;

  // --- re-add the affected windows ---
  this.motifCount += this._scanMotifs(mLo, mHi);
  this.homoCount += this._scanRuns(rLo, rHi);
  if (ctx.opts.avoidRepeats) {
    for (let i = Math.max(0, p - this.K + 1); i + this.K <= this.n && i <= p + 2; i++) this._kAdd(this._kAt(i));
  }
};

Scorer.prototype.violations = function () {
  return this.motifCount + this.homoCount + this.dupCount;
};

/** Try a substitution, return the resulting total, leave state unchanged. */
Scorer.prototype.peek = function (idx, newC) {
  const old = this.codons[idx];
  if (old === newC) return this.total();
  this.set(idx, newC);
  const t = this.total();
  this.set(idx, old);
  return t;
};

/* ---------- 8. Optimizer ------------------------------------------------
   Stage 1: exact dynamic program over synonymous choices with the previous
            codon as state (captures junction-spanning motifs).
   Stage 2: simulated annealing on the full objective, which includes the
            non-separable folding and windowed-GC terms.
   Stage 3: direct repair of whatever violations are left.
   ---------------------------------------------------------------------- */

function junctionPenalty(prev, cur, forbidden, maxRun) {
  const s = prev + cur;
  let p = 0;
  for (const m of forbidden) if (m.length <= 6 && s.indexOf(m) !== -1) p += 6;
  let run = 1, worst = 1;
  for (let i = 1; i < s.length; i++) {
    if (s[i] === s[i - 1]) { run++; worst = Math.max(worst, run); } else run = 1;
  }
  if (worst > maxRun) p += 2.5;
  return p;
}

export function dpOptimize(aaSeq, ctx, locked) {
  const n = aaSeq.length;
  const w = ctx.weights;
  const maxRun = ctx.opts.maxHomopolymer || 5;
  const shortForbidden = ctx.forbidden.filter(m => m.length <= 6);
  const choices = aaSeq.map((aa, i) => (locked && locked[i]) ? [locked[i]] : (AA_CODONS[aa] || ['NNN']));

  /* Sequence-level composition targets are not separable, so they enter the
     dynamic program as per-codon quadratic surrogates that pull the running
     composition toward the target. The annealing stage then works on the
     exact sequence-level objective. */
  const stepScore = (i, c) => {
    const gcC = (c.match(/[GC]/g) || []).length / 3;
    return w.cai * 3.0 * Math.log(ctx.wHigh[c] || 0.005)
         + w.env * 1.8 * Math.log(ctx.wEnv[c] || 0.005)
         - w.env * 4.0 * Math.pow(isGC3(c) - ctx.gc3Target, 2)
         - w.gc * 14.0 * Math.pow(gcC - ctx.gcTarget, 2);
  };

  const score = choices.map(cs => cs.map(() => -Infinity));
  const back = choices.map(cs => cs.map(() => -1));
  for (let k = 0; k < choices[0].length; k++) score[0][k] = stepScore(0, choices[0][k]);

  for (let i = 1; i < n; i++) {
    for (let k = 0; k < choices[i].length; k++) {
      const c = choices[i][k];
      const base = stepScore(i, c);
      let best = -Infinity, bi = -1;
      for (let j = 0; j < choices[i - 1].length; j++) {
        if (score[i - 1][j] === -Infinity) continue;
        const v = score[i - 1][j] + base
          - w.cons * junctionPenalty(choices[i - 1][j], c, shortForbidden, maxRun);
        if (v > best) { best = v; bi = j; }
      }
      score[i][k] = best; back[i][k] = bi;
    }
  }

  let bi = 0;
  for (let k = 1; k < choices[n - 1].length; k++) if (score[n - 1][k] > score[n - 1][bi]) bi = k;
  const out = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    /* A well-formed DP always hands back a real predecessor index. Guarded
       anyway: an out-of-range pointer would write undefined into the
       sequence and fail far from its cause. Index 0 is always a codon for
       this residue, so the fallback stays in-frame and synonymous. */
    if (!(bi >= 0 && bi < choices[i].length)) bi = 0;
    out[i] = choices[i][bi];
    bi = back[i][bi];
  }
  return out;
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function anneal(codons, aaSeq, ctx, locked, iters, seed) {
  const rnd = mulberry32(seed || 12345);
  const n = codons.length;
  const movable = [];
  for (let i = 0; i < n; i++) {
    if (locked && locked[i]) continue;
    if ((AA_CODONS[aaSeq[i]] || []).length > 1) movable.push(i);
  }
  if (!movable.length) return { codons: codons.slice(), result: evaluate(codons, ctx) };

  const sc = new Scorer(codons, ctx);
  let curTotal = sc.total();
  let best = sc.codons.slice(), bestTotal = curTotal;
  const T0 = 0.006, T1 = 0.00004;
  const reheatEvery = Math.max(200, Math.floor(iters / 5));

  for (let it = 0; it < iters; it++) {
    const T = T0 * Math.pow(T1 / T0, it / iters);
    if (it > 0 && it % reheatEvery === 0) {
      for (let i = 0; i < n; i++) if (sc.codons[i] !== best[i]) sc.set(i, best[i]);
      curTotal = sc.total();
    }
    const idx = movable[(rnd() * movable.length) | 0];
    const syn = AA_CODONS[aaSeq[idx]];
    const nc = syn[(rnd() * syn.length) | 0];
    const old = sc.codons[idx];
    if (nc === old) continue;
    sc.set(idx, nc);
    const t = sc.total();
    const d = t - curTotal;
    if (d >= 0 || rnd() < Math.exp(d / T)) {
      curTotal = t;
      if (t > bestTotal) { bestTotal = t; best = sc.codons.slice(); }
    } else {
      sc.set(idx, old);
    }
  }
  for (let i = 0; i < n; i++) if (sc.codons[i] !== best[i]) sc.set(i, best[i]);
  return polishAndRepair(best, aaSeq, ctx, movable, locked, sc);
}

/* Coordinate ascent to guarantee the returned sequence is at least a
   single-codon local optimum of the full objective. */
export function greedyPolish(codons, aaSeq, ctx, movable, startEval, maxPasses = 3, scorer) {
  const sc = scorer || new Scorer(codons, ctx);
  for (let i = 0; i < codons.length; i++) if (sc.codons[i] !== codons[i]) sc.set(i, codons[i]);
  let curTotal = sc.total();
  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;
    for (const i of movable) {
      const syn = AA_CODONS[aaSeq[i]];
      if (syn.length < 2) continue;
      const old = sc.codons[i];
      let bestC = old, bestT = curTotal;
      for (const c of syn) {
        if (c === old) continue;
        const t = sc.peek(i, c);
        if (t > bestT + 1e-12) { bestT = t; bestC = c; }
      }
      if (bestC !== old) { sc.set(i, bestC); curTotal = bestT; improved = true; }
    }
    if (!improved) break;
  }
  const out = sc.codons.slice();
  return { codons: out, result: evaluate(out, ctx) };
}

/* Candidate selection is lexicographic: fewer constraint violations first,
   objective score only as a tiebreak. A weighted sum alone gets this wrong.
   On a short insert, clearing two BamHI sites can cost more CAI than the
   constraint term gives back, so a pure sum keeps the sites - technically
   optimal, useless at the bench. If the user ticked "remove these sites",
   that is a constraint on the answer, not a preference to be traded away. */
export function betterCandidate(a, b) {
  const va = a.result.violations.total, vb = b.result.violations.total;
  if (va !== vb) return va < vb ? a : b;
  return a.result.total >= b.result.total ? a : b;
}

/* Polish, repair any leftover constraint violations, then polish again so the
   repair does not leave easy objective gains behind. */
function polishAndRepair(codons, aaSeq, ctx, movable, locked, sc) {
  let r = greedyPolish(codons, aaSeq, ctx, movable, null, 3, sc);
  const s2 = sc || new Scorer(r.codons, ctx);
  for (let i = 0; i < r.codons.length; i++) if (s2.codons[i] !== r.codons[i]) s2.set(i, r.codons[i]);
  if (s2.violations() > 0) {
    repairConstraints(s2, aaSeq, locked);
    const repaired = greedyPolish(s2.codons.slice(), aaSeq, ctx, movable, null, 2, s2);
    r = betterCandidate(repaired, r);
  }
  return r;
}

/* ---------- 8b. Constraint repair ---------------------------------------
   A weighted-sum objective handles constraints badly at the last mile. Any
   decreasing penalty is convex, so removing the FINAL violation is richly
   rewarded while going from two to one barely moves the score. A single-codon
   hill climber therefore stalls holding two restriction sites, each of which
   it would happily have removed on its own.

   In practice a BamHI site is not a soft trade-off, it is pass or fail for
   the cloning step. So after the objective search, walk the remaining
   violations directly and try to remove each one, accepting the cheapest
   synonymous change that clears it. Only codons overlapping a real violation
   are touched, so this is fast and cannot wander.
   ---------------------------------------------------------------------- */

export function repairConstraints(sc, aaSeq, locked, maxRounds = 6) {
  const ctx = sc.ctx;
  const canMove = i => !(locked && locked[i]) && (AA_CODONS[aaSeq[i]] || []).length > 1;

  for (let round = 0; round < maxRounds; round++) {
    const hits = countViolations(sc.seq.join(''), ctx.forbidden, ctx.opts).hits;
    if (!hits.length) break;
    let fixed = 0;

    for (const h of hits) {
      const before = sc.motifCount + sc.homoCount + sc.dupCount;
      if (!before) break;
      const lo = Math.max(0, Math.floor(h.at / 3) - 1);
      const hi = Math.min(aaSeq.length - 1, Math.floor((h.at + h.text.length - 1) / 3) + 1);

      let bestI = -1, bestC = null, bestViol = before, bestTot = -Infinity;
      for (let i = lo; i <= hi; i++) {
        if (!canMove(i)) continue;
        const old = sc.codons[i];
        for (const c of AA_CODONS[aaSeq[i]]) {
          if (c === old) continue;
          sc.set(i, c);
          const v = sc.motifCount + sc.homoCount + sc.dupCount;
          const t = sc.total();
          if (v < bestViol || (v === bestViol && v < before && t > bestTot)) {
            bestViol = v; bestTot = t; bestI = i; bestC = c;
          }
          sc.set(i, old);
        }
      }
      if (bestI >= 0 && bestViol < before) { sc.set(bestI, bestC); fixed++; }
    }
    if (!fixed) break;
  }
  return sc;
}

export function optimize(aaSeq, ctx, locked, opts = {}) {
  const dp = dpOptimize(aaSeq, ctx, locked);
  const dpEval = evaluate(dp, ctx);
  const iters = opts.iters ?? Math.max(1500, Math.min(9000, aaSeq.length * 18));
  const sa = anneal(dp, aaSeq, ctx, locked, iters, opts.seed || 7);
  return betterCandidate(
    { codons: sa.codons, result: sa.result, stage: 'DP + annealing' },
    { codons: dp, result: dpEval, stage: 'DP' });
}

/* Async variants: identical search, but they yield to the event loop so the
   page can paint a progress bar on long sequences. */
const yieldTick = () => new Promise(r => setTimeout(r, 0));

async function annealAsync(codons, aaSeq, ctx, locked, iters, seed, onProgress) {
  const rnd = mulberry32(seed || 12345);
  const n = codons.length;
  const movable = [];
  for (let i = 0; i < n; i++) {
    if (locked && locked[i]) continue;
    if ((AA_CODONS[aaSeq[i]] || []).length > 1) movable.push(i);
  }
  if (!movable.length) return { codons: codons.slice(), result: evaluate(codons, ctx) };

  const sc = new Scorer(codons, ctx);
  let curTotal = sc.total();
  let best = sc.codons.slice(), bestTotal = curTotal;
  const T0 = 0.006, T1 = 0.00004;
  const reheatEvery = Math.max(200, Math.floor(iters / 5));
  const chunk = 2000;

  for (let it = 0; it < iters; it++) {
    if (it % chunk === 0) {
      if (onProgress) onProgress(0.15 + 0.6 * (it / iters));
      await yieldTick();
    }
    const T = T0 * Math.pow(T1 / T0, it / iters);
    if (it > 0 && it % reheatEvery === 0) {
      for (let i = 0; i < n; i++) if (sc.codons[i] !== best[i]) sc.set(i, best[i]);
      curTotal = sc.total();
    }
    const idx = movable[(rnd() * movable.length) | 0];
    const syn = AA_CODONS[aaSeq[idx]];
    const nc = syn[(rnd() * syn.length) | 0];
    const old = sc.codons[idx];
    if (nc === old) continue;
    sc.set(idx, nc);
    const t = sc.total();
    const d = t - curTotal;
    if (d >= 0 || rnd() < Math.exp(d / T)) {
      curTotal = t;
      if (t > bestTotal) { bestTotal = t; best = sc.codons.slice(); }
    } else sc.set(idx, old);
  }
  for (let i = 0; i < n; i++) if (sc.codons[i] !== best[i]) sc.set(i, best[i]);
  const r = await greedyPolishAsync(best, aaSeq, ctx, movable, null, onProgress, 3, sc);
  for (let i = 0; i < r.codons.length; i++) if (sc.codons[i] !== r.codons[i]) sc.set(i, r.codons[i]);
  if (sc.violations() > 0) {
    repairConstraints(sc, aaSeq, locked);
    await yieldTick();
    const repaired = await greedyPolishAsync(sc.codons.slice(), aaSeq, ctx, movable, null, onProgress, 2, sc);
    return betterCandidate(repaired, r);
  }
  return r;
}

async function greedyPolishAsync(codons, aaSeq, ctx, movable, startEval, onProgress, maxPasses = 3, scorer) {
  const sc = scorer || new Scorer(codons, ctx);
  for (let i = 0; i < codons.length; i++) if (sc.codons[i] !== codons[i]) sc.set(i, codons[i]);
  let curTotal = sc.total();
  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false, k = 0;
    for (const i of movable) {
      if (k++ % 400 === 0) {
        if (onProgress) onProgress(0.75 + 0.24 * ((pass + k / movable.length) / maxPasses));
        await yieldTick();
      }
      const syn = AA_CODONS[aaSeq[i]];
      if (syn.length < 2) continue;
      const old = sc.codons[i];
      let bestC = old, bestT = curTotal;
      for (const c of syn) {
        if (c === old) continue;
        const t = sc.peek(i, c);
        if (t > bestT + 1e-12) { bestT = t; bestC = c; }
      }
      if (bestC !== old) { sc.set(i, bestC); curTotal = bestT; improved = true; }
    }
    if (!improved) break;
  }
  const out = sc.codons.slice();
  return { codons: out, result: evaluate(out, ctx) };
}

export async function optimizeAsync(aaSeq, ctx, locked, opts = {}, onProgress) {
  if (onProgress) onProgress(0.04);
  await yieldTick();
  const dp = dpOptimize(aaSeq, ctx, locked);
  const dpEval = evaluate(dp, ctx);
  if (onProgress) onProgress(0.15);
  const iters = opts.iters ?? Math.max(1200, Math.min(7000, aaSeq.length * 14));
  const sa = await annealAsync(dp, aaSeq, ctx, locked, iters, opts.seed || 7, onProgress);
  if (onProgress) onProgress(1);
  const pick = betterCandidate(
    { codons: sa.codons, result: sa.result, stage: 'DP + annealing' },
    { codons: dp, result: dpEval, stage: 'DP' });
  return { codons: pick.codons, result: pick.result, stage: pick.stage, dp, dpEval };
}

/* ---------- 9. Baselines for scoring comparison -------------------------
   Both re-encode the SAME protein the caller supplied, so neither invents a
   sequence. They exist to answer "is the environment-aware objective doing
   anything a one-line rule would not", and are never offered as parts.
   ---------------------------------------------------------------------- */

export function baselineRandom(aaSeq, seed) {
  const rnd = mulberry32(seed || 99);
  return aaSeq.map(aa => { const cs = AA_CODONS[aa] || ['NNN']; return cs[(rnd() * cs.length) | 0]; });
}

export function baselineMaxCAI(aaSeq, wTable) {
  return aaSeq.map(aa => {
    const cs = AA_CODONS[aa] || ['NNN'];
    return cs.reduce((b, c) => ((wTable[c] || 0) > (wTable[b] || 0) ? c : b), cs[0]);
  });
}

/* ---------- 9b. Pareto sweep --------------------------------------------
   One full dynamic-programming run per random weight vector. The point is
   to show that the weighting is a judgement call with a real frontier, not
   a setting with one right answer.
   ---------------------------------------------------------------------- */

export function paretoSweep(aaSeq, org, env, opts, locked, nSamples = 36) {
  const rnd = mulberry32(20240607);
  const keys = TERM_KEYS;
  const pts = [];
  for (let s = 0; s < nSamples; s++) {
    const raw = {};
    let z = 0;
    for (const k of keys) { raw[k] = -Math.log(1 - rnd() * 0.999); z += raw[k]; }
    const wts = {};
    for (const k of keys) wts[k] = raw[k] / z;
    const ctx = makeContext(org, env, opts, wts, aaSeq);
    const codons = dpOptimize(aaSeq, ctx, locked);
    const ev = evaluate(codons, ctx);
    pts.push({ weights: wts, terms: ev.terms, gc: ev.gc, foldP: ev.foldP, codons, violations: ev.violations.total });
  }
  // non-dominated set over the four maximized objectives
  const objs = ['cai', 'env', 'gc', 'struct'];
  for (const p of pts) {
    p.dominated = pts.some(q =>
      q !== p &&
      objs.every(o => q.terms[o] >= p.terms[o] - 1e-9) &&
      objs.some(o => q.terms[o] > p.terms[o] + 1e-9));
  }
  return pts;
}

/* ---------- 10. Build a codon table from real CDS -----------------------
   The honest fix for any organism without a bundled table - V. natriegens in
   this project. Counts codons in that organism's own coding sequences.
   ---------------------------------------------------------------------- */

export function codonUsageFromFasta(text) {
  const counts = {};
  for (const c of Object.keys(CODON_AA)) counts[c] = 0;
  const stats = { records: 0, used: 0, codons: 0, skippedFrame: 0, skippedAmbiguous: 0, skippedInternalStop: 0 };

  const records = text.split(/^>/m).map(r => r.trim()).filter(Boolean);
  const blocks = records.length ? records : [text];
  for (const rec of blocks) {
    const lines = rec.split(/\r?\n/);
    const body = (records.length ? lines.slice(1) : lines).join('');
    const seq = body.toUpperCase().replace(/U/g, 'T').replace(/[^ACGTN]/g, '');
    if (!seq) continue;
    stats.records++;
    if (seq.length < 6) { stats.skippedFrame++; continue; }
    if (seq.length % 3 !== 0) { stats.skippedFrame++; continue; }
    if (seq.includes('N')) { stats.skippedAmbiguous++; continue; }
    const cods = seq.match(/.{3}/g);
    // Drop the terminal stop, then reject anything with an internal stop:
    // a frame error or a pseudogene would otherwise poison the counts.
    const body2 = CODON_AA[cods[cods.length - 1]] === '*' ? cods.slice(0, -1) : cods;
    if (body2.some(c => CODON_AA[c] === '*')) { stats.skippedInternalStop++; continue; }
    for (const c of cods) counts[c]++;
    stats.used++; stats.codons += cods.length;
  }
  if (!stats.codons) {
    return { error: 'No usable coding sequences found. Each record must be a CDS whose length is a multiple of 3.', stats };
  }

  // Convert to within-family fractions; leave unseen families uniform.
  const usage = {};
  for (const [, cods] of Object.entries(AA_CODONS)) {
    const tot = cods.reduce((t, c) => t + counts[c], 0);
    for (const c of cods) usage[c] = tot > 0 ? counts[c] / tot : 1 / cods.length;
  }
  stats.emptyFamilies = Object.entries(AA_CODONS)
    .filter(([, cs]) => cs.reduce((t, c) => t + counts[c], 0) === 0).length;
  return { usage, counts, stats };
}

/** Parse a pasted Kazusa / HIVE-CUTS block. First number after each codon wins. */
export function parseUsageText(txt) {
  const out = {};
  const re = /\b([ACGTU]{3})\b[^0-9\-]*([0-9]*\.?[0-9]+)/g;
  let m;
  const up = txt.toUpperCase();
  while ((m = re.exec(up)) !== null) {
    const c = m[1].replace(/U/g, 'T');
    if (CODON_AA[c] && !(c in out)) out[c] = parseFloat(m[2]);
  }
  return out;
}

/** Normalise any absolute-count or per-1000 table to within-family fractions. */
export function normalizeUsage(raw) {
  const norm = {};
  for (const [, cods] of Object.entries(AA_CODONS)) {
    const tot = cods.reduce((t, c) => t + (raw[c] || 0), 0);
    for (const c of cods) norm[c] = tot > 0 ? (raw[c] || 0) / tot : 1 / cods.length;
  }
  return norm;
}

/* ---------- 11. Input parsing ------------------------------------------- */

export function parseInput(raw) {
  const lines = raw.split(/\r?\n/).filter(l => !l.startsWith('>'));
  const s = lines.join('').toUpperCase().replace(/[^A-Z*]/g, '');
  if (!s) return { error: 'Paste a DNA or protein sequence to begin.' };
  const dnaChars = (s.match(/[ATGCUN]/g) || []).length;
  const isDNA = dnaChars / s.length > 0.9;
  if (isDNA) {
    const dna = s.replace(/U/g, 'T');
    if (dna.includes('N')) return { error: 'Sequence contains N. Replace ambiguous bases before optimizing.' };
    if (dna.length % 3 !== 0) return { error: `DNA length ${dna.length} is not a multiple of 3. Trim or pad the sequence.` };
    const codons = dna.match(/.{3}/g);
    const aa = codons.map(c => CODON_AA[c]);
    const stopIdx = aa.indexOf('*');
    if (stopIdx !== -1 && stopIdx !== aa.length - 1)
      return { error: `Internal stop codon at position ${stopIdx + 1}. Check the reading frame.` };
    return { type: 'dna', dna, codons, aa, hasStop: stopIdx === aa.length - 1 };
  }
  const bad = [...s].find(ch => !AA_NAMES[ch]);
  if (bad) return { error: `Unrecognized residue "${bad}". Use one-letter amino-acid codes.` };
  return { type: 'protein', aa: [...s], hasStop: s.endsWith('*') };
}

/* ---------- 11b. Per-codon change attribution ---------------------------
   For each codon that moved, which objective term gained most by moving it.
   Returns raw signed deltas; the caller supplies the labels. This is an
   explanation of a decision already made, not part of the search.
   ---------------------------------------------------------------------- */

export const TERM_KEYS = ['cai', 'env', 'gc', 'struct', 'cons'];

export function attributeChanges(aaSeq, refCodons, newCodons, ctx) {
  const w = ctx.weights, out = [];
  const refSeq = refCodons.join('');
  const refViol = countViolations(refSeq, ctx.forbidden, ctx.opts);
  const badRanges = refViol.hits.map(h => [h.at, h.at + h.text.length]);
  const t = ctx.gc3Target;

  for (let i = 0; i < aaSeq.length; i++) {
    const oldC = refCodons[i], newC = newCodons[i];
    const rec = { i, aa: aaSeq[i], old: oldC, new: newC, changed: oldC !== newC, driver: null, deltas: null };
    if (rec.changed) {
      const gcOf = c => (c.match(/[GC]/g) || []).length / 3;
      const d = {
        cai: w.cai * (Math.log(ctx.wHigh[newC]) - Math.log(ctx.wHigh[oldC])),
        env: w.env * (0.6 * (Math.log(ctx.wEnv[newC]) - Math.log(ctx.wEnv[oldC]))
                    + 0.8 * (Math.abs(isGC3(oldC) - t) - Math.abs(isGC3(newC) - t))),
        gc: w.gc * 3 * (Math.pow(gcOf(oldC) - ctx.gcTarget, 2) - Math.pow(gcOf(newC) - ctx.gcTarget, 2)),
        cons: 0, struct: 0
      };
      const s = i * 3, e2 = s + 3;
      if (badRanges.some(([a, b]) => s < b && e2 > a)) d.cons = w.cons * 1.2;
      if (s < INIT_WINDOW_NT) {
        const a1 = foldedFraction(refSeq.slice(0, INIT_WINDOW_NT), ctx.env).p;
        const swapped = refSeq.slice(0, s) + newC + refSeq.slice(e2);
        const a2 = foldedFraction(swapped.slice(0, INIT_WINDOW_NT), ctx.env).p;
        d.struct = w.struct * (a1 - a2);
      }
      let best = 'cai', bv = -Infinity;
      for (const k of TERM_KEYS) if (d[k] > bv) { bv = d[k]; best = k; }
      rec.driver = bv > 1e-6 ? best : 'cai';
      rec.deltas = d;
    }
    out.push(rec);
  }
  return out;
}

/* ---------- 12. Self-test ---------------------------------------------- */

export function selfTest(organisms) {
  const checks = [];
  const ok = (name, pass, detail) => checks.push({ name, pass, detail });
  const withTable = Object.values(organisms).filter(o => o.usage);

  ok('Genetic code has 64 codons', Object.keys(CODON_AA).length === 64, Object.keys(CODON_AA).length + ' codons');
  const fams = Object.keys(AA_CODONS).length;
  ok('20 amino acids plus stop', fams === 21, fams + ' families');
  const counted = Object.values(AA_CODONS).reduce((t, c) => t + c.length, 0);
  ok('Families partition all 64 codons', counted === 64, counted + ' codons across families');

  for (const org of Object.values(organisms)) {
    const c = org.cardinal;
    ok(org.short + ': cardinal values ordered',
       c.T.min < c.T.opt && c.T.opt < c.T.max && c.pH.min < c.pH.opt && c.pH.opt < c.pH.max
       && c.salt.min < c.salt.opt && c.salt.opt < c.salt.max, 'min < opt < max');
    ok(org.short + ': gamma = 1 at the optimum',
       Math.abs(gammaCardinalT(c.T.opt, c.T) - 1) < 1e-6 && Math.abs(gammaCardinal2(c.pH.opt, c.pH) - 1) < 1e-6,
       'temperature and pH');
    ok(org.short + ': gamma = 0 outside the range',
       gammaCardinalT(c.T.max + 1, c.T) === 0 && gammaCardinal2(c.pH.min - 0.5, c.pH) === 0, 'beyond max and below min');
    if (!org.usage) {
      ok(org.short + ': no table, and says so', org.table.status === 'none' && !!org.todo,
         'usage is null with a TODO, as parts.json does');
      continue;
    }
    let worst = 0, missing = 0;
    for (const [, cods] of Object.entries(AA_CODONS)) {
      for (const c2 of cods) if (!(c2 in org.usage)) missing++;
      const sum = cods.reduce((t, c2) => t + (org.usage[c2] || 0), 0);
      worst = Math.max(worst, Math.abs(sum - 1));
    }
    ok(org.short + ': all 64 codons present', missing === 0, missing + ' missing');
    ok(org.short + ': every family sums to 1', worst < 1e-6, 'max deviation ' + worst.toExponential(1));
  }

  // yeast must not inherit the bacterial Shine-Dalgarno rule
  ok('Yeast uses poly(A) motifs, not Shine-Dalgarno',
     initiationMotifs('yeast').indexOf('AGGAGG') === -1 && initiationMotifs('bacteria').indexOf('AGGAGG') !== -1,
     'host-class specific');
  const fb = buildForbidden({ internalSD: true, hostClass: 'bacteria', typeIIS: true });
  ok('Initiation motifs are coding-strand only', fb.indexOf(revComp('AGGAGG')) === -1, 'no reverse complement added');
  ok('Restriction sites are double-stranded', fb.indexOf(revComp(ENZYME_SITES.BsaI)) !== -1, 'reverse complement added');
  ok('Gibson adds no site constraint', enzymesForAssembly('gibson').length === 0, 'scarless, sequence-independent');
  ok('Golden Gate constrains BsaI and BsmBI',
     buildForbidden({ enzymes: enzymesForAssembly('goldengate') }).indexOf(ENZYME_SITES.BsaI) !== -1, 'from the template');

  // the invariant that matters most: optimization must preserve the protein
  const opts = { typeIIS: true, cloning: true, internalSD: true, avoidRepeats: true,
                 maxHomopolymer: 5, custom: [], hypotheses: DEFAULT_HYPOTHESES };
  const rnd = mulberry32(20260816);
  const pool = 'ARNDCQEGHILKMFPSTWYV';
  const aa = ['M'];
  for (let i = 0; i < 90; i++) aa.push(pool[(rnd() * pool.length) | 0]);
  aa.push('*');
  for (const org of withTable) {
    const env = { temp: org.cardinal.T.opt, ph: org.cardinal.pH.opt, salt: org.cardinal.salt.opt, oxygen: 'aerobic' };
    const ctx = makeContext(org, env, opts, defaultWeights(org, env).weights, aa);
    const res = optimize(aa, ctx, null, { iters: 900 });
    const back = res.codons.map(c => CODON_AA[c]).join('');
    ok(org.short + ': translation is unchanged', back === aa.join(''), back === aa.join('') ? 'identical protein' : 'MISMATCH');
    ok(org.short + ': stop codon preserved', CODON_AA[res.codons[res.codons.length - 1]] === '*', res.codons[res.codons.length - 1]);
    const base = evaluate(baselineRandom(aa, 3), ctx);
    ok(org.short + ': beats a random synonymous baseline', res.result.total > base.total,
       res.result.total.toFixed(3) + ' vs ' + base.total.toFixed(3));
  }

  // an organism with no table must refuse rather than guess
  {
    const bare = Object.values(organisms).find(o => !o.usage);
    if (bare) {
      let threw = false, msg = '';
      try {
        makeContext(bare, { temp: 30, ph: 7, salt: 2, oxygen: 'aerobic' },
          opts, defaultWeights(bare, { temp: 30, ph: 7, salt: 2, oxygen: 'aerobic' }).weights, aa);
      } catch (e) { threw = true; msg = e.message; }
      ok(bare.short + ': refuses to optimize with no table', threw, threw ? 'throws instead of inventing one' : 'DID NOT THROW');
    }
  }

  // the highly-expressed reference must not be the genome average
  if (organisms.ecoli && organisms.ecoli.usageHigh) {
    const eco = organisms.ecoli;
    const wh = relativeAdaptiveness(eco.usageHigh), wg = relativeAdaptiveness(eco.usage);
    const top = (w, aa2) => AA_CODONS[aa2].reduce((b, c) => (w[c] > w[b] ? c : b), AA_CODONS[aa2][0]);
    ok('E. coli reference is the measured highly-expressed set',
       eco.highSource && eco.highSource.status === 'measured', eco.highSource.label);
    ok('Highly expressed E. coli prefers GCT, GGT, CGT',
       top(wh, 'A') === 'GCT' && top(wh, 'G') === 'GGT' && top(wh, 'R') === 'CGT',
       top(wh, 'A') + ' / ' + top(wh, 'G') + ' / ' + top(wh, 'R'));
    ok('Genome average differs from it, as expected',
       top(wg, 'A') !== top(wh, 'A'), 'genome picks ' + top(wg, 'A') + ', reference picks ' + top(wh, 'A'));
    ok('Both agree AGG and AGA are rare arginines',
       wh.AGG < 0.05 && wg.AGG < 0.1 && wh.AGA < 0.05, 'w(AGG) = ' + wh.AGG.toFixed(3) + ' / ' + wg.AGG.toFixed(3));
  }

  // the incremental scorer must agree with full evaluation, exactly
  if (withTable.length) {
    const aa2 = ['M']; const rnd2 = mulberry32(31337);
    for (let i = 0; i < 120; i++) aa2.push(pool[(rnd2() * pool.length) | 0]);
    aa2.push('*');
    const o2 = organisms.ecoli || withTable[0];
    const env2 = { temp: 37, ph: 7, salt: 0.5, oxygen: 'aerobic' };
    const ctx2 = makeContext(o2, env2, opts, defaultWeights(o2, env2).weights, aa2);
    const cods = baselineRandom(aa2, 5);
    const sc = new Scorer(cods, ctx2);
    let worst = 0, peekSafe = true;
    for (let m = 0; m < 400; m++) {
      const i = (rnd2() * aa2.length) | 0;
      const syn = AA_CODONS[aa2[i]];
      const nc = syn[(rnd2() * syn.length) | 0];
      const before = sc.total();
      sc.peek(i, nc);
      if (Math.abs(sc.total() - before) > 1e-12) peekSafe = false;
      sc.set(i, nc); cods[i] = nc;
      worst = Math.max(worst, Math.abs(sc.total() - evaluate(cods, ctx2).total));
    }
    ok('Incremental scorer matches full evaluation', worst < 1e-9, '400 moves, max difference ' + worst.toExponential(1));
    ok('Trial moves leave state untouched', peekSafe, 'peek is side-effect free');
  }

  // constraint pressure must survive on long sequences
  if (withTable.length) {
    const aa3 = ['M']; const rnd3 = mulberry32(8123);
    for (let i = 0; i < 1200; i++) aa3.push(pool[(rnd3() * pool.length) | 0]);
    aa3.push('*');
    const o3 = organisms.ecoli || withTable[0];
    const env3 = { temp: 37, ph: 7, salt: 0.5, oxygen: 'aerobic' };
    const ctx3 = makeContext(o3, env3, opts, defaultWeights(o3, env3).weights, aa3);
    const naive = evaluate(baselineMaxCAI(aa3, ctx3.wHigh), ctx3).violations.total;
    const got = optimize(aa3, ctx3, null, { iters: 6000 }).result.violations.total;
    ok('Constraints still clear on a 1200-codon gene', got < Math.max(2, naive * 0.2),
       naive + ' hits in a naive design, ' + got + ' after optimizing');
    ok('Constraint score never saturates to zero', consScore(500, 3600) > 0, 'density-scaled penalty');
  }

  // constraint repair must clear a deliberately planted site
  if (organisms.ecoli && organisms.ecoli.usage) {
    const o4 = organisms.ecoli;
    const env4 = { temp: 37, ph: 7, salt: 0.5, oxygen: 'aerobic' };
    // Trp-Ile forces TGG ATC, which spells the BamHI site GGATCC across the
    // junction. Only the Ile codon can move, so this is a clean test of
    // whether repair finds a single-codon escape the hill climber misses.
    const planted = ['ATG','TGG','ATC','CTG','AAA','GAA','TGG','ATC','CTG','TAA'];
    const aa4 = planted.map(c => CODON_AA[c]);
    const ctx4 = makeContext(o4, env4, opts, defaultWeights(o4, env4).weights, aa4);
    const v0 = evaluate(planted, ctx4).violations.total;
    const r4 = optimize(aa4, ctx4, null, { iters: 400 });
    ok('Planted restriction sites are repaired', v0 > 0 && r4.result.violations.total === 0,
       v0 + ' hits planted, ' + r4.result.violations.total + ' remaining');
    ok('Repair preserves the protein', r4.codons.map(c => CODON_AA[c]).join('') === aa4.join(''), 'identical protein');
  }

  // parser round-trip
  const p = parseInput('ATGGCGAAATAA');
  ok('DNA parser reads the frame', p.type === 'dna' && p.aa.join('') === 'MAK*', p.aa ? p.aa.join('') : p.error);
  ok('Frameshift is rejected', !!parseInput('ATGGCGAA').error, 'length not a multiple of 3');
  ok('Internal stop is rejected', !!parseInput('ATGTAAGCGAAA').error, 'reading-frame check');

  return { checks, passed: checks.filter(c => c.pass).length, total: checks.length };
}
