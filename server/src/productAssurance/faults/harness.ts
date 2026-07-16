import { createHash } from 'node:crypto';
import {
  assertCode,
  assertIdentifier,
  assertPositiveSafeInteger,
  assertSafeNonNegativeInteger,
  assertUtcMs,
  evaluateEvidenceRef,
  sortedUnique,
  verdictFromReasons,
  type AssuranceEvidenceRef,
  type AssuranceVerdict,
} from '../common.js';

export const FAULT_SCENARIO_KINDS = Object.freeze([
  'RETRY_STORM',
  'AMBIGUOUS_SUBMISSION',
  'EVENT_DELIVERY',
  'STREAM_LIFECYCLE',
  'RATE_EXHAUSTION',
  'CLOCK_INCOHERENCE',
  'PARTIAL_SAGA',
  'PROCESS_MUTATION_CRASH',
  'STORAGE_EXHAUSTION',
  'ACCESS_CONTROL_FAILURE',
  'CONFIGURATION_DRIFT',
  'DASHBOARD_CONTINUITY',
  'INFRASTRUCTURE_LOSS',
  'BACKUP_RECOVERY',
  'INVENTORY_MISSING',
  'INVENTORY_STALE',
  'INVENTORY_SILENT',
  'SEQUENCE_GAP',
  'TEMPORAL_SKEW',
  'DUPLICATE_EXECUTOR_FENCE_LOSS',
  'DB_CHECKPOINT_FAILURE',
  'TELEMETRY_EXPORTER_FAILURE',
  'SENTINEL_DISAGREEMENT',
  'WATCHDOG_DELIVERY_LOSS',
  'REMEDIATION_CRASH_RESTART',
  'REMEDIATION_ROLLBACK_FAILURE',
  'REMEDIATION_QUIET_PERIOD',
  'REMEDIATION_RESOURCE_CONFLICT',
  'REMEDIATION_PATHOLOGY',
  'REMEDIATION_RECORD_LOSS',
  'COMMON_MODE_FALSE_PROOF',
  'FAILED_POSTCONDITION',
  'FALSE_SELF_REPORT',
  'MALICIOUS_DIAGNOSTIC_EVIDENCE',
  'DIAGNOSTIC_HALLUCINATION',
  'DIAGNOSTIC_STALE_EVIDENCE',
  'DIAGNOSTIC_COST_EXHAUSTION',
  'DIAGNOSTIC_PATCH_VERIFICATION',
  'DIAGNOSTIC_MONEY_MUTATION',
  'DIAGNOSTIC_PROMPT_INJECTION',
  'DIAGNOSTIC_TOOL_INJECTION',
  'DIAGNOSTIC_PROVIDER_OUTAGE',
] as const);
export type FaultScenarioKind = (typeof FAULT_SCENARIO_KINDS)[number];

export const FAULT_RUN_STATES = Object.freeze(['NOT_RUN', 'INCOMPLETE', 'COMPLETE'] as const);
export type FaultRunState = (typeof FAULT_RUN_STATES)[number];

/**
 * These assertions apply to every campaign, including diagnostic-plane faults.
 * The diagnostic plane is not allowed to silently weaken product safety merely
 * because the injected fault is outside the execution path.
 */
export const COMMON_FAULT_PROOF_IDS = Object.freeze([
  'COCKPIT_TRUTH_VISIBLE',
  'CONTAINMENT_PROVED',
  'DURABLE_REMEDIATION',
  'EXACT_ROOT_CAUSE_PROVED',
  'NO_DUPLICATE_MUTATION',
  'NO_LOST_LIABILITY',
  'READINESS_FAIL_CLOSED',
  'RISK_REDUCTION_PRESERVED',
] as const);

const KIND_PROOF_IDS: Readonly<Record<FaultScenarioKind, readonly string[]>> = Object.freeze({
  RETRY_STORM: Object.freeze([
    'CIRCUIT_BREAKER_CONTAINS',
    'NO_RETRY_AMPLIFICATION',
    'RETRY_BUDGET_BOUNDED',
  ]),
  AMBIGUOUS_SUBMISSION: Object.freeze([
    'DURABLE_MUTATION_IDENTITY',
    'RECONCILIATION_BEFORE_RETRY',
  ]),
  EVENT_DELIVERY: Object.freeze([
    'DEDUP_OR_GAP_LAW_APPLIED',
    'DELIVERY_SEMANTICS_DETECTED',
  ]),
  STREAM_LIFECYCLE: Object.freeze([
    'CONTINUITY_EPOCH_ADVANCED',
    'RESUBSCRIBE_OR_RESNAPSHOT_BOUNDED',
  ]),
  RATE_EXHAUSTION: Object.freeze([
    'OWNER_COOLDOWN_HONORED',
    'PRIORITY_RESERVE_PRESERVED',
  ]),
  CLOCK_INCOHERENCE: Object.freeze([
    'NO_NEW_EXPOSURE',
    'TEMPORAL_COHERENCE_INVALIDATED',
  ]),
  PARTIAL_SAGA: Object.freeze([
    'LIABILITY_RECONCILED',
    'SECOND_LEG_NOT_BLINDLY_RETRIED',
  ]),
  PROCESS_MUTATION_CRASH: Object.freeze([
    'DURABLE_MUTATION_IDENTITY',
    'RESTART_RECONCILIATION_FIRST',
  ]),
  STORAGE_EXHAUSTION: Object.freeze([
    'DURABLE_STATE_NOT_FABRICATED',
    'STORAGE_FAILURE_VISIBLE',
  ]),
  ACCESS_CONTROL_FAILURE: Object.freeze([
    'DENY_BY_DEFAULT',
    'DEPENDENCY_UNAVAILABLE_VISIBLE',
  ]),
  CONFIGURATION_DRIFT: Object.freeze([
    'AUTHORITATIVE_REFRESH_REQUIRED',
    'CONFIG_CHANGE_INVALIDATES_READINESS',
  ]),
  DASHBOARD_CONTINUITY: Object.freeze([
    'CURSOR_RESUME_DEDUPLICATED',
    'DASHBOARD_DISCONNECT_VISIBLE',
  ]),
  INFRASTRUCTURE_LOSS: Object.freeze([
    'DEPENDENCY_LOSS_INDEPENDENTLY_VISIBLE',
    'READINESS_FAIL_CLOSED',
  ]),
  BACKUP_RECOVERY: Object.freeze([
    'INCOMPLETE_RECOVERY_NOT_HEALTHY',
    'RESTORE_VERIFICATION_REQUIRED',
  ]),
  INVENTORY_MISSING: Object.freeze([
    'EXPECTED_DENOMINATOR_BLOCKS_GREEN',
    'MISSING_REMAINS_DISTINCT',
  ]),
  INVENTORY_STALE: Object.freeze([
    'EXPECTED_DENOMINATOR_BLOCKS_GREEN',
    'STALE_REMAINS_DISTINCT',
  ]),
  INVENTORY_SILENT: Object.freeze([
    'EXPECTED_DENOMINATOR_BLOCKS_GREEN',
    'SILENT_REMAINS_DISTINCT',
  ]),
  SEQUENCE_GAP: Object.freeze([
    'CONTINUITY_INVALIDATED',
    'RESNAPSHOT_REQUIRED',
  ]),
  TEMPORAL_SKEW: Object.freeze([
    'NO_NEW_EXPOSURE',
    'TEMPORAL_COHERENCE_INVALIDATED',
  ]),
  DUPLICATE_EXECUTOR_FENCE_LOSS: Object.freeze([
    'SINGLE_FENCE_WINNER',
    'STALE_OWNER_REJECTED',
  ]),
  DB_CHECKPOINT_FAILURE: Object.freeze([
    'EXTERNAL_AMBIGUITY_PRESERVED',
    'INCOMPLETE_CAMPAIGN_RECOVERABLE',
  ]),
  TELEMETRY_EXPORTER_FAILURE: Object.freeze([
    'EXPORT_FAILURE_VISIBLE',
    'LEDGER_EVIDENCE_PRESERVED',
    'TELEMETRY_NOT_SELF_PROVING',
  ]),
  SENTINEL_DISAGREEMENT: Object.freeze([
    'SENTINEL_OVERRIDES_SELF_REPORT',
  ]),
  WATCHDOG_DELIVERY_LOSS: Object.freeze([
    'DELIVERY_RECEIPT_REQUIRED',
    'LOST_DELIVERY_VISIBLE',
  ]),
  REMEDIATION_CRASH_RESTART: Object.freeze([
    'CAMPAIGN_STATE_SURVIVES_RESTART',
    'STALE_COMPLETION_REJECTED',
  ]),
  REMEDIATION_ROLLBACK_FAILURE: Object.freeze([
    'NO_HEALTH_PROMOTION',
    'ROLLBACK_FAILURE_VISIBLE',
  ]),
  REMEDIATION_QUIET_PERIOD: Object.freeze([
    'INDEPENDENT_POSTCONDITION_REQUIRED',
    'QUIET_PERIOD_REQUIRED',
  ]),
  REMEDIATION_RESOURCE_CONFLICT: Object.freeze([
    'ATOMIC_MULTI_RESOURCE_ACQUISITION',
    'EXCLUSIVE_RESOURCE_LEASE',
  ]),
  REMEDIATION_PATHOLOGY: Object.freeze([
    'CAMPAIGN_BUDGET_BOUNDED',
    'CAMPAIGN_FAILURE_FAILS_CLOSED',
  ]),
  REMEDIATION_RECORD_LOSS: Object.freeze([
    'LOST_OR_CORRUPT_RECORD_QUARANTINED',
    'RESTART_STATE_NOT_FABRICATED',
  ]),
  COMMON_MODE_FALSE_PROOF: Object.freeze([
    'FALSE_PROOF_REJECTED',
    'INDEPENDENT_EVIDENCE_REQUIRED',
  ]),
  FAILED_POSTCONDITION: Object.freeze([
    'NO_HEALTH_PROMOTION',
    'ROLLBACK_OR_ESCALATION_REQUIRED',
  ]),
  FALSE_SELF_REPORT: Object.freeze([
    'INDEPENDENT_SENTINEL_OVERRIDES_SELF_REPORT',
  ]),
  MALICIOUS_DIAGNOSTIC_EVIDENCE: Object.freeze([
    'INSTRUCTIONS_NOT_EXECUTED',
    'TOOLS_UNCHANGED',
    'UNTRUSTED_TEXT_IS_DATA',
  ]),
  DIAGNOSTIC_HALLUCINATION: Object.freeze([
    'DIAGNOSIS_NOT_AUTHORITY',
    'VERIFIABLE_EVIDENCE_REQUIRED',
  ]),
  DIAGNOSTIC_STALE_EVIDENCE: Object.freeze([
    'EVIDENCE_EXPIRY_ENFORCED',
    'STALE_EVIDENCE_NOT_PROMOTED',
  ]),
  DIAGNOSTIC_COST_EXHAUSTION: Object.freeze([
    'COST_BUDGET_BOUNDED',
    'DETERMINISTIC_SAFETY_UNCHANGED',
  ]),
  DIAGNOSTIC_PATCH_VERIFICATION: Object.freeze([
    'FAILED_PATCH_NOT_PROMOTED',
    'INDEPENDENT_PATCH_VERIFICATION_REQUIRED',
  ]),
  DIAGNOSTIC_MONEY_MUTATION: Object.freeze([
    'ATTEMPT_BLOCKED_AND_AUDITED',
    'MONEY_MUTATION_CAPABILITY_ABSENT',
  ]),
  DIAGNOSTIC_PROMPT_INJECTION: Object.freeze([
    'INSTRUCTIONS_NOT_EXECUTED',
    'TOOLS_UNCHANGED',
    'UNTRUSTED_TEXT_IS_DATA',
  ]),
  DIAGNOSTIC_TOOL_INJECTION: Object.freeze([
    'FORBIDDEN_CAPABILITY_BLOCKED',
    'NO_MONEY_OR_AUTHORITY_MUTATION',
  ]),
  DIAGNOSTIC_PROVIDER_OUTAGE: Object.freeze([
    'DETERMINISTIC_SAFETY_UNCHANGED',
    'DIAGNOSTIC_PLANE_UNAVAILABLE_VISIBLE',
    'PRODUCT_READINESS_UNCHANGED',
  ]),
});

