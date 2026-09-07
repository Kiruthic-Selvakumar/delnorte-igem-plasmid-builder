# Plasmid builder benchmark (Task 3)

This benchmarks `designer.js`'s `design()` function (which calls `fillTemplate()`,
`scanSites()`, `gibsonPrimers()`). It is a correctness/regression benchmark for a
**deterministic, rule-based system** — there is no trained model anywhere in this
repository. Treat every percentage below the way you'd treat an integration-test
pass rate, not a machine-learning accuracy figure. Nothing in this benchmark makes,
or implies, a biological claim about whether any assembled construct would work in
a real cell.

## Three layers, never mixed into one number

1. **Core real-data benchmark** (`cases.json`, `scope: "core"`) — the headline
   Exact Construct Correctness (ECC) score. Covers `ecoli_inducible` and
   `vnat_broadhost` only.
2. **B. subtilis readiness** (`cases.json`, `scope: "bsub_readiness"`) — unscored
   smoke tests. Never counted in ECC.
3. **Synthetic branch-coverage fixtures** (`synthetic_fixtures.json`) — unscored
   unit-level tests with their own hand-built, inline template + parts catalog, for
   `designer.js` branches no real (template, gene) combination in this repo can
   reach. Never counted in ECC or the readiness tally.

## Scope of the core benchmark

**The headline score covers `ecoli_inducible` and `vnat_broadhost` only.**
`bsub_secretion` (B. subtilis) is **not validated** by this benchmark, because
Task 1 (adding real B. subtilis backbone parts) is not complete: `data/templates.json`'s
`bsub_secretion` template still points at `TODO_ori1030_repA`, `TODO_aad9_SpcR`,
`TODO_ermC_ErmR`, `TODO_Pveg`, and `TODO_amyE_signal` — none of which exist in
`data/parts.json`. It's kept in the separate, unscored "B. subtilis readiness" tier
instead. **Do not read any percentage in this benchmark as a B. subtilis validation
result.**

## What counts as a benchmark case

One case = one fixed `(template_id, host, cds_input)` triple, paired with a
hand-derived expected `design()` output. Every case carries:
- `covers` — plain-language statement of exactly which `designer.js` code path this
  case is meant to exercise. Use this field to audit coverage at a glance instead of
  inferring it from case counts.
- `derivation.notes` — how the expectation was worked out from the static data files.

## Revision history (schema_version 2)

The original version of this benchmark had 16 core cases (8 per template), 6 of
which per template used a different verified CDS with no other change. Since a
verified, user-supplied CDS is spliced into the `cds` slot unchanged regardless of
which gene it is, those 6 cases exercised the *identical* `fillTemplate()` branch —
volume without added coverage. This revision keeps, per core template, exactly:

- **1 normal case** — a verified CDS, exercising the full resolved-backbone path
  (and, for `vnat_broadhost`, the trans-dependency-**success** branch).
- **1 sanity-check case** — a second, differently-sized verified CDS, purely to
  catch an arithmetic bug that happens to cancel out for one specific gene's length.
  Explicitly documented as *not* testing a new branch.
- **1 placeholder-CDS case** — the user-supplied CDS record itself is
  `evidence: "placeholder"` / `seq: null`.
- **1 no-CDS-supplied case** — the required, user-supplied `cds` slot gets no input.

8 core cases total (down from 16), with equal or better branch coverage, plus 2 new
synthetic fixtures covering branches no real data reaches at all (see below).

## Avoiding a circular benchmark

Expected values in `cases.json` were derived by manually cross-referencing
`data/templates.json`'s slot/candidate lists against the id set in `data/parts.json`
— not by executing `fillTemplate()`/`design()` and recording what the code returned.
`run_benchmark.mjs` is the only place `design()` is ever invoked, and only to produce
the *actual* side of each diff.

Synthetic fixtures (`synthetic_fixtures.json`) are hand-traced against the published
algorithm in `designer.js` using invented template/part data that never touches
`data/templates.json`/`data/parts.json` — see each fixture's `derivation` field for
the by-hand trace.

Sequence-integrity secondary checks (GC% recount, ATCG-only check, primer-count
invariant) are computed in `run_benchmark.mjs` with plain string/array operations,
not by calling designer.js's own `gc()`/`tm()` helpers.

**Out of scope for this benchmark, by design:** whether a given part is *biologically*
correct for its role. `data/parts.json`'s mere existence of a candidate says nothing
about wet-lab performance — see the "gold validation" discussion below.

## Metrics

**Primary — Exact Construct Correctness (ECC), core cases only:**
```
ECC = (# core cases where actual.buildable == expected.buildable
        AND actual.order_ids == expected.order_ids   [exact sequence]
        AND set(actual.gap_roles) == set(expected.gap_roles)
        AND set(actual.placeholder_names) == set(expected.placeholder_names))
      / (# core cases)
```

