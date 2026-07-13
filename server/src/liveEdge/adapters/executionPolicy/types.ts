export const EXECUTION_POLICY_INPUT_SCHEMA = 'LIVE_EDGE_EXECUTION_POLICY_INPUT_V1' as const;
export const EXECUTION_POLICY_DECISION_SCHEMA = 'LIVE_EDGE_EXECUTION_POLICY_DECISION_V1' as const;
export const EXECUTION_POLICY_CANDIDATE_SCHEMA = 'LIVE_EDGE_EXECUTION_POLICY_CANDIDATE_V1' as const;

export type PolicyProduct = 'SPOT' | 'USD_M_PERPETUAL';
export type PolicySide = 'BUY' | 'SELL';
export type PolicyOrderType = 'LIMIT' | 'MARKET';
export type PolicyTimeInForce = 'GTC' | 'IOC' | 'FOK' | null;
export type PolicyPosture = 'PASSIVE' | 'AGGRESSIVE' | 'HYBRID' | 'RECOVERY';
export type PolicySequenceMode = 'ORDERED' | 'CONCURRENT';
export type PolicyDependencyKind =
  | 'INSTRUMENT_FILTER'
  | 'BOOK'
  | 'COST'
  | 'MODEL'
  | 'CALIBRATION'
  | 'EXCHANGE_TWIN'
  | 'CURRENT_ORDERS'
  | 'CURRENT_POSITION'
  | 'CURRENT_LIABILITY'
  | 'RECOVERY';

export type PolicyRejectionReason =
  | 'INPUT_REJECTED'
  | 'INTENT_NOT_AUTHORIZED'
  | 'AUTHORIZATION_EXPIRED'
  | 'DEPENDENCY_STALE'
  | 'OWNER_REVISION_MISMATCH'
  | 'INSTRUMENT_OR_FILTER_UNAVAILABLE'
  | 'BOOK_OR_COST_EVIDENCE_UNAVAILABLE'
  | 'DISTRIBUTION_UNAVAILABLE'
  | 'DISTRIBUTION_UNCALIBRATED'
  | 'PRICE_BOUND_EXCEEDED'
  | 'QUANTITY_OR_NOTIONAL_EXCEEDED'
  | 'CAPITAL_OR_RISK_LIMIT_EXCEEDED'
  | 'NAKED_DURATION_EXCEEDED'
  | 'RECOVERY_BUDGET_EXCEEDED'
  | 'TAIL_LOSS_EXCEEDED'
  | 'AMBIGUITY_REQUIRES_RECONCILIATION'
  | 'NO_AUTHORIZED_POLICY';

export interface PolicyConstraintEnvelope {
  readonly owner: 'MANDATE' | 'CAPITAL_FOUNDATION' | 'FOUNDATION_RISK' | 'OPERATOR_APPROVAL';
  readonly ownerRevision: string;
  readonly maxQuantity: string;
  readonly maxNotionalQuote: string;
  readonly maxNakedQuantity: string;
  readonly maxNakedNotionalQuote: string;
  readonly maxNakedDurationMs: number;
  readonly maxRecoveryCostQuote: string;
  readonly maxScenarioLossQuote: string;
  readonly maxTailLossQuote: string;
  readonly cvarConfidencePpm: number;
  readonly minimumCompletionPpm: number;
}

export interface PolicyAuthorityProjection {
  readonly state: 'AUTHORIZED' | 'REVOKED' | 'UNKNOWN';
  readonly intentId: string;
  readonly intentRevision: string;
  readonly externalPlanId: string;
  readonly correlationId: string;
  readonly authorizationRevision: string;
  readonly mandateId: string;
  readonly mandateRevision: string;
  readonly capitalReservationId: string;
  readonly capitalReservationRevision: string;
  readonly stagedPlanId: string;
  readonly stagedPlanRevision: string;
  readonly operatorApprovalId: string;
  readonly operatorApprovalRevision: string;
  readonly riskVerdictId: string;
  readonly riskVerdictRevision: string;
  readonly capitalAuthority: 'CAPITAL_FOUNDATION';
  readonly riskAuthority: 'FOUNDATION';
  readonly riskAllowed: boolean;
  readonly killOrRevokeActive: boolean;
  readonly observedAtMs: number;
  readonly validUntilMs: number;
  readonly mandateConstraints: PolicyConstraintEnvelope;
  readonly capitalConstraints: PolicyConstraintEnvelope;
  readonly riskConstraints: PolicyConstraintEnvelope;
  readonly approvalConstraints: PolicyConstraintEnvelope;
}

