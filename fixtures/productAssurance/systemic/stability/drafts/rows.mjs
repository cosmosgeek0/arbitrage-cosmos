/**
 * Machine-readable S8 insertion-request drafts.
 *
 * These rows are packet-local proposal evidence. They are not registered, wired,
 * configured, executable, or authoritative. All production operation IDs,
 * operation classes, commands, owners, paths, and insertion SHAs remain null
 * until the named canonical owner and I00 director confirm them.
 */
import {
  CANCELLATION_LATE_RESULT_LAW,
  REPAIR_LATE_RESULT_LAW,
  REPAIR_RESTART_BEHAVIOR,
  RESOURCE_FAMILIES,
  STABILITY_SCHEMA_VERSION,
  deepFreeze,
} from '../contracts.mjs';

const DRAFT_STATE = 'DRAFT_INSERTION_REQUEST';
const EVIDENCE_STATE = 'SYNTHETIC_ONLY';
const OWNER_CONFIRMATION_REQUIRED = 'OWNER_CONFIRMATION_REQUIRED';
const INSERTION_SHA_STATUS = 'PENDING_PACKET_COMMIT_AND_DIRECTOR_FAN_IN';
const CONFIGURATION_STATE = 'NOT_CONFIGURED';
const CAPABILITY_STATUS = 'SYNTHETIC';
const SUPERSESSION_DISPOSITION = 'PENDING_CANONICAL_OWNER_ADJUDICATION';

const NO_AUTHORITY = deepFreeze({
  mayCloseCircuit: false,
  mayResetCircuit: false,
  mayThrottle: false,
  mayShed: false,
  mayExecute: false,
});

function fanInMetadata({
  canonicalTarget,
  proposedRuntimeOwner,
  ipProofScenarioIds,
}) {
  return {
    schemaVersion: STABILITY_SCHEMA_VERSION,
    draftState: DRAFT_STATE,
    evidenceState: EVIDENCE_STATE,
    canonicalTarget,
    runtimeOwner: null,
    proposedRuntimeOwner,
    runtimeOwnerConfirmationStatus: OWNER_CONFIRMATION_REQUIRED,
    runtimePath: null,
    runtimePathConfirmationStatus: OWNER_CONFIRMATION_REQUIRED,
    insertionSha: null,
    insertionShaStatus: INSERTION_SHA_STATUS,
    ipProofScenarioIds,
    configurationState: CONFIGURATION_STATE,
    capabilityStatus: CAPABILITY_STATUS,
    supersessionDisposition: SUPERSESSION_DISPOSITION,
  };
}

const registryBase = {
  ...fanInMetadata({
    canonicalTarget: 'RELIABILITY_POLICY_REGISTRY.md',
    proposedRuntimeOwner: 'existing canonical Control Plane or operation owner',
    ipProofScenarioIds: [],
  }),
  stableOperationId: null,
  stableOperationIdConfirmationStatus: OWNER_CONFIRMATION_REQUIRED,
  canonicalOwner: null,
  canonicalOwnerConfirmationStatus: OWNER_CONFIRMATION_REQUIRED,
  implementationPath: null,
  implementationPathConfirmationStatus: OWNER_CONFIRMATION_REQUIRED,
  operationClass: null,
  operationClassConfirmationStatus: OWNER_CONFIRMATION_REQUIRED,
  registeredCommandIdentity: null,
  registeredCommandIdentityConfirmationStatus: OWNER_CONFIRMATION_REQUIRED,
  transientPermanentAmbiguousErrors: null,
  maximumAttempts: null,
  backoffAndTotalRetryBudget: null,
  rateBudgetAndCooldown: null,
  idempotencyIdentityAndLifetime: null,
  authoritativeReconciliationLookup: null,
  circuitOpenHalfOpenResetLaw: 'existing owner circuit only; S8 may observe evidence but cannot close or reset it',
  concurrencyBulkheadLimit: null,
  poisonEventQuarantine: null,
  fallbackFailoverEligibility: null,
  degradedBlockedResult: 'UNKNOWN or BLOCKED with exact evidence; never fabricated success',
  durableRestartCheckpoint: null,
  automaticRemediationAllowed: null,
  automaticRemediationConfirmationStatus: OWNER_CONFIRMATION_REQUIRED,
  operatorEscalationControlRunbook: null,
  observability: {
    metric: null,
    trace: null,
    materialEvent: null,
    incident: null,
    cockpitLocation: null,
    confirmationStatus: OWNER_CONFIRMATION_REQUIRED,
  },
  faultTest: 'packet-local deterministic fixture plus IP-PROOF composed insertion request',
  authority: NO_AUTHORITY,
  executionAuthority: 'NONE_IN_IP_ASSURANCE',
};

