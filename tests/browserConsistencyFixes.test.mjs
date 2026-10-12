// node --test for Phase 4C.1: browser-result consistency fixes found via
// manual UI testing (raw DNA CDS, E. coli, "Constitutive expression", Gibson)
// that automated tests up to Phase 4C did not catch. Real project data
// throughout; no literal DNA sequence is typed into this file (the "novel raw
// DNA" scenarios reuse the same held-out-real-sequence technique as
// tests/rawDnaDiscordAcceptance.test.mjs).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { runAutomaticDesign, classifyProvenance, planAssembly } from "../automatic/index.js";
import { compareCandidates, rankCandidates, computeParetoFront } from "../automatic/ranking.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const partsDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "parts.json"), "utf-8"));
const templatesDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "templates.json"), "utf-8"));
const registryCacheDoc = JSON.parse(readFileSync(path.join(ROOT, "data", "registry_cache.json"), "utf-8"));
const fullPartsById = {};
for (const p of partsDoc.parts) fullPartsById[p.id] = p;
const templates = templatesDoc.templates;

const HELD_OUT_ID = "dn_lysqdvp001_endolysin";
const heldOutPart = fullPartsById[HELD_OUT_ID];
const RAW_SEQUENCE = heldOutPart.seq; // read live from data/parts.json, never a literal here
const partsById = Object.fromEntries(Object.entries(fullPartsById).filter(([id]) => id !== HELD_OUT_ID));

// The exact browser scenario: novel raw DNA CDS, E. coli, structured goal
// "Constitutive expression", Gibson assembly, no template/backbone named.
function runBrowserScenario() {
  return runAutomaticDesign({
    text: RAW_SEQUENCE, role: "cds", host: "E. coli", goalFamily: "constitutive_expression",
    partsById, templates, registryCache: registryCacheDoc, maxCandidates: 6, assemblyMethod: "gibson",
  });
}

describe("Phase 4C.1 item 1: raw DNA is never displayed as placeholder", () => {
  test("classifyProvenance(anchor) is user_supplied/resolved, never placeholder/missing", () => {
    const result = runBrowserScenario();
    const c = classifyProvenance(result.characterized.input.anchorPart);
    assert.equal(c.provenanceStatus, "user_supplied");
    assert.equal(c.sequenceStatus, "resolved");
    assert.notEqual(c.provenanceStatus, "placeholder");
  });

  test("classifyProvenance is exported from automatic/index.js for the UI to use directly", () => {
    assert.equal(typeof classifyProvenance, "function");
  });
});

describe("Phase 4C.1 item 2: Registry part displays registry_recorded, not n/a or stale placeholder wording", () => {
  test("the recommended candidate's explanation reports provenanceStatus: registry_recorded for the Registry-recorded promoter, not n/a", () => {
    const result = runBrowserScenario();
    const partLine = result.explanation.lines.find(l => l.q && l.q.includes("Why was each part selected"));
    assert.ok(partLine, "expected a 'Why was each part selected' explanation line");
    assert.match(partLine.a, /constitutive promoter family member.*provenanceStatus: registry_recorded/);
    assert.doesNotMatch(partLine.a, /constitutive promoter family member.*provenanceStatus: n\/a/);
  });

  test("the family's own familyStatus text no longer contains stale Phase 4B 'always evidence:placeholder' wording", () => {
    const result = runBrowserScenario();
    assert.doesNotMatch(result.requirementPlan.familyStatus, /NOT project-verified, always evidence:placeholder/);
    assert.match(result.requirementPlan.familyStatus, /registry_recorded/);
  });
});

