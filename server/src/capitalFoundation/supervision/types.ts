import type {
  ActivePosition,
  ConfigurationAuthority,
  ControlPostureSnapshot,
  ExactDecimal,
  ExactPolicyBound,
  IntegerPolicyBound,
  NonNegativeDecimal,
  TruthMetadata,
} from '../contracts/index.js';
import type { ActiveStageAuthorityBinding, PlannedEconomicActionIntent } from '../actions/index.js';
import type { StageTransitionAuthorization } from '../stages/index.js';

export const SUPERVISION_CHECK_STATUSES = Object.freeze(['PASS', 'WATCH', 'BREACH', 'UNKNOWN'] as const);
export type SupervisionCheckStatus = (typeof SUPERVISION_CHECK_STATUSES)[number];

/**
 * Runtime boundary failures for the public ActivePosition projection consumed
 * by supervision.  A TypeScript annotation is not evidence that the supplied
 * object came from the positions projector, so these are checked again before
 * HOLD, ADD, or risk-reducing geometry is derived.
 */
export const SUPERVISION_POSITION_BOUNDARY_ISSUES = Object.freeze([
  'POSITION_ID_INVALID',
  'POSITION_MANDATE_ID_INVALID',
  'POSITION_REVISION_INVALID',
  'POSITION_STATE_INVALID',
  'POSITION_CAPITAL_LIFECYCLE_INVALID',
  'POSITION_STATE_LIFECYCLE_MISMATCH',
  'POSITION_OPENED_AT_INVALID',
  'POSITION_LAST_TRANSITION_AT_INVALID',
  'POSITION_TIME_ORDER_INVALID',
  'POSITION_ONE_LEG_SINCE_INVALID',
  'POSITION_COLLECTION_INVALID',
  'POSITION_GEOMETRY_INVALID',
  'POSITION_EXTERNAL_REFERENCE_INVALID',
  'THESIS_ID_INVALID',
  'THESIS_PROPOSAL_ID_INVALID',
  'THESIS_REVISION_INVALID',
  'THESIS_OPENED_AT_INVALID',
  'THESIS_TIME_ORDER_INVALID',
  'THESIS_HORIZON_INVALID',
  'THESIS_CONFIG_REVISION_INVALID',
] as const);
export type SupervisionPositionBoundaryIssue = (typeof SUPERVISION_POSITION_BOUNDARY_ISSUES)[number];

export interface SupervisionCheck {
  readonly code: string;
  readonly status: SupervisionCheckStatus;
  readonly detail: string;
  readonly evidenceIds: readonly string[];
  readonly blockingForIncrease: boolean;
}

export interface ExpectedPositionLeg {
  readonly instrumentId: string;
  readonly side: 'LONG' | 'SHORT';
}

export interface MarketCapacityFacts {
  readonly executableSpreadCost: NonNegativeDecimal | null;
  readonly availableDepth: NonNegativeDecimal | null;
  readonly exitCapacity: NonNegativeDecimal | null;
  readonly projectedExitCost: NonNegativeDecimal | null;
  readonly truth: Readonly<TruthMetadata>;
  readonly evidenceIds: readonly string[];
}

export interface PositionCostFacts {
  readonly accruedKnownCost: ExactDecimal | null;
  readonly projectedAdditionalCost: NonNegativeDecimal | null;
  readonly truth: Readonly<TruthMetadata>;
  readonly sourceIds: readonly string[];
}

export interface ThesisAssessment {
  readonly invalidated: boolean | null;
  readonly targetReached: boolean | null;
  readonly supportingEvidenceIds: readonly string[];
  readonly conflictingEvidenceIds: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly truth: Readonly<TruthMetadata>;
}

/**
 * Direct consumption of the stages lane's public, fail-closed transition
 * authorization.  Caller-supplied freshness/approval booleans are not an
 * authority surface.
 */
export type NextStageAuthority = StageTransitionAuthorization;

