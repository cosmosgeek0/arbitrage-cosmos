# V-G1 official and primary source pins

Classification: `NON_DIRECTOR_MACHINE_EVIDENCE`. Full source and Git identifiers
in this file are machine evidence; director-facing output uses only last-four
identifiers and paths.

Sources were inspected on 2026-07-29 before evaluator implementation and before
any target BTCUSDT Spot 1h archive ZIP body was opened. Public checksum sidecars
were observed and frozen in `archive_manifest.v1.json`; they contain digests, not
market outcomes. A separate read-only 1m archive-format audit occurred before
freeze, but no 1h target CSV, price outcome, or strategy economic result was
opened or computed.

| Source | Exact pin or observation | V-G1 use |
| --- | --- | --- |
| Binance public archives | [`binance-public-data` `5c7f3197591c0d54d85dc43066226bc4c671d47a`](https://github.com/binance/binance-public-data/blob/5c7f3197591c0d54d85dc43066226bc4c671d47a/README.md); raw README SHA-256 `085ab91377aa9325d44f4c7ad27cce4ab381e158403e1d7df2bad39d1a66f7c6` | Official daily/monthly layout, Spot kline schema, adjacent SHA-256 sidecars, publication cadence, and the 2025-01-01 Spot archive switch to microsecond timestamps. Binance warns that archive files may later be replaced, so every consumed ZIP and sidecar is frozen by exact bytes. |
| Binance archive host | [`data.binance.vision`](https://data.binance.vision/), observed 2026-07-29 | Exact public GET-only source. A read-only HEAD confirmed `BTCUSDT-1h-2026-06.zip` exists. V-G1 permits only the frozen monthly BTCUSDT Spot 1h path; no REST fallback is allowed. |
| Binance Spot kline contract | [`binance-spot-api-docs` `6b8372cad7cecbdf5dd88a3372eafff51988c5cf`](https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/rest-api.md#klinecandlestick-data); raw `rest-api.md` SHA-256 `49ea6809243fc7fb426e07f2fe662097736c7bb405bd2da5eef637d715427999` | Klines are uniquely identified by open time and expose OHLC, base/quote volume, trade count, and taker-buy base/quote volume. Completed hourly archive bars are the entire signal input. |
| Binance Spot filters | [`filters.md` at `6b8372c`](https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/filters.md); raw SHA-256 `4b5a8f0f5d15bcf68fd7ac2059ba6c88da641c06fd7885e642330c5ac8124dd3` | Current filters do not prove historical `exchangeInfo`, status, or permissions. Current metadata is therefore forbidden as a selector and historical filter truth remains unavailable. |
| Binance current Spot fee table | [Spot fee schedule](https://www.binance.com/en/fee/trading), observed 2026-07-29; `NON_CONTENT_FROZEN_SCENARIO_ONLY` | Regular User standard maker/taker was `0.100% / 0.100%`, exactly 10 bp per fill. The BNB column was `0.07500% / 0.07500%`, but that discount is conditional and sensitivity-only. The dynamic page bytes are not content-frozen. V-G1 freezes 10 bp as a current generic standard-rate counterfactual applied to history, not historical or account total fee truth. |
| Binance fee structure | [Fee Structure on Binance](https://www.binance.com/en/support/faq/detail/115000429332), observed 2026-07-29; `NON_CONTENT_FROZEN_SCENARIO_ONLY` | Describes the standard regular-user fee and conditional BNB discount. The dynamic page bytes are not content-frozen. V-G1 assumes no VIP, BNB, or promotion for gates; special and tax commission remain `UNKNOWN_NOT_MODELED`, not zero. |
| Binance commission semantics | [`commission_faq.md` at `6b8372c`](https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/faqs/commission_faq.md); raw SHA-256 `580cfa59c9f55adae0d27bf38d2bc7f268ad759fdf054486e356464c30bbd54c` | Account/symbol commission includes standard, special, tax, and discount state. Exact account commission is signed `USER_DATA`; it is not called and remains `UNKNOWN`. |
| Net buying pressure in crypto | Bao Doan and Duc Hong Vo, *The interconnection between net buying pressures in derivatives and spot markets*, *The British Accounting Review* (2025), [DOI 10.1016/j.bar.2025.101702](https://doi.org/10.1016/j.bar.2025.101702) | Primary motivation for a conditional cross-market association between crypto buying pressure and market outcomes. It does not validate this Binance-only hourly compression/continuation rule or establish net profitability. |
| PBO | Bailey, Borwein, López de Prado, and Zhu, *The Probability of Backtest Overfitting*, [DOI 10.21314/JCF.2016.322](https://doi.org/10.21314/JCF.2016.322) | Motivates frozen 12-block CSCV on equal 30-day development blocks. |
| Multiple testing | Holm, *A Simple Sequentially Rejective Multiple Test Procedure*, *Scandinavian Journal of Statistics* 6 (1979) | Motivates exact one-sided Holm familywise correction over all 32 frozen trials. |
| Circular blocks | Politis and Romano, *A Circular Block-Resampling Procedure for Stationary Data*, [Stanford technical report](https://statistics.stanford.edu/technical-reports/circular-block-resampling-procedure-stationary-data) (1991; published in *Exploring the Limits of Bootstrap*, 1992) | Motivates deterministic synchronous fixed-length 7-day and 14-day circular blocks. This does not prove stationarity or finite variance. |

## Evidence boundary

The archive supplies executed-bar observations, not historical bid/ask, resting
depth, queue position, counterfactual impact, local receive time, decision latency,
account commission, actual orders, or fills. The second-bar open after one full
intervening hour plus a fixed adverse-execution charge is a declared scenario, not
fill proof. Quote turnover is a
participation proxy, not executable capacity. A `GO` can only be public research
evidence under the frozen public-kline cost counterfactual for the
owner-profitability consumer; account profitability stays `UNKNOWN`, capital
remains `NO_GO`, and execution authority remains `NONE`. April–June 2026 is
retrospective sequestered validation, not prospective confirmation.
