# S-2K distinctness freeze

S-2K owns `SPOT_CROSS_SECTIONAL_REALIZED_THIRD_MOMENT_LOW_MINUS_HIGH`.
The shared substrate is Binance public Spot kline history; the predictive
primitive is the prior UTC day's standardized third realized moment of
five-minute close-to-close log returns. Direction is frozen long lowest
realized skewness and short highest realized skewness. Formation ends before
the decision boundary, execution starts after a fixed five-minute latency, and
the position is held for one UTC day. The portfolio is fixed dollar-neutral
four-by-four tails or entirely cash.

Nearest-family comparison:

| family | shared substrate | other primitive | exact S-2K difference |
|---|---|---|---|
| S-1B | Spot prices | single-asset time-series moving-average trend | cross-sectional third moment, no trend input |
| S-1E | Spot prices | intraday liquidity-shock reversal | daily realized moment rank, no shock threshold |
| S-1F | Spot prices, cross-section | weekly return continuation | third moment, not prior return sign or magnitude |
| S-1Y | price pairs | cointegration residual mean reversion | univariate intraday third moment, no pair residual |
| S-1Z | prices, market-neutral cross-section | residual momentum | no beta residual, return momentum, or sign input |
| S-2A | Spot prices | reversal | no lagged return-level sort |
| S-2C | cross-section, neutral tails | residual volatility second moment | raw intraday standardized third moment only |
| S-2E | Spot price and volume | return-volume interaction | volume is capacity-only and never a signal |
| S-2G | Spot public data | weekday/seasonality | no calendar conditioning |
| S-2H | Spot prices | overnight-gap reversal | continuous UTC-day intraday moment, no gap input |
| S-2L | Spot price and volume | Amihud illiquidity premium | no return-over-volume signal |
| V-G18 | Spot public data, skew label | quote-volume-per-trade-count shock | return-distribution skewness, not trade-size skew |
| V-G24 | cross-section | volume lead-lag network | no cross-symbol volume edge |
| V-G26 | Spot price and volume | price-volume correlation | volume never ranks S-2K |
| V-G38 | Spot volume | volatility-of-volume compression | price-return third moment only |

Forbidden S-2K signal inputs are raw-return momentum or reversal, residual
returns, realized volatility as a rank, kurtosis, volume or trade-count ranks,
taker flow, funding, open interest, mark/index premium, gaps, calendar labels,
current `exchangeInfo`, outcome-selected universes, direction flips, and
post-outcome estimator changes.

S-2K is not one of the seven families frozen by S-META1. It remains standalone
source-only evidence until an accepted successor registry or N3 convergence
explicitly counts it.
