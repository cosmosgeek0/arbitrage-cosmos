# Q14-001 — deterministic validation and falsification factory

Status: `ACCEPTED_FOR_Q14_IMPLEMENTATION`

Date: 2026-07-12

## Decision

Q14 implements the §16 validation law as a pure library over injected, digest-bound
sample and prediction sets (`quant/src/quant_edge/validation/`):

- **Splitting (§16.1).** Chronological expanding/rolling walk-forward with grouped
  event identity, label-interval purging, a backward embargo whose floor
  (declared max label horizon + declared feature lookback) is a constructor contract,
  and a final chronological holdout that appears in no fold. Groups straddling the
  holdout boundary are quarantined out of research entirely rather than silently
  trained on. The holdout is only materializable through an explicit
  `HoldoutGrantV1` bound to the exact plan digest, and any report that uses it
  records the grant.
- **Negative controls (§16.2).** Seeded pure transforms: global and block-local label
  permutations, stale/lagged predictions, future-value injection (the deliberate
  leak, honestly carrying label-interval end as its as-of time), a lineage-falsifying
  adversarial variant for tests, random-rank and activity-only baselines,
  intentionally incomplete data (unknown, never zero) and synthetic false bursts on
  true negatives. Cost perturbation lives in the stress module.
- **Metrics (§16.4 Q14 subset).** PR-AUC first-class, ROC-AUC secondary, precision/
  recall at k, top-k recall via recall-at-k, Brier, ECE with declared bins and
  calibration slope. Exact integer/rational arithmetic internally; public values are
  `FixedPointV1` at the accepted 10^-12 scale with half-even rounding; degenerate
  support returns `UNKNOWN` with a typed reason.
- **Bootstrap.** Seeded circular block bootstrap with declared block length,
  replicates and coverage; documented order-statistic percentile law; typed
  invalidity.
- **Multiple testing (§16.3).** Immutable sorted trial ledger where failed and
  abandoned trials are first-class; CSCV PBO with explicit gates (2..256 trials,
  4..16 even blocks) and a documented conservative tie law (at-or-below-median
  counts; identical clones read as PBO = 1, an honest statement that selecting among
  clones is overfitting); Benjamini–Hochberg over supplied exact p-values;
  exact-duplicate collapse as the bounded effective-trial estimator with the
  spectral refinement recorded as deferred.
- **Deterministic normal core.** Integer fixed-point erf series (working scale
  10^-24, |z| ≤ 12 clamp, loud convergence cap), Φ⁻¹ by bounded bisection against Φ
  itself, floor `isqrt` square roots, and a declared conservative absolute error
  bound of 10^-9 carried on every DSR report. Measured against independent
  references, Φ agrees to the last public ulp.
- **DSR.** Bailey/López-de-Prado construction with every statistical precondition an
  explicit gate: minimum observations (20), variance resolution floor (10^-12),
  positive skew/kurtosis variance adjustment, N = 1 degenerating to the
  probabilistic Sharpe ratio and zero cross-trial variance disabling deflation.
- **Stress.** Explicit fee/slippage/funding/borrow/recovery deltas plus latency
  under a declared opportunity-decay law; unknown gross edge or base cost abstains;
  the report counts actionable→non-actionable flips against the zero-delta base.
- **Leakage verdicts.** Temporal lineage audit (bounded violation evidence) and the
  behavioral battery (implausible-skill bound per declared family, measured
  no-skill envelope, extra shuffled probe). Ordered verdicts with no
  tolerance-widening path; a rejected model never reaches comparison.
- **Comparison.** Leakage assessment runs strictly on research samples (holdout and
  quarantined excluded, so holdout outcomes cannot influence any pre-holdout
  decision), per-fold direction-adjusted effects, bootstrap interval on the effect,
  evidence-based verdicts, digest-bound canonical mapping and a deterministic
  Markdown projection.

Acceptance headline (§20 Q14) is proven twice: the deliberately leaked model is
rejected through the temporal audit when its lineage is honest and through the
implausible-skill bound when its lineage is forged, while honest baselines and a
skilled-but-imperfect challenger are not rejected — committed in the golden fixture
and re-proven across an 8-dataset seeded battery.

## Shard-scope placements (D-LAUNCH-5)

- Durable shard state: `quant/TASKS/Q14_STATE.md` (spine-owned
  `quant/QUANT_EDGE_BUILD_STATE.md` untouched).
- Golden fixture and campaign artifacts: `quant/generated/q14/` (the spine's
  `quant/fixtures/` is outside the shard write set).
- Campaign builder: `quant/tests/q14/q14_validation_campaign.py` (the spine's
  `quant/scripts/` is outside the shard write set).
- This decision note carries the design rationale (the spine's `quant/docs/` is
  outside the shard write set).

## Rejected alternatives

- Float arithmetic anywhere in public contracts: destroys byte determinism; exact
  rationals internally and fixed point publicly replace it, mirroring accepted Q05/
  Q06 law.
- scikit-learn/scipy for splits, metrics, bootstrap or normal functions: adds heavy
  dependencies for logic that must be exactly reproducible and branch-auditable;
  the accepted lock stays unchanged.
- Purging by sample-count windows: label intervals are the truth; interval-overlap
  purging plus a contract-floored embargo replaces heuristics.
- A "soft" leakage warning state: §16 is a falsification law; verdicts reject and
  there is no widening path outside a new declared family bound.
- Evaluating leakage on the full sample set: lets holdout outcomes shape a
  pre-holdout decision; assessment is restricted to research samples (found and
  fixed during self-review).
- Implementing detection lead time, opportunity-decay measurement from outcomes,
  per-regime breakdowns beyond declared strata, CPCV and spectral effective-trial
  counts now: they need model/outcome semantics from later phases; recorded as
  deferred rather than faked.

## Known limitations (recorded, not hidden)

- PBO uses CSCV over supplied per-block scores; building the block matrix from fold
  results is the caller's job in the model phases.
- The no-skill envelope is a min/max band over seeded shuffles: conservative and can
  reject an honest model whose probe draw escapes a narrow band
  (`REJECTED_CONTROL_FAILURE`); a rejected-when-in-doubt posture is deliberate for a
  falsification factory.
- The effective-trial estimator collapses only exact clones; correlated trials still
  count separately (conservative for DSR deflation).
- All committed evidence is `SYNTHETIC`; no real-market metric, edge or model claim
  exists anywhere in Q14.
