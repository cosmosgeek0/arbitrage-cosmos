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
  volumeTypes: 'server/src/liveEdge/adapters/volumeLifecycle/types.ts@sha256:44268936146d03334d7e813490357649a0e264ebe1c3832d3215eacba5cf30de',
  volumeLifecycle: 'server/src/liveEdge/adapters/volumeLifecycle/lifecycle.ts@sha256:703f49ed69b4b729e9d2130bcdfd500759611840cf8564bd3363a53b45543a0d',
  exchangeTwinTypes: 'server/src/liveEdge/adapters/exchangeTwin/types.ts@sha256:c3bf70a72a5d87d6899e0cc21a7dcd106842e6de57002c8fcbd08decdea097f9',
  exchangeTwin: 'server/src/liveEdge/adapters/exchangeTwin/twin.ts@sha256:4084c2bb579a6b8e31cc3335ea5239aecb0c4d02069be149c16cf041ad6d726d',
  controlTypes: 'server/src/liveEdge/controls/types.ts@sha256:2896d2f40c55bbb464454121df0c79567c67ea8e9b0537e91cd017835a666373',
  controlAdapter: 'server/src/liveEdge/controls/adapter.ts@sha256:a80417934958059395fb22bf706867f0e386837faa13fc83a36402dea5bf1654',
  controlIntegrity: 'server/src/liveEdge/controls/integrity.ts@sha256:ee7c10923ca1c40dda6e9f306f70586cf78e5143932516d6c539c2c9bc1bd73d',
  controlValidation: 'server/src/liveEdge/controls/validation.ts@sha256:b128e5299af7fdc0506accec751ffb1884aeddb5dd657b0892963f45b951e9de',
  controlSyntheticPersistence: 'server/test/liveEdge/controls/fixtures.mjs@sha256:1dfedf361082414e3f77252cd50de06173278dff8309f820eed7b36dcd3a7023',
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
  l11StateAndAuthority: 'server/src/liveEdge/adapters/volumeLifecycle/types.ts#L9-L16',
  l11Planning: 'server/src/liveEdge/adapters/volumeLifecycle/lifecycle.ts#L1824-L2122',
  l11TwinSettlement: 'server/src/liveEdge/adapters/volumeLifecycle/lifecycle.ts#L1270-L1821',
  l11Reducer: 'server/src/liveEdge/adapters/volumeLifecycle/lifecycle.ts#L2397-L2820',
  l12Ordering: 'server/src/liveEdge/adapters/exchangeTwin/twin.ts#L555-L684',
  l12Reducer: 'server/src/liveEdge/adapters/exchangeTwin/twin.ts#L1138-L2538',
  l12State: 'server/src/liveEdge/adapters/exchangeTwin/types.ts#L342-L430',
  l13Types: 'server/src/liveEdge/controls/types.ts#CanonicalControlPersistencePort',
  l13GuardsAndPublish: 'server/src/liveEdge/controls/adapter.ts#DurableControlCommandAdapter.submit',
  l13Integrity: 'server/src/liveEdge/controls/integrity.ts#prepareControlEventAppend',
  l13Validation: 'server/src/liveEdge/controls/validation.ts#validateControlPlaneSnapshot',
  l13SyntheticReservation: 'server/test/liveEdge/controls/fixtures.mjs#createHarness().deps.persistence.append',
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

