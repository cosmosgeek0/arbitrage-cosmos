# V-G20 — synchronized-major volume diffusion

V-G20 is one sealed Binance-public-only test of whether a completed joint
BTCUSDT/ETHUSDT daily quote-volume shock precedes a future fixed liquid-alt cohort
return after one full lag day.

The contract is deliberately distinct:

- only BTC/ETH quote volume can trigger an event;
- alt volume, price, return, breadth, and event-time ranking cannot trigger or
  choose the cohort;
- the cohort is selected once from the 61 pre-development days and never
  substituted;
- signal day `t` closes, day `t+1` is an untouched lag, and any entry is at
  `t+2` open;
- every qualifying event becomes the whole cohort or cash;
- P&L is normalized to a non-compounded $1,000 research sleeve per
  non-overlapping event;
- the result is predictive public research, never structural causation, account
  truth, an order instruction, or capital authority.

## Lifecycle

From `quant/`:

```text
PYTHONPATH=. uv run python research/vg20/experiment.py freeze \
  --state-root /private/tmp/cosmos-s1f-weekly-momentum-cash-v1
PYTHONPATH=. uv run python research/vg20/experiment.py run \
  --state-root /private/tmp/cosmos-s1f-weekly-momentum-cash-v1
PYTHONPATH=. uv run python research/vg20/experiment.py verify \
  --state-root /private/tmp/cosmos-s1f-weekly-momentum-cash-v1
```

`freeze` hashes inputs without opening ZIP members. `run` consumes the only run
authority before semantic parsing. It parses the warmup, seals the fixed cohort,
evaluates all twelve development paths, and opens the holdout at most once only
if a development champion passes every gate. `verify` authenticates the frozen
packet without recomputation.

Any terminal source or lifecycle failure produces `UNMEASURED` and cannot be
repaired or rerun. A valid but economically/statistically weak measurement
produces `NO_GO`.