function registryRow({ draftRowId, ipProofScenarioIds, ...override }) {
  return deepFreeze({
    ...registryBase,
    draftRowId,
    ipProofScenarioIds,
    ...override,
  });
}

export const RELIABILITY_POLICY_REGISTRY_DRAFT_ROWS = deepFreeze([
  registryRow({
    draftRowId: 'draft.s8.bounded-request-tree',
    ipProofScenarioIds: ['AMENDMENT_S10_SCENARIO_09'],
    abstractLaw: 'BOUNDED_CANCELLABLE_REQUEST_TREE',
    deadlineTimeoutLaw: 'effective child deadline is the minimum inherited/local/budget deadline; equality is expired and cannot initiate a new effect',
    lateResultLaw: CANCELLATION_LATE_RESULT_LAW,
    s8ExtensionSchemaId: 'ip-assurance.s8.cancellation-evidence',
    fixtureIds: ['C01_PARENT_CANCEL_STOPS_NEW_LOCAL_EFFECT', 'C02_CHILD_DEADLINE_CANNOT_ESCAPE_PARENT', 'C12_CANCEL_OBSERVED_LOCAL_CHILD_CANNOT_START_EFFECT'],
  }),
  registryRow({
    draftRowId: 'draft.s8.long-lived-lease-heartbeat-fence',
    ipProofScenarioIds: ['AMENDMENT_S10_SCENARIO_04', 'AMENDMENT_S10_SCENARIO_21'],
    abstractLaw: 'LONG_LIVED_LEASE_HEARTBEAT_FENCE',
    deadlineTimeoutLaw: 'no root deadline; current lease, fresh heartbeat, confirmed owner mapping, and matching fence epoch are required; equality at expiry is expired',
    lateResultLaw: CANCELLATION_LATE_RESULT_LAW,
    s8ExtensionSchemaId: 'ip-assurance.s8.cancellation-evidence',
    fixtureIds: ['C07_LONG_LIVED_CONTROLLER_USES_CURRENT_LEASE', 'C08_LEASE_EXPIRY_BOUNDARY_REJECTS_AUTHORITY'],
  }),
  registryRow({
    draftRowId: 'draft.s8.external-mutation-cancel-intent-and-late-truth',
    ipProofScenarioIds: ['AMENDMENT_S10_SCENARIO_05', 'AMENDMENT_S10_SCENARIO_09', 'AMENDMENT_S10_SCENARIO_18', 'AMENDMENT_S10_SCENARIO_21'],
    abstractLaw: 'EXTERNAL_MUTATION_CANCEL_INTENT_AND_LATE_TRUTH',
    deadlineTimeoutLaw: 'request timeout ends local waiting only; it never proves an external mutation absent',
    lateResultLaw: CANCELLATION_LATE_RESULT_LAW,
    authoritativeReconciliationRequirement: 'canonical owner must confirm durable mutation identity and authoritative lookup before fan-in; blind retry remains forbidden',
    s8ExtensionSchemaId: 'ip-assurance.s8.cancellation-evidence',
    fixtureIds: ['C03_EXTERNAL_CANCEL_INTENT_REQUIRES_RECONCILIATION', 'C05_STALE_EPOCH_LATE_FILL_IS_TRUTH_NOT_AUTHORITY', 'C06_STALE_EPOCH_FACT_CANNOT_AUTHORIZE_NEW_WORK', 'C11_RESTART_CANNOT_LOSE_LATE_RESULT_LAW'],
  }),
  registryRow({
    draftRowId: 'draft.s8.automatic-local-repair-control-loop',
    ipProofScenarioIds: ['AMENDMENT_S10_SCENARIO_08', 'AMENDMENT_S10_SCENARIO_19'],
    abstractLaw: 'AUTOMATIC_LOCAL_REPAIR_CONTROL_LOOP',
    deadlineTimeoutLaw: 'canonical owner must bind cadence, horizon, convergence window, attempts, retry time, rate, resource, cost, concurrency, and clock evidence before automation is configured',
    lateResultLaw: REPAIR_LATE_RESULT_LAW,
    restartBehavior: REPAIR_RESTART_BEHAVIOR,
    s8ExtensionSchemaId: 'ip-assurance.s8.repair-policy-extension',
    repairContractMapping: {
      policyId: null,
      operationPolicyId: null,
      operationClass: null,
      registeredCommandIdentity: null,
      canonicalOwner: null,
      implementationPath: null,
      confirmationStatus: OWNER_CONFIRMATION_REQUIRED,
    },
    fixtureContractRef: 'fixtures/productAssurance/systemic/stability/fixtures.mjs#makeRepairPolicy',
    fixtureIds: ['R01_INDEPENDENT_POSTCONDITION_AND_QUIET_PERIOD', 'R04_NO_PROGRESS_TERMINATES_IN_DURABLE_QUARANTINE', 'R06_ALTERNATING_CONTROLLERS_QUARANTINE_AND_ESCALATE', 'R07_MISSING_OBSERVABILITY_MAKES_TERMINATION_UNKNOWN', 'R09_STALE_HANDOFF_COMPLETION_CANNOT_APPLY', 'R10_RESTART_CANNOT_RESET_ATTEMPTS_OR_COST', 'R12_COMPENSATION_FAILURE_ESCALATES_DURABLY'],
  }),
]);

