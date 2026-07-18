/**
 * Cross-engine strategy decay vocabulary.
 *
 * Basis and Volume remain the only strategy authorities. This contract lets
 * those owners consume one versioned measurement and emit a conservative,
 * monotonic governance decision. It contains no execution or capital-mutation
 * capability.
 */

export const STRATEGY_DECAY_MEASUREMENT_SCHEMA = 'cosmos.engine.strategy-decay.measurement' as const;
export const STRATEGY_DECAY_MEASUREMENT_SCHEMA_VERSION = 1 as const;
export const STRATEGY_DECAY_DECISION_SCHEMA = 'cosmos.engine.strategy-decay.decision' as const;
export const STRATEGY_DECAY_DECISION_SCHEMA_VERSION = 1 as const;
export const STRATEGY_DECAY_HISTORY_SCHEMA = 'cosmos.engine.strategy-decay.history' as const;
export const STRATEGY_DECAY_HISTORY_SCHEMA_VERSION = 1 as const;

export const STRATEGY_DECAY_SOURCES = Object.freeze(['BASIS', 'VOLUME'] as const);
export type StrategyDecaySource = (typeof STRATEGY_DECAY_SOURCES)[number];

export const STRATEGY_DECAY_AXES = Object.freeze([
  'CALIBRATION_RELIABILITY',
  'CLOSED_OUTCOME_NET_VALUE',
  'DIRECT_COMPETITOR_DISPLACEMENT',
] as const);
export type StrategyDecayAxis = (typeof STRATEGY_DECAY_AXES)[number];

export const STRATEGY_DECAY_STATES = Object.freeze([
  'UNKNOWN',
  'STABLE',
  'DEGRADED',
  'DEAD',
] as const);
export type StrategyDecayState = (typeof STRATEGY_DECAY_STATES)[number];

export const STRATEGY_DECAY_EVIDENCE_AUTHORITIES = Object.freeze([
  'PRODUCTION',
  'RECORDED_REPLAY',
  'SYNTHETIC_TEST',
  'UNKNOWN',
] as const);
export type StrategyDecayEvidenceAuthority = (typeof STRATEGY_DECAY_EVIDENCE_AUTHORITIES)[number];

export const STRATEGY_DECAY_DECISION_KINDS = Object.freeze([
  'HOLD_UNKNOWN',
  'HOLD_STABLE',
  'REDUCE',
  'DISABLE',
  'RETIRE',
] as const);
export type StrategyDecayDecisionKind = (typeof STRATEGY_DECAY_DECISION_KINDS)[number];

export const STRATEGY_DECAY_POSTURES = Object.freeze([
  'ENABLED',
  'REDUCED',
  'DISABLED',
  'RETIRED',
] as const);
export type StrategyDecayPosture = (typeof STRATEGY_DECAY_POSTURES)[number];

export const STRATEGY_DECAY_RESEARCH_STATES = Object.freeze([
  'NONE',
  'PENDING_REVIEW',
] as const);
export type StrategyDecayResearchState = (typeof STRATEGY_DECAY_RESEARCH_STATES)[number];

export interface StrategyDecayWindow {
  /** Half-open UTC interval [startAtMs, endAtMs). */
  readonly startAtMs: number;
  readonly endAtMs: number;
}

export interface StrategyDecayAxisAssessment {
  readonly axis: StrategyDecayAxis;
  readonly state: StrategyDecayState;
  readonly baselineSampleCount: number;
  readonly currentSampleCount: number;
  /** Exact decimal or reduced-fraction text; null means unknown. */
  readonly baselineValue: string | null;
  readonly currentValue: string | null;
  readonly unit: 'RATIO' | 'QUOTE_ASSET';
  readonly reasonCodes: readonly string[];
  readonly evidenceIds: readonly string[];
}

export interface StrategyDecayMeasurement {
  readonly schema: typeof STRATEGY_DECAY_MEASUREMENT_SCHEMA;
  readonly schemaVersion: typeof STRATEGY_DECAY_MEASUREMENT_SCHEMA_VERSION;
  readonly measurementId: string;
  readonly strategy: StrategyDecaySource;
  readonly configVersion: string;
  readonly direction: string;
  readonly evaluatedAtMs: number;
  readonly evidenceAuthority: StrategyDecayEvidenceAuthority;
  readonly baselineWindow: Readonly<StrategyDecayWindow>;
  readonly currentWindow: Readonly<StrategyDecayWindow>;
  /** Exactly one assessment for each canonical axis, in canonical order. */
  readonly axes: readonly Readonly<StrategyDecayAxisAssessment>[];
  readonly state: StrategyDecayState;
  readonly reasonCodes: readonly string[];
}

export interface StrategyDecayGovernancePolicy {
  readonly policyId: string;
  readonly policyRevision: string;
  readonly reduceAfterConsecutiveDegradedWindows: number;
  readonly disableAfterConsecutiveDeadWindows: number;
  readonly retireAfterConsecutiveDeadWindows: number;
  readonly maximumRecentDecisions: number;
}

export interface StrategyDecayDecision {
  readonly schema: typeof STRATEGY_DECAY_DECISION_SCHEMA;
  readonly schemaVersion: typeof STRATEGY_DECAY_DECISION_SCHEMA_VERSION;
  readonly decisionId: string;
  readonly revision: number;
  readonly strategy: StrategyDecaySource;
  readonly configVersion: string;
  readonly policyRevision: string;
  readonly measurementId: string;
  readonly evaluatedAtMs: number;
  readonly kind: StrategyDecayDecisionKind;
  readonly priorPosture: StrategyDecayPosture;
  readonly nextPosture: StrategyDecayPosture;
  readonly researchState: StrategyDecayResearchState;
  readonly researchCandidateId: string | null;
  readonly reasonCodes: readonly string[];
  /** Explicit proof that research redirection cannot self-promote. */
  readonly automaticResearchPromotion: false;
  readonly executionAuthority: 'NONE';
}

export interface StrategyDecayDecisionSummary {
  readonly decisionId: string;
  readonly revision: number;
  readonly measurementId: string;
  readonly evaluatedAtMs: number;
  readonly kind: StrategyDecayDecisionKind;
  readonly nextPosture: StrategyDecayPosture;
  readonly researchState: StrategyDecayResearchState;
}

export interface StrategyDecayHistoryState {
  readonly schema: typeof STRATEGY_DECAY_HISTORY_SCHEMA;
  readonly schemaVersion: typeof STRATEGY_DECAY_HISTORY_SCHEMA_VERSION;
  readonly strategy: StrategyDecaySource;
  readonly configVersion: string;
  readonly policyRevision: string;
  readonly revision: number;
  readonly effectivePosture: StrategyDecayPosture;
  readonly researchState: StrategyDecayResearchState;
  readonly researchCandidateId: string | null;
  readonly consecutiveDegradedWindows: number;
  readonly consecutiveDeadWindows: number;
  readonly totalDecisionCount: number;
  readonly compactedDecisionCount: number;
  readonly recentDecisions: readonly Readonly<StrategyDecayDecisionSummary>[];
  /** Hash-chain head covers every decision, including compacted summaries. */
  readonly historyDigest: string;
}

export type StrategyDecayEvaluationResult =
  | {
      readonly ok: true;
      readonly decision: Readonly<StrategyDecayDecision>;
      readonly nextState: Readonly<StrategyDecayHistoryState>;
    }
  | {
      readonly ok: false;
      readonly reasonCodes: readonly string[];
    };
