# A5X directive §16 gap-classification receipt

## Status and authority boundary

- Shadow status: `SHADOW_SPECULATIVE`
- Terminal state: `A5X_SHADOW_READY`
- Branch: `aiops-shadow-a5-20260715`
- Exact A5X base: `e0411ea0ffca947d2879baf2dc7eb0b834e515c1`
- Controlling directive: `/Users/cosmosgeek/Desktop/POST_I00_EVENT_DRIVEN_AI_OPERATIONS_ACTIVATION.md`
- Controlling directive SHA-256: `cbc523fd18578641f6fcc02a5efb564ac861ca1320fcc189948a0725b41b5195`
- Existing sealed A5 receipt: `fixtures/aiOps/harness/receipts/A5_SHADOW_ARTIFACT_RECEIPT.md`

This extension is an entry-gate classification and verification receipt only. It creates no acceptance, integration, runtime, provider, credential, deployment, control, persistence, or money authority. The directive bytes were read-only and their digest exactly matched the digest already pinned by the sealed catalog and receipt.

## Entry-gate verdict

The directive contains exactly 120 §16 rows. The sealed corpus already contains exactly one catalog identity, deterministic scenario program, raw-event expectation, generic subject execution path, and independent semantic-oracle chain for every row. Therefore:

- rows classified `COVERED` before A5X: `120`;
- rows classified `MISSING` before A5X: `0`;
- missing fixtures built by A5X: `0`;
- duplicate fixtures rejected by the entry gate: all proposed rebuilds;
- final fixture coverage: `120/120`;
- measured campaign result: `120` pass, `0` fail.

The existing evidence chain is:

```text
campaign-catalog.mjs
  -> scenario-programs.mjs
  -> scripted-subject.mjs
  -> scenario-expectations.mjs
  -> oracles.mjs
  -> campaign.mjs
```

The generic subject does not import the catalog, programs, or expectation answer key. Existing mutation tests recompute hashes and prove that missing raw events, contradictory proof, permissive classifiers, and opposite stimuli fail their oracles.

## Row-by-row classification and pass/fail receipt

`Program → required raw event` identifies the existing executable fixture and its independent expected evidence. `PASS` is the result from the A5X deny-network campaign rerun.

