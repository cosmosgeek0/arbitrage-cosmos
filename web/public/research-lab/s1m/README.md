# S-1M USD-M funding-acceleration mean-reversion

Status: `CUSTODY_BREACH_DECLARED_TERMINAL_UNMEASURED`

Consumer: `N3 successor / orchestrator scoreboard`

S-1M is a sealed, public-data-only historical experiment. It asks whether an
extreme acceleration in a USD-M perpetual contract's own settled funding
history predicts a contrarian price move after explicit fees, slippage,
funding, and stress.

No economic answer was produced. Before the packet was frozen, April 2026
`FUNUSDT` holdout rows were opened during custody inspection and a later
read-only audit. `CUSTODY_BREACH.v1.json` records the incident without
reproducing observed values. The one-run terminal is therefore `UNMEASURED`;
repair, reacquisition, rerun, and holdout evaluation are forbidden.

The headline ledger is the paired taker fallback. A separate maker-entry proxy
requires strict hourly-bar trade-through and is diagnostic only. Hourly public
bars cannot prove queue position, post-only acceptance, or an account fill.

## Distinct strategy family

`USDM_OWN_HISTORY_FUNDING_ACCELERATION_CONTRARIAN`

- S-1C triggers on a funding level around one settlement and targets the
  immediate post-settlement unwind. S-1M uses a robust second difference of
  normalized settled funding and enters only at the next full hour.
- S-1D ranks cumulative funding levels across contracts for a multi-day
  cross-sectional carry portfolio. S-1M compares each contract only with its
  own prior acceleration history and holds for at most two later settlements.
- S-1G and S-1J are Spot-hedged carry families. S-1M has no Spot leg and never
  books forecast funding as revenue.
- S-1H and S-1I use basis or Premium Index level dislocation. S-1M uses neither
  as a signal.
- S-1K and S-1L reserve COIN-M/USD-M and dated-future calendar families. S-1M
  uses one USD-M perpetual leg only.

## Frozen chronology

- Pre-outcome universe screen: June 2025.
- Warmup only: April through June 2025.
- Development: `[2025-07-01T00:00:00Z, 2026-04-01T00:00:00Z)`.
- Embargo: `[2026-04-01T00:00:00Z, 2026-04-08T00:00:00Z)`.
- Untouched holdout: `[2026-04-08T00:00:00Z, 2026-07-01T00:00:00Z)`.

The exact 12-symbol universe is derived once from June 2025 official archives:
eligible symbols need checksum-valid April-June custody and sufficient causal
funding history, then rank by June contract quote volume. No current
exchange-membership list or outcome-period return is used.

## Execution and authority boundary

- Reference capital and notional: USD-equivalent 1,000, non-compounded, at
  most one position.
- Taker fallback: 4 bp fee plus 2 bp adverse execution per fill.
- Maker diagnostic: 2 bp entry fee plus 1 bp adverse-selection charge, then a
  taker exit.
- Stress and severe costs are frozen in `protocol.v1.json`.
- Funding is booked from actual archived timestamps and rates with the hourly
  mark-price opening as a disclosed settlement-mark proxy.
- Account-effective fees, maker resting validity, historical filters, matched
  depth, margin feasibility, and executable capacity remain `UNKNOWN`.

No key, signed/private endpoint, order, test order, transfer, withdrawal,
provider, host, UI, canonical, or money action exists in this packet.

## One-run commands

All paths below stay inside this packet except the read-only shared archive.

```bash
python3 experiment.py screen --shared-root <read-only-monthly-root>
python3 experiment.py prepare --shared-root <read-only-monthly-root>
python3 experiment.py freeze
python3 experiment.py run --shared-root <read-only-monthly-root>
python3 experiment.py verify
python3 experiment.py report
```

`run` creates the consumed marker before any development outcome is read.
Development is sealed before holdout bytes are opened. A failed development
admission leaves the holdout unopened permanently.

The pre-run `prepare` phase is custody-only: it hashes every declared ZIP,
checks the publisher sidecar, and opens only the sole CSV member's header.
It never iterates an outcome row. In the one-run phase, April 2025 through
March 2026 rows may be parsed only after the consumed marker exists.
April-June 2026 rows may be parsed only after the development result and
champion are sealed and the holdout-open marker is atomically written.
