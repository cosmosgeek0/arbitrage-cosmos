# V-G23 official-source research

Research checked on 2026-07-29 before the V-G23 protocol or evaluator was frozen.

## Primary Binance sources

- Binance's official public-data repository documents Spot monthly kline archives,
  companion `.CHECKSUM` files, the twelve kline fields including quote-asset volume,
  later archive replacements, daily/monthly publication cadence, and Spot
  microsecond timestamps from 2025-01-01:
  <https://github.com/binance/binance-public-data/blob/master/README.md>
- Binance's current market-data-only documentation says `exchangeInfo` and `klines`
  are public and require no API key on `data-api.binance.vision`:
  <https://developers.binance.com/en/docs/products/spot/faqs/market_data_only>
- The current Spot REST documentation defines UTC time handling, public endpoint
  behavior, and millisecond/microsecond request and response semantics:
  <https://developers.binance.com/en/docs/products/spot/rest-api>
- The current kline contract says bars are keyed by open time and exposes base
  volume, quote-asset volume, trade count, and taker-buy volume:
  <https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market>
- The current trading-fee page is used only to motivate the retrieval-dated regular
  user 0.1000%/0.1000% public scenario:
  <https://www.binance.com/en/fee/trading>
- Binance's commission FAQ makes actual standard, special, tax, symbol-promotion,
  and discount truth account/order specific. It also documents that a Spot BUY
  commission is normally charged from received base and a SELL commission from
  received quote:
  <https://developers.binance.com/en/docs/products/spot/faqs/commission_faq>
- Current `LOT_SIZE`, `MARKET_LOT_SIZE`, `MIN_NOTIONAL`, and `NOTIONAL` filters do
  not establish historical filters:
  <https://developers.binance.com/en/docs/products/spot/filters>

## Methodological sources

- Gervais, Kaniel, and Mingelgrin motivate abnormal-volume research; their equity
  result is a prior, not evidence for Binance Spot:
  <https://doi.org/10.1111/0022-1082.00349>
- Llorente, Michaely, Saar, and Wang show that volume-return relations depend on
  trading motives. V-G23 therefore keeps price direction out of the signal and
  tests both absolute and broad-proxy excess returns:
  <https://doi.org/10.1093/rfs/15.4.1005>
- Bailey et al. define CSCV and the probability of backtest overfitting:
  <https://doi.org/10.21314/JCF.2016.322>
- White defines the data-snooping Reality Check:
  <https://doi.org/10.1111/1468-0262.00152>
- Politis and Romano define the stationary/block-bootstrap family used for
  dependence-aware uncertainty:
  <https://doi.org/10.1080/01621459.1994.10476870>

## Frozen interpretation

V-G23 reuses the checksum-bound, read-only archive-discovered USDT corpus at
`/private/tmp/cosmos-s1f-weekly-momentum-cash-v1`. It does not use current
`exchangeInfo` to select historical winners and does not reacquire or mutate shared
archives.

A support lane checked development-month ZIP schema only before the formal freeze,
after the protocol draft was fixed. It retained no price/volume outcomes and did not
open holdout months. The packet records this disclosure rather than claiming that
no supporting process ever opened a development ZIP.

Archive existence and daily bars reduce current-survivor filtering but cannot prove
historical `TRADING` status, permissions, filters, listing eligibility, or complete
absence of survivorship bias. A checksum-valid malformed history is causally
ineligible under a rule frozen before outcomes; it is never normalized or manually
excluded after inspection.

Daily quote volume is a public participation proxy, not historical spread, depth,
queue, impact, latency, fill, or executable-capacity evidence. Public costs are
sensitivity scenarios. Account-effective fees and executable capacity remain
`UNKNOWN` and `UNMEASURED`, respectively.
