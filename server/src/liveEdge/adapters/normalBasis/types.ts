import type {
  BinanceSpotOrderTifCapability,
} from '../binanceInstrumentSpecs/types.js';
import type {
  PrivateTruthProjection,
} from '../binancePrivateTruth/types.js';
import type {
  ExecutionPolicyDecision,
  ExecutionPolicyInput,
  ExecutionPolicyOwnerBindings,
  ExecutionPolicyPlan,
  PolicyAction,
  PolicyLeg,
} from '../executionPolicy/types.js';
import type {
  TwinOrderState,
  TwinScenarioInput,
  TwinScenarioState,
  TwinVenueStatus,
} from '../exchangeTwin/types.js';

export const NORMAL_BASIS_ENTRY_BINDING_SCHEMA =
  'LIVE_EDGE_NORMAL_BASIS_ENTRY_BINDING_V1' as const;
export const NORMAL_BASIS_FOUNDATION_BINDING_SCHEMA =
  'LIVE_EDGE_NORMAL_BASIS_FOUNDATION_BINDING_V1' as const;
export const NORMAL_BASIS_TWIN_OBSERVATION_SCHEMA =
  'LIVE_EDGE_NORMAL_BASIS_TWIN_OBSERVATION_V1' as const;
export const NORMAL_BASIS_POSITION_MODE_EVIDENCE_SCHEMA =
  'LIVE_EDGE_NORMAL_BASIS_POSITION_MODE_EVIDENCE_V1' as const;
export const NORMAL_BASIS_OWNER_AGREEMENT_SCHEMA =
  'LIVE_EDGE_NORMAL_BASIS_OWNER_AGREEMENT_V1' as const;

export type NormalBasisBindingReason =
  | 'POLICY_NOT_PLANNED'
  | 'POLICY_AUTHORITY_NOT_EXACT'
  | 'POLICY_LEG_SET_NOT_EXACT'
  | 'POLICY_ORDERING_NOT_EXACT'
  | 'SPOT_ENTRY_NOT_EXACT'
  | 'PERP_HEDGE_NOT_EXACT'
  | 'SPOT_OWNER_BINDING_NOT_EXACT'
  | 'FOUNDATION_PLAN_IDENTITY_NOT_EXACT'
  | 'FOUNDATION_DIRECTION_NOT_EXACT'
  | 'FOUNDATION_LEG_SET_NOT_EXACT'
  | 'FOUNDATION_QUANTITY_PROJECTION_NOT_EXACT'
  | 'FOUNDATION_NAKED_DURATION_EXCEEDS_POLICY';

export interface NormalBasisEntryPolicyBinding {
  readonly schema: typeof NORMAL_BASIS_ENTRY_BINDING_SCHEMA;
  readonly input: Readonly<ExecutionPolicyInput>;
  readonly ownerBindings: Readonly<ExecutionPolicyOwnerBindings>;
  readonly decision: Readonly<ExecutionPolicyDecision>;
  readonly plan: Readonly<ExecutionPolicyPlan>;
  readonly spotLeg: Readonly<PolicyLeg>;
  readonly perpLeg: Readonly<PolicyLeg>;
  readonly spotAction: Readonly<PolicyAction>;
  readonly perpAction: Readonly<PolicyAction>;
  readonly spotCapability: Readonly<BinanceSpotOrderTifCapability>;
  readonly bindingRevision: string;
  readonly lifecycleAuthority: 'FOUNDATION_EXECUTION';
  readonly reconciliationAuthority: 'FOUNDATION_RECONCILIATION';
  readonly simulationAuthority: 'SYNTHETIC_FIXTURE';
  readonly sendEligible: false;
  readonly actionAuthority: 'NONE_RECORD_ONLY';
  readonly externalActionAuthorization: 'NONE';
}

