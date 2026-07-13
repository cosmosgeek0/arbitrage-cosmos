import { CONFORMANCE_MAPPING_SCHEMA } from '../contracts/conformance.mjs';
import { MODEL_MANIFEST_BY_ID } from './model-manifest.mjs';

export const IMPLEMENTATION_RELEASE_SHA = '9785c93102b00389847b77c2f9348c06abc4344b';
export const FORMAL_FIXTURE_TIME_MS = 1_783_900_800_000;

const VERSION = Object.freeze({
  executionContract: 'server/src/foundation/contracts/execution.ts@sha256:fe0fd1b360f8dd340cfe3742b04d652d12584e00bd2ba2bf1f26e97dc40d41d4',
  executionCoordinator: 'server/src/foundation/execution/coordinator.ts@sha256:770100ee0cdeb18d7967bea79fc81330607e1fe06271a84f34a40fbda485ad40',
  executionReducer: 'server/src/foundation/execution/reducer.ts@sha256:31088d281623d1743330160dcd48116ebe1c1262c4a00053de334ae65f78f5c8e',
  persistenceTypes: 'server/src/systemIntegration/persistence/types.ts@sha256:5370239485d05c0d453044df92c05d33d4252412df35f5a22c96d69549168a88',
  riskChecks: 'server/src/foundation/risk/checks.ts@sha256:bbecf37e026caf3c60ecad6ebe65d4ce4e6d44e60801322152b5f51126bed1ed',
  validateOnlyOrchestrator: 'server/src/systemIntegration/verticalSlice/orchestrator.ts@sha256:34397e5581e3f48bb152c9b1b3605608a609e5c925bcfc1026e8ccce24eb5338',
});

export const CONFORMANCE_EVIDENCE_REFS = Object.freeze({
  executionStates: 'server/src/foundation/contracts/execution.ts#L94-L208',
  executionSubmit: 'server/src/foundation/execution/coordinator.ts#L478-L669',
  executionCancel: 'server/src/foundation/execution/coordinator.ts#L888-L903',
  executionReducer: 'server/src/foundation/execution/reducer.ts#L289-L705',
  persistenceTypes: 'server/src/systemIntegration/persistence/types.ts#L119-L158',
  executionReplay: 'server/test/foundation/execution/execution.mjs#L401-L598',
  riskKill: 'server/src/foundation/risk/checks.ts#L302-L355',
  riskReduction: 'server/src/foundation/risk/checks.ts#L514-L607',
  validateOnlyOrchestrator: 'server/src/systemIntegration/verticalSlice/orchestrator.ts#L793-L841',
  riskReplay: 'server/test/foundation/risk/risk.mjs#L434-L468',
  authorityReplay: 'server/test/systemIntegration/verticalSlice/authority.scenarios.test.mjs#L361-L400',
});

function freezeRows(rows) {
  return Object.freeze(rows.map((row) => Object.freeze({
    ...row,
    evidenceRefs: Object.freeze([...row.evidenceRefs]),
  })));
}

function absentRows(prefix, elements) {
  return freezeRows(elements.map(([category, modelElementId], index) => ({
    mappingId: `${prefix}-ROW-${index + 1}`,
    category,
    modelElementId,
    implementationOwner: 'NOT_IMPLEMENTED',
    implementationPath: 'NOT_IMPLEMENTED',
    implementationSymbol: null,
    durableRecord: null,
    postcondition: null,
    atomicity: 'ZERO_STEP_STUTTER',
    status: 'ABSENT',
    evidenceRefs: [],
  })));
}