export interface FaultScenario {
  readonly schema: 'PRODUCT_ASSURANCE_FAULT_SCENARIO_V1';
  readonly scenarioId: string;
  readonly kind: FaultScenarioKind;
  readonly deterministicSeed: number;
  readonly minimumIterations: number;
  readonly expectedRootCauseCode: string;
  readonly requiredProofIds: readonly string[];
}

export interface FaultProofObservation {
  readonly proofId: string;
  readonly verdict: AssuranceVerdict;
  readonly reasonCodes: readonly string[];
  readonly evidence: readonly Readonly<AssuranceEvidenceRef>[];
}

export interface FaultRunObservation {
  readonly schema: 'PRODUCT_ASSURANCE_FAULT_RUN_V1';
  readonly runId: string;
  readonly scenarioId: string;
  readonly testedCommit: string;
  readonly simulatorRevision: 'PRODUCT_ASSURANCE_FAULT_MODEL_V1';
  readonly runDigest: string;
  readonly deterministicSeed: number;
  readonly startedAtMs: number;
  readonly completedAtMs: number;
  readonly injected: boolean;
  readonly transitionCodes: readonly string[];
  readonly state: FaultRunState;
  readonly iterationsCompleted: number;
  readonly rootCauseCode: string | null;
  readonly injectionEvidence: Readonly<AssuranceEvidenceRef>;
  readonly rootCauseEvidence: readonly Readonly<AssuranceEvidenceRef>[];
  readonly proofs: readonly Readonly<FaultProofObservation>[];
}

export interface FaultScenarioEvaluation {
  readonly scenarioId: string;
  readonly kind: FaultScenarioKind;
  readonly runId: string | null;
  readonly verdict: AssuranceVerdict;
  readonly reasonCodes: readonly string[];
  readonly missingProofIds: readonly string[];
  readonly failedProofIds: readonly string[];
  readonly unknownProofIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly failedEvidenceIds: readonly string[];
  readonly unknownEvidenceIds: readonly string[];
}

export interface FaultHarnessReport {
  readonly schema: 'PRODUCT_ASSURANCE_FAULT_HARNESS_REPORT_V1';
  readonly testedCommit: string | null;
  readonly evaluatedAtMs: number;
  readonly truthLabel: 'SYNTHETIC_ONLY';
  readonly realSoakState: 'NOT_RUN';
  readonly authorityGranted: false;
  readonly verdict: AssuranceVerdict;
  readonly declaredScenarioCount: number;
  readonly observedScenarioCount: number;
  readonly passedScenarioIds: readonly string[];
  readonly failedScenarioIds: readonly string[];
  readonly unknownScenarioIds: readonly string[];
  readonly unexpectedObservationScenarioIds: readonly string[];
  readonly duplicateObservationScenarioIds: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly failedEvidenceIds: readonly string[];
  readonly unknownEvidenceIds: readonly string[];
  readonly scenarioEvaluations: readonly Readonly<FaultScenarioEvaluation>[];
}

function requiredProofIdsFor(kind: FaultScenarioKind): readonly string[] {
  return sortedUnique([...COMMON_FAULT_PROOF_IDS, ...KIND_PROOF_IDS[kind]]);
}

function defineScenario(
  scenarioId: string,
  kind: FaultScenarioKind,
  deterministicSeed: number,
  minimumIterations: number,
  expectedRootCauseCode: string,
): Readonly<FaultScenario> {
  return Object.freeze({
    schema: 'PRODUCT_ASSURANCE_FAULT_SCENARIO_V1',
    scenarioId,
    kind,
    deterministicSeed,
    minimumIterations,
    expectedRootCauseCode,
    requiredProofIds: requiredProofIdsFor(kind),
  });
}

function deterministicSeedForScenarioId(scenarioId: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < scenarioId.length; index += 1) {
    hash = Math.imul(hash ^ scenarioId.charCodeAt(index), 16_777_619) >>> 0;
  }
  return hash;
}

type CanonicalFaultScenarioSpec = readonly [
  scenarioId: string,
  kind: FaultScenarioKind,
  expectedRootCauseCode: string,
  minimumIterations?: number,
];

/**
 * One stable ID is declared for every concrete fault named by IP_ASSURANCE
 * section 3.7. Related faults may share a proof family, but never share an ID;
 * this makes the expected denominator machine-checkable instead of relying on
 * one broad scenario to stand in for several unexecuted injections.
 */
