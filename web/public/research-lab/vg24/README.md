# V-G24 — cross-sectional quote-volume lead-lag network

V-G24 is one sealed Binance-public-only verdict. Each completed Sunday `d`
forms a causal dynamic top-30 from the prior 30 days, computes robust
leave-one-out market-adjusted log quote-volume surprises, and applies a rolling
directional network learned from the prior 120 lag-two observations. Active
sources need residual surprise at least `2.0`; each source contributes exactly
three stable asymmetric outgoing edges or none. A trial buys the exact top
`K={3,5,8}` downstream targets at Tuesday `d+2` open and exits after
`H={1,3}` days, or keeps the entire sleeve in USDT cash.

Monday is a complete staging day. A selected cohort with any missing
pre-entry bar stays wholly in cash with no replacement. Once entry succeeds,
any missing required mark or scheduled exit makes the sealed measurement
`UNMEASURED`; it is never repaired or rerun.

## Sealed lifecycle

From `quant/`:

```sh
PYTHONPATH=. PYTHONDONTWRITEBYTECODE=1 PYTHONHASHSEED=0 \
  /Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/python -B \
  research/vg24/experiment.py freeze \
  --source-root /private/tmp/cosmos-s1f-weekly-momentum-cash-v1

PYTHONPATH=. PYTHONDONTWRITEBYTECODE=1 PYTHONHASHSEED=0 \
  /Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/python -B \
  research/vg24/experiment.py run \
  --source-root /private/tmp/cosmos-s1f-weekly-momentum-cash-v1

PYTHONPATH=. PYTHONDONTWRITEBYTECODE=1 PYTHONHASHSEED=0 \
  /Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/python -B \
  research/vg24/experiment.py verify \
  --source-root /private/tmp/cosmos-s1f-weekly-momentum-cash-v1
```

`freeze` is the only pre-outcome command. It reuses the exact read-only S-1F
discovery/acquisition metadata, hashes every required local compressed ZIP,
sidecar, and pair receipt, verifies the sidecar declaration, writes
`source-manifest.v1.json`, and writes a commit-bound `freeze.v1.json`. It never
opens a ZIP container or member. The freeze is committed before `run`.
The argument is deliberately named `--source-root`: that fixed S-1F tree is
read-only. All V-G24 lane state and write-once receipts live only under
`quant/research/vg24`, outside the source root.

`run` uses write-once `O_EXCL` and fsync receipts. It consumes the sole
evaluation authority before opening the first real member, evaluates all six
development trials, seals one champion, and opens the March-June holdout at
most once only if every frozen development gate passes. Any source, schema,
timing, post-entry, or receipt failure is terminal `UNMEASURED`; valid weak
economics are `NO_GO`. No rerun, repair, alternate threshold, runner-up rescue,
or post-outcome refreeze is permitted.

## Focused network-free proof

```sh
cd quant
/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/ruff check research/vg24
/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/ruff format --check research/vg24
MYPYPATH=. /Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/mypy \
  --strict --explicit-package-bases \
  research/vg24/experiment.py research/vg24/test_experiment.py
PYTHONPATH=. PYTHONDONTWRITEBYTECODE=1 PYTHONHASHSEED=0 \
  /Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/python -B -m pytest \
  -q -p no:cacheprovider research/vg24/test_experiment.py
```

The result reports gross, public-base, public-stress, and fee-stress net per
initial `$1,000`; a dependence-aware one-sided 95% lower bound and two-sided
90% interval; Holm and White reality-check diagnostics; 8-month-block/70-split
CSCV-PBO; drawdown; concentration; cash fraction; comparator excess; and a
prior quote-volume 1 bp capacity proxy.
Account-effective fees are `UNKNOWN`, executable capacity is `UNMEASURED`, and
consumer authority is limited to N3 successor/final convergence. The machine
result separates `localPublicScreenVerdict` from the unconditional
`capitalVerdict=NO_GO`, `widerProfitability=UNKNOWN`, and authority `NONE`; a
local screen pass is never exposed as a lone generic `GO`.
