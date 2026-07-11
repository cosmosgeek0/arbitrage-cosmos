import type {
  ActionUrgency,
  CapitalTruthState,
  ControlPostureSnapshot,
  ExactDecimal,
  FutureGate,
  NonNegativeDecimal,
  PositionActionIntent,
  PositionActionIntentKind,
} from '../contracts/index.js';
import type {
  ActivePositionId,
  PositionThesisId,
} from '../contracts/identity.js';
import type { StageTransitionAuthorization } from '../stages/index.js';

/**
 * The staged-plan identity already attached to the supervised position.  This
 * is intentionally separate from a transition authorization so a caller
 * cannot make an ADD self-consistent merely by setting approval booleans.
 */
export interface ActiveStageAuthorityBinding {
  readonly activeStage: StageTransitionAuthorization['from'];
  readonly planId: StageTransitionAuthorization['planId'];
  readonly planRevision: StageTransitionAuthorization['planRevision'];
  readonly planDigest: StageTransitionAuthorization['planDigest'];
  readonly reservationId: NonNullable<StageTransitionAuthorization['reservationId']>;
  readonly reservationRevision: NonNullable<StageTransitionAuthorization['reservationRevision']>;
  readonly approvalId: NonNullable<StageTransitionAuthorization['approvalId']>;
  readonly approvalRevision: NonNullable<StageTransitionAuthorization['approvalRevision']>;
}

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
  readonly activeStageAuthority: Readonly<ActiveStageAuthorityBinding> | null;
}

/** Direct type-only consumption of the stages lane's public authority output. */
export type NextStageIncreaseAuthority = StageTransitionAuthorization;

export interface DirectionalReductionGeometry {
  readonly currentTotalExposure: NonNegativeDecimal;
  readonly targetTotalExposure: NonNegativeDecimal;
  readonly currentNetDirectionalExposure: ExactDecimal;
  readonly targetNetDirectionalExposure: ExactDecimal;
  readonly absoluteDirectionalExposureReduction: NonNegativeDecimal;
}

/**
 * Action-lane enrichment of the frozen cross-lane intent contract.  The
 * external execution owner still receives an economic target, never orders.
 */
export interface ActionIntentAuthorityProjection {
  readonly stageTransitionAuthorization: Readonly<StageTransitionAuthorization> | null;
  readonly directionalReductionGeometry: Readonly<DirectionalReductionGeometry> | null;
}

export type PlannedEconomicActionIntent = PositionActionIntent & ActionIntentAuthorityProjection;

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
