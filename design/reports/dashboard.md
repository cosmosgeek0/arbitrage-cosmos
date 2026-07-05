# PAGE
Dashboard

# WHAT WAS BROKEN
- Billboard title and disconnected-account copy were louder than account truth.
- Command posture, KPIs, and decision stack were split into separate slabs, so the first glance did not answer "what matters now?"
- Empty account state was oversized; it read like a hero instead of a small honest state.
- Readiness and system state used repeated dot/status rows that became visual noise.
- Important numbers competed with thick labels, icons, and action cards.

# CHANGES
1. Rebuilt the first viewport into one command-center card: account sync, posture, KPIs, and decision stack now live together.
2. Shrunk the page title from billboard scale to compact cockpit scale.
3. Replaced the giant "Sync waiting" state with a small "Read keys absent" chip and a concise server-only key note.
4. Converted the KPI slab into a thin six-column strip where numeric values lead and non-numeric waiting states are visually quieter.
5. Tightened posture into a grouped rail with a truthful 3/6 ready count, compact labels, and no repeated status dots.
6. Compressed the decision stack from tall cards into a dense ranked queue with direct actions.
7. Removed StatusDot usage from Dashboard strategy/system rows; those rows now read as text/status pairs.
8. Reduced empty order/fill states so they stay small and do not masquerade as panels of content.

# REFERENCES USED
1. [Kraken Pro trading interface guide](https://support.kraken.com/articles/kraken-pro-trading-interface-guide) — borrowed the widget discipline: portfolio, orders, fills, and platform status stay close to the trading workspace instead of becoming a marketing hero.
2. [Hyperliquid account abstraction modes](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/account-abstraction-modes) — borrowed the account-surface idea that balances, holds, and margin/risk posture should read as one account state.
3. [Backpack Exchange API docs](https://docs.backpack.exchange/) — borrowed the dense terminal bias: depth/history/account data should be scannable in compact rows with clear limits and history states.

# FILES TOUCHED
- `web/src/pages/Dashboard.tsx`
- `web/src/styles.css`
- `design/reports/dashboard.md`

# GATES RUN + RESULTS
- `npm run build -w web` — PASS
- Browser render check `http://127.0.0.1:5181/` at 1440 light/dark — PASS, no console errors
- Browser render check `http://127.0.0.1:5181/` at 1920 light/dark — PASS, no console errors
- `npm test` — PASS, 50/50 gates

# SCREENSHOTS
- Before light: `design/screenshots/2026-07-05-dashboard-before-light-1440.png`
- Before dark: `design/screenshots/2026-07-05-dashboard-before-dark-1440.png`
- After light: `design/screenshots/2026-07-05-dashboard-after-light-1440.png`
- After dark: `design/screenshots/2026-07-05-dashboard-after-dark-1440.png`
- After light wide: `design/screenshots/2026-07-05-dashboard-after-light-1920.png`
- After dark wide: `design/screenshots/2026-07-05-dashboard-after-dark-1920.png`
