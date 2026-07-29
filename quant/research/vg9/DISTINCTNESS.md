# V-G9 distinctness law

V-G9 asks whether a **cross-sectional level spread in completed quote-volume market
share** predicts next-week **Spot-only** returns and adds information beyond Spot
share alone.

- Signal: trailing Spot quote volume and trailing USD-M quote volume, transformed
  only into same-window cross-sectional venue shares and their log ratio.
- Payoff: long Spot only, entered after 24 hours and exited/rebalanced weekly.
- Comparator: trailing Spot quote-volume share level, with the same eligible set,
  schedule, number of positions, weights, and costs.

It is not S-1P. S-1P is a BTC/ETH own-symbol five-minute temporal sequence whose
later basis cross creates a long-Spot/short-perpetual trade. V-G9 has no basis,
premium, convergence, paired trade, or temporal volume-event arm.

It is not V-G8. V-G8 ranks five-day Spot share relative to the immediately prior
sixty-day Spot share. V-G9 never computes share acceleration, a recent-versus-prior
window, or an own-Spot abnormal-volume ratio. Every V-G9 trial uses one trailing
window and compares the same level across venues.

Forbidden signal inputs are price, return, direction, shock, breakout, trend,
volatility, basis, premium, funding, open interest, liquidation, taker-side
imbalance, trade count, and any future completeness fact. USD-M can never create a
position, fee, funding cash flow, leverage, short, or borrow in V-G9.

If a later-discovered preregistered experiment already owns this exact
cross-sectional level-spread signal, weekly Spot-only payoff, and matched Spot-share
incremental test, V-G9 becomes `UNMEASURED` and is not retuned or reopened.
