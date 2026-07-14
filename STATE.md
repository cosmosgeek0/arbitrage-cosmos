# STATE.md — what is true right now

**Current checkpoint:** 2026-07-14 · exact required-last L merge `ec82bc51d5311dfb3f505216bfb3fa41733f038c` is integrated and sealed by `docs/archive/i00-phase2/L_LANE_INTEGRATION_RECEIPT.md` (SHA-256 `198af74b4f0931123a41d6b0a94b1bbcd6890813986d981bd39e95ba486c296b`); expected = discovered = receipt-accepted = integrated is 16/16/16/16; repository gates and the integration assurance overlay are green; A-FORMAL remains blocked; remaining L shared wiring, final source-freeze rerun, runtime/browser acceptance, and candidate sealing remain pending
**Law:** any landed change that alters project state must update this file in the same commit. This file wins on "what is the current state"; `ARCHITECTURE.md` wins on "how it is designed"; `MISSION.md` wins on "why".

## What this is

A private Binance arbitrage/intelligence operating machine ("Cosmos Arbitrage Control Room"): full-universe surveillance, Basis (spot–perp divergence) and Volume (dormant-token wakeup) strategy engines, evidence/attention intelligence, capital supervision, risk, dry-run execution, ledger, and an operator cockpit — composed into **one observable validate-only system**. It cannot move money: live execution returns `LIVE_EXECUTION_NOT_IMPLEMENTED` (tripwire-tested), there are no withdrawal/transfer routes, and no signed/private exchange call exists in the composed runtime.

## Git truth

