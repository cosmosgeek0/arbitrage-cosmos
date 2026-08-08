# S-1Z official-source research

Research was refreshed on 2026-07-30 before implementation.

## Official market data

- Binance USD-M REST general information documents `https://fapi.binance.com`,
  ascending responses, and millisecond timestamps:
  <https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/general-info>
- `GET /fapi/v1/exchangeInfo` is a current contract/status snapshot, not a historical
  membership record:
  <https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Exchange-Information>
- USD-M contract klines expose open time, OHLC, quote volume, and a maximum request
  limit of 1,500:
  <https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Kline-Candlestick-Data>
- Mark-price klines expose the hourly mark-price OHLC used here only as a public
  funding-notional proxy:
  <https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Mark-Price-Kline-Candlestick-Data>
- Funding history exposes actual recorded settlement timestamps and rates. Binance
  warns by interface design that interval adjustments exist; the evaluator never
  synthesizes an eight-hour clock:
  <https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-History>
- Current funding adjustments from `fundingInfo` are current state, not historical
  schedule proof:
  <https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-Info>

## Official archives and custody

Binance's public-data repository states that daily/monthly archives are published at
`data.binance.vision`, monthly data normally arrive on the first Monday, every ZIP has
a sibling `.CHECKSUM`, and archives can later be replaced:
<https://github.com/binance/binance-public-data/blob/master/README.md?plain=1>.

S-1Z freezes URL, retrieval metadata, publisher checksum, and locally observed SHA-256
for every selected monthly object. It uses only:

```text
data/futures/um/monthly/klines/{SYMBOL}/1h/{SYMBOL}-1h-YYYY-MM.zip
data/futures/um/monthly/markPriceKlines/{SYMBOL}/1h/{SYMBOL}-1h-YYYY-MM.zip
data/futures/um/monthly/fundingRate/{SYMBOL}/{SYMBOL}-fundingRate-YYYY-MM.zip
```

The exact scored window is `[2025-06-22T00:00:00Z,
2026-06-22T00:00:00Z)`. This ends before the independently observed
`markPriceKlines` gap on 2026-06-29. January through 21 June 2025 is warm-up only.

## Public cost evidence and limits

Binance's fee FAQ, updated 2026-05-01, gives a Regular User example of 2 bp maker and
5 bp taker fees, while stating that fees vary by VIP level and can change:
<https://www.binance.com/en/support/faq/detail/360033544231>.

S-1Z assumes no maker, VIP, BNB, rebate, promotion, or special-commission benefit.
The three frozen per-fill public proxies are:

| Scenario | Fee | Adverse execution | Round trip |
| --- | ---: | ---: | ---: |
| Base | 5 bp | 5 bp | 20 bp |
| Stress | 10 bp | 10 bp | 40 bp |
| Severe | 15 bp | 25 bp | 80 bp |

These are conservative public proxies, not account-effective fee truth or a
worst-case execution ceiling. Exact funding cash is also not established: archived
settled rates are actual, but the hourly mark open is only a public funding-notional
proxy. Account profitability and executable capacity therefore remain `UNMEASURED`
under every outcome.
