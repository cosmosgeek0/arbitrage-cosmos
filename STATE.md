# STATE.md — current product state

This file owns current product state. `ARCHITECTURE.md` Part II owns code authority, `MISSION.md` owns purpose, and `verification/product-truth-20260716/STATE.md` alone owns campaign status and next action.

## Source scope

| Scope | Exact identity | State | Ruling |
| --- | --- | --- | --- |
| Historical corrected I00 source | `74eb452efab89ca92ec9ff5cb192b723b5f198f3` | `VERIFIED` | The independent C2 receipt reported 15 fixed, 0 refused, and 0 pending; the source was later landed. Historical evidence does not verify newer source. |
| Landed validate-only core | landing ancestry through `51efaaa4` | `INTEGRATED` | Existing engine, capital, risk, ledger, control, reconciliation, cockpit, operations, and assurance owners remain canonical. |
| Immutable rejected Pass-0 candidate C2 | `dea2d2a5c2b5e83d3aea75b0e368f0a478596561` | `REJECTED_CLEAN_CLONE` | C2 remains immutable and is the mandatory sole direct parent of C9. Historical custody does not transfer. |
| Rejected Defect Wave 2 candidate C3 | `78f708d6cdb9d1618c53d3f08f71097b4320a63b` | `REJECTED_FINAL_VERIFICATION` | C3 is not C9 ancestry. Its direct parent was evidence commit `4ec9e8640a22661f7e1649204348a212d94163e1`, and its cockpit and evidence contracts produced six final-verifier findings. |
| Rejected Defect Wave 3 candidate C4 | `4c9143a0bcc331aa170e9e26b741240b39df8b9e` | `REJECTED_REPORT_PARITY` | C4's focused gates passed, but its canonical and literal single-branch gates stopped at 42/44 because `integration/reports/i00-proof-evidence.json` was stale. C4 remains immutable and outside C9 ancestry. |
| Rejected Defect Wave 4 candidate C5 | `959a5f9900e25f53414710bbfb3464c3ccb67a5d` | `REJECTED_FINAL_VERIFICATION` | VFINAL5 accepted C5 topology and executable gates but rejected its unbound generator, incomplete 61-input map, stale census/ledger, and WATCHMAN local-success false green. C5 is outside C9 ancestry. |
| Rejected Defect Wave 5 candidate C6 | `89cd7e066b97f2f33d730d1e0adf291ebe7c4f64` | `REJECTED_CANONICAL_SECURITY_GATE` | C6 remains immutable. Its exact clean gate found that the new campaign contract test used forbidden `child_process` and environment access; C6 was not pushed or evidence-bound. |
| Rejected Defect Wave 5 integrity candidate C7 | `a283eb859ec1142aadecbd64e0b84959535f6216` | `REJECTED_EXACT_EVIDENCE_INTEGRITY` | C7 remains immutable. Its payload inventory checksum was stale after structural rewrite, and its landed-core provenance claimed 1,666 exact blobs where the candidate tree had 1,634. C7 was not amended, pushed, or evidence-bound. |
| Rejected Defect Wave 5 idempotence candidate C8 | `6ab02a82931ae8234456c0710cca41b94fdc12c9` | `REJECTED_EXACT_CENSUS_NON_IDEMPOTENT` | C8 remains immutable and unpushed. Its canonical and source clean-clone gates passed, but a second post-evidence generator pass rewrote the live `truth-a` HEAD/tree, status, diff identity, and inventory digest instead of reproducing exact-candidate census bytes. |
| Account A correction candidate C9 | The containing source commit; exact SHA is assigned only after this state is committed | `C9_SOURCE_READY_TO_FREEZE` | C9 preserves the C8 product and evidence corrections, normalizes mutable custody state to the exact frozen candidate after validating the exact evidence-only descendant, and makes the verifier assert that binding, directly on C2. |
| Governing director authority | D-LAUNCH-65 at `9c8c9f98c7fbd491fb97fce70d723b6c8bed2a4d` | `BOUND_INPUT_NOT_ANCESTRY` | Its `QL_DIRECTOR_STATE.md` bytes and VFINAL5 receipt bytes are candidate-tracked verifier payloads. Ambient or moving `current-main` is not evidence, and Account A never modifies or pushes `current-main`. |

