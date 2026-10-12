# Constraint-Based Plasmid Design Model

## Problem

Template-guided tools assume the user already knows what architecture/backbone they want. Our model asks a different question:

> "Given a biological part, chassis, and design objective, what supported plasmid architecture should be built around it?"

## Inputs

- a project catalog part **or** an arbitrary custom external part (registered in-session, never written to the parts database)
- the part's biological role (promoter, RBS, CDS, terminator, marker, origin, oriT, signal, operator, other)
- a target host/chassis
- a design objective (free text, or a structured goal such as "inducible expression" / "secretion")
- an assembly method (Gibson or Golden Gate)
- optional additional parts that must stay fixed ("locked components")

## Pipeline

```
Input part
  → Requirement planning
  → Architecture generation
  → Supporting-part retrieval
  → Constraint validation
  → Assembly analysis
  → Registry/reference comparison
  → Multi-objective scoring
  → Pareto analysis
  → Ranking robustness
  → Recommended design
```

Host, goal, and any fixed/locked parts feed into requirement planning alongside the input part, so the roles the design *needs* (and which of those are already satisfied) are known before any search begins.

Two complementary generation pathways run in parallel: matching against known template architectures (when one exists for the anchor's role), and a true part-first constraint-based beam search that builds a new architecture directly around the anchor. Both pathways' candidates are validated and scored identically.

## Decision Logic

Every candidate must pass **hard constraints** before it can be recommended:
- every required biological role is filled by a real, resolved sequence (no placeholders, no gaps)
- documented host-incompatibility and host-dependency rules are enforced (unknown host compatibility is reported as unknown, never guessed)
- the user's anchor part is present **exactly**, unchanged, in every generated candidate
- every additional locked component is present at its correct role with its exact supplied sequence — a candidate that fails to preserve a lock is excluded from recommendation and shown "comparison only," never silently accepted
- a candidate that belongs to a different architecture family than the one the user explicitly selected is likewise excluded from recommendation, shown for comparison only

## Ranking

Candidates are scored with a fixed weighted formula (current weights, read directly from code):

| Dimension | Weight |
|---|---|
| Functional completeness | 0.30 |
| Assembly feasibility | 0.30 |
| Architecture evidence | 0.15 |
| Registry/reference support | 0.15 |
| Sequence quality (proxy) | 0.10 |
| Verified-part support | 0.00 (diagnostic only, not weighted) |

The weighted score determines the ranked order. **Pareto analysis is computed separately**: a candidate is Pareto-optimal if no other eligible candidate matches or beats it on every dimension at once — this surfaces genuine trade-offs (e.g. a candidate with weaker Registry support but stronger assembly feasibility) that a single weighted number would hide.

**Ranking robustness** re-scores the same candidates thousands of times under small random perturbations of the scoring weights and reports how often the same candidate stays on top. This measures how sensitive the *recommendation* is to reasonable disagreement about weight choices — it is **not** a probability of experimental/wet-lab success, and is never described as one.

## External Part Support

Any part — from our catalog or brought in by another iGEM team — can be registered for a session without editing `parts.json`. Registration success is deliberately kept separate from whether that single part is *enough information* to generate a complete plasmid:

- a **custom CDS** is usually well-posed on its own — the engine can generate a complete design directly.
- a **custom promoter** alone does not say which gene it should regulate, so the engine returns a structured "additional context required: CDS" response and asks the user to supply or register one, rather than guessing biological intent.

This is intentional: guessing a target gene for a bare promoter would be exactly the kind of fabricated biological claim this project's own rules forbid.

## Outputs

- ranked candidate list with score breakdowns and Pareto status
- an improved, professional circular plasmid map (directional features, outside leader-line labels, provenance-aware detail panel)
- side-by-side candidate comparison, highlighting only the components that differ
- a "Design Audit" summarizing constraints satisfied, assembly status, evidence provenance mix, and Registry references for the recommended candidate
- Gibson/assembly information (primers, restriction-site conflicts, feasibility)
- FASTA, JSON design-report, and GenBank export
- a one-click "Use This Design" handoff into the existing Map / Parts / Sequence / Assembly workspace
