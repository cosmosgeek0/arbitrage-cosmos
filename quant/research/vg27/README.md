# V-G27 cross-sectional intraday quote-volume-dispersion regime

| item | expected | found | status |
|---|---|---|---|
| scope | one Binance-public-only verdict | fixed ten-symbol Spot USDT cohort; hourly quote-volume dispersion | SEALED_PROTOCOL |
| timing | causal signal then delayed fill | shared cash through `2025-07-01`; formation after `00/06/12/18` UTC bar close from `2025-07-02`; one full hourly bar intervenes; entry at `t+2h` open | SEALED_PROTOCOL |
| family | all attempts retained | `L={8,13,26}` weeks × dispersion multiple `{1.5,2.0}` × hold `{4,12}` hours = 12 | SEALED_PROTOCOL |
| allocation | full cohort or cash | all ten members equal-weight or 100% zero-yield USDT; no replacement, ranking, tail, or partial exposure | SEALED_PROTOCOL |
| missingness | never survivor-renormalize | any required cohort, signal, entry, mark, or exit bar stops the run as `UNMEASURED` | SEALED_PROTOCOL |
| costs | public proxy only | base `10+5`, stress `10+15`, severe `20+25` bp per side; account-effective cost `UNKNOWN` | SEALED_PROTOCOL |
| inference | interval and search control | synchronous circular 7-day blocks; Holm over 12; centered White max-stat; all 70 eight-block CSCV orientations with average OOS tie rank | SEALED_PROTOCOL |
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
`freeze` writes authoritative `freeze.v3.json`. It independently hashes and
binds all staged bytes, the exact Python implementation/version, Decimal
context, and quant runtime locks without opening a member. The code/static
packet began as a direct child of canonical
`a169b123fb186d1943a75ad648552c4d95be1be1`; the pre-outcome v1 rejection and
rejected v2 correction remain byte-preserved in both packet and external
custody. The v3 supersession receipt binds the exact rejected v2 packet and
external digest, rejected authority head, zero outcome receipts, and MAX
reasons.

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
there is no run-time replicate override. The
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
champion selection rule over the stored 12 base-net rows, and the packet
inventory. Validating that stored selection rule does not reconstruct returns
or perform a new empirical selection. Verification never decompresses an
archive, reconstructs a return path, or opens the holdout.

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
