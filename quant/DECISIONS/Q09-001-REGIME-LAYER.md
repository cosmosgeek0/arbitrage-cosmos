# Q09-001 — change/regime/anomaly/analog layer design and decisions

Status: `ACCEPTED_FOR_Q09_IMPLEMENTATION`

Date: 2026-07-12 (shard `q09-regime-20260712`, base A6 `24ccf58`, director order D-LAUNCH-5)

## Decision 1 — pure deterministic reference implementations on the frozen lock

The shard cannot modify `quant/pyproject.toml`/`uv.lock` (shared, read-only under
D-LAUNCH-5). ruptures, STUMPY, River, PyOD, FAISS and hmmlearn therefore remain exactly
as the Q01 framework cards record them: deferred/reference, not installed. Q09 delivers
the §13.4/§14.5/§14.7 machinery as exact deterministic pure-Python implementations in
the house fixed-point/rational style. This is not a duplication of a canonical owner:
no such owner exists in the repository, and every relevant Q01 card names a
naive/exact parity baseline as its own admission test (ruptures: "compare
EWMA/CUSUM/BOCPD at matched false-alarm budgets"; STUMPY: "exact versus
naive/approximate distances"; FAISS: "brute-force parity"). Q09 builds those exact
baselines behind stable interfaces; a later phase may adopt the libraries as
challengers through `SHARED_CHANGE_REQUEST.md` without changing any caller.

## Decision 2 — no-float law carried into probabilistic machinery

House law forbids floats in public numeric contracts. The consequences:

- **CUSUM/Page-Hinkley** are integer-native already (sums and comparisons of
  fixed-point mantissas; the PH running mean is the exact integer mean quantized
  half-even per step, so there is no accumulated drift — the quantization law *is* the
  statistic's definition).
- **PELT** minimizes a *declared quantized objective*: the exact rational SSE of a
  segment, `(n·Σm² − (Σm)²) / (n·SCALE)`, quantized half-even once per segment
  evaluation to an integer cost in `SCALE·value²` units. After that single documented
  rounding, the dynamic program and PELT pruning are exact integer arithmetic, so the
  optimizer is exactly optimal for the objective it declares. Property tests prove
  parity with brute-force optimal partitioning of the same quantized objective.
- **BOCPD** uses a bounded discrete alphabet (robust median/MAD bucketing), so the
  Dirichlet-categorical predictive `(count+1)/(n+K)` is an exact small rational. The
  run-length posterior is fixed-point at scale 10^12 with a documented
  largest-remainder normalization (ties broken toward lower run length), and a hard
  run-length cap whose growth mass folds into the cap bin. The posterior the detector
  reports is exactly the posterior it computes; the quantization law is part of the
  detector's definition, not hidden error.
- **Soft regime** uses the same alphabet and the same fixed-point normalization law in
  a recursive Bayesian (forward) filter with a fixed transition matrix and a
  probability floor applied before normalization, preventing unseen-regime
  overconfidence by construction (§14.6).
- **Matrix Profile / analogs** never compute a square root: the z-normalized distance
  ordering is decided by exact integer comparison of signed squared correlations
  (`sign(cov)·cov²` cross-multiplied against variance products), the same device the
  Q06 diagnostics use. Reported similarity is signed ρ² quantized half-even to
  fixed-point; internal ordering is exact.

## Decision 3 — earlier-only law is structural, not filtered-after-the-fact

For both the left Matrix Profile and analog retrieval, a candidate window is eligible
only if `candidate_end ≤ query_start − embargo` (profile: `j + m ≤ i`; retrieval:
record end at or before query cutoff minus embargo). Overlap and same-event exclusion
are enforced before ranking; every exclusion increments a per-reason counter
(profile: `FUTURE`, `OVERLAP`, `SAME_EVENT`, `DEGENERATE`; retrieval adds
`COHORT` and `SHAPE`), so the acceptance
requirement "future/overlap exclusions are measured" is a first-class measured output,
asserted in tests and recorded in campaign artifacts. Ties rank by lower start index,
deterministically.

## Decision 4 — measured false alarms and detection delay

A typed metrics harness (`DetectionReportV1`) evaluates alarms against planted truth
with an explicit detection window: alarms inside `[change, change + window]` are
detections (delay = alarm − change, first alarm counts), alarms outside every window
are false alarms, undetected changes are missed. Rates and mean delay are exact
rationals; a `DetectionBudgetV1` turns measurements into pass/fail. PELT is measured by
boundary error (max/mean absolute distance to nearest true boundary plus over/under
segmentation counts); the anomaly/OOD layer is measured by hit/false rates on injected
outliers. The campaign commits these measurements in hash-bound artifacts.

## Decision 5 — quality gates fail closed and reset visibly

Detector inputs carry the accepted `QualityState` vocabulary. `COMPLETE`/`SYNTHETIC`
points are eligible; `STALE` points produce a `SUPPRESSED` step (state frozen, no
alarm); `GAPPED`/`RECONSTRUCTING`/`UNAVAILABLE`/`UNKNOWN`/`PARTIAL`/`SAMPLED` points
produce a `RESET` step for sequential detectors (CUSUM/PH/BOCPD/soft regime): all
sequential state restarts because continuity is broken, and the reset is visible in the
step record. Missing is never zero; a gap is never continuity; warmup yields
`WARMUP` steps with no alarm authority.

## Decision 6 — shard-scope artifact placement

`quant/scripts/**` and `quant/fixtures/**` are outside shard scope, so the campaign is
a package module (`python -m quant_edge.regime.campaign`) and the committed golden
fixture lives in `quant/generated/q09/regime_golden_v1.json` next to the campaign
evidence. The design record is folded into this decision note because `quant/docs/**`
is also outside shard scope. No shared change is required; `SHARED_CHANGE_REQUEST.md`
is therefore not created.

## Module map

```text
quant/src/quant_edge/regime/
  __init__.py       public exports; advisory-only docstring
  contracts.py      ObservationV1/ObservationSeriesV1, eligibility law, step vocab
  cusum.py          CusumConfigV1, two-sided streaming CUSUM
  page_hinkley.py   PageHinkleyConfigV1, two-sided streaming PH
  pelt.py           PeltConfigV1, quantized-SSE optimal partitioning with pruning
  alphabet.py       robust median/MAD bucketing into a bounded alphabet
  bocpd.py          BocpdConfigV1, bounded-run-length fixed-point BOCPD
  soft_regime.py    RegimeModel protocol, RegimeSpecV1, deterministic forward filter
  anomaly.py        robust anomaly score, persistence, disorder/OOD fusion
  matrix_profile.py earlier-only left profile, exact correlation-order comparisons
  analog.py         earlier-only top-k retrieval with outcome distributions
  metrics.py        detection/segmentation/anomaly measurement + budgets
  campaign.py       deterministic golden + seeded campaign writer (python -m)
```

Tests live in `quant/tests/q09/` (unit, property with seed `20260712`, contract/safety,
golden/campaign determinism). Coverage target: 100% statements/branches on
`quant_edge.regime`.

## Explicitly deferred

- ADWIN/KSWIN ("where supported" — River remains deferred; recorded, not skipped
  silently).
- HSMM/duration-explicit regimes, learned transition/emission parameters, per-regime
  calibration and regime-mixture inference (Q10+/Q12 model phases).
- FAISS-scale approximate retrieval; Q09 retrieval is exact and bounded.
- Volatility-triggered bars (noted in the Q06 receipt as awaiting a Q09 trigger
  definition): the change-point layer built here is that trigger seam, but bar
  construction lives in the frozen Q06 module, so wiring a volatility-bar spec is a
  later integration change, not a shard write.
- Any claim about real market data: every Q09 proof is `SYNTHETIC`.
