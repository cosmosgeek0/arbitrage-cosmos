# S-1G methodology — causal funded-basis carry

## Question and falsifiable claim

Can one predeclared BTCUSDT Spot/USD-M perpetual cash-and-carry rule produce a
positive net USD-equivalent result per $1,000 after conservative fees, funding,
spread, slippage, and latency, while surviving an untouched chronological
holdout, multiple-testing control, CSCV probability-of-backtest-overfitting
(PBO), drawdown, and volume-proxy capacity gates?

The trade is long Spot and short the perpetual in equal base quantity. A
positive perpetual premium is necessary but is never booked as entry revenue.
Only later measured basis compression and actually observed future funding
settlements contribute revenue.

## Pre-outcome custody

The complete public custody interval is the 13 calendar months
`[2020-01-01T00:00:00Z, 2021-02-01T00:00:00Z)`. Within it, the causal
one-week-ahead walk-forward contains exactly 52 steps (364 days), followed by a
later untouched four-week holdout.

Raw custody is physically split before any outcome is opened:

1. Development may acquire only the January–December 2020 monthly archives.
2. Holdout acquisition is a separate January 2021 root and is forbidden
   until the development result, exact champion ID, protocol digest, runner
   digest, trial-ledger digest, and source manifest are sealed.
3. Holdout opening requires an atomic, single-use authorization bound to those
   digests, including the exact development-consumption marker digest. A
   pre-existing marker, partial holdout root, digest mismatch, second use, or
   output collision fails closed.
4. Development cannot list, hash, inspect, parse, or infer holdout members.
   Before development acquisition or scoring, the fixed holdout root,
   authorization marker, evaluation marker, and checked-in holdout manifest
   must all be absent, including broken symlinks.
5. Each expected ZIP must have its sibling `.CHECKSUM`; the local SHA-256 must
   match before the sole ordinary CSV member is parsed. Archives with path
   traversal, links, extra members, conflicting rows, or unexpected schemas are
   rejected.

The development weekly score interval is
`[2020-01-01T00:00:00Z, 2020-12-30T00:00:00Z)`: 52 consecutive seven-day
half-open UTC blocks. Early observations remain measured zero-exposure weeks
until the funding lookback and seven prior complete volume days exist.
December 30–January 1 is unscored; selection and the candidate seal must finish
before the holdout root is acquired.

The untouched holdout score interval is
`[2021-01-01T00:00:00Z, 2021-01-29T00:00:00Z)`: four consecutive seven-day
half-open UTC blocks. It starts flat with no imported development state; its
first days remain measured zero exposure until holdout-local funding history
and seven complete volume days exist. January 29–February 1 is unscored.

The monthly archive itself is a custody unit; downloading a monthly holdout ZIP
counts as opening holdout custody even if no CSV row is parsed.

## Public inputs and causal timing

Required monthly series for BTCUSDT are:

- Spot 1-minute klines;
- USD-M perpetual 1-minute klines;
- USD-M 1-minute mark-price klines;
- USD-M funding-rate history.

At funding settlement time `t`, the decision may consume that now-settled
funding rate, earlier funding events, and only the latest shared Spot/perpetual
one-minute bars whose close time is strictly before `t`. It may not consume the
bar containing future observations after `t`. Funding intervals are derived
from prior observed settlement timestamps; an 8-hour schedule is not
hard-coded.

All timestamps are normalized to UTC milliseconds. Decimal market and money
fields remain exact decimal values until the final reporting conversion.
Missing minutes are not forward-filled. A decision, fill, funding attribution,
mark, or exit that lacks the required shared data fails closed.

## Candidate family and entry rule

There are exactly 12 attempted trials:

`L ∈ {6, 18} × H ∈ {1, 3, 7 days} × buffer ∈ {0, 5 bp}`.

No parameter, threshold, symbol, date, cost, stop, seed, or tie-break may be
changed after development outcomes are opened.

For candidate `(L, H, buffer)`:

1. Wait for `L` unique, strictly ordered, settled funding observations.
2. Require every rate in the trailing `L` observations to be strictly positive.
3. Let `r_floor` be the minimum of those `L` rates.
4. Let the causal interval be the median of the positive differences between
   those same trailing settlement timestamps. Reject inconsistent or missing
   timing rather than assuming eight hours.
5. Let `n_expected = floor(H × 24 hours / causal_interval)`.
6. Compute conservative funding forecast
   `q × mark_reference × r_floor × n_expected`.
