import { sha256 } from '../../dock/src/index.mjs';
import {
  asRecord,
  boundedString,
  deepFreeze,
  enumValue,
  exactFields,
  safeInteger,
  utcMillis,
} from './guards.mjs';
import { assertObservationBoundary } from './boundary.mjs';
import { decimalToMantissa, mantissaToDecimal } from './decimal.mjs';
import { fail } from './errors.mjs';

export const PAYLOAD_KINDS = Object.freeze([
  'TRADE',
  'BOOK_TICKER',
  'BOOK_SNAPSHOT',
  'BOOK_DELTA',
  'MARK',
  'INDEX',
  'FUNDING',
  'OPEN_INTEREST',
  'LIQUIDATION',
  'CONTEXT',
]);

export const PAYLOAD_FIELDS_BY_KIND = Object.freeze({
  TRADE: Object.freeze(['tradeId', 'price', 'size', 'makerSide']),
  BOOK_TICKER: Object.freeze(['bidPrice', 'askPrice', 'bidSize', 'askSize', 'availability']),
  BOOK_SNAPSHOT: Object.freeze(['bids', 'asks', 'checksum', 'integrityState']),
  BOOK_DELTA: Object.freeze(['bids', 'asks', 'checksum', 'integrityState']),
  MARK: Object.freeze(['markPrice']),
  INDEX: Object.freeze(['indexPrice']),
  FUNDING: Object.freeze(['fundingRate']),
  OPEN_INTEREST: Object.freeze(['openInterest']),
  LIQUIDATION: Object.freeze(['price', 'size', 'side']),
  CONTEXT: Object.freeze(['contextId', 'contextClass', 'status', 'provenanceRef']),
});

const UTC_MIN_MS = 1_262_304_000_000;
const UTC_MAX_MS = 4_102_444_800_000;

function protocolUtcMillis(value, field) {
  utcMillis(value, field);
  return safeInteger(value, field, { minimum: UTC_MIN_MS, maximum: UTC_MAX_MS });
}

function idString(value, field) {
  boundedString(value, field, 128);
  if (!/^[A-Za-z0-9_.:\-]{1,128}$/.test(value)) fail('PROTOCOL_ID_INVALID', `${field} is not an edge-protocol identifier`);
  return value;
}

function hashHex(value, field) {
  if (typeof value !== 'string' || !/^[a-f0-9]{16,128}$/.test(value)) fail('PROTOCOL_HASH_INVALID', `${field} must be lowercase hex`);
  return value;
}

function canonicalDecimal(value, field, { allowNegative = false, positive = false } = {}) {
  const mantissa = decimalToMantissa(value, field, { allowNegative });
  if (mantissaToDecimal(mantissa) !== value) fail('EVIDENCE_DECIMAL_NOT_CANONICAL', `${field} must be canonical decimal text`);
  if (positive && mantissa <= 0n) fail('EVIDENCE_DECIMAL_NOT_POSITIVE', `${field} must be positive`);
  return mantissa;
}

function validateLevels(levels, field) {
  if (!Array.isArray(levels) || levels.length === 0 || levels.length > 1_000) fail('EVIDENCE_BOOK_LEVELS_INVALID', `${field} must contain bounded levels`);
  return levels.map((level, index) => {
    if (!Array.isArray(level) || level.length !== 2) fail('EVIDENCE_BOOK_LEVEL_INVALID', `${field}[${index}] must contain price and quantity`);
    return [
      canonicalDecimal(level[0], `${field}[${index}].price`, { positive: true }),
      canonicalDecimal(level[1], `${field}[${index}].quantity`, { positive: true }),
    ];
  });
}

