# Resource and Backpressure Report — Phase 2 source closure — measurement pending

Generated from `fixtures/i00/closure-evidence.json` at 2026-07-14T00:00:00Z. Scope is `PHASE2_SOURCE_CLOSURE`; evidence truth is `MIXED_SOURCE_PROVED_AND_PENDING_MEASUREMENT`; product verdict is `PENDING_MEASUREMENT`; candidate state is `NOT_CANDIDATE_READY`. Accepted donor equality and source wiring are recorded. Runtime, browser, restart/reconciliation, and local-proxy performance measurements are not yet recorded. This is not an integration-candidate receipt.

The deterministic resource fixture remains a synthetic measurement plan. Local-proxy performance results are PENDING_MEASUREMENT and must be added from a measured receipt without relabeling fixture samples as runtime observations. The executable synthetic plan uses an injected clock, 60000 ms windows, at least 5 samples, and p50/p95/p99/max. Capacity breach must become `DEGRADED` or `BLOCKED` before silent loss. Lower-tier shedding is counted in P4→P3→P2 order; P0 material loss remains exactly zero and P0/P1 remain available.

## Current measurement status

| Measurement | Status | Contract/receipt |
| --- | --- | --- |
| runtime | PENDING_MEASUREMENT | — |
| browser | PENDING_MEASUREMENT | — |
| restartReconciliation | PENDING_MEASUREMENT | — |
| performance | PENDING_MEASUREMENT | test/i00/performance/contract.mjs |

## Explicit limitations

| Limitation | Status | Exact reason |
| --- | --- | --- |
| PRIVATE_SIGNED_EXCHANGE | NOT_CONFIGURED | PRIVATE_READ_AUTHORIZATION_REQUIRED; SIGNED_VALIDATION_AUTHORIZATION_REQUIRED |
| Q_PRODUCTION_TRANSPORT | NOT_CONFIGURED | Q_PRODUCTION_TRANSPORT_NOT_CONFIGURED |
| LIVE_EXECUTION | NOT_CONFIGURED | LIVE_EXECUTION_NOT_IMPLEMENTED |
| DEPLOYMENT_TARGET | OWNER_GATED | DEPLOYMENT_AUTHORIZATION_REQUIRED; REAL_TARGET_READBACK_REQUIRED |
| L12_ACTIVE_SUBJECT_PRIVATE_TRUTH | OWNER_GATED | CANONICAL_ACTIVE_SUBJECT_AND_PRIVATE_ACCOUNT_TRUTH_NOT_AUTHORIZED; ACCEPTED_PROJECTOR_NOT_INVOKED |
| L13_ACCEPTED_PROJECTOR | OWNER_GATED | VALIDATED_L12_ACTIVE_SUBJECT_TRUTH_UNAVAILABLE; ACCEPTED_PROJECTOR_NOT_INVOKED |
| L14_PRODUCTION_ACTIVATION | OWNER_GATED | NUMERIC_CONFIGURATION_CHECKPOINT_AND_RESERVATION_OWNERS_UNAVAILABLE; PRODUCTION_PERSISTENCE_NULL; NO_DISPATCH |
| FOUNDATION_QUANTITY_PRODUCTION_CONSUMER | NOT_CONFIGURED | CONTRACT_AND_HOSTILE_PROOFS_PRESENT; NO_AUTHORIZED_PRODUCTION_CONSUMER |
| MANAGED_RESTART_EFFECT | OWNER_GATED | KEYLESS_MANAGED_RESTART_OWNER_GATED; EXTERNAL_PROCESS_MANAGER_EFFECT_NOT_AUTHORIZED_OR_PROVED |
| PRODUCTION_CAPACITY | UNKNOWN | LOCAL_BOUNDED_ACCEPTANCE_ONLY; PRODUCTION_LOAD_AND_CAPACITY_NOT_MEASURED |
| PRODUCT_ASSURANCE_PRODUCTION_PROJECTION | NOT_CONFIGURED | PASSIVE_SOURCE_PROJECTION_ONLY; PRODUCTION_ASSURANCE_ACTIVATION_NOT_CONFIGURED |
| A_FORMAL | NOT_CONFIGURED | POST_LANDING_EXCLUDED_BY_L_LAST_ORDERING; ACCEPTED_POST_LANDING_TIP_b491893416006cf529aef02e5dd4a25d6475e7b8 |
| A_ACTION_EVIDENCE_S2 | NOT_CONFIGURED | POST_LANDING_ONLY_EXCLUDED; ACCEPTED_POST_LANDING_TIP_ca30adf5e97b6697afec49f13073024d953b117b |
| PREVERIFY_WORKTREE | NOT_CONFIGURED | NON_DONOR_WORKTREE_EXCLUDED_FROM_PHASE_2_CANDIDATE; TIP_46b2f1e31edf9f75aec7203e952a56f9869a2971; NO_INTEGRATION_DISPOSITION |

