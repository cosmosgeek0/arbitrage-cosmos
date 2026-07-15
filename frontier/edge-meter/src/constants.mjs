export const EDGE_METER_SCHEMA_VERSION = 1;
export const EDGE_METER_EXTENSION_ID = 'frontier.edge-meter';
export const EDGE_METER_EXTENSION_VERSION = '0.1.0';
export const DOCK_SHA = 'e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5';
export const FRONTIER_BASE_SHA = 'f0168cb37bd04d21bc90591ab2256770de3b75bc';

export const MAX_BATCH_ITEMS = 32;
export const MAX_ARRAY_ITEMS = 128;
export const MAX_STRING_LENGTH = 2_048;
export const MAX_REPORT_BYTES = 1_048_576;

export const REFERENCE_STATES = Object.freeze([
  'AVAILABLE',
  'MISSING',
  'UNKNOWN',
  'DIVERGENT',
  'NOT_APPLICABLE',
]);

export const OWNER_CLASSES = Object.freeze([
  'ENGINE',
  'EDGE_PROTOCOL',
  'INTELLIGENCE_FOUNDATION',
  'FOUNDATION',
  'CAPITAL',
  'LEDGER',
  'L',
  'Q',
]);

export const OWNER_REFERENCE_KEYS = Object.freeze([
  'proposal',
  'assessment',
  'outcome',
  'economicReport',
  'accountingPolicy',
  'fills',
  'costs',
  'liabilities',
  'evidence',
  'calibration',
  'abstention',
  'partition',
  'embargo',
  'pointInTimeJoin',
  'uncertainty',
  'multiplicity',
  'deflatedPerformance',
  'selectionPressure',
]);

export const PRE_DECISION_REFERENCE_KEYS = Object.freeze([
  'proposal',
  'accountingPolicy',
  'assessment',
  'calibration',
  'abstention',
  'partition',
  'embargo',
  'pointInTimeJoin',
  'uncertainty',
  'multiplicity',
  'deflatedPerformance',
  'selectionPressure',
]);

export const POST_HORIZON_REFERENCE_KEYS = Object.freeze([
  'outcome',
  'economicReport',
  'costs',
  'liabilities',
  'evidence',
]);

export const Q_REFERENCE_KEYS = Object.freeze([
  'assessment',
  'calibration',
  'abstention',
  'partition',
  'embargo',
  'pointInTimeJoin',
  'uncertainty',
  'multiplicity',
  'deflatedPerformance',
  'selectionPressure',
]);

export const LABEL_KINDS = Object.freeze(['REAL', 'HYPOTHETICAL', 'REPLAY']);
export const COHORTS = Object.freeze(['ACTED', 'REJECTED', 'EXPIRED', 'MISSED', 'CONTROL']);
export const RECORD_STATES = Object.freeze([
  'ATTRIBUTABLE',
  'INSUFFICIENT_EVIDENCE',
  'ABSTAIN_UNKNOWN',
  'NON_COMPARABLE',
  'DIVERGENT',
]);

export const DIMENSION_KEYS = Object.freeze([
  'strategy',
  'symbol',
  'venue',
  'regime',
  'turnover',
  'capacity',
]);

export const DIMENSION_STATES = Object.freeze(['AVAILABLE', 'UNKNOWN', 'NOT_APPLICABLE']);

// Exact Capital-owned EconomicMeasures names. EdgeMeter projects these values;
// it never defines another accounting taxonomy or totals them into a new net.
export const CAPITAL_MEASURE_KEYS = Object.freeze([
  'grossPricePnl',
  'basisContribution',
  'directionalContribution',
  'realizedPnl',
  'unrealizedPnl',
  'fees',
  'spread',
  'slippage',
  'funding',
  'borrow',
  'executionShortfall',
  'oneLegExposure',
  'recovery',
  'fxValuation',
  'unexplainedResidual',
]);

export const CAPITAL_MEASURE_STATUSES = Object.freeze([
  'KNOWN',
  'ESTIMATED',
  'MISSING',
  'NOT_APPLICABLE',
  'DIVERGENT',
]);

export const CAPITAL_TRUTH_STATES = Object.freeze(['COMPLETE', 'PARTIAL', 'UNKNOWN', 'DIVERGENT']);
export const CAPITAL_ACCOUNTING_STATUSES = Object.freeze(['COMPLETE', 'INCOMPLETE', 'DIVERGENT']);
export const CAPITAL_ACCOUNTING_CONFIDENCE = Object.freeze(['HIGH', 'MEDIUM', 'LOW', 'NONE']);
export const PRICE_PNL_BASES = Object.freeze(['LEG_PRICE', 'BASIS_AND_DIRECTIONAL']);
export const EXECUTION_COST_BASES = Object.freeze(['DETAILED_SPREAD_SLIPPAGE', 'EXECUTION_SHORTFALL']);

