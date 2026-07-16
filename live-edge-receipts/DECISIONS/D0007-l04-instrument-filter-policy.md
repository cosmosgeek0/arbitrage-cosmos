# D0007 — L04 instrument and filter policy

Status: `ACCEPTED_FOR_LANE_L04`

Date: `2026-07-12`

Authority: L-lane documentary normalization and static exact-decimal preflight
policy only. This decision grants no acquisition, cache, account, credential,
Capital, Risk, execution, reconciliation, persistence, deployment or external
action authority.

## Current official sources

Spot controlling source pin remains official repository commit
`31643ed390e2aa450ce872981556186acf96a195`, verified on 2026-07-12:

- `filters.md` SHA-256
  `4b5a8f0f5d15bcf68fd7ac2059ba6c88da641c06fd7885e642330c5ac8124dd3`;
- `rest-api.md` SHA-256
  `49ea6809243fc7fb426e07f2fe662097736c7bb405bd2da5eef637d715427999`;
- `enums.md` SHA-256
  `5708fe6fdea8013f6c8a8388074c8cef8482b2b69a09181e4b2b36e0c2b4ab4b`;
- `CHANGELOG.md` SHA-256
  `3c87303c7ba632d7240d34a7271652aaa8a4f5aebe8023eec6ab36a13bd10f8a`;
- `sbe/schemas/spot_3_5.xml` SHA-256
  `542776a038883dafe962341a041323ff5d8d3e36f1b860ab60156a88a4080bcf`.

Current USD-M pages checked on 2026-07-12:

- `https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/common-definition`,
  last modified 2026-07-10;
- current catalog `GET /fapi/v1/exchangeInfo` and New Order pages;
- current USD-M change log;
- COIN-M exchange information only as the product-specific comparison proving
  that USD-M does not document `contractSize`.

Current Margin pages checked on 2026-07-12:

- `https://developers.binance.com/en/docs/products/margin-trading/general-info`;
- `https://developers.binance.com/en/docs/products/margin-trading/best-practice`;
- current Margin market-data catalog and change log.

Documentation access was public and read-only. No Binance API endpoint was
called.

## Owner and input boundary

- Intelligence Runtime remains the canonical public acquisition, source
  lifecycle, freshness and recording owner.
- L04 consumes its immutable `RuntimeListingMetadata` evidence through a pure
  adapter. It does not fetch, poll, cache, schedule, persist or create another
  exchange-info owner.
- Runtime metadata preserves per-symbol raw filters and a semantic fingerprint
  but does not prove environment/host, raw response SHA, top-level exchange
  filters, Spot `isMarginTradingAllowed`, Spot time-in-force, private
  `MAX_ASSET` or current Spot execution rules. Those losses remain explicit.
- Runtime's current Spot source uses `data-api.binance.vision`, while accepted
  L02 `SPOT_EXCHANGE_INFO_FILTERS` binds `api.binance.com`. Metadata has no host
  field, so L04 cannot silently claim exact L02 source binding from metadata
  alone.
- L04 binds the injected projection to Runtime's existing exact Spot/USD-M
  source IDs, datasets, source-record identity, transform provenance and
  product invariants. This proves which canonical owner produced the metadata;
  it does not cure the separately recorded response-host loss.
- Runtime instrument tokens must already be uppercase NFC values using the
  canonical Unicode letter/number/dot/underscore/hyphen grammar. L04 does not
  normalize attacker-authored whitespace, case or decomposed text into an
  apparently canonical owner identity.
- The exact L02 public contract IDs are fixed to
  `SPOT_EXCHANGE_INFO_FILTERS`, `USDM_EXCHANGE_INFO_FILTERS` and
  `MARGIN_EXCHANGE_INFO_FILTERS`. Positive resolution remains documentary and
  grants `NONE_RECORD_ONLY` action authority.
- Capital's exact-decimal leaf is reused for normalization and arithmetic.
  Legacy binary64 exchange-info filters and `OrderService.roundToStep` are not
  imported or promoted.
- “Registry” means one immutable per-call value snapshot. L04 creates no
  singleton, mutable `Map`, cache, source registry, proposal queue or store.
- Per-call bounds align with the existing Runtime owner ceiling: at most 10,000
  symbols and 128 filters per symbol, with independent graph and aggregate
  string bounds. No truncation is permitted.

## Product and filter decisions

New-order static posture requires exact `TRADING`; every other documented or
unknown status blocks. Symbol capabilities never replace route authority,
account permission, Capital or Risk approval.

Current Spot/Margin-shared symbol filter vocabulary:

- `PRICE_FILTER`, `PERCENT_PRICE`, `PERCENT_PRICE_BY_SIDE`, `LOT_SIZE`,
  `MIN_NOTIONAL`, `NOTIONAL`, `ICEBERG_PARTS`, `MARKET_LOT_SIZE`;
- `MAX_NUM_ORDERS`, `MAX_NUM_ALGO_ORDERS`,
  `MAX_NUM_ICEBERG_ORDERS`, `MAX_POSITION`, `TRAILING_DELTA`,
  `MAX_NUM_ORDER_AMENDS`, `MAX_NUM_ORDER_LISTS`.

Current USD-M symbol filter vocabulary:

- `PRICE_FILTER`, `LOT_SIZE`, `MARKET_LOT_SIZE`, `MAX_NUM_ORDERS`,
  `PERCENT_PRICE`, `MIN_NOTIONAL`.

Only `PRICE_FILTER` officially declares its `minPrice`, `maxPrice` and
`tickSize` rules independently disabled by exact zero. Zero does not disable a
lot, notional, multiplier or count rule. `avgPriceMins=0` selects last price; it
does not disable a filter.