const RESOURCE_SCENARIOS = deepFreeze({
  LLM_TOKENS: ['AMENDMENT_S10_SCENARIO_19'],
  APIS: ['AMENDMENT_S10_SCENARIO_19'],
  BINANCE_RATE_LIMITS: ['AMENDMENT_S10_SCENARIO_19'],
  TELEMETRY_STORAGE: ['AMENDMENT_S10_SCENARIO_10', 'AMENDMENT_S10_SCENARIO_19'],
  REPLAY_COMPUTE: ['AMENDMENT_S10_SCENARIO_19'],
  DATABASE_WAL_GROWTH: ['AMENDMENT_S10_SCENARIO_10', 'AMENDMENT_S10_SCENARIO_19'],
  CLOUD_COST: ['AMENDMENT_S10_SCENARIO_19'],
  BACKGROUND_JOB_CONCURRENCY: ['AMENDMENT_S10_SCENARIO_19'],
});

export const RESOURCE_AND_BACKPRESSURE_REPORT_DRAFT_ROWS = deepFreeze(
  RESOURCE_FAMILIES.map((resourceFamily) => ({
    ...fanInMetadata({
      canonicalTarget: 'RESOURCE_AND_BACKPRESSURE_REPORT.md',
      proposedRuntimeOwner: 'existing canonical resource and Control Plane owners',
      ipProofScenarioIds: RESOURCE_SCENARIOS[resourceFamily],
    }),
    rowId: `draft.resource.${resourceFamily.toLowerCase()}`,
    resourceFamily,
    canonicalOwner: null,
    canonicalOwnerConfirmationStatus: OWNER_CONFIRMATION_REQUIRED,
    requiredEvidence: ['unit and observation window', 'current burn or null plus blocker', 'budget or null plus blocker', 'forecast or null plus blocker', 'top consumers with evidence', 'observed throttling state with evidence or blocker', 'circuit posture, freshness, ordered transitions, and independent-close evidence or exact blocker', 'exact canonical owner action or recommendation', 'material-evidence and safe-risk-reduction protections'],
    cockpitProjection: 'current burn; budget; forecast or UNKNOWN; top consumers; throttling evidence; circuit posture/freshness/independent-close evidence; exact owner action/reference',
    circuitEvidenceDraft: {
      state: 'UNKNOWN',
      canonicalOwner: null,
      ownerFailureDomain: null,
      observedAtMs: null,
      maxAgeMs: null,
      evidenceRef: null,
      openedAtMs: null,
      halfOpenAtMs: null,
      closedAtMs: null,
      resetEligibleAtMs: null,
      independentCloseEvidenceRef: null,
      independentCloseOwner: null,
      independentCloseFailureDomain: null,
      currentBurn: null,
      budget: null,
      forecast: null,
      topConsumers: [],
      throttling: {
        observed: 'UNKNOWN',
        observedAtMs: null,
        maxAgeMs: null,
        evidenceRef: null,
        unknownReason: 'RUNTIME_EVIDENCE_NOT_SUPPLIED_BY_CANONICAL_OWNER',
        canonicalOwner: null,
      },
      canonicalActionOrRecommendation: null,
      unknownReason: 'RUNTIME_EVIDENCE_NOT_SUPPLIED_BY_CANONICAL_OWNER',
      readOnly: true,
    },
    authority: {
      ...NO_AUTHORITY,
      mayDiscardMaterialMoneyEvidence: false,
      mayDiscardAuditEvidence: false,
      mayBlockIndependentlySafeRiskReduction: false,
    },
    controllerOwner: null,
    controllerOwnerConfirmationStatus: OWNER_CONFIRMATION_REQUIRED,
  })),
);

