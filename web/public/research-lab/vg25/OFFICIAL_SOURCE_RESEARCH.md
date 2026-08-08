# V-G25 official-source research

| item | expected | found | status |
|---|---|---|---|
| source owner | current official Binance material | Binance developer documentation and Binance public-data repository | PASS |
| public-only host | no credentials | `https://data-api.binance.vision`; public GET only | PASS |
| archive | immutable evidence | monthly Spot `1d` ZIP plus adjacent `.CHECKSUM`; exact bytes and headers bound because archives may be replaced | PASS |
| kline fields | daily open and quote volume | 12-field kline tuple includes open time, OHLC, close time, quote-asset volume, trade count, and taker-buy volumes | PASS |
| timestamp | explicit unit | Spot archive timestamps from 2025-01-01 are microseconds | PASS |
| fee | public counterfactual only | 10 bp/fill is a preregistered modeling assumption informed by a mutable Binance Academy page checked 2026-07-29; it is not an immutable-source or account-effective fee claim; account, symbol, tax, special, discount, and promotion truth remain UNKNOWN | PASS |
| filters | capacity boundary | current `exchangeInfo` and filters are captured, but historical filters, depth, spread, queue, impact, and executable capacity remain UNMEASURED | PASS |

## Immutable official pins

| source | immutable identity | raw-byte SHA-256 |
|---|---|---|
| Spot REST API | `binance/binance-spot-api-docs@6b8372cad7cecbdf5dd88a3372eafff51988c5cf:rest-api.md` | `49ea6809243fc7fb426e07f2fe662097736c7bb405bd2da5eef637d715427999` |
| Spot filters | `binance/binance-spot-api-docs@6b8372cad7cecbdf5dd88a3372eafff51988c5cf:filters.md` | `4b5a8f0f5d15bcf68fd7ac2059ba6c88da641c06fd7885e642330c5ac8124dd3` |
| market-data-only FAQ | `binance/binance-spot-api-docs@6b8372cad7cecbdf5dd88a3372eafff51988c5cf:faqs/market_data_only.md` | `57d608507426215c43f11907c07ed693f02725840d9ee4d6630f134de402b6da` |
| commission FAQ | `binance/binance-spot-api-docs@6b8372cad7cecbdf5dd88a3372eafff51988c5cf:faqs/commission_faq.md` | `580cfa59c9f55adae0d27bf38d2bc7f268ad759fdf054486e356464c30bbd54c` |
| public archive README | `binance/binance-public-data@5c7f3197591c0d54d85dc43066226bc4c671d47a:README.md` | `085ab91377aa9325d44f4c7ad27cce4ab381e158403e1d7df2bad39d1a66f7c6` |

## Current canonical pages checked

- [Spot market-data endpoints](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market)
- [Spot REST rules and rate limits](https://developers.binance.com/en/docs/products/spot/rest-api)
- [Spot exchange information](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/general)
- [Spot filters](https://developers.binance.com/en/docs/products/spot/filters)
- [market-data-only endpoints](https://developers.binance.com/en/docs/products/spot/faqs/market_data_only)
- [commission rates](https://developers.binance.com/en/docs/products/spot/faqs/commission_faq)
- [public archive contract](https://github.com/binance/binance-public-data/blob/5c7f3197591c0d54d85dc43066226bc4c671d47a/README.md?plain=1)
- [public fee explainer checked for modeling context only](https://www.binance.com/en/academy/articles/how-to-calculate-transaction-fees-on-binance)

## Frozen provenance requirements

Archive URL alone is not identity. Before any member is opened, V-G25 binds every
ZIP and publisher checksum byte stream, the independently calculated SHA-256,
byte count, ETag, Last-Modified, retrieval time, symbol, interval, and month. It
also preserves the raw public `exchangeInfo` response and response metadata.

The one-run evaluator rejects wrong timestamp units, multiple ZIP members,
non-12-column rows, duplicate or non-UTC daily opens, missing complete days,
invalid decimals, publisher checksum mismatch, and any selected entry or exit
gap. Missing evidence never becomes cash or numeric zero.

The fixed ten-symbol cohort is a preregistered, current-major research cohort.
It is not a historical top-ten reconstruction and is survivorship-limited. The
packet makes no broad-universe or causal-effect claim.
