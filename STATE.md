# STATE.md — current product state

This file owns current product state. `ARCHITECTURE.md` Part II owns code authority, `MISSION.md` owns purpose, and `verification/product-truth-20260716/STATE.md` alone owns campaign status and next action.

## Source scope

| Scope | Exact identity | State | Ruling |
| --- | --- | --- | --- |
| Historical corrected I00 source | `74eb452efab89ca92ec9ff5cb192b723b5f198f3` | `VERIFIED` | The independent C2 receipt reported 15 fixed, 0 refused, and 0 pending; the source was later landed. Historical evidence does not verify newer source. |
| Landed validate-only core | landing ancestry through `51efaaa4` | `INTEGRATED` | Existing engine, capital, risk, ledger, control, reconciliation, cockpit, operations, and assurance owners remain canonical. |
| Account A product-truth candidate | the commit containing this state rewrite; source parent `f11531e6637979d6e173f6eb25d04c10a76d20c8` | `INTEGRATED` | Account A may assemble and fix. Independent exact-SHA verification remains `BLOCKED` until Account B receives the frozen commit. |
| Durable Main observed at freeze | `2ae812624f20b9bc93fc4ad66cb568929101110f` on local and `origin/current-main` | `INTEGRATED` | Main has 0 exact `aiOps` namespace paths. The Account A candidate has 161. No candidate merge or push to `current-main` is claimed. |

The exact frozen candidate SHA cannot self-name inside its own commit. The campaign `INPUTS.lock` binds the containing commit after it is created. No later evidence-only commit changes candidate source C.

## Product posture

Cosmos Arbitrage Control Room remains one local validate-only product. Basis and Volume own strategy; intelligenceFoundation and intelligenceRuntime own evidence and public-source truth; capitalFoundation owns allocation and position policy; Foundation owns control, risk, execution contracts, and reconciliation; the existing Ledger owns durable history; System Integration composes those owners.

`LIVE_EXECUTION_NOT_IMPLEMENTED` remains enforced. No live order, test order, borrow, repay, leverage or margin mutation, transfer, withdrawal, private exchange read, signed exchange call, deployment, or credential use was authorized or exercised by this candidate campaign.

## Capability truth

| Capability dimension | State | Exact boundary |
| --- | --- | --- |
| Historical validate-only core | `VERIFIED` | Verification applies to historical C2R, not to the new candidate SHA. |
| Account A candidate source | `INTEGRATED` | Exact-SHA Account B verification is pending. |
| AI-Ops source: egress, contracts, runtime, adapters, cockpit, proof, replay, operations, runbooks | `INTEGRATED` | Nine sealed lanes and the egress patch are exact second-parent candidate merges. |
| AI provider activation, worker lifecycle, product route, owner signatures, and external paging | `NOT_CONFIGURED` | Inert source integration precedes signatures; provider or worker start is blocked until the owner-signed manifests and deployment gates exist. |
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

## Current source evidence

These are Account A builder measurements before the containing source-freeze commit. They are not independent acceptance:

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

- `BLOCKED`: independent verification of exact candidate C, current-candidate cockpit proof, composed-runtime proof, and clean-clone Pass 3 beyond the P0 CI-equivalent check.
- `NOT_CONFIGURED`: AI provider execution, production AI routing, external paging, staging deployment, private account truth, signed exchange calls, test orders, and production consumers for the deferred bridges.
- `UNWIRED`: AI-Ops composed production runtime.
- `ABSTAIN_UNKNOWN`: production capacity and economic edge.
- `DEFERRED_OWNER_GATE`: private-read, signed-test, test-order, deployment, and every capital rung.

Campaign census, P0 rulings, exact candidate lock, clean-clone receipt, and the next action live only under `verification/product-truth-20260716/`.