export type NormalBasisEntryBindingResult =
  | {
      readonly ok: true;
      readonly binding: Readonly<NormalBasisEntryPolicyBinding>;
    }
  | {
      readonly ok: false;
      readonly decision: Readonly<ExecutionPolicyDecision>;
      readonly reasonCodes: readonly NormalBasisBindingReason[];
    };

export type NormalBasisFoundationLegKey = 'SPOT' | 'PERP';
export type NormalBasisFoundationLegPhase = 'OPEN' | 'CLOSE';

/**
 * Structural, data-only view of the canonical Foundation execution owner.
 * The live-edge source never imports or recreates Foundation execution.
 */
export interface NormalBasisFoundationLegView {
  readonly legId: string;
  readonly key: NormalBasisFoundationLegKey;
  readonly phase: NormalBasisFoundationLegPhase;
  readonly role: 'SPOT_OPEN' | 'PERP_OPEN' | 'SPOT_CLOSE' | 'PERP_CLOSE';
  readonly venue: 'BINANCE_SPOT' | 'BINANCE_USDM';
  readonly side: 'BUY' | 'SELL';
  readonly quantity: number;
  readonly reduceOnly: boolean;
  readonly riskEffect: 'RISK_INCREASING' | 'RISK_REDUCING' | 'NEUTRAL';
  readonly clientOrderId: string;
}

export interface NormalBasisFoundationPlanView {
  readonly planId: string;
  readonly correlationId: string;
  readonly termsFingerprint: string;
  readonly strategy: 'BASIS';
  readonly direction: 'LONG_SPOT_SHORT_PERP';
  readonly symbol: string;
  readonly proposal: {
    readonly canonicalProposalId: string;
    readonly observedAtMs: number;
    readonly maxAgeMs: number;
    readonly expiresAtMs: number;
  };
  readonly attempt: number;
  readonly mode: 'PAPER';
  readonly requiresApproval: boolean;
  readonly maxNakedDurationMs: number;
  readonly openingOrder: readonly ['SPOT', 'PERP'];
  readonly openingLegs: Readonly<Record<NormalBasisFoundationLegKey, NormalBasisFoundationLegView>>;
  readonly closingLegs: Readonly<Record<NormalBasisFoundationLegKey, NormalBasisFoundationLegView>>;
}

export interface NormalBasisFoundationBinding {
  readonly schema: typeof NORMAL_BASIS_FOUNDATION_BINDING_SCHEMA;
  readonly entry: Readonly<NormalBasisEntryPolicyBinding>;
  readonly ownerPlan: Readonly<NormalBasisFoundationPlanView>;
  readonly aliases: readonly Readonly<{
    readonly policyLegId: string;
    readonly foundationOpenLegId: string;
    readonly foundationCloseLegId: string;
    readonly clientOpenOrderId: string;
    readonly clientCloseOrderId: string;
    readonly product: 'SPOT' | 'USD_M_PERPETUAL';
  }>[];
  readonly quantityProjection: 'BINARY64_PROJECTION';
  readonly foundationBindingRevision: string;
  readonly lifecycleAuthority: 'FOUNDATION_EXECUTION';
  readonly simulationAuthority: 'SYNTHETIC_FIXTURE';
  readonly sendEligible: false;
  readonly actionAuthority: 'NONE_RECORD_ONLY';
  readonly externalActionAuthorization: 'NONE';
}

export type NormalBasisFoundationBindingResult =
  | {
      readonly ok: true;
      readonly binding: Readonly<NormalBasisFoundationBinding>;
    }
  | {
      readonly ok: false;
      readonly reasonCodes: readonly NormalBasisBindingReason[];
    };

export interface NormalBasisFoundationLegRequestView {
  readonly planId: string;
  readonly correlationId: string;
  readonly symbol: string;
  readonly direction: 'LONG_SPOT_SHORT_PERP';
  readonly mode: 'PAPER';
  readonly phase: NormalBasisFoundationLegPhase;
  readonly leg: Readonly<NormalBasisFoundationLegView>;
}

