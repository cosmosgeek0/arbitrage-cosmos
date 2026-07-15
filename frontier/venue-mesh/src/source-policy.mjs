import { sha256 } from '../../dock/src/index.mjs';
import {
  arrayValue,
  asRecord,
  boundedString,
  deepFreeze,
  enumValue,
  exactFields,
  safeInteger,
  utcMillis,
} from './guards.mjs';
import { assertObservationBoundary } from './boundary.mjs';
import { fail } from './errors.mjs';

export const SOURCE_GATE_ORDER = Object.freeze([
  'OFFICIAL_OR_LICENSED_ACCESS',
  'STABLE_IDENTITY_MAPPING',
  'TIMESTAMP_SEQUENCE_SEMANTICS',
  'RETENTION_PERMISSION',
  'RESOURCE_RATE_BUDGET',
  'EXPLICIT_HYPOTHESIS_VALUE',
  'CANONICAL_PRODUCER_OWNERSHIP',
  'OBSERVABLE_FAILURE_STATE',
]);

function validateDigest(value, field) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail('SHA256_INVALID', `${field} must be lowercase SHA-256`);
  return value;
}

export function validateSourceCardEnvelope(envelope) {
  asRecord(envelope, 'VenueSourceCardEnvelopeV1');
  exactFields(envelope, ['schema', 'version', 'dataSourceCard', 'sourcePolicy', 'authorityClass', 'networkMode', 'admissionAuthority'], 'VenueSourceCardEnvelopeV1');
  assertObservationBoundary(envelope);
  if (envelope.schema !== 'VenueSourceCardEnvelopeV1' || envelope.version !== 1) fail('SOURCE_CARD_ENVELOPE_SCHEMA_INVALID', 'source card envelope must be V1');
  const card = asRecord(envelope.dataSourceCard, 'dataSourceCard');
  exactFields(card, [
    'schema', 'version', 'sourceId', 'contractRevision', 'evaluatedAtMs',
    'incrementalValueSummary', 'historicalCoverageSummary', 'liveCoverageSummary',
    'expectedLatencySummary', 'outageCompletenessSummary', 'disposition', 'gates',
    'hypothesisIds', 'canonicalProducerOwner', 'failureStateCodes',
  ], 'dataSourceCard');
  if (card.schema !== 'DataSourceCardV1' || card.version !== 1) fail('SOURCE_CARD_SCHEMA_INVALID', 'embedded source card must be Q DataSourceCardV1');
  for (const field of ['sourceId', 'contractRevision', 'incrementalValueSummary', 'historicalCoverageSummary', 'liveCoverageSummary', 'expectedLatencySummary', 'outageCompletenessSummary', 'disposition']) {
    boundedString(card[field], `dataSourceCard.${field}`, 1_024);
  }
  utcMillis(card.evaluatedAtMs, 'dataSourceCard.evaluatedAtMs');
  if (card.canonicalProducerOwner !== null) boundedString(card.canonicalProducerOwner, 'dataSourceCard.canonicalProducerOwner', 128);
  arrayValue(card.gates, 'dataSourceCard.gates', { minimum: 8, maximum: 8 });
  card.gates.forEach((gate, index) => {
    asRecord(gate, `dataSourceCard.gates[${index}]`);
    exactFields(gate, ['schema', 'version', 'gate', 'evidenceDigests', 'evidenceSummary'], `dataSourceCard.gates[${index}]`);
    if (gate.schema !== 'SourceGateEvidenceV1' || gate.version !== 1 || gate.gate !== SOURCE_GATE_ORDER[index]) {
      fail('SOURCE_GATE_ORDER_INVALID', 'source card gates must use the exact Q order');
    }
    arrayValue(gate.evidenceDigests, `dataSourceCard.gates[${index}].evidenceDigests`, { maximum: 32 });
    gate.evidenceDigests.forEach((digest, digestIndex) => validateDigest(digest, `dataSourceCard.gates[${index}].evidenceDigests[${digestIndex}]`));
    const sorted = [...new Set(gate.evidenceDigests)].sort();
    if (sorted.length !== gate.evidenceDigests.length || sorted.some((digest, digestIndex) => digest !== gate.evidenceDigests[digestIndex])) {
      fail('SOURCE_GATE_DIGEST_ORDER_INVALID', 'gate evidence digests must be sorted and unique');
    }
    boundedString(gate.evidenceSummary, `dataSourceCard.gates[${index}].evidenceSummary`, 1_024);
  });
  for (const field of ['hypothesisIds', 'failureStateCodes']) {
    arrayValue(card[field], `dataSourceCard.${field}`, { maximum: 64 });
    if (card[field].some((value) => typeof value !== 'string')) fail('SOURCE_CARD_ARRAY_INVALID', `dataSourceCard.${field} must contain strings`);
  }
  enumValue(card.disposition, ['ADOPT', 'ADAPT', 'REFERENCE_ONLY', 'REJECT'], 'dataSourceCard.disposition');
  const policy = asRecord(envelope.sourcePolicy, 'sourcePolicy');
  exactFields(policy, [
    'owner', 'upstreamOrigin', 'endpointClass', 'accessMethod', 'termsUrl',
    'termsContentSha256', 'documentationContentSha256', 'authenticationRequirement',
    'geography', 'documentationExampleUse', 'reviewedAtMs', 'nextReviewAtMs',
    'retentionPermission', 'redistributionPermission',
  ], 'sourcePolicy');
  for (const field of ['owner', 'upstreamOrigin', 'endpointClass', 'accessMethod', 'termsUrl', 'authenticationRequirement', 'geography', 'documentationExampleUse']) {
    boundedString(policy[field], `sourcePolicy.${field}`, field === 'termsUrl' ? 2_048 : 512);
  }
  if (!/^https:\/\//.test(policy.termsUrl)) fail('SOURCE_TERMS_URL_INVALID', 'source terms URL must be HTTPS');
  if (policy.termsContentSha256 !== null) validateDigest(policy.termsContentSha256, 'sourcePolicy.termsContentSha256');
  validateDigest(policy.documentationContentSha256, 'sourcePolicy.documentationContentSha256');
  utcMillis(policy.reviewedAtMs, 'sourcePolicy.reviewedAtMs');
  utcMillis(policy.nextReviewAtMs, 'sourcePolicy.nextReviewAtMs');
  if (policy.nextReviewAtMs <= policy.reviewedAtMs) fail('SOURCE_REVIEW_WINDOW_INVALID', 'next source review must follow reviewedAtMs');
  enumValue(policy.retentionPermission, ['PERMITTED', 'PROHIBITED', 'REVIEW_REQUIRED', 'UNKNOWN'], 'sourcePolicy.retentionPermission');
  enumValue(policy.redistributionPermission, ['PERMITTED', 'PROHIBITED', 'REVIEW_REQUIRED', 'UNKNOWN'], 'sourcePolicy.redistributionPermission');
  if (envelope.authorityClass !== 'NO_AUTHORITY' || envelope.networkMode !== 'FIXTURE_ONLY' || envelope.admissionAuthority !== 'NONE') {
    fail('SOURCE_CARD_AUTHORITY_WIDENING', 'source card envelope is review-only, fixture-only, and non-authoritative');
  }
  return true;
}

export function evaluateSourceCard(envelope, {
  expectedCanonicalProducerOwner,
  evaluatedAtMs,
  observedTermsContentSha256 = envelope?.sourcePolicy?.termsContentSha256,
} = {}) {
  validateSourceCardEnvelope(envelope);
  boundedString(expectedCanonicalProducerOwner, 'expectedCanonicalProducerOwner', 128);
  utcMillis(evaluatedAtMs, 'source review.evaluatedAtMs');
  if (observedTermsContentSha256 !== null) validateDigest(observedTermsContentSha256, 'observedTermsContentSha256');
  const failed = new Set(envelope.dataSourceCard.gates.filter((gate) => gate.evidenceDigests.length === 0).map((gate) => gate.gate));
  if (envelope.dataSourceCard.hypothesisIds.length === 0) failed.add('EXPLICIT_HYPOTHESIS_VALUE');
  if (envelope.dataSourceCard.canonicalProducerOwner !== expectedCanonicalProducerOwner) failed.add('CANONICAL_PRODUCER_OWNERSHIP');
  if (envelope.dataSourceCard.failureStateCodes.length === 0) failed.add('OBSERVABLE_FAILURE_STATE');
  const evaluatedBeforeReview = evaluatedAtMs < envelope.dataSourceCard.evaluatedAtMs
    || evaluatedAtMs < envelope.sourcePolicy.reviewedAtMs;
  if (evaluatedBeforeReview) {
    failed.add('OFFICIAL_OR_LICENSED_ACCESS');
    failed.add('RETENTION_PERMISSION');
  }
  const termsExpired = evaluatedAtMs >= envelope.sourcePolicy.nextReviewAtMs;
  const termsChanged = envelope.sourcePolicy.termsContentSha256 === null
    || observedTermsContentSha256 === null
    || envelope.sourcePolicy.termsContentSha256 !== observedTermsContentSha256;
  if (termsExpired || termsChanged || envelope.sourcePolicy.retentionPermission !== 'PERMITTED') failed.add('RETENTION_PERMISSION');
  if (termsExpired) failed.add('OFFICIAL_OR_LICENSED_ACCESS');
  const failedGateCodes = SOURCE_GATE_ORDER.filter((gate) => failed.has(gate));
  const documentationFixtureEligible = !termsExpired
    && !termsChanged
    && !evaluatedBeforeReview
    && envelope.sourcePolicy.documentationExampleUse === 'PINNED_SCHEMA_FIXTURE_ONLY'
    && /^[a-f0-9]{64}$/.test(envelope.sourcePolicy.documentationContentSha256);
  return deepFreeze({
    schema: 'VenueSourceCardReviewV1',
    sourceId: envelope.dataSourceCard.sourceId,
    cardHash: sha256(envelope.dataSourceCard),
    status: failedGateCodes.length === 0 ? 'ELIGIBLE_FOR_LATER_REVIEW' : 'INELIGIBLE',
    failedGateCodes,
    termsExpired,
    termsChanged,
    evaluatedBeforeReview,
    marketDataRetentionEligible: failedGateCodes.length === 0,
    documentationFixtureEligibility: documentationFixtureEligible ? 'PINNED_SCHEMA_FIXTURE_ONLY' : 'INELIGIBLE',
    redistributionAllowed: envelope.sourcePolicy.redistributionPermission === 'PERMITTED',
    authorityPosture: 'REVIEW_ONLY_NO_ADMISSION',
    canonicalSourceStateWritten: false,
  });
}

export function createSourceCardEnvelope(input) {
  const record = {
    ...input,
    schema: 'VenueSourceCardEnvelopeV1',
    version: 1,
    authorityClass: 'NO_AUTHORITY',
    networkMode: 'FIXTURE_ONLY',
    admissionAuthority: 'NONE',
  };
  validateSourceCardEnvelope(record);
  return deepFreeze(record);
}

export function materializeReviewOnlySourceCard({
  sourceId,
  contractRevision,
  evaluatedAtMs,
  canonicalProducerOwner,
  hypothesisIds,
  failureStateCodes,
  gateEvidenceDigests,
  sourcePolicy,
}) {
  boundedString(sourceId, 'source card input.sourceId', 128);
  boundedString(contractRevision, 'source card input.contractRevision', 128);
  utcMillis(evaluatedAtMs, 'source card input.evaluatedAtMs');
  boundedString(canonicalProducerOwner, 'source card input.canonicalProducerOwner', 128);
  arrayValue(hypothesisIds, 'source card input.hypothesisIds', { minimum: 1, maximum: 64 });
  arrayValue(failureStateCodes, 'source card input.failureStateCodes', { minimum: 1, maximum: 64 });
  asRecord(gateEvidenceDigests, 'source card input.gateEvidenceDigests');
  asRecord(sourcePolicy, 'source card input.sourcePolicy');
  const gates = SOURCE_GATE_ORDER.map((gate) => {
    const digests = gateEvidenceDigests[gate] ?? [];
    arrayValue(digests, `source card input.gateEvidenceDigests.${gate}`, { maximum: 32 });
    const normalized = [...new Set(digests.map((digest, index) => validateDigest(digest, `source card input.gateEvidenceDigests.${gate}[${index}]`)))].sort();
    return {
      schema: 'SourceGateEvidenceV1',
      version: 1,
      gate,
      evidenceDigests: normalized,
      evidenceSummary: normalized.length === 0
        ? `${gate} is not proven; review remains fail-closed.`
        : `${gate} has pinned fixture-review evidence only.`,
    };
  });
  return createSourceCardEnvelope({
    dataSourceCard: {
      schema: 'DataSourceCardV1',
      version: 1,
      sourceId,
      contractRevision,
      evaluatedAtMs,
      incrementalValueSummary: 'Read-only additional-venue fixture evidence for cross-venue hypothesis review.',
      historicalCoverageSummary: 'No historical capture or retention is implemented.',
      liveCoverageSummary: 'No live transport is implemented; documentation-derived fixtures only.',
      expectedLatencySummary: 'Deterministic fixture steps only; no production latency claim.',
      outageCompletenessSummary: 'Missing, stale, gapped, maintenance, and rate-limit states fail closed.',
      disposition: 'REFERENCE_ONLY',
      gates,
      hypothesisIds: [...new Set(hypothesisIds)].sort(),
      canonicalProducerOwner,
      failureStateCodes: [...new Set(failureStateCodes)].sort(),
    },
    sourcePolicy,
  });
}
