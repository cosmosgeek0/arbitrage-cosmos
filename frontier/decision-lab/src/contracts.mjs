import {
  cloneCanonical,
  contractError,
  deepFreeze,
  omitFields,
  sha256,
  validateFixtureOutput,
} from '../../dock/src/index.mjs';
import { acceptedOwnerContract, OWNER_CONTRACTS } from './owner-contracts.mjs';
import { policyManifestEntry } from './policy-manifest.mjs';
import { assertBoundedStructure } from './bounds.mjs';

export const DECISION_LAB_SCHEMA_VERSION = 1;
export const DECISION_LAB_CONTRACT_VERSION = '1.0.0';
export const MAX_ALTERNATIVES = 7;
export const MAX_ABLATIONS = 64;
export const MAX_INFORMATION_REFS = 256;

export const DECISION_DISPOSITIONS = Object.freeze([
  'ACCEPTED',
  'REJECTED',
  'ABSTAINED',
  'MISSED_OPPORTUNITY',
]);

export const ALTERNATIVE_KINDS = Object.freeze([
  'NO_TRADE',
  'EARLIER_TIMING',
  'DELAYED_TIMING',
  'THRESHOLD',
  'ENTRY',
  'EXIT',
  'EXECUTION_POLICY',
]);

export const ABLATION_KINDS = Object.freeze([
  'Q_ASSISTED_VS_MARKET_ONLY',
  'REMOVE_EVIDENCE_SOURCE',
  'REMOVE_FEATURE_FAMILY',
]);

export const CANONICAL_OWNERS = Object.freeze([
  'MAIN_ENGINE',
  'MAIN_INTELLIGENCE',
  'Q_RESEARCH',
  'L_EXCHANGE_TWIN',
  'L_EXECUTION_POLICY',
  'L_RECOVERY',
  'CAPITAL_ECONOMICS',
]);

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/;
const NON_NEGATIVE_DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/;
const REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_:.\-]{1,127}$/;
const Q15_FIXTURE_IDENTITY = Object.freeze({
  fixtureRecordId: 'q15-card:decision-lab-fixture',
  fixtureRevision: 'v1',
  fixtureRecordRef: 'frontier/decision-lab/fixtures/factory.mjs#Q15_EXPERIMENT_FIXTURE',
  fixtureTruthClass: 'SYNTHETIC_FIXTURE_REFERENCE',
  fixtureContentHash: '94e756195af082055ddff4d3fb7ff2eb3730e8d2a455e58ef204bdafafb1a847',
});
const ALTERNATIVE_MANIFEST_REF = 'frontier/decision-lab/src/policy-manifest.mjs#PREDECLARED_ALTERNATIVE_MANIFEST';
const ALTERNATIVE_MANIFEST_HASH = '30944cd6ed5f955004ad5c4cc53818e1d8b30dd6f385b1da3ce32909e1f82bec';
const L_POLICY_FACTORY_SOURCE = Object.freeze({
  evidenceClass: 'ACCEPTED_FIXTURE_FACTORY_SOURCE_ONLY',
  evidenceRef: 'git:df6b472993ca9659ce09cf5f72004981c6835f0d:server/test/liveEdge/executionPolicy/fixtures.mjs#makeCandidate',
  evidenceCommitSha: 'df6b472993ca9659ce09cf5f72004981c6835f0d',
  evidenceContentHash: 'e1ab8c2274553eb23bffa70829172fdbb939fb7e4ad559890e6bdd953605e5a9',
  fixtureRecordId: null,
  fixtureRevision: null,
  fixtureContentHash: null,
  payloadAvailable: false,
  alternativePolicyPayloadAvailable: false,
  truthClass: 'ACCEPTED_FIXTURE_FACTORY_SOURCE_ONLY',
  materializationState: 'NOT_MATERIALIZED',
  evaluationState: 'NOT_EVALUATED',
  authorityClass: 'NO_AUTHORITY',
});

const REPORT_FIELDS = Object.freeze([
  'schema',
  'version',
  'contractVersion',
  'requestId',
  'evaluatedAtMs',
  'fixtureClass',
  'fixtureComposition',
  'evaluationMode',
  'truthClass',
  'truthLabel',
  'authorityClass',
  'networkMode',
  'canonical',
  'decision',
  'alternatives',
  'ablations',
  'comparisonRules',
  'identityProof',
  'cutoffProof',
  'sourceDependenceWarnings',
  'warnings',
  'summary',
  'alternativeAuthorityProof',
  'ownerBoundaryProof',
  'winner',
  'causalClaimStatus',
  'causalEffect',
  'profitClaim',
  'limitations',
  'reportId',
  'reportHash',
]);

const PROJECTED_ALTERNATIVE_FIELDS = Object.freeze([
  'schema',
  'version',
  'alternativeId',
  'alternativeRevision',
  'kind',
  'role',
  'owner',
  'ownerEvidenceStatus',
  'predeclarationStatus',
  'predeclaredAtMs',
  'ownerEvidenceRef',
  'alternativeManifestRef',
  'feasibility',
  'support',
  'marketPathRef',
  'costAssumptionRef',
  'outcome',
  'causalClaimStatus',
  'causalEffect',
  'selected',
  'rank',
  'alternativeHash',
  'comparisonStatus',
]);

const PROJECTED_ABLATION_FIELDS = Object.freeze([
  'schema',
  'version',
  'ablationId',
  'ablationRevision',
  'kind',
  'predeclarationStatus',
  'predeclaredAtMs',
  'qExperimentEvidenceRef',
  'removedRefId',
  'baseline',
  'variant',
  'sourceDependenceWarnings',
  'interpretation',
  'ablationHash',
]);

export const DECISION_LAB_LIMITATIONS = Object.freeze([
  'A single retrospective decision cannot identify a population policy value.',
  'Historical-path alternatives are descriptive and may be confounded by the observed action and unavailable market response.',
  'No owner decision-record, outcome, cost, path, policy, propensity, or liability payload is bundled; accepted contract provenance is not record provenance.',
  'No result can promote a strategy, choose an execution policy, size capital, or authorize an order.',
]);

function fail(code, message) {
  throw contractError(code, message);
}

function compareCodeUnits(left, right) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function requireCanonicalMatch(actual, expected, code, message) {
  if (sha256(actual) !== sha256(expected)) fail(code, message);
}

function requireModuleFixtureRef(value, name) {
  if (
    typeof value !== 'string'
    || !/^frontier\/decision-lab\/fixtures\/factory\.mjs#(?:makeDecisionLabFixture|Q15_EXPERIMENT_FIXTURE)$/.test(value)
    || value.includes('..')
    || value.includes('//')
    || value.includes('\\')
  ) fail('FIXTURE_RECORD_REF_INVALID', `${name} must be a normalized module-local fixture reference`);
}

function record(value, fields, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('RECORD_REQUIRED', `${name} must be an object`);
  }
  const keys = Object.keys(value);
  const missing = fields.filter((field) => !Object.hasOwn(value, field));
  if (missing.length > 0) fail('REQUIRED_FIELD_MISSING', `${name} is missing ${missing.join(',')}`);
  const unknown = keys.filter((field) => !fields.includes(field));
  if (unknown.length > 0) fail('UNKNOWN_FIELD_REJECTED', `${name} contains ${unknown.join(',')}`);
  return value;
}

function text(value, name, maximum = 2_048) {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0 || value.length > maximum) {
    fail('STRING_INVALID', `${name} must be a trimmed non-empty string of at most ${maximum} characters`);
  }
  return value;
}

function enumValue(value, allowed, name) {
  if (!allowed.includes(value)) fail('ENUM_INVALID', `${name} has unsupported value ${String(value)}`);
  return value;
}

function utcMillis(value, name) {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    fail('UTC_MILLIS_INVALID', `${name} must be a non-negative safe integer`);
  }
  return value;
}

function nonNegativeDecimal(value, name, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || value.length > 128 || !NON_NEGATIVE_DECIMAL_PATTERN.test(value)) {
    fail('DECIMAL_INVALID', `${name} must be a bounded canonical non-negative decimal string`);
  }
  return value;
}

function propensity(value, name, { nullable = false } = {}) {
  const parsed = nonNegativeDecimal(value, name, { nullable });
  if (parsed === null) return null;
  if (!(parsed === '0' || parsed === '1' || parsed.startsWith('0.'))) {
    fail('PROPENSITY_INVALID', `${name} must be between zero and one`);
  }
  return parsed;
}

function canonicalReasonCodes(values, name, { allowEmpty = true } = {}) {
  if (!Array.isArray(values) || values.length > 128 || (!allowEmpty && values.length === 0)) {
    fail('REASON_CODES_INVALID', `${name} must be a bounded array${allowEmpty ? '' : ' with at least one value'}`);
  }
  for (const [index, value] of values.entries()) {
    if (typeof value !== 'string' || !REASON_CODE_PATTERN.test(value)) {
      fail('REASON_CODE_INVALID', `${name}[${index}] is not a stable reason code`);
    }
  }
  return Object.freeze([...new Set(values)].sort());
}

function boundedUnique(records, name, minimum, maximum, key) {
  if (!Array.isArray(records) || records.length < minimum || records.length > maximum) {
    fail('ARRAY_BOUNDS_INVALID', `${name} must contain ${minimum}..${maximum} records`);
  }
  const identities = records.map((entry, index) => text(entry?.[key], `${name}[${index}].${key}`, 256));
  if (new Set(identities).size !== identities.length) fail('DUPLICATE_IDENTITY', `${name} contains duplicate ${key}`);
}

export function validateCanonicalRef(input, name = 'CanonicalRefV1') {
  assertBoundedStructure(input, name);
  const value = record(input, [
    'owner',
    'contractId',
    'contractVersion',
    'ownerContractRef',
    'ownerCommitSha',
    'ownerContractContentHash',
    'fixtureRecordId',
    'fixtureRevision',
    'fixtureRecordRef',
    'fixtureTruthClass',
    'fixtureContentHash',
    'fixtureIdentityHash',
  ], name);
  enumValue(value.owner, CANONICAL_OWNERS, `${name}.owner`);
  for (const field of ['contractId', 'contractVersion', 'fixtureRecordId', 'fixtureRevision']) text(value[field], `${name}.${field}`, 512);
  text(value.ownerContractRef, `${name}.ownerContractRef`, 4_096);
  text(value.fixtureRecordRef, `${name}.fixtureRecordRef`, 4_096);
  if (!GIT_SHA_PATTERN.test(value.ownerCommitSha)) fail('GIT_SHA_INVALID', `${name}.ownerCommitSha must be a full lowercase Git SHA`);
  if (!value.ownerContractRef.startsWith(`git:${value.ownerCommitSha}:`)) {
    fail('OWNER_CONTRACT_REF_INVALID', `${name}.ownerContractRef must embed its exact ownerCommitSha`);
  }
  requireModuleFixtureRef(value.fixtureRecordRef, `${name}.fixtureRecordRef`);
  enumValue(
    value.fixtureTruthClass,
    ['SYNTHETIC_FIXTURE_REFERENCE', 'UNVERIFIED_RECORDED_SHAPE_REFERENCE'],
    `${name}.fixtureTruthClass`,
  );
  if (!SHA256_PATTERN.test(value.ownerContractContentHash)) {
    fail('OWNER_CONTRACT_HASH_INVALID', `${name}.ownerContractContentHash must be a lowercase SHA-256`);
  }
  if (!acceptedOwnerContract(value)) {
    fail('OWNER_CONTRACT_NOT_ACCEPTED', `${name} does not match the frozen accepted owner-contract allowlist`);
  }
  if (value.fixtureContentHash !== null && !SHA256_PATTERN.test(value.fixtureContentHash)) {
    fail('FIXTURE_CONTENT_HASH_INVALID', `${name}.fixtureContentHash must be null or a lowercase SHA-256`);
  }
  if (!SHA256_PATTERN.test(value.fixtureIdentityHash)) {
    fail('FIXTURE_IDENTITY_HASH_INVALID', `${name}.fixtureIdentityHash must be a lowercase SHA-256`);
  }
  const expectedIdentity = sha256(omitFields(value, ['fixtureIdentityHash']));
  if (value.fixtureIdentityHash !== expectedIdentity) fail('FIXTURE_IDENTITY_HASH_MISMATCH', `${name}.fixtureIdentityHash does not match its provenance envelope`);
  return deepFreeze(cloneCanonical(value));
}