**Secondary (core cases, also broken down per `template_id`):** buildability
accuracy, part-level precision/recall, gap-detection precision/recall,
placeholder-detection precision/recall, sequence-integrity invariants (length sum,
recomputed GC% within 0.1%, ATCG-only sequence, primer count matches buildability).

**B. subtilis readiness (separate, unscored):** the same checks, run against
`milestone_expected.baseline` (today) or `milestone_expected.post_task1` (future).

**Synthetic fixtures (separate, unscored):** exact match on `buildable`, `order_ids`,
structured `gaps` (role + missing list, not just role), `placeholders`, and
`siteConflicts` (part/enzyme/position) — a stricter, full-object comparison than the
core/readiness tiers, since these are pinpoint unit tests rather than a broad sweep.

## Milestone-aware bsub_readiness cases

Each `bsub_readiness` case's expectation lives under `milestone_expected.baseline`
(what the tool reports today: 4 known backbone gaps) and `milestone_expected.post_task1`
(what it *should* report once Task 1 lands — `null` for `order_ids`/`total_length`
there, since the real part IDs Task 1 will add aren't known yet). Running
`--milestone=post_task1` today will show these as intentional failures — expected,
not a bug — until Task 1 actually lands.

## CLAUDE.md compliance review (this revision)

An earlier revision of `synthetic_fixtures.json` contained fabricated literal
nucleotide strings in a second fixture, `goldengate_site_conflict_01`, labeled
`evidence: "verified"`. That violated two CLAUDE.md hard rules at once:

> "NEVER write a literal DNA sequence into any file. Sequences come only from
> data/parts.json. If a sequence is unknown, use null and add a TODO."

> "evidence is 'verified' or 'placeholder'. Never mark something verified unless it
> has a real source."

Neither rule carves out an exception for test fixtures. The fix applied:

1. **`trans_dependency_failure_01` kept, refactored.** This fixture tests
   `fillTemplate()`'s slot/candidate/`requires`-graph logic, not sequence
   arithmetic — it never needed sequence content. Every synthetic part now uses
   `seq: null`, `evidence: "placeholder"`, and a `todo` note, exactly the pattern
   CLAUDE.md itself prescribes for unknown sequences.
2. **`goldengate_site_conflict_01` removed entirely**, rather than reworked. A
   meaningful positive-match test of `scanSites()` fundamentally requires a part
   whose sequence contains a real restriction-site substring — there is no way to
   make that observable without literal sequence content in some file, and the rule
   permits sequences only in `data/parts.json`. (A tempting workaround — referencing
   `designer.js`'s own exported `ENZYMES` constant at runtime instead of typing new
   nucleotide characters — was considered and rejected: the rule's second clause is
   a single-source constraint, "sequences come only from data/parts.json," not
   "from anywhere already in the codebase," so that workaround would still violate
   it on a technicality rather than a clean pass.)

See `synthetic_fixtures.json`'s `claude_md_compliance` field for the same summary
kept next to the data it describes.

## Synthetic branch-coverage fixtures — why the remaining one exists

**`fillTemplate()`'s trans-dependency-failure gap** (`"cognate replication protein
missing"`) cannot be reached by any (template, gene) combination currently possible
with real repository data: the only real slot with a `requires` clause that resolves
today is `vnat_broadhost`'s ori, and its cognate Rep is always present, so the
failure branch never fires. `trans_dependency_failure_01` builds a minimal
template+catalog (all parts `seq: null` / `evidence: "placeholder"`) where the
required cognate part is deliberately absent from the catalog altogether, forcing
the dependency check to fail. This is a unit test of the algorithm's graph logic,
not a claim about any real gene or plasmid, and needs no sequence content to work.

## Remaining meaningful untested branches (after this revision)

Several of these exist specifically **because** of the CLAUDE.md compliance fix
above, not because they were overlooked — a real test of any of them needs literal
sequence content in a file, which the rule forbids outside `data/parts.json`:

- `scanSites()`'s actual restriction-site pattern-matching (forward-site search,
  reverse-complement via `rc()`, the per-part `Set` dedup) — untested by this entire
  benchmark. Every real template's parts are large, real, curated sequences; testing
  a *positive* match deterministically would require either injecting a known site
  into a real part's sequence (which is not synthetic-testing, it's editing real
  biological data) or writing new literal sequence content (forbidden).
- `design()`'s enzyme-selection branches for `assembly: "goldengate"` and
  `assembly: "biobrick"` — untested for the same reason; all 3 real templates use
  `"gibson"`.
- `tm()`'s Wallace-rule branch (anneal region <14nt) in `gibsonPrimers()` — untested;
  every real part used in a buildable case is ≥20bp, and reaching this branch with a
  synthetic part would need a short literal sequence, which the fix above rules out.
- `fillTemplate()`'s `user_supplied && !userCds && !required` no-op branch — no
  template in `data/templates.json` currently declares an optional user-supplied
  slot, so this is dead code under real data today. Not sequence-related; could
  still be added as a synthetic fixture without any CLAUDE.md concern.