const M11 = fixture({
  mappingId: 'S3-CONFORMANCE-M11',
  modelId: 'S3-M11-VOLUME-LIFECYCLE',
  implementationReleaseSha: FROZEN_L_IMPLEMENTATION_RELEASE_SHA,
  schemaVersions: [FROZEN_L_VERSION.volumeTypes],
  commandVersions: [FROZEN_L_VERSION.volumeLifecycle],
  storageVersions: ['FINITE_EVENT_BATCH_NO_RUNTIME_STORE'],
  mappings: freezeRows([
    {
      mappingId: 'S3-M11-MAP-STATE', category: 'STATE', modelElementId: 'ABSENT|PROBE|CONFIRM|ADD_ALLOWED|HOLD|REDUCE|EXIT|RECOVERY_REQUIRED',
      implementationOwner: 'liveEdge.adapters.volumeLifecycle', implementationPath: 'server/src/liveEdge/adapters/volumeLifecycle/types.ts', implementationSymbol: 'VolumeLifecycleState and VolumeLifecycleProjection',
      durableRecord: 'Immutable lifecycle projection and bounded history supplied by the caller', postcondition: null,
      atomicity: 'MANY_TO_ONE', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l11StateAndAuthority, CONFORMANCE_EVIDENCE_REFS.l11Reducer],
    },
    {
      mappingId: 'S3-M11-MAP-INCREASE', category: 'ACTION', modelElementId: 'PLAN_RECORD_ONLY_ENTRY_OR_ADD',
      implementationOwner: 'liveEdge.adapters.volumeLifecycle', implementationPath: 'server/src/liveEdge/adapters/volumeLifecycle/lifecycle.ts', implementationSymbol: 'evaluateVolumeLifecycle, entryGateReasons, planIncreasingStage, and actionRequest',
      durableRecord: 'Deterministic pending-action projection; no owner send', postcondition: null,
      atomicity: 'ONE_TO_MANY', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l11Planning, CONFORMANCE_EVIDENCE_REFS.l11Reducer],
    },
    {
      mappingId: 'S3-M11-MAP-PROTECT', category: 'ACTION', modelElementId: 'CLASSIFY_PROTECTION_AND_PLAN_REDUCE_OR_EXIT',
      implementationOwner: 'liveEdge.adapters.volumeLifecycle', implementationPath: 'server/src/liveEdge/adapters/volumeLifecycle/lifecycle.ts', implementationSymbol: 'exitTriggers and planRiskReduction',
      durableRecord: 'Record-only protective action projection', postcondition: null,
      atomicity: 'ONE_TO_MANY', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l11Planning],
    },
    {
      mappingId: 'S3-M11-MAP-TWIN', category: 'ACTION', modelElementId: 'SETTLE_TWIN_OR_ENTER_RECOVERY',
      implementationOwner: 'liveEdge.adapters.volumeLifecycle', implementationPath: 'server/src/liveEdge/adapters/volumeLifecycle/lifecycle.ts', implementationSymbol: 'twinSettlement, settleTwin, settledTwinReplayMatches, and recovery',
      durableRecord: 'Bound twin evidence retained in immutable lifecycle projection', postcondition: null,
      atomicity: 'ONE_TO_MANY', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l11TwinSettlement, CONFORMANCE_EVIDENCE_REFS.l11Reducer],
    },
    {
      mappingId: 'S3-M11-MAP-RECOVERY', category: 'ACTION', modelElementId: 'RESOLVE_VOLUME_RECOVERY',
      implementationOwner: 'liveEdge.adapters.volumeLifecycle', implementationPath: 'server/src/liveEdge/adapters/volumeLifecycle/lifecycle.ts', implementationSymbol: 'evaluateVolumeLifecycle recoveryReady branch and recovery',
      durableRecord: 'Immutable recovery projection; no runtime worker', postcondition: null,
      atomicity: 'ONE_TO_MANY', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l11Reducer, CONFORMANCE_EVIDENCE_REFS.l11TwinSettlement],
    },
    {
      mappingId: 'S3-M11-MAP-INVARIANT', category: 'INVARIANT', modelElementId: 'S3-SAF-06|S3-SAF-08|S3-SAF-11|S3-SAF-12|S3-SAF-13|S3-SAF-14|S3-M11-INV-01',
      implementationOwner: 'liveEdge.adapters.volumeLifecycle', implementationPath: 'server/src/liveEdge/adapters/volumeLifecycle/lifecycle.ts', implementationSymbol: 'entryGateReasons, planRiskReduction, twinSettlement, settleTwin, and recovery',
      durableRecord: 'Immutable lifecycle projection and bound evidence revisions', postcondition: 'Halt blocks ENTRY/ADD, protective EXIT remains non-sendable, active UNKNOWN truth enters recovery, a failed flat gate returns BLOCKED with no projection, and pending twin evidence cannot be locally replaced.',
      atomicity: 'ONE_TO_MANY', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l11Planning, CONFORMANCE_EVIDENCE_REFS.l11TwinSettlement, CONFORMANCE_EVIDENCE_REFS.l11Reducer],
    },
    {
      mappingId: 'S3-M11-MAP-POST', category: 'POSTCONDITION', modelElementId: 'FLAT_BLOCKED_ABSENT|SETTLED_STAGE|PROTECTIVE_EXIT|VISIBLE_RECOVERY',
      implementationOwner: 'liveEdge.adapters.volumeLifecycle', implementationPath: 'server/src/liveEdge/adapters/volumeLifecycle/lifecycle.ts', implementationSymbol: 'evaluateVolumeLifecycle, terminalDecision, and settleTwin',
      durableRecord: 'Immutable record-only lifecycle decision', postcondition: 'Only exact bound twin evidence changes quantity; ambiguity remains RECOVERY_REQUIRED and every action retains sendEligible false.',
      atomicity: 'MANY_TO_ONE', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l11TwinSettlement, CONFORMANCE_EVIDENCE_REFS.l11Reducer],
    },
  ]),
  omittedEnvironmentBehavior: ['No sender, cancel action, executor lease, borrow liability, durable store, or runtime recovery scheduler exists in the Volume adapter; evaluateVolumeProtectionRevision is outside this lifecycle-transition envelope.'],
  residualAssumptions: ['SYNTHETIC_ONLY record-only decisions; halt may plan protective EXIT but never ENTRY/ADD, and runtime_claim_closure is NOT_PERMITTED.'],
});

