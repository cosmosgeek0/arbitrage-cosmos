# S-1L official source research

Research was completed on 2026-07-29 before the evaluator or outcome protocol
was written.

## Chosen product surface

S-1L uses Binance USD-M dated quarterly BTCUSDT and ETHUSDT futures against
the same pair's USD-M perpetual. The current public `exchangeInfo` schema
exposes `contractType`, `deliveryDate`, `onboardDate`, status, assets, and
filters for dated and perpetual contracts. Exact dated symbols are used for
all fills; `continuousKlines` are never execution data because the contract
identity changes when Binance rolls the series.

USD-M was selected over COIN-M before outcomes for three evidence reasons:

1. linear USDT P&L avoids an extra inverse-contract and coin-collateral
   conversion layer in a dollar-normalized verdict;
2. BTC and ETH are the complete currently listed USD-M quarterly underlying
   set and have dated archive prefixes back through the declared window; and
3. the official USD-M archive contains dated-contract `bookDepth` for the
   whole 2023-Q1 through 2026-Q2 window, while the inspected COIN-M dated
   `bookTicker` surface becomes incomplete before the desired holdout ends.

Current ticker values were inspected only as corroboration and never select or
weight the historical universe.

## Primary official sources

- USD-M REST market-data catalog and exchange information:
  <https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data>
- Live public exchange information:
  <https://fapi.binance.com/fapi/v1/exchangeInfo>
- Official Binance public-data archive description and checksum contract:
  <https://github.com/binance/binance-public-data/blob/master/README.md?plain=1>
- Official public archive:
  <https://data.binance.vision/?prefix=data/futures/um/>
- Funding mechanics:
  <https://www.binance.com/en/support/faq/detail/360033525031>
- Futures fee explanation:
  <https://www.binance.com/en/support/faq/detail/360033544231>

## Frozen rule interpretations

- Quarterly delivery is the last Friday of March, June, September, or December
  at 08:00 UTC for the declared symbols. S-1L exits at least 23 hours before
  that time, so it never substitutes a settlement index for an executable
  close, never rolls, and never incurs a delivery settlement fee.
- Funding belongs only to the perpetual leg. The evaluator books each archived
  event at its actual timestamp; it does not synthesize an eight-hour schedule.
  The archive does not carry an exact funding mark, so the contemporaneous
  hourly perpetual mark open is frozen as a public proxy.
- Binance's public fee page did not expose a stable machine-readable account
  schedule in this environment. The official FAQ's 5 bp taker example is used
  only as a conservative public proxy. VIP, BNB discount, promotions, tax
  commission, and account-effective commission remain `UNKNOWN`.
- Public depth contains cumulative notional at percentage bands. S-1L binds the
  latest directional plus/minus 0.20% snapshot no older than 60 seconds at each
  fill. It is a coarse 20 bp capacity proxy, not proof of top-of-book spread,
  2 bp execution, queue position, realized impact, or account capacity.
- Binance documents that archive ZIPs may later be corrected. The freeze binds
  each planned object by listing metadata; acquisition then binds its adjacent
  official checksum and local SHA-256 before decompression.

## Rejected evidence substitutions

- the latest-30-day `/futures/data/basis` endpoint for a multi-year result;
- `continuousKlines` for dated-contract returns;
- mark or index prices as executable fills;
- candle volume as executable capacity;
- a public or hypothetical fee as account truth;
- current `exchangeInfo` as proof of historical tick, lot, or status filters;
- missing rows, missing archives, or partial clusters as economic zero.

These boundaries make the result public research only. They do not authorize
an account, provider, order, transfer, withdrawal, host, deployment, or money
action.
