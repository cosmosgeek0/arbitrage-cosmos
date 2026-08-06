# V-G5 sealed abnormal-volume breakout

V-G5 is one public-only Binance Spot experiment over a predeclared 12-month signal
window. It tests a fresh structural-high breakout confirmed by abnormal quote
volume, a lagged rising-price trend, and an antecedent volatility regime. It is
not any V-G1/G2/G3/G4 signal family.

The lifecycle is intentionally one way:

1. `freeze` validates metadata only and writes `freeze.v1.json`; no ZIP body opens.
2. Commit the freeze packet as a direct child of canonical `a169…1be1`.
3. `preflight` authenticates compressed files and sidecars without decompression.
4. `run` creates the only development marker before opening development ZIPs.
   Signals enter at the second UTC daily open, after one full staging day.
5. A development failure returns `NO_GO` with the holdout unopened.
6. A development pass seals one champion, creates the one holdout marker, opens
   only that holdout once, and returns `GO`, `NO_GO`, or `UNMEASURED`.
7. If the process is interrupted after the run marker, `finalize` writes a
   receipt-bound result if available or terminates `UNMEASURED`; it never reruns.
8. `seal` authenticates the exact allowed packet file set; commit the terminal
   packet.
9. `report` authenticates the clean committed result without recomputation.

The shared corpus defaults to
`/private/tmp/cosmos-s1f-weekly-momentum-cash-v1` and is strictly read-only. V-G5
uses its own lifecycle root,
`/private/tmp/cosmos-vg5-abnormal-volume-breakout-v1`.

```sh
VG5_PYTHON=/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/python
PYTHONHASHSEED=0 PYTHONPATH=quant "$VG5_PYTHON" quant/research/vg5/experiment.py freeze
PYTHONHASHSEED=0 PYTHONPATH=quant "$VG5_PYTHON" quant/research/vg5/experiment.py preflight
PYTHONHASHSEED=0 PYTHONPATH=quant "$VG5_PYTHON" quant/research/vg5/experiment.py run
PYTHONHASHSEED=0 PYTHONPATH=quant "$VG5_PYTHON" quant/research/vg5/experiment.py seal
# Commit only quant/research/vg5/**, then:
PYTHONHASHSEED=0 PYTHONPATH=quant "$VG5_PYTHON" quant/research/vg5/experiment.py report
```

Focused proof:

```sh
cd quant
/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/ruff check research/vg5
/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/ruff format --check research/vg5
MYPYPATH=. /Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/mypy \
  --strict --explicit-package-bases research/vg5/experiment.py \
  research/vg5/test_experiment.py
PYTHONPATH=. PYTHONHASHSEED=0 \
  /Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/pytest -q \
  research/vg5/test_experiment.py
```

All economics are USDT treated as USD at a frozen 1:1 reporting convention.
Executable capacity, account-effective fees, historical spread/impact, and
capital authority remain `UNKNOWN`/`NONE`, including for a measured `GO`.
