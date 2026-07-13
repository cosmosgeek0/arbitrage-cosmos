import { deepFreeze } from './canonical.mjs';

export const ASSURANCE_CASE_SCHEMA_VERSION = 'pa.s4.assurance-case.v1';
export const ASSURANCE_CASE_EVALUATION_VERSION = 'pa.s4.assurance-evaluation.v1';
export const ASSURANCE_CASE_VIEW_MODEL_VERSION = 'pa.s4.assurance-view-model.v1';
export const S1_ASSUMPTION_PROJECTION_VERSION = 'pa.s4.s1-assumption-projection.v1';

export const ACCEPTED_S1_SOURCE = deepFreeze({
  branch: 'ip-assur-hazard-20260713',
  commit: 'ab33b3712cddd67c3ec91cfa1dd232c75226cd9f',
  inputSchemaVersion: 'pa.s1.hazard-assurance.v1',
  evaluationSchemaVersion: 'pa.s1.hazard-evaluation.v1',
  entryPath: 'fixtures/productAssurance/systemic/hazard/index.mjs',
  schemaPath: 'fixtures/productAssurance/systemic/hazard/contracts/schema.mjs',
  schemaBlob: 'df5fa528a8178150066d6dca72665e78c1352eae',
  schemaSha256: '22998ab4479c57206f43214da70965d9d7896f593340129c73d7ba369728585f',
  validationPath: 'fixtures/productAssurance/systemic/hazard/contracts/validation.mjs',
  validationBlob: '28459d3f293234170f98ee7c9dcb8727c6ea5bf6',
  validationSha256: '5c2156a11f438b4fd5e61b7ecab8a5aa429342babda6ffd8617842b6455049d9',
  baselinePath: 'fixtures/productAssurance/systemic/hazard/fixtures/baseline.mjs',
  baselineBlob: 'b3ffc58609c8c78a3476908fad50de858a47be71',
  baselineSha256: 'cd8733bebc8285bd7d4fb03cd486eb777b1b7c7664e3bb65c3bd5dcc97bea726',
  evaluatorPath: 'fixtures/productAssurance/systemic/hazard/reference/hazard-evaluator.mjs',
  evaluatorBlob: 'f9bb853cc016c8f7117067c7140a303434a1e537',
  evaluatorSha256: 'b3470b29469da6a1b6b13f70a01b35ba201a6722a7866b99474327ab20a5ce13',
});

export const ACCEPTED_S1_ASSUMPTION_OWNERS = deepFreeze({
  'PA-S1-AS-001': 'intelligenceRuntime.public-source-truth',
  'PA-S1-AS-002': 'I00.private-account-truth',
  'PA-S1-AS-003': 'foundation.multi-leg-risk',
  'PA-S1-AS-004': 'capitalFoundation.capital-policy',
  'PA-S1-AS-005': 'Q.advisory-inference',
  'PA-S1-AS-006': 'foundation.reconciliation',
  'PA-S1-AS-007': 'I00.deployment-authority',
  'PA-S1-AS-008': 'I00.external-watchdog',
  'PA-S1-AS-009': 'IP-ASSURANCE.diagnostic-boundary',
});

export const ACCEPTED_S1_ASSUMPTION_IDS = Object.freeze(
  Object.keys(ACCEPTED_S1_ASSUMPTION_OWNERS),
);

