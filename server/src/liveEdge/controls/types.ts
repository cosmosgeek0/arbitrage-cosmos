import type {
  ContractResult,
  ControlCommand,
  DesiredRuntimeState,
  RuntimePhase,
} from '../../foundation/contracts/index.js';

export const DURABLE_CONTROL_SCHEMA = 'LIVE_EDGE_DURABLE_CONTROL_V1' as const;
export const DURABLE_CONTROL_PREVIEW_SCHEMA = 'LIVE_EDGE_CONTROL_PREVIEW_V1' as const;
export const DURABLE_CONTROL_EVENT_SCHEMA = 'LIVE_EDGE_CONTROL_EVENT_V1' as const;
export const DURABLE_CONTROL_ACK_SCHEMA = 'LIVE_EDGE_CONTROL_EVENT_ACK_V1' as const;
export const OPAQUE_OWNER_REFERENCE_SCHEMA = 'LIVE_EDGE_OPAQUE_OWNER_REFERENCE_V1' as const;

export const DURABLE_CONTROL_ACTION_TYPES = Object.freeze([
  'SET_COMPONENT_DESIRED_STATE',
  'PAUSE_INTAKE',
  'RESUME_INTAKE',
  'UPDATE_BOUNDED_CONFIGURATION',
  'APPROVE',
  'ARM',
  'DISARM',
  'REARM',
  'REVOKE',
  'HALT',
  'RECONCILE',
  'CANCEL',
  'CLOSE',
  'REDUCE',
  'EXECUTE_PRECOMPUTED_RECOVERY_PLAN',
  'REPAY_LIABILITY',
  'SAFE_RESTART_COMPONENT',
  'ACKNOWLEDGE_RECOVERY',
] as const);
export type DurableControlActionType = (typeof DURABLE_CONTROL_ACTION_TYPES)[number];

export const CONTROL_REASON_CODES = Object.freeze([
  'CONTROL_APPLIED',
  'CONTROL_NOOP',
  'AWARENESS_RECORDED',
  'INVALID_CONTROL_REQUEST',
  'STRICT_SCHEMA_VIOLATION',
  'SENSITIVE_MATERIAL_REJECTED',
  'AUTHENTICATED_OPERATOR_REQUIRED',
  'OPERATOR_IDENTITY_INVALID',
  'OPERATOR_MISMATCH',
  'PREVIEW_AUTHORITY_UNAVAILABLE',
  'PREVIEW_AUTHORITY_INVALID',
  'PREVIEW_DIGEST_MISMATCH',
  'PREVIEW_AUTHENTICATION_FAILED',
  'COMMAND_EXPIRED',
  'STALE_CONFIG_VERSION',
  'STALE_CONTROL_REVISION',
  'IDEMPOTENCY_CONFLICT',
  'COMMAND_IN_PROGRESS',
  'PERSISTENCE_UNAVAILABLE',
  'PERSISTENCE_ACK_INVALID',
  'COMMAND_OUTCOME_UNCERTAIN',
  'OWNER_SNAPSHOT_UNAVAILABLE',
  'OWNER_SNAPSHOT_INVALID',
  'OWNER_REJECTED',
  'OWNER_CONTRACT_INVALID',
  'COMMAND_NOT_APPLICABLE',
  'KILL_SWITCH_ENGAGED',
  'RECOVERY_REQUIRED',
  'RECOVERY_STATE_UNKNOWN',
  'EXCHANGE_TRUTH_UNAVAILABLE',
  'EXCHANGE_TRUTH_STALE',
  'EXCHANGE_TRUTH_INCOMPLETE',
  'EXCHANGE_TRUTH_MISMATCH',
  'RISK_OWNER_UNAVAILABLE',
  'RISK_OWNER_CONTRACT_INVALID',
  'RISK_INCREASE_FORBIDDEN',
  'WAITING_L08',
  'CONFIGURATION_OWNER_NOT_WIRED',
  'APPROVAL_OWNER_NOT_WIRED',
  'LIVE_EXECUTION_NOT_IMPLEMENTED',
] as const);
export type ControlReasonCode = (typeof CONTROL_REASON_CODES)[number];

