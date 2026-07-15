# RUN-17/REPLAY shadow receipt

Disposition: `SHADOW_SPECULATIVE`

Seal: `REPLAY_SHADOW_READY` means only that the candidate-independent replay corpus and deferred harness definitions are ready for owner review and future post-C2 porting. It is not a candidate verdict, integration acceptance, production evidence, release evidence, or authority to execute a workload.

## Provenance and commit topology

- Branch: `replay-shadow-20260715`
- Required base and implementation parent: `098f7b9449ab3b1c26bda19f51537bfea01d4c48`
- Implementation commit: `f70469dbbae810f598892120440f148a4bef5cd6`
- Implementation tree: `001f0d356af5f1df07a9bf609e8aa78e6dd75a37`
- Commits from base through implementation: one
- Receipt topology: this file is added in a receipt-only child of the implementation commit. The receipt intentionally does not self-name its child commit SHA.
- Execution authority: `NONE`
- Candidate binding: `null`
- Heavy execution: `DEFERRED_POST_C2_OTHER_MACHINE`

Implementation commit paths, exactly seven:

1. `fixtures/replayShadow/RESEARCH_BASIS.md`
2. `fixtures/replayShadow/corpus.v1.json`
3. `fixtures/replayShadow/entry-gate.v1.json`
4. `fixtures/replayShadow/harness.mjs`
5. `fixtures/replayShadow/insertion-requests.v1.json`
6. `test/replayShadow/adversarial.test.mjs`
7. `test/replayShadow/contracts.test.mjs`

Receipt-child path, exactly one:

1. `fixtures/replayShadow/REPLAY_SHADOW_RECEIPT.md`

The cumulative base-to-receipt scope is those eight paths, all within `fixtures/replayShadow/**` or `test/replayShadow/**`. No shared seam, root state document, package script, Main checkout, `role4-fix`, other worktree, merge, or push was touched.

## Entry-gate ruling

The 23-row entry gate was classified before construction:

- `ADOPT_EXISTING`: 2
- `ADAPT_EXISTING`: 9
- `REFERENCE_ONLY`: 3
- `MISSING_BUILD`: 5
- `REJECT_DUPLICATE`: 4

The packet adopts or adapts the existing Foundation replay/scenario/execution/reconciliation/control owners, Intelligence Runtime lifecycle/capacity/rate owners, Product Assurance fault/remediation owners, System Integration composition/persistence seams, and the existing Ledger. It rejects a duplicate replay engine, clock, socket/lifecycle simulator, capacity controller, execution/reconciliation/recovery authority, store, candidate evaluator, or verdict gate.

## Definition inventory

- Required coverage categories: 11 of 11
- Replay datasets: 11
- Dataset events: 64
- Product Assurance fault references: 30, all resolved by the focused contract test against `server/src/productAssurance/faults/harness.ts`
- Campaign definitions: 5 (`LATENCY`, `LOAD`, `SOAK`, `FAILURE`, `RECOVERY`)
- Campaign phases: 10
- Total defined iteration budgets/offers: 946,664
- Soak definition duration: 21,600,000 ms (six hours)
- Canonical validated-corpus content SHA-256: `592de536ee18868ae77038fc15471507dffbe5445ff987f92871c30ceef92210`

The pure compiler emits immutable, plan-derived reference frames. Open-arrival frames have deterministic inclusive offsets and round-robin dataset/subject assignment. Closed-loop frames have explicit same-subject and global admission-slot predecessors. Fault frames bind subject, injection point, campaign, fault, and correlation identities. Recovery templates are selected only for fault-bearing recovery frames. None of these definitions execute work.

## Focused verification at the implementation commit

Environment: Node.js `v22.23.1`.

Command:

```text
node --test --test-concurrency=1 --test-reporter=spec "test/replayShadow/**/*.test.mjs"
```

Result at `f70469dbbae810f598892120440f148a4bef5cd6`:

- Exit code: 0
- Tests: 61
- Passed: 61
- Failed: 0
- Cancelled: 0
- Skipped: 0
- Todo: 0
- Duration reported by the runner: 176.392542 ms

The focused suite covers import-time and compile-time zero-egress tripwires; credential and executable scans; exact entry-gate and insertion-request bindings; candidate/result identity rejection; hostile JSON shapes and value domains; deterministic plan derivation; phase, ordinal, fault, and coverage linkage; rate-scope separation; restart correlation and terminal unknowns; partial-fill identity/ambiguity; stale-data threshold crossing; connection shutdown/loss/reconnect ordering; clock regression and unit changes; recovery fact ownership and frame correlation; and six-hour soak shape.

Not run and not claimed:

- `npm test`
- `npm run test:all`
- Any build or heavy suite
- Any latency, load, soak, failure, or recovery campaign execution
- Any host timing, throughput, resource, SLO, threshold, pass/fail, or candidate measurement
- Any network, credential, endpoint, live provider, process mutation, owner adapter, or fault injection

## Limitations

The corpus pins these eight limitations exactly:

1. `NO_CANDIDATE_BINDING`
2. `NO_THRESHOLDS_OR_VERDICTS`
3. `NO_NETWORK_OR_PROCESS_MUTATION`
4. `NO_REAL_CREDENTIALS_OR_ENDPOINTS`
5. `NO_HOST_TIMING_MEASURED`
6. `HEAVY_EXECUTION_DEFERRED_POST_C2_OTHER_MACHINE`
7. `OWNER_ADAPTERS_UNMOUNTED`
8. `SYNTHETIC_CORPUS_IS_NOT_PRODUCTION_EVIDENCE`

The datasets are fake-provider, synthetic or adapted observation tapes. Their virtual time does not establish host duration. No canonical owner adapter is mounted, no package command exposes the packet, no shared state document claims integration, and no candidate-specific expected result exists.

## Insertion requests

All requests have `directEditAllowed: false`.

| Request | State | Target owner |
| --- | --- | --- |
| `RS-IR-PORT-001` | `DRAFT_UNMOUNTED` | `DIRECTOR_PORT_OWNER` |
| `RS-IR-REPLAY-002` | `DRAFT_UNMOUNTED` | `FOUNDATION_REPLAY_OWNER` |
| `RS-IR-SCENARIO-003` | `DRAFT_UNMOUNTED` | `FOUNDATION_SCENARIO_OWNER` |
| `RS-IR-CAPACITY-004` | `DRAFT_UNMOUNTED` | `INTELLIGENCE_RUNTIME_CAPACITY_OWNER` |
| `RS-IR-FAULT-005` | `DRAFT_UNMOUNTED` | `PRODUCT_ASSURANCE_FAULT_OWNER` |
| `RS-IR-HEAVY-006` | `DEFERRED_POST_C2_OTHER_MACHINE` | `V5_PERFORMANCE_OPERATIONS_SHARD` |
| `RS-IR-TEST-MOUNT-007` | `DRAFT_UNMOUNTED` | `PACKAGE_TEST_OWNER` |
| `RS-IR-DOCS-008` | `DRAFT_UNMOUNTED` | `DIRECTOR_DOCUMENTATION_OWNER` |
| `RS-IR-LIFECYCLE-009` | `DRAFT_UNMOUNTED` | `INTELLIGENCE_RUNTIME_LIFECYCLE_OWNER` |
| `RS-IR-AMBIGUITY-010` | `DRAFT_UNMOUNTED` | `FOUNDATION_EXECUTION_RECONCILIATION_OWNER` |
| `RS-IR-RECOVERY-011` | `DRAFT_UNMOUNTED` | `SYSTEM_INTEGRATION_COMPOSITION_OWNER` |

The detailed triggers and non-authoritative port requests remain in `fixtures/replayShadow/insertion-requests.v1.json`. Heavy execution stays deferred until the named future owner, machine, phase, and authority gates exist.
