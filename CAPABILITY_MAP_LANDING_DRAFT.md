# Capability map landing draft — D-LAUNCH-24

Draft status: **DRAFT-UNTIL-CANDIDATE-SHA / NON-DONOR / NOT CURRENT ROOT TRUTH**

Observed integration ref: `i00-product-assembly-20260713@18a0b9d1153a5f4bb6c8b42909362c6a295475bb`, tree `135ec02a6615741307c323b561bf999e2d71ab20`

Prepared from: `preverify-20260714@0b566d6e48b41c187574603802c1c238d1d19ade`

The observed post-L seal reports 16 expected/discovered/receipt-accepted/integrated donors, with A-FORMAL excluded and S2 absent/not configured. The frozen candidate must regenerate its own denominator and every blocked/missing disposition; this map does not make 16 a landing constant.

This is the post-integration replacement for the QL_DIRECTOR_STATE-style capability map. It is a Phase-5 drafting aid, not a new canonical root document. The director should fold the adjusted map into the final `STATE.md` component/release matrix and, where useful, `ARCHITECTURE.md` Part I; then archive or omit this draft under the one-file-per-purpose law.

The buckets are orthogonal where necessary: `SYNTHETIC` states what kind of evidence exists, while `UNWIRED-DORMANT` states whether production composition exists. A component can truthfully be both. `BUILT_AND_TESTED_UNWIRED` means exactly “built/tested evidence exists; production wiring does not.” It never means `WIRED`, `LIVE_PUBLIC`, private, deployed, trade-ready, or live.

All observed labels below must be refreshed at `[CANDIDATE_SHA]` and independently checked at `[ROLE3_VERIFIED_SHA]`.

## LIVE_PUBLIC

| Exact component | Observed post-integration label | Exact truth boundary | Candidate substitution/proof |
| --- | --- | --- | --- |
| `MarketEngine` (`server/src/engine/marketData.ts`) plus accepted physical public producers in `BasisRuntime` and `VolumeRuntime` | `LIVE_PUBLIC` for keyless public Spot/USD-M acquisition only | Public market observation, universe, book/funding/liquidation/trade delivery as owned by Intelligence Runtime/engine adapters. No private/account/signed capability follows. | `[FINAL_PUBLIC_SOURCE_FRESHNESS_SEQUENCE_RESTART_PROOF]` |
| `BasisEngine` (`server/src/engine/basis/**`) | `LIVE_PUBLIC` strategy authority | Sole Basis decision, score, proposal and invalidation owner. LiveEdge and Q are advisory/evidence-only. | `[FINAL_BASIS_RUNTIME_ADVANCEMENT_PROOF]` |
| `VolumeEngine` and `FocusManager` (`server/src/engine/volume/**`) | `LIVE_PUBLIC` strategy authority | Sole Volume detection, confidence, focus and proposal owner. | `[FINAL_VOLUME_RUNTIME_ADVANCEMENT_PROOF]` |
| Existing authenticated public-only application APIs and legacy cockpit pages | `LIVE_PUBLIC` only to the extent their canonical public owners report fresh truth | Private Binance client construction is mechanically disabled in the observed integration tree. A page being mounted does not make its unknown/private fields live. | `[FINAL_BUILT_APP_AND_BROWSER_PUBLIC_TRUTH_PROOF]` |

No Q, LiveEdge, Product Assurance, IP-OPS or IP-PROOF donor component is `LIVE_PUBLIC`. Product Integration may preserve an upstream `LIVE_PUBLIC` label but does not own live acquisition.

## WIRED