export const ASSURANCE_RESULTS = Object.freeze(['PASS', 'FAIL', 'UNKNOWN']);
export const EVIDENCE_ROLES = Object.freeze(['SUPPORT', 'COUNTERCHECK']);
export const EVIDENCE_PURPOSES = Object.freeze([
  'CLAIM_SUPPORT',
  'INDEPENDENCE_BASIS',
  'DIAGNOSTIC_POSTURE',
  'DIAGNOSTIC_CONTAINMENT',
  'DIAGNOSTIC_PERMISSION',
  'DIAGNOSTIC_PROVIDER_OUTAGE',
  'DIAGNOSTIC_PRIVACY',
  'DIAGNOSTIC_INDEPENDENCE',
]);
export const EVIDENCE_KINDS = Object.freeze([
  'ACCEPTED_TEST',
  'RUNTIME_PROBE',
  'ACCOUNT_READBACK',
  'CONFIGURATION_VERIFICATION',
  'DEPLOYMENT_IDENTITY',
  'MODEL_EVALUATION',
  'FAULT_INJECTION',
  'BROWSER_CHECK',
  'SENTINEL_RECEIPT',
  'FORMAL_MODEL_RESULT',
  'OWNER_AUTHORIZATION',
  'INVENTORY_MANIFEST',
  'TELEMETRY_COVERAGE',
  'CONTROL_REGISTRY_READBACK',
  'RECOVERY_EXERCISE',
  'DIAGNOSTIC_POSTURE_READBACK',
  'DIAGNOSTIC_CONTAINMENT_TEST',
  'DIAGNOSTIC_PERMISSION_READBACK',
  'DIAGNOSTIC_PROVIDER_OUTAGE_EXERCISE',
  'DIAGNOSTIC_PRIVACY_REVIEW',
  'DIAGNOSTIC_INDEPENDENCE_CHECK',
]);
export const DIAGNOSTIC_POSTURES = Object.freeze(['NOT_CONFIGURED', 'SHADOW', 'OWNER_GATED', 'ACTIVE']);
export const INDEPENDENCE_CLASSES = Object.freeze([
  'TECHNICAL',
  'TECHNICAL_AND_OPERATIONAL',
  'OUT_OF_PROCESS',
  'OUT_OF_HOST',
  'OUT_OF_BAND',
]);
export const FAILURE_DOMAIN_CLASSES = Object.freeze([
  'CLOCK',
  'STORE',
  'NETWORK',
  'CREDENTIAL',
  'CODE_PATH',
  'TELEMETRY_EXPORTER',
  'MODEL_FAMILY',
  'PROCESS',
  'HOST',
  'ORGANIZATION',
]);
export const COCKPIT_SURFACES = Object.freeze([
  'DASHBOARD',
  'HEALTH',
  'RISK',
  'OPPORTUNITIES',
  'LOGS',
  'NOTIFICATIONS',
  'CONTROL_ROOM',
]);

export const SCHEMA_LIMITS = deepFreeze({
  maxClaims: 128,
  maxEvidence: 512,
  maxEdgesPerNode: 64,
  maxFailureDomainsPerLeg: 32,
  maxCommonModeDependencies: 32,
  maxReasonCodes: 128,
  maxInvalidationPaths: 1_024,
  maxInvalidationPathLength: 64,
  maxIdLength: 160,
  maxShortTextLength: 512,
  maxLongTextLength: 4_096,
  maxTtlMs: 31_536_000_000,
  maxSloMs: 86_400_000,
});

