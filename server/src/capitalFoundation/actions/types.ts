import type {
  ActionUrgency,
  CapitalTruthState,
  ControlPostureSnapshot,
  ExactDecimal,
  FutureGate,
  NonNegativeDecimal,
  PositionActionIntentKind,
} from '../contracts/index.js';
import type {
  ActivePositionId,
  PositionThesisId,
} from '../contracts/identity.js';

export interface ActionPositionProjection {
  readonly positionId: ActivePositionId;
  readonly positionRevision: number;
  readonly thesisId: PositionThesisId;
  readonly thesisRevision: number;
  readonly valuationAsset: string;
  readonly currentTotalExposure: NonNegativeDecimal;
  /** Signed quote-value directional exposure used to prove hedge risk effect. */
  readonly currentNetDirectionalExposure: ExactDecimal;
  readonly currentBaseQuantity: ExactDecimal | null;
  readonly currentHedgeRatio: ExactDecimal | null;
  readonly completeness: CapitalTruthState;
  readonly truthReasonCodes: readonly string[];
}

export interface NextStageIncreaseAuthority {
  readonly currentStageSequence: number;
  readonly authorizedStageSequence: number;
  readonly authorizedStage: string;
  readonly maximumAdditionalExposure: NonNegativeDecimal;
  readonly maximumTotalExposure: NonNegativeDecimal;
  readonly freshEvidence: boolean;
  readonly reservationAvailable: boolean;
  readonly approvalValidated: boolean;
  readonly futureRiskRecheckRequired: boolean;
  readonly adversePriceMoveIsSoleReason: boolean;
}

export interface EconomicActionDecisionBase {
  readonly why: readonly string[];
  readonly triggerCodes: readonly string[];
  readonly supportingEvidenceIds: readonly string[];
  readonly conflictingEvidenceIds: readonly string[];
  readonly requiredFutureGates: readonly FutureGate[];
  readonly blockingFacts: readonly string[];
  readonly urgency: ActionUrgency;
  readonly hardDeadlineMs: number | null;
  readonly economicCostOfWaiting: NonNegativeDecimal | null;
  readonly expectedCostOfActing: NonNegativeDecimal | null;
  readonly invalidationConditions: readonly string[];
}

export type EconomicActionDecision =
  | (EconomicActionDecisionBase & { readonly kind: 'HOLD' })
  | (EconomicActionDecisionBase & {
      readonly kind: 'ADD_STAGE';
      readonly targetTotalExposure: NonNegativeDecimal;
      readonly targetBaseQuantity: ExactDecimal | null;
      readonly targetHedgeRatio: ExactDecimal | null;
      readonly authority: Readonly<NextStageIncreaseAuthority>;
    })
  | (EconomicActionDecisionBase & {
      readonly kind: 'REDUCE';
      readonly targetTotalExposure: NonNegativeDecimal;
      /** Signed directional exposure after the reduction. */
      readonly targetNetDirectionalExposure: ExactDecimal;
      readonly targetBaseQuantity: ExactDecimal | null;
      readonly targetHedgeRatio: ExactDecimal | null;
    })
  | (EconomicActionDecisionBase & {
      readonly kind: 'REQUEST_HEDGE';
      readonly targetQuoteDelta: ExactDecimal;
      readonly targetBaseQuantity: ExactDecimal | null;
      readonly targetHedgeRatio: ExactDecimal;
    })
  | (EconomicActionDecisionBase & { readonly kind: 'REQUEST_EXIT' })
  | (EconomicActionDecisionBase & { readonly kind: 'REQUEST_EMERGENCY_UNWIND' })
  | (EconomicActionDecisionBase & { readonly kind: 'FREEZE_NEW_ACTIONS' })
  | (EconomicActionDecisionBase & {
      readonly kind: 'NO_ACTION_UNKNOWN';
      readonly unknownReasonCodes: readonly string[];
    });

export interface PlanEconomicActionInput {
  readonly position: Readonly<ActionPositionProjection>;
  readonly decision: Readonly<EconomicActionDecision>;
  readonly controlPosture: Readonly<ControlPostureSnapshot>;
  readonly nowMs: number;
  readonly idempotencyKey: string;
  readonly correlationKey: string;
}

export interface ActionPlanningFailureContext {
  readonly requestedKind: PositionActionIntentKind;
  readonly safeCurrentExposure: NonNegativeDecimal;
}