export const OPAQUE_REFERENCE_OWNERS = Object.freeze([
  'FOUNDATION_CONTROL',
  'FOUNDATION_EXECUTION',
  'FOUNDATION_RECONCILIATION',
  'FOUNDATION_RISK',
  'CAPITAL_APPROVALS',
  'CAPITAL_RESERVATIONS',
  'CAPITAL_POSITIONS',
  'L06_MUTATION_JOURNAL',
  'L08_RECOVERY',
] as const);
export type OpaqueReferenceOwner = (typeof OPAQUE_REFERENCE_OWNERS)[number];

export interface OpaqueOwnerReferenceV1 {
  readonly schema: typeof OPAQUE_OWNER_REFERENCE_SCHEMA;
  readonly owner: OpaqueReferenceOwner;
  readonly id: string;
  readonly revision: string;
  readonly digest: string;
}

export interface WaitingL08ReferenceV1 extends OpaqueOwnerReferenceV1 {
  readonly owner: 'L08_RECOVERY';
  readonly validation: 'WAITING_L08';
}

export interface ComponentTargetV1 extends OpaqueOwnerReferenceV1 {
  readonly owner: 'FOUNDATION_CONTROL';
}

export interface RiskBoundDeclarationV1 {
  readonly measure: OpaqueOwnerReferenceV1 & { readonly owner: 'FOUNDATION_RISK' };
  readonly maximumPostActionValue: string;
}

export type BoundedConfigurationChangeV1 =
  | {
      readonly setting: 'COMPONENT_STEP_TIMEOUT_MS';
      readonly component: ComponentTargetV1;
      readonly valueMs: number;
    }
  | {
      readonly setting: 'PREFLIGHT_GATE_TIMEOUT_MS';
      readonly gateId: string;
      readonly valueMs: number;
    }
  | {
      readonly setting: 'SOURCE_STALE_AFTER_MS';
      readonly sourceId: string;
      readonly valueMs: number;
    };

export interface SetComponentDesiredStateAction {
  readonly type: 'SET_COMPONENT_DESIRED_STATE';
  readonly component: ComponentTargetV1;
  readonly desiredState: DesiredRuntimeState;
}

export interface PauseIntakeAction {
  readonly type: 'PAUSE_INTAKE';
  readonly scope: 'NEW_RISK';
}

export interface ResumeIntakeAction {
  readonly type: 'RESUME_INTAKE';
  readonly scope: 'NEW_RISK';
  readonly reconciliation: OpaqueOwnerReferenceV1 & { readonly owner: 'FOUNDATION_RECONCILIATION' };
}

export interface UpdateBoundedConfigurationAction {
  readonly type: 'UPDATE_BOUNDED_CONFIGURATION';
  readonly change: BoundedConfigurationChangeV1;
}

export interface ApproveAction {
  readonly type: 'APPROVE';
  readonly proposal: OpaqueOwnerReferenceV1;
  readonly approvalPolicy: WaitingL08ReferenceV1;
  readonly mode: 'VALIDATE_ONLY';
}

export interface ArmAction {
  readonly type: 'ARM';
  readonly approval: OpaqueOwnerReferenceV1 & { readonly owner: 'CAPITAL_APPROVALS' };
  readonly armingPolicy: WaitingL08ReferenceV1;
  readonly mode: 'VALIDATE_ONLY';
}

export interface DisarmAction {
  readonly type: 'DISARM';
  readonly arm: OpaqueOwnerReferenceV1 & { readonly owner: 'CAPITAL_APPROVALS' };
  readonly cause: 'OPERATOR_REQUEST' | 'SAFETY';
}

export interface RearmAction {
  readonly type: 'REARM';
  readonly priorArm: OpaqueOwnerReferenceV1 & { readonly owner: 'CAPITAL_APPROVALS' };
  readonly approval: OpaqueOwnerReferenceV1 & { readonly owner: 'CAPITAL_APPROVALS' };
  readonly armingPolicy: WaitingL08ReferenceV1;
  readonly mode: 'VALIDATE_ONLY';
}

