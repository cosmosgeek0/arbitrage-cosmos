/**
 * Wave 3 Lane — proposal outcome attribution and observational calibration.
 *
 * This vocabulary deliberately contains no threshold, recommendation, or
 * mutation command. Strategy engines remain the only strategy authorities;
 * this lane records evidence and computes version-isolated measurements.
 */
import type {
  ContractResult,
  StrategySource,
} from '../contracts/index.js';

export const PROPOSAL_OUTCOME_SCHEMA = 'cosmos.foundation.calibration.proposal-outcome' as const;
export const PROPOSAL_OUTCOME_SCHEMA_VERSION = 1 as const;
export const PROBABILITY_PPM_SCALE = 1_000_000 as const;
/** Hard bound before record validation/aggregation work begins. */
export const MAX_CALIBRATION_RECORDS = 10_000 as const;
export const MAX_CALIBRATION_VALIDATION_ISSUES = 64 as const;

export const OUTCOME_STATUSES = ['COMPLETE', 'INCOMPLETE'] as const;
export type OutcomeStatus = (typeof OUTCOME_STATUSES)[number];

/** Every numeric result is an exact safe integer in one declared unit. */
export const OUTCOME_RESULT_UNITS = [
  'USD_MICROS',
  'QUOTE_ASSET_MICROS',
  'BASIS_POINTS_X1E4',
] as const;
export type OutcomeResultUnit = (typeof OUTCOME_RESULT_UNITS)[number];

export interface CalibrationContext {
  /** UTC milliseconds from an injected real/replay/test clock. */
  nowMs: number;
  correlationId: string;
}

export interface ProposalObservationWindow {
  startAtMs: number;
  endAtMs: number;
}

export interface ProposalOutcomeInput {
  canonicalProposalId: string;
  /** Explicit null means no execution plan was bound. */
  planId: string | null;
  source: StrategySource;
  /** Versioned source-strategy output schema, e.g. basis.proposal.v1. */
  strategySchema: string;
  configVersion: string;
  direction: string;
  resultUnit: OutcomeResultUnit;
  proposalObservedAtMs: number;
  observationWindow: ProposalObservationWindow;
  status: OutcomeStatus;
  /** Required for COMPLETE, null for INCOMPLETE. */
  finalizedAtMs: number | null;
  /** Exact probability of success in parts per million; null when absent. */
  predictedProbabilityPpm: number | null;
  /** Required for COMPLETE, null for INCOMPLETE. */
  realizedSuccess: boolean | null;
  /** Signed result values in resultUnit. */
  grossResultMicrounits: number | null;
  feesMicrounits: number | null;
  slippageMicrounits: number | null;
  otherCostsMicrounits: number | null;
  netResultMicrounits: number | null;
  /** Exact filled/intended ratio in PPM; zero is known zero, null is missing. */
  fillRatioPpm: number | null;
}

export interface ProposalOutcomeRecord {
  schema: typeof PROPOSAL_OUTCOME_SCHEMA;
  schemaVersion: typeof PROPOSAL_OUTCOME_SCHEMA_VERSION;
  /** Stable identity over proposal/plan/source/config/schema/direction/unit/window. */
  outcomeId: string;
  /** Stable semantic content hash; recordedAtMs intentionally excluded. */
  contentFingerprint: string;
  recordedAtMs: number;
  canonicalProposalId: string;
  planId: string | null;
  source: StrategySource;
  strategySchema: string;
  configVersion: string;
  direction: string;
  resultUnit: OutcomeResultUnit;
  proposalObservedAtMs: number;
  observationWindow: ProposalObservationWindow;
  status: OutcomeStatus;
  finalizedAtMs: number | null;
  predictedProbabilityPpm: number | null;
  realizedSuccess: boolean | null;
  grossResultMicrounits: number | null;
  feesMicrounits: number | null;
  slippageMicrounits: number | null;
  otherCostsMicrounits: number | null;
  netResultMicrounits: number | null;
  fillRatioPpm: number | null;
}

