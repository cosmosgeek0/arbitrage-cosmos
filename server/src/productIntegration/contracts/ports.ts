import type {
  ProductCapitalRiskReference,
  ProductComponentEvidence,
  ProductExecutionReference,
  ProductOutcomeFeedbackReference,
  ProductOpportunityReference,
  ProductQAssessmentReference,
  ProductStrategyDecisionReference,
  ProductSupervisorProjection,
  DesiredRuntimeState,
} from './types.js';
import type { ContractResult } from '../../foundation/contracts/index.js';
import type {
  ProductCommandRequestProjection,
  ProductCommandReceiptProjection,
  ProductCommandPreviewIntentProjection,
  ProductCommandPreviewProjection,
} from '../commands/projection.js';
import type {
  ProductOperatorEventPage,
} from '../supervisor/events.js';

export interface BoundedOwnerProjection {
  readonly schema: string;
  readonly ownerId: string;
  readonly ownerRevision: string | null;
  readonly contentHash: string;
  readonly byteLength: number;
  readonly payload: unknown;
}

/** Read-only lifecycle evidence supplied by each canonical owner adapter. */
export interface ProductComponentLifecyclePort {
  readComponentEvidence(): ContractResult<Readonly<ProductComponentEvidence>>;
}

/** Q remains advisory; this port cannot approve capital, risk, or execution. */
export interface QAssessmentConsumerPort {
  readAssessmentReferences(): ContractResult<readonly Readonly<ProductQAssessmentReference>[]>;
}

export interface StrategySnapshotConsumerPort {
  readonly strategy: 'BASIS' | 'VOLUME';
  readDecisionReferences(): ContractResult<readonly Readonly<ProductStrategyDecisionReference>[]>;
}

export interface OpportunityAuthorityPort {
  readOpportunityReference(opportunityId: string): ContractResult<Readonly<ProductOpportunityReference> | null>;
}

export interface CapitalRiskVerdictConsumerPort {
  readCapitalRiskReference(opportunityId: string): ContractResult<Readonly<ProductCapitalRiskReference> | null>;
}

/** Accepted L execution/reconciliation contracts are adapted here when available. */
export interface ExecutionReconciliationConsumerPort {
  readExecutionReference(ticketId: string): ContractResult<Readonly<ProductExecutionReference> | null>;
}

export interface PositionRecoveryConsumerPort {
  readPositionRecoveryReferences(): ContractResult<readonly Readonly<ProductExecutionReference>[]>;
}

export interface OutcomeFeedbackPort {
  submitFeedbackProjection(feedback: Readonly<ProductOutcomeFeedbackReference>): ContractResult<Readonly<{
    accepted: boolean;
    duplicate: boolean;
    ownerReceiptId: string | null;
  }>>;
}

/** Existing Ledger/database remains the sole durable owner. */
export interface ProductLedgerPersistencePort {
  appendProjection(input: Readonly<{
    recordType: string;
    recordId: string;
    projectionRevision: number;
    ownerRevision: string | null;
    idempotencyKey: string;
    correlationId: string;
    occurredAtMs: number;
    payload: unknown;
  }>): Promise<ContractResult<Readonly<{ persisted: boolean; duplicate: boolean; ledgerReference: string }>>>;
}

/** Existing canonical Control Plane validates and applies the delegated command. */
export interface ProductOperatorCommandPort {
  preview(input: Readonly<ProductCommandPreviewIntentProjection>): Promise<ContractResult<Readonly<ProductCommandPreviewProjection & {
    effect: 'IMMEDIATE' | 'DRAIN' | 'RESTART' | 'DEPLOYMENT';
  }>>>;
  submit(input: Readonly<ProductCommandRequestProjection>): Promise<ContractResult<Readonly<ProductCommandReceiptProjection>>>;
  readResult(commandId: string): Promise<ContractResult<Readonly<ProductCommandReceiptProjection>>>;
}

/** Exact accepted L14 side-lane contract at immutable state seal 04e50f43. */
export type L14DurableControlActionType =
  | 'SET_COMPONENT_DESIRED_STATE' | 'PAUSE_INTAKE' | 'RESUME_INTAKE' | 'UPDATE_BOUNDED_CONFIGURATION'
  | 'APPROVE' | 'ARM' | 'DISARM' | 'REARM' | 'REVOKE' | 'HALT' | 'RECONCILE' | 'CANCEL'
  | 'CLOSE' | 'REDUCE' | 'EXECUTE_PRECOMPUTED_RECOVERY_PLAN' | 'REPAY_LIABILITY'
  | 'SAFE_RESTART_COMPONENT' | 'ACKNOWLEDGE_RECOVERY';
