# DQ-1 official source research

Checked 2026-07-30 before implementation. Only Binance-owned documentation and
`data.binance.vision` public archive objects were used.

## Pinned documentation

| Source | Immutable revision | Raw content SHA-256 | DQ-1 use |
|---|---|---|---|
| [Binance public-data README](https://github.com/binance/binance-public-data/blob/5c7f3197591c0d54d85dc43066226bc4c671d47a/README.md) | `5c7f3197591c0d54d85dc43066226bc4c671d47a` | `085ab91377aa9325d44f4c7ad27cce4ab381e158403e1d7df2bad39d1a66f7c6` | 12-field kline schema, daily/monthly layout, Spot 2025 microsecond cutover, SHA-256 sidecars, archive replacement warning |
| [Binance Spot REST API](https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/rest-api.md#klinecandlestick-data) | `6b8372cad7cecbdf5dd88a3372eafff51988c5cf` | `49ea6809243fc7fb426e07f2fe662097736c7bb405bd2da5eef637d715427999` | kline open-time logical identity, `1d` interval, default UTC time zone, response fields |
| [Binance Spot WebSocket streams](https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/web-socket-streams.md#klinecandlestick-streams-for-utc) | `6b8372cad7cecbdf5dd88a3372eafff51988c5cf` | `32bf73a0bed3b75e3ca981fdbaf48c53544bbdfb5944ef8ed1c4d7af9aceba0a` | corroborating UTC stream and start/close field semantics |

The public-data repository head was independently verified as
`5c7f3197591c0d54d85dc43066226bc4c671d47a`. The Spot API documentation head
was independently verified as `6b8372cad7cecbdf5dd88a3372eafff51988c5cf`.

## Official facts frozen by DQ-1

- Binance publishes Spot kline archives at daily and monthly cadences. The data
  rows use the 12 `/api/v3/klines` fields.
- The archive README says Spot archive timestamps from 2025-01-01 onward use
  microseconds. The live REST API's millisecond default does not override the
  archive cutover.
- Binance pairs archive ZIPs with `.CHECKSUM` files using SHA-256.
- The Spot API describes open time as the kline identity and uses UTC when
  `timeZone` is omitted.
- Binance warns that an archive may later be replaced after a discovered issue.
  Therefore a matching sidecar proves equality with currently published bytes,
  not source immutability or an independently signed origin.

## Observed public controls

The network-fetched bytes are preserved as base64 fixtures so verification is
network-free. Each decoded sidecar and ZIP matches the acquisition manifest.

- BTCUSDT 2024-12-31: open `1735603200000`, close `1735689599999`
  (millisecond-native).
- BTCUSDT 2025-01-01: open `1735689600000000`, close
  `1735775999999999` (microsecond-native).
- ACAUSDT 2026-02: 13 physical/logical rows. Row 13 opens at
  `1770940800000000` and closes at `1770951599999000`, before the frozen
  complete boundary `1771027199999999`.
- AXSUSDT 2026-02: 29 physical rows, with byte-identical same-open rows 10 and
  11. Both complete row payloads including LF hash to
  `36e86b2b8bdd586e5672faa0b9beda042442895f8de7bde3e4479c8d047a51ba`.

## Project policy versus unknown source behavior

Binance does not document physical duplicate-row behavior, a duplicate-free
archive guarantee, deduplication precedence, the cause of a shortened terminal
row, expected symbol-month inventory, or historical listing/delisting
semantics.

Accordingly, DQ-1 labels UTC-midnight completeness, exact adjacent duplicate
collapse, and terminal truncation quarantine as project policy predicates—not
Binance guarantees. It never describes the ACA row as an in-progress candle or
delisting proof, and it never converts observed absence into lifecycle truth.
