# V-G31 terminal evidence

## Verdict

V-G31 is terminal `NO_GO`. The sole run marker was consumed once. All twelve
frozen development trials completed, none passed every development gate, no
candidate was sealed, and the March–June 2026 holdout stayed unopened.

Capital verdict is `NO_GO`; execution authority is `NONE`.

## Development result

- Valid formations: 33 for every trial.
- Active holding spells: 24–33.
- Development gates passed: 4/11 for every trial.
- Gross net USDT per initial 1,000: -398.28 to -124.61.
- Public-base net USDT per initial 1,000: -470.59 to -204.76.
- Public-stress net USDT per initial 1,000: -519.05 to -260.00.
- Fee-stress net USDT per initial 1,000: -548.91 to -294.73.
- Public-stress maximum drawdown: 29.44% to 63.15%.
- Public 1 bp lagged participation proxy: 21,284.07 to 24,128.58 USDT.
- Holm-adjusted one-sided p-value: 1 for every trial.
- White Reality Check p-value: 0.9785208689.
- Monthly-net family-rank heuristic: 0.8714285714.

Every trial passed only the formation-count, active-spell, fixed-cohort, and
public-capacity-proxy gates. Every trial failed net, lower-bound, raw-p,
Holm-p, White-p, positive-month, and drawdown gates.

## Frozen-document boundary

`README.md`, `SHA256SUMS`, `freeze.v1.json`, and the other pre-outcome files are
preserved byte-for-byte. Their language saying result and markers were absent
describes the authenticated pre-outcome state. This terminal note records the
later one-use run without rewriting those frozen bytes.

Canonical terminal evidence is in:

- `run-marker.v1.json`
- `terminal-result-core.v1.json`
- `result.v1.json`

`candidate-seal.v1.json` and `holdout-open.v1.json` are absent because no
development trial qualified.

## Exact limitation

The result uses Binance public daily Spot archives and frozen public fee and
adverse-price scenarios. It does not prove historical order-book depth,
spread, filters, fractional executability, latency, queue position, impact, or
fills. Account-effective fees remain `UNKNOWN`, executable capacity remains
`UNMEASURED`, and the global holdout boundary remains
`NOT_CERTIFIED_SHARED_REUSE_RISK`.

The CSCV value is explicitly a non-gating monthly-net family-rank heuristic.
It does not reproduce the implemented champion rule; PBO of that selection
rule remains `UNMEASURED`.

No UI, host, provider, private API, order, transfer, withdrawal, or money
action occurred.
