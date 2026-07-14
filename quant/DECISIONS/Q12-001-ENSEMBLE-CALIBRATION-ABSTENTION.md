# Q12-001 — chronological ensemble, calibration and abstention

Status: `ACCEPTED FOR IMPLEMENTATION`

Date: 2026-07-13

## Decision

Q12 is a pure, bounded advisory library over accepted Q09/Q10/Q11/Q14 truth. It owns
only the final combination layer: fold-bound out-of-fold stacking, chronological
calibration, empirical interval challengers, named uncertainty proxies, and a
fail-closed abstention decision. It does not train the specialist owners, create a
second validation factory, infer OOD state, promote models, or convey capital, risk,
execution, registry, private-API, or order authority.

The stacker is an exact rational convex-simplex search over at most four specialists
and sixteen weight divisions. Every bundle must match one valid Q14 fold's exact train
and validation membership, point-in-time lineage, target, label horizon, declared Q10
probability semantics, and sample digest. The validated matrix retains and rechecks the
raw Q14 samples and plan, so a replaced matrix cannot launder a late feature or altered
fold. Meta labels must mature before calibration begins. Outputs bind the full fitted
stack digest, Q14 matrix, target, and horizon in their model identity.

Calibration compares deterministic Platt and exact isotonic challengers. Fit,
evaluation, and application slices are chronological and source-model-bound; every fit
label must mature before the next slice starts. A calibration evaluation must carry
Brier, log loss, predeclared ECE cells, reliability cells, and its calibrator digest.
A bare `AVAILABLE` flag cannot grant probability semantics. The abstention boundary
also requires the exact two-method comparison and proves that the applied calibrator
and evaluation are its recomputed winner.

Static split conformal adjusts a fixed-width canonical-stack baseline on a separate
ordered Q14 validation-fold prefix. This is not learned quantile regression and is not
labeled CQR. Every base bound is recomputed from the exact fitted stack score plus or
minus the frozen half-width; callers cannot substitute row bounds. The model records
the matrix, fitted-stack and half-width provenance as well as target, dataset, plan,
folds, calibration-outcome maturity, and regime/cohort/horizon identity. Application
requires bound model evidence and a disjoint, strictly later Q14 fold using the same
stack authority. Monitoring binds observation identity, prediction time, model digest,
and interval provenance; unavailable intervals remain in coverage accounting rather
than disappearing. Adaptive conformal is explicitly an empirical, non-exchangeable
challenger. It predicts before outcome visibility, accepts updates only after the bound
outcome time, and uses declared finite alpha bounds as an explicit engineering policy
rather than claiming the unbounded canonical ACI theorem.

Uncertainty remains a vector: source quality, canonical Q09 disorder/OOD state,
between-specialist disagreement, empirical Bernoulli outcome dispersion, conformal
width, Q14 cost/fill state, and Q14 timing/decay state. These are operational proxies,
not a Bayesian decomposition or scalar confidence.

The final decision is either advisory `WATCH` or `ABSTAIN_UNKNOWN`. Stale/ineligible
quality, OOD/unknown disorder, missing or conflicting specialists, missing or negative
cost evidence, unstable or unknown timing, missing calibration, unavailable interval,
or unknown/collapsed coverage independently forces `ABSTAIN_UNKNOWN`. Abstention
suppresses both probability and interval. A score cannot override an integrity gate.
The exported decision is a bound envelope whose complete context digest and internal
decision are recomputed together; callers cannot construct a free-standing `WATCH`.

The five Q10 `WAITING_Q14` seams close additively through typed Q14 evidence bound to
the accepted Q14 commit and director merge. Q10's accepted table, fixture, and receipts
remain immutable.

## Why

Default cross-validation and stacking APIs do not establish the chronological and
purged provenance required for overlapping market labels. Calibration on training
predictions is optimistically biased. Ordinary split-conformal exchangeability is not
credible under market drift. A single uncertainty score would erase the difference
between stale evidence, OOD state, specialist disagreement, interval width, and unknown
economics. Explicit contracts and abstention preserve those distinctions.

## Consequences

- Executable evidence is `SYNTHETIC_ONLY`; no Binance transferability, edge, coverage
  guarantee, or economic value is claimed.
- Isotonic calibration is retained as a challenger, not presumed superior; small
  support is an acknowledged overfit risk.
- Adaptive conformal reports empirical prequential behavior only. Its update law does
  not provide pointwise or conditional coverage.
- Exact grid stacking is transparent and deterministic but intentionally small; it is
  not a substitute for later Q13 work and does not begin Q13.
- Final holdout access remains Q14 grant-gated and is closure/evaluation evidence only,
  never a tuning input.
- The closure artifact distinguishes the full plan dataset from the exact research
  subset; leakage tests and stress evidence exclude holdout and quarantine rows.

## Rejected alternatives

- Random/K-fold or in-sample stacking: rejected for temporal leakage.
- Calibrating on stack-fit rows: rejected for optimistic reuse.
- Caller-owned base bounds, default interpolated quantiles, or clipped invalid
  intervals: rejected for unbound provenance and hidden numerical/availability
  semantics.
- Averaging conflicts or treating missing costs as zero: rejected as false precision.
- One scalar uncertainty or "pump probability": rejected as fabricated semantics.
- Rewriting Q10's historical `WAITING_Q14` rows: rejected because durable history is
  immutable; Q12 records the typed closure instead.

## Sources reviewed

- [scikit-learn 1.9 probability calibration](https://scikit-learn.org/stable/modules/calibration.html)
  and [time-series splitting](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html).
- [Romano, Patterson, and Candès, Conformalized Quantile Regression, NeurIPS 2019](https://proceedings.neurips.cc/paper_files/paper/2019/hash/5103c3584b063c431bd1268e9b5e76fb-Abstract.html).
- [Gibbs and Candès, Adaptive Conformal Inference, JMLR 2024](https://www.jmlr.org/papers/v25/22-1218.html).
- [Xu and Xie, EnbPI, ICML 2021](https://proceedings.mlr.press/v139/xu21h.html).

These sources guide method construction. They are not evidence that the synthetic Q12
results generalize to live market data. The CQR paper motivates the nonconformity and
finite-sample rank, but Q12's frozen-width stack baseline is not a quantile regressor.
