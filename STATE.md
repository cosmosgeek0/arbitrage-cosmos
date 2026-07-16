# STATE.md — current product state

This file owns current product state. `ARCHITECTURE.md` Part II owns code authority, `MISSION.md` owns purpose, and `verification/product-truth-20260716/STATE.md` alone owns campaign status and next action.

## Source scope

| Scope | Exact identity | State | Ruling |
| --- | --- | --- | --- |
| Historical corrected I00 source | `74eb452efab89ca92ec9ff5cb192b723b5f198f3` | `VERIFIED` | The independent C2 receipt reported 15 fixed, 0 refused, and 0 pending; the source was later landed. Historical evidence does not verify newer source. |
| Landed validate-only core | landing ancestry through `51efaaa4` | `INTEGRATED` | Existing engine, capital, risk, ledger, control, reconciliation, cockpit, operations, and assurance owners remain canonical. |
| Immutable rejected Pass-0 candidate C2 | `dea2d2a5c2b5e83d3aea75b0e368f0a478596561` | `REJECTED_CLEAN_CLONE` | C2 remains immutable. Its canonical gate passed, but the literal no-hardlink single-branch clone exposed the stale census contract and an unreachable dashboard donor object. C2 is not rewritten or relabeled. |
| Account A Defect Wave 2 candidate | The containing source commit; its exact SHA is assigned as C3 only after this state is committed | `C3_SOURCE_PENDING_LOCAL_GATES_AND_CUSTODY` | C3 is the new accepted source candidate only after the minimal census and donor-proof corrections are frozen. Account A must stop for director custody after local gates; C2 custody does not transfer. |
| Candidate source base Main | `2ae812624f20b9bc93fc4ad66cb568929101110f` | `INTEGRATED` | Later director-only `current-main` records, including D-LAUNCH-62 at `2a832750…`, are controlling evidence inputs rather than candidate ancestry. No candidate merge or push to `current-main` is claimed. |

The exact frozen C3 SHA cannot self-name inside its own commit. The campaign evidence child binds the containing commit after it is created. No later evidence-only commit changes candidate source C3.

## Product posture

Cosmos Arbitrage Control Room remains one local validate-only product. Basis and Volume own strategy; intelligenceFoundation and intelligenceRuntime own evidence and public-source truth; capitalFoundation owns allocation and position policy; Foundation owns control, risk, execution contracts, and reconciliation; the existing Ledger owns durable history; System Integration composes those owners.

`LIVE_EXECUTION_NOT_IMPLEMENTED` remains enforced. No live order, test order, borrow, repay, leverage or margin mutation, transfer, withdrawal, private exchange read, signed exchange call, deployment, or credential use was authorized or exercised by this candidate campaign.

## Capability truth

| Capability dimension | State | Exact boundary |
| --- | --- | --- |
| Historical validate-only core | `VERIFIED` | Verification applies to historical C2R, not to the new candidate SHA. |
| Account A candidate source | `C3_SOURCE_PENDING_LOCAL_GATES_AND_CUSTODY` | Defect Wave 2 preserves immutable C2, makes the exact donor proof clone-stable without weakening full-workspace proof, and reconciles the live worktree census. The containing source commit becomes C3; exact local gates and new custody remain mandatory. |
| AI-Ops source: egress, contracts, runtime, adapters, cockpit, proof, replay, operations, runbooks | `INTEGRATED` | Nine sealed lanes and the egress patch are exact second-parent candidate merges. |
| AI provider activation, worker lifecycle, product route, owner signatures, and external paging | `NOT_CONFIGURED` | AI-Ops root-test mount is also `NOT_CONFIGURED`; AI-Ops acceptance is explicitly excluded from the C2 baseline rather than inferred from `npm test`. |
| AI-Ops composed production runtime | `UNWIRED` | AI code has no live capital, order, signing, self-approval, or silent production-patch authority. |
| A-FORMAL `b491893416006cf529aef02e5dd4a25d6475e7b8` source | `INTEGRATED` | Merged through `48a89d9f`; pure formal artifacts are admitted. |
| Formal runtime | `REFERENCE_ONLY` | TLA tooling is `NOT_CONFIGURED`; no runtime authority is granted. |
| S2 action evidence `ca30adf5e97b6697afec49f13073024d953b117b` source | `INTEGRATED` | Merged through `55b456e1`; its fixtures are supporting evidence only. |
| S2 production authority | `REFERENCE_ONLY` | No strategy, execution, risk, ledger, or remediation authority is granted. |
| Product Assurance invariant catalog | `INTEGRATED` | All 17 mandated pure families now exist; missing or false critical facts fail closed. |
| Rate-budget and expected-inventory production fact projections | `NOT_CONFIGURED` | Canonical owners remain `INTELLIGENCE_RUNTIME_RATE_BUDGET` and `I08_S5_COVERAGE_OWNER`; the evaluator does not duplicate either owner. |
| Ledger compare-and-set persistence and L06 adapter | `WIRED_LOCAL` | Existing Ledger performs the atomic local write. The L06 production append producer remains `NOT_CONFIGURED`; send capability is absent and external authorization is `NONE`. |
| Foundation quantity comparison bridge | `VERIFIED` | It is a closed evidence-only comparison contract. Its production consumer remains `NOT_CONFIGURED`; it exposes no action schema. |
| A4 cockpit source | `INTEGRATED` | Current-candidate browser and complete cockpit verification remains `BLOCKED`; absent slots must render `MISSING` or `NOT_CONFIGURED`, never green. |
| Deployment, sentinel, paging, restore game-day, and rollback at staging | `NOT_CONFIGURED` | These are later owner and staging gates. |
| Private account truth | `NOT_CONFIGURED` | No private credential or read was used. |
| Signed validation and test-order lifecycle | `DEFERRED_OWNER_GATE` | Separate durable owner authorization is required for each later gate. |
| Money movement and capital canaries | `DEFERRED_OWNER_GATE` | No authorization is implied by source, local wiring, tests, or a prior gate. |
| Forward economic edge | `ABSTAIN_UNKNOWN` | No forward runtime evidence establishes repeatable net value after costs. |
| Frontier | `REFERENCE_ONLY` | It remains unauthorized and is not counted as accepted candidate source. |

