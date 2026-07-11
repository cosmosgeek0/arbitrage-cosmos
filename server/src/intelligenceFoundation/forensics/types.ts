import type {
  FeatureValue,
  ForensicCheck,
  NormalizedEvidence,
  TruthMetadata,
  ValidationResult,
} from '../contracts/index.js';

export const FORENSIC_CHECK_KINDS = [
  'ONE_PRINT_OR_CONCENTRATED_SPIKE',
  'WASH_LIKE_PING_PONG_CHURN',
  'VOLUME_WITHOUT_PRICE_RESPONSE',
  'PRICE_JUMP_ON_THIN_OR_DISAPPEARING_DEPTH',
  'ALREADY_EXHAUSTED_MOVE',
  'FAKE_FOLLOW_THROUGH',
  'REPEATED_WAKEUP_FADE',
  'MARKET_WIDE_MISCLASSIFICATION',
  'LIQUIDATION_ONLY_BURST',
  'STALE_OR_INCOMPLETE_EVIDENCE',
] as const;

export type ForensicCheckKind = (typeof FORENSIC_CHECK_KINDS)[number];

export interface HistoricalWakeupEpisode {
  id: string;
  symbol: string;
  instrumentId: string;
  triggerTimeMs: number;
  horizonMs: number;
  peakReturnPct: number | null;
  closingReturnPct: number | null;
  fadeFromPeakPct: number | null;
  complete: boolean;
  evidenceIds: string[];
  truth: TruthMetadata;
}

export interface ForensicsInput {
  symbol: string;
  /** Primary instrument used by the feature bank for this symbol. */
  instrumentId: string;
  evaluatedAtMs: number;
  candidateObservedAtMs: number | null;
  intendedQuoteNotional: number | null;
  configurationVersion: string;
  featureVersion: string;
  evidence: readonly NormalizedEvidence[];
  features: readonly FeatureValue[];
  history: readonly HistoricalWakeupEpisode[];
}

export interface ForensicMetric {
  name: string;
  value: number | string | boolean | null;
  unit: string;
}

export interface ForensicCheckResult extends ForensicCheck {
  check: ForensicCheckKind;
  /** Required UNKNOWN checks fail closed. */
  required: boolean;
  featureIds: string[];
  metrics: ForensicMetric[];
}

export interface ForensicsTradeability {
  state: 'CLEAR' | 'BLOCKED' | 'UNKNOWN';
  claimAllowed: boolean;
  blockingCheckIds: string[];
  warningCheckIds: string[];
  unknownRequiredCheckIds: string[];
  reasonCodes: string[];
}

export interface ForensicsReport {
  id: string;
  symbol: string;
  instrumentId: string;
  evaluatedAtMs: number;
  checks: ForensicCheckResult[];
  tradeability: ForensicsTradeability;
  truth: TruthMetadata;
}

export type ForensicsResult = ValidationResult<ForensicsReport>;
