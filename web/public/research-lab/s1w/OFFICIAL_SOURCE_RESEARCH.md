# S-1W official-source research

Checked on 2026-07-30 before implementation. Only official Binance sources were
used for the source contract.

The official documentation pages were inspected in a rendered web client. Their
direct command-line URLs currently return an AWS WAF challenge (`HTTP 202`, empty
body). The source-observation command records that challenge instead of pretending
the missing response body proves missing documentation.

## Current official contracts

| Source | Current fact used by S-1W |
|---|---|
| https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#open-interest-statistics | `GET /futures/data/openInterestHist`; period-end `timestamp`; `sumOpenInterest` and `sumOpenInterestValue`; maximum 500 rows; only the latest one month is available |
| https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#get-funding-rate-history | `GET /fapi/v1/fundingRate`; ordered settlement records; current REST response includes `fundingRate`, `fundingTime`, settlement-associated `markPrice`, and `rateType` |
| https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#mark-price-kline-candlestick-data | Mark-price bars identify open/close time and OHLC; auxiliary positions are documented as ignored |
| https://github.com/binance/binance-public-data | Public daily/monthly archives; daily files arrive the next day, monthly files on the first Monday; adjacent `.CHECKSUM` files verify the acquired ZIP; archives may later be replaced |
| https://data.binance.vision/ | Official archive publisher used for the frozen artifact observations |

## Observed official archive artifacts

The source-inspection command downloads fixed closed-period samples and their
adjacent checksum sidecars, validates SHA-256, requires one safe CSV member, and
records the exact headers and digests in
`generated/source-observations.v1.json`.

Observed archive layouts:

```text
data/futures/um/daily/metrics/{SYMBOL}/{SYMBOL}-metrics-YYYY-MM-DD.zip
data/futures/um/monthly/fundingRate/{SYMBOL}/{SYMBOL}-fundingRate-YYYY-MM.zip
data/futures/um/monthly/klines/{SYMBOL}/1h/{SYMBOL}-1h-YYYY-MM.zip
data/futures/um/monthly/markPriceKlines/{SYMBOL}/1h/{SYMBOL}-1h-YYYY-MM.zip
```

Observed headers:

```text
metrics:
create_time,symbol,sum_open_interest,sum_open_interest_value,count_toptrader_long_short_ratio,sum_toptrader_long_short_ratio,count_long_short_ratio,sum_taker_long_short_vol_ratio

fundingRate:
calc_time,funding_interval_hours,last_funding_rate
```

The archive `fundingRate` rows omit the current REST `markPrice` and `rateType`
fields. S-1W would therefore use an explicitly disclosed lagged mark-bar proxy and
would keep funding rate type unknown.

## Terminal causal finding

The official archive pages and README do not define:

- the semantic mapping from archive `create_time` to the REST period-end
  `timestamp`;
- the historical publication or availability time of a metrics row;
- the historical point-in-time publication or availability of the funding sign
  used for side assignment from the monthly funding archive;
- a historical point-in-time revision identifier;
- whether the bytes now in an old archive equal the rows observable through the
  REST endpoint at the proposed historical decision time.

Daily archive availability on the next day is not historical decision-time
availability. Archive checksums authenticate the acquired revision; they do not
prove when its rows were observable or whether an old object was later replaced.
Because the REST endpoint retains only the latest month, the missing point-in-time
fact cannot now be reconstructed for the frozen 12-month evaluation window.

S-1W therefore stops `UNMEASURED` before any development or holdout outcome
archive is opened. An event-time-lagged ex-post association could be computed, but
it is not substituted for the requested causal verdict.

BTCUSDT was used only for schema/source observation. Because bounded reviewers
opened BTCUSDT metrics, funding-rate, and book-depth sample rows from July 2025,
plus metrics, funding-rate, contract-kline, and mark-price-kline rows from June
2026, and metrics, funding-rate, and 5-minute mark-price-kline rows from January
2025, before the S-1W freeze, the symbol is quarantined from the entire planned
outcome cohort. Ten unique archive members were opened; all ten are quarantined.
This disposition is frozen in `PRE_FREEZE_EXPOSURE.v1.json`.
