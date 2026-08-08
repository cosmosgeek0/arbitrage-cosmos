# S-1Y official-source and distinctness freeze

Research checked on 2026-07-30 before the S-1Y worktree was created.

## Official Binance sources

- Binance's public-data repository documents the public
  `data.binance.vision` daily/monthly archives, USD-M futures datasets,
  SHA-256 sidecars, publication cadence, and the warning that archived files
  may later be replaced:
  <https://github.com/binance/binance-public-data/blob/master/README.md?plain=1>
- The current USD-M market-data reference documents contract klines
  (`GET /fapi/v1/klines`), mark-price klines
  (`GET /fapi/v1/markPriceKlines`), funding-rate history
  (`GET /fapi/v1/fundingRate`), and current exchange information
  (`GET /fapi/v1/exchangeInfo`):
  <https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data>
- The current USD-M general-information page documents public `NONE`
  endpoints, IP-based request limits, `429` backoff, and `418` escalation:
  <https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/general-info>
- The account commission endpoint is `USER_DATA`, not public market data.
  S-1Y therefore freezes illustrative public fee proxies and keeps the
  account-effective commission `UNKNOWN`.

The exact selected symbols were observed in the live, unauthenticated
`exchangeInfo` response as `TRADING`, `PERPETUAL`, quote `USDT`, and margin
`USDT`. Before worktree creation, every required archive ZIP and adjacent
`.CHECKSUM` for the 12 selected symbols, three datasets, and 14 months from
2025-05 through 2026-06 was probed: 1,008/1,008 returned HTTP 200. The sealed
freeze must independently bind the publisher declarations and local bytes.
All 504 adjacent publisher sidecars fetched live were also byte-identical to
the read-only local sidecars before freeze (504/504, zero mismatch).

## Material distinctness

S-1Y is a two-perpetual, cross-underlying, pairwise log-price-residual
contrarian strategy. It is not:

- S-1H Spot/perpetual basis-residual trading;
- S-1I premium-index residual tails;
- S-1N funding-tail beta matching;
- S-1P/S-1R volume- or funding-triggered basis reversion;
- active S-1X mark/index dislocation reversion;
- active S-1Z cross-sectional residual momentum;
- E-1/P-I1 same-underlying cash-and-carry; or
- a V-G Spot volume/price cohort.

That distinctness is conditional. S-1Y may not use Spot, Premium Index,
basis, funding, volume, open interest, or outcome-ranked pair selection in its
signal. Funding is PnL only. The six pairs and all 12 trials are frozen before
an archive member is opened.

## Known limitations

- Binance does not state a retention guarantee for these histories.
- `exchangeInfo` is current-only. Historical tick, lot, market-lot, minimum
  notional, status, and contract-rule snapshots are unavailable.
- Public hourly opens and mark opens are proxies, not fills.
- Historical order-book depth, spread, impact, queueing, latency, account
  commission, liquidation mechanics, and executable capacity are unavailable.
- Drawdown uses hourly marked equity from contract hourly opens, with entry and
  exit costs at their event hours and funding at settlement. It remains a
  public price proxy rather than executable account equity.
- The archive publisher can replace previously published files. S-1Y binds
  publisher sidecars and verifies admitted ZIP bytes.
- Funding publication latency and the precise ordering of funding settlement
  versus an hourly-open fill remain unknown. Official `fundingTime` values may
  carry millisecond offsets; S-1Y accepts only offsets from 0 through 59,999 ms
  after the UTC hour and uses that containing-hour mark open. Funding is booked
  only for events strictly inside an open position. Custody freezes each
  current row's `funding_interval_hours` as elapsed cadence since its prior
  settlement and checks adjacent rows plus both segment boundaries, including
  the development/deferred merge.

These limitations prevent capital authority. A positive public-proxy result
cannot become `GO`; it remains `UNMEASURED` until private/account and execution
truth exist.
