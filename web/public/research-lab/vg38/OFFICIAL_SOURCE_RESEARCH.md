# V-G38 official-source research

Current official Binance sources were checked on 2026-07-29. This note fixes
source semantics only; it contains no measurement or outcome.

## Pinned official sources

- Binance public-data Git pin
  `5c7f3197591c0d54d85dc43066226bc4c671d47a`:
  <https://github.com/binance/binance-public-data/blob/5c7f3197591c0d54d85dc43066226bc4c671d47a/README.md>
- Binance Spot API documentation Git pin
  `6b8372cad7cecbdf5dd88a3372eafff51988c5cf`:
  <https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/faqs/market_data_only.md>
- Current Spot kline specification:
  <https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market>
- Current public fee display and commission semantics:
  <https://www.binance.com/en/fee/trading> and
  <https://developers.binance.com/en/docs/products/spot/faqs/commission_faq>

## Source laws used by V-G38

1. `GET /api/v3/klines` returns twelve fields. Zero-indexed field `[5]` is base
   volume and field `[7]` is **quote asset volume**. V-G38 uses the published
   decimal value in field `[7]`; it does not reconstruct quote volume from price
   and base volume.
2. Binance publishes Spot kline history as daily or monthly ZIP objects under
   `data.binance.vision`. Every ZIP has a sibling `.CHECKSUM` object for SHA-256
   verification. Publisher archives may later be replaced, so custody binds both
   compressed ZIP bytes and sidecar bytes; a later replacement is a new source
   revision, never a silent substitution.
3. Binance states that Spot archive timestamps from 2025-01-01 onward are
   microseconds. The shared corpus is entirely post-cutover, so any non-microsecond
   timestamp is a source-validation failure.
4. `data-api.binance.vision` requires no authentication and exposes public market
   data only, including `exchangeInfo`, `klines`, and `time`. V-G38 uses neither
   credentials nor signed/account endpoints, private streams, orders, or any
   money-capable interface.
5. Binance's public fee page currently displays Regular User Spot maker and taker
   fees of `0.100%` per side. V-G38 may therefore label `10 bp` per executed side
   only as a current public displayed proxy. Binance documents standard, tax,
   special, promotion, discount, symbol, and account effects; without signed
   account evidence, account-effective commissions remain `UNKNOWN`.

## Shared archive custody

V-G38 reuses the exact V-G26 frozen archive corpus read-only: 180 monthly Spot
`1d` ZIP/`.CHECKSUM` pairs covering the same twelve USDT symbols and 2025-01
through 2026-03. Its controlling acquisition-manifest SHA-256 is
`fb9335c4372b979cb930bee059e41f02db355973ddf1e1ae4d878b828df3517a`.
V-G38 rejects any different manifest before parsing it, then independently
rehashes every listed compressed ZIP and sidecar. It does not redownload,
overwrite, repair, or inherit any V-G26 outcome.

No UI, canonical, deployment, live, host, provider, private-read, order,
transfer, withdrawal, money, or capital authority follows from these sources.
