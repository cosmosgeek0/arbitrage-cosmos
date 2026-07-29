# S-1S — USD-M pre-settlement funding squeeze

S-1S is a sealed, public-only research packet for a USD-M pre-settlement
funding-squeeze hypothesis. It is deliberately distinct from S-1R:

- S-1S must decide, enter, and exit strictly before the advertised settlement.
- S-1S may use only earlier settled rates and information published before entry.
- S-1S may not use the rate settled at the target event, post-settlement prices,
  funding cash flow, private data, orders, or account state.
- S-1R instead starts after settlement and studies post-settlement reversion.

## Terminal verdict

`UNMEASURED` with capital disposition `NO_GO`.

The available official monthly funding archive contains realized
`calc_time,funding_interval_hours,last_funding_rate` rows. The shared archives
do not contain historical, timestamped `nextFundingTime` or `/fundingInfo`
snapshots proving which next settlement was advertised before a historical
entry. Binance can change funding intervals, and current endpoints do not
backfill their historical state.

Using the eventual `calc_time` to align a pre-settlement trade would leak a
future schedule outcome. S-1S therefore consumes its one authorized run at the
causal-source preflight and opens neither development nor holdout archive
members. Net per $1,000, holdout economics, multiplicity tests, PBO, drawdown,
and capacity are all `null`, not zero.

## Frozen design

- Universe: `BTCUSDT`, `ETHUSDT`.
- Development: `[2025-07-01T00:00:00Z, 2026-04-01T00:00:00Z)`.
- Holdout: `[2026-04-01T00:00:00Z, 2026-07-01T00:00:00Z)`.
- Family: 12 trials = two prior-rate lookbacks × two z thresholds × three
  entry leads.
- Intended position: long Spot and short USD-M with equal base quantity,
  $1,000 gross reference capital, no compounding.
- Intended exit: five minutes before the advertised settlement and therefore
  outside Binance's documented settlement-time uncertainty.
- Frozen costs: public taker sensitivity, stress, and severe sensitivity; none
  is owner/account fee truth.
- Inference plan: synchronized seven-day block bootstrap, Holm across all 12
  trials, White Reality Check, and 12-block CSCV/PBO with 924 splits.

The complete contract is in `protocol.v1.json`; all 12 configurations are in
`trial_ledger.v1.json`.

## Reproduction

From `quant/`:

```bash
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=src .venv/bin/python -B research/s1s/verifier.py
(cd research/s1s && shasum -a 256 -c SHA256SUMS)
```

`prepare` and `freeze` are single-use construction phases. `run` is permanently
consumed. Do not rerun, repair, substitute another archive, or open the holdout.

## Authority boundary

This packet grants no execution, provider, private-read, order, transfer,
withdrawal, deployment, host, UI, or capital authority. Account-effective fees,
historical executable spreads, fill probability, depth, impact, and executable
capacity remain `UNKNOWN`. Money moved: `$0`.
