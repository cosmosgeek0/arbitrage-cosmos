# V-G16 — lagged quote-volume concentration change

V-G16 asks one narrow public-data question:

> After a completed UTC day in which Binance Spot USDT quote volume becomes
> unusually more concentrated, does the exact cohort that contributed most to
> that HHI increase earn positive net return from the next UTC open to the
> following UTC open?

The signal uses squared cross-sectional quote-volume shares, not price,
funding, open interest, taker imbalance, trade count, raw own-history volume
shock, breakout, entropy, volatility, or seasonality. Each decision is either
one exact equal-weight long-only cohort or USDT cash. Missing required evidence
is never cash. All monetary outputs are denominated in USDT; no USD-parity
conversion is claimed.

## Immutable lifecycle

1. `freeze` verifies and hashes compressed official-source inputs without
   opening ZIP members. Commit the resulting packet.
2. `run` exclusively creates `run-marker.v1.json` before the first
   decompression. It evaluates all twelve development trials, seals a champion
   only if every development gate passes, and then exclusively creates
   `holdout-open.v1.json` before opening the four holdout months.
3. Evaluation errors after the marker are written as terminal `UNMEASURED`
   whenever durable output remains available. A process, disk, or power failure
   may leave only the consumed marker; that is still terminal and never
   authorizes repair or rerun.
4. `verify` authenticates packet bytes and lifecycle receipts. It never opens
   source archives or recomputes economics.

Run from `quant/`:

```sh
PY_BIN=/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin
PYTHONPATH=src:. PYTHONHASHSEED=0 "$PY_BIN/python" -B \
  research/vg16/experiment.py freeze
# commit the frozen packet before continuing
PYTHONPATH=src:. PYTHONHASHSEED=0 "$PY_BIN/python" -B \
  research/vg16/experiment.py run
PYTHONPATH=src:. PYTHONHASHSEED=0 "$PY_BIN/python" -B \
  research/vg16/experiment.py verify
```

V-G16 is research evidence only. It performs no UI, host, provider, account,
private, order, transfer, withdrawal, execution, or money action. Even `GO`
means only `PUBLIC_SCENARIO_ONLY`; capital and execution authority stay `NONE`.
