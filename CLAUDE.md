# arbitrage-cosmos

Private Binance trading control room. Real money is involved. One user (the owner), behind Cloudflare Access (YubiKey + email). This is NOT a public product and NOT a Hyperliquid clone — it is a cockpit for watching, proposing, approving, and executing the owner's own trades.

Read ARCHITECTURE.md before building anything.

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

Phase 1 SHIPPED (July 2026): market data engine (spot miniTickers + futures mark/funding via the NEW tiered WS hosts — see ARCHITECTURE.md, legacy fstream `/ws` is dead), paper basis scanner, SQLite ledger, React dashboard (Overview / Opportunities / Portfolio placeholder / System with kill switch + config). Verified against Binance's own numbers.

Next: Phase 2 — read-only API keys → balances, positions, fills, user-data stream. Keys via env vars on the server only.
