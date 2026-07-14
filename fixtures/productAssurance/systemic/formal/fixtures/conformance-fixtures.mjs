import { CONFORMANCE_MAPPING_SCHEMA } from '../contracts/conformance.mjs';
import { MODEL_MANIFEST_BY_ID } from './model-manifest.mjs';

export const IMPLEMENTATION_RELEASE_SHA = '9785c93102b00389847b77c2f9348c06abc4344b';
export const FROZEN_L_IMPLEMENTATION_RELEASE_SHA = 'df6b472993ca9659ce09cf5f72004981c6835f0d';
export const FORMAL_FIXTURE_TIME_MS = 1_783_900_800_000;

const VERSION = Object.freeze({
  executionContract: 'server/src/foundation/contracts/execution.ts@sha256:fe0fd1b360f8dd340cfe3742b04d652d12584e00bd2ba2bf1f26e97dc40d41d4',
  executionCoordinator: 'server/src/foundation/execution/coordinator.ts@sha256:770100ee0cdeb18d7967bea79fc81330607e1fe06271a84f34a40fbda485ad40',
  executionReducer: 'server/src/foundation/execution/reducer.ts@sha256:31088d281623d1743330160dcd48116ebe1c1262c4a00053de334ae65f78f5c8e',
  persistenceTypes: 'server/src/systemIntegration/persistence/types.ts@sha256:5370239485d05c0d453044df92c05d33d4252412df35f5a22c96d69549168a88',
  riskChecks: 'server/src/foundation/risk/checks.ts@sha256:bbecf37e026caf3c60ecad6ebe65d4ce4e6d44e60801322152b5f51126bed1ed',
  validateOnlyOrchestrator: 'server/src/systemIntegration/verticalSlice/orchestrator.ts@sha256:34397e5581e3f48bb152c9b1b3605608a609e5c925bcfc1026e8ccce24eb5338',
});

