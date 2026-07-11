# README.md — Arbitrage Capital Control Room

Private Binance account cockpit and engine-control system behind Cloudflare Access.

Read these first (project operating docs):

1. `PROJECT_MEMORY.md` — current live state, git/deploy status, active phase, changelog.
2. `DESIGN_PLAYBOOK.md` — mandatory product and UI quality bar.
3. `UI_SURFACE_BASELINE.md` — shared navigation and operator-surface baseline.
4. `BLUEPRINT.md` — product, UI, backend, deploy, and reconstruction blueprint.
5. `ENGINE.md` — engine/algorithm/risk/ledger blueprint.
6. `DIRECTOR_RULEBOOK.md` — operating and safety rules for agents.

This app is not CG Signal Lab and not a public market dashboard. It is a private control room for account state, scanner proposals, risk, execution truth, PnL, ledger, and system health.

Hard laws:

- No withdrawals or transfer-out code/UI.
- Binance keys server-side only.
- No secrets in frontend, Git, logs, screenshots, or prompts.
- No autonomous live execution in v0.
- Manual order and loan mutations fail closed behind account, key-permission,
  control-mode, kill-switch, live-arm, risk, and confirmation gates.
- Kill switch visible and checked first.
- Ledger every financial intent and outcome, including unknown outcomes.

Verified repository commands:

```bash
npm ci
npm test
npm run build
npm run test:integration
npm run start
npm run dev -w web
```

`npm test` is the deterministic CI lane: typecheck, clean production build,
engine proofs, and focused safety regressions. `npm run test:integration` boots
the built app in an isolated data directory and verifies the live public-market
path. Run `npm run test:all` when network access is available and both lanes are
required.

Declared private-deploy target (verify against the real environment):

- Cloudflare hostname: `https://arbitrage.cosmosgeek.org`
- EC2 path: `/opt/arbitrage-cosmos`
- local origin: `127.0.0.1:8080` (set `PORT=8601` explicitly for the historical EC2 tunnel target)
- tunnel: `cosmosgeek-arbitrage`

## Safe local Binance setup

The cockpit reads account state from a **server-side** Binance key. Without a key it boots into an honest disconnected/setup state; with one it shows real balances, permissions, orders, and fills. Keys never touch the browser.

1. On Binance, create a **System generated** HMAC API key.
2. **Enable Reading** only. Keep **Spot/Margin Trading OFF**, **Withdrawals OFF**, and **Universal Transfer OFF**.
3. Optionally restrict the key to your current local IP.
4. **Save the secret immediately** — Binance shows it once.
5. Copy `.env.example` → `.env` and put the values there (env names: `BINANCE_API_KEY`, `BINANCE_API_SECRET`). `.env` is gitignored.
6. Restart the server (`npm run build && npm run start`, or `npm run dev`).
7. Never paste the key/secret into chat, screenshots, logs, or GitHub. The UI shows only a masked key fingerprint.

The persisted default posture is halted: kill switch on, live mode off, and
money controls blocked. A read-only key cannot pass the permission checks for
manual order or loan actions. If those capabilities are deliberately enabled
later, every action still passes the server-side control and risk gates and is
written to the audit ledger. There is no withdrawal or transfer-out route.

## Operator access boundary

The server binds to `127.0.0.1` unless `HOST` is set explicitly. A genuine
loopback socket with a canonical localhost Host is accepted for local tools and
the browser. Remote API and WebSocket access requires a verified Cloudflare
Access JWT whose issuer, audience, signature, subject, and email match
`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, and
`CONTROL_ROOM_OPERATOR_EMAIL`. State-changing remote requests also require an
exact HTTPS same-origin header. The AWS notification intake is the sole API
exception and uses its separate bearer token.
