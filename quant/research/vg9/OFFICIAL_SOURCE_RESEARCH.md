# V-G9 official-source research freeze

Checked and frozen on 2026-07-29 before implementation and before any V-G9 archive
body access.

## Official Binance sources

- Public archive layout, monthly/daily files, CHECKSUM sidecars, Spot and USD-M
  kline quote-asset-volume fields, archive replacement caveat, and the Spot
  microsecond switch from 2025-01-01:
  <https://github.com/binance/binance-public-data>
- Public Spot market-data-only URLs require no authentication:
  <https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md>
- Current Spot REST contract:
  <https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md>
- Current USD-M public market-data contract, including `/fapi/v1/klines`, unique
  kline open times, and quote-asset volume:
  <https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data>
- Current public Spot trading-fee schedule:
  <https://www.binance.com/en/fee/trading>
- Account commission rates are authenticated `USER_DATA` and require an API key and
  signed timestamp:
  <https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/account#query-commission-rates>

## Frozen interpretation

Spot monthly `1d` rows and USD-M monthly `1h` rows both expose quote-asset volume.
V-G9 normalizes Spot microseconds and USD-M milliseconds, requires unique aligned
opens, and aggregates exactly 24 complete USD-M UTC hourly bars into a daily signal
observation. Missing, duplicated, off-grid, cross-day, or partial evidence is not
filled or converted to zero.

The archive path itself is the point-in-time symbol inventory. V-G9 uses exact
common `^[A-Z0-9]+USDT$` archive presence month by month and then causal trailing
bar eligibility. It does not call current `exchangeInfo`, backfill a historical
listing state, or require a symbol to survive through future months.

The regular-user 10 bp Spot fee is a public scenario, not account truth. Base uses
10 bp fee plus 10 bp adverse execution per fill; stress uses 10 bp fee plus 25 bp
adverse execution per fill. No BNB, VIP, promotion, special commission, or tax
discount is assumed. Account-effective fees remain `UNKNOWN`.

Quote volume is not historical book depth, spread, queue priority, hypothetical fill
proof, or executable capacity. Participation is a public proxy only; executable
depth and capacity remain `UNKNOWN`.
