// Benchmark runner for designer.js's design() function.
//
// Three clearly separated layers, all executed here but NEVER mixed into one
// number:
//   1. CORE   (cases.json, scope=="core")            -> Exact Construct
//      Correctness (ECC), the headline score. ecoli_inducible + vnat_broadhost only.
//   2. B. SUBTILIS READINESS (cases.json, scope=="bsub_readiness") -> unscored
//      smoke tests for the currently-known-missing B. subtilis backbone parts.
//   3. SYNTHETIC (synthetic_fixtures.json) -> unscored unit-level fixtures with
//      their OWN inline template+parts, built to reach designer.js branches
//      that no real (template, gene) combination in this repo can reach.
//      IMPORTANT: every synthetic part uses seq:null / evidence:"placeholder".
//      CLAUDE.md forbids writing literal DNA sequences into any file other
//      than data/parts.json, so fixtures that would require real sequence
//      content to be meaningful (e.g. a scanSites() restriction-site match)
//      are not implemented here -- see synthetic_fixtures.json's
//      claude_md_compliance note and remaining_untested_branches below.
//
// This script EXECUTES design()/fillTemplate() against fixed inputs and diffs
// the result against hand-derived expectations. It never derives expectations
// itself -- cases.json and synthetic_fixtures.json are frozen input, produced
// independently by reading data/templates.json + data/parts.json (or, for
// synthetic fixtures, by hand-tracing the algorithm against an invented input).
//
// Usage: node benchmark/run_benchmark.mjs [--milestone=baseline|post_task1]
//
// Scoring rule (do not special-case template IDs here): only cases.json
// entries with scope === "core" count toward ECC and the other primary/
// secondary metrics. Adding real bsub_secretion coverage later means adding
// new scope:"core" entries to cases.json -- no changes to this file needed.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { design } from "../designer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const milestone = (process.argv.find(a => a.startsWith("--milestone=")) || "--milestone=baseline")
  .split("=")[1];

const casesDoc = JSON.parse(readFileSync(path.join(__dirname, "cases.json"), "utf-8"));
const syntheticDoc = JSON.parse(readFileSync(path.join(__dirname, "synthetic_fixtures.json"), "utf-8"));
const partsDoc = JSON.parse(readFileSync(path.join(REPO_ROOT, "data", "parts.json"), "utf-8"));
const templatesDoc = JSON.parse(readFileSync(path.join(REPO_ROOT, "data", "templates.json"), "utf-8"));

const partsById = {};
for (const p of partsDoc.parts) partsById[p.id] = p;
const templatesById = {};
for (const t of templatesDoc.templates) templatesById[t.id] = t;

const idToName = id => (partsById[id] ? partsById[id].name : id);
const setEq = (a, b) => a.size === b.size && [...a].every(x => b.has(x));

// ---------------------------------------------------------------------------
// Layer 1 & 2: real-data cases (cases.json)
// ---------------------------------------------------------------------------

function runCase(c) {
  const template = templatesById[c.template_id];
  const userCds = c.cds_input.mode === "existing_part" ? partsById[c.cds_input.id] : null;

  let plan, threw = null;
  try {
    plan = design(template, partsById, userCds);
  } catch (e) {
    threw = e.message;
  }

  const isCore = c.scope === "core";
  const expected = isCore ? c.expected : c.milestone_expected[milestone];

  if (threw) {
    return { case_id: c.case_id, scope: c.scope, template_id: c.template_id, covers: c.covers, error: threw, pass: false, checks: {} };
  }

  const actualOrderIds = plan.order.map(o => o.id);
  const actualGapRoles = new Set(plan.gaps.map(g => g.role));
  const actualPlaceholderNames = new Set(plan.placeholders);

  const expectedGapRoles = new Set(isCore ? c.expected.gaps.map(g => g.role) : expected.gap_roles);
  const expectedPlaceholderNames = new Set(
    (isCore ? c.expected.placeholders : expected.placeholder_ids).map(idToName)
  );

  const buildableMatch = plan.buildable === expected.buildable;
  const gapsMatch = setEq(actualGapRoles, expectedGapRoles);
  const placeholdersMatch = setEq(actualPlaceholderNames, expectedPlaceholderNames);

  const orderCheckable = expected.order_ids !== undefined && expected.order_ids !== null;
  const orderMatch = orderCheckable
    ? actualOrderIds.length === expected.order_ids.length && actualOrderIds.every((id, i) => id === expected.order_ids[i])
    : null;

  const gcRecount = plan.sequence.length
    ? (100 * [...plan.sequence].filter(ch => ch === "G" || ch === "C").length) / plan.sequence.length
    : 0;
  const gcMatches = Math.abs(gcRecount - plan.gc) < 0.1;
  const onlyATCG = /^[ATCG]*$/.test(plan.sequence);
  const primerCountExpected = plan.buildable ? plan.order.length : 0;
  const primerCountMatches = plan.primers.length === primerCountExpected;
  const lengthMatches = expected.total_length == null ? null : plan.totalLength === expected.total_length;

  const corePass = buildableMatch && (orderCheckable ? orderMatch : true) && gapsMatch && placeholdersMatch;

  return {
    case_id: c.case_id,
    scope: c.scope,
    template_id: c.template_id,
    covers: c.covers,
    milestone,
    pass: corePass,
    checks: { buildableMatch, orderMatch, gapsMatch, placeholdersMatch, gcMatches, onlyATCG, primerCountMatches, lengthMatches },
    actual: {
      buildable: plan.buildable, order_ids: actualOrderIds, gap_roles: [...actualGapRoles],
      placeholder_names: [...actualPlaceholderNames], total_length: plan.totalLength, gc: plan.gc
    },
    expected_used: expected
  };
}

