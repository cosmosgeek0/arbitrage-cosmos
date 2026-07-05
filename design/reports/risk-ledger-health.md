# PAGE
Risk, LedgerPage, and SystemHealth control rescue.

# WHAT WAS BROKEN
- Risk split the live-send truth across hero, metric cards, chain cards, and safety controls; the gate did not read like one instrument.
- Ledger spent too much first-viewport space on filter/status chips before the actual event timeline.
- Ledger events showed summaries, but the reason line was not consistently visible until opening rows.
- SystemHealth repeated account, feed, risk, ledger, and order status across metric cards, impact cards, component rows, and preflight.
- Dark-mode control surfaces still carried too much glass/card glare for the project's flat terminal law.

# CHANGES
1. Replaced Risk's separate hero/metric/chain stack with one gate instrument showing verdict, kill switch action, daily usage, order cap, open slots, rejects, utilization, and every live-send gate.
2. Made Risk's kill switch and resume path prominent in the first control surface while preserving the existing confirm modal and server actions.
3. Collapsed Ledger filters into a compact audit console with kind select, decision segmented control, refresh/clear actions, and category counts.
4. Promoted Ledger's event timeline upward and added a visible reason line to each event row.
5. Replaced blank detail values in Ledger expansion with `not recorded` instead of dash placeholders.
6. Compressed SystemHealth into one operations board: cockpit WS, Binance streams, REST/clock, account truth, user stream, scanner, order cache, risk, ledger, and rate budget appear once.
7. Added dark-mode flattening for the rescued control surfaces under `/* ===== PAGE RESCUE: control ===== */`.

# REFERENCES USED
1. CoinGlass futures grouping — https://www.coinglass.com/pro/futures/Cryptofutures — borrowed the idea of grouping dense derivative/system data into domain bands instead of scattering status cards.
2. Kraken Pro trading interface guide — https://support.kraken.com/articles/kraken-pro-trading-interface-guide — borrowed the always-nearby trading/status surface pattern for gate status and action routing.
3. Pyth price-feed terminal/catalogue — https://www.pyth.network/price-feeds — borrowed compact comparable feed-card spacing for the SystemHealth operations board.

# FILES TOUCHED
- `web/src/pages/Risk.tsx`
- `web/src/pages/LedgerPage.tsx`
- `web/src/pages/SystemHealth.tsx`
- `web/src/styles.css` under `/* ===== PAGE RESCUE: control ===== */`
- `design/reports/risk-ledger-health.md`

# GATES RUN + RESULTS
- `npm run build -w web` — PASS
- Browser render check on `http://127.0.0.1:5184/` — PASS, Risk/Ledger/SystemHealth captured in light and dark.
- Browser console check — PASS, no warnings/errors returned.
- `npm test` — PASS, 50/50 gates.

# SCREENSHOTS
- Before Risk light: `design/screenshots/2026-07-05-risk-ledger-health-before-risk-light-1440.png`
- Before Risk dark: `design/screenshots/2026-07-05-risk-ledger-health-before-risk-dark-1440.png`
- After Risk light: `design/screenshots/2026-07-05-risk-ledger-health-after-risk-light-1440.png`
- After Risk dark: `design/screenshots/2026-07-05-risk-ledger-health-after-risk-dark-1440.png`
- Before Ledger light: `design/screenshots/2026-07-05-risk-ledger-health-before-ledger-light-1440.png`
- Before Ledger dark: `design/screenshots/2026-07-05-risk-ledger-health-before-ledger-dark-1440.png`
- After Ledger light: `design/screenshots/2026-07-05-risk-ledger-health-after-ledger-light-1440.png`
- After Ledger dark: `design/screenshots/2026-07-05-risk-ledger-health-after-ledger-dark-1440.png`
- Before SystemHealth light: `design/screenshots/2026-07-05-risk-ledger-health-before-system-light-1440.png`
- Before SystemHealth dark: `design/screenshots/2026-07-05-risk-ledger-health-before-system-dark-1440.png`
- After SystemHealth light: `design/screenshots/2026-07-05-risk-ledger-health-after-system-light-1440.png`
- After SystemHealth dark: `design/screenshots/2026-07-05-risk-ledger-health-after-system-dark-1440.png`
