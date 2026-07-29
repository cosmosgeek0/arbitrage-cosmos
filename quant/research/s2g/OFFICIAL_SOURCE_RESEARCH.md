# S-2G official-source freeze

Access clock: `2026-07-29T19:20:00Z`. Research happened before code or archive
member access. The observed official repository heads were
`binance-public-data@5c7f3197591c0d54d85dc43066226bc4c671d47a` and
`binance-spot-api-docs@6b8372cad7cecbdf5dd88a3372eafff51988c5cf`.

## Binance-public facts used

- The commit-pinned
  [Binance public-data README](https://github.com/binance/binance-public-data/blob/5c7f3197591c0d54d85dc43066226bc4c671d47a/README.md)
  defines daily/monthly Spot archives, SHA-256 `.CHECKSUM` sidecars, and the
  possibility that published archive bytes are later corrected. S-2G therefore
  seals compressed ZIP bytes and sidecars before any member is opened.
- The official [kline specification](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market#klinecandlestick-data)
  defines the twelve fields and UTC default. S-2G uses `open_time`, `open`,
  `close_time`, and `quote_asset_volume`; it derives weekday only from the
  validated UTC open timestamp. Binance's archive README says Spot archive
  timestamps from `2025-01-01` onward are microseconds, which is enforced.
- The [market-data-only boundary](https://developers.binance.com/en/docs/products/spot/faqs/market_data_only)
  supports public-only acquisition. No signed or account endpoint is used.
- The public [Spot fee schedule](https://www.binance.com/en/fee/trading)
  showed regular-user maker/taker `0.100% / 0.100%` at the access clock. This is
  frozen as a 10 bp per-turnover-unit public proxy, not historical or account
  truth. Binance's [commission FAQ](https://developers.binance.com/en/docs/products/spot/faqs/commission_faq)
  confirms account/symbol commission can include standard, tax, special,
  discount, and promotion effects and requires signed account evidence for
  effective truth. Effective fees remain `UNKNOWN`.
- Current [Spot filters](https://developers.binance.com/en/docs/products/spot/filters)
  explain `PRICE_FILTER`, `LOT_SIZE`, `MARKET_LOT_SIZE`, and notional filters.
  Current filters cannot prove historical tradability or capacity and are not
  used to rewrite the fixed cohort.

## Primary method sources

The protocol preregisters the calendar prior (French, DOI
`10.1016/0304-405X(80)90021-5`), dependent circular block bootstrap
(Politis-Romano, DOI `10.1080/01621459.1994.10476870`), White reality check
(DOI `10.1111/1468-0262.00152`), familywise multiplicity control
(Romano-Wolf, DOI `10.1111/j.1468-0262.2005.00615.x`), CSCV/PBO
(Bailey et al., DOI `10.21314/JCF.2016.322`), and cost discipline
(Novy-Marx-Velikov, DOI `10.1093/rfs/hhv063`).

## Truth boundary

Daily public quote volume is only a participation proxy. It cannot establish
spread, depth, impact, fill probability, borrow availability, borrow cost,
account commission, or executable capacity. The short leg is synthetic
research. Those limitations remain `UNKNOWN` or `UNMEASURED`, and this packet
never grants capital or execution authority.