const results = casesDoc.cases.map(runCase);
const core = results.filter(r => r.scope === "core");
const readiness = results.filter(r => r.scope === "bsub_readiness");

function summarize(list) {
  const n = list.length;
  const passN = list.filter(r => r.pass).length;
  const byTemplate = {};
  for (const r of list) {
    byTemplate[r.template_id] ??= { n: 0, pass: 0 };
    byTemplate[r.template_id].n++;
    if (r.pass) byTemplate[r.template_id].pass++;
  }
  let buildableCorrect = 0, precisions = [], recalls = [], gapP = [], gapR = [], phP = [], phR = [];
  for (const r of list) {
    if (r.error) continue;
    if (r.checks.buildableMatch) buildableCorrect++;
    const expOrder = new Set(r.expected_used.order_ids || []);
    const actOrder = new Set(r.actual.order_ids);
    if (expOrder.size || actOrder.size) {
      const tp = [...actOrder].filter(x => expOrder.has(x)).length;
      precisions.push(actOrder.size ? tp / actOrder.size : 1);
      recalls.push(expOrder.size ? tp / expOrder.size : 1);
    }
    const expGaps = new Set(r.scope === "core" ? r.expected_used.gaps.map(g => g.role) : r.expected_used.gap_roles);
    const actGaps = new Set(r.actual.gap_roles);
    const tpg = [...actGaps].filter(x => expGaps.has(x)).length;
    gapP.push(actGaps.size ? tpg / actGaps.size : 1);
    gapR.push(expGaps.size ? tpg / expGaps.size : 1);
    const expPh = new Set((r.scope === "core" ? r.expected_used.placeholders : r.expected_used.placeholder_ids).map(idToName));
    const actPh = new Set(r.actual.placeholder_names);
    const tpPh = [...actPh].filter(x => expPh.has(x)).length;
    phP.push(actPh.size ? tpPh / actPh.size : 1);
    phR.push(expPh.size ? tpPh / expPh.size : 1);
  }
  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  return {
    n, pass: passN, pct: n ? +(100 * passN / n).toFixed(1) : null, byTemplate,
    secondary: {
      buildability_accuracy: n ? +(100 * buildableCorrect / n).toFixed(1) : null,
      part_precision_macro: avg(precisions), part_recall_macro: avg(recalls),
      gap_precision_macro: avg(gapP), gap_recall_macro: avg(gapR),
      placeholder_precision_macro: avg(phP), placeholder_recall_macro: avg(phR)
    }
  };
}

const coreSummary = summarize(core);
const readinessSummary = summarize(readiness);

// ---------------------------------------------------------------------------
// Layer 3: synthetic branch-coverage fixtures (synthetic_fixtures.json)
// These use their OWN inline template + parts, never data/templates.json or
// data/parts.json, and never contribute to any score above.
// ---------------------------------------------------------------------------

