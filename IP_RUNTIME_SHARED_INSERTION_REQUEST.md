# IP-RUNTIME shared insertion request

Status: `PRESTAGE_ONLY` — director-owned edits requested; none of these edits were made in this packet.

## Frozen inputs and accepted interface frontier

- Packet base: `420cc83e5512d54ca1b1c064c1041d89b23914a0`.
- Frozen Q/L protocol commit: `73e1a1ff7daa48df8dac45713fc5f106842edafc`.
- Protocol document SHA-256: `951fdbb5f347f900c61e60055f90cf2e1e1e743b75b7dc733652acb8d43353a1`.
- Protocol schema SHA-256: `229af0ff13d600c7d305c6deb7f57b61bdb6f8a35f6f2349d91f5ab1b4972f1c`.
- Q runtime frontier: no accepted Q16/Q17 inference service, sidecar, transport, generated TypeScript client, or runtime receipt exists. `productIntegration/adapters/qProtocol.ts` therefore binds only the frozen version/hash and consumes already-validated envelopes.
- Accepted L spine read from immutable state seal `4c815f5b739ee0e572e5e72e1eeda6698a4d72ba`: L00-L07. Accepted L05 private truth, L06 injected journal/CAS request, and L07 deterministic exchange twin are adapter donors after merge. L07 implementation is `51be697476f32fbf2e9ae2cf4c5fab359187345f`; its immutable receipt commit is `ebd7aa567334e8e6cbd82e3559f2bcebf56a0088`, and receipt SHA-256 is `9977d9ea6000a5c2980988254b80893090aaa84bde46164495b5c4d50879c62d`.
- Accepted L14 side-lane state seal `04e50f43ab18b1a0e4b03effcb70f0d7ea5a0e28`: `L14_ACCEPTED / LANE_READY_BUILT_AND_TESTED_UNWIRED`. Its direct `server/src/liveEdge/controls/index.ts` donor is not exported by the live-edge barrel and is absent from this packet base, so `L14DurableControlPort` and `L14CanonicalControlPersistencePort` remain explicit ports until director fan-in.
- L07 is `ACCEPTED_BUILT_AND_TESTED_UNWIRED` and exposes a deterministic injected exchange twin at `server/src/liveEdge/adapters/exchangeTwin/index.ts`. Every L07 scenario, order, cancel, checkpoint, and calibration result remains simulator evidence with `simulationAuthority = SYNTHETIC_FIXTURE`, `actionAuthority = NONE_RECORD_ONLY`, and `externalActionAuthorization = NONE`; its checkpoint is value evidence, not persistence proof, and it supplies no production execution, fill, position, reconciliation, private-source, signed-request, or money authority. L08 is only `READY`; L08-L13 have no accepted implementation or acceptance receipt. Policy, real ticket/execution/reconciliation, position/recovery, and machine-graph interfaces therefore remain unavailable ports. L14's `WaitingL08ReferenceV1` is an opaque `WAITING_L08` blocker, never proof that L08 exists.
- Accepted dashboard shell donor `6925015` consumes an extended `SystemSupervisorSnapshot`, `SystemControlMutation`, and before/after `SystemControlReceipt`; the `DashboardDonorBridgePort` preserves that exact top-level contract until the director maps it to canonical System Integration truth.
- Accepted L15 deployment-infrastructure satellite receipt `2cec412927fa2f64f05a0b2774b18e45f8ce4fa5` covers work commit `9a82d47` (11 network-free test files, 347 assertions). It is artifact-only and director integration is pending: no AWS, Cloudflare, systemd, secret-store, network, or deployment mutation occurred, and artifact existence is not deployment readiness.

Do not replace a port with a production import until the director records the accepted donor SHA/path/test in I00 state.

## Required director-owned composition edits

1. `server/src/productIntegration/index.ts`
   - Add the production family barrel during director fan-in after accepted adapters are selected. Export contracts/adapters/lifecycle/supervisor/commands only; never export deterministic fixtures into production.
2. `server/src/systemIntegration/contracts/constants.ts`
   - Reconcile the current closed 13-ID system component union with I00's accepted final managed-component registry.
   - Preserve Foundation whole-machine phase as the only machine lifecycle authority.
   - Add an explicit directional mapping from accepted owner lifecycle evidence to `ProductComponentLifecycle`; do not cast strings.
3. `server/src/systemIntegration/contracts/types.ts` and `server/src/systemIntegration/supervisor/types.ts`
   - Add owner-supplied heartbeat, last input, receive, process, meaningful-advance, queue/backpressure/drop, supported-command, and build/config/schema/model revision evidence.
   - Either adopt the additive `ProductComponentEvidence`/`ProductSupervisorProjection` shapes or map them losslessly into the canonical read model. The canonical supervisor remains `systemIntegration`.