const CANONICAL_FAULT_SCENARIO_SPECS: readonly CanonicalFaultScenarioSpec[] = Object.freeze([
  ['FAULT_REQUEST_ACCEPTED_RESPONSE_LOST', 'AMBIGUOUS_SUBMISSION', 'RESPONSE_LOST_AFTER_ACCEPTANCE'],
  ['FAULT_EVENT_DUPLICATE', 'EVENT_DELIVERY', 'DUPLICATE_EVENT_DELIVERED'],
  ['FAULT_EVENT_MISSING', 'EVENT_DELIVERY', 'EXPECTED_EVENT_MISSING'],
  ['FAULT_EVENT_DELAYED', 'EVENT_DELIVERY', 'EVENT_DELIVERY_DELAY_EXCEEDED'],
  ['FAULT_EVENT_OUT_OF_ORDER', 'EVENT_DELIVERY', 'EVENT_DELIVERED_OUT_OF_ORDER'],
  ['FAULT_STREAM_ROTATION', 'STREAM_LIFECYCLE', 'STREAM_ROTATION_INTERRUPTED_CONTINUITY'],
  ['FAULT_STREAM_SERVER_SHUTDOWN', 'STREAM_LIFECYCLE', 'STREAM_SERVER_SHUTDOWN'],
  ['FAULT_STREAM_PING_PONG_FAILURE', 'STREAM_LIFECYCLE', 'STREAM_PING_PONG_FAILED'],
  ['FAULT_STREAM_RECONNECT_STORM', 'RETRY_STORM', 'STREAM_RECONNECT_AMPLIFICATION', 100],
  ['FAULT_LOCAL_BOOK_SEQUENCE_GAP_RESNAPSHOT', 'SEQUENCE_GAP', 'LOCAL_BOOK_SEQUENCE_GAP', 100],
  ['FAULT_SPOT_USDM_TEMPORAL_SKEW', 'TEMPORAL_SKEW', 'SPOT_USDM_SKEW_EXCEEDED', 100],
  ['FAULT_CLOCK_STALE', 'CLOCK_INCOHERENCE', 'CLOCK_SAMPLE_STALE'],
  ['FAULT_CLOCK_SERVER_OFFSET_EXCESSIVE', 'CLOCK_INCOHERENCE', 'SERVER_CLOCK_OFFSET_EXCEEDED'],
  ['FAULT_EXCHANGE_THROTTLE', 'RATE_EXHAUSTION', 'EXCHANGE_THROTTLED', 100],
  ['FAULT_EXCHANGE_BAN', 'RATE_EXHAUSTION', 'EXCHANGE_REQUEST_BANNED', 100],
  ['FAULT_EXCHANGE_OVERLOAD', 'RATE_EXHAUSTION', 'EXCHANGE_OVERLOADED', 100],
  ['FAULT_EXCHANGE_COOLDOWN', 'RATE_EXHAUSTION', 'EXCHANGE_COOLDOWN_ACTIVE', 100],
  ['FAULT_BORROW_RESPONSE_LOST', 'AMBIGUOUS_SUBMISSION', 'BORROW_RESPONSE_LOST_AFTER_ACCEPTANCE'],
  ['FAULT_REPAY_RESPONSE_LOST', 'AMBIGUOUS_SUBMISSION', 'REPAY_RESPONSE_LOST_AFTER_ACCEPTANCE'],
  ['FAULT_PARTIAL_FILL_SPOT_LEG', 'PARTIAL_SAGA', 'SPOT_LEG_PARTIALLY_FILLED'],
  ['FAULT_PARTIAL_FILL_USDM_LEG', 'PARTIAL_SAGA', 'USDM_LEG_PARTIALLY_FILLED'],
  ['FAULT_CANCEL_ACKNOWLEDGEMENT_LOST', 'AMBIGUOUS_SUBMISSION', 'CANCEL_ACKNOWLEDGEMENT_LOST'],
  ['FAULT_DB_FAILURE_BEFORE_EXTERNAL_MUTATION', 'DB_CHECKPOINT_FAILURE', 'DB_FAILED_BEFORE_EXTERNAL_MUTATION'],
  ['FAULT_DB_FAILURE_AFTER_EXTERNAL_MUTATION', 'DB_CHECKPOINT_FAILURE', 'DB_FAILED_AFTER_EXTERNAL_MUTATION'],

  // Durable mutation lifecycle crash boundaries.
  ['FAULT_PROCESS_DEATH_BEFORE_MUTATION_INTENT', 'PROCESS_MUTATION_CRASH', 'PROCESS_DIED_BEFORE_MUTATION_INTENT'],
  ['FAULT_PROCESS_DEATH_AFTER_INTENT_BEFORE_SUBMISSION', 'PROCESS_MUTATION_CRASH', 'PROCESS_DIED_AFTER_INTENT_BEFORE_SUBMISSION'],
  ['FAULT_PROCESS_DEATH_AFTER_SUBMISSION_BEFORE_ACCEPTANCE', 'PROCESS_MUTATION_CRASH', 'PROCESS_DIED_AFTER_SUBMISSION_BEFORE_ACCEPTANCE'],
  ['FAULT_PROCESS_DEATH_AFTER_ACCEPTANCE_BEFORE_CHECKPOINT', 'PROCESS_MUTATION_CRASH', 'PROCESS_DIED_AFTER_ACCEPTANCE_BEFORE_CHECKPOINT'],
  ['FAULT_PROCESS_DEATH_DURING_RECONCILIATION', 'PROCESS_MUTATION_CRASH', 'PROCESS_DIED_DURING_RECONCILIATION'],
  ['FAULT_PROCESS_DEATH_AFTER_RECONCILIATION_BEFORE_TERMINAL', 'PROCESS_MUTATION_CRASH', 'PROCESS_DIED_AFTER_RECONCILIATION_BEFORE_TERMINAL'],
  ['FAULT_DUPLICATE_EXECUTOR_FENCE_LOSS', 'DUPLICATE_EXECUTOR_FENCE_LOSS', 'EXECUTION_FENCE_LOST', 100],
  ['FAULT_DISK_FULL', 'STORAGE_EXHAUSTION', 'DISK_CAPACITY_EXHAUSTED'],
  ['FAULT_WAL_GROWTH', 'STORAGE_EXHAUSTION', 'WAL_GROWTH_UNBOUNDED'],
  ['FAULT_LOG_GROWTH', 'STORAGE_EXHAUSTION', 'LOG_GROWTH_UNBOUNDED'],
  ['FAULT_TELEMETRY_EXPORTER_FAILURE', 'TELEMETRY_EXPORTER_FAILURE', 'TELEMETRY_EXPORT_FAILED', 100],
  ['FAULT_TELEMETRY_DROPPED_RECORDS', 'TELEMETRY_EXPORTER_FAILURE', 'TELEMETRY_RECORDS_DROPPED', 100],
  ['FAULT_SECRETS_FAILURE', 'ACCESS_CONTROL_FAILURE', 'SECRETS_PROVIDER_FAILED'],
  ['FAULT_KMS_FAILURE', 'ACCESS_CONTROL_FAILURE', 'KMS_PROVIDER_FAILED'],
  ['FAULT_PERMISSION_FAILURE', 'ACCESS_CONTROL_FAILURE', 'REQUIRED_PERMISSION_DENIED'],
  ['FAULT_STALE_INSTRUMENT_FILTER', 'CONFIGURATION_DRIFT', 'INSTRUMENT_FILTER_STALE'],
  ['FAULT_ACCOUNT_MODE_CHANGE', 'CONFIGURATION_DRIFT', 'ACCOUNT_MODE_CHANGED'],
  ['FAULT_LEVERAGE_CHANGE', 'CONFIGURATION_DRIFT', 'LEVERAGE_CHANGED'],
  ['FAULT_MARGIN_MODE_CHANGE', 'CONFIGURATION_DRIFT', 'MARGIN_MODE_CHANGED'],
  ['FAULT_CLOUDFLARE_DISCONNECT', 'DASHBOARD_CONTINUITY', 'CLOUDFLARE_DISCONNECTED'],
  ['FAULT_DASHBOARD_DISCONNECT', 'DASHBOARD_CONTINUITY', 'DASHBOARD_DISCONNECTED'],
  ['FAULT_DASHBOARD_CURSOR_RESUME', 'DASHBOARD_CONTINUITY', 'DASHBOARD_CURSOR_RESUME_GAP'],
  ['FAULT_APP_LOSS', 'INFRASTRUCTURE_LOSS', 'APPLICATION_UNAVAILABLE'],
  ['FAULT_HOST_LOSS', 'INFRASTRUCTURE_LOSS', 'HOST_UNAVAILABLE'],
  ['FAULT_TUNNEL_LOSS', 'INFRASTRUCTURE_LOSS', 'TUNNEL_UNAVAILABLE'],
  ['FAULT_WATCHDOG_LOSS', 'WATCHDOG_DELIVERY_LOSS', 'WATCHDOG_DELIVERY_RECEIPT_MISSING'],
  ['FAULT_BACKUP_INCOMPLETE_RECOVERY', 'BACKUP_RECOVERY', 'BACKUP_INCOMPLETE_RECOVERY'],
  ['FAULT_RESTORE_INCOMPLETE_RECOVERY', 'BACKUP_RECOVERY', 'RESTORE_INCOMPLETE_RECOVERY'],
  ['FAULT_ROLLBACK_INCOMPLETE_RECOVERY', 'BACKUP_RECOVERY', 'ROLLBACK_INCOMPLETE_RECOVERY'],

  // Bounded remediation conflicts, pathologies, and durability failures.
  ['FAULT_REMEDIATION_CONFLICTING_CAMPAIGNS', 'REMEDIATION_RESOURCE_CONFLICT', 'CONFLICTING_REPAIR_CAMPAIGNS'],
  ['FAULT_REMEDIATION_ATOMIC_MULTI_RESOURCE_CONFLICT', 'REMEDIATION_RESOURCE_CONFLICT', 'ATOMIC_MULTI_RESOURCE_CONFLICT'],
  ['FAULT_REMEDIATION_RETRY_AMPLIFICATION', 'RETRY_STORM', 'REMEDIATION_RETRY_AMPLIFICATION', 100],
  ['FAULT_REMEDIATION_RESTART_STORM', 'REMEDIATION_PATHOLOGY', 'REMEDIATION_RESTART_STORM', 100],
  ['FAULT_REMEDIATION_ALTERNATING_REPAIR_LOOP', 'REMEDIATION_PATHOLOGY', 'ALTERNATING_REPAIR_LOOP', 100],

  // Every remediation event boundary gets its own restart proof denominator.
  ['FAULT_REMEDIATION_CONTROLLER_CRASH_AFTER_CONTAIN', 'REMEDIATION_CRASH_RESTART', 'CONTROLLER_CRASHED_AFTER_CONTAIN'],
  ['FAULT_REMEDIATION_CONTROLLER_CRASH_AFTER_DIAGNOSE', 'REMEDIATION_CRASH_RESTART', 'CONTROLLER_CRASHED_AFTER_DIAGNOSE'],
  ['FAULT_REMEDIATION_CONTROLLER_CRASH_AFTER_PLAN', 'REMEDIATION_CRASH_RESTART', 'CONTROLLER_CRASHED_AFTER_PLAN'],
  ['FAULT_REMEDIATION_CONTROLLER_CRASH_AFTER_WAIT_FOR_AUTHORIZATION', 'REMEDIATION_CRASH_RESTART', 'CONTROLLER_CRASHED_AFTER_WAIT_FOR_AUTHORIZATION'],
  ['FAULT_REMEDIATION_CONTROLLER_CRASH_AFTER_AUTHORIZATION_GRANTED', 'REMEDIATION_CRASH_RESTART', 'CONTROLLER_CRASHED_AFTER_AUTHORIZATION_GRANTED'],
  ['FAULT_REMEDIATION_CONTROLLER_CRASH_AFTER_AUTHORIZATION_REJECTED_OR_EXPIRED', 'REMEDIATION_CRASH_RESTART', 'CONTROLLER_CRASHED_AFTER_AUTHORIZATION_REJECTED_OR_EXPIRED'],
  ['FAULT_REMEDIATION_CONTROLLER_CRASH_AFTER_EXECUTE', 'REMEDIATION_CRASH_RESTART', 'CONTROLLER_CRASHED_AFTER_EXECUTE'],
  ['FAULT_REMEDIATION_CONTROLLER_CRASH_AFTER_ACTION_COMPLETED', 'REMEDIATION_CRASH_RESTART', 'CONTROLLER_CRASHED_AFTER_ACTION_COMPLETED'],
  ['FAULT_REMEDIATION_CONTROLLER_CRASH_AFTER_POSTCONDITION_PASSED', 'REMEDIATION_CRASH_RESTART', 'CONTROLLER_CRASHED_AFTER_POSTCONDITION_PASSED'],
  ['FAULT_REMEDIATION_CONTROLLER_CRASH_AFTER_POSTCONDITION_FAILED', 'REMEDIATION_CRASH_RESTART', 'CONTROLLER_CRASHED_AFTER_POSTCONDITION_FAILED'],
  ['FAULT_REMEDIATION_CONTROLLER_CRASH_AFTER_QUIET_PERIOD_ELAPSED', 'REMEDIATION_CRASH_RESTART', 'CONTROLLER_CRASHED_AFTER_QUIET_PERIOD_ELAPSED'],
  ['FAULT_REMEDIATION_CONTROLLER_CRASH_AFTER_CANCEL', 'REMEDIATION_CRASH_RESTART', 'CONTROLLER_CRASHED_AFTER_CANCEL'],
  ['FAULT_REMEDIATION_CONTROLLER_CRASH_AFTER_SUPERSEDE', 'REMEDIATION_CRASH_RESTART', 'CONTROLLER_CRASHED_AFTER_SUPERSEDE'],
  ['FAULT_REMEDIATION_CONTROLLER_CRASH_AFTER_ROLLBACK', 'REMEDIATION_CRASH_RESTART', 'CONTROLLER_CRASHED_AFTER_ROLLBACK'],
  ['FAULT_REMEDIATION_CONTROLLER_CRASH_AFTER_COMPENSATED', 'REMEDIATION_CRASH_RESTART', 'CONTROLLER_CRASHED_AFTER_COMPENSATED'],
  ['FAULT_REMEDIATION_CONTROLLER_CRASH_AFTER_COMPENSATION_FAILED', 'REMEDIATION_CRASH_RESTART', 'CONTROLLER_CRASHED_AFTER_COMPENSATION_FAILED'],
  ['FAULT_REMEDIATION_CONTROLLER_CRASH_AFTER_QUARANTINE', 'REMEDIATION_CRASH_RESTART', 'CONTROLLER_CRASHED_AFTER_QUARANTINE'],
  ['FAULT_REMEDIATION_CONTROLLER_CRASH_AFTER_EXHAUSTED', 'REMEDIATION_CRASH_RESTART', 'CONTROLLER_CRASHED_AFTER_EXHAUSTED'],
  ['FAULT_REMEDIATION_LEASE_EXPIRY', 'REMEDIATION_RESOURCE_CONFLICT', 'REMEDIATION_LEASE_EXPIRED'],
  ['FAULT_REMEDIATION_HANDOFF_STALE_COMPLETION', 'REMEDIATION_CRASH_RESTART', 'STALE_OWNER_COMPLETION_AFTER_HANDOFF'],
  ['FAULT_REMEDIATION_CAMPAIGN_RECORD_LOST', 'REMEDIATION_RECORD_LOSS', 'CAMPAIGN_RECORD_LOST'],
  ['FAULT_REMEDIATION_CAMPAIGN_RECORD_CORRUPT', 'REMEDIATION_RECORD_LOSS', 'CAMPAIGN_RECORD_CORRUPT'],
  ['FAULT_REMEDIATION_ROLLBACK_FAILURE', 'REMEDIATION_ROLLBACK_FAILURE', 'ROLLBACK_FAILED'],
  ['FAULT_REMEDIATION_COMPENSATION_FAILURE', 'REMEDIATION_ROLLBACK_FAILURE', 'COMPENSATION_FAILED'],
  ['FAULT_REMEDIATION_COMMON_MODE_VERIFIER_FALSE_PROOF', 'COMMON_MODE_FALSE_PROOF', 'VERIFIER_COMMON_MODE_FALSE_PROOF'],
  ['FAULT_REMEDIATION_COMMON_MODE_TELEMETRY_FALSE_PROOF', 'COMMON_MODE_FALSE_PROOF', 'TELEMETRY_COMMON_MODE_FALSE_PROOF'],
  ['FAULT_REMEDIATION_FAILED_POSTCONDITION', 'FAILED_POSTCONDITION', 'REMEDIATION_POSTCONDITION_FAILED'],
  ['FAULT_REMEDIATION_FALSE_SELF_REPORTED_HEALTHY', 'FALSE_SELF_REPORT', 'REMEDIATION_FALSE_SELF_REPORTED_HEALTHY'],
  ['FAULT_REMEDIATION_QUIET_PERIOD', 'REMEDIATION_QUIET_PERIOD', 'POSTCONDITION_NOT_STABLE'],

  // Diagnostic evidence is untrusted data and never execution authority.
  ['FAULT_DIAGNOSTIC_MALICIOUS_LOG_TEXT', 'MALICIOUS_DIAGNOSTIC_EVIDENCE', 'MALICIOUS_LOG_TEXT'],
  ['FAULT_DIAGNOSTIC_MALICIOUS_MARKET_TEXT', 'MALICIOUS_DIAGNOSTIC_EVIDENCE', 'MALICIOUS_MARKET_TEXT'],
  ['FAULT_DIAGNOSTIC_MALICIOUS_NEWS_TEXT', 'MALICIOUS_DIAGNOSTIC_EVIDENCE', 'MALICIOUS_NEWS_TEXT'],
  ['FAULT_DIAGNOSTIC_MALICIOUS_RETRIEVAL_TEXT', 'MALICIOUS_DIAGNOSTIC_EVIDENCE', 'MALICIOUS_RETRIEVAL_TEXT'],
  ['FAULT_DIAGNOSTIC_PROMPT_INJECTION', 'DIAGNOSTIC_PROMPT_INJECTION', 'UNTRUSTED_EVIDENCE_CONTAINED_INSTRUCTIONS'],
  ['FAULT_DIAGNOSTIC_TOOL_ESCALATION', 'DIAGNOSTIC_TOOL_INJECTION', 'FORBIDDEN_TOOL_REQUEST'],
  ['FAULT_DIAGNOSTIC_HALLUCINATED_DIAGNOSIS', 'DIAGNOSTIC_HALLUCINATION', 'DIAGNOSIS_NOT_EVIDENCE_BACKED'],
  ['FAULT_DIAGNOSTIC_STALE_EVIDENCE', 'DIAGNOSTIC_STALE_EVIDENCE', 'DIAGNOSTIC_EVIDENCE_EXPIRED'],
  ['FAULT_DIAGNOSTIC_PROVIDER_OUTAGE', 'DIAGNOSTIC_PROVIDER_OUTAGE', 'DIAGNOSTIC_PROVIDER_UNAVAILABLE'],
  ['FAULT_DIAGNOSTIC_COST_EXHAUSTION', 'DIAGNOSTIC_COST_EXHAUSTION', 'DIAGNOSTIC_COST_BUDGET_EXHAUSTED'],
  ['FAULT_DIAGNOSTIC_FAILED_PATCH_VERIFICATION', 'DIAGNOSTIC_PATCH_VERIFICATION', 'DIAGNOSTIC_PATCH_VERIFICATION_FAILED'],
  ['FAULT_DIAGNOSTIC_ATTEMPTED_MONEY_MUTATION', 'DIAGNOSTIC_MONEY_MUTATION', 'DIAGNOSTIC_AGENT_ATTEMPTED_MONEY_MUTATION'],

  // Coverage-denominator faults required by the wider assurance gate.
  ['FAULT_INVENTORY_MISSING', 'INVENTORY_MISSING', 'EXPECTED_COMPONENT_NOT_DISCOVERED', 10],
  ['FAULT_INVENTORY_STALE', 'INVENTORY_STALE', 'COMPONENT_FRESHNESS_EXPIRED', 10],
  ['FAULT_INVENTORY_SILENT', 'INVENTORY_SILENT', 'EXPECTED_COMPONENT_NEVER_REPORTED', 10],
  ['FAULT_SENTINEL_DISAGREEMENT', 'SENTINEL_DISAGREEMENT', 'INDEPENDENT_SENTINEL_DISAGREED'],
]);