The exact frozen C9 SHA cannot self-name inside its own commit. A later campaign evidence descendant must bind exact C9, its tree, its sole C2 parent, and its tracked bytes. No evidence-only commit may change C9 source; any later source correction is C10.

## Product posture

Cosmos Arbitrage Control Room remains one local validate-only product. Basis and Volume own strategy; intelligenceFoundation and intelligenceRuntime own evidence and public-source truth; capitalFoundation owns allocation and position policy; Foundation owns control, risk, execution contracts, and reconciliation; the existing Ledger owns durable history; System Integration composes those owners.

`LIVE_EXECUTION_NOT_IMPLEMENTED` remains enforced. No live order, test order, borrow, repay, leverage or margin mutation, transfer, withdrawal, private exchange read, signed exchange call, deployment, or credential use was authorized or exercised by this candidate campaign.

## Capability truth

| Capability dimension | State | Exact boundary |
| --- | --- | --- |
| Historical validate-only core | `VERIFIED` | Verification applies to historical C2R, not to the new candidate SHA. |
| Account A candidate source | `C9_SOURCE_READY_TO_FREEZE` | C9 is a single correction commit whose sole direct parent must byte-equal immutable C2. C3 through C8 and their evidence descendants are excluded from C9 ancestry. |
| AI-Ops source: egress, contracts, runtime, adapters, cockpit, proof, replay, operations, runbooks | `INTEGRATED` | Nine sealed lanes and the egress patch are exact second-parent candidate merges. |
| AI provider activation, worker lifecycle, product route, owner signatures, and external paging | `NOT_CONFIGURED` | Provider and runtime activation remain `NOT_CONFIGURED`. Canonical root gates now mount the branch-aware AI-Ops acceptance suites without implying operational activation. |
| AI-Ops composed production runtime | `UNWIRED` | AI code has no live capital, order, signing, self-approval, or silent production-patch authority. |
| A-FORMAL `b491893416006cf529aef02e5dd4a25d6475e7b8` source | `INTEGRATED` | Merged through `48a89d9f`; pure formal artifacts are admitted. |
| Formal runtime | `REFERENCE_ONLY` | TLA tooling is `NOT_CONFIGURED`; no runtime authority is granted. |
| S2 action evidence `ca30adf5e97b6697afec49f13073024d953b117b` source | `INTEGRATED` | Merged through `55b456e1`; its fixtures are supporting evidence only. |
| S2 production authority | `REFERENCE_ONLY` | No strategy, execution, risk, ledger, or remediation authority is granted. |
| Product Assurance invariant catalog | `INTEGRATED` | All 17 mandated pure families now exist; missing or false critical facts fail closed. |
| Rate-budget and expected-inventory production fact projections | `NOT_CONFIGURED` | Canonical owners remain `INTELLIGENCE_RUNTIME_RATE_BUDGET` and `I08_S5_COVERAGE_OWNER`; the evaluator does not duplicate either owner. |
| Ledger compare-and-set persistence and L06 adapter | `WIRED_LOCAL` | Existing Ledger performs the atomic local write. The L06 production append producer remains `NOT_CONFIGURED`; send capability is absent and external authorization is `NONE`. |
| Volume event persistence | `WIRED_LOCAL` | Memory observation dedupe is separate from ledger delivery; a failed delivery remains retryable, and only a successful ledger commit becomes durably deduped. |
| Basis and Volume lifecycle cleanup | `WIRED` | An asynchronous start rejection best-effort stops the partially started owner runtime, always retires its observation trackers, and preserves the original startup failure. |
| Foundation quantity comparison bridge | `VERIFIED` | It is a closed evidence-only comparison contract. Its production consumer remains `NOT_CONFIGURED`; it exposes no action schema. |
| A4 cockpit source | `INTEGRATED_FAIL_CLOSED` | Surface readiness is relational: any required `MISSING`, `UNKNOWN`, `UNAVAILABLE`, `NOT_CONFIGURED`, or `BLOCKED` datum forces `BLOCKED_BACKEND` and non-green rendering. Component, feed, strategy, and Watchman presentation truth is projected by the canonical server supervisor. A local refresh success is only an action acknowledgement and cannot change canonical health color or recovery wording. |
| Notification polling | `WIRED_BOUNDED` | The active premium Header tray uses one abortable settled poll with bounded HTTP requests. Failures retain last-known events and render explicit `STALE` or `UNAVAILABLE` feed truth instead of a false clear inbox. |
| Watchman browser health and public refresh | `WIRED_BOUNDED` | Health and sanitized browser-observation work share one abortable settled poll; public refresh acknowledgements have a finite deadline and release local busy state in `finally`. Canonical supervisor posture remains the only owner of Watchman health color and recovery wording. |
| Deployment, sentinel, paging, restore game-day, and rollback at staging | `NOT_CONFIGURED` | These are later owner and staging gates. |
| Deployment receipt and readback contracts | `BUILT_AND_TESTED` | Runtime validators compile the declared Draft 2020-12 schemas as structural authority before semantic, chronology, evidence, and SHA checks; unknown fields and wrong nested types fail closed. |
| Quant money-truth owner corrections | `WIRED_LOCAL — POST_ACCEPTANCE_CORRECTION_PENDING` | F-034/F-038/F-039 correct executable-basis denominator, directional economics, and instrument/unit identity bytes in the existing Q02/Q05/Q08 owners. FIX-017 additionally closes same-instrument and cross-unit basis pairing in Q08. Their historical phase identities, receipts, source seals, and primary-evidence pins remain immutable; Q17 verifies current correction seals/evidence separately as `NOT_ACCEPTED` and records FIX-017 as pending non-self-referential provenance. The canonical Q17 campaign regenerated and validated all eight proof-kit artifacts; the current component-manifest digest is `127687fb…8656fc`. |
| Quant inference timeout isolation | `WIRED_LOCAL — POST_ACCEPTANCE_CORRECTION_PENDING` | RB-13 runs each assessment in an explicit `spawn` worker over a bounded nonblocking, checksummed one-shot pipe frame. The parent watches both pipe readiness and the child sentinel; timeout, shutdown, partial/malformed/trailing data, or nonzero exit triggers bounded terminate/kill/reap before releasing the sole work slot. This changes post-C16/A16 bytes: the historical Q16/Q17 receipts do not attest RB-13, and independent exact-commit verification remains pending. The combined pending-correction self-excluding Q17 artifact-manifest digest is `0246146f…7eb45`; it is current generated evidence, not an acceptance seal. Admission, health, counters, and all advisory-only authority boundaries remain parent-owned. |
| Private account truth | `NOT_CONFIGURED` | No private credential or read was used. |
| Signed validation and test-order lifecycle | `DEFERRED_OWNER_GATE` | Separate durable owner authorization is required for each later gate. |
| Money movement and capital canaries | `DEFERRED_OWNER_GATE` | No authorization is implied by source, local wiring, tests, or a prior gate. |
| Forward economic edge | `ABSTAIN_UNKNOWN` | No forward runtime evidence establishes repeatable net value after costs. |
| Product-truth absence and exclusion proofs | `BUILT_AND_TESTED` | The exact-candidate generator binds zero-path proofs for the external verifier, external sentinel, and Frontier source, plus explicit Frontier reference ancestry dispositions; the verifier independently recomputes them from Git. Existing exact-C9 evidence is historical and is not relabeled by this source correction. |
| Frontier | `REFERENCE_ONLY` | It remains unauthorized and is not counted as accepted candidate source. |

