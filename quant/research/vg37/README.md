# V-G37 — lagged market-wide quote-volume synchronization shock

V-G37 asks one bounded question: after Binance Spot USDT symbols suddenly move
from idiosyncratic to synchronized daily quote-volume innovations, does a
fixed, unranked 12-name cohort beat cash and its always-on comparator after
public fee/adverse-price stresses?

The synchronization statistic is the median zero-lag pairwise Spearman
correlation across every symbol that has the complete causal lookback at that
formation. The shock is the recent statistic minus the statistic on the
immediately preceding, disjoint 56-day window. A Monday decision observes at
most Saturday's completed bar, then holds the full fixed cohort for 3 or 7 days
or stays in zero-yield USDT cash.

Here, causal means mechanically time-causal—no future row can affect a signal,
fill, or capacity input. This is a predictive association study, not a claim of
causal identification.

This is not breadth, diffusion, autocorrelation, turnover, entropy,
concentration, dispersion, a state-transition matrix, or a single-symbol
shock. It never counts abnormal symbols, scans lead/lag edges, ranks members,
selects a synchronized subset, or uses price/return in the signal.

## Sealed lifecycle

From the `quant/` directory with the accepted CPython 3.13 environment:

```text
PYTHONDONTWRITEBYTECODE=1 PYTHONHASHSEED=0 PYTHONPATH=src:. \
  .venv/bin/python -m research.vg37.experiment freeze \
  --protocol-commit <clean protocol commit>

PYTHONDONTWRITEBYTECODE=1 PYTHONHASHSEED=0 PYTHONPATH=src:. \
  .venv/bin/python -m research.vg37.experiment run \
  --candidate-commit <clean source-freeze commit>

PYTHONDONTWRITEBYTECODE=1 PYTHONHASHSEED=0 PYTHONPATH=src:. \
  .venv/bin/python -m research.vg37.verify
```

`freeze` authenticates compressed ZIP bytes, checksum sidecars, and pair
metadata without listing or decompressing ZIP members. `run` durably consumes
the packet-local development marker before its first archive member open.
Holdout members remain unopened unless one development trial passes every
frozen gate; a separate one-use marker precedes the first holdout member open.
After either marker, there is no repair, resume, rerun, refreeze, source
substitution, member drop, or retune.

## Interpretation

`GO` means only that all frozen public-scenario gates passed. Capital remains
`NO_GO`, authority remains `NONE`, account-effective commission remains
`UNKNOWN`, executable capacity remains `UNMEASURED`, and the global
volume-family attempt ledger/holdout independence remains uncertified.
