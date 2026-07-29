# V-G13 official source freeze

Confirmed independently against the current official Binance repositories on
2026-07-29 before implementation. The immutable commit URLs and SHA-256 content
digests are bound in `official-source-freeze.v1.json`.

## Public archive

The official `binance-public-data` README says:

- Spot daily archives become available the next day and monthly archives on the
  first Monday of the month.
- Spot timestamps from 2025-01-01 onward are in microseconds.
- Spot kline rows contain open time, OHLC, base volume, close time, quote asset
  volume, trade count, taker-buy volumes, and an ignored field.
- Every archive zip has a sibling checksum, and archived files may later be
  replaced when issues are discovered.

V-G13 therefore admits only checksum-verified daily Spot `1d` archive files,
normalizes the documented microsecond timestamps explicitly, and binds every
archive/checksum byte before parsing. An unavailable, changed, malformed,
duplicate, or gapped necessary row is terminal `UNMEASURED`; it is never
repaired, dropped, deduplicated, substituted, or retried.

## Spot klines and market-only boundary

The official Spot REST documentation says `GET /api/v3/klines` bars are uniquely
identified by open time, default to UTC, and expose open/close prices plus quote
asset volume. The market-data-only FAQ says `data-api.binance.vision` needs no
API key and serves public endpoints including `exchangeInfo` and `klines`.

V-G13 uses only public Spot market data. It makes no private, signed, account,
order, test-order, transfer, borrowing, or execution request.

## Filters and fees

The official filters document says filters are symbol/exchange trading rules and
defines `PRICE_FILTER`, `LOT_SIZE`, `MIN_NOTIONAL`, `NOTIONAL`, and
`MARKET_LOT_SIZE`. V-G13 does not claim historical executable filter compliance:
filters are `UNKNOWN`.

The official commission FAQ says its displayed rates are fictional and actual
current rates come from authenticated account commission queries or a
commission-computing test order. Those private/action-bearing paths are outside
this public study. The fixed 10 bp per side fee is therefore a declared public
research proxy only; account fees remain `UNKNOWN`.

## Research authority

The source freeze supports a market-data-only public research result. It grants
no capital, trading, deployment, account, or execution authority:
`authority = NONE`.