function autonomyRow({
  rowId,
  layer,
  proposedRuntimeOwner,
  ipProofScenarioIds,
  limit,
  failurePosture,
  ownerOverride,
  fixtureIds,
  configurationState = CONFIGURATION_STATE,
}) {
  return deepFreeze({
    ...fanInMetadata({
      canonicalTarget: 'AUTONOMY_CLOSURE_REPORT.md',
      proposedRuntimeOwner,
      ipProofScenarioIds,
    }),
    rowId,
    layer,
    authorityOwner: null,
    authorityOwnerConfirmationStatus: OWNER_CONFIRMATION_REQUIRED,
    limit,
    failurePosture,
    ownerOverride,
    fixtureIds,
    configurationState,
    authority: NO_AUTHORITY,
  });
}

export const AUTONOMY_CLOSURE_REPORT_DRAFT_ROWS = deepFreeze([
  autonomyRow({
    rowId: 'draft.autonomy.reconciliation-after-cancellation-or-timeout',
    layer: 'reconciliation',
    proposedRuntimeOwner: 'existing canonical reconciliation owner',
    ipProofScenarioIds: ['AMENDMENT_S10_SCENARIO_04', 'AMENDMENT_S10_SCENARIO_05', 'AMENDMENT_S10_SCENARIO_09', 'AMENDMENT_S10_SCENARIO_21'],
    limit: 'continues only through a canonical-owner-confirmed registered operation class and fenced recovery context',
    failurePosture: 'UNKNOWN or RECOVERY_REQUIRED with durable ambiguity; never absent-by-cancellation',
    ownerOverride: 'existing owner control/runbook only',
    fixtureIds: ['C03_EXTERNAL_CANCEL_INTENT_REQUIRES_RECONCILIATION', 'C09_REGISTERED_FENCED_RECOVERY_SURVIVES_PARENT_TIMEOUT'],
  }),
  autonomyRow({
    rowId: 'draft.autonomy.repair-loop-stability',
    layer: 'recovery',
    proposedRuntimeOwner: 'I03 canonical Control Plane command registry owner',
    ipProofScenarioIds: ['AMENDMENT_S10_SCENARIO_08', 'AMENDMENT_S10_SCENARIO_19'],
    limit: 'local registered repairs only; bounded attempts/time/rate/resource/cost/concurrency; no money or policy mutation',
    failurePosture: 'quarantine, escalation, or durable unresolved evidence when assumptions hold; otherwise UNKNOWN and unbounded',
    ownerOverride: 'canonical owner approval/control only',
    fixtureIds: ['R04_NO_PROGRESS_TERMINATES_IN_DURABLE_QUARANTINE', 'R07_MISSING_OBSERVABILITY_MAKES_TERMINATION_UNKNOWN'],
  }),
  autonomyRow({
    rowId: 'draft.autonomy.independent-watchdog-on-assumption-loss',
    layer: 'watchdog',
    proposedRuntimeOwner: 'existing independent watchdog owner',
    ipProofScenarioIds: ['AMENDMENT_S10_SCENARIO_11', 'AMENDMENT_S10_SCENARIO_19'],
    limit: 'surface missing store/clock/fence/observability; cannot repair or clear owner circuits from this packet',
    failurePosture: 'UNKNOWN with exact missing assumption',
    ownerOverride: 'owner-gated runbook',
    fixtureIds: ['R07_MISSING_OBSERVABILITY_MAKES_TERMINATION_UNKNOWN', 'R08_MISSING_ASSUMPTION_FORBIDS_NEXT_ACTUATION'],
    configurationState: 'OWNER_GATED',
  }),
  autonomyRow({
    rowId: 'draft.autonomy.restart-preserves-campaign-law',
    layer: 'restart',
    proposedRuntimeOwner: 'I03 lifecycle plus I04 persistence owners',
    ipProofScenarioIds: ['AMENDMENT_S10_SCENARIO_05', 'AMENDMENT_S10_SCENARIO_21'],
    limit: 'same campaign identity, attempts, budgets, cooldown, lease/fence, and late-result law',
    failurePosture: 'BLOCKED or FAILED_ATTENTION_REQUIRED; no budget reset',
    ownerOverride: 'canonical safe restart control only',
    fixtureIds: ['C11_RESTART_CANNOT_LOSE_LATE_RESULT_LAW', 'R10_RESTART_CANNOT_RESET_ATTEMPTS_OR_COST'],
  }),
  autonomyRow({
    rowId: 'draft.autonomy.resource-evidence-only',
    layer: 'operator control',
    proposedRuntimeOwner: 'existing resource and operator-control owners',
    ipProofScenarioIds: ['AMENDMENT_S10_SCENARIO_19'],
    limit: 'S8 shows read-only circuit evidence and exact owner recommendation only',
    failurePosture: 'UNKNOWN or attention-required; material evidence and safe risk reduction remain protected',
    ownerOverride: 'no S8 control exists',
    fixtureIds: ['E04_PACKET_CANNOT_CLAIM_THROTTLE_AUTHORITY', 'E05_MATERIAL_AUDIT_EVIDENCE_CANNOT_SHED', 'E06_SAFE_RISK_REDUCTION_CANNOT_BE_BLOCKED'],
  }),
]);

