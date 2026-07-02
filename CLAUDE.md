# arbitrage-cosmos

Private Binance trading control room. Real money is involved. One user (the owner), behind Cloudflare Access (YubiKey + email). This is NOT a public product and NOT a Hyperliquid clone — it is a cockpit for watching, proposing, approving, and executing the owner's own trades.

Read ARCHITECTURE.md before building anything.

## Product rules (locked by the owner)

- The homepage is the ACCOUNT control room (balance, PnL, orders, fills, strategy state, trade ticket, risk, kill switch, event log). Never a big BTC chart, never a market token wall, never a Signal Lab clone.
- If a button exists it must do something; unimplemented features show as disabled/in-development, never as fake-running.
- Empty pages show a useful setup state, not blanks.
- Live execution is manual-only: strategy → proposal → prefilled ticket → risk gate → typed confirmation → send. No autonomous order placement in v0.
- Withdrawals/transfers-out: no code, no UI, ever. Keys: server env only, never frontend, never git.
- Run `npm test` (29 gates) before considering any change done.

## Non-negotiable safety rules

1. **Paper mode is the default.** Live order placement is a separate, explicit mode behind a config flag AND a UI switch. It does not exist until Phase 5.
2. **API keys never touch the frontend, git, or logs.** Backend env vars only. Keys must be created withdrawal-disabled and IP-restricted to the EC2 box. Never ask for or handle a key with withdrawal permission.
3. **Every decision is written to the ledger** — signals, proposals, risk accepts/rejects (with named reason), orders, fills, errors, config changes. If it isn't in the ledger, it didn't happen.
4. **The risk gate sits between brain and executor.** No code path may place an order without passing the risk gate. No exceptions for "testing".
5. **Kill switch first.** The global halt flag is checked before every order action and cancels open orders when flipped.
6. **Use Binance testnet** (spot + futures) for all executor development. Real keys only after testnet order flow is proven.

## Build discipline

- Build ONE layer at a time and verify it against real Binance data before starting the next. Do not scaffold five features at once.
- Verify with numbers, not vibes: if the dashboard shows a price/basis/funding value, cross-check it against Binance's own UI or API before calling it done.
- When something is broken, fix that specific thing. Do not refactor unrelated code in the same pass.
- UI polish (Coinbase/Binance quality is the bar) comes AFTER the data underneath is correct. A beautiful page showing wrong numbers is worse than an ugly page showing right ones.

## Current phase

v0 Control Room SHIPPED (2026-07-02): account dashboard (disconnected + connected states), signed Binance client (`server/src/binance/client.ts` — no withdrawal methods by design), manual trade ticket with preview/validate/live-send, server-side risk gate (`services/risk.ts`), full ledger (events + fills + signals in SQLite), user-data stream with 30s polling fallback (listenKey flow may be deprecated — polling is the guaranteed path), basis monitor producing explained proposals, 29 gate tests in `server/test/gates.mjs` (`npm test`).

Market data uses the NEW tiered futures WS hosts (legacy fstream `/ws` is silently dead since 2026-04-23 — see ARCHITECTURE.md).

Next: two-leg basis ticket via Binance testnet executor; margin borrow checks; volume-spike monitor.
