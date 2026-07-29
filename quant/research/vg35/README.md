# V-G35 abnormal-volume-duration packet

| item | expected | found | status |
|---|---|---|---|
| scope | one materially distinct Binance-public verdict | exact newly attained abnormal-volume spell age, not recovery, autocorrelation, breadth, turnover, or seasonality | SEALED_PROTOCOL |
| data | fixed public cohort | ten Spot USDT symbols, monthly `1d` archives, 2025-01 through 2026-06 | SEALED_PROTOCOL |
| family | all attempts retained | exact ages `{2,3,5}` × holdings `{1,3}` = 6 trials | SEALED_PROTOCOL |
| timing | strict lag | signal after `t` close; skip full `t+1`; enter `t+2` open; exit `t+2+H` open | SEALED_PROTOCOL |
| portfolio | cohort or cash | all qualifiers equal-weight, no overlap; all-ten timing benchmark on identical windows and costs | SEALED_PROTOCOL |
| costs | public stresses | fee 10 bp/fill plus adverse execution 0/2/10/25 bp; fee stress 20+25 bp/fill; account fee UNKNOWN | SEALED_PROTOCOL |
| inference | intervals and search control | synchronous 14/28-day circular blocks, 4096 draws; 12-hypothesis Holm; White cash and benchmark checks; 8-choose-4 CSCV PBO | SEALED_PROTOCOL |
| risk | measurable or blunt | daily drawdown cap 20%; public 1 bp capacity proxy; executable capacity UNMEASURED | SEALED_PROTOCOL |
| holdout | one local open | champion only after immutable selection seal and every development gate passes; no fallback or rerun | SEALED_PROTOCOL |
| reuse | shared physical corpus | `NOT_CERTIFIED_SHARED_REUSE_RISK`; program-adjusted `p=1`; verified-positive eligibility false | SEALED_PROTOCOL |
| authority | no action | N3 successor/orchestrator scoreboard consumer; capital, execution, private API, host, UI, and money authority NONE | SEALED_PROTOCOL |

## Protocol summary

For each symbol and complete UTC day, abnormal volume means quote volume at
least twice the median of the prior 60 complete days. Spell age resets at each
scored partition boundary. Each trial fires only when its exact age is newly
attained. All qualifying symbols form one equal-weight cohort; otherwise the
portfolio is cash. Cohorts never overlap.

The descriptive termination hazard is reported with a Wilson 95% interval and
partition-end right censoring. It cannot select or rescue an economic result.

## Lifecycle

Run from `quant/`. Commit the static packet first, run `bind-sources`, commit
the resulting source manifest, run `freeze`, then commit the sole freeze
receipt. Only that direct child freeze commit may run the experiment.

```bash
PYTHONPATH=.:src PYTHONHASHSEED=0 uv run --frozen \
  python research/vg35/experiment.py bind-sources

PYTHONPATH=.:src PYTHONHASHSEED=0 uv run --frozen \
  python research/vg35/experiment.py freeze

PYTHONPATH=.:src PYTHONHASHSEED=0 uv run --frozen \
  python research/vg35/experiment.py run

PYTHONPATH=.:src PYTHONHASHSEED=0 uv run --frozen \
  python research/vg35/experiment.py hashes

PYTHONPATH=.:src PYTHONHASHSEED=0 uv run --frozen \
  python research/vg35/verify.py
```

`bind-sources` is network-free, writes only packet-local bindings, and hashes
the shared V-G25 corpus without opening or modifying it. `freeze` binds source,
protocol, evaluator, tests, runtime, and empty outcome state. `run` creates and
fsyncs the exclusive marker before the first archive member is opened.

Development is consumable once. Holdout can open once only after every
development gate passes and `selection.v1.json` immutably seals the champion.
After a marker is consumed there is no repair, retune, fallback, or rerun.
The independent verifier is network-free and validates hashes and cross-file
bindings without importing the evaluator, recomputing statistics, or reopening
an archive.

Commit the terminal artifacts and `SHA256SUMS` together. A later change to any
freeze-bound byte invalidates the lifecycle and requires a fresh, never-opened
lane; no in-place repair is permitted.

Any custody, schema, timestamp, completeness, lifecycle, or one-run failure is
`UNMEASURED`; a valid failed gate is `NO_GO`. Even a local
`PUBLIC_RESEARCH_GO_LOCAL` remains program-ineligible because shared-holdout
reuse is not certified.