function fixture({
  mappingId,
  modelId,
  schemaVersions,
  commandVersions,
  storageVersions,
  mappings,
  mismatches = [],
  unreachableAbstractions = [],
  omittedEnvironmentBehavior,
  residualAssumptions,
}) {
  const manifest = MODEL_MANIFEST_BY_ID[modelId];
  return Object.freeze({
    schemaVersion: CONFORMANCE_MAPPING_SCHEMA,
    mappingId,
    modelId,
    modelVersion: manifest.modelVersion,
    modelContentSha256: manifest.bundleSha256,
    implementationReleaseSha: IMPLEMENTATION_RELEASE_SHA,
    implementationSchemaVersions: Object.freeze([...schemaVersions]),
    implementationCommandVersions: Object.freeze([...commandVersions]),
    implementationStorageTransitionVersions: Object.freeze([...storageVersions]),
    normalizerVersion: 'ip-assurance.s3.conformance-normalizer.v1',
    mappings,
    replays: Object.freeze({
      representativeSuccess: Object.freeze({
        traceId: `${mappingId}-SUCCESS`, status: 'NOT_RUN', traceSha256: null, harness: null, evidenceRefs: Object.freeze([]),
      }),
      validatedCounterexamples: Object.freeze([]),
    }),
    mismatches: Object.freeze([...mismatches]),
    unreachableAbstractions: Object.freeze([...unreachableAbstractions]),
    omittedEnvironmentBehavior: Object.freeze([...omittedEnvironmentBehavior]),
    residualAssumptions: Object.freeze([...residualAssumptions]),
    evaluatedAtMs: FORMAL_FIXTURE_TIME_MS,
  });
}

const M01 = fixture({
  mappingId: 'S3-CONFORMANCE-M01',
  modelId: 'S3-M01-AMBIGUOUS-MUTATION',
  schemaVersions: [VERSION.executionContract],
  commandVersions: [VERSION.executionCoordinator],
  storageVersions: [VERSION.persistenceTypes],
  mappings: freezeRows([
    {
      mappingId: 'S3-M01-MAP-STATE', category: 'STATE', modelElementId: 'INTENT_DURABLE|IN_FLIGHT|AMBIGUOUS|LOOKUP|TERMINAL',
      implementationOwner: 'foundation.execution', implementationPath: 'server/src/foundation/contracts/execution.ts', implementationSymbol: 'PLAN_LIFECYCLES and LEG_LIFECYCLES',
      durableRecord: 'PersistedIdempotencyReceipt and returned execution checkpoint types', postcondition: null,
      atomicity: 'MANY_TO_ONE', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.executionStates, CONFORMANCE_EVIDENCE_REFS.persistenceTypes],
    },
    {
      mappingId: 'S3-M01-MAP-ACTION', category: 'ACTION', modelElementId: 'PERSIST_INTENT|DISPATCH_MUTATION|BEGIN_RECONCILIATION|LOOKUP_*',
      implementationOwner: 'foundation.execution', implementationPath: 'server/src/foundation/execution/coordinator.ts', implementationSymbol: 'ExecutionCoordinator',
      durableRecord: 'serializeExecutionCheckpoint return value; caller persistence is not enforced', postcondition: null,
      atomicity: 'ONE_TO_MANY', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.executionSubmit],
    },
    {
      mappingId: 'S3-M01-MAP-INVARIANT', category: 'INVARIANT', modelElementId: 'S3-SAF-03|S3-SAF-04|S3-SAF-05|S3-SAF-06',
      implementationOwner: 'foundation.execution + systemIntegration.persistence', implementationPath: 'server/src/foundation/execution/coordinator.ts', implementationSymbol: 'ExecutionCoordinator.submitPaper path',
      durableRecord: 'PersistedIdempotencyReceipt structural type', postcondition: 'No enforced atomic durable-write-before-submit boundary was found.',
      atomicity: 'ONE_TO_MANY', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.executionSubmit, CONFORMANCE_EVIDENCE_REFS.persistenceTypes],
    },
    {
      mappingId: 'S3-M01-MAP-POST', category: 'POSTCONDITION', modelElementId: 'AUTHORITATIVE_APPLIED|AUTHORITATIVE_ABSENT|DURABLE_UNRESOLVED',
      implementationOwner: 'foundation.execution', implementationPath: 'server/src/foundation/execution/coordinator.ts', implementationSymbol: 'ExecutionCoordinator ambiguity lookup and checkpoint restore',
      durableRecord: 'Execution checkpoint returned to caller', postcondition: 'Ambiguity lookup may resolve the same client identity; unresolved ambiguity blocks resend.',
      atomicity: 'ONE_TO_MANY', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.executionSubmit, CONFORMANCE_EVIDENCE_REFS.executionReplay],
    },
  ]),
  mismatches: ['Submission-start is reduced in memory before submitPaper; the coordinator does not enforce durable intent persistence before the external paper effect.'],
  omittedEnvironmentBehavior: ['Caller checkpoint persistence atomicity, crash timing at the submit boundary, and authoritative exchange lookup durability are not modeled by the implementation mapping.'],
  residualAssumptions: ['PAPER submission identity and lookup behavior are deterministic in the cited ordinary harness; LIVE execution is not implemented.'],
});