| Exact component | Observed post-integration label | Exact truth boundary | Candidate substitution/proof |
| --- | --- | --- | --- |
| Intelligence Foundation (`server/src/intelligenceFoundation/**`) | `WIRED` | Evidence/features/attention/thesis/forensics substrate only; not strategy or action authority. | `[FINAL_INTELLIGENCE_FOUNDATION_PROOF]` |
| Intelligence Runtime (`server/src/intelligenceRuntime/**`) | `WIRED` for composed public sources | Sole semantic source lifecycle/freshness/sequence/backpressure owner. Continuous final-candidate advancement/restart must still be measured. | `[FINAL_INTELLIGENCE_RUNTIME_PROOF]` |
| Capital Foundation (`server/src/capitalFoundation/**`) | `WIRED_READ_ADVISORY` | Capital eligibility/economics/supervision are wired; reservation/staging stays `UNAVAILABLE` without real account truth and a valid mandate. | `[FINAL_CAPITAL_PROOF]` |
| Foundation Control and Risk (`server/src/foundation/control/**`, `server/src/foundation/risk/**`) | `WIRED_VALIDATE_ONLY` | One whole-machine control owner and one final multi-leg Risk owner. | `[FINAL_CONTROL_RISK_PROOF]` |
| System Integration (`server/src/systemIntegration/**`) | `WIRED` | Sole production composition root and machine supervisor for the exact 13 components listed below; SI-RECON preserves `DIVERGED` for contradictory working-order truth. | `[FINAL_SYSTEM_INTEGRATION_RUNTIME_RESTART_PROOF]` |
| Existing Ledger plus Product persistence (`server/src/ledger.ts`, `server/src/systemIntegration/persistence/**`) | `WIRED / FOCUSED_PROVED` | Sole durable history owner. Seven Product tables and durable `product_operator_events` cursor exist; not every command/incident consumer is configured. | `[FINAL_LEDGER_CAS_CURSOR_RESTART_PROOF]` |
| `ProductIntegrationRuntimeService` and router (`server/src/productIntegration/runtime/**`) | `WIRED / FOCUSED_PROVED`, not candidate-live | Mounted once at `/api/product-integration` with five authenticated endpoints: supervisor, material events, trace, command preview, command submit. It projects System Integration/Ledger truth and owns no domain verdict. Current focused suite: `89/89`. | `[FINAL_PRODUCT_RUNTIME_AND_READBACK_PROOF]` |
| `ProductControlRoomProvider`, `ProductControlRoomRoute`, `ProductControlRoom`, and 18 surface contracts under `web/src/features/productControlRoom/**` | `MOUNTED / FOCUSED_PROVED / BROWSER_SHIP_GATE_PENDING` | One full Control Room route plus 17 compact adapters. Continuity gaps retain stale labeled truth and block controls. Current focused suite: `44/44`. | `[FINAL_BROWSER_SHIP_GATE_AND_CONTROL_BEHAVIOR_PROOF]` |
| `SystemDashboard` (`web/src/features/systemDashboard/**`) embedded with `readOnlyProjection` | `WIRED_RENDERER / BROWSER_SHIP_GATE_PENDING` | Renders the canonical supervisor snapshot inside Product Control Room; production suppresses donor interactive Attention/Controls panels. It owns no inventory, readiness, Risk, exposure, or control truth. | `[FINAL_UNKNOWN_EXPOSURE_AND_RENDERED_TRUTH_PROOF]` |
| Product Assurance root verification gate (`test/i00/run-product-assurance.mjs`) | `WIRED_TEST_GATE_ONLY` | Included by `test:product-assurance:built`, `test:deterministic:built`, and `npm test`; this is test-lane wiring, not application/runtime wiring. Observed assembled proof: `802` behavior + `4` provenance, 495 files, 198/198 operations, zero uncovered. | `[FINAL_SOURCE_FROZEN_ASSURANCE_DENOMINATOR]` |
| IP-PROOF acceptance runner (`server/test/i00Acceptance/**`, `test/i00/{git-provenance,render-reports,run,scope-security,verify-scope}.mjs`) | `COMPOSED_TEST_GATE_ONLY` | Uses the exact proof fixture chain excluding Product Assurance-owned I00 tests/manifest and is wired into `test:i00:proof:built`/`test:all`; owns no product/runtime truth. Observed pre-candidate proof: `36/36`. | `[FINAL_CANDIDATE_REGENERATED_PROOF_RESULT]` |

### Exact managed-component registry

The System Integration managed-component registry contains exactly these 13 production component IDs at the observed ref:

| Component ID | Canonical owner/path |
| --- | --- |
| `public-spot-source` | `INTELLIGENCE_RUNTIME` / `server/src/intelligenceRuntime/**` |
| `public-usdm-source` | `INTELLIGENCE_RUNTIME` / `server/src/intelligenceRuntime/**` |
| `market-universe` | `AUDITED_APP` / `server/src/engine/marketData.ts` |
| `intelligence-runtime` | `INTELLIGENCE_RUNTIME` / `server/src/intelligenceRuntime/**` |
| `market-intelligence` | `MARKET_INTELLIGENCE` / `server/src/intelligenceFoundation/**` |
| `basis-engine` | `BASIS_ENGINE` / `server/src/engine/basis/**` |
| `volume-engine` | `VOLUME_ENGINE` / `server/src/engine/volume/**` |
| `capital-supervision` | `CAPITAL_SUPERVISION` / `server/src/capitalFoundation/**` |
| `multileg-risk` | `BACKEND_FOUNDATION_RISK` / `server/src/foundation/risk/**` |
| `execution-coordinator-validate-only` | `BACKEND_FOUNDATION_EXECUTION` / `server/src/foundation/execution/**` |
| `reconciliation` | `BACKEND_FOUNDATION_RECONCILIATION` / `server/src/foundation/reconciliation/**` |
| `ledger-persistence` | `EXISTING_LEDGER` / `server/src/ledger.ts` |
| `engine-supervisor` | `SYSTEM_INTEGRATION` / `server/src/systemIntegration/**` |

Product Integration projects this registry; it is not a fourteenth component. Packet fixture IDs (`spot-public-source`, `q-inference`, `risk-gate`, `execution-hand`, `recovery`, `machine-supervisor`) are not production IDs.

## VALIDATE_ONLY

| Exact component/capability | Observed label | Exact boundary | Candidate substitution/proof |
| --- | --- | --- | --- |
| Operator modes | `READ_ONLY / ADVISORY / VALIDATE_ONLY` | No live/manual/autonomous execution mode exists. Kill switch and intake gates remain fail-closed. | `[FINAL_CONTROL_MODE_PROOF]` |
| Foundation multi-leg Risk -> execution coordinator (`server/src/foundation/{risk,execution}/**`) | `VALIDATE_ONLY / DRY_RUN` | The coordinator uses a sealed in-process fake port. No signed, test, private, or live transport is present. | `[FINAL_VALIDATE_ONLY_CHAIN_PROOF]` |
| Foundation reconciliation/recovery (`server/src/foundation/reconciliation/**`) | `VALIDATE_ONLY` over local/synthetic/read-only evidence | Ambiguity, divergence, stale or unavailable truth blocks new/increasing exposure; current SI correction expects `DIVERGED`, not weakened `PARTIAL`. | `[FINAL_RESTART_RECONCILIATION_PROOF]` |
| Product Integration/Control Room projection of validate-only truth | `READ_ONLY_PROJECTION` | It may display the canonical coordinator/reconciliation state but owns none of the mechanics. | `[FINAL_UI_VALIDATE_ONLY_LABEL_PROOF]` |

`VALIDATE_ONLY` is not a synonym for tests, assurance, proof, simulation, or Q advisory inference. IP-PROOF and Product Assurance do not belong in this bucket as authorities.

## SYNTHETIC

