# V-G4 official-source research

Observed 2026-07-29 before implementation.

## Public market data

- Binance's official archive documents daily and monthly Spot klines, trades, and
  aggregate trades. Each ZIP has a sibling SHA-256 `.CHECKSUM`; Binance also warns
  that archived files can later be corrected. V-G4 therefore binds the exact local
  ZIP bytes, checksum bytes, official checksum values, object metadata, and source
  URLs before any archive is decompressed:
  <https://github.com/binance/binance-public-data/blob/master/README.md>
- From 2025-01-01 onward, Spot archive timestamps use microseconds. The documented
  kline fields include OHLC, base volume, quote-asset volume, trade count, and
  taker-buy volume. V-G4 uses only completed `1d` OHLC and quote volume.
- Binance's public market-data-only host is `https://data-api.binance.vision`.
  Public endpoints need no account credentials:
  <https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md>
- Current `exchangeInfo` and current filter documentation are not historical
  point-in-time filters. V-G4 does not retrofit today's `PRICE_FILTER`, `LOT_SIZE`,
  `MARKET_LOT_SIZE`, or notional rules onto past bars:
  <https://developers.binance.com/en/docs/products/spot/filters>

## Public fees and cost boundary

- The public regular-user Spot schedule displayed 0.100% maker and 0.100% taker on
  2026-07-29. V-G4 charges the 10 bp taker rate on both entry and exit and assumes no
  BNB, VIP, pair-promotion, or other discount:
  <https://www.binance.com/en/fee/trading>
- Binance's commission FAQ states that standard, tax, special, account, symbol, and
  discount components can affect the actual charge. Exact account/symbol rates come
  from a signed account endpoint, which this public-only study must not access:
  <https://developers.binance.com/en/docs/products/spot/faqs/commission_faq>
- Consequently, 10 bp per leg is a real, cited public regular-user scenario, not
  account-effective truth. Account-effective fees remain `UNKNOWN`.
- Daily OHLCV contains no synchronized historical spread or depth. V-G4 separately
  charges a frozen 10 bp adverse-price cost per leg and a 25 bp-per-leg stress, and
  labels both as models. Its 1 bp of prior daily quote volume is only a public
  participation proxy. Executable book capacity remains `UNMEASURED`.

## Statistical sources

- The design uses chronological rolling-origin evaluation; every validation
  observation follows its information set:
  <https://otexts.com/fpp3/tscv.html>
- Circular block resampling retains short-run serial dependence. Holm step-down
  controls the declared family of twelve trials. CSCV/PBO is development-only and
  cannot replace chronological validation or rescue a failed economic gate:
  <https://doi.org/10.1080/01621459.1994.10476870>,
  <https://www.jstor.org/stable/4615733>,
  <https://doi.org/10.21314/JCF.2016.322>
- The chronological holdout is opened once only after a development champion and
  its exact receipts are sealed. It is never used for variant selection.