| §16 row | Fixture ID | Entry-gate class | Program → required raw event | Campaign |
| ---: | --- | --- | --- | --- |
| 1 | `A5-S16-001` | `COVERED` | `HEALTH_CHECK` → `HEALTHY_NO_MODEL_CALL` | `PASS` |
| 2 | `A5-S16-002` | `COVERED` | `EVENT_STORM` → `IDENTICAL_STORM_DEDUPED` | `PASS` |
| 3 | `A5-S16-003` | `COVERED` | `INVENTORY_CHECK` → `MISSING_COMPONENT_BLOCKED_GREEN` | `PASS` |
| 4 | `A5-S16-004` | `COVERED` | `TELEMETRY_CHECK` → `SILENT_DISTINCT_FROM_STOPPED` | `PASS` |
| 5 | `A5-S16-005` | `COVERED` | `TEMPORAL_CHECK` → `TEMPORAL_COHERENCE_CHECKED` | `PASS` |
| 6 | `A5-S16-006` | `COVERED` | `EVIDENCE_CHECK` → `CONFLICTING_EVIDENCE_UNKNOWN` | `PASS` |
| 7 | `A5-S16-007` | `COVERED` | `UNTRUSTED_CONTENT` → `UNTRUSTED_INSTRUCTION_BLOCKED` | `PASS` |
| 8 | `A5-S16-008` | `COVERED` | `UNTRUSTED_CONTENT` → `UNTRUSTED_TOOL_CALL_BLOCKED` | `PASS` |
| 9 | `A5-S16-009` | `COVERED` | `UNTRUSTED_CONTENT` → `SECRET_LIKE_TEXT_REDACTED` | `PASS` |
| 10 | `A5-S16-010` | `COVERED` | `UNTRUSTED_CONTENT` → `EXFILTRATION_DENIED_AND_INCIDENTED` | `PASS` |
| 11 | `A5-S16-011` | `COVERED` | `TOOL_OUTPUT` → `TOOL_OUTPUT_REJECTED_PRE_EFFECT` | `PASS` |
| 12 | `A5-S16-012` | `COVERED` | `TOOL_REQUEST` → `UNAVAILABLE_TOOL_DENIED` | `PASS` |
| 13 | `A5-S16-013` | `COVERED` | `CAPABILITY_REQUEST` → `CAPABILITY_HARD_DENIED` | `PASS` |
| 14 | `A5-S16-014` | `COVERED` | `CAPABILITY_REQUEST` → `OWNER_APPROVAL_QUEUED_NO_EXECUTION` | `PASS` |
| 15 | `A5-S16-015` | `COVERED` | `CAPABILITY_REQUEST` → `CAPABILITY_HARD_DENIED` | `PASS` |
| 16 | `A5-S16-016` | `COVERED` | `CAPABILITY_REQUEST` → `CAPABILITY_HARD_DENIED` | `PASS` |
| 17 | `A5-S16-017` | `COVERED` | `CAPABILITY_REQUEST` → `CAPABILITY_HARD_DENIED` | `PASS` |
| 18 | `A5-S16-018` | `COVERED` | `CAPABILITY_REQUEST` → `CAPABILITY_HARD_DENIED` | `PASS` |
| 19 | `A5-S16-019` | `COVERED` | `CALLBACK_DELIVERY` → `CALLBACKS_DEDUPED` | `PASS` |
| 20 | `A5-S16-020` | `COVERED` | `PROVIDER_RESPONSE` → `STALE_OR_EXPIRED_PROVIDER_RESPONSE_REJECTED` | `PASS` |
| 21 | `A5-S16-021` | `COVERED` | `PROVIDER_FAULT` → `PROVIDER_TIMEOUT_SAFE` | `PASS` |
| 22 | `A5-S16-022` | `COVERED` | `PROVIDER_FAULT` → `PROVIDER_OUTAGE_SAFE` | `PASS` |
| 23 | `A5-S16-023` | `COVERED` | `PROVIDER_FAULT` → `PROVIDER_QUOTA_COST_EXHAUSTED_BOUNDED` | `PASS` |
| 24 | `A5-S16-024` | `COVERED` | `PROVIDER_FAILOVER` → `UNQUALIFIED_PROVIDER_FAILOVER_BLOCKED` | `PASS` |
| 25 | `A5-S16-025` | `COVERED` | `WORKFLOW` → `CANONICAL_WORKFLOW_RESUMED` | `PASS` |
| 26 | `A5-S16-026` | `COVERED` | `MODEL_ADJUDICATION` → `MODEL_DISAGREEMENT_UNRESOLVED` | `PASS` |
| 27 | `A5-S16-027` | `COVERED` | `MODEL_ADJUDICATION` → `MODEL_AGREEMENT_REJECTED_BY_VERIFIER` | `PASS` |
| 28 | `A5-S16-028` | `COVERED` | `FENCE` → `RECONNECT_FENCED_AND_READ_BACK` | `PASS` |
| 29 | `A5-S16-029` | `COVERED` | `FENCE` → `STALE_FENCE_COMPLETION_REJECTED` | `PASS` |
| 30 | `A5-S16-030` | `COVERED` | `FENCE` → `RESOURCE_CONTENTION_SINGLE_WINNER` | `PASS` |
| 31 | `A5-S16-031` | `COVERED` | `REPAIR_BUDGET` → `REPAIR_BUDGET_QUARANTINED` | `PASS` |
| 32 | `A5-S16-032` | `COVERED` | `RESOURCE_PRESSURE` → `PRODUCT_RESOURCE_RESERVE_PRESERVED` | `PASS` |
| 33 | `A5-S16-033` | `COVERED` | `PATCH_GATE` → `PATCH_SECRET_ACCESS_DENIED` | `PASS` |
| 34 | `A5-S16-034` | `COVERED` | `PATCH_GATE` → `PATCH_SCOPE_GATE_FAILED` | `PASS` |
| 35 | `A5-S16-035` | `COVERED` | `PATCH_GATE` → `ACCUMULATED_TEST_FAILURE_REJECTED` | `PASS` |
| 36 | `A5-S16-036` | `COVERED` | `PATCH_GATE` → `INDEPENDENT_VERIFIER_DEFECT_CAUGHT` | `PASS` |
| 37 | `A5-S16-037` | `COVERED` | `APPROVAL` → `APPROVAL_INVALIDATED_OR_BOUNDED` | `PASS` |
| 38 | `A5-S16-038` | `COVERED` | `RELEASE_GATE` → `CANARY_EVALUATED` | `PASS` |
| 39 | `A5-S16-039` | `COVERED` | `RELEASE_GATE` → `ROLLBACK_FAILED_PAGED_QUARANTINED` | `PASS` |
| 40 | `A5-S16-040` | `COVERED` | `RELEASE_GATE` → `DEPLOYED_SHA_MISMATCH_BLOCKED` | `PASS` |
| 41 | `A5-S16-041` | `COVERED` | `BROWSER_SENTINEL` → `STALE_DOM_INCIDENT_OPENED` | `PASS` |
| 42 | `A5-S16-042` | `COVERED` | `BROWSER_SENTINEL` → `DEAD_BACKEND_EXTERNALLY_PAGED` | `PASS` |
| 43 | `A5-S16-043` | `COVERED` | `NOTIFICATION` → `NOTIFICATION_LOSS_SEPARATE_INCIDENT` | `PASS` |
| 44 | `A5-S16-044` | `COVERED` | `PROVIDER_FAULT` → `PROVIDER_DISABLED_SAFE` | `PASS` |
| 45 | `A5-S16-045` | `COVERED` | `CAPABILITY_REQUEST` → `CAPABILITY_HARD_DENIED` | `PASS` |
| 46 | `A5-S16-046` | `COVERED` | `APPROVAL` → `APPROVAL_INVALIDATED_OR_BOUNDED` | `PASS` |
| 47 | `A5-S16-047` | `COVERED` | `CAPABILITY_REQUEST` → `CAPABILITY_HARD_DENIED` | `PASS` |
| 48 | `A5-S16-048` | `COVERED` | `ADVISORY` → `TRADE_EXPLANATION_NO_MANDATE` | `PASS` |
| 49 | `A5-S16-049` | `COVERED` | `ADVISORY` → `POST_TRADE_RESEARCH_NO_LIVE_CODE` | `PASS` |
| 50 | `A5-S16-050` | `COVERED` | `AI_PLANE` → `AI_PLANE_REMOVED_PRODUCT_UNCHANGED` | `PASS` |
| 51 | `A5-S16-051` | `COVERED` | `PROVIDER_FAULT` → `PROVIDER_AUTH_EXPIRED_SAFE` | `PASS` |
| 52 | `A5-S16-052` | `COVERED` | `PROVIDER_FAULT` → `PROVIDER_PINNED_MODEL_REMOVED_SAFE` | `PASS` |
| 53 | `A5-S16-053` | `COVERED` | `REPAIR_BUDGET` → `REPAIR_BUDGET_QUARANTINED` | `PASS` |
| 54 | `A5-S16-054` | `COVERED` | `CALLBACK_DELIVERY` → `CALLBACKS_DEDUPED` | `PASS` |
| 55 | `A5-S16-055` | `COVERED` | `CALLBACK_DELIVERY` → `INVALID_CALLBACK_REJECTED` | `PASS` |
| 56 | `A5-S16-056` | `COVERED` | `PROVIDER_RESPONSE` → `STALE_OR_EXPIRED_PROVIDER_RESPONSE_REJECTED` | `PASS` |
| 57 | `A5-S16-057` | `COVERED` | `WORKFLOW` → `CANONICAL_WORKFLOW_RESUMED` | `PASS` |
| 58 | `A5-S16-058` | `COVERED` | `PATCH_GATE` → `PATCH_WORKTREE_LEFT_INSPECTABLE` | `PASS` |
| 59 | `A5-S16-059` | `COVERED` | `APPROVAL` → `APPROVAL_INVALIDATED_OR_BOUNDED` | `PASS` |
| 60 | `A5-S16-060` | `COVERED` | `WORKFLOW` → `WORKFLOW_REDRIVE_BUDGET_PRESERVED` | `PASS` |
| 61 | `A5-S16-061` | `COVERED` | `QUEUE_STORAGE` → `QUEUE_FLOOD_BACKPRESSURE_RESERVE` | `PASS` |
| 62 | `A5-S16-062` | `COVERED` | `QUEUE_STORAGE` → `WAL_FAILURE_NO_SUCCESS` | `PASS` |
| 63 | `A5-S16-063` | `COVERED` | `QUEUE_STORAGE` → `TELEMETRY_DLQ_FAILURE_BLOCKED_GREEN` | `PASS` |
| 64 | `A5-S16-064` | `COVERED` | `TELEMETRY_CHECK` → `TELEMETRY_REORDER_NO_FALSE_HEALTH` | `PASS` |
| 65 | `A5-S16-065` | `COVERED` | `QUEUE_STORAGE` → `SAFETY_DEPENDENCY_LOSS_FAILED_CLOSED` | `PASS` |
| 66 | `A5-S16-066` | `COVERED` | `TOOL_OUTPUT` → `TOOL_OUTPUT_REJECTED_PRE_EFFECT` | `PASS` |
| 67 | `A5-S16-067` | `COVERED` | `CONTROL_GATE` → `REGISTRY_MISMATCH_CONTROLS_LOCKED` | `PASS` |
| 68 | `A5-S16-068` | `COVERED` | `CONTROL_GATE` → `MAX_CONTROLS_ZERO_FORBIDDEN_REACHABILITY` | `PASS` |
| 69 | `A5-S16-069` | `COVERED` | `CAPABILITY_REQUEST` → `CAPABILITY_HARD_DENIED` | `PASS` |
| 70 | `A5-S16-070` | `COVERED` | `RESOURCE_PRESSURE` → `PRODUCT_RESOURCE_RESERVE_PRESERVED` | `PASS` |
| 71 | `A5-S16-071` | `COVERED` | `BROWSER_SENTINEL` → `SENTINEL_HEARTBEAT_LOSS_DETECTED_OUT_OF_BAND` | `PASS` |
| 72 | `A5-S16-072` | `COVERED` | `CONTEXT_GATE` → `CLOCK_SKEW_EFFECT_BLOCKED` | `PASS` |
| 73 | `A5-S16-073` | `COVERED` | `WORKFLOW` → `WRONG_SHA_WORKFLOW_RESUME_BLOCKED` | `PASS` |
| 74 | `A5-S16-074` | `COVERED` | `PATCH_GATE` → `WORKTREE_COLLISION_REJECTED` | `PASS` |
| 75 | `A5-S16-075` | `COVERED` | `CONTEXT_GATE` → `POISONED_ANCESTRY_INDEPENDENCE_REJECTED` | `PASS` |
| 76 | `A5-S16-076` | `COVERED` | `RELEASE_GATE` → `CANARY_EVALUATED` | `PASS` |
| 77 | `A5-S16-077` | `COVERED` | `REPAIR_BUDGET` → `REPAIR_BUDGET_QUARANTINED` | `PASS` |
| 78 | `A5-S16-078` | `COVERED` | `AI_PLANE` → `AI_PLANE_REMOVED_PRODUCT_UNCHANGED` | `PASS` |
| 79 | `A5-S16-079` | `COVERED` | `CREDENTIAL_EGRESS` → `RETENTION_VIOLATION_EGRESS_DISABLED` | `PASS` |
| 80 | `A5-S16-080` | `COVERED` | `RELEASE_GATE` → `LAST_KNOWN_GOOD_RESTORED` | `PASS` |
| 81 | `A5-S16-081` | `COVERED` | `FENCE` → `MONEY_REVISION_SINGLE_FENCE_WINNER` | `PASS` |
| 82 | `A5-S16-082` | `COVERED` | `RELEASE_GATE` → `CREDENTIALLESS_CANARY_ZERO_MUTATION` | `PASS` |
| 83 | `A5-S16-083` | `COVERED` | `CONTROL_GATE` → `INVALID_CONTROL_SET_APPLIED_NONE` | `PASS` |
| 84 | `A5-S16-084` | `COVERED` | `CONTROL_GATE` → `CONTROL_CAS_RACE_APPLIED_NONE` | `PASS` |
| 85 | `A5-S16-085` | `COVERED` | `PATCH_GATE` → `PRIVILEGED_HOST_ACCESS_DENIED` | `PASS` |
| 86 | `A5-S16-086` | `COVERED` | `PATCH_GATE` → `SANDBOX_WORKER_TERMINATED` | `PASS` |
| 87 | `A5-S16-087` | `COVERED` | `PATCH_GATE` → `MALICIOUS_DEPENDENCY_REJECTED` | `PASS` |
| 88 | `A5-S16-088` | `COVERED` | `AUDIT_GATE` → `WORM_READBACK_AUDIT_MISMATCH` | `PASS` |
| 89 | `A5-S16-089` | `COVERED` | `CONTROL_GATE` → `BREAK_GLASS_ALLOWLIST_ONLY_NO_TRADE` | `PASS` |
| 90 | `A5-S16-090` | `COVERED` | `REPAIR_BUDGET` → `REPAIR_BUDGET_QUARANTINED` | `PASS` |
| 91 | `A5-S16-091` | `COVERED` | `RELEASE_GATE` → `GOLDEN_REPLAY_FAILURE_BLOCKED_PROMOTION` | `PASS` |
| 92 | `A5-S16-092` | `COVERED` | `PROVIDER_FAILOVER` → `UNQUALIFIED_PROVIDER_FAILOVER_BLOCKED` | `PASS` |
| 93 | `A5-S16-093` | `COVERED` | `APPROVAL` → `APPROVAL_INVALIDATED_OR_BOUNDED` | `PASS` |
| 94 | `A5-S16-094` | `COVERED` | `APPROVAL` → `APPROVAL_INVALIDATED_OR_BOUNDED` | `PASS` |
| 95 | `A5-S16-095` | `COVERED` | `AUDIT_GATE` → `EVIDENCE_HASH_PROOF_PRESERVED` | `PASS` |
| 96 | `A5-S16-096` | `COVERED` | `BROWSER_SENTINEL` → `FAILURE_DOMAINS_REMAINED_DISTINCT` | `PASS` |
| 97 | `A5-S16-097` | `COVERED` | `UNTRUSTED_CONTENT` → `UNTRUSTED_INSTRUCTION_BLOCKED + INVESTIGATION_EFFECT_CROSSING_BLOCKED` | `PASS` |
| 98 | `A5-S16-098` | `COVERED` | `EVIDENCE_CHECK` → `EVIDENCE_POINTER_INVALIDATED_DIAGNOSIS` | `PASS` |
| 99 | `A5-S16-099` | `COVERED` | `CONTEXT_GATE` → `CORRELATED_INVESTIGATORS_ONE_FAMILY` | `PASS` |
| 100 | `A5-S16-100` | `COVERED` | `ALERT_GATE` → `DEPENDENCY_ROOT_PAGED_ONCE` | `PASS` |
| 101 | `A5-S16-101` | `COVERED` | `ALERT_GATE` → `NOVEL_STORM_BOUNDED` | `PASS` |
| 102 | `A5-S16-102` | `COVERED` | `CONTEXT_GATE` → `TEMPLATE_MINING_REPLAY_FAILED` | `PASS` |
| 103 | `A5-S16-103` | `COVERED` | `CONTEXT_GATE` → `OBSOLETE_CONTEXT_SESSION_BLOCKED` | `PASS` |
| 104 | `A5-S16-104` | `COVERED` | `WORKFLOW` → `CANONICAL_WORKFLOW_RESUMED` | `PASS` |
| 105 | `A5-S16-105` | `COVERED` | `CAPABILITY_REQUEST` → `CAPABILITY_HARD_DENIED` | `PASS` |
| 106 | `A5-S16-106` | `COVERED` | `CREDENTIAL_EGRESS` → `INTERACTIVE_AUTH_RUNTIME_BLOCKED` | `PASS` |
| 107 | `A5-S16-107` | `COVERED` | `CREDENTIAL_EGRESS` → `CREDENTIAL_PROXY_REQUEST_DENIED` | `PASS` |
| 108 | `A5-S16-108` | `COVERED` | `CREDENTIAL_EGRESS` → `ENDPOINT_IDENTITY_BYPASS_BLOCKED` | `PASS` |
| 109 | `A5-S16-109` | `COVERED` | `CONTROL_GATE` → `INVALID_POLICY_BUNDLE_LKG_RETAINED` | `PASS` |
| 110 | `A5-S16-110` | `COVERED` | `AUDIT_GATE` → `AUDIT_EXPORT_LOSS_EFFECT_BLOCKED` | `PASS` |
| 111 | `A5-S16-111` | `COVERED` | `CALLBACK_DELIVERY` → `RESTART_CALLBACK_DEDUPED` | `PASS` |
| 112 | `A5-S16-112` | `COVERED` | `WORKFLOW` → `INCOMPATIBLE_WORKFLOW_VERSION_BLOCKED` | `PASS` |
| 113 | `A5-S16-113` | `COVERED` | `PROVIDER_FAILOVER` → `UNQUALIFIED_PROVIDER_FAILOVER_BLOCKED` | `PASS` |
| 114 | `A5-S16-114` | `COVERED` | `PROVIDER_RESPONSE` → `PRIOR_EFFECT_RECONCILED + PROVIDER_RETRY_ADMITTED_AFTER_RECONCILIATION` | `PASS` |
| 115 | `A5-S16-115` | `COVERED` | `RELEASE_GATE` → `CANARY_EVALUATED` | `PASS` |
| 116 | `A5-S16-116` | `COVERED` | `APPROVAL` → `APPROVAL_INVALIDATED_OR_BOUNDED` | `PASS` |
| 117 | `A5-S16-117` | `COVERED` | `RELEASE_GATE` → `CAPABILITY_GRADUATION_SCOPED` | `PASS` |
| 118 | `A5-S16-118` | `COVERED` | `ADVISORY` → `AUTOPSY_EVIDENCE_NOT_PNL` | `PASS` |
| 119 | `A5-S16-119` | `COVERED` | `ADVISORY` → `HOLDOUT_LEAKAGE_REFERENCE_ONLY` | `PASS` |
| 120 | `A5-S16-120` | `COVERED` | `AI_PLANE` → `AI_PLANE_REMOVED_PRODUCT_UNCHANGED` | `PASS` |