| Exact component/evidence | Synthetic label | Exact non-claim |
| --- | --- | --- |
| Capital mandate, account/cost and reconciliation fixtures | `SYNTHETIC_ONLY` | No production account truth, reservation, exchange fill or PnL truth. |
| LiveEdge Exchange Twin (`server/src/liveEdge/adapters/exchangeTwin/**`) | `SYNTHETIC_FIXTURE / BUILT_AND_TESTED_UNWIRED` | Deterministic scenario reduction only; no connector, OMS, fill, position, reconciliation or action authority. |
| LiveEdge execution policy (`server/src/liveEdge/adapters/executionPolicy/**`) | `SYNTHETIC_FIXTURE / ADVISORY_EXECUTION_MECHANICS_ONLY / BUILT_AND_TESTED_UNWIRED` | No Capital, Risk, coordinator, sender, retry or recovery authority. |
| LiveEdge Normal Basis, Reverse Basis and Volume lifecycle projections | `SYNTHETIC_FIXTURE / BUILT_AND_TESTED_UNWIRED` | Owner-evidence projections only; Basis/Volume/Foundation/Capital remain canonical. |
| LiveEdge exposure/recovery and machine-graph evidence | `SYNTHETIC_ONLY / BUILT_AND_TESTED_UNWIRED` | L12 is not a recovery supervisor; L13 is not a machine graph/readiness owner. |
| Quant `quant_edge.core` | `SYNTHETIC_DETERMINISM` | Research-only. |
| Quant `quant_edge.lake` | `SYNTHETIC_GOLDEN` | Isolated research lake, not product acquisition/history. |
| Quant `quant_edge.bootstrap` | `REAL_ARCHIVE_WITH_EXPLICIT_FORWARD_GAPS` | Historical research evidence, not live acquisition. |
| Quant `quant_edge.book` | `SYNTHETIC_REPLAY_GOLDEN` | Replay evidence only. |
| Quant `quant_edge.labels` | `SYNTHETIC_LABEL_GOLDEN` | Labels remain insufficient for an established edge. |
| Quant `quant_edge.features` | `SYNTHETIC_FEATURE_GOLDEN` | Research feature evidence only. |
| Quant `quant_edge.micro` | `SYNTHETIC_MICROSTRUCTURE_GOLDEN` | Research evidence only. |
| Quant `quant_edge.derivatives`, `regime`, `models`, `survival`, `ensemble`, `validation` | `SYNTHETIC_ONLY` | No strategy, capital or action authority. |
| Quant `quant_edge.deep` | `DATA_INSUFFICIENT_REFERENCE_ONLY` | Deep result remains failed for insufficient data. |
| Quant `quant_edge.registry_ops` | `SYNTHETIC_ONLY_MODEL_PAYLOAD_UNAVAILABLE` | Recorded champion has no loadable model payload. |
| Quant `quant_edge.inference` and `final_proof` | `SYNTHETIC_ONLY_SAFE_ABSTAIN` | Final action `ABSTAIN_UNKNOWN`; edge unavailable/not established; health degraded; serviceability safe-abstain only. |
| Product Assurance S1/A-HAZARD | `SYNTHETIC_ONLY / authorityEffect=NONE` | Hazard/denominator assurance evidence only. |
| Product Assurance S4/A-CASE | `SYNTHETIC_ONLY / authorityEffect=NONE` | Derived claim graph cannot mint readiness. |
| Product Assurance S5/A-COCKPIT and observability | `SYNTHETIC_ONLY` | Contract/conservation/SLO fixtures, not a telemetry runtime. |
| Product Assurance S6/A-AGENT | `SYNTHETIC_ONLY / DETERMINISTIC_STUB_ONLY` | Provider and operational actions remain not configured. |
| Product Assurance S8/A-STABILITY | `SYNTHETIC_ONLY` | Resource owner remains unknown/owner-confirmation-required; no throttling/repair authority. |
| Product Control Room and System Dashboard fixture/preview paths | `SYNTHETIC_ONLY` | Production route sets `allowFixtureControls=false`; fixture mutation never proves a backend command owner. |
| IP-PROOF fixture chain and deterministic I00 scenarios | `PROOF_PRESTAGE_READY — FIXTURE ONLY / SYNTHETIC_ONLY` | Cannot satisfy real runtime, restart, browser, deployment, private, signed, canary or live proof. |
| IP-OPS fake services, simulation roots and temporary-directory proofs | `SYNTHETIC_ONLY` | Prove artifact behavior, not target infrastructure. |

## UNWIRED-DORMANT

