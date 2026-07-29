# S-2I distinctness lock

## Frozen family

At a completed common UTC hour, S-2I fits a prior-only rolling relation between
same-symbol Spot and USD-M returns. The predictor is the standardized Spot
innovation left after controlling for the contemporaneous USD-M return.
Cross-sectional high innovations are bought and low innovations are sold in
USD-M at the next common hourly open. No Spot position is held.

## Nearest accepted work

- V-G9 studies multi-week Spot versus USD-M volume-share leadership and pays
  out in weekly Spot returns.
- V-G24 studies daily Spot quote-volume network leadership and pays out in
  later Spot returns.
- S-1P uses a relative-volume event followed by a basis cross and a paired
  Spot/perpetual convergence payoff.
- S-1Y is USD-M-only fixed-pair price-residual mean reversion.
- S-1Z and S-2A are own-USD-M residual momentum/reversal drafts.

S-2I shares neither their predictor primitive nor their payoff lifecycle.

## Collision rails

The evaluator must stop if any of these changes:

- basis, premium, funding, volume, taker flow, or open interest becomes a
  predictor;
- a Spot position or paired Spot/perpetual payoff is introduced;
- the matched comparator ceases to use the same lifecycle and its own
  just-completed USD-M return;
- the reverse USD-M → Spot diagnostic disappears;
- symbol membership or trials are changed after outcome access.
