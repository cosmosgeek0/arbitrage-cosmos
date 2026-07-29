# V-G29 sibling-family collision audit

| sibling | shared surface | V-G29 exclusion | disposition |
|---|---|---|---|
| V-G13 | quote volume versus price variability | uses high-low log range, rolling time-series elasticity, slope break, and whole-cohort regime; no close-return volatility percentile or top-K | DISTINCT_SIBLING |
| V-G17 | price displacement per quote volume | uses log quote volume as the dependent variable against high-low range; no absolute close return, ratio score, or selected-symbol portfolio | DISTINCT_SIBLING |
| V-G1 | activity with low displacement | no taker-buy field, BTC-only rule, hourly data, or continuation direction | DISTINCT |
| V-G6 | range compression then breakout | no independent compression threshold, structural high, or breakout confirmation | DISTINCT |
| V-G26 | lagged price-volume correlation | no return field, rank correlation, cross-symbol correlation, or correlation regime | DISTINCT |
| V-G28 | quote-volume acceleration | no quote-volume difference or acceleration score | DISTINCT |

V-G29 defines range only as `ln(high/low)`. It forbids close-return sign,
absolute close return, close-return volatility, breakout, reversal, trend,
standalone directional price low/high features, taker fields, trade count, volume shock, market share,
cross-venue data, correlation, and quote-volume acceleration.

Distinctness does not erase dependence. The frozen multiplicity gate applies
Holm and White Reality Check across all eight V-G29 trials, then applies a
conservative external factor of 29 named V-G attempts to the champion's
within-family adjusted p-value. PBO is a development diagnostic and gate, never
a return estimate.
