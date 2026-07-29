# S-2K — Binance Spot cross-sectional realized-skewness verdict

S-2K is one sealed, public-data-only replication of the negative
cross-sectional realized-skewness effect. It ranks a fixed twenty-symbol USDT
cohort on each completed UTC day's five-minute realized skewness, then models a
dollar-neutral long-low/short-high portfolio or holds the whole portfolio in
cash. The primary strategy, direction, cohort, timing, estimator, costs,
partitions, inference, and one-run lifecycle are frozen before any economic
archive is decompressed.

Cash means zero primary P&L, not an invented zero rank correlation. Because
rank IC is the frozen secondary hypothesis in the same Holm family, any signal
date lacking its complete score and forward-return cohort makes the run
`UNMEASURED`. Public volume capacity aggregates all absolute entry and exit
quote weights sharing a symbol and execution bar before applying the one-basis-
point participation proxy.

This is a synthetic factor test, not an executable Spot strategy. Its negative
weights require borrow or Margin inventory that public Spot archives do not
prove. Account-effective commission, borrow availability and cost, historical
filters, spread/depth, queue position, latency, impact, collateral, and
liquidation feasibility remain `UNKNOWN` or `UNMEASURED`. Public fee and volume
figures are proxies only. Capital authority is always `NO_GO`; execution
authority is always `NONE`.

The lifecycle is:

1. `freeze` writes the exclusive protocol freeze before archive acquisition.
2. Commit the static freeze packet.
3. `acquire` downloads every direct frozen Binance ZIP and `.CHECKSUM` pair,
   verifies SHA-256, and does not decompress any archive.
4. `run` creates `RUN_STARTED.v1.json` with exclusive-create and durable fsync
   before the first development decompression.
5. Development is evaluated once. Only if every frozen development gate passes
   is one candidate sealed and the holdout marker created before any holdout
   decompression.
6. `report` and `verifier.py` authenticate the committed terminal packet without
   network or economic recomputation.

Commands, from `quant/` in the S-2K worktree:

```text
PYTHONPATH=. python research/s2k/experiment.py freeze
PYTHONPATH=. python research/s2k/experiment.py acquire --workers 8
PYTHONPATH=. python research/s2k/experiment.py run
PYTHONPATH=. python research/s2k/experiment.py report
PYTHONPATH=. python research/s2k/verifier.py
```

Focused proof:

```text
ruff check research/s2k
ruff format --check research/s2k
MYPYPATH=. mypy --strict --explicit-package-bases \
  research/s2k/experiment.py research/s2k/verifier.py \
  research/s2k/test_experiment.py
PYTHONPATH=. PYTHONHASHSEED=0 pytest -q research/s2k/test_experiment.py
```

The committed packet contains no raw archives. External state is frozen at
`/private/tmp/cosmos-s2k-realized-skewness-2afc-v1`.
