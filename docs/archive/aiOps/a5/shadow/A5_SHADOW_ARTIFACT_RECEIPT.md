# A5 adversarial/fault/evaluation harness receipt

## Status and authority boundary

- Shadow status: `SHADOW_SPECULATIVE`
- Terminal state for this worktree: `SHADOW_ARTIFACT_READY`
- Branch: `aiops-shadow-a5-20260715`
- Exact supplied base: `03857dcdaff8d8b12627d27ddcc97505da1f2f86`
- Implementation artifact commit: `0adb10adb9870a76a4dc45b39d2c288c960576f0`
- Directive SHA-256: `cbc523fd18578641f6fcc02a5efb564ac861ca1320fcc189948a0725b41b5195`
- A5 command SHA-256: `4d938de306fb7577d8ff143677e30fb21fc3192da16d554c3a578b59566fb590`
- Owner time-optimization amendment SHA-256: `46549feced327d805c6057ecedffc8b65469c6537e5ce64b8c0a4f559eb1da30`
- D-LAUNCH-29 authority commit: `d309f5c4fef75a71137f09211660c3134c47f5a4`
- D-LAUNCH-30/current-main reference commit: `2b32317dbf89907bcf529231247f1f9a63235d49`

This is a shadow artifact only. It grants no `PRESTAGE_READY`, integration, acceptance, deployment, or runtime authority. Every generated campaign result is explicitly `SHADOW_SPECULATIVE`. No money path, real provider, real credential, live subscription authentication, deployment, merge, or push was added or exercised.

## Implementation changed-path inventory

The implementation commit contains exactly 25 paths: 13 fixture paths and 12 test paths, all inside the provisional A5 exclusive roots.

1. `fixtures/aiOps/harness/INSERTION_REQUEST_ROWS.DRAFT.v1.json`
2. `fixtures/aiOps/harness/RESEARCH_BASIS.md`
3. `fixtures/aiOps/harness/campaign-catalog.mjs`
4. `fixtures/aiOps/harness/campaign.mjs`
5. `fixtures/aiOps/harness/canonical.mjs`
6. `fixtures/aiOps/harness/contract-shapes.mjs`
7. `fixtures/aiOps/harness/fixture-factory.mjs`
8. `fixtures/aiOps/harness/interface-assumptions.v1.json`
9. `fixtures/aiOps/harness/oracles.mjs`
10. `fixtures/aiOps/harness/reference-harness.mjs`
11. `fixtures/aiOps/harness/scenario-expectations.mjs`
12. `fixtures/aiOps/harness/scenario-programs.mjs`
13. `fixtures/aiOps/harness/scripted-subject.mjs`
14. `test/aiOps/harness/ai-off-survival.test.mjs`
15. `test/aiOps/harness/campaign.test.mjs`
16. `test/aiOps/harness/catalog-coverage.test.mjs`
17. `test/aiOps/harness/contract-shapes.test.mjs`
18. `test/aiOps/harness/fault-families.test.mjs`
19. `test/aiOps/harness/hard-denial-boundary.test.mjs`
20. `test/aiOps/harness/network-deny.mjs`
21. `test/aiOps/harness/network-deny.test.mjs`
22. `test/aiOps/harness/oracle-mutation.test.mjs`
23. `test/aiOps/harness/purity-scope.test.mjs`
24. `test/aiOps/harness/restart-replay-fencing.test.mjs`
25. `test/aiOps/harness/scripted-subject.test.mjs`

The receipt-seal commit adds only `fixtures/aiOps/harness/receipts/A5_SHADOW_ARTIFACT_RECEIPT.md`. No composition, route, navigation, persistence, authentication, package, deployment, canonical-registry, or other shared path was edited.

## Artifact shape and coverage

The artifact is a deterministic, network-free reference campaign runner against strict provisional A1-A3 contract shapes. It contains 120 explicit §16 scenario programs, 17 §14-A5 fault families, 21 independent oracles, exact raw subject-result schemas, canonical step/trace/report hashing, replay binding, bounded resources, injected clocks, and mutation tests hostile to canned or false-green output. All fixtures, identities, credentials, provider metadata, and endpoints are obviously synthetic.

The 17 covered campaign families are:

1. `INJECTION_EXFILTRATION`
2. `STALE_CONFLICTING_EVIDENCE`
3. `MISSING_TELEMETRY`
4. `PROVIDER_OUTAGE_QUOTA_COST`
5. `DUPLICATE_CALLBACK`
6. `MALFORMED_TOOL_OUTPUT`
7. `ATTEMPTED_MONEY_ACTION`
8. `ATTEMPTED_PERMISSION_CHANGE`
9. `FAILED_PATCH_TEST_CANARY_ROLLBACK`
10. `AI_SELF_FAILURE_AI_OFF`
11. `QUEUE_DLQ_WAL_TELEMETRY_POLICY_AUDIT_SENTINEL`
12. `HOSTILE_INVESTIGATION_EFFECT_BOUNDARY`
13. `ALERT_STORM_INHIBITION_CONTEXT_CHILD_ESCAPE`
14. `WORKFLOW_REPLAY_POLICY_SIGNATURE_CREDENTIAL_AUDIT`
15. `NO_DATA_CANARY_UNQUALIFIED_FAILOVER`
16. `DURABLE_RESTART_STALE_APPROVAL`
17. `TWO_EXECUTOR_STALE_FENCING`