4. `server/src/systemIntegration/composition/graph.ts` and `managedComposition.ts`
   - Add accepted adapters in dependency order: persistence/control shell; sources/universe; evidence/Q; Basis/Volume; opportunity/Capital/Risk; accepted L private truth/execution/reconciliation; recovery/outcome; cockpit.
   - Translate `planProductLifecycle()` operations into existing `DeterministicSupervisor`/`SystemControlService` commands. Never execute the plan directly.
   - Use the existing injected clock/scheduler and reverse-order stop behavior; add no timer to `productIntegration`.
5. `server/src/systemIntegration/production/factory.ts`
   - Construct concrete ports for accepted donors only.
   - Until Q16/Q17 and L08-L13 are accepted, bind explicit `UNAVAILABLE` adapters and keep packet fixtures confined to tests. The accepted L07 twin may be bound only as synthetic simulator/calibration evidence through its direct barrel after its immutable donor is merged; it must never satisfy a production ticket, execution, reconciliation, position, recovery, private-truth, or trade-readiness port. Bind accepted L14 only after its immutable donor is merged and its canonical persistence request is satisfied.
   - Do not open a new market socket, private source, ledger, queue, cache, or command service.
6. `server/src/index.ts`
   - Mount the expanded composition through the existing startup path.
   - Replace delayed-start behavior only after the canonical composition tests prove dependency readiness.
   - Drive graceful drain/shutdown through the canonical Control Plane and persist the result before process exit.

## Required route and event-delivery edits

1. `server/src/systemIntegration/routes/router.ts`, `routes/types.ts`, and the existing route registration in `server/src/index.ts`
   - Add read-only `/health/live`, `/health/ready`, and `/health/trade-ready` responses from one canonical projection.
   - Add bounded supervisor/component/trace reads; route code must not recompute readiness or strategy truth.
   - Add command preview/submit/result endpoints backed by `SystemControlService`, server-derived operator identity, durable idempotency, expiry, and expected revision.
2. Existing application WebSocket delivery in `server/src/index.ts`
   - Publish only material operator events/supervisor deltas.
   - Cursor by the dedicated durable material-event cursor requested below, never timestamp and never a filtered `events.id` sequence.
   - Response fields: `afterCursor`, `nextCursor`, `events`, `continuity`, `missingFromCursor`, `missingToCursor`, `hasMore`.
   - If the requested cursor precedes retention or a ledger ID is missing, return explicit `TRUNCATED_REQUIRES_BACKFILL` or `GAP_REQUIRES_BACKFILL`; never silently reset to the current window.
   - Raw logs/metrics remain bounded pull detail, not the default browser stream.

## Exact canonical persistence/migration request

Persistence owner remains `server/src/ledger.ts` plus `server/src/systemIntegration/persistence/**`. Apply one director-reviewed schema revision inside that database. Do not create another SQLite file or store.

The migration must add these durable objects (names may be prefixed by the director only to match an existing migration convention; column semantics are fixed):

### `product_component_desired_state`

```text
component_id TEXT PRIMARY KEY
desired_state TEXT NOT NULL
state_revision INTEGER NOT NULL CHECK(state_revision >= 0)
restart_generation INTEGER NOT NULL CHECK(restart_generation >= 0)
updated_at_ms INTEGER NOT NULL
correlation_id TEXT NOT NULL
ledger_event_id INTEGER NOT NULL REFERENCES events(id)
```

### `product_commands`

```text
command_id TEXT PRIMARY KEY
idempotency_key TEXT NOT NULL UNIQUE
request_digest TEXT NOT NULL
command_type TEXT NOT NULL
target_component_id TEXT NOT NULL
authenticated_operator_id TEXT NOT NULL
reason TEXT NOT NULL
required_authority TEXT NOT NULL
request_payload_json TEXT NOT NULL
preview_digest TEXT NOT NULL
preview_json TEXT NOT NULL
expected_revision INTEGER NOT NULL CHECK(expected_revision >= 0)
resulting_revision INTEGER
status TEXT NOT NULL
created_at_ms INTEGER NOT NULL
expires_at_ms INTEGER NOT NULL
completed_at_ms INTEGER
correlation_id TEXT NOT NULL
before_projection_json TEXT
after_projection_json TEXT
result_json TEXT
ledger_event_id INTEGER REFERENCES events(id)
CHECK(expires_at_ms > created_at_ms)
UNIQUE(idempotency_key, request_digest)
```