7. Compute causal positive basis forecast
   `q × (perpetual_reference - spot_reference)`. Require it to be strictly
   positive independently.
8. Require
   `positive_basis_forecast + conservative_funding_forecast`
   to be at least the full primary all-taker round-trip modeled cost plus
   `q × spot_reference × buffer / 10,000`.

The gross forecast is an eligibility threshold only. Neither forecast component
is booked as PnL. Future funding contributes only when a later settlement is
actually observed while the short remains open. Basis PnL uses the raw causal
fallback and exit references; fees and every adverse execution wedge are
subtracted as named expenses.

Only one position may be open. A completed exit starts a fixed 24-hour
cooldown. No pyramiding, staged allocation, borrowing, rebalancing, interest
credit, collateral yield, or reinvestment is modeled.

## Maker attempt and deterministic fallback

At an eligible signal, the simulator records a paired maker-entry attempt at
the causal reference time. Public kline/funding archives do not contain queue
position, order-level depth, cancellation priority, or a defensible fill
receipt. Therefore:

- primary maker state is always `MAKER_NONFILL_PUBLIC_QUEUE_UNKNOWN`;
- the attempt books zero quantity, zero fee, and zero spread capture;
- no one-leg maker fill is permitted;
- exactly 60 seconds after the attempt, the strategy either executes both legs
  as takers at the first common eligible one-minute open or skips the entry if
  the causal rule no longer clears;
- a missing common fallback minute is a data failure, not a free fill.

Every paired attempt is counted when the initial causal signal clears, even if
capacity or the fallback-time rule later skips the taker entry. Completed
fallbacks and skipped fallbacks are reported separately.

Every exit is a paired taker exit. Maker-fill sensitivities, if ever reported,
are non-decision diagnostics and cannot change the verdict.

## Capital and quantity

The reporting unit is $1,000 USD-equivalent account capital under the explicit
proxy `1 USDT = 1 USD`:

- $400 is reserved for the fully funded Spot purchase;
- $600 is futures collateral;
- the USD-M short targets approximately $400 notional and the same BTC base
  quantity as Spot;
- no borrowed asset, margin loan, leverage mutation, liquidation credit, or
  external yield is allowed.

Quantity is rounded down to the predeclared current public common step proxy of
`0.001 BTC`, using the greater of the two raw fallback references so neither
leg exceeds its $400 target. Historical lot, notional, and filter validity is
`UNKNOWN`; current public filters are feasibility context only. A zero or
below-minimum proxy quantity is no trade.

## Cost and PnL accounting

Each scenario reports Spot fees, futures fees, aggregate spread, aggregate
slippage, aggregate latency, funding, basis, rounding, and net as separate
components. Every value is assessed on the four actual fill notionals.

| Scenario | fee | spread | slippage | latency | total per taker fill |
| --- | ---: | ---: | ---: | ---: | ---: |
| primary | 10 bp | 3 bp | 4 bp | 3 bp | 20 bp |
| stress | 10 bp | 5 bp | 10 bp | 5 bp | 30 bp |
| severe | 10 bp | 10 bp | 25 bp | 15 bp | 60 bp |

The 10 bp fee is a conservative proxy on Spot and futures for both entry and
exit; it is not account fee truth. At exactly $400 notional per leg, four
primary fills imply $1.60 fees and $1.60 execution wedge, or $3.20 per $1,000,
before funding and basis PnL. Actual fill notionals determine the reported
amounts.

Raw one-minute open references are retained. The adverse spread, slippage, and
latency wedges are not hidden in adjusted prices; they are subtracted explicitly
from net on every actual fill notional.

The same causal trade timestamps and quantities selected under primary costs
are repriced under stress and severe costs. Stress does not select a new
champion or create a different trade sample.

For each completed trade:

- `spotGross = q × (spotExit - spotEntry)`;
- `perpetualGross = q × (perpetualEntry - perpetualExit)`;
- `basisPnl = spotGross + perpetualGross`;
- `fundingPnl = Σ(q × eventMarkPrice × eventFundingRate)` for settlements
  strictly after entry and strictly before the exit instant; a positive
  rate is received by the short and a negative rate is paid;
- `net = basisPnl + fundingPnl - fees - spread - slippage - latency
  - roundingResidual`.

Fee, funding, spread, slippage, latency, basis, and rounding
components must reconcile exactly to net. Funding observed before the actual
taker fallback fill is excluded.

