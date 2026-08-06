# V-G26 official-source research

Research was refreshed on 2026-07-29 before implementation. Only Binance public
documentation and public Spot market-data archives are in scope. No credential,
account, signed endpoint, private stream, order, provider, host, or money path is
used.

## Frozen primary sources

- Binance's public-data repository, frozen here at commit
  `5c7f3197591c0d54d85dc43066226bc4c671d47a`, documents daily and monthly Spot
  archive paths, the twelve kline columns, companion `.CHECKSUM` objects,
  post-2025 microsecond timestamps, and the possibility that an archive is later
  replaced:
  <https://github.com/binance/binance-public-data/blob/master/README.md?plain=1>
- Binance's Spot API documentation repository, frozen here at commit
  `6b8372cad7cecbdf5dd88a3372eafff51988c5cf`, defines the public-only market-data
  hosts and states that they expose only public market data:
  <https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md>
- The official Spot REST market-data specification defines `GET /api/v3/klines`,
  UTC kline open-time identity, request weight 2, a maximum of 1,000 rows, and the
  twelve-element response containing base volume and quote-asset volume:
  <https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market>
- Current symbol status and filters are exposed through `exchangeInfo`, but that
  endpoint is a current-state interface rather than a complete historical
  listing, suspension, and delisting ledger:
  <https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/general>
  and
  <https://developers.binance.com/en/docs/products/spot/filters>
- Binance's current public trading-fee table displays regular-user Spot maker and
  taker fees of 0.100% per side. Exact account commission is account-specific and
  available through signed `USER_DATA`; this packet never calls it:
  <https://www.binance.com/en/fee/trading>
  and
  <https://developers.binance.com/en/docs/products/spot/faqs/commission_faq>
- The official Spot changelog added public block-trade market-data interfaces in
  May 2026. V-G26's corpus ends on 2026-03-31, before that addition; the kline
  documentation still does not establish historical trade-composition semantics:
  <https://github.com/binance/binance-spot-api-docs/blob/master/CHANGELOG.md?plain=1>

The report-only CSCV/PBO diagnostic follows Bailey et al.'s primary paper:
<https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2326253>. PBO measures
within-family selection-overfitting risk; it does not establish causality and
cannot select, rescue, or veto the sealed candidate.

## Frozen implications

1. The exact corpus is 180 monthly pairs: twelve named Spot USDT symbols by
   fifteen months from 2025-01 through 2026-03. Acquisition downloads each ZIP and
   sidecar, authenticates the sidecar against the compressed ZIP, and records
   lengths, hashes, official URLs, and HTTP metadata when present without opening
   an archive member.
2. A later valid publisher replacement is a new source revision, never a silent
   rewrite. Freeze binds the exact compressed ZIP and sidecar bytes used here.
3. The evaluator independently rejects extra or ambiguous ZIP members, malformed
   rows, non-microsecond timestamps, duplicate or unordered days, gaps, impossible
   OHLC geometry, nonpositive prices or volumes, and source-matrix drift.
4. For target open `D`, every signal input ends on completed UTC day `D-1`.
   Per symbol, `L` close-return/quote-volume-change pairs use `L+1` completed bars.
   Exact average ranks handle ties; a constant input that makes Spearman undefined
   is terminal `UNMEASURED`.
5. The static twelve-symbol cohort is a retrospective benchmark. Current
   `exchangeInfo` is not retrojected, so historical whole-market membership and
   survivor-free universe construction remain `UNMEASURED`.
6. Public klines cannot prove account-effective fees, spread, historical book
   depth, fill probability, impact, or executable capacity. The 10 bp fee and
   adverse-price charges are public scenarios. Account-effective fees are
   `UNKNOWN`; the 1 bp quote-volume capacity number is a proxy; executable
   capacity is `UNMEASURED`.
7. Absolute cohort-or-cash return alone can be market beta. Every trial is
   therefore measured against an identical always-on equal-weight cohort under
   the same cost scenario and boundary liquidation.

## Scope boundary

The result can support only a Binance-public retrospective shadow-research
disposition for N3 successor/final convergence. It grants no UI, canonical,
deployment, live, host, provider, private-read, order, transfer, withdrawal,
money, or capital authority.
