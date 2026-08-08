# V-G32 — lagged liquidity-leader membership-churn regime

V-G32 tests whether daily churn in the identity of Binance Spot quote-volume
leaders predicts positive public-model profitability for one fixed
50/50 BTCUSDT/ETHUSDT sleeve.

For each completed UTC day, every eligible symbol is ranked on the identical
common risk set at `t` and `t-7` by its trailing-30-day median quote volume.
The signal is:

`1 - |Top20(t) intersect Top20(t-7)| / 20`.

The current scalar is compared only with its own prior 30 or 60 valid
observations. Eight frozen trials cross `{30,60}` history, `{0.15,0.30}` tail
probability, and `{HIGH_ON,LOW_ON}` polarity. A signal completed on day `t`
can change the portfolio only at the `t+2` UTC open. Top-K members are never
traded; `ON` holds fixed BTC/ETH units and `OFF` is zero-yield USDT cash.

This is a public liquidity-membership proxy, not float-adjusted asset turnover,
historical executable liquidity, or account profitability.

## Sealed lifecycle

1. Synthetic tests and static checks complete without reading a shared ZIP.
2. `freeze` rechecks current V-G31 bytes, authenticates shared custody, hashes
   every selected compressed ZIP, sidecar, and pair receipt, and binds all
   protocol/code/source bytes without listing or decompressing a ZIP member.
3. `run` creates the sole external development marker before the first member
   open.
4. All eight development trials are evaluated. Any failed development gate
   closes `NO_GO` and leaves March-June 2026 holdout members unopened.
5. Only if every development gate passes is the sole champion sealed. A separate
   holdout-open marker is created before any holdout member is opened.
6. Marker consumption forbids repair, source substitution, symbol dropping,
   retuning, refreezing, runner-up use, or rerun. Data-free terminal finalization
   is the only allowed recovery.

Shared source root (read-only):

`/private/tmp/cosmos-s1f-weekly-momentum-cash-v1`

Exclusive V-G32 state root:

`/private/tmp/cosmos-vg32-lagged-liquidity-turnover-1be1-a0fe`

## Commands

Run from `quant/` with the locked Python 3.13.14 environment:

```sh
PY=/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/python
PYTHONPATH=. PYTHONHASHSEED=0 "$PY" -B -m pytest -q research/vg32/test_experiment.py
"$PY" -m ruff check research/vg32
"$PY" -m ruff format --check research/vg32
MYPYPATH=. PYTHONPATH=. PYTHONHASHSEED=0 "$PY" -m mypy --strict \
  --explicit-package-bases research/vg32/experiment.py \
  research/vg32/test_experiment.py research/vg32/verify.py
PYTHONPATH=. PYTHONHASHSEED=0 "$PY" -B research/vg32/experiment.py freeze
PYTHONPATH=. PYTHONHASHSEED=0 "$PY" -B research/vg32/experiment.py run
# Only for a consumed marker interrupted after immutable terminal-core creation:
# PYTHONPATH=. PYTHONHASHSEED=0 "$PY" -B research/vg32/experiment.py finalize
PYTHONPATH=. PYTHONHASHSEED=0 "$PY" -B research/vg32/experiment.py seal
PYTHONPATH=. PYTHONHASHSEED=0 "$PY" -B research/vg32/experiment.py verify
PYTHONPATH=. PYTHONHASHSEED=0 "$PY" -B research/vg32/verify.py
```

The measurement verdict is exactly `GO`, `NO_GO`, or `UNMEASURED`. Even `GO`
has capital verdict `NO_GO`, execution authority `NONE`, and effect `$0`.
Account-effective fees remain `UNKNOWN`; historical filters, depth, spread,
impact, fills, and executable capacity remain `UNMEASURED`.