const M12 = fixture({
  mappingId: 'S3-CONFORMANCE-M12',
  modelId: 'S3-M12-EXCHANGE-TWIN-AMBIGUITY',
  implementationReleaseSha: FROZEN_L_IMPLEMENTATION_RELEASE_SHA,
  schemaVersions: [FROZEN_L_VERSION.exchangeTwinTypes],
  commandVersions: [FROZEN_L_VERSION.exchangeTwin],
  storageVersions: ['CALLER_OWNED_TWIN_CHECKPOINT'],
  mappings: freezeRows([
    {
      mappingId: 'S3-M12-MAP-STATE', category: 'STATE', modelElementId: 'TWIN_ORDER_CANCEL_CRASH_AND_RECONCILIATION',
      implementationOwner: 'liveEdge.adapters.exchangeTwin', implementationPath: 'server/src/liveEdge/adapters/exchangeTwin/types.ts', implementationSymbol: 'TwinOrderState and TwinScenarioState',
      durableRecord: 'Caller-owned serialized exchange-twin checkpoint', postcondition: null,
      atomicity: 'MANY_TO_ONE', status: 'MAPPED', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l12State, CONFORMANCE_EVIDENCE_REFS.l12Reducer],
    },
    {
      mappingId: 'S3-M12-MAP-PLACE', category: 'ACTION', modelElementId: 'PREFLIGHT_AND_SINGLE_PLACEMENT',
      implementationOwner: 'liveEdge.adapters.exchangeTwin', implementationPath: 'server/src/liveEdge/adapters/exchangeTwin/twin.ts', implementationSymbol: 'reduceCanonical PLACE_DISPATCH and VENUE_ARRIVAL branches; executeAggressive',
      durableRecord: 'Immutable TwinScenarioState projection', postcondition: null,
      atomicity: 'ONE_TO_MANY', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l12Reducer],
    },
    {
      mappingId: 'S3-M12-MAP-RACE', category: 'ACTION', modelElementId: 'TRADE_CANCEL_RACE_AND_DELIVERY',
      implementationOwner: 'liveEdge.adapters.exchangeTwin', implementationPath: 'server/src/liveEdge/adapters/exchangeTwin/twin.ts', implementationSymbol: 'reduceCanonical TRADE_EVIDENCE, CANCEL_DISPATCH, CANCEL_ARRIVAL, and CANCEL_DELIVERY branches',
      durableRecord: 'Immutable TwinOrderState event projection', postcondition: null,
      atomicity: 'ONE_TO_MANY', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l12Ordering, CONFORMANCE_EVIDENCE_REFS.l12Reducer],
    },
    {
      mappingId: 'S3-M12-MAP-RESTORE', category: 'ACTION', modelElementId: 'CRASH_AND_RESTORE_CHECKPOINT',
      implementationOwner: 'liveEdge.adapters.exchangeTwin', implementationPath: 'server/src/liveEdge/adapters/exchangeTwin/twin.ts', implementationSymbol: 'reduceCanonical CRASH and RESTART branches; checkpointExchangeTwin and restoreExchangeTwin',
      durableRecord: 'Caller-owned serialized exchange-twin checkpoint', postcondition: null,
      atomicity: 'ONE_TO_MANY', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l12Reducer],
    },
    {
      mappingId: 'S3-M12-MAP-RECONCILE', category: 'ACTION', modelElementId: 'APPLY_EXACT_OR_VISIBLE_UNRESOLVED_RECONCILIATION',
      implementationOwner: 'liveEdge.adapters.exchangeTwin', implementationPath: 'server/src/liveEdge/adapters/exchangeTwin/twin.ts', implementationSymbol: 'reduceCanonical RECONCILIATION_OBSERVATION branch and validateCommittedState',
      durableRecord: 'Injected reconciliation observation retained in TwinScenarioState', postcondition: null,
      atomicity: 'ONE_TO_MANY', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l12Ordering, CONFORMANCE_EVIDENCE_REFS.l12Reducer],
    },
    {
      mappingId: 'S3-M12-MAP-INVARIANT', category: 'INVARIANT', modelElementId: 'S3-SAF-03|S3-SAF-05|S3-SAF-06|S3-SAF-11|S3-SAF-13|S3-SAF-14|S3-M12-INV-01|S3-M12-INV-02',
      implementationOwner: 'liveEdge.adapters.exchangeTwin', implementationPath: 'server/src/liveEdge/adapters/exchangeTwin/twin.ts', implementationSymbol: 'eventOrderingDomains, sourceOrderIsProved, validateCommittedState, reduceCanonical, checkpointExchangeTwin, and restoreExchangeTwin',
      durableRecord: 'Immutable twin state and caller-owned checkpoint', postcondition: 'Unproved equal-time races allocate no fill; cancel ACK cannot erase fill; UNKNOWN cannot become OBSERVED; exact reconciliation alone clears recovery.',
      atomicity: 'ONE_TO_MANY', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l12Ordering, CONFORMANCE_EVIDENCE_REFS.l12Reducer],
    },
    {
      mappingId: 'S3-M12-MAP-POST', category: 'POSTCONDITION', modelElementId: 'OBSERVED_EXACT_OR_RECOVERY_REQUIRED',
      implementationOwner: 'liveEdge.adapters.exchangeTwin', implementationPath: 'server/src/liveEdge/adapters/exchangeTwin/twin.ts', implementationSymbol: 'validateCommittedState and runExchangeTwinScenario',
      durableRecord: 'Immutable TwinScenarioState projection', postcondition: 'OBSERVED is twin-local synthetic truth only; mismatch or ambiguity remains RECOVERY_REQUIRED.',
      atomicity: 'MANY_TO_ONE', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l12Ordering, CONFORMANCE_EVIDENCE_REFS.l12Reducer],
    },
  ]),
  omittedEnvironmentBehavior: ['Injected reconciliation performs no owner query; caller persistence atomicity, runtime retry scheduling, execution leases, and capital authority are absent.'],
  residualAssumptions: ['SYNTHETIC_ONLY twin-local OBSERVED is not canonical Foundation truth; identity uniqueness is not fencing and runtime_claim_closure is NOT_PERMITTED.'],
});

