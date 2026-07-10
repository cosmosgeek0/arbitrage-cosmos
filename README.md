# README.md — Arbitrage Capital Control Room

Private Binance account cockpit and engine-control system behind Cloudflare Access.

Read these first (four core docs):

1. `DIRECTOR_RULEBOOK.md` — operating rules for Director/agents.
2. `BLUEPRINT.md` — product, UI, backend, deploy, and reconstruction blueprint.
3. `ENGINE.md` — engine/algorithm/risk/ledger blueprint.
4. `PROJECT_MEMORY.md` — current live state, git/deploy status, active phase, changelog.

This app is not CG Signal Lab and not a public market dashboard. It is a private control room for account state, scanner proposals, risk, execution truth, PnL, ledger, and system health.

Hard laws:

- No withdrawals or transfer-out code/UI.
- Binance keys server-side only.
- No secrets in frontend, Git, logs, screenshots, or prompts.
- No autonomous live execution in v0.
- Risk gate before every live send.
- Kill switch visible and checked first.
- Ledger everything.

Run commands must be verified from `package.json`. Historical expected commands:

```bash
npm install
npm test
npm run build
npm run start
cd web && npx vite --port 5173
```

Target private deploy:

- Cloudflare hostname: `https://arbitrage.cosmosgeek.org`
- EC2 path: `/opt/arbitrage-cosmos`
- local origin: `127.0.0.1:8601`
- tunnel: `cosmosgeek-arbitrage`

## Local read-only Binance setup

The cockpit reads account state from a **server-side** Binance key. Without a key it boots into an honest disconnected/setup state; with one it shows real balances, permissions, orders, and fills. Keys never touch the browser.

1. On Binance, create a **System generated** HMAC API key.
2. **Enable Reading** only. Keep **Spot/Margin Trading OFF**, **Withdrawals OFF**, and **Universal Transfer OFF**.
3. Optionally restrict the key to your current local IP.
4. **Save the secret immediately** — Binance shows it once.
5. Copy `.env.example` → `.env` and put the values there (env names: `BINANCE_API_KEY`, `BINANCE_API_SECRET`). `.env` is gitignored.
6. Restart the server (`npm run build && npm run start`, or `npm run dev`).
7. Never paste the key/secret into chat, screenshots, logs, or GitHub. The UI shows only a masked key fingerprint.

Trading stays blocked regardless of key permissions (kill switch on, live mode off, risk gate first), and there is no withdrawal or transfer-out route anywhere in the app.