describe("Phase 4C.1 item 3: a structured goal excludes a conflicting Pathway-A template from goal-compatible competition", () => {
  test("the exact browser scenario: 'Constitutive expression' excludes 'E. coli inducible expression' from the recommendation/Pareto pool", () => {
    const result = runBrowserScenario();
    const inducibleCandidates = result.candidates.all.filter(c => c.templateLabel === "E. coli inducible expression");
    assert.ok(inducibleCandidates.length > 0, "test setup: expected Pathway A to still generate the inducible template");
    for (const c of inducibleCandidates) {
      assert.equal(c.goalCompatible, false);
      assert.equal(c.conflictingFamily, "inducible_regulated_expression");
    }
    // Still visible for comparison (not silently removed):
    const inducibleRanked = result.scoring.ranked.filter(r => r.candidate.templateLabel === "E. coli inducible expression");
    assert.equal(inducibleRanked.length, inducibleCandidates.filter(c => c.validation.valid).length);
    for (const r of inducibleRanked) assert.equal(r.eligibleForRecommendation, false);
    // The recommendation itself must be goal-compatible:
    assert.equal(result.recommended.goalCompatible, true);
    assert.notEqual(result.recommended.templateLabel, "E. coli inducible expression");
  });

  test("beam-search (Pathway B) candidates are always goalCompatible:true -- built explicitly for the selected family", () => {
    const result = runBrowserScenario();
    const beamCandidates = result.candidates.all.filter(c => c.origin === "beam_search");
    assert.ok(beamCandidates.length > 0);
    for (const c of beamCandidates) assert.equal(c.goalCompatible, true);
  });

  test("without a structured goal selected, nothing is excluded (no false positives)", () => {
    const result = runAutomaticDesign({
      partId: "sg_GFP", host: "E. coli", goal: "reporter expression", // free text that matches no family
      partsById: fullPartsById, templates, maxCandidates: 6,
    });
    for (const c of result.candidates.all) assert.equal(c.goalCompatible, true);
    for (const r of result.scoring.ranked) assert.equal(r.eligibleForRecommendation, true);
  });
});

describe("Phase 4C.1 item 4: the recommendation is never Pareto-dominated by another eligible candidate on a tie", () => {
  test("the exact browser scenario: recommended is Pareto-optimal, not 'dominated by ecoli_inducible__default'", () => {
    const result = runBrowserScenario();
    const recEntry = result.scoring.ranked.find(r => r.candidateId === result.recommended.candidateId);
    assert.equal(recEntry.paretoOptimal, true, `recommended candidate must be Pareto-nondominated; dominatedBy=${JSON.stringify(recEntry.dominatedBy)}`);
    assert.deepEqual(recEntry.dominatedBy, []);
  });

  test("rankCandidates prefers a Pareto-nondominated candidate over a dominated one when overallScore ties", () => {
    const a = { candidateId: "z_dominated", overallScore: 90, paretoOptimal: false };
    const b = { candidateId: "a_nondominated", overallScore: 90, paretoOptimal: true };
    const ranked = rankCandidates([a, b]);
    // "a_nondominated" would lose the plain candidateId tie-break (alphabetically after "z_dominated"... wait it's before) --
    // pick ids so the OLD (candidateId-only) tie-break would have picked the WRONG (dominated) one first.
    const c = { candidateId: "aaa_dominated", overallScore: 90, paretoOptimal: false };
    const d = { candidateId: "zzz_nondominated", overallScore: 90, paretoOptimal: true };
    const ranked2 = rankCandidates([c, d]);
    assert.equal(ranked2[0].candidateId, "zzz_nondominated", "Pareto-nondominated must be preferred over candidateId ordering on a tie");
    assert.equal(ranked[0].candidateId, "a_nondominated");
  });

  test("computeParetoFront + rankCandidates together reproduce the fix on real synthetic breakdowns", () => {
    const scored = [
      { candidateId: "dominated_but_alpha_first", overallScore: 80, breakdown: { functionalCompleteness: 0.8, assemblyFeasibility: 0.8 } },
      { candidateId: "nondominated_but_alpha_last", overallScore: 80, breakdown: { functionalCompleteness: 0.9, assemblyFeasibility: 0.9 } },
    ];
    const pareto = Object.fromEntries(computeParetoFront(scored, ["functionalCompleteness", "assemblyFeasibility"]).map(p => [p.candidateId, p]));
    const withPareto = scored.map(s => ({ ...s, ...pareto[s.candidateId] }));
    const ranked = rankCandidates(withPareto);
    assert.equal(ranked[0].candidateId, "nondominated_but_alpha_last");
    assert.equal(ranked[0].paretoOptimal, true);
  });
});

