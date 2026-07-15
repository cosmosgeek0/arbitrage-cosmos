export const STRATEGY_ARENA_VERSION = '1.0.0';
export const DOCK_CONTRACT_SHA = 'e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5';
export const IMMUTABLE_BASE_SHA = 'f0168cb37bd04d21bc90591ab2256770de3b75bc';

export const REQUIRED_DOCK_FACETS = Object.freeze([
  'EXPERIMENT_PROVIDER',
  'SCENARIO_REFERENCE',
  'COCKPIT_PROJECTION',
]);

export const DOCK_ARTIFACT_SHA256 = Object.freeze({
  ownerMap: '8fccd53db5905bc7eb5508ae1653259fa3805723dbb530f36855b99ee46eb9ab',
  moduleFacetMatrix: 'deeabbe20ad9de5d7824b39d57f87ec6eaaa87280e30b688b5fa4216befc57e3',
});

export const DOCK_ARTIFACT_CANONICAL_HASHES = Object.freeze({
  ownerMap: '644ffcb9dfe5677a731855e30a5cd0a5b935087cdebe1672a5d815f391110aee',
  moduleFacetMatrix: '54696fb65a1838714f5a359a864644d412e606dbc2b667ca590d20faad4c0399',
});

export const REQUIRED_DOCK_BINDING_HASHES = Object.freeze({
  EXPERIMENT_PROVIDER: '1a28f00b6e2f9e042beb3923271caf2b0f376233fa7092e725ad07d15503a698',
  SCENARIO_REFERENCE: '35f74a00293a869adcb3cbb7dfa884d40cbd33afdf82b2ed4590cda048d28d19',
  COCKPIT_PROJECTION: '588e54eb6cafc8ca0114e3f11eac55801fc4b4957d1f6a32bfb797f9754ffa00',
});

export const ARENA_ADAPTER_HASHES = Object.freeze({
  experimentProvider: 'fafe08b15284bf892b07af54bdb4a1d64415d9d72242005c1e908de3db7fac1a',
  scenarioReference: 'c4e45f303e75048a9ffec99bc1528d0875e0cd6e2c0fc565c58612ac266f086e',
  cockpitProjection: '8b7c8f27d2420fac4786552f5cdcedfa918bd28aaf403318ef47fd8f09edec9e',
});

export const SEALED_PRODUCT_SURFACE_CANONICAL_HASH = '746e3f733402f875b44167d68128b9fa0670c8bfc864a817e45cfc9cb9b56763';
export const SEALED_SCENARIO_REFERENCE_CANONICAL_HASH = '0866c1d998c01a341bda294c1d73ab04103e0f0b5c25c1a932d2e95b2dd183be';

const Q14_COMMIT = '02b4eccc8d2ef53b830cafae06e5175715fa6ebb';
const Q14_PATH = 'quant/generated/q14/q14_validation_golden_v1.json';
const Q14_GIT_OBJECT = 'd13141000460086c60918a8c8e99123f7049c750';
const Q14_CONTENT_SHA256 = '539c95b264333208dfd37c96856be32bd130b41907560558a38bd323e53b20c9';
const q14OwnerRef = (pointer, projectionSha256, schemaId) => Object.freeze({
  ref: `git:${Q14_COMMIT}:${Q14_PATH}${pointer === null ? '' : `#${pointer}`}`,
  gitObjectSha: Q14_GIT_OBJECT,
  contentSha256: Q14_CONTENT_SHA256,
  projectionSha256,
  schemaId,
  schemaVersion: '1',
  posture: 'SYNTHETIC_ONLY',
});

export const SEALED_Q14_VALIDATION_AUTHORITY = Object.freeze({
  sourceArtifactRef: q14OwnerRef(null, null, 'Q14ValidationGoldenV1'),
  validationFoldsRef: q14OwnerRef('/plan/folds', '45d95a79c9ed28fedc488538405aa22c4684d4373fa82f59e5bd2daafad9ed71', 'Q14ValidationFoldsV1'),
  validationFoldsDigest: '45d95a79c9ed28fedc488538405aa22c4684d4373fa82f59e5bd2daafad9ed71',
  datasetDigestRef: q14OwnerRef('/datasetDigest', '99fb6a3c9ee41f7b1895d7f46e69793948a01dfb179cda2e65413089cff8400a', 'Q14DatasetDigestV1'),
  datasetDigest: '701e256d7beb6161812ed2d5edba16069856c1ded12e996b987c7e758249724b',
  planStatusRef: q14OwnerRef('/plan/status', 'bb3389e2cbcd7bf4d4fcbf732e19b71490126f21ec98b92ce63ac9f464e845c1', 'Q14PlanStatusV1'),
  holdoutPolicyRef: q14OwnerRef('/plan/spec', 'af8915a48b59e6dcbcab7d63969400d32c5d2706dd7e9f948dd5c3db4d87f83e', 'Q14HoldoutPolicyV1'),
});

