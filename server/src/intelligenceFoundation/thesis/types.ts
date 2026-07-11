import type {
  BaselineState,
  CandidateState,
  EvidenceKind,
  FeatureValue,
  HypothesisClass,
  MarketStage,
  NormalizedEvidence,
  TruthMetadata,
} from '../contracts/index.js';

export interface ThesisFeatureBindings {
  spotRelativeVolume: string;
  perpetualRelativeVolume: string;
  spotArrivalAcceleration: string;
  perpetualArrivalAcceleration: string;
  symbolReturnPct: string;
  spotReturnPct: string;
  perpetualReturnPct: string;
  aggressorImbalance: string;
  priceResponsePerFlow: string;
  depthSupportRatio: string;
  depthChangeRatio: string;
  spreadChangeBps: string;
  replenishmentRatio: string;
  absorptionRatio: string;
  fundingRateChange: string;
  openInterestChangePct: string;
  liquidationFlowShare: string;
  marketParticipationRatio: string;
  symbolMarketResidualReturnPct: string;
  fadeFromPeakPct: string;
  historicalAnalogueCount: string;
  tradeSizeRepeatRatio: string;
  sideAlternationRatio: string;
  deadBaselineFlag: string;
}

export interface ThesisRules {
  version: string;
  bindings: ThesisFeatureBindings;
  shortWindowMs: number;
  confirmationWindowMs: number;
  mediumWindowMs: number;
  leadLagTieMs: number;
  activityMultiple: number;
  arrivalAcceleration: number;
  visibleMovePct: number;
  continuationMovePct: number;
  quietMovePct: number;
  flowImbalanceAbs: number;
  lowPriceResponsePerFlow: number;
  depthSupportRatio: number;
  depthCollapseRatio: number;
  marketParticipationRatio: number;
  maxSymbolResidualPct: number;
  liquidationFlowShare: number;
  oiDropPct: number;
  fundingChangeAbs: number;
  oiChangeAbs: number;
  absorptionRatio: number;
  replenishmentRatio: number;
  churnRepeatRatio: number;
  churnAlternationRatio: number;
  exhaustionMovePct: number;
  reversalFadePct: number;
  tooLateDetectionLagMs: number;
  maxFreshAgeMs: number;
}

export interface ThesisBuildInput {
  candidate: CandidateState;
  baseline: BaselineState | null;
  features: readonly FeatureValue[];
  evidence: readonly NormalizedEvidence[];
  analogueIds: readonly string[];
  evaluatedAtMs: number;
  intendedQuoteNotional: number | null;
  requiredEvidenceKinds: readonly EvidenceKind[];
}

export interface ResolvedThesisSignal {
  state: 'AVAILABLE' | 'UNAVAILABLE';
  value: FeatureValue['value'];
  featureIds: string[];
  observationStartMs: number | null;
  observationEndMs: number | null;
  reasonCodes: string[];
  truths: TruthMetadata[];
}

export interface StageClassificationInput {
  baselineReady: boolean;
  shortMovePct: number | null;
  confirmationMovePct: number | null;
  mediumMovePct: number | null;
  shortActivityMultiple: number | null;
  confirmationActivityMultiple: number | null;
  mediumActivityMultiple: number | null;
  shortArrivalAcceleration: number | null;
  confirmationArrivalAcceleration: number | null;
  mediumArrivalAcceleration: number | null;
  aggressorImbalance: number | null;
  depthSupportRatio: number | null;
  depthChangeRatio: number | null;
  spreadChangeBps: number | null;
  fadeFromPeakPct: number | null;
  candidateOpenedAtMs: number;
  changedAtMs: number | null;
}

export interface StageAssessment {
  stage: MarketStage;
  reasonCodes: string[];
}

export interface HypothesisClassificationInput {
  stage: MarketStage;
  leadMarket: 'SPOT' | 'PERPETUAL' | 'NEITHER' | 'UNKNOWN';
  deadBaseline: boolean | null;
  spotActivityHot: boolean | null;
  persistentActivity: boolean | null;
  visibleMove: boolean | null;
  aggressorImbalance: number | null;
  priceResponsePerFlow: number | null;
  depthSupportRatio: number | null;
  depthChangeRatio: number | null;
  replenishmentRatio: number | null;
  absorptionRatio: number | null;
  fundingRateChange: number | null;
  openInterestChangePct: number | null;
  liquidationFlowShare: number | null;
  marketParticipationRatio: number | null;
  symbolMarketResidualReturnPct: number | null;
  tradeSizeRepeatRatio: number | null;
  sideAlternationRatio: number | null;
}

export interface HypothesisAssessment {
  hypothesis: HypothesisClass;
  reasonCodes: string[];
}
