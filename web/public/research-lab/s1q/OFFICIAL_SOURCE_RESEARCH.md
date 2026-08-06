# S-1Q official Binance source research

Frozen before evaluator or protocol implementation on
`2026-07-29T16:18:50Z`. The research packet is public-data-only. No signed,
private, trading, transfer, withdrawal, provider, host, or money endpoint was
called.

Correction receipt: the first draft had SHA-256
`0f295411ac6c5f4076bdcebc2cdcf039b4eb5615312c19f563a0502ff4293e93`
and used the duplicated anchor `#get-get-funding-rate-info`. The anchor alone
was corrected to `#get-funding-rate-info` before `preseal.v1.json` and before
any archive member was opened. No source interpretation or protocol claim
changed.

## Official sources

| Source | Retrieval time (UTC) | Frozen interpretation |
| --- | --- | --- |
| [USD-M funding-rate history](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#get-funding-rate-history) | 2026-07-29T16:18:50Z | Public `GET /fapi/v1/fundingRate`; history is ascending, time-bounded, and identifies `Regular` versus `Special` funding rows. The public archive used by this study omits `rateType` and `markPrice`, so archive rows alone cannot establish normal-settlement classification or the exact funding mark. |
| [USD-M funding-rate information](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#get-funding-rate-info) | 2026-07-29T16:18:50Z | Public `GET /fapi/v1/fundingInfo` exposes current adjusted caps/floors and `fundingIntervalHours`. The page does not document historical snapshots. S-1Q therefore does not backfill historical cadence with current funding information. |
| [USD-M contract klines](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#kline-candlestick-data) | 2026-07-29T16:18:50Z | Public `GET /fapi/v1/klines`; klines are identified by open time. S-1Q uses the next complete hourly contract-kline open after settlement as a price proxy, not as evidence of a fill. Quote-asset volume is only a prior-complete-day participation proxy. |
| [USD-M mark-price klines](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#mark-price-kline-candlestick-data) | 2026-07-29T16:18:50Z | Public `GET /fapi/v1/markPriceKlines`; mark-price klines are identified by open time. S-1Q uses hourly mark opens only to proxy later funding cash flows, never as executable prices. |
| [USD-M exchange information](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#exchange-information) | 2026-07-29T16:18:50Z | Public `GET /fapi/v1/exchangeInfo` is explicitly current exchange rules and symbol information. S-1Q does not use it for historical membership, filters, or survivor replacement. |
| [USD-M user commission rate](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/account#user-commission-rate) | 2026-07-29T16:18:50Z | `GET /fapi/v1/commissionRate` is signed `USER_DATA`. Its example rates are examples, not account truth. The endpoint is not called; account-effective commission remains `UNKNOWN`. Public fee values in S-1Q are sensitivity assumptions only. |
| [Official Binance public-data README](https://github.com/binance/binance-public-data/blob/master/README.md?plain=1) | 2026-07-29T16:18:50Z | Binance publishes public daily/monthly archives at `data.binance.vision`. Every ZIP has an adjacent publisher `.CHECKSUM`; archives may later be replaced. S-1Q verifies and freezes the exact publisher checksums it reads. |
| [Official USD-M monthly funding-rate archive](https://data.binance.vision/?prefix=data%2Ffutures%2Fum%2Fmonthly%2FfundingRate%2F) | 2026-07-29T16:18:50Z | Official public object-listing surface. Local shared copies are read-only inputs, not canonical mutable state. |

## Causal and economic limits frozen before outcomes

- Binance documents the public funding history response but not a historical
  publication-latency bound. `PUBLICATION_CAUSALITY=UNKNOWN`; public-only `GO`
  is unavailable.
- The shared monthly funding archive schema is expected to omit `rateType` and
  `markPrice`. Unless a bounded, exact-timestamp public cross-check can prove
  every consumed row is `Regular`, `RATE_TYPE_CAUSALITY=UNKNOWN`; capital
  authority remains `NONE`.
- Kline and mark-kline opens are proxies. Order-book depth, spread, filters,
  fill probability, latency, executable capacity, and account-effective fees
  remain `UNKNOWN`.
- Current `exchangeInfo` and current `fundingInfo` cannot prove historical
  symbol membership or cadence and are excluded from the historical protocol.