export type NormalBasisTwinStage =
  | 'ENTRY_SPOT'
  | 'ENTRY_HEDGE'
  | 'EXIT_SPOT'
  | 'EXIT_PERP'
  | 'RECOVERY_CLOSE_SPOT'
  | 'RECOVERY_CLOSE_PERP';

export interface NormalBasisPositionModeEvidence {
  readonly schema: typeof NORMAL_BASIS_POSITION_MODE_EVIDENCE_SCHEMA;
  readonly owner: 'BINANCE_PRIVATE_TRUTH';
  readonly projection: Readonly<PrivateTruthProjection>;
  readonly sendEligible: false;
  readonly actionAuthority: 'NONE_RECORD_ONLY';
  readonly externalActionAuthorization: 'NONE';
}

export interface NormalBasisFoundationLegStateView {
  readonly definition: Readonly<NormalBasisFoundationLegView>;
  readonly lifecycle:
    | 'PLANNED'
    | 'VALIDATED'
    | 'SUBMITTING'
    | 'ACKNOWLEDGED'
    | 'PARTIALLY_FILLED'
    | 'FILLED'
    | 'CANCEL_PENDING'
    | 'CANCELLED'
    | 'REJECTED'
    | 'AMBIGUOUS';
  readonly submittedQuantity: number;
  readonly cumulativeFilledQuantity: number;
  readonly venueOrderId: string | null;
}

/**
 * Structural, data-only result returned by the injected canonical Foundation
 * checkpoint hydrator. LiveEdge cannot import the execution owner directly.
 */
export interface NormalBasisFoundationStateView {
  readonly plan: Readonly<NormalBasisFoundationPlanView>;
  readonly lifecycle:
    | 'CREATED'
    | 'AWAITING_APPROVAL'
    | 'PREFLIGHTING'
    | 'READY'
    | 'OPENING'
    | 'HEDGED_OPEN'
    | 'ONE_LEG_EXPOSED'
    | 'RECOVERY_REQUIRED'
    | 'CLOSE_REQUESTED'
    | 'CLOSING'
    | 'RECONCILING'
    | 'CLOSED'
    | 'FAILED'
    | 'CANCELLED'
    | 'EXPIRED';
  readonly revision: number;
  readonly stateRevisionId: string;
  readonly lastSequence: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly eventLog: readonly Readonly<{
    readonly eventId: string;
    readonly planId: string;
    readonly sequence: number;
    readonly occurredAtMs: number;
    readonly type: string;
    readonly phase?: NormalBasisFoundationLegPhase;
    readonly legKey?: NormalBasisFoundationLegKey;
    readonly submittedQuantity?: number;
  }>[];
  readonly openingLegs: Readonly<Record<
    NormalBasisFoundationLegKey,
    Readonly<NormalBasisFoundationLegStateView>
  >>;
  readonly closingLegs: Readonly<Record<
    NormalBasisFoundationLegKey,
    Readonly<NormalBasisFoundationLegStateView>
  >>;
}

export type NormalBasisFoundationCheckpointRestoreView =
  | {
      readonly ok: true;
      readonly state: Readonly<NormalBasisFoundationStateView>;
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
    };

/** Narrow dependency injection seam implemented by canonical Foundation. */
export interface NormalBasisFoundationCheckpointHydrator {
  hydrateExecutionCheckpoint(
    serializedCheckpoint: string,
  ): NormalBasisFoundationCheckpointRestoreView;
}

export interface NormalBasisMutationLineage {
  readonly requestSequence: number;
  readonly requestId: string;
  readonly intentFingerprint: string;
  readonly sanitizedRequestContentHash: string;
  readonly privateProjectionRevision: string;
  readonly foundationReconciliationResultRevision: string;
  readonly lineageRevision: string;
}

export type NormalBasisLocalDisposition =
  | 'ACKNOWLEDGED'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'TERMINAL_NO_FILL'
  | 'REJECTED'
  | 'AMBIGUOUS';

