# V-G21 — lagged market-factor residual volume

V-G21 asks one bounded question: after a symbol's completed daily quote-volume
surprise is conditioned on a **lagged, leave-one-out, market-wide volume factor**,
does the positive scaled residual identify a profitable next-open Spot cohort
versus zero-yield cash?

This packet is public Binance research only. It creates no UI, host, private-read,
order, execution, or money authority. A `GO` would mean forward-shadow eligibility,
not live trading approval.

## Distinct signal contract

For completed UTC day `d`, symbol `i`:

1. `s(i,d) = ln(quoteVolume(i,d)) - median(ln(quoteVolume(i,d-20:d-1)))`.
2. `M(-i,d)` is the median `s(j,d)` across the causal daily universe excluding `i`.
3. Rolling OLS with intercept is fit only through `d-1`:
   `s(i,u) = alpha + beta * M(-i,u-1)`, `u=d-L..d-1`.
4. The raw residual is
   `e(i,d) = s(i,d) - alpha - beta*M(-i,d-1)`.
5. The score divides `e(i,d)` by the trailing 20-day residual MAD calculated only
   through `d-1`; missing or zero scale makes the symbol ineligible.

This is intentionally named a lag-conditioned residual. It does not claim to remove
an unobserved contemporaneous market shock at `d`.

No price direction, return, volatility, taker flow, trade count, market share,
large-cap subset, diffusion portfolio, or market-regime switch enters the score.
Observation is sealed after day `d`; entry is the `d+2` open, leaving one full daily
archive-publication interval. Each valid sleeve buys the complete positive-residual
cohort or remains cash.

## Lifecycle

Run from `quant/` with the repository's pinned Python environment:

```text
PYTHONPATH=.:src uv run python research/vg21/experiment.py inventory \
  --state-root /private/tmp/cosmos-s1f-weekly-momentum-cash-v1
PYTHONPATH=.:src uv run python research/vg21/experiment.py freeze
PYTHONPATH=.:src uv run python research/vg21/experiment.py run
PYTHONPATH=.:src uv run python research/vg21/experiment.py checksums
PYTHONPATH=.:src uv run python research/vg21/experiment.py verify
```

`inventory` authenticates bytes and sidecars without opening archive members.
`freeze` binds the protocol, evaluator, tests, trial ledger, seed table, research,
and source inventory. `run` consumes the only run authority before the first ZIP
member is opened. The marker refuses reruns, including after an `UNMEASURED` stop.
The holdout may be opened at most once and only after a development champion seal.
Because sibling V-G lanes inspect overlapping dates, that seal is lane-local only:
the packet records the shared-family holdout as not certified and forces the N3
consumer p-value to `1` pending a prospectively frozen successor and fresh evidence.

## Verdict law

- Data custody, causality, lifecycle, missing-successful-exit, or source-integrity
  failure: `UNMEASURED`, capital `NO_GO`; numeric economics stay null.
- Development economic/statistical failure: `NO_GO`; holdout remains unopened.
- Holdout gate failure: `NO_GO`.
- All frozen gates passing: research `GO`; execution and capital authority `NONE`.

Historical spread, depth, filters, and account-effective fees never become zero.
