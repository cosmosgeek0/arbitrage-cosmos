# S-1J official-source research freeze

Research was completed on 2026-07-29 before implementation and before S-1J
scored any outcome. A hostile schema preflight sampled the header/first row of
three reused BTCUSDT members before freeze. BTCUSDT is therefore quarantined
from the S-1J universe; no sampled value can enter this experiment.

## Current primary sources

- Binance USD-M market-data documentation:
  <https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data>
- Binance Spot REST documentation:
  <https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api>
- Binance public-data archive contract:
  <https://github.com/binance/binance-public-data/blob/master/README.md?plain=1>
- Binance Spot fee schedule:
  <https://www.binance.com/en/fee/trading>
- Binance Spot account commission endpoint:
  <https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/account>
- Binance USD-M account commission endpoint:
  <https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/account>

## Frozen source conclusions

`GET /fapi/v1/fundingRate` is public and returns actual funding timestamps. The
current response also includes event mark price and rate type, but the official
monthly archive used here has only `calc_time`, `funding_interval_hours`, and
`last_funding_rate`. S-1J therefore uses actual archive timestamps and a
same-hour mark-price-kline proxy. It never assumes an eight-hour interval.
The archived interval field must provide continuous coverage for every signal
and holding window. Archive `+1ms` stamps are assigned to their settlement hour,
and the entry and exit hours are conservatively excluded from funding PnL.

Official archive ZIPs have adjacent `.CHECKSUM` files. Binance documents that
archives may later be replaced. S-1J binds the already checksum-verified parent
manifests, recomputes each opened ZIP SHA-256, and reads those shared bytes
without mutation. Spot archive timestamps switch from milliseconds to
microseconds beginning 2025-01-01; the parser normalizes by magnitude. Missing
archives or cohorts stay missing, never economic zero.

Public archives do not contain uniform historical Spot BBO, depth, hypothetical
queue position, or paired order state. Maker entry is consequently a
non-authoritative sensitivity. The decision cases instead use an immediate
paired taker-at-open proxy; daily Spot data cannot identify a later fallback
price. Daily Spot data also makes spread, adverse selection, intraday path, and
capacity conditional proxies.

The public Spot regular-user schedule is only a current fee proxy. Effective
Spot and USD-M commissions require signed account endpoints. VIP tier,
promotions, BNB discounts, tax/special commission, historical fee schedules,
and account-specific effective fees are not public archive truth. They remain
`UNKNOWN`; no signed/private endpoint is called.

Current `exchangeInfo` cannot prove historical membership or historical
filters. It is not used to select the backtest universe. Exact-name common
June-2024 archive presence is the frozen point-in-time screen, followed by
strictly causal per-entry liquidity eligibility. Historical filter
executability and true paired capacity remain `UNKNOWN`.
