# S-1U distinctness freeze

S-1U is frozen as
`USD_M_SETTLEMENT_ANCHORED_LAGGED_TAKER_BUY_IMBALANCE_CONTRARIAN_RESPONSE`.
Its only directional conditioner is lagged, fully closed USD-M taker-buy quote
imbalance. A published funding row supplies only an observed event timestamp.

The boundary is material:

| predecessor | frozen boundary from S-1U |
|---|---|
| S-1C | no funding-sign/premium crowd-unwind direction and no maker trade-through |
| S-1D | no funding-level rank or funding-dispersion carry |
| S-1E | no Spot liquidity shock; S-1U uses USD-M contract flow at observed settlements |
| S-1F | no weekly Spot momentum |
| S-1G | no BTC basis/funding carry |
| S-1H | no BTC/ETH relative basis |
| S-1I | no premium residual |
| S-1J | no Spot hedge and no funding carry |
| S-1K | no COIN-M versus USD-M relative basis |
| S-1L | no quarterly/perpetual relative basis |
| S-1M | no funding acceleration |
| S-1N | no beta-matched high-versus-low funding portfolio |
| S-1O | no open-interest condition and no settlement-to-settlement hold |
| S-1P | no volume-led later basis crossing; basis is forbidden |
| S-1Q | no funding-sign flip |
| S-1R | no funding surprise or Spot/USD-M basis reversion |
| S-1S | no pre-settlement squeeze |
| S-1T | no funding-interval level, transition, change, or transition-conditioned response |

S-1U is contrarian only: long the two lowest lagged imbalance members and short
the two highest. It does not test continuation as a competing direction.
Funding value, funding sign, interval length, and event funding cash flow never
enter the signal or PnL. No later observed settlement may enter the response
horizon.
