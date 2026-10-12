# Validation Summary

All figures below are read directly from this repository's existing `benchmark/results/*.json` files and the current automated test run — nothing here was re-generated or re-run for this document.

## A. Canonical automated tests

`node --test`: **305 / 305 passing, 0 failing** (current run, this session).

## B. Engineering Characterization / Cost (ECC) and B. subtilis readiness

`benchmark/results/baseline_bbb3749.json`: **Core ECC 8/8 (100%)**, **B. subtilis readiness 4/4 (100%)**.

ECC verifies that the software correctly implements its own documented rules (part selection, gap detection, buildability logic) against known-good/known-bad fixtures. **It is a software/rule-correctness check, not a claim of biological accuracy.**

## C. Catalog-wide part challenge

Source: `benchmark/results/catalog_part_challenge.json`

- **746 eligible CDS anchors** tested across **8 supported host/design-goal configurations** → **5,968 total runs**
- Hard-valid rate: **99.43%**
- Anchor preservation rate: **100%**
- Assembly-feasible (top-ranked candidate) rate: **99.43%**
- The remaining ~0.57% of runs fail for real, explained reasons only: 16 runs hit a genuinely placeholder/unresolved anchor sequence, 10 hit a documented host-incompatibility, 8 fall into the honest "other" catch-all (e.g. a real ambiguous-base sequence). No run threw an exception.

## D. Leave-one-out raw-DNA challenge

Source: `benchmark/results/leave_one_out_challenge.json`

A real CDS is removed from the active catalog and resupplied **only as pasted raw DNA** — simulating a gene the tool has never seen — then compared against the same gene run the normal (catalog-known) way.

- **584 paired comparisons** (93 real genes × supported host/goal configurations)
- **0 / 584 (0%) materially different outcomes** between the raw-DNA path and the catalog-known path
- **100%** of non-collision cases were correctly classified `user_supplied`
- **0 exceptions**

## E. Property-based stress test

Source: `benchmark/results/property_stress_check.json`

- **2,000 randomized trials**, fixed seed, **80 determinism re-checks**
- **0 property violations, 0 errors** across 9 invariants that must never fail (e.g. the anchor is never mutated, invalid candidates never outrank valid ones, ranking is reproducible)

## F. Universal custom-part / role-generalization challenge

Source: `benchmark/results/custom_part_role_challenge.json`

- All **10 supported biological roles** tested (promoter, RBS, terminator, signal, marker, origin, oriT, CDS, operator, other)
- **1,816 total runs**
- Registration success rate: **100%**
- Anchor preservation rate: **100%**
- Exception rate: **0%**
- Unjustified rejection rate: **0** (no hard rejections occurred at all in this sweep — every non-modeled-role case was correctly reported as "additional context required," not a rejection)

## G. Template-Guided baseline comparison

Source: `benchmark/results/template_vs_automatic.json`

Honest comparison, not a strawman: on **3 of 4 templates** (ecoli_inducible, vnat_broadhost, bsub_secretion), Template-Guided and Automatic Design **tie** on basic buildability (both 100% buildable) — Automatic does not claim superiority where none exists. On the 4th (**bsub_delnorte**), the fixed template alone is **not buildable (0%)**, while Automatic Design still produces a working design (**100% buildable**) by searching around the constraint instead of being locked to one backbone.

Where both tie on buildability, Automatic's additional value is: no backbone choice required, an average of **8.25 alternative candidates** generated per case, constraint filtering, Registry comparison (available in 100% of Automatic cases here), ranking, Pareto analysis, and robustness/explanation — none of which Template-Guided provides.

## H. Project case study

The B. subtilis / endolysin design (`benchmark/results/existing_project_cases.json`) — the project's own real Dry Lab design question — is included as a **computational design case study only**: the engine produced 7 hard-valid candidates, a Pareto-optimal, "highly stable" (100% robustness) top recommendation, with Registry comparison available. **This is a demonstration that the model reasons correctly about a case the team actually cares about — it is not experimental or wet-lab validation.**