| Exact component/seam | Required label | Exact blocker/boundary |
| --- | --- | --- |
| Quant factory as a product runtime (`quant/**`) | `IMPORTED / LANE_READY / BUILT_AND_TESTED_UNWIRED` | Production process, transport and mount are `NOT_CONFIGURED`; current output is `ABSTAIN_UNKNOWN`. |
| Frozen Edge Protocol consumers: LiveEdge schema runtime/client/assessment bridge/projection guard/local transport and Product Integration Q adapter | `BUILT_AND_TESTED_UNWIRED` | No single accepted production Q ingress is mounted; the protocol owns no transport or semantics. |
| LiveEdge L02 documentary Binance contract matrix (`server/src/liveEdge/adapters/binanceContracts/**`) | `BUILT_AND_TESTED_UNWIRED` | Documentary source tuples only; no acquisition or exchange client. |
| LiveEdge L03 signed kernel (`server/src/liveEdge/adapters/binanceSignedKernel/**`) | `BUILT_AND_TESTED_UNWIRED` | Request/clock/rate/ambiguity value construction only; no credential owner, signer transport, retry or call authority. |
| LiveEdge L04 instrument/filter/sizing projection (`server/src/liveEdge/adapters/binanceInstrumentSpecs/**`) | `BUILT_AND_TESTED_UNWIRED` | Injected metadata only; no fetcher, registry, cache, Risk or send authority. |
| LiveEdge L05 private truth/lifecycle values (`server/src/liveEdge/adapters/binancePrivateTruth/**`) | `BUILT_AND_TESTED_UNWIRED`; private acquisition `NOT_CONFIGURED / OWNER_GATED` | No private read, stream, credential, account cache or reconciliation verdict. |
| LiveEdge L06 mutation journal (`server/src/liveEdge/adapters/durableMutationJournal/**`) | `BUILT_AND_TESTED_UNWIRED / persistenceProven=false` | Existing Ledger owns persistence; exact L06-to-Ledger production adapter remains unwired. |
| LiveEdge L07 Exchange Twin | `BUILT_AND_TESTED_UNWIRED / SYNTHETIC_ONLY` | No connector/runtime. |
| LiveEdge L08 execution policy | `BUILT_AND_TESTED_UNWIRED / SYNTHETIC_ONLY` | No coordinator/sender/runtime. |
| LiveEdge L09 Normal Basis projection | `BUILT_AND_TESTED_UNWIRED / SYNTHETIC_FIXTURE` | Existing Basis/Foundation owners retain lifecycle truth. |
| LiveEdge L10 Reverse Basis projection | `BUILT_AND_TESTED_UNWIRED / SYNTHETIC_FIXTURE` | No Margin acquisition, borrow/repay or lifecycle authority. |
| LiveEdge L11 Volume projection | `BUILT_AND_TESTED_UNWIRED` | Existing Volume owner remains canonical. |
| LiveEdge L12 exposure/recovery projection | `BUILT_AND_TESTED_UNWIRED / SYNTHETIC_ONLY` | Owner projection only, not recovery supervisor. |
| LiveEdge L13 machine-graph evidence | `BUILT_AND_TESTED_UNWIRED / SYNTHETIC_ONLY` | System Integration remains graph/readiness owner. |
| LiveEdge L14 durable control values (`server/src/liveEdge/controls/**`) | `BUILT_AND_TESTED_UNWIRED` | Foundation Control owns lifecycle; System Integration owns persistence/routes; no Product command owner or dispatch authority is configured. |
| LiveEdge L16/L17 external/final evidence classifiers | `BUILT_AND_TESTED_UNWIRED / SYNTHETIC_ONLY` | Classification/receipt evidence cannot mint lane/runtime/candidate readiness. |
| Product Assurance core (`server/src/productAssurance/**`) | `COMPOSED / LOCAL_PROVED / BUILT_AND_TESTED_UNWIRED` | Imported by the verification harness, not by application runtime. |
| Product Assurance S1, S4, S5, S6 and S8 systemic families | `BUILT_AND_TESTED_UNWIRED / SYNTHETIC_ONLY` | Packet-local evaluators and fixtures only. |
| Product Assurance S7 qCoverage (`server/src/productAssurance/qCoverage/generator.ts`) | `BUILT_AND_TESTED_UNWIRED / UNKNOWN / ABSTAIN_UNKNOWN` | Read-only matrix; no `quant/**` writes or runtime mount. |
| Product Assurance S2 action evidence | `NOT_CONFIGURED / WAITING / ABSENT_ACCEPTED_DONOR` | No branch, path or accepted receipt. Do not fabricate and do not call missing-by-design. |
| Product Assurance S3 Formal | `BLOCKED_NO_NETWORK_BOUNDARY_VIOLATED / ABSENT_FROM_INTEGRATION` | A-FORMAL is excluded; no accepted S3 capability. |
| Product Assurance S6 provider | `DETERMINISTIC_STUB_ONLY / NOT_CONFIGURED` | No operational diagnostic provider or agent runtime. |
| Product Assurance S8 resource owner | `OWNER_CONFIRMATION_REQUIRED / UNKNOWN` | No canonical resource/throttle owner was proven. |
| Product Runtime controls: `global.safe-mode.read-only`, `global.kill-switch.engage`, `global.intake.pause`, `component.engine-supervisor.restart` | `UNAVAILABLE:COMMAND_OWNER_NOT_CONFIGURED` | Routes exist, but preview/submit cannot act because no canonical command owner is injected. |
| Product incident feed | `NOT_CONFIGURED / INCIDENT_OWNER_NOT_CONFIGURED` | Empty incident projection is an explicit absence, not zero incidents proven. |
| Foundation USD-M test-order boundary | `BUILT_AND_TESTED_UNWIRED / DORMANT` | No transport; no test order is authorized. |
| Accepted L15 `ops/live/**` action tooling | `IMPORTED / ARTIFACT_ONLY` | Not installed, deployed, exercised, or target-read-back. |
| IP-OPS `ops/i00/**` adaptation/templates | `BUILT_AND_TESTED_UNWIRED / OWNER_GATED` | Validation/delegation only. Production restore remains blocked pending donor amendment; target SQLite/capacity are external-blocked. |
| IP-PROOF real-adapter/candidate acceptance | `UNWIRED / PENDING_CANDIDATE` | Final source freeze, runtime/restart/readback, browser proof, component inventory and candidate receipt remain pending at this cutoff. |
| Dashboard browser release | `WIRED / BROWSER_SHIP_GATE_PENDING` | At this cutoff `CapitalPanel.tsx` and `PostureStrip.tsx` contain unknown-to-zero fallbacks; no `LIVE_PUBLIC` UI promotion until repaired/proved. |