export interface PolicyDependencyEvidence {
  readonly kind: PolicyDependencyKind;
  readonly revision: string;
  readonly state: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN' | 'AMBIGUOUS';
  readonly observedAtMs: number;
  readonly validUntilMs: number;
}

export interface PolicyLeg {
  readonly legId: string;
  readonly instrumentRevision: string;
  readonly filterRevision: string;
  readonly l04SizingRevision: string;
  readonly l04SourceEvidenceRevision: string;
  readonly l04SnapshotRevision: string;
  readonly l04PreflightState: 'PASS' | 'BLOCKED';
  readonly allowedOrderTypes: readonly PolicyOrderType[];
  readonly allowedTimeInForce: readonly Exclude<PolicyTimeInForce, null>[];
  readonly product: PolicyProduct;
  readonly accountRealmId: string;
  readonly symbol: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly side: PolicySide;
  readonly reduceOnly: boolean;
  readonly requestedQuantity: string;
  readonly filteredQuantity: string;
  readonly authorizedLimitPrice: string;
  readonly filteredNotionalQuote: string;
}

export interface PolicyAction {
  readonly schema: 'EXECUTION_POLICY_ACTION_V1';
  readonly actionId: string;
  readonly actionRevision: string;
  readonly step: number;
  readonly kind: 'PLACE' | 'CANCEL' | 'REPLACE_AFTER_CONFIRMED_CANCEL' | 'RECOVER';
  readonly legId: string;
  readonly orderType: PolicyOrderType | null;
  readonly timeInForce: PolicyTimeInForce;
  readonly quantity: string | null;
  readonly quantitySource:
    | 'AUTHORIZED_FILTERED_QUANTITY'
    | 'ACTUAL_FILL_OF_LEG'
    | 'CONFIRMED_REMAINDER_AFTER_CANCEL'
    | 'RISK_REDUCING_RECOVERY_EVIDENCE'
    | null;
  readonly price: string | null;
  readonly targetActionId: string | null;
  readonly dependsOnActualFillLegId: string | null;
  readonly requiresConfirmedCancelActionId: string | null;
  readonly exposureEffect: 'MAY_OPEN_WITHIN_AUTHORIZATION' | 'RISK_REDUCING_ONLY' | 'NO_EXPOSURE_EFFECT';
  readonly recoveryEvidenceRevision: string | null;
  readonly targetExposureRevision: string | null;
  readonly deadlineOffsetMs: number;
  readonly ambiguityPosture: 'RECONCILE_ONLY';
}

export interface PolicyScenarioLegFill {
  readonly legId: string;
  readonly filledQuantity: string;
}

export interface PolicyScenario {
  readonly scenarioId: string;
  readonly probabilityPpm: number;
  readonly fills: readonly PolicyScenarioLegFill[];
  readonly feeOrRebateQuote: string;
  readonly adverseSelectionQuote: string;
  readonly opportunityDecayQuote: string;
  readonly cancelRaceQuote: string;
  readonly unhedgedLossQuote: string;
  readonly recoveryCostQuote: string;
  readonly lossQuote: string;
  readonly fillLatencyMs: number;
  readonly maxNakedQuantity: string;
  readonly maxNakedNotionalQuote: string;
  readonly maxNakedDurationMs: number;
  readonly ambiguity: 'NONE' | 'RECONCILIATION_REQUIRED';
}