export type L14ControlReasonCode =
  | 'CONTROL_APPLIED' | 'CONTROL_NOOP' | 'AWARENESS_RECORDED' | 'INVALID_CONTROL_REQUEST'
  | 'STRICT_SCHEMA_VIOLATION' | 'SENSITIVE_MATERIAL_REJECTED' | 'AUTHENTICATED_OPERATOR_REQUIRED'
  | 'OPERATOR_IDENTITY_INVALID' | 'OPERATOR_MISMATCH' | 'PREVIEW_AUTHORITY_UNAVAILABLE'
  | 'PREVIEW_AUTHORITY_INVALID' | 'PREVIEW_DIGEST_MISMATCH' | 'PREVIEW_AUTHENTICATION_FAILED'
  | 'COMMAND_EXPIRED' | 'STALE_CONFIG_VERSION' | 'STALE_CONTROL_REVISION' | 'IDEMPOTENCY_CONFLICT'
  | 'COMMAND_IN_PROGRESS' | 'PERSISTENCE_UNAVAILABLE' | 'PERSISTENCE_ACK_INVALID'
  | 'COMMAND_OUTCOME_UNCERTAIN' | 'OWNER_SNAPSHOT_UNAVAILABLE' | 'OWNER_SNAPSHOT_INVALID'
  | 'OWNER_REJECTED' | 'OWNER_CONTRACT_INVALID' | 'COMMAND_NOT_APPLICABLE' | 'KILL_SWITCH_ENGAGED'
  | 'RECOVERY_REQUIRED' | 'RECOVERY_STATE_UNKNOWN' | 'EXCHANGE_TRUTH_UNAVAILABLE'
  | 'EXCHANGE_TRUTH_STALE' | 'EXCHANGE_TRUTH_INCOMPLETE' | 'EXCHANGE_TRUTH_MISMATCH'
  | 'RISK_OWNER_UNAVAILABLE' | 'RISK_OWNER_CONTRACT_INVALID' | 'RISK_INCREASE_FORBIDDEN'
  | 'WAITING_L08' | 'CONFIGURATION_OWNER_NOT_WIRED' | 'APPROVAL_OWNER_NOT_WIRED'
  | 'LIVE_EXECUTION_NOT_IMPLEMENTED';
export type L14OpaqueReferenceOwnerPort =
  | 'FOUNDATION_CONTROL' | 'FOUNDATION_EXECUTION' | 'FOUNDATION_RECONCILIATION' | 'FOUNDATION_RISK'
  | 'CAPITAL_APPROVALS' | 'CAPITAL_RESERVATIONS' | 'CAPITAL_POSITIONS' | 'L06_MUTATION_JOURNAL' | 'L08_RECOVERY';
export interface L14OpaqueOwnerReferencePort {
  readonly schema: 'LIVE_EDGE_OPAQUE_OWNER_REFERENCE_V1';
  readonly owner: L14OpaqueReferenceOwnerPort;
  readonly id: string;
  readonly revision: string;
  readonly digest: string;
}
export interface L14WaitingL08ReferencePort extends L14OpaqueOwnerReferencePort {
  readonly owner: 'L08_RECOVERY';
  readonly validation: 'WAITING_L08';
}
export interface L14ComponentTargetPort extends L14OpaqueOwnerReferencePort { readonly owner: 'FOUNDATION_CONTROL' }
export interface L14RiskBoundDeclarationPort {
  readonly measure: L14OpaqueOwnerReferencePort & { readonly owner: 'FOUNDATION_RISK' };
  readonly maximumPostActionValue: string;
}
export type L14BoundedConfigurationChangePort =
  | { readonly setting: 'COMPONENT_STEP_TIMEOUT_MS'; readonly component: L14ComponentTargetPort; readonly valueMs: number }
  | { readonly setting: 'PREFLIGHT_GATE_TIMEOUT_MS'; readonly gateId: string; readonly valueMs: number }
  | { readonly setting: 'SOURCE_STALE_AFTER_MS'; readonly sourceId: string; readonly valueMs: number };
