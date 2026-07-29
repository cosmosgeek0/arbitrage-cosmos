# S-2H distinctness

| existing family | shared surface | S-2H boundary | disposition |
|---|---|---|---|
| S-1E Spot liquidity-shock reversal | Spot reversal | S-1E is a seller-flow and abnormal-volume five-minute event with a 30-minute long/cash payoff; S-2H is a once-daily UTC-boundary price-gap cross-section with a synthetic long/short payoff | DISTINCT |
| S-1F weekly Spot momentum | Spot cross-section | S-1F ranks multi-week continuation and holds long/cash for one week; S-2H ranks an adjacent-print boundary gap in the opposite direction and closes within the UTC day | DISTINCT |
| S-1Y pair-residual mean reversion | mean reversion | S-1Y trades fixed USD-M pair residuals over multi-day holds; S-2H uses raw Spot boundary gaps across one frozen universe | DISTINCT |
| S-1Z residual momentum | cross-sectional returns | S-1Z is USD-M two-factor residual continuation; S-2H is raw Spot boundary reversal | DISTINCT |
| S-2A intraday residual reversal | cross-sectional reversal | S-2A is an hourly USD-M BTC-factor residual event with lagged-volume confirmation; S-2H is a daily Spot UTC-boundary raw-gap sort | DISTINCT |
| V-G13 volume-volatility decoupling | cross-sectional rank | V-G13 forbids a primary price-gap signal; S-2H uses only the price boundary for direction | DISTINCT |
| V-G22 volume-gap continuation | “gap” wording | V-G22's gap is abnormal quote-volume continuation; S-2H's gap is adjacent Spot prices and reversal | DISTINCT |

The family stops as a duplicate if the primary signal changes from
`UTC_DAILY_BOUNDARY_GAP`, if the payoff changes from reversal, or if the venue
changes from Binance Spot. Costs, tail size, or holding time alone never create
a new family.
