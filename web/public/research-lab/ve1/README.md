# V-E1 Volume public-data verdict

Verdict: `UNMEASURED — ACCEPTED_LIFECYCLE_AND_PUBLIC_INPUT_MAPPING_UNAVAILABLE`

This packet evaluates whether the accepted Volume candidate
`6c8184331d85d098d2919e37d217f220f4c3214c` can be measured exactly over the
frozen 12-month public window. It stops before downloading or opening the
holdout because the admission gate fails:

- the accepted economic-exit policy is `REJECT_ONLY`, with quantity, fees,
  slippage, and all three exit thresholds unset;
- strategy and exit controls are OFF; exit is invoked at most once per newly
  committed `vroc:` pseudo-candidate, never for detector proposals, with the
  entry observation as current, and it cannot publish a sample;
- Binance's official Spot archive contains `aggTrades`, `trades`, and `klines`,
  but not historical `bookTicker`, synchronized depth, local receive clocks, or
  point-in-time symbol filters required by the accepted semantics.

Using candles, trades, current books, or invented fill rules would measure a
different strategy. The zero counts in `verdict.v1.json` are admission counts,
not zero performance.

## Frozen protocol

- Warm-up: `[2025-06-30T00:00:00Z, 2025-07-01T00:00:00Z)` (unscored)
- Research: `[2025-07-01T00:00:00Z, 2026-03-01T00:00:00Z)`
- Untouched holdout: `[2026-03-01T00:00:00Z, 2026-07-01T00:00:00Z)`
- Account-effective fees: `UNKNOWN`
- Current informational public fee scenarios: 10 bp/side regular; 7.5 bp/side
  conditional BNB (live references are not content-frozen or account proof)
- Required stress: +2 bp on both entry and exit
- Funding or inventory authority: none inferred

The official sources inspected on 2026-07-28 include immutable, SHA-256-bound
revisions of the
[Binance public archive](https://github.com/binance/binance-public-data/blob/5c7f3197591c0d54d85dc43066226bc4c671d47a/README.md),
[Spot WebSocket streams](https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/web-socket-streams.md),
[filters](https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/filters.md), and
[IOC enums](https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/enums.md).
Live, explicitly non-content-frozen references are the
[Spot market-data API](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market),
[public fee schedule](https://www.binance.com/en/fee/trading), and
[BNB fee FAQ](https://www.binance.com/en/support/faq/detail/115000583311).

## Reproduce

From the repository root:

```sh
node quant/research/ve1/verify.mjs
node --test quant/research/ve1/verify.test.mjs
node quant/research/ve1/verify-sources.mjs
(cd quant/research/ve1 && shasum -a 256 -c SHA256SUMS)
```

The main verifier is network-free. It binds the packet to the accepted Git
object and exact source bytes, validates cross-file invariants and packet
checksums, enforces frozen JSON byte fingerprints (so extra claims are rejected),
and rejects numeric performance claims while the mapping gate is closed.
`verify-sources.mjs` performs public GETs only to the immutable raw
GitHub URLs and verifies their recorded byte lengths and SHA-256 digests; it
does not call live fee pages, private endpoints, or exchange APIs.
