# Official-source research frozen before implementation

Research was performed on 2026-07-30 before the S-2I worktree was created.

## Archive and clock contract

Binance's official public-data repository documents daily/monthly public
archives and an adjacent SHA-256 `.CHECKSUM` for every ZIP. It also warns that
archives can be replaced. Spot archive timestamps use microseconds from
2025-01-01 onward; USD-M archive timestamps remain milliseconds.

- Public archive specification:
  <https://github.com/binance/binance-public-data>
- Spot market-data contract:
  <https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market>
- USD-M market-data contract:
  <https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data>
- USD-M change log:
  <https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/change-log>

Binance does not publish a bound on historical cross-engine clock offset.
Therefore S-2I inserts one full guard hour after the predictor bar and
identifies only publisher-timestamp association at completed one-hour UTC-bar
granularity. It makes no physical-clock causality, sub-hour, same-millisecond,
latency, or atomic-fill claim.

## Source routes

For each fixed symbol and month:

```text
data/spot/monthly/klines/{symbol}/1h/{symbol}-1h-{month}.zip
data/futures/um/monthly/klines/{symbol}/1h/{symbol}-1h-{month}.zip
data/futures/um/monthly/markPriceKlines/{symbol}/1h/{symbol}-1h-{month}.zip
data/futures/um/monthly/fundingRate/{symbol}/{symbol}-fundingRate-{month}.zip
```

Every route is rooted at `https://data.binance.vision/`; `.CHECKSUM` is
appended for the publisher digest.

## Costs, funding, and capacity boundary

The current public USD-M fee explanation uses 2 bp maker and 5 bp taker as a
regular-user example, not account truth:
<https://www.binance.com/en/support/faq/detail/360033544231>.
The signed commission-rate endpoint is private USER_DATA, so S-2I never calls
it and keeps account-effective commission `UNKNOWN`.

Funding is sourced from publisher monthly archives and booked only as PnL.
Current public funding-history semantics are documented at:
<https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#get-funding-rate-history>.

There is no documented synchronized historical Spot/USD-M order book covering
the study window. Quote-volume participation is only a public flow proxy.
Executable capacity, spread, impact, queue position, historical filters,
liquidation safety, and USDT-to-fiat-USD equivalence remain unmeasured.

## Structural break

The USD-M change log records introduction of RPI orders on 2025-11-18.
Hourly kline S-2I does not claim invariant microstructure across that date and
reports pre/post-break economics separately as a limitation diagnostic.

## Pinned documentation identities

- `binance/binance-public-data` inspected at
  `5c7f3197591c0d54d85dc43066226bc4c671d47a`
- `binance/binance-spot-api-docs` inspected at
  `6b8372cad7cecbdf5dd88a3372eafff51988c5cf`

These pins identify the inspected documentation, not immutable archive bytes.
The source manifest separately pins every sidecar and ZIP SHA-256.
