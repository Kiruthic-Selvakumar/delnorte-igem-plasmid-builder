# Wiki Package

Everything here is ready to paste onto the iGEM wiki.

## Files

| File | Purpose |
|---|---|
| `judge_summary.md` | 1–2 minute read for a judge: what we built, why it's different, real test numbers, limitations. |
| `model_summary.md` | Full model description: inputs, pipeline, decision logic, ranking/robustness, external-part support, outputs. |
| `validation_summary.md` | Evidence-only summary of current test/benchmark results (from existing `benchmark/results/*.json` — nothing re-run). |
| `model_pipeline.svg` | One clean diagram of the design pipeline, safe to embed directly on the wiki. |

## Screenshot checklist (human team)

Capture these 6 screenshots from the running app (Automatic Design mode unless noted):

1. **Register Custom Part** — show the registration form with a part name, role selected, and a DNA sequence pasted in.
2. **Promoter needs CDS** — run a custom promoter with no CDS locked; show the "additional context required: CDS" panel.
3. **Recommended design** — after a successful run, show the Design Summary card together with the Recommended Candidate card.
4. **Plasmid workbench** — show the improved circular plasmid map with the user's anchor part selected (detail panel open).
5. **Candidate comparison** — open "Compare Candidates," pick two candidates, and show the differing rows highlighted.
6. **Use This Design** — click "Use This Design" on a candidate and show the resulting Map / Parts / Sequence workspace populated with it.
