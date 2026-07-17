# STATE.md — current product state

This file owns current product state. `ARCHITECTURE.md` Part II owns code authority, `MISSION.md` owns purpose, and `verification/product-truth-20260716/STATE.md` alone owns campaign status and next action.

## Source scope

| Scope | Exact identity | State | Ruling |
| --- | --- | --- | --- |
| Historical corrected I00 source | `74eb452efab89ca92ec9ff5cb192b723b5f198f3` | `VERIFIED` | The independent C2 receipt reported 15 fixed, 0 refused, and 0 pending; the source was later landed. Historical evidence does not verify newer source. |
| Landed validate-only core | landing ancestry through `51efaaa4` | `INTEGRATED` | Existing engine, capital, risk, ledger, control, reconciliation, cockpit, operations, and assurance owners remain canonical. |
| Immutable rejected Pass-0 candidate C2 | `dea2d2a5c2b5e83d3aea75b0e368f0a478596561` | `REJECTED_CLEAN_CLONE` | C2 remains immutable and is the mandatory sole direct parent of C4. Its historical custody does not transfer to C4. |
| Rejected Defect Wave 2 candidate C3 | `78f708d6cdb9d1618c53d3f08f71097b4320a63b` | `REJECTED_FINAL_VERIFICATION` | C3 is not C4 ancestry. Its direct parent was evidence commit `4ec9e8640a22661f7e1649204348a212d94163e1`, and its cockpit and evidence contracts produced six final-verifier findings. |
| Account A Defect Wave 3 candidate C4 | The containing source commit; exact SHA is assigned only after this state is committed | `FROZEN_C4_SOURCE` | The containing commit reapplies the accepted clean-clone corrections directly onto C2 and adds the fail-closed cockpit and canonical-authority product fixes. Campaign evidence and custody remain separate later-child gates. |
| Candidate source base Main | `2ae812624f20b9bc93fc4ad66cb568929101110f` | `INTEGRATED` | Later director-only `current-main` records, including D-LAUNCH-62 at `2a832750…`, are controlling evidence inputs rather than candidate ancestry. No candidate merge or push to `current-main` is claimed. |

The exact frozen C4 SHA cannot self-name inside its own commit. The campaign evidence descendant binds that source commit after it is created. No later evidence-only commit changes candidate source C4, and any later source correction is C5.

## Product posture

Cosmos Arbitrage Control Room remains one local validate-only product. Basis and Volume own strategy; intelligenceFoundation and intelligenceRuntime own evidence and public-source truth; capitalFoundation owns allocation and position policy; Foundation owns control, risk, execution contracts, and reconciliation; the existing Ledger owns durable history; System Integration composes those owners.

`LIVE_EXECUTION_NOT_IMPLEMENTED` remains enforced. No live order, test order, borrow, repay, leverage or margin mutation, transfer, withdrawal, private exchange read, signed exchange call, deployment, or credential use was authorized or exercised by this candidate campaign.

## Capability truth

| Capability dimension | State | Exact boundary |
| --- | --- | --- |
| Historical validate-only core | `VERIFIED` | Verification applies to historical C2R, not to the new candidate SHA. |
| Account A candidate source | `FROZEN_C4_SOURCE` | Defect Wave 3 source is a sole-direct-parent child of immutable C2. C3 is excluded from ancestry; exact C4 evidence and custody are campaign gates, not source mutations. |
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
| A4 cockpit source | `INTEGRATED_FAIL_CLOSED` | Surface readiness is relational: any required `MISSING`, `UNKNOWN`, `UNAVAILABLE`, `NOT_CONFIGURED`, or `BLOCKED` datum forces `BLOCKED_BACKEND` and non-green rendering. Component, feed, strategy, and Watchman presentation truth is projected by the canonical server supervisor; the browser only renders it or fails closed on continuity. |
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
- C2 and C3 gate artifacts are historical evidence only. Neither candidate is eligible for relabeling as C4, and neither candidate's custody transfers to C4.

## Defect Wave 2 and 3 adjudication

- C4 is created directly from immutable C2. Its commit object must have exactly one parent and that parent must equal `dea2d2a5c2b5e83d3aea75b0e368f0a478596561`; merge-base ancestry is insufficient.
- The accepted Defect Wave 2 census and donor corrections are reapplied as source changes without importing the C2 evidence commit, C3, or any C3 evidence descendant into C4 ancestry.
- Product Integration now projects `canonicalPresentation` for every canonical component and one server-owned `canonicalCockpit` object for market-feed readiness, strategy runtime, and Watchman posture. `web/src/lib/canonicalCockpitTruth.ts` is retired; mounted browser consumers cannot recompute supervisor posture, feed readiness, strategy readiness, or Watchman truth.
- Server, browser contract, surface renderer, and CSS share one relational readiness law. A required datum with a null value or blocking truth cannot coexist with `BINDING_READY`, green `LIVE_PUBLIC`, or an absent blocker. The hostile browser-contract test covers the rejected shape-valid false green.
- The rendered ship gate traverses Calendar through Dashboard, verifies the 22/540/30 title contract, audits all 18 surface rows as `data-surface-ready=false` / `BLOCKED` / `BLOCKED_BACKEND`, checks light and dark computed status colors, opens the canonical Trust Advisor, and leaves the owner's light theme restored with no browser errors.
- Candidate-backed lock bytes, complete 61-input source/disposition coverage, exact-C4 `candidate_sha` cells, direct-parent topology proof, canonical gate output, and local no-hardlink single-branch preflight belong only to the exact-C4 campaign evidence descendant.

## Previous source evidence

These are historical Account A builder measurements. They are not exact-C4 evidence or independent acceptance:

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

- `BLOCKED`: C4 custody, independent final verification, composed-runtime proof, and any acceptance beyond Account-A local evidence.
- `NOT_CONFIGURED`: AI provider execution, production AI routing, external paging, staging deployment, private account truth, signed exchange calls, test orders, and production consumers for the deferred bridges.
- `UNWIRED`: AI-Ops composed production runtime.
- `ABSTAIN_UNKNOWN`: production capacity and economic edge.
- `DEFERRED_OWNER_GATE`: private-read, signed-test, test-order, deployment, and every capital rung.

Campaign census, P0 rulings, exact candidate lock, clean-clone receipt, and the next action live only under `verification/product-truth-20260716/`.