## D-LAUNCH-62 Wave 1 status

- The four durable prep inputs are preserved byte-identically under `verification/product-truth-20260716/wave1-inputs/`; the activation draft and canary precheck remain later-gate reference material only.
- The complete input lock now carries 61 controlling, candidate-law/lock, Wave-1, superseded-available, and superseded-absent rows, including the candidate-tracked QL director state and DAG. The D-LAUNCH-62 Main object is rehashed and blob-verified; the prior D-LAUNCH-61 receipt is preserved as historical old-C custody and explicitly has no C2 custody effect.
- The clean-clone proof generator is separated into deterministic tracked-byte evidence plus an ambient Git tri-state diagnostic. Moving refs and optional external objects are not baked into sealed report bytes.
- The accepted current director-owned QL bytes are `QL_DIRECTOR_STATE.md` SHA-256 `95d4c276…` and `QL_PARALLEL_DAG.md` SHA-256 `89a13c8a…`; D-LAUNCH-7 historical pins remain preserved separately.
- The canonical Product Assurance gate now includes A-FORMAL and S2 action-evidence suites. AI-Ops port/shadow suites remain deliberately root-unmounted and excluded from C2 acceptance because their branch-specific assumptions are not candidate-compatible.
- The I00 donor/topology contract now admits the exact authorized post-L merge sequence without adding those sources to the original 16-donor equality count. A-FORMAL and S2 are candidate ancestors classified as integrated reference-only; PREVERIFY remains an explicit non-ancestor. Focused command contracts pass `28/28`.
- All 14 durable Wave-1 findings are adjudicated. The coverage matrix has 153 rows, including 17 explicit Frontier dispositions, the missing permanent-law rows, and honest absent-control/AI-Ops boundaries; the capability matrix has 23 rows.
- Focused proof is green at `47/47`; the acceptance contract is green at `44/44`, including a sole branch with no `current-main` ref. The five human I00 reports and machine report are refreshed from a clean tracked-byte source checkpoint.
- The historical D-LAUNCH-1 Q-lock supersession no longer requires a moving `current-main` ref or an ambient raw owner blob for sealed acceptance. Exact candidate-reachable commit/lock bytes and the director attestation are authoritative; ref/blob availability is diagnostic, with absent raw bytes reported as `DIRECTOR_COMMIT_ATTESTED_NOT_REHASHED`.
- Exact-C2 evidence generation now reads candidate bytes rather than mutable evidence-child seeds, classifies historical active-name artifacts, confines the post-C2 diff to the campaign directory, and requires the exact candidate-bound gate report before generating the manifest.
- C2 exact canonical results remain historical builder evidence only; its clean-clone failure rejects C2 as the source candidate. C3 must independently rerun the complete canonical and literal local clean-clone batteries, then stop for new director custody before any live-remote clone. Wave 1b security and cockpit findings remain pending.