export const SAFE_EVENT_RECOMMENDATION_TYPE = 'ASSURANCE_CLAIM_INVALIDATED';
export const SAFE_INCIDENT_RECOMMENDATION_TYPE = 'ASSURANCE_ATTENTION_REQUIRED';
export const UNSAFE_ASSURANCE_TEXT_PATTERN = /(?:LIVE[\s_-]*EXECUTION|ORDERS?[\s_-]*(?:ENABLED|ISSUED|PLACED)|BORROW(?:ING)?[\s_-]*(?:ENABLED|ISSUED)|REPAY(?:MENT)?[\s_-]*(?:ENABLED|ISSUED)|TRANSFERS?[\s_-]*(?:ENABLED|ISSUED)|WITHDRAW(?:AL)?S?[\s_-]*(?:ENABLED|ISSUED)|LEVERAGE[\s_-]*(?:ENABLED|MUTATED)|MARGIN[\s_-]*(?:ENABLED|MUTATED)|COMMAND[\s_-]*(?:ISSUED|ENABLED)|AUTHORITY[\s_-]*(?:GRANTED|ENABLED)|IGNORE[\s_-]*(?:ALL[\s_-]*)?(?:PREVIOUS|PRIOR|SYSTEM)[\s_-]*INSTRUCTIONS?|SYSTEM[\s_-]*PROMPT)/i;
export const ASSURANCE_CASE_PROPAGATION_POLICY = deepFreeze({
  requiredDependencyMode: 'ALL',
  failurePrecedence: 'FAIL_THEN_UNKNOWN_THEN_PASS',
  expiryResult: 'UNKNOWN',
  propagationSloMs: 1_000,
  assuranceSloMs: 5_000,
});
export const ASSURANCE_DERIVED_REASON_CODES = Object.freeze([
  'ALL_MANDATORY_DERIVED_CLAIMS_PASS',
  'ALL_REQUIRED_SUPPORT_CURRENT',
  'ASSURANCE_EVALUATION_FAILED_CLOSED',
  'ASSURANCE_PACKET_CAPTURE_FAILED',
  'ASSURANCE_PACKET_INVALID',
  'ASSURANCE_SLO_MISSED',
  'ASSURANCE_SLO_UNDETERMINED',
  'CLOCK_INVALID',
  'COMMON_MODE_FAILURE_DOMAIN',
  'CONTRADICTED',
  'CURRENT',
  'CURRENT_INDEPENDENT_EVIDENCE',
  'DECLARED_COMMON_MODE_DEPENDENCY',
  'DECLARED_EVIDENCE_FAILURE',
  'DECLARED_EVIDENCE_UNKNOWN',
  'DERIVED_CLAIM_FAILED',
  'DERIVED_CLAIM_UNKNOWN',
  'DERIVED_DEPENDENCY_FAILED',
  'DERIVED_DEPENDENCY_UNKNOWN',
  'DIAGNOSTIC_CLAIM_MISSING',
  'DIAGNOSTIC_CONFIGURED_EVIDENCE_COMPLETE',
  'DIAGNOSTIC_CONTAINMENT_EVIDENCE_MISSING',
  'DIAGNOSTIC_EVIDENCE_NOT_BOUND_TO_CLAIM',
  'DIAGNOSTIC_INDEPENDENT_EVIDENCE_MISSING',
  'DIAGNOSTIC_NOT_CONFIGURED_VALID',
  'DIAGNOSTIC_PACKET_OR_INPUT_INVALID',
  'DIAGNOSTIC_PERMISSION_EVIDENCE_MISSING',
  'DIAGNOSTIC_POSTURE_EVIDENCE_MISSING',
  'DIAGNOSTIC_PRIVACY_EVIDENCE_MISSING',
  'DIAGNOSTIC_PROVIDEROUTAGE_EVIDENCE_MISSING',
  'EVALUATED_PACKET_ISSUES_PRESENT',
  'EVIDENCE_FAILED',
  'EVIDENCE_MISSING',
  'EVIDENCE_REFERENCE_MISSING',
  'EVIDENCE_UNKNOWN',
  'EXPIRED',
  'FAIL',
  'INCOHERENT',
  'INDEPENDENCE_BASIS_FAILED',
  'INDEPENDENCE_BASIS_MISSING',
  'INDEPENDENCE_BASIS_UNKNOWN',
  'INDEPENDENCE_UNPROVEN',
  'INVALIDATION_PATHS_TRUNCATED',
  'INVALID_TIMELINE',
  'MANDATORY_CLAIM_COVERAGE_FAILURE',
  'MISSING',
  'NOT_YET_VALID',
  'PACKET_GENERATED_IN_FUTURE',
  'PACKET_OR_INPUT_INVALID',
  'PASS',
  'PRODUCER_FAILURE_DOMAIN_COVERAGE_MISSING',
  'PRODUCER_VERIFIER_NOT_INDEPENDENT',
  'PRODUCER_VERIFIER_OWNER_COMMON_MODE',
  'PROPAGATION_SLO_MISSED',
  'PROPAGATION_SLO_UNDETERMINED',
  'S1_ASSUMPTION_CURRENT',
  'S1_ASSUMPTION_FAILED',
  'S1_ASSUMPTION_NOT_CURRENT',
  'S1_ASSUMPTION_REFERENCE_MISSING',
  'S1_ASSUMPTION_UNKNOWN',
  'S1_PROJECTION_CAPTURE_FAILED',
  'S1_PROJECTION_FROM_FUTURE',
  'S1_PROJECTION_INVALID',
  'S1_PROJECTION_NOT_CURRENT',
  'SUBCLAIM_FAILED',
  'SUBCLAIM_REFERENCE_MISSING',
  'SUBCLAIM_UNKNOWN',
  'UNHANDLED_PACKET_ISSUE',
  'UNREGISTERED',
  'UNKNOWN',
  'VALIDATED',
  'VERIFIER_FAILURE_DOMAIN_COVERAGE_MISSING',
  'WEAK',
]);
export const MANDATORY_CLAIM_VALIDATOR = deepFreeze({
  validatorId: 'PA-S4-DERIVED-CLAIM-EVALUATOR',
  version: 'PA-S4-DERIVED-CLAIM-EVALUATOR-V1',
});
export const MANDATORY_CLAIM_DRILL_DOWN = 'Show component binding, source identity, validator, producer, verifier, common-mode domains, assumptions, dependent path, age, expiry, and existing owner.';
export const PROHIBITED_ASSURANCE_COMMANDS = Object.freeze([
  'HALT',
  'CLOSE',
  'REPAIR',
  'DEMOTION',
  'DEPLOYMENT',
  'CAPITAL',
  'ORDER',
  'BORROW',
  'REPAY',
  'TRANSFER',
  'WITHDRAWAL',
]);