function validateOwnerRef(input, owners, name) {
  const value = validateCanonicalRef(input, name);
  if (!owners.includes(value.owner)) fail('OWNER_MISMATCH', `${name}.owner is not allowed for this seam`);
  return value;
}

function requireContract(value, contractIds, name) {
  if (!contractIds.includes(value.contractId)) {
    fail('OWNER_CONTRACT_SEAM_MISMATCH', `${name}.contractId is not accepted for this seam`);
  }
  return value;
}

function validateFeatureRef(input, cutoffTimeMs, index) {
  const name = `DecisionEnvelopeV1.featureRefs[${index}]`;
  const value = record(input, ['ref', 'featureFamilyId', 'informationRole', 'asOfMs', 'inputLastEventMs'], name);
  const ref = validateOwnerRef(value.ref, ['Q_RESEARCH', 'MAIN_INTELLIGENCE'], `${name}.ref`);
  requireContract(ref, ['FeatureValueV1', 'FeatureValue'], `${name}.ref`);
  text(value.featureFamilyId, `${name}.featureFamilyId`, 256);
  enumValue(value.informationRole, ['MARKET_ONLY', 'Q_ASSISTED'], `${name}.informationRole`);
  const asOfMs = utcMillis(value.asOfMs, `${name}.asOfMs`);
  const inputLastEventMs = utcMillis(value.inputLastEventMs, `${name}.inputLastEventMs`);
  if (inputLastEventMs > asOfMs || asOfMs > cutoffTimeMs) {
    fail('POST_CUTOFF_FEATURE_ACCESS', `${name} observes information after the decision cutoff`);
  }
  return deepFreeze({ ref, featureFamilyId: value.featureFamilyId, informationRole: value.informationRole, asOfMs, inputLastEventMs });
}

function validateEvidenceRef(input, cutoffTimeMs, index) {
  const name = `DecisionEnvelopeV1.evidenceRefs[${index}]`;
  const value = record(input, [
    'ref',
    'sourceFamilyId',
    'informationRole',
    'upstreamOriginId',
    'copyClusterId',
    'eventTimeMs',
    'publishedTimeMs',
    'observedTimeMs',
    'validUntilMs',
  ], name);
  const ref = validateOwnerRef(value.ref, ['Q_RESEARCH', 'MAIN_INTELLIGENCE'], `${name}.ref`);
  requireContract(ref, ['FrozenPreEventRecord', 'ComparisonReportV1', 'ReferenceMarketEvidenceRowV1'], `${name}.ref`);
  text(value.sourceFamilyId, `${name}.sourceFamilyId`, 256);
  enumValue(value.informationRole, ['MARKET_ONLY', 'Q_ASSISTED'], `${name}.informationRole`);
  text(value.upstreamOriginId, `${name}.upstreamOriginId`, 256);
  if (value.copyClusterId !== null) text(value.copyClusterId, `${name}.copyClusterId`, 256);
  for (const field of ['eventTimeMs', 'publishedTimeMs', 'observedTimeMs', 'validUntilMs']) {
    utcMillis(value[field], `${name}.${field}`);
  }
  if (value.eventTimeMs > cutoffTimeMs || value.publishedTimeMs > cutoffTimeMs || value.observedTimeMs > cutoffTimeMs) {
    fail('POST_CUTOFF_EVIDENCE_ACCESS', `${name} was not available in the exact information set`);
  }
  if (value.publishedTimeMs > value.observedTimeMs) {
    fail('EVIDENCE_OBSERVED_BEFORE_PUBLICATION', `${name} cannot be observed before publication`);
  }
  if (value.validUntilMs < cutoffTimeMs) fail('EVIDENCE_STALE_AT_CUTOFF', `${name} expired before the decision cutoff`);
  return deepFreeze({
    ref,
    sourceFamilyId: value.sourceFamilyId,
    informationRole: value.informationRole,
    upstreamOriginId: value.upstreamOriginId,
    copyClusterId: value.copyClusterId,
    eventTimeMs: value.eventTimeMs,
    publishedTimeMs: value.publishedTimeMs,
    observedTimeMs: value.observedTimeMs,
    validUntilMs: value.validUntilMs,
  });
}

function validateBiasAssessment(input) {
  const dimensions = [
    'selectionBias',
    'survivorshipBias',
    'hindsightRisk',
    'copiedSourceRisk',
    'confounding',
  ];
  const value = record(input, dimensions, 'DecisionEnvelopeV1.biasAssessment');
  return deepFreeze(Object.fromEntries(dimensions.map((dimension) => {
    const entry = record(value[dimension], ['status', 'reasonCodes'], `DecisionEnvelopeV1.biasAssessment.${dimension}`);
    enumValue(entry.status, ['PRESENT', 'UNKNOWN', 'NOT_EVIDENCED'], `DecisionEnvelopeV1.biasAssessment.${dimension}.status`);
    return [dimension, deepFreeze({
      status: entry.status,
      reasonCodes: canonicalReasonCodes(entry.reasonCodes, `DecisionEnvelopeV1.biasAssessment.${dimension}.reasonCodes`, {
        allowEmpty: entry.status === 'NOT_EVIDENCED',
      }),
    })];
  })));
}

export function createDecisionEnvelope(input) {
  assertBoundedStructure(input, 'DecisionEnvelopeV1');
  const raw = cloneCanonical(input);
  const value = record(raw, [
    'schema',
    'version',
    'disposition',
    'decisionTimeMs',
    'informationCutoffMs',
    'canonicalDecisionRef',
    'qExperimentRef',
    'marketPathRef',
    'costAssumptionRef',
    'featureRefs',
    'evidenceRefs',
    'biasAssessment',
  ], 'DecisionEnvelopeV1');
  if (value.schema !== 'DecisionEnvelopeV1' || value.version !== 1) fail('SCHEMA_VERSION_INVALID', 'DecisionEnvelopeV1 must be V1');
  enumValue(value.disposition, DECISION_DISPOSITIONS, 'DecisionEnvelopeV1.disposition');
  const decisionTimeMs = utcMillis(value.decisionTimeMs, 'DecisionEnvelopeV1.decisionTimeMs');
  const informationCutoffMs = utcMillis(value.informationCutoffMs, 'DecisionEnvelopeV1.informationCutoffMs');
  if (informationCutoffMs > decisionTimeMs) fail('INFORMATION_CUTOFF_INVALID', 'information cutoff cannot follow the decision');
  const canonicalDecisionRef = validateOwnerRef(
    value.canonicalDecisionRef,
    ['MAIN_ENGINE', 'MAIN_INTELLIGENCE', 'Q_RESEARCH'],
    'DecisionEnvelopeV1.canonicalDecisionRef',
  );
  const decisionSourceByDisposition = {
    ACCEPTED: { owner: 'MAIN_ENGINE', contractId: 'MainDecisionV0', fixtureRecordId: 'decision:accepted' },
    REJECTED: { owner: 'MAIN_ENGINE', contractId: 'MainDecisionV0', fixtureRecordId: 'decision:rejected' },
    ABSTAINED: { owner: 'Q_RESEARCH', contractId: 'BoundAssessmentDecisionV1', fixtureRecordId: 'decision:abstained' },
    MISSED_OPPORTUNITY: { owner: 'Q_RESEARCH', contractId: 'DispositionRecordV1', fixtureRecordId: 'decision:missed_opportunity' },
  };
  const expectedDecisionSource = decisionSourceByDisposition[value.disposition];
  if (Object.entries(expectedDecisionSource).some(([field, expected]) => canonicalDecisionRef[field] !== expected)) {
    fail('DECISION_DISPOSITION_SOURCE_MISMATCH', `DecisionEnvelopeV1 ${value.disposition} must bind its exact canonical source semantics`);
  }
  const qExperimentRef = validateOwnerRef(value.qExperimentRef, ['Q_RESEARCH'], 'DecisionEnvelopeV1.qExperimentRef');
  if (qExperimentRef.contractId !== 'Q15ExperimentCardV1') {
    fail('EXPERIMENT_CONTRACT_MISMATCH', 'DecisionEnvelopeV1.qExperimentRef must bind Q15ExperimentCardV1');
  }
  if (qExperimentRef.fixtureContentHash === null) fail('EXPERIMENT_FIXTURE_HASH_REQUIRED', 'DecisionEnvelopeV1.qExperimentRef requires exact fixture content bytes');
  for (const [field, expected] of Object.entries(Q15_FIXTURE_IDENTITY)) {
    if (qExperimentRef[field] !== expected) fail('EXPERIMENT_FIXTURE_IDENTITY_MISMATCH', `DecisionEnvelopeV1.qExperimentRef.${field} is not the bundled validated Q15 fixture`);
  }
  const marketPathRef = validateOwnerRef(
    value.marketPathRef,
    ['Q_RESEARCH', 'L_EXCHANGE_TWIN', 'MAIN_INTELLIGENCE'],
    'DecisionEnvelopeV1.marketPathRef',
  );
  requireContract(marketPathRef, ['TwinScenarioInput'], 'DecisionEnvelopeV1.marketPathRef');
  const costAssumptionRef = validateOwnerRef(
    value.costAssumptionRef,
    ['Q_RESEARCH', 'L_EXECUTION_POLICY', 'CAPITAL_ECONOMICS'],
    'DecisionEnvelopeV1.costAssumptionRef',
  );
  requireContract(costAssumptionRef, ['CostScenarioV1'], 'DecisionEnvelopeV1.costAssumptionRef');
  boundedUnique(value.featureRefs, 'DecisionEnvelopeV1.featureRefs', 1, MAX_INFORMATION_REFS, 'featureFamilyId');
  const featureRefs = value.featureRefs
    .map((entry, index) => validateFeatureRef(entry, informationCutoffMs, index))
    .sort((left, right) => compareCodeUnits(left.ref.fixtureRecordId, right.ref.fixtureRecordId));
  boundedUnique(value.evidenceRefs, 'DecisionEnvelopeV1.evidenceRefs', 1, MAX_INFORMATION_REFS, 'sourceFamilyId');
  const evidenceRefs = value.evidenceRefs
    .map((entry, index) => validateEvidenceRef(entry, informationCutoffMs, index))
    .sort((left, right) => compareCodeUnits(left.ref.fixtureRecordId, right.ref.fixtureRecordId));
  if (featureRefs.length + evidenceRefs.length + 1 > MAX_ABLATIONS) {
    fail('INFORMATION_SET_ABLATION_BUDGET_EXCEEDED', 'DecisionLab information set must fit one complete bounded one-at-a-time ablation set');
  }
  const informationRoles = new Set([...featureRefs, ...evidenceRefs].map((entry) => entry.informationRole));
  if (!informationRoles.has('MARKET_ONLY') || !informationRoles.has('Q_ASSISTED')) {
    fail('INFORMATION_ROLE_COVERAGE_INVALID', 'DecisionLab requires explicit MARKET_ONLY and Q_ASSISTED information roles');
  }
  const refIds = [...featureRefs, ...evidenceRefs].map((entry) => entry.ref.fixtureRecordId);
  if (new Set(refIds).size !== refIds.length) fail('DUPLICATE_INFORMATION_REF', 'feature and evidence record IDs must be unique');
  const biasAssessment = validateBiasAssessment(value.biasAssessment);
  for (const dimension of ['selectionBias', 'survivorshipBias', 'hindsightRisk', 'confounding']) {
    if (biasAssessment[dimension].status === 'NOT_EVIDENCED') {
      fail('RETROSPECTIVE_BIAS_UNDERSTATED', `DecisionEnvelopeV1.${dimension} cannot be NOT_EVIDENCED for one retrospective decision`);
    }
  }
  const hasCopiedDependence = evidenceRefs.some((entry, index) => evidenceRefs.some((other, otherIndex) => (
    index !== otherIndex
    && ((entry.copyClusterId !== null && entry.copyClusterId === other.copyClusterId)
      || entry.upstreamOriginId === other.upstreamOriginId)
  )));
  if (hasCopiedDependence && biasAssessment.copiedSourceRisk.status !== 'PRESENT') {
    fail('COPIED_SOURCE_BIAS_UNDERSTATED', 'DecisionEnvelopeV1 copied-source bias must be PRESENT when evidence shares a copy cluster or upstream origin');
  }
  const core = {
    schema: 'DecisionEnvelopeV1',
    version: 1,
    disposition: value.disposition,
    decisionTimeMs,
    informationCutoffMs,
    canonicalDecisionRef,
    qExperimentRef,
    marketPathRef,
    costAssumptionRef,
    featureRefs,
    evidenceRefs,
    biasAssessment,
  };
  const decisionHash = sha256(core);
  return deepFreeze({ ...core, decisionContextId: `dl_decision_${decisionHash}`, decisionHash });
}

