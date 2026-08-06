# S-1N funding-dispersion beta-matched continuation

S-1N is one public-only Binance USD-M historical experiment. It tests whether
the high side of a causally elevated cross-sectional funding dispersion
continues to outperform the low side for 6, 12, or 24 hours after matching the
two tails by prior BTC beta.

It is the reverse economic direction of S-1D: S-1N is long high normalized
funding and short low normalized funding. Every archive funding rate is
normalized with its published `funding_interval_hours`; no eight-hour schedule
is synthesized. Account-effective fees, matched executable depth, queue state,
latency, and live capacity remain `UNKNOWN` or `UNMEASURED`.

The frozen lifecycle is:

1. `discover` lists exactly 523 raw June 2025 monthly funding keys and
   authenticates each available June funding/kline sidecar. A missing screen
   sidecar is ledgered and excludes that symbol before ranking. Raw key count is
   not eligibility: the frozen grammar plus explicit stable/fiat base
   exclusions are applied before ranking.
2. `freeze` emits an external candidate binding the protocol, evaluator, tests,
   frozen official-source record, and discovery inventory. `seal-freeze`
   exclusively creates the repository freeze before any ZIP body is opened.
3. `screen` opens June warmup only, validates funding and the complete one-hour contract
   klines, and seals the no-replacement top 30 by total June quote volume.
4. `acquire` authenticates the exact selected Cartesian:
   30 symbols × 13 months × 3 datasets = 1,170 ZIPs plus sidecars. It downloads
   only June warmup through March development bodies; April–June holdout bodies
   remain absent even though their URLs and sidecars are sealed.
5. `run` consumes the sole marker before opening development. Missing,
   checksum-invalid, schema-invalid, or sample-incomplete evidence seals
   terminal `UNMEASURED`; a complete valid economic or inferential gate failure
   seals terminal `NO_GO`. Both leave the April 8–July 1 holdout unopened. Only
   a fully passing development family seals one champion and authorizes a
   separate `acquire-holdout`. That command downloads but does not decompress
   the 270 holdout bodies. `finalize-holdout` consumes the one holdout-open
   marker before any holdout decompression.
6. `seal-result` exclusively creates the repository result from the bound
   external candidate. `report` then verifies the committed packet without
   network or recomputation.

The default external state is
`/private/tmp/cosmos-s1n-funding-dispersion-beta-matched-v1`.

```sh
quant/.venv/bin/python quant/research/s1n/experiment.py discover
quant/.venv/bin/python quant/research/s1n/experiment.py freeze
quant/.venv/bin/python quant/research/s1n/experiment.py seal-freeze
quant/.venv/bin/python quant/research/s1n/experiment.py screen
quant/.venv/bin/python quant/research/s1n/experiment.py acquire
quant/.venv/bin/python quant/research/s1n/experiment.py run
quant/.venv/bin/python quant/research/s1n/experiment.py acquire-holdout
quant/.venv/bin/python quant/research/s1n/experiment.py finalize-holdout
quant/.venv/bin/python quant/research/s1n/experiment.py seal-result
quant/.venv/bin/python quant/research/s1n/experiment.py report
```

Focused verification from `quant/`:

```sh
ruff check research/s1n
ruff format --check research/s1n
MYPYPATH=. mypy --strict --explicit-package-bases \
  research/s1n/experiment.py research/s1n/test_experiment.py
PYTHONPATH=. PYTHONHASHSEED=0 pytest -q research/s1n/test_experiment.py
```

No positive public proxy result can authorize capital. A positive result is
`UNMEASURED`, capital remains `NO_GO`, and execution authority remains `NONE`.
