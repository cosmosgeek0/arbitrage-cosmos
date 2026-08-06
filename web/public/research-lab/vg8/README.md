# V-G8 — sealed public Spot abnormal-volume rotation

V-G8 tests one volume-only cross-sectional hypothesis over the last twelve complete
calendar months: rotate a long-only Spot portfolio weekly toward symbols whose share
of eligible-universe quote volume accelerated over five days versus the immediately
prior sixty days.

The signal never consumes price direction, return, trend, volatility, breakout,
reversal, compression, climax, taker flow, funding, private data, or account state.
Six trials are frozen: `K={3,5,8}` crossed with retention buffer `{0,2}`. A
same-schedule liquidity-level portfolio tests whether the signal beats a simple
liquidity rank; it does not eliminate every market-beta or composition difference.

## Sealed lifecycle

1. `freeze` reads only the already checksum-verified shared discovery/acquisition
   manifests. It binds the exact protocol, evaluator, source note, archive-discovered
   universe, inventory, runtime, and source-manifest bytes. It never opens a ZIP.
2. Commit the freeze.
3. `run` writes the sole external run marker before the first development ZIP is
   decompressed. It selects one champion using development only.
4. `run` writes the candidate seal and one-use holdout-open marker before opening any
   March–June 2026 ZIP.
5. `run` writes exactly one terminal `result.v1.json`. A result or prior marker makes
   rerun/refit/reopen fail closed.
6. `verify` authenticates the committed packet without recomputing outcomes.

`HANDOFF.md` contains exactly one proposed FABLE5 §5 row for the successor/orchestrator
to append. V-G8 does not mutate shared `run.md`.

Shared archive/checksum state is read-only:

`/private/tmp/cosmos-s1f-weekly-momentum-cash-v1`

V-G8's one-use markers live separately:

`/private/tmp/cosmos-vg8-abnormal-volume-rotation-1be1-5d58`

## Commands

```sh
PY=/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/python
PYTHONHASHSEED=0 $PY quant/research/vg8/experiment.py freeze
git add quant/research/vg8
git commit -m "quant: freeze V-G8 volume-share rotation"
PYTHONHASHSEED=0 $PY quant/research/vg8/experiment.py run
PYTHONHASHSEED=0 $PY quant/research/vg8/experiment.py seal
PYTHONHASHSEED=0 $PY quant/research/vg8/experiment.py verify
```

Focused checks:

```sh
cd quant
PYTHONPATH=. PYTHONHASHSEED=0 \
  /Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/pytest -q \
  research/vg8/test_experiment.py
/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/ruff check research/vg8
/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/ruff format --check research/vg8
```

The measurement verdict is exactly `GO`, `NO_GO`, or `UNMEASURED`. Even `GO` would
remain public shadow research with capital verdict `NO_GO` and execution authority
`NONE`. Daily OHLCV cannot establish historical book depth, actual fills, historical
filters, latency, account-effective fees, or executable capacity.
