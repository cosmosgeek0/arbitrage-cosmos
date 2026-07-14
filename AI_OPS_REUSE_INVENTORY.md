# AI-Ops reuse inventory

Status: `NON_DONOR_ADVISORY_ONLY / WAITING_INTEGRATED_ACCEPTED`

This is the D-LAUNCH-28 prestage inventory requested before an immutable `INTEGRATED_ACCEPTED` SHA exists. It is not the directive's final `AI_OPS_REUSE_AND_GAP_RECEIPT.md`, is not candidate input, and grants no A1-A5 launch, mount, runtime, provider, merge, push, deployment, or money authority. The final Section 3 receipt must be regenerated from the eventual accepted SHA.

## Evidence boundary and method

| Evidence | Immutable identity | Use |
| --- | --- | --- |
| Assigned branch/base | `aiops-prestage-20260714` at `d78be24f4da14632c857ee250b62e3fec33c2743`; tree `ea9113c2bf5fd95d4e39bde214d2ecf1f1e7e995` | Non-donor write boundary |
| Integration evidence cutoff | `i00-product-assembly-20260713@03857dcdaff8d8b12627d27ddcc97505da1f2f86`; tree `92a2ec21b060eb0da3c98e3d6b16fad9843bbf89` | Read-only current-candidate inventory; not accepted |
| S6/A-AGENT seal | `97e87bd7045d2883ef8c4bd3cdb7f5daf83e0437`; implementation `86a0e80f53069de33488f30aa55338648a46cf37` | Accepted packet-local S6 evidence |
| S6 owner law | `c57610cb5f7d56efb61e53ae27057fbe92a6a2f6:IP_ASSURANCE.md#7.1`; blob `308a7b90a3a75a707bb22a8880ee02b6acef9675` | Class A-D boundary |
| S1/A-HAZARD seal | `ab33b3712cddd67c3ec91cfa1dd232c75226cd9f`; implementation `5de362639638fafcd9563787647200bcbf175df5` | Accepted packet-local S1 evidence |
| Authority receipt | `93c53e8370b53f82762cc20408a1e38b2d44542d:AI_OPS_AUTHORITY_RESOLUTION_RECEIPT.md`; blob `e0f115b81656ec4e91e6886da844958952496e56` | Real authority-name resolution |

Every other branch/worktree was inspected through local Git objects, using `git show <ref>:<path>` for file content. No other worktree filesystem was changed or used as a source of mutable truth. The active integration ref moved from `76387ec47d14b7b8dead28928de8dc4487133f73` to the cutoff above during inspection; that change touched restart/performance evidence, not an owner path inventoried below. Acceptance-time regeneration remains mandatory.

The requested disposition and the directive's exact Section 3 classification are deliberately separate:

| Prestage disposition | Section 3 classification used here |
| --- | --- |
| `REUSE_AS_IS` | `REUSE` or, for proof/fixture evidence that cannot become runtime authority, `REFERENCE_ONLY` |
| `EXTEND_VIA_INSERTION_REQUEST` | `ADAPT` |
| `MISSING` | `MISSING_REQUIRED` |

## Section 3 mandatory-source coverage

This ledger closes the directive's minimum inspection list without pretending that an untracked owner input or an unaccepted projection is a runtime owner. Git blobs are from integration cutoff `03857dc...` unless another immutable object is named.

