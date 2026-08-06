# V-G22 — lagged quote-volume regime-gap continuation

| item | expected | frozen contract | status |
|---|---|---|---|
| scope | one distinct Binance public-only verdict | Spot monthly `1d` kline archives; USDT archive-discovered union | FROZEN |
| measurement window | twelve UTC months | 2025-07-01 through 2026-06-30 | FROZEN |
| development | four chronological fixed-rule evaluations | May-Oct is history buffer only; no selection or calibration; fixed-rule folds are Nov, Dec, Jan, Feb | FROZEN |
| holdout | one sealed untouched outcome partition | compressed Jan-Jun ZIPs are pre-acquired and checksum-authenticated; Jan-Feb are warmup; Mar-Jun members remain unopened until the fsynced holdout-open receipt; maximum one open | SEALED_BY_PROTOCOL |
| signal | lagged adjacent closed-bar volume regimes plus positive close | classify bars `t-1` and `t` with frozen empirical-tercile indices `floor((L-1)k/3)` and `<=` ties, using only each bar's prior `L` closes; require regime gap `G` and `close[t] > close[t-1]` | FROZEN |
| timing | no same-close fill | choose only after `t` closes; enter at `t+1` UTC open; exit after frozen hold | CAUSAL |
| cohort | deterministic cohort or cash | require 20-name causal risk set and at least 3 candidates; rank regime gap, exact-Decimal quote-volume ratio, exact-Decimal return ratio, UTF-8 symbol; equal-weight top 5 or fewer; otherwise cash | FROZEN |
| trials | bounded family | prior lookback `20/40/60` × minimum regime-class gap `1/2` × hold `1/3` = 12 | FROZEN |
| costs | explicit sensitivity proxies | every side pays frozen `10 bp` fee sensitivity plus adverse execution of `10 bp` base or `25 bp` stress; 10 bp is not public-table or account truth | PROXY_ONLY |
| inference | multiplicity and selection control | 4,096-path 7-day block bootstrap with deterministic per-trial streams; separate synchronous White draws; 8-block/70-split compounded-net PBO; highest compounded development base net selects | FROZEN |
| risk | comparable capital path | stress compounded return; maximum drawdown gate uses BASE NAV; `$1,000` research capital; `H` equal daily sleeves; zero allocations make coverage null and failing | FROZEN |
| capacity | bar-only participation screen | BASE-path entry allocation uses 1 bp of prior 30-day median quote volume in nominal USDT; USD conversion and executable capacity are `UNMEASURED` | PROXY_ONLY |
| freeze | exact pre-outcome identity | binds parent and pre-outcome commit, manifest, official sources, evaluator/tests/docs, ordered 12-trial family digest, and split-plan digest | REQUIRED |
| receipts | irreversible lifecycle | separate write-once fsynced development-open, selection/candidate-seal, holdout-open, and terminal receipts | REQUIRED |
| ledger | complete trial accounting | all 12 trial statuses and canonical ledger digest are mandatory | REQUIRED |
| lifecycle bias | historical membership truth | archive discovery does not prove point-in-time tradability and is not survivor-free | DISCLOSED |
| order-book inference | none allowed | no spread, depth, queue, impact, fill, or latency claim from klines | FORBIDDEN |
| terminal verdict | one sealed result | `GO`, `NO_GO`, or honest `UNMEASURED` under `protocol.v1.json` | REQUIRED |
| consumer | final convergence | N3 successor/final convergence | PINNED |
| authority | effects | no UI, host, provider, private API, account data, order, transfer, withdrawal, or money effect | NONE |

The protocol JSON is the controlling machine-readable contract. The official
source freeze records the current Binance documentation and the exact available
archive custody tuple. No outcome may alter either file.