## D-LAUNCH-65 evidence-input status

- The four durable prep inputs are preserved byte-identically under `verification/product-truth-20260716/wave1-inputs/`; the activation draft and canary precheck remain later-gate reference material only.
- The exact-only generator owns a normalized 61-row lock. Every row has a stable identifier, explicit source, explicit disposition, and matrix linkage; eight absent historical names remain honestly absent.
- All 23 external `content_oid` rows have raw candidate-tracked payload copies. A clean single-branch clone can rehash their bytes, SHA-256 values, lengths, and Git blob OIDs without Desktop paths or hidden refs.
- D-LAUNCH-65 `QL_DIRECTOR_STATE.md` and the VFINAL5 receipt are separately packaged and byte-bound. They remain authority/defect evidence, not executable inputs or candidate ancestry.
- The clean-clone proof generator is separated into deterministic tracked-byte evidence plus an ambient Git tri-state diagnostic. Moving refs and optional external objects are not baked into sealed report bytes.
- Candidate-root `QL_DIRECTOR_STATE.md` SHA-256 `95d4c276…` and `QL_PARALLEL_DAG.md` SHA-256 `89a13c8a…` are retained pre-D-LAUNCH-65 context only. The separately packaged D-LAUNCH-65 payload at commit `9c8c9f98c7fbd491fb97fce70d723b6c8bed2a4d` is the governing director overlay.
- The canonical Product Assurance gate includes A-FORMAL and S2 action-evidence suites. Canonical root gates now mount all 449 AI-Ops port/shadow tests; donor-only identity and scope assertions remain exact on their donor branches while integrated runs verify current-tree truth. Production AI provider/runtime authority remains `NOT_CONFIGURED`.
- `docs/archive/i00-phase4/STAGING_POST_L_TOPOLOGY_RECEIPT.v1.json` seals the exact 21-merge authorized post-L sequence through staging merge `90947e7e…39d6` without adding those sources to the original 16-donor equality count. The receipt-bound verifier pins its source commit/tree/parent, blob, SHA-256, schema, cut tree/parents, embedded allowlist, and independently derived Git topology; focused command contracts pass `29/29`, including hostile wrong-topology mutations. A-FORMAL and S2 remain candidate ancestors classified as integrated reference-only; PREVERIFY remains an explicit non-ancestor.
- The fixed matrix cardinalities remain 153 directive + 23 capability + 178 cockpit = 354. The evidence descendant must regenerate every candidate cell to exact C9; source mode cannot emit placeholders.
- Matrix rows `AIO-008`, `DEP-003`, and `FRT-000` now cite the executable exact generator/verifier rather than the retired throw-only generator. Regenerating a new exact-candidate evidence descendant remains a separate custody action; this branch does not rewrite or relabel historical C9 evidence.
- Focused proof is green at `47/47`; the acceptance contract is green at `47/47`, including a sole branch with no `current-main` ref. The five human I00 reports and machine report are refreshed from a clean tracked-byte source checkpoint.
- The historical D-LAUNCH-1 Q-lock supersession no longer requires a moving `current-main` ref or an ambient raw owner blob for sealed acceptance. Exact candidate-reachable commit/lock bytes and the director attestation are authoritative; ref/blob availability is diagnostic, with absent raw bytes reported as `DIRECTOR_COMMIT_ATTESTED_NOT_REHASHED`.
- `WORKTREE_LEDGER.md` records the immutable pre-freeze registry of 96 live worktrees, including `truth-a` and `truth-b`, plus five D-LAUNCH-65-authorized `REMOVED_SAFE` tombstones for 101 durable entries.
- Exact-C9 evidence generation validates live `truth-a` as either the exact candidate or the exact 15-path evidence descendant, then candidate-normalizes its mutable HEAD-derived census fields before hashing; a second pass must be byte-identical.
- Exact payload metadata carries separately named source-preparation lineage and a recomputed current inventory checksum; the verifier also recomputes the payload-set checksum from all 25 candidate-tracked files.
- Provenance v3 derives every lane match/mismatch count and all landed-core adaptation blobs from exact candidate Git trees; stale seed counts or nested candidate blobs are verifier failures.
- C2 through C8 gate artifacts are historical evidence only. No rejected candidate is eligible for relabeling as C9, and no prior custody transfers to C9.

