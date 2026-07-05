# HANDOFF.md — Cosmos Arbitrage Control Room (single source of truth for new agents)
Workflow: Owner → ChatGPT-Pro (plans) → Claude director (this file) → Codex (UI grind) / Claude Code Fable 5 (engine).
Read order for ANY new agent: AGENTS.md (safety, supreme) → PROJECT_CONTEXT.md → ENGINE_CONTEXT.md → this file.

## STATE (2026-07-05)
- Private real-money Binance cockpit. Paper mode default, keys absent, risk gate + kill switch, NO withdrawals ever.
- Stack: server/ = Express+better-sqlite3+ws (TS ESM, ~30 REST routes in src/index.ts); web/ = React18+Vite+lightweight-charts, 16 pages; styles.css legacy monolith (~13k lines, token system still pending).
- Gates: `npm test` = 50/50 (server/test/gates.mjs). Run: `npm run start` (:8080) + `cd web && npx vite --port 5173`.
- Pushed to github.com/cosmosgeek0/arbitrage-cosmos @ e77a7e7. Sister project signallab DELETED locally (lives on GitHub only).
- UI rescue round 1 done on: Dashboard, Markets, ManualTrade/Orders, Risk/Ledger/SystemHealth, Settings (full-page rail).

## UI LAWS (owner-locked, apply to every UI run)
Thin type (thick = one hero number only) · no hairline/box walls (whitespace carries structure; worst in dark mode — check both themes every run) · no watermark spam (attribution once, footer) · no word-soup status lines · honest states (missing data = compact chip, never placeholder furniture; every control works or is disabled-with-reason) · alive UI (tick/flash numbers, hover states) · references before edits: Kraken Pro, Hyperliquid, Backpack, Binance pro, TradingView, CoinGlass; 1Password/macOS for settings craft only. One page per Codex chat, before/after screenshots light+dark, ≥5 visible changes, report changed files, npm test green, stop.

## ENGINE (not started — next major work, Fable 5 in repo root)
- ENGINE_CONTEXT.md now lives at repo ROOT (1825 lines, the design bible); engine/ is empty, reserved for the engine code. server/src/engine/{marketData,scanner}.ts = legacy UI feed, NOT the engine.
- OPEN DECISION for Fable run 1: ENGINE_CONTEXT prescribes PYTHON engine (engine/*.py incl runner/api/replay) but server is TS. Director recommendation: separate Python process per bible; TS server proxies read-only /api/engine/*; UI never talks to engine directly.
- Build order: 1 skeleton(config/models/clock/runner-stub) 2 binance_universe+binance_public 3 state+rolling 4 features 5 focus 6 strategies/{basis,dead_volume} 7 risk 8 ledger+api. One module per run + tests + stop. No live orders in v0. Run 1 = PLANNING ONLY (module map, integration points, first module pick).
- Engine agent must not touch web/, UI, keys, mode logic. UI agents must not touch engine/ or server services (orders/loans/risk/ledger behavior).
