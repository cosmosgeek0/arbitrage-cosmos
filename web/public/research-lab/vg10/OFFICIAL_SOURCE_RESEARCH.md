# V-G10 official-source research

Research was checked before implementation on 2026-07-29. Protocol source
identity is pinned, so later upstream changes do not silently rewrite this
experiment.

## Pinned Binance sources

- Spot API docs commit
  [`6b8372cad7cecbdf5dd88a3372eafff51988c5cf`](https://github.com/binance/binance-spot-api-docs/tree/6b8372cad7cecbdf5dd88a3372eafff51988c5cf).
  The pinned REST contract identifies unspecified-security endpoints as public
  `NONE`, says klines are uniquely identified by open time, and exposes quote
  asset volume plus taker-buy quote asset volume.
- The pinned
  [market-data-only FAQ](https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/faqs/market_data_only.md)
  states that `data-api.binance.vision` needs no authentication and serves only
  public market data.
- The pinned
  [commission FAQ](https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/faqs/commission_faq.md)
  labels its prices and commissions fictional. Effective commission depends on
  account, symbol/order side, standard, special, tax, and discount state.
- Public-data commit
  [`5c7f3197591c0d54d85dc43066226bc4c671d47a`](https://github.com/binance/binance-public-data/tree/5c7f3197591c0d54d85dc43066226bc4c671d47a).
  Its README documents monthly Spot ZIPs, companion `.CHECKSUM` sidecars, the
  12-field kline layout, later archive replacement risk, and microsecond Spot
  timestamps from 2025-01-01.

`protocol.v1.json` freezes the exact SHA-256 digest of every cited source file,
including REST, market-data-only, glossary, WebSocket, commission, changelog,
and public-data README bytes.

## Frozen interpretation

The only signal-bearing quantities are total quote volume and taker-buy quote
volume as a ratio-composition imbalance. Total quote volume never becomes a
level, rank, shock, liquidity signal, or time-of-day residual. The next-bar
wait prevents using the formation decision's immediate bar as an executable
entry. Official archives and sidecars prove public source custody; they do not
prove fills, account commission, historical filters, spread, depth, latency, or
capacity.

The five cost scenarios are analyst sensitivities, not Binance fee claims.
VIP, BNB, promotion, special, and tax adjustments are not assumed. The $1,000
quote-volume participation number is a public-print capacity proxy only.
