# V-G18 — lagged trade-size-skew cohort verdict

V-G18 is one public-only, offline Binance Spot experiment. It asks whether the
upper cross-sectional tail of a symbol's lagged mean quote notional per
reported trade predicts a profitable long cohort after frozen cost proxies.

The strategy is **cohort or cash**:

- compute the signal only from a fully closed UTC daily bar and the preceding
  120 fully closed daily bars;
- rank a point-in-time eligible USDT cohort without price or return inputs;
- enter the complete frozen top-K cohort at the next UTC daily open, or keep
  the entire sleeve in cash;
- never replace an unavailable selected name with the next rank;
- never short, borrow, use leverage, call a private API, place an order, or
  move money.

The ratio is a mean-notional proxy, not an observed trade-size distribution.
V-G18 is mathematically related to V-G11's inverse fragmentation metric and is
not an independent family. A future N3 successor must bind both siblings and
their wider multiplicity before any global positive-edge claim.

## Sealed lifecycle

1. `manifest` authenticates compressed ZIP, sidecar, and acquisition-manifest
   bytes without opening archive members.
2. Static protocol, evaluator, tests, trial ledger, and source manifest are
   committed and pushed.
3. `seal` writes the commit-bound freeze receipt; that receipt is committed and
   pushed.
4. `arm-development` reserves ordinal 1 and is committed and pushed before
   `develop` creates a second state-only `O_CREAT|O_EXCL` body-consumption
   receipt immediately before opening any archive body.
5. Development either ends `NO_GO`/`UNMEASURED`, or seals exactly one champion.
6. Only a passing champion can create and push one `holdout-open` receipt.
7. `holdout` creates its own state-only body-consumption receipt, opens the
   final partition once, and writes the terminal verdict.

Any crash after a consumed marker is terminal. No repair, redesign, threshold
change, symbol replacement, rerun, or second holdout is permitted.

## Verification

Run from `quant/` with the canonical pinned environment:

```text
PYTHONPATH=src:. python -B research/vg18/experiment.py verify
python -B -m pytest -q -p no:cacheprovider research/vg18/test_experiment.py
(cd research/vg18 && shasum -a 256 -c SHA256SUMS)
```

The packet is research evidence only. Its execution and capital authority are
always `NONE`; its capital decision is always `NO_GO`, including when a local
public-proxy holdout passes.