## Load-shedding priority

| Priority | Work preserved | Evidence |
| --- | --- | --- |
| P0 | position supervision,reconciliation,recovery,private truth,ledger,operator control | fixtures/i00/closure-evidence.json; I00_PRODUCT_BUILD_STATE.md; fixtures/i00/receipt-provenance.json; server/src/productIntegration/runtime/systemControlCommandOwner.ts; fixtures/i00/living-director-input-acceptance.json; IP_PROOF_RECEIPT.md@23e985c17b9b860fee26be397fa05b26f3daf8f2 |
| P1 | risk,execution,exposure | fixtures/i00/closure-evidence.json; I00_PRODUCT_BUILD_STATE.md; fixtures/i00/receipt-provenance.json; IP_PROOF_RECEIPT.md@23e985c17b9b860fee26be397fa05b26f3daf8f2 |
| P2 | canonical public sources and engines | fixtures/i00/closure-evidence.json; I00_PRODUCT_BUILD_STATE.md; fixtures/i00/receipt-provenance.json; server/src/productIntegration/runtime; server/src/systemIntegration; IP_PROOF_RECEIPT.md@23e985c17b9b860fee26be397fa05b26f3daf8f2 |
| P3 | Q advisory enrichment | fixtures/i00/closure-evidence.json; I00_PRODUCT_BUILD_STATE.md; fixtures/i00/receipt-provenance.json; IP_PROOF_RECEIPT.md@23e985c17b9b860fee26be397fa05b26f3daf8f2 |
| P4 | optional research,replay,news,charts,broad enrichment | fixtures/i00/closure-evidence.json; I00_PRODUCT_BUILD_STATE.md; fixtures/i00/receipt-provenance.json; IP_PROOF_RECEIPT.md@23e985c17b9b860fee26be397fa05b26f3daf8f2 |

## Synthetic measurement-plan matrix

