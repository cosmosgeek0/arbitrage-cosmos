# Q06 feature-registry design and honest posture

Authored 2026-07-12 with the Q06 implementation. Records every versioned law the
feature common layer ships and what remains deferred. Nothing here claims a feature is
predictive, validated or economically valuable; the lane still holds no persisted real
market rows, so every proof is `SYNTHETIC` fixture evidence.

## Deterministic numeric law

- One fixed-point representation (integer mantissa at scale 10^-12) with half-even
  rounding on every multiply/divide (`round_half_even`), so streaming arithmetic is
  platform-deterministic without floats.
- Exact rationals (Q05 `ExactRatioV1`) remain the batch-reference arithmetic; batch
  values quantize to fixed point half-even exactly once.
- Streaming/batch agreement is measured in integer ulps of the fixed-point scale
  against each card's declared tolerance. Exact-arithmetic features declare 0 ulp;
  the EWMA recurrence declares 64 ulp headroom (measured seeded drift: 2 ulp).

## Sampling domains (§12.1)

Wall-time bars are half-open `[anchor + i·width, anchor + (i+1)·width)` tiling the
completeness interval with explicit empty bars and an explicitly incomplete final bar
when the interval ends mid-bar. Event bars are one per observation. Trade-count and
volume bars close on their thresholds and emit an explicit incomplete tail, never a
silent drop. Volume bars refuse volume-unknown series: unknown volume is not zero.
Volatility-triggered bars are deferred until a volatility trigger definition exists
(Q09 change/regime layer) and are recorded here as deferred, not skipped.

## Robust baselines (§12.2)

Bounded-window exact rolling median/MAD (even windows use the half-even mean of the two
central values), fixed-point EWMA mean/variance (West recurrence, explicit alpha),
bounded-window exact lower-order-statistic quantiles, and per-cohort baseline sets
keyed by symbol, time-of-day bucket, UTC-anchored funding-cycle bucket, regime id and
liquidity bucket. Every cohort is gated by an explicit history-sufficiency contract
(minimum span and observation count); insufficient history yields `None`/`UNKNOWN`,
never a fabricated baseline. t-digest quantile sketches are deferred in favor of exact
bounded windows and recorded as a future scaling option.

## Registry law (§12)

`FeatureCardV1` carries every §12 field; construction rejects any missing or malformed
field, so an incomplete card is unrepresentable. The registry sorts cards by unique
`name:version` identity, binds a canonical content digest and renders a deterministic
Markdown projection whose drift is rejected by `verify_registry_markdown`.

## Freshness and quality (§10.4 propagation)

Feature values carry `AVAILABLE`/`STALE`/`UNKNOWN`/`DATA_INVALID` with an explicit
mapping from the accepted `QualityState` vocabulary (gapped evidence is
`DATA_INVALID`; unavailable/partial/sampled/reconstructing/unknown map to `UNKNOWN`;
stale maps to `STALE`). Propagation takes the worst of input quality, the freshness
bound and computation truth; a value exists only when everything is `AVAILABLE`.

## Diagnostics (§12.3 subset)

Implemented model-free: Pearson/Spearman signed r-squared as exact rationals (signed
square avoids irrational square roots; Spearman uses doubled midranks so ties stay
integral), near-constant checks, missingness counts with longest-run detection and
greedy single-link redundancy clustering above an explicit r-squared threshold.
The model-dependent diagnostics formerly recorded by `deferred_diagnostics()` are now
owned by Q14's authoritative walk-forward plan: training-fold mutual information,
same-fit permutation importance on chronological validation folds, exact additive
TreeSHAP/equivalent validation, sign/monotonicity stability, genuine family refits and
incremental value after the existing engine-feature baseline. Q06 retains the bounded
model-free diagnostics; `diagnostic_obligations()` records the complete ten-item law.
Q14 matrices are built only from source cells that bind observation status/value,
source as-of and last-event time, source owner/revision/artifact digest and evidence
posture. Synthetic posture cannot publish available diagnostics. Chronological
permutation selects each donor only from feature truth available by that receiver's
cutoff and binds the donor cell plus recomputed output lineage.

## v1 primitive features

`activity_intensity:v1`, `bar_return:v1`, `ewma_variance:v1` and `robust_z:v1` are
production-shaped machinery probes with complete cards, batch references, streaming
implementations and committed golden vectors. Their hypotheses describe mechanism
only; no predictive claim exists and Q07/Q08 own the real microstructure/derivative
families.
