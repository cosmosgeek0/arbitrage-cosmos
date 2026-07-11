import type {
  ApprovalActionClass,
  CapitalMandate,
  CapitalReservation,
  CapitalStage,
  ConfigurationAuthority,
  ExactPolicyBound,
  FutureGate,
  IntegerPolicyBound,
  NonNegativeDecimal,
  OpportunityConsideration,
  StagedExposureStep,
  StagedPlan,
} from '../contracts/index.js';
import type {
  ApprovalPolicyBounds,
  OperatorApprovalState,
  ScopedApprovalValidationContext,
} from '../approvals/index.js';

export interface StagedPlanConfiguration {
  readonly authority: Readonly<ConfigurationAuthority>;
  readonly maximumPlanExposure: Readonly<ExactPolicyBound>;
  readonly maximumPlanDurationMs: Readonly<IntegerPolicyBound>;
  readonly maximumStageDurationMs: Readonly<IntegerPolicyBound>;
  readonly maximumEvidenceAgeMs: Readonly<IntegerPolicyBound>;
  readonly maximumNakedLegAmount: Readonly<ExactPolicyBound>;
  readonly maximumNakedLegDurationMs: Readonly<IntegerPolicyBound>;
}

export interface StagedPlanConfigurationDraft
  extends Omit<StagedPlanConfiguration, 'authority'> {
  readonly sourceId: string;
  readonly issuedAtMs: number;
  readonly effectiveFromMs: number;
  readonly effectiveUntilMs: number | null;
}

export interface NextStageCondition {
  readonly targetStage: CapitalStage;
  readonly conditions: readonly string[];
}

export interface StageSkipCondition {
  readonly targetStage: CapitalStage;
  readonly skippedStages: readonly CapitalStage[];
  readonly conditions: readonly string[];
}

export interface GovernedStagedExposureStep extends StagedExposureStep {
  readonly requiredApprovalActions: readonly ApprovalActionClass[];
  readonly nextStageConditions: readonly Readonly<NextStageCondition>[];
  readonly skipConditions: readonly Readonly<StageSkipCondition>[];
  readonly unenteredCancellationConditions: readonly string[];
}

export interface GovernedStagedPlan extends StagedPlan {
  readonly stages: readonly Readonly<GovernedStagedExposureStep>[];
  readonly configRevision: ConfigurationAuthority['revision'];
  readonly proposalIntakeDigest: string;
  readonly valuationAsset: string;
  readonly reservationRevision: number;
  readonly reservationConsiderationId: CapitalReservation['considerationId'];
}

export interface BuildStagedPlanInput {
  readonly reservation: Readonly<CapitalReservation>;
  readonly proposalIntakeDigest: string;
  readonly valuationAsset: string;
  readonly configuration: Readonly<StagedPlanConfiguration>;
  readonly stages: readonly Readonly<GovernedStagedExposureStep>[];
  readonly activeStage: CapitalStage;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly correlationId: string;
}

export interface ReviseStagedPlanInput extends Omit<BuildStagedPlanInput, 'proposalIntakeDigest' | 'valuationAsset' | 'createdAtMs'> {
  readonly current: Readonly<GovernedStagedPlan>;
  readonly currentConfiguration: Readonly<StagedPlanConfiguration>;
  readonly completedStages: readonly CapitalStage[];
  readonly currentTotalExposure: NonNegativeDecimal;
  readonly revisedAtMs: number;
}

export interface StagedPlanRevisionReceipt {
  readonly plan: Readonly<GovernedStagedPlan>;
  readonly cancelledUnenteredStages: readonly CapitalStage[];
  readonly revisedAtMs: number;
}

export interface StageEvidenceObservation {
  readonly code: string;
  readonly observedAtMs: number;
  readonly available: boolean;
}

export interface ScopedStageApproval {
  /** Current revisioned approval state owned by the approvals lane. */
  readonly state: Readonly<OperatorApprovalState>;
  /** Exact context evaluated again by the public approvals policy. */
  readonly context: Readonly<ScopedApprovalValidationContext>;
  /** Content-addressed approval bounds used by that evaluation. */
  readonly policy: Readonly<ApprovalPolicyBounds>;
  /** Concrete mandate whose identity and digest the approval must bind. */
  readonly mandate: Readonly<CapitalMandate>;
}

export interface FutureRiskRecheckBinding {
  readonly required: boolean;
  readonly owner: 'FOUNDATION_MULTI_LEG_RISK';
  readonly stagedPlanId: string;
  readonly stagedPlanRevision: number;
  readonly stagedPlanDigest: string;
}

export interface EvaluateStageTransitionInput {
  readonly plan: Readonly<GovernedStagedPlan>;
  readonly configuration: Readonly<StagedPlanConfiguration>;
  readonly to: CapitalStage;
  readonly stageEnteredAtMs: number;
  readonly nowMs: number;
  readonly correlationId: string;
  readonly currentTotalExposure: NonNegativeDecimal;
  readonly requestedAdditionalExposure: NonNegativeDecimal;
  readonly reservation: Readonly<CapitalReservation> | null;
  readonly reservationValidatedAtMs: number | null;
  readonly evidence: readonly Readonly<StageEvidenceObservation>[];
  readonly satisfiedThesisConditions: readonly string[];
  readonly triggeredInvalidationConditions: readonly string[];
  readonly triggeredStopAddingConditions: readonly string[];
  readonly satisfiedTransitionConditions: readonly string[];
  readonly availableLiquidityDepth: NonNegativeDecimal | null;
  readonly proposedNakedLegAmount: NonNegativeDecimal;
  readonly proposedNakedLegDurationMs: number;
  readonly approval: Readonly<ScopedStageApproval> | null;
  readonly futureRiskRecheck: Readonly<FutureRiskRecheckBinding> | null;
  readonly adversePriceMoveIsSoleReason: boolean;
}

export interface StageTransitionAuthorization {
  readonly from: CapitalStage;
  readonly to: CapitalStage;
  readonly authorizedForExternalRiskEvaluation: boolean;
  readonly executionReady: false;
  readonly reservationConsumption: NonNegativeDecimal;
  readonly requiredFutureGates: readonly FutureGate[];
  readonly evaluatedAtMs: number;
  readonly planId: string;
  readonly planRevision: number;
  readonly planDigest: string;
  readonly reservationId: string | null;
  readonly reservationRevision: number | null;
  readonly reservationAvailable: NonNegativeDecimal | null;
  readonly approvalId: string | null;
  readonly approvalRevision: number | null;
}

export interface BuildCapitalMandateInput {
  readonly consideration: Readonly<OpportunityConsideration>;
  readonly allocationDecisionId: CapitalMandate['allocationDecisionId'];
  readonly reservation: Readonly<CapitalReservation>;
  readonly plan: Readonly<GovernedStagedPlan>;
  readonly configuration: Readonly<StagedPlanConfiguration>;
  readonly targetMaximumExposure: NonNegativeDecimal;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly correlationId: string;
}

export interface ReviseCapitalMandateInput {
  readonly current: Readonly<CapitalMandate>;
  readonly plan: Readonly<GovernedStagedPlan>;
  readonly configuration: Readonly<StagedPlanConfiguration>;
  readonly proposalIntakeDigest: string;
  readonly targetMaximumExposure: NonNegativeDecimal;
  readonly revisedAtMs: number;
  readonly expiresAtMs: number;
  readonly correlationId: string;
}