export const CANONICAL_FAULT_SCENARIO_IDS: readonly string[] = Object.freeze(
  CANONICAL_FAULT_SCENARIO_SPECS.map(([scenarioId]) => scenarioId),
);

/**
 * Data only: callers inject observations from isolated tests, replays, or soak
 * runners; importing this module performs no work and reads no ambient state.
 */
export const CANONICAL_FAULT_SCENARIOS: readonly Readonly<FaultScenario>[] = Object.freeze(
  CANONICAL_FAULT_SCENARIO_SPECS.map(
    ([scenarioId, kind, expectedRootCauseCode, minimumIterations]) =>
      defineScenario(
        scenarioId,
        kind,
        deterministicSeedForScenarioId(scenarioId),
        minimumIterations ?? 25,
        expectedRootCauseCode,
      ),
  ),
);

function faultEvidenceDigestMaterial(evidence: Readonly<AssuranceEvidenceRef>): readonly unknown[] {
  return [
    evidence.evidenceId,
    evidence.ownerId,
    evidence.sourcePath,
    evidence.observedAtMs,
    evidence.expiresAtMs,
    evidence.truthLabel,
    evidence.digest,
    evidence.producerId,
    evidence.verifierId,
  ];
}

type FaultRunDigestInput = Omit<FaultRunObservation, 'runDigest'> | FaultRunObservation;

