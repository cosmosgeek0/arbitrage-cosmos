# S-1V official-source research

Research date: 2026-07-29; current official catalog and archive locations
rechecked 2026-07-29. Sources were limited to current official Binance
documentation, Binance Data Collection, and Binance's official public-data
repository. No third-party market data, private endpoint, credential, or
account value was used.

## Source findings frozen before implementation

| Item | Official finding | S-1V binding |
| --- | --- | --- |
| Public archives | Binance Data Collection publishes public daily and monthly market-data files. | Only monthly USD-M objects below `data/futures/um/monthly` are allowed. |
| Integrity | Binance's public-data README states that each ZIP has a sibling `.CHECKSUM` file and documents SHA-256 verification. It also warns that archived files can later be updated. | Every ZIP and sidecar is byte-bound before member opening; a later remote revision cannot silently replace frozen bytes. |
| USD-M klines | Binance documents `/fapi/v1/klines`; a kline is keyed by open time and includes OHLC, volume, and quote-asset volume. | Contract `1h` archives supply the June liquidity metric and prior-complete-day public capacity proxy, not returns. |
| Mark-price klines | Binance documents `/fapi/v1/markPriceKlines`; mark-price klines are keyed by open time. | `1h` mark-price opens supply entry and exit valuation. They are not executable fill prices. |
| Funding history | Binance documents public `/fapi/v1/fundingRate`, ascending timestamp queries, and funding-rate/time fields. | Monthly `fundingRate` archive rows supply settled rate observations; only source `calc_time < decision hour` is signal-eligible. |
| Funding interval | Binance's current public `/fapi/v1/fundingInfo` describes symbols with adjusted funding intervals and exposes `fundingIntervalHours`. | Current state is never applied historically. S-1V uses only the interval stored with each historical archive row. |
| Exchange information | Binance labels `/fapi/v1/exchangeInfo` as current trading rules and symbol information. | Current exchange information is not historical membership evidence. June archive presence and validation define the screen. |
| Commission | Binance's `/fapi/v1/commissionRate` is signed `USER_DATA`; its example shows a taker commission rate of `0.0004` (4 bp). | S-1V makes no signed call. Four bp is only the base public research proxy; account-effective commission remains `UNKNOWN`. |

Official references:

- [Binance Data Collection](https://data.binance.vision/)
- [Binance official public-data README](https://github.com/binance/binance-public-data/)
- [USD-M funding-rate history](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#get-funding-rate-history)
- [USD-M exchange information](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#exchange-information)
- [USD-M kline data](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#klinecandlestick-data)
- [USD-M mark-price kline data](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#mark-price-klinecandlestick-data)
- [USD-M funding-rate information](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#get-funding-rate-info)
- [USD-M user commission rate](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/account#user-commission-rate)

## Packet acquisition provenance

The experiment engine is network-free. Its sole acquisition state is
`LOCAL_OFFICIAL_ARCHIVE_REUSE_CHECKSUM_VERIFIED`: clone or copy the pre-existing
official Binance public archive cache into the packet-owned `/private/tmp`
source root, hash each ZIP and adjacent official `.CHECKSUM`, and verify the ZIP
against that sidecar.

S-1V observes no HTTP acquisition. Each manifest `source_url` remains the
official Binance origin path, while `http_status` is `null`. Neither field
claims a current HTTP 200 response or equality with current remote bytes.
Binance may have revised the remote archive; the locally frozen,
checksum-verified cached bytes are the evaluated evidence. There is no optional
fresh-download path.

## Schema-only official probe disclosure

Before coding, the task root fetched the official remote BTCUSDT
`fundingRate` archive for `2026-06` and read only its CSV header:

`calc_time,funding_interval_hours,last_funding_rate`

No data or outcome row was read. This probe occurred outside the selected
S-1V raw source-root lifecycle. Therefore S-1V does not claim that no remote
archive member was ever opened globally. The narrower custody claim is:
selected-source-root holdout outcome rows remain unopened unless every frozen
development gate passes.

## Causal and executable limits

- `calc_time` is a settlement timestamp, not a historical publication
  timestamp. Advancing eligibility to the next UTC hour prevents same-timestamp
  use but does not prove when a remote observer could first retrieve the row.
  Historical publication latency is `UNKNOWN`.
- The official catalog does not turn a present monthly file into proof of
  complete historical coverage. S-1V therefore requires every funding CSV to
  be nonempty, validates both month endpoints, stitches all months per symbol,
  and rejects stale decision snapshots as invalid evidence rather than cash.
- Mark-price opens are valuation proxies. They do not establish bid/ask spread,
  order-book depth, queue position, latency, fill probability, impact, or a
  realizable execution price.
- The funding archive header does not supply an exact settlement mark. S-1V
  uses the corresponding hourly mark-price open to proxy funding notional.
  That value is not an exact settlement mark or account debit.
- Contract quote volume supports only a coarse participation proxy. Executable
  capacity is `UNKNOWN`.
- Current exchange rules do not reconstruct historical tick, quantity,
  notional, leverage, or margin constraints. Those limits remain `UNKNOWN`.
- The commission example is not this account's rate. Discounts, tier, rebates,
  and account-effective fees remain `UNKNOWN`.

These limits are capital blockers. Even an all-gates public-proxy pass remains
`PUBLIC_PROXY_PASS_CAPITAL_NO_GO`; it is not a verified positive executable
edge and carries no funding or trading authority.