Indexes: `(target_component_id, created_at_ms DESC)`, `(status, created_at_ms DESC)`, `(correlation_id)`.

`authenticated_operator_id` is derived by the server security boundary; browser identity is ignored. `reason` is 1..500 UTF-8 characters. `request_payload_json`, `preview_json`, and each before/after/result projection are closed-schema, secret-guarded, canonical JSON capped at 262,144 bytes. `required_authority` is the control-registry authority value, never a browser claim.

### `product_config_revisions`

```text
config_revision TEXT PRIMARY KEY
content_digest TEXT NOT NULL UNIQUE
status TEXT NOT NULL
effective_at_ms INTEGER
created_at_ms INTEGER NOT NULL
created_by_operator_id TEXT NOT NULL
correlation_id TEXT NOT NULL
config_json TEXT NOT NULL
ledger_event_id INTEGER NOT NULL REFERENCES events(id)
```

### `product_identity_references`

This is the durable alias/reference graph, not a second proposal/execution store.

```text
reference_type TEXT NOT NULL
reference_id TEXT NOT NULL
owner_id TEXT NOT NULL
owner_revision TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(length(owner_revision) > 0)
owner_state TEXT NOT NULL
resolution_state TEXT NOT NULL
correlation_id TEXT NOT NULL
parent_reference_type TEXT
parent_reference_id TEXT
payload_hash TEXT
owner_projection_json TEXT NOT NULL
occurred_at_ms INTEGER NOT NULL
valid_until_ms INTEGER
ledger_event_id INTEGER NOT NULL REFERENCES events(id)
PRIMARY KEY(reference_type, reference_id, owner_revision)
```

Required `reference_type` values at first migration: `OPPORTUNITY`, `CAPITAL_VERDICT`, `RISK_VERDICT`, `TICKET`, `LEG`, `ORDER`, `AMBIGUOUS_MUTATION`, `POSITION`, `LIABILITY`, `RECOVERY_CAMPAIGN`, `MODEL_ASSESSMENT`, `OUTCOME`, `BOOT_OPERATION`, `SHUTDOWN_OPERATION`, `DEPLOYMENT_REVISION`.

Indexes: `(correlation_id, occurred_at_ms)`, `(parent_reference_type, parent_reference_id)`, `(reference_type, resolution_state, occurred_at_ms DESC)`.

`owner_state`, `resolution_state`, and `owner_projection_json` are validated owner projections. They make unresolved restart queries reconstructible without assigning strategy/execution semantics to the alias table. Allowed `resolution_state` values are `OPEN`, `TERMINAL_PROVEN`, `AMBIGUOUS`, `RECOVERY_REQUIRED`, `UNAVAILABLE`, and `UNKNOWN`; only the canonical owner adapter may advance them, and an acknowledgement alone cannot clear exposure/liability/recovery.

### `product_operator_events`

This table gives the filtered material operator stream its own gap-free durable cursor. Global `events.id` remains the ledger identity and may legitimately contain non-material rows between published events.

```text
cursor INTEGER PRIMARY KEY AUTOINCREMENT
ledger_event_id INTEGER NOT NULL UNIQUE REFERENCES events(id)
event_id TEXT NOT NULL UNIQUE
component_id TEXT NOT NULL
correlation_id TEXT NOT NULL
occurred_at_ms INTEGER NOT NULL
persisted_at_ms INTEGER NOT NULL
material_projection_json TEXT NOT NULL
```

Indexes: `(correlation_id, cursor)`, `(component_id, cursor DESC)`. The operator-event insert and its underlying ledger insert share one transaction. Retention records the first retained `cursor`; missing values inside the retained range are a real gap, while a requested cursor below the retention floor is explicit truncation.

### `product_incidents`

```text
incident_id TEXT PRIMARY KEY
fingerprint TEXT NOT NULL UNIQUE
root_component_id TEXT NOT NULL
severity TEXT NOT NULL
capital_relevant INTEGER NOT NULL CHECK(capital_relevant IN (0,1))
state TEXT NOT NULL
first_seen_at_ms INTEGER NOT NULL
last_seen_at_ms INTEGER NOT NULL
event_count INTEGER NOT NULL CHECK(event_count >= 1)
acknowledged_at_ms INTEGER
acknowledged_by_operator_id TEXT
resolved_at_ms INTEGER
correlation_id TEXT NOT NULL
ledger_event_id INTEGER NOT NULL REFERENCES events(id)
```

Index: `(state, severity, last_seen_at_ms DESC)`.

### `product_boot_release_revisions`

