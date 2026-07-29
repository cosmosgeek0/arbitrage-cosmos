# S-1K official-source research

Retrieved 2026-07-29 UTC. Only public Binance sources were used.

| subject | official source | frozen implication |
|---|---|---|
| UM/CM integration | https://developers.binance.com/en/docs/products/derivatives-trading-coin-futures/Important-CM-UM-Integration-Notice | UM and CM share market-data infrastructure and a 2,400 request-weight/minute/IP pool after the June 2026 migration. Product identity remains explicit in every receipt. |
| USD-M market schema | https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data | USD-M perpetual status, filters, funding history, mark data, and funding-info fields are recorded from public endpoints. Precision fields are not substituted for tick or lot filters. |
| COIN-M market schema | https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-coin-m-futures/api/rest-api/market-data | COIN-M contract size, USD quote, coin margin asset, filters, funding history, and mark data are recorded separately. |
| funding mechanics | https://www.binance.com/en/support/faq/detail/360033525031 | Positive funding transfers from longs to shorts. Actual events are summed; an eight-hour interval is never assumed. |
| public archives | https://github.com/binance/binance-public-data/blob/master/README.md?plain=1 | Every consumed ZIP and adjacent checksum is byte- and digest-bound. Binance may revise archives later, so retrieval receipts are part of custody. |
| public fee examples | https://www.binance.com/en/support/faq/detail/360033544231 | The 2 bp maker and 5 bp taker examples are public hypothetical proxies. Account-effective fees and discounts remain `UNKNOWN`. |
| USD-M current metadata | https://fapi.binance.com/fapi/v1/exchangeInfo | Current symbol/filter data is a schema receipt, not point-in-time historical membership evidence. |
| COIN-M current metadata | https://dapi.binance.com/dapi/v1/exchangeInfo | Current symbol/filter and contract-size data is a schema receipt, not point-in-time historical evidence. |

## Evidence boundary

The official recent archives contain funding, trade-price klines, mark/index data,
and volume. They do not provide symmetric recent historical top-of-book coverage
for the matched COIN-M and USD-M legs. Consequently:

- trade and mark bars are reference-price proxies, not executable fills;
- maker queue position and fillability are `UNMEASURED`;
- the capacity output is a one-basis-point volume-participation proxy;
- account fee, collateral, margin, liquidation, conversion, and leverage truth
  remains `UNKNOWN`;
- no result grants capital, order, provider, host, or product authority.

The experiment may measure a fully frozen public proxy. The missing executable
book evidence is an unconditional blocker for `GO`.