- Remote: `git@github.com:cosmosgeek0/arbitrage-cosmos.git` · this integration session has not written or pushed `current-main`; live local/remote-tracking `current-main` is now `bf262c08984cf05cb84425e850b187af5f8adf03` and descends from the integrated `7383fd89477ed0b3e677e53c57c35d76ac34bbd8` snapshot.
- The Phase 2 branch contains the exact canonical Main director-state ancestry through `7383fd89477ed0b3e677e53c57c35d76ac34bbd8`; that synchronization changes only `QL_DIRECTOR_STATE.md`, `QL_PARALLEL_DAG.md`, and `WORKER_PROMPTS.md` relative to the preceding accepted SI tree.
- Accepted Q donor `02b4eccc8d2ef53b830cafae06e5175715fa6ebb` is a merge parent and its 504 `quant/**` donor paths remain exact. The shared target retains canonical D-LAUNCH-1 lock blob `d1ebc3b6ddeae9f0b92520f9ca1bc5a3270430d5` rather than regressing to the historical Q snapshot blob `cf414da3b46d46d1807f4c04939c7ee1121f5895`; `fixtures/i00/q-directive-input-supersession.json` plus the Git provenance gate proves the sole authorized transition.
- Accepted dashboard donor `692501587617d4880303fbd747d93e63c376f088` is integrated by exact IP-CONTROL equivalence: the donor and current `web/src/features/systemDashboard/**` trees are both `d3d899db3b0395532a3cf12b2304e91a2ce528ce` (21/21 files). Its stale root `DASH_INTEGRATION_NOTES.md` is explicitly superseded by `IP_CONTROL_MOUNT_REQUEST.md`; the shared-spine implementation now mounts the canonical Product Control provider and bindings into the application.
- Accepted L15 donor `2cec412927fa2f64f05a0b2774b18e45f8ce4fa5` is integrated by exact Git ancestry. Its 31-file `ops/live/**` tree remains exactly `584163858a0333cb1ccb9eff756e91a851b1cb71`; all 17 donor-owned `ops/tests/**` paths remain byte-identical while the enclosing target tree also retains previously accepted `ops/tests/i00/**`. Its root integration note is archived byte-identically at `docs/archive/i00-phase2/L15_OPS_INTEGRATION_NOTES.md` to preserve root-document law.
- Accepted A-CORE donor `08a0a09780727e2b4ba59017b5701998abe29b77` is integrated by exact Git ancestry with 36 donor paths. The integration overlay preserves the accepted A-CORE scanner bytes exactly while pinning the accepted L source hashes and operation-site sets; the current scan is 495 files / 198 discovered / 198 covered / 0 uncovered. The final source-freeze rerun after remaining shared wiring is still pending, and `CORE_SCAFFOLD_READY` is not relabeled as overall assurance readiness.
- Accepted A-HAZARD donor `ab33b3712cddd67c3ec91cfa1dd232c75226cd9f` is integrated by exact Git ancestry with 24 donor paths. Its systemic hazard fixtures remain evidence-only; serial-spine bindings are applied through canonical owners while all insertion evidence remains explicitly `DRAFT` and non-authoritative.
- Accepted A-COCKPIT donor `d4ff9c94c9fec9477481223c4b33d8f671a34f6d` is integrated by exact Git ancestry with 53 donor paths. Its cockpit/observability evidence remains fixture-only and cannot mint live green; the serial spine fulfills the mount requests through canonical Product owners without widening fixture authority.
- Accepted A-AGENT donor `97e87bd7045d2883ef8c4bd3cdb7f5daf83e0437` is integrated by exact Git ancestry with 20 byte-identical donor paths. Its immutable donor-tip suite passes `111/111`; on the accumulated branch, 109/109 integration-safe behavior checks pass and the two donor-context branch/path assertions are replaced by exact Git-object provenance rather than weakened.
- Accepted A-STABILITY donor `d35674e7f9621320c35e0bc0270efd515cc64dbd` is integrated by exact Git ancestry with 19 byte-identical donor paths. Its immutable donor-tip suite passes `212/212`; on the accumulated branch, 211/211 integration-safe behavior checks pass and the sole donor-context branch/path assertion is replaced by exact Git-object provenance. Resource ownership remains `UNKNOWN`.
- Accepted A-CASE/S4 donor `b4d8a446cb4cd6e77e7fbaf38f927b7513dc316c` is integrated by exact Git ancestry with 41 byte-identical donor paths. Its immutable donor-tip suite passes `233/233`; on the accumulated branch, 231/231 integration-safe behavior checks pass and the two lane-context assertions are replaced by exact Git ancestry/path proof. The projection remains `SYNTHETIC_ONLY` with `authorityEffect=NONE`.
- A-CASE/S4 accepted tip `b4d8a446cb4cd6e77e7fbaf38f927b7513dc316c` is integrated and receipted with exact `CASE_PRESTAGE_READY`; all 41 donor paths remain byte-identical.
- The former L refusal snapshot is superseded by exact clean donor tip `df6b472993ca9659ce09cf5f72004981c6835f0d`, tree `1add5ee43fea623509c20d0990ec9efac2543fc4`, `LIVE_EDGE_RECEIPT.md` SHA-256 `0b95db6e0ae8777d3e3bebb1a510561c7dfc9dcba963bd02fbc91025dd784fe2`, and L17 acceptance SHA-256 `f23e078fdd1cf8d64585c01b677817d4d4efa3a08f9c4933acae09b399ce2381`. Its worktree has no tracked dirt and exactly two protected owner directives. Required-last merge `ec82bc51d5311dfb3f505216bfb3fa41733f038c`, tree `7192a94883f6ac43d0c7d06b2a0f24275a7feef8`, has pre-L commit `139d2cf07ffd3167bd54a3c14c0fc6671c2f02e9` first and that exact L donor second; `docs/archive/i00-phase2/L_LANE_INTEGRATION_RECEIPT.md` seals it. L is integrated but its remaining shared wiring and candidate acceptance are pending. A-FORMAL tip `89c783bd9e55ce83c21ed1181757122d88e4c980` remains `BLOCKED_NO_NETWORK_BOUNDARY_VIOLATED`.
- Milestone tags (all pushed): `sprint-foundation-final`, `sprint-intelligence-final`, `sprint-runtime-final`, `sprint-capital-final`, `sprint-convergence-final`.
- Milestone commits on `current-main`: audited baseline `b272049` → organs round 1 `c4ae7a9` → organs round 2 `87af782` → convergence `b58e64e`.
- Feature branches preserved on origin as recovery points (`market-intelligence-main-20260711`, `backend-foundation-parallel-20260711-070056`, `live-intelligence-runtime-main-20260711`, `capital-supervision-main-20260711`, `system-convergence-vertical-slice-20260711`, `engine-overdrive`, `engine-volume-overdrive`).
- Workspace: canonical Main is `/Users/cosmosgeek/Desktop/Main`; the sole Phase 2 shared writer is `/Users/cosmosgeek/Desktop/i00-assembly` on `i00-product-assembly-20260713`. Donor worktrees are immutable recovery/audit points and are never bulk-copied.
- `.env`, `data/`, `dist/`, `node_modules/` are never tracked. Keys are server-side only.