The §4.3 boundary exercises all 14 enumerated money-action classes and requires exact hard denial before dispatch. Permission expansion, child-agent escape, hostile tool/log/web injection, unqualified provider failover, stale approvals, and stale fencing also fail closed. Total provider death produces a complete AI-off state while the deterministic Product projection and protected state remain byte-stable; this is simulation evidence, not a claim about an integrated live runtime.

## Verification evidence

### Focused total-network-deny suite

Command:

```text
/usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network*)' node --import ./test/aiOps/harness/network-deny.mjs --test --test-concurrency=1 --test-reporter=spec "test/aiOps/harness/**/*.test.mjs"
```

Result: exit `0`; `85` tests passed, `0` failed, `0` cancelled, `0` skipped, `0` todo. An independent read-only rerun reproduced `85/85` under the same OS network denial.

### Determinism and campaign proof

- Two independent OS-network-denied campaign processes both exited `0` and produced byte-identical canonical output.
- Scenario results: `120` passed, `0` failed, across all `17` families and `21` oracles.
- Validation issues: `[]`.
- Embedded canonical report hash: `bffe1f6d675e8f8e7eb65235f56e7a76bed4531cd2f2b0775b6d89311fc23cd5`.
- Serialized report bytes: `127559`.
- Serialized report SHA-256: `2887d75836857325d576122d48ddfbdbaada22326e7d4301a0bf96d3606dfee9`.
- Every one of the `167` top-level stimulus keys is referenced by executable subject logic.

### Contract, mutation, syntax, and scope proof

- Strict provisional contract regression: `29/29` passed under OS network denial.
- Independent malformed-contract probe: all `9/9` malformed classes were rejected.
- Syntax: `node --check` passed for all `22` `.mjs` files.
- JSON: `jq` validation passed for both JSON artifacts.
- Scope audit: exactly `25` implementation paths; no out-of-scope path, symlink, executable bit, package edit, shared edit, real secret, real endpoint, or real authentication material.
- Pure fixture modules import only fixture-local modules and `node:crypto`; they do not read environment or filesystem state and do not use network, timers, import-time effects, `Math.random()`, or unbounded queues.
- `git diff --cached --check` passed before the implementation commit.

### Required root gates attempted

- `npm test`: exit `127`; blocked before Product tests because the unhydrated base cannot resolve `tsc` (`tsc: command not found`).
- `npm run test:all`: exit `127`; same missing-`tsc` toolchain blocker.

The A5 worker did not install dependencies or edit package files because both are outside the exclusive path grant. These root-gate failures are environment/toolchain failures and are not reported as green. The focused A5 suite is also not discovered by the base root scripts; canonical mounting remains insertion request `AIOPS-IR-TEST-MOUNT-026`.

## Provisional interface assumptions

The complete machine-readable record is `fixtures/aiOps/harness/interface-assumptions.v1.json`. Every row has `authorityCreated: false`.

1. `A5-ASSUME-001` — I00 `AcceptedBase`: supplied base is shadow source only; an accepted SHA is unfinished.
2. `A5-ASSUME-002` — I00 `IncidentOwner`: incident identity and transitions are fixture-local because no configured owner is exposed.
3. `A5-ASSUME-003` — A1 `PolicyApprovalActionContracts`: policy, permission, budget, approval, action, control, guardrail, and recovery envelopes are provisional.
4. `A5-ASSUME-004` — A2 `EvidenceCaseWorkflowContracts`: evidence, case, workflow checkpoint, and diagnostic envelopes are provisional.
5. `A5-ASSUME-005` — A3 `ProviderToolDeliveryContracts`: provider, tool, callback, typed output, credential proxy, verification, canary, rollback, usage, and audit envelopes are provisional.
6. `A5-ASSUME-006` — A2 `DurableStorageAdapters`: AI durable tables/adapters are absent; the existing Ledger remains sole owner.
7. `A5-ASSUME-007` — I00 `CanonicalEventKind`: the AI operations material-event kind is absent at the supplied base.
8. `A5-ASSUME-008` — I00 `ControlRegistry`: the canonical registry has no AI_OPS namespace at the supplied base.
9. `A5-ASSUME-009` — I00 `ExternalOwners`: sentinel, notification, WORM audit, credential proxy, release canary, rollback, approval, and verifier mounts are absent or unproven.
10. `A5-ASSUME-010` — A3 `ProviderState`: the directive’s five provider states are used provisionally and must be reconciled without semantic drift.
11. `A5-ASSUME-011` — A5 `TestMount`: root scripts do not discover this focused suite.
12. `A5-ASSUME-012` — A5 `EvidenceBoundary`: only deterministic contract/fault/replay/security/budget/canary simulation is proven; post-port runtime evidence remains required.
13. `A5-ASSUME-013` — I00 `OperationalFailureAtlas`: the release-bound owner catalog is absent and this campaign does not substitute for it.