## Defect Wave 5 and evidence-integrity adjudication

- C9 is created directly from immutable C2. Its commit object must have exactly one parent and that parent must equal `dea2d2a5c2b5e83d3aea75b0e368f0a478596561`; merge-base ancestry is insufficient.
- The accepted C5 source, all four VFINAL5 corrections, the C6 canonical-gate test correction, the C7 payload/provenance integrity correction, and the C8 census-idempotence correction are squashed directly onto C2 without importing C3 through C8 or an evidence descendant into C9 ancestry.
- Product Integration now projects `canonicalPresentation` for every canonical component and one server-owned `canonicalCockpit` object for market-feed readiness, strategy runtime, and Watchman posture. `web/src/lib/canonicalCockpitTruth.ts` is retired; mounted browser consumers cannot recompute supervisor posture, feed readiness, strategy readiness, or Watchman truth.
- Server, browser contract, surface renderer, and CSS share one relational readiness law. A required datum with a null value or blocking truth cannot coexist with `BINDING_READY`, green `LIVE_PUBLIC`, or an absent blocker. The hostile browser-contract test covers the rejected shape-valid false green.
- The rendered ship gate traverses Calendar through Dashboard, verifies the 22/540/30 title contract, audits all 18 surface rows as `data-surface-ready=false` / `BLOCKED` / `BLOCKED_BACKEND`, checks light and dark computed status colors, opens the canonical Trust Advisor, and leaves the owner's light theme restored with no browser errors.
- `integration/reports/i00-proof-evidence.json` is regenerated from the restricted tracked candidate source; its sealed bytes do not depend on richer ambient refs or unreachable Git objects.
- `RefreshDock` presents canonical WATCHMAN status for its launcher, dot, and health class. Local `/api/refresh` success may report `Public Refresh Completed` but cannot announce recovery or render green while canonical health remains outage.
- The source commit contains the fail-closed generator/schema correction and payload registry. Exact lock bytes, all 354 exact-C9 matrix cells, direct-parent proof, exact payload/provenance remeasurement, exact census, and manifests belong only to a later exact-C9 campaign evidence descendant.

