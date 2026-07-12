# Q06 feature registry

Registry version: `q08-derivatives-v1`

Content SHA-256: `b30aa3a40c5a635edb165c6e0d04062ed954b364f48e215cc65c717aa51df6dc`

No feature listed here is claimed to be predictive, validated or economically
valuable; cards are machinery contracts with streaming/batch equivalence law.

| Feature | Domain | Cohort | Unit | Tolerance (ulp) | Batch | Streaming |
| --- | --- | --- | --- | ---: | --- | --- |
| `basis_converging_fraction:v1` | WALL_TIME | spot-perp-pair-self | RATIO | 0 | `quant_edge.derivatives.bar_features:batch_basis_converging_fraction` | `quant_edge.derivatives.bar_features:streaming_basis_converging_fraction` |
| `basis_gap_acceleration:v1` | WALL_TIME | spot-perp-pair-self | RATIO_PER_BAR_SQUARED | 0 | `quant_edge.derivatives.bar_features:batch_basis_gap_acceleration` | `quant_edge.derivatives.bar_features:streaming_basis_gap_acceleration` |
| `basis_gap_velocity:v1` | WALL_TIME | spot-perp-pair-self | RATIO_PER_BAR | 0 | `quant_edge.derivatives.bar_features:batch_basis_gap_velocity` | `quant_edge.derivatives.bar_features:streaming_basis_gap_velocity` |
| `basis_sign_persistence:v1` | WALL_TIME | spot-perp-pair-self | COUNT | 0 | `quant_edge.derivatives.bar_features:batch_basis_sign_persistence` | `quant_edge.derivatives.bar_features:streaming_basis_sign_persistence` |

## Campaign evidence (synthetic only)

- Seed: `20260712`
- Golden fixture SHA-256: `8820d4d54d17a54a0959dae0e96ccd5e95b610b25f6c593bf7b74130d3737eb5`
- Seeded pairs: 12, all equivalence reports passed
- Max ulp deviation by feature: `basis_converging_fraction:v1`=0, `basis_gap_acceleration:v1`=0, `basis_gap_velocity:v1`=0, `basis_sign_persistence:v1`=0
- Normal and reverse executable constructions remain distinct; unknown
  borrow, funding or cost components stay UNKNOWN and never become zero.
