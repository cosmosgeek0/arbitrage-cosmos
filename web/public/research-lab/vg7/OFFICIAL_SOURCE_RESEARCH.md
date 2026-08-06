# V-G7 official-source research freeze

Accessed `2026-07-29` before evaluator implementation.

## Data

- Binance's official public-data repository documents daily and monthly Spot
  archives, the kline schema, SHA-256 `.CHECKSUM` sidecars, and the possibility
  of later archive corrections:
  <https://github.com/binance/binance-public-data/blob/master/README.md>
- Repository HEAD observed before implementation:
  `5c7f3197591c0d54d85dc43066226bc4c671d47a`.
- Binance Data Vision is the official archive host:
  <https://data.binance.vision/>.
- Spot kline archives use the REST kline schema. Klines are uniquely identified
  by open time:
  <https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market>.
- Spot archive timestamps are microseconds from `2025-01-01`. V-G7 therefore
  rejects millisecond rows throughout its `2025-03`–`2026-06` source window.
- The public market-data-only host is documented at:
  <https://developers.binance.com/en/docs/products/spot/faqs/market_data_only>.

The selected immutable local corpus is the official-checksum-bound,
not-yet-decompressed S-1F acquisition at
`/private/tmp/cosmos-s1f-weekly-momentum-cash-v1`. V-G7 rehashes the bounded
compressed subset and its publisher sidecars without modifying shared bytes.
The pre-freeze audit also disclosed that the official-checksummed
`AERGOUSDT-1d-2025-03.zip` member fails the daily-close boundary contract.
The frozen protocol treats every semantically invalid warmup symbol-month as
wholly unavailable, never repairs a row, preserves the symbol, and requires 90
new consecutive valid prior days before eligibility. A semantic defect in a
measurement month invalidates the sealed measurement.

## Fees and execution

- The current public Spot schedule displays regular-user maker/taker fees of
  `0.100% / 0.100%`:
  <https://www.binance.com/en/fee/trading>.
- Binance documents that actual commission may include standard, special, tax,
  buyer/seller, maker/taker, and conditional BNB-discount components:
  <https://developers.binance.com/en/docs/products/spot/faqs/commission_faq>.
- Current public filters are documented at:
  <https://developers.binance.com/en/docs/products/spot/filters>.
- Repository HEAD for Binance Spot API documentation observed before
  implementation:
  `6b8372cad7cecbdf5dd88a3372eafff51988c5cf`.

Public kline opens are reference prices, not fill proofs. The public regular
fee is a current sensitivity, not historical account truth. Account-effective
fees, special/tax commission, historical filter snapshots, spread, queue
position, depth, partial fills, market impact, and executable capacity remain
`UNKNOWN`, `UNAVAILABLE`, or `UNMEASURED` as appropriate.

## Frozen execution banner

`PUBLIC_BAR_EXECUTION_SENSITIVITY_ONLY; ACCOUNT_EFFECTIVE_FEES=UNKNOWN; HISTORICAL_FILTER_ADMISSIBILITY=UNKNOWN; HISTORICAL_BOOK=UNAVAILABLE; VERIFIED_EXECUTABLE_CAPACITY=UNMEASURED; EXECUTION_AUTHORITY=NONE.`
