# V-G4 volume-price divergence reversal

This packet measures one public-only Binance Spot hypothesis over the exact interval
2025-07-01 through 2026-06-30. The strategy buys a confirmed reversal after price
makes a new low on contracting ordinary volume. It explicitly rejects volume shocks,
so it is distinct from both volume-shock continuation and volume-shock reversal.

The protocol, evaluator, official-source note, selected source objects, and every
checksum are frozen before archive decompression. Development uses canonical Q14
purged expanding walk-forward folds, circular-block inference, Holm correction over
all twelve trials, and development-only CSCV/PBO. The final 122 days are inaccessible
unless a development champion clears every frozen gate; if opened, only that champion
is evaluated once.

## Commands

Run from `quant/` with the repository environment:

```bash
PYTHONPATH=src:. python research/vg4/experiment.py freeze
PYTHONPATH=src:. python research/vg4/experiment.py run
PYTHONPATH=src:. python research/vg4/experiment.py verify
PYTHONPATH=src:. pytest -q research/vg4/test_experiment.py tests/q14/test_q14_splits.py tests/q14/test_q14_multiplicity_bootstrap.py
```

`freeze` reads and hashes only compressed public source objects and checksum metadata.
`run` has an exclusive-create one-run marker and decompression is terminally consumed.
`verify` authenticates receipts and hashes without rerunning or opening a sealed
holdout.

## Truth boundary

- Public regular-user fee scenario: 10 bp taker fee per leg.
- Account-effective fee: `UNKNOWN`.
- Public OHLCV participation capacity: measured proxy.
- Historical executable order-book capacity: `UNMEASURED`.
- Private/account/order/money effects: none.
- Capital authority: `NONE`.

The terminal result and focused proof are appended here only after the single run.
