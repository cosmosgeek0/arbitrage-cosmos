# V-G25 volume-shock recovery-horizon packet

| item | expected | found | status |
|---|---|---|---|
| scope | one Binance public-only verdict | fixed ten-symbol Spot cohort; daily first-passage volume recovery | SEALED_PROTOCOL |
| timing | causal ordering | completed shock and two-bar recovery; one full intervening day; entry `r+2` open; exit `r+3` open | SEALED_PROTOCOL |
| family | all attempts retained | 3 shock thresholds × 2 recovery boundaries × 2 horizon caps = 12 | SEALED_PROTOCOL |
| portfolio | cohort or cash | all newly confirmed recoveries equal-weight; otherwise USDT cash | SEALED_PROTOCOL |
| costs | fees and execution sensitivity | preregistered 10 bp/fill modeling counterfactual; 24 bp base and 40 bp stress nominal round trips; account fee UNKNOWN | SEALED_PROTOCOL |
| inference | interval and search control | synchronous 14/28-day circular blocks; Holm; White Reality Check; CSCV PBO diagnostic only | SEALED_PROTOCOL |
| risk | drawdown and capacity | daily-mark drawdown; public 1 bp prior-volume proxy; executable capacity UNMEASURED | SEALED_PROTOCOL |
| holdout | one champion-only open | 2026-03-01 through 2026-06-30; opens only if every development gate passes | SEALED_PROTOCOL |
| authority | no action | N3 successor/final convergence consumer; capital and execution authority NONE | SEALED_PROTOCOL |

## Commands

Run from `quant/` with the state root from `protocol.v1.json`.

```bash
PYTHONPATH=.:src PYTHONHASHSEED=0 uv run --frozen \
  python research/vg25/experiment.py acquire

PYTHONPATH=.:src PYTHONHASHSEED=0 uv run --frozen \
  python research/vg25/experiment.py freeze

PYTHONPATH=.:src PYTHONHASHSEED=0 uv run --frozen \
  python research/vg25/experiment.py run

PYTHONPATH=.:src PYTHONHASHSEED=0 uv run --frozen \
  python research/vg25/experiment.py verify
```

`acquire` may use only official public endpoints and must not open a ZIP member.
`freeze` binds the exact packet inputs, every manifest-bound compressed object,
raw `exchangeInfo`, `.python-version`, `pyproject.toml`, `uv.lock`, runtime
identity, and the empty outcome state. `run` rehashes every binding before it
creates and fsyncs the exclusive marker. Commit that freeze before `run`.

`run` creates the development marker with exclusive create and filesystem sync
before opening any member. It is consumable once. Holdout is opened at most once
and only after the immutable selected trial passes every development gate; a
second exclusive, fsynced marker precedes the first holdout member.
There is no repair, fallback, retune, or rerun after either marker is consumed.

`verify` is network-free and authenticates only exact bytes and cross-file
bindings. It does not recompute statistics or reopen source archives.
