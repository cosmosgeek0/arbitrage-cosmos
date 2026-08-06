# V-G31 — lagged quote-volume state-transition delta

V-G31 asks one narrow Binance-public-only question:

> Does a large change in the market-wide distribution of daily quote-volume
> state transitions predict positive forward return for a fixed equal-weight
> Spot cohort after public fee and adverse-price scenarios?

Each fixed member's completed daily quote volume is classified into one of four
states using only that member's immediately prior 84 days. At a Monday entry
`E`, a recent `{7,14,28}`-transition 4×4 joint frequency matrix through `E-2`
is compared with the immediately preceding disjoint 84-transition matrix. The
signal is their total-variation distance. Thresholds are `{0.10,0.20}` and
holds are `{3,7}` days, producing exactly twelve trials.

An active trial holds every one of the twelve preregistered members at equal
weight; an inactive trial stays entirely in zero-yield USDT. There is no member
ranking, top-K, rotation, price direction, or predecision price input. Missing
required evidence is terminal `UNMEASURED`, never a smaller cohort or cash.

## Sealed lifecycle

1. `freeze` authenticates the shared discovery/acquisition manifests and hashes
   only compressed ZIP, sidecar, and pair-receipt bytes. It does not list or
   decompress a ZIP member.
2. Before `run`, remain at the exact canonical base with exactly the complete
   untracked packet—and no tracked or out-of-scope change.
3. `run` records every frozen packet path and digest, then atomically creates
   the packet-local one-use run marker before opening the first development ZIP
   member.
4. All twelve development trials are evaluated synchronously. The sole
   champion is sealed only if every development gate passes.
5. The packet-local one-use holdout marker is created before any March–June 2026
   member is opened. Only the sealed champion is evaluated.
6. A consumed marker forbids repair, rerun, retuning, replacement members,
   alternate thresholds/directions, or a second holdout open.
7. `verify` authenticates the frozen bytes and any terminal receipts without
   reopening an archive or recomputing outcomes.

Shared source files are read-only:

`/private/tmp/cosmos-s1f-weekly-momentum-cash-v1`

V-G31 lifecycle markers stay inside the exclusive writer scope:

`quant/research/vg31/`

## Pre-outcome proof

Run from `quant/` with the locked environment:

```sh
PY=/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/python
PYTHONPATH=. PYTHONHASHSEED=0 "$PY" -B research/vg31/evaluator.py freeze
PYTHONPATH=. PYTHONHASHSEED=0 "$PY" -B -m pytest -q research/vg31/test_evaluator.py
"$PY" -m ruff check research/vg31
"$PY" -m ruff format --check research/vg31
MYPYPATH=. PYTHONHASHSEED=0 "$PY" -m mypy --strict \
  --explicit-package-bases research/vg31/evaluator.py \
  research/vg31/verify.py research/vg31/test_evaluator.py
PYTHONPATH=. PYTHONHASHSEED=0 "$PY" -B research/vg31/verify.py
```

The sealed run is deliberately absent from this implementation packet.
`result.v1.json`, run/holdout markers, and any profitability claim must remain
absent until the committed freeze passes independent exact-hash review.

The eventual measurement verdict is exactly `GO`, `NO_GO`, or `UNMEASURED`.
Even `GO` is public shadow research only: capital verdict remains `NO_GO`,
execution authority remains `NONE`, account-effective fees remain `UNKNOWN`,
and executable capacity remains `UNMEASURED`.