export type L14DurableControlActionPort =
  | { readonly type: 'SET_COMPONENT_DESIRED_STATE'; readonly component: L14ComponentTargetPort; readonly desiredState: DesiredRuntimeState }
  | { readonly type: 'PAUSE_INTAKE'; readonly scope: 'NEW_RISK' }
  | { readonly type: 'RESUME_INTAKE'; readonly scope: 'NEW_RISK'; readonly reconciliation: L14OpaqueOwnerReferencePort & { readonly owner: 'FOUNDATION_RECONCILIATION' } }
  | { readonly type: 'UPDATE_BOUNDED_CONFIGURATION'; readonly change: L14BoundedConfigurationChangePort }
  | { readonly type: 'APPROVE'; readonly proposal: L14OpaqueOwnerReferencePort; readonly approvalPolicy: L14WaitingL08ReferencePort; readonly mode: 'VALIDATE_ONLY' }
  | { readonly type: 'ARM'; readonly approval: L14OpaqueOwnerReferencePort & { readonly owner: 'CAPITAL_APPROVALS' }; readonly armingPolicy: L14WaitingL08ReferencePort; readonly mode: 'VALIDATE_ONLY' }
  | { readonly type: 'DISARM'; readonly arm: L14OpaqueOwnerReferencePort & { readonly owner: 'CAPITAL_APPROVALS' }; readonly cause: 'OPERATOR_REQUEST' | 'SAFETY' }
  | { readonly type: 'REARM'; readonly priorArm: L14OpaqueOwnerReferencePort & { readonly owner: 'CAPITAL_APPROVALS' }; readonly approval: L14OpaqueOwnerReferencePort & { readonly owner: 'CAPITAL_APPROVALS' }; readonly armingPolicy: L14WaitingL08ReferencePort; readonly mode: 'VALIDATE_ONLY' }
  | { readonly type: 'REVOKE'; readonly targetKind: 'APPROVAL' | 'RESERVATION' | 'ARM'; readonly target: L14OpaqueOwnerReferencePort }
  | { readonly type: 'HALT'; readonly scope: 'NEW_RISK'; readonly retainSupervision: true }
  | { readonly type: 'RECONCILE'; readonly scope: 'ACCOUNT_AND_EXCHANGE'; readonly target: L14OpaqueOwnerReferencePort & { readonly owner: 'FOUNDATION_RECONCILIATION' } }
  | { readonly type: 'CANCEL'; readonly order: L14OpaqueOwnerReferencePort & { readonly owner: 'L06_MUTATION_JOURNAL' }; readonly orderPolicy: L14WaitingL08ReferencePort; readonly riskBound: L14RiskBoundDeclarationPort }
  | { readonly type: 'CLOSE'; readonly position: L14OpaqueOwnerReferencePort & { readonly owner: 'CAPITAL_POSITIONS' }; readonly orderPolicy: L14WaitingL08ReferencePort; readonly riskBound: L14RiskBoundDeclarationPort }
  | { readonly type: 'REDUCE'; readonly position: L14OpaqueOwnerReferencePort & { readonly owner: 'CAPITAL_POSITIONS' }; readonly reductionBps: number; readonly orderPolicy: L14WaitingL08ReferencePort; readonly riskBound: L14RiskBoundDeclarationPort }
  | { readonly type: 'EXECUTE_PRECOMPUTED_RECOVERY_PLAN'; readonly recoveryPlan: L14WaitingL08ReferencePort; readonly riskBound: L14RiskBoundDeclarationPort }
  | { readonly type: 'REPAY_LIABILITY'; readonly liability: L14OpaqueOwnerReferencePort; readonly repaymentPolicy: L14WaitingL08ReferencePort; readonly riskBound: L14RiskBoundDeclarationPort }
  | { readonly type: 'SAFE_RESTART_COMPONENT'; readonly component: L14ComponentTargetPort; readonly restartMode: 'SAFE_RECONCILE_FIRST' }
  | { readonly type: 'ACKNOWLEDGE_RECOVERY'; readonly recovery: L14OpaqueOwnerReferencePort & { readonly owner: 'FOUNDATION_EXECUTION' }; readonly observedRecoveryRevision: string; readonly statement: 'AWARENESS_ONLY' };
