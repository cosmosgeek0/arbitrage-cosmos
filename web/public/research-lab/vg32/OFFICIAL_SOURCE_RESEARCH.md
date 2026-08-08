# V-G32 official-source research

Checked on 2026-07-29 before V-G32 implementation and before any V-G32
archive member was opened.

## Current official Binance sources

- Binance's official public-data repository documents daily and monthly Spot
  kline archives, companion SHA-256 `.CHECKSUM` files, all twelve kline fields,
  later archive replacements, publication cadence, and microsecond Spot
  timestamps from 2025-01-01:
  <https://github.com/binance/binance-public-data/blob/master/README.md>
- Binance's market-data-only documentation identifies `exchangeInfo` and
  `klines` as public, keyless market-data methods:
  <https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md>
- The current Spot REST contract says klines are keyed by open time, defines
  UTC interval handling, and identifies quote-asset volume as field eight:
  <https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md>
- Current Spot filters describe current quantity and notional rules but do not
  provide historical filter truth:
  <https://github.com/binance/binance-spot-api-docs/blob/master/filters.md>
- Binance's commission FAQ makes standard, special, tax, discount, and
  symbol-promotion commission account/order specific:
  <https://github.com/binance/binance-spot-api-docs/blob/master/faqs/commission_faq.md>

`official_sources.v1.json` pins the two official repositories to the exact
revisions observed before code and binds the exact bytes of every relied-on
document. The current public fee page is intentionally not treated as immutable
account truth. The frozen 10 bp and 20 bp fees are public sensitivity inputs;
account-effective commission remains `UNKNOWN`.

## Frozen interpretation

V-G32 reads only the checksum-bound shared Spot archive corpus at
`/private/tmp/cosmos-s1f-weekly-momentum-cash-v1`. It never uses current
`exchangeInfo` to rewrite historical membership. The archive-discovered USDT
universe already carries the shared stable/fiat and paired-leveraged exclusions.
V-G32 additionally enforces an explicit uppercase-ASCII symbol grammar.

The signal reads only symbol identity, UTC open time, and quote-asset volume.
Open price is accessed only for the fixed BTCUSDT/ETHUSDT outcome sleeve after
the delayed target is fixed. High, low, close, base volume, trade count, taker
fields, and the ignored field never enter the signal.

Archive presence does not prove historical `TRADING` status, permissions,
filters, spread, depth, latency, impact, queue position, or fills. Daily quote
volume supports only a public-print participation proxy. Historical executable
capacity remains `UNMEASURED`.

## Methodological sources

- Holm, *A Simple Sequentially Rejective Multiple Test Procedure*:
  <https://doi.org/10.2307/4615733>
- White, *A Reality Check for Data Snooping*:
  <https://doi.org/10.1111/1468-0262.00152>
- Bailey et al., CSCV and probability of backtest overfitting:
  <https://doi.org/10.21314/JCF.2016.322>
- Politis and Romano, dependence-aware resampling:
  <https://doi.org/10.1080/01621459.1994.10476870>

These methods constrain inference; none establishes Binance Spot profitability
in advance.
