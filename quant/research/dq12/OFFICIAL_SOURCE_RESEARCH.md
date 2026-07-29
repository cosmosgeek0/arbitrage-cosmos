# DQ-12 current Binance source research

Checked 2026-07-30 before implementation. Only Binance-owned documentation,
repositories, and public endpoints were used. DQ-12 performs no network access.

## Primary sources

| Source | Current revision or access boundary | DQ-12 use |
|---|---|---|
| [Spot exchange information](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/general#exchange-information) | accessed 2026-07-30 | `/api/v3/exchangeInfo` is current exchange trading rules and symbol information; response fields and weight |
| [Spot enum definitions](https://developers.binance.com/en/docs/products/spot/enums) | accessed 2026-07-30 | current Spot symbol-status vocabulary |
| [Spot API documentation repository](https://github.com/binance/binance-spot-api-docs/tree/6b8372cad7cecbdf5dd88a3372eafff51988c5cf) | `6b8372cad7cecbdf5dd88a3372eafff51988c5cf` | current official Spot documentation revision and changelog |
| [USD-M exchange information](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#exchange-information) | accessed 2026-07-30 | `/fapi/v1/exchangeInfo` is current trading rules and contract information; response fields and weight |
| [USD-M common definitions](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/common-definition) | accessed 2026-07-30 | contract-type and contract-status vocabularies |
| [Binance public-data repository](https://github.com/binance/binance-public-data/tree/5c7f3197591c0d54d85dc43066226bc4c671d47a) | `5c7f3197591c0d54d85dc43066226bc4c671d47a` | archive namespaces and checksum boundary; archives do not provide historical exchange-info snapshots |

The current Git heads were measured directly before implementation. The two
live public exchange-info endpoints were each read once to check the current
documented shapes. Those live bytes are not fixtures and are not an authority
for future runs.

## Normative facts used by DQ-12

### Provenance and market type

Spot rows do not contain a literal `marketType=SPOT` field, and USD-M rows do
not contain a literal `marketType=USD_M` field. DQ-12 therefore binds market
type to the exact public endpoint provenance:

- Spot: `api.binance.com` plus `/api/v3/exchangeInfo`
- USD-M: `fapi.binance.com` plus `/fapi/v1/exchangeInfo`

A symbol suffix, concatenated symbol, `pair`, or caller label cannot establish
market type.

### Spot contract

The current Spot response exposes `symbol`, `status`, `baseAsset`,
`quoteAsset`, and `isSpotTradingAllowed`. Exact current eligibility requires
`status == "TRADING"` and `isSpotTradingAllowed is true`.

The current documented status values are `TRADING`, `END_OF_DAY`, `HALT`,
`BREAK`, and `CANCEL_ONLY`. An unrecognized value is unresolved rather than a
new trading state.

`permissions` is not a reliable Spot-market discriminator. Current live
responses can contain an empty `permissions` array while `permissionSets`
carries account permission expressions, and the API can omit permission sets
on request. DQ-12 therefore uses `isSpotTradingAllowed` for the venue contract
and does not reinterpret account permission expressions.

### USD-M contract

The USD-M response exposes `symbol`, `pair`, `contractType`, `deliveryDate`,
`onboardDate`, `status`, `baseAsset`, `quoteAsset`, `marginAsset`,
`underlyingType`, and `underlyingSubType`.

For the DQ-12 Spot-to-crypto-perpetual join, current eligibility requires:

- `contractType == "PERPETUAL"`
- `status == "TRADING"`
- `underlyingType == "COIN"`
- `pair == symbol`

The final predicate is a conservative DQ-12 project rule for a current
perpetual join. It prevents a dated contract's underlying `pair` from being
treated as the order-routing `symbol`.

Current documentation includes delivery contracts and delivery or settlement
states. The live response also contained `TRADIFI_PERPETUAL` and non-coin
underlying types. DQ-12 does not reinterpret any of those as a crypto
perpetual.

The documented endpoint weight is 20 for Spot and 1 for USD-M. Rate-limit
values are returned in the response and are not hard-coded as identity facts.

### Same-underlying and settlement boundary

The join uses explicit asset fields. It never splits or trims a symbol:

1. resolve each base asset through a scoped, evidence-referenced registry;
2. require one canonical underlying identity;
3. require one canonical quote identity;
4. require the USD-M `marginAsset` to resolve to the same quote identity.

The USD-M endpoint names `marginAsset`; it does not expose a separate
`settleAsset`. DQ-12 labels this value `SETTLE_PROXY_FROM_MARGIN_ASSET` and
never upgrades it to stronger settlement truth.

`pair` is not an alias. A dated contract can use an underlying pair such as
`BTCUSDT` while its order-routing symbol contains a delivery suffix.

### Aliases and migrations

Neither current exchange-info endpoint exposes former symbols, asset rename
history, validity intervals, or contract-unit multipliers. Current live USD-M
base assets include multiplier-like names such as `1000SHIB` while legitimate
asset names can also begin with a digit, such as `1INCH`.

DQ-12 therefore performs no prefix stripping, case folding, Unicode
normalization, suffix parsing, or implicit rebrand mapping. Any alias or
migration must be explicit, venue/market/role scoped, time bounded,
quantity-scale complete, and evidence referenced. The consuming protocol must
precommit the registry digest.

## Current-only limitation

Both exchange-info endpoints describe current rules and current symbol
information. The official public archive contains market-data files, not an
immutable history of exchange-info status snapshots. A current `TRADING` row
cannot prove that a symbol was trading at a historical observation time.

DQ-12 therefore supports only `CURRENT_ONLY`. A historical request, stale or
future capture, excessive cross-endpoint skew, missing migration evidence, or
unrecognized current enum fails closed as `UNKNOWN`.

## Live shape check

The one-time current payload check observed:

- Spot BTCUSDT with `TRADING`, `isSpotTradingAllowed=true`, and empty legacy
  `permissions`;
- USD-M BTCUSDT with `PERPETUAL`, `TRADING`, `COIN`, and matching
  quote/margin assets;
- a dated BTC contract whose `pair` and order-routing `symbol` differ;
- `BTCDOMUSDT` as a non-coin index perpetual;
- multiplier-like `1000SHIB` and digit-leading `1INCH` base assets;
- `TRADIFI_PERPETUAL` commodity and equity rows.

Those observations test the conservative rules above. They are not embedded
as historical truth, and their exchange-info `serverTime` values are not used
as capture clocks.