function validatePayload(payloadKind, payload, quality) {
  const scalar = (field, options) => canonicalDecimal(payload[field], `evidence.payload.${field}`, options);
  if (payloadKind === 'BOOK_TICKER') {
    exactFields(payload, PAYLOAD_FIELDS_BY_KIND.BOOK_TICKER, 'evidence.payload.BOOK_TICKER');
    const bid = scalar('bidPrice', { positive: true });
    const ask = scalar('askPrice', { positive: true });
    if (bid >= ask) fail('EVIDENCE_BOOK_CROSSED', 'book ticker bid must be below ask');
    if (payload.bidSize !== null) scalar('bidSize', { positive: true });
    if (payload.askSize !== null) scalar('askSize', { positive: true });
    enumValue(payload.availability, ['AVAILABLE'], 'evidence.payload.availability');
    if (quality.completeness === 'COMPLETE' && (payload.bidSize === null || payload.askSize === null)) fail('EVIDENCE_COMPLETENESS_OVERCLAIM', 'complete book ticker requires both sizes');
    return;
  }
  if (payloadKind === 'TRADE') {
    exactFields(payload, PAYLOAD_FIELDS_BY_KIND.TRADE, 'evidence.payload.TRADE');
    idString(payload.tradeId, 'evidence.payload.tradeId');
    scalar('price', { positive: true });
    scalar('size', { positive: true });
    enumValue(payload.makerSide, ['BUY', 'SELL'], 'evidence.payload.makerSide');
    return;
  }
  if (['BOOK_SNAPSHOT', 'BOOK_DELTA'].includes(payloadKind)) {
    exactFields(payload, PAYLOAD_FIELDS_BY_KIND[payloadKind], `evidence.payload.${payloadKind}`);
    const bids = validateLevels(payload.bids, 'evidence.payload.bids');
    const asks = validateLevels(payload.asks, 'evidence.payload.asks');
    boundedString(payload.checksum, 'evidence.payload.checksum', 128);
    enumValue(payload.integrityState, ['CHECKSUM_VERIFIED', 'CHECKSUM_UNVERIFIED_FIXTURE'], 'evidence.payload.integrityState');
    if (quality.completeness === 'COMPLETE' && payload.integrityState !== 'CHECKSUM_VERIFIED') fail('EVIDENCE_COMPLETENESS_OVERCLAIM', 'complete book evidence requires verified integrity');
    if (bids[0][0] >= asks[0][0]) fail('EVIDENCE_BOOK_CROSSED', 'book best bid must be below best ask');
    return;
  }
  const singleField = {
    MARK: ['markPrice', { positive: true }],
    INDEX: ['indexPrice', { positive: true }],
    FUNDING: ['fundingRate', { allowNegative: true }],
    OPEN_INTEREST: ['openInterest', {}],
  }[payloadKind];
  if (singleField !== undefined) {
    exactFields(payload, PAYLOAD_FIELDS_BY_KIND[payloadKind], `evidence.payload.${payloadKind}`);
    scalar(singleField[0], singleField[1]);
    return;
  }
  if (payloadKind === 'LIQUIDATION') {
    exactFields(payload, PAYLOAD_FIELDS_BY_KIND.LIQUIDATION, 'evidence.payload.LIQUIDATION');
    scalar('price', { positive: true });
    scalar('size', { positive: true });
    enumValue(payload.side, ['BUY', 'SELL'], 'evidence.payload.side');
    return;
  }
  if (payloadKind === 'CONTEXT') {
    exactFields(payload, PAYLOAD_FIELDS_BY_KIND.CONTEXT, 'evidence.payload.CONTEXT');
    for (const field of ['contextId', 'contextClass', 'status', 'provenanceRef']) boundedString(payload[field], `evidence.payload.${field}`, 2_048);
    return;
  }
  fail('EVIDENCE_PAYLOAD_KIND_UNIMPLEMENTED', `${payloadKind} payload validation is not implemented`);
}

