# S-1H BTC/ETH relative-basis dislocation experiment

S-1H is one checksum-bound, public-only Binance historical experiment. It asks
whether an unusually rich normal Spot/perpetual basis in BTC or ETH, identified
by the causal ETH-minus-BTC relative-basis residual, mean-reverts after complete
public all-taker cost scenarios.

This is not S-1G carry. Funding rate, funding sign, funding forecast,
time-to-funding, and funding settlement clocks are forbidden from the signal,
ranking, entry, exit, and trial selection. Positive funding credits are discarded;
only realized adverse funding debits are charged.

The sealed lifecycle is:

1. `discover` reads only official `.CHECKSUM` sidecars and writes an external
   normalized inventory. No ZIP body is downloaded or opened.
2. `freeze` authenticates the protocol/evaluator/research bytes and emits one
   external freeze candidate.
3. Commit the exact freeze candidate as `freeze.v1.json`.
4. `acquire` downloads checksum-bound ZIP bytes without decompressing them.
5. `run` consumes the sole run marker before any ZIP is opened, evaluates the
   nine-month development and expanding walk-forward periods, and seals one
   champion only if every development gate passes. The April–June holdout is
   opened once for that champion only; if development rejects the family it stays
   untouched.
6. Commit the exact external result candidate as `result.v1.json`.
7. `report` authenticates the committed packet without network or recomputation.

Default external state:
`/private/tmp/cosmos-s1h-btc-eth-rv-basis-v1`.

```sh
/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/python \
  quant/research/s1h/experiment.py discover
/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/python \
  quant/research/s1h/experiment.py freeze
/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/python \
  quant/research/s1h/experiment.py acquire
/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/python \
  quant/research/s1h/experiment.py run
/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/python \
  quant/research/s1h/experiment.py report
```

Focused verification from `quant/`:

```sh
/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/ruff check research/s1h
/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/ruff format --check research/s1h
MYPYPATH=. /Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/mypy \
  --strict --explicit-package-bases \
  research/s1h/experiment.py research/s1h/test_experiment.py
PYTHONPATH=. PYTHONHASHSEED=0 \
  /Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/pytest -q \
  research/s1h/test_experiment.py
```

`measurementVerdict` is limited to `GO`, `NO_GO`, or `UNMEASURED`. A public
historical positive cannot authorize capital: current/account-effective USD-M
fees, historical filter continuity, matched executable depth, queue state,
receive-clock latency, and live executable capacity are unavailable. Therefore a
positive proxy result is capped at `UNMEASURED`, capital remains `NO_GO`, and
execution authority remains `NONE`.
