// Phase 5A, item 5: EXISTING PROJECT CASES.
//
// Produces one machine-readable evaluation record (the same evaluateRun()
// shape used throughout Phase 5A, plus the full runAutomaticDesign() result
// for deep inspection) for each of:
//   - the real B. subtilis/endolysin case (the actual Dry Lab design question
//     this project exists to answer -- see benchmark/bsub_endolysin_case_study.mjs
//     for the full narrative report; this is the same real scenario,
//     evaluated with Phase 5A's own metrics for consistency with items 1-4)
//   - representative E. coli expression cases (inducible and constitutive)
//   - V. natriegens cases actually supported by real project data (inducible
//     and conjugation_transfer)
//
// No template/backbone is named in any input.
//
// Usage: node benchmark/existing_project_cases.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { runAutomaticDesign } from "../automatic/index.js";
import { evaluateRun } from "./lib/evaluationHelpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const partsDoc = JSON.parse(readFileSync(path.join(REPO_ROOT, "data", "parts.json"), "utf-8"));
const templatesDoc = JSON.parse(readFileSync(path.join(REPO_ROOT, "data", "templates.json"), "utf-8"));
const registryCacheDoc = JSON.parse(readFileSync(path.join(REPO_ROOT, "data", "registry_cache.json"), "utf-8"));
const partsById = {};
for (const p of partsDoc.parts) partsById[p.id] = p;
const templates = templatesDoc.templates;

const CASES = [
  { label: "B. subtilis / endolysin (real Dry Lab case)", partId: "dn_lysqdvp001_endolysin", host: "B. subtilis", goalFamily: "secretion" },
  { label: "E. coli / GFP / inducible expression", partId: "sg_GFP", host: "E. coli", goalFamily: "inducible_regulated_expression" },
  { label: "E. coli / GFP / constitutive expression", partId: "sg_GFP", host: "E. coli", goalFamily: "constitutive_expression" },
  { label: "V. natriegens / GFP / inducible expression", partId: "sg_GFP", host: "V. natriegens", goalFamily: "inducible_regulated_expression" },
  { label: "V. natriegens / GFP / conjugation transfer", partId: "sg_GFP", host: "V. natriegens", goalFamily: "conjugation_transfer" },
];

console.log("=".repeat(78));
console.log("EXISTING PROJECT CASES (Phase 5A, item 5)");
console.log("=".repeat(78));

const records = [];
for (const c of CASES) {
  const anchor = partsById[c.partId];
  const result = runAutomaticDesign({ partId: c.partId, host: c.host, goalFamily: c.goalFamily, partsById, templates, registryCache: registryCacheDoc, maxCandidates: 8, robustnessTrials: 1000 });
  const evalRec = evaluateRun(result, { anchorRole: "cds", expectedAnchorId: c.partId, expectedAnchorLength: anchor.length });
  console.log(`\n--- ${c.label} ---`);
  console.log(`  architectureGenerated: ${evalRec.architectureGenerated}, hardValidGenerated: ${evalRec.hardValidGenerated}, anchorPreserved: ${evalRec.anchorPreserved}`);
  console.log(`  validCount: ${evalRec.validCount}, invalidCount: ${evalRec.invalidCount}, goalCompatibleRecommendation: ${evalRec.goalCompatibleRecommendation}`);
  console.log(`  assemblyFeasibleTop1: ${evalRec.assemblyFeasibleTop1}, registryComparisonAvailable: ${evalRec.registryComparisonAvailable}, paretoOptimalTop1: ${evalRec.paretoOptimalTop1}`);
  console.log(`  robustness: ${evalRec.robustness ? `${(evalRec.robustness.stability * 100).toFixed(0)}% (${evalRec.robustness.label})` : "n/a"}`);
  if (evalRec.failureCategory) console.log(`  failureCategory: ${evalRec.failureCategory}`);
  records.push({ label: c.label, input: c, evaluation: evalRec, recommendedRoleOrder: result.ok && result.recommended ? result.recommended.plan.order.map(o => o.name) : null });
}

mkdirSync(path.join(__dirname, "results"), { recursive: true });
const outPath = path.join(__dirname, "results", "existing_project_cases.json");
writeFileSync(outPath, JSON.stringify({ meta: { title: "Existing Project Cases (Phase 5A, item 5)", generatedAt: new Date().toISOString() }, records }, null, 2));
console.log(`\nWrote ${path.relative(REPO_ROOT, outPath)}`);
