# Q12 ensemble, calibration and abstention campaign (synthetic only)

- Seed: `20260712`
- Golden fixture SHA-256: `28d657a80b4c0328529c62e6dccf8631c2cb3574cc399ff27108b192677a942e`
- Q10 WAITING_Q14 seams closed: `5/5`
- Selected chronological calibration: `PLATT_CHRONOLOGICAL`
- Coverage monitor: `AVAILABLE`
- Evidence posture: `SYNTHETIC_ONLY`; no edge, market validity, promotion, capital,
  risk or order authority is claimed.

## Deterministic abstention matrix

| Case | Action | Reasons |
| --- | --- | --- |
| conflicting | ABSTAIN_UNKNOWN | SPECIALIST_CONFLICT |
| costNegative | ABSTAIN_UNKNOWN | COST_NEGATIVE, COST_STRESS_UNSTABLE |
| costUnknown | ABSTAIN_UNKNOWN | COST_UNKNOWN, TIMING_UNKNOWN |
| healthy | WATCH | — |
| ood | ABSTAIN_UNKNOWN | OOD_SUSPECT |
| stale | ABSTAIN_UNKNOWN | EVIDENCE_STALE, OOD_UNKNOWN |

## Q14 closure

- `16-01-purged-embargoed-walk-forward` → `ADAPTED_CLOSED` via `quant_edge.validation.WalkForwardSpecV1`, `quant_edge.validation.build_walk_forward_plan`
- `16-02-untouched-holdout` → `ADAPTED_CLOSED` via `quant_edge.validation.HoldoutGrantV1`, `quant_edge.validation.open_holdout`
- `16-03-negative-control-factory` → `ADAPTED_CLOSED` via `quant_edge.validation.assess_leakage`, `quant_edge.validation.falsify_lineage`, `quant_edge.validation.future_leaked_predictions`, `quant_edge.validation.shuffled_labels`
- `16-04-cost-latency-stress` → `ADAPTED_CLOSED` via `quant_edge.ensemble.decide_advisory`, `quant_edge.validation.run_cost_stress`
- `16-05-pbo-dsr-bootstrap` → `ADAPTED_CLOSED` via `quant_edge.validation.TrialLedgerV1`, `quant_edge.validation.block_bootstrap_interval`, `quant_edge.validation.deflated_sharpe_ratio`, `quant_edge.validation.pbo_cscv`