| Mandated source | Exact inspected object/path and hash | Cutoff finding and inventory mapping | Disposition, proof or insertion seam |
| --- | --- | --- | --- |
| I00 owner directive | Protected `I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md`, content SHA-256 `9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5`, resolved by authority receipt `93c53e8...:AI_OPS_AUTHORITY_RESOLUTION_RECEIPT.md` blob `e0f115b81656ec4e91e6886da844958952496e56` | The owner input has no Git blob at the cutoff and is not copied here. Its committed implementation evidence is mapped below and in R08-R19. | `REFERENCE_ONLY`; `DO_NOT_COPY`; final accepted-SHA gate must re-read the protected owner object. |
| I00 §14 durable self-healing/operation registry | `server/src/productAssurance/catalog/core.ts` blob `b777635f1eeb4d92882e86ae0789086425603653`; `operations/policy.ts` blob `d63a7c9001dc9296ce9d02bd7bcf1854ac56883a`; generated `RELIABILITY_POLICY_REGISTRY.md` blob `178ab92358d4b551748166f34769d47e3c912032` | `OPERATION_POLICY_REGISTRY`, `CORE_OPERATION_POLICIES`, `validateOperationPolicy`, `scanOperationCoverage`, `decideRetry`, `transitionCircuit`; deterministic source-built policy registry, not an effect owner. R10. | Pure registry `REUSE_AS_IS` / `REUSE`; production dispatcher/checkpoint remains `MISSING`; proofs `server/test/productAssurance/core-policy-inventory.test.mjs` and `production-operation-scan-adversarial.test.mjs`. |
| Bounded autonomic reconcile kernel | `server/src/productAssurance/remediation/campaign.ts` blob `5b858894af4e31af0922a5e84e07b9cd795caf20` | `REMEDIATION_STATES`, `transitionRemediationCampaign`, `acquireResourceSet`, `buildRepairConflictGraph`; pure bounded campaign vocabulary, no mounted controller/persistence. R10. | `REUSE_AS_IS` / `REUSE`; controller and checkpoint `MISSING`; later Control/Ledger insertion only. Proof `server/test/productAssurance/operational-remediation.test.mjs` plus S8 hostile tests. |
| Runtime-assurance separation | `controllers/gate.ts` blob `af852a24bcfbe248dbebb259847d378fa6f29afc`; `systemIntegration/adapters/passiveOwnerEvidence.ts` blob `033cf78bb443f2e1c2a39c2febec7dbf0a4723b0`; `canonicalOwnerEvidence.ts` blob `d28300188162d2f96f591e4a4d0f44f7f272ba5b` | `evaluateAdvancedControllerGate` preserves deterministic no-new-exposure fallback; Product Assurance adapter is read-only `NOT_CONFIGURED/UNKNOWN` and cannot compute product readiness/control truth. R12/R17. | `REUSE_AS_IS` / `REUSE`; no second Risk, Capital, supervisor or readiness owner. Proof under `server/test/systemIntegration/**` and Product Assurance gate adversarial tests. |
| Operational Failure Atlas | `failureAtlas/atlas.ts` blob `30ee43149328ede255acb5421324e64819fc6f01`; generated `fixtures/productAssurance/generated/OPERATIONAL_FAILURE_ATLAS.md` blob `cee6e95858726e088210d3e4f7deafc5e8accf03`; S1 packet tree `018187be07156abaea60c0ba91875232bb331803` at `ab33b37...` | Pure validator/projector and `UNKNOWN` empty-input generated view exist; accepted release catalog/owner/adapter do not. R03-R05. | Scaffold `REUSE`; generated/S1 fixture evidence `REFERENCE_ONLY`; accepted release catalog `MISSING_REQUIRED`; S1 insertion rows `PA-S1-IR-001..003`. |
| Subordinate LLM diagnostic/repair-assistance plane and `AGENTIC_DIAGNOSTIC_BOUNDARY.md` | `diagnostics/boundary.ts` blob `7b6b92a4fcbcc15d22b90d35f1244427fa1b0eab`; generated boundary blob `1088ead1bea2854beb52bb41b29aae51e663dff3`; S6 `provider-stub.mjs` blob `f9d53717160f892685851c2f84e961b74b8f1347` | Permission hierarchy, hard denials, redaction and outage projection exist; generated owner seams are `WAITING/UNKNOWN`; provider state is `NOT_CONFIGURED`; stub is test-only. R01-R02/R18. | Boundary `REUSE`; generated/stub `REFERENCE_ONLY`; production identity/provider/sandbox/persistence/routes `MISSING_REQUIRED`, later only via S6 insertion requests. |
| I00 §20 diagnostic-provider external authorization | `ops/i00/bin/validate-authorization.mjs` blob `2d45e79b883b9a206b3d88ea03aae57ae8adac7f`; `secrets-provider.mjs` blob `2dc5005d7e0458153e6963498e60d5b452e121cb`; authorization template blob `2a33573d20de64020890e27704bd961496831e57`; `IP_OPS_ACTIVATION_REQUEST.md` blob `62ad9b93c0d3fdfea4e750b8b682b4cce4ff63ed`; `IP_OPS_STATE.md` blob `55c8869bbb29b8eb30fe168596b012dd3a13849b` | Canonical owner-gated external-action/secret-reference validation exists; external authorizations/actions are `NONE`. R18-R19. | `REUSE_AS_IS` / `REFERENCE_ONLY` for validators; AI provider activation `MISSING_REQUIRED`; `AIOPS-IR-EGRESS-016`, config/deployment/auth requests. |
| I00 I02 adapters | `server/src/productIntegration/adapters/qProtocol.ts` blob `c181ec9ae600000750f372d92753ffd6017c1aa2`; `canonicalReferences.ts` blob `cb862980c47ae35c0927e9da2370d65ee085c5cc`; existing `systemIntegration/adapters/**` | Canonical adapter package exists. AI Ops may add only narrow evidence adapters; it cannot replace producers or owners. | `REUSE`; new evidence binding only by typed insertion/`ADAPT`. |
| I00 I03/I04/I08/I09 | `ASSURANCE_INSERTION_REQUEST.md` blob `207ba5a15fc4782612567dfc40c7a45c845fb67a`, rows `AIR-I03-REMEDIATION-CONTROLLER`, `AIR-I04-CAMPAIGN-PERSISTENCE`, `AIR-I08-SUPERVISOR-AGGREGATION`, `AIR-I09-READ-CONTROL-SEAM`; actual owners `managedComposition.ts` blob `0dfbedc6c61958f85d6bfc50fac21ef23ea1a6a3`, `ledger.ts` blob `cb2433266dde597de22b873db68c4e5c33d34a1b`, supervisor `projection.ts` blob `0b6b5cb2306048a57b301ad528ac97c37bbd0508`, runtime `router.ts` blob `47655848f80109cc6c2aba1e5a5e912a56c1f1eb`, command owner blob `7dca4a1cb3c11f8a468d71d808a2933329b9538f` | Canonical composition, Ledger, supervisor and authenticated command API exist; Product Assurance controller/checkpoint/aggregation/read seam rows remain `NOT_CONFIGURED/UNKNOWN`. R08-R14. | Canonical owners `REUSE`; AI mounts `MISSING_REQUIRED` then `ADAPT` only by fresh integrator; no second composition/store/supervisor/API. |
| I00 I10/I11 | `cockpit/viewModel.ts` blob `1281a5e0b6e090ad4021e20594dfcefd231b1064`; `faults/harness.ts` blob `aa326c35f726220aaa5bf199364e5bb046f29a0b`; same insertion artifact rows `AIR-I10-COCKPIT-01..11` and `AIR-IP-PROOF-BASE-CAMPAIGNS` | Render-neutral 11-section cockpit scaffold and deterministic synthetic fault corpus exist; production sections/live campaign fan-in remain unconfigured. R14/R17/R19. | Scaffolds `REUSE`; fixtures `REFERENCE_ONLY`; Product API/cockpit and accepted campaign mount `ADAPT`; rendered and fault proof required. |
| I00 I13 deployment bundle | `ops/i00/bin/assemble-release.mjs` blob `be721b432c67dd638c5758bc5b7817c82e2b7d21`; `validate-release.mjs` `13794c9e402c98c45f56bc370ba73c0a44af339e`; `release-switch.sh` `480654e66a38076126e34bd4b617d8f0854a72f8`; `rollback-switch.sh` `e2540de6368fc39996f649612b9980c48acadd7f` | Immutable release/validation/switch/rollback mechanisms exist; no AI authority and no activation. | Mechanisms `REUSE_AS_IS` / `REFERENCE_ONLY`; all use remains §20 owner-gated. |
| I00 I14 target operations | `ops/live/bin/deploy.sh` blob `6d4e4b96a89cfecaf83b72008fe407593d85d2e2`; watchdog blob `7b6de64310d34915bdb272083f742a8df735765e`; Cloudflare template blob `3abc7b7dd8b6f0e0c2ce19333a01f8cfe9288a14`; systemd template blob `8048eca9a9804a70328b70b12553ca2ddd26b039` | Templates/bundle exist; real target activation, canary and readback are unproved/owner-gated. | `REFERENCE_ONLY`; target activation/readback and AI-specific canary remain `MISSING_REQUIRED` until §20 authorization. |
| I00 §27 acceptance | `I00_PRODUCT_BUILD_STATE.md` blob `97c28d71a1f9b6986e4b00ae18d2e0df9943bef5`; `test/i00/complete-acceptance.mjs` blob `6bc83e95b767ad51b412385719532b659bd96388`; `performance.test.mjs` blob `39cee5b5921f0209586ba315029c8d7979af6053`; `local-acceptance.mjs` blob `5e000a611585e3f78a52c58d0da8c382b6d8278c`; `local-proxy-soak.mjs` blob `68da51bf64dc242b2e0232eb999af74eb38b7c0a`; `ops/tests/i00/run-all.sh` blob `2ee528045c11dad6a709be0ac448ff3e365497cc` | Cutoff is `CANDIDATE_SOURCE_FROZEN / LOCAL_ACCEPTANCE_PENDING / NOT_SELF_VERIFIED`, `NOT_CANDIDATE_READY`; no immutable `INTEGRATED_ACCEPTED` SHA. | `MISSING_REQUIRED`; final entry gate cannot pass. Complete acceptance, production-port, browser/capture and ops gates remain director/integrator-owned. |
| IP-ASSURANCE §§3.1-3.9 | `IP_ASSURANCE.md` at `c57610c...` blob `308a7b90a3a75a707bb22a8880ee02b6acef9675`; production modules at cutoff: `catalog/core.ts` `b777635f...`, `operations/policy.ts` `d63a7c90...`, `invariants/evaluator.ts` `36679b18...`, `remediation/campaign.ts` `5b858894...`, `projections/operationalTruth.ts` `f139357c...`, `cockpit/viewModel.ts` `1281a5e0...`, `faults/harness.ts` `aa326c35...`, `failureAtlas/atlas.ts` `30ee4314...`, `controllers/gate.ts` `af852a24...`, `diagnostics/boundary.ts` `7b6b92a4...` | Exact sections map respectively to operation registry; inventory/telemetry coverage; read-only invariants; remediation projection; truth adapters; cockpit package; fault harness; runtime-assurance/failure corpus; subordinate LLM boundary. R01-R18. | Pure owners/scaffolds `REUSE`; synthetic/generated evidence `REFERENCE_ONLY`; every production owner mount remains explicit `ADAPT` or `MISSING_REQUIRED`, never a duplicate authority. |
| Amendment §7 S6 / A-AGENT | `ip-assur-agent-20260713@97e87bd...`; packet tree `9fc6b226d195166b3aa3e3328f671c17840ffc5e`; schema blob `042456c58b1cd5b6eb179c0c9c289f6e69d06034`; evaluator blob `9d8399e6c0d2a74a892bf759342a75e40eabd867`; receipt blob `1c2fb625a3d90ece61a44c56adc9788063badb99` | Accepted packet-local contracts, hostile tests and view model; no production runtime/provider authority. R01-R02. | Contracts/evaluators `REUSE`; fixtures/receipt `REFERENCE_ONLY`; production mount `MISSING_REQUIRED` then owner insertion. |
| Amendment §9 S8 | `ip-assur-stability-20260713@d35674e...`, accepted implementation `9ceeffd...`; stability packet tree `321592d4a7533692d5c1c0f1ad76a0ccedde96af`; test tree `f8d70d746e6912ad3531222e78944ac12e22f8f9`; receipt blob `d441a5d23bf87178af47b143e4a955d826aeb711` | Accepted packet-local cancellation, repair-loop, resource, integrity and view-model evidence; owner confirmation/resource truth remains `UNKNOWN`, never runtime authority. | `REUSE_AS_IS` only as hostile test/reference corpus / Section 3 `REFERENCE_ONLY`; A5 consumes, production owner seams remain insertion requests. |
| Canonical incident/material-event/Ledger/command/approval/remediation/telemetry/auth/cockpit owners | Exact cutoff paths/symbols enumerated in R06-R18 | Incident, generic human approval, independent sentinel/audit and external delivery owners are missing; material delivery, Ledger, Control, auth, Product API/client and pure assurance projections exist. | Per-row `REUSE`, `ADAPT` or `MISSING_REQUIRED`; duplicates rejected below; shared seams are typed in `AI_OPS_COLLISION_MAP.md`. |
| Existing browser/synthetic monitoring | `ops/i00/bin/probe.mjs` blob `111c2839e37fc33bb34859cd28f8cae9c59e24b5`; `ops/tests/i00/test-probes-and-readback.sh` blob `09783f588cdc9f9fe0458c95c7109c1002c116ca`; `test/i00/performance/app-probe.mjs` blob `d489c7dab7021ad68bb2cbed6cb0ef9bd20b186b` | Existing liveness/readback and browser performance probes exist; an independently deployed sentinel does not. R17/R19. | Probe mechanisms `REUSE_AS_IS` / `REFERENCE_ONLY`; AI observation extension `ADAPT`; external sentinel owner/live proof `MISSING_REQUIRED`. |
| Worktree/patch/test/release/canary/rollback mechanisms | `DIRECTOR.md` blob `c8f6b263904e40fe77eb5123a3d40d150e8abf72`; `package.json` blob `99728adf274e3b150c6aa263d3150726e93bef95`; `ops/i00/**`, `ops/live/**`, `ops/templates/i00/**`; `server/src/services/deploymentFreezeFileSystem.ts` | Isolation, tests, freeze, release/readback/rollback mechanisms exist; no AI patch service or autonomous release owner exists. R19. | Mechanisms `REFERENCE_ONLY`; isolated repair handoff `ADAPT`; provider/deployment activation `MISSING_REQUIRED` until owner authorization. |
| Root authority equivalents | Exact mapping and blobs in “Authority-name resolution” below | All names resolve to real repository objects; no dummy root document is created. | `REFERENCE_ONLY`; actual owner docs remain controlling. |