export interface CalibrationCohort {
  source: StrategySource;
  strategySchema: string;
  configVersion: string;
  direction: string;
  resultUnit: OutcomeResultUnit;
  /** Exact observation horizon; different horizons are never blended. */
  observationHorizonMs: number;
}

export interface AggregateProposalOutcomesInput extends CalibrationContext {
  cohort: CalibrationCohort;
  records: readonly ProposalOutcomeRecord[];
}

export const CALIBRATION_EXCLUSION_REASONS = [
  'SOURCE_MISMATCH',
  'STRATEGY_SCHEMA_MISMATCH',
  'CONFIG_VERSION_MISMATCH',
  'DIRECTION_MISMATCH',
  'RESULT_UNIT_MISMATCH',
  'OBSERVATION_HORIZON_MISMATCH',
  'OUTCOME_INCOMPLETE',
] as const;
export type CalibrationExclusionReason = (typeof CALIBRATION_EXCLUSION_REASONS)[number];

export interface CalibrationExclusion {
  reason: CalibrationExclusionReason;
  count: number;
  outcomeIds: readonly string[];
}

export const MISSING_EVIDENCE_REASONS = [
  'MISSING_PREDICTED_PROBABILITY',
  'MISSING_GROSS_RESULT',
  'MISSING_FEES',
  'MISSING_SLIPPAGE',
  'MISSING_OTHER_COSTS',
  'MISSING_NET_RESULT',
  'MISSING_FILL_RATIO',
] as const;
export type MissingEvidenceReason = (typeof MISSING_EVIDENCE_REASONS)[number];

export interface MissingEvidenceCount {
  reason: MissingEvidenceReason;
  count: number;
}

/** Reduced exact rational. Denominator is always positive. */
export interface ExactFraction {
  numerator: string;
  denominator: string;
}

/** Aggregate in the input field's exact integer unit. */
export interface ExactIntegerAggregate {
  knownCount: number;
  missingCount: number;
  /** Null when knownCount=0; empty evidence is not a fabricated zero. */
  sum: string | null;
  mean: ExactFraction | null;
  min: number | null;
  max: number | null;
}

export interface ProbabilityCalibrationMetrics {
  scalePpm: typeof PROBABILITY_PPM_SCALE;
  knownCount: number;
  missingCount: number;
  meanPredictedProbability: ExactFraction | null;
  observedPositiveFrequency: ExactFraction | null;
  /** Binary Brier mean squared loss, exact and reduced. Lower is better. */
  brierLoss: ExactFraction | null;
}

export interface CalibrationMetrics {
  completeCount: number;
  successCount: number;
  failureCount: number;
  successRate: ExactFraction | null;
  probability: ProbabilityCalibrationMetrics;
  grossResult: ExactIntegerAggregate;
  fees: ExactIntegerAggregate;
  slippage: ExactIntegerAggregate;
  otherCosts: ExactIntegerAggregate;
  netResult: ExactIntegerAggregate;
  fillRatioPpm: ExactIntegerAggregate;
  /** Every economic/cost/fill field is known; nothing was backfilled. */
  fullyObservedEconomicCount: number;
}

export interface CalibrationReport {
  reportId: string;
  cohortId: string;
  evaluatedAtMs: number;
  cohort: CalibrationCohort;
  inputRecordCount: number;
  uniqueRecordCount: number;
  duplicateIdenticalCount: number;
  includedCount: number;
  excludedCount: number;
  includedOutcomeIds: readonly string[];
  exclusions: readonly CalibrationExclusion[];
  missingEvidence: readonly MissingEvidenceCount[];
  metrics: CalibrationMetrics;
  /** Explicit proof that this report cannot change strategy behavior. */
  strategyMutationAuthority: 'NONE';
  automaticStrategyMutation: false;
}

export const CALIBRATION_FAILURE_CODES = Object.freeze({
  EVIDENCE_INVALID: 'CALIBRATION_EVIDENCE_INVALID',
  IDENTITY_CONFLICT: 'CALIBRATION_IDENTITY_CONFLICT',
} as const);

export type ProposalOutcomeRecordResult = ContractResult<Readonly<ProposalOutcomeRecord>>;
export type CalibrationReportResult = ContractResult<Readonly<CalibrationReport>>;
