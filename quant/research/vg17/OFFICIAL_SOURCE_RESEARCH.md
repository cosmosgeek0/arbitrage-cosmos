# V-G17 current official-source research

Observed on `2026-07-29` before V-G17 implementation or archive decompression.

## Binance public market data

- Binance's public-data repository states that Spot kline archives reproduce
  `/api/v3/klines`, are published as daily/monthly ZIP files, and have adjacent
  SHA-256 `.CHECKSUM` objects. It also warns that archive objects can be
  replaced, so V-G17 freezes both compressed and sidecar bytes:
  <https://github.com/binance/binance-public-data/blob/master/README.md?plain=1>
- The current Spot kline schema identifies bars by open time and exposes quote
  asset volume as field seven. V-G17 uses only completed `1d` bars:
  <https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market>
- Binance documents `data-api.binance.vision` as a market-data-only REST host.
  V-G17 does not use a signed endpoint:
  <https://developers.binance.com/en/docs/products/spot/faqs/market_data_only>
- Binance's archive documentation states that Spot timestamps from
  `2025-01-01` use microseconds. V-G17 rejects another unit rather than guessing.

## Costs and capacity boundary

- Binance's commission FAQ says actual commission can include standard, special,
  tax, buyer/seller, maker/taker, and discount components. Exact account
  commission requires account context, which is forbidden here:
  <https://developers.binance.com/en/docs/products/spot/faqs/commission_faq>
- Current Spot filters include `LOT_SIZE`, `MARKET_LOT_SIZE`, `MIN_NOTIONAL`,
  and `NOTIONAL`, but a current snapshot is not historical proof:
  <https://developers.binance.com/en/docs/products/spot/filters>

The frozen public scenario therefore uses a declared `10 bp` taker fee per fill
and modeled adverse prices. Account-effective fees, historical spreads, fills,
depth, queue position, historical filters, and executable capacity stay
`UNKNOWN` or `UNMEASURED`.

## Statistical anchors

- The absolute-return/dollar-volume construction follows the form commonly
  called an Amihud illiquidity proxy. V-G17 calls it an
  **impact-efficiency regime**, never observed or causal market impact:
  <https://www.sciencedirect.com/science/article/pii/S1386418101000246>
- CSCV/PBO is used only as a development selection-overfitting diagnostic:
  <https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf>
- Circular block resampling preserves bounded serial dependence:
  <https://statistics.stanford.edu/technical-reports/circular-block-resampling-procedure-stationary-data>

These sources motivate the frozen measurement law. They do not establish
profitability, execution feasibility, or capital authority.