## Canonical owner inventory

### R00 - Shared deterministic contract, identity, time and authority primitives

- Exact paths and symbols:
  - `server/src/foundation/contracts/failures.ts`: `StructuredFailure`, `STRUCTURED_FAILURE_KEYS`, `ContractResult`, `ok`, `fail`, `isStructuredFailure`, `createStructuredFailure`, `serializeStructuredFailure`, `failureFromIssues`.
  - `server/src/foundation/contracts/identity.ts`: `canonicalJson`, `deriveCommandId`, `deriveCorrelationId`, `deriveEventId`, `deriveStateRevisionId`, `deriveConfigVersionId`.
  - `server/src/foundation/contracts/time.ts`: `SourcedTimestamp`, `FreshnessReport`, `isValidUtcMillis`, `createSourcedTimestamp`, `evaluateFreshness`.
  - `server/src/foundation/contracts/authority.ts`: `DataAuthority`, `DATA_AUTHORITIES`, `weakestAuthority`, `FRESHNESS_STATES`, `downgradeAuthority`, `UNKNOWN`, `UNAVAILABLE`.
- Status: canonical pure primitives for structured failure, deterministic identity, sourced time/freshness and authority downgrade already exist.
- Disposition: `REUSE_AS_IS`; Section 3: `REUSE`.
- Consumer law: all A lanes consume these primitives; no lane invents parallel failure envelopes, IDs, freshness semantics, authority ranks, or fabricated known values.

### R01 - S6/A-AGENT contracts, policy, isolation, promotion and demotion