export interface RevokeAction {
  readonly type: 'REVOKE';
  readonly targetKind: 'APPROVAL' | 'RESERVATION' | 'ARM';
  readonly target: OpaqueOwnerReferenceV1;
}

export interface HaltAction {
  readonly type: 'HALT';
  readonly scope: 'NEW_RISK';
  readonly retainSupervision: true;
}

export interface ReconcileAction {
  readonly type: 'RECONCILE';
  readonly scope: 'ACCOUNT_AND_EXCHANGE';
  readonly target: OpaqueOwnerReferenceV1 & { readonly owner: 'FOUNDATION_RECONCILIATION' };
}

export interface CancelAction {
  readonly type: 'CANCEL';
  readonly order: OpaqueOwnerReferenceV1 & { readonly owner: 'L06_MUTATION_JOURNAL' };
  readonly orderPolicy: WaitingL08ReferenceV1;
  readonly riskBound: RiskBoundDeclarationV1;
}

export interface CloseAction {
  readonly type: 'CLOSE';
  readonly position: OpaqueOwnerReferenceV1 & { readonly owner: 'CAPITAL_POSITIONS' };
  readonly orderPolicy: WaitingL08ReferenceV1;
  readonly riskBound: RiskBoundDeclarationV1;
}

export interface ReduceAction {
  readonly type: 'REDUCE';
  readonly position: OpaqueOwnerReferenceV1 & { readonly owner: 'CAPITAL_POSITIONS' };
  readonly reductionBps: number;
  readonly orderPolicy: WaitingL08ReferenceV1;
  readonly riskBound: RiskBoundDeclarationV1;
}

export interface ExecutePrecomputedRecoveryPlanAction {
  readonly type: 'EXECUTE_PRECOMPUTED_RECOVERY_PLAN';
  readonly recoveryPlan: WaitingL08ReferenceV1;
  readonly riskBound: RiskBoundDeclarationV1;
}

export interface RepayLiabilityAction {
  readonly type: 'REPAY_LIABILITY';
  readonly liability: OpaqueOwnerReferenceV1;
  readonly repaymentPolicy: WaitingL08ReferenceV1;
  readonly riskBound: RiskBoundDeclarationV1;
}

export interface SafeRestartComponentAction {
  readonly type: 'SAFE_RESTART_COMPONENT';
  readonly component: ComponentTargetV1;
  readonly restartMode: 'SAFE_RECONCILE_FIRST';
}

export interface AcknowledgeRecoveryAction {
  readonly type: 'ACKNOWLEDGE_RECOVERY';
  readonly recovery: OpaqueOwnerReferenceV1 & { readonly owner: 'FOUNDATION_EXECUTION' };
  readonly observedRecoveryRevision: string;
  readonly statement: 'AWARENESS_ONLY';
}

export type DurableControlAction =
  | SetComponentDesiredStateAction
  | PauseIntakeAction
  | ResumeIntakeAction
  | UpdateBoundedConfigurationAction
  | ApproveAction
  | ArmAction
  | DisarmAction
  | RearmAction
  | RevokeAction
  | HaltAction
  | ReconcileAction
  | CancelAction
  | CloseAction
  | ReduceAction
  | ExecutePrecomputedRecoveryPlanAction
  | RepayLiabilityAction
  | SafeRestartComponentAction
  | AcknowledgeRecoveryAction;

export interface ControlPreviewRequest {
  readonly schema: typeof DURABLE_CONTROL_SCHEMA;
  readonly version: 1;
  readonly action: DurableControlAction;
  readonly expectedConfigVersion: number;
  readonly reason: string;
  readonly ttlMs: number;
}

export interface AuthenticatedOperatorIdentity {
  readonly authenticated: true;
  readonly subjectId: string;
  readonly sessionId: string;
  readonly source: 'LOOPBACK' | 'CLOUDFLARE_ACCESS';
  readonly audience: 'L14_DURABLE_CONTROLS';
  readonly authenticatedAtMs: number;
  readonly expiresAtMs: number;
}