## Defect Wave 2 adjudication

- The live Git worktree inventory, not a numeric constant, now supplies the expected registered-worktree count. Exact name-policy reconciliation still fails closed on any unknown, unexpectedly restored, or missing live lane.
- `prep-act`, `shard-prov`, `shard-sec`, `v-clean`, and `v-cockpit` are explicit `REMOVED_SAFE` tombstones under D-LAUNCH-65. The four accepted outputs are verified byte-for-byte from exact commit `0e4b364849075a454d7dd624ca068c238f4196c2` into candidate-tracked Wave-1 inputs; `shard-sec` and `v-cockpit` are explicitly `NO_ACCEPTED_OUTPUT`.
- I00 donor equality retains the genuine live full-workspace Git-object/worktree proof. Only an automatically detected, detached, non-shallow, single-worktree/single-branch clone with no `current-main` ref or alternates may use the exact C2-tracked receipt authority. That mode rechecks candidate-reachable integration commits and receipts, the dashboard sealed cut, and current topology; only `DASHBOARD-SHELL` and `PREVERIFY` may be absent as declared non-ancestors. Any missing merge-parent donor fails closed.
- The campaign evidence child must record immutable C2 and exact C3 separately. It may not call the evidence child a replacement C3, inherit C2 custody, or claim final acceptance or deployment readiness.

## Previous source evidence

These are Account A builder measurements from the superseded old-C cycle. They are not C2 evidence or independent acceptance:

| Evidence | Measured result |
| --- | --- |
| Root deterministic/CI command `npm test` | Exit 0; typecheck, build, engines, focused security, Product Assurance, and I00 acceptance contract green; deterministic egress attempts 0. |
| Product Assurance | 555 scanned files; 205/205 operation sites covered; 0 uncovered; 802 behavior checks and 4 provenance checks. |
| Safety invariant focus | 17/17 catalog families; pass, missing-fact `UNKNOWN`, and false-fact `FAIL` paths verified. |
| Live-edge mutation journal adapter | 22/22; bounded Worker lifecycle, atomic race, restart, corruption, count capacity, and 512 KiB capacity proofs. |
| Candidate report parity | 44/44 I00 performance/acceptance tests; candidate-HEAD parity passed in clean detached checkouts and a sole branch not named `current-main`. |
| Generated authority evidence | `scanPassed=true`, `authorityConverged=true`, unresolved conflicts 0; 1,027 candidate definitions and 90 transport candidates inspected. |
| Diff hygiene | `git diff --check` exit 0 before this state rewrite. |

## Git and provenance rulings

- CI hotfix `6c6d1edd3e7bd7aecb3330d4cca3df087659f5dd` is in Main and candidate ancestry. Hotfix #2 `53c6da81` is `REFERENCE_ONLY`; its useful behavior was independently adapted without admitting its stale branch assumptions.
- The candidate has exact second-parent merges for egress, A1-A5, observability, operations, replay, runbooks, A-FORMAL, and S2. Their sealed donor tips are candidate ancestors.
- The Product Assurance historical merge-cut proof remains 193/193 blobs. Current source records seven explicit post-integration replacements, leaving 186 donor-identical HEAD blobs.
- Product Assurance now scans 555 files and exactly 205 discovered operations with zero uncovered sites.
- The five protected owner-directive root files are absent from this clean candidate checkout. Their exact committed verifier bundle remains verification-only and cannot impersonate live owner input.
- The retired Role 3 C2 receipt is historical `REFERENCE_ONLY` evidence for C2R. The campaign preserves its exact untracked bytes in a tracked evidence-only descendant; it does not reclassify that receipt as current-candidate verification.

## Known boundaries

- `BLOCKED`: independent verification of exact C2, current-candidate cockpit proof, composed-runtime proof, and independent clean-clone acceptance beyond Account-A builder evidence.
- `NOT_CONFIGURED`: AI provider execution, production AI routing, external paging, staging deployment, private account truth, signed exchange calls, test orders, and production consumers for the deferred bridges.
- `UNWIRED`: AI-Ops composed production runtime.
- `ABSTAIN_UNKNOWN`: production capacity and economic edge.
- `DEFERRED_OWNER_GATE`: private-read, signed-test, test-order, deployment, and every capital rung.

Campaign census, P0 rulings, exact candidate lock, clean-clone receipt, and the next action live only under `verification/product-truth-20260716/`.
