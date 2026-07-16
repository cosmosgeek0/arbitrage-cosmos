# Q10 model battery design — transparent baselines, boosted challengers, bounded studies

Everything in this phase is deterministic advisory research machinery proven on honest
`SYNTHETIC` fixtures. No model is predictive, validated or economically valuable; no
output carries promotion, strategy, capital or order authority.

## 1. Package layout (`quant_edge.models`)

| Module | Owns | Floats? |
| --- | --- | --- |
| `quantize` | the single binary64 → `FixedPointV1` half-even crossing | boundary |
| `contracts` | metric/result/report/disposition contracts | never |
| `split` | `InternalChronologicalSplitV1`, typed non-authoritative | never |
| `synthetic` | integer planted-structure datasets and targets | never |
| `metrics` | exact-rational metrics over quantized predictions | `log_loss` only |
| `engine` | all numpy/scikit-learn/xgboost fitting and scoring | yes (internal) |
| `estimators` | estimator registry; exact pure families; engine dispatch | raw outputs only |
| `studies` | bounded seeded fully-logged Optuna adapter | objective handoff |
| `battery` | orchestration, dispositions, `BatteryResultV1` | never |

The package barrel imports only the pure modules, so `import quant_edge.models` works
without the `models` extra; `engine`/`estimators`/`studies`/`battery` require it.

## 2. Numeric law

- Engines compute in binary64. Every value crossing into a public contract is quantized
  exactly once through `quantize_binary64`: `Fraction.from_float` recovers the exact
  rational of the binary64 (lossless), then half-even rounding onto the Q06 fixed-point
  scale (`10^12`). Probabilities additionally fail closed outside `[0, 1]`.
- All public metrics are exact integer/rational arithmetic over the once-quantized
  predictions and integer labels: Brier, tie-aware Mann-Whitney AUC, 10-bin ECE, MSE,
  MAE, pinball per level and mean, coverage absolute error, crossing fraction,
  precision@k, micro recall@k and Kendall tau-a. The single exception is `log_loss`
  (needs logarithms): binary64 under a documented one-grid-unit clip law, labeled
  `BINARY64` in its `MetricDerivation`.
- No float appears in any public dataclass field, mapping or artifact.

## 3. Synthetic planted structure (`battery_synthetic:v1`, 640 rows, 10 features)

Feature roles are declared, not inferred: two planted monotone linear signals
(`lin_primary`, `lin_secondary`, direction +1), two sign-XOR participants
(`xor_left`, `xor_right`), one heteroscedasticity driver (`hetero_driver`), three pure
noise columns, and positive liquidity/activity proxies (activity declared +1 for the
rank latent). All values are integers from `DeterministicRandom` with a fixed
draw order per row; the accepted modulo bias is documented machinery.

Four targets over the shared matrix:

- `transition_binary:v1` — latent `40·lin1 + 20·lin2 + 55·xor(±100) + U[-3000,3000]`.
  The XOR term is invisible to any linear or monotone-in-features model by
  construction, so the boosted challenger should win here honestly.
- `net_edge_regression:v1` — `25·lin1 + 10·lin2 + U[-100,100]·(5 + |hetero|)`. Noise
  dominates the linear signal, so flexible challengers can overfit and honestly lose to
  OLS on test MSE (and on the frozen seed, they measurably do).
- `net_edge_quantiles:v1` — the same labels; conditional quantiles depend on `|hetero|`
  (a kink no linear-in-features quantile regression can represent), so the boosted
  quantile model can win honestly.
- `attention_rank:v1` — groups of 16; latent `6·activity + 45·lin1 + U[-1500,1500]`,
  graded 0–3 by fixed thresholds; relevant means grade ≥ 2; the focus budget is k=4.

The builder fails closed unless both binary classes appear in each of the train,
validation and test slices.

## 4. Split and the WAITING_Q14 seam

`InternalChronologicalSplitV1(400, 16, 96, 128)` partitions rows in chronological
order with a declared embargo gap and carries
`authority: BATTERY_INTERNAL_NON_AUTHORITATIVE` in every mapping. It exists so studies
have a validation objective and reports have an out-of-train test slice — nothing
more. Purged/embargoed walk-forward, untouched-holdout governance, the
negative-control factory, cost/latency stress and PBO/DSR diagnostics are Q14
property; no frozen Q14 interface exists at this base, so the disposition table
records them `WAITING_Q14` and the battery never reimplements them or claims
validation-grade authority for any comparison.

## 5. Models

Transparent baselines: L2 logistic and saga elastic-net logistic (train-only
standardization; isotonic-calibrated), OLS, exact-LP linear quantile regression, and
proxy single-feature rankers. Controls: train prevalence (no-trade), train mean, exact
type-1 train quantiles, and seeded random scores (exact 53-bit fractions). Challengers:
XGBoost classifier / regressor / multi-quantile / pairwise ranker — `hist`, `n_jobs=1`,
fixed seeds, `subsample=colsample=1.0`, CPU only — in default and study-tuned
variants. Every fit is wrapped in `threadpool_limits(1)`.

Monotone constraints are derivable only from declared planted directions
(`monotone_vector` fails closed on any contradiction) and are applied per target:
`lin_primary`/`lin_secondary` for binary/regression, `lin_primary`/`activity` for
ranking. The law is property-tested on prediction grids. The multi-quantile
challenger runs unconstrained: XGBoost's vector-leaf `reg:quantileerror` measurably
violates declared constraints on planted-direction probes, so constraining it would
be a false promise (recorded in disposition `14.3-04`).

Calibration: classifier probabilities (baselines and challengers identically) pass one
isotonic stage fit on the validation slice only; ECE is reported before and after.
Controls stay `UNCALIBRATED_SCORE`; regression/quantile/rank outputs are
`NOT_PROBABILITY`.

## 6. Bounded studies

Four studies (classifier/regressor/quantile/ranker), each: seeded TPE, sequential,
12-trial hard budget, finite exact spaces (`suggest_int` ranges and categorical grids
of integers or decimal strings — no continuous distribution, so every parameter is
JSON-safe and replayable). Objectives are exact metrics on the validation slice only
(raw, pre-calibration scores for the classifier). Every trial is logged typed with its
exact quantized objective; failures keep their reason and count against the budget;
`StudyRecordV1` fails closed if the logged count differs from the budget or the best
index violates the objective law (exact-mantissa ordering, earliest-index tie-break).

## 7. Reports and honesty

`ComparisonReportV1` holds every registered model exactly once, sorted; the winner is
recomputed in `__post_init__` from the predeclared primary metric (exact mantissa
ordering, lexicographic tie-break) so a dropped loss or a hand-picked winner cannot
construct. Primary metrics: Brier (binary), MSE (regression), mean pinball (quantile),
precision@4 (rank). The campaign additionally freezes an explicit
`honestChallengerLosses` section; on the frozen seed the regression target preserves
both boosted challengers losing to OLS as a measured fact.

## 8. Determinism

One battery run is ~1.9 s single-threaded. In-process reruns and subprocess runs under
different CWD / `TZ` / `PYTHONHASHSEED` produce byte-identical artifacts (verified by
contract tests). Determinism claims are host-scoped, as everywhere in this lane;
framework versions are pinned by `uv.lock` and recorded in the battery mapping.

## 9. What Q10 deliberately does not do

No survival models (Q11), no ensembles/conformal/abstention beyond the per-model
calibration stage (Q12), no deep models (Q13), no validation factory (Q14, recorded
`WAITING_Q14`), no registry/champion semantics (Q15), no inference service (Q16), no
LightGBM/CatBoost/scikit-survival dependencies, no model persistence, no real data,
no edge claim.
