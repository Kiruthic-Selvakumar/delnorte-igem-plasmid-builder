# 🧬 Del Norte iGEM — Plasmid Builder

AI-powered plasmid assembly tool for the **Del Norte iGEM** coral reef protection project.

## Project Context

Reef-building corals cover 1% of the ocean floor yet support 25% of all marine life. Rising water temperatures activate virulence in *Vibrio coralliilyticus*, causing coral bleaching. This project engineers *Bacillus subtilis* and *Vibrio natrigens* to express the phage-derived endolysin **Lysqdvp001**, which cleaves the MurNAc-L-Ala bond in *Vibrio* peptidoglycan — killing the pathogen without harming beneficial coral microbiota.

## Tool Features

- **Host selection** — *B. subtilis* (coral-surface colonizer) or *V. natrigens* (marine environment)
- **Part configurator** — preset parts per host with reorder/add/remove; supports any named biological part
- **AI assembly** — calls Claude claude-sonnet-4-6 to retrieve documented sequences (iGEM Registry, Addgene, NCBI) and assemble a full circular plasmid
- **Plasmid map** — color-coded SVG donut map with segment labels and GC/kb stats
- **Part details** — per-part sequence preview, description, and source reference
- **Sequence viewer** — full FASTA output, color-coded by part type, with one-click copy
- **Delivery protocol** — host-specific transformation steps, selection conditions, and colony PCR verification

## Stack

- React + Vite
- Anthropic Claude API (`claude-sonnet-4-6`)
- No other dependencies — pure React + fetch

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

The app calls the Anthropic API directly from the browser. You will need an API key set in `.env`:

```
VITE_ANTHROPIC_API_KEY=sk-ant-...
```

> **Note:** Sequences are AI-generated. Verify with BLAST and wet-lab validation before ordering synthesis.

## Part Color Code

| Color | Part type |
|-------|-----------|
| 🟢 Green | Promoter |
| 🟡 Yellow | RBS |
| 🔵 Blue | CDS |
| 🔴 Red | Terminator |
| 🟣 Purple | Selection marker |
| 🟠 Orange | Origin of replication |

## Team

Del Norte iGEM · San Diego, CA