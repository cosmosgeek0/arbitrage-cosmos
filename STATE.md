# STATE.md — what is true right now

**Current checkpoint:** 2026-07-14 · Phase 2 accepted L15 infrastructure merge `35672dcc448d2ca55b17c24344fb413b4d1e14a7` receipted after Q and dashboard equivalence on `i00-product-assembly-20260713`
**Law:** any landed change that alters project state must update this file in the same commit. This file wins on "what is the current state"; `ARCHITECTURE.md` wins on "how it is designed"; `MISSION.md` wins on "why".

## What this is

A private Binance arbitrage/intelligence operating machine ("Cosmos Arbitrage Control Room"): full-universe surveillance, Basis (spot–perp divergence) and Volume (dormant-token wakeup) strategy engines, evidence/attention intelligence, capital supervision, risk, dry-run execution, ledger, and an operator cockpit — composed into **one observable validate-only system**. It cannot move money: live execution returns `LIVE_EXECUTION_NOT_IMPLEMENTED` (tripwire-tested), there are no withdrawal/transfer routes, and no signed/private exchange call exists in the composed runtime.

## Git truth

- Remote: `git@github.com:cosmosgeek0/arbitrage-cosmos.git` · default branch `current-main` remains untouched at `7383fd89477ed0b3e677e53c57c35d76ac34bbd8`.
- The Phase 2 branch contains the exact canonical Main director-state ancestry through `7383fd89477ed0b3e677e53c57c35d76ac34bbd8`; that synchronization changes only `QL_DIRECTOR_STATE.md`, `QL_PARALLEL_DAG.md`, and `WORKER_PROMPTS.md` relative to the preceding accepted SI tree.
- Accepted Q donor `02b4eccc8d2ef53b830cafae06e5175715fa6ebb` is a merge parent and its 504 `quant/**` donor paths remain exact. The shared target retains canonical D-LAUNCH-1 lock blob `d1ebc3b6ddeae9f0b92520f9ca1bc5a3270430d5` rather than regressing to the historical Q snapshot blob `cf414da3b46d46d1807f4c04939c7ee1121f5895`; `fixtures/i00/q-directive-input-supersession.json` plus the Git provenance gate proves the sole authorized transition.
- Accepted dashboard donor `692501587617d4880303fbd747d93e63c376f088` is integrated by exact IP-CONTROL equivalence: the donor and current `web/src/features/systemDashboard/**` trees are both `d3d899db3b0395532a3cf12b2304e91a2ce528ce` (21/21 files). Its stale root `DASH_INTEGRATION_NOTES.md` is explicitly superseded by `IP_CONTROL_MOUNT_REQUEST.md`; the application mount is still pending.
- Accepted L15 donor `2cec412927fa2f64f05a0b2774b18e45f8ce4fa5` is integrated by exact Git ancestry. Its 31-file `ops/live/**` tree remains exactly `584163858a0333cb1ccb9eff756e91a851b1cb71`; all 17 donor-owned `ops/tests/**` paths remain byte-identical while the enclosing target tree also retains previously accepted `ops/tests/i00/**`. Its root integration note is archived byte-identically at `docs/archive/i00-phase2/L15_OPS_INTEGRATION_NOTES.md` to preserve root-document law.
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
| Quant Edge research/inference donor (`quant/**`) | IMPORTED — exact accepted Q `LANE_READY` snapshot; advisory `ABSTAIN_UNKNOWN`, no accepted champion, no money authority; production transport/mount still NOT_CONFIGURED |
| Capital Supervision (`server/src/capitalFoundation/**`) | WIRED read/advisory; reservation authority UNAVAILABLE (needs real account truth) |
| System Integration (`server/src/systemIntegration/**`) | WIRED — composition root, supervisor, authenticated APIs, controls, vertical slice; accepted SI-RECON `f03ed786a8c5cab50ef27ad33026a74f79f7df87` preserves `DIVERGED` for contradictory working-order truth |
| Deployment/operations artifacts (`ops/live/**`, `ops/tests/**`) | IMPORTED — exact accepted L15 templates and network-free proof; no installation, AWS/Cloudflare mutation, deployment, or target readback |
| Operator modes | READ_ONLY / ADVISORY / VALIDATE_ONLY only; kill switch fail-closed for new risk |
| Live execution / signed calls / borrow / transfer | MISSING by design — mechanically blocked |