function validateCostEvidence(input, name) {
  if (input === null) return null;
  const value = record(input, ['ref', 'quoteAsset', 'totalQuote'], name);
  const ref = validateOwnerRef(value.ref, ['Q_RESEARCH', 'L_EXECUTION_POLICY', 'CAPITAL_ECONOMICS'], `${name}.ref`);
  text(value.quoteAsset, `${name}.quoteAsset`, 32);
  nonNegativeDecimal(value.totalQuote, `${name}.totalQuote`);
  return deepFreeze({ ref, quoteAsset: value.quoteAsset, totalQuote: value.totalQuote });
}

function validateResidualLiability(input, positionTaken, name) {
  const value = record(input, ['state', 'ref', 'asset', 'quantity'], name);
  enumValue(value.state, ['NONE', 'PRESENT', 'UNKNOWN', 'UNAVAILABLE', 'NOT_APPLICABLE'], `${name}.state`);
  const ref = value.ref === null ? null : validateOwnerRef(value.ref, ['L_RECOVERY'], `${name}.ref`);
  if (ref !== null) requireContract(ref, ['L12RecoveryEvidence'], `${name}.ref`);
  if (value.state === 'PRESENT') {
    if (ref === null) fail('LIABILITY_REF_REQUIRED', `${name}.ref is required for PRESENT liability`);
    if (ref.fixtureContentHash === null) fail('LIABILITY_PAYLOAD_REQUIRED', `${name}.ref requires exact owner liability payload bytes`);
    text(value.asset, `${name}.asset`, 32);
    nonNegativeDecimal(value.quantity, `${name}.quantity`);
    if (value.quantity === '0') fail('LIABILITY_QUANTITY_INVALID', `${name}.quantity must be positive when liability is PRESENT`);
  } else if (value.state === 'NONE') {
    if (ref === null || value.asset !== null || value.quantity !== null) {
      fail('LIABILITY_NONE_SHAPE_INVALID', `${name} NONE requires owner evidence and no fabricated amount`);
    }
    if (ref.fixtureContentHash === null) fail('LIABILITY_PAYLOAD_REQUIRED', `${name} NONE requires exact owner liability payload bytes`);
  } else if (value.state === 'NOT_APPLICABLE') {
    if (positionTaken !== false || ref !== null || value.asset !== null || value.quantity !== null) {
      fail('LIABILITY_NOT_APPLICABLE_INVALID', `${name} is NOT_APPLICABLE only when no position existed`);
    }
  } else if (value.asset !== null || value.quantity !== null) {
    fail('LIABILITY_UNKNOWN_SHAPE_INVALID', `${name} cannot carry an amount while ${value.state}`);
  }
  return deepFreeze({ state: value.state, ref, asset: value.asset, quantity: value.quantity });
}

function validateUncertainty(input, name) {
  const value = record(input, ['state', 'reasonCodes'], name);
  enumValue(value.state, ['BOUNDED_BY_OWNER', 'UNKNOWN', 'UNAVAILABLE'], `${name}.state`);
  return deepFreeze({
    state: value.state,
    reasonCodes: canonicalReasonCodes(value.reasonCodes, `${name}.reasonCodes`, {
      allowEmpty: value.state === 'BOUNDED_BY_OWNER',
    }),
  });
}

export function createOutcomeEvidence(input, context) {
  assertBoundedStructure(input, context.name ?? 'OutcomeEvidenceV1');
  const raw = cloneCanonical(input);
  const name = context.name ?? 'OutcomeEvidenceV1';
  const value = record(raw, [
    'schema',
    'version',
    'outcomeId',
    'outcomeRevision',
    'outcomeAttributionRef',
    'state',
    'realizationClass',
    'positionTaken',
    'marketPathHash',
    'costAssumptionHash',
    'mfePct',
    'maePct',
    'timeInExposureMs',
    'realizedCost',
    'hypotheticalCost',
    'residualLiability',
    'uncertainty',
  ], name);
  if (value.schema !== 'OutcomeEvidenceV1' || value.version !== 1) fail('SCHEMA_VERSION_INVALID', `${name} must be V1`);
  text(value.outcomeId, `${name}.outcomeId`, 256);
  text(value.outcomeRevision, `${name}.outcomeRevision`, 256);
  const outcomeAttributionRef = validateOwnerRef(
    value.outcomeAttributionRef,
    ['Q_RESEARCH', 'MAIN_INTELLIGENCE'],
    `${name}.outcomeAttributionRef`,
  );
  enumValue(value.state, ['AVAILABLE', 'UNAVAILABLE'], `${name}.state`);
  enumValue(value.realizationClass, [
    'REALIZED',
    'HYPOTHETICAL_PATH_CONDITIONAL',
    'NOT_APPLICABLE_NO_POSITION',
    'UNAVAILABLE',
  ], `${name}.realizationClass`);
  const expectedAttributionContract = value.realizationClass === 'REALIZED'
    ? 'OutcomeLabel'
    : 'ExcursionOutcomeV1';
  requireContract(outcomeAttributionRef, [expectedAttributionContract], `${name}.outcomeAttributionRef`);
  if (value.state === 'AVAILABLE' && outcomeAttributionRef.fixtureContentHash === null) {
    fail('OUTCOME_PAYLOAD_REQUIRED', `${name} AVAILABLE requires exact owner outcome payload bytes`);
  }
  if (value.positionTaken !== true && value.positionTaken !== false && value.positionTaken !== null) {
    fail('POSITION_TAKEN_INVALID', `${name}.positionTaken must be true, false, or null`);
  }
  if (value.marketPathHash !== context.marketPathHash || value.costAssumptionHash !== context.costAssumptionHash) {
    fail('COMPARISON_IDENTITY_MISMATCH', `${name} must use the identical market path and cost assumption`);
  }
  const realizedCost = validateCostEvidence(value.realizedCost, `${name}.realizedCost`);
  const hypotheticalCost = validateCostEvidence(value.hypotheticalCost, `${name}.hypotheticalCost`);
  if (realizedCost !== null) requireContract(realizedCost.ref, ['EconomicReport'], `${name}.realizedCost.ref`);
  if (hypotheticalCost !== null) requireContract(hypotheticalCost.ref, ['CostedOutcomeV1'], `${name}.hypotheticalCost.ref`);
  if ((realizedCost !== null && realizedCost.ref.fixtureContentHash === null)
    || (hypotheticalCost !== null && hypotheticalCost.ref.fixtureContentHash === null)) {
    fail('COST_PAYLOAD_REQUIRED', `${name} cost evidence requires exact owner payload bytes`);
  }
  const uncertainty = validateUncertainty(value.uncertainty, `${name}.uncertainty`);
  if (value.state === 'UNAVAILABLE') {
    if (
      value.realizationClass !== 'UNAVAILABLE'
      || value.positionTaken !== null
      || value.mfePct !== null
      || value.maePct !== null
      || value.timeInExposureMs !== null
      || realizedCost !== null
      || hypotheticalCost !== null
      || !['UNKNOWN', 'UNAVAILABLE'].includes(value.residualLiability?.state)
      || !['UNKNOWN', 'UNAVAILABLE'].includes(uncertainty.state)
    ) fail('UNAVAILABLE_OUTCOME_SHAPE_INVALID', `${name} UNAVAILABLE must not fabricate outcome values`);
  } else if (value.positionTaken === true) {
    nonNegativeDecimal(value.mfePct, `${name}.mfePct`);
    nonNegativeDecimal(value.maePct, `${name}.maePct`);
    utcMillis(value.timeInExposureMs, `${name}.timeInExposureMs`);
    if (value.realizationClass === 'REALIZED') {
      if (realizedCost === null || hypotheticalCost !== null) fail('REALIZED_COST_SHAPE_INVALID', `${name} REALIZED requires only owner-realized costs`);
    } else if (value.realizationClass === 'HYPOTHETICAL_PATH_CONDITIONAL') {
      if (hypotheticalCost === null || realizedCost !== null) fail('HYPOTHETICAL_COST_SHAPE_INVALID', `${name} HYPOTHETICAL requires only owner-hypothetical costs`);
    } else {
      fail('POSITION_REALIZATION_INVALID', `${name} position outcome has an invalid realization class`);
    }
  } else if (value.positionTaken === false) {
    if (
      value.mfePct !== null
      || value.maePct !== null
      || value.timeInExposureMs !== 0
      || realizedCost !== null
      || hypotheticalCost !== null
      || !['NOT_APPLICABLE_NO_POSITION', 'HYPOTHETICAL_PATH_CONDITIONAL'].includes(value.realizationClass)
    ) fail('NO_POSITION_OUTCOME_SHAPE_INVALID', `${name} no-position outcome keeps excursion and costs null`);
  } else {
    fail('AVAILABLE_OUTCOME_POSITION_UNKNOWN', `${name} AVAILABLE outcome must state whether a position existed`);
  }
  const residualLiability = validateResidualLiability(value.residualLiability, value.positionTaken, `${name}.residualLiability`);
  const core = {
    schema: 'OutcomeEvidenceV1',
    version: 1,
    outcomeId: value.outcomeId,
    outcomeRevision: value.outcomeRevision,
    outcomeAttributionRef,
    state: value.state,
    realizationClass: value.realizationClass,
    positionTaken: value.positionTaken,
    marketPathHash: value.marketPathHash,
    costAssumptionHash: value.costAssumptionHash,
    mfePct: value.mfePct,
    maePct: value.maePct,
    timeInExposureMs: value.timeInExposureMs,
    realizedCost,
    hypotheticalCost,
    residualLiability,
    uncertainty,
  };
  return deepFreeze({ ...core, outcomeHash: sha256(core) });
}

