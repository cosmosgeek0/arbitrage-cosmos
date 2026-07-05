# CURRENT_STATE.md — arbitrage (SHORT TRUTH · agents read this FIRST · update after EVERY run · max 80 lines)
Updated: 2026-07-05 (Codex Design-loop Orders execution desk)

## Repo
- Node/TS monorepo: server/ (Express + better-sqlite3 + ws, ESM, tsx dev) + web/ (React 18 + Vite + lightweight-charts).
- engine/ holds ENGINE_CONTEXT.md ONLY — no engine code exists yet. PROJECT_CONTEXT.md at root is the purpose bible.
- Many uncommitted changes in worktree (UI passes in flight).

## App status
- Runs: `npm run start` (server :8080, paper mode, keys absent) + `cd web && npx vite --port 5173`.
- Gates: `npm test` currently 50/50 PASS.
- ~30 REST endpoints in server/src/index.ts (state, markets, klines, orders, loans, pnl, signals, proposals…).

## Latest run (2026-07-05)
- Purpose pass completed per DESIGN_LOOP order: read `PROJECT_CONTEXT.md`, `engine/ENGINE_CONTEXT.md`, `design/DESIGN_CONTEXT.md`, `CURRENT_STATE.md`, `design/TASTE_LOG.md`, `design/SITE_MAP.md`, `design/TOKENS.md`, and `design/PHOTO_QUEUE.md`.
- No owner photo attached, so this was a recovery run. Purpose pass selected `Orders`, the next full execution surface and the most safety-relevant unfinished cockpit page.
- Applied: replaced the separate Orders hero/status/command slabs with one compact Order desk showing held notional, open-limit usage, working-vs-terminal state, account feed, risk gate, history request, and cancel review. Blotter and inspector now enter the first viewport at 1440.
- Research applied: current Binance/Coinbase/TradingView order surfaces emphasize open/terminal status, fill progress, funds-on-hold, cancelability, and stream/snapshot truth close to the trading workspace.
- Screenshots saved: `design/screenshots/2026-07-05-orders-compact-{light,dark}-{1440,1920}.png`, `design/screenshots/2026-07-05-orders-compact-{light,dark}-zoom200-720.png`, and workarea shots.

## UI status
- 16 pages in web/src/pages. Settings is full-page rail workbench; Loans leads with Borrow Preflight; Topbar is a compact menu-row strip; Orders is now a compact execution desk with real route actions, locked history loading, and source line.
- Known diseases: legacy styles.css sections, execution surfaces still need one-surface purpose passes for Fills/PnL.

## Engine status
- NOT STARTED. server/src/engine/{marketData,scanner}.ts is legacy-lite market feed for the UI, not the full ENGINE_CONTEXT Python engine.
- Open decision (owner-directed): run one Python engine process and proxy /api/engine/* through TS server; UI should remain server API-only for engine state.

## Works / Broken
- Works: paper cockpit, scanner signals, gates, honest empty states, and API plumbing for core surfaces.
- Broken/missing: production-grade engine, token design system, several dead-looking trading regions, consistent per-surface purpose depth for Orders/Fills/PnL.

## Next 5 tasks (order)
1. Fable run 1: planning only — module map + build order + first module pick (resolve Python-vs-TS with rationale).
2. Fable run 2: Module 1 skeleton + tests, then stop.
3. Codex UI run: execute Fills purpose pass (execution-history truth, import path, fee/source audit).
4. Codex UI run: execute PnL purpose pass after Fills.
5. Continue token-system work (TOKENS.md + web/src/tokens.css) after next UI run if still pending.

## Latest known good
- Build: npm run build → PASS (2026-07-05 Orders execution desk).
- Test: npm test → 50/50 (2026-07-05 Orders execution desk).
- Screenshots: design/screenshots/2026-07-05-orders-compact-{light,dark}-{1440,1920}.png and zoom/workarea variants.
- Server boot log: "cosmos control room: 360 pairs, keys absent, :8080".
