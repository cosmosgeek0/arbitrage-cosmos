# S-1K COIN-M versus USD-M relative funding/basis experiment

This packet evaluates one public-data proxy family on five fixed matched
underlyings. It starts from canonical commit
`a169b123fb186d1943a75ad648552c4d95be1be1` and writes only
`quant/research/s1k/**`.

## Frozen lifecycle

1. `discover` records current public metadata and checksum sidecars without
   opening archive bodies.
2. `freeze` binds the protocol, evaluator, tests, research note, and discovery.
3. The freeze is committed before `acquire`.
4. `acquire` copies/downloads ZIP bytes and verifies every official checksum
   without decompression.
5. `run` creates an exclusive marker, opens development bodies, evaluates all
   18 trials, seals one champion, creates the one holdout-open marker, and only
   then opens the holdout.
6. `report` authenticates and prints the terminal result without recomputation.

Any error after the run marker writes `UNMEASURED` and consumes the run. A second
run is refused.

## Interpretation

`netUsdPer1k` means USD proxy PnL for USD 1,000 COIN-M face and a USD-M
quantity frozen as `1000 / COIN-M entry price` (approximately USD 2,000 gross
two-leg face). Quantities are theoretical and unrounded because point-in-time
historical filters are unavailable. It is not return on account capital. Maker
and stress costs are public hypothetical fee/slippage scenarios. The result
always has `capitalVerdict=NO_GO` and `executionAuthority=NONE`.

The experiment can return:

- `GO`: all frozen statistical and execution gates pass;
- `NO_GO`: the measurement completes but one or more gates fail;
- `UNMEASURED`: custody, schema, completeness, or lifecycle prevents a valid
  measurement.

Recent symmetric historical book evidence is unavailable, so this protocol
cannot satisfy the executable-evidence gate and cannot return `GO`.

## Commands

Run from `quant/` with its locked environment:

```text
PYTHONPATH=. .venv/bin/python research/s1k/experiment.py --state-root <root> discover
PYTHONPATH=. .venv/bin/python research/s1k/experiment.py --state-root <root> freeze
PYTHONPATH=. .venv/bin/python research/s1k/experiment.py --state-root <root> acquire
PYTHONPATH=. PYTHONHASHSEED=0 .venv/bin/python research/s1k/experiment.py --state-root <root> run
PYTHONPATH=. .venv/bin/python research/s1k/experiment.py --state-root <root> report
```
