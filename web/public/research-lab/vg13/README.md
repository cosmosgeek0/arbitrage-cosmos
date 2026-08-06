# V-G13 — volume/volatility decoupling

V-G13 is a sealed, public-market-only Binance Spot daily-bar experiment. It
ranks the cross-sectional gap between trailing 7/14-day USDT quote notional and
close-to-close realized volatility, then evaluates top K = 3/5/8 long-cash
portfolios with seven daily one-seventh sleeves from t+1 open to t+8 open.

Signal attribution is measured against a deterministic one-to-one control:
each low-RV selection is matched to an unused high-RV name with the nearest
quote-notional percentile and run on the identical schedule, sizing, and costs.
GO requires positive stress matched-control excess confidence, Holm family
correction, PBO at most 0.50, positive-month evidence, and the other frozen
economic/sample/risk gates.

## Frozen source and lifecycle

- Shared discovery/acquisition metadata and archive files are read-only.
- `freeze` reads metadata plus compressed bytes only; it does not open a ZIP
  central directory or member.
- `run` creates an external development marker with exclusive creation before
  opening any archive body.
- March–June 2026 remains unopened until the development family is complete and
  one candidate is sealed; a second exclusive marker permits one holdout open.
- Any malformed, duplicate, or internally gapped necessary row, source drift,
  formation with fewer than 25 eligible names, selected missing entry/exit, or
  lifecycle defect is terminal `UNMEASURED`.
- There is no repair, row drop, deduplication, fallback, retry, rerun, or
  holdout reopen.

The intended commands, from the repository root with `PYTHONPATH=quant`, are:

```text
python -m research.vg13.experiment freeze \
  --source-root /private/tmp/cosmos-s1f-weekly-momentum-cash-v1

python -m research.vg13.experiment run \
  --source-root /private/tmp/cosmos-s1f-weekly-momentum-cash-v1 \
  --external-state-root /private/tmp/cosmos-vg13-volume-volatility-decoupling-v1

python -m research.vg13.verify \
  --source-root /private/tmp/cosmos-s1f-weekly-momentum-cash-v1 \
  --external-state-root /private/tmp/cosmos-vg13-volume-volatility-decoupling-v1
```

The fixed 10 bp fee per side and 10/25 bp adverse execution per side are public
research proxies. Account fees, historical spread, depth, filters, and fills
remain `UNKNOWN`. Authority is `NONE`.
