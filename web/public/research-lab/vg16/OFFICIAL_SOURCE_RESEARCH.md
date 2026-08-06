# V-G16 official-source research

Observed on 2026-07-29 before V-G16 implementation and before this experiment
opened any archive body.

## Binance public market data

- Binance documents `GET /api/v3/klines` as public market data. A kline is
  uniquely identified by open time, UTC is the default day boundary, and field
  eight is quote-asset volume. V-G16 uses completed `1d` bars and field eight
  only; the completed day is lagged and the earliest modeled entry is the next
  UTC open:
  <https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market>
- Binance's market-data-only host needs no API key. V-G16 uses no signed,
  account, user-data, order, wallet, or private endpoint:
  <https://developers.binance.com/en/docs/products/spot/faqs/market_data_only>
- Binance's official public archive provides monthly and daily Spot kline ZIPs
  plus sibling SHA-256 `.CHECKSUM` files. Its README states that Spot archive
  timestamps from 2025-01-01 use microseconds and that archived files can later
  be replaced after corrections. V-G16 therefore freezes the exact local ZIP,
  checksum, and acquisition-receipt bytes before opening any ZIP:
  <https://github.com/binance/binance-public-data/blob/master/README.md>
- `exchangeInfo` is current, not a historical membership table. V-G16 does not
  retrofit today's symbol status or filters onto historical bars. Its universe
  is point-in-time and archive-observed, inside the single USDT quote cohort:
  <https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/general>

## Source-normalization boundary

Binance defines klines by open time. Before seeing V-G16 outcomes, the protocol
therefore freezes one symbol-agnostic rule: adjacent rows with the same symbol
and open time are canonicalized to one observation only when all twelve decoded
fields are exactly equal. The packet records every such row and grants no extra
coverage. A conflicting duplicate, non-adjacent repeated key, malformed row, or
invalid UTC boundary is terminal `UNMEASURED`.

This packaging-anomaly class was known from earlier independent experiments.
The rule is documented identity normalization, applied uniformly before V-G16
opens bytes; it is not a symbol exclusion, outcome filter, or post-run repair.

## Public costs and capacity boundary

- The public regular-user Spot schedule displayed 0.100% maker and 0.100% taker
  on 2026-07-29. V-G16 charges 10 bp taker on both modeled fills, assumes no BNB,
  VIP, or promotion discount, and separately charges adverse-price scenarios:
  <https://www.binance.com/en/fee/trading>
- Binance explains that standard, tax, special, discount, account, and symbol
  components can change actual commission. Exact current symbol/account rates
  require account data and remain outside this public-only task:
  <https://developers.binance.com/en/docs/products/spot/faqs/commission_faq>
- Current Spot filters do not prove historical fractional executability, depth,
  spread, or impact. Quote volume supports only a lagged participation proxy.
  Because the selected quote asset is USDT, every monetary threshold, P&L, and
  public capacity proxy is labeled in USDT; V-G16 makes no USD-parity claim.
  Account-effective fees and executable capacity remain `UNKNOWN` or
  `UNMEASURED` regardless of the public-scenario verdict:
  <https://github.com/binance/binance-spot-api-docs/blob/master/filters.md>

## Statistical sources

- Chronological evaluation preserves the information order:
  <https://robjhyndman.com/hyndsight/tscv/>
- Circular block resampling retains short-run dependence; Holm controls the
  frozen trial family; White's Reality Check tests the best observed member
  against the full family:
  <https://doi.org/10.1080/01621459.1994.10476870>,
  <https://doi.org/10.2307/4615733>,
  <https://doi.org/10.1111/1468-0262.00152>
- CSCV/PBO is a development-only overfitting diagnostic. It never selects the
  champion, alters Holm or confidence intervals, touches the holdout, rescues a
  failed gate, or creates capital authority:
  <https://doi.org/10.21314/JCF.2016.322>
