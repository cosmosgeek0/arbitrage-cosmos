import type {
  LegLifecycle,
  PlanLifecycle,
  ReconciliationStatus,
} from '../../foundation/contracts/index.js';
import type { ExactDecimal, NonNegativeDecimal } from './decimal.js';
import type {
  ActivePositionId,
  CapitalMandateId,
  ExecutionCorrelationReferenceId,
  PositionThesisId,
  ReconciliationReferenceId,
  StrategyProposalId,
} from './identity.js';
import type { CapitalLifecycleState } from './lifecycle.js';
import type { TruthMetadata } from './truth.js';

export const POSITION_STATES = Object.freeze([
  'ENTERING',
  'PARTIALLY_EXPOSED',
  'HEDGED',
  'ACTIVE',
  'REDUCING',
  'EXITING',
  'RECOVERY_REQUIRED',
  'CLOSED',
  'UNKNOWN',
] as const);
export type PositionState = (typeof POSITION_STATES)[number];

export interface PositionLeg {
  readonly id: string;
  readonly instrumentId: string;
  readonly symbol: string;
  readonly side: 'LONG' | 'SHORT';
  readonly quantity: NonNegativeDecimal;
  readonly quoteExposure: NonNegativeDecimal;
  readonly valuationAsset: string;
  readonly externalLifecycle: LegLifecycle | null;
  readonly truth: Readonly<TruthMetadata>;
}

export interface PositionThesis {
  readonly id: PositionThesisId;
  readonly revision: number;
  readonly strategy: 'BASIS' | 'VOLUME';
  readonly proposalId: StrategyProposalId;
  readonly originalEvidenceIds: readonly string[];
  readonly intelligenceThesisPacketId: string | null;
  readonly openedAtMs: number;
  readonly expectedHorizonMs: number;
  readonly maximumHoldingHorizonMs: number;
  readonly targetConditions: readonly string[];
  readonly invalidationConditions: readonly string[];
  readonly stopAddingConditions: readonly string[];
  readonly configRevision: string;
}

export interface ExternalExecutionReference {
  readonly id: ExecutionCorrelationReferenceId;
  readonly externalPlanId: string;
  readonly correlationId: string;
  readonly lifecycle: PlanLifecycle;
  readonly observedAtMs: number;
  readonly sequence: number | null;
  readonly revision: string | null;
  readonly truth: Readonly<TruthMetadata>;
}

export interface ExternalReconciliationReference {
  readonly id: ReconciliationReferenceId;
  readonly externalPlanId: string;
  readonly correlationId: string;
  readonly status: ReconciliationStatus;
  readonly observedAtMs: number;
  readonly sequence: number | null;
  readonly revision: string | null;
  readonly reasonCodes: readonly string[];
  readonly truth: Readonly<TruthMetadata>;
}

export interface ActivePosition {
  readonly id: ActivePositionId;
  readonly revision: number;
  readonly mandateId: CapitalMandateId;
  readonly thesis: Readonly<PositionThesis>;
  readonly state: PositionState;
  readonly capitalLifecycle: CapitalLifecycleState;
  readonly legs: readonly Readonly<PositionLeg>[];
  readonly totalGrossExposure: NonNegativeDecimal;
  readonly netDirectionalExposure: ExactDecimal;
  readonly hedgeRatio: ExactDecimal | null;
  readonly oneLegExposure: NonNegativeDecimal;
  readonly oneLegSinceMs: number | null;
  readonly executionReference: Readonly<ExternalExecutionReference> | null;
  readonly reconciliationReference: Readonly<ExternalReconciliationReference> | null;
  readonly outstandingActionIntentIds: readonly string[];
  readonly openedAtMs: number;
  readonly lastTransitionAtMs: number;
  readonly truth: Readonly<TruthMetadata>;
}
