export const SOURCE_AUTHORITIES = [
  'EXCHANGE_PRIMARY',
  'EXCHANGE_DERIVED',
  'ENGINE_DERIVED',
  'OPERATOR_SUPPLIED',
  'REPLAY_SUPPLIED',
  'CONTEXTUAL',
  'UNKNOWN',
] as const;
export type SourceAuthorityKind = (typeof SOURCE_AUTHORITIES)[number];

export const SOURCE_ENDPOINT_CLASSES = ['PUBLIC', 'MARKET', 'REST', 'INJECTED', 'UNKNOWN'] as const;
export type SourceEndpointClass = (typeof SOURCE_ENDPOINT_CLASSES)[number];

export const PRODUCT_FAMILIES = ['SPOT', 'USD_M_PERPETUAL', 'COIN_M_PERPETUAL', 'MARGIN', 'BORROW'] as const;
export type ProductFamily = (typeof PRODUCT_FAMILIES)[number];

export const COMPLETENESS_STATES = ['COMPLETE', 'PARTIAL', 'MISSING', 'UNKNOWN'] as const;
export type CompletenessState = (typeof COMPLETENESS_STATES)[number];

export const FRESHNESS_STATES = ['FRESH', 'STALE', 'UNAVAILABLE', 'UNKNOWN'] as const;
export type FreshnessState = (typeof FRESHNESS_STATES)[number];

export const FRESHNESS_BASES = [
  'SOURCE_EVENT_TIME',
  'SOURCE_TRANSACTION_TIME',
  'RECEIVE_TIME',
  'UNAVAILABLE',
] as const;
export type FreshnessBasis = (typeof FRESHNESS_BASES)[number];

export const EVIDENCE_KINDS = [
  'TRADE',
  'BOOK_TICKER',
  'DEPTH_SNAPSHOT',
  'DEPTH_DELTA',
  'MARK_PRICE',
  'FUNDING',
  'OPEN_INTEREST',
  'LIQUIDATION',
  'BORROW',
  'CONTEXT',
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const MARKET_STAGES = [
  'QUIET',
  'EARLY_CHANGE',
  'BEFORE_VISIBLE_MOVE',
  'VISIBLE_EXPANSION',
  'CONTINUATION',
  'EXHAUSTION',
  'REVERSAL',
  'TOO_LATE',
  'UNCLASSIFIED',
] as const;
export type MarketStage = (typeof MARKET_STAGES)[number];

export const EVIDENCE_POLARITIES = ['SUPPORTING', 'CONFLICTING', 'NEUTRAL', 'UNAVAILABLE'] as const;
export type EvidencePolarity = (typeof EVIDENCE_POLARITIES)[number];

export const ATTENTION_TIERS = ['UNIVERSE', 'WATCH', 'CANDIDATE', 'FOCUS', 'DEEP_FOCUS', 'RELEASED'] as const;
export type AttentionTier = (typeof ATTENTION_TIERS)[number];

export const HYPOTHESIS_CLASSES = [
  'DEAD_VOLUME_WAKEUP',
  'ACCUMULATION_TO_EXPANSION',
  'SPOT_LED_EXPANSION',
  'PERPETUAL_LED_SQUEEZE',
  'LIQUIDATION_DRIVEN_MOVE',
  'MARKET_WIDE_BETA_MOVE',
  'THIN_BOOK_DISLOCATION',
  'CHURN_WITHOUT_FOLLOW_THROUGH',
  'EXHAUSTED_MOVE',
  'UNCLASSIFIED_ANOMALY',
] as const;
export type HypothesisClass = (typeof HYPOTHESIS_CLASSES)[number];

export const FORENSIC_VERDICTS = ['PASS', 'FAIL', 'UNKNOWN'] as const;
export type ForensicVerdict = (typeof FORENSIC_VERDICTS)[number];

export const TOPOLOGY_EDGE_TYPES = ['DATA', 'EVIDENCE', 'ATTENTION', 'DECISION_INPUT', 'CONTROL', 'RECOVERY'] as const;
export type TopologyEdgeType = (typeof TOPOLOGY_EDGE_TYPES)[number];

export const FAILURE_CODES = [
  'INVALID_VARIANT',
  'INVALID_VALUE',
  'SECRET_FIELD_REJECTED',
  'MISSING_SOURCE',
  'STALE_SOURCE',
  'WRONG_ENDPOINT_CLASS',
  'DUPLICATE_EVENT',
  'OUT_OF_ORDER_EVENT',
  'SEQUENCE_GAP',
  'TIMESTAMP_SKEW',
  'CROSSED_BOOK',
  'INCOMPLETE_EVIDENCE',
  'INSUFFICIENT_HISTORY',
  'BUDGET_EXHAUSTED',
  'PROTECTED_CAPITAL',
  'NO_LOOK_AHEAD_VIOLATION',
  'HORIZON_NOT_REACHED',
  'UNAVAILABLE',
  'INTERNAL_CONTRACT_ERROR',
] as const;
export type FailureCode = (typeof FAILURE_CODES)[number];
