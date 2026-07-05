# PAGE
Markets

# WHAT WAS BROKEN
- The first viewport was dominated by KPI/stat cards and scan cards, so the actual market list did not feel like the primary instrument.
- The table carried weak/dead cells: spot-only assets rendered dashes in basis/funding and idle assets rendered a dash in Signal.
- Price, 24h change, basis, funding, and volume had similar visual weight, making rows harder to scan quickly.
- Feed health was spread across a large panel and text pills instead of compact stale/fresh chips.
- The right rail competed with the market list at 1440px, causing table compression and clipped row actions.

# CHANGES
1. Rebuilt the page as table-first: compact hero, compact source strip, compact summary strip, then the full-width market list.
2. Replaced the large live-data panel with compact feed chips for market stream, scanner, REST, spot ticker, futures mark price, and refresh cadence.
3. Replaced the KPI/card wall with a slim summary strip: BTC, market tone, average basis, top volume, top gainers, top losers, basis watch.
4. Removed nonessential rank and trend columns so asset, price, 24h, basis, funding, volume, state, Details, and Ticket fit cleanly at 1440px.
5. Added row-level hierarchy: asset/logo/pair badges, bold price and volume, sublabels for mark price, 24h range, basis source, funding countdown, and quote volume.
6. Replaced dead dashes with compact honest chips: `spot`, `spot only`, `no perp`, `quiet`, `watch`, and `perp`.
7. Moved the mover/funding/context rail below the full-width table so the serious market list has priority and no horizontal overflow.
8. Added a single quiet source note under the table for data provenance instead of scattered source/watermark text.

# REFERENCES USED
- [Binance Markets rankings](https://www.binance.com/en/markets/trading_data/rankings) — borrowed compact market scanners for hot coins, top gainers, top losers, and top volume.
- [Coinbase Explore](https://www.coinbase.com/explore) — borrowed the clean asset/price/change/volume/action table hierarchy.
- [TradingView watchlist advanced view](https://www.tradingview.com/support/solutions/43000771546-watchlist-advanced-view-mode/) — borrowed the watchlist logic of focusing rows around last price, change, volume, and sortable table metrics.

# FILES TOUCHED
- `web/src/pages/Markets.tsx`
- `web/src/styles.css` under `/* ===== PAGE RESCUE: markets ===== */`
- `design/reports/markets.md`
- `design/screenshots/2026-07-05-markets-before-light-1440.png`
- `design/screenshots/2026-07-05-markets-before-dark-1440.png`
- `design/screenshots/2026-07-05-markets-after-light-1440.png`
- `design/screenshots/2026-07-05-markets-after-dark-1440.png`

# GATES RUN + RESULTS
- `npm run build -w web` — PASS.
- Browser render check at `http://127.0.0.1:5182/`, 1440px — PASS.
- Light and dark screenshots captured — PASS.
- Markets interaction check: Gainers filter, search, Details row action, and return to Markets — PASS.
- Markets table width check at 1440px: `scrollWidth - clientWidth = 0` — PASS.
- Console check: no Markets-page errors before interaction. Opening Token Detail via Details produced an existing external TradingView embed error from `https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js`; not changed because this run is scoped to Markets.
- `npm test` — PASS, 50/50 gates.

# SCREENSHOTS
- Before light: `design/screenshots/2026-07-05-markets-before-light-1440.png`
- Before dark: `design/screenshots/2026-07-05-markets-before-dark-1440.png`
- After light: `design/screenshots/2026-07-05-markets-after-light-1440.png`
- After dark: `design/screenshots/2026-07-05-markets-after-dark-1440.png`
