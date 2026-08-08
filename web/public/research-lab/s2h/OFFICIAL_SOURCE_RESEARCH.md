# S-2H official-source research

Source review frozen on 2026-07-30 before implementation outcomes.

| source | frozen identity | use |
|---|---|---|
| [Binance public-data README](https://github.com/binance/binance-public-data/blob/5c7f3197591c0d54d85dc43066226bc4c671d47a/README.md) | `5c7f3197591c0d54d85dc43066226bc4c671d47a` | Official monthly Spot kline layout, 2025 microsecond timestamp transition, next-month publication schedule, adjacent checksum files, and warning that archives can later be revised |
| [Binance Spot REST kline schema](https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/rest-api.md#klinecandlestick-data) | `6b8372cad7cecbdf5dd88a3372eafff51988c5cf` | Open-time identity, OHLC/quote-volume fields, UTC default, and current REST time-unit semantics |
| [Binance Spot commission FAQ](https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/faqs/commission_faq.md) | `6b8372cad7cecbdf5dd88a3372eafff51988c5cf` | Exact commission depends on account, symbol, discounts, tax, and special commission; public schedules are scenarios, not account truth |
| [Binance Spot filters](https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/filters.md) | `6b8372cad7cecbdf5dd88a3372eafff51988c5cf` | Current filters do not reconstruct historical filters |

Current verification also confirmed that the official `BTCUSDT` June 2026
hourly ZIP and checksum sidecar return HTTP 200. The ZIP was last modified
2026-07-06, and its current official compressed-byte SHA-256 is
`7c446aee297f382ee92b8d9b3300a1d7c21bed8166118f3bb261275bed5e308e`.
This is a source probe only; S-2H freezes every downloaded object separately.

## Boundaries

- Spot is continuous. The tested value is an adjacent UTC kline-bucket
  discontinuity, not a closed-session overnight premium.
- Archive timestamps from 2025 onward are parsed as microseconds only. REST's
  default millisecond JSON behavior is not applied to archive CSVs.
- Current `exchangeInfo` is not historical membership or filter evidence and
  cannot select or rescue the universe.
- S-2H reuses and hash-binds S-1F's complete paginated prefix-listing receipt
  plus its checksum-verified June 2025 cache. That prior receipt retained an
  ASCII candidate grammar: raw non-ASCII prefixes are evidenced in the listing
  root but were not materialized as candidates. S-2H does not silently claim
  UTF-8-complete candidate coverage, and the possible top-30 effect remains
  `UNMEASURED`. The inherited discovery and acquisition-manifest digests are
  frozen in `protocol.v1.json`; each June pair must also reconcile to that
  acquisition manifest and its official adjacent checksum before ranking.
- Klines contain quote volume but not historical bid/ask spread, queue,
  counterfactual impact, fill probability, or borrow inventory.
- The public regular-user 10-bp-per-fill scenario is not account-effective
  commission. No VIP, BNB, maker, promotion, tax, or special-commission benefit
  is assumed.
- A synthetic short return does not prove that Spot inventory could have been
  borrowed, held, or liquidated safely.
- The local holdout overlaps dates used elsewhere in the research program.
  It is locally sealed only; global holdout independence is not certified.