export interface PolicyDistribution {
  readonly schema: 'EXECUTION_POLICY_DISTRIBUTION_V1';
  readonly distributionRevision: string;
  readonly modelRevision: string;
  readonly calibrationRevision: string;
  readonly lineageExchangeTwinRevision: string;
  readonly state: 'CALIBRATED' | 'UNCALIBRATED' | 'UNAVAILABLE';
  readonly sampleCount: number;
  readonly minimumRequiredSampleCount: number;
  readonly quoteAsset: string;
  readonly observedAtMs: number;
  readonly validUntilMs: number;
  readonly scenarios: readonly PolicyScenario[];
}

export interface PolicyFailureTransitions {
  readonly onTimeout: 'RECONCILE_ONLY';
  readonly onDisconnect: 'RECONCILE_ONLY';
  readonly onHttp5xx: 'RECONCILE_ONLY';
  readonly onCancelAmbiguity: 'RECONCILE_ONLY';
  readonly onFirstLegReject: 'STOP_NO_NEW_EXPOSURE' | 'RECOVER_WITHIN_BUDGET' | 'NOT_APPLICABLE';
  readonly onFirstLegPartial: 'WAIT_FOR_ACTUAL_FILL' | 'RECOVER_WITHIN_BUDGET' | 'NOT_APPLICABLE';
  readonly onFirstLegTimeout: 'RECONCILE_ONLY' | 'NOT_APPLICABLE';
  readonly onConcurrentImbalance: 'RECOVER_WITHIN_BUDGET' | 'STOP_NO_NEW_EXPOSURE' | 'NOT_APPLICABLE';
}

export interface PolicyLegFailureTransition {
  readonly legId: string;
  readonly onReject: 'STOP_NO_NEW_EXPOSURE' | 'RECOVER_WITHIN_BUDGET';
  readonly onPartial: 'WAIT_FOR_ACTUAL_FILL' | 'RECOVER_WITHIN_BUDGET';
  readonly onTimeout: 'RECONCILE_ONLY';
  readonly onAmbiguity: 'RECONCILE_ONLY';
}

export interface ExecutionPolicyCandidate {
  readonly schema: typeof EXECUTION_POLICY_CANDIDATE_SCHEMA;
  readonly candidateId: string;
  readonly candidateRevision: string;
  readonly posture: PolicyPosture;
  readonly sequenceMode: PolicySequenceMode;
  readonly authorizationRevision: string;
  readonly mandateRevision: string;
  readonly capitalReservationRevision: string;
  readonly riskVerdictRevision: string;
  readonly stagedPlanRevision: string;
  readonly operatorApprovalRevision: string;
  readonly expiresAtMs: number;
  readonly actions: readonly PolicyAction[];
  readonly failureTransitions: PolicyFailureTransitions;
  readonly legFailureTransitions: readonly PolicyLegFailureTransition[];
  readonly distribution: PolicyDistribution;
}

export interface ExecutionPolicyInput {
  readonly schema: typeof EXECUTION_POLICY_INPUT_SCHEMA;
  readonly policyRequestId: string;
  readonly policyVersion: string;
  readonly evaluatedAtMs: number;
  readonly authority: PolicyAuthorityProjection;
  readonly dependencies: readonly PolicyDependencyEvidence[];
  readonly legs: readonly PolicyLeg[];
  readonly candidates: readonly ExecutionPolicyCandidate[];
}

export interface ExactRationalEvidence {
  readonly weightedNumerator: string;
  readonly denominatorPpm: number;
}

export interface ExactCvarEvidence {
  readonly confidencePpm: number;
  readonly tailMassPpm: number;
  readonly varLossQuote: string;
  readonly strictlyWorseMassPpm: number;
  readonly boundaryAtomMassPpm: number;
  readonly boundaryIncludedMassPpm: number;
  readonly weightedLossNumerator: string;
  readonly denominatorPpm: number;
}