export interface CommonSupervisionPolicy {
  readonly authority: Readonly<ConfigurationAuthority>;
  readonly valuationAsset: string;
  readonly targetHedgeRatio: Readonly<ExactPolicyBound>;
  readonly maximumHedgeRatioDrift: Readonly<ExactPolicyBound>;
  readonly maximumOneLegExposure: Readonly<ExactPolicyBound>;
  readonly maximumOneLegDurationMs: Readonly<IntegerPolicyBound>;
  readonly emergencyOneLegDurationMs: Readonly<IntegerPolicyBound>;
  readonly minimumExitCapacity: Readonly<ExactPolicyBound>;
  readonly minimumAvailableDepth: Readonly<ExactPolicyBound>;
  readonly maximumExecutableSpreadCost: Readonly<ExactPolicyBound>;
  readonly maximumProjectedExitCost: Readonly<ExactPolicyBound>;
  readonly maximumTotalGrossExposure: Readonly<ExactPolicyBound>;
  readonly reductionTargetExposure: Readonly<ExactPolicyBound>;
  readonly maximumOutstandingIntents: Readonly<IntegerPolicyBound>;
}

export interface CommonSupervisionInput {
  readonly position: Readonly<ActivePosition>;
  readonly expectedLegs: readonly Readonly<ExpectedPositionLeg>[];
  readonly market: Readonly<MarketCapacityFacts>;
  readonly costs: Readonly<PositionCostFacts>;
  readonly thesisAssessment: Readonly<ThesisAssessment>;
  readonly controlPosture: Readonly<ControlPostureSnapshot>;
  readonly policy: Readonly<CommonSupervisionPolicy>;
  /** Independent incumbent-plan binding used to authenticate an ADD authority. */
  readonly activeStageAuthority: Readonly<ActiveStageAuthorityBinding> | null;
  readonly nextStageAuthority: Readonly<NextStageAuthority> | null;
  readonly economicCostOfWaiting: NonNegativeDecimal | null;
  readonly expectedCostOfActing: NonNegativeDecimal | null;
  readonly nowMs: number;
}

export const EXACT_EVIDENCE_SIGNAL_STATES = Object.freeze(['PRESENT', 'ABSENT', 'UNKNOWN'] as const);
export type ExactEvidenceSignalState = (typeof EXACT_EVIDENCE_SIGNAL_STATES)[number];

export interface ExactEvidenceSignal {
  readonly state: ExactEvidenceSignalState;
  readonly strength: NonNegativeDecimal | null;
  readonly truth: Readonly<TruthMetadata>;
  readonly evidenceIds: readonly string[];
}

export interface BasisPathObservation {
  readonly executableBasis: ExactDecimal;
  readonly observedAtMs: number;
  readonly truth: Readonly<TruthMetadata>;
  readonly evidenceId: string;
}

export const BASIS_FUNDING_DIRECTIONS = Object.freeze(['PAID', 'RECEIVED', 'FLAT', 'UNKNOWN'] as const);
export type BasisFundingDirection = (typeof BASIS_FUNDING_DIRECTIONS)[number];

export interface BasisFundingFacts {
  readonly rate: ExactDecimal | null;
  readonly direction: BasisFundingDirection;
  readonly nextFundingAtMs: number | null;
  readonly accruedFunding: ExactDecimal | null;
  readonly truth: Readonly<TruthMetadata>;
  readonly evidenceIds: readonly string[];
}

export const BASIS_RESOURCE_AVAILABILITIES = Object.freeze(['AVAILABLE', 'UNAVAILABLE', 'RECALLED', 'UNKNOWN', 'NOT_REQUIRED'] as const);
export type BasisBorrowAvailability = (typeof BASIS_RESOURCE_AVAILABILITIES)[number];

export interface BasisBorrowFacts {
  readonly availability: BasisBorrowAvailability;
  readonly rate: NonNegativeDecimal | null;
  readonly accruedCost: NonNegativeDecimal | null;
  readonly truth: Readonly<TruthMetadata>;
  readonly evidenceIds: readonly string[];
}

export interface BasisSpecificFacts {
  readonly entryExecutableBasis: ExactDecimal;
  readonly currentExecutableBasis: ExactDecimal;
  readonly convergencePath: readonly Readonly<BasisPathObservation>[];
  readonly expectedRemainingEdgeAfterExitCosts: ExactDecimal | null;
  readonly funding: Readonly<BasisFundingFacts>;
  readonly borrow: Readonly<BasisBorrowFacts>;
  readonly hedgeDrift: NonNegativeDecimal | null;
  readonly liquidationDistance: NonNegativeDecimal | null;
  readonly marginDistance: NonNegativeDecimal | null;
  readonly spotLiquidityDeterioration: NonNegativeDecimal | null;
  readonly perpetualLiquidityDeterioration: NonNegativeDecimal | null;
  readonly truth: Readonly<TruthMetadata>;
  readonly evidenceIds: readonly string[];
}

