# DQ-6 official-source references

Retrieved 2026-07-30. These sources define claim boundaries; the validator is
network-free and does not fetch them at runtime.

## Fees

- [Binance Spot commission FAQ](https://developers.binance.com/en/docs/products/spot/faqs/commission_faq)
  separates standard, tax, special, and discount terms; its worked rates are
  fictional examples.
- [Binance Spot query commission rates](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/account#query-commission-rates-user_data)
  is a signed `USER_DATA` request for current account/symbol commission rates.
- [Binance Spot account trade list](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/account#account-trade-list-user_data)
  reports actual-fill commission and commission asset through signed account data.

Therefore a public schedule is a scenario input, not account-effective fee truth.
Without signed rate or actual-fill evidence, DQ-6 preserves account fee as
`UNKNOWN`.

## Funding and decomposition

- [Binance USD-M income history](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/account#get-income-history)
  separates realized PnL, funding fee, and commission income types.
- [Binance USD-M funding-rate history](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#get-funding-rate-history)
  exposes historical funding rate, funding time, and mark price.

DQ-6 therefore retains funding as a separate signed PnL term instead of silently
folding it into gross PnL or costs.

## Public capacity proxies

- [Binance Spot market-data endpoints](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market)
  expose public order-book snapshots and rolling quote-asset volume.
- [Binance Spot market-order FAQ](https://developers.binance.com/en/docs/products/spot/faqs/market_orders_faq)
  documents that market orders can partially fill and expire when liquidity is
  exhausted.

Public volume/depth can support a reproducible proxy. It does not prove an
executable fill size, so DQ-6 fixes executable capacity at `UNMEASURED`.

## USDT denomination

- [Tether legal terms](https://tether.to/en/legal/) distinguish Tether tokens from
  fiat currency and make direct redemption conditional on eligibility, procedures,
  minimums, and fees.
- [Tether FAQ](https://tether.to/en/faqs/) describes the token peg and reserves.

DQ-6 does not turn nominal USDT into USD through assumed parity. A future USD claim
would need a separate, timestamped conversion artifact and validator revision.
