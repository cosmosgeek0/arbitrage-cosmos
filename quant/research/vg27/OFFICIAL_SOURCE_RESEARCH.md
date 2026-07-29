# V-G27 official Binance source note

| item | expected | found | status |
|---|---|---|---|
| source owner | current official Binance material only | Binance developer documentation and `binance-public-data` | PASS |
| public transport | credentials absent | monthly public Spot archives and market-data-only REST host | PASS |
| archive identity | exact evidence bytes | every `1h` ZIP and adjacent `.CHECKSUM` are byte-hashed before any outcome body open | PASS |
| kline contract | signal and later pricing fields | 12-field tuple includes open time, OHLC, close time, quote-asset volume, count, and taker-buy volumes | PASS |
| timestamp | current archive rule | Spot archive timestamps from 2025-01-01 are microseconds | PASS |
| symbol metadata | public context only | public `exchangeInfo`; no private/account endpoint | PASS |
| fee truth | no invented account fee | commission examples are fictional and account-specific; the frozen 10 bp fee is sensitivity only | PASS |

## Current official sources checked

- [Binance public-data archive README](https://github.com/binance/binance-public-data/blob/5c7f3197591c0d54d85dc43066226bc4c671d47a/README.md?plain=1)
- [Spot REST market-data klines](https://developers.binance.com/en/docs/binance-spot-api-docs/rest-api/market-data-endpoints#klinecandlestick-data)
- [Spot REST exchange information](https://developers.binance.com/en/docs/binance-spot-api-docs/rest-api/general-endpoints#exchange-information)
- [Market-data-only endpoints](https://developers.binance.com/docs/binance-spot-api-docs/faqs/market_data_only)
- [Commission FAQ](https://developers.binance.com/docs/binance-spot-api-docs/faqs/commission_faq)

## Immutable research pins

| source | immutable identity | raw-byte SHA-256 |
|---|---|---|
| Spot REST API | `binance/binance-spot-api-docs@6b8372cad7cecbdf5dd88a3372eafff51988c5cf:rest-api.md` | `49ea6809243fc7fb426e07f2fe662097736c7bb405bd2da5eef637d715427999` |
| Spot filters | `binance/binance-spot-api-docs@6b8372cad7cecbdf5dd88a3372eafff51988c5cf:filters.md` | `4b5a8f0f5d15bcf68fd7ac2059ba6c88da641c06fd7885e642330c5ac8124dd3` |
| market-data-only FAQ | `binance/binance-spot-api-docs@6b8372cad7cecbdf5dd88a3372eafff51988c5cf:faqs/market_data_only.md` | `57d608507426215c43f11907c07ed693f02725840d9ee4d6630f134de402b6da` |
| commission FAQ | `binance/binance-spot-api-docs@6b8372cad7cecbdf5dd88a3372eafff51988c5cf:faqs/commission_faq.md` | `580cfa59c9f55adae0d27bf38d2bc7f268ad759fdf054486e356464c30bbd54c` |
| public archive README | `binance/binance-public-data@5c7f3197591c0d54d85dc43066226bc4c671d47a:README.md` | `085ab91377aa9325d44f4c7ad27cce4ab381e158403e1d7df2bad39d1a66f7c6` |

The commission FAQ explicitly describes examples as fictional and notes that
actual rates depend on the account and order. Therefore V-G27's `10 bp` public
fee assumption is a frozen sensitivity, not a claim about a current or
historical account. Discounts, taxes, special commissions, promotions, maker
versus taker realization, and account tier remain `UNKNOWN`.

Archive URLs are not custody. Before any member is opened, V-G27 binds the ZIP
bytes, publisher checksum bytes, independently computed digest, byte count,
symbol, interval, month, and preserved response metadata. The evaluator rejects
headers, non-12-column rows, wrong timestamp units, non-hour opens, wrong close
boundaries, duplicates, gaps, extra members, and wrong member names.