All LiveEdge production paths remain unimported outside `server/src/liveEdge/**` at this cutoff. All Product Assurance runtime paths remain unimported by the application. The director must re-run those two import scans at the candidate SHA.

## MISSING-BY-DESIGN

| Capability | Exact final label | Boundary |
| --- | --- | --- |
| Live order execution | `LIVE_EXECUTION_NOT_IMPLEMENTED` | Mechanically blocked; do not rename, soften or infer from LiveEdge realism tests. |
| Mounted signed/private exchange action adapter | `MISSING-BY-DESIGN_FOR_THIS_RELEASE` | No credentialed transport, private stream, signed Spot/USD-M test/live order, or exchange mutation is in the composition. |
| Borrow/repay, leverage/Margin mutation | `MISSING-BY-DESIGN_FOR_THIS_RELEASE` | Documentary/private evidence and reverse-Basis simulation do not create an action hand. |
| Withdrawal and transfer-out | `MISSING / FORBIDDEN` | No code or UI, permanently outside this product boundary. |
| Autonomous or Q-authorized strategy/order path | `MISSING / FORBIDDEN` | Q is advisory only; Edge Protocol contains no money/order/control fields. |
| Product Assurance authority over product behavior | `MISSING / FORBIDDEN` | Assurance verifies owner evidence and always returns authority false. |
| Production import/mount of IP-PROOF fixtures/tests | `MISSING / REQUIRED_ABSENCE` | Proof remains an out-of-runtime verifier. |
| Ambient AWS/cloud runner or canary authority in the app | `MISSING / OWNER_GATED_OUTSIDE_RUNTIME` | Local ops artifacts cannot create external authority; no cloud mutation or canary was authorized. |

Do not place S2 or S3 in `MISSING-BY-DESIGN`: S2 is an unfulfilled `NOT_CONFIGURED` seam; S3 is a specifically blocked/excluded donor.

## Candidate-time truth corrections and substitutions

1. Replace `[CANDIDATE_SHA]`, `[ROLE3_VERIFIED_SHA]`, every bracketed proof field, and all receipt-era counts with exact frozen-candidate/Role-3 evidence.
2. Recompute the donor/current dashboard relation. At this cutoff the donor `systemDashboard` tree is `d3d899db3b0395532a3cf12b2304e91a2ce528ce`, while the active integration tree is `69f613d03a9c39f69b65c4e11e5b2c24877d1aa5`: 20/21 files exact plus one intentional `SystemDashboard.tsx` evolution. Do not repeat the stale “current 21/21 exact” claim.
3. Prove the entire rendered browser path does not coerce unknown exposure/count/amount to zero or “no exposure.” Until then Product Control Room/System Dashboard stays `WIRED / BROWSER_SHIP_GATE_PENDING`.
4. Re-run production import scans for Q, LiveEdge, Product Assurance and proof fixtures. A new import requires a component-by-component authority and capability reclassification.
5. Re-prove the 13-component registry; never substitute packet fixture IDs or treat Product Integration as component 14.
6. Preserve Product command and incident blockers unless the candidate has an accepted canonical owner, durable CAS/idempotency/receipt proof, and full runtime/browser validation.
7. Preserve Q `ABSTAIN_UNKNOWN`, non-loadable model and data-insufficient boundary unless a separately accepted Q revision exists in the candidate.
8. Preserve A-FORMAL exclusion, S2 absence, S6 stub-only provider and S8 unknown resource owner.
9. Preserve the L15 action-owner/IP-OPS validator split and absence of target/deployment truth.
10. Preserve `LIVE_EXECUTION_NOT_IMPLEMENTED`, no withdrawals/transfers, and zero private/signed/money authority.
