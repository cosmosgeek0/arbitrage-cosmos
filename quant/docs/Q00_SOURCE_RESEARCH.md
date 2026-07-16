# Q00 current primary-source research

Retrieved 2026-07-12 before Q00 implementation. Only official Binance documentation/repositories were used for exchange claims. Q03 must pin exact revisions and content hashes again; web documentation is mutable.

## Sources

1. Binance public archive repository and checksum/update policy, pinned at `5c7f3197591c0d54d85dc43066226bc4c671d47a`: <https://github.com/binance/binance-public-data/commit/5c7f3197591c0d54d85dc43066226bc4c671d47a>
2. Binance Spot API general information and market-data-only endpoint: <https://developers.binance.com/en/docs/products/spot/rest-api>
3. Official Spot WebSocket stream contract, pinned at docs commit `31643ed390e2aa450ce872981556186acf96a195`: <https://github.com/binance/binance-spot-api-docs/blob/31643ed390e2aa450ce872981556186acf96a195/web-socket-streams.md>
4. Current rendered Spot WebSocket documentation: <https://developers.binance.com/en/docs/products/spot/web-socket-streams>
5. Current USD-M connection/migration contract: <https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/Connect>
6. Binance developer documentation and supported-interface policy: <https://developers.binance.com/en/docs/introduction>

Pinned content hashes recorded by the Q00 research pass:

```text
binance-public-data README SHA-256 085ab91377aa9325d44f4c7ad27cce4ab381e158403e1d7df2bad39d1a66f7c6
Spot web-socket-streams.md SHA-256 32bf73a0bed3b75e3ca981fdbaf48c53544bbdfb5944ef8ed1c4d7af9aceba0a
Spot CHANGELOG.md SHA-256 3c87303c7ba632d7240d34a7271652aaa8a4f5aebe8023eec6ab36a13bd10f8a
Binance llms-full.txt retrieval SHA-256 c72e3a3d9c840cf7db9ce5df5844106dda9a4b681d5d6539ff79e9c90ce0cbe0
```

## Decisions forced by current sources

- Public archive ZIPs have adjacent SHA-256 checksum files, but Binance may later replace archives and publishes an updates history. Manifests must retain retrieval time, URL, checksum and revision; a path/date is not immutable identity.
- Spot public archive timestamps switch to microseconds from 2025-01-01. Preserve the raw integer and per-file declared/inferred unit; reject ambiguous or mixed-unit partitions.
- The documented free archive supports Spot/Futures aggregate trades, trades and klines. Directory presence for other event families is not enough to accept their schema or coverage.
- USD-M `bookDepth` archive files are coarse percentage-band snapshots, not sequenced L2; `metrics` is aggregated context. Neither can be upgraded into high-fidelity book truth.
- The archive repository README says MIT, but there is no repository `LICENSE` file or explicit raw archive-data redistribution grant. Record repository license as `MIT_IN_README_ONLY`, archive-data license as `NOT_EXPLICIT`, and raw redistribution as `UNKNOWN_REQUIRES_APPROVAL`.
- Archive data lacks local receive clocks and cannot prove live latency, queue position, opportunity decay, or complete L2 reconstruction.
- Spot aggregate trades, book ticker and depth expose different time/sequence facts. In particular, a stream without authoritative event time must keep source time null instead of substituting receive time.
- Spot and USD-M depth reconstruction and overlap rules are product-specific. They require separately versioned adapters and gap/resnapshot tests.
- Current USD-M contracts are changing around unified market/RPI fields and public/market WebSocket paths. Q03 source cards must pin the exact contract revision and preserve fields such as product identity and RPI coverage instead of copying permanent constants from Q00. See the official [migration notice](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/Important-WebSocket-Change-Notice) and [change log](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/change-log).
- Since the 2026-04-23 migration, USD-M depth/book ticker use `/public` while aggregate trades, mark price and liquidations use `/market`; merged feeds require retaining and filtering the product marker rather than assuming every record is USD-M. Futures depth continuity uses its separate [official local-book contract](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/How-to-manage-a-local-order-book-correctly).
- USD-M aggregate-trade and visible-depth coverage can differ because RPI inclusion/exclusion differs. Flow features must expose that mismatch rather than compare them as identical liquidity populations.
- Official USD-M liquidation wording currently conflicts over whether the per-symbol 1,000 ms sample retains the latest or largest event. Treat it as sampled/incomplete with selection `UNKNOWN` until a pinned authoritative clarification; never sum silence as zero or call it complete liquidation volume.
- Official interfaces evolve. Every adopted source needs a versioned `DataSourceCard`, license/retention decision, identity map, timestamp/sequence semantics, rate/resource budget, hypothesis value, canonical producer owner, and observable failure state.
- Cross-venue leadership remains evidence-only. Granger-style lead/lag statistics are not tradable alpha until measured receive, inference, execution latency and costs preserve the effect out of sample.

## Q00 adoption status

| Source | Status | Reason |
| --- | --- | --- |
| Binance public archive | `ADAPT` for Q03 coarse history | official and checksum-backed; per-file coverage/schema/revision and raw-data license/redistribution posture still must be manifested |
| Canonical Intelligence Runtime capture | `ADAPT` for Q03 forward atlas | only approved production producer; missing Q append-only bridge remains an integration gap |
| Full historical L2 inferred from candles/archive directories | `REJECT` | no credible sequence/local-receive reconstruction |
| New Q-owned production Binance socket/poller | `REJECT` | violates canonical producer ownership and can backpressure/diverge from runtime truth |
| Additional venues/context sources | `REFERENCE_ONLY` at Q00 | require a later source card and narrow hypothesis-specific experiment |

## H5 and exit-liquidity constraints

Primary research supports anomaly and event-stage hypotheses, not a generic calibrated `P(bait)`. Keep distinct targets such as scheduled-target rank, pre-onset ignition, onset-now detection, continuation/exhaustion/fade horizons, and size/horizon-specific executable exit capacity.

- Xu and Livshits supports chronological event splits and ranking hypotheses, but resampling changes absolute score meaning: <https://www.usenix.org/conference/usenixsecurity19/presentation/xu-jiahua>
- La Morgia et al. is post-onset detection and its rush-order grouping remains a fill-aggregation proxy: <https://doi.org/10.1145/3561300>
- Li, Shin and Wang supports time-to-peak, MFE/MAE and fade outcomes; later price decline is not executable capacity without contemporaneous depth: <https://doi.org/10.1017/S0022109025000201>
- Benford/round-number/trade-size work is cohort-level diagnostic evidence only and needs point-in-time tick, step, notional, denomination and aggregation controls: <https://www.nber.org/papers/w30783>

Later H5 work must split whole events before window generation, purge overlapping label/feature intervals, embargo neighbors, preserve natural prevalence in calibration/test, report proper scoring/calibration uncertainty, and use `UNCALIBRATED_SCORE` or abstain when positives are insufficient. Exit outcomes require explicit size/horizon bid capacity, VWAP impact, slippage, fill fraction and time-to-fill. Owner annotations remain immutable weak supervision with `as_of`, visible evidence and outcome-hidden status; they never overwrite objective labels.

No source was called during deterministic tests and no market data was downloaded in Q00.
