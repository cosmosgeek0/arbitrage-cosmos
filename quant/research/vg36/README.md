# V-G36 lagged taker-buy quote-volume-share shock

V-G36 asks one bounded question: after an isolated negative shock in the
cohort-level mean of within-bar Spot taker-buy quote-volume shares, does a
delayed equal-weight cohort position earn positive net absolute and
always-on-cohort excess returns?

This is not another raw-volume regime. Each completed daily bar contributes only
`taker_buy_quote_asset_volume / quote_asset_volume`. The twelve shares are
equal-weighted, logit transformed, and differenced. A trial fires only when the
current innovation is at or below a prior-only rolling median/MAD z-score
threshold and the preceding standardized innovation was greater than -1. Prices
are used only after a signal for the frozen open-to-open execution simulation.
Base volume, quote-volume level, and trade count never enter the signal.

## Frozen lifecycle

1. Commit the reviewed source packet as the only direct child of canonical
   `a169b123fb186d1943a75ad648552c4d95be1be1`.
2. `acquire` reads the exact 192 expected ZIP/sidecar pairs from the shared
   read-only archive root. It hashes the compressed ZIP bytes and sidecar bytes,
   validates the publisher checksum, and never opens an archive member.
3. `freeze` rehashes the same compressed inputs without decompression and writes
   the source manifest and pre-outcome freeze receipt.
4. Commit the acquisition and freeze outputs as the direct-child frozen commit.
5. `run` validates the clean frozen commit and consumes one exclusive run marker
   before opening any development ZIP.
6. A custody, collision, schema, timestamp, continuity, causal, exit, or lifecycle
   defect is terminal `UNMEASURED`. The marker remains consumed; repair and rerun
   are forbidden.
7. If any development gate fails, the terminal verdict is `NO_GO` and the
   March-June 2026 holdout remains unopened.
8. Only a development passer receives a candidate seal. The holdout-open marker
   is written after that seal and before the holdout ZIPs are opened. A separate
   immutable receipt records the first successfully opened holdout member body.
9. Commit the terminal packet as the direct child of the frozen run head.
10. `verify` authenticates that exact clean commit and rehashes compressed source
   bytes without opening ZIP members or recomputing outcomes.

The shared archive root is never written:

`/Users/cosmosgeek/.codex/evidence/cosmos-vg3-public-volume-v1-4ddd-r5/archives/data/spot/monthly/klines`

Run later, from `quant/`, only after the separately reviewed freeze authorization:

```bash
# First commit the source packet as the direct child of canonical.
PYTHONPATH=src:. PYTHONDONTWRITEBYTECODE=1 PYTHONHASHSEED=0 \
  python research/vg36/experiment.py acquire
PYTHONPATH=src:. PYTHONDONTWRITEBYTECODE=1 PYTHONHASHSEED=0 \
  python research/vg36/experiment.py freeze
# Commit the acquisition/freeze outputs as one direct-child frozen commit.
PYTHONPATH=src:. PYTHONDONTWRITEBYTECODE=1 PYTHONHASHSEED=0 \
  python research/vg36/experiment.py run
# Commit the terminal outputs as one direct-child terminal commit.
PYTHONPATH=src:. PYTHONDONTWRITEBYTECODE=1 PYTHONHASHSEED=0 \
  python research/vg36/verify.py
```

Pre-outcome focused proof:

```bash
ruff check research/vg36
ruff format --check research/vg36
MYPYPATH=src:. mypy --strict --explicit-package-bases \
  research/vg36/experiment.py research/vg36/verify.py \
  research/vg36/test_experiment.py
PYTHONPATH=src:. PYTHONDONTWRITEBYTECODE=1 PYTHONHASHSEED=0 \
  pytest -q -p no:cacheprovider research/vg36/test_experiment.py
git diff --check -- quant/research/vg36
```

## Frozen measurement

- Cohort: `BTCUSDT`, `ETHUSDT`, `BNBUSDT`, `XRPUSDT`, `ADAUSDT`,
  `DOGEUSDT`, `SOLUSDT`, `TRXUSDT`, `LTCUSDT`, `LINKUSDT`, `AVAXUSDT`,
  and `DOTUSDT`; no ranking, substitution, or backfill.
- Source months: March 2025 through June 2026, monthly Spot `1d` klines.
- Measured development: July 2025 through February 2026; sealed holdout:
  March through June 2026.
- Trials: `L={20,60} × K={1.5,2.5} × H={1,3,5}`, exactly twelve.
- Scenarios per executed side: gross 0 bp, fee-only 10 bp, base 20 bp,
  stress 35 bp, severe 60 bp. Account-effective fees remain `UNKNOWN`.
- Inference: 4,096 seeded circular-block replicates; seven-day primary and
  fourteen-day sensitivity intervals; Holm correction for absolute and excess
  families; White centered max-stat tests; eight-month choose-four CSCV/PBO,
  diagnostic only. The PBO uses mean excess and is not the gate-plus-LCB
  selection procedure; multi-day holdings are not purged at month boundaries.
- Capacity: one-basis-point participation in each member's lagged 30-day median
  quote volume, combined conservatively as twelve times the least member.
  Historical executable capacity remains `UNMEASURED`.
- Drawdown: marked at daily opens. Intraday drawdown remains `UNMEASURED`.

## Truth boundary

The source is public daily aggregate data. It cannot prove causality, spread,
depth, fill probability, adverse selection, market impact, account commission,
or executable capacity. The global archive/holdout has been shared across
research families; therefore even a local all-gates pass remains globally
ineligible, capital disposition `NO_GO`, and authority `NONE`.

No UI, canonical runtime, host, provider, private API, credential, order,
transfer, withdrawal, or money surface is touched. Consumer: N3 successor /
orchestrator scoreboard.
