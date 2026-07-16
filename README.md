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
npm run test:all          # full Node/TypeScript repository suite
npm run test:i00:complete                    # print the bounded command/evidence plan only
npm run test:i00:complete -- --plan          # explicitly print the bounded command/evidence plan only
npm run test:i00:complete -- --run --q-venv /absolute/path/to/accepted-q-venv --browser-receipt test/i00/performance/evidence/browser/<browser-receipt>.json
npm run test:i00:complete -- --validate-only --candidate-sha <candidate-commit> --seal-sha <sole-child-seal-commit> --performance-receipt test/i00/performance/evidence/<performance-receipt>.json --browser-receipt test/i00/performance/evidence/browser/<browser-receipt>.json --complete-receipt test/i00/performance/evidence/<complete-receipt>.json
npm run test:integration  # boots the built app; live public-market gates
npm run build             # server tsc + web vite production build
npm run start             # run the built server
npm run dev -w web        # web dev server
npm run validate:config -- --env /absolute/path/to/i00.env
npm run smoke:public      # public-only, keyless source smoke
npm run smoke:private-read # OWNER_GATED, data-only exit 2 in this integration boundary
npm run smoke:signed-test  # OWNER_GATED, data-only exit 2 in this integration boundary
```

The stable operations entrypoints are `npm run backup`, `npm run restore:test`,
`npm run release:preflight`, `npm run deploy:preflight`, and
`npm run rollback:preflight`. They require explicit absolute inputs after `--`.
Backup and restore are restricted to marked local simulation/isolated paths;
release, deploy, and rollback commands perform validation only. None invokes a
service switch, systemd, AWS, deployment, private exchange access, or signed calls.

## Hard laws

- No withdrawals or transfer-out code/UI. No autonomous live execution.
- Binance keys server-side only; no secrets in frontend, Git, logs, or prompts.
- Kill switch is visible, checked first, and fail-closed for new risk.
- Every financial intent and outcome is ledgered, including unknown outcomes.
- Manual money mutations (if ever enabled) fail closed behind account, permission, control-mode, kill-switch, live-arm, risk, and confirmation gates.

## Keyless local boundary

This integration candidate deliberately constructs no private or signed Binance
client. Local startup is public-only and keyless: account balances, permissions,
orders, fills, borrow truth, and private reconciliation remain
`NOT_CONFIGURED`/`OWNER_GATED`. Do not add credentials to exercise this Phase 2
candidate. Default persisted posture is halted, live execution is absent, and
all money controls remain blocked.

## Operator access boundary

Server binds to `127.0.0.1` unless `HOST` is set. Remote API/WebSocket access requires a verified Cloudflare Access JWT (issuer, audience, signature, subject, email matching `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `CONTROL_ROOM_OPERATOR_EMAIL`); state-changing remote requests also require exact HTTPS same-origin. The AWS notification intake is the sole exception and uses its own bearer token.

Declared private-deploy target (verify against the real environment): `https://arbitrage.cosmosgeek.org` · EC2 `/opt/arbitrage-cosmos` · local origin `127.0.0.1:8080` · tunnel `cosmosgeek-arbitrage`.