export interface BasisSupervisionPolicy {
  readonly authority: Readonly<ConfigurationAuthority>;
  readonly minimumRemainingEdge: Readonly<ExactPolicyBound>;
  readonly minimumRemainingEdgeForAdd: Readonly<ExactPolicyBound>;
  readonly maximumAdverseBasisMove: Readonly<ExactPolicyBound>;
  readonly maximumAdverseFundingRate: Readonly<ExactPolicyBound>;
  readonly fundingExitLeadTimeMs: Readonly<IntegerPolicyBound>;
  readonly maximumBorrowRate: Readonly<ExactPolicyBound>;
  readonly maximumHedgeDrift: Readonly<ExactPolicyBound>;
  readonly minimumLiquidationDistance: Readonly<ExactPolicyBound>;
  readonly minimumMarginDistance: Readonly<ExactPolicyBound>;
  readonly maximumLiquidityDeterioration: Readonly<ExactPolicyBound>;
  readonly requiredConvergingObservationsForAdd: Readonly<IntegerPolicyBound>;
}

export interface BasisSupervisionInput {
  readonly common: Readonly<CommonSupervisionInput>;
  readonly basis: Readonly<BasisSpecificFacts>;
  readonly policy: Readonly<BasisSupervisionPolicy>;
}

export const VOLUME_LEADERSHIP_STATES = Object.freeze(['SPOT', 'PERPETUAL', 'MIXED', 'UNKNOWN'] as const);
export type VolumeLeadershipState = (typeof VOLUME_LEADERSHIP_STATES)[number];

export const VOLUME_CALIBRATION_MODES = Object.freeze(['OBSERVE_ONLY', 'VALIDATE_ONLY', 'MANUAL_ARMED'] as const);
export type VolumeCalibrationMode = (typeof VOLUME_CALIBRATION_MODES)[number];

export interface VolumeSpecificFacts {
  readonly originalThesisStage: string;
  readonly continuation: Readonly<ExactEvidenceSignal>;
  readonly acceleration: Readonly<ExactEvidenceSignal>;
  readonly exhaustion: Readonly<ExactEvidenceSignal>;
  readonly reversal: Readonly<ExactEvidenceSignal>;
  readonly leadership: VolumeLeadershipState;
  readonly liquidityDeterioration: NonNegativeDecimal | null;
  readonly crowding: Readonly<ExactEvidenceSignal>;
  readonly funding: Readonly<ExactEvidenceSignal>;
  readonly openInterest: Readonly<ExactEvidenceSignal>;
  readonly falseFollowThrough: boolean | null;
  readonly washLike: boolean | null;
  readonly calibrationMode: VolumeCalibrationMode;
  readonly calibrationTruth: Readonly<TruthMetadata>;
  readonly truth: Readonly<TruthMetadata>;
  readonly evidenceIds: readonly string[];
}

export interface VolumeSupervisionPolicy {
  readonly authority: Readonly<ConfigurationAuthority>;
  readonly minimumContinuationStrength: Readonly<ExactPolicyBound>;
  readonly minimumAccelerationStrengthForAdd: Readonly<ExactPolicyBound>;
  readonly maximumExhaustionStrength: Readonly<ExactPolicyBound>;
  readonly maximumReversalStrength: Readonly<ExactPolicyBound>;
  readonly maximumCrowdingStrength: Readonly<ExactPolicyBound>;
  readonly maximumLiquidityDeterioration: Readonly<ExactPolicyBound>;
  readonly requireSpotLeadershipForAdd: boolean;
  readonly reduceOnPerpetualLeadership: boolean;
}

export interface VolumeSupervisionInput {
  readonly common: Readonly<CommonSupervisionInput>;
  readonly volume: Readonly<VolumeSpecificFacts>;
  readonly policy: Readonly<VolumeSupervisionPolicy>;
}

export interface SupervisionDecision {
  readonly strategy: 'BASIS' | 'VOLUME';
  readonly positionId: ActivePosition['id'];
  readonly positionRevision: number;
  readonly thesisRevision: number;
  readonly priority: 'EXPOSED_CAPITAL';
  /** Bound authority projection prevents a verified ADD from degrading to an unbound base intent. */
  readonly intent: Readonly<PlannedEconomicActionIntent>;
  readonly checks: readonly Readonly<SupervisionCheck>[];
  readonly evaluatedAtMs: number;
  readonly decisionKey: string;
}
