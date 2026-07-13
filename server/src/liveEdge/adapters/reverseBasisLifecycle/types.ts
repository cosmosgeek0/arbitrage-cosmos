import type {
  ExecutionPolicyDecision,
  ExecutionPolicyInput,
} from '../executionPolicy/types.js';
import type { TwinScenarioState, TwinVenueStatus } from '../exchangeTwin/types.js';

export const REVERSE_BASIS_INPUT_SCHEMA = 'LIVE_EDGE_REVERSE_BASIS_INPUT_V1' as const;
export const REVERSE_BASIS_STATE_SCHEMA = 'LIVE_EDGE_REVERSE_BASIS_STATE_V1' as const;
export const REVERSE_BASIS_CHECKPOINT_SCHEMA = 'LIVE_EDGE_REVERSE_BASIS_CHECKPOINT_V1' as const;

export const REVERSE_BASIS_REQUIRED_GATES = Object.freeze([
  'BASIS_PROPOSAL',
  'CAPITAL_MANDATE',
  'CAPITAL_RESERVATION',
  'FOUNDATION_RISK',
  'OPERATOR_APPROVAL',
  'SPOT_BOOK',
  'USDM_BOOK',
  'INSTRUMENT_FILTERS',
  'COMMISSIONS_FUNDING',
  'PRIVATE_ACCOUNT',
  'POSITION_MODE',
  'CURRENT_ORDERS_POSITIONS',
  'RECOVERY_CAPACITY',
] as const);

export type ReverseBasisGateKind = (typeof REVERSE_BASIS_REQUIRED_GATES)[number];
export type ReverseBasisMarginMode = 'CROSS' | 'ISOLATED';
export type ReverseBasisMutationState =
  | 'CONFIRMED'
  | 'REJECTED_NO_EFFECT_PROVEN'
  | 'UNKNOWN';
export type ReverseBasisLifecycleStage =
  | 'BLOCKED'
  | 'PREFLIGHTED'
  | 'BORROWING'
  | 'LIABILITY_CONFIRMED'
  | 'ENTRY_MARGIN_SELL_WORKING'
  | 'HEDGE_WORKING'
  | 'OPEN'
  | 'EXITING'
  | 'REPAYING'
  | 'CLOSED'
  | 'RECOVERY_REQUIRED'
  | 'RECOVERING'
  | 'RECOVERED'
  | 'MANUAL_INTERVENTION';

export type ReverseBasisOrderRole =
  | 'MARGIN_ENTRY_SELL'
  | 'FUTURES_ENTRY_HEDGE'
  | 'MARGIN_EXIT_COVER'
  | 'FUTURES_EXIT_CLOSE'
  | 'RECOVERY_MARGIN_COVER'
  | 'RECOVERY_FUTURES_ADJUST';

export interface ReverseBasisNoActionAuthority {
  readonly simulationAuthority: 'SYNTHETIC_FIXTURE';
  readonly sendEligible: false;
  readonly privateReadAuthority: 'NONE';
  readonly mutationAuthority: 'NONE';
  readonly actionAuthority: 'NONE_RECORD_ONLY';
  readonly externalActionAuthorization: 'NONE';
}

export const REVERSE_BASIS_NO_ACTION_AUTHORITY: Readonly<ReverseBasisNoActionAuthority> =
  Object.freeze({
    simulationAuthority: 'SYNTHETIC_FIXTURE',
    sendEligible: false,
    privateReadAuthority: 'NONE',
    mutationAuthority: 'NONE',
    actionAuthority: 'NONE_RECORD_ONLY',
    externalActionAuthorization: 'NONE',
  });

export interface ReverseBasisAccountBinding {
  readonly accountRealmId: string;
  readonly futuresAccountRealmId: string;
  readonly marginMode: ReverseBasisMarginMode;
  readonly isolatedSymbol: string | null;
  readonly symbol: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly futuresPositionMode: 'ONE_WAY' | 'HEDGE';
  readonly futuresPositionSide: 'BOTH' | 'LONG';
  readonly accountConstruction: 'NO_TRANSFER_REQUIRED';
  readonly transferRequired: false;
  readonly bindingRevision: string;
}

export interface ReverseBasisOwnerChainBinding {
  readonly correlationId: string;
  readonly intentId: string;
  readonly intentRevision: string;
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
}

export interface ReverseBasisPolicyDecisionBinding {
  readonly entryDecisionId: string;
  readonly entryDecisionRevision: string;
  readonly exitDecisionId: string;
  readonly exitDecisionRevision: string;
  readonly recoveryDecisionId: string;
  readonly recoveryDecisionRevision: string;
}