- Owner/seal: `ip-assur-agent-20260713@97e87bd7045d2883ef8c4bd3cdb7f5daf83e0437`.
- Exact paths and symbols:
  - `fixtures/productAssurance/systemic/agentBoundary/agent-boundary-v1.schema.json`: `SandboxBudgetCeilingV1`, `WorkloadIdentityEventV1`, `ExternalSandboxBindingV1`, `ExternalSandboxNotConfiguredV1`, `EvidenceReferenceV1`, `AppendRetentionReceiptV1`, `DiagnosticTracePrivacyRetentionExtensionV1`, `EvidenceCheckV1`, `SelfCorrectionClassPolicyV1`, `SelfCorrectionCandidateV1`, `RepairEvidencePolicyFixtureV1`, `RepairEvidenceBundleV1`, `CorpusDedupRegistryFixtureV1`, `CorpusItemV1`, `CorpusReleaseV1`, `InsertionRequestRowV1`.
  - `fixtures/productAssurance/systemic/agentBoundary/evaluators.mjs`: `PERMISSION_LEVELS`, `SAFE_DIAGNOSTIC_CAPABILITIES`, `PERMANENTLY_FORBIDDEN_CAPABILITIES`, `IP_ASSURANCE_CLASS_LAW`, `reduceWorkloadIdentity`, `evaluateSandboxBinding`, `evaluateTracePrivacyAndRetention`, `deriveSelfCorrectionClass`, `evaluateSelfCorrectionPromotion`, `evaluateRepairEvidence`, `evaluateCorpusItemGovernance`, `evaluateCorpusReleaseGovernance`, `diagnosticRequestDigest`, `sandboxBoundaryDigest`, `corpusManifestDigest`, `decisionContractDigest`.
  - `fixtures/productAssurance/systemic/agentBoundary/diagnostic-worker-view-v1.schema.json`: `DiagnosticWorkerViewV1`.
  - `fixtures/productAssurance/systemic/agentBoundary/view-models.mjs`: `projectDiagnosticWorkerView`.
  - `fixtures/productAssurance/systemic/agentBoundary/canonical.mjs`: `canonicalStringify`, `sha256Hex`, `deepFreeze`, `findForbiddenKeys`, `makeEvaluation`, `appendChainDigest`.
- Status: integrated packet-local deterministic contracts; fixtures remain synthetic and `operationalActionAllowed=false`. The exact S6 fields are `configurationState=SYNTHETIC_ONLY` and `providerMode=DETERMINISTIC_STUB`; the corrected provider state is `NOT_CONFIGURED`. `configurationState` and `providerMode` are not `providerState` values.
- Disposition: `REUSE_AS_IS`; Section 3: `REUSE` for contracts/evaluators and `REFERENCE_ONLY` for synthetic fixtures.
- Consumer law: A1 consumes the contract and policy vocabulary; A2 consumes evidence/trace/corpus shapes; A3 consumes isolation and sandbox decisions; A4 consumes the sealed view model; A5 reuses the hostile corpus. No lane may rebuild AgentOps authority.
- Proof entrypoints: `test/productAssurance/systemic/agentBoundary/*.test.mjs`; sealed evidence reports `111/111` focused tests.

### R02 - S6 deterministic provider stub and generic diagnostic boundary

- Exact paths and symbols:
  - `fixtures/productAssurance/systemic/agentBoundary/provider-stub.mjs`: `runDeterministicProviderStub`, `isValidTypedProviderStubOutput`, `isDeterministicProviderStubDescriptor`, `providerStubDecisionDigest`.
  - `server/src/productAssurance/diagnostics/boundary.ts`: `DIAGNOSTIC_PERMISSION_LEVELS`, `DIAGNOSTIC_FORBIDDEN_CAPABILITIES`, `DIAGNOSTIC_ALLOWED_CAPABILITY_IDS`, `evaluateDiagnosticProposal`, `redactDiagnosticEvidence`, `diagnosticProviderOutageProjection`.
  - `server/src/productAssurance/adapters/ownerContracts.ts`: `OWNER_CONTRACT_WAITING_SEAMS`, `bindOwnerContract`, `consumeOwnerContract`; `DIAGNOSTIC_GOVERNANCE` remains a waiting seam.
  - `fixtures/productAssurance/generated/AGENTIC_DIAGNOSTIC_BOUNDARY.md`; blob `1088ead1bea2854beb52bb41b29aae51e663dff3`: generated `WAITING`/`UNKNOWN` projection. Its `DIAGNOSTIC_GOVERNANCE` row targets the S6 path but records `DIRECTOR_ACCEPTED_SATELLITE_COMMIT_MISSING` in that generated snapshot.
- Status: the deterministic stub is suitable for P1; the production workload identity, provider, sandbox, trace/retention, persistence, route, supervisor, command and cockpit mounts do not exist.
- Disposition: deterministic stub `REUSE_AS_IS` only inside network-free P1 tests / Section 3 `REFERENCE_ONLY`; generated boundary `REUSE_AS_IS` / Section 3 `REFERENCE_ONLY`; production mount is currently `MISSING` / Section 3 `MISSING_REQUIRED`, with any later owner-ratified wiring performed `EXTEND_VIA_INSERTION_REQUEST` / Section 3 `ADAPT`.
- Existing S6 draft seams: `fixtures/productAssurance/systemic/agentBoundary/ASSURANCE_INSERTION_REQUEST_DRAFT.json` and `.md`, rows `agent-boundary.draft.diagnostic-kill-control`, `agent-boundary.draft.provider-workload-identity`, and `agent-boundary.draft.diagnostic-worker-cockpit`.

### R03 - S1 hazard packet and expected-family denominator

- Owner/seal: `ip-assur-hazard-20260713@ab33b3712cddd67c3ec91cfa1dd232c75226cd9f`.
- Exact paths and symbols:
  - `fixtures/productAssurance/systemic/hazard/contracts/schema.mjs`: `HAZARD_ASSURANCE_SCHEMA`, `HAZARD_VIEW_MODEL_SCHEMA`, `OPERATION_CLASSES`, `REQUIRED_FAILURE_FAMILY_IDS`, `ATLAS_EVIDENCE_STATES`, `ATLAS_COVERAGE_DISPOSITIONS`, `OWNER_REVIEW_STATES`, `SCHEMA_LIMITS`.
  - `fixtures/productAssurance/systemic/hazard/contracts/validation.mjs`: `computeAtlasDenominatorFingerprint`, `validateHazardAssurancePacket`, `validateHazardViewModel`.
  - `fixtures/productAssurance/systemic/hazard/reference/atlas-coverage.mjs`: `evaluateFailureAtlasCoverage`.
  - `fixtures/productAssurance/systemic/hazard/reference/hazard-evaluator.mjs`: `evaluateAssumptionAt`, `evaluateHazardAssurance`.
  - `fixtures/productAssurance/systemic/hazard/reference/view-model.mjs`: `buildHazardAssuranceViewModel`.
  - `fixtures/productAssurance/systemic/hazard/fixtures/baseline.mjs`: `UNACCEPTABLE_LOSS_FAMILIES`, `FAILURE_FAMILIES`, `ASSUMPTIONS`, `HAZARDS`, `ASSUMPTION_CONSUMERS`, `FIXTURE_REGISTRY`, `buildCompleteHazardFixture`.