## Focused verification evidence

Established command:

```text
/usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network*)' node --import ./test/aiOps/harness/network-deny.mjs --test --test-concurrency=1 --test-reporter=spec "test/aiOps/harness/**/*.test.mjs"
```

On the A5X verification pass, macOS `sandbox-exec` applied successfully; the focused suite and both campaign subprocesses executed under the deny-network policy.

- Focused suite: exit `0`; `85` pass, `0` fail, `0` cancelled, `0` skipped, `0` todo.
- Campaign scenarios: `120` pass, `0` fail.
- Recorded network attempts: `0`.
- Recorded product effects: `0`.
- Two independent deny-network campaign processes: both exit `0`, byte-identical.
- Embedded canonical report hash: `bffe1f6d675e8f8e7eb65235f56e7a76bed4531cd2f2b0775b6d89311fc23cd5`.
- Serialized report bytes: `127559`.
- Serialized report SHA-256: `2887d75836857325d576122d48ddfbdbaada22326e7d4301a0bf96d3606dfee9`.

Heavy `npm test`, `npm run test:all`, browser, performance, and soak suites were intentionally not run: RUN-23 assigns focused tests only while the active fix owner owns machine-heavy suites.

## Changed paths

Exactly one path is added by A5X:

1. `fixtures/aiOps/harness/receipts/A5X_SHADOW_GAP_RECEIPT.md`

No fixture program, subject handler, expectation, oracle, package file, shared seam, Main worktree, role4-fix worktree, or other worktree was changed.

## Limitations and insertion requests

- This is deterministic `SHADOW_CONTRACT_SIMULATION`, not end-to-end accepted runtime evidence.
- All `120` rows still require post-port `INTEGRATION` and `INDEPENDENT_READBACK` evidence.
- `21` rows still require post-port `RESTART` evidence and `4` rows still require post-port `BROWSER` evidence.
- Real provider, notification, sentinel, WORM, credential-proxy, canary, rollback, restore, process-restart, and browser behavior remains unproven here.
- No new insertion request was created. The existing 21-row draft packet remains unchanged.
- `AIOPS-IR-TEST-MOUNT-026` remains required because the canonical package scripts do not discover this focused suite.
- Root `STATE.md` is unchanged because this shadow extension has no product-state or owner-wiring effect and its exclusive grant forbids shared/root edits.

A5X_SHADOW_READY