## Verification (Phase 2 through accepted L15 integration, 2026-07-14)

```bash
npm run test:foundation  # exit 0; all 24 sorted files passed at the F-BRIDGE cut
npm test                 # exit 0; deterministic 377/377 after SI-RECON
npm run test:all         # exit 0; complete repository gate after SI-RECON
node --test --test-concurrency=1 --test-reporter=spec server/test/i00Acceptance/authority-protocol.test.mjs  # 14/14
node --import tsx --test --test-concurrency=1 --test-reporter=spec web/test/productControlRoom/contracts.test.mjs  # 18/18
bash ops/tests/run-all.sh  # exit 0; 11/11 files; 347 assertions; network-free except loopback harnesses
# From a clean git archive of exact Q donor 02b4eccc with only its pinned .venv linked:
PYTHONPATH=src .venv/bin/python -m pytest tests/q17 -q --cov=quant_edge.final_proof --cov-branch --cov-report=term  # 384/384; 96.50%
PYTHONPATH=src .venv/bin/python -m pytest -q --tb=short  # 3,011 passed; 6 documented shard-only skips
```

F-BRIDGE focused proof is green: execution `173/173`, execution import purity `30/30`, compatibility `131/131`, reconciliation `75/75`. SI-RECON focused proof is `29/29`. Q is green only in the immutable donor view: focused `384/384` at `96.50%` and accumulated `3,011` plus six documented skips. Running Q17 against the combined target correctly produces `366 passed / 18 failed / 93.70%` because its immutable proof freezes the historical 1,568-byte directive lock; this is recorded diagnostic evidence, never reported as a green target-tree Q17 gate. The integration-owned provenance suite proves the exact D-LAUNCH-1 external supersession `14/14`. Dashboard donor equivalence is exact at Git-tree level and its focused Product Control Room contract suite passes `18/18`. L15's complete network-free operational suite passes `11/11` files and 347 assertions. Root `npm test`, protocol `22/22`, and `npm run test:all` all pass; the complete root gate reports System Integration `180/180`. The SI corrected expectation remains `DIVERGED`, not a weakened `PARTIAL` claim.

## What is genuinely live vs not

- **Live public:** Spot/USD-M acquisition, universe, Basis, Volume, authenticated supervisor/control APIs, SQLite ledger/control persistence, cockpit truth surfaces (Dashboard, Health, Opportunities, Risk, Logs/Ledger).
- **Dry-run/synthetic:** capital mandate fixture → Foundation risk → sealed validate-only two-leg coordinator → reconciliation fixtures.
- **Unavailable (honest gaps):** continuous effectful intelligence feed; production capital/account truth; signed validation; exchange reconciliation against real fills; recovery mechanics; live execution.

## Next build families (in order)

1. Finish remaining accepted Phase 2 donor fan-in one donor at a time: A-CORE, A-HAZARD, A-COCKPIT, A-AGENT, A-STABILITY. Keep A-FORMAL, A-CASE, and any unsealed L lane refused at their exact blockers.
2. Apply the accepted shared insertion requests through the existing System Integration/Ledger/Foundation owners; mount the Q protocol client and dashboard without creating duplicate truth or lifecycle owners.
3. Complete authenticated private account truth (Spot/USD-M/Margin balances, liabilities, permissions, fees, funding, borrow capacity, freshness) only from an accepted donor; otherwise retain `NOT_CONFIGURED`.
4. Prove dependency-driven startup, runtime readback, browser truth, restart/reconciliation, and complete I00 local acceptance.
5. Preserve external/private/signed/AWS/deployment/money work as `OWNER_GATED` outside this branch's authority.

## Documentation map

Root (one file, one purpose): `README.md` quickstart/access · `MISSION.md` why and the edge hypotheses · `STATE.md` this file · `ARCHITECTURE.md` structure + canonical authority map · `AGENTS.md` rules for any coding agent · `DIRECTOR.md` how sprints are directed · `DESIGN.md` UI system + locked baselines.
History (evidence, superseded blueprints, sprint directives, receipts, research notes, the owner's original vision dump): `docs/archive/` — see its README. Receipts of future sprints go there too, with this file updated to point at the newest.
