# S-1I USD-M cross-sectional premium-dislocation mean reversion

S-1I is one checksum-bound, public-only Binance USD-M research experiment over
the latest complete twelve monthly archives, July 2025 through June 2026. It
tests whether contracts with unusually negative Premium Index values subsequently
outperform contracts with unusually positive values over short, non-overlapping
holding windows. The latest signal bar has been closed for a full hour before the
regular-futures entry open, so no candle-close/open simultaneity is credited.

This is a futures-price mean-reversion experiment. At each entry, a causal
regression removes the component of the short-horizon Premium Index mean
explained by the latest strictly pre-entry funding rate, normalized to an
eight-hour equivalent. Its coefficients are fit only on the prior 30
same-anchor daily cross-sections, then applied out of sample to the current
cross-section. The mean absolute out-of-sample score/funding correlation must
remain at or below the frozen 0.25 bound. The selected long-short portfolio's
mean absolute signed dollar-weighted funding exposure must also remain at or
below 0.00005 per normalized eight-hour interval (0.5 bp of gross notional), so
funding dispersion is controlled at the traded tails rather than harvested.
Funding is never positively ranked or optimized. Any actual funding timestamp
at or between a selected position's entry and exit boundaries invalidates that
cohort and makes the zero-invalid-cohort gate `UNKNOWN`; equal-timestamp event
ordering is not assumed, and a settlement is never silently ignored or
estimated. The experiment is not carry, funding dispersion, spot/perpetual
execution, private account research, or order authorization.

## Sealed lifecycle

1. `screen` opens only June 2025 regular one-hour kline archives, discovered from
   the official archive, and freezes the top-30 cohort by total quote volume.
2. `freeze` binds the protocol, evaluator, official-source note, complete screen
   manifest, selected cohort, and every selected June source hash.
3. Commit the source and `freeze.v1.json` before acquiring outcome archives.
4. `acquire` downloads and checksum-verifies regular klines, premium-index
   klines, and funding-rate archives without opening their ZIP bodies. June
   2025 premium and funding archives are frozen warmup inputs for the prior
   residualization fit, not part of the twelve-month outcome interval.
5. `run` first authenticates the exact, complete compressed acquisition without
   opening any ZIP body. Only then does it write the sole run marker, open
   development archives, seal the predeclared primary and diagnostics, and write
   a holdout-open marker before opening the April-June 2026 holdout once.
6. The fixed primary is deployed in every expanding-window walk-forward fold.
   CSCV/PBO remains a development-only family diagnostic and cannot gate or
   replace the primary.
7. `report` authenticates the terminal packet and its independent external
   result receipt without network or recomputation; if a process interruption
   left only the staged receipt, it can finalize the exact precomputed result
   bytes without rerunning the experiment.

External state defaults to `/private/tmp/cosmos-s1i-premium-dislocation-v1`.
Raw archive bytes and full manifests are not committed.

```sh
PY=/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin/python
"$PY" quant/research/s1i/experiment.py screen --workers 16
"$PY" quant/research/s1i/experiment.py freeze
"$PY" quant/research/s1i/experiment.py acquire --workers 16
"$PY" quant/research/s1i/experiment.py run
"$PY" quant/research/s1i/experiment.py report
```

Focused verification:

```sh
cd quant
PY=/Users/cosmosgeek/Desktop/cosmos-merge/quant/.venv/bin
"$PY/ruff" check research/s1i
"$PY/ruff" format --check research/s1i
MYPYPATH=. "$PY/mypy" --strict --explicit-package-bases \
  research/s1i/experiment.py research/s1i/test_experiment.py
PYTHONPATH=. PYTHONHASHSEED=0 "$PY/pytest" -q research/s1i/test_experiment.py
```

`measurementVerdict` is exactly `GO`, `NO_GO`, or `UNMEASURED`. A public
scenario cannot establish historical account-effective commission, spread,
queue position, book impact, margin feasibility, or executable capacity.
Consequently a fully measured non-positive result can produce `NO_GO`, incomplete
evidence produces `UNMEASURED`, and an otherwise positive public result also
remains `UNMEASURED`; capital is always `NO_GO` and execution authority is always
`NONE`.