export const ARENA_LIMITS = Object.freeze({
  maxStrategies: 8,
  maxEvents: 32,
  maxObservations: 64,
  maxReferences: 64,
  maxStrings: 128,
  maxStringLength: 2_048,
  maxMicrosAbsolute: 1_000_000_000_000n,
  maxCapacityUnits: 1_000_000_000,
  ppmScale: 1_000_000,
});

export const CAMPAIGN_PHASES = Object.freeze(['ITERATION']);
export const PARTITIONS = Object.freeze(['WALK_FORWARD_VALIDATION']);
export const DECISION_DISPOSITIONS = Object.freeze([
  'ACTED',
  'REJECTED',
  'EXPIRED',
  'MISSED',
  'QUIET_CONTROL',
  'DATA_INVALID',
]);
export const OUTCOME_CLASSES = Object.freeze(['FAVORABLE', 'UNFAVORABLE', 'NEUTRAL', 'UNKNOWN']);
export const AMBIGUITY_STATES = Object.freeze(['CLEAR', 'AMBIGUOUS', 'UNKNOWN']);
export const ECONOMIC_STATES = Object.freeze(['AVAILABLE', 'NO_EXPOSURE', 'UNKNOWN']);
export const EXPOSURE_STATES = Object.freeze(['SHADOW_EXPOSED', 'NO_EXPOSURE', 'UNKNOWN']);
export const ALLOCATION_STATES = Object.freeze(['GRANTED', 'CAPPED', 'BLOCKED', 'NOT_REQUESTED', 'UNKNOWN']);

export const COST_FIELDS = Object.freeze([
  'fees',
  'slippage',
  'fundingBorrow',
  'latency',
  'recovery',
]);

export const ARENA_METRICS = Object.freeze([
  'FIXTURE_NET_OUTCOME_MICROS',
  'COST_SURVIVAL_RATE_PPM',
  'NON_ACTION_QUALITY_PPM',
  'FALSE_POSITIVE_RATE_PPM_INVERTED',
  'RECOVERY_BURDEN_MICROS_INVERTED',
  'AMBIGUITY_RATE_PPM_INVERTED',
  'CAPACITY_CONSTRAINT_RATE_PPM_INVERTED',
  'WORST_SLICE_NET_MICROS',
]);

export const METRIC_DIRECTION = Object.freeze(Object.fromEntries(ARENA_METRICS.map((metricId) => [metricId, 'MAXIMIZE'])));

export const FIXED_LIMITATIONS = Object.freeze([
  'All event, economics, exposure, and capacity facts are deterministic synthetic fixture projections; none is canonical product truth.',
  'Q alone owns datasets, splits, purge, embargo, holdout access, global holdout one-use, multiplicity, model comparison, and registry lifecycle.',
  'Capital, Risk, L, outcome, and strategy owners alone own canonical accounting, exposure, decisions, recovery, and strategy behavior.',
  'StrategyArena aggregates caller-supplied fixture facts; it does not compute realized attribution, residual decomposition, or decision alternatives.',
  'Final-holdout evaluation is not implemented: Q must issue a new whole-strategy grant and immutable replay bundle bound to the exact campaign, policy, seed, snapshots, models, and facts.',
  'Campaign-bound whole-strategy trial and multiplicity evidence is unavailable; raw fixture Pareto tiers are selection-pressure-unadjusted and lifecycle/meta-allocation proposals abstain.',
  'Owner-reference resolution is a caller-supplied pinned-identity attestation; accepted-source object/content/projection bytes are independently checked only by the module-local build-time suite.',
  'Comparative rankings and any future owner-review advisories have no promotion, allocation, lifecycle, or execution authority.',
  'No mounted behavior, production isolation, runtime safety, live readiness, edge, or profitability is proven.',
]);