## Component status (release labels are cumulative; see ARCHITECTURE.md)

| Component | Status |
| --- | --- |
| Audited product (services, Binance owners, ledger, cockpit) | LIVE_PUBLIC (keyless, public-only posture) |
| Basis engine + Volume engine (`server/src/engine/**`) | LIVE_PUBLIC — sole strategy authorities |
| Backend Foundation (`server/src/foundation/**`) | WIRED via adapters; accepted F-BRIDGE `a0c0c2e5ef3180aa720488463643433cefeb65e5` hardens terminalization and restart recovery; execution coordinator remains dry-run only; USD-M test-order boundary dormant/NOT wired |
| Market Intelligence (`server/src/intelligenceFoundation/**`) | WIRED as evidence substrate |
| Intelligence Runtime (`server/src/intelligenceRuntime/**`) | WIRED for composed public sources; continuous effectful feed = next work |
| Quant Edge research/inference donor (`quant/**`) | IMPORTED — exact accepted Q `LANE_READY` snapshot; advisory `ABSTAIN_UNKNOWN`, no accepted champion, no money authority; production transport/mount still NOT_CONFIGURED |
| Capital Supervision (`server/src/capitalFoundation/**`) | WIRED read/advisory; reservation authority UNAVAILABLE (needs real account truth) |
| System Integration (`server/src/systemIntegration/**`) | WIRED — composition root, supervisor, authenticated APIs, controls, vertical slice; accepted SI-RECON `f03ed786a8c5cab50ef27ad33026a74f79f7df87` preserves `DIVERGED` for contradictory working-order truth |
| Product Integration (`server/src/productIntegration/**`) | PRE-L WIRED / FOCUSED_PROVED — canonical routes, supervisor projection, durable material-event cursor and trace/control seams are mounted; no command owner is configured and complete runtime/restart acceptance is pending |
| Deployment/operations artifacts (`ops/live/**`, `ops/tests/**`) | IMPORTED — exact accepted L15 templates and network-free proof; no installation, AWS/Cloudflare mutation, deployment, or target readback |
| Product persistence (`server/src/ledger.ts`, System Integration adapter) | PRE-L WIRED / FOCUSED_PROVED — seven Product tables, durable material events, generic Ledger compare-and-set, command/config/reference/incident/boot seams, and exact quantity bridge are implemented |
| Product Assurance core (`server/src/productAssurance/**`) | COMPOSED / LOCAL_PROVED — exact A-CORE scanner bytes preserved; accepted L source/site identities pinned; 495 files, 198/198 operations covered, 0 uncovered; Product Assurance `802` behavior plus `4` provenance pass; final post-wiring source-freeze rerun remains pending |
| Product Control Room (`web/src/features/productControlRoom/**`) | PRE-L MOUNTED / FOCUSED_PROVED — one canonical provider binds the real route and shared page surfaces; browser ship-gate proof remains pending |
| Operator modes | READ_ONLY / ADVISORY / VALIDATE_ONLY only; kill switch fail-closed for new risk |
| Live execution / private or signed calls / borrow / transfer / AWS runner | MISSING or OWNER_GATED by design — production startup and routes are mechanically retired or fail closed; no ambient credential or cloud client is constructed |