| Metric | Unit | Producer | Method | Plan soft bound | Plan hard bound | Fixture p50/p95/p99/max | Fixture breach | Product status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CPU | percent | process/host telemetry | p50/p95/p99/max | 70 | 90 | 65/80/80/80 | DEGRADED | MEASUREMENT_PENDING | fixtures/i00/closure-evidence.json; I00_PRODUCT_BUILD_STATE.md; fixtures/i00/receipt-provenance.json; IP_PROOF_RECEIPT.md@23e985c17b9b860fee26be397fa05b26f3daf8f2 |
| EVENT_LOOP | milliseconds | Node runtime | lag distribution | 50 | 200 | 20/75/75/75 | DEGRADED | MEASUREMENT_PENDING | fixtures/i00/closure-evidence.json; I00_PRODUCT_BUILD_STATE.md; fixtures/i00/receipt-provenance.json; server/src/productIntegration/runtime; server/src/systemIntegration; IP_PROOF_RECEIPT.md@23e985c17b9b860fee26be397fa05b26f3daf8f2 |
| MEMORY | bytes | process telemetry | RSS and heap distribution | 536870912 | 805306368 | 400000000/500000000/500000000/500000000 | OK | MEASUREMENT_PENDING | fixtures/i00/closure-evidence.json; I00_PRODUCT_BUILD_STATE.md; fixtures/i00/receipt-provenance.json; IP_PROOF_RECEIPT.md@23e985c17b9b860fee26be397fa05b26f3daf8f2 |
| PROCESS_GROWTH | bytes_per_hour | soak harness | slope | 10485760 | 52428800 | 3000000/5000000/5000000/5000000 | OK | MEASUREMENT_PENDING | fixtures/i00/closure-evidence.json; I00_PRODUCT_BUILD_STATE.md; fixtures/i00/receipt-provenance.json; IP_PROOF_RECEIPT.md@23e985c17b9b860fee26be397fa05b26f3daf8f2 |
| DISK_WAL | bytes | SQLite/host | size and growth | 1073741824 | 5368709120 | 14000000/18000000/18000000/18000000 | OK | MEASUREMENT_PENDING | fixtures/i00/closure-evidence.json; I00_PRODUCT_BUILD_STATE.md; fixtures/i00/receipt-provenance.json; ops/i00; fixtures/i00/baseline-route-migration.json; IP_PROOF_RECEIPT.md@23e985c17b9b860fee26be397fa05b26f3daf8f2 |
| EVIDENCE_LOG_GROWTH | bytes_per_hour | retention telemetry | tiered growth | 104857600 | 524288000 | 3000000/5000000/5000000/5000000 | OK | MEASUREMENT_PENDING | fixtures/i00/closure-evidence.json; I00_PRODUCT_BUILD_STATE.md; fixtures/i00/receipt-provenance.json; server/src/productIntegration/runtime; server/src/systemIntegration; IP_PROOF_RECEIPT.md@23e985c17b9b860fee26be397fa05b26f3daf8f2 |
| PUBLIC_RATE | events_per_second | intelligenceRuntime | source rate distribution | 20000 | 50000 | 10000/18000/18000/18000 | OK | MEASUREMENT_PENDING | fixtures/i00/closure-evidence.json; I00_PRODUCT_BUILD_STATE.md; fixtures/i00/receipt-provenance.json; server/src/productIntegration/runtime; server/src/systemIntegration; IP_PROOF_RECEIPT.md@23e985c17b9b860fee26be397fa05b26f3daf8f2 |
| PRIVATE_RATE | events_per_second | accepted L private truth | product-separated rate | 1000 | 5000 | 0/0/0/0 | UNAVAILABLE | OWNER_GATED | fixtures/i00/closure-evidence.json; I00_PRODUCT_BUILD_STATE.md; fixtures/i00/receipt-provenance.json; fixtures/i00/living-director-input-acceptance.json; IP_PROOF_RECEIPT.md@23e985c17b9b860fee26be397fa05b26f3daf8f2 |
| Q_RATE_LATENCY | milliseconds | accepted Q | rate plus p50/p95/p99 | 250 | 1000 | 40/60/60/60 | UNAVAILABLE | Q_PRODUCTION_TRANSPORT_NOT_CONFIGURED | fixtures/i00/closure-evidence.json; I00_PRODUCT_BUILD_STATE.md; fixtures/i00/receipt-provenance.json; fixtures/i00/living-director-input-acceptance.json; IP_PROOF_RECEIPT.md@23e985c17b9b860fee26be397fa05b26f3daf8f2 |
| QUEUE_DEPTH | items | all bounded queues | depth/capacity | 70 | 100 | 20/60/60/60 | OK | MEASUREMENT_PENDING | fixtures/i00/closure-evidence.json; I00_PRODUCT_BUILD_STATE.md; fixtures/i00/receipt-provenance.json; server/src/productIntegration/runtime; server/src/systemIntegration; ops/i00; fixtures/i00/baseline-route-migration.json; IP_PROOF_RECEIPT.md@23e985c17b9b860fee26be397fa05b26f3daf8f2 |
| PROCESSING_LAG | milliseconds | domain components | event-to-processed | 250 | 1000 | 40/60/60/60 | OK | MEASUREMENT_PENDING | fixtures/i00/closure-evidence.json; I00_PRODUCT_BUILD_STATE.md; fixtures/i00/receipt-provenance.json; IP_PROOF_RECEIPT.md@23e985c17b9b860fee26be397fa05b26f3daf8f2 |
| DROP_COALESCE_SUPERSEDE | count | bounded queues | separate counters | 10 | 100 | 2/8/8/8 | OK | MEASUREMENT_PENDING | fixtures/i00/closure-evidence.json; I00_PRODUCT_BUILD_STATE.md; fixtures/i00/receipt-provenance.json; server/src/productIntegration/runtime; server/src/systemIntegration; IP_PROOF_RECEIPT.md@23e985c17b9b860fee26be397fa05b26f3daf8f2 |
| DB_WRITE_LATENCY | milliseconds | Ledger | commit distribution | 50 | 250 | 6/10/10/10 | OK | MEASUREMENT_PENDING | fixtures/i00/closure-evidence.json; I00_PRODUCT_BUILD_STATE.md; fixtures/i00/receipt-provenance.json; IP_PROOF_RECEIPT.md@23e985c17b9b860fee26be397fa05b26f3daf8f2 |
| BINANCE_WEIGHT_RATE | weight_per_interval | exchange adapters | header/readback budget | 700000 | 900000 | 300000/500000/500000/500000 | OK | MEASUREMENT_PENDING | fixtures/i00/closure-evidence.json; I00_PRODUCT_BUILD_STATE.md; fixtures/i00/receipt-provenance.json; IP_PROOF_RECEIPT.md@23e985c17b9b860fee26be397fa05b26f3daf8f2 |
| RECONNECT_RESYNC | count | source lifecycle | fingerprinted counter | 5 | 20 | 1/2/2/2 | OK | MEASUREMENT_PENDING | fixtures/i00/closure-evidence.json; I00_PRODUCT_BUILD_STATE.md; fixtures/i00/receipt-provenance.json; server/src/productIntegration/runtime; server/src/systemIntegration; IP_PROOF_RECEIPT.md@23e985c17b9b860fee26be397fa05b26f3daf8f2 |
| FOCUS_CAPACITY | symbols | focus allocator | ready/capacity | 32 | 64 | 8/16/16/16 | OK | MEASUREMENT_PENDING | fixtures/i00/closure-evidence.json; I00_PRODUCT_BUILD_STATE.md; fixtures/i00/receipt-provenance.json; ops/i00; fixtures/i00/baseline-route-migration.json; IP_PROOF_RECEIPT.md@23e985c17b9b860fee26be397fa05b26f3daf8f2 |
| ACTIVE_TICKET_PRIORITY | priority_invariant | scheduler | P0 preempts P3/P4 | 0 | 0 | invariant | INVARIANT | SYNTHETIC_MEASUREMENT_PLAN | fixtures/i00/closure-evidence.json; I00_PRODUCT_BUILD_STATE.md; fixtures/i00/receipt-provenance.json; IP_PROOF_RECEIPT.md@23e985c17b9b860fee26be397fa05b26f3daf8f2 |
| API_BROWSER_PRESSURE | bytes_per_second | API/read model | fanout and cursor load | 5242880 | 20971520 | 300000/500000/500000/500000 | OK | MEASUREMENT_PENDING | fixtures/i00/closure-evidence.json; I00_PRODUCT_BUILD_STATE.md; fixtures/i00/receipt-provenance.json; server/src/productIntegration/runtime/systemControlCommandOwner.ts; IP_PROOF_RECEIPT.md@23e985c17b9b860fee26be397fa05b26f3daf8f2 |
| LOAD_SHED_ORDER | priority_invariant | supervisor | P4 then P3 then P2; P0 preserved | 0 | 0 | invariant | INVARIANT | SYNTHETIC_MEASUREMENT_PLAN | fixtures/i00/closure-evidence.json; I00_PRODUCT_BUILD_STATE.md; fixtures/i00/receipt-provenance.json; IP_PROOF_RECEIPT.md@23e985c17b9b860fee26be397fa05b26f3daf8f2 |