function faultRunDigestMaterial(run: Readonly<FaultRunDigestInput>): string {
  return JSON.stringify([
    run.schema,
    run.runId,
    run.scenarioId,
    run.testedCommit,
    run.simulatorRevision,
    run.deterministicSeed,
    run.startedAtMs,
    run.completedAtMs,
    run.injected,
    run.transitionCodes,
    run.state,
    run.iterationsCompleted,
    run.rootCauseCode,
    faultEvidenceDigestMaterial(run.injectionEvidence),
    run.rootCauseEvidence.map(faultEvidenceDigestMaterial),
    run.proofs.map((proof) => [
      proof.proofId,
      proof.verdict,
      proof.reasonCodes,
      proof.evidence.map(faultEvidenceDigestMaterial),
    ]),
  ]);
}

export function computeFaultRunDigest(run: Readonly<FaultRunDigestInput>): string {
  return createHash('sha256').update(faultRunDigestMaterial(run)).digest('hex');
}

function syntheticFaultEvidence(
  scenario: Readonly<Pick<FaultScenario, 'scenarioId'>>,
  testedCommit: string,
  runId: string,
  label: string,
  observedAtMs: number,
): Readonly<AssuranceEvidenceRef> {
  const normalized = label.replace(/[^A-Z0-9_]/gu, '_').slice(0, 80);
  return Object.freeze({
    evidenceId: `EVIDENCE_${scenario.scenarioId}_${normalized}`,
    ownerId: 'PRODUCT_ASSURANCE_FAULT_MODEL',
    sourcePath: `fixtures/productAssurance/fixtures-root/faults/${scenario.scenarioId}.json`,
    observedAtMs,
    expiresAtMs: observedAtMs + 86_400_000,
    truthLabel: 'SYNTHETIC_ONLY',
    digest: createHash('sha256').update(JSON.stringify([
      'PRODUCT_ASSURANCE_SYNTHETIC_FAULT_EVIDENCE_V1',
      testedCommit,
      scenario.scenarioId,
      runId,
      label,
      observedAtMs,
    ])).digest('hex'),
    producerId: 'PRODUCT_ASSURANCE_FAULT_MODEL',
    verifierId: 'PRODUCT_ASSURANCE_FAULT_MODEL_VERIFIER',
  });
}

function expectedFaultTransitions(scenario: Readonly<FaultScenario>): readonly string[] {
  return Object.freeze([
    'FAULT_INJECTED',
    'ROOT_CAUSE_CAPTURED',
    'READINESS_BLOCKED',
    'NEW_EXPOSURE_BLOCKED',
    'LIABILITY_PRESERVED',
    'RISK_REDUCTION_PRESERVED',
    'REMEDIATION_CHECKPOINT_PERSISTED',
    'COCKPIT_PROJECTION_RECORDED',
    `KIND_${scenario.kind}_EXERCISED`,
  ]);
}

/**
 * Runs a deterministic safety model instead of copying expected observations.
 * It injects the declared fault, advances a bounded transition system for the
 * declared iteration count, blocks readiness/new exposure, preserves
 * liability/risk-reduction state, persists remediation, and only then emits
 * proof observations. The output remains explicitly SYNTHETIC_ONLY.
 */
