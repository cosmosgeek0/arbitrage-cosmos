# V-G21 official-source research

Research was refreshed on 2026-07-29 before evaluator implementation. Only
first-party Binance sources and immutable source-control revisions are admitted.

## Frozen source pins

| Contract | Immutable revision | Local SHA-256 |
| --- | --- | --- |
| Binance public-data README | [`5c7f3197591c0d54d85dc43066226bc4c671d47a`](https://github.com/binance/binance-public-data/blob/5c7f3197591c0d54d85dc43066226bc4c671d47a/README.md) | `085ab91377aa9325d44f4c7ad27cce4ab381e158403e1d7df2bad39d1a66f7c6` |
| Spot REST kline contract | [`6b8372cad7cecbdf5dd88a3372eafff51988c5cf`](https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/rest-api.md) | `49ea6809243fc7fb426e07f2fe662097736c7bb405bd2da5eef637d715427999` |
| Spot filters contract | [`6b8372cad7cecbdf5dd88a3372eafff51988c5cf`](https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/filters.md) | `4b5a8f0f5d15bcf68fd7ac2059ba6c88da641c06fd7885e642330c5ac8124dd3` |
| Market-data-only FAQ | [`6b8372cad7cecbdf5dd88a3372eafff51988c5cf`](https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/faqs/market_data_only.md) | `57d608507426215c43f11907c07ed693f02725840d9ee4d6630f134de402b6da` |
| Commission FAQ | [`6b8372cad7cecbdf5dd88a3372eafff51988c5cf`](https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/faqs/commission_faq.md) | `580cfa59c9f55adae0d27bf38d2bc7f268ad759fdf054486e356464c30bbd54c` |

The source-control heads were measured as current on 2026-07-29:
`binance-public-data@5c7f3197591c0d54d85dc43066226bc4c671d47a` and
`binance-spot-api-docs@6b8372cad7cecbdf5dd88a3372eafff51988c5cf`.

## Admitted semantics

- Monthly Spot kline archives and adjacent `.CHECKSUM` objects are public,
  authentication-free evidence. Archive objects can later be corrected, so every
  admitted byte object and checksum sidecar is frozen rather than silently refreshed.
- The daily kline CSV has 12 ordered fields. V-G21 uses open price and field 7,
  quote-asset volume. Base-asset volume is never aggregated across symbols.
- Spot archive timestamps from 2025 onward are microseconds. A complete `1d` bar opens
  at UTC midnight and closes exactly one microsecond before the next UTC midnight.
- Current REST `/exchangeInfo` describes current state. V-G21 does not use it to
  reconstruct historical membership, filters, or capacity.
- The public regular-user 10 bp taker rate is only a scenario. Binance's commission
  contract permits account, symbol, discount, special-rate, and tax components.
  Account-effective commission therefore remains `UNKNOWN`.

## Evidence limits

Daily bars contain no historical bid/ask spread, order-book depth, queue position,
fill, local receipt clock, account commission, or historical symbol filters. The
experiment can measure a checksum-bound bar-return counterfactual and public
liquidity proxy only. Executable capacity, fillability, account-net profitability,
private-account truth, and capital authority remain `UNMEASURED`/`NONE`.

