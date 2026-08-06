# S-1F official and primary source pins

All web sources were checked on 2026-07-28 before the evaluator was written or any
archive ZIP was opened.

| Source | Exact pin or observation | S-1F use |
| --- | --- | --- |
| Binance public data | [`binance-public-data` `5c7f3197591c0d54d85dc43066226bc4c671d47a`](https://github.com/binance/binance-public-data/blob/5c7f3197591c0d54d85dc43066226bc4c671d47a/README.md), commit time 2025-01-09T09:41:15Z, raw README SHA-256 `085ab91377aa9325d44f4c7ad27cce4ab381e158403e1d7df2bad39d1a66f7c6` | Monthly/daily layout, Spot kline schema, SHA-256 sidecars, next-day/first-Monday publication, and the 2025-01-01 millisecond-to-microsecond Spot timestamp transition. The README warns that archive files may later be replaced, so every consumed ZIP is checksum-bound. |
| Binance archive listing | [`data.binance.vision`](https://data.binance.vision/) and its public S3 bucket `https://s3-ap-northeast-1.amazonaws.com/data.binance.vision`, observed 2026-07-28 | Complete paginated archive-prefix discovery. Continuation tokens are treated as transport state, not evidence; normalized decoded prefix/key rows are hashed. |
| Binance Spot filters | [`binance-spot-api-docs` `6b8372cad7cecbdf5dd88a3372eafff51988c5cf`](https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/filters.md), commit time 2026-07-27T07:43:52Z | `PRICE_FILTER`, `LOT_SIZE`, `MIN_NOTIONAL`, `NOTIONAL`, and `MARKET_LOT_SIZE` are current rules. Binance does not publish a date-stamped historical `exchangeInfo` archive here; historical filter continuity is therefore unmeasured and current membership is forbidden as a backtest selector. |
| Binance current symbol metadata | [`GET /api/v3/exchangeInfo`](https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/rest-api.md) | Documents current status, order types, Spot permission sets, and filters. S-1F does not call it or apply current state retroactively. |
| Binance Spot commissions | [Current fee table](https://www.binance.com/en/fee/trading), observed 2026-07-28T17:32:20Z | Regular User Spot maker/taker was 0.100%/0.100%. S-1F freezes 10 bp per fill with no VIP, BNB, promotion, tax, or special reduction. |
| Binance commission semantics | [Commission FAQ at `6b8372c`](https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/faqs/commission_faq.md) | Exact symbol/account commission is a signed account fact and may include standard, special, tax, and discount state. It remains unmeasured in this public-only experiment. |
| Cross-sectional crypto momentum | Liu, Tsyvinski, and Wu, *Common Risk Factors in Cryptocurrency*, *Journal of Finance* 77 (2022), [DOI 10.1111/jofi.13119](https://doi.org/10.1111/jofi.13119) | Primary motivation for frozen 1–4 week relative-return trials. Their broad-market, value-weighted, long-short factor does not validate this Binance-only equal-slot long/cash implementation. |
| Canonical cross-sectional momentum | Jegadeesh and Titman, *Returns to Buying Winners and Selling Losers*, *Journal of Finance* 48 (1993), [DOI 10.1111/j.1540-6261.1993.tb04702.x](https://doi.org/10.1111/j.1540-6261.1993.tb04702.x) | Defines relative winner/loser ranking; used only as methodological ancestry. |
| Realistic crypto caution | Han, Kang, and Ryu, *Momentum in the Cryptocurrency Market: A Comprehensive Analysis under Realistic Assumptions*, [DOI 10.2139/ssrn.4675565](https://doi.org/10.2139/ssrn.4675565), revision 2026-03-26 | Costs, path dependence, skew, and fat tails can reverse apparently significant momentum profitability. |
| Tail-risk caution | Grobys and Shahzad, *Cryptocurrency Momentum: Is It an Illusion?*, [DOI 10.1002/ijfe.70036](https://doi.org/10.1002/ijfe.70036), first published 2025-08-13 | Motivates exact terminal net, block intervals, drawdown, and concentration rather than a Sharpe promotion gate. |
| PBO | Bailey, Borwein, López de Prado, and Zhu, *The Probability of Backtest Overfitting*, [DOI 10.21314/JCF.2016.322](https://doi.org/10.21314/JCF.2016.322) | Frozen 12-block CSCV on development rows only. |
| Multiple testing | Harvey, Liu, and Zhu, *…and the Cross-Section of Expected Returns*, [DOI 10.1093/rfs/hhv059](https://doi.org/10.1093/rfs/hhv059), published 2015-10-09 | Motivates declaring every attempted trial and familywise correction. |
| Reality check | White, *A Reality Check for Data Snooping*, [DOI 10.1111/1468-0262.00152](https://doi.org/10.1111/1468-0262.00152) | Motivates a synchronous centered max-statistic diagnostic across all trials. |
| Circular blocks | Politis and Romano, *A Circular Block-Resampling Procedure for Stationary Data*, [Stanford technical report](https://statistics.stanford.edu/technical-reports/circular-block-resampling-procedure-stationary-data), 1992 | Motivates seeded circular weekly blocks. It does not prove stationarity or finite variance. |

## Frozen interpretation limits

The official archive supplies OHLCV bars, not historical order books, spread, queue,
impact, account commission, historical filter snapshots, or guaranteed USDT/USD
parity. Daily opens plus fixed adverse execution are a declared scenario, not fill
proof. Quote volume is a participation proxy, not executable capacity. A research
`GO` can only mean forward-shadow intake; capital remains `NO_GO` and execution
authority remains `NONE`.