Spot/Margin grids use value modulo increment from zero. Current USD-M docs use
`(value - minimum) modulo increment` for price and quantity. Market orders are
conservatively checked against both `LOT_SIZE` and `MARKET_LOT_SIZE` because
official USD-M text does not say the market filter replaces the general lot
filter.

Spot market minimum/maximum notional applicability follows its exact published
booleans. USD-M documents only `MIN_NOTIONAL { notional }`; a Spot `NOTIONAL`
shape, max-notional value or applicability flag cannot be cross-cast. USD-M
market notional uses mark price.

Percent-price filters require exact, current owner-produced reference price
evidence. Account order counts, position limits, amendments, order lists and
private `MAX_ASSET` require separate owner truth and cannot be passed from
public metadata alone.

Reference evidence is a closed Intelligence Runtime projection bound to the
exact product, symbol and instrument revision, exact decimal price, official
reference kind/window and a content revision. Its injected validity interval
cannot exceed 5,000 ms. Wrong, partial, stale, future-skewed or mismatched
evidence blocks before arithmetic. L04 performs no reference-price acquisition.
Waiting decisions consume the complete evidence object, not a caller-authored
revision/timestamp tuple, and revalidate its content revision, product, symbol,
instrument revision, kind, window, authority and exact validity interval.

## Current product-specific conflicts and gaps

- Spot currently includes `CANCEL_ONLY`; exact string comparison prevents it
  from being treated as `TRADING`.
- Spot filter examples are not limits. `ICEBERG_PARTS` prose/example and later
  changelog values differ, so values are always payload evidence.
- Spot SBE 3:5 exposes an undocumented `T_PLUS_SELL` filter. Unknown filters
  block action rather than being ignored.
- Spot `PRICE_RANGE` execution rules come from a separate public endpoint and
  are unavailable in Runtime listing metadata.
- USD-M catalog incorrectly flattens fields from several filters into one
  object tagged `PRICE_FILTER`. L04 dispatches only on `filterType` and rejects
  extra composite fields.
- USD-M `MAX_NUM_ALGO_ORDERS` remains in common definitions but the change log
  removed it from exchange information on 2025-12-29. If present it is a source
  anomaly/blocker, not current per-symbol truth.
- USD-M conditional order enums remain rendered after their routes moved to
  Algo Service. Regular-order static policy accepts only current route-compatible
  `LIMIT`/`MARKET` mechanics and never infers route permission from the symbol
  array.
- USD-M does not document `contractSize`; it remains `null`/`UNAVAILABLE` and
  notional is exact price times quantity. Precision integers never substitute
  for tick or step filters.
- Margin has no distinct exchange-info. It reuses Spot symbol filters and then
  requires a separate Cross/Isolated eligibility and restriction join.
  `permissionSets` or Spot trading permission alone cannot prove Margin
  eligibility or account tradability.
- Current Margin pair/asset/restriction sources require API-key market-data
  evidence and contain unresolved request/timestamp, time-unit and boundary
  inconsistencies. No authorized probe occurred. L04 records these as later
  owner requirements and cannot claim Margin action readiness.
- Retired Margin `leverageBracket` cannot be restored from stale catalog/SDK
  rendering after its 2026-04-13 removal.

## Exact-decimal and sizing law

- Every monetary/filter value remains an exact canonical decimal string;
  binary floating point, exponent notation, UI precision and locale formatting
  are rejected.
- Price is never auto-adjusted. Misalignment blocks.
- Quantity may only stay unchanged or reduce. Conservative reduction is
  `origin + floor((candidate-origin)/step)*step`, followed by complete grid and
  notional revalidation. Incompatible grids block; the algorithm never searches
  upward.
- Exact notional is recalculated after every transformation.
- The effective ceiling is no greater than the Capital-approved notional,
  intended exposure, applicable official maximum and unchanged 10-USDT canary
  envelope.
- The literal canary `10` is compared only when both the instrument quote asset
  and the sizing request's notional asset are exact `USDT`. Non-USDT symbols
  block because L04 has no canonical FX-conversion authority; quote units are
  never cross-cast into USDT.
- If reduction violates a minimum quantity/notional, the result is blocked.
  Minimum filters never trigger an automatic quantity or capital increase.
- Every positive static result still declares `sendEligible=false`,
  `externalActionAuthorization=NONE` and `actionAuthority=NONE_RECORD_ONLY`.
- Waiting work is bound to one content-derived instrument revision. A status or
  filter change requires re-preflight; receipt-time-only change cannot rewrite
  semantic identity.
- Instrument revision also binds the effective source maximum-age policy.
  Owner and caller freshness are capped at their smaller value and never exceed
  300,000 ms. Waiting decisions consume an injected evaluation time and bind
  any reference-evidence revision/interval; expiry or clock skew cannot remain
  `CURRENT`.
- Semantic `instrumentRevision`/`registryRevision` intentionally remain stable
  across receipt-only refreshes. Separate `sourceEvidenceRevision` and
  `snapshotRevision` bind source received/valid-until times, evaluation time
  and the exact receipt instance. Timestamp mutation cannot manufacture fresh
  evidence, while a genuine refresh triggers waiting-work re-preflight without
  rewriting semantic filter identity.
- Waiting bindings also carry the exact order type, time-in-force, USDT
  notional asset and prior evidence/snapshot revisions. A posture that could
  not have passed static preflight cannot claim `CURRENT`.

## External boundary

No private/account read, credential access, public exchange API call,
signed/test/live order, Margin action, real order, capital change,
AWS/Cloudflare/Secrets mutation, deployment or restart was performed or
authorized. `LIVE_EXECUTION_NOT_IMPLEMENTED` remains unchanged.