- Status: accepted packet-local synthetic denominator and hazard evidence only; it grants no Atlas/runtime authority.
- Disposition: `REUSE_AS_IS`; Section 3: `REFERENCE_ONLY` until bound to an accepted release catalog.
- Proof entrypoints: `test/productAssurance/systemic/hazard/*.test.mjs`; sealed evidence reports `69/69` focused tests.

### R04 - Operational Failure Atlas contract/evaluator scaffold

- Exact path and symbols: `server/src/productAssurance/failureAtlas/atlas.ts`: `OperationalFailureAtlasCatalog`, `OperationalFailureDefinition`, `OperationalFailureAtlasProjection`, `validateOperationalFailureAtlasCatalog`, `projectOperationalFailureAtlas`, `OperationalFailureRecord`, `projectOperationalFailureRecords`, `FAILURE_ASSURANCE_DIMENSIONS`, `FAILURE_FAIL_SAFE_POSTURES`, `FAILURE_FAMILY_DENOMINATOR_SUBJECT_ID`.
- Status: pure, integrated scaffolding that validates/projects a supplied catalog; it does not instantiate or own an accepted release catalog.
- Disposition: `REUSE_AS_IS`; Section 3: `REUSE`.
- Consumer law: A1 may adapt missing contract fields only through the Product Assurance owner; A2 may query projections but cannot manufacture the catalog; A5 replays the S1 corpus.

### R05 - Generated Atlas projection versus accepted-release Atlas instance

- Existing generated artifact: `fixtures/productAssurance/generated/OPERATIONAL_FAILURE_ATLAS.md`; blob `cee6e95858726e088210d3e4f7deafc5e8accf03`. It is an `UNKNOWN` projection over `Empty canonical input`, reason `FAILURE_RECORD_CORPUS_EMPTY`; non-empty records remain `FAILURE_RECORD_OWNER_CONTRACT_WAITING`.
- Missing release artifact: owner-reviewed accepted-release catalog/manifest/rows, owner binding and production adapter. `fixtures/productAssurance/systemic/hazard/state/HAZARD_STATE.md` explicitly preserves those and the I08 mount as gaps. The S1 fixture is `SYNTHETIC_ONLY` and cannot be promoted.
- Disposition: generated projection `REUSE_AS_IS` / Section 3 `REFERENCE_ONLY`; accepted-release catalog, owner binding and production adapter `MISSING` / Section 3 `MISSING_REQUIRED`.
- Required owner action: ratify an Atlas owner and consume S1 draft rows `PA-S1-IR-001` (release manifest/rows), `PA-S1-IR-002` (production adapter), and `PA-S1-IR-003` (supervisor/API/cockpit mount). Until then, AI cases must report Atlas matching unavailable.

### R06 - Canonical incident lifecycle owner

- Exact evidence:
  - `server/src/productIntegration/runtime/types.ts`: `ProductRuntimeIncidentAvailability`; `ProductRuntimeSupervisorEnvelope.incidents` is `readonly never[]`.
  - `server/src/productIntegration/runtime/projection.ts`: `buildProductRuntimeSupervisorEnvelope` sets `incidentAvailability.state='NOT_CONFIGURED'`, blocker `INCIDENT_OWNER_NOT_CONFIGURED`, and `incidents=[]`.
  - `server/src/ledger.ts`: `compareAndTransitionProductIncident` persists an owner-supplied incident transition only.
- Status: no owner for incident identity, grouping, fingerprint lifecycle, severity, acknowledgement or resolution is configured. The Ledger primitive is persistence, not incident authority. S4 assurance-case evidence is not a substitute runtime incident owner.
- Disposition: `MISSING`; Section 3: `MISSING_REQUIRED`.
- Required owner action: director must ratify the canonical incident owner before A2 can request an admission projection. No lane may create a parallel incident database or quietly treat `compareAndTransitionProductIncident` as policy.

### R07 - Canonical material-event owner and delivery

- Exact paths and symbols:
  - `server/src/systemIntegration/contracts/constants.ts`: `SYSTEM_TRACE_EVENT_KINDS`.
  - `server/src/systemIntegration/contracts/types.ts`: `SystemTraceEvent`, `SystemTraceSnapshot`.
  - `server/src/ledger.ts`: `prepareProductOperatorEvent`, `readProductOperatorEventPage`; material kinds are `CONTROL`, `STRATEGY`, `INTELLIGENCE`, `CAPITAL`, `RISK`, `EXECUTION`, `RECONCILIATION`.
  - `server/src/productIntegration/supervisor/events.ts`: `ProductOperatorEvent`, `ProductOperatorEventPage`, `projectOperatorEventPage`.
  - `server/src/productIntegration/runtime/types.ts`: `ProductRuntimeMaterialSourcePage`, `ProductRuntimeMaterialEvent`, `ProductRuntimeMaterialEventPage`, `ProductRuntimeReadPorts.events`.
  - `server/src/productIntegration/runtime/events.ts`: `projectProductMaterialEventPage`.
  - `server/src/productIntegration/runtime/materialDelivery.ts`: `PRODUCT_RUNTIME_MATERIAL_DELIVERY_PAGE_LIMIT`, `parseProductRuntimeMaterialDeliveryAfterCursor`, `projectProductRuntimeSupervisorDelta`, `projectProductRuntimeMaterialDeliveryPage`.
- Status: durable cursor/material-event delivery exists and is canonical. `projectOperatorEventPage` is a reusable projection contract/reference, not by itself an active event-delivery chain; the active Product delivery chain is the runtime material-delivery/service/WebSocket path listed above.
- Disposition: `REUSE_AS_IS`; Section 3: `REUSE`.
- Insertion boundary: an AI case-transition event kind requires a typed request to the trace enum, persistence selector, material projection, route/WebSocket and supervisor owners. A2 must not create an event bus, cursor or socket.

### R08 - Control Plane and managed lifecycle

- Exact paths and symbols:
  - `server/src/foundation/contracts/runtime.ts`: `CONTROL_COMMANDS`, `ControlCommand`, `RUNTIME_PHASES`, `RuntimePhase`, `RUNTIME_PHASE_TRANSITIONS`, `canTransitionPhase`, `checkRunModePermitted`, `LIVE_EXECUTION_BLOCK_CODE`.
  - `server/src/foundation/control/types.ts`: `ManagedComponent`, `PreflightGate`, `ControlEnvironment`, `SupervisorConfig`, `SupervisorDeps`, `ControlCommandRequest`, `CommandReceipt`, `CONTROL_FAILURE_CODES`, `BUILTIN_GATE_NAMES`.
  - `server/src/foundation/control/plan.ts`: `computeStartOrder`, `computeExclusions`.
  - `server/src/foundation/control/supervisor.ts`: `DeterministicSupervisor`, `createDeterministicSupervisor`.
  - `server/src/systemIntegration/composition/managedComposition.ts`: `ManagedRuntimeComposition`, `createManagedRuntimeComposition`.
  - `server/src/systemIntegration/composition/graph.ts`: `CoreManagedGraph`, `createCoreManagedGraph`.
  - `server/src/systemIntegration/composition/promisePollAdapter.ts`: `PromisePollManagedComponent`.
  - `server/src/systemIntegration/application/facade.ts`: `SystemIntegrationApplication`, `createSystemIntegrationApplication`.
