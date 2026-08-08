# S-2A official-source research

Research was refreshed before implementation on 2026-07-30.

## Current official facts used by the freeze

| item | official source | frozen use |
|---|---|---|
| Public archive custody | [Binance public-data README](https://github.com/binance/binance-public-data/blob/master/README.md) | Monthly public USD-M archives; every ZIP must match its official `.CHECKSUM`; acquired bytes remain immutable. |
| USD-M hourly kline schema | [Kline/Candlestick Data](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Kline-Candlestick-Data) | Exact 12-field `1h` rows; open/close and quote-volume fields only. |
| USD-M mark-price kline schema | [Mark Price Kline/Candlestick Data](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Mark-Price-Kline-Candlestick-Data) | Exact 12-field `1h` rows; only price/time fields are admitted, because Binance designates the apparent volume/trade slots as ignored. |
| Current instrument metadata | [Exchange Information](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Exchange-Information) | Current contract type/status/onboard-date corroboration only; never treated as a historical point-in-time universe. |
| Public funding history schema | [Funding Rate History](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-History) | Observed public funding timestamp/rate rows are booked over each open interval. |
| Public rate-limit law | [USD-M General Information](https://developers.binance.com/docs/derivatives/usds-margined-futures/general-info) | Archive acquisition is serial and bounded; HTTP retries stay inside the one invocation. |
| Example archive custody | [BTCUSDT monthly 1h objects](https://data.binance.vision/?prefix=data%2Ffutures%2Fum%2Fmonthly%2Fklines%2FBTCUSDT%2F1h%2F) | Confirms the frozen July-2025 through June-2026 object naming. |

The official README states that monthly archives are published on a declared
cadence, carry SHA-256 sidecars, and may later be replaced when Binance corrects
an issue. S-2A therefore stores the exact received ZIP and sidecar bytes and
never silently refreshes them inside the consumed run.

## Measured pre-worktree availability

Before the worktree existed, all 576 kline/funding objects were checked. During
the pre-freeze audit, still before any outcome body or run marker was opened,
the additional 288 mark-price objects were checked. The combined matrix is 864
public objects: 12 fixed contracts × 12 months × three datasets × ZIP plus
checksum. Every July-2025 through June-2026 URL returned HTTP 200. The current
public `exchangeInfo` response also described all 12 fixed contracts as
USDT-margined perpetuals with `TRADING` status and onboard dates preceding the
study window.

That check proves present download availability, not historical membership,
delisting immunity, a freshness SLA, or immutable future bytes. The one-run
evaluator independently obtains and checksum-verifies the exact bodies it uses.

A single checksum-verified pre-window June-2025 BTCUSDT sample established the
archive schemas without opening any study outcome. The mark-price archive
(`af4ef4580eef01d1c2347e1278510e45ba88117c16d47c8bf3fe4b6bd6855a56`)
had one 720-row member on the exact hourly grid. The funding archive
(`a1f4a40953740fa83ee9ad97776ff8325d1958654a67f1325614071a983819d4`)
had 90 rows with an eight-hour declared interval, but publisher timestamps
varied by up to 16 ms around the canonical settlement hour. S-2A therefore
freezes a narrow nearest-hour normalization with an absolute one-second
ceiling, rejects collisions/reordering, and verifies every canonical gap
against one unchanged per-symbol declared interval. Any interval transition is
ambiguous under the archive schema and therefore terminal `UNMEASURED`.
Study-window bodies remain unopened until the sole run.

## Limitations frozen before outcomes

- Current `exchangeInfo` is not a point-in-time historical instrument master.
  The cohort is a predeclared retrospective large-contract panel, so
  survivorship bias remains a named limitation.
- Archive presence is established per fixed symbol and month. It is not a
  claim that all Binance contracts possess 12 months of history.
- Public kline quote volume is a turnover proxy, not executable depth.
- Published funding is public contract history, not account settlement truth.
- Hourly mark-price open is a checksum-bound funding-notional proxy, not the
  exact mark used for account settlement.
- Public fee and adverse-execution values are conservative research scenarios,
  not the owner's effective tier or realized execution.
- USDT source values are reported as USD-per-$1k research notation and do not
  prove historical or future USDT/USD parity.
- No private, provider, host, UI, order, transfer, withdrawal, or money path is
  involved.
