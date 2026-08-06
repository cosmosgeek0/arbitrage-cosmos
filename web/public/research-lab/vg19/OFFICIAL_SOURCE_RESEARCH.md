# V-G19 official-source research

Research was refreshed on 2026-07-29 before implementation. This packet uses
only unauthenticated Binance public Spot archive objects. It never calls a
private endpoint and never reads account, order, host, provider, or money data.

## Source custody

Binance's official public-data repository documents monthly and daily Spot
kline archives, the twelve positional kline fields, SHA-256 sidecars, and the
fact that archive objects can be replaced when corrections are published:

- <https://github.com/binance/binance-public-data/blob/master/README.md?plain=1>
- <https://data.binance.vision/?prefix=data%2Fspot%2Fmonthly%2Fklines%2F>

For Spot archives dated 2025-01-01 onward, timestamps are microseconds. V-G19
therefore rejects millisecond-looking timestamps, incomplete calendar grids,
duplicate rows, non-hourly spacing, unsafe ZIP members, unexpected fields, and
checksum disagreement. It freezes both the ZIP and raw `.CHECKSUM` bytes
because a URL is not immutable evidence.

The frozen source form is:

```text
https://data.binance.vision/data/spot/monthly/klines/{SYMBOL}/1h/{SYMBOL}-1h-{YYYY}-{MM}.zip
https://data.binance.vision/data/spot/monthly/klines/{SYMBOL}/1h/{SYMBOL}-1h-{YYYY}-{MM}.zip.CHECKSUM
```

All 360 expected archive and sidecar objects for the ten symbols and eighteen
months returned HTTP 200 during pre-code feasibility checks. Existence was not
treated as row-level validity; that is checked only after the protocol freeze
and one-run marker.

The official Spot REST specification confirms that klines are public market
data and that `exchangeInfo` describes current exchange state:

- <https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md?plain=1>
- <https://github.com/binance/binance-spot-api-docs/blob/master/filters.md>
- <https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md>

Current `exchangeInfo` cannot prove historical filters. V-G19 does not use it
to backfill historical eligibility.

## Fees and execution boundary

The public Binance fee page showed the Regular User Spot maker/taker rate as
0.100%/0.100% on 2026-07-29:

- <https://www.binance.com/en/fee/trading>

Exact account and order commission is authenticated `USER_DATA`, as documented
by the official commission FAQ:

- <https://github.com/binance/binance-spot-api-docs/blob/master/faqs/commission_faq.md?plain=1>

V-G19 therefore treats 10 basis points per fill side as a current public
sensitivity, adds a frozen adverse-price sensitivity, and leaves
account-effective fee, historical spread/impact, order admissibility,
fillability, and executable capacity `UNKNOWN`. Quote volume supplies only a
screening participation proxy.

## Method research

Primary research motivates, but does not predetermine, the verdict:

- Intraday seasonality can inflate measured volume dependence, so the signal
  uses only prior matching UTC hour-of-week observations:
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC5094667/>
- The PBO diagnostic follows the CSCV framing and remains incapable of
  rescuing a failed causal, cost, sample, or holdout gate:
  <https://doi.org/10.21314/JCF.2016.322>
- White's data-snooping warning motivates freezing every diagnostic trial:
  <https://doi.org/10.1111/1468-0262.00152>

## Scope conclusion

The official archives can measure checksum-bound persistence of
seasonality-adjusted quote-volume surprise and a bar-price cohort-or-cash
sensitivity. They cannot establish account-real profitability or capital
capacity. No result in this packet authorizes deployment, execution, orders,
private reads, providers, hosts, UI changes, or money.
