# DQ-13 current primary-source research

Checked 2026-07-30 before implementation. Only Binance-owned documentation was
used for exchange semantics. DQ-13 performs no live documentation or market
fetch during validation.

## Frozen source snapshot

| Source | Revision or retrieval evidence | DQ-13 use |
|---|---|---|
| [Binance Spot WebSocket streams](https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/web-socket-streams.md) | commit `6b8372cad7cecbdf5dd88a3372eafff51988c5cf`; raw SHA-256 `32bf73a0bed3b75e3ca981fdbaf48c53544bbdfb5944ef8ed1c4d7af9aceba0a` | kline `E/t/T/x`, final flag, inclusive close, stream cadence, optional microsecond mode |
| [Binance Spot REST API](https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/rest-api.md) | same commit; raw SHA-256 `49ea6809243fc7fb426e07f2fe662097736c7bb405bd2da5eef637d715427999` | kline open-time identity, close field, UTC/request-time-zone boundary |
| [Binance public-data README](https://github.com/binance/binance-public-data/blob/5c7f3197591c0d54d85dc43066226bc4c671d47a/README.md) | commit `5c7f3197591c0d54d85dc43066226bc4c671d47a`; raw SHA-256 `085ab91377aa9325d44f4c7ad27cce4ab381e158403e1d7df2bad39d1a66f7c6` | Spot 2025 microsecond cutover, archive cadence, checksums, replacement warning |
| [Binance Spot timing rules](https://developers.binance.com/en/docs/products/spot/rest-api) | retrieved 2026-07-30 within Binance `llms-full.txt` snapshot SHA-256 `ec4e23cdd90ea7aacab7c14b2ed323fb82c90c87029762be11512aab3194ed32` | REST millisecond default and explicit microsecond request mode |
| [Binance USD-M REST market data](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) | same retrieved documentation snapshot | kline, mark/index kline, funding history, funding info, and current exchange info fields |
| [Binance USD-M WebSocket market data](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market) | same retrieved documentation snapshot | kline final/event fields, instant mark/index event fields, and update-speed expectations |
| [Binance USD-M timing rules](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/general-info) | same retrieved documentation snapshot | USD-M time/timestamp fields are milliseconds |
| [Binance Spot public kline API](https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=3d&limit=3) | live public response checked 2026-07-30 together with `1w` and `timeZone=8` requests | fixed-step UTC/local phase cross-check before freezing v1 |

The GitHub revisions are immutable content pins. The
`developers.binance.com` digest is retrieval evidence for a mutable official
documentation aggregate, not a claim that the website is immutable.

## Official facts used

- Spot kline streams separate outer event time `E`, interval start `t`,
  inclusive close `T`, and closed flag `x`. Spot REST kline tuples separately
  expose open and close times.
- Spot REST klines accept a `timeZone` parameter. Spot market-data streams
  separately document `<symbol>@kline_<interval>@+08:00`, whose intervals open
  and close in UTC+8 while payload timestamps remain Unix timestamps.
- Spot REST and streams default to milliseconds and support an explicit
  microsecond mode. Spot public archive timestamps switch to microseconds from
  2025-01-01. USD-M documentation specifies milliseconds.
- USD-M funding history exposes `fundingTime` for the funding event and a mark
  price associated with that funding charge. The endpoint does not document a
  historical publication clock.
- USD-M `fundingInfo` has no observation/update timestamp.
- USD-M `exchangeInfo` is current metadata. Its `serverTime` is documented as
  unsuitable for current time; Spot `exchangeInfo` also lacks a metadata
  last-modified/version timestamp.
- A mark-price stream's next funding time is a future schedule field, not the
  event time, availability time, fill time, or proof of a realized funding
  charge.
- Public archive files appear after their event intervals and may later be
  replaced. Event time or path identity therefore does not prove historical
  availability or immutable bytes.

## DQ-13 policy, not Binance guarantees

The following are conservative project rules:

- source profile, unit, and clock uncertainty must be explicit;
- native millisecond precision remains a range after normalization;
- interval outputs become semantically complete only at the exclusive end and
  require final/receipt evidence;
- fixed interval opens must match the frozen local-zone phase observed before
  v1: local epoch grids through daily, local day-one modulo three days, and
  local Monday for weekly; a future exchange phase change requires a new policy
  version rather than silent acceptance;
- v1 narrows shifted-zone support to the endpoint profiles that identify it:
  Spot REST and documented Spot UTC+8 streams. Spot archives and USD-M
  interval profiles remain UTC-only because the frozen sources do not identify
  a shifted series for those profiles;
- availability is a persisted receipt or separately frozen release proof;
- selection is exact-key and backward on known-by evidence;
- current metadata begins no earlier than receipt and expires right-open;
- settled funding and projected funding are different feed meanings;
- missing, stale, ambiguous, or conflicting evidence is `UNKNOWN`;
- only a complete `VALID` multi-feed chain is admissible.

Binance does not prove the caller's local receipt clock, clock-error bound,
ingest order, expected feed coverage, or consumer freshness tolerance. DQ-13
validates those supplied claims but cannot independently establish them.