## Current canonical gate evidence

These are measured results for the final merged staging tree; they do not alter the historical candidate rulings below.

| Command | Mounted denominator | Measured result |
| --- | ---: | --- |
| `npm test` | 452 = 3 hostile perimeter + 449 AI-Ops | Exit 0; 452/452 passed; AI-Ops reported 0 failed and 0 skipped. |
| `npm run test:all` | 3,514 = 3 hostile perimeter + 449 AI-Ops + 3,062 Quant | Exit 0; `CANONICAL_TEST_ALL PASS`; Quant reported 3,056 passed plus the six exact allowed Q08/Q15 donor-branch skips. |
| `npm run test:i00:commands` | 29 | Exit 0; 29/29 passed, including receipt-pinned post-landing ancestry and hostile topology mutations. |
| Product Assurance operation scan | 556 files / 226 discovered | 226/226 covered; 0 uncovered; 802 behavior checks and 4 provenance checks. |

## Real-gap campaign state

This branch is closing the ranked Bucket-D behaviors from `DIRECTIVE_GAP_TRIAGE.md` in exact order. Each row is independently committed with a focused hostile regression; full mounted denominators are remeasured only after the ranked list is complete.

| Rank | Item | State | Focused proof |
| ---: | --- | --- | --- |
| 1 | `FIX-031` | `BUILT_AND_TESTED` | Application bootstrap acquires one atomic PID/heartbeat lease before opening the canonical `DATA_DIR`, Ledger, boot generation, listener, or runtime. The hostile lease suite is 4/4, System Integration is 412/412, and live competitors exit before a second boot revision while dead same-host ownership recovers atomically. |
| 2 | `FIX-017` | `BUILT_AND_TESTED` | Q08 basis-path arithmetic now requires distinct instrument identities with matching base-size and quote-price units before cross-leg subtraction. The focused hostile file is 19/19, Q08 is 198 passed plus four exact shard-only skips, Q17 is 389/389, and the full Quant gate is 3,057 passed plus six exact allowed skips (3,063 total). Both owning generators reproduced current evidence (Q08 byte-identically; Q17 with explicit pending FIX-017 provenance). |
| 11 | `L-011` | `BUILT_AND_TESTED` | The canonical validate-only orchestrator now yields an exact `DATABASE_FAILURE_BEFORE_SEND` owner witness only when persistence fails before approval, risk, coordinator, reconciliation, or any sealed-venue call. The focused hostile regression proves one database read failure, one fail-closed durable result attempt, zero venue/submission calls, no execution plan, and no execution authority. |

