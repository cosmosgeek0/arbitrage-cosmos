# V-G2 official-source research

Retrieved on 2026-07-29 before implementation. Only official Binance and
primary methodology sources were used.

## Public archive contract

- Binance publishes Spot `klines`, `trades`, and `aggTrades` as daily and
  monthly ZIP archives with adjacent SHA-256 `.CHECKSUM` files:
  <https://github.com/binance/binance-public-data/blob/master/README.md?plain=1>
- Spot archive timestamps from 2025-01-01 onward are microseconds. V-G2
  rejects a non-microsecond 2025+ row instead of guessing its unit.
- Archived objects can be replaced after Binance identifies an issue. V-G2's
  immutable boundary is therefore the locally frozen ZIP, sidecar bytes, URL,
  length, advertised digest, and locally recomputed digest.
- Public market-data endpoints require no API key:
  <https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md>
- Klines are uniquely identified by open time. Their fields include OHLC,
  base-asset volume, quote-asset volume, trade count, and taker-buy volumes:
  <https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md>

The latest fully available twelve calendar months at retrieval were
2025-07-01 through 2026-06-30. V-G2 uses quote volume, not base volume, for
cross-asset comparison within the common USDT quote.

## Fee and execution boundary

- The current official Spot fee table publishes Regular User maker/taker fees
  of 0.100%/0.100%:
  <https://www.binance.com/en/fee/trading>
- Binance's commission FAQ explains that exact account commission can also
  include special and tax components and discounts. Exact account rates require
  authenticated account data:
  <https://github.com/binance/binance-spot-api-docs/blob/master/faqs/commission_faq.md>
- Current `exchangeInfo` and filters are public, but they are not historical
  point-in-time snapshots:
  <https://github.com/binance/binance-spot-api-docs/blob/master/filters.md>

V-G2 therefore uses a public Regular User taker scenario of 10 basis points per
fill, no BNB/VIP/promotion discount, and fractional research quantities. The
base adverse-execution proxy is 10 basis points per side; stress is 25 basis
points per side. Neither is promoted to measured historical spread or impact.
Account-effective fee, historical filter compliance, order-book fillability,
and executable capacity remain `UNKNOWN`.

## Statistical anchors

- White's Reality Check:
  <https://onlinelibrary.wiley.com/doi/abs/10.1111/1468-0262.00152>
- Holm's family-wise multiple-testing procedure:
  <https://doi.org/10.2307/4615733>
- Probability of Backtest Overfitting / CSCV:
  <https://doi.org/10.21314/JCF.2016.322>
- High-volume return premium:
  <https://doi.org/10.1111/0022-1082.00349>

PBO is reported as a diagnostic only. It does not select a trial, rescue a
failed multiplicity or lower-bound gate, or independently veto the verdict.
