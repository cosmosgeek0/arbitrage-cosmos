# Q06 feature registry

Registry version: `q07-micro-v1`

Content SHA-256: `b805c14e4afb9e417359c6b9307dd1dd6dc5c07ab64e25e9bc38a62a44bc3f7e`

No feature listed here is claimed to be predictive, validated or economically
valuable; cards are machinery contracts with streaming/batch equivalence law.

| Feature | Domain | Cohort | Unit | Tolerance (ulp) | Batch | Streaming |
| --- | --- | --- | --- | ---: | --- | --- |
| `absorption_ratio:v1` | EVENT_TIME | symbol-self | RATIO | 0 | `quant_edge.micro.flow:batch_absorption_ratio` | `quant_edge.micro.flow:streaming_absorption_ratio` |
| `amihud_illiquidity:v1` | EVENT_TIME | symbol-self | RETURN_PER_VOLUME | 0 | `quant_edge.micro.flow:batch_amihud_illiquidity` | `quant_edge.micro.flow:streaming_amihud_illiquidity` |
| `band_flow:v1` | EVENT_TIME | symbol-self | SIZE_UNITS | 0 | `quant_edge.micro.bookfeat:batch_band_flow` | `quant_edge.micro.bookfeat:streaming_band_flow` |
| `book_slope_imbalance:v1` | EVENT_TIME | symbol-self | RATIO | 0 | `quant_edge.micro.bookfeat:batch_book_slope_imbalance` | `quant_edge.micro.bookfeat:streaming_book_slope_imbalance` |
| `cumulative_band_imbalance:v1` | EVENT_TIME | symbol-self | RATIO | 0 | `quant_edge.micro.bookfeat:batch_cumulative_band_imbalance` | `quant_edge.micro.bookfeat:streaming_cumulative_band_imbalance` |
| `depth_resiliency:v1` | EVENT_TIME | symbol-self | RATIO | 0 | `quant_edge.micro.bookfeat:batch_depth_resiliency` | `quant_edge.micro.bookfeat:streaming_depth_resiliency` |
| `effective_spread:v1` | EVENT_TIME | symbol-self | RATIO | 0 | `quant_edge.micro.flow:batch_effective_spread` | `quant_edge.micro.flow:streaming_effective_spread` |
| `kyle_slope:v1` | EVENT_TIME | symbol-self | IMPACT_PER_SIZE | 0 | `quant_edge.micro.flow:batch_kyle_slope` | `quant_edge.micro.flow:streaming_kyle_slope` |
| `l1_queue_imbalance:v1` | EVENT_TIME | symbol-self | RATIO | 0 | `quant_edge.micro.l1:batch_l1_queue_imbalance` | `quant_edge.micro.l1:streaming_l1_queue_imbalance` |
| `microprice_displacement:v1` | EVENT_TIME | symbol-self | RATIO | 0 | `quant_edge.micro.l1:batch_microprice_displacement` | `quant_edge.micro.l1:streaming_microprice_displacement` |
| `ofi_l1:v1` | EVENT_TIME | symbol-self | SIZE_UNITS | 0 | `quant_edge.micro.l1:batch_ofi_l1` | `quant_edge.micro.l1:streaming_ofi_l1` |
| `signed_trade_imbalance:v1` | EVENT_TIME | symbol-self | RATIO | 0 | `quant_edge.micro.flow:batch_signed_trade_imbalance` | `quant_edge.micro.flow:streaming_signed_trade_imbalance` |
| `size_concentration_hhi:v1` | EVENT_TIME | symbol-self | RATIO | 0 | `quant_edge.micro.flow:batch_size_concentration_hhi` | `quant_edge.micro.flow:streaming_size_concentration_hhi` |
| `trade_dispersion:v1` | EVENT_TIME | symbol-self | SECONDS | 0 | `quant_edge.micro.flow:batch_trade_dispersion` | `quant_edge.micro.flow:streaming_trade_dispersion` |
| `trade_intensity:v1` | EVENT_TIME | symbol-self | TRADES_PER_SECOND | 0 | `quant_edge.micro.flow:batch_trade_intensity` | `quant_edge.micro.flow:streaming_trade_intensity` |
| `vwap_spread_at_size:v1` | EVENT_TIME | symbol-self | RATIO | 0 | `quant_edge.micro.bookfeat:batch_vwap_spread_at_size` | `quant_edge.micro.bookfeat:streaming_vwap_spread_at_size` |

## Section 13.1 dispositions

| Bullet | Disposition | Implemented features |
| --- | --- | --- |
| 13.1-01-l1-ofi | ADOPT | ofi_l1:v1 |
| 13.1-02-multilevel-ofi | ADAPT | band_flow:v1 |
| 13.1-03-queue-imbalance | ADOPT | cumulative_band_imbalance:v1, l1_queue_imbalance:v1 |
| 13.1-04-microprice | ADOPT | microprice_displacement:v1 |
| 13.1-05-signed-trade-imbalance | ADOPT | signed_trade_imbalance:v1 |
| 13.1-06-arrival | ADAPT | trade_dispersion:v1, trade_intensity:v1 |
| 13.1-07-size-distribution | ADAPT | size_concentration_hhi:v1 |
| 13.1-08-book-shape | ADAPT | book_slope_imbalance:v1 |
| 13.1-09-depth-dynamics | ADAPT | depth_resiliency:v1 |
| 13.1-10-cancel-add-intensity | BLOCKED_DATA | — |
| 13.1-11-wall-persistence | REFERENCE_ONLY | — |
| 13.1-12-effective-spread-vwap | ADOPT | effective_spread:v1, vwap_spread_at_size:v1 |
| 13.1-13-price-response | ADOPT | kyle_slope:v1 |
| 13.1-14-impact-illiquidity | ADOPT | amihud_illiquidity:v1, kyle_slope:v1 |
| 13.1-15-absorption | ADAPT | absorption_ratio:v1 |
| 13.1-16-failed-moves | REFERENCE_ONLY | — |
| 13.1-17-adverse-selection | REFERENCE_ONLY | — |

## Campaign evidence (synthetic only)

- Seed: `20260712`
- Golden fixture SHA-256: `6b5ad2e2b43b3574240ae649eaede07962cb67963359b5df2ab685022acd580c`
- Disposition table SHA-256: `a47b5212f68cf0b07c2374b5b041fac23582b3013ba164fa7237d0be9d78a892`
- Seeded scenarios: 10, all equivalence reports passed
- Max update ops by feature: `absorption_ratio:v1`=16, `amihud_illiquidity:v1`=16, `band_flow:v1`=5, `book_slope_imbalance:v1`=10, `cumulative_band_imbalance:v1`=5, `depth_resiliency:v1`=8, `effective_spread:v1`=1, `kyle_slope:v1`=16, `l1_queue_imbalance:v1`=1, `microprice_displacement:v1`=1, `ofi_l1:v1`=1, `signed_trade_imbalance:v1`=1, `size_concentration_hhi:v1`=1, `trade_dispersion:v1`=16, `trade_intensity:v1`=1, `vwap_spread_at_size:v1`=12

> possible_spoof_like_pattern: public L2/L1 evidence can describe patterns consistent with spoofing but can never attribute individual intent; any such feature must carry this limitation verbatim
