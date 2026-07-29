# S-2G distinctness gate

Verdict before worktree outcomes: `PASS_TO_PROCEED_WITH_NARROW_RAIL`.

S-2G alone asks whether a within-symbol UTC weekday open-to-next-open return
mean interacts with a prior-completed daily quote-volume **level rank**. It
centers by the within-symbol all-day return mean, cross-sectional weekday-return
mean, and volume-rank midpoint; ranks their product; and uses fixed
equal-gross market-neutral tails or cash. `D-1` is deliberately unused; every
formation input ends at `D-2`.

This centering establishes the distinct joint score, not zero realized
portfolio exposure to each component characteristic. That attribution remains
an explicit limitation.

Materially different accepted or active families:

- V-G14 and V-G19 use current intraday volume relative to matching
  half-hour/hour-of-week volume history and trade long/cash; price direction is
  not their formation alpha.
- S-2E uses lagged return times volume **change**, which S-2G forbids.
- V-G26 uses rolling return/volume-change correlation as a cohort-wide regime.
- V-G3 uses negative idiosyncratic return plus abnormal-volume reversal.
- S-1F uses a Monday weekly momentum schedule, not weekday-conditioned return
  seasonality.
- S-2A is a USD-M residual-return reversal family, not Binance Spot seasonality.

Any matching-slot current-volume residual, volume anomaly/event threshold,
lagged return feature, return-times-volume-change term, price-volume
correlation, weekday subset choice, futures input, or standalone volume-rank
trade is a collision and must terminate `UNMEASURED` before archive access.
