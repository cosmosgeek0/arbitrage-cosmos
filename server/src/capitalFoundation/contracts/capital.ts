import type { RiskCheck, RiskVerdict } from '../../foundation/contracts/index.js';
import type { CapitalStage } from './lifecycle.js';
import { compareExactDecimals, type ExactDecimal, type NonNegativeDecimal } from './decimal.js';
import type {
  AllocationDecisionId,
  CapitalMandateId,
  CapitalReservationId,
  ConfigRevisionId,
  OpportunityConsiderationId,
  OperatorApprovalId,
  StagedPlanId,
} from './identity.js';
import { capitalDigest } from './identity.js';
import type { FutureGate } from './actions.js';
import { truthAllowsNewExposure, type TruthMetadata } from './truth.js';

export const CONTROL_POSTURES = Object.freeze(['OPEN', 'PAUSED_NEW_EXPOSURE', 'KILL_NEW_EXPOSURE', 'UNKNOWN'] as const);
export type ControlPosture = (typeof CONTROL_POSTURES)[number];

export interface ControlPostureSnapshot {
  readonly posture: ControlPosture;
  readonly truth: Readonly<TruthMetadata>;
  readonly revision: string | null;
  readonly reasonCodes: readonly string[];
}

export interface ConfigurationAuthority {
  readonly revision: ConfigRevisionId;
  readonly sourceId: string;
  readonly issuedAtMs: number;
  readonly effectiveFromMs: number;
  readonly effectiveUntilMs: number | null;
}

export interface ExactPolicyBound {
  readonly value: NonNegativeDecimal;
  readonly minimum: NonNegativeDecimal;
  readonly maximum: NonNegativeDecimal;
  readonly unit: string;
}

export interface IntegerPolicyBound {
  readonly value: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly unit: string;
}

export interface CapitalBudgetPolicy {
  readonly authority: Readonly<ConfigurationAuthority>;
  readonly valuationAsset: string;
  readonly portfolioGrossLimit: Readonly<ExactPolicyBound>;
  readonly portfolioNetLimit: Readonly<ExactPolicyBound>;
  readonly perStrategyLimits: Readonly<Record<'BASIS' | 'VOLUME', ExactPolicyBound>>;
  readonly perSymbolLimit: Readonly<ExactPolicyBound>;
  readonly perCorrelatedGroupLimit: Readonly<ExactPolicyBound>;
  readonly perVenueInstrumentLimit: Readonly<ExactPolicyBound>;
  readonly riskReductionReserve: Readonly<ExactPolicyBound>;
  readonly maximumConcurrentPlans: Readonly<IntegerPolicyBound>;
  readonly maximumActivePositions: Readonly<IntegerPolicyBound>;
  readonly reservationTtlMs: Readonly<IntegerPolicyBound>;
}

export const ALLOCATION_STATUSES = Object.freeze(['GRANTED', 'CAPPED', 'BLOCKED'] as const);
export type AllocationStatus = (typeof ALLOCATION_STATUSES)[number];

export interface AllocationAuditStep {
  readonly code: string;
  readonly before: NonNegativeDecimal;
  readonly after: NonNegativeDecimal;
  readonly limit: NonNegativeDecimal | null;
  readonly reason: string;
}

export interface AllocationDecision {
  readonly id: AllocationDecisionId;
  readonly considerationId: OpportunityConsiderationId;
  readonly status: AllocationStatus;
  readonly requestedAmount: NonNegativeDecimal;
  readonly grantedAmount: NonNegativeDecimal;
  readonly valuationAsset: string;
  readonly priorityKey: string;
  readonly policyRevision: ConfigRevisionId;
  readonly audit: readonly Readonly<AllocationAuditStep>[];
  readonly blockingReasons: readonly string[];
  readonly decidedAtMs: number;
}

export const RESERVATION_STATES = Object.freeze(['ACTIVE', 'RELEASED', 'EXPIRED'] as const);
export type ReservationState = (typeof RESERVATION_STATES)[number];

export interface CapitalReservation {
  readonly id: CapitalReservationId;
  readonly allocationDecisionId: AllocationDecisionId;
  readonly considerationId: OpportunityConsiderationId;
  readonly amount: NonNegativeDecimal;
  readonly consumedAmount: NonNegativeDecimal;
  readonly valuationAsset: string;
  readonly state: ReservationState;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly releasedAtMs: number | null;
  readonly revision: number;
  readonly idempotencyKey: string;
}

export interface StagePrerequisite {
  readonly code: string;
  readonly required: boolean;
  readonly evidenceMaximumAgeMs: number | null;
  readonly detail: string;
}