const M02 = fixture({
  mappingId: 'S3-CONFORMANCE-M02',
  modelId: 'S3-M02-TWO-LEG-RECOVERY',
  schemaVersions: [VERSION.executionContract, VERSION.executionReducer],
  commandVersions: [VERSION.executionCoordinator],
  storageVersions: [VERSION.persistenceTypes],
  mappings: freezeRows([
    {
      mappingId: 'S3-M02-MAP-STATE', category: 'STATE', modelElementId: 'FIRST_IN_FLIGHT|PARTIAL|CANCEL_PENDING|AMBIGUOUS|RECOVERY|TERMINAL',
      implementationOwner: 'foundation.execution', implementationPath: 'server/src/foundation/contracts/execution.ts', implementationSymbol: 'PlanLifecycle and LegLifecycle',
      durableRecord: 'Execution checkpoint types returned by coordinator', postcondition: null,
      atomicity: 'MANY_TO_ONE', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.executionStates],
    },
    {
      mappingId: 'S3-M02-MAP-ACTION', category: 'ACTION', modelElementId: 'SUBMIT_FIRST_LEG|REQUEST_CANCEL|LATE_FILL|HEDGE_RESIDUAL|CLOSE_EXPOSED_LEG',
      implementationOwner: 'foundation.execution', implementationPath: 'server/src/foundation/execution/coordinator.ts', implementationSymbol: 'ExecutionCoordinator sequential-leg and cancel guards',
      durableRecord: 'Returned execution checkpoint; no coordinator-owned durable commit', postcondition: null,
      atomicity: 'ONE_TO_MANY', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.executionSubmit, CONFORMANCE_EVIDENCE_REFS.executionCancel],
    },
    {
      mappingId: 'S3-M02-MAP-INVARIANT', category: 'INVARIANT', modelElementId: 'S3-SAF-04|S3-SAF-06|S3-SAF-07',
      implementationOwner: 'foundation.execution', implementationPath: 'server/src/foundation/execution/reducer.ts', implementationSymbol: 'reduceExecutionEvent and exposure derivation helpers',
      durableRecord: 'Reducer event stream represented inside checkpoint', postcondition: 'Known fill exposure remains derived; unresolved exposure blocks intake.',
      atomicity: 'MANY_TO_ONE', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.executionReducer],
    },
    {
      mappingId: 'S3-M02-MAP-POST', category: 'POSTCONDITION', modelElementId: 'HEDGED|CLOSED|UNRESOLVED',
      implementationOwner: 'foundation.execution', implementationPath: 'server/src/foundation/execution/coordinator.ts', implementationSymbol: 'ExecutionCoordinator recovery recommendation and checkpoint result',
      durableRecord: 'Execution checkpoint returned to caller', postcondition: 'Partial fill sizes the dependent leg; recovery recommendations remain non-automatic.',
      atomicity: 'ONE_TO_MANY', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.executionReplay],
    },
  ]),
  mismatches: ['No coordinator cancel-order port or automatic compensation protocol closes the full modeled cancel/fill recovery sequence.'],
  omittedEnvironmentBehavior: ['External cancellation transport, late-fill delivery ordering, and caller-owned checkpoint persistence are omitted.'],
  residualAssumptions: ['The cited PAPER execution reducer and ordinary harness preserve observed fill quantities deterministically.'],
});

