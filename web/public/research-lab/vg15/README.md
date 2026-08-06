# V-G15 volume-breadth regime

V-G15 asks one narrow question: after a large share of a frozen twelve-symbol
Binance Spot USDT benchmark trades above each member's own lagged daily quote-volume
baseline, does holding the whole cohort beat cash after frozen public cost scenarios?

The signal is price-free and selection-free. It does not buy the high-volume names.
At an `ON` transition the research portfolio splits its notional equally across all
twelve frozen members, holds fixed units without internal rotation, and exits the
whole cohort at the next `OFF` open. Otherwise it holds cash.

## Sealed lifecycle

1. `freeze` validates and hashes compressed public ZIPs and companion checksum bytes
   without opening a ZIP member. It binds the exact protocol, evaluator, trial grid,
   source note, and 168 selected ZIP/sidecar pairs.
2. Commit the freeze packet.
3. `run` requires that committed freeze and a clean worktree, creates the sole-run
   marker with exclusive creation, and then opens development archives.
4. If no development candidate passes, the result is measured `NO_GO` and the
   holdout remains unopened.
5. If a candidate passes, its identity and development evidence are sealed before
   the holdout-open receipt is created. The four holdout months are then opened once
   for that candidate only.
6. Any custody, schema, chronology, continuity, causality, marker, or exit-integrity
   failure is terminal `UNMEASURED`; no deduplication, symbol drop, repair, or rerun
   is permitted.
7. `verify` authenticates the frozen packet and receipts without recomputing returns
   or opening archive members.

Run from `quant/`:

```bash
PYTHONPATH=src:. PYTHONHASHSEED=0 python research/vg15/experiment.py freeze
PYTHONPATH=src:. PYTHONHASHSEED=0 python research/vg15/experiment.py run
PYTHONPATH=src:. PYTHONHASHSEED=0 python research/vg15/experiment.py verify
```

Focused proof:

```bash
ruff check research/vg15
ruff format --check research/vg15
MYPYPATH=src:. mypy --strict --explicit-package-bases \
  research/vg15/experiment.py research/vg15/test_experiment.py
PYTHONPATH=src:. PYTHONHASHSEED=0 pytest -q \
  research/vg15/test_experiment.py \
  tests/q14/test_q14_splits.py \
  tests/q14/test_q14_multiplicity_bootstrap.py
```

## Truth boundary

- Public regular-taker scenario: 10 bp per executed side.
- Base adverse-price proxy: 10 bp per executed side; base total 20 bp.
- Stress adverse-price proxy: 25 bp per executed side; stress total 35 bp.
- Account-effective fees, taxes, discounts, promotions, spread, filters, and impact:
  `UNKNOWN`.
- Daily quote-volume participation capacity: measured proxy only.
- Historical executable capacity and intraday drawdown: `UNMEASURED`.
- Private/account/order/host/money effects: none.
- Capital authority: `NONE`.
- Consumer: N3 successor/final convergence.

The static cohort is a retrospective benchmark and may contain survivor-selection
bias. Within-family Holm correction and PBO do not control the wider profitability
search. A local `GO`, if reached, is still shadow research rather than capital
authority.