describe("Phase 4C.1 item 5: tie explanations never claim an identical value drove a ranking difference", () => {
  test("the exact browser scenario's comparison summary is honest about the tie", () => {
    const result = runBrowserScenario();
    assert.ok(result.comparison, "expected a #1 vs #2 comparison to be produced");
    assert.doesNotMatch(result.comparison.summary, /driven mainly by \w+ \((\d+)% vs \1%\)/, "must never cite a dimension whose two percentages are identical as the driver");
    assert.match(result.comparison.summary, /tied on displayed overall score/);
  });

  test("compareCandidates never cites a zero-delta dimension as the driver", () => {
    const winner = { candidateId: "w", overallScore: 84.7, breakdown: { functionalCompleteness: 0.86, assemblyFeasibility: 1 }, paretoOptimal: true };
    const loser = { candidateId: "l", overallScore: 84.7, breakdown: { functionalCompleteness: 0.86, assemblyFeasibility: 1 }, paretoOptimal: false };
    const { summary } = compareCandidates(winner, loser);
    assert.doesNotMatch(summary, /driven mainly by/);
    assert.match(summary, /tied on displayed overall score \(84\.7 vs 84\.7\) and on every comparable sub-score/);
    assert.match(summary, /Pareto-nondominated/);
  });

  test("compareCandidates DOES cite a real, non-zero delta when one genuinely exists", () => {
    const winner = { candidateId: "w", overallScore: 90, breakdown: { functionalCompleteness: 1, assemblyFeasibility: 1 } };
    const loser = { candidateId: "l", overallScore: 80, breakdown: { functionalCompleteness: 0.6, assemblyFeasibility: 1 } };
    const { summary } = compareCandidates(winner, loser);
    assert.match(summary, /driven mainly by functionalCompleteness \(100% vs 60%\)/);
  });
});

describe("Phase 4C.1 item 6: assembly missing-sequence message identifies the actual part", () => {
  test("the exact browser scenario: primers ARE generated for every part (the bug was stale resolution, not a genuinely missing sequence)", () => {
    const result = runBrowserScenario();
    const ap = result.recommended.assemblyPlan;
    assert.equal(ap.primerSupport, true);
    assert.equal(ap.primers.length, result.recommended.plan.order.length);
    assert.deepEqual(ap.missingSequenceParts, []);
    assert.doesNotMatch(ap.rationale.join(" "), /one or more resolved parts has no sequence on file \(gap\/placeholder\)/);
  });

  test("planAssembly identifies the exact part when a resolved id truly isn't in partsById", () => {
    const fakePlan = {
      order: [
        { role: "ori", name: "ori", id: "sg_ori", length: 589 },
        { role: "promoter", name: "mystery promoter", id: "registry:NOT_ACTUALLY_RESOLVED", length: 35 },
      ],
      totalLength: 624, gc: 50, sequence: "A".repeat(624), gaps: [], placeholders: [], siteConflicts: [],
    };
    const ap = planAssembly(fakePlan, "gibson", { partsById: { sg_ori: fullPartsById.sg_ori } });
    assert.equal(ap.missingSequenceParts.length, 1);
    assert.equal(ap.missingSequenceParts[0].name, "mystery promoter");
    assert.equal(ap.missingSequenceParts[0].id, "registry:NOT_ACTUALLY_RESOLVED");
    assert.match(ap.rationale.join(" "), /"mystery promoter"/);
    assert.match(ap.rationale.join(" "), /no catalog record found for this id/);
  });
});

describe("Phase 4C.1 item 8: existing raw-DNA Discord acceptance test still passes", () => {
  test("the full browser scenario runs end to end without error and stays hard-valid", () => {
    const result = runBrowserScenario();
    assert.equal(result.ok, true);
    assert.equal(result.recommended.validation.valid, true);
  });
});
