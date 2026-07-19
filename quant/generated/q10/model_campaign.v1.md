# Q10 model battery campaign (synthetic only)

- Seed: `20260712`
- Battery SHA-256: `f742b90e4613a900aa09e869316045a2069b8007cff25dbfadae634e578ada8f`
- Golden fixture SHA-256: `fa8b5dd28dc6753ae410296730bb21f09a1c19c3bb76785bc84b01944907fcbf`
- Evidence posture: SYNTHETIC_ONLY — planted machinery truth, never market truth;
  no model here is predictive, validated or economically valuable.

## Comparison reports

### `attention_rank:v1` — primary `precision_at_4`

| Model | Role | Primary value | Winner |
| --- | --- | --- | --- |
| `activity_only:v1` | TRANSPARENT_BASELINE | 0.625000000000 | — |
| `liquidity_only:v1` | TRANSPARENT_BASELINE | 0.437500000000 | — |
| `random_rank:v1` | CONTROL | 0.562500000000 | — |
| `xgb_ranker:v1` | BOOSTED_CHALLENGER | 0.937500000000 | **yes** |
| `xgb_ranker_tuned:v1` | BOOSTED_CHALLENGER | 0.937500000000 | — |

### `net_edge_quantiles:v1` — primary `pinball_mean`

| Model | Role | Primary value | Winner |
| --- | --- | --- | --- |
| `quantile_linear:v1` | TRANSPARENT_BASELINE | 1180.824147789594 | — |
| `train_quantile_constant:v1` | CONTROL | 1251.570312500000 | — |
| `xgb_quantile:v1` | BOOSTED_CHALLENGER | 1188.322331548358 | — |
| `xgb_quantile_tuned:v1` | BOOSTED_CHALLENGER | 1126.784276103601 | **yes** |

### `net_edge_regression:v1` — primary `mse`

| Model | Role | Primary value | Winner |
| --- | --- | --- | --- |
| `ols:v1` | TRANSPARENT_BASELINE | 11986555.932557070553 | **yes** |
| `train_mean:v1` | CONTROL | 13515873.061225000000 | — |
| `xgb_regressor:v1` | BOOSTED_CHALLENGER | 13690338.847560466480 | — |
| `xgb_regressor_tuned:v1` | BOOSTED_CHALLENGER | 12039986.663485348873 | — |

### `transition_binary:v1` — primary `brier`

| Model | Role | Primary value | Winner |
| --- | --- | --- | --- |
| `elastic_net_logistic:v1` | TRANSPARENT_BASELINE | 0.269822658726 | — |
| `logistic:v1` | TRANSPARENT_BASELINE | 0.268779972731 | — |
| `no_trade_prevalence:v1` | CONTROL | 0.251337500000 | — |
| `random_rank:v1` | CONTROL | 0.310899346642 | — |
| `xgb_classifier:v1` | BOOSTED_CHALLENGER | 0.085698540952 | **yes** |
| `xgb_classifier_tuned:v1` | BOOSTED_CHALLENGER | 0.088127669719 | — |

## Honest challenger losses

- `net_edge_regression:v1`: winner `ols:v1` (TRANSPARENT_BASELINE); losing boosted challengers: `xgb_regressor:v1`, `xgb_regressor_tuned:v1`

## Bounded studies (all trials logged)

| Study | Requested | Logged | Complete | Best trial |
| --- | --- | --- | --- | --- |
| `study_xgb_classifier:v1` | 12 | 12 | 12 | 4 |
| `study_xgb_quantile:v1` | 12 | 12 | 12 | 7 |
| `study_xgb_ranker:v1` | 12 | 12 | 12 | 0 |
| `study_xgb_regressor:v1` | 12 | 12 | 12 | 10 |

## Section 14 dispositions

| Bullet | Disposition | Implemented ids |
| --- | --- | --- |
| 14.1-01-robust-heuristic-baselines | ADAPT | activity_only:v1, liquidity_only:v1 |
| 14.1-02-calibrated-logistic-elastic-net | ADOPT | elastic_net_logistic:v1, logistic:v1 |
| 14.1-03-linear-quantile-regression | ADOPT | ols:v1, quantile_linear:v1 |
| 14.1-04-gam-spline | REFERENCE_ONLY | — |
| 14.1-05-liquidity-activity-rankers | ADOPT | activity_only:v1, liquidity_only:v1 |
| 14.1-06-random-and-no-trade-controls | ADOPT | no_trade_prevalence:v1, random_rank:v1, train_mean:v1, train_quantile_constant:v1 |
| 14.2-01-topk-precision-recall | ADOPT | kendall_tau_a, precision_at_4, recall_at_4 |
| 14.2-02-detection-lead-time | DATA_INSUFFICIENT | — |
| 14.2-03-information-gain-promotion | DATA_INSUFFICIENT | — |
| 14.2-04-conservative-net-value | DATA_INSUFFICIENT | — |
| 14.2-05-compute-stream-cost | DATA_INSUFFICIENT | — |
| 14.3-01-xgboost-challengers | ADOPT | xgb_classifier:v1, xgb_classifier_tuned:v1, xgb_quantile:v1, xgb_quantile_tuned:v1, xgb_ranker:v1, xgb_ranker_tuned:v1, xgb_regressor:v1, xgb_regressor_tuned:v1 |
| 14.3-02-lightgbm | REFERENCE_ONLY | — |
| 14.3-03-catboost | REFERENCE_ONLY | — |
| 14.3-04-monotonic-constraints | ADOPT | monotone_vector |
| 14.3-05-real-market-targets | DATA_INSUFFICIENT | — |
| 14.3-06-record-all-trials | ADOPT | study_xgb_classifier:v1, study_xgb_quantile:v1, study_xgb_ranker:v1, study_xgb_regressor:v1 |
| 15-01-per-model-calibration | ADOPT | isotonic_calibrate |
| 15-02-ensemble-conformal-abstention | REFERENCE_ONLY | — |
| 16-01-purged-embargoed-walk-forward | WAITING_Q14 | — |
| 16-02-untouched-holdout | WAITING_Q14 | — |
| 16-03-negative-control-factory | WAITING_Q14 | — |
| 16-04-cost-latency-stress | WAITING_Q14 | — |
| 16-05-pbo-dsr-bootstrap | WAITING_Q14 | — |
