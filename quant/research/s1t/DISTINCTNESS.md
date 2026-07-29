# S-1T distinctness

S-1T asks whether, within its frozen June-2025 selected universe, a contract-level
Binance USD-M funding settlement interval compression retrospectively identified
in official archive rows as a stable 8-hour cadence changing to 4 or 1 hours is
followed by a profitable contrarian event cohort after public proxy costs.

That universe is fixed before any July-2025-or-later member is inspected:
candidates come only from June-2025 fundingRate `*USDT` paths, eligibility
requires complete stable-8h June funding and both complete hourly datasets, and
eligible contracts are ranked by exact June contract quote volume. Only ranks 1
through `min(100, eligible_count)` are selected, with no later replacement.

It does not reuse outcomes from any earlier packet.

- S-1M studies funding acceleration while cadence remains an input, not a
  transition treatment.
- S-1Q studies funding sign flips; S-1T requires no sign flip.
- S-1R studies funding surprise and basis reversion; S-1T has no basis signal.
- S-1S is a pre-settlement squeeze design; S-1T enters only after archived
  settlement rows retrospectively identify a cadence change.
- S-1U conditions on taker imbalance; S-1T does not use trade imbalance.
- S-1V studies a cross-sectional dispersion compression-to-expansion state
  transition across a fixed 30-symbol portfolio. S-1T studies each contract in
  its frozen June-2025 top-`min(100, eligible_count)` stable-8h `*USDT` universe
  whose settlement cadence changes from 8 hours to 4 or 1 hour.
- S-2F is recorded as `RETIRED/PRE_WORKTREE_STOP` with no protocol or research
  worktree; its reserved funding-trend question is not a settlement-cadence
  event study.

Reusable packet discipline is limited to checksum custody, one-run markers,
cohort-or-cash accounting, multiplicity, PBO, drawdown, capacity-proxy, and
sealed-holdout conventions.
