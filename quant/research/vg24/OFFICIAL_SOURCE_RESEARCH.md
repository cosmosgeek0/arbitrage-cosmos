# V-G24 official public-source freeze

Research was refreshed on 2026-07-29 before implementation and before V-G24
listed, decompressed, or read any Binance ZIP member. V-G24 uses only
unauthenticated Binance Spot public data.

| item | exact official pin | frozen use |
|---|---|---|
| Binance public-data repository | [`5c7f3197591c0d54d85dc43066226bc4c671d47a`](https://github.com/binance/binance-public-data/blob/5c7f3197591c0d54d85dc43066226bc4c671d47a/README.md?plain=1), commit time `2025-01-09T09:41:15Z` | Monthly Spot `1d` archive layout, twelve kline fields, SHA-256 sidecars, archive-correction warning, and the 2025+ microsecond timestamp rule |
| pinned public-data README bytes | [`raw`](https://raw.githubusercontent.com/binance/binance-public-data/5c7f3197591c0d54d85dc43066226bc4c671d47a/README.md), SHA-256 `085ab91377aa9325d44f4c7ad27cce4ab381e158403e1d7df2bad39d1a66f7c6` | Exact documentation byte identity checked before code |
| Binance Spot API documentation | [`6b8372cad7cecbdf5dd88a3372eafff51988c5cf`](https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/rest-api.md?plain=1), commit time `2026-07-27T07:43:52Z` | Public `GET /api/v3/klines`, UTC-default daily bars, open-time identity, and quote-asset-volume field semantics |
| pinned Spot REST documentation bytes | [`raw`](https://raw.githubusercontent.com/binance/binance-spot-api-docs/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/rest-api.md), SHA-256 `49ea6809243fc7fb426e07f2fe662097736c7bb405bd2da5eef637d715427999` | Exact documentation byte identity checked before code |
| public market-data-only boundary | [`market_data_only.md` at `6b8372c`](https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/faqs/market_data_only.md?plain=1) | Public market data has no user-data authority |
| commission semantics | [`commission_faq.md` at `6b8372c`](https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/faqs/commission_faq.md?plain=1) | Standard, special, tax, and discount state can vary by account and trade; exact account-effective fees remain `UNKNOWN` |
| public archive | [data.binance.vision](https://data.binance.vision/) | Read-only compressed Spot monthly kline ZIPs and colocated checksum sidecars |

The two repository pins above were also the current official `master` revisions
observed through the GitHub repository API on 2026-07-29. That observation does
not make archive URLs immutable. The publisher states that archive objects can
later be corrected, so the freeze binds each admitted local ZIP and sidecar by
path, byte count, SHA-256, declared ZIP checksum, ETag, and `Last-Modified`
metadata inherited from the checksum-verified S-1F acquisition manifest.

## Frozen interpretation

Only kline quote-asset volume enters the V-G24 signal, dynamic cohort, robust
surprises, market-factor residuals, and lag-two network. Open and close prices
are parsed and validated with each admitted twelve-field kline before selection,
but selection code cannot reference them; their first economic use is after the
cohort is fixed, solely for payoff and observed-mark drawdown.
Base volume, returns, prices, taker fields, trade count, current
`exchangeInfo`, private data, and future bars cannot choose a source, edge, or
downstream cohort.

Spot archive timestamps from 2025-01-01 onward are microseconds. A real outcome
run must reject non-microsecond timestamps, non-UTC daily boundaries, unsafe or
unexpected ZIP members, duplicate days, source revision drift, malformed
OHLCV, or checksum disagreement. The freeze command may hash compressed ZIP
bytes and sidecars but is forbidden to construct a `ZipFile`, list a member, or
read CSV content.

## Truth boundary

The shared S-1F acquisition receipt's `NOT_DECOMPRESSED` state was true at its
acquisition time. Other sibling lanes have since used the same compressed
objects, so this is not a program-wide fresh holdout. V-G24 nevertheless has
its own lane-local unopened partition and may open its March-June members only
after its own selected champion passes every development gate.

The archive has no historical bid/ask spread, queue, depth, latency, impact,
fill probability, exact historical symbol eligibility, or account commission.
The gross, public base, public stress, and fee-stress paths are declared public
research scenarios. A prior quote-volume 1 bp participation screen is not
executable capacity. USDT is treated as nominal USD only for the requested
`$1,000` research normalization; parity is not proven.

The lag order is causal in information time, but it does not identify a
structural causal effect. Venue-wide news and common flows remain unobserved
confounders. Even a local public-screen `GO` is not
`VERIFIED_POSITIVE`, because the dates overlap sibling experiments and no
program-wide multiplicity convergence has occurred. Capital and execution
authority are always `NONE`.
