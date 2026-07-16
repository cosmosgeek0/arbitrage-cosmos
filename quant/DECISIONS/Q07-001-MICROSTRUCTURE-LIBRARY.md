# Q07-001 — bounded microstructure library over honest evidence shapes

Status: `ACCEPTED_FOR_Q07_IMPLEMENTATION`

Date: 2026-07-12

## Decision

Q07 implements the §13.1 microstructure/liquidity families as a pure library over the
three evidence shapes the lane honestly holds — L1 top-of-book with sizes, maker-flagged
trades and book-view ladders — plus Q06 bars for per-bar illiquidity. Sixteen v1
features ship, each under the accepted Q06 card law with a batch reference, a streaming
implementation at declared 0-ulp equivalence and a deterministic per-update operation
bound. Every §13.1 bullet receives exactly one machine-checkable disposition; families
the current contracts cannot support honestly are `BLOCKED_DATA` or `REFERENCE_ONLY`
with recorded reasons. Wall-time cost evidence is stdout-only and environment-specific;
deterministic operation counts are the asserted cost law.

Feature values quantize exactly once (half-even, fixed point 10^-12) after exact
integer/rational computation; missing or insufficient evidence yields UNKNOWN, never
zero.

## Rejected alternatives

- Event-level multi-level OFI from diff-depth snapshots: snapshot differences cannot
  attribute adds/cancels/executions; shipped honestly as `band_flow` (ADAPT) and the
  cancellation/addition family is `BLOCKED_DATA`, not simulated.
- Spoofing detection features: public data can never attribute individual intent; only
  the `possible_spoof_like_pattern` wording is lawful, fixed by
  `spoof_pattern_semantics()` and tested.
- Wall-clock benchmarks asserted in tests: host timing is nondeterministic; the
  asserted law is the deterministic `last_update_ops` counter against a declared
  bound, with wall time printed as stdout-only evidence per the task.
- Nonzero ulp tolerances: every Q07 computation is exact until one final quantization,
  so streaming/batch agreement is required to be exact (0 ulp) — a tolerance would
  hide law violations.
- Implementing every §13.1 variant (arrival acceleration/entropy, book convexity,
  level-migration, tail-mass shifts): unreviewable bulk without settled definitions;
  each is deferred by name inside its family's ADAPT reason.
- Failed-move and adverse-selection features now: they need the Q05 label/event join
  and provable pre-cutoff evidence; building them here would risk label leakage —
  `REFERENCE_ONLY` until the phase that wires features to labeled events.
- Deep intended-size grids for VWAP-spread: one versioned intended size proves the
  law; a size grid is a later, reviewable parameter decision.
