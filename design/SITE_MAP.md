# PAGE STATUS (merge pass 2026-07-05):
- Dashboard: usable · Markets: usable · ManualTrade/Orders: usable · Risk/Ledger/SystemHealth: usable · Settings: usable
- All 5 rescues merged; npm test 50/50; 5 clean CSS page markers, no collisions.

# SITE MAP — arbitrage-cosmos cockpit (plain words, kept current by every run)
> RULE: read this first, update it last, every run. Real money: AGENTS.md laws override all.
- web/src/pages: Dashboard, Markets, TokenDetail, ManualTrade, Orders, Positions, Fills, PnL, Loans, Strategies, Opportunities, Risk, Ledger, SystemHealth, Settings (+ Account, Wallets).
- web/src/pages/Dashboard.tsx: first-screen account cockpit. Compact page head says Account cockpit, hero shows current account readiness instead of billboard messaging, and decision stack sits before metric strip.
- web/src/pages/Orders.tsx: compact execution desk. First viewport now combines held notional, open-limit usage, working-vs-terminal state, account feed, risk gate, history request, cancel review, locked history loading, blotter entry, inspector, and one quiet source line.
- web/src/pages/Positions.tsx: spot exposure workbench. Shows account-sync posture, exposure and cost-basis only when basis data exists, explicit futures-not-active state, honest empty blotter, readiness checklist, safe routes to Manual Trade/Fills/Ledger/Wallets/Risk.
- web/src/pages/Loans.tsx: Borrow Preflight first; reverse-basis blockers, borrowable assets, and kill/live gate are surfaced before the loan catalog; controls route to real pages.
- web/src/pages/Strategies.tsx: truth-first strategy board with scanner funnel, proposal cards quoting ledger reason text, basis/funding context, and roadmap for unbuilt modes only.
- web/src/pages/Opportunities.tsx: proposal queue ranked by engine net edge after fees; radar tabs remain context lenses.
- web/src/pages/SystemHealth.tsx: trust-first view using `/api/system` and showing stream freshness, account truth, risk posture, request budget, and safe route actions.
- web/src/pages/Settings.tsx: full-page workbench with left rail, account posture panel, local appearance/data controls, and API/safety pane.
- web/src/components + lib + store.tsx: shared UI/state; styles.css now contains topbar compact-strip updates plus the compact Orders execution-desk layout.
- server/src: API layer reads market/state/ledger/signals/proposals and drives UI without client-side signed Binance access.
- Latest run: DESIGN_LOOP recovery pass completed on `Orders` after purpose pass selected it as the highest-impact unfinished execution surface.
- Latest top row: 44px menu-row style strip; Market/Account/Stream are compact dots with tooltips/labels, Health shows the current blocker, UTC remains wide-screen secondary timing, and local clock anchors the far right in `Thu Jul 2 10:52PM` style.
- Next full-content targets: Fills, then PnL.
- Gates: npm test (50). Dev: npm run build then node server/dist/index.js (port 8080; .claude/launch.json name `cosmos`).
(Each run: correct and extend this map in plain words.)