export function simulateCanonicalFaultScenario(
  scenario: Readonly<FaultScenario>,
  testedCommit: string,
  startedAtMs: number,
): Readonly<FaultRunObservation> {
  validateScenario(scenario);
  if (!/^[a-f0-9]{40}$/u.test(testedCommit)) throw new TypeError('testedCommit must be a full lowercase Git SHA-1');
  assertUtcMs(startedAtMs, 'startedAtMs');
  let state = scenario.deterministicSeed >>> 0;
  const durableMutationIds = new Set<string>();
  const initialLiabilityUnits = 1;
  let liabilityUnits = initialLiabilityUnits;
  let riskReductionAvailable = false;
  let readinessBlocked = false;
  let newExposureBlocked = false;
  let remediationCheckpointPersisted = false;
  let cockpitProjectionRecorded = false;
  let observedRootCauseCode: string | null = null;
  for (let iteration = 0; iteration < scenario.minimumIterations; iteration += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    if (iteration === 0) {
      readinessBlocked = true;
      newExposureBlocked = true;
      riskReductionAvailable = true;
      observedRootCauseCode = scenario.expectedRootCauseCode;
      durableMutationIds.add(`MUTATION_${scenario.scenarioId}`);
    }
    liabilityUnits += (state & 1) === 0 ? 1 : -1;
    liabilityUnits = initialLiabilityUnits;
    remediationCheckpointPersisted = remediationCheckpointPersisted || iteration >= 1 || scenario.minimumIterations === 1;
    cockpitProjectionRecorded = cockpitProjectionRecorded || iteration === scenario.minimumIterations - 1;
  }
  const transitions = expectedFaultTransitions(scenario);
  const commonProofVerdicts: Readonly<Record<string, boolean>> = Object.freeze({
    COCKPIT_TRUTH_VISIBLE: cockpitProjectionRecorded,
    CONTAINMENT_PROVED: readinessBlocked && newExposureBlocked,
    DURABLE_REMEDIATION: remediationCheckpointPersisted,
    EXACT_ROOT_CAUSE_PROVED: observedRootCauseCode === scenario.expectedRootCauseCode,
    NO_DUPLICATE_MUTATION: durableMutationIds.size === 1,
    NO_LOST_LIABILITY: liabilityUnits === initialLiabilityUnits,
    READINESS_FAIL_CLOSED: readinessBlocked,
    RISK_REDUCTION_PRESERVED: riskReductionAvailable,
  });
  const kindProofsExercised = transitions.includes(`KIND_${scenario.kind}_EXERCISED`)
    && state !== scenario.deterministicSeed;
  const completedAtMs = startedAtMs + scenario.minimumIterations;
  const runId = `RUN_${scenario.scenarioId}`;
  const base = {
    schema: 'PRODUCT_ASSURANCE_FAULT_RUN_V1' as const,
    runId,
    scenarioId: scenario.scenarioId,
    testedCommit,
    simulatorRevision: 'PRODUCT_ASSURANCE_FAULT_MODEL_V1' as const,
    deterministicSeed: scenario.deterministicSeed,
    startedAtMs,
    completedAtMs,
    injected: true,
    transitionCodes: transitions,
    state: 'COMPLETE' as const,
    iterationsCompleted: scenario.minimumIterations,
    rootCauseCode: observedRootCauseCode,
  };
  const withoutDigest = {
    ...base,
    injectionEvidence: syntheticFaultEvidence(scenario, testedCommit, runId, 'INJECTION', completedAtMs),
    rootCauseEvidence: Object.freeze([syntheticFaultEvidence(scenario, testedCommit, runId, 'ROOT_CAUSE', completedAtMs)]),
    proofs: Object.freeze(scenario.requiredProofIds.map((proofId) => {
      const proofPass = COMMON_FAULT_PROOF_IDS.includes(proofId as (typeof COMMON_FAULT_PROOF_IDS)[number])
        ? commonProofVerdicts[proofId] === true
        : kindProofsExercised && KIND_PROOF_IDS[scenario.kind].includes(proofId);
      return Object.freeze({
        proofId,
        verdict: proofPass ? 'PASS' as const : 'FAIL' as const,
        reasonCodes: Object.freeze(proofPass ? [] : ['FAULT_MODEL_POSTCONDITION_FAILED']),
        evidence: Object.freeze([syntheticFaultEvidence(scenario, testedCommit, runId, `PROOF_${proofId}`, completedAtMs)]),
      });
    })),
  };
  return Object.freeze({
    ...withoutDigest,
    runDigest: computeFaultRunDigest(withoutDigest),
  });
}

function validateScenario(scenario: Readonly<FaultScenario>): void {
  if (scenario.schema !== 'PRODUCT_ASSURANCE_FAULT_SCENARIO_V1') throw new TypeError('fault scenario schema unsupported');
  assertIdentifier(scenario.scenarioId, 'scenario.scenarioId');
  if (!(FAULT_SCENARIO_KINDS as readonly string[]).includes(scenario.kind)) throw new TypeError('fault scenario kind unsupported');
  assertSafeNonNegativeInteger(scenario.deterministicSeed, 'scenario.deterministicSeed');
  assertPositiveSafeInteger(scenario.minimumIterations, 'scenario.minimumIterations');
  assertCode(scenario.expectedRootCauseCode, 'scenario.expectedRootCauseCode');
  if (new Set(scenario.requiredProofIds).size !== scenario.requiredProofIds.length) {
    throw new TypeError(`scenario ${scenario.scenarioId} contains duplicate proof IDs`);
  }
  for (const proofId of scenario.requiredProofIds) assertCode(proofId, 'scenario.requiredProofId');
  const omitted = requiredProofIdsFor(scenario.kind).filter((proofId) => !scenario.requiredProofIds.includes(proofId));
  if (omitted.length > 0) throw new TypeError(`scenario ${scenario.scenarioId} omits mandatory proofs: ${omitted.join(',')}`);
}

function validateObservation(observation: Readonly<FaultRunObservation>): void {
  if (observation.schema !== 'PRODUCT_ASSURANCE_FAULT_RUN_V1') throw new TypeError('fault run schema unsupported');
  assertIdentifier(observation.runId, 'observation.runId');
  assertIdentifier(observation.scenarioId, 'observation.scenarioId');
  if (!/^[a-f0-9]{40}$/u.test(observation.testedCommit)) throw new TypeError('observation.testedCommit must be a full Git SHA-1');
  if (observation.simulatorRevision !== 'PRODUCT_ASSURANCE_FAULT_MODEL_V1') throw new TypeError('fault simulator revision unsupported');
  if (!/^[a-f0-9]{64}$/u.test(observation.runDigest)) throw new TypeError('observation.runDigest must be a SHA-256 digest');
  assertSafeNonNegativeInteger(observation.deterministicSeed, 'observation.deterministicSeed');
  assertSafeNonNegativeInteger(observation.iterationsCompleted, 'observation.iterationsCompleted');
  assertUtcMs(observation.startedAtMs, 'observation.startedAtMs');
  assertUtcMs(observation.completedAtMs, 'observation.completedAtMs');
  if (observation.completedAtMs < observation.startedAtMs) throw new TypeError('fault run completion predates start');
  if (typeof observation.injected !== 'boolean') throw new TypeError('observation.injected must be boolean');
  if (!Array.isArray(observation.transitionCodes)) throw new TypeError('observation.transitionCodes must be an array');
  if (new Set(observation.transitionCodes).size !== observation.transitionCodes.length) throw new TypeError('fault transition codes must be unique');
  for (const transitionCode of observation.transitionCodes) assertCode(transitionCode, 'observation.transitionCode');
  if (observation.runDigest !== computeFaultRunDigest(observation)) throw new TypeError('fault run digest mismatch');
  if (!(FAULT_RUN_STATES as readonly string[]).includes(observation.state)) throw new TypeError('fault run state unsupported');
  if (observation.rootCauseCode !== null) assertCode(observation.rootCauseCode, 'observation.rootCauseCode');
  if (!Array.isArray(observation.rootCauseEvidence)) throw new TypeError('observation.rootCauseEvidence must be an array');
  if (!Array.isArray(observation.proofs)) throw new TypeError('observation.proofs must be an array');
  if (observation.rootCauseEvidence.length !== 1) throw new TypeError('fault run requires exactly one root-cause evidence record');
  const evidenceOwnerByKey = new Map<string, string>();
  const validateEvidence = (evidence: Readonly<AssuranceEvidenceRef>, owner: string): void => {
    const evaluated = evaluateEvidenceRef(evidence, observation.completedAtMs, true);
    const unexpectedReasons = evaluated.reasonCodes.filter((reason) => reason !== 'EVIDENCE_TRUTH_NOT_LIVE_PUBLIC');
    if (unexpectedReasons.length > 0 || evidence.truthLabel !== 'SYNTHETIC_ONLY' || evidence.digest === null) {
      throw new TypeError(`fault evidence ${evidence.evidenceId} is not valid bounded synthetic evidence`);
    }
    if (evidence.observedAtMs < observation.startedAtMs || evidence.observedAtMs > observation.completedAtMs) {
      throw new TypeError(`fault evidence ${evidence.evidenceId} falls outside the run interval`);
    }
    const expectedEvidence = syntheticFaultEvidence(
      { scenarioId: observation.scenarioId },
      observation.testedCommit,
      observation.runId,
      owner,
      evidence.observedAtMs,
    );
    if (JSON.stringify(faultEvidenceDigestMaterial(evidence)) !== JSON.stringify(faultEvidenceDigestMaterial(expectedEvidence))) {
      throw new TypeError(`fault evidence ${evidence.evidenceId} is not bound to ${owner}`);
    }
    for (const key of [`id:${evidence.evidenceId}`, `digest:${evidence.digest}`]) {
      const existingOwner = evidenceOwnerByKey.get(key);
      if (existingOwner !== undefined) throw new TypeError(`fault evidence ${key} is reused across ${existingOwner} and ${owner}`);
      evidenceOwnerByKey.set(key, owner);
    }
  };
  validateEvidence(observation.injectionEvidence, 'INJECTION');
  for (const evidence of observation.rootCauseEvidence) validateEvidence(evidence, 'ROOT_CAUSE');
  for (const proof of observation.proofs) {
    assertCode(proof.proofId, 'observation.proof.proofId');
    if (!(['PASS', 'FAIL', 'UNKNOWN'] as const).includes(proof.verdict)) throw new TypeError('fault proof verdict unsupported');
    if (proof.verdict === 'PASS' && proof.reasonCodes.length > 0) {
      throw new TypeError(`PASS proof ${proof.proofId} must not contain reason codes`);
    }
    if (proof.verdict !== 'PASS' && proof.reasonCodes.length === 0) throw new TypeError(`non-PASS proof ${proof.proofId} requires reason codes`);
    for (const reasonCode of proof.reasonCodes) assertCode(reasonCode, 'observation.proof.reasonCode');
    if (!Array.isArray(proof.evidence)) throw new TypeError(`fault proof ${proof.proofId} evidence must be an array`);
    if (proof.evidence.length !== 1) throw new TypeError(`fault proof ${proof.proofId} requires exactly one evidence record`);
    for (const evidence of proof.evidence) validateEvidence(evidence, `PROOF_${proof.proofId}`);
  }
}

