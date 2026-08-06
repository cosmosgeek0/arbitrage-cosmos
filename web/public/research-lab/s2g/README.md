# S-2G — sealed weekday × lagged-volume Spot verdict

This packet preregisters and runs one Binance-public-only experiment over the
half-open 12-month measurement window `[2025-07-01, 2026-07-01)`. It starts
from exact base `a169b123fb186d1943a75ad648552c4d95be1be1` and owns only
`quant/research/s2g/**`.

## Frozen question

For every target UTC day `D`, can a fixed 12-symbol Binance Spot cohort earn
positive net USDT per initial 1,000 under public cost proxies when ranked by:

`two-way-centered prior same-weekday return mean × centered prior quote-volume level rank`?

The cohort was preregistered before S-2G by accepted V-G15 commit
`dcd47073c043ad6dce87cfd5db8ea6a372b4e0c4`; S-2G never filters it using
current exchange status or S-2G returns. Historical survivorship remains a
limitation.

All signal data ends at `D-2`; `D-1` is unused. The 12 trials are
`weekday weeks {4,8} × volume days {1,7,28} × tail K {2,3}`. Each active day is
equal-weight `+0.5` top-K and `-0.5` bottom-K; otherwise the strategy holds
zero-yield USDT cash. The short side is synthetic research with borrow
availability and cost `UNKNOWN`.

The return component subtracts each symbol's all-day mean over the same trailing
`7L` return days and then subtracts the cross-sectional weekday mean. Centering
the volume rank at `0.5` prevents a raw standalone-volume score. Equal-weight
selected tails are not constrained to be orthogonal to either component, so
this is a joint-score strategy verdict—not a structural interaction coefficient
or proof that component exposures are zero.

The final open in each partition is liquidation-only. That intentionally omits
the development-to-holdout crossing return and the post-window crossing return,
so no sealed boundary is crossed merely to obtain an exit price.

## Sealed lifecycle

1. `freeze` verifies shared compressed ZIP/checksum/receipt bytes without
   opening an archive, binds the exact protocol/static packet, and emits
   `freeze.v1.json`, `source-manifest.v1.json`, and `SHA256SUMS`.
2. A human-inspectable frozen state is retained before outcomes. `run` then
   creates `run-marker.v1.json` with `O_EXCL` before the first decompression.
3. All 12 development trials run over `[2025-07-01, 2026-03-01)`. The fixed
   selection is highest `PUBLIC_STRESS` compounded net, then trial ID.
4. The holdout `[2026-03-01, 2026-07-01)` is opened once for that champion only
   if it passes every development gate. Development failure leaves it unopened.
5. Any post-marker failure is terminal `UNMEASURED`; repair, rerun, and reopen
   are forbidden. `verify.py` is network-free and never opens archive members.

Commands from `quant/`:

```bash
S2G_PYTHON=/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/python
PYTHONHASHSEED=0 PYTHONPATH=. "$S2G_PYTHON" -m research.s2g.evaluator freeze
PYTHONHASHSEED=0 PYTHONPATH=. "$S2G_PYTHON" -m research.s2g.evaluator verify
PYTHONHASHSEED=0 PYTHONPATH=. "$S2G_PYTHON" -m research.s2g.evaluator run
PYTHONHASHSEED=0 PYTHONPATH=. "$S2G_PYTHON" -m research.s2g.verify
```

## Interpretation boundary

`GO` means only that every frozen public-scenario development and single
holdout gate passed. `NO_GO` means at least one valid frozen gate failed.
`UNMEASURED` means the preregistered estimate could not be validly completed.
Capital remains `NO_GO` in every case. Account-effective fees are `UNKNOWN`;
executable and short-borrow capacity are `UNMEASURED`. Because sibling public
research reused the same calendar, global holdout status is always
`NOT_CERTIFIED_SHARED_REUSE_RISK`; N3 successor/final convergence is the sole
consumer.

The 14-day circular-block interval is conditional on the realized signal and
turnover path; it does not re-estimate signals inside each replicate. Initial
opening and final liquidation log costs are spread uniformly across inference
observations so each bootstrap draw includes those boundary costs exactly once,
while reported NAV and monthly P&L retain their true clock placement. PBO is an
eight-month, 70-split diagnostic—not a verdict gate. Holm and the basic
unstudentized White check cover the 12 searched strategy variants, not an
omnibus structural interaction hypothesis.