function validateFeasibility(input, name) {
  const value = record(input, ['state', 'reasonCodes'], name);
  enumValue(value.state, ['POSSIBLE_AT_CUTOFF', 'IMPOSSIBLE_AT_CUTOFF', 'UNKNOWN'], `${name}.state`);
  return deepFreeze({
    state: value.state,
    reasonCodes: canonicalReasonCodes(value.reasonCodes, `${name}.reasonCodes`, {
      allowEmpty: value.state === 'POSSIBLE_AT_CUTOFF',
    }),
  });
}

function validateSupport(input, name) {
  const value = record(input, ['propensityStatus', 'supportStatus', 'loggingPropensity', 'targetPropensity'], name);
  enumValue(value.propensityStatus, ['POSITIVE', 'ZERO', 'UNKNOWN'], `${name}.propensityStatus`);
  enumValue(value.supportStatus, ['PRESENT', 'ABSENT', 'UNKNOWN'], `${name}.supportStatus`);
  const loggingPropensity = propensity(value.loggingPropensity, `${name}.loggingPropensity`, { nullable: true });
  const targetPropensity = propensity(value.targetPropensity, `${name}.targetPropensity`, { nullable: true });
  if (value.propensityStatus === 'POSITIVE') {
    if (loggingPropensity === null || targetPropensity === null || loggingPropensity === '0' || targetPropensity === '0' || value.supportStatus !== 'PRESENT') {
      fail('POSITIVE_SUPPORT_INVALID', `${name} POSITIVE requires exact positive propensities and PRESENT support`);
    }
  } else if (value.propensityStatus === 'ZERO') {
    if (loggingPropensity !== '0' || targetPropensity === null || targetPropensity === '0' || value.supportStatus !== 'ABSENT') {
      fail('ZERO_SUPPORT_INVALID', `${name} ZERO requires zero logging propensity, positive target propensity, and ABSENT support`);
    }
  } else if (loggingPropensity !== null || targetPropensity !== null || value.supportStatus !== 'UNKNOWN') {
    fail('UNKNOWN_SUPPORT_INVALID', `${name} UNKNOWN must preserve null propensities and UNKNOWN support`);
  }
  const opeEligibility = value.propensityStatus === 'ZERO'
    ? 'INELIGIBLE_ZERO_PROPENSITY'
    : value.propensityStatus === 'UNKNOWN'
      ? 'INELIGIBLE_UNKNOWN_PROPENSITY'
      : 'NOT_APPLICABLE_SINGLE_DECISION';
  return deepFreeze({
    propensityStatus: value.propensityStatus,
    supportStatus: value.supportStatus,
    loggingPropensity,
    targetPropensity,
    importanceWeight: null,
    opeEligibility,
  });
}

function validatePolicyOwnerEvidenceRef(input, kind, name) {
  const fields = [
    'schema',
    'version',
    'owner',
    'contractId',
    'contractVersion',
    'ownerContractRef',
    'ownerCommitSha',
    'ownerContractContentHash',
    'evidenceClass',
    'evidenceRef',
    'evidenceCommitSha',
    'evidenceContentHash',
    'fixtureRecordId',
    'fixtureRevision',
    'fixtureContentHash',
    'payloadAvailable',
    'alternativePolicyPayloadAvailable',
    'truthClass',
    'materializationState',
    'evaluationState',
    'authorityClass',
  ];
  const value = record(input, fields, name);
  if (value.schema !== 'PolicyOwnerEvidenceRefV1' || value.version !== 1) {
    fail('POLICY_EVIDENCE_VERSION_INVALID', `${name} must be PolicyOwnerEvidenceRefV1@1`);
  }
  if (!acceptedOwnerContract(value)) fail('POLICY_OWNER_CONTRACT_NOT_ACCEPTED', `${name} owner contract is not frozen and accepted`);
  const contract = kind === 'EXECUTION_POLICY' ? OWNER_CONTRACTS.L_EXECUTION_POLICY : OWNER_CONTRACTS.Q_EXPERIMENT;
  const expectedSource = kind === 'EXECUTION_POLICY'
    ? L_POLICY_FACTORY_SOURCE
    : {
        evidenceClass: 'LOCAL_Q15_EXPERIMENT_FIXTURE',
        evidenceRef: Q15_FIXTURE_IDENTITY.fixtureRecordRef,
        evidenceCommitSha: null,
        evidenceContentHash: Q15_FIXTURE_IDENTITY.fixtureContentHash,
        fixtureRecordId: Q15_FIXTURE_IDENTITY.fixtureRecordId,
        fixtureRevision: Q15_FIXTURE_IDENTITY.fixtureRevision,
        fixtureContentHash: Q15_FIXTURE_IDENTITY.fixtureContentHash,
        payloadAvailable: true,
        alternativePolicyPayloadAvailable: false,
        truthClass: 'SYNTHETIC_FIXTURE_REFERENCE',
        materializationState: 'MATERIALIZED_FIXTURE',
        evaluationState: 'NOT_EVALUATED',
        authorityClass: 'NO_AUTHORITY',
      };
  const expected = {
    schema: 'PolicyOwnerEvidenceRefV1',
    version: 1,
    ...contract,
    ...expectedSource,
  };
  requireCanonicalMatch(value, expected, 'POLICY_OWNER_EVIDENCE_MISMATCH', `${name} must preserve the exact unevaluated owner evidence`);
  return deepFreeze(cloneCanonical(value));
}

function validateAlternativeManifestRef(input, kind, name) {
  const value = record(input, [
    'schema',
    'version',
    'referenceClass',
    'manifestRef',
    'manifestHash',
    'entryId',
    'entryRevision',
    'entryHash',
    'kind',
    'scenarioPredeclaredAtMs',
    'authorityClass',
    'temporalAuthority',
  ], name);
  const entry = policyManifestEntry(kind);
  const expected = {
    schema: 'AlternativeManifestRefV1',
    version: 1,
    referenceClass: 'SYNTHETIC_SCENARIO_PREDECLARATION_METADATA_ONLY',
    manifestRef: ALTERNATIVE_MANIFEST_REF,
    manifestHash: ALTERNATIVE_MANIFEST_HASH,
    entryId: entry.entryId,
    entryRevision: entry.entryRevision,
    entryHash: entry.entryHash,
    kind: entry.kind,
    scenarioPredeclaredAtMs: entry.scenarioPredeclaredAtMs,
    authorityClass: 'NO_AUTHORITY',
    temporalAuthority: false,
  };
  requireCanonicalMatch(value, expected, 'ALTERNATIVE_MANIFEST_REF_MISMATCH', `${name} must bind the exact local non-authoritative manifest entry`);
  return deepFreeze(cloneCanonical(value));
}

