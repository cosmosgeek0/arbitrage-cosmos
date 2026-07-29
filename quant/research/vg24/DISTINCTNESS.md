# V-G24 distinctness boundary

V-G24 is the rolling cross-symbol volume-to-volume lag-two network experiment.
Its semantic identity is:

```text
Sunday source residual quote-volume surprise
  -> frozen directional i[t] to j[t+2] network learned only through d-1
  -> exact top-K downstream target cohort
  -> Tuesday open price payoff
```

It is distinct from the nearest public Volume experiments:

| sibling family | sibling mechanism | V-G24 exclusion |
|---|---|---|
| V-G19 | own-symbol hourly abnormal-volume autocorrelation | no hourly data, no self-lag trigger, no own-symbol persistence cohort |
| V-G20 | fixed BTC/ETH joint daily shock into one fixed liquid-alt cohort | no fixed leaders, no fixed target cohort, no contemporaneous joint-major trigger |
| V-G21 | residual volume-beta mechanism | no contemporaneous beta sort or residual-price payoff selector |
| V-G22 | adjacent own-symbol volume-regime gap plus positive price continuation | no price/return signal, no adjacent regime classification, no own-symbol continuation selection |
| V-G23/V-G25 and direct shock families | thresholded own-symbol shock followed by that symbol's continuation or recovery | a source never buys itself by construction; only learned lag-two downstream targets are eligible |
| cross-sectional momentum families | price-return winner ranking | prices cannot rank a source, edge, or target |

The following are frozen collision rails:

- signal input is Spot USDT quote volume only;
- every surprise uses only that symbol's prior 60 complete days;
- the daily leave-one-out market factor uses only the causal dynamic top-30;
- every edge is ordered, excludes self-edges, uses `i[t]` and `j[t+2]`, and
  ends with a target observation no later than `d-1`;
- an edge must be positive in the full fit and both chronological halves,
  stable under the frozen half-difference bound, and stronger than its reverse
  direction by the frozen margin;
- each eligible source retains exactly three outgoing edges or retains none;
- only a Sunday source residual surprise at least `2.0` activates its retained
  edges;
- a trial selects an exact top `K` downstream cohort or stays wholly in cash;
- the matched comparator ranks the same causal top-30 by each asset's own
  current residual surprise and is evaluated only on the network's active
  schedule;
- prices are schema-parsed with the public kline before selection but are
  inaccessible to cohort/network functions; their first economic use is after
  the cohort is fixed, only for payoff, observed-mark drawdown, and the
  same-schedule comparator.

These rails distinguish method identity. They do not prove structural
causation, historical tradability, execution, capacity, or a program-wide
positive edge.
