# S-2A complete S-1/V-G distinctness record

The pre-worktree gate compared every reachable S-1 family and every V-G slot.
No outcome JSON, holdout member, or sealed run was opened.

## Collision rail

S-2A remains materially distinct only while all four facts stay true:

1. the venue is public Binance USD-M;
2. the signal is a one-hour return residual from a causal BTC factor fit;
3. quote-volume confirmation is strictly lagged before the residual hour;
4. the payoff is symmetric idiosyncratic reversal with a mechanical
   market-factor hedge and an intraday exit.

Using the same-window cohort-median drop plus contemporaneous volume/seller
share of S-1E would be `DUPLICATE_S-1E`. Replacing reversal with continuation
would collide with S-1Z. Replacing the cross-sectional residual cohort with
fixed-pair OLS spreads would collide with S-1Y.

## Nearest S-1 families

| family | existing economic family | why S-2A is different |
|---|---|---|
| S-1E | Spot long/cash, contemporaneous five-minute median drop plus volume and seller-share shock, 30-minute exit | USD-M, causal BTC factor residual, preceding-hour volume, symmetric long/short plus BTC hedge, 2/4/8-hour exit |
| S-1Y | fixed USD-M pair-price OLS residual mean reversion; volume and cross-sectional residual cohorts forbidden; 72/168-hour holds | cross-sectional single-factor residual tails, required lagged volume, intraday holds |
| S-1Z | USD-M cross-sectional residual momentum | opposite continuation direction |
| S-1I | USD-M residual Premium Index mean conditioned on lagged funding | return residual rather than Premium Index/funding |
| S-1H | BTC/ETH Spot-perpetual basis residual | no Spot or basis input |
| S-1P | BTC/ETH relative-volume event followed by own-basis cross | no basis cross; multi-contract residual-return cohort |
| S-1U | settlement-clock contrarian tails from lagged taker imbalance | no settlement event or taker imbalance |

The remaining families are separate: S-1B single-BTC Spot trend; S-1C
post-funding unwind; S-1D funding dispersion; S-1F weekly Spot momentum; S-1G
basis carry; S-1J funding-ranked Spot hedge; S-1K COIN-M/USD-M relative
funding; S-1L calendar basis; S-1M funding acceleration; S-1N funding
continuation; S-1O OI-conditioned funding persistence; S-1Q funding-sign-flip
reversion; S-1R funding-surprise basis reversion; S-1S pre-settlement squeeze;
S-1T interval transition; S-1V funding-dispersion transition; and S-1W
OI-acceleration carry. S-1X has no product bytes and was retired as an S-1I
duplicate. No S-1A artifact was reachable.

## Nearest V-G families

| family | existing economic family | why S-2A is different |
|---|---|---|
| V-G3 | Spot daily negative median-demeaned return plus same-day volume shock, long/cash, 24-hour hold | USD-M hourly BTC-factor residual, preceding-hour volume, two-sided factor-neutral payoff |
| V-G7 | Spot daily own-history volume climax plus failed-low confirmation, long/cash | no daily climax or price-level failed-low rule |
| V-G10 | intraday Spot cross-sectional residual taker-flow; price and return inputs forbidden | S-2A requires price residual reversal and USD-M |
| V-G1 | BTC-only hourly Spot price/flow continuation | cross-sectional USD-M reversal |
| V-G27 | intraday lagged quote-volume residual dispersion; price forbidden | return residual is the primary signal |
| V-G9 | USD-M signal input with a long-Spot payoff | all payoff legs are USD-M and factor-neutral |

All 38 V-G slots were reconciled. V-G2 through V-G32, V-G35, and V-G37 have
committed protocols; V-G1, V-G10, V-G36, and V-G38 had design artifacts; V-G33
and V-G34 had no product bytes and were retired as duplicates of V-G27 and
V-G30. None matches S-2A's venue, causal sequence, residual topology, and
payoff together.