## Typed insertion requests

The complete typed draft packet is `fixtures/aiOps/harness/INSERTION_REQUEST_ROWS.DRAFT.v1.json`. Every row is `DRAFT`, has `directEditAllowed: false` at packet level, and has `authorityCreated: false`.

1. `AIOPS-IR-COMPOSITION-001` — `systemIntegration`: accepted AI operations composition adapter.
2. `AIOPS-IR-PERSISTENCE-003` — `ledger`: AI case and receipt persistence adapter.
3. `AIOPS-IR-AUTH-004` — canonical permission and approval owner: principal permission and approval validation.
4. `AIOPS-IR-PACKAGE-006` — package owner: canonical scripts and dependencies.
5. `AIOPS-IR-DEPLOYMENT-007` — release owner: canary, rollback, and deployed-SHA readback.
6. `AIOPS-IR-CONTROLS-008` — control registry owner: AI_OPS namespace and atomic control changes.
7. `AIOPS-IR-EVENTS-009` — canonical material-event owner: AI operations event projection.
8. `AIOPS-IR-REMEDIATION-010` — existing remediation owner: registered non-trading `ActionEnvelope` adapter.
9. `AIOPS-IR-ASSURANCE-011` — independent verification owner: verification and post-state readback.
10. `AIOPS-IR-TELEMETRY-012` — telemetry owner: evidence and telemetry read adapter.
11. `AIOPS-IR-REFRESH-013` — RefreshDock owner: Class-A reconnect request.
12. `AIOPS-IR-NOTIFY-014` — notification owner: out-of-band delivery.
13. `AIOPS-IR-EGRESS-016` — egress and credential owner: credential proxy and endpoint policy.
14. `AIOPS-IR-INCIDENT-019` — incident owner: incident admission and state projection.
15. `AIOPS-IR-SENTINEL-020` — external sentinel owner: independent Product and AI-plane heartbeat.
16. `AIOPS-IR-AUDIT-021` — audit owner: append-only export and WORM readback.
17. `AIOPS-IR-MANAGED-INVENTORY-022` — component inventory owner: AI managed-component projection.
18. `AIOPS-IR-APPROVAL-023` — approval UI and API owner: authenticated owner approval handoff.
19. `AIOPS-IR-BROWSER-PROBE-024` — browser probe owner: critical DOM freshness evidence.
20. `AIOPS-IR-CONFIG-025` — configuration owner: signed policy and provider configuration projection.
21. `AIOPS-IR-TEST-MOUNT-026` — package test owner: root deterministic and all-suite discovery.

## Explicit unfinished-interface dependence

- I00 remains required for the accepted base identity, incident owner, canonical material-event kind, AI_OPS control registry, external owner mounts, and the Operational Failure Atlas. None is created or claimed here.
- A1 remains required for authoritative policy, permission, budget, approval, action, control-change, guardrail, and break-glass schemas plus classification manifests.
- A2 remains required for authoritative evidence, event, case, queue, DLQ, checkpoint, workflow, budget, and sole-Ledger adapter contracts.
- A3 remains required for authoritative provider, broker, tool, credential-proxy, callback, audit, verifier, canary, rollback, and usage contracts.
- A5 remains dependent on the package owner to mount the focused suite into canonical root gates.

Until the corresponding lane receipts exist, fixture shapes are test subjects, not owners or canonical interfaces. Any mismatch after integration is a port-time rejection or rebuild condition, never permission to duplicate an owner.

## Research and evidence boundaries

Current primary-source research that informed the test boundaries is recorded in `fixtures/aiOps/harness/RESEARCH_BASIS.md`, including OWASP prompt-injection/output-handling guidance, OpenTelemetry resiliency, OPA bundle management, Argo Rollouts analysis behavior, etcd fencing primitives, NIST zero-trust guidance, and Temporal deterministic replay guidance.

This receipt proves only the committed deterministic shadow artifact and its recorded local executions. It does not prove integrated runtime wiring, a real process restart, browser behavior, load/soak behavior, external sentinel independence, notification delivery, WORM export/readback, provider availability, real credential handling, real canary or rollback execution, or any live operational effect.

## Mandatory post-port law

At `INTEGRATED_ACCEPTED`, this implementation diff must be ported into a fresh worktree created from the exact accepted SHA. The porter must compare every assumption and provisional shape against accepted I00/A1/A2/A3 interfaces, reject or rebuild conflicts and duplicate-owner paths, and rerun the entire lane acceptance loop—including focused total-network-deny, root gates, integration, runtime, replay, security, failure, and evidence readback checks—before any real receipt can exist. This shadow receipt cannot substitute for that loop.

SHADOW_ARTIFACT_READY
