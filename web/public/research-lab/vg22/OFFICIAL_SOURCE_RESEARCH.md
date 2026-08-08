# V-G22 official public-source freeze

| item | expected | frozen finding | status |
|---|---|---|---|
| research time | current research before implementation | `2026-07-29T16:36:26Z` | FROZEN |
| Binance public-data revision | immutable official revision | `5c7f3197591c0d54d85dc43066226bc4c671d47a` | FROZEN |
| Binance Spot API revision | immutable official revision | `6b8372cad7cecbdf5dd88a3372eafff51988c5cf` | FROZEN |
| archive | official public Spot monthly klines | <https://data.binance.vision/> | PUBLIC_ONLY |
| public-data documentation | daily/monthly files, schema, checksums, timestamp unit | <https://github.com/binance/binance-public-data/blob/5c7f3197591c0d54d85dc43066226bc4c671d47a/README.md?plain=1> | PINNED |
| Spot kline documentation | open-time identity, UTC default, kline fields | <https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/rest-api.md?plain=1> | PINNED |
| market-data-only documentation | public endpoint boundary | <https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/faqs/market_data_only.md?plain=1> | PINNED |
| commission documentation | account commission components and discount variability | <https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/faqs/commission_faq.md?plain=1> | PINNED |

## Frozen source facts

| item | expected | frozen finding | status |
|---|---|---|---|
| kline identity | deterministic bar key | Binance identifies a kline by open time | ACCEPT |
| daily boundary | UTC research bars | Spot klines default to UTC; start and end parameters remain UTC | ACCEPT |
| kline fields | exact public inputs | schema contains open, close, close time, quote-asset volume, and eight other documented fields | ACCEPT |
| archive cadence | bounded acquisition | official archive publishes daily and monthly public market-data files | ACCEPT |
| archive timestamp unit | correct 2025-2026 parsing | Spot archive timestamps from 2025-01-01 onward are microseconds | ACCEPT |
| archive checksum | byte custody | each ZIP has a colocated `.CHECKSUM` SHA-256 sidecar | REQUIRED |
| archive mutability | reproducible revision | publisher states archives may later be updated; freeze available ETag, `Last-Modified`, listed/local byte counts, ZIP and sidecar SHA-256, declared ZIP SHA-256, and acquisition completion time; do not invent request/receive times | REQUIRED |
| sealed holdout custody | bytes versus outcomes | compressed Jan-Jun files are already local and checksum-authenticated; Jan-Feb are warmup, while Mar-Jun ZIP members remain unopened until the holdout-open receipt | SEALED |
| ETag | checksum proof | not documented as the archive SHA-256 | REJECT_AS_SUBSTITUTE |
| quote volume | signal field | quote-asset volume is a documented kline field; it is not order-book volume | ACCEPT_WITH_BOUNDARY |
| public endpoint | public-only acquisition | `data-api.binance.vision` is documented for public market data and excludes user data | ACCEPT |

## Truth boundary

| item | expected | frozen finding | status |
|---|---|---|---|
| regime signal | adjacent closed-bar quote-volume regimes | measurable from authenticated public kline archives | MEASURABLE |
| fill model | account execution truth | klines do not contain bid/ask spread, queue, depth, latency, impact, rebates, or fill probability | UNMEASURED |
| fee sensitivity | frozen research cost | `10 bp` per side is a declared sensitivity proxy, not a claimed public-table rate | PROXY_ONLY |
| account fee | exact effective commission | standard, special, tax, discount, BNB, referral, and promotional components may vary by account and trade | UNKNOWN |
| executable capacity | realizable notional | quote-volume participation is only a screening proxy | UNMEASURED |
| historical symbol lifecycle | point-in-time tradability | archive key presence does not prove that a symbol was continuously enabled, eligible, or tradable at each historical entry | BIASED_OR_UNKNOWN |
| archive-discovered universe | survivorship-free cohort | union discovery can use after-the-fact symbol existence and archive retention; causal history screening limits but does not remove lifecycle bias | NOT_SURVIVOR_FREE |
| authority | capital or execution approval | public research has no order, private-data, provider, host, UI, transfer, withdrawal, or money authority | NONE |
