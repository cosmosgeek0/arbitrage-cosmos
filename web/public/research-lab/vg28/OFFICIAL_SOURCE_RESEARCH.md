# V-G28 official Binance source research

Research checked on 2026-07-29 before implementation. Only Binance-owned
documentation, Binance-owned public data, and Binance-owned repositories are
admissible.

| source | current official fact | V-G28 use |
|---|---|---|
| [Spot kline reference](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market#klinecandlestick-data) | `GET /api/v3/klines`; bars are keyed by open time; `1h` is supported; the twelve-field response includes open and quote-asset volume | schema meaning only |
| [Market Data Only FAQ](https://developers.binance.com/en/docs/products/spot/faqs/market_data_only) | `data-api.binance.vision` needs no authentication and serves public market-data endpoints including klines | confirms public-only boundary; no key |
| [Binance public-data README](https://github.com/binance/binance-public-data/blob/master/README.md) | `data.binance.vision` publishes daily/monthly files; Spot kline field 7 is quote-asset volume; monthly `1h` paths and adjacent checksum verification are documented | sole historical corpus and archive schema |
| [Official Python path helpers](https://github.com/binance/binance-public-data/tree/master/python) | Binance publishes programmatic download helpers | path cross-check only; the frozen packet constructs the disclosed monthly URL itself |
| [Official shell path helper](https://github.com/binance/binance-public-data/blob/master/shell/download-klines.sh) | Binance publishes a kline archive download helper | path cross-check only; no helper output is outcome evidence |
| [Spot fee table](https://www.binance.com/en/fee/trading) | the current regular-user Spot table displays `0.100% / 0.100%` maker/taker before shown discounts | justifies a current public 10 bp-per-fill schedule proxy |
| [Commission FAQ](https://developers.binance.com/en/docs/products/spot/faqs/commission_faq) | commissions can include standard, tax, special, promotion, and discount effects; examples are explicitly fictional; current account rates are queried through account-specific interfaces | public schedule cannot establish historical or account-effective fees |
| [Query Commission Rates](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/account#query-commission-rates-user_data) | `GET /api/v3/account/commission` returns current account commission rates and is signed `USER_DATA` | not called; proves account truth is private and outside authority |

## Archive facts frozen into the contract

The official public-data README says Spot archive timestamps from
2025-01-01 onward are in microseconds. V-G28 therefore validates the
January 2025 through June 2026 archive grids in microseconds, even though the
live REST reference describes its default response timestamps separately.

The exact archive path is:

```text
https://data.binance.vision/data/spot/monthly/klines/{SYMBOL}/1h/{SYMBOL}-1h-{YYYY-MM}.zip
```

The adjacent integrity object is the same path with `.CHECKSUM` appended.
Existing cached objects are not trusted by filename. `inventory` must
re-admit only exact raw ZIP and checksum bytes after official path identity,
published checksum validation, and a fresh local SHA-256 inventory. No prior
decompressed member, feature, result, trial score, champion, or holdout outcome
may be reused.

## Fee and execution truth

The frozen `10` bp fee per fill is a public-schedule proxy observed on the
current fee table. It is not the fee paid by any account and is not evidence of
the fee that applied during 2025-2026. The official commission material says
account, symbol, side, discounts, promotions, tax, and special commission can
matter, while the precise current endpoint is signed `USER_DATA`.
V-G28 does not call it. Account-effective fees remain `UNKNOWN`.

Entry and exit use public hourly opens with fixed adverse adjustments of
`10`, `25`, and `50` bp per fill. No source used here supplies historical
spread, depth, queue position, latency, partial-fill, market-impact, rejection,
or executable-capacity truth. The reported one-basis-point capacity is only a
causal trailing public quote-volume proxy. Execution authority remains `NONE`.