export interface NormalBasisTwinLegObservation {
  readonly schema: typeof NORMAL_BASIS_TWIN_OBSERVATION_SCHEMA;
  readonly foundationBindingRevision: string;
  readonly stage: NormalBasisTwinStage;
  readonly policyPlanId: string;
  readonly foundationPlanId: string;
  readonly policyLegId: string;
  readonly foundationLegId: string;
  readonly l06MutationId: string;
  readonly mutationLineage: Readonly<NormalBasisMutationLineage>;
  readonly twinFixtureId: string;
  readonly deterministicClientOrderId: string;
  readonly product: 'SPOT' | 'USD_M_PERPETUAL';
  readonly side: 'BUY' | 'SELL';
  readonly reduceOnly: boolean;
  readonly positionSide: 'BOTH' | null;
  readonly positionModeProjectionRevision: string;
  readonly positionModeEvidence: Readonly<NormalBasisPositionModeEvidence>;
  readonly ownerCheckpoint: string;
  readonly ownerCheckpointChecksum: string;
  readonly ownerCheckpointRevision: string;
  readonly ownerStateRevision: string;
  readonly ownerStateLifecycle: NormalBasisFoundationStateView['lifecycle'];
  readonly ownerStateLastSequence: number;
  readonly requestedQuantity: string;
  readonly venueFilledQuantity: string;
  readonly confirmedFilledQuantity: string;
  readonly remainingQuantity: string;
  readonly expiredQuantity: string;
  readonly venueStatus: TwinVenueStatus;
  readonly localTruth: TwinOrderState['localTruth'];
  readonly localDisposition: NormalBasisLocalDisposition;
  readonly terminalStatus: 'CANCELED' | 'EXPIRED' | null;
  readonly ambiguityVisible: boolean;
  readonly recoveryRequired: boolean;
  readonly blockedReasonCodes: readonly string[];
  readonly twinOutcomeRevision: string;
  readonly observationRevision: string;
  readonly state: Readonly<TwinScenarioState>;
  readonly order: Readonly<TwinOrderState>;
  readonly lifecycleAuthority: 'FOUNDATION_EXECUTION';
  readonly reconciliationAuthority: 'FOUNDATION_RECONCILIATION';
  readonly evidenceAuthority: 'ADAPTER_EVIDENCE_ONLY';
  readonly simulationAuthority: 'SYNTHETIC_FIXTURE';
  readonly sendEligible: false;
  readonly actionAuthority: 'NONE_RECORD_ONLY';
  readonly externalActionAuthorization: 'NONE';
}

export interface RunNormalBasisTwinLegInput {
  readonly binding: Readonly<NormalBasisFoundationBinding>;
  readonly stage: NormalBasisTwinStage;
  readonly ownerRequest: Readonly<NormalBasisFoundationLegRequestView>;
  readonly scenario: Readonly<TwinScenarioInput>;
  readonly ownerCheckpoint: string;
  readonly ownerCheckpointHydrator: Readonly<NormalBasisFoundationCheckpointHydrator>;
  readonly privateTruthEvidence: Readonly<NormalBasisPositionModeEvidence>;
}

/** Structural output accepted by the dormant Foundation PAPER port. */
export type NormalBasisOwnerLegOutcomeView =
  | {
      readonly kind: 'ACKNOWLEDGED';
      readonly venueOrderId: null;
    }
  | {
      readonly kind: 'PARTIALLY_FILLED' | 'FILLED';
      readonly venueOrderId: null;
      readonly cumulativeFilledQuantity: number;
    }
  | {
      readonly kind: 'REJECTED' | 'AMBIGUOUS';
      readonly failure: Readonly<{
        readonly code: string;
        readonly message: string;
        readonly retryable: false;
        readonly recommendedOperatorAction: string;
      }>;
    };

export type NormalBasisCanonicalOutcome =
  | 'CLOSED'
  | 'HEDGED_OPEN'
  | 'ONE_LEG_EXPOSED'
  | 'RECOVERY_REQUIRED';