- Status: canonical whole-machine lifecycle/control authority exists.
- Disposition: owner `REUSE_AS_IS`; AI component registration `EXTEND_VIA_INSERTION_REQUEST`; Section 3: `REUSE` plus `ADAPT`.
- Consumer law: the integrator alone may insert a killable, non-critical AI component. No second lifecycle or Control Plane is allowed.

### R09 - Canonical command registry and command owner

- Exact paths and symbols:
  - `server/src/systemIntegration/contracts/constants.ts`: `SYSTEM_CONTROL_COMMANDS`.
  - `server/src/systemIntegration/contracts/types.ts`: `SystemControlState`, `SystemControlMutation`, `SystemControlMutationRequest`, `SystemControlMutationReceipt`, `SystemControlMutationResult`.
  - `server/src/systemIntegration/controls/service.ts`: `SystemControlService`, `controlRequestDigest`.
  - `server/src/productIntegration/runtime/systemControlCommandOwner.ts`: `ProductRuntimeSystemControlCommandOwner`, `createProductRuntimeSystemControlCommandOwner`.
  - `server/src/productIntegration/runtime/controls.ts`: `buildProductRuntimeControlRegistry`, `previewProductRuntimeControl`, `parseProductRuntimeCommandRequest`, `submitProductRuntimeControl`.
- Runtime truth: the source registry exposes exactly four controls: `global.safe-mode.read-only`, `global.kill-switch.engage`, `global.intake.pause`, and `component.engine-supervisor.restart`.
- Disposition: existing four `REUSE_AS_IS`; `AI_OPS` namespace `EXTEND_VIA_INSERTION_REQUEST`; Section 3: `REUSE` plus `ADAPT`.
- Proof-only caution: `fixtures/i00/proof-catalog.json::controls[]` has 14 closure rows, but only four are `WIRED_SOURCE`. It is not a runtime registry. Contract-present shared additions are `SET_COMPONENT_STATE`, `APPLY_CONFIGURATION`, `REVOKE_APPROVAL`, and `REVOKE_RESERVATION`; reconciliation, focus, Basis/Volume intake, recovery, and incident acknowledgement remain missing/owner-gated.

### R10 - Command/remediation policy and deterministic campaign vocabulary

- Exact paths and symbols:
  - `server/src/productAssurance/catalog/core.ts`: `OPERATION_POLICY_REGISTRY`, `CORE_OPERATION_POLICIES`.
  - `server/src/productAssurance/operations/policy.ts`: `OperationPolicy`, `OPERATION_CLASSES`, `OPERATION_WIRING_STATES`, `validateOperationPolicy`, `scanOperationCoverage`, `decideRetry`, `transitionCircuit`.
  - `server/src/productAssurance/remediation/campaign.ts`: `REMEDIATION_ACTIONS`, `REMEDIATION_STATES`, `RemediationCampaign`, `RemediationEvent`, `validateRemediationCampaign`, `transitionRemediationCampaign`, `acquireResourceSet`, `buildRepairConflictGraph`.
- Runtime truth: `OP_LOCAL_REMEDIATION_CAMPAIGN` is `wiringState='NOT_CONFIGURED'`, owner `BACKEND_FOUNDATION_CONTROL`, `automaticRemediationAllowed=false`, with checkpoint `I04_CAMPAIGN_CHECKPOINT_INSERTION_REQUIRED`.
- Disposition: pure policy/transition vocabulary `REUSE_AS_IS` / Section 3 `REUSE`; the active dispatcher/runtime/checkpoint is currently `MISSING` / Section 3 `MISSING_REQUIRED`; any later registered AI runbooks, checkpoint and command exposure require `EXTEND_VIA_INSERTION_REQUEST` / Section 3 `ADAPT`.
- Hard boundary: the directive-proposed `ActionEnvelope` is not an integration-tree symbol or current canonical contract. If ratified, it remains only a typed request to an existing effect owner. No AI executor may be created.

### R11 - Sole durable ledger/persistence owner

- Exact paths and symbols:
  - `server/src/ledger.ts`: `Ledger`, `LedgerEvent`, `LedgerEventInput`, `LedgerProductOperatorEventRecord`, `LedgerProductOperatorEventPage`, `logEvent`, `logEventsAtomically`, `recentEvents`, `getConfigValue`, `setConfigValueAndLogEvent`, `compareAndSetConfigValueAndLogEvents`, `readProductOperatorEventPage`, `compareAndTransitionProductIncident`.
  - `server/src/systemIntegration/persistence/ledgerAdapter.ts`: `SystemLedgerPersistenceAdapter`, `appendTraceEvent`, `queryTrace`, `compareAndTransitionProductIncident`.
  - `server/src/systemIntegration/persistence/types.ts`: `LedgerPersistencePort`, `ProductIncidentPersistenceInput`, `PersistedTraceEventRecord`, checkpoint contracts.
  - `server/src/productIntegration/contracts/ports.ts`: `ProductLedgerPersistencePort`.
- Status: the existing `Ledger` and `data/cosmos.db` are the sole durable owner.
- Disposition: owner/primitives `REUSE_AS_IS`; case, transition, inbox, outbox, DLQ, attempt, effect, usage and approval schema/adapters `EXTEND_VIA_INSERTION_REQUEST`; Section 3: `REUSE` plus `ADAPT`.
- Hard boundary: no second database, incident ledger, case store, approval store, workflow history, effect ledger or file journal.

### R12 - Root-cause, trace and operator-attention projections

- Exact paths and symbols:
  - `server/src/systemIntegration/supervisor/types.ts`: `SystemAttentionItem`, `SystemTraceIndex`, `SystemRootCause`, `SystemSupervisorReadModel`.
  - `server/src/systemIntegration/supervisor/rootCause.ts`: `projectRootCauses`, `readinessSeverity`.
  - `server/src/systemIntegration/supervisor/traceIndex.ts`: `buildSystemTraceIndex`, `traceByCorrelationId`, `recentCorrelatedDecisions`.
  - `server/src/productIntegration/runtime/trace.ts`: `PRODUCT_RUNTIME_TRACE_STAGES`, `projectProductCorrelationTrace`.
- Status: canonical read-only root-cause/attention/trace projection exists; it is not an incident lifecycle owner.
- Disposition: `REUSE_AS_IS`; Section 3: `REUSE`.

### R13 - Bounded in-memory queue, lag and replay seams

