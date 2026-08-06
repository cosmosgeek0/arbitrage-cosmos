# S-1I official and primary source pins

All sources were checked on 2026-07-29 before the evaluator was written and
before any outcome ZIP was opened.

| Source | Current fact used by S-1I |
| --- | --- |
| [Binance USD-M Premium Index klines](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#premium-index-kline-data) | `GET /fapi/v1/premiumIndexKlines`; one-hour is supported and the limit is 1,500. Only timestamps and Premium Index OHLC are semantic. Positions 5 and 7-11 are documented as ignored, even though archive CSVs use generic kline headers. S-1I uses only the close and timestamps. |
| [Binance USD-M regular klines](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#kline-candlestick-data) | `GET /fapi/v1/klines`; quote asset volume is tuple field 7 and is used only for a causal liquidity screen and volume-participation capacity proxy. Candle volume is not order-book depth or fill evidence. |
| [Binance USD-M funding-rate history](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#funding-rate-history) | `GET /fapi/v1/fundingRate` is public and documents funding time, funding rate, and the mark price associated with a funding-fee charge. S-1I deliberately does not capture plaintext API responses before the candidate seal because that could expose untouched-holdout outcomes. It instead uses checksum-verified archive timestamps, interval hours, and rates: rates are normalized to an eight-hour equivalent, enter only an OLS nuisance control fit on the prior 30 same-anchor days, and are checked for signed dollar-weighted exposure in the selected tails. Any actual archive funding timestamp at or between a selected position's entry and exit makes the cohort unmeasured; equal-timestamp ordering is not assumed and no settlement cash flow is invented. |
| [Binance public-data repository](https://github.com/binance/binance-public-data/blob/master/README.md?plain=1) and [archive](https://data.binance.vision/) | Public daily/monthly files, USD-M kline schema, adjacent SHA-256 sidecars, next-day/first-Monday cadence, and the warning that archived objects may later be replaced. S-1I freezes URL, checksum text, ZIP SHA-256, byte size, and parsed evidence hashes. |
| [Binance Exchange Information](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#exchange-information) | The endpoint is a current snapshot. `MARKET_LOT_SIZE`, `LOT_SIZE`, and precision fields are distinct. S-1I does not use current membership or current filters as historical evidence. Historical rule snapshots are unavailable. |
| [Binance Futures fee explanation](https://www.binance.com/en/support/faq/detail/360033544231) | Defines maker/taker semantics and fee = position value times rate. Its 0.05% taker number is an educational example, not account-effective historical truth. S-1I labels 5 bp per fill as an official illustrative public scenario, assumes no VIP/BNB/promotion reduction, and never calls it realized commission. |
| [Binance User Commission Rate](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/account#user-commission-rate-user_data) | Exact current commission is signed `USER_DATA`; historical realized commissions require private fill records. Both are prohibited here, so account-effective fees remain `UNKNOWN`. |
| [White, Reality Check](https://doi.org/10.1111/1468-0262.00152) | Motivates a synchronous centered moving-block maximum-statistic check across every frozen diagnostic. |
| [Romano and Wolf, Stepwise Multiple Testing](https://doi.org/10.1111/j.1468-0262.2005.00615.x) | Motivates explicit family-wise inference rather than selecting one attractive parameter result. S-1I also reports Holm-corrected one-sided block-bootstrap tests. |
| [Bailey et al., Probability of Backtest Overfitting](https://doi.org/10.21314/JCF.2016.322) | Motivates development-only combinatorially symmetric cross-validation (CSCV/PBO). It is diagnostic only: holdout observations never enter it, and it cannot select or replace the predeclared primary. |
| [Ackerer, Hugonnier, and Jermann, Fundamentals of Perpetual Futures](https://arxiv.org/abs/2212.06888) | Provides economic motivation for studying perpetual-price deviations and their convergence. It does not validate this rule, its fills, or profitability. |

## Frozen interpretation limits

The checksum-verified archives supply hourly OHLCV, premium-index OHLC, and
funding timestamps, interval hours, and rates. S-1I does not capture the public
funding-history mark-price response before the candidate seal, so a selected
position spanning an actual settlement is explicitly unmeasured. The evidence
also does not supply historical bid/ask, queues, depth, spread, realized trade
impact, account commissions, margin state, or historical exchange filters.

The regular-user 5 bp taker value and fixed 2/5/10 bp adverse-price scenarios are
declared stress models. Quote volume is only a public participation proxy.
Exit-boundary drawdown is not intrahour liquidation drawdown. A positive packet
therefore cannot become capital authority; missing cost truth stays missing.
