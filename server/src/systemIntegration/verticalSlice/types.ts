import type {
  ApprovalActionClass,
  BoundRiskDecisionReference,
  CapitalMandate,
  CapitalReservation,
  ControlPostureSnapshot,
  NonNegativeDecimal,
  OperatorApproval,
  SourcedTimestamp,
  StrategyProposalReference,
  StructuredFailure,
} from '../../capitalFoundation/contracts/index.js';
import type {
  ApprovalAuthorityDecision,
  ApprovalPolicyBounds,
  OperatorApprovalState,
} from '../../capitalFoundation/approvals/index.js';
import type { GovernedStagedPlan } from '../../capitalFoundation/stages/index.js';
import type { CanonicalProposal, RiskVerdict } from '../../foundation/contracts/index.js';
import type {
  ExecutionPlanDefinition,
  ExecutionPlanState,
} from '../../foundation/execution/index.js';
import type {
  RiskEvaluationInput,
} from '../../foundation/risk/index.js';
import type {
  ObservedEvidenceInput,
  ReconciliationPolicy,
  ReconciliationResult,
} from '../../foundation/reconciliation/index.js';
import type {
  SystemReleaseStatus,
  SystemTruthLabel,
} from '../contracts/constants.js';

/**
 * Capital's existing allocator requires this local envelope before it will
 * produce a reservation. Integration may consume the resulting owner record,
 * but it may never manufacture or reinterpret that envelope as execution
 * authority.
 */
export interface OwnerSuppliedCapitalReservationDialect {
  readonly owner: 'CAPITAL_SUPERVISION';
  readonly considerationMode: 'MANUAL_ARMED';
  readonly source: 'OWNER_SUPPLIED_PREBUILT';
  readonly syntheticOnly: true;
  readonly executionAuthority: 'NONE';
}

export interface ValidateOnlyCapitalBundle {
  readonly sourceProposal: Readonly<StrategyProposalReference>;
  readonly reservation: Readonly<CapitalReservation>;
  readonly stagedPlan: Readonly<GovernedStagedPlan>;
  readonly mandate: Readonly<CapitalMandate>;
  readonly approval: Readonly<OperatorApproval>;
  /** Revisioned Capital owner state; callers must restore it across retries/restarts. */
  readonly approvalState: Readonly<OperatorApprovalState>;
  readonly approvalPolicy: Readonly<ApprovalPolicyBounds>;
  readonly controlPosture: Readonly<ControlPostureSnapshot>;
  readonly approvalObservedAt: Readonly<SourcedTimestamp>;
  readonly reservationDialect: Readonly<OwnerSuppliedCapitalReservationDialect>;
}

export interface ValidateOnlyApprovalUse {
  readonly actionClass: ApprovalActionClass;
  readonly stage: string | null;
  readonly instrumentIds: readonly string[];
  readonly idempotencyKey: string;
}

export interface ValidateOnlyLegTerms {
  readonly intendedPrice: number;
  readonly quantity: number;
  /** Exact Capital-side quote amount retained beside the binary64 projection. */
  readonly quoteNotional: NonNegativeDecimal;
  readonly estimatedRequiredMarginUsd: number | null;
}

export interface ValidateOnlyExecutionTerms {
  readonly accountId: string;
  readonly attempt: number;
  readonly maxNakedDurationMs: number;
  readonly spot: Readonly<ValidateOnlyLegTerms>;
  readonly perpetual: Readonly<ValidateOnlyLegTerms>;
  readonly estimatedRequiredMarginUsd: number | null;
  readonly requiredBorrowUsd: number | null;
}

/** Risk owner input excluding facts integration must derive and bind itself. */
export type ValidateOnlyRiskEvidence = Omit<
  RiskEvaluationInput,
  'nowMs' | 'intent' | 'proposal' | 'approval'
>;

export interface ValidateOnlySupervisionInput {
  /** Correlation of the already-existing plan, kept distinct from this validation root. */
  readonly rootCorrelationId: string;
  readonly state: Readonly<ExecutionPlanState>;
  readonly truthLabel: 'SYNTHETIC_ONLY';
  readonly executionAuthority: 'NONE';
}

export interface ValidateOnlySupervisionProjection {
  readonly rootCorrelationId: string;
  readonly executionCorrelationId: string;
  readonly planId: string;
  readonly truthLabel: 'SYNTHETIC_ONLY';
  readonly executionAuthority: 'NONE';
  readonly state: Readonly<ExecutionPlanState>;
  readonly reconciliation: Readonly<ReconciliationResult> | null;
}

export interface ValidateOnlyRiskPlanBinding {
  readonly planId: string;
  readonly executionCorrelationId: string;
  readonly foundationTermsFingerprint: string;
  readonly riskDecisionId: string;
  readonly mandateDigest: string;
  readonly riskIntentDigest: string;
  readonly executionTermsDigest: string;
}