export function createAlternativeReference(input, context) {
  assertBoundedStructure(input, context.name ?? 'AlternativeReferenceV1');
  const raw = cloneCanonical(input);
  const name = context.name ?? 'AlternativeReferenceV1';
  const value = record(raw, [
    'schema',
    'version',
    'alternativeId',
    'alternativeRevision',
    'kind',
    'role',
    'owner',
    'predeclarationStatus',
    'predeclaredAtMs',
    'ownerEvidenceRef',
    'alternativeManifestRef',
    'feasibility',
    'support',
    'marketPathRef',
    'costAssumptionRef',
    'outcome',
  ], name);
  if (value.schema !== 'AlternativeReferenceV1' || value.version !== 1) fail('SCHEMA_VERSION_INVALID', `${name} must be V1`);
  text(value.alternativeId, `${name}.alternativeId`, 256);
  text(value.alternativeRevision, `${name}.alternativeRevision`, 256);
  enumValue(value.kind, ALTERNATIVE_KINDS, `${name}.kind`);
  enumValue(value.role, ['OBSERVED_DECISION', 'COUNTERFACTUAL_ALTERNATIVE'], `${name}.role`);
  const expectedOwner = value.role === 'OBSERVED_DECISION'
    ? context.canonicalDecisionRef.owner
    : value.kind === 'EXECUTION_POLICY' ? 'L_EXECUTION_POLICY' : 'Q_RESEARCH';
  if (value.owner !== expectedOwner) fail('ALTERNATIVE_OWNER_INVALID', `${name}.owner must be ${expectedOwner}`);
  enumValue(value.predeclarationStatus, [
    'SYNTHETIC_SCENARIO_PREDECLARED',
    'RECORDED_EVIDENCE_UNAVAILABLE',
    'NOT_APPLICABLE_OBSERVED',
  ], `${name}.predeclarationStatus`);
  const manifestEntry = policyManifestEntry(value.kind);
  if (value.alternativeRevision !== manifestEntry.entryRevision) {
    fail('POLICY_MANIFEST_PREDECLARATION_MISMATCH', `${name} does not use the frozen manifest entry revision`);
  }
  let predeclaredAtMs = null;
  if (context.fixtureClass === 'SYNTHETIC_FIXTURE') {
    if (value.predeclarationStatus !== 'SYNTHETIC_SCENARIO_PREDECLARED') {
      fail('SYNTHETIC_PREDECLARATION_STATUS_INVALID', `${name} must label its predeclaration as synthetic scenario metadata`);
    }
    predeclaredAtMs = utcMillis(value.predeclaredAtMs, `${name}.predeclaredAtMs`);
    if (predeclaredAtMs !== manifestEntry.scenarioPredeclaredAtMs || predeclaredAtMs > context.informationCutoffMs) {
      fail('NOT_PREDECLARED', `${name} does not match the simulated pre-outcome scenario cutoff`);
    }
  } else {
    const expectedStatus = value.role === 'OBSERVED_DECISION'
      ? 'NOT_APPLICABLE_OBSERVED'
      : 'RECORDED_EVIDENCE_UNAVAILABLE';
    if (value.predeclarationStatus !== expectedStatus || value.predeclaredAtMs !== null) {
      fail('RECORDED_PREDECLARATION_UNSUPPORTED', `${name} has no owner evidence that its alternative predates the recorded decision`);
    }
  }
  const ownerEvidenceRef = value.role === 'OBSERVED_DECISION'
    ? validateCanonicalRef(value.ownerEvidenceRef, `${name}.ownerEvidenceRef`)
    : validatePolicyOwnerEvidenceRef(value.ownerEvidenceRef, value.kind, `${name}.ownerEvidenceRef`);
  if (value.role === 'OBSERVED_DECISION'
    && sha256(ownerEvidenceRef) !== sha256(context.canonicalDecisionRef)) {
    fail('OBSERVED_DECISION_SOURCE_MISMATCH', `${name} observed baseline must bind the exact canonical decision source`);
  }
  const alternativeManifestRef = validateAlternativeManifestRef(value.alternativeManifestRef, value.kind, `${name}.alternativeManifestRef`);
  const marketPathRef = validateCanonicalRef(value.marketPathRef, `${name}.marketPathRef`);
  const costAssumptionRef = validateCanonicalRef(value.costAssumptionRef, `${name}.costAssumptionRef`);
  if (
    marketPathRef.fixtureIdentityHash !== context.marketPathHash
    || costAssumptionRef.fixtureIdentityHash !== context.costAssumptionHash
  ) fail('COMPARISON_IDENTITY_MISMATCH', `${name} does not bind the decision's exact path and costs`);
  const feasibility = validateFeasibility(value.feasibility, `${name}.feasibility`);
  const support = validateSupport(value.support, `${name}.support`);
  if (support.propensityStatus !== 'UNKNOWN') {
    fail('PROPENSITY_EVIDENCE_UNAVAILABLE', `${name} has no immutable logging-policy artifact for an exact propensity claim`);
  }
  const outcome = createOutcomeEvidence(value.outcome, {
    name: `${name}.outcome`,
    marketPathHash: context.marketPathHash,
    costAssumptionHash: context.costAssumptionHash,
  });
  if (feasibility.state !== 'POSSIBLE_AT_CUTOFF' && outcome.state !== 'UNAVAILABLE') {
    fail('IMPOSSIBLE_ALTERNATIVE_OUTCOME', `${name} cannot manufacture an outcome for an impossible or unknown decision`);
  }
  if (value.role === 'COUNTERFACTUAL_ALTERNATIVE'
    && (feasibility.state !== 'UNKNOWN' || outcome.state !== 'UNAVAILABLE')) {
    fail('OWNER_ALTERNATIVE_ARTIFACT_UNAVAILABLE', `${name} cannot evaluate a counterfactual without an immutable Q/L policy payload`);
  }
  if (value.role === 'OBSERVED_DECISION') {
    if (support.propensityStatus === 'ZERO' || support.supportStatus === 'ABSENT') {
      fail('OBSERVED_SUPPORT_INVALID', `${name} observed decision cannot have known-zero logging support`);
    }
    if (context.fixtureClass === 'UNVERIFIED_RECORDED_SHAPE_FIXTURE') {
      if (feasibility.state !== 'UNKNOWN' || outcome.state !== 'UNAVAILABLE') {
        fail('UNVERIFIED_RECORDED_SHAPE_OUTCOME_INVALID', `${name} cannot claim an observed outcome without recorded owner bytes`);
      }
    } else if (outcome.state === 'AVAILABLE') {
      if (context.disposition === 'ACCEPTED' && outcome.realizationClass !== 'REALIZED') {
        fail('OBSERVED_REALIZATION_INVALID', `${name} accepted observed decision must use REALIZED owner evidence`);
      } else if (context.disposition !== 'ACCEPTED'
        && (value.kind !== 'NO_TRADE' || outcome.realizationClass !== 'NOT_APPLICABLE_NO_POSITION')) {
        fail('OBSERVED_NO_ACTION_INVALID', `${name} non-accepted observed baseline must be an explicit no-position record`);
      }
    }
  } else if (!['HYPOTHETICAL_PATH_CONDITIONAL', 'NOT_APPLICABLE_NO_POSITION', 'UNAVAILABLE'].includes(outcome.realizationClass)) {
    fail('COUNTERFACTUAL_REALIZATION_INVALID', `${name} counterfactual cannot be labeled realized`);
  }
  if (value.kind === 'NO_TRADE' && outcome.state === 'AVAILABLE'
    && (outcome.positionTaken !== false || outcome.realizationClass !== 'NOT_APPLICABLE_NO_POSITION')) {
    fail('NO_TRADE_POSITION_INVALID', `${name} no-trade alternative cannot contain a position outcome`);
  }
  const core = {
    schema: 'AlternativeReferenceV1',
    version: 1,
    alternativeId: value.alternativeId,
    alternativeRevision: value.alternativeRevision,
    kind: value.kind,
    role: value.role,
    owner: value.owner,
    ownerEvidenceStatus: value.role === 'OBSERVED_DECISION'
      ? 'OBSERVED_DECISION_SOURCE_ONLY'
      : value.kind === 'EXECUTION_POLICY'
        ? 'UNEVALUATED_FIXTURE_FACTORY_SOURCE_ONLY'
        : 'EXPERIMENT_METADATA_ONLY_NO_POLICY_PAYLOAD',
    predeclarationStatus: value.predeclarationStatus,
    predeclaredAtMs,
    ownerEvidenceRef,
    alternativeManifestRef,
    feasibility,
    support,
    marketPathRef,
    costAssumptionRef,
    outcome,
    causalClaimStatus: 'NOT_IDENTIFIED',
    causalEffect: null,
    selected: false,
    rank: null,
  };
  return deepFreeze({ ...core, alternativeHash: sha256(core) });
}

function createInformationSet(featureRefIds, evidenceRefIds) {
  const core = {
    featureRefIds: [...featureRefIds].sort(compareCodeUnits),
    evidenceRefIds: [...evidenceRefIds].sort(compareCodeUnits),
  };
  return deepFreeze({ ...core, informationSetHash: sha256(core) });
}

function validateLocalFixtureResultRef(input, name) {
  const value = record(input, [
    'fixtureRecordId',
    'fixtureRevision',
    'fixtureRecordRef',
    'fixtureTruthClass',
    'fixtureRecordHash',
  ], name);
  text(value.fixtureRecordId, `${name}.fixtureRecordId`, 256);
  text(value.fixtureRevision, `${name}.fixtureRevision`, 256);
  text(value.fixtureRecordRef, `${name}.fixtureRecordRef`, 4_096);
  requireModuleFixtureRef(value.fixtureRecordRef, `${name}.fixtureRecordRef`);
  enumValue(value.fixtureTruthClass, ['SYNTHETIC_FIXTURE_REFERENCE', 'UNVERIFIED_RECORDED_SHAPE_REFERENCE'], `${name}.fixtureTruthClass`);
  if (!SHA256_PATTERN.test(value.fixtureRecordHash)) fail('LOCAL_RESULT_HASH_INVALID', `${name}.fixtureRecordHash must be SHA-256`);
  if (value.fixtureRecordHash !== sha256(omitFields(value, ['fixtureRecordHash']))) {
    fail('LOCAL_RESULT_HASH_MISMATCH', `${name}.fixtureRecordHash does not match its local identity`);
  }
  return deepFreeze(cloneCanonical(value));
}

function validateInformationSet(input, expected, name) {
  const value = record(input, ['featureRefIds', 'evidenceRefIds', 'informationSetHash'], name);
  for (const field of ['featureRefIds', 'evidenceRefIds']) {
    if (!Array.isArray(value[field]) || value[field].length > MAX_INFORMATION_REFS) {
      fail('INFORMATION_SET_INVALID', `${name}.${field} must be a bounded array`);
    }
    value[field].forEach((entry, index) => text(entry, `${name}.${field}[${index}]`, 512));
    if (new Set(value[field]).size !== value[field].length
      || value[field].some((entry, index) => index > 0 && compareCodeUnits(value[field][index - 1], entry) >= 0)) {
      fail('INFORMATION_SET_ORDER_INVALID', `${name}.${field} must be sorted and unique`);
    }
  }
  if (!SHA256_PATTERN.test(value.informationSetHash)
    || value.informationSetHash !== sha256(omitFields(value, ['informationSetHash']))) {
    fail('INFORMATION_SET_HASH_INVALID', `${name}.informationSetHash does not match its exact refs`);
  }
  requireCanonicalMatch(value, expected, 'ABLATION_INFORMATION_SET_MISMATCH', `${name} does not prove the required removal set`);
  return deepFreeze(cloneCanonical(value));
}

function createAblationResult(input, context, name) {
  const value = record(input, [
    'state',
    'decisionAction',
    'reasonCodes',
    'resultRef',
    'informationSet',
    'marketPathHash',
    'costAssumptionHash',
  ], name);
  enumValue(value.state, ['AVAILABLE', 'UNAVAILABLE'], `${name}.state`);
  enumValue(value.decisionAction, [
    'IGNORE',
    'WATCH',
    'FOCUS',
    'PROPOSE_CONSIDERATION',
    'ABSTAIN_UNKNOWN',
    'UNAVAILABLE',
  ], `${name}.decisionAction`);
  if (value.marketPathHash !== context.marketPathHash || value.costAssumptionHash !== context.costAssumptionHash) {
    fail('ABLATION_IDENTITY_MISMATCH', `${name} must retain the exact comparison path and costs`);
  }
  const resultRef = value.resultRef === null ? null : validateLocalFixtureResultRef(value.resultRef, `${name}.resultRef`);
  if (value.state === 'AVAILABLE' && (resultRef === null || value.decisionAction === 'UNAVAILABLE')) {
    fail('ABLATION_AVAILABLE_SHAPE_INVALID', `${name} AVAILABLE requires a Q result reference and action`);
  }
  if (value.state === 'UNAVAILABLE' && (resultRef !== null || value.decisionAction !== 'UNAVAILABLE')) {
    fail('ABLATION_UNAVAILABLE_SHAPE_INVALID', `${name} UNAVAILABLE must remain unfilled`);
  }
  return deepFreeze({
    state: value.state,
    decisionAction: value.decisionAction,
    reasonCodes: canonicalReasonCodes(value.reasonCodes, `${name}.reasonCodes`, { allowEmpty: value.state === 'AVAILABLE' }),
    resultRef,
    informationSet: validateInformationSet(value.informationSet, context.expectedInformationSet, `${name}.informationSet`),
    marketPathHash: value.marketPathHash,
    costAssumptionHash: value.costAssumptionHash,
  });
}