export interface NormalBasisRecoveryRecommendationView {
  readonly planId: string;
  readonly correlationId: string;
  readonly ownerCheckpointChecksum: string;
  readonly ownerRevision: number;
  readonly ownerStateRevision: string;
  readonly reconciliationEvidenceRevision: string;
  readonly evaluatedAtMs: number;
  readonly action:
    | 'VERIFY_AMBIGUOUS_ORDER'
    | 'HEDGE_RESIDUAL'
    | 'CLOSE_EXPOSED_LEG'
    | 'CANCEL_REMAINDER'
    | 'MANUAL_REVIEW'
    | 'NO_ACTION';
  readonly riskEffect: 'RISK_INCREASING' | 'RISK_REDUCING' | 'NEUTRAL';
  readonly reason: string;
  readonly phase: NormalBasisFoundationLegPhase | null;
  readonly legKey: NormalBasisFoundationLegKey | null;
  readonly legId: string | null;
  readonly clientOrderId: string | null;
  readonly automatic: false;
  readonly recommendationRevision: string;
}

export interface NormalBasisFoundationRecoveryRecommendationView {
  readonly action: NormalBasisRecoveryRecommendationView['action'];
  readonly riskEffect: NormalBasisRecoveryRecommendationView['riskEffect'];
  readonly reason: string;
  readonly phase: NormalBasisFoundationLegPhase | null;
  readonly legKey: NormalBasisFoundationLegKey | null;
  readonly clientOrderId: string | null;
  readonly automatic: false;
}

export interface NormalBasisFoundationRecoveryProvider {
  recommendExecutionRecovery(
    state: Readonly<NormalBasisFoundationStateView>,
    evaluatedAtMs: number,
  ): readonly Readonly<NormalBasisFoundationRecoveryRecommendationView>[];
}

export interface NormalBasisFoundationReconciledLegView {
  readonly phase: NormalBasisFoundationLegPhase;
  readonly legKey: NormalBasisFoundationLegKey;
  readonly clientOrderId: string;
  readonly venueOrderId: string | null;
  readonly expectedLifecycle: string;
  readonly expectedSubmittedQuantity: number;
  readonly expectedFilledQuantity: number;
  readonly observedOrderStatus:
    | 'NEW'
    | 'PARTIALLY_FILLED'
    | 'FILLED'
    | 'CANCELED'
    | 'REJECTED'
    | 'EXPIRED'
    | 'UNKNOWN'
    | null;
  readonly observedOrderFilledQuantity: number | null;
  readonly observedTradeFilledQuantity: number | null;
  readonly observedFilledQuantity: number | null;
  readonly observedRemainderQuantity: number | null;
  readonly status: string;
  readonly reasonCodes: readonly string[];
}

export interface NormalBasisFoundationReconciliationSourceView {
  readonly sourceId: string;
  readonly sourceTimeMs: number | null;
  readonly receivedAtMs: number;
  readonly maxAgeMs: number;
  readonly freshness: string;
  readonly authority: string;
  readonly completeness: string;
  readonly coverageStartMs: number | null;
  readonly coverageEndMs: number | null;
  readonly status: string;
  readonly reasonCodes: readonly string[];
}