- `scanSites()`'s `if (!p.seq) continue` guard IS now exercised (every part in
  `trans_dependency_failure_01` is `seq: null`), but only under an empty enzyme list
  (`assembly: "gibson"`) — its effect under a non-empty enzyme list is still
  unobserved, same root cause as the scanSites items above.
- `gibsonPrimers()`'s modulo wrap-around indexing has only been exercised with ≥4
  parts (real core/readiness cases); `trans_dependency_failure_01` never reaches
  `gibsonPrimers()` at all since it's not buildable. Not sequence-related; could
  still be added later.
- Free-text gap `reason` strings are intentionally never asserted verbatim — a
  wording change wouldn't be caught. Documented tradeoff, not a bug.

**If the team wants real coverage of the scanSites/enzyme-selection/Wallace-rule
branches, that requires a explicit decision from the team on how to reconcile it
with the CLAUDE.md sequence rule** (e.g. amending the rule to allow clearly-labeled
non-biological test fixtures) — not something to route around unilaterally here.

## Gold validation (separate, future layer — not built yet)

A **gold validation benchmark** — "given template + gene, does the builder reproduce
a real, independently-known plasmid structure?" — is a distinct, harder layer from
everything above, and has **not been built**, because no legitimate ground truth for
it currently exists in this repository: no GenBank/SnapGene files, no plasmid maps,
no wet-lab construct records. The project's own gene (`dn_lysqdvp001_endolysin`) and
four B. subtilis backbone placeholders (`dn_pub110_ori`, `dn_pvsv105_ori`,
`dn_spectinomycin_resistance_spcr`, `dn_kanamycin_resistance_kanr`) carry literature
citations but all have `seq: null` — citations are not sequences. Building this layer
requires real data from the wet-lab/Task-2 team (verified sequences, a GenBank
accession, an Addgene ID, or an independently-authored design record) — see prior
conversation history for the specific asks. Do not treat the ECC score in this file
as covering that layer.

## Reporting rule across milestones — do not conflate denominators

When Task 1 changes the `bsub_secretion` template's candidates, keep these three
numbers visibly distinct:

- **(A) Baseline supported-template score** — `ecoli_inducible` + `vnat_broadhost`,
  the 8 original core cases (this run: `benchmark/results/baseline_<sha>.json`).
- **(B) Post-Task-1 score on the SAME 8 original core cases** — regression check.
- **(C) Post-Task-1 expanded score** — (B) plus newly-added `scope: "core"` cases
  for `bsub_secretion`. Larger denominator than (A)/(B); must be labeled as such.

`run_benchmark.mjs` prints and stores a self-describing `core_scope_note` on every
run (milestone, N, exact template composition) so a report always carries its own
denominator.

## Extending after Task 1

`run_benchmark.mjs` never special-cases a template ID — it only groups by the
`scope` field. To add real `bsub_secretion` coverage once Task 1 lands: hand-derive
new cases against the updated data files, add them to `cases.json` with
`"scope": "core"`, and they automatically enter the ECC denominator on the next run
(score C). No changes to `run_benchmark.mjs` are needed. Keep the 4 original
`bsub_readiness` cases permanently as regression tests (run at
`--milestone=post_task1`).

## Files

- `cases.json` — frozen real-data benchmark input (core + bsub_readiness).
- `synthetic_fixtures.json` — frozen synthetic branch-coverage fixtures, each with
  its own inline template + parts (no dependency on `data/`).
- `run_benchmark.mjs` — `node run_benchmark.mjs [--milestone=baseline|post_task1]`.
  Runs all three layers, prints per-case `covers` text and a documented list of
  remaining untested branches, writes `results/<milestone>_<git-sha>.json` and `.csv`.
  Never overwrites a prior run under a different git sha.
- `results/` — one timestamped/sha-tagged pair of files per run.

## How to state results honestly

> "On a frozen 8-case benchmark covering `ecoli_inducible` and `vnat_broadhost`,
> `designer.js`'s deterministic template-filling logic reproduced the hand-verified
> expected part list, buildability verdict, and gap/placeholder set in N/8 cases
> (X% Exact Construct Correctness). B. subtilis (`bsub_secretion`) is not included in
> this figure — 4 separate smoke tests confirm known-gap detection, pending Task 1.
> 1 additional synthetic unit fixture confirms a designer.js branch unreachable by
> any real data today (trans-dependency failure) behaves correctly; a second
> planned fixture for restriction-site-conflict detection was not built, because it
> would require literal DNA content that CLAUDE.md's sequence rule forbids outside
> data/parts.json -- documented as a known gap rather than worked around. This is a
> pass rate for rule-based logic against
> manually-derived expected outputs, comparable to an integration-test suite's pass
> rate — not a machine-learning model's predictive accuracy, since no model,
> training data, or learned parameters exist in this system. It also does not
> constitute biological or wet-lab validation of any construct."
