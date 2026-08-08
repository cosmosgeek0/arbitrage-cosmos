# V-G37 official-source research pin

Accessed 2026-07-29T18:32Z, before implementation. Public Spot only.

## Current official facts used

- Binance Spot `GET /api/v3/klines` identifies a bar by open time. The
  zero-based field 7 is `Quote asset volume`; `1d` is a supported interval.
  `startTime` and `endTime` are UTC even when another display timezone is
  requested. Source:
  <https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market>
- `GET /api/v3/exchangeInfo` exposes exact symbol, status, base asset, quote
  asset, Spot permission, and filters. This packet does not rewrite its
  historical archive universe from current status. Source:
  <https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/general>
- `data-api.binance.vision` is the official market-data-only host and needs no
  API key. Source:
  <https://developers.binance.com/en/docs/products/spot/faqs/market_data_only>
- The official public archive publishes daily and monthly Spot ZIPs and a
  sibling SHA-256 `.CHECKSUM`. Binance warns that archive files may be replaced
  after data issues are found. Spot archive timestamps from 2025-01-01 onward
  are microseconds. Source revision:
  <https://github.com/binance/binance-public-data/blob/de6bdec7520bcae888d66c362257f120dfc9d65b/README.md>
- Public REST timing and rate-limit rules do not apply during the sealed
  evaluation because it is network-free. Source:
  <https://developers.binance.com/en/docs/products/spot/rest-api>

## Research boundary

The signal uses only public archive symbol, UTC open time, and quote-asset
volume. The fixed USDT trade cohort makes quote-volume units comparable. No
credential, signed endpoint, account fee, wallet, order, host, provider, or UI
surface is used.

The public archive provides trade-print volume, not spread, depth, impact,
account commission, fill probability, or executable capacity. Those remain
`UNKNOWN` or `UNMEASURED`; fee and adverse-price values are explicit public
stress assumptions.

One pre-protocol schema probe displayed the first three rows of
`BTCUSDT-1d-2025-01.zip`. It established the documented post-2025 microsecond
unit and 12-column shape; it calculated no signal, return, statistic, or gate,
and it is development warm-up rather than holdout evidence. The sealed run law
still requires a durable marker before the evaluator opens any member.

## Primary research consulted for design, not proof

- Chordia, Roll, and Subrahmanyam, *Commonality in liquidity*:
  <https://doi.org/10.1093/rfs/hhw026>
- White, *A Reality Check for Data Snooping*:
  <https://doi.org/10.1111/1468-0262.00152>
- Bailey et al., *The Probability of Backtest Overfitting*:
  <https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2326253>

These motivate a commonality measurement and multiple-testing controls. They do
not establish that V-G37 predicts returns or is profitable.
