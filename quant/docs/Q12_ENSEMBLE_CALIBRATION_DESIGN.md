# Q12 ensemble, calibration and abstention design

Evidence posture: `SYNTHETIC_ONLY`

Authority posture: advisory-only library; no capital, risk, execution, registry,
private-API, secret, network, environment, clock, filesystem, or order authority.

## Decision chain

1. Q14 owns purged/grouped walk-forward membership, holdout grants, leakage controls,
   cost stress, bootstrap, PBO, DSR, and trial accounting.
2. Q10/Q11 own specialist behavior. Q12 consumes injected predictions; it does not
   retrain, reinterpret unknowns, or open private data paths.
3. Q12 validates the complete OOF rectangle and fits a bounded transparent convex
   stack on earlier folds.
4. Later OOF slices fit and compare chronological calibrators after prior labels have
   matured.
5. A separate ordered residual prefix fits the static interval challenger. Later
   observations measure coverage; adaptive updates occur only after outcome maturity.
6. Named uncertainty components and typed Q14 stress evidence enter the abstention
   gates. Only fully bound, healthy evidence can yield advisory `WATCH`.

## AlgorithmCard — exact convex OOF stack

**Input.** A Q14 `SampleSetV1`, valid `WalkForwardPlanV1`, two to four sorted specialist
IDs, one Q10 `ProbabilitySemantics` declaration per specialist bundle, and one
prediction bundle per valid fold/specialist pair.

**Method.** Validate exact train IDs, exact validation coverage, subset digest, target,
horizon, feature-as-of lineage, and exclusion of holdout/quarantined rows. Enumerate
all integer compositions of a declared denominator (at most sixteen), convert them to
exact simplex weights, and minimize OOF Brier loss with a deterministic tuple tie-break.

**Assumptions.** Specialist scores are probabilities for one declared binary target
and exact label horizon. Q14 fold truth is authoritative. Meta outcomes are known and
all mature before the first calibration cutoff.

**Failure modes.** Missing/duplicate bundles, substituted train rows, holdout or
quarantined rows, late features, target/horizon mismatch, unknown labels, unbound
matrix, overlapping chronology, or malformed weights raise a typed contract error.

**Baseline/ablation.** The grid includes every one-specialist corner and equal/near-
equal blends. A challenger must beat or tie these under the same OOF rows; ties choose
the lexicographically stable weight tuple. No synthetic loss is interpreted as edge.

**Measured synthetic result.** Grid-8 selected `5/8` linear and `3/8` robust at exact
OOF Brier `1501607/12288000` (about `0.122201`). Grid-16 selected `9/16` linear and
`7/16` robust at `749353027/6144000000` (about `0.121965`). The small synthetic
resolution improvement is implementation evidence, not an edge claim.

## AlgorithmCard — chronological Platt calibration

**Input.** Later OOF stack probabilities with known binary labels, a bounded minimum
support, minimum unique scores, and predeclared reliability bins.

**Method.** Run a fixed 64-step ridge-stabilized binary64 Newton optimizer, then
quantize coefficient, intercept, and applied probabilities at the existing Q10 fixed-
point boundary. Binary64 never appears in public contracts.

**Assumptions.** Fit rows are source-model-bound, point-in-time, two-class, nonconstant,
and strictly earlier by label maturity than evaluation/application rows.

**Failure modes.** Insufficient, one-class, constant, late-feature, wrong-model,
reused, or digest-mismatched evidence becomes `UNKNOWN` or raises at the boundary.

**Baseline/ablation.** Compared against exact isotonic on the same later evaluation
slice using Brier, then method ID as a deterministic tie-break. Reports also retain log
loss, ECE, calibration slope/intercept when identified, and reliability cells.

**Measured synthetic result.** On 11 strictly later evaluation rows, Platt won with
Brier `0.139869987261` and log loss `0.472711523121` at the frozen fixed-point scale.

## AlgorithmCard — exact isotonic calibration

**Method.** Sort exact rational score/label pairs, aggregate duplicate scores, and run
pool-adjacent-violators with exact rational block rates. Application is a monotone step
map.

**Assumptions and limits.** Monotonicity is plausible; sample size may still be far
below the range where isotonic is stable. Small-support overfit is explicitly reported
and no method is promoted from synthetic evidence.

**Failure modes/baseline.** Same chronology and support gates as Platt. Platt is the
lower-variance parametric comparator.

**Measured synthetic result.** On the same 11-row evaluation slice, isotonic produced
Brier `0.141414141414` and fixed-point log loss `2.648647330425`; it lost narrowly to
Platt under the predeclared Brier rule. No method is promoted from synthetic evidence.

## AlgorithmCard — fixed-width split-conformal stack baseline

**Input.** One canonical Q12 OOF matrix and fitted stack, a frozen exact half-width,
and strictly prediction-time-ordered Q14 validation observations from one
regime/cohort/horizon. Fit and coverage outcomes must have matured; an application
observation may remain outcome-unknown.

**Method.** Recompute every base score from the exact stack and set its bounds to
`score - half_width` and `score + half_width`; caller-owned row bounds are rejected.
Nonconformity is
`max(0, lower - outcome, outcome - upper)`. For support `n`, select the exact sorted
score at rank `ceil((n + 1) * (1 - alpha))`; do not interpolate. Record calibration
outcome maturity. Apply only through recomputable model evidence to a later,
identity-bound fold using the same matrix, fitted stack, and half-width. This is a
fixed-width baseline followed by split-conformal residual adjustment, not learned
quantile regression and not a CQR claim.

**Assumptions.** Residual order is meaningful. Exchangeability is not assumed for the
market-time-series use case.