export interface L14PreviewRiskWitnessPort {
  readonly truthRevision: string;
  readonly measureRevision: string;
  readonly currentValue: string;
  readonly maximumPostActionValue: string;
  readonly evaluatedAtMs: number;
  readonly authority: 'FOUNDATION_RISK';
}
export interface L14ControlPreviewRequestPort {
  readonly schema: 'LIVE_EDGE_DURABLE_CONTROL_V1';
  readonly version: 1;
  readonly action: L14DurableControlActionPort;
  readonly expectedConfigVersion: number;
  readonly reason: string;
  readonly ttlMs: number;
}
export interface L14DurableControlPreviewPort {
  readonly schema: 'LIVE_EDGE_CONTROL_PREVIEW_V1';
  readonly version: 1;
  readonly commandId: string;
  readonly action: L14DurableControlActionPort;
  readonly actionDigest: string;
  readonly expectedConfigVersion: number;
  readonly expectedControlRevision: number;
  readonly actorBinding: string;
  readonly reason: string;
  readonly generatedAtMs: number;
  readonly expiresAtMs: number;
  readonly riskWitness: Readonly<L14PreviewRiskWitnessPort> | null;
  readonly previewDigest: string;
  readonly authorizationTag: string;
  readonly externalActionAuthorization: 'NONE';
}
export interface L14ControlSubmissionRequestPort {
  readonly schema: 'LIVE_EDGE_DURABLE_CONTROL_V1';
  readonly version: 1;
  readonly preview: Readonly<L14DurableControlPreviewPort>;
}
export interface L14ControlCommandReceiptPort {
  readonly schema: 'LIVE_EDGE_CONTROL_RECEIPT_V1';
  readonly version: 1;
  readonly commandId: string;
  readonly previewDigest: string;
  readonly actionType: L14DurableControlActionType;
  readonly disposition: 'APPLIED' | 'NOOP' | 'AWARENESS_RECORDED';
  readonly reasonCode: L14ControlReasonCode;
  readonly actorBinding: string;
  readonly expectedConfigVersion: number;
  readonly committedControlRevision: number;
  readonly applied: boolean;
  readonly recordedAtMs: number;
  readonly ledgerEventIds: readonly [number, number];
  readonly recoveryStateChanged: false;
  readonly externalActionAuthorization: 'NONE';
}
export interface L14ControlCommandRejectionReceiptPort {
  readonly schema: 'LIVE_EDGE_CONTROL_REJECTION_RECEIPT_V1';
  readonly version: 1;
  readonly commandId: string;
  readonly previewDigest: string;
  readonly actionType: L14DurableControlActionType;
  readonly actorBinding: string;
  readonly reasonCode: L14ControlReasonCode;
  readonly expectedConfigVersion: number;
  readonly committedControlRevision: number;
  readonly recordedAtMs: number;
  readonly ledgerEventIds: readonly [number, number];
  readonly recoveryStateChanged: false;
  readonly externalActionAuthorization: 'NONE';
}
export type L14ControlCommandLookupPort =
  | { readonly kind: 'NOT_FOUND'; readonly journalVersion: 0; readonly headDigest: null }
  | { readonly kind: 'PENDING'; readonly previewDigest: string; readonly actorBinding: string; readonly journalVersion: number; readonly headDigest: string }
  | { readonly kind: 'COMPLETED'; readonly previewDigest: string; readonly actorBinding: string; readonly journalVersion: number; readonly headDigest: string; readonly receipt: Readonly<L14ControlCommandReceiptPort> }
  | { readonly kind: 'REJECTED'; readonly previewDigest: string; readonly actorBinding: string; readonly journalVersion: number; readonly headDigest: string; readonly rejection: Readonly<L14ControlCommandRejectionReceiptPort> };