/** Full data-only view of canonical Foundation reconciliation output. */
export interface NormalBasisFoundationReconciliationView {
  readonly planId: string;
  readonly correlationId: string;
  readonly evaluatedAtMs: number;
  readonly status: string;
  readonly recommendation: string;
  readonly executionAuthority: 'NONE';
  readonly reasons: readonly Readonly<{
    readonly code: string;
    readonly status: string;
    readonly detail: string;
    readonly evidenceKind: string | null;
    readonly phase: NormalBasisFoundationLegPhase | null;
    readonly legKey: NormalBasisFoundationLegKey | null;
  }>[];
  readonly legs: readonly Readonly<NormalBasisFoundationReconciledLegView>[];
  readonly positions: readonly Readonly<{
    readonly venue: string;
    readonly expectedDeltaQuantity: number;
    readonly observedDeltaQuantity: number | null;
    readonly differenceQuantity: number | null;
    readonly status: string;
    readonly reasonCodes: readonly string[];
  }>[];
  readonly sources: Readonly<{
    readonly orders: Readonly<NormalBasisFoundationReconciliationSourceView>;
    readonly fills: Readonly<NormalBasisFoundationReconciliationSourceView>;
    readonly positions: Readonly<NormalBasisFoundationReconciliationSourceView>;
  }>;
  readonly normalization: Readonly<{
    readonly exactDuplicateOrdersDropped: number;
    readonly exactDuplicateFillsDropped: number;
    readonly exactDuplicatePositionsDropped: number;
    readonly outOfOrderFillPairs: number;
  }>;
}

/** Narrow injected call-through to the canonical Foundation reconciler. */
export interface NormalBasisFoundationReconciliationProvider {
  reconcileExecutionState(
    state: Readonly<NormalBasisFoundationStateView>,
    evaluatedAtMs: number,
  ): Readonly<NormalBasisFoundationReconciliationView>;
}

export interface EvaluateNormalBasisOwnerAgreementInput {
  readonly foundationBinding: Readonly<NormalBasisFoundationBinding>;
  readonly ownerCheckpoint: string;
  readonly ownerCheckpointHydrator: Readonly<NormalBasisFoundationCheckpointHydrator>;
  readonly ownerReconciliationProvider: Readonly<NormalBasisFoundationReconciliationProvider>;
  readonly ownerReconciliationEvaluatedAtMs: number;
  readonly recoveryProvider: Readonly<NormalBasisFoundationRecoveryProvider>;
  readonly recoveryEvaluatedAtMs: number;
  readonly observations: readonly Readonly<NormalBasisTwinLegObservation>[];
}

export interface NormalBasisOwnerAgreement {
  readonly schema: typeof NORMAL_BASIS_OWNER_AGREEMENT_SCHEMA;
  readonly foundationBindingRevision: string;
  readonly ownerCheckpointChecksum: string;
  readonly ownerCheckpointRevision: string;
  readonly ownerStateRevision: string;
  readonly reconciliationEvidenceRevision: string;
  readonly reconciliationStatus: string;
  readonly ownerReconciliationEvidence: Readonly<NormalBasisFoundationReconciliationView>;
  readonly canonicalOutcome: NormalBasisCanonicalOutcome;
  readonly state: 'PASS' | 'MANUAL_ACTION_REQUIRED' | 'BLOCKED';
  readonly reasonCodes: readonly string[];
  readonly openingSpotQuantity: string;
  readonly openingPerpQuantity: string;
  readonly closingSpotQuantity: string;
  readonly closingPerpQuantity: string;
  readonly residualSpotQuantity: string;
  readonly residualPerpQuantity: string;
  readonly netBaseQuantity: string;
  readonly unhedgedBaseQuantity: string;
  readonly ambiguityVisible: boolean;
  readonly workingRemainderVisible: boolean;
  readonly manualActionRequired: boolean;
  readonly ownerRecommendationsRetained: readonly Readonly<NormalBasisRecoveryRecommendationView>[];
  readonly observationRevisions: readonly string[];
  readonly agreementRevision: string;
  readonly lifecycleAuthority: 'FOUNDATION_EXECUTION';
  readonly reconciliationAuthority: 'FOUNDATION_RECONCILIATION';
  readonly evidenceAuthority: 'ADAPTER_EVIDENCE_ONLY';
  readonly simulationAuthority: 'SYNTHETIC_FIXTURE';
  readonly sendEligible: false;
  readonly actionAuthority: 'NONE_RECORD_ONLY';
  readonly externalActionAuthorization: 'NONE';
}