const FROZEN_L_VERSION = Object.freeze({
  executionPolicyTypes: 'server/src/liveEdge/adapters/executionPolicy/types.ts@sha256:da466c08356b6707f69f3df85501661d3d985082feddb4127b7e7974cdf54402',
  executionPolicy: 'server/src/liveEdge/adapters/executionPolicy/policy.ts@sha256:c713027a55961e3b8e10b11ffe6d1c0c3470f101fe74fa2b7449570ec9669c50',
  foundationExecutionContract: 'server/src/foundation/contracts/execution.ts@sha256:fe0fd1b360f8dd340cfe3742b04d652d12584e00bd2ba2bf1f26e97dc40d41d4',
  foundationExecutionReducer: 'server/src/foundation/execution/reducer.ts@sha256:bd451c9f7e5085389f51c63ad7cc918d51d9256ef8e867e466b76cb3fe6b9df2',
  normalBasisTypes: 'server/src/liveEdge/adapters/normalBasis/types.ts@sha256:8fc7a86fcf4aa3d3fb8d212e1c83624f743ac442567d20d41f6318bf9fd2fb60',
  normalBasisTwin: 'server/src/liveEdge/adapters/normalBasis/twinAdapter.ts@sha256:c8015c0f9c63186d6f77738d1687c608d541d0f66e2cc2181725378e49ef3029',
  normalBasisEvidence: 'server/src/liveEdge/adapters/normalBasis/evidence.ts@sha256:a2101caacc8a1d5fe5bb5552274531dc9288f7ea5d635c214d9e6272c8311f51',
  reverseBasisTypes: 'server/src/liveEdge/adapters/reverseBasisLifecycle/types.ts@sha256:530598f7f05804690a34e6344833235db6762e31cc5343438ab104499680ef53',
  reverseBasisLifecycle: 'server/src/liveEdge/adapters/reverseBasisLifecycle/lifecycle.ts@sha256:f287106fb6002cf2cd05e26049cac73e79726448d703c86a61d785adcbecd7be',
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
  l08Authority: 'server/src/liveEdge/adapters/executionPolicy/policy.ts#L142-L148',
  l08ActionValidation: 'server/src/liveEdge/adapters/executionPolicy/policy.ts#L348-L690',
  l08Evaluation: 'server/src/liveEdge/adapters/executionPolicy/policy.ts#L832-L1194',
  l09OwnerTransitions: 'server/src/foundation/contracts/execution.ts#L133-L211',
  l09Reducer: 'server/src/foundation/execution/reducer.ts#L299-L783',
  l09TwinAdapter: 'server/src/liveEdge/adapters/normalBasis/twinAdapter.ts#L454-L930',
  l09Agreement: 'server/src/liveEdge/adapters/normalBasis/evidence.ts#L500-L760',
  l10EventReducer: 'server/src/liveEdge/adapters/reverseBasisLifecycle/lifecycle.ts#L1465-L1913',
  l10StageProjection: 'server/src/liveEdge/adapters/reverseBasisLifecycle/lifecycle.ts#L1283-L1462',
  l10FoldAndReplay: 'server/src/liveEdge/adapters/reverseBasisLifecycle/lifecycle.ts#L1919-L2810',
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
  implementationReleaseSha = IMPLEMENTATION_RELEASE_SHA,
}) {
  const manifest = MODEL_MANIFEST_BY_ID[modelId];
  return Object.freeze({
    schemaVersion: CONFORMANCE_MAPPING_SCHEMA,
    mappingId,
    modelId,
    modelVersion: manifest.modelVersion,
    modelContentSha256: manifest.bundleSha256,
    implementationReleaseSha,
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

const M08 = fixture({
  mappingId: 'S3-CONFORMANCE-M08',
  modelId: 'S3-M08-ORDER-POLICY',
  implementationReleaseSha: FROZEN_L_IMPLEMENTATION_RELEASE_SHA,
  schemaVersions: [FROZEN_L_VERSION.executionPolicyTypes],
  commandVersions: [FROZEN_L_VERSION.executionPolicy],
  storageVersions: ['NOT_APPLICABLE'],
  mappings: freezeRows([
    {
      mappingId: 'S3-M08-MAP-STATE', category: 'STATE', modelElementId: 'RAW|EVALUATE|PLANNED|REJECTED',
      implementationOwner: 'liveEdge.adapters.executionPolicy', implementationPath: 'server/src/liveEdge/adapters/executionPolicy/types.ts', implementationSymbol: 'ExecutionPolicyInput and ExecutionPolicyDecision',
      durableRecord: null, postcondition: null, atomicity: 'MANY_TO_ONE', status: 'MAPPED', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l08Authority, CONFORMANCE_EVIDENCE_REFS.l08Evaluation],
    },
    {
      mappingId: 'S3-M08-MAP-PARSE', category: 'ACTION', modelElementId: 'PARSE_POLICY_ENVELOPE',
      implementationOwner: 'liveEdge.adapters.executionPolicy', implementationPath: 'server/src/liveEdge/adapters/executionPolicy/policy.ts', implementationSymbol: 'validateAction, validateTransitions, validateLegTransitions, and validateCandidate',
      durableRecord: null, postcondition: null, atomicity: 'ONE_TO_MANY', status: 'MAPPED', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l08ActionValidation],
    },
    {
      mappingId: 'S3-M08-MAP-EVALUATE', category: 'ACTION', modelElementId: 'EVALUATE_GLOBAL_AUTHORITY_AND_DEPENDENCIES',
      implementationOwner: 'liveEdge.adapters.executionPolicy', implementationPath: 'server/src/liveEdge/adapters/executionPolicy/policy.ts', implementationSymbol: 'evaluateExecutionPolicyCore, rejectGlobal, and rejectedInput',
      durableRecord: null, postcondition: null, atomicity: 'ONE_TO_MANY', status: 'MAPPED', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l08Evaluation],
    },
    {
      mappingId: 'S3-M08-MAP-GRAPH', category: 'ACTION', modelElementId: 'VALIDATE_CANCEL_REPLACE_AND_RECOVERY_GRAPH',
      implementationOwner: 'liveEdge.adapters.executionPolicy', implementationPath: 'server/src/liveEdge/adapters/executionPolicy/policy.ts', implementationSymbol: 'validateAction, validateTransitions, validateLegTransitions, and validateCandidate',
      durableRecord: null, postcondition: null, atomicity: 'ONE_TO_MANY', status: 'MAPPED', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l08ActionValidation],
    },
    {
      mappingId: 'S3-M08-MAP-INVARIANT', category: 'INVARIANT', modelElementId: 'S3-SAF-08|S3-SAF-11|S3-SAF-12|S3-SAF-13|S3-SAF-14',
      implementationOwner: 'liveEdge.adapters.executionPolicy', implementationPath: 'server/src/liveEdge/adapters/executionPolicy/policy.ts', implementationSymbol: 'evaluateExecutionPolicyCore and validateCandidate',
      durableRecord: null, postcondition: 'Kill/revoke, UNKNOWN authority/dependency, stale evidence, invalid cancel graph, and widening recovery all fail closed in the record-only evaluator.',
      atomicity: 'MANY_TO_ONE', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l08ActionValidation, CONFORMANCE_EVIDENCE_REFS.l08Evaluation],
    },
    {
      mappingId: 'S3-M08-MAP-POST', category: 'POSTCONDITION', modelElementId: 'NON_SENDABLE_PLANNED_OR_FAIL_CLOSED_REJECTED',
      implementationOwner: 'liveEdge.adapters.executionPolicy', implementationPath: 'server/src/liveEdge/adapters/executionPolicy/policy.ts', implementationSymbol: 'AUTHORITY, finalizeDecision, and evaluateExecutionPolicyCore',
      durableRecord: null, postcondition: 'Every decision remains SYNTHETIC_FIXTURE, sendEligible false, NONE_RECORD_ONLY, and externalActionAuthorization NONE.',
      atomicity: 'MANY_TO_ONE', status: 'MAPPED', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l08Authority, CONFORMANCE_EVIDENCE_REFS.l08Evaluation],
    },
  ]),
  omittedEnvironmentBehavior: ['The frozen implementation is a one-shot pure evaluator; it has no runtime reducer, executor, cancel observer, repair worker, lease, or persistence transition.'],
  residualAssumptions: ['SYNTHETIC_ONLY and SUPPORTING_EVIDENCE_ONLY; runtime_claim_closure is NOT_PERMITTED and no plan is sendable.'],
});