Weekly score is the change in conservative liquidation equity during each
half-open UTC week, expressed in USD-equivalent per original $1,000. Open
positions are marked at the latest shared causal close with the full round-trip
scenario decomposition, including already incurred entry costs and a reserved
exit. Realized accounting replaces that provisional trade total at exit, so
costs are not counted twice.

The liquidation-equity path observes the actual fallback-open state
immediately after entry, before any within-minute favorable movement. Positive
exposure weeks are attributed from the actual fallback fill timestamp, never
from the earlier maker-attempt timestamp.

## Exit and stop rules

The first causal trigger wins; ties use the order below:

1. invalid, missing, duplicated, or nonmonotone required source data;
2. portfolio drawdown reaches 10.00% of the original $1,000;
3. current positive basis widens by at least 100 bp from entry basis;
4. a newly settled funding rate is nonpositive;
5. causal perpetual-minus-Spot basis is nonpositive (convergence);
6. candidate maximum hold `H`;
7. development or holdout score boundary.

Economic triggers execute both exits as takers at the first common eligible
minute after the trigger. A source-data trigger refuses to invent an exit,
records the evidence as incomplete, and makes the affected evaluation
`UNMEASURED`. Reaching the 10% drawdown is terminal: exit at the first common
eligible minute, prohibit new positions for the remainder of that evaluation,
and fail the drawdown gate.

No signal may enter unless its 60-second fallback timestamp plus that
candidate's maximum hold `H` is no later than the score boundary. Internal
weekly boundaries do not reset strategy state; positions may cross them, and
the liquidation-equity change is allocated to the appropriate week.

## Walk-forward and selection

Each candidate's authorization score uses one chronologically ordered,
continuous 52-week equity path. Rules and parameters are frozen before week
one.

The 52-step causal one-week-ahead diagnostic covers all 364 scored days:

- week one uses the predeclared lexical cold-start candidate
  `s1g-l06-h01-b000`;
- the diagnostic is a separate executable switched portfolio that starts each
  week flat, may use only causal funding and volume history from earlier
  timestamps, and exits any still-open position as a paired taker at that
  week's boundary before switching;
- each weekly calculation loads at most the preceding 18 causal days, enough
  for the maximum 18-event lookback even at the accepted 24-hour interval
  ceiling and for the seven complete volume days;
- realized equity, the running equity peak, drawdown-terminal state, and any
  residual 24-hour cooldown from the selected prior week carry into the next
  week; only position inventory is forced flat;
- before each later week, rank all 12 data-valid candidates using earlier
  flat-to-flat diagnostic scores only;
- rank first by prior weekly mean; only exact mean ties invoke the prior
  bootstrap lower bound, then prior weekly-close drawdown, then candidate ID;
  for one through three prior weeks the four-week bootstrap is undefined, so
  an exact mean tie skips it and uses drawdown then candidate ID;
- record the selected candidate's next-week score;
- never refit from, revise after, or back-propagate the next week's outcome.

This diagnostic does not open holdout and does not replace the final
development selection and is not an authorization gate. After all 52
development weeks, first apply every candidate-specific authorization gate.
The final champion is the eligible candidate with, in order:

1. greatest primary mean net USD-equivalent per $1,000;
2. greatest primary 95% stationary-bootstrap lower bound;
3. smallest maximum drawdown;
4. lexicographically smallest candidate ID.

If no candidate is eligible, holdout stays closed and the verdict is `NO_GO`
unless source custody was invalid, in which case it is `UNMEASURED`.

## Uncertainty, multiplicity, and PBO

All 12 attempted trials remain in the family regardless of errors, zero trades,
or poor results.

For each candidate, use a stationary circular bootstrap over its 52 weekly
development scores:

- expected block length: 4 weeks;
- replicates: 9,999;
- pseudorandom seed: 9,999;
- interval: two-sided percentile 95%;
- null test: one-sided mean net `<= 0`, computed from centered block-bootstrap
  samples;
- familywise correction: Holm step-down over all 12 p-values at FWER 0.05.

Development weeks 5–52 undergo CSCV PBO as a 48-by-12 matrix with 12
contiguous four-week blocks and all 924 symmetric six-block splits. The first
four fixed cold-start weeks are excluded from PBO only; they remain in every
economic total, interval, Holm test, drawdown, and walk-forward score.
Each split selects the highest in-sample mean, breaking exact ties by candidate
ID. PBO must be at most 0.20. A valid zero-trade trial remains in the
matrix with its measured zero score. A genuinely invalid trial makes PBO
`UNMEASURED`; it is never deleted or replaced with a favorable sentinel.

