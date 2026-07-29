# V-G11 methodology

## Source and semantic boundary

The input is the read-only S-1F archive cache. Its discovery, acquisition
manifest, and consumed run-marker bytes are pinned, but that marker grants no
V-G11 authority. Every selected ZIP is matched to its manifest row, its local
sibling `.CHECKSUM`, its exact SHA-256 and byte count before decompression.
Only completed 2025+ microsecond daily Spot klines are accepted.

Field 8 is quote asset volume and field 9 is Binance's number of trades. The
metric is:

`intensity = number_of_trades / quote_asset_volume`

and may be displayed as trades per 1,000,000 USDT. It is a mean quote-notional
fragmentation proxy. It is not average fill size, unique orders, unique users,
capacity, spread, slippage, impact, or transaction cost.

## Causal signal and labels

For each stable eligible public Spot `*USDT` archive prefix, a signal day needs
exactly 60 consecutive completed prior daily bars. Current intensity is divided
by the median of the 60 prior daily intensities. A first crossing requires the
previous day's intensity to be below that same frozen prior-60 threshold and
current intensity to be at or above it.

The current trade count must be at least 1.25 times its prior-60 median. Current
quote volume must be 0.75–1.25 times its prior-60 median, whose level must be at
least 10,000,000 USDT. After an event the next three signal dates are blocked
for that symbol. No price, return, volatility, entropy, taker-buy, seasonality,
residual, cross-sectional rank, or weekly rotation value enters detection.
Open prices are read only after selection to label the entry at signal+1 UTC
daily open and exit at signal+3 UTC daily open.

The three closed trials are intensity thresholds 1.5, 2.0, and 3.0. Development
chooses the largest stress-proxy mean, with trial ID ascending as the exact tie
break. No outcome-driven amendment is permitted.

## Costs and statistics

Gross label returns are reduced by frozen round-trip proxies: 20 bp public fee
schedule only, 30 bp base (10 bp fee plus 5 bp explicit friction per fill), and
70 bp stress (10 bp fee plus 25 bp explicit friction per fill). A conditional
15 bp round-trip BNB display scenario is informational and never gates.

Signal-date clusters are resampled with a deterministic seven-calendar-day
circular block bootstrap. The one-sided lower probability is 0.05/3 across the
closed three-trial family. Development requires at least 40 events, 10 symbols,
six event months, positive stress mean, adjusted lower bound above zero, and
stress-proxy drawdown no greater than 35%. Holdout requires 20 events, eight
symbols, three months, positive stress mean, the same conservative lower-bound
gate, and the same drawdown bound.

Development signal dates are 2025-07-01 through 2026-02-25. Holdout signal
dates are 2026-03-01 through 2026-06-27. This makes the physical monthly
partitions disjoint: May 2025–February 2026 for development/warmup and
March–June 2026 for holdout.

## Verdict and consumer contract

A source or validity failure before defensible development measurement is
terminal `UNMEASURED/NO_GO`. A development gate failure is terminal measured
`NO_GO` with holdout untouched. Only a fixed development candidate may reach a
single digest-bound holdout evaluation; research `GO` requires every holdout
gate.

The N3 projection is for a successor registry/adapter, not the current adapter.
It exposes exact declared/observed trial counts but keeps unrun PBO, deflated
Sharpe ratio, accepted global test, account-effective fees, maker-entry truth,
complete costs, capacity, regime coverage, historical filters, slippage, and
impact as JSON `null`, never numeric zero. Capital and execution authority are
always `NONE`.
