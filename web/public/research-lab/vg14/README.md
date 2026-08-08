# V-G14 — intraday quote-volume seasonality residual

V-G14 is a sealed, public-only Binance Spot research lane. It measures whether
a completed 30-minute bar whose quote volume is unusually large relative to the
same UTC half-hour in each of the previous eight weeks predicts a later long/cash
return. It is not an order, deployment, account-fee, or capital-authority lane.

## Terminal verdict

`NO_GO` at development. The single allowed development run authenticated 100
official archive/checksum pairs and validated 145,920 bars. All four frozen
trials failed the stress-economics, bootstrap, Holm, drawdown, month-stability,
and proxy-capacity gates. No champion was sealed, so the March-June 2026
holdout remains physically absent and unopened. See `TERMINAL.md` and the
checksum-bound JSON evidence.

The four frozen trials are `2x` and `4x` residual thresholds crossed with 6-hour
and 12-hour holding periods. A signal observed after bar `t` completes enters at
the open of `t+60 minutes`, leaving one complete 30-minute bar between signal and
entry. While a position is active, later signals are ignored.

## Frozen truth boundary

- Signal fields: public `open_time` and `quote_asset_volume` only.
- Outcome field: public `open` only, after deterministic signal selection.
- Account-effective fees: `UNKNOWN`.
- Base proxy per fill: 10 bp fee + 5 bp adverse execution.
- Stress proxy per fill: 10 bp fee + 15 bp adverse execution.
- Severe diagnostic per fill: 20 bp fee + 25 bp adverse execution.
- Net factor formula: `gross_factor * (1 - (fee_bp + adverse_bp)/10000)^2`.
- Capacity screen: a $1,000 notional must be no more than 1 bp of the signal
  bar's quote volume. This is only a screening proxy, never executable capacity.

Public klines do not measure historical spread, book depth, market impact,
fillability, latency, rebates, account discounts, tax/special commissions, or
symbol-specific operational filters. The fixed ten-symbol cohort also limits
generalizability.

## Custody and one-run lifecycle

The evaluator writes only to the external state root, defaulting to
`/private/tmp/cosmos-vg14-volume-seasonality-residual-v1`.

```bash
python quant/research/vg14/experiment.py freeze-evaluator
python quant/research/vg14/experiment.py acquire-development
python quant/research/vg14/experiment.py inventory-development
python quant/research/vg14/experiment.py consume-development
```

`inventory-development` authenticates every ZIP against the exact received
`.CHECKSUM` bytes without opening any ZIP member. `consume-development` writes
an immutable marker before the first member open. Any custody, checksum, ZIP,
schema, timestamp, grid, duplicate, gap, nonpositive value, wrong-base, freeze,
or lifecycle failure is terminal `UNMEASURED`.

If all frozen development gates pass, and only then, the evaluator writes a
candidate seal. The seal binds the exact development result, pre-open source
manifest, development-consumption marker, evaluator and evaluator freeze,
protocol and protocol freeze, champion identity/gates, and history tail by
SHA-256. Holdout access recomputes those gates and bindings; a stale, fabricated,
or modified seal is rejected. The parent may then run:

```bash
python quant/research/vg14/experiment.py acquire-holdout
python quant/research/vg14/experiment.py inventory-holdout
python quant/research/vg14/experiment.py consume-holdout
```

The holdout-open marker is written before the first holdout network request.
Without a candidate seal, holdout acquisition and opening are refused. A valid
development gate failure is `NO_GO`, leaves holdout bytes physically absent,
and writes terminal evidence. A final `GO` requires every development gate and
the single-open holdout gate to pass.

Before either development acquisition or consumption, the evaluator also
requires every holdout custody directory, artifact, and marker to be physically
absent. Development and holdout results each bind their exact source manifest,
evaluator, protocol freeze, and protocol; terminal evidence binds the result.

The downloader permits only the frozen official
`https://data.binance.vision/data/spot/monthly/klines/…` URL family. Tests use
only generated synthetic bytes and never access a network or a real archive.

## Focused verification

From `quant/`:

```bash
uv run ruff check research/vg14
uv run ruff format --check research/vg14
uv run mypy --strict research/vg14/experiment.py research/vg14/test_experiment.py
uv run pytest -q research/vg14/test_experiment.py
```

The machine-readable terminal artifacts deliberately retain
`ACCOUNT_EFFECTIVE_FEES_UNKNOWN`, `effectUsd=0`, and `capitalAuthority=NONE`.