- Exact paths and symbols:
  - `server/src/intelligenceRuntime/lifecycle/queue.ts`: `InboundQueueMode`, `InboundQueueEntry`, `QueueOfferResult`, `BoundedQueueSnapshot`, `cloneBoundedQueueValue`, `BoundedInboundQueue`.
  - `server/src/intelligenceRuntime/lifecycle/lagMetrics.ts`: `ProcessingLagStats`, `ProcessingLagSnapshot`, `BoundedProcessingLagMetrics`.
  - `server/src/systemIntegration/contracts/types.ts`: `SystemQueueSnapshot`.
  - `server/src/foundation/replay/capture.ts`: `PrePostReplayCapture`.
  - `server/src/foundation/replay/ringBuffer.ts`: `BoundedRingBuffer`.
  - `server/src/foundation/replay/types.ts`: `ReplayStoragePort`.
- Status: bounded in-memory queue and lag primitives exist; `OP_RUNTIME_IN_MEMORY_QUEUE` in `server/src/productAssurance/catalog/core.ts` is owned by `INTELLIGENCE_RUNTIME` and `WIRED`.
- Disposition: primitives `REUSE_AS_IS` / Section 3 `REUSE`; an AI durable task queue/inbox/outbox/DLQ owner is currently `MISSING` / Section 3 `MISSING_REQUIRED`; any later Ledger-backed support requires `EXTEND_VIA_INSERTION_REQUEST` / Section 3 `ADAPT`.
- Missing: no dedicated AI-Ops broker or durable task queue exists. Absence is not permission to create a second canonical market/material-event queue, bus, cursor or socket.

### R14 - Canonical Product APIs and cockpit client

- Backend:
  - `server/src/productIntegration/runtime/router.ts`: `createProductIntegrationRuntimeRouter`.
  - `server/src/productIntegration/runtime/service.ts`: `ProductIntegrationRuntimeService`, `createProductIntegrationRuntime`.
  - Authenticated routes mounted under `/api/product-integration`: `GET /v1/supervisor`, `GET /v1/material-events`, `GET /v1/traces/:correlationId`, `POST /v1/commands/preview`, `POST /v1/commands`, `GET /v1/commands/:commandId/result`.
  - Authenticated `/ws` emits `canonical-supervisor-delta` and `material-event-page` with cursor continuity/gap handling.
- Web:
  - `web/src/lib/productIntegration/httpTransport.ts`: `ProductIntegrationEndpoints`, `createHttpProductIntegrationTransport`.
  - `web/src/lib/productIntegration/client.ts`: `ProductIntegrationTransport`, `ProductIntegrationClient`, `createProductIntegrationClient`, `ProductBindingError`.
  - `web/src/lib/productIntegration/useProductControlRoomBinding.ts`: `PRODUCT_MATERIAL_CURSOR_STORAGE_KEY`, `readDurableMaterialCursor`, `persistDurableMaterialCursor`, `proveMaterialContinuity`, `useProductControlRoomBinding`.
  - `web/src/features/productControlRoom/ProductControlRoomProvider.tsx`: `ProductControlRoomProvider`, `useProductControlRoomContext`.
  - `web/src/features/productControlRoom/ProductControlRoom.tsx`: `ProductControlRoom`.
  - `web/src/features/productControlRoom/ProductControlRoomRoute.tsx`: `ProductControlRoomRoute`.
  - `web/src/features/productControlRoom/surfaceMounts.ts`: `SURFACE_MOUNT_CONTRACTS`.
  - `web/src/App.tsx`: module-local `PRODUCT_INTEGRATION_ENDPOINTS`.
- Status: canonical Product API/client/cursor owner exists.
- Disposition: `REUSE_AS_IS`; AI endpoints and bindings `EXTEND_VIA_INSERTION_REQUEST`; Section 3: `REUSE` plus `ADAPT`.
- Hard boundary: no parallel polling client, WebSocket, client store, API authority or browser-owned readiness/incident truth.

### R15 - RefreshDock and existing refresh/reconnect owner

- Exact paths and symbols:
  - `web/src/components/Header.tsx`: `RefreshDock`.
  - `web/src/lib/refresh.ts`: `fireRefresh`, `useRefreshSignal`.
  - `web/src/lib/canonicalCockpitTruth.ts`: `canonicalRefreshTargetPosture`.
  - `server/src/index.ts`: `POST /api/refresh` and its existing target dispatch.
  - `web/src/App.tsx`: existing `RefreshDock` mount.
- Status: only bounded public targets `news`, `calendar`, and `fx` are executable through `POST /api/refresh`. Managed targets `all`, `market`, and `runtime` are preview-only and return `CONTROL_PREVIEW_REQUIRED`/HTTP 409; `account` is `NOT_CONFIGURED`.
- Disposition: public executable targets `REUSE_AS_IS` / Section 3 `REUSE`; managed-target activation and any AI reset/reconnect projection are currently unavailable and require `EXTEND_VIA_INSERTION_REQUEST` / Section 3 `ADAPT` after a real command owner exists.
- Hard boundary: no second reset API, restart owner, cadence owner or connection-control panel.

### R16 - Notifications, paging and acknowledgement

- Existing evidence:
  - `server/src/index.ts`: `notificationRoutingSnapshot`, `GET /api/notification-routing`; AWS notification intake remains owner-gated.
  - `web/src/lib/notifications.ts` and `web/src/pages/NotificationsPage.tsx`: cockpit notification projection.
  - `server/src/productIntegration/runtime/managedInventory.ts`: `notification-incident-router` is `NOT_CONFIGURED` with `INCIDENT_OWNER_NOT_CONFIGURED`.
- Status: UI/routing projection exists, but a canonical incident-linked page/ack/escalation/delivery owner and independent delivery proof are not configured.
- Disposition: existing projection `REUSE_AS_IS`; AI incident paging/ack/delivery `MISSING` pending incident-owner ratification and then `EXTEND_VIA_INSERTION_REQUEST`; Section 3: `REUSE` plus `MISSING_REQUIRED`.

### R17 - Telemetry, health projections and independent sentinel

- Reusable paths and symbols:
  - `server/src/foundation/observability/types.ts`: `DiagnosticsPolicy`, `DiagnosticsInput`, `DiagnosticsSnapshot`, `DiagnosticsResult`, `OBSERVABILITY_FAILURE_CODES`.
  - `server/src/foundation/observability/derive.ts`: `deriveDiagnostics`.
  - `server/src/systemIntegration/supervisor/**`: component health, queue, trace and root-cause projections.
  - `server/src/productAssurance/projections/operationalTruth.ts`: `projectTemporalCoherence`, `projectExecutionLease`, `projectTelemetryPipeline`, `projectIndependentSentinel`, `evaluateWatchdogDelivery`.
- Status: telemetry/sentinel evaluation vocabulary exists. A production external sentinel and independently administered WORM audit delivery are not configured/proven.
- Disposition: projections `REUSE_AS_IS`; AI metrics registration `EXTEND_VIA_INSERTION_REQUEST`; production sentinel/WORM proof `MISSING`; Section 3: `REUSE`, `ADAPT`, and `MISSING_REQUIRED` respectively.

