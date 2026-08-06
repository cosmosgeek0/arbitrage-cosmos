# S-1H official and primary source pins

All sources below were checked on 2026-07-29 before the evaluator was written and
before any outcome ZIP was downloaded or opened.

| Source | Exact pin or observation | S-1H use |
| --- | --- | --- |
| Binance public data | [`binance-public-data` `5c7f3197591c0d54d85dc43066226bc4c671d47a`](https://github.com/binance/binance-public-data/blob/5c7f3197591c0d54d85dc43066226bc4c671d47a/README.md), raw README SHA-256 `085ab91377aa9325d44f4c7ad27cce4ab381e158403e1d7df2bad39d1a66f7c6` | Official monthly Spot and USD-M archive layout, schemas, SHA-256 sidecars, and publication cadence. The README warns that files can be replaced, so every ZIP is checksum-bound. Spot archive timestamps from 2025-01-01 are microseconds and are normalized explicitly. |
| Binance Spot REST documentation | [`binance-spot-api-docs` `6b8372cad7cecbdf5dd88a3372eafff51988c5cf`](https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/rest-api.md), raw SHA-256 `49ea6809243fc7fb426e07f2fe662097736c7bb405bd2da5eef637d715427999` | Public kline semantics and current `exchangeInfo`. Current metadata is not used to prove historical eligibility. |
| Binance USD-M market data | [Klines](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#kline-candlestick-data), [mark-price klines](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#mark-price-kline-candlestick-data), and [funding history](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#get-funding-rate-history), observed 2026-07-29 | Perpetual trade-price bars, settlement mark evidence, actual funding timestamps, and realized rates. Funding never enters the signal; favorable funding is omitted and adverse funding is charged. |
| Binance Spot commissions | [Current fee table](https://www.binance.com/en/fee/trading), observed 2026-07-29 | Regular User Spot maker/taker rendered as 0.100%/0.100%. S-1H freezes 10 bp per Spot fill with no BNB, VIP, promotion, tax, or special reduction. |
| Binance USD-M commissions | [Current fee page](https://www.binance.com/en/fee/futureFee), observed 2026-07-29, and [fee FAQ](https://www.binance.com/en/support/faq/detail/360033544231), updated 2026-05-01 | The unauthenticated current table rendered “No records found.” The FAQ's 0.02% maker / 0.05% taker Regular User figures are explicitly hypothetical. S-1H uses 5 bp per USD-M taker fill as a public baseline sensitivity, 10 bp in stress, and never calls either account truth. |
| Current filters | [Spot filters](https://developers.binance.com/en/docs/products/spot/filters), [Spot exchange information](https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/rest-api.md#exchange-information), and [USD-M exchange information](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#exchange-information) | `PRICE_FILTER`, `LOT_SIZE`, `MARKET_LOT_SIZE`, and notional rules are current facts only. Binance does not supply a date-stamped historical filter ledger for this experiment. |
| Multiple testing | Holm, *A Simple Sequentially Rejective Multiple Test Procedure*, [DOI 10.2307/4615733](https://doi.org/10.2307/4615733) | One-sided family p-values are corrected across all four frozen trials; failed/empty trials remain in the family. |
| Data snooping | White, *A Reality Check for Data Snooping*, [DOI 10.1111/1468-0262.00152](https://doi.org/10.1111/1468-0262.00152) | A synchronous centered max-statistic reality check is a development gate across the complete trial family. |
| Dependent resampling | Politis and Romano, *The Stationary Bootstrap*, [DOI 10.1080/01621459.1994.10476870](https://doi.org/10.1080/01621459.1994.10476870) | Seeded joint circular calendar blocks preserve cross-trial dependence. The empirical interval is not stationarity or finite-variance proof. |
| PBO | Bailey, Borwein, López de Prado, and Zhu, *The Probability of Backtest Overfitting*, [DOI 10.21314/JCF.2016.322](https://doi.org/10.21314/JCF.2016.322) | Frozen 8-block CSCV on development daily returns only. PBO is diagnostic and cannot override walk-forward, Holm, reality-check, lower-bound, drawdown, cost, or holdout gates. |

## Frozen interpretation limits

The archive provides OHLCV bars, mark-price bars, and funding settlements—not
historical bid/ask books, queue state, receive-clock latency, two-leg atomicity,
account-effective commission, historical filter snapshots, or USDT/USD parity.
Next-bar opens plus fixed adverse execution are declared scenarios, not fill
proof. Prior complete-bar quote volume is a participation proxy, not executable
capacity. A negative result is a defensible `NO_GO`; a positive public proxy
result is `UNMEASURED`, capital is `NO_GO`, and execution authority is `NONE`.