export interface L14ControlEventBasePort {
  readonly schema: 'LIVE_EDGE_CONTROL_EVENT_V1';
  readonly version: 1;
  readonly commandId: string;
  readonly previewDigest: string;
  readonly actionType: L14DurableControlActionType;
  readonly actorBinding: string;
  readonly expectedConfigVersion: number;
  readonly expectedControlRevision: number;
  readonly occurredAtMs: number;
  readonly eventId: string;
  readonly contentDigest: string;
  readonly externalActionAuthorization: 'NONE';
}
export interface L14ControlIntentCommittedEventPort extends L14ControlEventBasePort {
  readonly kind: 'CONTROL_INTENT_COMMITTED';
  readonly action: L14DurableControlActionPort;
  readonly expiresAtMs: number;
  readonly decisionCode: L14ControlReasonCode;
  readonly riskWitness: Readonly<L14PreviewRiskWitnessPort> | null;
}
export interface L14ControlAppliedEventPort extends L14ControlEventBasePort {
  readonly kind: 'CONTROL_APPLIED';
  readonly applied: boolean;
  readonly reasonCode: L14ControlReasonCode;
  readonly recoveryStateChanged: false;
}
export interface L14ControlAwarenessRecordedEventPort extends L14ControlEventBasePort {
  readonly kind: 'CONTROL_AWARENESS_RECORDED';
  readonly recoveryRevision: string;
  readonly awarenessOnly: true;
  readonly recoveryStateChanged: false;
  readonly reasonCode: 'AWARENESS_RECORDED';
}
export interface L14ControlRejectedEventPort extends L14ControlEventBasePort {
  readonly kind: 'CONTROL_REJECTED';
  readonly reasonCode: L14ControlReasonCode;
  readonly redacted: true;
  readonly intentCommitted: boolean;
  readonly recoveryStateChanged: false;
}
export type L14ControlEventPort = L14ControlIntentCommittedEventPort | L14ControlAppliedEventPort | L14ControlAwarenessRecordedEventPort | L14ControlRejectedEventPort;
export interface L14ControlEventAppendRequestPort {
  readonly ownerTarget: 'SYSTEM_INTEGRATION_LEDGER';
  readonly event: Readonly<L14ControlEventPort>;
  readonly idempotencyKey: string;
  readonly appendRequestDigest: string;
  readonly expectedJournalVersion: number;
  readonly previousHeadDigest: string | null;
  readonly nextHeadDigest: string;
  readonly externalActionAuthorization: 'NONE';
}
export interface L14ControlEventAppendAcknowledgementPort {
  readonly schema: 'LIVE_EDGE_CONTROL_EVENT_ACK_V1';
  readonly version: 1;
  readonly owner: 'SYSTEM_INTEGRATION_LEDGER';
  readonly disposition: 'COMMITTED_NEW' | 'IDEMPOTENT_REPLAY' | 'IDEMPOTENCY_CONFLICT' | 'VERSION_CONFLICT' | 'EXPIRED' | 'FAILED';
  readonly commandId: string;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly appendRequestDigest: string;
  readonly expectedJournalVersion: number;
  readonly committedJournalVersion: number | null;
  readonly previousHeadDigest: string | null;
  readonly committedHeadDigest: string | null;
  readonly appendedCount: 0 | 1;
  readonly ledgerEventId: number | null;
  readonly committedAtMs: number | null;
  readonly currentConfigVersion: number;
  readonly currentControlRevision: number;
  readonly failureCode: L14ControlReasonCode | null;
  readonly externalActionAuthorization: 'NONE';
}
export interface L14DurableControlPort {
  preview(input: unknown): Promise<ContractResult<Readonly<L14DurableControlPreviewPort>>>;
  submit(input: unknown): Promise<ContractResult<Readonly<L14ControlCommandReceiptPort>>>;
}
export interface L14CanonicalControlPersistencePort {
  lookup(commandId: string): Promise<Readonly<L14ControlCommandLookupPort>>;
  append(input: Readonly<L14ControlEventAppendRequestPort>): Promise<Readonly<L14ControlEventAppendAcknowledgementPort>>;
}

/** Machine supervisor is a projection over owners, never a domain authority. */
export interface ProductSupervisorProjectionPort {
  project(nowMs: number, revision: number): ContractResult<Readonly<ProductSupervisorProjection>>;
}

export interface ProductOperatorEventStreamPort {
  readPage(input: Readonly<{ afterCursor: number; limit: number }>): Promise<ContractResult<Readonly<ProductOperatorEventPage>>>;
}

/** Accepted L05 evidence only; no read/mutation authority is added here. */
export interface ProductPrivateTruthConsumerPort {
  readPrivateTruthProjection(): ContractResult<Readonly<BoundedOwnerProjection>>;
}

