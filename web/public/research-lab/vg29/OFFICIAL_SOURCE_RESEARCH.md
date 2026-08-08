# V-G29 official Binance source research

Checked on `2026-07-29` before V-G29 implementation or archive
decompression.

| item | expected | found | status |
|---|---|---|---|
| public REST | public market-data host | `data-api.binance.vision`; unsigned market data | VERIFIED |
| Spot klines | exact schema and closure | open/high/low/close, quote volume at field 7, close time at field 6 | VERIFIED |
| historical archive | official bulk source | daily/monthly ZIP files with adjacent SHA-256 sidecars | VERIFIED |
| timestamp units | deterministic parsing | Spot archive changes from milliseconds to microseconds on 2025-01-01 | VERIFIED |
| current universe rules | current status and filters | `exchangeInfo`; no historical status/filter archive is claimed | CURRENT_ONLY |
| public fee proxy | regular-user scenario | current maker/taker display is 10 bp per fill; account rate differs by context | PROXY_ONLY |
| executable capacity | historical depth/fills | quote volume is traded notional, not available depth or fill capacity | UNMEASURED |

Official references:

- <https://developers.binance.com/en/docs/products/spot/rest-api>
- <https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market>
- <https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/general>
- <https://developers.binance.com/en/docs/products/spot/filters>
- <https://github.com/binance/binance-public-data/blob/master/README.md?plain=1>
- <https://data.binance.vision/>
- <https://www.binance.com/en/fee/trading>

V-G29 freezes every downloaded ZIP and sidecar digest. It rejects a wrong
column count, wrong filename, wrong timestamp unit, incomplete daily grid,
duplicate day, non-positive OHLC/quote volume, or a sidecar mismatch. The
current `exchangeInfo` snapshot cannot prove historical membership or filters,
so the universe is a disclosed survivor cohort and historical filter
executability remains unmeasured.
