# V-G10 — sealed 15-minute taker-buy-imbalance persistence

V-G10 tests one public Binance Spot hypothesis: after removing each symbol's
causal time-of-day median **from directional taker-buy imbalance**, persistent
positive residuals may continue over the next two or four hours.

The signal is

`I = (2 * taker_buy_quote_volume - total_quote_volume) / total_quote_volume`.

It never uses price/return, raw quote-volume level/rank/shock/seasonality,
breadth, concentration, gap, market-factor beta, diffusion, trade count,
price-impact efficiency, volatility, entropy, futures, breakout, trend,
reversal, compression, or climax. Price is read only after selection to
measure the frozen entry/exit return. Raw quote volume is used only after
selection for the explicitly non-executable $1,000 public-print participation
proxy.

## Frozen experiment

- Static cohort: top 40 eligible archive-discovered USDT Spot symbols ranked
  before outcomes by trailing 60-day median daily quote volume over
  2025-04-01 through 2025-06-30.
- Warmup: June 2025. Development: July 2025 through March 2026. Untouched
  holdout: April through June 2026.
- Formations: 00:00, 06:00, 12:00, and 18:00 UTC. Four completed 15-minute
  bars form the signal; the complete next bar is waited; entry is its following
  open; exit is the exact open two or four hours later.
- Family: `D={14,28} × P={3,4} × K={3,5} × H={2h,4h}`, exactly 16 stable
  trials. Sparse persistence or fewer than 20 signal-eligible symbols creates
  a synchronous inactive-cash formation. It is a sampling/gate failure, not a
  fabricated source error.
- Primary scenario: `FEE_STRESS`, 20 bp fee plus 25 bp adverse execution per
  fill, multiplicatively applied. All five frozen analyst sensitivities are
  reported.
- Statistics: synchronous circular-block bootstrap with 8,192 replications,
  seven-day primary and 14-day sensitivity; separate Holm correction for
  absolute and matched-excess one-sided centered-null p-values; exact
  eight-month/all-70-split CSCV/PBO.

All public fees are analyst sensitivities. Account-effective/historical/special/
tax commission is `UNKNOWN`; spread, book impact, latency, historical filter
admissibility, and executable capacity are `UNMEASURED`. USDT=USD is only an
unproven reporting convention.

## One-use lifecycle

Every receipt, downloaded byte, outcome, and marker lives below a mandatory
external `--state-dir`. The shared daily archive is read-only and the packet
directory is never a runtime output directory.

```sh
PYTHONHASHSEED=0 uv run --locked --no-sync --project quant python quant/research/vg10/experiment.py \
  --state-dir /private/tmp/cosmos-vg10-state source-freeze
PYTHONHASHSEED=0 uv run --locked --no-sync --project quant python quant/research/vg10/experiment.py \
  --state-dir /private/tmp/cosmos-vg10-state cohort-freeze \
  --daily-source-root /private/tmp/cosmos-s1f-weekly-momentum-cash-v1
PYTHONHASHSEED=0 uv run --locked --no-sync --project quant python quant/research/vg10/experiment.py \
  --state-dir /private/tmp/cosmos-vg10-state acquire-development \
  --offline-source /path/to/preacquired/public/files
PYTHONHASHSEED=0 uv run --locked --no-sync --project quant python quant/research/vg10/experiment.py \
  --state-dir /private/tmp/cosmos-vg10-state development-run
```

Only if development produces exactly one gate-passing champion:

```sh
uv run --locked --no-sync --project quant python quant/research/vg10/experiment.py --state-dir /private/tmp/cosmos-vg10-state candidate-seal
uv run --locked --no-sync --project quant python quant/research/vg10/experiment.py --state-dir /private/tmp/cosmos-vg10-state holdout-open
uv run --locked --no-sync --project quant python quant/research/vg10/experiment.py --state-dir /private/tmp/cosmos-vg10-state \
  acquire-holdout --offline-source /path/to/untouched/holdout/files
uv run --locked --no-sync --project quant python quant/research/vg10/experiment.py --state-dir /private/tmp/cosmos-vg10-state holdout-run
uv run --locked --no-sync --project quant python quant/research/vg10/experiment.py --state-dir /private/tmp/cosmos-vg10-state verify
```

`--network` may replace `--offline-source` only by explicit choice. Tests never
enable it. Network acquisition permits only exact HTTPS authority
`data.binance.vision`, rejects redirects and final-URL drift, and streams under
frozen sidecar/ZIP byte caps. Development failure ends `NO_GO` without holdout
access. A pre-existing one-use outcome marker or any post-marker exception is
terminal `UNMEASURED`, with no repair, replay, refit, or reopen.

A `development-run-start` or `holdout-run-start` marker means only that the
one-use attempt was consumed. The exclusive `*-body-open-attempt.v1.json`
receipt is written before that phase can decompress its first ZIP member. Its
presence means body opening was entered and an unmeasured, possibly nonzero
number of member bodies may have been read; it never claims a member count.
All expected archive bodies count as loaded and validated only when the
exclusive `*-body-open.v1.json` success receipt also exists, binds the attempt
receipt, and records a loaded count equal to the frozen acquisition count.
`verify` reports the attempt, the full-load receipt, and one explicit state:
`NOT_ATTEMPTED`, `ATTEMPTED_MEMBER_READ_COUNT_UNMEASURED`, or
`ALL_EXPECTED_BODIES_LOADED_AND_VALIDATED`. A post-marker parser failure is
therefore never mislabeled as unopened archive bytes.

## Synthetic verification

```sh
PYTHONHASHSEED=0 uv run --locked --no-sync --project quant python -m unittest -v quant.research.vg10.test_experiment
uv run --locked --no-sync --project quant ruff check quant/research/vg10
uv run --locked --no-sync --project quant ruff format --check quant/research/vg10
uv run --locked --no-sync --project quant mypy --strict quant/research/vg10/experiment.py
```

No command above grants capital authority. Even research `GO` always retains
capital verdict `NO_GO` and execution authority `NONE`.
