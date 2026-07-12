# Q03 Source Coverage Matrix

Matrix revision: `q03.source.coverage.v1`
As-of UTC milliseconds: `1783846749000`
Canonical SHA-256: `f2f23bbb394e6547222bfde5ed4bc8ed9551a771ad5bfe18c4c239ca70429104`

Authority posture: `RESEARCH_EVIDENCE_ONLY`. `UNKNOWN` and `UNAVAILABLE` are missingness states, never measured zeroes. A URL is not an immutable revision without its exact official checksum.

| Venue | Product | Event | UTC date | Availability | Rows | Observed internal ID discontinuities | Invalid | Duplicates | Source revision |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| binance | spot | aggTrades | 2017-11-06 | OBSERVED | 832 | 0 | 0 | 0 | a016530bb394b38ea93a324de4b528a2f9b8faee41d469558e994eb4a731b15a |
| binance | spot | bookTicker | 2026-07-12 | UNAVAILABLE | UNAVAILABLE | UNAVAILABLE | UNAVAILABLE | UNAVAILABLE | UNAVAILABLE |
| binance | usd_m_perpetual | depthDelta | 2026-07-12 | UNAVAILABLE | UNAVAILABLE | UNAVAILABLE | UNAVAILABLE | UNAVAILABLE | UNAVAILABLE |
| binance | usd_m_perpetual | tardisHistoricalL2 | 2026-07-12 | UNAVAILABLE | UNAVAILABLE | UNAVAILABLE | UNAVAILABLE | UNAVAILABLE | UNAVAILABLE |

### `binance/spot/aggTrades/2017-11-06`

- **Source URL:** https://data.binance.vision/data/spot/daily/aggTrades/BNBUSDT/BNBUSDT-aggTrades-2017-11-06.zip
- **Official checksum:** 2de38a97c23e86d2aafc4edabbd891646210a69a6194cb65d0ab9e8c88fda893
- **Schema:** BinanceSpotDailyAggTradesCsvV1 / 272a42976182a5a97a2c926ee90f88d784fc232aaadbd8477d4a219d76c3af71
- **Raw source time:** 1509940463590..1510012550791 MILLISECOND/DECLARED
- **Replacement status:** OBSERVED_AT_RETRIEVAL
- **License/retention:** repository=MIT_IN_README_ONLY; archive=NOT_EXPLICIT; redistribution=UNKNOWN_REQUIRES_APPROVAL; retention=LOCAL_DERIVED_ONLY
- **Known omissions:** ARCHIVE_BOUNDARY_COMPLETENESS_UNKNOWN; ARCHIVE_COMPLETENESS_UNPROVEN; BORROW_TRUTH_UNAVAILABLE; CAUSAL_INTENT_UNAVAILABLE; COMPLETE_L2_UNAVAILABLE; COMPLETE_LIQUIDATION_FLOW_UNAVAILABLE; LIVE_LATENCY_UNAVAILABLE; LOCAL_RECEIVE_CLOCK_UNAVAILABLE; POINT_IN_TIME_IDENTITY_INCOMPLETE; QUEUE_POSITION_UNAVAILABLE

### `binance/spot/bookTicker/2026-07-12`

- **Source URL:** UNAVAILABLE
- **Official checksum:** UNAVAILABLE
- **Schema:** UNAVAILABLE / UNAVAILABLE
- **Raw source time:** UNAVAILABLE
- **Replacement status:** REPLACEMENT_STATUS_UNKNOWN
- **License/retention:** repository=NOT_APPLICABLE; archive=NOT_APPLICABLE; redistribution=NOT_APPLICABLE; retention=UNKNOWN
- **Known omissions:** EXACT_DECIMAL_DELIVERY_MISSING; PERSISTENCE_CLOCK_MISSING; REAL_Q_DELIVERY_MISSING; RECEIVE_MONOTONIC_CLOCK_MISSING; RECEIVE_ORDINAL_MISSING

### `binance/usd_m_perpetual/depthDelta/2026-07-12`

- **Source URL:** UNAVAILABLE
- **Official checksum:** UNAVAILABLE
- **Schema:** UNAVAILABLE / UNAVAILABLE
- **Raw source time:** UNAVAILABLE
- **Replacement status:** REPLACEMENT_STATUS_UNKNOWN
- **License/retention:** repository=NOT_APPLICABLE; archive=NOT_APPLICABLE; redistribution=NOT_APPLICABLE; retention=UNKNOWN
- **Known omissions:** EXACT_DECIMAL_DELIVERY_MISSING; REAL_Q_DELIVERY_MISSING; SEQUENCE_COMPLETE_CAPTURE_MISSING

### `binance/usd_m_perpetual/tardisHistoricalL2/2026-07-12`

- **Source URL:** UNAVAILABLE
- **Official checksum:** UNAVAILABLE
- **Schema:** UNAVAILABLE / UNAVAILABLE
- **Raw source time:** UNAVAILABLE
- **Replacement status:** REPLACEMENT_STATUS_UNKNOWN
- **License/retention:** repository=NOT_APPLICABLE; archive=UNKNOWN; redistribution=PROHIBITED; retention=INTERFACE_ONLY
- **Known omissions:** LICENSE_ENTITLEMENT_MISSING; RAW_REDISTRIBUTION_PROHIBITED; SUBSCRIPTION_NOT_ACQUIRED