function runSyntheticFixture(fx) {
  const fixturePartsById = {};
  for (const p of fx.parts) fixturePartsById[p.id] = p;
  const userCds = fx.cds_input.mode === "existing_part" ? fixturePartsById[fx.cds_input.id] : null;

  let plan, threw = null;
  try {
    plan = design(fx.template, fixturePartsById, userCds);
  } catch (e) {
    threw = e.message;
  }
  if (threw) {
    return { fixture_id: fx.fixture_id, covers: fx.covers, error: threw, pass: false, checks: {} };
  }

  const actualOrderIds = plan.order.map(o => o.id);
  const orderMatch = actualOrderIds.length === fx.expected.order_ids.length &&
    actualOrderIds.every((id, i) => id === fx.expected.order_ids[i]);

  const buildableMatch = plan.buildable === fx.expected.buildable;

  const gapsMatch = plan.gaps.length === fx.expected.gaps.length &&
    fx.expected.gaps.every(eg => plan.gaps.some(ag =>
      ag.role === eg.role && JSON.stringify([...ag.missing || []].sort()) === JSON.stringify([...eg.missing || []].sort())
    ));

  const placeholdersMatch = setEq(new Set(plan.placeholders), new Set((fx.expected.placeholders || []).map(id => (fixturePartsById[id] || {}).name || id)));

  const siteConflictsMatch = plan.siteConflicts.length === fx.expected.site_conflicts.length &&
    fx.expected.site_conflicts.every(ec => plan.siteConflicts.some(ac =>
      ac.part === ec.part && ac.enzyme === ec.enzyme && ac.position === ec.position
    ));

  const lengthMatch = fx.expected.total_length == null ? null : plan.totalLength === fx.expected.total_length;

  const pass = orderMatch && buildableMatch && gapsMatch && placeholdersMatch && siteConflictsMatch && (lengthMatch !== false);

  return {
    fixture_id: fx.fixture_id,
    covers: fx.covers,
    pass,
    checks: { orderMatch, buildableMatch, gapsMatch, placeholdersMatch, siteConflictsMatch, lengthMatch },
    actual: {
      buildable: plan.buildable, order_ids: actualOrderIds, gaps: plan.gaps,
      placeholders: plan.placeholders, siteConflicts: plan.siteConflicts, total_length: plan.totalLength
    }
  };
}

const syntheticResults = syntheticDoc.fixtures.map(runSyntheticFixture);
const syntheticPass = syntheticResults.filter(r => r.pass).length;

// ---------------------------------------------------------------------------
// Known remaining gaps: designer.js branches this benchmark (real + synthetic)
// still does not exercise, as of this revision. Documented, not computed.
// ---------------------------------------------------------------------------
const REMAINING_UNTESTED_BRANCHES = [
  "CLAUDE.md-driven gap: scanSites()'s actual restriction-site pattern-matching (forward-site indexOf, reverse-complement via rc(), the per-part Set dedup) is untested by this entire benchmark. A meaningful positive-match test requires a part with a real sequence containing an enzyme recognition site, and CLAUDE.md prohibits writing literal DNA sequences into any file other than data/parts.json. A previous revision of this benchmark tested this with a synthetic sequence and was reverted for that reason -- see synthetic_fixtures.json's claude_md_compliance note.",
  "CLAUDE.md-driven gap: design()'s enzyme-selection branches for assembly:'goldengate' and assembly:'biobrick' are untested for the same reason -- all 3 real templates use 'gibson', and a meaningful goldengate/biobrick test needs the same site-matching sequence content the item above rules out.",
  "CLAUDE.md-driven gap: tm()'s Wallace-rule branch (anneal region <14nt) in gibsonPrimers() is untested -- every real part used in a buildable core/readiness/synthetic case is >=20bp, and building a shorter synthetic part to reach it would again require literal sequence content.",
  "fillTemplate(): the 'user_supplied && !userCds && !required' no-op branch -- no template in data/templates.json currently declares a user_supplied slot with required:false, so this line is dead code under real data today. Low risk (single no-op branch), and not sequence-content-related so could be added later without any CLAUDE.md concern.",
  "scanSites(): the 'if (!p.seq) continue' null-seq guard IS exercised (every synthetic part in trans_dependency_failure_01 has seq:null, and it runs under an empty enzyme list since that fixture uses assembly:'gibson'), but only with an empty enzyme list, so the guard's crash-prevention effect under a non-empty enzyme list remains unobserved -- same root cause as the two scanSites items above.",
  "gibsonPrimers(): the modulo wrap-around indexing '(i - 1 + parts.length) % parts.length' has only been exercised with >=4 parts (real core/readiness cases). trans_dependency_failure_01 never calls gibsonPrimers at all (buildable=false). The 1-part and 2-part edge cases are untested and not sequence-content-related, so could be added later without any CLAUDE.md concern.",
  "Free-text gap 'reason' strings (e.g. 'no candidate in catalog' vs 'no CDS provided' vs 'cognate replication protein missing') are intentionally never asserted verbatim by this benchmark -- a wording change would not be caught. Documented tradeoff, not a bug."
];

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const report = {
  milestone,
  generated_at: new Date().toISOString(),
  disclaimer: "designer.js contains no trained model. This is a pass-rate benchmark of deterministic, rule-based logic (fillTemplate/scanSites/gibsonPrimers/design in designer.js) against hand-derived expected outputs -- not a machine-learning accuracy metric.",
  core_scope_note: `CORE SCORE -- milestone=${milestone} -- scope=core -- N=${coreSummary.n} -- templates: ${Object.entries(coreSummary.byTemplate).map(([t, v]) => `${t}(${v.n})`).join(", ")}. B. subtilis (bsub_secretion) is NOT included in this score.`,
  core: coreSummary,
  bsub_readiness_note: `B. SUBTILIS READINESS (unscored smoke tests) -- milestone=${milestone} -- N=${readinessSummary.n}. Verifies known-gap detection only, not a validated buildable construct. Deferred pending Task 1.`,
  bsub_readiness: readinessSummary,
  synthetic_note: `SYNTHETIC BRANCH-COVERAGE FIXTURES (unscored, own inline data, never counted in any score above) -- N=${syntheticResults.length}, pass=${syntheticPass}.`,
  synthetic: { n: syntheticResults.length, pass: syntheticPass },
  remaining_untested_branches: REMAINING_UNTESTED_BRANCHES,
  results,
  synthetic_results: syntheticResults
};