export interface ReverseBasisOwnerGate {
  readonly kind: ReverseBasisGateKind;
  readonly state: 'PASS' | 'BLOCKED' | 'UNKNOWN';
  readonly ownerRevision: string;
  readonly observedAtMs: number;
  readonly validUntilMs: number;
}

export interface ReverseBasisCollateralEvidence {
  readonly accountRealmId: string;
  readonly marginMode: ReverseBasisMarginMode;
  readonly isolatedSymbol: string | null;
  readonly state: 'CURRENT' | 'STALE' | 'UNKNOWN';
  readonly marginLevel: string | null;
  readonly collateralMarginLevel: string | null;
  readonly collateralValueQuote: string | null;
  readonly liquidationPrice: string | null;
  readonly liquidationState: 'NORMAL' | 'MARGIN_CALL' | 'LIQUIDATION' | 'UNKNOWN';
  readonly observedAtMs: number;
  readonly validUntilMs: number;
  readonly collateralRevision: string;
}

export interface ReverseBasisBorrowQuote {
  readonly accountRealmId: string;
  readonly marginMode: ReverseBasisMarginMode;
  readonly isolatedSymbol: string | null;
  readonly state: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';
  readonly asset: string;
  readonly requestedPrincipal: string;
  readonly maximumBorrowable: string | null;
  readonly accountBorrowLimit: string | null;
  readonly availableInventory: string | null;
  readonly hourlyInterestRate: string | null;
  readonly interestAccrual: 'ON_BORROW_AND_HOURLY' | 'UNKNOWN';
  readonly nextInterestAtMs: number | null;
  readonly observedAtMs: number;
  readonly validUntilMs: number;
  readonly quoteRevision: string;
}

export interface ReverseBasisTicket {
  readonly ticketId: string;
  readonly decisionId: string;
  readonly basisProposalId: string;
  readonly basisProposalRevision: string;
  readonly direction: 'SHORT_SPOT_LONG_PERP';
  readonly account: Readonly<ReverseBasisAccountBinding>;
  readonly ownerChain: Readonly<ReverseBasisOwnerChainBinding>;
  readonly policyDecisions: Readonly<ReverseBasisPolicyDecisionBinding>;
  readonly requestedPrincipal: string;
  readonly maxGrossNotionalQuote: string;
  readonly maxNakedQuantity: string;
  readonly maxNakedNotionalQuote: string;
  readonly maxNakedDurationMs: number;
  readonly maxRecoveryCostQuote: string;
  readonly maxRecoveryGrossNotionalQuote: string;
  readonly entryEvidenceRevision: string;
  readonly filterRevision: string;
  readonly expiresAtMs: number;
}

export interface ReverseBasisPreflight {
  readonly evaluatedAtMs: number;
  readonly basisDirection: 'SHORT_SPOT_LONG_PERP';
  readonly basisBorrowVerdict: 'OK' | 'MISSING' | 'STALE' | 'INSUFFICIENT' | 'BLOCKED';
  readonly gates: readonly Readonly<ReverseBasisOwnerGate>[];
  readonly collateral: Readonly<ReverseBasisCollateralEvidence>;
  readonly borrowQuote: Readonly<ReverseBasisBorrowQuote> | null;
}

export interface ReverseBasisPolicyWitness {
  readonly input: Readonly<ExecutionPolicyInput>;
  readonly decision: Readonly<ExecutionPolicyDecision>;
}

export interface ReverseBasisPolicySet {
  readonly entry: Readonly<ReverseBasisPolicyWitness>;
  readonly exit: Readonly<ReverseBasisPolicyWitness>;
  readonly recovery: Readonly<ReverseBasisPolicyWitness>;
}

export interface ReverseBasisBorrowObservation {
  readonly accountRealmId: string;
  readonly marginMode: ReverseBasisMarginMode;
  readonly isolatedSymbol: string | null;
  readonly asset: string;
  readonly requestedPrincipal: string;
  readonly confirmedPrincipal: string | null;
  readonly transactionId: string | null;
  readonly state: ReverseBasisMutationState;
  readonly liabilityRevision: string | null;
  readonly evidenceRevision: string;
}

export interface ReverseBasisRepayObservation {
  readonly source: 'LIFECYCLE_FIXTURE' | 'EXTERNAL_MANUAL';
  readonly accountRealmId: string;
  readonly marginMode: ReverseBasisMarginMode;
  readonly isolatedSymbol: string | null;
  readonly asset: string;
  readonly requestedRepayAmount: string;
  readonly confirmedRepayAmount: string | null;
  readonly transactionId: string | null;
  readonly state: ReverseBasisMutationState;
  readonly liabilityRevision: string | null;
  readonly evidenceRevision: string;
}