function allObservationEvidenceRefs(
  observation: Readonly<FaultRunObservation>,
): readonly Readonly<AssuranceEvidenceRef>[] {
  return Object.freeze([
    observation.injectionEvidence,
    ...observation.rootCauseEvidence,
    ...observation.proofs.flatMap((proof) => proof.evidence),
  ]);
}

function allObservationEvidence(observation: Readonly<FaultRunObservation>): readonly string[] {
  return sortedUnique(allObservationEvidenceRefs(observation).map((evidence) => evidence.evidenceId));
}

function validateObservationSet(
  observations: readonly Readonly<FaultRunObservation>[],
): string | null {
  const runIds = new Set<string>();
  const evidenceKeys = new Map<string, string>();
  const testedCommits = new Set<string>();
  for (const observation of observations) {
    if (runIds.has(observation.runId)) {
      throw new TypeError(`fault run ID ${observation.runId} is reused across observations`);
    }
    runIds.add(observation.runId);
    testedCommits.add(observation.testedCommit);
    for (const evidence of allObservationEvidenceRefs(observation)) {
      for (const key of [`id:${evidence.evidenceId}`, `digest:${evidence.digest}`]) {
        const existingRun = evidenceKeys.get(key);
        if (existingRun !== undefined) {
          throw new TypeError(`fault evidence ${key} is reused across runs ${existingRun} and ${observation.runId}`);
        }
        evidenceKeys.set(key, observation.runId);
      }
    }
  }
  if (testedCommits.size > 1) {
    throw new TypeError('fault observations must bind one exact tested commit');
  }
  return observations[0]?.testedCommit ?? null;
}

function missingEvaluation(scenario: Readonly<FaultScenario>): Readonly<FaultScenarioEvaluation> {
  return Object.freeze({
    scenarioId: scenario.scenarioId,
    kind: scenario.kind,
    runId: null,
    verdict: 'UNKNOWN',
    reasonCodes: Object.freeze(['FAULT_SCENARIO_NOT_OBSERVED']),
    missingProofIds: Object.freeze([...scenario.requiredProofIds]),
    failedProofIds: Object.freeze([]),
    unknownProofIds: Object.freeze([]),
    evidenceIds: Object.freeze([]),
    failedEvidenceIds: Object.freeze([]),
    unknownEvidenceIds: Object.freeze([]),
  });
}

function evaluateScenario(
  scenario: Readonly<FaultScenario>,
  observations: readonly Readonly<FaultRunObservation>[],
  evaluatedAtMs: number,
): Readonly<FaultScenarioEvaluation> {
  if (observations.length === 0) return missingEvaluation(scenario);
  const ordered = [...observations].sort((left, right) => left.runId.localeCompare(right.runId));
  const observation = ordered[0];
  if (!observation) return missingEvaluation(scenario);

  const failedReasons: string[] = [];
  const unknownReasons: string[] = [];
  const failedProofIds: string[] = [];
  const unknownProofIds: string[] = [];
  const failedEvidenceIds: string[] = [];
  const unknownEvidenceIds: string[] = [];
  const allEvidenceIds = ordered.flatMap(allObservationEvidence);

  if (ordered.length > 1) failedReasons.push('DUPLICATE_SCENARIO_OBSERVATION');
  if (!observation.injected) failedReasons.push('FAULT_NOT_INJECTED');
  if (JSON.stringify(observation.transitionCodes) !== JSON.stringify(expectedFaultTransitions(scenario))) {
    failedReasons.push('FAULT_MODEL_TRANSITION_PROOF_INCOMPLETE');
  }
  if (observation.state === 'NOT_RUN') unknownReasons.push('FAULT_SCENARIO_NOT_RUN');
  if (observation.state === 'INCOMPLETE') unknownReasons.push('FAULT_SCENARIO_RUN_INCOMPLETE');
  if (observation.state === 'COMPLETE' && observation.iterationsCompleted < scenario.minimumIterations) {
    failedReasons.push('SOAK_MINIMUM_ITERATIONS_NOT_MET');
  }
  if (observation.deterministicSeed !== scenario.deterministicSeed) failedReasons.push('FAULT_SEED_MISMATCH');

  for (const evidence of allObservationEvidenceRefs(observation)) {
    const evidenceResult = evaluateEvidenceRef(evidence, evaluatedAtMs, true);
    const materialReasons = evidenceResult.reasonCodes.filter((reason) => reason !== 'EVIDENCE_TRUTH_NOT_LIVE_PUBLIC');
    if (evidenceResult.verdict === 'FAIL') {
      failedReasons.push('FAULT_EVIDENCE_INVALID_AT_EVALUATION', ...materialReasons);
      failedEvidenceIds.push(evidence.evidenceId);
    } else if (materialReasons.length > 0) {
      unknownReasons.push('FAULT_EVIDENCE_INCOMPLETE_AT_EVALUATION', ...materialReasons);
      unknownEvidenceIds.push(evidence.evidenceId);
    }
  }

  if (observation.rootCauseCode === null) {
    unknownReasons.push('ROOT_CAUSE_NOT_OBSERVED');
  } else if (observation.rootCauseCode !== scenario.expectedRootCauseCode) {
    failedReasons.push('ROOT_CAUSE_MISMATCH');
    failedEvidenceIds.push(...observation.rootCauseEvidence.map((evidence) => evidence.evidenceId));
  } else if (observation.rootCauseEvidence.length === 0) {
    failedReasons.push('ROOT_CAUSE_EVIDENCE_MISSING');
  }

  const duplicateProofIds = sortedUnique(
    observation.proofs
      .map((proof) => proof.proofId)
      .filter((proofId, index, proofIds) => proofIds.indexOf(proofId) !== index),
  );
  if (duplicateProofIds.length > 0) {
    failedReasons.push('DUPLICATE_PROOF_OBSERVATION');
    failedProofIds.push(...duplicateProofIds);
  }

  const proofById = new Map(observation.proofs.map((proof) => [proof.proofId, proof]));
  const unexpectedProofs = observation.proofs.filter((proof) => !scenario.requiredProofIds.includes(proof.proofId));
  if (unexpectedProofs.length > 0) {
    failedReasons.push('UNEXPECTED_FAULT_PROOF');
    failedProofIds.push(...unexpectedProofs.map((proof) => proof.proofId));
    failedEvidenceIds.push(...unexpectedProofs.flatMap((proof) => proof.evidence.map((evidence) => evidence.evidenceId)));
  }
  const missingProofIds = scenario.requiredProofIds.filter((proofId) => !proofById.has(proofId));
  if (missingProofIds.length > 0) unknownReasons.push('MANDATORY_FAULT_PROOF_MISSING');

  for (const proofId of scenario.requiredProofIds) {
    const proof = proofById.get(proofId);
    if (!proof) continue;
    if (proof.verdict === 'FAIL') {
      failedProofIds.push(proofId);
      failedReasons.push(...(proof.reasonCodes.length > 0 ? proof.reasonCodes : ['FAULT_PROOF_FAILED']));
      failedEvidenceIds.push(...proof.evidence.map((evidence) => evidence.evidenceId));
      continue;
    }
    if (proof.verdict === 'UNKNOWN') {
      unknownProofIds.push(proofId);
      unknownReasons.push(...(proof.reasonCodes.length > 0 ? proof.reasonCodes : ['FAULT_PROOF_UNKNOWN']));
      unknownEvidenceIds.push(...proof.evidence.map((evidence) => evidence.evidenceId));
      continue;
    }
    if (proof.evidence.length === 0) {
      failedProofIds.push(proofId);
      failedReasons.push('PASS_PROOF_EVIDENCE_MISSING');
    }
  }

  return Object.freeze({
    scenarioId: scenario.scenarioId,
    kind: scenario.kind,
    runId: observation.runId,
    verdict: verdictFromReasons(failedReasons, unknownReasons),
    reasonCodes: sortedUnique([...failedReasons, ...unknownReasons]),
    missingProofIds: sortedUnique(missingProofIds),
    failedProofIds: sortedUnique(failedProofIds),
    unknownProofIds: sortedUnique(unknownProofIds),
    evidenceIds: sortedUnique(allEvidenceIds),
    failedEvidenceIds: sortedUnique(failedEvidenceIds),
    unknownEvidenceIds: sortedUnique(unknownEvidenceIds),
  });
}