const M09 = fixture({
  mappingId: 'S3-CONFORMANCE-M09',
  modelId: 'S3-M09-NORMAL-BASIS-LIFECYCLE',
  implementationReleaseSha: FROZEN_L_IMPLEMENTATION_RELEASE_SHA,
  schemaVersions: [FROZEN_L_VERSION.foundationExecutionContract, FROZEN_L_VERSION.normalBasisTypes],
  commandVersions: [FROZEN_L_VERSION.foundationExecutionReducer, FROZEN_L_VERSION.normalBasisTwin, FROZEN_L_VERSION.normalBasisEvidence],
  storageVersions: ['CALLER_OWNED_CHECKPOINT_NOT_ENFORCED'],
  mappings: freezeRows([
    {
      mappingId: 'S3-M09-MAP-STATE', category: 'STATE', modelElementId: 'FOUNDATION_PLAN_AND_LEG_LIFECYCLES',
      implementationOwner: 'foundation.execution', implementationPath: 'server/src/foundation/contracts/execution.ts', implementationSymbol: 'PLAN_LIFECYCLE_TRANSITIONS and LEG_LIFECYCLE_TRANSITIONS',
      durableRecord: 'ExecutionPlanState checkpoint returned to the caller', postcondition: null,
      atomicity: 'MANY_TO_ONE', status: 'MAPPED', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l09OwnerTransitions],
    },
    {
      mappingId: 'S3-M09-MAP-PLAN', category: 'ACTION', modelElementId: 'PLAN_PREFLIGHT_OPEN_CLOSE_TRANSITIONS',
      implementationOwner: 'foundation.execution', implementationPath: 'server/src/foundation/execution/reducer.ts', implementationSymbol: 'reduceExecutionEvent plan-event branches',
      durableRecord: 'Reducer eventLog and stateRevisionId inside returned checkpoint', postcondition: null,
      atomicity: 'ONE_TO_MANY', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l09Reducer],
    },
    {
      mappingId: 'S3-M09-MAP-LEG', category: 'ACTION', modelElementId: 'LEG_SUBMIT_FILL_CANCEL_AMBIGUITY_TRANSITIONS',
      implementationOwner: 'foundation.execution', implementationPath: 'server/src/foundation/execution/reducer.ts', implementationSymbol: 'reduceExecutionEvent leg submit, fill, cancel, and reconciliation branches',
      durableRecord: 'Opening and closing leg state inside returned checkpoint', postcondition: null,
      atomicity: 'ONE_TO_MANY', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l09Reducer, CONFORMANCE_EVIDENCE_REFS.l09OwnerTransitions],
    },
    {
      mappingId: 'S3-M09-MAP-EVIDENCE', category: 'ACTION', modelElementId: 'NORMAL_BASIS_TWIN_OBSERVATION_AND_AGREEMENT',
      implementationOwner: 'liveEdge.adapters.normalBasis', implementationPath: 'server/src/liveEdge/adapters/normalBasis/twinAdapter.ts', implementationSymbol: 'runNormalBasisTwinLeg and evaluateNormalBasisOwnerAgreement',
      durableRecord: 'Caller-supplied owner checkpoint plus immutable evidence projection', postcondition: null,
      atomicity: 'ONE_TO_MANY', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l09TwinAdapter, CONFORMANCE_EVIDENCE_REFS.l09Agreement],
    },
    {
      mappingId: 'S3-M09-MAP-REPAIR', category: 'ACTION', modelElementId: 'RECONCILE_OR_REPAIR_RESIDUAL',
      implementationOwner: 'foundation.execution + liveEdge.adapters.normalBasis', implementationPath: 'server/src/foundation/execution/reducer.ts', implementationSymbol: 'reduceExecutionEvent reconciliation branches and evaluateNormalBasisOwnerAgreement',
      durableRecord: 'Returned checkpoint and evidence-only agreement', postcondition: null,
      atomicity: 'ONE_TO_MANY', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l09Reducer, CONFORMANCE_EVIDENCE_REFS.l09Agreement],
    },
    {
      mappingId: 'S3-M09-MAP-INVARIANT', category: 'INVARIANT', modelElementId: 'S3-SAF-03|S3-SAF-06|S3-SAF-07|S3-SAF-12|S3-SAF-13|S3-SAF-14|S3-SAF-15|S3-M09-INV-01',
      implementationOwner: 'foundation.execution + liveEdge.adapters.normalBasis', implementationPath: 'server/src/foundation/execution/reducer.ts', implementationSymbol: 'reduceExecutionEvent, runNormalBasisTwinLeg, and evaluateNormalBasisOwnerAgreement',
      durableRecord: 'Returned Foundation checkpoint and evidence projections', postcondition: 'Cancel request remains CANCEL_PENDING; fill residual is retained; non-exact truth blocks agreement PASS; terminal plans have no submit successor.',
      atomicity: 'ONE_TO_MANY', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l09OwnerTransitions, CONFORMANCE_EVIDENCE_REFS.l09Reducer, CONFORMANCE_EVIDENCE_REFS.l09TwinAdapter, CONFORMANCE_EVIDENCE_REFS.l09Agreement],
    },
    {
      mappingId: 'S3-M09-MAP-POST', category: 'POSTCONDITION', modelElementId: 'HEDGED_OPEN|CLOSED|BLOCKED|DURABLE_UNRESOLVED',
      implementationOwner: 'foundation.execution + liveEdge.adapters.normalBasis', implementationPath: 'server/src/liveEdge/adapters/normalBasis/evidence.ts', implementationSymbol: 'evaluateNormalBasisOwnerAgreement',
      durableRecord: 'Caller-owned Foundation checkpoint; adapter output is immutable evidence only', postcondition: 'PASS requires exact owner agreement; ambiguity and residual exposure remain manual, blocked, or recovery-required.',
      atomicity: 'MANY_TO_ONE', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l09Agreement, CONFORMANCE_EVIDENCE_REFS.l09Reducer],
    },
  ]),
  omittedEnvironmentBehavior: ['No literal HALT event, executor fence, durable scheduler, automatic repair executor, or adapter-owned lifecycle exists in the mapped files.'],
  residualAssumptions: ['Foundation remains the lifecycle and reconciliation owner; normalBasis is SYNTHETIC_FIXTURE evidence only and runtime_claim_closure is NOT_PERMITTED.'],
});