export interface ValidateOnlyOrchestratorInput {
  /** Deliberately string-typed so every future/live spelling can fail closed. */
  readonly requestedMode: string;
  readonly nowMs: number;
  readonly correlationId: string;
  readonly canonicalProposal: Readonly<CanonicalProposal>;
  readonly capital: Readonly<ValidateOnlyCapitalBundle>;
  readonly approvalUse: Readonly<ValidateOnlyApprovalUse>;
  readonly executionTerms: Readonly<ValidateOnlyExecutionTerms>;
  readonly riskEvidence: Readonly<ValidateOnlyRiskEvidence>;
  /** Optional separately correlated prior Foundation state that remains observable when new risk is blocked. */
  readonly supervision: Readonly<ValidateOnlySupervisionInput> | null;
  readonly reconciliationEvidence: Readonly<ObservedEvidenceInput>;
  readonly reconciliationPolicy: Readonly<ReconciliationPolicy>;
}

export type ValidateOnlyDisposition =
  | 'MODE_BLOCKED'
  | 'INPUT_REJECTED'
  | 'APPROVAL_REJECTED'
  | 'RISK_REJECTED'
  | 'EXECUTION_PREFLIGHT_REJECTED'
  | 'RECONCILIATION_BLOCKED'
  | 'PERSISTENCE_FAILED'
  | 'READY';

export interface ValidateOnlyOwnerInvocations {
  readonly approvalEvaluations: number;
  readonly approvalUseReductions: number;
  readonly riskEvaluations: number;
  readonly executionDefinitionsCreated: number;
  readonly coordinatorsCreated: number;
  readonly coordinatorPreflights: number;
  readonly reconciliationEvaluations: number;
  readonly persistenceReads: number;
  readonly persistenceWrites: number;
}

export interface ValidateOnlyVenueAudit {
  readonly sealed: boolean;
  readonly identityClaims: number;
  readonly preflightCalls: number;
  readonly validationCalls: number;
  readonly submissionCalls: number;
  readonly lookupCalls: number;
  readonly reconciliationCalls: number;
  readonly callOrder: readonly string[];
}

export interface ValidateOnlyRunSnapshot {
  readonly schema: 'cosmos.system-integration.validate-only.v1';
  readonly recordId: string;
  readonly disposition: ValidateOnlyDisposition;
  readonly rootCorrelationId: string;
  readonly executionCorrelationId: string | null;
  readonly evaluatedAtMs: number;
  readonly operatorMode: 'VALIDATE_ONLY';
  readonly capitalReservationDialect: 'OWNER_SUPPLIED_MANUAL_ARMED_ENVELOPE' | 'UNAVAILABLE_OR_UNVALIDATED';
  readonly executionAuthority: 'NONE';
  readonly liveExecutionPermitted: false;
  readonly truthLabels: readonly SystemTruthLabel[];
  readonly releaseStatuses: readonly SystemReleaseStatus[];
  readonly canonicalProposalId: string;
  readonly sourceProposalId: string;
  readonly reservationId: string;
  readonly stagedPlanId: string;
  readonly mandateId: string;
  readonly approvalId: string;
  readonly approvalDecision: Readonly<ApprovalAuthorityDecision> | null;
  readonly approvalState: Readonly<OperatorApprovalState> | null;
  readonly riskVerdict: Readonly<RiskVerdict> | null;
  readonly boundRiskDecision: Readonly<BoundRiskDecisionReference> | null;
  readonly riskPlanBinding: Readonly<ValidateOnlyRiskPlanBinding> | null;
  readonly executionPlan: Readonly<ExecutionPlanDefinition> | null;
  readonly executionState: Readonly<ExecutionPlanState> | null;
  readonly reconciliation: Readonly<ReconciliationResult> | null;
  readonly supervision: Readonly<ValidateOnlySupervisionProjection> | null;
  readonly failure: Readonly<StructuredFailure> | null;
  readonly ownerInvocations: Readonly<ValidateOnlyOwnerInvocations>;
  readonly venueAudit: Readonly<ValidateOnlyVenueAudit>;
  readonly persistenceId: string | null;
}

export interface ValidateOnlyRunResult {
  readonly ok: boolean;
  readonly snapshot: Readonly<ValidateOnlyRunSnapshot>;
}

export interface ValidateOnlyPersistenceRecord
  extends Omit<ValidateOnlyRunSnapshot, 'persistenceId'> {}

export interface ValidateOnlyPersistencePort {
  loadValidateOnlyApprovalState(
    approvalId: string,
  ): Promise<Readonly<OperatorApprovalState> | null>;
  persistValidateOnly(
    record: Readonly<ValidateOnlyPersistenceRecord>,
  ): Promise<Readonly<{ persistenceId: string }>>;
}
