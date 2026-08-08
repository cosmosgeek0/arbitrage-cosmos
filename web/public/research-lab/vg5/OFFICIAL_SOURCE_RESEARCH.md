# V-G5 official-source freeze

Observed on 2026-07-29 UTC, before evaluator outcomes:

- Binance's official public-data specification documents Spot daily/monthly kline
  archives, sibling `.CHECKSUM` files, first-Monday monthly publication, next-day
  daily publication, a 2025-01-01 Spot timestamp change from milliseconds to
  microseconds, and the possibility that archive files are later replaced.
  V-G5 therefore binds exact already-acquired ZIP and sidecar hashes rather than
  trusting mutable paths. Because every required month is in 2025 or later, the
  parser requires microseconds for both timestamps and exact UTC daily boundaries;
  it does not coerce either integer from another unit.
- Binance's official fee table displayed 0.100% maker and 0.100% taker for a
  regular user. The displayed 0.075% BNB rate is conditional. V-G5 assumes neither
  BNB payment, VIP status, promotions, special commission, nor tax commission.
- Binance's official Spot REST documentation identifies public market-data
  endpoints and signed account commission endpoints. Current public metadata is
  not used as historical listing proof, and account-effective commission remains
  `UNKNOWN`.

Primary sources:

- <https://github.com/binance/binance-public-data/blob/master/README.md>
- <https://www.binance.com/en/fee/trading>
- <https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints>

The source observations freeze public modelling inputs only. They do not establish
historical spread, depth, queue position, filters, impact, account commission, or
capital authority.