## Verification (Phase 2 exact final-donor merge checkpoint, 2026-07-14)

```bash
npm run test:foundation  # exit 0; all 24 sorted files passed at the F-BRIDGE cut
npm run typecheck        # exit 0; current pre-L server and web trees
npm run build            # exit 0; current pre-L server and web trees; web built 1,878 modules with advisory chunk warning only
npm run test:app:built   # exit 0; 73/73 hostile built-app gates
npm test                 # exit 0 on the exact integration overlay
npm run test:all         # exit 0 on the exact integration overlay
node --test --test-concurrency=1 --test-reporter=spec server/test/i00Acceptance/authority-protocol.test.mjs  # 14/14
# Current Product Integration suite: 89/89. Product Control Room: 44/44. Full System Integration: 218/218.
# Focused health/CAS/operator/persistence/quantity bundle: 36/36. Persistence suite: 38/38.
# Server boundary proofs: 69/69 plus 146/146; focused health/quantity proof: 15/15.
# Post-merge L gates: L06 79/79; L12 21/21; L13 37/37; L14 38/38; LiveEdge 1,618/1,618 in 447743.267792ms.
# Post-merge owner gates: protocol 22/22; Foundation Control 97/97; SI controls/restart/routes 9/9.
# Product Assurance: 495 files; 198 discovered; 198 covered; 0 uncovered; 802 behavior + 4 provenance.
# I00 proof: 36/36 after re-pinning current Main QL objects and classifying L documentary source facts.
bash ops/tests/run-all.sh  # exit 0; 11/11 files; 347 assertions; network-free except loopback harnesses
node --test --test-concurrency=1 --test-reporter=spec "server/test/productAssurance/**/*.test.mjs"  # 32/32
node test/i00/product-assurance-operation-overlay.mjs --fail-on-uncovered  # 198/198; zero uncovered; exact accepted-L source/site pins
node --test --test-concurrency=1 --test-reporter=spec "test/productAssurance/systemic/hazard/**/*.test.mjs"  # 69/69
node --test --test-concurrency=1 test/productAssurance/systemic/cockpit/*.test.mjs  # 50/50
node --test --test-concurrency=1 test/productAssurance/systemic/observability/*.test.mjs  # 100/100
# Exact A-AGENT donor tip: 111/111. Integration-safe behavior with immutable branch/path context proofs replaced by Git-object provenance: 109/109.
# Exact A-STABILITY donor tip: 212/212. Integration-safe behavior with immutable branch/path context proof replaced by Git-object provenance: 211/211.
# Exact A-CASE/S4 donor tip: 233/233. Integration-safe behavior with immutable branch/lane context proofs replaced by Git-object provenance: 231/231.
# From a clean git archive of exact Q donor 02b4eccc with only its pinned .venv linked:
PYTHONPATH=src .venv/bin/python -m pytest tests/q17 -q --cov=quant_edge.final_proof --cov-branch --cov-report=term  # 384/384; 96.50%
PYTHONPATH=src .venv/bin/python -m pytest -q --tb=short  # 3,011 passed; 6 documented shard-only skips
```

