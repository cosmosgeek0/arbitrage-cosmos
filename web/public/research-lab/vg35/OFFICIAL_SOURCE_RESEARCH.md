# V-G35 official-source research

Refreshed 2026-07-29 before evaluator implementation. Only official Binance
documentation and immutable Binance GitHub revisions define the source contract.

| item | expected | found | status |
|---|---|---|---|
| source | Binance public-only Spot evidence | monthly `1d` public kline ZIPs and adjacent `.CHECKSUM` files | PASS |
| fields | open and quote volume | the 12-field kline tuple contains open time, open, close time, and quote-asset volume | PASS |
| timestamp | explicit archive unit | Spot archive timestamps from 2025-01-01 onward are microseconds | PASS |
| custody | bytes, not URL, establish identity | publisher warns archives may later change; exact ZIP, checksum, size, and hash must be bound | PASS |
| access | no credentials | the V-G35 evaluator uses the already-frozen V-G25 public corpus read-only and performs no network request | PASS |
| fee | public counterfactual only | 10 bp per fill is a preregistered public modeling assumption; exact account, symbol, tax, special, discount, and promotional rates remain UNKNOWN | PASS |
| capacity | bounded public proxy | prior quote-volume prints can support a 1 bp participation proxy; depth, spread, queue, impact, historical filters, and executable capacity remain UNMEASURED | PASS |

## Immutable pins

| source | immutable identity | raw-byte SHA-256 |
|---|---|---|
| Spot REST API | [`binance/binance-spot-api-docs@6b837…c5cf:rest-api.md`](https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/rest-api.md) | `49ea6809243fc7fb426e07f2fe662097736c7bb405bd2da5eef637d715427999` |
| market-data-only FAQ | [`binance/binance-spot-api-docs@6b837…c5cf:faqs/market_data_only.md`](https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/faqs/market_data_only.md) | `57d608507426215c43f11907c07ed693f02725840d9ee4d6630f134de402b6da` |
| commission FAQ | [`binance/binance-spot-api-docs@6b837…c5cf:faqs/commission_faq.md`](https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/faqs/commission_faq.md) | `580cfa59c9f55adae0d27bf38d2bc7f268ad759fdf054486e356464c30bbd54c` |
| public archive README | [`binance/binance-public-data@5c7f…d47a:README.md`](https://github.com/binance/binance-public-data/blob/5c7f3197591c0d54d85dc43066226bc4c671d47a/README.md?plain=1) | `085ab91377aa9325d44f4c7ad27cce4ab381e158403e1d7df2bad39d1a66f7c6` |

Current official pages checked: [Spot market data](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market),
[market-data-only URLs](https://developers.binance.com/en/docs/products/spot/faqs/market_data_only),
and [Spot commissions](https://developers.binance.com/en/docs/products/spot/faqs/commission_faq).

## Frozen source boundary

V-G35 does not reacquire or modify source data. `bind-sources` hashes the exact
180 ZIPs, 180 checksum sidecars, and the V-G25 parent custody manifest in place
under `/Users/cosmosgeek/.codex/research-data/vg25-volume-shock-recovery-1be1-019faeec/`.
It opens no archive member. Freeze precedes the sole member-opening run.

Physical reuse is disclosed as `NOT_CERTIFIED_SHARED_REUSE_RISK`. Consequently,
the program-adjusted p-value is fixed at `1` and program verified-positive
eligibility is false even if every local gate passes. No result carries capital,
execution, account-fee, or executable-capacity authority.