const M13 = fixture({
  mappingId: 'S3-CONFORMANCE-M13',
  modelId: 'S3-M13-DURABLE-CONTROL-REVISION',
  implementationReleaseSha: FROZEN_L_IMPLEMENTATION_RELEASE_SHA,
  schemaVersions: [FROZEN_L_VERSION.controlTypes, FROZEN_L_VERSION.controlValidation],
  commandVersions: [FROZEN_L_VERSION.controlAdapter, FROZEN_L_VERSION.controlIntegrity],
  storageVersions: [FROZEN_L_VERSION.controlSyntheticPersistence],
  mappings: freezeRows([
    {
      mappingId: 'S3-M13-MAP-STATE', category: 'STATE', modelElementId: 'CONTROL_PREVIEW_JOURNAL_REVISION_PUBLICATION_AND_REPLAY',
      implementationOwner: 'liveEdge.controls', implementationPath: 'server/src/liveEdge/controls/types.ts', implementationSymbol: 'ControlPlaneSnapshot, ControlCommandLookup, and CanonicalControlPersistencePort',
      durableRecord: 'PENDING/terminal command journal contract with global controlRevision', postcondition: null,
      atomicity: 'MANY_TO_ONE', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l13Types, CONFORMANCE_EVIDENCE_REFS.l13SyntheticReservation],
    },
    {
      mappingId: 'S3-M13-MAP-PREVIEW', category: 'ACTION', modelElementId: 'PREVIEW_AND_CANONICAL_GUARDS',
      implementationOwner: 'liveEdge.controls', implementationPath: 'server/src/liveEdge/controls/adapter.ts', implementationSymbol: 'DurableControlCommandAdapter.preview, DurableControlCommandAdapter.submit, riskIncreasingByNature, recoveryBlocked, and recheckRisk',
      durableRecord: 'Preview digest and bound canonical snapshot revisions', postcondition: null,
      atomicity: 'ONE_TO_MANY', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l13GuardsAndPublish, CONFORMANCE_EVIDENCE_REFS.l13Validation],
    },
    {
      mappingId: 'S3-M13-MAP-RESERVE', category: 'ACTION', modelElementId: 'APPEND_INTENT_AND_RESERVE_GLOBAL_REVISION',
      implementationOwner: 'liveEdge.controls contract + synthetic harness', implementationPath: 'server/test/liveEdge/controls/fixtures.mjs', implementationSymbol: 'createHarness().deps.persistence.append CONTROL_INTENT_COMMITTED and VERSION_CONFLICT branches',
      durableRecord: 'Synthetic append reserves expectedControlRevision plus one', postcondition: null,
      atomicity: 'ONE_TO_MANY', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l13Integrity, CONFORMANCE_EVIDENCE_REFS.l13SyntheticReservation, CONFORMANCE_EVIDENCE_REFS.l13Types],
    },
    {
      mappingId: 'S3-M13-MAP-INTEGRITY', category: 'ACTION', modelElementId: 'PREPARE_AND_CONFIRM_CONTROL_EVENT_APPEND',
      implementationOwner: 'liveEdge.controls', implementationPath: 'server/src/liveEdge/controls/integrity.ts', implementationSymbol: 'prepareControlEventAppend and confirmControlEventAppend',
      durableRecord: 'Hash-linked append request and acknowledgement validation', postcondition: null,
      atomicity: 'ONE_TO_MANY', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l13Integrity],
    },
    {
      mappingId: 'S3-M13-MAP-PUBLISH', category: 'ACTION', modelElementId: 'PUBLISH_RESERVED_COMMAND',
      implementationOwner: 'liveEdge.controls', implementationPath: 'server/src/liveEdge/controls/adapter.ts', implementationSymbol: 'publish, lifecycleCommand, and DurableControlCommandAdapter.submit',
      durableRecord: 'Committed intent must precede injected owner publication', postcondition: null,
      atomicity: 'ONE_TO_MANY', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l13GuardsAndPublish, CONFORMANCE_EVIDENCE_REFS.l13Integrity],
    },
    {
      mappingId: 'S3-M13-MAP-FINALIZE', category: 'ACTION', modelElementId: 'FINALIZE_OR_RETAIN_PENDING_AMBIGUITY',
      implementationOwner: 'liveEdge.controls', implementationPath: 'server/src/liveEdge/controls/adapter.ts', implementationSymbol: 'finalizeRejected, publish failure branches, post-publication expiry branch, and outcome append handling',
      durableRecord: 'Journal version one remains PENDING on ambiguous post-intent outcome', postcondition: null,
      atomicity: 'ONE_TO_MANY', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l13GuardsAndPublish, CONFORMANCE_EVIDENCE_REFS.l13Integrity],
    },
    {
      mappingId: 'S3-M13-MAP-REPLAY', category: 'ACTION', modelElementId: 'RELOAD_AND_REPLAY_DURABLE_RESULT',
      implementationOwner: 'liveEdge.controls', implementationPath: 'server/src/liveEdge/controls/adapter.ts', implementationSymbol: 'lookup and replayResult',
      durableRecord: 'Exact command lookup and bound terminal/PENDING receipt', postcondition: null,
      atomicity: 'ONE_TO_ONE', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l13GuardsAndPublish, CONFORMANCE_EVIDENCE_REFS.l13Types],
    },
    {
      mappingId: 'S3-M13-MAP-INVARIANT', category: 'INVARIANT', modelElementId: 'S3-SAF-01|S3-SAF-04|S3-SAF-08|S3-SAF-11|S3-SAF-12|S3-SAF-13|S3-M13-INV-01|S3-M13-INV-02|S3-M13-INV-03',
      implementationOwner: 'liveEdge.controls contract + synthetic harness', implementationPath: 'server/src/liveEdge/controls/adapter.ts', implementationSymbol: 'DurableControlCommandAdapter.submit, publish, replayResult, and finalizeRejected',
      durableRecord: 'Command journal plus globally reserved controlRevision', postcondition: 'One revision admits one command; publication follows intent; halt/repair/UNKNOWN block risk-increasing publication while safe controls remain admissible; terminal replay never republishes.',
      atomicity: 'ONE_TO_MANY', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l13GuardsAndPublish, CONFORMANCE_EVIDENCE_REFS.l13Integrity, CONFORMANCE_EVIDENCE_REFS.l13SyntheticReservation],
    },
    {
      mappingId: 'S3-M13-MAP-POST', category: 'POSTCONDITION', modelElementId: 'COMPLETED|REJECTED|PREINTENT_REJECTED|WAITING_L08|PENDING_AMBIGUOUS',
      implementationOwner: 'liveEdge.controls', implementationPath: 'server/src/liveEdge/controls/adapter.ts', implementationSymbol: 'DurableControlCommandAdapter.submit, auditRejection, replayResult, and finalizeRejected',
      durableRecord: 'Bound command journal receipt', postcondition: 'Known outcome may complete or reject; pre-intent failure uses auditRejection without reserving the command journal; WAITING_L08 never publishes; post-intent uncertainty stays PENDING.',
      atomicity: 'MANY_TO_ONE', status: 'PARTIAL', evidenceRefs: [CONFORMANCE_EVIDENCE_REFS.l13GuardsAndPublish, CONFORMANCE_EVIDENCE_REFS.l13Integrity],
    },
  ]),
  mismatches: ['Atomic global control-revision reservation is implemented only by the synthetic test harness; the production CanonicalControlPersistencePort is unwired to canonical Ledger/System Integration persistence.'],
  omittedEnvironmentBehavior: ['No canonical persistence adapter, runtime restart orchestration, L08 action dispatch, or externally authorized money action is wired.'],
  residualAssumptions: ['L14 is BUILT_AND_TESTED_UNWIRED; persistenceProven is false, all outputs retain externalActionAuthorization NONE, and runtime_claim_closure is NOT_PERMITTED.'],
});

export const CONFORMANCE_FIXTURES = Object.freeze([
  M01, M02, M03, M04, M05, M06, M07, M08, M09, M10, M11, M12, M13,
]);
