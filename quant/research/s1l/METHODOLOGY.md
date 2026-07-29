# S-1L methodology

## One economic question

Does a same-underlying Binance USD-M quarterly-versus-perpetual convergence
position retain a positive, statistically defensible net result per $1,000
gross after explicit perpetual funding, taker-fee proxy, adverse execution,
expiry flatting, and a coarse public capacity gate?

For each completed expiry, the 08:00 UTC hourly close at a frozen days-to-
delivery offset determines which contract is rich. The evaluator enters both
legs at the next 09:00 hourly open, shorts the rich contract, longs the cheap
contract, and closes both at 09:00 one or two days before delivery. BTC and ETH
are combined into one equal-gross quarterly portfolio cluster.

## Accounting

Each cluster uses fixed, non-compounding $1,000 gross:

- $500 gross per underlying;
- equal base quantity on the dated and perpetual legs, sized as
  `$500 / (dated entry price + perpetual entry price)`, so their two entry
  notionals sum to $500 without leaving a first-order outright delta;
- linear USD-M price P&L `side * base_quantity * (exit - entry)`;
- every archived perpetual funding event strictly inside the holding interval;
- four taker-proxy fills per underlying;
- adverse price on every entry and exit.

The base scenario uses 5 bp fee plus 2 bp adverse execution per leg fill. The
stress scenario keeps the 5 bp fee and uses 20 bp adverse execution, matching
the narrowest public depth band. The identity

`reference gross + funding - adverse execution - fees = net`

must reconcile exactly under decimal arithmetic. Account-effective fee and
realized-fill truth remain `UNKNOWN`.

## Expiry, roll, and missingness

Each dated symbol is a separate contract. There is no continuous-contract
execution price, synthetic splice, or automatic roll. All positions are flat
at least 23 hours before the documented 08:00 UTC delivery, so settlement
price and delivery fee are not booked. A missing signal, entry, exit, hourly
path, funding/mark alignment, checksum, schema, or directional depth snapshot
terminates the one run as `UNMEASURED`; it never drops or rescales a cluster.

## Frozen family and holdout

The immutable six-trial family is entry DTE `{14, 28, 42}` crossed with exit
DTE `{1, 2}`. Development is the eight quarterly clusters from 2023-Q1 through
2024-Q4. One champion is selected by highest stress net, then base net, then
trial ID. Its bytes and complete development record are sealed before the six
quarters from 2025-Q1 through 2026-Q2 are opened once.

## Multiplicity, PBO, drawdown, capacity

- 4,096 seeded synchronous circular-block bootstrap replicates use two-quarter
  blocks.
- The complete six-trial development matrix feeds one-sided raw and Holm
  p-values, a centered maximum-statistic reality check, and a Bonferroni lower
  endpoint for the selected trial.
- CSCV/PBO uses all `C(8,4)=70` development splits. Zero-trade cells stay in the
  matrix; in-sample ties choose the lowest trial ID and out-of-sample equality
  counts as below median.
- Drawdown is marked hourly as hypothetical adverse liquidation equity after
  entry fees, exit fees, accumulated funding, and the scenario's slippage.
  Intrahour lows and account liquidation dynamics remain unknown.
- At every fill, the latest public directional ±0.20% depth snapshot no older
  than 60 seconds is divided by that fill's actual reference notional before
  the minimum scale is applied to $1,000 gross. All legs must support the
  normalized portfolio. Exact execution capacity remains unknown.

## Verdict law

`UNMEASURED` means the required public path or seal integrity could not be
computed. `NO_GO` means it was computed but at least one public or
account-effective gate failed or stayed unknown. `GO` requires every gate,
including independently proven account-effective costs. None of the three
states grants capital or order authority.
