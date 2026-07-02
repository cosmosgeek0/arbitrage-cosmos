# Architecture — Cosmos Arbitrage Control Room

One backend process, clean internal modules, one database, one dashboard. Do not split into microservices at this scale — module boundaries yes, network boundaries no.

## Components (all inside one backend process at first)

```
Binance WS/REST ──> [Market Data Engine] ──> in-memory feature store
                                                    │
                                             [Brain / Strategy Modules]
                                                    │  trade proposals
                                             [Risk Gate]
                                                    │  approved proposals
                                        [Approval Queue] (manual at first)
                                                    │
                                             [Executor] ──> Binance (testnet → live)
                                                    │
Binance user-data stream ──────────────> [Account State] (balances, fills, positions)

everything above writes to ──> [Ledger (SQLite)] <── read by [Dashboard API] <── React UI
```

- **Market Data Engine** — maintains WebSocket connections (`!miniTicker@arr`, `<symbol>@bookTicker`, mark price / funding streams; per-symbol `@depth@100ms` + `@aggTrade` only for focused symbols). Handles reconnects (24h connection lifetime), keeps a local order book from snapshot + diffs.
- **Feature store** — in-memory, per symbol: last price, spot/perp basis (bid/ask executable, not mid), funding rate + next funding time, rolling volume baselines (1h/24h), spread, depth score, borrowability + max borrow + borrow rate (refreshed slowly via margin REST).
- **Brain** — runs on a timer (1–5s tick is plenty; this is not HFT). Per-symbol state machine:
  `IDLE → WATCHING → FOCUS → PROPOSED → ACTIVE → COOLDOWN`
  Strategy modules are pure functions: `(features, config) → proposal | reject(reason)`. Every reject reason is a named string and is ledgered. Proposals carry: symbol, direction, size, expected edge after fees, worst case, exit plan, confidence, which strategy produced it.
- **Risk Gate** — deterministic checks, all configurable from the dashboard: max order size, max open positions, max daily loss, allowed-symbols list, min depth at size, max spread, borrow available if needed, no conflicting position, cooldown after loss, global kill switch. Rejects are ledgered with reason.
- **Approval Queue** — proposals wait for a human click. Auto-approve per strategy is a later, explicit unlock.
- **Executor** — the ONLY module that signs requests to Binance trading endpoints. Uses order test endpoint before live. Handles partial fills, stale-order cancellation, and two-leg atomicity for basis trades (never leave one naked leg without a ledgered recovery plan).
- **Ledger** — SQLite (upgrade to Postgres only if it hurts). Tables: `events` (append-only, everything), `proposals`, `orders`, `fills`, `positions`, `pnl_daily`, `config_changes`.
- **Dashboard** — React + Vite behind Cloudflare Access. Pages: Portfolio (equity, daily PnL bars, drawdown, per-strategy PnL), Opportunities (live proposals + reject feed), Positions, Orders/Fills, Strategies (on/off, paper/live, params), Risk, Logs, Kill switch. Talks to backend via REST + one WebSocket for live updates. Never talks to Binance.

## Stack

TypeScript everywhere (Node 22 backend, React + Vite frontend, better-sqlite3). One language keeps the codebase coherent for AI-loop development. (Python asyncio would also work; the choice matters less than consistency — this repo is TypeScript, do not mix.)

## Strategy modules (in order of implementation)

1. **Basis scanner (paper)** — for every symbol with both spot + perp: compute executable basis from bookTickers, subtract fees (spot taker ~0.1%, futures taker ~0.05%, ×2 for close) and expected slippage; factor funding direction; check borrow availability/cost for the spot-short direction. Propose only if net edge remains and the signal persists >N seconds.
2. **Volume-spike scanner (paper)** — rolling volume baselines from miniTickers; promote outliers to FOCUS (subscribe depth + aggTrade); in focus, compute taker buy/sell imbalance, spread, depth quality; propose only after focus-mode confirmation.
3. Later: funding-farm positioning, listing events, whatever the ledger data suggests. New "judgment" = new named filter with a logged reject reason. That is how human intuition gets encoded, one rule at a time.

## Binance API facts this design depends on (verified July 2026)

- WS: ≤1024 streams/connection, ≤300 connection attempts/5min/IP, 5 control msgs/sec, 24h lifetime. Market data over WS has no request-weight cost.
- Spot `!ticker@arr` is retired (Mar 2026) — use `!miniTicker@arr` or per-symbol tickers.
- **Futures WS migrated to tiered hosts (legacy dead since 2026-04-23):** `wss://fstream.binance.com/public` (book tickers, depth), `/market` (aggTrades, mark price, klines), `/private` (user data). The legacy `wss://fstream.binance.com/ws/...` still ACCEPTS connections but silently sends no data — a nasty trap for old tutorial code.
- Order book = depth aggregated by price level (REST snapshot up to 5000 levels + `@depth@100ms` diffs). Individual orders/identities are NOT visible; walls are inferred from level sizes.
- `@aggTrade` gives every trade with taker side in real time → trade-flow imbalance is computable.
- Futures public data endpoints (~1000 req/5min class): open interest history, top/global long-short ratios, taker buy/sell volume — 5m granularity, last 30 days.
- REST: 6000 request-weight/min/IP (spot). Margin: max-borrowable + interest rate endpoints exist and must be checked per-trade.
- Testnets exist for spot and futures — executor is developed there.

## Signal Lab relationship

No hard dependency. This bot ingests Binance directly (it must re-verify everything pre-order anyway). If Signal Lab scores become useful as an extra input later: expose one JSON endpoint from Signal Lab, called machine-to-machine with a Cloudflare Access service token. Never scrape its HTML; never trust it as sole trigger.

## Phases

- **P1 Data layer** — market data engine + feature store + a raw dashboard page proving live numbers match Binance's UI.
- **P2 Ledger + account** — read-only keys, balances/positions/fills via user-data stream, ledger writing everything.
- **P3 Paper brain** — basis scanner + risk gate + opportunities/reject feed on dashboard. Run for days; measure honestly.
- **P4 Approval + testnet execution** — approval queue, executor against testnet, two-leg handling proven.
- **P5 Tiny live** — trade-enabled key (no withdrawal, IP-locked), minimum sizes, manual approval only, kill switch tested first.
- **P6+** — volume-spike strategy, auto-approve per strategy, more filters driven by ledger evidence.