const owner = (ownerId, ownerPath) => ({ ownerId, ownerPath });

export const MANDATORY_CLAIM_REQUIREMENTS = deepFreeze([
  {
    claimId: 'PA-S4-CLAIM-001', requirementKey: 'REQUIRED_INVENTORY_DISPOSITION',
    statement: 'Required inventory has an explicit disposition.',
    scope: 'Exact release-bound required inventory and its canonical dispositions.',
    canonicalOwner: owner('IP-ASSURANCE.invariant-atlas-owner', 'server/src/productAssurance/** canonical worker only'),
    resultConsumerOwner: owner('I08.machine-supervisor', 'server/src/systemIntegration/supervisor/** read-only I08 projection'),
    requiredSubclaimIds: ['PA-S4-CLAIM-002'], requiredAssumptionIds: ['PA-S1-AS-007', 'PA-S1-AS-008'],
    requiredEvidenceKind: 'INVENTORY_MANIFEST', cockpitSurface: 'HEALTH',
  },
  {
    claimId: 'PA-S4-CLAIM-002', requirementKey: 'ENABLED_COMPONENT_DISCOVERY',
    statement: 'Each enabled required component is discovered and instrumented.',
    scope: 'Enabled required components in the exact release and runtime projection.',
    canonicalOwner: owner('IP-ASSURANCE.invariant-atlas-owner', 'server/src/productAssurance/** canonical worker only'),
    resultConsumerOwner: owner('I08.machine-supervisor', 'server/src/systemIntegration/supervisor/** read-only I08 projection'),
    requiredSubclaimIds: ['PA-S4-CLAIM-003'], requiredAssumptionIds: ['PA-S1-AS-008'],
    requiredEvidenceKind: 'RUNTIME_PROBE', cockpitSurface: 'HEALTH',
  },
  {
    claimId: 'PA-S4-CLAIM-003', requirementKey: 'DENOMINATOR_INTEGRITY',
    statement: 'No missing or unsupported required component is hidden by the denominator.',
    scope: 'Release-bound expected denominator including missing and unsupported rows.',
    canonicalOwner: owner('IP-ASSURANCE.invariant-atlas-owner', 'server/src/productAssurance/** canonical worker only'),
    resultConsumerOwner: owner('I08.machine-supervisor', 'server/src/systemIntegration/supervisor/** read-only I08 projection'),
    requiredSubclaimIds: ['PA-S4-CLAIM-004'], requiredAssumptionIds: ['PA-S1-AS-008'],
    requiredEvidenceKind: 'INVENTORY_MANIFEST', cockpitSurface: 'HEALTH',
  },
  {
    claimId: 'PA-S4-CLAIM-004', requirementKey: 'TELEMETRY_POSTURE_SUFFICIENCY',
    statement: 'Telemetry completeness is sufficient for the exact claimed posture.',
    scope: 'Exact claimed posture, evidence window, telemetry paths, and advancement state.',
    canonicalOwner: owner('IP-ASSURANCE.invariant-atlas-owner', 'server/src/productAssurance/** canonical worker only'),
    resultConsumerOwner: owner('I08.machine-supervisor', 'server/src/systemIntegration/supervisor/** read-only I08 projection'),
    requiredSubclaimIds: [], requiredAssumptionIds: ['PA-S1-AS-008'],
    requiredEvidenceKind: 'TELEMETRY_COVERAGE', cockpitSurface: 'HEALTH',
  },
  {
    claimId: 'PA-S4-CLAIM-005', requirementKey: 'TEMPORAL_COHERENCE',
    statement: 'Spot, Futures, and account inputs are temporally coherent for the exact action.',
    scope: 'Exact correlated Spot, Futures, and account action snapshot.',
    canonicalOwner: owner('foundation.multi-leg-risk', 'server/src/foundation/risk/**'),
    resultConsumerOwner: owner('foundation.multi-leg-risk', 'server/src/foundation/risk/**'),
    requiredSubclaimIds: [], requiredAssumptionIds: ['PA-S1-AS-003'],
    requiredEvidenceKind: 'ACCOUNT_READBACK', cockpitSurface: 'RISK',
  },
  {
    claimId: 'PA-S4-CLAIM-006', requirementKey: 'AUTHORITATIVE_RECONCILIATION',
    statement: 'Authoritative account and exchange truth is reconciled.',
    scope: 'Exact local and authoritative order, fill, position, liability, and account snapshot.',
    canonicalOwner: owner('foundation.reconciliation', 'server/src/foundation/reconciliation/**'),
    resultConsumerOwner: owner('foundation.reconciliation', 'server/src/foundation/reconciliation/**'),
    requiredSubclaimIds: ['PA-S4-CLAIM-005'], requiredAssumptionIds: ['PA-S1-AS-003'],
    requiredEvidenceKind: 'ACCOUNT_READBACK', cockpitSurface: 'RISK',
  },
  {
    claimId: 'PA-S4-CLAIM-007', requirementKey: 'CURRENT_FENCED_EPOCH',
    statement: 'Only a current fenced epoch may enter canonical mutation state.',
    scope: 'Exact mutation identity, process, deployment, lease, and fencing epoch.',
    canonicalOwner: owner('foundation.execution-coordinator', 'server/src/foundation/execution/**'),
    resultConsumerOwner: owner('foundation.control-plane', 'server/src/foundation/control/**'),
    requiredSubclaimIds: ['PA-S4-CLAIM-011'], requiredAssumptionIds: ['PA-S1-AS-007'],
    requiredEvidenceKind: 'DEPLOYMENT_IDENTITY', cockpitSurface: 'CONTROL_ROOM',
  },
  {
    claimId: 'PA-S4-CLAIM-008', requirementKey: 'CONTROL_COMMAND_CANONICALITY',
    statement: 'Live controls map to canonical commands.',
    scope: 'Exact exposed live control and canonical command-registry revision.',
    canonicalOwner: owner('foundation.control-plane', 'server/src/foundation/control/**'),
    resultConsumerOwner: owner('foundation.control-plane', 'server/src/foundation/control/**'),
    requiredSubclaimIds: [], requiredAssumptionIds: ['PA-S1-AS-002', 'PA-S1-AS-009'],
    requiredEvidenceKind: 'CONTROL_REGISTRY_READBACK', cockpitSurface: 'CONTROL_ROOM',
  },
  {
    claimId: 'PA-S4-CLAIM-009', requirementKey: 'RECOVERY_PATH_EVIDENCE',
    statement: 'Required rollback and recovery paths have current scenario-bounded evidence.',
    scope: 'Exact rollback or recovery scenario, product, account, exposure, and window.',
    canonicalOwner: owner('foundation.reconciliation', 'server/src/foundation/reconciliation/**'),
    resultConsumerOwner: owner('foundation.execution-coordinator', 'server/src/foundation/execution/**'),
    requiredSubclaimIds: ['PA-S4-CLAIM-006'], requiredAssumptionIds: ['PA-S1-AS-006'],
    requiredEvidenceKind: 'RECOVERY_EXERCISE', cockpitSurface: 'RISK',
  },
  {
    claimId: 'PA-S4-CLAIM-010', requirementKey: 'MODEL_COHORT_VERSION',
    statement: 'Model evidence matches the approved cohort and version.',
    scope: 'Exact model revision, symbol, horizon, liquidity, regime, and calibration cohort.',
    canonicalOwner: owner('Q.advisory-inference', 'I00 section 9 accepted Q inference service'),
    resultConsumerOwner: owner('engine.strategy-authority', 'server/src/engine/**'),
    requiredSubclaimIds: [], requiredAssumptionIds: ['PA-S1-AS-005'],
    requiredEvidenceKind: 'MODEL_EVALUATION', cockpitSurface: 'OPPORTUNITIES',
  },
  {
    claimId: 'PA-S4-CLAIM-011', requirementKey: 'RELEASE_IDENTITY_AGREEMENT',
    statement: 'Displayed, tested, and deployed SHAs agree.',
    scope: 'Exact displayed, tested, deployed, schema, configuration, model, and protocol revisions.',
    canonicalOwner: owner('I00.deployment-authority', 'I00 section 19 deployment authority'),
    resultConsumerOwner: owner('I08.machine-supervisor', 'server/src/systemIntegration/supervisor/** read-only I08 projection'),
    requiredSubclaimIds: [], requiredAssumptionIds: ['PA-S1-AS-007'],
    requiredEvidenceKind: 'DEPLOYMENT_IDENTITY', cockpitSurface: 'DASHBOARD',
  },
  {
    claimId: 'PA-S4-CLAIM-012', requirementKey: 'INDEPENDENT_SENTINEL_PAGING',
    statement: 'Independent sentinel and paging evidence is current.',
    scope: 'Exact application boundary, sentinel, paging route, delivery receipt, and retention path.',
    canonicalOwner: owner('I00.external-watchdog', 'I00 section 19 external watchdog owner'),
    resultConsumerOwner: owner('I08.machine-supervisor', 'server/src/systemIntegration/supervisor/** read-only I08 projection'),
    requiredSubclaimIds: ['PA-S4-CLAIM-004'], requiredAssumptionIds: ['PA-S1-AS-008'],
    requiredEvidenceKind: 'SENTINEL_RECEIPT', cockpitSurface: 'NOTIFICATIONS',
  },
  {
    claimId: 'PA-S4-CLAIM-013', requirementKey: 'DIAGNOSTIC_PLANE_POSTURE',
    statement: 'Diagnostic-plane posture is explicit. NOT_CONFIGURED is valid and cannot degrade deterministic product readiness. If posture is SHADOW, OWNER_GATED, or ACTIVE, containment, permission, provider-outage, privacy, and independent evidence must be current.',
    scope: 'Exact diagnostic posture and, when configured, its five required evidence families.',
    canonicalOwner: owner('IP-ASSURANCE.diagnostic-boundary', 'IP_ASSURANCE.md section 3.9'),
    resultConsumerOwner: owner('I08.machine-supervisor', 'server/src/systemIntegration/supervisor/** read-only I08 projection'),
    requiredSubclaimIds: [], requiredAssumptionIds: ['PA-S1-AS-002', 'PA-S1-AS-007', 'PA-S1-AS-009'],
    requiredEvidenceKind: 'DIAGNOSTIC_POSTURE_READBACK', cockpitSurface: 'HEALTH',
  },
]);

