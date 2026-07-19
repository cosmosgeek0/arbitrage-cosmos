import type {
  AttentionRequest,
  AttentionTier,
  CandidateState,
  FocusState,
  StableFailure,
  StrategyCandidateHint,
  TruthMetadata,
  ValidationResult,
} from '../contracts/index.js';

export const SOURCE_QUALITY_STATES = ['HEALTHY', 'DEGRADED', 'STALE', 'FAILED', 'UNKNOWN'] as const;
export type SourceQualityState = (typeof SOURCE_QUALITY_STATES)[number];

export const FOCUS_ELIGIBILITY_STATES = ['ELIGIBLE', 'INELIGIBLE', 'UNKNOWN'] as const;
export type FocusEligibilityState = (typeof FOCUS_ELIGIBILITY_STATES)[number];

export interface AttentionFocusEligibility {
  state: FocusEligibilityState;
  reasonCodes: string[];
}

export interface AttentionSourceQuality {
  state: SourceQualityState;
  reasonCodes: string[];
}

export interface AttentionInstrument {
  instrumentId: string;
  symbol: string;
  /** Operator intent only; the planner still owns eligibility and capacity. */
  operatorPinned?: boolean;
  protectedCapital: boolean;
  releaseRequested: boolean;
  releaseReasonCodes: string[];
  focusEligibility: AttentionFocusEligibility;
  sourceQuality: AttentionSourceQuality;
  truth: TruthMetadata;
}

export interface AttentionAllocation extends FocusState {
  symbol: string;
  desiredTier: AttentionTier;
  priority: number | null;
  hintIds: string[];
  lastSignalAtMs: number | null;
  cooldownUntilMs: number | null;
  candidateOpenedAtMs: number | null;
  focusEligibility: AttentionFocusEligibility;
  sourceQuality: SourceQualityState;
}

export interface IgnoredCandidateHint {
  hintId: string;
  instrumentId: string;
  reasonCode: 'UNKNOWN_INSTRUMENT' | 'SYMBOL_MISMATCH' | 'STALE_HINT' | 'FUTURE_HINT' | 'UNAVAILABLE_HINT';
}

export interface AttentionPlanningInput {
  atMs: number;
  instruments: readonly AttentionInstrument[];
  previousAllocations?: readonly AttentionAllocation[];
  hints?: readonly StrategyCandidateHint[];
  hintPortFailures?: readonly StableFailure[];
}

export interface AttentionTierCounts {
  UNIVERSE: number;
  WATCH: number;
  CANDIDATE: number;
  FOCUS: number;
  DEEP_FOCUS: number;
  RELEASED: number;
}

export interface AttentionPlan {
  id: string;
  atMs: number;
  configurationVersion: string;
  allocations: AttentionAllocation[];
  candidates: CandidateState[];
  requests: AttentionRequest[];
  ignoredHints: IgnoredCandidateHint[];
  hintPortFailures: StableFailure[];
  tierCounts: AttentionTierCounts;
  truth: TruthMetadata;
}

export type AttentionPlanResult = ValidationResult<AttentionPlan>;

/** Narrow read-only bridge. Concrete strategy engines are intentionally absent. */
export interface StrategyCandidateHintPort {
  readonly portId: string;
  readCandidateHints(atMs: number): readonly StrategyCandidateHint[];
}