```text
operation_id TEXT PRIMARY KEY
operation_type TEXT NOT NULL
generation INTEGER NOT NULL CHECK(generation >= 0)
tested_commit TEXT
deployed_commit TEXT
config_revision TEXT
schema_revision TEXT NOT NULL
model_revision TEXT
started_at_ms INTEGER NOT NULL
completed_at_ms INTEGER
clean INTEGER CHECK(clean IN (0,1))
blocker_code TEXT
correlation_id TEXT NOT NULL
ledger_event_id INTEGER NOT NULL REFERENCES events(id)
```

### Accepted L14 per-command journal insertion

Implement the deferred request from immutable path `live-edge-receipts/patches/L14-canonical-control-ledger-integration.request.md` inside the existing Ledger/System Integration transaction boundary. Do not translate it into the generic `product_commands` row alone.

The exact persistence adapter must expose `lookup(commandId)` with all four states: `NOT_FOUND`, `PENDING`, `COMPLETED`, and `REJECTED`. It must accept the exact L14 `ControlEventAppendRequest` and return the exact `ControlEventAppendAcknowledgement`, including:

```text
ownerTarget = SYSTEM_INTEGRATION_LEDGER
per-command expectedJournalVersion + previousHeadDigest CAS
nextHeadDigest
idempotencyKey bound to appendRequestDigest
distinct CONTROL_INTENT_COMMITTED / CONTROL_APPLIED /
  CONTROL_AWARENESS_RECORDED / CONTROL_REJECTED events
COMMITTED_NEW / IDEMPOTENT_REPLAY / IDEMPOTENCY_CONFLICT /
  VERSION_CONFLICT / EXPIRED / FAILED acknowledgement
currentConfigVersion + currentControlRevision
externalActionAuthorization = NONE
```

One transaction must validate the closed event/digest, CAS the command head/version, reserve `expectedControlRevision + 1` only for `CONTROL_INTENT_COMMITTED` after comparing config version, and append the dedicated control event plus audit event atomically. Restart reconstruction must preserve pending intent and exact terminal `APPLIED`, `NOOP`, `AWARENESS_RECORDED`, or rejected receipts. Redacted pre-intent rejection audits do not reserve an authentic command ID. Owner consumption serializes reservation/application, enforces deadline/config/control bindings, and leaves ambiguous publication `PENDING`; it never fabricates a terminal applied/rejected result.

### Accepted L06 exact mutation-journal CAS insertion

Implement immutable request `L06-canonical-ledger-cas.request.md` only through the existing Ledger/System Integration transaction. The adapter must call accepted donor `validateMutationAppendRequest` and then `applyMutationAppendRequest` against the exact prior persisted checkpoint before any write; this is what validates entry semantics, content/entry/head/append digests, `nextOutcomeRevision`, identity lineage, and legal journal progression. The pre-stage structural fixture does not replace that reducer proof.

Enforce the accepted canonical UTF-8 limits: 128 KiB per entry, 128 KiB per append request, 512 KiB per checkpoint, 256 total entries, with the final eight slots reserved from noncritical telemetry by the donor policy. One database transaction must CAS the expected journal version and previous head, append the dedicated mutation-journal record and audit event, store the next checkpoint, and return the exact L06 acknowledgement. `COMMITTED_NEW` and `IDEMPOTENT_REPLAY` require positive Ledger event identity and exact committed head/version/outcome; stale version/head returns `VERSION_CONFLICT`, exhausted capacity returns `CAPACITY_EXHAUSTED`, and malformed/idempotency-conflicting requests fail closed. Rebuild/replay tests must prove no duplicate append and no reopening of synthetic submission authority.

### Atomicity and restart requirements

- Add adapter methods in `server/src/systemIntegration/persistence/types.ts` and `ledgerAdapter.ts` for command compare-and-append, desired-state compare-and-set, alias/reference upsert, incident transition, and boot/release checkpoint.
- Command idempotency check, state revision check, command/result insert, and ledger event insert must share one SQLite transaction.
- L06's injected acknowledgement is not database CAS proof. Replace its persistence port only with the canonical transactional method after L06 is merged.
- Checkpoint codec/version in `server/src/systemIntegration/persistence/codec.ts` must migrate forward and reject unsupported/newer revisions. Rollback must either understand the new schema or refuse before release switch.
- Restart barrier must load unresolved `TICKET`, `AMBIGUOUS_MUTATION`, `POSITION`, `LIABILITY`, and `RECOVERY_CAMPAIGN` references and block new entries until accepted L/owner reconciliation clears them.
- JSON columns hold bounded, validated owner projections only. Exact money/quantity values remain decimal strings. Unknown is `null`/`UNKNOWN`/`UNAVAILABLE`, never zero.

