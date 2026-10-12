// Performance Benchmarking (Phase 4B, Step 15).
//
// Measures real wall-clock runtime and real search-effort counts (using the
// same opts.stats instrumentation hook added for the ablation analysis --
// see automatic/architectureGeneration.js's doc comment) for representative
// E. coli and B. subtilis cases. NOT a correctness check (see run_benchmark.mjs
// for that) -- this only reports how much work the constraint-based beam
// search actually does and how long it takes, on this machine, right now.
// Timings will vary run to run and machine to machine; they are reported as
// real, freshly-measured numbers, not fixed targets to hit.
//
// Usage: node benchmark/performance_benchmark.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { runAutomaticDesign } from "../automatic/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const partsDoc = JSON.parse(readFileSync(path.join(REPO_ROOT, "data", "parts.json"), "utf-8"));
const templatesDoc = JSON.parse(readFileSync(path.join(REPO_ROOT, "data", "templates.json"), "utf-8"));
const registryCacheDoc = JSON.parse(readFileSync(path.join(REPO_ROOT, "data", "registry_cache.json"), "utf-8"));
const partsById = {};
for (const p of partsDoc.parts) partsById[p.id] = p;
const templates = templatesDoc.templates;

const CASES = [
  {
    name: "E. coli / sg_GFP / inducible_regulated_expression (typical case)",
    opts: { partId: "sg_GFP", role: "cds", host: "E. coli", goalFamily: "inducible_regulated_expression", partsById, templates, registryCache: registryCacheDoc, maxCandidates: 6, beamWidth: 5, robustnessTrials: 500 },
  },
  {
    name: "B. subtilis / dn_lysqdvp001_endolysin / secretion (real Dry Lab case study, Step 13)",
    opts: { partId: "dn_lysqdvp001_endolysin", role: "cds", host: "B. subtilis", goalFamily: "secretion", partsById, templates, registryCache: registryCacheDoc, maxCandidates: 8, beamWidth: 6, candidatesPerRole: 4, robustnessTrials: 1000 },
  },
  {
    name: "B. subtilis / PkatA promoter anchor + locked endolysin cds (non-CDS-anchor / multi-locked-component case)",
    opts: {
      partId: "dn_pkata_promoter", role: "promoter", host: "B. subtilis", goalFamily: "secretion",
      additionalLockedComponents: [{ role: "cds", partId: "dn_lysqdvp001_endolysin" }],
      partsById, templates, registryCache: registryCacheDoc, maxCandidates: 6, beamWidth: 5, robustnessTrials: 500,
    },
  },
  {
    name: "V. natriegens / sg_GFP / conjugation_transfer (widest role set: ori_shuttle + orit + signal-less)",
    opts: { partId: "sg_GFP", role: "cds", host: "V. natriegens", goalFamily: "conjugation_transfer", partsById, templates, registryCache: registryCacheDoc, maxCandidates: 6, beamWidth: 5, robustnessTrials: 500 },
  },
];

function timeIt(fn) {
  const t0 = process.hrtime.bigint();
  const result = fn();
  const t1 = process.hrtime.bigint();
  return { result, ms: Number(t1 - t0) / 1e6 };
}

const report = [];
console.log("=".repeat(78));
console.log("PERFORMANCE BENCHMARK (Phase 4B, Step 15)");
console.log("=".repeat(78));
console.log("Real, freshly-measured wall-clock timings on this machine, right now --");
console.log("not fixed targets. Re-run this script to get current numbers.");
console.log();

for (const c of CASES) {
  const stats = {};
  const { result, ms: totalMs } = timeIt(() => runAutomaticDesign({ ...c.opts, stats }));
  const beamOnly = result.candidates.all.filter(x => x.origin === "beam_search");

  const entry = {
    case: c.name,
    endToEndRuntimeMs: +totalMs.toFixed(2),
    partialsConsidered: stats.partialsConsidered ?? null,
    prunedByIncompatibility: stats.prunedByIncompatibility ?? null,
    prunedByDependency: stats.prunedByDependency ?? null,
    beamSizeByStage: stats.beamSizeByStage ?? null,
    beamSearchCandidatesGenerated: beamOnly.length,
    beamSearchCandidatesValid: beamOnly.filter(x => x.validation.valid).length,
    templateCandidatesGenerated: result.candidates.all.length - beamOnly.length,
    totalCandidatesGenerated: result.candidates.all.length,
    robustnessTrials: result.scoring.robustness?.trials ?? null,
    ok: result.ok,
  };
  report.push(entry);

  console.log(`--- ${c.name} ---`);
  console.log(`  end-to-end runtime: ${entry.endToEndRuntimeMs} ms (includes template pathway, beam search, scoring, robustness x${entry.robustnessTrials} trials, assembly planning, explanation)`);
  console.log(`  beam search: ${entry.partialsConsidered} candidate-part combinations considered, ${entry.prunedByIncompatibility} pruned (incompatibility), ${entry.prunedByDependency} pruned (dependency infeasibility)`);
  console.log(`  candidates generated: ${entry.totalCandidatesGenerated} total (${entry.templateCandidatesGenerated} template-pathway, ${entry.beamSearchCandidatesGenerated} beam-search, of which ${entry.beamSearchCandidatesValid} valid)`);
  console.log();
}

mkdirSync(path.join(__dirname, "results"), { recursive: true });
const outPath = path.join(__dirname, "results", "performance_benchmark.json");
writeFileSync(outPath, JSON.stringify({ measuredAt: new Date().toISOString(), nodeVersion: process.version, cases: report }, null, 2));
console.log(`Wrote ${path.relative(REPO_ROOT, outPath)}`);