export interface ControlPlaneSnapshot {
  readonly configVersion: number;
  readonly controlRevision: number;
  readonly recoveryState: 'CLEAR' | 'RECOVERY_REQUIRED' | 'RECONCILING' | 'UNKNOWN';
  readonly halted: boolean;
  readonly intakePaused: boolean;
  readonly observedAtMs: number;
  readonly foundationRuntime: Readonly<{
    readonly revision: number;
    readonly desiredState: DesiredRuntimeState;
    readonly phase: RuntimePhase;
  }>;
}

export interface ExchangeTruthSnapshotV1 {
  readonly status: 'CURRENT_COMPLETE' | 'STALE' | 'PARTIAL' | 'DIVERGED' | 'UNAVAILABLE';
  readonly truthRevision: string;
  readonly accountRealmId: string;
  readonly observedAtMs: number;
  readonly riskMeasure: Readonly<{
    readonly definition: OpaqueOwnerReferenceV1 & { readonly owner: 'FOUNDATION_RISK' };
    readonly value: string;
  }>;
}

export interface PreviewRiskWitnessV1 {
  readonly truthRevision: string;
  readonly measureRevision: string;
  readonly currentValue: string;
  readonly maximumPostActionValue: string;
  readonly evaluatedAtMs: number;
  readonly authority: 'FOUNDATION_RISK';
}

export interface DurableControlPreview {
  readonly schema: typeof DURABLE_CONTROL_PREVIEW_SCHEMA;
  readonly version: 1;
  readonly commandId: string;
  readonly action: DurableControlAction;
  readonly actionDigest: string;
  readonly expectedConfigVersion: number;
  readonly expectedControlRevision: number;
  readonly actorBinding: string;
  readonly reason: string;
  readonly generatedAtMs: number;
  readonly expiresAtMs: number;
  readonly riskWitness: Readonly<PreviewRiskWitnessV1> | null;
  readonly previewDigest: string;
  readonly authorizationTag: string;
  readonly externalActionAuthorization: 'NONE';
}

export interface ControlSubmissionRequest {
  readonly schema: typeof DURABLE_CONTROL_SCHEMA;
  readonly version: 1;
  readonly preview: DurableControlPreview;
}

export interface ControlCommandReceipt {
  readonly schema: 'LIVE_EDGE_CONTROL_RECEIPT_V1';
  readonly version: 1;
  readonly commandId: string;
  readonly previewDigest: string;
  readonly actionType: DurableControlActionType;
  readonly disposition: 'APPLIED' | 'NOOP' | 'AWARENESS_RECORDED';
  readonly reasonCode: ControlReasonCode;
  readonly actorBinding: string;
  readonly expectedConfigVersion: number;
  readonly committedControlRevision: number;
  readonly applied: boolean;
  readonly recordedAtMs: number;
  readonly ledgerEventIds: readonly [number, number];
  readonly recoveryStateChanged: false;
  readonly externalActionAuthorization: 'NONE';
}

export type ControlPreviewResult = ContractResult<Readonly<DurableControlPreview>>;
export type ControlSubmissionResult = ContractResult<Readonly<ControlCommandReceipt>>;

export interface ControlEventBase {
  readonly schema: typeof DURABLE_CONTROL_EVENT_SCHEMA;
  readonly version: 1;
  readonly commandId: string;
  readonly previewDigest: string;
  readonly actionType: DurableControlActionType;
  readonly actorBinding: string;
  readonly expectedConfigVersion: number;
  readonly expectedControlRevision: number;
  readonly occurredAtMs: number;
  readonly eventId: string;
  readonly contentDigest: string;
  readonly externalActionAuthorization: 'NONE';
}