The four holdout weekly scores use 9,999 stationary-bootstrap replicates, seed
9,999, expected block length four weeks, and a nominal 95% interval, but only
the sealed champion is evaluated. Four observations at the frozen four-week
block length provide approximately one effective dependence block. The
interval is therefore `NOMINAL_DESCRIPTIVE_ONLY` and its decision state is
`UNMEASURED_INSUFFICIENT_EFFECTIVE_BLOCKS`; it cannot authorize a positive
holdout claim. No
holdout-driven multiplicity correction, threshold change, alternative
candidate, rerun, or second opening is permitted.

Minimum sample gates are:

- development: at least 12 completed round trips and at least 8 scored weeks
  with positive exposure;
- holdout: at least 6 completed round trips and at least 3 scored weeks with
  positive exposure.

A valid but smaller sample, including zero trades, is a measured scarcity
failure and therefore `NO_GO`, not `UNMEASURED`.

## Capacity

Capacity is a causal quote-volume proxy, not order-book or maker capacity.
Before each fill, compute for each venue:

`venueReference = min(previous complete UTC-day quote volume,
                      median of the previous seven complete UTC-day quote volumes)`.

The paired base leg capacity is the minimum venue reference multiplied by
`0.00005` (0.5 bp participation). Stress capacity uses `0.000025` (0.25 bp).
Missing or nonpositive reference volume fails the capacity gate. Every actual
rounded entry and price-changed exit leg must fit under both base and stress
participation.

At each fill, reported account-capital capacity is
`pairedLegCapacity × 1,000 / actual maximum-leg fill notional`. The candidate
reports the minimum across entry and exit. It is labeled
`VOLUME_PROXY_CAPACITY`; no public one-minute result is executable-depth proof.

## Development and holdout gates

Development may authorize the one holdout opening only if the selected
candidate satisfies all of:

- complete checksummed source custody and zero selected-event join loss;
- minimum development sample;
- primary total net per $1,000 strictly positive;
- primary 95% lower bound strictly positive;
- stress total net strictly positive;
- Holm-adjusted one-sided significance at FWER 0.05;
- CSCV PBO at most 0.20;
- primary and stress maximum drawdown below 10.00%;
- $400 leg within base and stress volume-proxy capacity on every fill;
- cost decomposition reconciliation exact.

The sealed champion is labeled historical `proxyEconomicPass` only if it
satisfies the analogous data, sample, positive point, nominal positive lower
bound, positive stress, drawdown, capacity, and reconciliation gates without
any change or rerun. Because the holdout has only one approximate effective
block, even that proxy-positive state remains terminal `UNMEASURED`, never
`PASS` or `GO`.

## Verdict law

- `UNMEASURED`: source custody, schema, chronology, join, atomic holdout, or
  accounting completeness is invalid, or the holdout has insufficient
  effective dependence blocks; no numeric null is converted to zero.
- `NO_GO`: evidence is measurable but the sample, economics, uncertainty,
  Holm, PBO, stress, drawdown, or capacity gate fails. Zero qualifying
  positives remains `NO_GO`.
- `GO`: reserved for a verified-positive owner gate with account-effective
  costs, executable maker/depth evidence, and sealed-forward validation.

Because S-1G is public historical validation and account-effective fees,
historical filters, maker fills, and depth remain unknown, this experiment
cannot issue `GO`. If every public proxy gate passes, the honest terminal state
is `UNMEASURED` for the owner verified-positive-edge question, with any
historical proxy-positive result labeled separately and without authority.
For the N3-compatible output vocabulary, the verified or credible positive
count remains JSON `null` whenever decision truth is `UNKNOWN`; a separate
proxy-positive count records `1`, `0`, or `null` without upgrading authority.

## Research basis

Binance documents the public archive, kline formats, monthly grouping,
checksums, and the possibility that archives are later replaced
([public-data README](https://github.com/binance/binance-public-data/blob/master/README.md?plain=1)).
Its USD-M documentation defines public funding history and mark-price market
data
([USD-M market data](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#get-funding-rate-history)).

The economic hypothesis follows documented work on crypto carry
([Schmeling, Schrimpf, and Todorov](https://doi.org/10.1287/mnsc.2024.05069))
and perpetual-futures funding/basis mechanics
([He, Manela, Ross, and von Wachter](https://arxiv.org/abs/2212.06888)).
The deliberately pessimistic maker treatment is consistent with research that
fill probability and post-fill returns are a coupled selection problem
([Albers et al.](https://arxiv.org/abs/2502.18625)); public candles do not solve
that problem.
