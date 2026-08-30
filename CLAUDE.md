# Del Norte iGEM Plasmid Builder

## Hard rules
- NEVER write a literal DNA sequence into any file. Sequences come only
  from data/parts.json. If a sequence is unknown, use null and add a TODO.
- Never reintroduce synth() or any function that generates fake DNA.
- Every part needs: id, name, type, seq, desc, src, evidence, hosts.
- evidence is "verified" or "placeholder". Never mark something verified
  unless it has a real source.

## Stack - do not change this
Standalone index.html. React 18 from CDN + Babel standalone. NO build step.
Do NOT add Vite, webpack, or any bundler. Do NOT create a src/ folder.
Deployed by GitHub Pages from the repo root.
All file paths must be relative (./data/parts.json, not /data/parts.json).
