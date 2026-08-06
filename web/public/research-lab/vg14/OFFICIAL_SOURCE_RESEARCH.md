# V-G14 official public-source freeze

Frozen on 2026-07-29 before protocol implementation or outcome access.

## Primary official sources

1. Binance Spot REST API general information:
   <https://developers.binance.com/en/docs/products/spot/rest-api>
2. Binance Spot REST API market-data endpoints:
   <https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market>
3. Binance Spot market-data-only FAQ:
   <https://developers.binance.com/en/docs/products/spot/faqs/market_data_only>
4. Binance Spot commission FAQ:
   <https://developers.binance.com/en/docs/products/spot/faqs/commission_faq>
5. Binance public archive:
   <https://data.binance.vision/>
6. Binance public-data README pinned to Git commit
   `5c7f3197591c0d54d85dc43066226bc4c671d47a`:
   <https://github.com/binance/binance-public-data/blob/5c7f3197591c0d54d85dc43066226bc4c671d47a/README.md?plain=1>
7. Binance Spot REST documentation pinned to Git commit
   `6b8372cad7cecbdf5dd88a3372eafff51988c5cf`:
   <https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/rest-api.md?plain=1>
8. Binance market-data-only FAQ pinned to the same Spot documentation commit:
   <https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/faqs/market_data_only.md?plain=1>
9. Binance commission FAQ pinned to the same Spot documentation commit:
   <https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/faqs/commission_faq.md?plain=1>

## Frozen source facts

- Binance identifies a kline by its open time. The Spot kline schema includes
  open, high, low, close, base-asset volume, close time, quote-asset volume,
  trade count, taker-buy base volume, and taker-buy quote volume.
- The Spot REST kline endpoint requires an interval, defaults to 500 rows, and
  allows at most 1,000 rows per request. Kline interpretation defaults to UTC,
  and `startTime` and `endTime` remain UTC even when a presentation timezone is
  requested.
- `https://data-api.binance.vision` is an official market-data-only base URL
  for public endpoints. It does not provide user data.
- The official public archive supplies daily and monthly Spot kline ZIPs. The
  public-data README states that Spot archive timestamps from 2025-01-01 onward
  are in microseconds.
- Each archive has a colocated `.CHECKSUM` file containing a SHA-256 digest.
  The publisher may replace archive files, so V-G14 freezes both the received
  sidecar bytes and the digest of every received ZIP before opening a member.
- An archive filename is not timezone proof. V-G14 derives UTC from the
  documented epoch timestamp and rejects timestamps that do not form its exact
  30-minute UTC grid.
- An HTTP ETag is not documented as the archive SHA-256 and is never used as a
  checksum substitute.

## Truth boundary

The public kline archive can measure the declared historical bar experiment.
It cannot establish account-effective standard, special, tax, discount, BNB,
referral, or promotional commission. Those values remain `UNKNOWN`.

The frozen fee and adverse-execution values in the protocol are explicit
research proxies. Public klines do not prove historical bid/ask spread,
order-book depth, impact, fillability, latency, rebates, symbol-specific
filters, or executable capacity. Those limitations remain `UNMEASURED` or
`UNKNOWN`; no public proxy is promoted to account or capital truth.

