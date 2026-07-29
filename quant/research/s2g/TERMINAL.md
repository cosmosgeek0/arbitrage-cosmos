# S-2G terminal verdict

## Decision

`NO_GO`; capital `NO_GO`; authority `NONE`.

The fixed development selector chose `W08_V28_K03` (8 prior weekday weeks,
28 prior quote-volume days, three names per side). It failed the frozen
development gates, so no candidate seal was created and the holdout remained
`UNOPENED` (`0/1`). The global holdout is independently
`NOT_CERTIFIED_SHARED_REUSE_RISK`. Sole consumer: `N3 successor/final
convergence`.

## Economics per initial 1,000 USDT

USDT is the reporting denomination and is not a USD-parity claim.

| Scenario | Net USDT / 1,000 | Final NAV | Maximum drawdown |
|---|---:|---:|---:|
| `PUBLIC_GROSS` | `+72.39644783` | `1072.39644783` | `10.1636%` |
| `PUBLIC_BASE` (10 bp fee + 10 bp adverse / turnover) | `-467.35790447` | `532.64209553` | `47.6575%` |
| `PUBLIC_STRESS` (10 bp fee + 25 bp adverse / turnover) | `-684.87364797` | `315.12635203` | `68.6270%` |
| `FEE_STRESS` (20 bp fee + 25 bp adverse / turnover) | `-777.92178362` | `222.07821638` | `77.7944%` |

The selected stress path had 242 valid formations, 233 active days, 1,995
nonzero symbol fills, mean daily turnover `1.44198773`, and zero positive
development months.

## Interval, multiplicity, and overfit diagnostic

- `PUBLIC_STRESS` seeded 14-day circular-block 90% interval:
  `[-745.50829840, -608.44107363]` USDT per initial 1,000.
- One-sided conditional block p-value: `1`.
- Holm-adjusted p-value over all 12 frozen variants: `1`.
- Basic synchronous White reality-check p-value: `1`.
- CSCV PBO diagnostic: `18/70 = 0.2571428571`; measured over eight
  development calendar months and explicitly not a verdict gate.

The development gates that failed were drawdown, positive net, positive lower
bound, positive-month count, raw p, Holm p, and White p. Formation count,
active-day count, symbol coverage, and the public capacity proxy passed.

## Capacity and truth boundary

The selected stress path's P05 public `C_1bp` quote-volume participation proxy
was `5916.33007944` USDT of strategy capital, above the frozen 1,000 threshold.
This is not executable capacity. Historical spread, depth, impact, fill
probability, current/historical filters, synthetic-short borrow availability,
borrow cost, and account-effective fees remain `UNMEASURED` or `UNKNOWN`.

The equal-weight selected tails are not constrained to be orthogonal to the
weekday and volume component characteristics. The result is profitability of
the frozen centered-product joint score, not a structural interaction
coefficient. Inference is conditional on the realized signal/turnover path;
fixed blocks do not re-estimate signals or preserve exact weekday counts.

## Custody and verification

- Exact base: `a169b123fb186d1943a75ad648552c4d95be1be1`.
- Frozen public sources: 12 symbols × 14 months = 168 ZIP/checksum/receipt
  triples, compressed bytes authenticated before any archive member opened.
- Freeze SHA-256:
  `39cfbe9f64b1cc5c7e3e7bfa1daa1af622c45eec6b996e2ed64cc87854dfbdad`.
- Source-manifest SHA-256:
  `a5ead6d8153befe8d99c498fd6a4f7a4c89317c851d223c729e77b9edcdc1f9c`.
- Run-marker SHA-256:
  `c46bf33beb68348c210342417bfc52c2c10b0000122a2ada3c0cebde981b66c8`.
- Terminal-core SHA-256:
  `ea6a7442537b2baaf6bde6d9bc66cf41118397e30991f438f22fbe9528ac40ac`.
- Result SHA-256:
  `ceac9d6d3fb6169905725b8129e2a69af15db1fc3d0e993c7892ffafe90d5f47`.
- One exclusive run marker exists; candidate and holdout-open markers do not.
- Network-free terminal verifier: `PASS verdict=NO_GO`.
- Static acceptance before the seal: 20 focused tests, Ruff check/format, and
  strict mypy all passed.

No UI, canonical/live/host/provider/private API, order, transfer, withdrawal,
or money state changed. Money remains `$0`.
