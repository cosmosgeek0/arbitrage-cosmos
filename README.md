# Cosmos Arbitrage Control Room

Keyless Binance public-market surveillance and arbitrage/intelligence control room, operated behind Cloudflare Access. Not a public dashboard, not a retail demo: the current composition provides public-universe surveillance, Basis/Volume strategy evidence, validate-only capital and risk supervision, dry-run evaluation, durable history, and system health. Private account data and signed exchange capability remain `NOT_CONFIGURED`/`OWNER_GATED`.

**Current posture:** one composed validate-only system. Live execution is mechanically blocked (`LIVE_EXECUTION_NOT_IMPLEMENTED`); there are no withdrawal or transfer-out routes anywhere.

## Documentation

Governing / read first:

| File | Purpose |
| --- | --- |
| `README.md` | Entry point; this inventory; verified commands |
| `STATE.md` | What is true right now — start here |
| `MISSION.md` | Why this exists; the edge hypotheses |
| `ARCHITECTURE.md` | Code families, decision chain, canonical authority map |
| `AGENTS.md` | Rules for any coding agent |
| `DIRECTOR.md` | Director boot file: laws, environment, recovery |
| `DESIGN.md` | UI design system, ship gate, locked surface baselines |
| `MANUAL.md` | Owner's operating manual |
| `FULL_AUDIT.md` | Historical read-only whole-tree source audit; not runtime, browser, or deployment proof |
| `MISTAKES.md` | Historical recovery failure-prevention lessons; not current product truth |

Live protocol / authorization contracts: `EDGE_PROTOCOL_V1.md`, `IP_ASSURANCE.md`,
`IP_OPS_ACTIVATION_REQUEST.md`.

Immutable machine-read evidence (byte-pinned by tests; history, not steering):
`AI_OPS_AUTHORITY_RESOLUTION_RECEIPT.md`, `F_BRIDGE_RECEIPT.md`, `SI_RECON_RECEIPT.md`,
`I00_CLOSURE_PRESTAGE_RECEIPT.md`, `I00_PRESTAGE_VERIFICATION_RECEIPT.md`,
`I00_PRODUCT_BUILD_STATE.md`, `I00_VERIFY_RECEIPT.md`, `LIVE_EDGE_RECEIPT.md`,
`IP_CONTROL_RECEIPT.md`, `IP_CONTROL_STATE.md`, `IP_OPS_RECEIPT.md`, `IP_OPS_STATE.md`,
`IP_PROOF_RECEIPT.md`, `IP_PROOF_STATE.md`, `IP_RUNTIME_RECEIPT.md`, `IP_RUNTIME_STATE.md`,
`QL_DIRECTOR_STATE.md`, `QL_PARALLEL_DAG.md`.

Generated assurance reports (owned by `test/i00/render-reports.mjs --write`; never hand-edit):
`AUTONOMY_CLOSURE_REPORT.md`, `MISSION_COVERAGE_MATRIX.md`, `NO_TERMINAL_DEPENDENCY_REPORT.md`,
`OFFICIAL_INTERFACE_MATRIX.md`, `RESOURCE_AND_BACKPRESSURE_REPORT.md`.

All other history lives in `docs/archive/` and in Git objects.

Test batteries: `npm test` and `npm run test:all`, plus the separate operations
proofs `bash ops/tests/run-all.sh` and `bash ops/tests/i00/run-all.sh` (CI runs
both jobs). Temporary external control files until deployment completes:
`Desktop/FIX_WAVES.md` (live checkpoint) and
`Desktop/FRESH_DIRECTOR_FINAL_TRANSITION.md` (the active deployment script).

## Commands (verified)

```bash
npm ci                    # install (Node 22, npm workspaces)
npm test                  # deterministic CI lane: typecheck, build, engines, safety
npm run test:all          # full Node/TypeScript repository suite
npm run test:i00:complete                    # print the bounded command/evidence plan only
npm run test:i00:complete -- --plan          # explicitly print the bounded command/evidence plan only
npm run test:i00:complete -- --run --uv /absolute/path/to/uv --q-venv /absolute/path/to/accepted-q-venv --browser-receipt test/i00/performance/evidence/browser/<browser-receipt>.json
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

Complete-acceptance run mode requires `--uv` to name an existing regular executable target by absolute `uv` path (`uv.exe` on Windows). Preflight rejects a missing, relative, wrong-name, non-regular, or non-executable input before any acceptance step. The complete receipt binds the resolved uv path and binary with separate SHA-256 provenance, and the runner prepends only the explicit path's directory to the sealed child `PATH`; every other sealed environment field remains unchanged.

The stable operations entrypoints are `npm run backup`, `npm run restore:test`,
`npm run release:preflight`, `npm run deploy:preflight`, and
`npm run rollback:preflight`. They require explicit absolute inputs after `--`.
Backup and restore are restricted to marked local simulation/isolated paths;
release, deploy, and rollback commands perform validation only. None invokes a
service switch, systemd, AWS, deployment, private exchange access, or signed calls.

## Hard laws

- No withdrawals or transfer-out code/UI. No autonomous live execution.
- The current composition accepts no Binance credentials; no secrets in frontend, Git, logs, screenshots, or prompts.
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

Server binds to `127.0.0.1` unless `HOST` is set. Remote API/WebSocket access requires a verified Cloudflare Access JWT (issuer, audience, signature, subject, email matching `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `CONTROL_ROOM_OPERATOR_EMAIL`); state-changing remote requests also require exact HTTPS same-origin.

Declared private-deploy target (verify against the real environment): `https://arbitrage.cosmosgeek.org` · EC2 `/opt/cosmos/current` · local origin `127.0.0.1:8080` · tunnel `cosmosgeek-arbitrage`.
