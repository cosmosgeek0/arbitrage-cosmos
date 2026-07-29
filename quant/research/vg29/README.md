# V-G29 lagged quote-volume-to-range elasticity break

V-G29 is one sealed Binance-public-only profitability experiment for the N3
successor/final convergence. It asks whether a market-wide break in the
relationship between completed-day quote volume and completed-day intraday
range identifies a profitable long-only regime.

The signal is deliberately narrow:

- `range_d = ln(high_d / low_d)`;
- each symbol's elasticity is the OLS slope of `ln(quote_volume)` on
  `ln(range)` over a fixed completed-day window;
- the break is a short-window slope minus a disjoint older baseline-window
  slope;
- Monday entry uses bars only through the prior Saturday;
- a trial is invested only when the fixed fraction of symbols with a positive
  break reaches its fixed breadth threshold;
- an invested trial holds the entire fixed cohort at equal weight for seven
  calendar days; otherwise it holds USDT cash.

This is not observed market impact, order-book elasticity, causal demand,
breakout, reversal, quote-volume acceleration, or account-executable capacity.

## Custody

1. `acquire` downloads official monthly Spot `1d` ZIP and `.CHECKSUM` bytes,
   verifies the sidecars, and writes a source manifest without opening a ZIP.
2. `freeze` binds the protocol, evaluator, tests, source research, collision
   audit, README, and compressed-source manifest before any archive member is
   read.
3. The freeze is committed cleanly.
4. `run` atomically consumes one external and one packet-local development
   marker before the first decompression.
5. The complete development evidence is sealed as a standalone artifact before
   any champion or holdout receipt. Development failure seals `NO_GO` with
   every holdout ZIP unopened. Only a development champion passing every
   frozen gate can create the one holdout open receipt.
6. `seal` validates the local/external custody chain and writes `SHA256SUMS`;
   `report` authenticates and prints existing
   evidence without recomputation.

## Commands

Run from `quant/`:

```sh
PYTHONPATH=src:. PYTHONHASHSEED=0 python -B research/vg29/experiment.py acquire
PYTHONPATH=src:. PYTHONHASHSEED=0 python -B research/vg29/experiment.py freeze
PYTHONPATH=src:. PYTHONHASHSEED=0 python -B research/vg29/experiment.py run
PYTHONPATH=src:. PYTHONHASHSEED=0 python -B research/vg29/experiment.py seal
PYTHONPATH=src:. PYTHONHASHSEED=0 python -B research/vg29/experiment.py report
```

Focused verification:

```sh
ruff check research/vg29
ruff format --check research/vg29
MYPYPATH=. mypy --strict --explicit-package-bases \
  research/vg29/experiment.py research/vg29/test_experiment.py
PYTHONPATH=src:. PYTHONHASHSEED=0 python -B -m pytest -q \
  -p no:cacheprovider research/vg29/test_experiment.py
(cd research/vg29 && shasum -a 256 -c SHA256SUMS)
```

## Truth boundary

Official daily klines can measure the frozen reference-price path, public cost
scenarios, close-mark drawdown, block-bootstrap intervals, multiplicity, PBO,
and a quote-volume participation sensitivity. They cannot establish historical
listing/filter truth, account-effective fees, spreads, fills, latency,
intraday drawdown, order-book depth, or executable capacity. Those limits
remain explicit even if the public scenario is positive.
