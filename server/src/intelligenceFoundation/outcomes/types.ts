import type {
  FrozenPreEventRecord,
  NormalizedEvidence,
  OutcomeLabel,
  OutcomeMetrics,
  ThesisPacket,
  ForensicCheck,
  FeatureValue,
  ValidationResult,
  TruthMetadata,
} from '../contracts/index.js';

export type CandidateDisposition = 'ACCEPTED' | 'REJECTED' | 'OBSERVED';
export type OutcomeDirection = 'UP' | 'DOWN';
export type OutcomePriceBasis = 'TRADE' | 'BOOK_MID' | 'MARK' | 'INDEX';
export type OutcomeMetricField = keyof OutcomeMetrics | 'laterMoved';

export interface FreezePreEventInput {
  triggerTimeMs: number;
  evidenceCutoffTimeMs?: number;
  candidateDisposition: CandidateDisposition;
  thesis: ThesisPacket;
  forensics: readonly ForensicCheck[];
  evidence: readonly NormalizedEvidence[];
  features: readonly FeatureValue[];
  configurationVersion: string;
  featureVersion: string;
  producerVersion: string;
}

export interface LiquiditySurvivalPolicy {
  /** Frozen BOOK_TICKER used as the pre-event top-of-book liquidity baseline. */
  referenceEvidenceId: string;
}

export interface DepthSurvivalPolicy {
  /** Frozen DEPTH_SNAPSHOT used as the pre-event depth baseline. */
  referenceEvidenceId: string;
}

export interface TheoreticalExecutionPolicy {
  /** Frozen DEPTH_SNAPSHOT used for a no-look-ahead, trigger-time depth walk. */
  depthEvidenceId: string;
  side: 'BUY' | 'SELL';
  intendedBaseQuantity: number;
  maximumSlippagePct: number;
}

export interface OutcomePolicy {
  horizonMs: number;
  direction: OutcomeDirection;
  movedThresholdPct: number;
  terminalMaxAgeMs: number;
  requiredMetricFields: readonly OutcomeMetricField[];
  referenceEvidenceId: string;
  priceBasis: OutcomePriceBasis;
  liquidity?: LiquiditySurvivalPolicy;
  depth?: DepthSurvivalPolicy;
  execution?: TheoreticalExecutionPolicy;
}

export interface OutcomePolicySnapshot {
  readonly id: string;
  readonly horizonMs: number;
  readonly direction: OutcomeDirection;
  readonly movedThresholdPct: number;
  readonly terminalMaxAgeMs: number;
  readonly requiredMetricFields: readonly OutcomeMetricField[];
  readonly referenceEvidenceId: string;
  readonly priceBasis: OutcomePriceBasis;
  readonly liquidity: Readonly<LiquiditySurvivalPolicy> | null;
  readonly depth: Readonly<DepthSurvivalPolicy> | null;
  readonly execution: Readonly<TheoreticalExecutionPolicy> | null;
}

export interface AttributedOutcomeLabel extends OutcomeLabel {
  readonly policy: OutcomePolicySnapshot;
}

export interface AttributeOutcomeInput {
  frozen: FrozenPreEventRecord;
  evaluatedAtMs: number;
  policy: OutcomePolicy;
  laterEvidence: readonly NormalizedEvidence[];
}

export interface IntelligenceOutcomeState {
  readonly frozenRecords: readonly FrozenPreEventRecord[];
  readonly labels: readonly AttributedOutcomeLabel[];
  readonly truth: TruthMetadata;
}

export type OutcomeStateEvent =
  | { type: 'FROZEN_RECORD_ADDED'; record: FrozenPreEventRecord }
  | { type: 'OUTCOME_LABEL_ADDED'; label: AttributedOutcomeLabel };

export interface DispositionOutcomeCounts {
  total: number;
  moved: number;
  didNotMove: number;
  unknown: number;
}

export interface OutcomeCohort {
  id: string;
  configurationVersion: string;
  featureVersion: string;
  policyId: string;
  horizonMs: number;
  direction: OutcomeDirection;
  priceBasis: OutcomePriceBasis;
  total: number;
  complete: number;
  incomplete: number;
  accepted: DispositionOutcomeCounts;
  rejected: DispositionOutcomeCounts;
  observed: DispositionOutcomeCounts;
  metricMeans: NumericOutcomeMetricMeans;
  executionFeasibility: ExecutionFeasibilitySummary;
  truth: TruthMetadata;
}

export type NumericOutcomeMetricMeans = Omit<OutcomeMetrics, 'theoreticalExecutionFeasible'>;

export interface ExecutionFeasibilitySummary {
  evaluated: number;
  feasible: number;
  infeasible: number;
  unknown: number;
  feasibleRate: number | null;
}

export type FreezeResult = ValidationResult<FrozenPreEventRecord>;
export type AttributionResult = ValidationResult<AttributedOutcomeLabel>;