export interface ControlIntentCommittedEvent extends ControlEventBase {
  readonly kind: 'CONTROL_INTENT_COMMITTED';
  readonly action: DurableControlAction;
  readonly expiresAtMs: number;
  readonly decisionCode: ControlReasonCode;
  readonly riskWitness: Readonly<PreviewRiskWitnessV1> | null;
}

export interface ControlAppliedEvent extends ControlEventBase {
  readonly kind: 'CONTROL_APPLIED';
  readonly applied: boolean;
  readonly reasonCode: ControlReasonCode;
  readonly recoveryStateChanged: false;
}

export interface ControlAwarenessRecordedEvent extends ControlEventBase {
  readonly kind: 'CONTROL_AWARENESS_RECORDED';
  readonly recoveryRevision: string;
  readonly awarenessOnly: true;
  readonly recoveryStateChanged: false;
  readonly reasonCode: 'AWARENESS_RECORDED';
}

export interface ControlRejectedEvent extends ControlEventBase {
  readonly kind: 'CONTROL_REJECTED';
  readonly reasonCode: ControlReasonCode;
  readonly redacted: true;
  /** False for a security audit that must not reserve the command ID. */
  readonly intentCommitted: boolean;
  readonly recoveryStateChanged: false;
}

export type DurableControlEvent =
  | ControlIntentCommittedEvent
  | ControlAppliedEvent
  | ControlAwarenessRecordedEvent
  | ControlRejectedEvent;

export interface ControlEventAppendRequest {
  readonly ownerTarget: 'SYSTEM_INTEGRATION_LEDGER';
  readonly event: Readonly<DurableControlEvent>;
  readonly idempotencyKey: string;
  readonly appendRequestDigest: string;
  readonly expectedJournalVersion: number;
  readonly previousHeadDigest: string | null;
  readonly nextHeadDigest: string;
  readonly externalActionAuthorization: 'NONE';
}

export interface ControlEventAppendAcknowledgement {
  readonly schema: typeof DURABLE_CONTROL_ACK_SCHEMA;
  readonly version: 1;
  readonly owner: 'SYSTEM_INTEGRATION_LEDGER';
  readonly disposition:
    | 'COMMITTED_NEW'
    | 'IDEMPOTENT_REPLAY'
    | 'IDEMPOTENCY_CONFLICT'
    | 'VERSION_CONFLICT'
    | 'EXPIRED'
    | 'FAILED';
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
  readonly failureCode: ControlReasonCode | null;
  readonly externalActionAuthorization: 'NONE';
}

export type ControlCommandLookup =
  | { readonly kind: 'NOT_FOUND'; readonly journalVersion: 0; readonly headDigest: null }
  | {
      readonly kind: 'PENDING';
      readonly previewDigest: string;
      readonly actorBinding: string;
      readonly journalVersion: number;
      readonly headDigest: string;
    }
  | {
      readonly kind: 'COMPLETED';
      readonly previewDigest: string;
      readonly actorBinding: string;
      readonly journalVersion: number;
      readonly headDigest: string;
      readonly receipt: Readonly<ControlCommandReceipt>;
    }
  | {
      readonly kind: 'REJECTED';
      readonly previewDigest: string;
      readonly actorBinding: string;
      readonly journalVersion: number;
      readonly headDigest: string;
      readonly rejection: Readonly<ControlCommandRejectionReceipt>;
    };

export interface ControlCommandRejectionReceipt {
  readonly schema: 'LIVE_EDGE_CONTROL_REJECTION_RECEIPT_V1';
  readonly version: 1;
  readonly commandId: string;
  readonly previewDigest: string;
  readonly actionType: DurableControlActionType;
  readonly actorBinding: string;
  readonly reasonCode: ControlReasonCode;
  readonly expectedConfigVersion: number;
  readonly committedControlRevision: number;
  readonly recordedAtMs: number;
  readonly ledgerEventIds: readonly [number, number];
  readonly recoveryStateChanged: false;
  readonly externalActionAuthorization: 'NONE';
}

export interface CanonicalControlPersistencePort {
  lookup(commandId: string): Promise<Readonly<ControlCommandLookup>>;
  append(request: Readonly<ControlEventAppendRequest>): Promise<Readonly<ControlEventAppendAcknowledgement>>;
}