**Failure modes.** Insufficient support or finite-sample rank, mixed context, unknown
fit outcomes, crossed or substituted base bounds, foreign matrix/stack/half-width,
prediction before calibration maturity, forged model evidence, or identity mixing
yields `UNKNOWN` or a contract error. Invalid intervals are never clipped.

**Baseline/ablation.** The unadjusted base interval is the explicit baseline. Coverage
is measured only on a disjoint later slice, with unavailable emissions counted.

**Measured synthetic result.** The fold-04 fit used 11 Q14-bound binary outcomes and
selected adjustment `497/2000`; the complete, disjoint fold-05 covered `7/11` known
outcomes against the model-alpha-bound `3/5` minimum. Fold-06 is assessment-only. The report is labeled
empirical/non-exchangeable and proves no future coverage guarantee.

## AlgorithmCard — adaptive conformal challenger

**Input.** A bounded residual window, target alpha, bounded step size, alpha bounds,
and a pending observation whose outcome is absent at prediction time.

**Method.** Predict from the current prefix. After the bound observation's outcome time,
verify identity and state digest, append its nonnegative base residual, and update alpha
only when the adjusted interval existed. Clamp alpha to declared bounds. Warm-up rows
bootstrap the residual window even while the conformal interval is unavailable.

**Assumptions and limits.** This is an empirical non-exchangeable challenger. Adaptive
conformal results concern long-run error frequency under stated conditions, not a
per-observation conditional guarantee. Delayed, out-of-order, or mismatched updates
fail closed.

**Baseline/ablation.** Static fixed-width split conformal is the frozen-alpha
comparator. Prefix invariance and unknown-outcome state preservation are executable
properties.

**Measured synthetic result.** A fold-06 prediction was emitted before its outcome,
then one covered matured update moved bounded alpha from `2/5` to `21/50`; replacing
that outcome with unknown left the exact prefix digest unchanged.

## AlgorithmCard — named uncertainty vector

**Components.** Canonical quality; Q09 disorder/OOD state; mean squared deviation of
specialist probabilities; maximum pairwise gap; `p(1-p)` empirical outcome dispersion;
conformal width; Q14 cost/fill state; Q14 timing/decay state; Q14 stress digest.

**Assumptions.** Disagreement and outcome dispersion are proxies. They are not
identified epistemic and aleatoric variance.

**Failure modes.** Fewer than two unique specialists, out-of-range probabilities,
unavailable/crossed interval contracts, zero or incoherent stress support, or unbound
stress evidence fails closed. Missing interval width remains `None`, never zero.

**Baseline/ablation.** Each component is separately serialized and separately gated;
there is deliberately no scalar aggregation to ablate.

**Measured synthetic result.** The healthy assessment recorded disagreement variance
`2209/250000`, maximum gap `47/250`, empirical outcome-dispersion about `0.010439`,
conformal width `897/1000`, positive cost state, and stable timing. The separate bound
conflict row had exact gap `1`; missing-cost remained typed `UNKNOWN` rather than zero.

## AlgorithmCard — deterministic abstention

**Input.** One sample/target/horizon assessment contract containing the chosen
calibrator, the two-method comparison proving it won, its evaluation, calibrated
prediction set, conformal interval and coverage report, the fitted-stack-owned
specialist set, uncertainty vector, and exact Q14 stress outcome.

**Method.** Recompute the fitted stack, winning calibration, full-fold application and
one-row projection; derive specialist scores from the validated matrix; recompute Q09
fusion, conformal model/assessment/coverage, full Q14 stress, uncertainty, and the
final decision envelope. Evaluate every hard gate and emit reasons in a frozen
precedence order. Any reason returns `ABSTAIN_UNKNOWN` with probability and interval
suppressed. No reason returns advisory `WATCH`.

**Failure modes.** Partial calibration evidence or any cross-model/cross-sample/
cross-horizon substitution is rejected before a decision. Stale, OOD, conflict,
cost-negative, and cost-unknown cases are independent acceptance tests.

**Baseline/ablation.** A score-only threshold is the rejected baseline. Gate-by-gate
tests prove that an attractive score cannot override evidence integrity.

**Measured synthetic result.** Stale, OOD, specialist conflict, missing cost, and
known negative cost each emitted `ABSTAIN_UNKNOWN` with the applicable ordered reason;
only the fully bound healthy case emitted advisory `WATCH`. The five Q10
`WAITING_Q14` seams closed `5/5` through typed Q14 evidence.

## Q10 `WAITING_Q14` closure

Q12 never rewrites Q10. `ValidationClosureEvidenceV1` separates the full plan samples
from the exact non-holdout/non-quarantined research subset, requires the valid Q14 plan,
its bound holdout grant and exact opened IDs, and recomputes three typed leakage
assessments from the honest later-fold OOF stack plus temporal and falsified-lineage
controls. It also binds typed cost-negative and cost-unknown stress reports, the full
trial ledger, and AVAILABLE PBO/DSR/bootstrap reports.
The grant is opened once per deterministic campaign build; Q14's pure grant API is not
misrepresented as globally single-use. The closure manifest is pinned to Q14 acceptance
`e266b42913fb721cc2a8470a08774be3fdf1ce0c`
and director merge `f756f3b582f24857811e6ec4c0d08a3a61026b74`.

## Evidence and interpretation limits

All committed values are deterministic synthetic measurements. They can prove code
behavior, provenance checks, failure handling, byte stability, and gate precedence.
They cannot prove a live market edge, stable calibration under distribution shift,
conditional interval coverage, favorable costs, or safe execution. Q12 has no path to
turn a research output into an order.
