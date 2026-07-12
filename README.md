# Cosmos Arbitrage Control Room

Private Binance account cockpit and arbitrage/intelligence operating machine, operated behind Cloudflare Access. Not a public dashboard, not a retail demo: an operator-grade control room for full-universe surveillance, Basis/Volume strategy engines, capital supervision, risk, dry-run execution, ledger truth, and system health.

**Current posture:** one composed validate-only system. Live execution is mechanically blocked (`LIVE_EXECUTION_NOT_IMPLEMENTED`); there are no withdrawal or transfer-out routes anywhere.

## Documentation (one file, one purpose)

| File | Purpose |
| --- | --- |
| `STATE.md` | What is true right now — start here |
| `MISSION.md` | Why this exists; the edge hypotheses |
| `ARCHITECTURE.md` | Code families, decision chain, canonical authority map |
| `AGENTS.md` | Rules for any coding agent |
| `DIRECTOR.md` | How sprints are directed, verified, and landed |
| `DESIGN.md` | UI design system, ship gate, locked surface baselines |
| `docs/archive/` | All history: receipts, superseded blueprints, sprint directives |

## Commands (verified)

```bash
npm ci                    # install (Node 22, npm workspaces)
npm test                  # deterministic CI lane: typecheck, build, engines, safety
npm run test:all          # every suite in the repository (the full battery)
npm run test:integration  # boots the built app; live public-market gates
npm run build             # server tsc + web vite production build
npm run start             # run the built server
npm run dev -w web        # web dev server
```

## Hard laws

- No withdrawals or transfer-out code/UI. No autonomous live execution.
- Binance keys server-side only; no secrets in frontend, Git, logs, or prompts.
- Kill switch is visible, checked first, and fail-closed for new risk.
- Every financial intent and outcome is ledgered, including unknown outcomes.
- Manual money mutations (if ever enabled) fail closed behind account, permission, control-mode, kill-switch, live-arm, risk, and confirmation gates.

## Safe local Binance setup

The cockpit reads account state from a **server-side** Binance key. Without one it boots into an honest disconnected state; with one it shows real balances, permissions, orders, and fills. Keys never touch the browser.

1. On Binance create a **System generated** HMAC API key with **Enable Reading only** (Spot/Margin Trading OFF, Withdrawals OFF, Universal Transfer OFF). Optionally IP-restrict it.
2. Copy `.env.example` → `.env`; set `BINANCE_API_KEY` / `BINANCE_API_SECRET`. `.env` is gitignored.
3. `npm run build && npm run start` (or `npm run dev`). The UI shows only a masked key fingerprint.

Default persisted posture is halted: kill switch on, live mode off, money controls blocked.

## Operator access boundary

Server binds to `127.0.0.1` unless `HOST` is set. Remote API/WebSocket access requires a verified Cloudflare Access JWT (issuer, audience, signature, subject, email matching `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `CONTROL_ROOM_OPERATOR_EMAIL`); state-changing remote requests also require exact HTTPS same-origin. The AWS notification intake is the sole exception and uses its own bearer token.

Declared private-deploy target (verify against the real environment): `https://arbitrage.cosmosgeek.org` · EC2 `/opt/arbitrage-cosmos` · local origin `127.0.0.1:8080` · tunnel `cosmosgeek-arbitrage`.
