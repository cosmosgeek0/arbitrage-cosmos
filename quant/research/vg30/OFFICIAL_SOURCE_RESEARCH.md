# V-G30 official Binance source research

Research was checked on 2026-07-29 before implementation. Only official
Binance sources are used for source and economic-boundary claims.

## Public kline and archive facts

- Binance documents Spot `GET /api/v3/klines` as public market data, identifies
  a kline by open time, uses UTC as the default time zone, and defines the
  twelve returned fields. Quote-asset volume is the eighth field (zero-based
  index 7):
  <https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market>
- Binance's market-data-only service exposes public endpoints without user
  data. V-G30 makes no authenticated, signed, account, order, wallet, or private
  request:
  <https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md>
- Binance's public-data repository documents monthly Spot kline ZIPs, one
  colocated SHA-256 `.CHECKSUM` per ZIP, and the same twelve-field kline schema.
  It states that Spot archive timestamps from 2025-01-01 use microseconds and
  that archived files may later be replaced after corrections:
  <https://github.com/binance/binance-public-data/blob/master/README.md?plain=1>
- The official archive host is public and is the frozen object-key authority
  for this packet:
  <https://data.binance.vision/>

V-G30 therefore freezes the exact compressed ZIP, checksum sidecar, local pair
receipt, acquisition-manifest row, and present/absent inventory before opening
any ZIP member. It enforces milliseconds before 2025 and microseconds from
2025 onward, and rejects non-UTC daily boundaries, wrong archive months,
malformed rows, conflicting duplicates, and non-adjacent repeated keys.

## Fee, filters, and execution boundary

- Binance's public trading-fee schedule showed regular-user Spot maker and
  taker fees of 0.100% on 2026-07-29. V-G30 therefore freezes a conservative
  public proxy of 10 basis points per taker fill and assumes no BNB discount:
  <https://www.binance.com/en/fee/trading>
- Binance's official commission FAQ explains that standard, special, tax, and
  discount components can vary and that account-specific commission truth is
  authenticated. V-G30 keeps account-effective fees `UNKNOWN`:
  <https://github.com/binance/binance-spot-api-docs/blob/master/faqs/commission_faq.md>
- Binance's official Spot filter documentation defines price, lot-size,
  market-lot-size, notional, and related current filters:
  <https://developers.binance.com/en/docs/products/spot/filters>

Monthly klines do not provide historical bid/ask spread, depth, queue, market
impact, latency, fill probability, account commission, or point-in-time symbol
filters. Quote volume therefore supports only a public participation proxy.
Executable capacity, historical fractional executability, and actual fill
economics remain `UNMEASURED` regardless of the public-scenario verdict.

Archive discovery is not a historical exchange-info snapshot. Requiring
causally complete bars and lagged liquidity reduces but does not eliminate
symbol-lifecycle and archive-retention bias. V-G30 never backfills current
exchange status into historical membership.
