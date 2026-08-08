# V-G15 official-source research

Research was refreshed on 2026-07-29 before implementation. Only public
documentation and public market-data archives are in scope. No credential, account,
signed endpoint, private stream, order, host, or money path was used.

## Primary sources

- Binance's public-data repository documents the daily and monthly Spot archive
  layout, publication cadence, kline columns, companion `.CHECKSUM` files, and the
  possibility that a previously published archive may later be replaced:
  <https://github.com/binance/binance-public-data/blob/master/README.md?plain=1>
- Binance's Spot REST market-data documentation defines `GET /api/v3/klines`, UTC
  time parameters, the unique open-time identity, the 1,000-row limit, and the tuple
  containing base volume and quote-asset volume:
  <https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md?plain=1>
- The official public-data README states that Spot archive timestamps use
  microseconds from 2025-01-01 onward and milliseconds before that date. V-G15's
  declared source interval begins in May 2025, so every accepted archive timestamp
  must be microseconds:
  <https://github.com/binance/binance-public-data/blob/master/README.md?plain=1>
- Binance's commission FAQ explains that standard, tax, and special commissions and
  discounts can differ. Exact account/symbol commission is exposed by the signed
  `USER_DATA` account commission endpoint, which V-G15 does not call:
  <https://developers.binance.com/en/docs/products/spot/faqs/commission_faq>
  and
  <https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/account>
- Binance Academy's current public explanation, updated 2026-01-22, uses a regular
  Spot example of 0.10% while warning that VIP tier and BNB discounts change the
  actual rate:
  <https://academy.binance.com/en/articles/how-to-calculate-transaction-fees-on-binance>

The statistical design also follows the primary CSCV/PBO paper by Bailey et al.:
<https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2326253>. PBO is a selection
overfitting diagnostic, not proof of causality and not a substitute for an untouched
holdout.

## Frozen implications

1. V-G15 uses quote-asset volume only within one quote asset, USDT.
2. Each signal uses one fully completed UTC day and a baseline ending one day earlier.
   The position changes only at the next day's open.
3. The source manifest binds compressed ZIP bytes, sidecar bytes, exact official
   object names, lengths, ETags/last-modified metadata when available, and SHA-256.
   A later valid publisher replacement is a different source revision, never a
   silent rewrite.
4. A checksum proves custody, not semantic correctness. The evaluator independently
   rejects ambiguous members, malformed rows, duplicate or unordered open times,
   non-daily boundaries, gaps, impossible OHLC geometry, nonpositive prices, and
   negative quote volume.
5. Current `exchangeInfo` has current symbol status and rules but no complete
   historical listing/suspension/delisting timeline. V-G15 therefore never uses it
   to reconstruct the past. Its static twelve-symbol benchmark is explicitly a
   retrospective benchmark with possible survivor-selection bias, not a historical
   whole-market universe.
6. Public klines cannot establish account-effective historical fees, spreads, book
   depth, fill probability, market impact, or executable capacity. The 10 bp fee and
   adverse-price charges are frozen public scenarios; account fee and executable
   capacity remain `UNKNOWN`/`UNMEASURED`.
7. The signal is only the cross-sectional fraction above an own-history volume
   baseline. It never ranks members or uses price direction. Exposure is the entire
   cohort or cash, with no replacement constituent.

## Scope boundary

The result may support only a public retrospective shadow-research disposition for
the N3 successor/final-convergence consumer. It grants no trading, funding, transfer,
deployment, account, private-read, order, or capital authority.