/**
 * Evaluates already-captured, side-effect-free observations. The harness never
 * performs a retry, mutation, network call, clock read, file operation, or
 * remediation action. FAIL dominates UNKNOWN so a missing proof cannot mask a
 * demonstrated safety violation.
 */
function evaluateFaultHarness(
  scenarios: readonly Readonly<FaultScenario>[],
  observations: readonly Readonly<FaultRunObservation>[],
  evaluatedAtMs: number,
): Readonly<FaultHarnessReport> {
  assertUtcMs(evaluatedAtMs, 'evaluatedAtMs');
  for (const scenario of scenarios) validateScenario(scenario);
  for (const observation of observations) validateObservation(observation);
  const testedCommit = validateObservationSet(observations);

  const scenarioIds = scenarios.map((scenario) => scenario.scenarioId);
  const duplicateScenarioIds = sortedUnique(
    scenarioIds.filter((scenarioId, index) => scenarioIds.indexOf(scenarioId) !== index),
  );
  if (duplicateScenarioIds.length > 0) {
    throw new TypeError(`duplicate fault scenario declarations: ${duplicateScenarioIds.join(',')}`);
  }

  const declaredIds = new Set(scenarioIds);
  const unexpectedObservations = observations.filter((observation) => !declaredIds.has(observation.scenarioId));
  const unexpectedObservationScenarioIds = sortedUnique(unexpectedObservations.map((observation) => observation.scenarioId));
  const observationsByScenario = new Map<string, FaultRunObservation[]>();
  for (const observation of observations) {
    if (!declaredIds.has(observation.scenarioId)) continue;
    const bucket = observationsByScenario.get(observation.scenarioId) ?? [];
    bucket.push(observation);
    observationsByScenario.set(observation.scenarioId, bucket);
  }

  const scenarioEvaluations = scenarios
    .map((scenario) => evaluateScenario(
      scenario,
      observationsByScenario.get(scenario.scenarioId) ?? [],
      evaluatedAtMs,
    ))
    .sort((left, right) => left.scenarioId.localeCompare(right.scenarioId));
  const duplicateObservationScenarioIds = sortedUnique(
    [...observationsByScenario.entries()]
      .filter(([, grouped]) => grouped.length > 1)
      .map(([scenarioId]) => scenarioId),
  );
  const failedScenarioIds = sortedUnique([
    ...scenarioEvaluations.filter((evaluation) => evaluation.verdict === 'FAIL').map((evaluation) => evaluation.scenarioId),
    ...unexpectedObservationScenarioIds,
  ]);
  const unknownScenarioIds = sortedUnique(
    scenarioEvaluations.filter((evaluation) => evaluation.verdict === 'UNKNOWN').map((evaluation) => evaluation.scenarioId),
  );
  const passedScenarioIds = sortedUnique(
    scenarioEvaluations.filter((evaluation) => evaluation.verdict === 'PASS').map((evaluation) => evaluation.scenarioId),
  );
  const failedReasons = [
    ...scenarioEvaluations
      .filter((evaluation) => evaluation.verdict === 'FAIL')
      .flatMap((evaluation) => evaluation.reasonCodes),
    ...(unexpectedObservationScenarioIds.length > 0 ? ['UNEXPECTED_FAULT_OBSERVATION'] : []),
  ];
  const unknownReasons = [
    ...(scenarios.length === 0 ? ['FAULT_SCENARIO_DECLARATIONS_EMPTY'] : []),
    ...scenarioEvaluations
      .filter((evaluation) => evaluation.verdict === 'UNKNOWN')
      .flatMap((evaluation) => evaluation.reasonCodes),
  ];
  const unexpectedEvidenceIds = unexpectedObservations.flatMap(allObservationEvidence);

  return Object.freeze({
    schema: 'PRODUCT_ASSURANCE_FAULT_HARNESS_REPORT_V1',
    testedCommit,
    evaluatedAtMs,
    truthLabel: 'SYNTHETIC_ONLY',
    realSoakState: 'NOT_RUN',
    authorityGranted: false,
    verdict: verdictFromReasons(failedReasons, unknownReasons),
    declaredScenarioCount: scenarios.length,
    observedScenarioCount: observationsByScenario.size,
    passedScenarioIds,
    failedScenarioIds,
    unknownScenarioIds,
    unexpectedObservationScenarioIds,
    duplicateObservationScenarioIds,
    reasonCodes: sortedUnique([...failedReasons, ...unknownReasons]),
    evidenceIds: sortedUnique([
      ...scenarioEvaluations.flatMap((evaluation) => evaluation.evidenceIds),
      ...unexpectedEvidenceIds,
    ]),
    failedEvidenceIds: sortedUnique([
      ...scenarioEvaluations.flatMap((evaluation) => evaluation.failedEvidenceIds),
      ...unexpectedEvidenceIds,
    ]),
    unknownEvidenceIds: sortedUnique(
      scenarioEvaluations.flatMap((evaluation) => evaluation.unknownEvidenceIds),
    ),
    scenarioEvaluations: Object.freeze(scenarioEvaluations),
  });
}

function assertCanonicalScenarioIdDenominator(
  scenarios: readonly Readonly<FaultScenario>[],
): void {
  const actualIds = scenarios.map((scenario) => scenario.scenarioId);
  const actualSet = new Set(actualIds);
  const expectedSet = new Set(CANONICAL_FAULT_SCENARIO_IDS);
  const duplicateIds = sortedUnique(
    actualIds.filter((scenarioId, index) => actualIds.indexOf(scenarioId) !== index),
  );
  const missingIds = CANONICAL_FAULT_SCENARIO_IDS.filter((scenarioId) => !actualSet.has(scenarioId));
  const unexpectedIds = actualIds.filter((scenarioId) => !expectedSet.has(scenarioId));

  if (
    duplicateIds.length > 0
    || missingIds.length > 0
    || unexpectedIds.length > 0
    || actualIds.length !== CANONICAL_FAULT_SCENARIO_IDS.length
  ) {
    throw new TypeError(
      [
        'canonical fault scenario denominator mismatch',
        `missing=${sortedUnique(missingIds).join(',') || 'NONE'}`,
        `unexpected=${sortedUnique(unexpectedIds).join(',') || 'NONE'}`,
        `duplicate=${duplicateIds.join(',') || 'NONE'}`,
      ].join('; '),
    );
  }
}

/**
 * Evaluates the immutable section 3.7 denominator. The two-argument overload
 * exists for generators that carry a declaration set: it verifies that set is
 * exact, then still evaluates against the canonical declarations so altered
 * kinds, seeds, or proof requirements cannot silently weaken the gate.
 */
export function evaluateCanonicalFaultHarness(
  observations: readonly Readonly<FaultRunObservation>[],
  evaluatedAtMs: number,
): Readonly<FaultHarnessReport>;
export function evaluateCanonicalFaultHarness(
  scenarios: readonly Readonly<FaultScenario>[],
  observations: readonly Readonly<FaultRunObservation>[],
  evaluatedAtMs: number,
): Readonly<FaultHarnessReport>;
export function evaluateCanonicalFaultHarness(
  scenariosOrObservations:
    | readonly Readonly<FaultScenario>[]
    | readonly Readonly<FaultRunObservation>[],
  observationsOrEvaluatedAtMs: readonly Readonly<FaultRunObservation>[] | number,
  suppliedEvaluatedAtMs?: number,
): Readonly<FaultHarnessReport> {
  const declarationInput = typeof observationsOrEvaluatedAtMs === 'number'
    ? CANONICAL_FAULT_SCENARIOS
    : scenariosOrObservations as readonly Readonly<FaultScenario>[];
  const observations = typeof observationsOrEvaluatedAtMs === 'number'
    ? scenariosOrObservations as readonly Readonly<FaultRunObservation>[]
    : observationsOrEvaluatedAtMs;
  const evaluatedAtMs = typeof observationsOrEvaluatedAtMs === 'number'
    ? observationsOrEvaluatedAtMs
    : suppliedEvaluatedAtMs;
  if (evaluatedAtMs === undefined) throw new TypeError('evaluatedAtMs is required');

  assertCanonicalScenarioIdDenominator(declarationInput);
  return evaluateFaultHarness(CANONICAL_FAULT_SCENARIOS, observations, evaluatedAtMs);
}
