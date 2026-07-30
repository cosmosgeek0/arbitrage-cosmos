# Volume finite archive economics

This successor reproduces the retained finite Volume archive experiment and
normalizes its economics for verdict-normalization/final-profitability. It
does not redesign or activate the accepted V-I2/V-I3/V-I4 prospective capture
substrate.

The input corpus is 120 official Binance Spot `1s` kline archives plus their
adjacent checksum sidecars: twelve scored months and three boundary files for
each of eight USDT symbols. The exact recovered measurement script is retained
at `measure_volume_12m.py` with SHA-256
`576ea91a27195553902766f78fa3994430fa30ff2a55f6bc3aaab251dca1b826`.
It maps the frozen detector cadence and threshold state, then applies a clearly
external 60-second shadow exit and a one-second fill delay.

The archive is valid only for the declared conditional proxy. Binance's
documented archive does not contain historical synchronized depth,
`bookTicker`, receive-clock, reconnect-generation, or point-in-time
`exchangeInfo` evidence. Unavailable book and capped raw-tape gates are assumed
to pass, the eight-symbol cohort is survivorship-biased, and the April-June
split is retrospective. No result here is accepted V-I2 lifecycle economics,
account-effective profitability, executable capacity, or USD parity.

`economics-policy.v1.json` was frozen before the current reproduction
completed. Prior outcomes were already known, so it explicitly forbids a
positive GO: a positive would be rejected until exact prospective OOS and PBO
gates pass. A robust negative may still establish the bounded archive verdict
`NO_GO`.

The committed evidence packet contains the compact accepted-event ledgers,
archive manifest, raw reproduction results, normalized terminal result, and
checksums. Raw multi-gigabyte ZIPs remain outside Git; the manifest binds each
URL, official sidecar digest, recomputed archive digest, member name, and size.

No network is used by `finalize_volume_economics.py` or
`verify_volume_economics.py`. The strategy remains DEFAULT OFF, KILL ON,
SHADOW ONLY, record-only, with no submit, CAS, private, signed, key, provider,
host, order, transfer, withdrawal, or money authority.

## Terminal result

The current source corpus exactly reproduced the retained event ledgers:
4,754 phase-0 events and 4,862 timer-alignment phase-1 events across
2025-07-01 through 2026-06-30. All 120 official archive sidecars verified.

Primary phase 0 measures:

- public 10 bps/side fee plus 5 bps/side slippage:
  `-2.962473567507` synthetic USDT per $1k aggregate entry notional,
  95% seven-day circular-block interval
  `[-3.056512138017, -2.867807826356]`;
- public 12 bps/side stress plus 5 bps/side slippage:
  `-3.362499292366` per $1k,
  interval `[-3.456518602527, -3.267858583968]`;
- stress maximum peak-to-trough cumulative modeled PnL drawdown:
  `191.823859630910` synthetic USDT at the repeated $12 event model;
  this is not a capital drawdown claim.

Phase 1 is independently negative under the same stress:
`-3.335946905795` per $1k with interval
`[-3.432101247596, -3.232371123613]` and modeled drawdown
`194.632486271680` synthetic USDT.

Both stress upper bounds are strictly below zero, so the finite archive
verdict is `NO_GO`. The OOS gate is failed because outcomes were already
opened, PBO is not established, `$1k` capacity is unknown, and
account-effective economics remain `UNMEASURED`. Those failures would reject
any positive; they do not weaken this negative archive disposition.
