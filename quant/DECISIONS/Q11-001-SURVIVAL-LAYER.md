# Q11-001 — survival and competing-risk layer design and decisions

Status: `ACCEPTED_FOR_Q11_IMPLEMENTATION`

Date: 2026-07-12 (shard `q11-survival-20260712`, base `8a5dd09` = Q lane with
Q07+Q08+Q09 merged, director order D-LAUNCH-5, Q11 cut `0f2bb88`)

## Decision 1 — exact reference implementations on the frozen lock

The shard cannot modify `quant/pyproject.toml`/`uv.lock`. The Q01 framework cards
settle the dependency question for survival modeling: scikit-survival 0.28.0 is
`REJECT` (GPL-3.0-or-later reciprocal-license risk plus an unreviewed compiled
surface) and its card names "Kaplan-Meier/parametric/XGBoost AFT" comparisons as the
admission test for any later challenger; XGBoost AFT is `ADOPT` but deferred to the
Q10 battery, which is spine-owned and out of this shard's write scope. Q11 therefore
delivers the §14.4 survival layer as exact deterministic pure-Python reference
implementations behind stable interfaces — the parity baselines every later survival
challenger (XGBoost AFT, gradient survival, Cox/AFT) must beat on identical cohorts.
Nothing here duplicates a canonical owner: no survival machinery exists anywhere in
the repository.

## Decision 2 — Kaplan-Meier, Aalen-Johansen and a discrete-time hazard model are
the honest exactly-computable choice

Cox partial likelihood and parametric AFT need `exp`/iterative optimization — float
machinery the house numeric law forbids in public contracts and that cannot be made
byte-deterministic across platforms without declaring an arbitrary quantized
optimizer. Instead of quantizing a float optimizer, Q11 chooses estimators whose
mathematics is already exact over integer counts:

- **Kaplan-Meier / Nelson-Aalen**: products/sums of exact rationals built from
  integer risk-set and event counts.
- **Reverse Kaplan-Meier**: the censoring-survival estimator `G` for IPCW, computed
  by the same machinery with the roles of events and censorings exchanged.
- **Aalen-Johansen**: cause-specific cumulative incidence over the same counts;
  `S(t) + Σ_k CIF_k(t) = 1` holds exactly in the internal rationals — a conservation
  law the property suite asserts rather than assumes.
- **Stratified discrete-time cause-specific hazard model**: the §14.1 transparent
  baseline. Its complete fitted state is integer sufficient statistics (per stratum,
  per grid bin, per cause: event counts and risk-set sizes); prediction multiplies
  exact per-bin survival factors. It is a genuine censored-data model (right-censored
  subjects contribute risk exposure without an event) with a documented exact Laplace
  smoothing law `h_k = (d_k + α) / (n + (K+1)·α)`, where the `K+1` mass includes the
  survive-the-bin outcome so the per-bin outcome distribution sums to one exactly.

## Decision 3 — internal exact rationals, quantized only at the contract boundary

KM/AJ running products over hundreds of event times exceed `ExactRatioV1`'s declared
10^60 magnitude bound after reduction, so the public contracts cannot carry the raw
rationals. The law: all estimator/metric arithmetic runs in unbounded exact rational
arithmetic (`fractions.Fraction`, never floats); every published probability,
hazard, score or gap is quantized half-even to the house `FixedPointV1` scale 10^12
exactly once, at the contract boundary. Integer counts (at-risk, events, censored,
excluded) are published raw. Deterministic fixtures therefore assert exact quantized
mantissas, and the test suite re-derives goldens through independent `Fraction`
references.

## Decision 4 — censoring is first-class and fail-closed

`SubjectV1` carries `EVENT`-with-cause or `RIGHT_CENSORED` explicitly (the same
shape law as the Q05 outcome contracts: a cause is present if and only if the status
is `EVENT`). §11.7's law "censored cases remain censored" is enforced structurally:
no estimator or metric path converts a censored subject into an event or drops it
silently. Quality gating happens in a measured builder step — gap-class subjects are
excluded into per-quality exclusion counts (`DATA_INVALID` accounting, never a
normal negative). IPCW fails closed: when the reverse-KM censoring survival reaches
zero where a weight is required, the affected time reports an explicit
`UNAVAILABLE` status instead of dividing by zero or clamping. Post-follow-up curve
queries return `None`; unseen strata and thin risk sets return `UNKNOWN`
predictions; unknowns stay `UNKNOWN`.

## Decision 5 — documented tie and binning laws

- At tied times, events are processed before censorings (the standard product-limit
  convention), for both KM and reverse-KM; the reverse-KM risk set at a tied time
  excludes that time's true events.
- `TimeGridV1` bins are right-closed: a duration `d` lands in bin `j` when
  `t_{j-1} < d ≤ t_j` (with `t_0 = 0`). A subject censored inside a bin is treated
  as censored at the bin's end (it remains at risk for that whole bin) — the
  documented discrete-time convention that makes the life-table survival curve equal
  KM exactly when the grid is aligned to the distinct event times and censoring only
  occurs at bin boundaries; the property suite asserts that equivalence.
- Durations beyond the grid end are administratively censored at grid end and
  counted, never silently dropped or extrapolated.

## Decision 6 — metrics measure, budgets judge, groups do not leak

The metrics harness follows the Q09 pattern: measurements are typed reports, and a
declared `SurvivalBudgetV1` turns them into pass/fail verdicts. Concordance uses the
Harrell usable-pair law with half credit for score ties and optional horizon
truncation; pairs whose subjects share a `group_id` are excluded and counted —
§11.7's adjacent-windows-stay-in-one-group law applied at metric level, mirroring
Q09's same-event exclusion. Brier scores use IPCW with the reverse-KM `G` evaluated
as a left limit at event times. Calibration reports bin subjects by predicted event
probability into fixed equal-width bins and compare the exact mean prediction with a
censoring-aware observed frequency (KM/AJ within the bin cohort), so censored
subjects never bias observed frequencies; expected calibration error weights bins by
population. Per Q-D discipline, no probability leaves the layer without its
calibration evidence alongside.

## Decision 7 — the six §14.4 targets are a versioned vocabulary, not market truth

`targets.py` publishes v1 specs binding each declared target (time to ignition,
continuation, fade, Basis convergence, invalidation, actionability window) to its
primary cause and competing causes (e.g. convergence competes with invalidation and
disorder; §11.4's right-censored non-convergence is the censoring state, not a
cause). These specs are machinery constants proving the layer end-to-end; real
cohorts arrive from the label factory at integration time. No spec claims a market
frequency, a hazard shape or an economic value.

## Decision 8 — campaign evidence is synthetic and self-accusing

`python -m quant_edge.survival.campaign OUTPUT_ROOT` writes the golden fixture and
seeded (`20260712`) measurement artifacts under `quant/generated/q11/`,
byte-deterministically, with no network/env/ambient-time access. Seeded cohorts are
drawn from known discrete hazard laws through the house `DeterministicRandom`
(u64-threshold draws with exact integer thresholds), so estimator recovery is
measured against a known truth; the fitted model is evaluated on held-out cohorts;
a marginal no-skill predictor is measured alongside as the floor. Every artifact
states `SYNTHETIC` posture and repeats that no measurement is a market claim.
