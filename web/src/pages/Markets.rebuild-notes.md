# Markets Rebuild Brief

Scope:
- Only change the Markets surface and the data fields needed by that surface.
- Keep account, orders, risk, strategy, and detail workflows intact.
- Prefer page-scoped CSS over broad edits to `web/src/styles.css`.

Reference direction:
- TradingView crypto screener: dense rows, sortable screener tabs, thin separators, useful derivative columns.
- Coinbase Explore: clean top hierarchy, market stats strip, readable asset rows, sober spacing.
- Do not clone either product. Blend dense professional data with a clean private-control-room layout.

Data priority:
- Exact Binance USDT spot universe, with spot-only and exact spot+USDT perpetual availability.
- Availability must be explicit in API rows: `hasSpot` and `hasPerp`, not inferred from missing prices.
- Spot vs perpetual mark basis is useful but not enough. Show executable top-of-book gaps:
  - long spot / short perp: `perpBid - spotAsk`.
  - short spot / long perp: `spotBid - perpAsk`.
- Show spread quality for spot and perp, top-book quote depth, funding rate, next funding, volume, 24h move, high/low range, and data-source provenance.
- Missing data must render as missing, not invented.

Data sources for this pass:
- Binance spot mini ticker stream: live spot last, 24h change, range, quote volume.
- Binance spot all-symbol book ticker REST: best bid/ask and top-book quantities.
- Binance USD-M mark price stream: mark price, funding rate, next funding time.
- Binance USD-M all-symbol book ticker REST: best perp bid/ask and top-book quantities.
- Binance USD-M all-symbol 24h ticker REST: perp last, 24h change, high/low, and quote volume.
- Binance USD-M current open interest REST: rotating background sampler, displayed as estimated USD notional when mark price is available.
- Binance USD-M all-market liquidation stream: rolling live 15-minute forced-long/forced-short notional window.
- Existing icon cache is only for logos, not market facts.

UI rules:
- No bulky card farm. Use thin dividers, compact bands, dense sortable tables, and restrained badges.
- Numeric changes should use the existing `Num` flash behavior.
- Labels should be professional and concise: executable gap, funding, spot spread, perp spread, depth, availability.
- Coinbase-style order matters: hero/search/status first, compact data provenance second, four calm market stats third, then tabs/filters/table. Do not cram source chips, stats, filters, and table controls into one horizontal band.
- Avoid duplicated venue chips inside the asset name; venue/availability belongs in the venue column.

Latest verification:
- `/api/markets` readback: 442 Binance USDT rows, 360 exact spot+perp pairs, 82 spot-only rows, no missing availability flags.
- Derivatives view headers verified in browser: Perp mark, Index basis, Funding, Open interest, OI / Vol, Liq 15m, Long / short liq, Perp volume.
- Source strip verified in browser: grouped Spot, Perps, OI, Liquidations, and Scanner chips; exact source names stay in the Data sentence.
- Liquidations are a live rolling 15-minute stream window. Empty values mean Binance has not emitted force-order prints for that symbol/window; do not backfill fake data.