mkdirSync(path.join(REPO_ROOT, "benchmark", "results"), { recursive: true });

let sha = "nogit";
try {
  const { execSync } = await import("node:child_process");
  sha = execSync("git rev-parse --short HEAD", { cwd: REPO_ROOT }).toString().trim();
} catch { /* no git available in this environment */ }

const base = `${milestone}_${sha}`;
writeFileSync(path.join(REPO_ROOT, "benchmark", "results", `${base}.json`), JSON.stringify(report, null, 2));

const csvRows = [
  ["layer", "case_id", "scope_or_fixture", "template_id", "milestone", "pass", "covers"]
];
for (const r of results) {
  csvRows.push(["real_data", r.case_id, r.scope, r.template_id, r.milestone ?? milestone, r.pass, r.covers ?? ""]);
}
for (const r of syntheticResults) {
  csvRows.push(["synthetic", r.fixture_id, "synthetic", "n/a", milestone, r.pass, r.covers ?? ""]);
}
const csv = csvRows.map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
writeFileSync(path.join(REPO_ROOT, "benchmark", "results", `${base}.csv`), csv);

console.log(report.core_scope_note);
console.log(`CORE ECC: ${coreSummary.pass}/${coreSummary.n} (${coreSummary.pct}%)`);
for (const [t, v] of Object.entries(coreSummary.byTemplate)) console.log(`  ${t}: ${v.pass}/${v.n}`);
console.log("");
console.log("Code paths covered by each core case:");
for (const r of core) console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.case_id}\n      covers: ${r.covers}`);
console.log("");
console.log(report.bsub_readiness_note);
console.log(`READINESS PASS RATE: ${readinessSummary.pass}/${readinessSummary.n} (${readinessSummary.pct}%)`);
for (const r of readiness) console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.case_id} (milestone=${milestone})`);
console.log("");
console.log(report.synthetic_note);
for (const r of syntheticResults) console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.fixture_id}\n      covers: ${r.covers}`);
console.log("");
console.log("Remaining meaningful untested branches:");
for (const b of REMAINING_UNTESTED_BRANCHES) console.log(`  - ${b}`);
console.log("");

const failed = [...core, ...readiness].filter(r => !r.pass);
const failedSynthetic = syntheticResults.filter(r => !r.pass);
if (failed.length || failedSynthetic.length) {
  console.log(`FAILED CASES (${failed.length + failedSynthetic.length}):`);
  for (const r of failed) {
    console.log(`  [${r.scope}] ${r.case_id}`);
    if (r.error) { console.log(`    threw: ${r.error}`); continue; }
    for (const [k, v] of Object.entries(r.checks)) if (v === false) console.log(`    ${k}: FAIL`);
    console.log(`    actual.buildable=${r.actual.buildable} actual.gap_roles=${JSON.stringify(r.actual.gap_roles)} actual.order_ids=${JSON.stringify(r.actual.order_ids)}`);
  }
  for (const r of failedSynthetic) {
    console.log(`  [synthetic] ${r.fixture_id}`);
    if (r.error) { console.log(`    threw: ${r.error}`); continue; }
    for (const [k, v] of Object.entries(r.checks)) if (v === false) console.log(`    ${k}: FAIL`);
    console.log(`    actual=${JSON.stringify(r.actual)}`);
  }
} else {
  console.log("No failed cases.");
}
console.log(`\nWrote benchmark/results/${base}.json and .csv`);
