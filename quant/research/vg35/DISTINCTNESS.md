# V-G35 family distinctness

V-G35 owns one variable: the exact newly attained age of a symbol's own
consecutive abnormal daily quote-volume spell. A day is abnormal only when its
complete quote volume is at least `2.0 ×` the median of its prior 60 complete
days. Trials test exact ages `2`, `3`, and `5`, each with lagged holding horizons
`1` and `3` days.

| prior family | owned question | V-G35 exclusion |
|---|---|---|
| V-G25 volume-shock recovery | time from shock crossing to recovery/censoring and post-recovery return | no shock-to-recovery episode, recovery boundary, first-passage endpoint, or post-recovery entry |
| V-G19 abnormal-volume autocorrelation | lag correlation, decay, and half-life of abnormal volume | no autocorrelation, rho, decay curve, half-life, or immediate shock continuation |
| breadth | how many symbols are abnormal and whether breadth scales exposure | no count/share scalar, breadth gate, breadth rank, or exposure scaling |
| turnover | changes in volume share, rank, leadership, or concentration | no rank rotation, share turnover, concentration, entropy, or replacement |
| seasonality | calendar-conditioned or seasonally residualized volume | no hour, weekday, month, UTC-session, or calendar residual |

Also forbidden are price direction, breakout, trend, reversal, volatility,
range, wick, failed-low, diffusion, factor residual, price-volume correlation,
acceleration, dispersion, transition-matrix, liquidity-adjusted, derivatives,
taker-flow, and trade-count families.

The one-day spell-termination hazard
`h(d) = P(next day nonabnormal | exact current spell age d)` is descriptive and
right-censored when the next partition day is unavailable. It never selects,
weights, filters, rescues, or changes a trial. The signal is frozen after day
`t` closes; day `t+1` is skipped in full; entry is `t+2` open. Therefore the
next-day hazard outcome cannot leak into membership or execution.