function dependenceWarningsFor(decision, removedRefId) {
  const warnings = [];
  const removed = decision.evidenceRefs.find((entry) => entry.ref.fixtureRecordId === removedRefId);
  if (!removed) return warnings;
  if (removed.copyClusterId !== null) {
    const peers = decision.evidenceRefs.filter((entry) => entry.copyClusterId === removed.copyClusterId);
    if (peers.length > 1) warnings.push(`COPIED_SOURCE_CLUSTER:${removed.copyClusterId}`);
  }
  const origins = decision.evidenceRefs.filter((entry) => entry.upstreamOriginId === removed.upstreamOriginId);
  if (origins.length > 1) warnings.push(`SHARED_UPSTREAM_ORIGIN:${removed.upstreamOriginId}`);
  return warnings.sort();
}

function warningCode(dimension, status) {
  const label = dimension.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
  return `${label}_${status}`;
}

export function decisionSourceDependenceWarnings(decision) {
  const warnings = new Set();
  const copyClusters = new Map();
  const origins = new Map();
  for (const evidence of decision.evidenceRefs) {
    if (evidence.copyClusterId !== null) {
      copyClusters.set(evidence.copyClusterId, (copyClusters.get(evidence.copyClusterId) ?? 0) + 1);
    }
    origins.set(evidence.upstreamOriginId, (origins.get(evidence.upstreamOriginId) ?? 0) + 1);
  }
  for (const [cluster, count] of copyClusters) if (count > 1) warnings.add(`COPIED_SOURCE_CLUSTER:${cluster}`);
  for (const [origin, count] of origins) if (count > 1) warnings.add(`SHARED_UPSTREAM_ORIGIN:${origin}`);
  return Object.freeze([...warnings].sort());
}

export function alternativeComparisonStatus(alternative) {
  if (alternative.feasibility.state === 'IMPOSSIBLE_AT_CUTOFF') return 'NOT_COMPARABLE_IMPOSSIBLE_AT_CUTOFF';
  if (alternative.feasibility.state === 'UNKNOWN') return 'ABSTAIN_UNKNOWN_FEASIBILITY';
  if (alternative.outcome.state === 'UNAVAILABLE') return 'ABSTAIN_UNKNOWN_OUTCOME';
  return 'DESCRIPTIVE_PATH_REPLAY';
}

export function decisionLabAlternativeAuthorityProof(alternatives) {
  const counterfactuals = alternatives.filter((entry) => entry.role === 'COUNTERFACTUAL_ALTERNATIVE');
  return deepFreeze({
    counterfactualCount: counterfactuals.length,
    ownerPolicyPayloadAvailableCount: counterfactuals.filter((entry) => entry.ownerEvidenceRef.alternativePolicyPayloadAvailable).length,
    counterfactualPredeclarationProvenCount: counterfactuals.filter((entry) => (
      entry.predeclarationStatus === 'SYNTHETIC_SCENARIO_PREDECLARED'
      && entry.alternativeManifestRef.temporalAuthority === true
    )).length,
    counterfactualOutcomeAvailableCount: counterfactuals.filter((entry) => entry.outcome.state === 'AVAILABLE').length,
    syntheticScenarioMetadataCount: alternatives.filter((entry) => entry.predeclarationStatus === 'SYNTHETIC_SCENARIO_PREDECLARED').length,
    recordedPredeclarationEvidenceUnavailableCount: counterfactuals.filter((entry) => entry.predeclarationStatus === 'RECORDED_EVIDENCE_UNAVAILABLE').length,
    counterfactualEvaluationAuthorized: false,
  });
}

export function decisionLabWarnings(decision, alternatives, ablations) {
  const warnings = new Set([
    'ALTERNATIVES_NOT_OPTIMIZED_OR_RANKED',
    'BIAS_NOT_ELIMINATED',
    'COUNTERFACTUALS_ARE_PATH_CONDITIONAL_HYPOTHESES',
    'DESCRIPTIVE_PATH_REPLAY_NOT_CAUSAL',
    'FINAL_HOLDOUT_NOT_ACCESSED_OR_OPTIMIZED',
    'SINGLE_DECISION_OPE_NOT_APPLICABLE',
  ]);
  for (const [dimension, assessment] of Object.entries(decision.biasAssessment)) {
    warnings.add(warningCode(dimension, assessment.status));
  }
  for (const warning of decisionSourceDependenceWarnings(decision)) warnings.add(warning);
  for (const alternative of alternatives) {
    if (alternative.support.propensityStatus === 'ZERO') warnings.add('ZERO_LOGGING_PROPENSITY_NO_SUPPORT');
    if (alternative.support.propensityStatus === 'UNKNOWN') warnings.add('UNKNOWN_PROPENSITY_NO_OPE');
    if (alternative.outcome.state === 'UNAVAILABLE') warnings.add('ALTERNATIVE_OUTCOME_UNAVAILABLE');
    if (alternative.feasibility.state !== 'POSSIBLE_AT_CUTOFF') warnings.add('ALTERNATIVE_FEASIBILITY_NOT_PROVEN');
  }
  for (const ablation of ablations) {
    if (ablation.variant.state === 'UNAVAILABLE') warnings.add('ABLATION_RESULT_UNAVAILABLE');
    for (const warning of ablation.sourceDependenceWarnings) warnings.add(warning);
  }
  if (decision.disposition === 'MISSED_OPPORTUNITY') warnings.add('MISSED_LABEL_IS_NOT_PROFIT_PROOF');
  return Object.freeze([...warnings].sort());
}

export function decisionLabCutoffProof(decision) {
  return deepFreeze({
    informationCutoffMs: decision.informationCutoffMs,
    latestFeatureAsOfMs: Math.max(...decision.featureRefs.map((entry) => entry.asOfMs)),
    latestFeatureInputEventMs: Math.max(...decision.featureRefs.map((entry) => entry.inputLastEventMs)),
    latestEvidenceEventMs: Math.max(...decision.evidenceRefs.map((entry) => entry.eventTimeMs)),
    latestEvidencePublishedMs: Math.max(...decision.evidenceRefs.map((entry) => entry.publishedTimeMs)),
    latestEvidenceObservedMs: Math.max(...decision.evidenceRefs.map((entry) => entry.observedTimeMs)),
    postCutoffReferenceCount: 0,
    finalHoldoutAccessed: false,
  });
}

export function assertDecisionLabFixtureTruth(value, fixtureClass) {
  assertBoundedStructure(value, 'DecisionLabFixtureTruth');
  if (!['SYNTHETIC_FIXTURE', 'UNVERIFIED_RECORDED_SHAPE_FIXTURE'].includes(fixtureClass)) {
    fail('FIXTURE_CLASS_INVALID', 'DecisionLab fixture truth class is unsupported');
  }
  let syntheticReferenceCount = 0;
  let recordedReferenceCount = 0;
  const visit = (entry) => {
    if (entry === null || typeof entry !== 'object') return;
    if (Object.hasOwn(entry, 'fixtureTruthClass')) {
      if (entry.fixtureTruthClass === 'SYNTHETIC_FIXTURE_REFERENCE') syntheticReferenceCount += 1;
      else if (entry.fixtureTruthClass === 'UNVERIFIED_RECORDED_SHAPE_REFERENCE') recordedReferenceCount += 1;
      else fail('FIXTURE_TRUTH_MISMATCH', `DecisionLab contains unsupported fixture truth ${String(entry.fixtureTruthClass)}`);

      const isBundledSyntheticPolicy = ['Q15ExperimentCardV1', 'ExecutionPolicyCandidate'].includes(entry.contractId);
      if (isBundledSyntheticPolicy && entry.fixtureTruthClass !== 'SYNTHETIC_FIXTURE_REFERENCE') {
        fail('POLICY_FIXTURE_TRUTH_MISMATCH', `${entry.contractId} fixture bytes are synthetic and cannot be relabeled recorded`);
      }
      if (fixtureClass === 'SYNTHETIC_FIXTURE' && entry.fixtureTruthClass !== 'SYNTHETIC_FIXTURE_REFERENCE') {
        fail('FIXTURE_TRUTH_MISMATCH', 'DecisionLab synthetic fixture contains a recorded reference');
      }
      if (fixtureClass === 'UNVERIFIED_RECORDED_SHAPE_FIXTURE'
        && !isBundledSyntheticPolicy
        && entry.contractId !== 'TwinScenarioInput'
        && entry.fixtureTruthClass !== 'UNVERIFIED_RECORDED_SHAPE_REFERENCE') {
        fail('FIXTURE_TRUTH_MISMATCH', 'DecisionLab unverified recorded-shape fixture contains an unclassified reference');
      }
    }
    if (Array.isArray(entry)) entry.forEach(visit);
    else Object.values(entry).forEach(visit);
  };
  visit(value);
  if (syntheticReferenceCount + recordedReferenceCount === 0) {
    fail('FIXTURE_TRUTH_REFERENCE_MISSING', 'DecisionLab report requires explicit fixture truth references');
  }
  if (fixtureClass === 'UNVERIFIED_RECORDED_SHAPE_FIXTURE'
    && (recordedReferenceCount === 0 || syntheticReferenceCount === 0)) {
    fail('RECORDED_FIXTURE_COMPOSITION_INVALID', 'DecisionLab unverified recorded-shape fixture must expose its unverified and synthetic composition');
  }
  return fixtureClass === 'SYNTHETIC_FIXTURE' ? 'SYNTHETIC_ONLY' : 'UNVERIFIED_RECORDED_SHAPE_WITH_SYNTHETIC_METADATA';
}

export function assertRecordedReferenceBoundaries(fixtureClass, decision, alternatives, ablations) {
  if (fixtureClass !== 'UNVERIFIED_RECORDED_SHAPE_FIXTURE') return true;
  if (decision.disposition === 'ACCEPTED') {
    fail('RECORDED_ACCEPTED_REALIZATION_UNSUPPORTED', 'Recorded-reference fixture has no accepted realized owner outcome bytes');
  }
  if (alternatives.some((entry) => entry.outcome.state !== 'UNAVAILABLE')) {
    fail('RECORDED_COUNTERFACTUAL_UNSUPPORTED', 'Unverified recorded-shape outcomes must all remain unavailable');
  }
  if (ablations.some((entry) => entry.baseline.state !== 'UNAVAILABLE' || entry.variant.state !== 'UNAVAILABLE')) {
    fail('RECORDED_ABLATION_UNSUPPORTED', 'Recorded-reference ablation results must remain unavailable');
  }
  return true;
}