function insertionRequest({
  requestId,
  proposedOwner,
  targetSeam,
  ipProofScenarioIds,
  reason,
  contract,
  tests,
  expectedBehavior,
}) {
  return deepFreeze({
    ...fanInMetadata({
      canonicalTarget: targetSeam,
      proposedRuntimeOwner: proposedOwner,
      ipProofScenarioIds,
    }),
    requestId,
    owner: null,
    proposedOwner,
    ownerConfirmationStatus: OWNER_CONFIRMATION_REQUIRED,
    targetSeam,
    reason,
    contract,
    tests,
    expectedBehavior,
    authority: NO_AUTHORITY,
  });
}

export const ASSURANCE_INSERTION_REQUEST_DRAFT_ROWS = deepFreeze([
  insertionRequest({
    requestId: 'S8-IR-01',
    proposedOwner: 'IP-ASSURANCE core registry owner',
    targetSeam: 'packet-final RELIABILITY_POLICY_REGISTRY.md generator/input',
    ipProofScenarioIds: ['AMENDMENT_S10_SCENARIO_04', 'AMENDMENT_S10_SCENARIO_05', 'AMENDMENT_S10_SCENARIO_08', 'AMENDMENT_S10_SCENARIO_09', 'AMENDMENT_S10_SCENARIO_19', 'AMENDMENT_S10_SCENARIO_21'],
    reason: 'fold the four S8 abstract law rows without creating a second registry or pre-registering operation details',
    contract: 'canonical owner supplies stable operation IDs, classes, commands, owners, paths, budgets, reconciliation lookups, and observability before insertion',
    tests: 'registry completeness, exact owner-confirmed operation-class mapping, ambiguous-mutation no-blind-retry, no invented cancellation status',
    expectedBehavior: 'owner-generated registry cites accepted rows; this subtree remains source fixture evidence only',
  }),
  insertionRequest({
    requestId: 'S8-IR-02',
    proposedOwner: 'I03 canonical Control Plane and command registry owner',
    targetSeam: 'managed request/campaign lifecycle adapters',
    ipProofScenarioIds: ['AMENDMENT_S10_SCENARIO_04', 'AMENDMENT_S10_SCENARIO_08', 'AMENDMENT_S10_SCENARIO_09', 'AMENDMENT_S10_SCENARIO_21'],
    reason: 'supply inherited deadline/cancel-intent/lease/fence and repair-loop observations to the accepted owner',
    contract: 'no new runtime status; cancellation is intent; stale epoch rejects authority; local effects stop only after cancellation is observed and before commitment',
    tests: 'C01-C12 and R01-R11 adapted to owner-confirmed contracts',
    expectedBehavior: 'canonical owner decides and acts; S8 reference evaluator remains unmounted',
  }),
  insertionRequest({
    requestId: 'S8-IR-03',
    proposedOwner: 'I04 existing ledger/database persistence owner',
    targetSeam: 'campaign/cancellation checkpoint adapter',
    ipProofScenarioIds: ['AMENDMENT_S10_SCENARIO_05', 'AMENDMENT_S10_SCENARIO_09', 'AMENDMENT_S10_SCENARIO_21'],
    reason: 'persist request identity, late-result law, attempts, budgets, cooldown, lease/fence, containment and independent postconditions without a second store',
    contract: 'restart restores exact campaign/request identity and budget consumption; late facts remain durable',
    tests: 'C11 and R10 plus owner crash/restart scenarios',
    expectedBehavior: 'existing ledger/database remains sole persistence authority',
  }),
  insertionRequest({
    requestId: 'S8-IR-04',
    proposedOwner: 'I08 canonical supervisor projection owner',
    targetSeam: 'read-only assurance projection',
    ipProofScenarioIds: ['AMENDMENT_S10_SCENARIO_04', 'AMENDMENT_S10_SCENARIO_08', 'AMENDMENT_S10_SCENARIO_09', 'AMENDMENT_S10_SCENARIO_19', 'AMENDMENT_S10_SCENARIO_21'],
    reason: 'surface deadline, cancel intent, lease/fence, progress/no-progress, oscillation evidence, containment, and assumption loss',
    contract: 'consume owner snapshots; never recompute or actuate; UNKNOWN and SYNTHETIC_ONLY remain visible',
    tests: 'render-neutral view-model truth and no-control tests',
    expectedBehavior: 'one supervisor remains the only runtime read projection',
  }),
  insertionRequest({
    requestId: 'S8-IR-05',
    proposedOwner: 'I00 RESOURCE_AND_BACKPRESSURE_REPORT owner',
    targetSeam: 'final resource/backpressure report evidence rows',
    ipProofScenarioIds: ['AMENDMENT_S10_SCENARIO_10', 'AMENDMENT_S10_SCENARIO_19'],
    reason: 'add the exact eight-family cost/resource denominator and protection law',
    contract: 'burn/budget/forecast/top-consumer/throttling evidence plus owner action; null with blocker for unknown; no close/reset/throttle/execute authority',
    tests: 'E01-E10 plus owner evidence-reference and circuit-authority tests',
    expectedBehavior: 'optional work sheds before protected work; material evidence and safe risk reduction cannot be blocked',
  }),
  insertionRequest({
    requestId: 'S8-IR-06',
    proposedOwner: 'IP-CONTROL cockpit owner',
    targetSeam: 'existing I00 Health/Control/Logs surfaces',
    ipProofScenarioIds: ['AMENDMENT_S10_SCENARIO_08', 'AMENDMENT_S10_SCENARIO_09', 'AMENDMENT_S10_SCENARIO_19'],
    reason: 'render view-model fields without a new dashboard or fake controls',
    contract: 'top-level attention plus drill-down; source labels explicit; controls empty unless separately WIRED_LIVE by canonical owner',
    tests: 'view-model source/UNKNOWN/no-control assertions and later browser acceptance',
    expectedBehavior: 'no state appears healthy solely from producer self-report',
  }),
  insertionRequest({
    requestId: 'S8-IR-07',
    proposedOwner: 'IP-PROOF composed acceptance owner',
    targetSeam: 'I00 deterministic/chaos harness',
    ipProofScenarioIds: ['AMENDMENT_S10_SCENARIO_04', 'AMENDMENT_S10_SCENARIO_05', 'AMENDMENT_S10_SCENARIO_08', 'AMENDMENT_S10_SCENARIO_09', 'AMENDMENT_S10_SCENARIO_18', 'AMENDMENT_S10_SCENARIO_19', 'AMENDMENT_S10_SCENARIO_21'],
    reason: 'prove S8 semantics against composed canonical owners, not packet fixtures alone',
    contract: 'adapt cancellation, stale truth, controller oscillation, lease handoff, restart budget, and resource protection fixtures',
    tests: 'accepted amendment scenarios 4, 5, 8, 9, 18, 19, and 21 where applicable; packet does not claim them passed',
    expectedBehavior: 'only IP-PROOF/I00 may claim composed proof',
  }),
]);
