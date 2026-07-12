# STATE.md — what is true right now

**Frozen:** 2026-07-12 · branch `current-main` · convergence tip `b58e64e` (this docs consolidation lands directly after it)
**Law:** any landed change that alters project state must update this file in the same commit. This file wins on "what is the current state"; `ARCHITECTURE.md` wins on "how it is designed"; `MISSION.md` wins on "why".

## What this is

A private Binance arbitrage/intelligence operating machine ("Cosmos Arbitrage Control Room"): full-universe surveillance, Basis (spot–perp divergence) and Volume (dormant-token wakeup) strategy engines, evidence/attention intelligence, capital supervision, risk, dry-run execution, ledger, and an operator cockpit — composed into **one observable validate-only system**. It cannot move money: live execution returns `LIVE_EXECUTION_NOT_IMPLEMENTED` (tripwire-tested), there are no withdrawal/transfer routes, and no signed/private exchange call exists in the composed runtime.

## Git truth

- Remote: `git@github.com:cosmosgeek0/arbitrage-cosmos.git` · default branch `current-main` (pushed and current).
- Milestone tags (all pushed): `sprint-foundation-final`, `sprint-intelligence-final`, `sprint-runtime-final`, `sprint-capital-final`, `sprint-convergence-final`.
- Milestone commits on `current-main`: audited baseline `b272049` → organs round 1 `c4ae7a9` → organs round 2 `87af782` → convergence `b58e64e`.
- Feature branches preserved on origin as recovery points (`market-intelligence-main-20260711`, `backend-foundation-parallel-20260711-070056`, `live-intelligence-runtime-main-20260711`, `capital-supervision-main-20260711`, `system-convergence-vertical-slice-20260711`).
- `.env`, `data/`, `dist/`, `node_modules/` are never tracked. Keys are server-side only.

## Component status (release labels are cumulative; see ARCHITECTURE.md)

| Component | Status |
| --- | --- |
| Audited product (services, Binance owners, ledger, cockpit) | LIVE_PUBLIC (read-only key posture) |
| Basis engine + Volume engine (`server/src/engine/**`) | LIVE_PUBLIC — sole strategy authorities |
| Backend Foundation (`server/src/foundation/**`) | WIRED via adapters; execution coordinator dry-run only; USD-M test-order boundary dormant/NOT wired |
| Market Intelligence (`server/src/intelligenceFoundation/**`) | WIRED as evidence substrate |
| Intelligence Runtime (`server/src/intelligenceRuntime/**`) | WIRED for composed public sources; continuous effectful feed = next work |
| Capital Supervision (`server/src/capitalFoundation/**`) | WIRED read/advisory; reservation authority UNAVAILABLE (needs real account truth) |
| System Integration (`server/src/systemIntegration/**`) | WIRED — composition root, supervisor, authenticated APIs, controls, vertical slice |
| Operator modes | READ_ONLY / ADVISORY / VALIDATE_ONLY only; kill switch fail-closed for new risk |
| Live execution / signed calls / borrow / transfer | MISSING by design — mechanically blocked |

## Verification (last full run: 2026-07-12, twice, identical)

```bash
npm test               # deterministic CI lane: typecheck, build, engines, focused safety (exit 0)
npm run test:all       # everything below in one command (exit 0, twice)
npm run test:integration  # boots built app, live public-market path (gates 72/72)
```

Focused lanes: existing checks 377 · gates 72 · intelligence 152 · runtime 394 · capital 433 · foundation 871 (incl. risk 884 assertions) · integration scenarios 30 (SC-01..SC-30). Security: existing 146 perimeter/safety checks + convergence egress tripwire. Zero known failing tests.

## What is genuinely live vs not

- **Live public:** Spot/USD-M acquisition, universe, Basis, Volume, authenticated supervisor/control APIs, SQLite ledger/control persistence, cockpit truth surfaces (Dashboard, Health, Opportunities, Risk, Logs/Ledger).
- **Dry-run/synthetic:** capital mandate fixture → Foundation risk → sealed validate-only two-leg coordinator → reconciliation fixtures.
- **Unavailable (honest gaps):** continuous effectful intelligence feed; production capital/account truth; signed validation; exchange reconciliation against real fills; recovery mechanics; live execution.

## Next build families (in order)

1. Complete authenticated private account truth (Spot/USD-M/Margin balances, liabilities, permissions, fees, funding, borrow capacity, freshness).
2. Concrete signed exchange adapters — test-order validation only, separately audited.
3. Two-leg live-recovery validation (partial fills, ambiguity, one-leg exposure, unwind).
4. Real outcome collection/calibration (no-look-ahead promotion gates).
5. Full operator control room expansion (every safe bounded control; no decorative toggles).
6. Deployment + external watchdog (EC2/systemd, Cloudflare boundary, backups, rollback).
7. Signed validation mode; then the smallest manually approved capital trial — only after every prior gate.

## Documentation map

Root (one file, one purpose): `README.md` quickstart/access · `MISSION.md` why and the edge hypotheses · `STATE.md` this file · `ARCHITECTURE.md` structure + canonical authority map · `AGENTS.md` rules for any coding agent · `DIRECTOR.md` how sprints are directed · `DESIGN.md` UI system + locked baselines.
History (evidence, superseded blueprints, sprint directives, receipts, research notes, the owner's original vision dump): `docs/archive/` — see its README. Receipts of future sprints go there too, with this file updated to point at the newest.
