# V-G31 official-source research

Checked on 2026-07-29 before V-G31 implementation and before any V-G31 archive
member was opened.

## Current official Binance sources

- Binance's official public-data repository documents daily and monthly Spot
  kline archives, companion SHA-256 `.CHECKSUM` files, the twelve kline fields
  including quote-asset volume, later archive replacements, publication cadence,
  and microsecond Spot timestamps from 2025-01-01:
  <https://github.com/binance/binance-public-data/blob/master/README.md>
- Binance's market-data-only documentation says `exchangeInfo` and `klines` are
  public and need no API key on `data-api.binance.vision`:
  <https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md>
- The Spot REST contract defines UTC kline boundaries, bars keyed by open time,
  and quote-asset volume in kline field eight:
  <https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md>
- Current Spot filters describe current quantity and notional constraints but
  do not provide historical filters:
  <https://github.com/binance/binance-spot-api-docs/blob/master/filters.md>
- Binance's commission FAQ makes actual standard, special, tax, discount, and
  symbol-promotion commission account/order specific:
  <https://github.com/binance/binance-spot-api-docs/blob/master/faqs/commission_faq.md>
- The public trading-fee page was checked only for the retrieval-dated regular
  user 0.1000% maker/taker sensitivity scenario. It is mutable and is not
  account-effective evidence:
  <https://www.binance.com/en/fee/trading>

`official_sources.v1.json` pins the two official Git repositories to the exact
revisions observed before code and binds SHA-256 for each relied-on document.
The mutable fee page is retrieval-dated rather than represented as immutable.

## Frozen interpretation

V-G31 reads the checksum-bound shared Spot archive corpus in read-only mode:

`/private/tmp/cosmos-s1f-weekly-momentum-cash-v1`

It never uses current `exchangeInfo` to rewrite historical membership. The fixed
cohort is preregistered explicitly, and every member must supply every required
causal state, entry, mark, and exit observation. A missing member is not dropped
and cannot be replaced. That is the full-cohort-or-cash boundary.

For a Monday entry day `E`, the signal can read completed daily bars only through
`E-2` (Saturday). Sunday and all Monday prices are absent from the signal. Daily
quote volume is classified against that same symbol's immediately prior 84
strictly consecutive completed days. The recent transition matrix and older
matrix use disjoint transition-to-day ranges. Price is read only after a signal
has been fixed, for forward return measurement.

Archive presence reduces current-survivor selection, but public archives do not
prove historical `TRADING` status, permissions, filters, fractional execution,
spread, depth, latency, impact, queue position, or fills. Quote volume supports
only a lagged participation proxy. Account-effective fees remain `UNKNOWN`;
historical executable capacity remains `UNMEASURED`.

## Statistical boundary

The twelve frozen trials are evaluated synchronously. Circular block resampling
preserves short-run dependence; Holm controls the trial family; White's Reality
Check tests the best observed trial against the whole frozen family. The
development CSCV family-rank calculation is a non-gating heuristic over monthly
absolute net USDT. It does not reproduce the implemented champion rule, so PBO
of that selection rule remains `UNMEASURED`; the heuristic cannot select or
rescue a trial.

- Circular block bootstrap:
  <https://doi.org/10.1080/01621459.1994.10476870>
- Holm multiplicity control:
  <https://doi.org/10.2307/4615733>
- White Reality Check:
  <https://doi.org/10.1111/1468-0262.00152>
- CSCV/PBO:
  <https://doi.org/10.21314/JCF.2016.322>
