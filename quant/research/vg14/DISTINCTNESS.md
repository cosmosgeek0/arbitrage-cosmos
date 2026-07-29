# V-G14 distinctness freeze

V-G14 owns one narrow family:

> Spot-only, own-symbol 30-minute quote-volume residual versus the same UTC
> half-hour-of-week in the strictly previous eight weeks, followed by a
> delayed long/cash return measurement.

The signal uses only completed-bar `quote_asset_volume`, the symbol identifier,
and the UTC open timestamp. Open prices are used only after signal selection to
measure the predeclared entry and exit. Price direction is not a feature.

This is materially distinct from the adjacent public volume lanes:

- V-G1: BTC hourly taker-buy pressure, abnormal activity, and price
  displacement/compression.
- V-G2/V-G3: daily own-history volume shock with positive-return continuation
  or negative-residual-return reversal.
- V-G4-V-G7: daily divergence, breakout, compression, climax, price-low, wick,
  or reversal structures.
- V-G8: weekly eligible-universe volume-share rotation.
- V-G9: Spot versus USD-M cross-venue volume leadership.
- V-G10: 15-minute time-of-day-adjusted taker-buy imbalance with 2/4-hour
  persistence labels.
- V-G11: trade-count-to-notional fragmentation.
- V-G12: weekly cross-sectional volume entropy regime.
- V-G13: notional-volume versus realized-volatility decoupling.

V-G14 forbids taker-buy fields, trade counts, price-return or price-direction
features, volatility/range inputs, fresh highs or lows, breakouts, reversals,
wicks, compression, entropy, concentration, eligible-universe volume share,
derivatives, funding, cross-venue data, order-book data, and private data.

Its frozen family is 30-minute total quote-volume seasonality residual with
6-hour or 12-hour measurement horizons. It does not reuse V-G10's 15-minute
aggressor-side imbalance or its 2/4-hour horizon family.

