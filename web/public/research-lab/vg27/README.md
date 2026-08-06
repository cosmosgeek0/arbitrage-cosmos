# V-G27 cross-sectional intraday quote-volume-dispersion regime

| item | expected | found | status |
|---|---|---|---|
| scope | one Binance-public-only verdict | fixed ten-symbol Spot USDT cohort; hourly quote-volume dispersion | SEALED_PROTOCOL |
| timing | causal signal then delayed fill | shared cash through `2025-07-01`; formation after `00/06/12/18` UTC bar close from `2025-07-02`; one full hourly bar intervenes; entry at `t+2h` open | SEALED_PROTOCOL |
| family | all attempts retained | `L={8,13,26}` weeks × dispersion multiple `{1.5,2.0}` × hold `{4,12}` hours = 12 | SEALED_PROTOCOL |
| allocation | full cohort or cash | all ten members equal-weight or 100% zero-yield USDT; no replacement, ranking, tail, or partial exposure | SEALED_PROTOCOL |
| missingness | never survivor-renormalize | any required cohort, signal, entry, mark, or exit bar stops the run as `UNMEASURED` | SEALED_PROTOCOL |
| costs | public proxy only | each row stores accumulated chargeable entry-plus-exit reference notional and frozen fee/adverse bp; costs must reconcile to notional × rate within `5e-12`; base `10+5`, stress `10+15`, severe `20+25` bp per side; account-effective cost `UNKNOWN` | SEALED_PROTOCOL |
| inference | interval and search control | 6,575 development and 2,183 holdout hourly-return observations; synchronous circular 7-day blocks; reconstructed Holm over all 12 raw p-values; centered White max-stat; all 70 eight-block CSCV orientations with 1–12 distinct paths and average OOS tie rank | SEALED_PROTOCOL |
| risk | drawdown and screen | hourly-open modeled net-liquidation drawdown; nominal initial-$1k 1 bp quote-volume screen only; reinvestment may exceed it; executable capacity `UNMEASURED` | SEALED_PROTOCOL |
| holdout | champion-only one-time open | `2026-04-01` through `2026-06-30`; remains unopened unless every development authorization gate passes | SEALED_PROTOCOL |
| authority | no action | consumer `N3 successor/final convergence`; capital `NO_GO`; execution authority `NONE` | SEALED_PROTOCOL |

## Commands

Run from `quant/` with Python 3.13 and the locked environment:

```bash
PYTHONPATH=.:src PYTHONHASHSEED=0 uv run --frozen \
  python research/vg27/experiment.py acquire

PYTHONPATH=.:src PYTHONHASHSEED=0 uv run --frozen \
  python research/vg27/experiment.py freeze

PYTHONPATH=.:src PYTHONHASHSEED=0 uv run --frozen \
  python research/vg27/experiment.py run

PYTHONPATH=.:src PYTHONHASHSEED=0 uv run --frozen \
  python research/vg27/experiment.py seal

PYTHONPATH=.:src PYTHONHASHSEED=0 uv run --frozen \
  python research/vg27/experiment.py verify
```

`acquire` is the only network-capable command. It downloads exact official
monthly Spot `1h` ZIP and adjacent `.CHECKSUM` bytes without opening a member.
`freeze` writes authoritative `freeze.v4.json`. It independently hashes and
binds all staged bytes, the exact Python implementation/version, Decimal
context, and quant runtime locks without opening a member. The code/static
packet began as a direct child of canonical
`a169b123fb186d1943a75ad648552c4d95be1be1`; the pre-outcome v1 rejection and
rejected v2 and v3 corrections remain byte-preserved in both packet and
external custody. The v4 supersession receipt binds rejected v3 packet and
external SHA-256
`54fdea8026e99b68653368bef2fbb6b44ceb98b11b14848a525a7dd0bfcef2da`,
rejected authority head
`5b5ff77e4173dff9b4588d9f85f9c79d738a78a8`, zero outcome receipts, and the
MAX reasons `HOLM_ADJUSTMENT_NOT_RECONSTRUCTED` and
`COST_SCENARIO_SEMANTICS_UNBOUND`.

`run` creates and syncs the development marker before the first development
archive body open. The marker is consumable once. A prior marker without a
result can only be finalized as terminal `UNMEASURED`; it cannot resume. The
packet authority is published only after a same-directory exclusive temporary
inode contains complete fsynced bytes; atomic no-clobber publication precedes
the external replica. A failure before the first packet marker is published
propagates with zero terminal receipts and is safe to retry. A damaged,
truncated, or symlink receipt path is non-authorizing custody evidence whose
exact kind and digest or link-text digest are bound by terminal `UNMEASURED`.
The production analysis always uses exactly 2,048 frozen bootstrap replicates;
bootstrap and White p-values must lie on the exact `k/2049` grid, while an
estimated PBO must lie on the exact `k/70` grid. There is no run-time replicate
override. The
paired development selection is sealed after development analysis and before
any holdout authority. The holdout marker hash-binds that selection and
champion before the first holdout archive body open and only after all
development gates pass. Packet receipts are written and synced first; external
paths are replicas. A partial replica becomes custody-terminal `UNMEASURED`
without creating or overwriting a missing twin. There is no repair, retune,
fallback, or rerun.

`seal` writes the exact packet-wide `SHA256SUMS` once after the terminal result.
`verify` is network-free. It checks exact hashes, receipt bindings, canonical
JSON, complete simulation/inference schemas, accounting identities, the frozen
champion selection rule over the stored 12-decimal base-net rows, and the packet
inventory. Validating that stored selection rule does not reconstruct returns
or perform a new empirical selection. Verification never decompresses an
archive, reconstructs a return path, or opens the holdout.

Every simulation row stores the directly accumulated chargeable entry-plus-exit
reference notional, the scenario's fee and adverse-execution bp, and its
serialized costs. Verification accepts only the narrow `5e-12` Decimal
tolerance needed for independently rounded 12-decimal costs and cost ratios.
A zero-event row must have exactly zero turnover, cost, gross PnL, and net PnL;
an active row must clear the frozen first-entry notional floor
`1000 / (1 + fee + adverse)`. Gross costs must be exactly zero. Formal gates,
screen flags, cost-reconciliation flags, champion selection, and the final
verdict are all derived from the sealed serialized rows, not higher-precision
in-memory values.

## Interpretation boundary

The fixed cohort is disclosed and survivorship-limited. The experiment is a
lagged predictive association test, not causal identification. Public quote
volume is not executable depth. Spread, order-book depth, impact, queue,
latency, filters at historical time, partial fills, and account-effective fees
remain `UNMEASURED` or `UNKNOWN`. Even a public-data `GO` cannot authorize
capital: the terminal capital verdict remains `NO_GO` and execution authority
remains `NONE` until account fees and executable capacity exist. The reported
minimum nominal initial-$1k screen and actual-entry-to-screen ratio are
diagnostics, not executable size limits. Local Holm and White adjustments cover
only V-G27's 12 trials. V-G1 through V-G27
program-wide multiplicity and shared-date dependence remain `NOT_CONVERGED`, so
local significance cannot be called verified-positive.
