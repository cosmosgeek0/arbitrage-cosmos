# V-G18 official-source research

Research checked on 2026-07-29 before implementation.

## Frozen source facts

- Binance Spot `GET /api/v3/klines` defines field 7 as quote asset volume and
  field 8 as number of trades. V-G18 therefore names their ratio
  **mean quote notional per Binance-reported trade**. It is not order size,
  unique-user size, fill size, aggressor size, spread, impact, or account
  execution quality.
- `data-api.binance.vision` provides public market-data-only endpoints without
  authentication. V-G18 uses no API key, account source, or private endpoint.
- Binance's official public-data repository states that Spot kline archive rows
  use the REST kline schema, supplies a sibling `.CHECKSUM` for each ZIP, and
  warns that archive files can later be replaced when issues are found.
- Spot archive timestamps from 2025-01-01 onward are microseconds. V-G18's
  frozen source window starts on 2025-01-01 and rejects any other timestamp
  unit.

## Official references

- https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market#kline-candlestick-data
- https://developers.binance.com/en/docs/products/spot/faqs/market_data_only
- https://github.com/binance/binance-public-data/blob/master/README.md
- https://github.com/binance/binance-spot-api-docs/blob/master/faqs/commission_faq.md

## Economic boundary

The public archive does not publish this account's effective fee, spread,
depth, filters at historical decision time, market impact, or executable
capacity. Public fee/adverse-price scenarios are sensitivity inputs only.
Account-effective fees and executable capacity remain `UNKNOWN` and
`UNMEASURED`.
