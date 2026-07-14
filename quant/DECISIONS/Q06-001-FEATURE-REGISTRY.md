# Q06-001 — deterministic feature registry and common law

Status: `ACCEPTED_FOR_Q06_IMPLEMENTATION`

Date: 2026-07-12

## Decision

Q06 implements the §12 feature common law as a pure library: one explicit fixed-point
arithmetic with half-even rounding, four sampling domains with explicit boundary and
empty/incomplete-bar truth, context-conditioned robust baselines gated by history
sufficiency, the complete feature-card/registry law with tamper-evident digests and a
drift-rejected Markdown projection, a streaming/batch equivalence harness measured in
integer ulps against per-card declared tolerances, worst-of freshness/quality
propagation, four v1 primitive features proving the machinery end to end, and bounded
model-free redundancy diagnostics with every fold/model-dependent §12.3 diagnostic
explicitly deferred to the model/validation phases.

A feature that fails its declared equivalence tolerance is not production-ready and
fails the suite; there is no tolerance-widening path outside a new card version.

## Rejected alternatives

- Float arithmetic with epsilon comparisons: destroys cross-platform byte determinism;
  integer fixed point with an explicit rounding law replaces it.
- One-minute candles as the default domain: §12.1 forbids forcing phenomena into one
  clock; all four domains are first-class and volatility bars await a real trigger
  definition.
- Global (uncohorted) baselines: mixes time-of-day/funding/regime/liquidity contexts
  and fabricates comparability; cohort keys and history gates replace it.
- Implementing SHAP/mutual-information/permutation diagnostics now: they require
  models and chronological folds that do not exist yet; pretending otherwise would be
  theater. They are recorded as deferred.
- Approximate quantile sketches (t-digest): unnecessary at current scale and harder to
  make byte-deterministic; exact bounded windows serve v1 and the sketch remains a
  documented scaling option.
- Registering the Q07/Q08 market feature families here: Q06 owns the law, not the
  library; premature families would be unreviewable bulk.