const M10 = fixture({
  mappingId: 'S3-CONFORMANCE-M10',
  modelId: 'S3-M10-REVERSE-BASIS-LIABILITY',
  implementationReleaseSha: FROZEN_L_IMPLEMENTATION_RELEASE_SHA,
  schemaVersions: [FROZEN_L_VERSION.reverseBasisTypes],
  commandVersions: [FROZEN_L_VERSION.reverseBasisLifecycle],
  storageVersions: ['FINITE_EVENT_BATCH_NO_RUNTIME_STORE'],
  mappings: freezeRows([
    {
      mappingId: 'S3-M10-MAP-STATE', category: 'STATE', modelElementId: 'DERIVED_REVERSE_BASIS_STAGE_AND_EVENT_FOLD',
      implementationOwner: 'liveEdge.adapters.reverseBasisLifecycle', implementationPath: 'server/src/liveEdge/adapters/reverseBasisLifecycle/types.ts', implementationSymbol: 'ReverseBasisLifecycleStage, ReverseBasisEvent, and ReverseBasisLifecycleState',
      durableRecord: 'Finite input event batch and immutable returned projection', postcondition: null,
      atomicity: 'MANY_TO_ONE', status: 'MAPPED', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l10EventReducer, CONFORMANCE_EVIDENCE_REFS.l10StageProjection],
    },
    {
      mappingId: 'S3-M10-MAP-LIABILITY', category: 'ACTION', modelElementId: 'OBSERVE_BORROW_LIABILITY_AND_REPAY',
      implementationOwner: 'liveEdge.adapters.reverseBasisLifecycle', implementationPath: 'server/src/liveEdge/adapters/reverseBasisLifecycle/lifecycle.ts', implementationSymbol: 'applyEvent BORROW_OBSERVED, LIABILITY_OBSERVED, and REPAY_OBSERVED branches',
      durableRecord: 'Immutable event fold retained in returned lifecycle state', postcondition: null,
      atomicity: 'ONE_TO_MANY', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l10EventReducer],
    },
    {
      mappingId: 'S3-M10-MAP-ORDERS', category: 'ACTION', modelElementId: 'OBSERVE_ENTRY_HEDGE_EXIT_AND_COVER',
      implementationOwner: 'liveEdge.adapters.reverseBasisLifecycle', implementationPath: 'server/src/liveEdge/adapters/reverseBasisLifecycle/lifecycle.ts', implementationSymbol: 'applyEvent ORDER_OBSERVED branch and projectOrder',
      durableRecord: 'Projected order map inside returned lifecycle state', postcondition: null,
      atomicity: 'ONE_TO_MANY', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l10EventReducer, CONFORMANCE_EVIDENCE_REFS.l10FoldAndReplay],
    },
    {
      mappingId: 'S3-M10-MAP-RECOVERY', category: 'ACTION', modelElementId: 'OBSERVE_RECOVERY_CLOSURE_OR_MANUAL_EVIDENCE',
      implementationOwner: 'liveEdge.adapters.reverseBasisLifecycle', implementationPath: 'server/src/liveEdge/adapters/reverseBasisLifecycle/lifecycle.ts', implementationSymbol: 'applyEvent RECOVERY_EVIDENCE, CLOSURE_RECONCILED, and MANUAL_INTERVENTION branches',
      durableRecord: 'Immutable event fold retained in returned lifecycle state', postcondition: null,
      atomicity: 'ONE_TO_MANY', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l10EventReducer],
    },
    {
      mappingId: 'S3-M10-MAP-DERIVE', category: 'ACTION', modelElementId: 'DERIVE_REVERSE_BASIS_STAGE',
      implementationOwner: 'liveEdge.adapters.reverseBasisLifecycle', implementationPath: 'server/src/liveEdge/adapters/reverseBasisLifecycle/lifecycle.ts', implementationSymbol: 'deriveLifecycle and runReverseBasisLifecycle',
      durableRecord: 'Derived immutable lifecycle projection', postcondition: null,
      atomicity: 'MANY_TO_ONE', status: 'MAPPED', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l10StageProjection, CONFORMANCE_EVIDENCE_REFS.l10FoldAndReplay],
    },
    {
      mappingId: 'S3-M10-MAP-INVARIANT', category: 'INVARIANT', modelElementId: 'S3-SAF-06|S3-SAF-07|S3-SAF-12|S3-SAF-13|S3-SAF-14|S3-SAF-15|S3-M10-INV-01|S3-M10-INV-02',
      implementationOwner: 'liveEdge.adapters.reverseBasisLifecycle', implementationPath: 'server/src/liveEdge/adapters/reverseBasisLifecycle/lifecycle.ts', implementationSymbol: 'applyEvent, computeExposure, closureReasons, and deriveLifecycle',
      durableRecord: 'Immutable event fold and derived liability/exposure projection', postcondition: 'Principal and interest cannot regress before repay; zero binds confirmed repay; paired fills are bounded; UNKNOWN remains recovery-required; closure is final.',
      atomicity: 'ONE_TO_MANY', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l10EventReducer, CONFORMANCE_EVIDENCE_REFS.l10StageProjection, CONFORMANCE_EVIDENCE_REFS.l10FoldAndReplay],
    },
    {
      mappingId: 'S3-M10-MAP-POST', category: 'POSTCONDITION', modelElementId: 'EXACT_ZERO_LIABILITY_CLOSURE_OR_VISIBLE_RECOVERY',
      implementationOwner: 'liveEdge.adapters.reverseBasisLifecycle', implementationPath: 'server/src/liveEdge/adapters/reverseBasisLifecycle/lifecycle.ts', implementationSymbol: 'closureReasons, deriveLifecycle, and runReverseBasisLifecycle',
      durableRecord: 'Immutable final projection over the supplied event batch', postcondition: 'CLOSED or RECOVERED requires exact current closure, zero debt, paired flat legs, and no open, ambiguous, or unmatched references.',
      atomicity: 'MANY_TO_ONE', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l10StageProjection, CONFORMANCE_EVIDENCE_REFS.l10FoldAndReplay],
    },
  ]),
  unreachableAbstractions: ['BORROWING is declared in ReverseBasisLifecycleStage but is never assigned by frozen deriveLifecycle; confirmed borrow projects to RECOVERY_REQUIRED until liability truth.'],
  omittedEnvironmentBehavior: ['No literal HALT event, executor fence, ambient scheduler, durable event store, or live mutation executor exists in this finite evidence-batch adapter.'],
  residualAssumptions: ['SYNTHETIC_ONLY and SUPPORTING_EVIDENCE_ONLY; stage is derived rather than a transition guard and runtime_claim_closure is NOT_PERMITTED.'],
});

export const CONFORMANCE_FIXTURES = Object.freeze([M01, M02, M03, M04, M05, M06, M07, M08, M09, M10]);