export interface OperatorIdentityPort {
  resolve(): Promise<Readonly<AuthenticatedOperatorIdentity> | null>;
}

export interface InjectedClockPort {
  nowMs(): number;
}

export interface PreviewAuthorityPort {
  mintCommandId(seedDigest: string): Promise<string>;
  seal(previewDigest: string, actorBinding: string): Promise<string>;
  verify(previewDigest: string, actorBinding: string, authorizationTag: string): Promise<boolean>;
}

export interface CanonicalControlStatePort {
  read(): Promise<Readonly<ControlPlaneSnapshot>>;
}

export interface ExchangeTruthPort {
  read(action: Readonly<DurableControlAction>): Promise<Readonly<ExchangeTruthSnapshotV1>>;
}

export interface RiskOwnerDecision {
  readonly allowed: boolean;
  readonly reasonCode: 'CONTROL_APPLIED' | 'RISK_INCREASE_FORBIDDEN' | 'EXCHANGE_TRUTH_MISMATCH';
  readonly projectedPostActionValue: string;
  readonly measureRevision: string;
  readonly evaluatedAtMs: number;
  readonly authority: 'FOUNDATION_RISK';
}

export interface RiskOwnerPort {
  preview(
    action: Readonly<DurableControlAction>,
    truth: Readonly<ExchangeTruthSnapshotV1>,
    nowMs: number,
  ): Promise<Readonly<PreviewRiskWitnessV1>>;
  recheck(
    action: Readonly<DurableControlAction>,
    preview: Readonly<PreviewRiskWitnessV1>,
    truth: Readonly<ExchangeTruthSnapshotV1>,
    nowMs: number,
  ): Promise<Readonly<RiskOwnerDecision>>;
}

export interface CanonicalOwnerInspection {
  readonly accepted: boolean;
  readonly reasonCode: ControlReasonCode;
  readonly riskIncreasing: boolean;
}

export interface CanonicalOwnerApplication {
  readonly accepted: boolean;
  readonly applied: boolean;
  readonly reasonCode: ControlReasonCode;
  readonly evaluatedAtMs: number;
  readonly deadlineAtMs: number;
  readonly deadlineHonored: true;
  readonly observedConfigVersion: number;
  readonly observedControlRevision: number;
}

export interface CanonicalControlOwnerPort {
  inspect(
    action: Readonly<DurableControlAction>,
    snapshot: Readonly<ControlPlaneSnapshot>,
  ): Promise<Readonly<CanonicalOwnerInspection>>;
  publishCommitted(
    action: Readonly<DurableControlAction>,
    context: Readonly<{
      commandId: string;
      previewDigest: string;
      actorBinding: string;
      committedAtMs: number;
      invokedAtMs: number;
      expiresAtMs: number;
      expectedConfigVersion: number;
      committedControlRevision: number;
    }>,
  ): Promise<Readonly<CanonicalOwnerApplication>>;
}

/** Exact accepted Foundation Control Plane seam; L14 never owns lifecycle state. */
export interface FoundationControlPlanePort {
  issue(request: Readonly<{
    readonly command: ControlCommand;
    readonly revision: number;
    readonly nowMs: number;
  }>): ContractResult<Readonly<{
    readonly commandId: string;
    readonly correlationId: string;
    readonly command: ControlCommand;
    readonly revision: number;
    readonly applied: boolean;
    readonly detail: string;
  }>>;
}

export interface DurableControlAdapterDependencies {
  readonly clock: InjectedClockPort;
  readonly identity: OperatorIdentityPort;
  readonly previewAuthority: PreviewAuthorityPort;
  readonly state: CanonicalControlStatePort;
  readonly exchangeTruth: ExchangeTruthPort;
  readonly risk: RiskOwnerPort;
  readonly persistence: CanonicalControlPersistencePort;
  readonly owner: CanonicalControlOwnerPort;
  readonly foundation: FoundationControlPlanePort;
}