export interface StagedExposureStep {
  readonly stage: CapitalStage;
  readonly sequence: number;
  readonly maximumAdditionalExposure: NonNegativeDecimal;
  readonly maximumTotalExposure: NonNegativeDecimal;
  readonly reservationConsumption: NonNegativeDecimal;
  readonly prerequisites: readonly Readonly<StagePrerequisite>[];
  readonly economicThesisConditions: readonly string[];
  readonly invalidationConditions: readonly string[];
  readonly maximumTimeInStageMs: number;
  readonly requiredApprovalActions: readonly string[];
  readonly requiredFutureGates: readonly FutureGate[];
  readonly liquidityRequirement: NonNegativeDecimal | null;
  readonly maximumNakedLegAmount: NonNegativeDecimal;
  readonly maximumNakedLegDurationMs: number;
  readonly stopAddingConditions: readonly string[];
  readonly allowedNextStages: readonly CapitalStage[];
  readonly reductionConditions: readonly string[];
  readonly cancellableBeforeEntry: boolean;
}

export interface StagedPlan {
  readonly id: StagedPlanId;
  readonly reservationId: CapitalReservationId;
  readonly revision: number;
  readonly digest: string;
  readonly stages: readonly Readonly<StagedExposureStep>[];
  readonly activeStage: CapitalStage;
  readonly remainingReservedAmount: NonNegativeDecimal;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}

export interface FoundationRiskCheckProjection
  extends Pick<RiskCheck, 'code' | 'status' | 'blocking' | 'detail' | 'evidenceTimestamp'> {}

/**
 * Float-free semantic projection of the canonical Foundation verdict. The
 * source digest binds back to the original verdict while observed/limit are
 * deliberately omitted because Foundation permits numeric values there.
 */
export interface FoundationRiskVerdictProjection
  extends Pick<RiskVerdict, 'allowed' | 'evaluatedAt' | 'expiresAt' | 'blockingCodes'> {
  readonly checks: readonly Readonly<FoundationRiskCheckProjection>[];
  readonly sourceVerdictDigest: string;
  readonly omittedFields: readonly ['checks.observed', 'checks.limit'];
}

export interface BoundRiskDecisionReference {
  readonly decisionId: string;
  readonly mandateId: CapitalMandateId;
  readonly mandateRevision: number;
  readonly mandateDigest: string;
  readonly externalPlanId: string;
  readonly correlationId: string;
  readonly verdict: Readonly<FoundationRiskVerdictProjection>;
}

export function projectFoundationRiskVerdict(
  verdict: Readonly<RiskVerdict>,
): Readonly<FoundationRiskVerdictProjection> {
  const checks = Object.freeze(verdict.checks.map((check) => Object.freeze({
    code: check.code,
    status: check.status,
    blocking: check.blocking,
    detail: check.detail,
    evidenceTimestamp: check.evidenceTimestamp,
  })));
  const semantic = {
    allowed: verdict.allowed,
    evaluatedAt: verdict.evaluatedAt,
    expiresAt: verdict.expiresAt,
    blockingCodes: [...verdict.blockingCodes],
    checks,
  };
  return Object.freeze({
    ...semantic,
    blockingCodes: Object.freeze([...semantic.blockingCodes]),
    sourceVerdictDigest: capitalDigest(semantic),
    omittedFields: Object.freeze(['checks.observed', 'checks.limit'] as const),
  });
}

export interface CapitalMandate {
  readonly id: CapitalMandateId;
  readonly revision: number;
  readonly digest: string;
  readonly considerationId: OpportunityConsiderationId;
  readonly allocationDecisionId: AllocationDecisionId;
  readonly reservationId: CapitalReservationId;
  readonly stagedPlanId: StagedPlanId;
  readonly stagedPlanRevision: number;
  readonly stagedPlanDigest: string;
  readonly proposalIntakeDigest: string;
  readonly configRevision: ConfigRevisionId;
  readonly approvalId: OperatorApprovalId | null;
  readonly riskDecision: Readonly<BoundRiskDecisionReference> | null;
  readonly targetMaximumExposure: NonNegativeDecimal;
  readonly valuationAsset: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}

export function postureAllowsRiskIncrease(snapshot: ControlPostureSnapshot): boolean {
  return snapshot.posture === 'OPEN' && truthAllowsNewExposure(snapshot.truth);
}

export function policyBoundIsValid(bound: ExactPolicyBound): boolean {
  const value = bound.value as ExactDecimal;
  const minimum = bound.minimum as ExactDecimal;
  const maximum = bound.maximum as ExactDecimal;
  return compareExactDecimals(value, minimum) >= 0 && compareExactDecimals(value, maximum) <= 0;
}
