# Cosmos Arbitrage Control Room

Private cockpit for one Binance account, behind Cloudflare Access. The homepage is the **account control room** — balance, PnL, open orders, fills, strategy state, manual trade ticket, risk limits, kill switch, live event log. It is not a market dashboard and not a Binance clone.

Read [CLAUDE.md](CLAUDE.md) for the non-negotiable rules and [ARCHITECTURE.md](ARCHITECTURE.md) for the design.

## What v0 does

- **Without keys:** boots into a professional disconnected state with a setup checklist; public market data (all ~360 exact spot+perp pairs) streams for the basis monitor and trade-ticket quotes.
- **With keys (server env only):** balances, equity, open orders, fills (live via user data stream, 30s polling fallback), positions with ledger-derived average cost, daily realized PnL.
- **Manual live trading:** order ticket → Preview (Binance filters + full risk-check breakdown) → Validate (signed test order) → Send live (only when armed; typed-symbol confirmation; server re-runs the risk gate at send time).
- **Risk engine:** kill switch, live-arm toggle, max notional per order/day, max daily loss, max open orders, allow/blocklists, cooldown, stale-order flagging. Runs server-side before every send — the UI cannot bypass it.
- **Ledger:** every intent, risk decision, request, response, fill, strategy signal, manual action, config change and error is stored and browsable.
- **Strategies:** basis monitor produces explained proposals (monitor only — approving prefills the ticket, never sends). Volume-spike monitor is shown as in-development, not fake-running.
- **Not in this app, ever:** withdrawals, transfers out, keys in the frontend/git, autonomous order placement.

## Run

```bash
npm install
npm run build
npm start            # http://localhost:8080  (PORT env to change)
npm test             # 29 gate tests (boots an isolated instance)
```

Connect Binance: `cp .env.example .env`, fill `BINANCE_API_KEY` / `BINANCE_API_SECRET` on the **server**, restart. Create the key with reading enabled, **withdrawals disabled**, IP-restricted; enable spot trading only when you intend to send live orders.

## Deploy (EC2 + Cloudflare tunnel)

```bash
git clone <repo> && cd arbitrage-cosmos
npm ci && npm run build && npm test
PORT=8080 npm start
```

Point the Cloudflare tunnel at `http://localhost:8080`; keep the hostname behind Cloudflare Access (YubiKey + email). Systemd unit:

```ini
# /etc/systemd/system/cosmos.service
[Unit]
Description=Cosmos Arbitrage Control Room
After=network-online.target

[Service]
WorkingDirectory=/home/ubuntu/arbitrage-cosmos
ExecStart=/usr/bin/env node server/dist/index.js
Restart=always
Environment=PORT=8080

[Install]
WantedBy=multi-user.target
```

Run from the repo root (ledger writes `./data/`, server serves `./web/dist`). `.env` lives next to `package.json`, is gitignored, and never leaves the box.

## Status

- [x] **v0** — control-room shell, disconnected/connected states, manual live trade path with risk gate + confirmation, ledger, kill switch, tests
- [ ] two-leg basis ticket (spot + perp legs) via testnet executor
- [ ] margin borrow availability checks for reverse-basis proposals
- [ ] volume-spike monitor with focus mode
- [ ] per-strategy auto-approve (explicit, far later)