/** Exact immutable L06 request shell; TEntry is the accepted MutationJournalEntry after donor merge. */
export interface L06MutationJournalEntryPort {
  readonly schema: 'LIVE_EDGE_MUTATION_ENTRY_V1';
  readonly version: 1;
  readonly entryId: string;
  readonly mutationId: string;
  readonly observationId: string;
  readonly journalVersion: number;
  readonly previousHeadDigest: string | null;
  readonly kind: 'CREATED' | 'PREFLIGHTED' | 'SUBMISSION_INTENT' | 'SUBMISSION_OBSERVED' | 'HTTP_OBSERVED'
    | 'PRIVATE_ORDER_OBSERVED' | 'PRIVATE_FILL_OBSERVED' | 'FOUNDATION_RECONCILIATION_OBSERVED'
    | 'OBSERVATION_ID_CONFLICT' | 'TELEMETRY_DEGRADED';
  readonly occurredAtMs: number;
  readonly receivedAtMs: number;
  readonly sourceRevision: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly contentRevision: string;
}

export interface L06MutationAppendRequestPort<TEntry extends object> {
  readonly schema: 'LIVE_EDGE_MUTATION_APPEND_REQUEST_V1';
  readonly version: 1;
  readonly ownerTarget: 'SYSTEM_INTEGRATION_LEDGER';
  readonly mutationId: string;
  readonly entryId: string;
  readonly idempotencyKey: string;
  readonly expectedJournalVersion: number;
  readonly nextJournalVersion: number;
  readonly previousHeadDigest: string | null;
  readonly entry: Readonly<TEntry>;
  readonly nextHeadDigest: string;
  readonly nextOutcomeRevision: string;
  readonly entryContentRevision: string;
  readonly appendRequestDigest: string;
  readonly externalActionAuthorization: 'NONE';
}

export interface L06MutationAppendAcknowledgementPort {
  readonly schema: 'LIVE_EDGE_MUTATION_APPEND_ACK_V1';
  readonly version: 1;
  readonly owner: 'SYSTEM_INTEGRATION_LEDGER';
  readonly disposition: 'COMMITTED_NEW' | 'IDEMPOTENT_REPLAY' | 'VERSION_CONFLICT' | 'FAILED' | 'CAPACITY_EXHAUSTED';
  readonly mutationId: string;
  readonly entryId: string;
  readonly idempotencyKey: string;
  readonly appendRequestDigest: string;
  readonly expectedJournalVersion: number;
  readonly committedJournalVersion: number | null;
  readonly previousHeadDigest: string | null;
  readonly committedHeadDigest: string | null;
  readonly committedOutcomeRevision: string | null;
  readonly appendedCount: 0 | 1;
  readonly ledgerEventId: number | null;
  readonly committedAtMs: number | null;
  readonly failureCode: string | null;
  readonly externalActionAuthorization: 'NONE';
}

/** Director-owned canonical Ledger CAS requested by accepted L06. */
export interface ProductMutationJournalCasPort<TEntry extends object> {
  compareAndAppend(input: Readonly<L06MutationAppendRequestPort<TEntry>>): Promise<ContractResult<Readonly<L06MutationAppendAcknowledgementPort>>>;
}

/** Contract consumed by the accepted dashboard adapter; no browser recomputation. */
export interface ProductDashboardClientPort {
  readSupervisor(): Promise<ContractResult<Readonly<ProductSupervisorProjection>>>;
  readEvents(input: Readonly<{ afterCursor: number; limit: number }>): Promise<ContractResult<Readonly<ProductOperatorEventPage>>>;
  readTrace(correlationId: string): Promise<ContractResult<Readonly<{
    correlationId: string;
    projections: readonly Readonly<BoundedOwnerProjection>[];
    truncated: boolean;
  }>>>;
}

/** Exact top-level bridge consumed by accepted dashboard shell donor 6925015. */
export type DashboardDonorComponentId =
  | 'public-spot-source' | 'public-usdm-source' | 'market-universe' | 'intelligence-runtime' | 'market-intelligence'
  | 'basis-engine' | 'volume-engine' | 'capital-supervision' | 'multileg-risk'
  | 'execution-coordinator-validate-only' | 'reconciliation' | 'ledger-persistence' | 'engine-supervisor';