export const REQUIRED_MANDATORY_CLAIM_IDS = Object.freeze(
  MANDATORY_CLAIM_REQUIREMENTS.map((entry) => entry.claimId),
);
export const REQUIRED_MANDATORY_REQUIREMENT_KEYS = Object.freeze(
  MANDATORY_CLAIM_REQUIREMENTS.map((entry) => entry.requirementKey),
);
export const canonicalEvidenceStatement = (evidence) => {
  const claimBinding = evidence?.claimBinding;
  const requirement = MANDATORY_CLAIM_REQUIREMENTS.find((entry) => (
    entry.claimId === claimBinding?.claimId
    && entry.requirementKey === claimBinding?.requirementKey
    && entry.scope === claimBinding?.scope
  ));
  if (!requirement) return null;
  return evidence?.purpose === 'INDEPENDENCE_BASIS'
    ? `Independent owner-authorization record defines the verifier contract for ${requirement.claimId}: ${requirement.statement}`
    : `Independent evidence record evaluates ${requirement.claimId}: ${requirement.statement}`;
};
export const REQUIRED_ROOT_CLAIM_IDS = Object.freeze([
  'PA-S4-CLAIM-001',
  'PA-S4-CLAIM-006',
  'PA-S4-CLAIM-007',
  'PA-S4-CLAIM-008',
  'PA-S4-CLAIM-009',
  'PA-S4-CLAIM-010',
  'PA-S4-CLAIM-012',
  'PA-S4-CLAIM-013',
]);

