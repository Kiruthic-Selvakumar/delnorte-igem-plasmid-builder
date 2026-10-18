# 🧬 Del Norte iGEM — Plasmid Builder

Plasmid design and assembly tool for the **Del Norte iGEM** coral reef protection project.

## Project Context

Reef-building corals cover 1% of the ocean floor yet support 25% of all marine life. Rising water temperatures activate virulence in *Vibrio coralliilyticus*, causing coral bleaching. This project engineers *Bacillus subtilis* and *Vibrio natriegens* to express the phage-derived endolysin **Lysqdvp001**, which cleaves the MurNAc-L-Ala bond in *Vibrio* peptidoglycan — killing the pathogen without harming beneficial coral microbiota.

## Where sequences come from

Every sequence in the tool is read from `data/parts.json` — 1,391 curated feature sequences extracted from the [pLannotate v2.0.0](https://github.com/mmcguffi/pLannotate) SnapGene database bundle. **Nothing is generated.** The tool calls no AI model and no external service; at runtime it fetches only its own files under `./data/`, including a pre-fetched iGEM Registry snapshot (`registry_cache.json`, refreshed offline by `scripts/refresh_registry_cache.mjs`).

Each part carries an `evidence` field that is either `verified` (backed by a real source in `src`) or `placeholder` (a known gap, with `seq: null`). 5 of the 1,391 parts are currently placeholders. A part with no sequence is surfaced as a gap rather than filled in.

> **Note:** Curated sequences are still a starting point, not a validated construct. Confirm part identity and junctions by BLAST and wet-lab verification before ordering synthesis.

## Design modes

The builder has two modes, chosen in the UI:

- **🧭 Template-Guided** — start from one of the 4 documented architectures in `data/templates.json` (*B. subtilis* ×2, *E. coli*, *V. natriegens*; all Gibson assembly), then reorder, add, or swap parts.
- **🧮 Automatic Design** — give an anchor part and a design goal; the pipeline in `automatic/` derives the roles the plasmid needs, builds candidate architectures by bounded beam search alongside template-derived candidates, then validates, scores, and ranks them. Every candidate runs through the same evaluation, and invalid ones are never scored. Output includes a Pareto front, a ranking-robustness analysis, an assembly plan, and a written explanation of the recommendation.

Supporting features:

- **Codon optimization** — optional recoding of a CDS for the target host and its growth conditions. The objective has five terms: tRNA adaptation (CAI), environment fit, GC composition, open initiation (5′ folding), and constraints (sites, runs, repeats). Bundled usage tables for 5 organisms in `data/codon_tables.json`; you can also paste your own CDS set to build a table.
- **Plasmid map** — color-coded SVG donut map with segment labels and size/GC stats
- **Part details** — per-part sequence preview, description, and source reference
- **Sequence viewer** — full FASTA output, color-coded by part type, with one-click copy
- **Exports** — FASTA, GenBank, and a JSON design report
- **Delivery protocol** — host-specific transformation steps, selection conditions, and colony PCR verification (defined for *B. subtilis* and *V. natriegens*; the *E. coli* template has no protocol yet)

> **Known wart:** the species name is spelled both `V. natriegens` (correct) and `V. natrigens` in data and code. `HOST_ALIAS` in `index.html` papers over the mismatch; new code should not rely on either spelling matching by accident.

## Stack

- Standalone `index.html` — React 18 + Babel standalone from CDN
- No build step, no bundler, no install; deployed by GitHub Pages from the repo root
- All paths are relative, so the repo root can be served from any subdirectory

## Getting Started

Serve the repo root with any static file server (needed so `fetch("./data/parts.json")` works), e.g.:

```bash
python -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000). Opening `index.html` as a `file://` URL will not work — the data files are fetched.

To run the test suite (Node 18+, nothing to install):

```bash
npm test
```

`package.json` exists only to mark the repo as ES modules for Node and to hold that script. It declares no dependencies.

## Repo Layout

| Path | Contents |
|------|----------|
| `index.html` | The whole app — UI, styles, template-guided mode |
| `automatic/` | Automatic Design Mode pipeline (ES modules) + `AutomaticModeUI.jsx` |
| `designer.js` | Template fill, restriction-site scanning, Gibson primer design |
| `codon.js` | Codon optimization engine (no presentation logic) |
| `data/` | `parts.json`, `templates.json`, `codon_tables.json`, `registry_cache.json` |
| `tests/` | `node --test` suites (305 tests) |
| `benchmark/` | Evaluation harness and recorded results — see `benchmark/README.md` |
| `scripts/` | `refresh_registry_cache.mjs` — refreshes the iGEM Registry cache |
| `wiki_package/` | Judge-facing model, validation, and pipeline write-ups |

## Part Color Code

| Color | Part type |
|-------|-----------|
| 🟢 Green | Promoter |
| 🔵 Cyan | Operator |
| 🟡 Yellow | RBS |
| 🔵 Blue | CDS |
| 🩷 Pink | Signal sequence |
| 🔴 Red | Terminator |
| 🟣 Purple | Selection marker |
| 🟠 Orange | Origin of replication |
| 🟢 Lime | Origin of transfer (*oriT*) |
| ⚫ Slate | Other |

## Team

Del Norte iGEM · San Diego, CA
