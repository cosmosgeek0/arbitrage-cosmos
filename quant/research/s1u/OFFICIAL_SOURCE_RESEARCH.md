# S-1U official Binance source research

Frozen before implementation on 2026-07-29. Only official Binance
documentation and Binance's official public-data repository/catalog were used.

## Selected sources

1. USD-M Futures market-data catalog
   <https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data>
2. Binance public-data repository
   <https://github.com/binance/binance-public-data>
3. Binance Futures funding-fee FAQ
   <https://www.binance.com/en/support/faq/detail/360033525031>
4. Binance Futures trading-fee FAQ
   <https://www.binance.com/en/support/faq/detail/360033544231>
5. USD-M account catalog, including User Commission Rate (signed private
   endpoint, disclosure only)
   <https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/account#user-commission-rate>

## Semantics used

- The official USD-M kline schema exposes open time, OHLC, close time, quote
  asset volume, and taker-buy quote asset volume. S-1U defines the bounded
  signed quote imbalance as
  `(2 * taker_buy_quote_volume - quote_volume) / quote_volume`.
- The funding-history schema exposes the observed `fundingTime`; S-1U uses the
  corresponding official archive `calc_time` only as an event timestamp. It
  never turns a future nominal eight-hour schedule into data.
- Funding intervals can be adjusted. The current funding-info endpoint is not a
  historical interval ledger, so S-1U derives no historical schedule from it.
- The official public-data repository publishes monthly USD-M archive objects
  and sibling `.CHECKSUM` files. S-1U freezes URLs, publisher checksums, actual
  SHA-256 values, byte counts, and ZIP member names.
- The public archive funding rows do not carry the REST response's `rateType`
  field. S-1U therefore calls them "published funding settlements", does not
  assert a historical rate type, and does not use funding values.
- Binance states that funding applies only to positions open at the funding
  time and warns that timing can deviate around the event. S-1U opens only
  after the observed event and books no event funding.
- The public fee FAQ provides examples, not the user's effective commission.
  The signed commission endpoint confirms that account-effective fee truth is
  private. Public fee numbers in S-1U are conservative research proxies only.

## Rejected sources and substitutions

- `/futures/data/takerlongshortRatio` is rejected: the official endpoint exposes
  only the latest 30 days, not the frozen twelve-month study.
- Current `exchangeInfo` is rejected as a historical-membership or historical
  filter ledger.
- Spot archives, third-party vendors, aggregators, scraped charts, private
  endpoints, account state, and provider data are forbidden.
- No missing contract is replaced and no partial cohort is renormalized.

## Honest executable boundary

Archived quote volume cannot reveal the account's commission, contemporaneous
spread, depth, queue, fill probability, impact, latency, liquidation risk,
margin constraints, or executable capacity. Those quantities remain
`UNKNOWN`. The study can return a public-proxy research verdict; it cannot
authorize capital.
