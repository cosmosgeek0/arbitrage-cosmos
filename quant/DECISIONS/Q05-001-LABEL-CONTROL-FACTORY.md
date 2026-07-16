# Q05-001 — deterministic §11 label and matched-control factory

Status: `ACCEPTED_FOR_Q05_IMPLEMENTATION`

Date: 2026-07-12

## Decision

Q05 implements the complete Section 11 machinery as a pure library over injected
evidence: content-derived point-in-time sample identity, exact-rational multi-horizon
outcomes with explicit censoring, versioned stage discovery labels, Basis label
contracts with explicit borrow/fee/funding assumptions, the six-state event disposition
law, deterministic §11.6 matched controls and byte-reproducible manifests, plus the
objective-outcome reference the accepted Q-E owner-annotation link contract consumes.

The factory computes only what supplied evidence lawfully supports. Unknown stays
unknown, gaps are `DATA_INVALID`, missing series or stale references are `UNAVAILABLE`,
truncated evidence is `CENSORED` with an explicit censor time, and no float enters any
numeric path. All identities (sample, outcome, disposition, manifest, evaluation group,
match result) are content hashes, so §11.7 reproducibility is structural, not aspirational.

The lane holds no persisted real market rows, so every executable proof is honestly
`SYNTHETIC` and the receipt reports real label coverage as `DATA_INSUFFICIENT`. Q05
builds no feature registry, model, calibration, drift, inference or action authority.

## Rejected alternatives

- One binary `pump=true` target: forbidden by the directive and useless for calibrated
  research; the multi-horizon/stage/disposition decomposition replaces it.
- Float returns with tolerance comparisons: destroys byte determinism; exact rationals
  over aligned integers are closed under every operation the factory performs.
- Coercing censored or gapped windows into zeros or negatives: fabricates evidence; the
  status vocabulary carries the truth instead.
- Letting the factory assert `ACTED`/`REJECTED`/`EXPIRED`: those are operational truths
  owned by the production ledger; only explicit assertions are accepted.
- Control matching on model scores or future outcomes: leaks future membership; only
  observable window facts and pre-cutoff candidate facts enter eligibility.
- Populating labels from the disposed Q03 sample hashes: impossible without raw rows and
  would misrepresent hash evidence as market data.