const M03 = fixture({
  mappingId: 'S3-CONFORMANCE-M03',
  modelId: 'S3-M03-EXECUTION-FENCING',
  schemaVersions: ['NOT_IMPLEMENTED'], commandVersions: ['NOT_IMPLEMENTED'], storageVersions: ['NOT_IMPLEMENTED'],
  mappings: absentRows('S3-M03', [['STATE', 'EXECUTION_LEASE_AND_EPOCH'], ['ACTION', 'OVERLAP_ACQUIRE_AND_REVOKE'], ['INVARIANT', 'S3-SAF-01|S3-SAF-02|S3-SAF-03'], ['POSTCONDITION', 'LOST_OWNER_REVOKED_OR_UNRESOLVED']]),
  omittedEnvironmentBehavior: ['Multi-process execution lease, compare-and-swap fencing, process resurrection, and callback transport identity are not implemented.'],
  residualAssumptions: ['Control-supervisor generation guards are non-money analogues and are intentionally not claimed as execution conformance.'],
});

const M04 = fixture({
  mappingId: 'S3-CONFORMANCE-M04',
  modelId: 'S3-M04-REPAIR-CAMPAIGN',
  schemaVersions: ['NOT_IMPLEMENTED'], commandVersions: ['NOT_IMPLEMENTED'], storageVersions: ['NOT_IMPLEMENTED'],
  mappings: absentRows('S3-M04', [['STATE', 'DURABLE_REPAIR_CAMPAIGN'], ['ACTION', 'RETRY_ROLLBACK_COMPENSATE_QUARANTINE'], ['INVARIANT', 'S3-SAF-01|S3-SAF-02|S3-SAF-06|S3-SAF-09|S3-M04-INV-01'], ['POSTCONDITION', 'INDEPENDENT_RECOVERY_OR_VISIBLE_TERMINAL']]),
  omittedEnvironmentBehavior: ['Repair effect idempotency, conflict ordering, compensation availability, and authoritative verification are not implemented.'],
  residualAssumptions: ['Supervisor process restart is not relabeled as remediation-campaign conformance.'],
});

const M05 = fixture({
  mappingId: 'S3-CONFORMANCE-M05',
  modelId: 'S3-M05-BORROW-LIABILITY',
  schemaVersions: ['NOT_IMPLEMENTED'], commandVersions: ['NOT_IMPLEMENTED'], storageVersions: ['NOT_IMPLEMENTED'],
  mappings: absentRows('S3-M05', [['STATE', 'BORROW_SHORT_INTEREST_REPAY_LIABILITY'], ['ACTION', 'DURABLE_MUTATION_AND_RECONCILIATION'], ['INVARIANT', 'S3-SAF-04|S3-SAF-05|S3-SAF-06|S3-SAF-07'], ['POSTCONDITION', 'AUTHORITATIVE_ZERO_OR_DURABLE_UNRESOLVED']]),
  omittedEnvironmentBehavior: ['Canonical borrow owner is read-only feasibility truth; no accepted borrow/short/repay mutation protocol exists.'],
  residualAssumptions: ['Legacy loan mutation code is excluded from accepted integration and is not conformance evidence.'],
});