F-BRIDGE focused proof is green: execution `173/173`, execution import purity `30/30`, compatibility `131/131`, reconciliation `75/75`. SI-RECON focused proof is `29/29`. Q is green only in the immutable donor view: focused `384/384` at `96.50%` and accumulated `3,011` plus six documented skips. Running Q17 against the combined target correctly produces `366 passed / 18 failed / 93.70%` because its immutable proof freezes the historical 1,568-byte directive lock; this is recorded diagnostic evidence, never reported as a green target-tree Q17 gate. The integration-owned provenance suite proves the exact D-LAUNCH-1 external supersession `14/14`. L15's complete network-free operational suite passes `11/11` files and 347 assertions. The exact final L merge passes L06 `79/79`, L12 `21/21`, L13 `37/37`, L14 `38/38`, full LiveEdge `1,618/1,618` in `447743.267792ms`, protocol `22/22`, Foundation Control `97/97`, and SI controls/restart/routes `9/9`. A-CORE passes `32/32`; A-HAZARD passes `69/69`; A-COCKPIT passes `50/50` plus observability `100/100`; A-AGENT passes `111/111` at its immutable tip and `109/109` integration-safe behavior checks; A-STABILITY passes `212/212` at its immutable tip and `211/211` integration-safe behavior checks; S4 passes `233/233` at its immutable tip and `231/231` integration-safe behavior checks. The exact integration overlay preserves A-CORE scanner bytes and pins accepted L source hashes/site sets: 495 files scanned, 198 operations discovered, 198 covered, 0 uncovered; Product Assurance passes `802` behavior plus `4` provenance. Current shared-spine evidence also retains Product Integration `89/89`, Product Control Room `44/44`, System Integration `218/218`, focused health/CAS/operator/persistence/quantity `36/36`, persistence `38/38`, boundary `69/69` plus `146/146`, built-app hostile gates `73/73`, typecheck/build, `npm test`, and `npm run test:all` at exit 0. I00 proof passes `36/36` after re-pinning current Main QL objects and classifying L documentary source facts. Remaining L shared wiring, the final post-wiring source-freeze rerun, runtime restart/readback, browser ship gate, and candidate receipt are still pending. The SI corrected expectation remains `DIVERGED`, not a weakened `PARTIAL` claim.

## What is genuinely live vs not

- **Implemented local public path:** Spot/USD-M acquisition, universe, Basis, Volume, supervisor and Product routes, seven-table SQLite Product persistence with durable cursors, and mounted cockpit truth surfaces. Final runtime/restart/browser acceptance is not yet claimed.
- **Dry-run/synthetic:** capital mandate fixture → Foundation risk → sealed validate-only two-leg coordinator → reconciliation fixtures.
- **Unavailable (honest gaps):** production capital/account truth; private reads; signed validation; exchange reconciliation against real fills; a canonical Product command owner; AWS/deployment; live execution. These remain `NOT_CONFIGURED`, `OWNER_GATED`, `UNKNOWN`, or mechanically blocked rather than fabricated green.

## Next build families (in order)

1. Complete the integrated L donor's remaining canonical shared wiring and focused owner proofs without creating a duplicate owner.
2. Freeze the final post-wiring source set and rerun the exact Product Assurance denominator plus repository gates.
3. Run deterministic scenarios, dependency-driven runtime startup/restart/readback, reconciliation, and the complete browser ship gate.
4. Seal `INTEGRATION_CANDIDATE_READY` only after all measured local acceptance passes; park read-only for independent Phase 3 verification and do not self-certify.
5. Preserve A-FORMAL as blocked and external/private/signed/AWS/deployment/money work as `OWNER_GATED` outside this branch's authority.

## Documentation map

Root (one file, one purpose): `README.md` quickstart/access · `MISSION.md` why and the edge hypotheses · `STATE.md` this file · `ARCHITECTURE.md` structure + canonical authority map · `AGENTS.md` rules for any coding agent · `DIRECTOR.md` how sprints are directed · `DESIGN.md` UI system + locked baselines.
History (evidence, superseded blueprints, sprint directives, receipts, research notes, the owner's original vision dump): `docs/archive/` — see its README. Receipts of future sprints go there too, with this file updated to point at the newest.
