# S-1F weekly cross-sectional Spot momentum/cash experiment

S-1F is one checksum-bound, public-only Binance Spot research experiment. It rotates
an equal-slot USDT portfolio into the strongest positive-return names inside a
point-in-time liquid top-30 cohort, or leaves unused slots in cash. It is a
cross-sectional continuation test, not BTC time-series trend, funding carry,
post-funding crowd unwind, or intraday reversal.

The sealed lifecycle is:

1. `discover` lists only archive metadata and writes a complete external discovery
   manifest.
2. `freeze` binds the exact archive-discovered universe, target-key inventory,
   protocol bytes, and evaluator bytes before any ZIP is opened.
3. Commit the freeze.
4. `acquire` downloads checksum-bound ZIP bytes without decompressing them.
5. `run` creates its sole run marker, opens development archives only, seals one
   champion, atomically opens the untouched holdout once, and writes `result.v1.json`.
6. `report` authenticates the committed packet without network or recomputation.

Default external state lives at
`/private/tmp/cosmos-s1f-weekly-momentum-cash-v1`. Raw listings, archives, and full
manifests are never committed.

```sh
/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/python \
  quant/research/s1f/experiment.py discover
/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/python \
  quant/research/s1f/experiment.py freeze
/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/python \
  quant/research/s1f/experiment.py acquire
/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/python \
  quant/research/s1f/experiment.py run
/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/python \
  quant/research/s1f/experiment.py report
```

Focused verification:

```sh
cd quant
/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/ruff check research/s1f
/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/ruff format --check research/s1f
MYPYPATH=. /Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/mypy \
  --strict --explicit-package-bases \
  research/s1f/experiment.py research/s1f/test_experiment.py
PYTHONPATH=. PYTHONHASHSEED=0 \
  /Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/pytest -q \
  research/s1f/test_experiment.py
```

`measurementVerdict` is limited to `GO`, `NO_GO`, or `UNMEASURED`. Even a measured
`GO` is shadow research only. Historical filters, account-effective fees, book
depth, realized impact, and live executable capacity remain unmeasured; capital is
always `NO_GO` and execution authority is always `NONE`.