export const Q_ABSTENTION_ACTIONS = Object.freeze(['WATCH', 'ABSTAIN_UNKNOWN', 'UNAVAILABLE']);
// Frozen precedence copied from accepted Q AbstentionReason/_REASON_ORDER at
// 02b4eccc8d2ef53b830cafae06e5175715fa6ebb. F8 only validates and projects it.
export const Q_ABSTENTION_REASONS = Object.freeze([
  'EVIDENCE_STALE',
  'EVIDENCE_INCOMPLETE',
  'OOD_SUSPECT',
  'OOD_UNKNOWN',
  'SPECIALIST_MISSING',
  'SPECIALIST_CONFLICT',
  'COST_UNKNOWN',
  'COST_NEGATIVE',
  'COST_STRESS_UNSTABLE',
  'TIMING_UNKNOWN',
  'CALIBRATION_UNAVAILABLE',
  'INTERVAL_UNAVAILABLE',
  'COVERAGE_UNKNOWN',
  'COVERAGE_COLLAPSED',
]);
export const Q_PARTITION_CLASSES = Object.freeze(['FORWARD_ONLY', 'HISTORICAL_FIT']);
export const Q_HOLDOUT_STATES = Object.freeze(['GRANTED', 'NOT_GRANTED', 'UNKNOWN']);
export const Q_PROOF_STATES = Object.freeze(['PROVEN', 'UNPROVEN', 'UNKNOWN']);
export const Q_AVAILABILITY_STATES = Object.freeze(['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN']);
export const Q_COVERAGE_STATES = Object.freeze(['AVAILABLE', 'COLLAPSED', 'UNKNOWN']);
export const SELECTION_EVIDENCE_KINDS = Object.freeze([
  'MULTIPLE_TESTING',
  'DEFLATED_PERFORMANCE',
  'SELECTION_PRESSURE',
]);

export const GROSS_BRIDGE_STATES = Object.freeze([
  'AVAILABLE',
  'MISSING',
  'DIVERGENT',
  'NOT_APPLICABLE',
]);

export const CAPITAL_IDENTITY_EQUATION = 'NET_KNOWN_EQUALS_SUM_KNOWN_INCLUDED_COMPONENTS';
export const GROSS_BRIDGE_EQUATION = 'ACTUAL_GROSS_EQUALS_DECISION_BENCHMARK_PLUS_TIMING_PLUS_EXECUTION_DELTA_PLUS_BRIDGE_RESIDUAL';

export const REQUIRED_DOCK_FACETS = Object.freeze([
  'ADVISORY_ASSESSOR',
  'COCKPIT_PROJECTION',
]);

export const DOCK_FACET_PINS = Object.freeze({
  ADVISORY_ASSESSOR: Object.freeze({
    bindingHash: 'bd4fe6b1d4354729b0caa856e05e661e3f956b5574b8be68401336b18be0eefa',
    acceptedOwnerCommitSha: 'b3d8cedece8cf3a9f546c60016beae442f85f160',
    canonicalOwnerRef: 'git:b3d8cedece8cf3a9f546c60016beae442f85f160:quant/src/quant_edge/inference/**',
    canonicalContractRef: 'git:73e1a1ff7daa48df8dac45713fc5f106842edafc:packages/edge-protocol/schema/edge-protocol-v1.schema.json#/$defs/EdgeAssessmentEnvelopeV1',
    canonicalContractVersion: 'EdgeAssessmentEnvelopeV1@1',
    operation: 'EVALUATE_FIXTURE',
  }),
  COCKPIT_PROJECTION: Object.freeze({
    bindingHash: '588e54eb6cafc8ca0114e3f11eac55801fc4b4957d1f6a32bfb797f9754ffa00',
    acceptedOwnerCommitSha: '2c98ae653ba97e6383c29697283288346de28bdb',
    canonicalOwnerRef: 'git:2c98ae653ba97e6383c29697283288346de28bdb:web/src/lib/productIntegration/model.ts',
    canonicalContractRef: 'git:56c47dad398c485b6653036c8b90c53f11061b1e:web/src/lib/productIntegration/model.ts#ProductSupervisorEnvelope,ProductSurfaceProjection,ProductSurfaceDatum',
    canonicalContractVersion: 'product-supervisor.v1',
    operation: 'PROJECT_FIXTURE',
  }),
});

export const FORBIDDEN_CLAIM_WORDS = Object.freeze([
  'LIVE',
  'INTEGRATED',
  'TRADE_READY',
  'EDGE_PROVEN',
  'PROFITABLE',
  'PRODUCTION_READY',
  'DEPLOYED',
]);
