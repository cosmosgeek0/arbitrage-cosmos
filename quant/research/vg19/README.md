# V-G19 abnormal-volume autocorrelation verdict

V-G19 is one sealed Binance public-only test of lagged persistence and decay in
seasonality-adjusted Spot quote-volume surprise. Its economic contract is an
equal-weight abnormal-volume cohort or USDT cash. It is not a breakout,
reversal, return-ranked rotation, taker-imbalance, futures, account, or
execution strategy.

At a completed UTC hour, each symbol's `log1p(quote volume)` is standardized
against only the previous 26 matching UTC hour-of-week observations using a
median and scaled MAD. The frozen primary selects the top three symbols only
when at least three have `z >= 2.5`; otherwise it stays cash. One full hour is
skipped, entry is the next open, holding is four hours, cohorts never overlap,
and future volume or price cannot affect selection.

## Sealed lifecycle

1. `acquire` downloads the 180 exact official ZIPs and 180 checksum sidecars,
   verifies compressed bytes without opening members, and creates
   `source_manifest.v1.json`.
2. `freeze` binds the protocol, complete 54-trial diagnostic ledger, evaluator,
   tests, research, README, and source manifest before any CSV member opens.
3. The pre-outcome freeze is committed.
4. `run` exclusively creates the run marker, opens warm-up/development bytes
   once, seals the frozen primary receipt, records the holdout open before
   opening March-June bytes, and writes exactly one terminal result.
5. `seal` creates the packet checksum inventory.
6. `report` verifies hashes and cross-file bindings only. It never downloads or
   recomputes outcomes.

Checksum, schema, timestamp, grid, seasonal-scale, selected entry/exit, or
receipt failure stops terminally as `UNMEASURED`. There is no repair, symbol
drop, substitution, threshold change, runner-up rescue, or rerun.

## Commands

Run from `quant/` using the repository-pinned environment:

```sh
PYTHONPATH=src:. PYTHONHASHSEED=0 ./.venv/bin/python -B \
  research/vg19/experiment.py acquire

PYTHONPATH=src:. PYTHONHASHSEED=0 ./.venv/bin/python -B \
  research/vg19/experiment.py freeze

PYTHONPATH=src:. PYTHONHASHSEED=0 ./.venv/bin/python -B \
  research/vg19/experiment.py run

PYTHONPATH=src:. PYTHONHASHSEED=0 ./.venv/bin/python -B \
  research/vg19/experiment.py seal

PYTHONPATH=src:. PYTHONHASHSEED=0 ./.venv/bin/python -B \
  research/vg19/experiment.py report
```

Focused verification:

```sh
./.venv/bin/ruff check research/vg19
./.venv/bin/ruff format --check research/vg19
MYPYPATH=src:. ./.venv/bin/mypy --strict --explicit-package-bases \
  research/vg19/experiment.py research/vg19/test_experiment.py
PYTHONPATH=src:. PYTHONHASHSEED=0 ./.venv/bin/python -B -m pytest -q \
  -p no:cacheprovider research/vg19/test_experiment.py
shasum -a 256 -c research/vg19/SHA256SUMS
```

## Truth boundary

The packet reports mechanism evidence, current-public-cost sensitivities, PBO,
drawdown, and an OHLCV participation screen. Account-effective fees,
historical admissibility, book fillability, and executable capacity remain
`UNKNOWN`. Even a public-screen pass is never capital or execution authority;
the packet's effect is `$0`.