export interface ReverseBasisLiabilityObservation {
  readonly accountRealmId: string;
  readonly marginMode: ReverseBasisMarginMode;
  readonly isolatedSymbol: string | null;
  readonly asset: string;
  readonly principal: string;
  readonly accruedInterest: string;
  readonly totalLiability: string;
  readonly repayStatus:
    | 'NOT_REPAID'
    | 'PARTIALLY_REPAID'
    | 'REPAY_PENDING'
    | 'REPAY_REJECTED'
    | 'REPAY_UNKNOWN'
    | 'ZERO_CONFIRMED';
  readonly observedAtMs: number;
  readonly validUntilMs: number;
  readonly liabilityRevision: string;
}

export interface ReverseBasisOrderObservation {
  readonly orderRef: string;
  readonly role: ReverseBasisOrderRole;
  readonly accountRealmId: string;
  readonly marginMode: ReverseBasisMarginMode | null;
  readonly isolatedSymbol: string | null;
  readonly accountOrderId: string | null;
  readonly mutationState: ReverseBasisMutationState;
  readonly mutationEvidenceRevision: string;
  readonly policyPlanRevision: string;
  readonly policyActionId: string;
  readonly mechanicsAuthority: 'L07_SPOT_MARKET_MECHANICS_ONLY' | 'L07_USDM_MECHANICS';
  readonly twinFixtureId: string;
  readonly twinScenario: Readonly<TwinScenarioState>;
}

export interface ReverseBasisRecoveryEvidence {
  readonly recoveryRef: string;
  readonly policyPlanRevision: string;
  readonly policyActionId: string;
  readonly riskMeasureBefore: string;
  readonly riskMeasureAfter: string;
  readonly grossNotionalAfter: string;
  readonly recoveryCostQuote: string;
  readonly liquidityState: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';
  readonly collateralRevision: string;
  readonly evidenceRevision: string;
  readonly targetExposureRevision: string;
}

export interface ReverseBasisRecoveryProjection extends ReverseBasisRecoveryEvidence {
  readonly occurredAtMs: number;
}

export interface ReverseBasisClosureEvidence {
  readonly state: 'EXACT' | 'PARTIAL' | 'AMBIGUOUS' | 'UNAVAILABLE';
  readonly accountRealmId: string;
  readonly liabilityRevision: string | null;
  readonly borrowTransactionId: string | null;
  readonly repayTransactionId: string | null;
  readonly orderStateRevisions: readonly string[];
  readonly openOrderRefs: readonly string[];
  readonly ambiguousMutationRefs: readonly string[];
  readonly unmatchedFillRefs: readonly string[];
  readonly marginShortRemaining: string;
  readonly futuresLongRemaining: string;
  readonly observedAtMs: number;
  readonly validUntilMs: number;
  readonly reconciliationRevision: string;
}

export interface ReverseBasisManualIntervention {
  readonly reasonCode: string;
  readonly operatorAction: string;
  readonly evidenceRevision: string;
}

export type ReverseBasisEvent =
  | ReverseBasisEventEnvelope<'BORROW_OBSERVED', ReverseBasisBorrowObservation>
  | ReverseBasisEventEnvelope<'LIABILITY_OBSERVED', ReverseBasisLiabilityObservation>
  | ReverseBasisEventEnvelope<'ORDER_OBSERVED', ReverseBasisOrderObservation>
  | ReverseBasisEventEnvelope<'REPAY_OBSERVED', ReverseBasisRepayObservation>
  | ReverseBasisEventEnvelope<'RECOVERY_EVIDENCE', ReverseBasisRecoveryEvidence>
  | ReverseBasisEventEnvelope<'CLOSURE_RECONCILED', ReverseBasisClosureEvidence>
  | ReverseBasisEventEnvelope<'MANUAL_INTERVENTION', ReverseBasisManualIntervention>;

export interface ReverseBasisEventEnvelope<K extends string, P> {
  readonly schema: 'LIVE_EDGE_REVERSE_BASIS_EVENT_V1';
  readonly eventId: string;
  readonly sequence: number;
  readonly occurredAtMs: number;
  readonly kind: K;
  readonly payload: Readonly<P>;
}

export interface ReverseBasisLifecycleInput extends ReverseBasisNoActionAuthority {
  readonly schema: typeof REVERSE_BASIS_INPUT_SCHEMA;
  readonly lifecycleVersion: 'L10_REVERSE_BASIS_V1';
  readonly evaluatedAtMs: number;
  readonly ticket: Readonly<ReverseBasisTicket>;
  readonly preflight: Readonly<ReverseBasisPreflight>;
  readonly policies: Readonly<ReverseBasisPolicySet>;
  readonly events: readonly Readonly<ReverseBasisEvent>[];
}

