/**
 * System Integration contract vocabulary.
 *
 * These labels describe the convergence shell only. Domain owners keep their
 * existing vocabularies and are translated directionally at the boundary.
 */

export const SYSTEM_SAFE_MODES = Object.freeze([
  'READ_ONLY',
  'ADVISORY',
  'VALIDATE_ONLY',
] as const);

export type SystemSafeMode = (typeof SYSTEM_SAFE_MODES)[number];

export const BLOCKED_EXECUTION_MODE_REQUESTS = Object.freeze([
  'LIVE',
  'LIVE_MANUAL',
  'MANUAL_ARMED',
  'EXECUTION_LIVE',
  'AUTONOMOUS',
] as const);

export type BlockedExecutionModeRequest = (typeof BLOCKED_EXECUTION_MODE_REQUESTS)[number];

export const SYSTEM_RELEASE_STATUSES = Object.freeze([
  'BUILT_AND_TESTED',
  'IMPORTED',
  'WIRED',
  'LIVE_PUBLIC',
  'SYNTHETIC_ONLY',
  'BLOCKED',
  'NOT_CONFIGURED',
  'MISSING',
] as const);

export type SystemReleaseStatus = (typeof SYSTEM_RELEASE_STATUSES)[number];

export const SYSTEM_TRUTH_LABELS = Object.freeze([
  'LIVE_PUBLIC',
  'DRY_RUN',
  'SYNTHETIC_ONLY',
  'RECORDED_REPLAY',
  'UNAVAILABLE',
  'UNKNOWN',
] as const);

export type SystemTruthLabel = (typeof SYSTEM_TRUTH_LABELS)[number];

export const SYSTEM_COMPONENT_IDS = Object.freeze([
  'public-spot-source',
  'public-usdm-source',
  'market-universe',
  'intelligence-runtime',
  'market-intelligence',
  'q-inference',
  'basis-engine',
  'volume-engine',
  'capital-supervision',
  'multileg-risk',
  'execution-coordinator-validate-only',
  'reconciliation',
  'ledger-persistence',
  'engine-supervisor',
] as const);

export type SystemComponentId = (typeof SYSTEM_COMPONENT_IDS)[number];

export const SYSTEM_OWNER_KINDS = Object.freeze([
  'AUDITED_APP',
  'INTELLIGENCE_RUNTIME',
  'MARKET_INTELLIGENCE',
  'Q_INFERENCE',
  'BASIS_ENGINE',
  'VOLUME_ENGINE',
  'CAPITAL_SUPERVISION',
  'BACKEND_FOUNDATION_CONTROL',
  'BACKEND_FOUNDATION_RISK',
  'BACKEND_FOUNDATION_EXECUTION',
  'BACKEND_FOUNDATION_RECONCILIATION',
  'EXISTING_LEDGER',
  'SYSTEM_INTEGRATION',
] as const);

export type SystemOwnerKind = (typeof SYSTEM_OWNER_KINDS)[number];

export const SYSTEM_READINESS_STATES = Object.freeze([
  'STOPPED',
  'WARMING',
  'READY',
  'DEGRADED',
  'BLOCKED',
  'FAILED',
] as const);

export type SystemReadinessState = (typeof SYSTEM_READINESS_STATES)[number];

export const SYSTEM_CONTROL_COMMANDS = Object.freeze([
  'SET_COMPONENT_STATE',
  'SET_INTAKE_PAUSED',
  'SET_SAFE_MODE',
  'SET_KILL_SWITCH',
  'APPLY_CONFIGURATION',
  'REVOKE_APPROVAL',
  'REVOKE_RESERVATION',
  'RESTART_COMPONENT',
  'SET_BASIS_INTAKE',
  'CLEAR_DEPLOYMENT_FREEZE',
  'SET_PUBLIC_SOURCE_LIFECYCLE',
  'SET_BASIS_SYMBOL_POLICY',
  'SET_VOLUME_SYMBOL_POLICY',
  'REDUCE_SIZE_CEILING',
  'SET_STRATEGY_THRESHOLD',
  'PIN_FOCUS',
] as const);

export type SystemControlCommand = (typeof SYSTEM_CONTROL_COMMANDS)[number];

export const SYSTEM_TRACE_EVENT_KINDS = Object.freeze([
  'CONTROL',
  'SOURCE',
  'STRATEGY',
  'INTELLIGENCE',
  'CAPITAL',
  'RISK',
  'EXECUTION',
  'RECONCILIATION',
  'PERSISTENCE',
  'SUPERVISOR',
] as const);

export type SystemTraceEventKind = (typeof SYSTEM_TRACE_EVENT_KINDS)[number];

export const SYSTEM_SEMANTIC_STREAMS = Object.freeze([
  'MARKET_UNIVERSE',
  'SPOT_MINI_TICKER',
  'SPOT_AGGREGATE_TRADE',
  'SPOT_BEST_BID_ASK',
  'USD_M_BEST_BID_ASK',
  'USD_M_MARK_FUNDING',
  'USD_M_LIQUIDATION',
] as const);

export type SystemSemanticStream = (typeof SYSTEM_SEMANTIC_STREAMS)[number];

export const SYSTEM_SOURCE_PRODUCER_KINDS = Object.freeze([
  'EXISTING_AUDITED',
  'MANUAL_ACCEPTANCE_ONLY',
  'NONE',
] as const);

export type SystemSourceProducerKind = (typeof SYSTEM_SOURCE_PRODUCER_KINDS)[number];

export const SYSTEM_SOURCE_TRANSPORTS = Object.freeze([
  'INJECTED_EXISTING',
  'MANUAL_PUBLIC_SMOKE',
  'NONE',
] as const);

export type SystemSourceTransport = (typeof SYSTEM_SOURCE_TRANSPORTS)[number];

export const DIALECT_LOSS_CODES = Object.freeze([
  'TRANSACTION_TIME_USED_AS_SOURCE_TIME',
  'TRANSACTION_TIME_NOT_REPRESENTABLE',
  'SEQUENCE_NOT_REPRESENTABLE',
  'SOURCE_TIME_UNAVAILABLE',
  'MAX_AGE_MISSING',
  'REVISION_UNAVAILABLE',
  'SOURCE_ID_DERIVED',
  'RUNTIME_SAMPLED_LOWER_BOUND',
  'RUNTIME_UNKNOWN_MAPPED_UNAVAILABLE',
  'MI_MISSING_MAPPED_UNAVAILABLE',
  'MI_UNKNOWN_MAPPED_UNAVAILABLE',
  'UPSTREAM_AUTHORITY_MISSING',
  'AUTHORITY_CONTEXT_MISMATCH',
  'OPERATOR_AUTHORITY_UNREPRESENTABLE',
  'UNKNOWN_AUTHORITY',
  'STALE_AUTHORITY_DOWNGRADED',
  'ORIGIN_FAILURE_FIELDS_RETAINED_IN_TRACE',
  'ORIGIN_FAILURE_DETAIL_REDACTED',
  'BINARY64_PROJECTION',
] as const);

export type DialectLossCode = (typeof DIALECT_LOSS_CODES)[number];

export const LIVE_EXECUTION_NOT_IMPLEMENTED = 'LIVE_EXECUTION_NOT_IMPLEMENTED' as const;
