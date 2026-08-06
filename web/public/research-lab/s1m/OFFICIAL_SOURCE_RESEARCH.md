# S-1M official-source research

Status: `REVIEWED_2026-07-29_BEFORE_IMPLEMENTATION`

Only official Binance sources define the custody and exchange semantics used by
this experiment.

## Public archives

The official
[Binance public-data repository](https://github.com/binance/binance-public-data/blob/master/README.md?plain=1)
documents daily/monthly public archives, the USD-M kline tuple, and sibling
`.CHECKSUM` files. It also warns that archived files can later be replaced.

S-1M therefore records the publisher key, publisher checksum bytes, verified ZIP
SHA-256, byte count, member name, and member schema for every input. A mutable
URL by itself is not evidence.

The frozen June 2025 rank retained `FUNUSDT`. During metadata-only preparation,
the exact official May and June 2026 `fundingRate/FUNUSDT` monthly object URLs
returned HTTP 404 on 2026-07-29, while April was published. S-1M treats that
trailing funding-archive absence as an inactive contract lifecycle: the symbol
is never replaced, no signal can exist without a settled-funding archive, and a
later funding-archive reappearance would fail closed. HTTP status is not signed
publisher evidence, so the absence remains a disclosed custody classification
rather than an economic observation.

The read-only source families are:

- `data/futures/um/monthly/fundingRate`
- `data/futures/um/monthly/klines/<symbol>/1h`
- `data/futures/um/monthly/markPriceKlines/<symbol>/1h`

Contract klines provide OHLC and quote volume. Binance documents mark-price
kline non-OHLC fields as ignored, so S-1M never treats mark-price volume as
liquidity.

## Current USD-M API semantics checked on 2026-07-29

The current
[USD-M market-data reference](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data)
documents:

- `GET /fapi/v1/fundingRate`: inclusive time bounds, ascending history,
  explicit `fundingTime`, `fundingRate`, associated `markPrice`, and
  `rateType`;
- `GET /fapi/v1/fundingInfo`: current adjusted caps, floors, and funding
  intervals, not historical configuration;
- `GET /fapi/v1/klines`: contract-price OHLCV and quote volume;
- `GET /fapi/v1/markPriceKlines`: mark-price OHLC; and
- `GET /fapi/v1/exchangeInfo`: current symbol/filter truth.

The [USD-M change log](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/Change-Log)
added `rateType` to funding history on 2026-07-23: `Regular` is normal funding
and `Special` is additional stock-dividend funding. The historical monthly
archive used here exposes only
`calc_time,funding_interval_hours,last_funding_rate`; it omits `markPrice` and
`rateType`.

S-1M freezes a crypto-only, pre-outcome universe and excludes stable/fiat and
stock-perpetual bases. That reduces but does not cryptographically prove the
absence of a future special-rate classification. The final packet reports
`fundingRateTypeState=ARCHIVE_FIELD_UNAVAILABLE` and cannot use the archive as
account truth.

The current
[general information](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/general-info)
and
[common definitions](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/common-definition)
were also checked for timestamp, rate-limit, contract, status, and filter
semantics. S-1M performs no API call during evaluation.

## Funding accounting

Binance's
[funding-rates explanation](https://www.binance.com/en/academy/articles/what-are-funding-rates-in-crypto-markets)
states that positive funding is paid by longs to shorts and negative funding is
paid by shorts to longs. It also explains that intervals can vary.

Consequences:

- Use each exact archived timestamp and `funding_interval_hours`.
- Normalize signal rates to an eight-hour equivalent before differencing.
- Never synthesize an eight-hour schedule.
- Funding cash flow is
  `-position_sign * quantity * hourly_mark_proxy * settled_rate`.
- Forecast funding is never booked.

## Fees, maker status, and capacity

The official
[User Commission Rate endpoint](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/account)
is signed `USER_DATA`. Its examples include maker `0.0002` and taker `0.0004`,
but examples do not prove the owner's tier, discounts, promotions, or
symbol-effective rate.

S-1M freezes those values only as public sensitivities and reports
`ACCOUNT_EFFECTIVE_FEES=UNKNOWN`.

An hourly low/high can support a strict trade-through proxy but cannot establish
post-only acceptance, queue position, partial fill, or adverse selection. Quote
volume can support a declared small-participation capacity proxy but cannot
prove depth, impact, margin, or executable capacity. All of those limits remain
explicit in the terminal result.