const M06 = fixture({
  mappingId: 'S3-CONFORMANCE-M06',
  modelId: 'S3-M06-HALT-RISK-REDUCTION',
  schemaVersions: [VERSION.riskChecks], commandVersions: [VERSION.validateOnlyOrchestrator], storageVersions: ['NOT_APPLICABLE'],
  mappings: freezeRows([
    {
      mappingId: 'S3-M06-MAP-STATE', category: 'STATE', modelElementId: 'OPEN|HALT_NEW_EXPOSURE|UNKNOWN',
      implementationOwner: 'foundation.risk', implementationPath: 'server/src/foundation/risk/checks.ts', implementationSymbol: 'checkKillSwitch',
      durableRecord: null, postcondition: null, atomicity: 'ONE_TO_ONE', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.riskKill],
    },
    {
      mappingId: 'S3-M06-MAP-ACTION', category: 'ACTION', modelElementId: 'EVALUATE_CANONICAL_RISK|COMMIT_OR_BLOCK_REDUCTION',
      implementationOwner: 'systemIntegration.verticalSlice', implementationPath: 'server/src/systemIntegration/verticalSlice/orchestrator.ts', implementationSymbol: 'ValidateOnlyOrchestrator',
      durableRecord: null, postcondition: null, atomicity: 'ONE_TO_MANY', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.validateOnlyOrchestrator],
    },
    {
      mappingId: 'S3-M06-MAP-INVARIANT', category: 'INVARIANT', modelElementId: 'S3-SAF-08|S3-SAF-10|S3-M06-INV-01',
      implementationOwner: 'foundation.risk', implementationPath: 'server/src/foundation/risk/checks.ts', implementationSymbol: 'checkKillSwitch and checkRecoveryRiskReduction',
      durableRecord: null, postcondition: 'Risk increase is blocked; a reduction requires fresh account-bound evidence and cannot overshoot.',
      atomicity: 'MANY_TO_ONE', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.riskKill, CONFORMANCE_EVIDENCE_REFS.riskReduction],
    },
    {
      mappingId: 'S3-M06-MAP-POST', category: 'POSTCONDITION', modelElementId: 'APPLIED_REDUCTION|BLOCKED|UNRESOLVED',
      implementationOwner: 'foundation.risk', implementationPath: 'server/src/foundation/risk/checks.ts', implementationSymbol: 'checkRecoveryRiskReduction',
      durableRecord: null, postcondition: 'Pure validation admits only a bounded proven reduction; no operational mutation is performed.',
      atomicity: 'MANY_TO_ONE', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.riskReplay, CONFORMANCE_EVIDENCE_REFS.authorityReplay],
    },
  ]),
  omittedEnvironmentBehavior: ['No operational halt command is demonstrated across every mutation route, and no canonical live risk-reduction execution path exists.'],
  residualAssumptions: ['The mapped implementation is validate-only and preserves LIVE_EXECUTION_NOT_IMPLEMENTED.'],
});

const M07 = fixture({
  mappingId: 'S3-CONFORMANCE-M07',
  modelId: 'S3-M07-CANCELLATION-BOUNDARY',
  schemaVersions: ['NOT_IMPLEMENTED'], commandVersions: ['NOT_IMPLEMENTED'], storageVersions: ['NOT_IMPLEMENTED'],
  mappings: absentRows('S3-M07', [['STATE', 'LOCAL_CHILD_VS_EXTERNAL_MUTATION'], ['ACTION', 'CANCEL_OBSERVE_DETACH_HANDOFF_RECONCILE'], ['INVARIANT', 'S3-SAF-01|S3-SAF-02|S3-SAF-03|S3-SAF-04|S3-SAF-06'], ['POSTCONDITION', 'CANCELLED_OR_AUTHORITATIVE_EXTERNAL_TERMINAL']]),
  omittedEnvironmentBehavior: ['Abort boundary, non-cancellable effect classification, detached reconciliation context, and durable fencing handoff are not implemented.'],
  residualAssumptions: ['Existing execution cancellation refusal is partial safety evidence only and is not a full protocol mapping.'],
});

export const CONFORMANCE_FIXTURES = Object.freeze([M01, M02, M03, M04, M05, M06, M07]);
