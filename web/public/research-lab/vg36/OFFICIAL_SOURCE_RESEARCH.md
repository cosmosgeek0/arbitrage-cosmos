# V-G36 official-source research

Research was refreshed on 2026-07-29 UTC before implementation. Only official
Binance public documentation and the already-present public Spot archive mirror
are in scope. No credential, signed endpoint, private stream, order, provider,
host, or money path is used.

## Frozen official pins

- Binance public-data repository commit
  `5c7f3197591c0d54d85dc43066226bc4c671d47a` documents monthly Spot
  archives, companion `.CHECKSUM` objects, all twelve kline columns, and
  microsecond Spot timestamps from 2025-01-01:
  <https://github.com/binance/binance-public-data/blob/5c7f3197591c0d54d85dc43066226bc4c671d47a/README.md?plain=1>
- Binance Spot API documentation commit
  `6b8372cad7cecbdf5dd88a3372eafff51988c5cf` is the frozen API-document
  identity. The official kline response defines quote asset volume at
  zero-based index 7 and taker-buy quote asset volume at zero-based index 10:
  <https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/rest-api.md?plain=1>
- Binance documents its market-data-only host as public-only:
  <https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/faqs/market_data_only.md?plain=1>
- Binance's public regular-user Spot schedule shows 0.100% maker and taker fees.
  Account-effective commission is account-specific and exposed by signed
  `USER_DATA`; V-G36 never calls it:
  <https://www.binance.com/en/fee/trading>
  and
  <https://developers.binance.com/en/docs/products/spot/faqs/commission_faq>

The report-only CSCV/PBO diagnostic follows Bailey et al.:
<https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2326253>.

## Frozen implications

1. The exact source matrix is 192 pairs: twelve static symbols by sixteen
   months, March 2025 through June 2026.
2. Acquisition and freeze hash the compressed ZIP and sidecar bytes and validate
   the publisher SHA-256 before any archive member can be opened.
3. Any later publisher replacement is a new source revision. It cannot silently
   replace a frozen input.
4. The evaluator accepts exactly one unencrypted regular ZIP member with the
   expected basename. Extra, nested, duplicate, encrypted, symlinked, hard-linked,
   malformed, discontinuous, or ambiguous inputs are terminal defects.
5. For a completed UTC day, share is exactly field 10 divided by field 7.
   Twelve shares are averaged equally. No field 5 raw volume, field 8 trade
   count, price return, price level, or quote-volume level enters the signal.
6. The current innovation is standardized only against the prior `L`
   innovations. Its immediately prior standardized innovation must exceed -1,
   preventing a continuing negative episode from firing repeatedly.
7. Public daily bars cannot establish causal order flow, account fees, book
   spread/depth, fill probability, impact, intraday drawdown, or executable
   capacity. Those truths remain `NOT_CLAIMED`, `UNKNOWN`, or `UNMEASURED`.
8. The shared archive/holdout has cross-family exposure risk. A verified local
   positive cannot become a capital-positive verdict.

## Scope boundary

The result can support only one checksum-bound Binance-public retrospective
shadow-research disposition for the N3 successor/orchestrator scoreboard. It
grants no execution or capital authority.
