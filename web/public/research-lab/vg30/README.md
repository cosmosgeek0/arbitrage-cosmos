# V-G30 — lagged cross-sectional quote-volume tail concentration

V-G30 asks one frozen, public-data-only question:

> When positive own-history quote-volume anomalies become unusually
> concentrated in the cross-sectional upper tail on a completed Sunday, does
> the complete anomalous cohort earn positive net Tuesday-to-Tuesday return
> after declared public fee and adverse-price scenarios?

For every eligible Binance Spot USDT symbol on Sunday `D`, V-G30 computes

`A_i(D) = max(Q_i(D) / median(Q_i(D-60), …, Q_i(D-1)) - 1, 0)`.

For `p ∈ {0.10, 0.20}`, `k = ceil(p × |U_D|)` and `TC_p` is the fraction of
all strictly positive anomaly mass held by the first `k` symbols, ranked by
`A` descending and UTF-8 symbol bytes ascending. An event exists only when
`TC_p` strictly exceeds a frozen nearest-rank quantile of the exact prior 26
Sunday values. The six trials are the two tail fractions crossed with
`q ∈ {0.75, 0.90, 0.95}`.

The signal uses quote volume, symbol identity, and UTC bar time only. Price is
read only after selection for the lagged public return measurement. Signal and
selection do not use price, range, HHI, entropy, dispersion, breadth, raw
cross-sectional share, share acceleration, regime gaps, taker fields, trade
count, funding, open interest, futures, private, or account data.

## Frozen allocation and timing

- Point-in-time membership requires the current Sunday plus 60 exact prior
  daily bars and a prior-30-day median quote volume of at least 5,000,000 USDT.
- The risk set must contain at least 30 names and at least `k` strictly positive
  anomalies. Missing required signal evidence is `UNMEASURED`, never zero.
- A nonpositive 60-day median for a symbol that otherwise passes the lagged
  liquidity rule makes its anomaly undefined and is terminal `UNMEASURED`; the
  symbol cannot be silently dropped.
- Inactive event: 100% USDT cash.
- Active event: 100% equal weight in the complete top-`k` cohort.
- Monday is deliberately skipped. Entry is Tuesday `D+2` UTC open and exit is
  the next Tuesday `D+9` UTC open. Cohorts never overlap.
- A missing selected entry, exit, or capacity input is terminal `UNMEASURED`;
  there is no replacement, partial cohort, or cash relabel.

## Irreversible lifecycle

Run from `quant/` in the pinned project Python environment:

```sh
PYTHONPATH=. PYTHONHASHSEED=0 python -B research/vg30/experiment.py freeze
# commit and push source-manifest.v1.json plus freeze.v1.json
PYTHONPATH=. PYTHONHASHSEED=0 python -B research/vg30/experiment.py mark
# commit and push run-marker.v1.json
PYTHONPATH=. PYTHONHASHSEED=0 python -B research/vg30/experiment.py run
PYTHONPATH=. PYTHONHASHSEED=0 python -B research/vg30/experiment.py verify
```

`freeze` authenticates compressed ZIPs, sidecars, pair receipts, and exact
present/absent inventory without opening a ZIP member. `mark` requires a clean,
pushed, upstream-equal freeze and creates the immutable marker with
`O_CREAT|O_EXCL`, mode `0600`, file `fsync`, and directory `fsync`. `run`
requires that marker to be committed and pushed, consumes a separate fixed
local-state marker plus an identical packet receipt immediately before the first ZIP body
open, and is never repairable or repeatable in the sealed lineage. There is no
alternate state-root argument.

Development covers fully contained Tuesday-to-Tuesday cohorts in
2025-07-01 through 2026-02-28. March through June 2026 ZIP members remain
unopened unless the selected development champion passes every frozen public
gate. The holdout is then opened once, without retuning or a runner-up.
`verify` authenticates only the exact terminal packet and checksums; it never
opens archives or recomputes economics.

The source window starts in November 2024 solely to provide the exact 60 daily
bars and 26 prior Sundays needed before the first July 2025 development
cohort. Those warm-up observations cannot contribute returns, selection, or
inference. Binance Spot archive timestamps before 2025 are parsed as
milliseconds and timestamps from 2025 onward as microseconds, matching the
official public-data convention. Any missing preregistered history is terminal
`UNMEASURED`, not warm-up cash or a shortened lookback.

## Truth boundary

The four scenarios charge 20, 40, 70, and 120 nominal basis points per round
trip (fee-only, base, stress, and severe). They are public research
sensitivities. Account-effective fees remain `UNKNOWN`. The capacity statistic
is only `k × minimum selected prior-30-day median quote volume × participation`
at 1 bp and 0.5 bp. Historical spread, book depth, impact, filters, fill
probability, fractional executability, and executable capacity remain
`UNMEASURED`.

Gate inputs are serialized from the evaluator's unquantized fixed-point
`Decimal` values. Display rounding cannot move capacity, drawdown, inference,
or concentration across a frozen boundary. CSCV/PBO is diagnostic only and is
reported as unavailable, never zero, if a split has non-unique mean-score
ranking.

The terminal verifier rejects every extra file, hidden file, symlink, or
directory; revalidates marker mode and Git lineage; binds the local-state
consumption copy to the packet receipt; checks verdict/gate consistency; and
enforces the complete no-effect authority matrix. This is lineage-plus-local
custody, not a distributed lock against a malicious replay from a fresh clone.

Even a local `GO` is `PUBLIC_SCENARIO_ONLY`. Global positive-edge authority,
capital authority, and execution authority are always `NONE`. The consumer is
`N3 successor/final convergence`.