export const DIAGNOSTIC_EVIDENCE_REQUIREMENTS = deepFreeze({
  postureEvidenceIds: {
    purpose: 'DIAGNOSTIC_POSTURE',
    kind: 'DIAGNOSTIC_POSTURE_READBACK',
  },
  containmentEvidenceIds: {
    purpose: 'DIAGNOSTIC_CONTAINMENT',
    kind: 'DIAGNOSTIC_CONTAINMENT_TEST',
  },
  permissionEvidenceIds: {
    purpose: 'DIAGNOSTIC_PERMISSION',
    kind: 'DIAGNOSTIC_PERMISSION_READBACK',
  },
  providerOutageEvidenceIds: {
    purpose: 'DIAGNOSTIC_PROVIDER_OUTAGE',
    kind: 'DIAGNOSTIC_PROVIDER_OUTAGE_EXERCISE',
  },
  privacyEvidenceIds: {
    purpose: 'DIAGNOSTIC_PRIVACY',
    kind: 'DIAGNOSTIC_PRIVACY_REVIEW',
  },
  independentEvidenceIds: {
    purpose: 'DIAGNOSTIC_INDEPENDENCE',
    kind: 'DIAGNOSTIC_INDEPENDENCE_CHECK',
  },
});

export const INDEPENDENCE_REQUIRED_FAILURE_DOMAIN_CLASSES = deepFreeze({
  TECHNICAL: ['CLOCK', 'STORE', 'NETWORK', 'CREDENTIAL', 'CODE_PATH', 'TELEMETRY_EXPORTER', 'MODEL_FAMILY'],
  TECHNICAL_AND_OPERATIONAL: ['CLOCK', 'STORE', 'NETWORK', 'CREDENTIAL', 'CODE_PATH', 'TELEMETRY_EXPORTER', 'MODEL_FAMILY', 'PROCESS', 'ORGANIZATION'],
  OUT_OF_PROCESS: ['CLOCK', 'STORE', 'NETWORK', 'CREDENTIAL', 'CODE_PATH', 'TELEMETRY_EXPORTER', 'MODEL_FAMILY', 'PROCESS'],
  OUT_OF_HOST: ['CLOCK', 'STORE', 'NETWORK', 'CREDENTIAL', 'CODE_PATH', 'TELEMETRY_EXPORTER', 'MODEL_FAMILY', 'PROCESS', 'HOST'],
  OUT_OF_BAND: ['CLOCK', 'STORE', 'NETWORK', 'CREDENTIAL', 'CODE_PATH', 'TELEMETRY_EXPORTER', 'MODEL_FAMILY', 'PROCESS', 'HOST', 'ORGANIZATION'],
});

