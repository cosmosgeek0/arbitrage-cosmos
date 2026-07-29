# V-G20 official-source research

Accessed 2026-07-29 before implementation. This packet uses only public Binance
Spot evidence.

## Admitted sources

- Binance public archive contract and kline schema:
  <https://github.com/binance/binance-public-data/blob/master/README.md>
- Current public Spot REST market-data contract:
  <https://developers.binance.com/en/docs/products/spot/rest-api>
- Current public market-data-only host:
  <https://developers.binance.com/en/docs/products/spot/faqs/market_data_only>
- Current Spot symbol filters:
  <https://developers.binance.com/en/docs/products/spot/filters>
- Current public trading-fee schedule:
  <https://www.binance.com/en/fee/trading>

## Frozen interpretation

Binance documents monthly and daily public Spot archives, twelve kline fields,
quote-asset volume, and one SHA-256 sidecar per ZIP. It also warns that archive
objects can be corrected later. V-G20 therefore binds the acquired ZIP bytes,
sidecar bytes, upstream acquisition receipt, and local SHA-256 values.

Spot archive timestamps from 2025-01-01 onward are microseconds. All admitted
V-G20 bars are 2025+ and must be exact microsecond UTC daily bars. Quote volume,
not base volume, is the only cross-symbol volume input.

`exchangeInfo` describes current symbol status and filters. It does not reconstruct
historical status, market capitalization, or a point-in-time tradable universe.
V-G20 therefore never calls it and labels the frozen pre-development cohort a
Binance-liquidity proxy, not a market-cap classification.

The public regular-user taker schedule is a sensitivity input only. Exact account
commission, discounts, taxes, promotions, historical spreads, order-book depth,
queue position, impact, and fills are unavailable in this public archive. Account
fees remain `UNKNOWN`; executable capacity remains `UNMEASURED`.

## Claim boundary

A BTC/ETH volume event that occurs before a future alt-cohort return supports at
most a lagged predictive association. Common market news and venue-wide flows are
unobserved confounders. This packet never claims an identified structural causal
effect and never grants capital authority.