## Accepted adapter fan-in requests

- Q: generate or import one schema validator/client from the frozen schema; prove parity with `node packages/edge-protocol-tests/protocol.test.mjs`. Then bind an accepted Q16/Q17 transport to `QAssessmentConsumerPort`. No model bytes, process, or socket is assumed by this packet.
- Basis/Volume: adapt existing `systemIntegration/adapters/engineCapture.ts` and Foundation canonical read-model outputs to `StrategySnapshotConsumerPort`; preserve opaque owner IDs and reasons.
- Capital/Risk: consume accepted exact-decimal owner verdict references. Do not convert engine floats into money.
- L05: after director merge, adapt `server/src/liveEdge/adapters/binancePrivateTruth/index.ts` projections/witnesses; this is evidence only and does not grant account-read or mutation authority.
- L06: after director merge, adapt journal/reconciliation handoffs; satisfy its canonical ledger CAS and fractional-quantity bridge requests in director-owned owners.
- L07: after director merge of immutable implementation `51be697476f32fbf2e9ae2cf4c5fab359187345f`, consume the direct `server/src/liveEdge/adapters/exchangeTwin/index.ts` barrel without reimplementing its reducer or its L03/L04/L06 owner-evidence checks. Preserve the exact `TwinScenarioState`, `TwinCheckpoint`, and `TwinCalibrationComparison` truth axes, including `AVAILABLE | UNAVAILABLE | GAPPED` book truth, `PROVED | AMBIGUOUS` ordering truth, simulator-only venue/local states, null probability/confidence, and the three non-authority constants. Treat checkpoints as value-only and calibration as evidence-only. Do not promote synthetic fills, venue status, recovery-required flags, or calibration availability into canonical execution, reconciliation, position, exposure, or trade-readiness truth.
- L08-L13: bind policy/ticket/execution/reconciliation/position/recovery ports only from future accepted immutable tips. L08 is currently `READY` but unimplemented; L09-L13 have no accepted implementation. Until accepted, return `UNAVAILABLE`, not guessed records.
- L14: after director merge of `04e50f43...`, bind the direct durable-control adapter losslessly. Preserve `APPLIED | NOOP | AWARENESS_RECORDED` receipts and `NOT_FOUND | PENDING | COMPLETED | REJECTED` lookup states; do not squeeze them into a boolean or the generic command result union.
- Outcome: persist assessment/model/outcome aliases through `ProductLedgerPersistencePort`; Q receives only sanitized feedback projections with dedupe receipt.
- Dashboard donor: map immutable donor `6925015` into `DashboardDonorBridgePort` without dropping `phase`, `overallPosture`, `truthLabel`, runtime/control generations, control before/after receipt, summaries, or correlated decisions. The browser remains a pure consumer and never recomputes readiness.
- L15 deployment artifacts: adapt immutable work commit `9a82d47` and receipt `2cec412927fa2f64f05a0b2774b18e45f8ce4fa5`; do not rebuild them. Wire `/health/live` and `/health/ready` to the canonical supervisor projection, but never put `/health/trade-ready` in a deploy/watchdog gate. Supply `EXPOSURE_CMD` from a bounded read-only projection that returns only `NONE | ACTIVE | AMBIGUOUS | RECOVERY_REQUIRED | UNKNOWN`, with failure collapsing to `UNKNOWN`; integrate release packaging and ledger-owned schema/rollback-floor truth; surface deployment freeze as a recorded control-plane fact. Creating the money-readiness marker, installing services, accessing secrets, running real regional benchmarks, and any AWS/Cloudflare/deployment activation remain separately owner-authorized external actions and are not authorized by this request.

## Package/test/documentation edits

- Root `package.json`: after merge, add a focused script equivalent to `node --test --test-concurrency=1 --test-reporter=spec "server/test/productIntegration/**/*.test.mjs"` and include it in `test:all:built`.
- Add the final route/composition/persistence/browser scenarios to the existing integration and I00 acceptance scripts; do not hardcode a historical count.
- Update `ARCHITECTURE.md` Part II only if the director changes an owner. Additive ports do not change ownership.
- Update `STATE.md` in the director's integration commit with actual wired/live/synthetic/unavailable state and measured test counts.

## Required fan-in proof

Before declaring any part integrated, the director must show: accepted donor SHAs; scope-clean merge; generated-client parity; focused tests; `npm test`; `npm run test:all`; route/control/persistence tests; cursor gap/truncation tests; restart-with-ambiguity proof; actual local runtime readback; and rendered cockpit truth. This packet alone proves none of those runtime claims.
