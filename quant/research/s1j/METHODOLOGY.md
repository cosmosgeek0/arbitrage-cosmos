# S-1J methodology

S-1J asks one narrow question: can a weekly basket of the most persistently
positive-funding Binance USDT contracts pay for an equal-base long Spot / short
USD-M hedge after complete public proxy and stressed costs?

## Causal experiment

The frozen June 2024 archive inventory supplies only the starting symbol names;
future-complete symbols are not selected. BTCUSDT is quarantined because three
of its archive members were sampled for schema preflight before freeze. At each
Monday 00:00 UTC entry, S-1J uses information strictly before entry to form a
30-name cohort by the weakest causal Spot/USD-M quote-volume measure. It ranks
that cohort only by settled funding per lookback day. Trials combine four fixed
lookbacks with three fixed basket sizes. Positive-score names are selected;
unused slots remain cash.

Each selected name sizes equal base quantity against the greater of its Spot
and USD-M opens, bounded by $500 divided by declared slots; residual capital
stays cash and neither venue leg exceeds its unlevered budget. Entry and exit
are seven days apart. Funding settlement hours strictly inside the holding
interval are credited to the short at the same-hour mark-price open proxy only
when the archived interval series proves continuous window coverage. Entry and
exit hours, including Binance `+1ms` stamps, are excluded. Spot and perpetual
price PnL, funding, each venue's fees, and adverse execution reconcile to net
USD per $1,000 account capital.

The maker-entry case cannot establish fills and has no selection or verdict
authority; its exit is priced as taker. The decision cases are independent
immediate paired taker-at-open proxies because daily Spot data cannot identify a
later fallback price. PROXY assumes 10 bp Spot, 5 bp USD-M, and 2 bp adverse
execution per fill. STRESS assumes 10 bp on both venues and 5 bp adverse per
fill. Account-effective fees remain `UNKNOWN`.

## Sealed inference

All 51 development weeks and all 12 trials remain synchronous. A valid week
with no signal is zero; missing selected evidence invalidates the experiment.
The 12-trial family enters Holm and White max-mean control in both decision
scenarios. Joint circular block bootstraps use frozen four- and eight-week
blocks, 4,096 replicates, and seed 2026072902. CSCV-PBO uses the first 48
development weeks as 12 four-week blocks and all 924 six-block splits.

One champion is sealed before holdout. The runner-up can never replace it.
Development failure leaves holdout unopened. If development passes, a separate
atomic marker is written before the first July 2025-June 2026 outcome archive
member is opened, and only the champion is evaluated. June 2025
embargo/feature-warmup rows are already loaded during development; they are not
holdout outcomes.

## Verdict boundary

Custody or measurement failure is `UNMEASURED` with null economics. A valid
public proxy failure is `NO_GO`. Even a completely positive public proxy is
only `UNMEASURED`, because account-effective fees, maker fills, historical
filters, and executable depth/queue capacity are unknown. Public-only `GO` is
structurally unreachable. This packet grants no capital, provider, account,
order, transfer, withdrawal, host, or deployment authority.