## Previous source evidence

These are historical Account A builder measurements. They are not exact-C9 evidence or independent acceptance:

| Evidence | Measured result |
| --- | --- |
| Root deterministic/CI command `npm test` | Exit 0; typecheck, build, engines, focused security, Product Assurance, and I00 acceptance contract green; deterministic egress attempts 0. |
| Product Assurance | 555 scanned files; 205/205 operation sites covered; 0 uncovered; 802 behavior checks and 4 provenance checks. |
| Safety invariant focus | 17/17 catalog families; pass, missing-fact `UNKNOWN`, and false-fact `FAIL` paths verified. |
| Live-edge mutation journal adapter | 22/22; bounded Worker lifecycle, atomic race, restart, corruption, count capacity, and 512 KiB capacity proofs. |
| Candidate report parity | Historical pre-C4 acceptance was 44/44. Exact C4 was rejected at 42/44 because its machine report was stale; exact-C9 measurement occurs only after the containing source commit is frozen. |
| Generated authority evidence | `scanPassed=true`, `authorityConverged=true`, unresolved conflicts 0; 1,027 candidate definitions and 90 transport candidates inspected. |
| Diff hygiene | `git diff --check` exit 0 before this state rewrite. |

## Git and provenance rulings

- CI hotfix `6c6d1edd3e7bd7aecb3330d4cca3df087659f5dd` is in Main and candidate ancestry. Hotfix #2 `53c6da81` is `REFERENCE_ONLY`; its useful behavior was independently adapted without admitting its stale branch assumptions.
- The candidate has exact second-parent merges for egress, A1-A5, observability, operations, replay, runbooks, A-FORMAL, and S2. Their sealed donor tips are candidate ancestors.
- The Product Assurance historical merge-cut proof remains 193/193 blobs. Current source records seven explicit post-integration replacements, leaving 186 donor-identical HEAD blobs.
- Product Assurance now scans 556 files and exactly 226 discovered operations with zero uncovered sites.
- The five protected owner-directive root files are absent from this clean candidate checkout. Their exact committed verifier bundle remains verification-only and cannot impersonate live owner input.
- The retired Role 3 C2 receipt is historical `REFERENCE_ONLY` evidence for C2R. The campaign preserves its exact untracked bytes in a tracked evidence-only descendant; it does not reclassify that receipt as current-candidate verification.

## Known boundaries

- `BLOCKED`: C9 independent final verification, composed-runtime proof, and any acceptance beyond Account-A baseline evidence.
- `NOT_CONFIGURED`: AI provider execution, production AI routing, external paging, staging deployment, private account truth, signed exchange calls, test orders, and production consumers for the deferred bridges.
- Deployment remains `NOT_CONFIGURED`; canonical activation templates and the isolated probe now carry exact public-source startup admission while rejecting deterministic-offline conflicts.
- Owner-gated AWS control and the latency benchmark remain `NOT_CONFIGURED`; AWS provider calls, Foundation execution ports, baseline history fetches, and benchmark DNS/HTTP work now have bounded abortable deadlines with hostile never-settling regressions.
- `UNWIRED`: AI-Ops composed production runtime.
- `ABSTAIN_UNKNOWN`: production capacity and economic edge.
- `DEFERRED_OWNER_GATE`: private-read, signed-test, test-order, deployment, and every capital rung.

Campaign census, P0 rulings, exact candidate lock, clean-clone receipt, and the next action live only under `verification/product-truth-20260716/`.
