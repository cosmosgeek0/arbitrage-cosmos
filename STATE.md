# STATE.md — what is true right now

**Current checkpoint:** 2026-07-14 · Phase 2 integration branch `i00-product-assembly-20260713` · authority handoff `c1266f24c464a49ef1657e2549b06d7a90d6cac7`
**Law:** any landed change that alters project state must update this file in the same commit. This file wins on "what is the current state"; `ARCHITECTURE.md` wins on "how it is designed"; `MISSION.md` wins on "why".

## What this is

A private Binance arbitrage/intelligence operating machine ("Cosmos Arbitrage Control Room"): full-universe surveillance, Basis (spot–perp divergence) and Volume (dormant-token wakeup) strategy engines, evidence/attention intelligence, capital supervision, risk, dry-run execution, ledger, and an operator cockpit — composed into **one observable validate-only system**. It cannot move money: live execution returns `LIVE_EXECUTION_NOT_IMPLEMENTED` (tripwire-tested), there are no withdrawal/transfer routes, and no signed/private exchange call exists in the composed runtime.

## Git truth

- Remote: `git@github.com:cosmosgeek0/arbitrage-cosmos.git` · default branch `current-main` remains untouched at `7383fd89477ed0b3e677e53c57c35d76ac34bbd8`.
- The Phase 2 branch contains the exact canonical Main director-state ancestry through `7383fd89477ed0b3e677e53c57c35d76ac34bbd8`; that synchronization changes only `QL_DIRECTOR_STATE.md`, `QL_PARALLEL_DAG.md`, and `WORKER_PROMPTS.md` relative to the preceding accepted SI tree.
- Milestone tags (all pushed): `sprint-foundation-final`, `sprint-intelligence-final`, `sprint-runtime-final`, `sprint-capital-final`, `sprint-convergence-final`.
- Milestone commits on `current-main`: audited baseline `b272049` → organs round 1 `c4ae7a9` → organs round 2 `87af782` → convergence `b58e64e`.
- Feature branches preserved on origin as recovery points (`market-intelligence-main-20260711`, `backend-foundation-parallel-20260711-070056`, `live-intelligence-runtime-main-20260711`, `capital-supervision-main-20260711`, `system-convergence-vertical-slice-20260711`, `engine-overdrive`, `engine-volume-overdrive`).
- Workspace: canonical Main is `/Users/cosmosgeek/Desktop/Main`; the sole Phase 2 shared writer is `/Users/cosmosgeek/Desktop/i00-assembly` on `i00-product-assembly-20260713`. Donor worktrees are immutable recovery/audit points and are never bulk-copied.
- `.env`, `data/`, `dist/`, `node_modules/` are never tracked. Keys are server-side only.

## Component status (release labels are cumulative; see ARCHITECTURE.md)

| Component | Status |
| --- | --- |
| Audited product (services, Binance owners, ledger, cockpit) | LIVE_PUBLIC (read-only key posture) |
| Basis engine + Volume engine (`server/src/engine/**`) | LIVE_PUBLIC — sole strategy authorities |
| Backend Foundation (`server/src/foundation/**`) | WIRED via adapters; accepted F-BRIDGE `a0c0c2e5ef3180aa720488463643433cefeb65e5` hardens terminalization and restart recovery; execution coordinator remains dry-run only; USD-M test-order boundary dormant/NOT wired |
| Market Intelligence (`server/src/intelligenceFoundation/**`) | WIRED as evidence substrate |
| Intelligence Runtime (`server/src/intelligenceRuntime/**`) | WIRED for composed public sources; continuous effectful feed = next work |
| Capital Supervision (`server/src/capitalFoundation/**`) | WIRED read/advisory; reservation authority UNAVAILABLE (needs real account truth) |
| System Integration (`server/src/systemIntegration/**`) | WIRED — composition root, supervisor, authenticated APIs, controls, vertical slice; accepted SI-RECON `f03ed786a8c5cab50ef27ad33026a74f79f7df87` preserves `DIVERGED` for contradictory working-order truth |
| Operator modes | READ_ONLY / ADVISORY / VALIDATE_ONLY only; kill switch fail-closed for new risk |
| Live execution / signed calls / borrow / transfer | MISSING by design — mechanically blocked |

## Verification (Phase 2 F-BRIDGE + SI-RECON gate, 2026-07-14)

```bash
npm run test:foundation  # exit 0; all 24 sorted files passed at the F-BRIDGE cut
npm test                 # exit 0; deterministic 377/377 after SI-RECON
npm run test:all         # exit 0; complete repository gate after SI-RECON
```

F-BRIDGE focused proof is green: execution `173/173`, execution import purity `30/30`, compatibility `131/131`, reconciliation `75/75`. SI-RECON focused proof is `29/29`. The complete gate passes deterministic `377`, app `72`, intelligence `152`, intelligence runtime `394`, capital `433`, all 24 Foundation files, and System Integration `180/180`. The corrected expectation is `DIVERGED`, not a weakened `PARTIAL` claim.

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