export interface PolicyCandidateMetrics {
  readonly objectiveVersion: 'LEXICOGRAPHIC_CVAR_MAX_EXPECTED_RECOVERY_MAX_LATENCY_EXPECTED_LATENCY_DURATION_FILL_COMPLETION_V1';
  readonly expectedFilledQuantityByLeg: readonly {
    readonly legId: string;
    readonly evidence: ExactRationalEvidence;
  }[];
  readonly completionPpm: number;
  readonly expectedFeeOrRebateQuote: ExactRationalEvidence;
  readonly expectedAdverseSelectionQuote: ExactRationalEvidence;
  readonly expectedOpportunityDecayQuote: ExactRationalEvidence;
  readonly expectedCancelRaceQuote: ExactRationalEvidence;
  readonly expectedUnhedgedLossQuote: ExactRationalEvidence;
  readonly expectedLossQuote: ExactRationalEvidence;
  readonly expectedRecoveryCostQuote: ExactRationalEvidence;
  readonly expectedFillLatencyMsNumerator: string;
  readonly expectedFillLatencyDenominatorPpm: 1_000_000;
  readonly maximumFillLatencyMs: number;
  readonly expectedNakedDurationMsNumerator: string;
  readonly expectedNakedDurationDenominatorPpm: 1_000_000;
  readonly maximumLossQuote: string;
  readonly cvarLossQuote: ExactCvarEvidence;
}

export interface PolicyCandidateEvaluation {
  readonly candidateId: string;
  readonly candidateRevision: string;
  readonly distributionRevision: string;
  readonly modelRevision: string;
  readonly calibrationRevision: string;
  readonly authorized: boolean;
  readonly reasonCodes: readonly PolicyRejectionReason[];
  readonly metrics: PolicyCandidateMetrics | null;
}

export interface ExecutionPolicyPlan {
  readonly schema: 'LIVE_EDGE_EXECUTION_POLICY_PLAN_V1';
  readonly planId: string;
  readonly planRevision: string;
  readonly policyRequestId: string;
  readonly policyVersion: string;
  readonly intentId: string;
  readonly intentRevision: string;
  readonly externalPlanId: string;
  readonly correlationId: string;
  readonly authorizationRevision: string;
  readonly mandateId: string;
  readonly mandateRevision: string;
  readonly capitalReservationId: string;
  readonly capitalReservationRevision: string;
  readonly stagedPlanId: string;
  readonly stagedPlanRevision: string;
  readonly operatorApprovalId: string;
  readonly operatorApprovalRevision: string;
  readonly riskVerdictId: string;
  readonly riskVerdictRevision: string;
  readonly evidenceRevisions: readonly string[];
  readonly distributionRevision: string;
  readonly modelRevision: string;
  readonly calibrationRevision: string;
  readonly lineageExchangeTwinRevision: string;
  readonly selectedCandidateId: string;
  readonly selectedCandidateRevision: string;
  readonly posture: PolicyPosture;
  readonly sequenceMode: PolicySequenceMode;
  readonly legs: readonly PolicyLeg[];
  readonly actions: readonly PolicyAction[];
  readonly failureTransitions: PolicyFailureTransitions;
  readonly legFailureTransitions: readonly PolicyLegFailureTransition[];
  readonly metrics: PolicyCandidateMetrics;
  readonly expiresAtMs: number;
  readonly policyAuthority: 'ADVISORY_EXECUTION_MECHANICS_ONLY';
  readonly simulationAuthority: 'SYNTHETIC_FIXTURE';
  readonly sendEligible: false;
  readonly actionAuthority: 'NONE_RECORD_ONLY';
  readonly externalActionAuthorization: 'NONE';
}

export interface ExecutionPolicyDecision {
  readonly schema: typeof EXECUTION_POLICY_DECISION_SCHEMA;
  readonly decisionId: string;
  readonly decisionRevision: string;
  readonly disposition: 'PLANNED' | 'REJECTED';
  readonly evaluatedAtMs: number | null;
  readonly policyRequestId: string | null;
  readonly policyVersion: string | null;
  readonly reasonCodes: readonly PolicyRejectionReason[];
  readonly selectedPlan: ExecutionPolicyPlan | null;
  readonly candidateEvaluations: readonly PolicyCandidateEvaluation[];
  readonly policyAuthority: 'ADVISORY_EXECUTION_MECHANICS_ONLY';
  readonly simulationAuthority: 'SYNTHETIC_FIXTURE';
  readonly sendEligible: false;
  readonly actionAuthority: 'NONE_RECORD_ONLY';
  readonly externalActionAuthorization: 'NONE';
}
