# S-1O official-source research freeze

Assessed: 2026-07-29 UTC

This packet is public-data research only. It never calls a signed endpoint, reads an API key,
touches an account, or performs an order, transfer, withdrawal, host, deployment, or UI action.
The URLs below are the frozen official-source set used to define the acquisition and evidence
contract. Before executable code, a checksum-verified June 2025 warmup sample was opened only
to establish archive headers, timestamp shapes, and field domains. No analysis-period outcome
was computed, and no holdout archive member was inspected while this source contract was
written.

## Frozen sources

1. [Binance public data repository](https://github.com/binance/binance-public-data)
   - Binance documents daily and monthly public archive downloads at
     `https://data.binance.vision/`.
   - Every ZIP is accompanied by a `.CHECKSUM` sidecar and the repository documents SHA-256
     verification.
   - The repository warns that archive files can be updated, so S-1O records and verifies the
     exact checksum sidecar and ZIP digest rather than treating a URL as immutable evidence.
   - The repository does **not** document the semantic derivation, publication latency, or
     historical correction policy of the USD-M `metrics` files used here.

2. [USD-M Open Interest Statistics](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Open-Interest-Statistics)
   - Public endpoint: `GET /futures/data/openInterestHist`.
   - The current schema exposes `sumOpenInterest`, `sumOpenInterestValue`, and a timestamp at
     supported periods including five minutes.
   - The endpoint documents availability for only the latest one month. It cannot supply the
     frozen twelve-month S-1O calendar, and S-1O forbids REST/archive stitching.

3. [USD-M Funding Rate History](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-History)
   - Public endpoint: `GET /fapi/v1/fundingRate`.
   - The current response identifies actual funding timestamps and rates. The current REST
     schema also identifies `Regular` versus `Special` rates.
   - The public archive `fundingRate` CSV used by S-1O exposes `calc_time`,
     `funding_interval_hours`, and `last_funding_rate`; it does not carry the current REST
     `rateType` field. S-1O therefore cannot prove a historical rate-type classification from
     the archive and records that limitation.

4. [USD-M Mark Price Klines](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Mark-Price-Kline-Candlestick-Data)
   - Public endpoint: `GET /fapi/v1/markPriceKlines`.
   - Mark-price klines are identified by open time. S-1O uses checksum-bound five-minute
     archive bars and only a bar complete at or before a settlement timestamp.

5. [USD-M Contract Klines](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Kline-Candlestick-Data)
   - Public endpoint: `GET /fapi/v1/klines`.
   - Klines are identified by open time. S-1O uses checksum-bound five-minute contract archive
     bars for delayed entry, delayed exit, and a coarse quote-volume capacity proxy.

6. [USD-M User Commission Rate](https://developers.binance.com/docs/derivatives/usds-margined-futures/account/rest-api/User-Commission-Rate)
   - `GET /fapi/v1/commissionRate` is a signed `USER_DATA` endpoint.
   - S-1O is prohibited from calling it. Any public example or assumed rate is a scenario
     proxy, never account-effective fee truth.

## Archive paths frozen by S-1O

Only these public archive families are admitted:

- `data/futures/um/daily/metrics/BTCUSDT/BTCUSDT-metrics-YYYY-MM-DD.zip`
- `data/futures/um/monthly/fundingRate/BTCUSDT/BTCUSDT-fundingRate-YYYY-MM.zip`
- `data/futures/um/monthly/markPriceKlines/BTCUSDT/5m/BTCUSDT-5m-YYYY-MM.zip`
- `data/futures/um/monthly/klines/BTCUSDT/5m/BTCUSDT-5m-YYYY-MM.zip`

Every admitted archive must have a matching official `.CHECKSUM` sidecar, the sidecar must name
the requested ZIP exactly, and its SHA-256 must equal the downloaded bytes. Missing, malformed,
ambiguous, schema-drifted, duplicate, gapped, or checksum-drifted evidence fails closed.

The February 2026 monthly archives straddle the development/embargo/holdout boundaries. The
acquisition plan therefore downloads an independently checksum-verified copy into each custody
root. Development parsing stops before `2026-02-10T00:00:00Z`; the separate holdout copy is not
opened until a champion seal exists and the holdout-open marker has been created.

## Frozen evidence limitations

- The official public-data repository does not define how historical USD-M `metrics`
  `sum_open_interest` and `sum_open_interest_value` are derived, when a row became observable,
  or how corrections are governed. A statistically positive public result is therefore capped
  at `UNMEASURED`, never `GO`.
- The archive funding file does not expose the current REST `rateType`; historical special-rate
  exclusion is unproved.
- Five-minute bars are not executable quotes. Entry, exit, mark, fee, slippage, and capacity
  values are explicit public proxies.
- An OI row is admissible only after a complete-period cutoff: for event `t`, S-1O uses the
  latest row at or before `t-5m`, refuses a row more than ten minutes older than that cutoff,
  and applies the same bounded rule at the frozen 8h or 24h baseline. It never consumes a
  future row or performs unbounded forward-fill.
- Archive metrics `create_time` is admitted only as UTC text `YYYY-MM-DD HH:MM:SS`. Archived
  funding milliseconds are retained exactly. Cadence is valid when elapsed time is within
  1,000 milliseconds of either adjacent row's advertised interval, admitting interval
  transitions without rounding or normalizing an event time.
- The capacity proxy clock is funding event `t`: exactly 288 gap-free contract five-minute
  bars whose close times are in `[t-24h,t)` are summed, then the smaller of one millionth of
  that quote volume and one millionth of the same lagged OI row's OI value is reported.
- Account-effective fees, discounts, VIP tier, historical exchange filters, executable depth,
  fill probability, latency, impact, liquidation mechanics, and deploy/runtime behavior remain
  `UNKNOWN`.
- No result from this packet grants capital or production authority. Capital disposition is
  always `NO_GO`.
