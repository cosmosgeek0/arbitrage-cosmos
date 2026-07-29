# S-1T official source research

Research refreshed on 2026-07-29 before packet code or outcome inspection.
Only official Binance documentation and public-data surfaces are protocol
authorities. No authenticated endpoint was called.

## Current official contracts

1. [USD-M funding-rate history](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#get-funding-rate-history)
   documents public `GET /fapi/v1/fundingRate`, ascending pagination, inclusive
   `startTime` and `endTime`, maximum `limit=1000`, and a shared
   500-requests-per-five-minutes-per-IP limit with `fundingInfo`. Its response
   has `symbol`, `fundingRate`, `fundingTime`, `markPrice`, and current
   `rateType` semantics (`Regular` or stock-dividend `Special`).
2. [USD-M funding-rate info](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#get-funding-rate-info)
   documents public `GET /fapi/v1/fundingInfo` for symbols with adjusted caps,
   floors, or `fundingIntervalHours`. It is a current-state response. It has no
   historical effective timestamp and therefore MUST NOT be backfilled over
   historical rows.
3. [USD-M exchange information](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#exchange-information)
   is current trading-rule and symbol information. Current membership, status,
   filters, or `contractType` MUST NOT be treated as historical truth.
4. [User commission rate](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/account#user-commission-rate-user_data)
   is a signed `USER_DATA` endpoint. The documentation example is 4 bp taker,
   but an account's effective fee is private, tiered, discount-sensitive, and
   therefore `UNKNOWN` in S-1T. S-1T never calls it.
5. The current public [Binance Futures fee schedule](https://www.binance.com/en/fee/futureFee)
   is client-rendered and changeable. S-1T freezes a conservative public proxy
   of 5 bp per taker fill, with 8 bp and 10 bp stress rates. These are scenario
   inputs, not an account-fee claim.
6. [Binance Public Data](https://github.com/binance/binance-public-data/blob/master/README.md)
   states that public market data is published as daily or monthly files, that
   monthly data is normally posted on the first Monday of the month, and that
   every ZIP has an adjacent `.CHECKSUM` file for SHA-256 verification. It also
   warns that archived files may later be corrected.
7. The official archive root is
   `https://data.binance.vision/data/futures/um/monthly`. S-1T uses:
   `fundingRate/{symbol}/{symbol}-fundingRate-{month}.zip`,
   `markPriceKlines/{symbol}/1h/{symbol}-1h-{month}.zip`, and
   `klines/{symbol}/1h/{symbol}-1h-{month}.zip`, plus each adjacent
   `.CHECKSUM`.

## Prior schema exposure disclosure

Before the S-1T lifecycle was sealed, the first CSV header was decompressed from
each of these cached official holdout members:

- `fundingRate/BTCUSDT/BTCUSDT-fundingRate-2026-06.zip`:
  `calc_time,funding_interval_hours,last_funding_rate`
- `markPriceKlines/BTCUSDT/1h/BTCUSDT-1h-2026-06.zip` and
  `klines/BTCUSDT/1h/BTCUSDT-1h-2026-06.zip`:
  `open_time,open,high,low,close,volume,close_time,quote_volume,count,taker_buy_volume,taker_buy_quote_volume,ignore`

Exactly zero data rows and zero outcome values were read. This is nevertheless
a real member open. Those three members are therefore recorded as
`HEADER_ONLY_SCHEMA_EXPOSED`, not `SEALED_UNOPENED`. All their data rows remain
outcome-sealed. Every other April–June member remains `SEALED_UNOPENED` until
the conditional holdout gate.

## Frozen interpretation

- Historical cadence is the positive integer `funding_interval_hours` carried
  by each official archive row and is cross-checked against adjacent settlement
  timestamps. It is not reconstructed from today's `fundingInfo`.
- Monthly archive rows are retrospective. The archive documentation does not
  establish when a historical row was observable through a public live surface.
  The simulated entry clock is therefore not called causal, as-of, or lag-safe.
- A historical transition is an observed settlement-cadence association, not
  proof of an announcement, effective policy timestamp, cap/floor change, or
  exogenous intervention.
- `rateType` is absent from the selected archive schema. The screen therefore
  determines eligibility only from symbols matching `^[A-Z0-9]+USDT$` with
  complete June-2025 funding-rate, mark-price, and contract-kline evidence and a
  stable 8-hour June history. For every eligible symbol, all 720 June
  `klines/1h` `quote_volume` tokens are summed with exact base-10 decimal
  arithmetic. Eligible symbols are ranked by that total descending and raw
  ASCII symbol ascending; ranks 1 through `min(100, eligible_count)` are fixed
  as the research universe. The ledger preserves every eligible total, rank,
  and `SELECTED` or `REJECTED_BY_RANK` disposition.
- The estimand is only that frozen June-2025 top-100 contract-quote-volume
  stable-8h universe. No current endpoint or July-2025-or-later availability,
  metadata, or value may admit, exclude, rerank, pad, or replace a symbol. No
  other rank cutoff is computed or tested. The six-row event baseline
  separately rejects launch-at-short-cadence observations.
- Archive publication latency, historical spread, depth, queue position,
  impact, filter history, account fees, and executable capacity remain
  `UNKNOWN`.
- Cached official ZIPs and sidecars are independently checked, copied without
  hardlinks into exclusive read-only packet files, and rehashed before and after
  every member open. The frozen inventory records missing paths for the selected
  universe instead of using later availability to revise or refill it. Because
  Binance may revise archives, S-1T claims equality only to these digest-bound
  cached bytes, not to a later remote revision.
