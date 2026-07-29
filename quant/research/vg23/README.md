# V-G23 — sealed public Spot abnormal-volume-breadth allocation

V-G23 tests one market-wide, price-free volume hypothesis over the last twelve
complete calendar months. At each weekly formation, every causally eligible Binance
Spot USDT symbol receives an own-history abnormal-volume ratio:

`mean(last 5 completed daily quote volumes) / median(prior 60 completed days)`.

The fraction above a frozen abnormality multiple is one market breadth scalar. That
scalar may change only the total exposure of a fixed 50/50 BTCUSDT/ETHUSDT proxy
sleeve; it cannot rank, select, rotate, or relatively weight symbols. The remaining
capital stays in zero-yield USDT.

Six trials are frozen: abnormal multiple `{1.50, 2.00}` crossed with breadth
saturation `{0.20, 0.35, 0.50}`. Risk exposure is
`min(1, breadth / saturation)`. A same-schedule continuously invested 50/50
BTCUSDT/ETHUSDT sleeve is the matched benchmark.

This is distinct from V-G8's cross-sectional volume-share top-K rotation and from
V-G15's static twelve-name daily binary cohort/cash regime.

## Sealed lifecycle

1. `freeze` reads only already checksum-verified shared discovery/acquisition
   manifests. It binds the protocol, evaluator, verifier, official-source note,
   archive-discovered universe, inventory, runtime, and costs without the evaluator
   opening a ZIP.
2. Commit the freeze before any V-G23 archive member is decompressed.
3. `run` creates the sole external run marker before development ZIP access.
4. Development chooses one champion under the frozen rule. The candidate seal and
   one-use holdout-open marker are written before any March-June 2026 ZIP is opened.
5. `run` writes an external immutable terminal-result core, embeds it in the run
   receipt, then writes exactly one result that binds both. A receipt/result write
   interruption can be closed with the data-free `finalize` command; it never
   reopens an archive or reruns an estimate.
6. Existing marker/result bytes make rerun, repair, retune, runner-up evaluation,
   or holdout reopening fail closed. `seal` writes packet checksums; the independent
   verifier authenticates the committed Git lineage, external markers, exact result
   core, headline, and frozen gate conjunction without recomputing outcomes.

A bounded read-only support lane performed a development-month schema-only scan
before freeze after the protocol draft existed; it retained no price or volume
outcomes and did not open March-June 2026 holdout archives. The freeze discloses
that scan and asserts only that economic outcome fields and holdout bytes remained
unopened. No rule, trial, cost, universe threshold, or direction was changed from
that scan.

Shared source/checksum state is read-only:

`/private/tmp/cosmos-s1f-weekly-momentum-cash-v1`

V-G23 one-use markers live separately:

`/private/tmp/cosmos-vg23-abnormal-volume-breadth-1be1-a780`

## Commands

Run with the locked Python 3.13.14 environment and `PYTHONHASHSEED=0`:

```sh
PY=/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/python
git add quant/research/vg23/{OFFICIAL_SOURCE_RESEARCH.md,README.md,experiment.py,protocol.v1.json,test_experiment.py,verify.py}
git commit -m "quant: freeze V-G23 protocol and evaluator"
PYTHONHASHSEED=0 $PY quant/research/vg23/experiment.py freeze
git add quant/research/vg23/freeze.v1.json
git commit -m "quant: seal V-G23 source inventory"
PYTHONHASHSEED=0 $PY quant/research/vg23/experiment.py run
# Only if the consumed run was interrupted before result closure:
# PYTHONHASHSEED=0 $PY quant/research/vg23/experiment.py finalize
# Render HANDOFF.md and VERIFICATION.md from the immutable result without
# changing any static or generated JSON evidence.
PYTHONHASHSEED=0 $PY quant/research/vg23/experiment.py seal
git add quant/research/vg23/{HANDOFF.md,SHA256SUMS,VERIFICATION.md,result.v1.json,run-receipt.v1.json}
git commit -m "quant: record V-G23 terminal verdict"
PYTHONHASHSEED=0 $PY quant/research/vg23/verify.py
```

Focused static and fixture proof runs from `quant/`:

```sh
PYTHONPATH=. PYTHONHASHSEED=0 \
  /Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/pytest -q \
  research/vg23/test_experiment.py
/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/ruff check research/vg23
/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/ruff format --check research/vg23
MYPYPATH=. PYTHONHASHSEED=0 \
  /Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/mypy \
  --strict --explicit-package-bases \
  research/vg23/experiment.py research/vg23/test_experiment.py
```

The measurement verdict is exactly `GO`, `NO_GO`, or `UNMEASURED`. `GO` remains
public shadow research with capital verdict `NO_GO`, execution authority `NONE`,
and no `VERIFIED_POSITIVE` status. Account-effective fees, historical filters,
spread/depth/impact, and executable capacity are not established by daily OHLCV.