export function createAblationComparison(input, context) {
  assertBoundedStructure(input, context.name ?? 'AblationComparisonV1');
  const raw = cloneCanonical(input);
  const name = context.name ?? 'AblationComparisonV1';
  const value = record(raw, [
    'schema',
    'version',
    'ablationId',
    'ablationRevision',
    'kind',
    'predeclarationStatus',
    'predeclaredAtMs',
    'qExperimentEvidenceRef',
    'removedRefId',
    'baseline',
    'variant',
  ], name);
  if (value.schema !== 'AblationComparisonV1' || value.version !== 1) fail('SCHEMA_VERSION_INVALID', `${name} must be V1`);
  text(value.ablationId, `${name}.ablationId`, 256);
  text(value.ablationRevision, `${name}.ablationRevision`, 256);
  enumValue(value.kind, ABLATION_KINDS, `${name}.kind`);
  let predeclaredAtMs = null;
  if (context.fixtureClass === 'SYNTHETIC_FIXTURE') {
    if (value.predeclarationStatus !== 'SYNTHETIC_SCENARIO_PREDECLARED') {
      fail('SYNTHETIC_PREDECLARATION_STATUS_INVALID', `${name} must label its timing as synthetic scenario metadata`);
    }
    predeclaredAtMs = utcMillis(value.predeclaredAtMs, `${name}.predeclaredAtMs`);
    if (predeclaredAtMs > context.decision.informationCutoffMs) fail('NOT_PREDECLARED', `${name} was declared after the simulated information cutoff`);
  } else if (value.predeclarationStatus !== 'RECORDED_EVIDENCE_UNAVAILABLE' || value.predeclaredAtMs !== null) {
    fail('RECORDED_PREDECLARATION_UNSUPPORTED', `${name} has no recorded predeclaration evidence`);
  }
  const qExperimentEvidenceRef = validatePolicyOwnerEvidenceRef(value.qExperimentEvidenceRef, 'Q_ASSISTED', `${name}.qExperimentEvidenceRef`);
  if (value.kind === 'Q_ASSISTED_VS_MARKET_ONLY') {
    if (value.removedRefId !== null) fail('ABLATION_REMOVAL_INVALID', `${name} Q-assisted comparison removes no single ref`);
  } else {
    text(value.removedRefId, `${name}.removedRefId`, 512);
    if (value.kind === 'REMOVE_EVIDENCE_SOURCE'
      && !context.decision.evidenceRefs.some((entry) => entry.ref.fixtureRecordId === value.removedRefId)) {
      fail('ABLATION_SOURCE_REF_MISSING', `${name} removed evidence is not in the information set`);
    }
    if (value.kind === 'REMOVE_FEATURE_FAMILY'
      && !context.decision.featureRefs.some((entry) => entry.featureFamilyId === value.removedRefId)) {
      fail('ABLATION_FEATURE_FAMILY_MISSING', `${name} removed feature family is not in the information set`);
    }
  }
  const resultContext = {
    marketPathHash: context.decision.marketPathRef.fixtureIdentityHash,
    costAssumptionHash: context.decision.costAssumptionRef.fixtureIdentityHash,
  };
  const allFeatureIds = context.decision.featureRefs.map((entry) => entry.ref.fixtureRecordId);
  const allEvidenceIds = context.decision.evidenceRefs.map((entry) => entry.ref.fixtureRecordId);
  const baselineInformationSet = createInformationSet(allFeatureIds, allEvidenceIds);
  let variantInformationSet;
  if (value.kind === 'Q_ASSISTED_VS_MARKET_ONLY') {
    variantInformationSet = createInformationSet(
      context.decision.featureRefs.filter((entry) => entry.informationRole === 'MARKET_ONLY').map((entry) => entry.ref.fixtureRecordId),
      context.decision.evidenceRefs.filter((entry) => entry.informationRole === 'MARKET_ONLY').map((entry) => entry.ref.fixtureRecordId),
    );
  } else if (value.kind === 'REMOVE_EVIDENCE_SOURCE') {
    variantInformationSet = createInformationSet(allFeatureIds, allEvidenceIds.filter((id) => id !== value.removedRefId));
  } else {
    const removedFeature = context.decision.featureRefs.find((entry) => entry.featureFamilyId === value.removedRefId);
    variantInformationSet = createInformationSet(
      allFeatureIds.filter((id) => id !== removedFeature.ref.fixtureRecordId),
      allEvidenceIds,
    );
  }
  const baseline = createAblationResult(
    value.baseline,
    { ...resultContext, expectedInformationSet: baselineInformationSet },
    `${name}.baseline`,
  );
  const variant = createAblationResult(
    value.variant,
    { ...resultContext, expectedInformationSet: variantInformationSet },
    `${name}.variant`,
  );
  const core = {
    schema: 'AblationComparisonV1',
    version: 1,
    ablationId: value.ablationId,
    ablationRevision: value.ablationRevision,
    kind: value.kind,
    predeclarationStatus: value.predeclarationStatus,
    predeclaredAtMs,
    qExperimentEvidenceRef,
    removedRefId: value.removedRefId,
    baseline,
    variant,
    sourceDependenceWarnings: value.kind === 'REMOVE_EVIDENCE_SOURCE'
      ? dependenceWarningsFor(context.decision, value.removedRefId)
      : Object.freeze([]),
    interpretation: 'SENSITIVITY_ONLY_NOT_CAUSAL_CONTRIBUTION',
  };
  return deepFreeze({ ...core, ablationHash: sha256(core) });
}

export function assertAblationBaselineIdentity(ablations) {
  const baselineHashes = new Set(ablations.map((entry) => sha256(entry.baseline)));
  if (baselineHashes.size !== 1) {
    fail('ABLATION_BASELINE_IDENTITY_MISMATCH', 'Every one-at-a-time ablation must use one immutable baseline result and action');
  }
  return true;
}

function validateReportSourceRequest(input, report, decision, alternatives, ablations) {
  const source = record(cloneCanonical(input), [
    'schema',
    'version',
    'requestId',
    'evaluatedAtMs',
    'fixtureClass',
    'decision',
    'alternatives',
    'ablations',
  ], 'DecisionLabReportV1.sourceRequest');
  if (source.schema !== 'DecisionLabRequestV1' || source.version !== 1) {
    fail('REPORT_SOURCE_REQUEST_VERSION_INVALID', 'DecisionLabReportV1 source request must be DecisionLabRequestV1@1');
  }
  if (source.requestId !== report.requestId
    || source.evaluatedAtMs !== report.evaluatedAtMs
    || source.fixtureClass !== report.fixtureClass) {
    fail('REPORT_SOURCE_REQUEST_METADATA_MISMATCH', 'DecisionLabReportV1 metadata must match its immutable source request');
  }
  const sourceDecision = createDecisionEnvelope(source.decision);
  requireCanonicalMatch(sourceDecision, decision, 'REPORT_SOURCE_DECISION_MISMATCH', 'DecisionLabReportV1 decision differs from its source request');
  boundedUnique(source.alternatives, 'DecisionLabReportV1.sourceRequest.alternatives', 2, MAX_ALTERNATIVES, 'alternativeId');
  const alternativeContext = {
    fixtureClass: source.fixtureClass,
    canonicalDecisionRef: sourceDecision.canonicalDecisionRef,
    informationCutoffMs: sourceDecision.informationCutoffMs,
    disposition: sourceDecision.disposition,
    marketPathHash: sourceDecision.marketPathRef.fixtureIdentityHash,
    costAssumptionHash: sourceDecision.costAssumptionRef.fixtureIdentityHash,
  };
  const sourceAlternatives = source.alternatives
    .map((entry, index) => createAlternativeReference(entry, {
      ...alternativeContext,
      name: `DecisionLabReportV1.sourceRequest.alternatives[${index}]`,
    }))
    .sort((left, right) => compareCodeUnits(left.alternativeId, right.alternativeId))
    .map((entry) => deepFreeze({ ...entry, comparisonStatus: alternativeComparisonStatus(entry) }));
  requireCanonicalMatch(sourceAlternatives, alternatives, 'REPORT_SOURCE_ALTERNATIVE_MISMATCH', 'DecisionLabReportV1 alternatives differ from its source request');
  boundedUnique(source.ablations, 'DecisionLabReportV1.sourceRequest.ablations', 3, MAX_ABLATIONS, 'ablationId');
  const sourceAblations = source.ablations
    .map((entry, index) => createAblationComparison(entry, {
      decision: sourceDecision,
      fixtureClass: source.fixtureClass,
      name: `DecisionLabReportV1.sourceRequest.ablations[${index}]`,
    }))
    .sort((left, right) => compareCodeUnits(left.ablationId, right.ablationId));
  requireCanonicalMatch(sourceAblations, ablations, 'REPORT_SOURCE_ABLATION_MISMATCH', 'DecisionLabReportV1 ablations differ from its source request');
}