export function validateMarketEvidenceEnvelope(envelope) {
  asRecord(envelope, 'MarketEvidenceEnvelopeV1');
  exactFields(envelope, [
    'schema', 'version', 'revision', 'evidenceId', 'traceId', 'instrumentGraph',
    'exchangeEventTimeMs', 'localReceiveTimeMs', 'normalizationTimeMs', 'featureCutoffTimeMs',
    'source', 'rawPayloadHash', 'normalizedSchemaHash', 'truthLabel', 'quality', 'payloadKind', 'payload',
  ], 'MarketEvidenceEnvelopeV1');
  if (envelope.schema !== 'MarketEvidenceEnvelopeV1' || envelope.version !== 1 || envelope.revision !== 0) {
    fail('EVIDENCE_SCHEMA_INVALID', 'evidence must be MarketEvidenceEnvelopeV1 revision 0');
  }
  idString(envelope.evidenceId, 'evidence.evidenceId');
  idString(envelope.traceId, 'evidence.traceId');
  asRecord(envelope.instrumentGraph, 'evidence.instrumentGraph');
  exactFields(envelope.instrumentGraph, ['venue', 'product', 'symbol', 'canonicalAsset', 'spotSymbol', 'perpSymbol', 'borrowAsset', 'missingLegReason'], 'evidence.instrumentGraph');
  for (const field of ['venue', 'product', 'symbol', 'canonicalAsset']) boundedString(envelope.instrumentGraph[field], `evidence.instrumentGraph.${field}`, 256);
  enumValue(envelope.instrumentGraph.product, ['SPOT', 'USDM_PERP', 'MARGIN'], 'evidence.instrumentGraph.product');
  if (envelope.exchangeEventTimeMs !== null) protocolUtcMillis(envelope.exchangeEventTimeMs, 'evidence.exchangeEventTimeMs');
  protocolUtcMillis(envelope.localReceiveTimeMs, 'evidence.localReceiveTimeMs');
  protocolUtcMillis(envelope.normalizationTimeMs, 'evidence.normalizationTimeMs');
  if (envelope.featureCutoffTimeMs !== null) protocolUtcMillis(envelope.featureCutoffTimeMs, 'evidence.featureCutoffTimeMs');
  if (envelope.exchangeEventTimeMs !== null && envelope.exchangeEventTimeMs > envelope.localReceiveTimeMs) {
    fail('EVIDENCE_CLOCK_ORDER_INVALID', 'exchange event time cannot follow local receive time');
  }
  if (envelope.localReceiveTimeMs > envelope.normalizationTimeMs) fail('EVIDENCE_CLOCK_ORDER_INVALID', 'local receive time cannot follow normalization time');
  if (envelope.featureCutoffTimeMs !== null && envelope.normalizationTimeMs > envelope.featureCutoffTimeMs) {
    fail('EVIDENCE_CUTOFF_VIOLATION', 'normalization time cannot follow the feature cutoff');
  }
  asRecord(envelope.source, 'evidence.source');
  exactFields(envelope.source, ['sourceType', 'streamClass', 'connectionId', 'sessionId', 'sequence', 'endpoint'], 'evidence.source');
  for (const field of ['sourceType', 'streamClass']) boundedString(envelope.source[field], `evidence.source.${field}`, 256);
  idString(envelope.source.connectionId, 'evidence.source.connectionId');
  if (envelope.source.sessionId !== null) idString(envelope.source.sessionId, 'evidence.source.sessionId');
  if (envelope.source.sequence !== null) safeInteger(envelope.source.sequence, 'evidence.source.sequence', { minimum: 0 });
  if (envelope.source.endpoint !== null) boundedString(envelope.source.endpoint, 'evidence.source.endpoint', 256);
  hashHex(envelope.rawPayloadHash, 'evidence.rawPayloadHash');
  hashHex(envelope.normalizedSchemaHash, 'evidence.normalizedSchemaHash');
  if (envelope.truthLabel !== 'SYNTHETIC') fail('EVIDENCE_TRUTH_LABEL_FORBIDDEN', 'VenueMesh prestage evidence must remain SYNTHETIC');
  asRecord(envelope.quality, 'evidence.quality');
  exactFields(envelope.quality, ['freshness', 'completeness', 'gapCount', 'duplicate', 'reconstructed'], 'evidence.quality');
  enumValue(envelope.quality.freshness, ['FRESH', 'STALE', 'UNKNOWN'], 'evidence.quality.freshness');
  enumValue(envelope.quality.completeness, ['COMPLETE', 'PARTIAL', 'SAMPLED', 'UNAVAILABLE', 'UNKNOWN'], 'evidence.quality.completeness');
  safeInteger(envelope.quality.gapCount, 'evidence.quality.gapCount', { minimum: 0 });
  if (typeof envelope.quality.duplicate !== 'boolean' || typeof envelope.quality.reconstructed !== 'boolean') {
    fail('EVIDENCE_QUALITY_FLAG_INVALID', 'duplicate and reconstructed flags must be boolean');
  }
  enumValue(envelope.payloadKind, PAYLOAD_KINDS, 'evidence.payloadKind');
  asRecord(envelope.payload, 'evidence.payload');
  if (Object.keys(envelope.payload).length > 128) fail('EVIDENCE_PAYLOAD_BOUNDS_EXCEEDED', 'evidence payload exceeds 128 properties');
  validatePayload(envelope.payloadKind, envelope.payload, envelope.quality);
  assertObservationBoundary(envelope);
  return true;
}

