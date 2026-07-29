# V-G10 distinctness map

V-G10 owns one narrow family:
`SPOT_15M_CROSS_SECTIONAL_TIME_OF_DAY_TAKER_BUY_IMBALANCE_PERSISTENCE_CONTINUATION`.
Its signal asks whether the *directional composition* of aggressive Spot flow
remains unusually buy-heavy relative to that symbol's own causal UTC
quarter-hour baseline.

| Sibling | Why V-G10 is materially different |
| --- | --- |
| V-G1 | Cross-sectional 15-minute Spot cohort, not BTCUSDT hourly pressure; no price compression/return input. |
| V-G2/V-G3 | No daily quote-volume level, rank, or shock. |
| V-G4 | No reversal or price-direction signal. |
| V-G5 | No breakout, trend, or volatility. |
| V-G6 | No compression or breakout. |
| V-G7 | No climax, exhaustion, or reversal. |
| V-G8 | No weekly volume-share rotation. |
| V-G9 | Spot only; no USD-M or cross-venue volume leadership. |
| V-G11 | No trade count or notional-intensity feature. |
| V-G12 | No entropy or entropy-breadth regime. |
| V-G13 | No raw-volume/realized-volatility decoupling. |
| V-G14 | No raw-volume intraday seasonality residual. Time-of-day adjustment applies exclusively to taker-buy imbalance. |
| V-G15 | No breadth above a lagged raw-volume baseline. |
| V-G16 | No quote-volume concentration change. |
| V-G17 | No absolute-return-per-volume or price-impact-efficiency signal. |
| V-G18 | No quote-volume-per-trade-count shock. |
| V-G19 | No seasonality-adjusted raw-volume-surprise autocorrelation. |
| V-G20 | No BTC/ETH-to-alt volume diffusion. |
| V-G21 | No market-factor residual volume beta. |
| V-G22 | No adjacent-bar quote-volume-gap continuation. |
| V-G23 | No market-wide abnormal-volume-breadth allocation. |
| V-G24 | No cross-sectional quote-volume lead-lag transmission network. |
| V-G25 | No daily volume-shock first-passage recovery-horizon or survival construct. |
| V-G26 | No lagged price/quote-volume Spearman correlation regime; price is forbidden to the V-G10 signal. |
| V-G27 | No cross-sectional intraday raw quote-volume dispersion. |
| V-G28 | No own-symbol log quote-volume second-difference acceleration/deceleration. |
| V-G29 | No quote-volume-to-intraday-range elasticity or elasticity break. |
| V-G30 | No lagged quote-volume positive-anomaly tail concentration. |
| V-G31 | No lagged quote-volume state-transition regime. |
| V-G32 | No lagged liquidity-leader membership churn or turnover regime. |
| V-G33 | Rejected before implementation as a material duplicate of V-G27, not V-G10. |
| V-G34 | Rejected before implementation as a material duplicate of V-G30, not V-G10. |
| V-G35 | No lagged abnormal-volume-duration hazard or survival construct. |
| V-G36 | No daily negative-logit taker-buy-share innovation shock on an unranked whole-cohort-or-cash clock. V-G36 shares the two kline volume fields, but its single-event volatility-normalized shock primitive is distinct from V-G10's same-quarter-hour causal-median residual, four-bar persistence count, and cross-sectional top-K rank. |
| V-G37 | No lagged market-wide quote-volume synchronization shock. |
| V-G38 | No lagged quote-volume volatility-of-volume compression. |

## Input firewall

Signal code receives only symbol, UTC timestamps, total quote volume, and
taker-buy quote volume. Price is dereferenced only after selection at frozen
entry and exit opens. The waited bar's raw quote volume is dereferenced only
after selection for the non-executable $1,000 participation proxy. Number of
trades and other kline columns are parsed solely for strict schema custody and
never enter ranking.

Any future implementation that puts price, return, raw-volume level, surprise,
breadth, concentration, gap, market factor, diffusion, trade count,
price-impact efficiency, volatility, entropy, futures, breakout, trend,
reversal, compression, climax, or exhaustion into the score is a different
protocol and invalidates V-G10 rather than extending it.

This collision boundary is closed through V-G38 using the terminal or
pre-worktree-stop evidence for each sibling. Shared raw kline fields alone do
not establish distinctness: V-G36 is separated by its shock-detection
primitive, not merely by frequency, thresholds, allocation, or packaging.