export type DashboardDonorTruthLabel = 'LIVE_PUBLIC' | 'DRY_RUN' | 'SYNTHETIC_ONLY' | 'RECORDED_REPLAY' | 'UNAVAILABLE' | 'UNKNOWN';
export type DashboardDonorReadiness = 'STOPPED' | 'WARMING' | 'READY' | 'DEGRADED' | 'BLOCKED' | 'FAILED';
export interface DashboardDonorControlStatePort {
  readonly revision: number;
  readonly generation: number;
  readonly safeMode: 'READ_ONLY' | 'ADVISORY' | 'VALIDATE_ONLY';
  readonly killSwitchEngaged: boolean;
  readonly intakePaused: boolean;
  readonly updatedAtMs: number;
  readonly correlationId: string;
}
export interface DashboardDonorComponentSnapshotPort {
  readonly componentId: DashboardDonorComponentId;
  readonly owner: string;
  readonly ownerPath: string;
  readonly releaseStatuses: readonly string[];
  readonly truthLabel: DashboardDonorTruthLabel;
  readonly desiredState: 'STOPPED' | 'RUNNING' | 'PAUSED';
  readonly phase: string;
  readonly domainObservedState: string | null;
  readonly readiness: DashboardDonorReadiness;
  readonly completeness: string;
  readonly sourceTimestamp: Readonly<{ sourceTimeMs: number | null; receivedAtMs: number; maxAgeMs: number }> | null;
  readonly freshness: Readonly<{ state: string; ageMs: number | null; evaluatedAt: number }> | null;
  readonly lastReceiveAtMs: number | null;
  readonly lastProcessAtMs: number | null;
  readonly lastSuccessAtMs: number | null;
  readonly dependencies: readonly DashboardDonorComponentId[];
  readonly queue: Readonly<{ depth: number; capacity: number; dropped: number; coalesced: number; observedAtMs: number }> | null;
  readonly blockerCodes: readonly string[];
  readonly generation: number;
  readonly restartCount: number;
  readonly supportedControls: readonly string[];
  readonly capitalExposed: boolean;
  readonly operatorAttentionRequired: boolean;
  readonly lastFailure: Readonly<{ code: string; message: string; recommendedOperatorAction: string }> | null;
}
export interface DashboardDonorDependencyEdgePort {
  readonly from: DashboardDonorComponentId;
  readonly to: DashboardDonorComponentId;
  readonly required: boolean;
  readonly state: 'AVAILABLE' | 'DEGRADED' | 'BLOCKED' | 'UNKNOWN';
  readonly rootBlockerComponentId: DashboardDonorComponentId | null;
  readonly reasonCodes: readonly string[];
}
export interface DashboardDonorTraceDecisionPort {
  readonly eventId: string;
  readonly correlationId: string;
  readonly componentId: DashboardDonorComponentId;
  readonly kind: string;
  readonly occurredAtMs: number;
  readonly truthLabel: DashboardDonorTruthLabel;
  readonly ownerId: string | null;
  readonly canonicalProjectionId: string | null;
  readonly revisionDigest: string | null;
  readonly failureCode: string | null;
  readonly referenceIds: readonly string[];
}
export interface DashboardDonorSupervisorSummariesPort {
  readonly sourceCoverage: Readonly<{ truthLabel: DashboardDonorTruthLabel; universeSymbols: number | null; spotCoveredSymbols: number | null; usdMCoveredSymbols: number | null; quietSymbolsRetained: number | null; materialGapCount: number | null; rateLimitedSourceCount: number | null; lastMaterialGapAtMs: number | null }>;
  readonly strategies: Readonly<Record<'basis' | 'volume', Readonly<{ truthLabel: DashboardDonorTruthLabel; heartbeatAtMs: number | null; candidateCount: number | null; proposalCount: number | null; cooldownCount: number | null; rejectionCount: number | null; acceptedCount: number | null; lastDecisionAtMs: number | null; sourceRevision: string | null }>>>;
  readonly intelligence: Readonly<{ truthLabel: DashboardDonorTruthLabel; evidenceCount: number | null; attentionCount: number | null; focusRequestedCount: number | null; focusActiveCount: number | null; thesisCount: number | null; insufficientEvidenceCount: number | null; lastUpdateAtMs: number | null }>;
  readonly capital: Readonly<{ truthLabel: DashboardDonorTruthLabel; accountTruthState: string; allocatableAmount: string | null; reservedAmount: string | null; activeExposureAmount: string | null; eligibleCount: number | null; reservationCount: number | null; stagedMandateCount: number | null; activeExposureCount: number | null; recoveryCount: number | null; checkpointRevision: string | null; blockerCodes: readonly string[] }>;
  readonly risk: Readonly<{
    truthLabel: DashboardDonorTruthLabel;
    latestVerdict: 'APPROVE' | 'REJECT' | 'NEEDS_REVIEW' | 'CAP' | 'UNAVAILABLE';
    latestVerdictAtMs: number | null;
    latestVerdictId: string | null;
    correlationId: string | null;
    maxAllowedSize: string | null;
    requiredConfirmation: boolean | null;
    decisiveInputSnapshot: readonly Readonly<{
      code: string; status: 'PASS' | 'FAIL' | 'UNKNOWN'; detail: string;
      observed: string | null; limit: string | null; evidenceTimestamp: number | null;
    }>[];
    rejectionCount: number | null;
    reasonCodes: readonly string[];
  }>;
  readonly execution: Readonly<{ truthLabel: DashboardDonorTruthLabel; mode: 'VALIDATE_ONLY' | 'UNAVAILABLE'; barrier: 'LIVE_EXECUTION_NOT_IMPLEMENTED'; planId: string | null; planLifecycle: string | null; coordinatorState: string; legCount: number | null; recoveryState: string | null; lastTransitionAtMs: number | null }>;
  readonly reconciliation: Readonly<{ truthLabel: DashboardDonorTruthLabel; status: string; blocksNewExposure: boolean; recommendation: string | null; checkpointId: string | null; evaluatedAtMs: number | null; reasonCodes: readonly string[] }>;
  readonly ledger: Readonly<{ truthLabel: DashboardDonorTruthLabel; writable: boolean | null; lastEventId: string | null; lastPersistedAtMs: number | null; checkpointRevision: string | null; recentTraceCount: number | null; lastCleanShutdownAtMs: number | null }>;
}
export interface DashboardDonorSupervisorSnapshotPort {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly evaluatedAtMs: number;
  readonly phase: string;
  readonly overallPosture: 'STOPPED' | 'WARMING' | 'READY' | 'DEGRADED' | 'BLOCKED' | 'FAILED';
  readonly truthLabel: DashboardDonorTruthLabel;
  readonly runtimeGeneration: number;
  readonly controlGeneration: number;
  readonly control: Readonly<DashboardDonorControlStatePort>;
  readonly components: readonly Readonly<DashboardDonorComponentSnapshotPort>[];
  readonly edges: readonly Readonly<DashboardDonorDependencyEdgePort>[];
  readonly firstRootBlockerComponentId: DashboardDonorComponentId | null;
  readonly rootBlockerComponentIds: readonly DashboardDonorComponentId[];
  readonly operatorAttentionComponentIds: readonly DashboardDonorComponentId[];
  readonly attentionQueue: readonly Readonly<{ componentId: DashboardDonorComponentId; rootComponentId: DashboardDonorComponentId; severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'; reasonCodes: readonly string[]; capitalExposed: boolean; recommendedOperatorAction: string | null }>[];
  readonly summaries: Readonly<DashboardDonorSupervisorSummariesPort>;
  readonly recentCorrelatedDecisions: readonly Readonly<DashboardDonorTraceDecisionPort>[];
}
export type DashboardDonorControlMutationPort =
  | { readonly command: 'SET_SAFE_MODE'; readonly safeMode: 'READ_ONLY' | 'ADVISORY' | 'VALIDATE_ONLY' }
  | { readonly command: 'SET_KILL_SWITCH'; readonly engaged: boolean }
  | { readonly command: 'SET_INTAKE_PAUSED'; readonly paused: boolean }
  | { readonly command: 'RESTART_COMPONENT'; readonly componentId: DashboardDonorComponentId };
export interface DashboardDonorControlReceiptPort {
  readonly applied: boolean;
  readonly code: string;
  readonly before: Readonly<DashboardDonorControlStatePort>;
  readonly after: Readonly<DashboardDonorControlStatePort>;
  readonly ledgerEventId: number | null;
}
export interface DashboardDonorBridgePort {
  readSnapshot(): ContractResult<Readonly<DashboardDonorSupervisorSnapshotPort>>;
  mutate(input: Readonly<{ mutation: DashboardDonorControlMutationPort; reason: string }>): Promise<ContractResult<Readonly<DashboardDonorControlReceiptPort>>>;
  readLastReceipt(): ContractResult<Readonly<DashboardDonorControlReceiptPort> | null>;
}