### R18 - Auth, approval and external/provider authorization

- Existing auth seam: `server/src/security/access.ts`: `OperatorAccess`; Product routes are behind `operatorAccess.middleware()` in `server/src/index.ts`.
- Existing exact command preview/receipt types: `server/src/productIntegration/runtime/types.ts`: `ProductRuntimeOperator`, `ProductRuntimeControlPreview`, `ProductRuntimeCommandRequest`, `ProductRuntimeControlResult`, `ProductRuntimeCommandResultReadback`.
- Status: authenticated operator and command receipts exist. No generic AI production-approval owner, provider credential injection owner, or accepted I00 Section 20 provider authorization is configured. Capital approval contracts are capital-domain owners and cannot be repurposed.
- Disposition: auth/command receipt `REUSE_AS_IS` / Section 3 `REUSE`; isolated AI principals and a generic human approval owner are currently `MISSING` / Section 3 `MISSING_REQUIRED`; any later identity/approval binding requires `EXTEND_VIA_INSERTION_REQUEST` / Section 3 `ADAPT`; provider authorization remains `MISSING` until explicit human-owner activation.

### R19 - Isolated patch, test, release, canary and rollback mechanisms

- Reusable existing boundaries: Git worktrees/feature branches under `DIRECTOR.md`; repository test entrypoints in `package.json`; `server/src/systemIntegration/ops/**`; `server/src/services/deploymentFreezeFileSystem.ts`; deployment/runbook assets under `ops/i00/**`, `ops/live/**`, and `ops/templates/i00/**`.
- Status: repository isolation, tests, deployment freeze and owner-gated release/runbook assets exist. There is no AI patch-task service, provider credential, self-merge/deploy route, or AI-owned canary/rollback owner.
- Disposition: mechanisms `REUSE_AS_IS`/Section 3 `REFERENCE_ONLY`; AI repair adapter and artifact handoff `EXTEND_VIA_INSERTION_REQUEST`; any provider/deployment activation remains `MISSING` pending owner approval.
- Hard boundary: repair workers never write Main, merge, push, deploy, approve, or verify their own candidate.

## Exact duplicate rejection ledger

| Proposed duplicate | Section 3 class | Binding disposition |
| --- | --- | --- |
| Sentinel database, incident database, case database, approval store, workflow-history store or effect ledger | `REJECT_DUPLICATE` | Use the existing Ledger through canonical-owner insertion requests |
| Sentinel executor, AI executor, SSM executor or order/capital tool | `REJECT_DUPLICATE` | Existing deterministic command/remediation/release owners only; money actions permanently denied |
| Sentinel/AI Control Plane, Risk gate or health authority | `REJECT_DUPLICATE` | Reuse Foundation Control, System Integration truth and Product projections |
| Second canonical market/material-event bus, cursor, queue authority, socket or broad market producer | `REJECT_DUPLICATE` | Reuse `SystemTraceEvent`, Ledger material cursor, Product delivery and bounded queue primitives; a ratified AI task queue may exist only in the exclusive AI namespace through a Ledger insertion request |
| Separate AgentOps system or reconstructed `SEN-00..SEN-18` | `REJECT_DUPLICATE` | Consume S6/A-AGENT; superseded drafts grant no authority |
| Browser-computed incident, strategy, risk, capital or readiness truth | `REJECT_DUPLICATE` | Cockpit renders canonical server projections only |

## Authority-name resolution

| Directive name | Real authority at the cutoff | Exact Git object identity |
| --- | --- | --- |
| `BLUEPRINT.md` | `MISSION.md` plus `ARCHITECTURE.md` Part I | `03857dc...:MISSION.md` blob `239f0f938360e73e5b30d385acbf77b5d1a9a364`; `03857dc...:ARCHITECTURE.md` blob `93d7604599b43109eb67433e85101009c3f82b8e` |
| `DIRECTOR_RULEBOOK.md` | `DIRECTOR.md` plus `AGENTS.md` | blobs `c8f6b263904e40fe77eb5123a3d40d150e8abf72` and `d1c22f41616f3419468b5733dd1917527a0e21b0` |
| `PROJECT_MEMORY.md` | `docs/archive/**` plus live `QL_DIRECTOR_STATE.md` | archive tree `4ef4937c3c615ebb2e5258e64312d466c0c3b419`; state blob `8116ec491fc7fc863dbcb4015be4cdb105a5a1bc` |
| `ENGINE.md` | `ARCHITECTURE.md` Part II | `03857dc...:ARCHITECTURE.md` blob `93d7604599b43109eb67433e85101009c3f82b8e` |
| `DESIGN_PLAYBOOK.md` | `DESIGN.md` | `03857dc...:DESIGN.md` blob `da8d247c9a6dc4f9d072bccce64b59ba5cdc1da5` |
| Current product state | Integration Git objects and immutable receipts; the assigned-base/root `STATE.md` at `d78be24...` is stale by design, while the integration-cutoff `STATE.md` is newer but still not an accepted-SHA receipt | `03857dc...:STATE.md` blob `3b69b5d7a82f1263f2e6980f4b2484473b80e727` |
| S6 authority | `97e87bd...` packet plus `c57610c...:IP_ASSURANCE.md#7.1` | S6 packet tree `9fc6b226d195166b3aa3e3328f671c17840ffc5e`; law blob `308a7b90a3a75a707bb22a8880ee02b6acef9675` |
| S1 authority | `ab33b37...` packet; accepted-release Atlas remains missing | S1 packet tree `018187be07156abaea60c0ba91875232bb331803` |

Archived same-name files were also inspected and are historical `REFERENCE_ONLY`, not governing substitutes: `docs/archive/DIRECTOR_RULEBOOK.md` blob `0b4513051024a1e237105051a086166f820e2f64`; `docs/archive/BLUEPRINT.md` blob `edfc46a892e8cbdd9a88fe6c8e3e9654a3a52ae2`; `docs/archive/ENGINE.md` blob `63e2bbc4d0dde1a6eaa6efba0a04b32ed6716fda`; `docs/archive/PROJECT_MEMORY.md` blob `e61e796833942222a6fa99676198daf87fe588fe`; and `docs/archive/DESIGN_PLAYBOOK.md` blob `52cd828a8bf0970f230cf29589e5ec21ad944c5b`.

## Entry-gate result

The reuse gate does not pass yet because the immutable accepted SHA does not exist, the release-bound Operational Failure Atlas is missing, the canonical incident owner is not configured, and AI-specific persistence/auth/approval/provider/runtime/cockpit mounts require shared-owner insertion requests. The result is usable prestage evidence only:

`WAITING_INTEGRATED_ACCEPTED / NON_DONOR_ADVISORY_ONLY`
