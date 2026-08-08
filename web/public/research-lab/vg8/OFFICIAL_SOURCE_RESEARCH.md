# V-G8 official-source research

Research checked on 2026-07-29 before the V-G8 protocol or evaluator was written.

## Primary Binance sources

- Binance's official public-data repository documents the Spot monthly kline layout,
  the companion `.CHECKSUM` files, the twelve kline fields (including quote-asset
  volume), archive update caveats, and the Spot timestamp migration to microseconds
  from 2025-01-01:
  <https://github.com/binance/binance-public-data/blob/master/README.md>
- The current official Spot REST documentation identifies public market-data
  endpoints, UTC kline semantics, request limits, and millisecond/microsecond time
  handling:
  <https://developers.binance.com/en/docs/products/spot/rest-api>
- The current official kline endpoint contract says bars are uniquely identified by
  open time and exposes quote-asset volume:
  <https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market>
- The current Binance trading-fee page shows the regular-user Spot maker/taker
  schedule as 0.1000%/0.1000%. V-G8 assumes no BNB, VIP, pair promotion, special
  commission, or tax discount:
  <https://www.binance.com/en/fee/trading>
- Official commission documentation makes account/order-specific standard, special,
  tax, and discount truth authenticated user data. V-G8 makes no private call:
  <https://github.com/binance/binance-spot-api-docs/blob/master/faqs/commission_faq.md>
- Official Spot filter documentation defines `LOT_SIZE`, `MARKET_LOT_SIZE`,
  `MIN_NOTIONAL`, and `NOTIONAL`. Historical filter snapshots are not present in the
  public archive used here:
  <https://developers.binance.com/en/docs/products/spot/filters>

## Methodological sources

- Gervais, Kaniel, and Mingelgrin motivate abnormal-volume research in equities; this
  is a prior, not proof for crypto:
  <https://doi.org/10.1111/0022-1082.00349>
- Llorente, Michaely, Saar, and Wang show that the volume/return relation depends on
  trading motive, supporting V-G8's refusal to smuggle price direction into the
  volume-only signal:
  <https://doi.org/10.1093/rfs/15.4.1005>
- Recent crypto evidence reports that abnormal trading volume can proxy disagreement
  and that high-abnormal-volume assets can have lower subsequent returns. That makes
  the direction genuinely falsifiable:
  <https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4345640>
- Bailey et al. define combinatorially symmetric cross-validation and the probability
  of backtest overfitting:
  <https://doi.org/10.21314/JCF.2016.322>
- White defines the Reality Check used for data-snooping control:
  <https://doi.org/10.1111/1468-0262.00152>
- Politis and Romano define the stationary/block-bootstrap family used for
  dependence-aware uncertainty:
  <https://doi.org/10.1080/01621459.1994.10476870>

## Frozen interpretation

The official archive and its checksum sidecars are source evidence. Public fee and
adverse-execution numbers are scenarios. They are not account truth, fill proof,
historical spread/depth, or permission/filter history. Exact executable capacity and
account-effective fees remain `UNMEASURED`/`UNKNOWN`.
