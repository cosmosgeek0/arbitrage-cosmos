# Cosmos — Arbitrage Control Room

Private Binance trading cockpit. Phase 1: live market data for all exact spot+perp USDT pairs, a **paper** basis scanner with a full decision ledger, and a dashboard. No API keys, no orders — public market data only.

Read [CLAUDE.md](CLAUDE.md) for the non-negotiable rules and [ARCHITECTURE.md](ARCHITECTURE.md) for the design and phase plan.

## Stack

- `server/` — Node 22 + TypeScript. Binance WebSocket ingest (spot miniTickers + futures mark/funding), basis scanner, SQLite ledger (`data/cosmos.db`), REST + WS API, serves the built dashboard.
- `web/` — React + Vite dashboard (Overview, Opportunities, Portfolio, System).

## Run locally

```bash
npm install
npm run build
npm start          # http://localhost:8080  (PORT env to change)
```

Dev loop: `npm run dev` (tsx watch, serves last-built `web/dist`), or run `npm run dev -w web` in a second terminal for frontend HMR (proxies /api and /ws to :8080).

## Deploy (EC2 + Cloudflare tunnel)

```bash
# on the box (Node 22 required)
git clone <repo> && cd arbitrage-cosmos
npm ci && npm run build
PORT=8080 npm start
```

Point the Cloudflare tunnel at `http://localhost:8080` and keep the hostname behind Cloudflare Access (YubiKey + email). Run under systemd so it survives reboots:

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

```bash
sudo systemctl enable --now cosmos
```

Note: run Node from the repo root (the ledger writes to `./data/`, the server serves `./web/dist`).

## Phase status

- [x] **P1** Market data + paper basis scanner + ledger + dashboard
- [ ] **P2** Read-only API keys → balances, positions, fills
- [ ] **P3** Paper brain runs for days, measured honestly
- [ ] **P4** Approval queue + testnet executor
- [ ] **P5** Tiny live orders, manual approval only
