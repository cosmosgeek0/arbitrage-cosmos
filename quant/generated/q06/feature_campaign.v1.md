# Q06 feature registry

Registry version: `q06-features-v1`

Content SHA-256: `c2ee717edee8708463c84f5bd72d1e3578081d4c90e569dcc56df2c49ef208b5`

No feature listed here is claimed to be predictive, validated or economically
valuable; cards are machinery contracts with streaming/batch equivalence law.

| Feature | Domain | Cohort | Unit | Tolerance (ulp) | Batch | Streaming |
| --- | --- | --- | --- | ---: | --- | --- |
| `activity_intensity:v1` | WALL_TIME | symbol-self | COUNT | 0 | `quant_edge.features.primitives:batch_activity_intensity` | `quant_edge.features.primitives:streaming_activity_intensity` |
| `bar_return:v1` | WALL_TIME | symbol-self | RATIO | 0 | `quant_edge.features.primitives:batch_bar_return` | `quant_edge.features.primitives:streaming_bar_return` |
| `ewma_variance:v1` | WALL_TIME | symbol-self | RATIO_SQUARED | 64 | `quant_edge.features.primitives:batch_ewma_variance` | `quant_edge.features.primitives:streaming_ewma_variance` |
| `robust_z:v1` | WALL_TIME | symbol-self | MAD_UNITS | 0 | `quant_edge.features.primitives:batch_robust_z` | `quant_edge.features.primitives:streaming_robust_z` |

## Campaign evidence (synthetic only)

- Seed: `20260712`
- Golden fixture SHA-256: `06c81655ebb61a6311f29f7964d99b6d4dca94d7a1f8c2416d922fda3fcbabb3`
- Seeded series: 12, all equivalence reports passed
- Max ulp deviation by feature: `activity_intensity:v1`=0, `bar_return:v1`=0, `ewma_variance:v1`=2, `robust_z:v1`=0
