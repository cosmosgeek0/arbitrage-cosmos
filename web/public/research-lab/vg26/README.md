# V-G26 price-volume-correlation regime

V-G26 asks one narrow question: does a strictly lagged cross-symbol median
price/quote-volume Spearman-correlation regime produce positive post-cost
cohort-or-cash returns and positive excess returns versus the identical cohort
held continuously?

For each symbol and target open, the signal uses only completed daily bars through
the prior UTC day. It correlates `L` close-to-close returns with the aligned `L`
quote-volume changes, then takes the median correlation across the frozen twelve
symbols. The portfolio is either the complete equal-notional cohort or cash. Units
are fixed between transitions; there is no ranking, rotation, shorting, or leverage.

## Sealed lifecycle

1. `acquire` downloads the exact 180 public ZIP/sidecar pairs into the declared
   temporary corpus, verifies every official checksum, and does not open ZIP
   members.
2. Commit the protocol, official-source note, evaluator, and tests.
3. `freeze` requires that clean commit, validates the executable protocol, binds
   the acquisition receipt and compressed bytes, and writes the pre-outcome source
   manifest and freeze receipt without decompression.
4. Commit the freeze packet.
5. `run` requires the clean committed freeze, creates the exclusive one-run marker,
   and only then opens development archives.
6. No development gate passer means measured `NO_GO` with the January-March
   holdout unopened. Otherwise one champion is sealed before one holdout-open
   receipt and one evaluation.
7. Any custody, schema, timestamp, chronology, continuity, causality, marker, or
   exit-integrity failure is terminal `UNMEASURED`. There is no repair, retuning,
   runner-up substitution, or rerun after the marker.
8. `verify` authenticates the terminal packet and frozen compressed sources without
   recomputing outcomes or opening archive members.

Run from `quant/` with the repository's pinned Python environment:

```bash
PYTHONPATH=src:. PYTHONHASHSEED=0 python research/vg26/experiment.py acquire
PYTHONPATH=src:. PYTHONHASHSEED=0 python research/vg26/experiment.py freeze
PYTHONPATH=src:. PYTHONHASHSEED=0 python research/vg26/experiment.py run
PYTHONPATH=src:. PYTHONHASHSEED=0 python research/vg26/experiment.py verify
```

Focused proof:

```bash
ruff check research/vg26
ruff format --check research/vg26
MYPYPATH=src:. mypy --strict --explicit-package-bases \
  research/vg26/experiment.py research/vg26/test_experiment.py
PYTHONPATH=src:. PYTHONHASHSEED=0 pytest -q -p no:cacheprovider \
  research/vg26/test_experiment.py \
  tests/q14/test_q14_splits.py \
  tests/q14/test_q14_multiplicity_bootstrap.py
shasum -a 256 -c research/vg26/SHA256SUMS
git diff --check
```

## Frozen measurement

- Grid: lookback 20/40/60 complete daily pairs by median Spearman threshold
  0.00/0.10/0.20/0.30, twelve trials total.
- Development: common first target open 2025-03-03 (so the 60-day trial uses
  exactly the available 2025-01-01 through 2025-03-02 completed bars), through
  final liquidation on 2025-12-31, with five fixed two-month folds.
- Holdout: source begins 2026-01-01; first eligible target open is 2026-01-02;
  final liquidation is 2026-03-31.
- Inference: 4,096 seeded circular seven-day block replicates, a two-sided 90%
  interval, one-sided 95% lower bound, Holm correction across all twelve excess
  paths, and report-only 10-month choose-5 CSCV/PBO.
- Drawdown: starting $1,000 cash plus every post-transition marked equity at the
  daily open; intraday drawdown remains unmeasured.
- Costs per executed side: 10 bp public regular fee plus 10 bp base or 25 bp
  stress adverse-price proxy.
- Capacity: twelve times the least constituent's lagged 30-day median quote volume
  times 1 bp, a public-volume proxy only.

## Truth boundary

Account-effective fees are `UNKNOWN`. Historical executable capacity, book depth,
fill probability, impact, and intraday drawdown are `UNMEASURED`. The static cohort
may contain survivor-selection bias. Public-cost profitability does not establish
account profitability or wider strategy-family profitability.

UI, canonical, deployment, live, host, provider, private, order, transfer,
withdrawal, and money surfaces are untouched. Capital authority is `NONE`.
Consumer: N3 successor/final convergence.
