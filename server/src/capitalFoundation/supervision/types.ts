import type {
  ActivePosition,
  ConfigurationAuthority,
  ControlPostureSnapshot,
  ExactDecimal,
  ExactPolicyBound,
  IntegerPolicyBound,
  NonNegativeDecimal,
  PositionActionIntent,
  TruthMetadata,
} from '../contracts/index.js';

export const SUPERVISION_CHECK_STATUSES = ['PASS', 'WATCH', 'BREACH', 'UNKNOWN'] as const;
export type SupervisionCheckStatus = (typeof SUPERVISION_CHECK_STATUSES)[number];

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

export interface NextStageAuthority {
  readonly maximumAdditionalExposure: NonNegativeDecimal;
  readonly maximumTotalExposure: NonNegativeDecimal;
  readonly evidenceFresh: boolean;
  readonly reservationAvailable: boolean;
  readonly approvalCurrent: boolean;
  readonly futureRiskRecheckRequired: boolean;
  readonly adversePriceMoveIsSoleReason: boolean;
  readonly authorityReferences: readonly string[];
}

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
  readonly nextStageAuthority: Readonly<NextStageAuthority> | null;
  readonly economicCostOfWaiting: NonNegativeDecimal | null;
  readonly expectedCostOfActing: NonNegativeDecimal | null;
  readonly nowMs: number;
}

export interface ExactEvidenceSignal {
  readonly state: 'PRESENT' | 'ABSENT' | 'UNKNOWN';
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

export interface BasisFundingFacts {
  readonly rate: ExactDecimal | null;
  readonly direction: 'PAID' | 'RECEIVED' | 'FLAT' | 'UNKNOWN';
  readonly nextFundingAtMs: number | null;
  readonly accruedFunding: ExactDecimal | null;
  readonly truth: Readonly<TruthMetadata>;
  readonly evidenceIds: readonly string[];
}

export interface BasisBorrowFacts {
  readonly availability: 'AVAILABLE' | 'UNAVAILABLE' | 'RECALLED' | 'UNKNOWN' | 'NOT_REQUIRED';
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

export interface VolumeSpecificFacts {
  readonly originalThesisStage: string;
  readonly continuation: Readonly<ExactEvidenceSignal>;
  readonly acceleration: Readonly<ExactEvidenceSignal>;
  readonly exhaustion: Readonly<ExactEvidenceSignal>;
  readonly reversal: Readonly<ExactEvidenceSignal>;
  readonly leadership: 'SPOT' | 'PERPETUAL' | 'MIXED' | 'UNKNOWN';
  readonly liquidityDeterioration: NonNegativeDecimal | null;
  readonly crowding: Readonly<ExactEvidenceSignal>;
  readonly funding: Readonly<ExactEvidenceSignal>;
  readonly openInterest: Readonly<ExactEvidenceSignal>;
  readonly falseFollowThrough: boolean | null;
  readonly washLike: boolean | null;
  readonly calibrationMode: 'OBSERVE_ONLY' | 'VALIDATE_ONLY' | 'MANUAL_ARMED';
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
  readonly intent: Readonly<PositionActionIntent>;
  readonly checks: readonly Readonly<SupervisionCheck>[];
  readonly evaluatedAtMs: number;
  readonly decisionKey: string;
}