export interface ReverseBasisOrderProjection {
  readonly orderRef: string;
  readonly role: ReverseBasisOrderRole;
  readonly accountRealmId: string;
  readonly accountOrderId: string | null;
  readonly mutationState: ReverseBasisMutationState;
  readonly mutationEvidenceRevision: string;
  readonly liabilityBasis: Readonly<ReverseBasisLiabilityObservation>;
  readonly policyPlanRevision: string;
  readonly policyActionId: string;
  readonly mechanicsAuthority: ReverseBasisOrderObservation['mechanicsAuthority'];
  readonly twinFixtureId: string;
  readonly twinScenarioRevision: string;
  readonly twinOutcomeRevision: string;
  readonly twinOrderRevision: string;
  readonly venueStatus: TwinVenueStatus;
  readonly localTruth: string;
  readonly requestedQuantity: string;
  readonly filledQuantity: string;
  readonly filledNotionalQuote: string;
  readonly remainingQuantity: string;
  readonly expiredQuantity: string;
  readonly fillIds: readonly string[];
  readonly open: boolean;
  readonly ambiguous: boolean;
  readonly observedAtMs: number | null;
  readonly venueEffectAtMs: number | null;
  readonly dispatchAtMs: number | null;
  readonly firstEventOccurredAtMs: number;
  readonly lastEventOccurredAtMs: number;
}

export interface ReverseBasisExposure {
  readonly borrowedPrincipal: string | null;
  readonly accruedInterest: string | null;
  readonly totalLiability: string | null;
  readonly marginSaleFilled: string;
  readonly futuresEntryFilled: string;
  readonly marginCoverFilled: string;
  readonly futuresExitFilled: string;
  readonly marginShortRemaining: string;
  readonly futuresLongRemaining: string;
  readonly hedgeDriftQuantity: string;
  readonly grossOpenQuantity: string;
}

export interface ReverseBasisProcessedEvent {
  readonly eventId: string;
  readonly sequence: number;
  readonly kind: ReverseBasisEvent['kind'];
  readonly eventRevision: string;
  readonly stageAfter: ReverseBasisLifecycleStage;
}

export interface ReverseBasisLifecycleState extends ReverseBasisNoActionAuthority {
  readonly schema: typeof REVERSE_BASIS_STATE_SCHEMA;
  readonly lifecycleVersion: 'L10_REVERSE_BASIS_V1';
  readonly ticket: Readonly<ReverseBasisTicket>;
  readonly evaluatedAtMs: number;
  readonly stage: ReverseBasisLifecycleStage;
  readonly preflightPassed: boolean;
  readonly preflight: Readonly<ReverseBasisPreflight>;
  readonly borrowQuote: Readonly<ReverseBasisBorrowQuote> | null;
  readonly collateral: Readonly<ReverseBasisCollateralEvidence>;
  readonly borrow: Readonly<ReverseBasisBorrowObservation> | null;
  readonly initialLiability: Readonly<ReverseBasisLiabilityObservation> | null;
  readonly liability: Readonly<ReverseBasisLiabilityObservation> | null;
  readonly repay: Readonly<ReverseBasisRepayObservation> | null;
  readonly repayBasis: Readonly<ReverseBasisLiabilityObservation> | null;
  readonly orders: readonly Readonly<ReverseBasisOrderProjection>[];
  readonly recoveryEvidence: readonly Readonly<ReverseBasisRecoveryProjection>[];
  readonly recoveryBatchTargetRevision: string | null;
  readonly closureEvidence: Readonly<ReverseBasisClosureEvidence> | null;
  readonly manualIntervention: Readonly<ReverseBasisManualIntervention> | null;
  readonly nakedRiskStartedAtMs: number | null;
  readonly nakedRiskLimitBreached: boolean;
  readonly borrowOccurredAtMs: number | null;
  readonly repayOccurredAtMs: number | null;
  readonly lastOrderOccurredAtMs: number | null;
  readonly exposure: Readonly<ReverseBasisExposure>;
  readonly openOrderRefs: readonly string[];
  readonly ambiguousMutationRefs: readonly string[];
  readonly unmatchedFillRefs: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly processedEvents: readonly Readonly<ReverseBasisProcessedEvent>[];
  readonly inputRevision: string;
  readonly stateRevision: string;
}

export interface ReverseBasisCheckpoint extends ReverseBasisNoActionAuthority {
  readonly schema: typeof REVERSE_BASIS_CHECKPOINT_SCHEMA;
  readonly state: Readonly<ReverseBasisLifecycleState>;
  readonly checkpointRevision: string;
}