export function validateDecisionLabReport(input, sourceRequest) {
  assertBoundedStructure(input, 'DecisionLabReportV1');
  if (sourceRequest === null || typeof sourceRequest !== 'object' || Array.isArray(sourceRequest)) {
    fail('REPORT_SOURCE_REQUEST_REQUIRED', 'DecisionLabReportV1 validation requires its full immutable source request');
  }
  assertBoundedStructure(sourceRequest, 'DecisionLabReportV1.sourceRequest');
  const value = record(cloneCanonical(input), REPORT_FIELDS, 'DecisionLabReportV1');
  if (
    value.schema !== 'DecisionLabReportV1'
    || value.version !== 1
    || value.contractVersion !== DECISION_LAB_CONTRACT_VERSION
    || value.evaluationMode !== 'DESCRIPTIVE_PATH_REPLAY'
    || value.truthClass !== 'ADVISORY'
    || value.networkMode !== 'FIXTURE_ONLY'
    || value.authorityClass !== 'NO_AUTHORITY'
    || value.canonical !== false
    || value.causalClaimStatus !== 'NOT_IDENTIFIED'
    || value.causalEffect !== null
    || value.winner !== null
    || value.profitClaim !== false
  ) fail('REPORT_BOUNDARY_INVALID', 'DecisionLabReportV1 widened its fixture-only descriptive boundary');
  text(value.requestId, 'DecisionLabReportV1.requestId', 256);
  utcMillis(value.evaluatedAtMs, 'DecisionLabReportV1.evaluatedAtMs');
  enumValue(value.fixtureClass, ['SYNTHETIC_FIXTURE', 'UNVERIFIED_RECORDED_SHAPE_FIXTURE'], 'DecisionLabReportV1.fixtureClass');
  const expectedFixtureComposition = value.fixtureClass === 'SYNTHETIC_FIXTURE'
    ? 'SYNTHETIC_ONLY'
    : 'UNVERIFIED_RECORDED_SHAPE_WITH_SYNTHETIC_METADATA';
  if (value.fixtureComposition !== expectedFixtureComposition) {
    fail('REPORT_FIXTURE_COMPOSITION_INVALID', 'DecisionLabReportV1 fixture composition must expose mixed recorded and synthetic fixtures');
  }
  const expectedTruthLabel = value.fixtureClass === 'SYNTHETIC_FIXTURE' ? 'SYNTHETIC_ONLY' : 'UNVERIFIED_RECORDED_SHAPE_ONLY';
  if (value.truthLabel !== expectedTruthLabel) fail('REPORT_TRUTH_LABEL_INVALID', 'DecisionLabReportV1 truth label must match its fixture class');

  const decisionOutputFields = [
    'schema',
    'version',
    'disposition',
    'decisionTimeMs',
    'informationCutoffMs',
    'canonicalDecisionRef',
    'qExperimentRef',
    'marketPathRef',
    'costAssumptionRef',
    'featureRefs',
    'evidenceRefs',
    'biasAssessment',
    'decisionContextId',
    'decisionHash',
  ];
  const decisionValue = record(value.decision, decisionOutputFields, 'DecisionLabReportV1.decision');
  const decision = createDecisionEnvelope(omitFields(decisionValue, ['decisionContextId', 'decisionHash']));
  requireCanonicalMatch(decisionValue, decision, 'REPORT_DECISION_INVALID', 'DecisionLabReportV1 decision does not match its validated immutable envelope');
  if (value.evaluatedAtMs < decision.decisionTimeMs) fail('REPORT_EVALUATION_BEFORE_DECISION', 'DecisionLabReportV1 cannot precede its decision');

  boundedUnique(value.alternatives, 'DecisionLabReportV1.alternatives', 2, MAX_ALTERNATIVES, 'alternativeId');
  const alternativeContext = {
    fixtureClass: value.fixtureClass,
    canonicalDecisionRef: decision.canonicalDecisionRef,
    informationCutoffMs: decision.informationCutoffMs,
    disposition: decision.disposition,
    marketPathHash: decision.marketPathRef.fixtureIdentityHash,
    costAssumptionHash: decision.costAssumptionRef.fixtureIdentityHash,
  };
  const alternatives = value.alternatives.map((inputAlternative, index) => {
    const name = `DecisionLabReportV1.alternatives[${index}]`;
    const alternativeValue = record(inputAlternative, PROJECTED_ALTERNATIVE_FIELDS, name);
    const support = record(alternativeValue.support, [
      'propensityStatus',
      'supportStatus',
      'loggingPropensity',
      'targetPropensity',
      'importanceWeight',
      'opeEligibility',
    ], `${name}.support`);
    const outcome = record(alternativeValue.outcome, [
      'schema',
      'version',
      'outcomeId',
      'outcomeRevision',
      'outcomeAttributionRef',
      'state',
      'realizationClass',
      'positionTaken',
      'marketPathHash',
      'costAssumptionHash',
      'mfePct',
      'maePct',
      'timeInExposureMs',
      'realizedCost',
      'hypotheticalCost',
      'residualLiability',
      'uncertainty',
      'outcomeHash',
    ], `${name}.outcome`);
    const raw = {
      ...omitFields(alternativeValue, [
        'ownerEvidenceStatus',
        'causalClaimStatus',
        'causalEffect',
        'selected',
        'rank',
        'alternativeHash',
        'comparisonStatus',
      ]),
      support: omitFields(support, ['importanceWeight', 'opeEligibility']),
      outcome: omitFields(outcome, ['outcomeHash']),
    };
    const rebuilt = createAlternativeReference(raw, { ...alternativeContext, name });
    const expected = deepFreeze({ ...rebuilt, comparisonStatus: alternativeComparisonStatus(rebuilt) });
    requireCanonicalMatch(alternativeValue, expected, 'REPORT_ALTERNATIVE_INVALID', `${name} contains unvalidated or authority-widening state`);
    return expected;
  });
  if (alternatives.filter((alternative) => alternative.role === 'OBSERVED_DECISION').length !== 1) {
    fail('REPORT_OBSERVED_DECISION_CARDINALITY', 'DecisionLabReportV1 requires exactly one observed decision');
  }
  const alternativeIds = alternatives.map((alternative) => alternative.alternativeId);
  if (alternativeIds.some((id, index) => index > 0 && compareCodeUnits(alternativeIds[index - 1], id) >= 0)) {
    fail('REPORT_ALTERNATIVE_ORDER_INVALID', 'DecisionLabReportV1 alternatives must use canonical code-unit order');
  }
  const alternativeKinds = [...new Set(alternatives.map((alternative) => alternative.kind))].sort(compareCodeUnits);
  if (sha256(alternativeKinds) !== sha256([...ALTERNATIVE_KINDS].sort(compareCodeUnits))) {
    fail('REPORT_ALTERNATIVE_COVERAGE_INCOMPLETE', 'DecisionLabReportV1 requires all seven alternative kinds');
  }

  boundedUnique(value.ablations, 'DecisionLabReportV1.ablations', 3, MAX_ABLATIONS, 'ablationId');
  const ablations = value.ablations.map((inputAblation, index) => {
    const name = `DecisionLabReportV1.ablations[${index}]`;
    const ablationValue = record(inputAblation, PROJECTED_ABLATION_FIELDS, name);
    const raw = omitFields(ablationValue, ['sourceDependenceWarnings', 'interpretation', 'ablationHash']);
    const expected = createAblationComparison(raw, { decision, fixtureClass: value.fixtureClass, name });
    requireCanonicalMatch(ablationValue, expected, 'REPORT_ABLATION_INVALID', `${name} contains unvalidated or authority-widening state`);
    return expected;
  });
  const ablationIds = ablations.map((ablation) => ablation.ablationId);
  if (ablationIds.some((id, index) => index > 0 && compareCodeUnits(ablationIds[index - 1], id) >= 0)) {
    fail('REPORT_ABLATION_ORDER_INVALID', 'DecisionLabReportV1 ablations must use canonical code-unit order');
  }
  const qComparisons = ablations.filter((ablation) => ablation.kind === 'Q_ASSISTED_VS_MARKET_ONLY');
  const sourceRemovals = ablations.filter((ablation) => ablation.kind === 'REMOVE_EVIDENCE_SOURCE').map((entry) => entry.removedRefId).sort(compareCodeUnits);
  const familyRemovals = ablations.filter((ablation) => ablation.kind === 'REMOVE_FEATURE_FAMILY').map((entry) => entry.removedRefId).sort(compareCodeUnits);
  const expectedSources = decision.evidenceRefs.map((entry) => entry.ref.fixtureRecordId).sort(compareCodeUnits);
  const expectedFamilies = decision.featureRefs.map((entry) => entry.featureFamilyId).sort(compareCodeUnits);
  if (
    qComparisons.length !== 1
    || sha256(sourceRemovals) !== sha256(expectedSources)
    || sha256(familyRemovals) !== sha256(expectedFamilies)
  ) fail('REPORT_ABLATION_COVERAGE_INCOMPLETE', 'DecisionLabReportV1 requires complete one-at-a-time source and feature-family ablations');
  assertAblationBaselineIdentity(ablations);
  validateReportSourceRequest(sourceRequest, value, decision, alternatives, ablations);
  const fixtureComposition = assertDecisionLabFixtureTruth({ decision, alternatives, ablations }, value.fixtureClass);
  if (fixtureComposition !== value.fixtureComposition) {
    fail('REPORT_FIXTURE_COMPOSITION_INVALID', 'DecisionLabReportV1 fixture composition does not match its references');
  }
  assertRecordedReferenceBoundaries(value.fixtureClass, decision, alternatives, ablations);

  requireCanonicalMatch(value.comparisonRules, {
    identicalMarketPathRequired: true,
    identicalCostAssumptionRequired: true,
    alternativesPredeclaredRequired: true,
    ownerPolicyPayloadRequiredForCounterfactualEvaluation: true,
    recordedPredeclarationEvidenceRequiredForCounterfactualEvaluation: true,
    syntheticScenarioMetadataIsTemporalEvidence: false,
    policiesEvaluatedOrSelectedByDecisionLab: false,
    postOutcomeFeatureAccessAllowed: false,
    strategyTournamentAllowed: false,
  }, 'REPORT_COMPARISON_RULES_INVALID', 'DecisionLabReportV1 comparison rules widened authority');
  requireCanonicalMatch(value.identityProof, {
    marketPathHash: decision.marketPathRef.fixtureIdentityHash,
    costAssumptionHash: decision.costAssumptionRef.fixtureIdentityHash,
    alternativesWithMatchingPath: alternatives.length,
    alternativesWithMatchingCosts: alternatives.length,
    ablationsWithMatchingPathAndCosts: ablations.length,
  }, 'REPORT_IDENTITY_PROOF_INVALID', 'DecisionLabReportV1 identity proof does not match validated comparisons');
  requireCanonicalMatch(value.cutoffProof, decisionLabCutoffProof(decision), 'REPORT_CUTOFF_PROOF_INVALID', 'DecisionLabReportV1 cutoff proof does not match its immutable information set');
  requireCanonicalMatch(
    value.sourceDependenceWarnings,
    decisionSourceDependenceWarnings(decision),
    'REPORT_SOURCE_WARNING_INVALID',
    'DecisionLabReportV1 source-dependence warnings are incomplete or altered',
  );
  requireCanonicalMatch(
    value.warnings,
    decisionLabWarnings(decision, alternatives, ablations),
    'REPORT_WARNING_INVALID',
    'DecisionLabReportV1 warnings are incomplete or altered',
  );
  requireCanonicalMatch(value.summary, {
    decisionDisposition: decision.disposition,
    alternativeCount: alternatives.length,
    descriptiveComparisonCount: alternatives.filter((entry) => entry.comparisonStatus === 'DESCRIPTIVE_PATH_REPLAY').length,
    unavailableAlternativeCount: alternatives.filter((entry) => entry.outcome.state === 'UNAVAILABLE').length,
    ablationCount: ablations.length,
    unavailableAblationCount: ablations.filter((entry) => entry.variant.state === 'UNAVAILABLE').length,
  }, 'REPORT_SUMMARY_INVALID', 'DecisionLabReportV1 summary does not match validated records');
  requireCanonicalMatch(
    value.alternativeAuthorityProof,
    decisionLabAlternativeAuthorityProof(alternatives),
    'REPORT_ALTERNATIVE_AUTHORITY_PROOF_INVALID',
    'DecisionLabReportV1 alternative authority proof does not match unavailable owner policy and temporal evidence',
  );
  requireCanonicalMatch(value.ownerBoundaryProof, {
    qExperimentRegistryWritten: false,
    qFeatureOrOutcomeComputed: false,
    lExecutionPolicyEvaluatorInvoked: false,
    lPolicySelected: false,
    lExchangeTwinExecuted: false,
    capitalOrRiskDecisionMade: false,
    orderIssued: false,
    externalMutationPerformed: false,
  }, 'REPORT_OWNER_BOUNDARY_INVALID', 'DecisionLabReportV1 cannot claim an owner action or mutation');
  requireCanonicalMatch(
    value.limitations,
    DECISION_LAB_LIMITATIONS,
    'REPORT_LIMITATIONS_INVALID',
    'DecisionLabReportV1 limitations are incomplete or altered',
  );

  validateFixtureOutput(value);
  const core = omitFields(value, ['reportId', 'reportHash']);
  const expected = sha256(core);
  if (value.reportHash !== expected || value.reportId !== `dl_report_${expected}`) {
    fail('REPORT_HASH_MISMATCH', 'DecisionLabReportV1 identity does not match canonical report bytes');
  }
  return true;
}