export const CLAIM_NODE_REQUIRED_FIELDS = Object.freeze([
  'claimId',
  'requirementKey',
  'statement',
  'scope',
  'canonicalOwner',
  'resultConsumerOwner',
  'capitalCritical',
  'subclaimIds',
  'assumptionIds',
  'supportingEvidenceIds',
  'counterEvidenceIds',
  'validator',
  'propagationSloMs',
  'assuranceSloMs',
  'invariantProjection',
  'cockpitProjection',
  'componentDrillDown',
  'missingDataBehavior',
]);

export const EVIDENCE_REQUIRED_FIELDS = Object.freeze([
  'evidenceId',
  'role',
  'purpose',
  'kind',
  'statement',
  'claimBinding',
  'capitalCritical',
  'result',
  'reasonCode',
  'sourceIdentity',
  'createdAtMs',
  'lastVerifiedAtMs',
  'maximumAgeMs',
  'expiresAtMs',
  'validator',
  'producer',
  'verifier',
  'independence',
  'derivedFromClaimIds',
  'derivedFromEvidenceIds',
  'certifiesEvidenceIds',
]);

export const ASSURANCE_CASE_SCHEMA_DESCRIPTOR = deepFreeze({
  $id: 'urn:cosmos:product-assurance:s4:assurance-case:v1',
  schemaVersion: ASSURANCE_CASE_SCHEMA_VERSION,
  closedObjects: true,
  bounded: true,
  resultVocabulary: ASSURANCE_RESULTS,
  mandatoryClaimIds: REQUIRED_MANDATORY_CLAIM_IDS,
  propagationPolicy: ASSURANCE_CASE_PROPAGATION_POLICY,
  claimNodeRequiredFields: CLAIM_NODE_REQUIRED_FIELDS,
  evidenceRequiredFields: EVIDENCE_REQUIRED_FIELDS,
  limits: SCHEMA_LIMITS,
  authorityBoundary: {
    truthLabel: 'SYNTHETIC_ONLY',
    authorityEffect: 'NONE',
    runtimeProjectionOwner: 'I08.machine-supervisor',
  },
  explanationBoundary: {
    llmMayExplain: true,
    llmMayRestoreSupport: false,
    prohibitedCommands: PROHIBITED_ASSURANCE_COMMANDS,
  },
});
