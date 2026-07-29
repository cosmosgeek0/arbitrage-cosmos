# V-G17 lagged impact-efficiency regime

V-G17 is one sealed, public-only Binance Spot research packet for the N3
successor/final profitability convergence. It asks whether a fixed, disclosed
cohort of long-lived USDT assets with high lagged absolute return per unit of
quote volume earns positive net public-scenario returns in a causal long-or-cash
portfolio.

The ratio is an observational **impact-efficiency regime**. It is not an
identified price-impact coefficient. The packet has no UI, host, provider,
private API, account, order, execution, or money authority. Its effect is `$0`.

## Sealed lifecycle

1. `inventory` authenticates the exact public ZIP and `.CHECKSUM` bytes without
   opening ZIP members.
2. `freeze` binds protocol, evaluator, tests, source research, README, and the
   source manifest before any bar is decompressed.
3. The frozen packet is committed cleanly.
4. `run` consumes one immutable exclusive-create marker before the first
   decompression. Development either stops `UNMEASURED`, returns `NO_GO` with
   holdout untouched, or seals one champion before one holdout-open receipt.
5. `seal` writes the terminal packet checksum inventory without recomputing an
   outcome.
6. `report` authenticates committed evidence and prints it; it never reruns.

Source bytes are independently admitted from
`/private/tmp/cosmos-s1f-weekly-momentum-cash-v1`. Reusing those public
compressed objects does not reuse another strategy, outcome, or seal.

## Commands

Run from `quant/`:

```sh
PYTHONPATH=src:. PYTHONHASHSEED=0 python -B \
  research/vg17/experiment.py inventory
PYTHONPATH=src:. PYTHONHASHSEED=0 python -B \
  research/vg17/experiment.py freeze
PYTHONPATH=src:. PYTHONHASHSEED=0 python -B \
  research/vg17/experiment.py run
PYTHONPATH=src:. PYTHONHASHSEED=0 python -B \
  research/vg17/experiment.py seal
PYTHONPATH=src:. PYTHONHASHSEED=0 python -B \
  research/vg17/experiment.py report
```

Focused verification:

```sh
ruff check research/vg17
ruff format --check research/vg17
MYPYPATH=. mypy --strict --explicit-package-bases \
  research/vg17/experiment.py research/vg17/test_experiment.py
PYTHONPATH=src:. PYTHONHASHSEED=0 python -B -m pytest -q \
  -p no:cacheprovider research/vg17/test_experiment.py
(cd research/vg17 && shasum -a 256 -c SHA256SUMS)
```

## Truth boundary

Daily kline data can measure the frozen reference-price return path, declared
cost scenarios, drawdown, PBO, multiplicity, and a quote-volume participation
sensitivity. It cannot prove executable prices, intraday drawdown, historical
filters, account-effective fees, or executable capacity. Those fields remain
explicitly unmeasured.