export function createMarketEvidenceEnvelope({
  identity,
  rawPayload,
  payloadKind,
  payload,
  exchangeEventTimeMs,
  localReceiveTimeMs,
  normalizationTimeMs,
  featureCutoffTimeMs = null,
  sourceType,
  streamClass,
  connectionId,
  sessionId = null,
  sequence = null,
  endpoint = null,
  freshness = 'UNKNOWN',
  completeness = 'UNKNOWN',
  gapCount = 0,
  duplicate = false,
  reconstructed = false,
}) {
  asRecord(identity, 'identity');
  if (identity.identityState !== 'VERIFIED' || identity.canonicalProduct === null || identity.baseCanonicalAssetId === null) {
    fail('EVIDENCE_IDENTITY_UNRESOLVED', 'canonical-aligned evidence requires a verified local identity map');
  }
  asRecord(rawPayload, 'rawPayload');
  asRecord(payload, 'payload');
  const rawPayloadHash = sha256(rawPayload);
  const normalizedSchemaHash = sha256({ schema: 'MarketEvidenceEnvelopeV1', version: 1, payloadKind });
  const stableIdentity = {
    venue: identity.venue,
    venueInstrumentId: identity.venueInstrumentId,
    payloadKind,
    rawPayloadHash,
    localReceiveTimeMs,
  };
  const record = {
    schema: 'MarketEvidenceEnvelopeV1',
    version: 1,
    revision: 0,
    evidenceId: `vm.ev.${sha256(stableIdentity).slice(0, 32)}`,
    traceId: `vm.trace.${sha256({ stableIdentity, sourceType, streamClass }).slice(0, 28)}`,
    instrumentGraph: {
      venue: identity.venue,
      product: identity.canonicalProduct,
      symbol: identity.symbol,
      canonicalAsset: identity.baseCanonicalAssetId,
      spotSymbol: identity.canonicalProduct === 'SPOT' ? identity.symbol : null,
      perpSymbol: identity.canonicalProduct === 'USDM_PERP' ? identity.symbol : null,
      borrowAsset: null,
      missingLegReason: null,
    },
    exchangeEventTimeMs,
    localReceiveTimeMs,
    normalizationTimeMs,
    featureCutoffTimeMs,
    source: { sourceType, streamClass, connectionId, sessionId, sequence, endpoint },
    rawPayloadHash,
    normalizedSchemaHash,
    truthLabel: 'SYNTHETIC',
    quality: { freshness, completeness, gapCount, duplicate, reconstructed },
    payloadKind,
    payload,
  };
  validateMarketEvidenceEnvelope(record);
  return deepFreeze(record);
}

export function makeUnavailableObservation({ identityId, payloadKind, reasonCodes, observedAtMs }) {
  idString(identityId, 'unavailable.identityId');
  enumValue(payloadKind, PAYLOAD_KINDS, 'unavailable.payloadKind');
  protocolUtcMillis(observedAtMs, 'unavailable.observedAtMs');
  if (!Array.isArray(reasonCodes) || reasonCodes.length === 0 || reasonCodes.some((value) => typeof value !== 'string')) {
    fail('UNAVAILABLE_REASON_REQUIRED', 'unavailable observations require explicit reason codes');
  }
  const record = {
    schema: 'VenueUnavailableObservationV1',
    identityId,
    payloadKind,
    status: 'UNAVAILABLE',
    value: null,
    reasonCodes: [...new Set(reasonCodes)].sort(),
    observedAtMs,
    authorityClass: 'NO_AUTHORITY',
    canonical: false,
  };
  validateVenueUnavailableObservation(record);
  return deepFreeze(record);
}

export function validateVenueUnavailableObservation(record) {
  asRecord(record, 'VenueUnavailableObservationV1');
  exactFields(record, ['schema', 'identityId', 'payloadKind', 'status', 'value', 'reasonCodes', 'observedAtMs', 'authorityClass', 'canonical'], 'VenueUnavailableObservationV1');
  if (record.schema !== 'VenueUnavailableObservationV1' || record.status !== 'UNAVAILABLE' || record.value !== null) {
    fail('UNAVAILABLE_OBSERVATION_SCHEMA_INVALID', 'unavailable observation must be V1 with null value');
  }
  idString(record.identityId, 'unavailable.identityId');
  enumValue(record.payloadKind, PAYLOAD_KINDS, 'unavailable.payloadKind');
  protocolUtcMillis(record.observedAtMs, 'unavailable.observedAtMs');
  if (!Array.isArray(record.reasonCodes) || record.reasonCodes.length === 0 || record.reasonCodes.some((value) => typeof value !== 'string')) {
    fail('UNAVAILABLE_REASON_REQUIRED', 'unavailable observations require explicit reason codes');
  }
  const normalizedReasons = [...new Set(record.reasonCodes)].sort();
  if (normalizedReasons.length !== record.reasonCodes.length || normalizedReasons.some((value, index) => value !== record.reasonCodes[index])) {
    fail('UNAVAILABLE_REASON_ORDER_INVALID', 'unavailable reason codes must be sorted and unique');
  }
  if (record.authorityClass !== 'NO_AUTHORITY' || record.canonical !== false) fail('UNAVAILABLE_AUTHORITY_WIDENING', 'unavailable observations remain non-canonical and no-authority');
  assertObservationBoundary(record);
  return true;
}
