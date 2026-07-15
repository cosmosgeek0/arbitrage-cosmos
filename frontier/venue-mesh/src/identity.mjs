import { sha256 } from '../../dock/src/index.mjs';
import {
  arrayValue,
  asRecord,
  boundedString,
  deepFreeze,
  enumValue,
  exactFields,
  optionalString,
  safeInteger,
  stableSort,
  utcMillis,
} from './guards.mjs';
import { decimalToMantissa } from './decimal.mjs';
import { fail } from './errors.mjs';

export const VENUES = Object.freeze(['COINBASE', 'KRAKEN', 'DERIBIT']);
export const PRODUCT_FAMILIES = Object.freeze(['SPOT', 'PERPETUAL', 'DATED_FUTURE', 'OPTION']);
const DERIVATIVE_PRODUCTS = new Set(['PERPETUAL', 'DATED_FUTURE', 'OPTION']);

function assetKey(venue, assetCode) {
  return `${venue}:${assetCode}`;
}

export function validateInstrumentDescriptor(input) {
  asRecord(input, 'VenueInstrumentV1');
  exactFields(input, [
    'schema', 'version', 'venue', 'venueInstrumentId', 'symbol', 'baseAsset', 'quoteAsset',
    'settlementAsset', 'productFamily', 'expiryTimeMs', 'strike', 'optionType',
    'contractMultiplier', 'contractMultiplierUnit', 'tickSize', 'quantityStep', 'status',
    'tradingPhase', 'observedAtMs', 'availableAtMs', 'sourceUrl', 'sourceContentSha256',
    'publicCapabilities', 'authorityClass', 'canonical', 'networkMode',
  ], 'VenueInstrumentV1');
  if (input.schema !== 'VenueInstrumentV1' || input.version !== 1) fail('INSTRUMENT_SCHEMA_INVALID', 'instrument descriptor must be VenueInstrumentV1');
  enumValue(input.venue, VENUES, 'instrument.venue');
  enumValue(input.productFamily, PRODUCT_FAMILIES, 'instrument.productFamily');
  for (const field of ['venueInstrumentId', 'symbol', 'baseAsset', 'quoteAsset', 'status', 'tradingPhase', 'sourceUrl', 'sourceContentSha256']) {
    boundedString(input[field], `instrument.${field}`, field === 'sourceUrl' ? 2_048 : 256);
  }
  if (!/^https:\/\//.test(input.sourceUrl)) fail('INSTRUMENT_SOURCE_URL_INVALID', 'instrument sourceUrl must be HTTPS documentation provenance');
  if (!/^[a-f0-9]{64}$/.test(input.sourceContentSha256)) fail('INSTRUMENT_SOURCE_HASH_INVALID', 'instrument source hash must be SHA-256');
  optionalString(input.settlementAsset, 'instrument.settlementAsset', 64);
  if (input.expiryTimeMs !== null) utcMillis(input.expiryTimeMs, 'instrument.expiryTimeMs');
  optionalString(input.strike, 'instrument.strike', 128);
  enumValue(input.optionType, [null, 'CALL', 'PUT'], 'instrument.optionType');
  optionalString(input.contractMultiplier, 'instrument.contractMultiplier', 128);
  optionalString(input.contractMultiplierUnit, 'instrument.contractMultiplierUnit', 128);
  optionalString(input.tickSize, 'instrument.tickSize', 128);
  optionalString(input.quantityStep, 'instrument.quantityStep', 128);
  utcMillis(input.observedAtMs, 'instrument.observedAtMs');
  utcMillis(input.availableAtMs, 'instrument.availableAtMs');
  if (input.availableAtMs > input.observedAtMs) fail('INSTRUMENT_TIME_ORDER_INVALID', 'instrument availableAtMs cannot follow observedAtMs');
  if (DERIVATIVE_PRODUCTS.has(input.productFamily)) {
    if (input.settlementAsset === null) fail('SETTLEMENT_ASSET_REQUIRED', 'derivative instrument requires explicit settlement asset');
    if (input.contractMultiplier === null || input.contractMultiplierUnit === null) {
      fail('CONTRACT_MULTIPLIER_REQUIRED', 'derivative instrument requires explicit contract multiplier and unit');
    }
    decimalToMantissa(input.contractMultiplier, 'instrument.contractMultiplier');
  }
  if (input.productFamily === 'OPTION') {
    if (input.optionType === null || input.strike === null || input.expiryTimeMs === null) {
      fail('OPTION_IDENTITY_INCOMPLETE', 'option identity requires optionType, strike, and expiry');
    }
  } else if (input.optionType !== null || input.strike !== null) {
    fail('OPTION_FIELDS_FORBIDDEN', 'non-option instruments cannot carry option fields');
  }
  if (input.productFamily === 'DATED_FUTURE' && input.expiryTimeMs === null) fail('FUTURE_EXPIRY_REQUIRED', 'dated future requires expiry');
  if (input.productFamily !== 'DATED_FUTURE' && input.productFamily !== 'OPTION' && input.expiryTimeMs !== null) {
    fail('EXPIRY_FIELD_FORBIDDEN', 'spot and perpetual instruments cannot carry expiry');
  }
  if (input.authorityClass !== 'NO_AUTHORITY' || input.canonical !== false || input.networkMode !== 'FIXTURE_ONLY') {
    fail('INSTRUMENT_AUTHORITY_WIDENING', 'instrument descriptor must remain non-canonical and fixture-only');
  }
  asRecord(input.publicCapabilities, 'instrument.publicCapabilities');
  exactFields(input.publicCapabilities, ['bookTicker', 'trades', 'depth', 'funding', 'mark', 'index', 'openInterest', 'liquidations'], 'instrument.publicCapabilities');
  const allowedCapabilityStates = ['SUPPORTED_PUBLIC', 'UNSUPPORTED', 'UNKNOWN', 'AUTHENTICATION_REQUIRED'];
  for (const capability of ['bookTicker', 'trades', 'depth', 'funding', 'mark', 'index', 'openInterest', 'liquidations']) {
    enumValue(input.publicCapabilities[capability], allowedCapabilityStates, `instrument.publicCapabilities.${capability}`);
  }
  return true;
}

export function mapInstrumentIdentity(descriptor, registry) {
  validateInstrumentDescriptor(descriptor);
  arrayValue(registry, 'asset registry', { maximum: 10_000 });
  const entries = new Map();
  for (const [index, entry] of registry.entries()) {
    asRecord(entry, `asset registry[${index}]`);
    enumValue(entry.venue, VENUES, `asset registry[${index}].venue`);
    boundedString(entry.assetCode, `asset registry[${index}].assetCode`, 64);
    boundedString(entry.canonicalAssetId, `asset registry[${index}].canonicalAssetId`, 128);
    boundedString(entry.provenanceRef, `asset registry[${index}].provenanceRef`, 2_048);
    if (entry.verificationState !== 'VERIFIED') fail('ASSET_REGISTRY_UNVERIFIED', 'asset registry entries must be explicitly VERIFIED');
    const key = assetKey(entry.venue, entry.assetCode);
    if (entries.has(key)) fail('ASSET_REGISTRY_COLLISION', `duplicate asset registry key ${key}`);
    entries.set(key, entry);
  }
  const base = entries.get(assetKey(descriptor.venue, descriptor.baseAsset)) ?? null;
  const quote = entries.get(assetKey(descriptor.venue, descriptor.quoteAsset)) ?? null;
  const settlement = descriptor.settlementAsset === null
    ? null
    : entries.get(assetKey(descriptor.venue, descriptor.settlementAsset)) ?? null;
  const reasonCodes = [];
  if (base === null) reasonCodes.push('BASE_ASSET_ID_UNKNOWN');
  if (quote === null) reasonCodes.push('QUOTE_ASSET_ID_UNKNOWN');
  if (descriptor.settlementAsset !== null && settlement === null) reasonCodes.push('SETTLEMENT_ASSET_ID_UNKNOWN');
  if (['DATED_FUTURE', 'OPTION'].includes(descriptor.productFamily)) reasonCodes.push('CANONICAL_PRODUCT_UNSUPPORTED');
  const isUsdmPerpetual = descriptor.productFamily === 'PERPETUAL'
    && quote !== null
    && settlement !== null
    && quote.canonicalAssetId === settlement.canonicalAssetId;
  if (descriptor.productFamily === 'PERPETUAL' && !isUsdmPerpetual) reasonCodes.push('SETTLEMENT_SEMANTICS_UNSUPPORTED');
  const identity = {
    schema: 'VenueInstrumentIdentityMapV1',
    version: 1,
    identityId: `vm-identity-${sha256({ descriptor, base, quote, settlement }).slice(0, 32)}`,
    venue: descriptor.venue,
    venueInstrumentId: descriptor.venueInstrumentId,
    symbol: descriptor.symbol,
    productFamily: descriptor.productFamily,
    canonicalProduct: descriptor.productFamily === 'SPOT' ? 'SPOT' : isUsdmPerpetual ? 'USDM_PERP' : null,
    baseAssetCode: descriptor.baseAsset,
    baseCanonicalAssetId: base?.canonicalAssetId ?? null,
    quoteAssetCode: descriptor.quoteAsset,
    quoteCanonicalAssetId: quote?.canonicalAssetId ?? null,
    settlementAssetCode: descriptor.settlementAsset,
    settlementCanonicalAssetId: settlement?.canonicalAssetId ?? null,
    contractMultiplier: descriptor.contractMultiplier,
    contractMultiplierUnit: descriptor.contractMultiplierUnit,
    expiryTimeMs: descriptor.expiryTimeMs,
    strike: descriptor.strike,
    optionType: descriptor.optionType,
    sourceInstrumentHash: sha256(descriptor),
    identityState: reasonCodes.length === 0 ? 'VERIFIED' : 'PARTIAL',
    reasonCodes: [...new Set(reasonCodes)].sort(),
    provenanceRefs: stableSort([base, quote, settlement].filter(Boolean).map((entry) => entry.provenanceRef), (value) => value),
    authorityClass: 'NO_AUTHORITY',
    canonical: false,
    networkMode: 'FIXTURE_ONLY',
  };
  return deepFreeze(identity);
}

function isDerivative(identity) {
  return DERIVATIVE_PRODUCTS.has(identity.productFamily);
}

export function compareInstrumentIdentity(left, right) {
  asRecord(left, 'left identity');
  asRecord(right, 'right identity');
  const reasonCodes = [];
  if (left.baseCanonicalAssetId === null || right.baseCanonicalAssetId === null) reasonCodes.push('BASE_ASSET_ID_UNKNOWN');
  else if (left.baseCanonicalAssetId !== right.baseCanonicalAssetId) reasonCodes.push('BASE_ASSET_ID_MISMATCH');
  if (left.quoteCanonicalAssetId === null || right.quoteCanonicalAssetId === null) reasonCodes.push('QUOTE_ASSET_ID_UNKNOWN');
  else if (left.quoteCanonicalAssetId !== right.quoteCanonicalAssetId) reasonCodes.push('QUOTE_CURRENCY_MISMATCH');
  if (left.canonicalProduct !== right.canonicalProduct) reasonCodes.push('PRODUCT_FAMILY_MISMATCH');
  for (const identity of [left, right]) {
    if (isDerivative(identity) && (identity.contractMultiplier === null || identity.contractMultiplierUnit === null)) {
      reasonCodes.push('CONTRACT_MULTIPLIER_MISSING');
    }
    if (identity.canonicalProduct === null) reasonCodes.push('CANONICAL_PRODUCT_UNSUPPORTED');
  }
  if (isDerivative(left) && isDerivative(right)) {
    if (left.contractMultiplier !== right.contractMultiplier || left.contractMultiplierUnit !== right.contractMultiplierUnit) {
      reasonCodes.push('CONTRACT_MULTIPLIER_MISMATCH');
    }
  }
  if (isDerivative(left) !== isDerivative(right)) {
    const derivative = isDerivative(left) ? left : right;
    const spot = isDerivative(left) ? right : left;
    if (derivative.baseCanonicalAssetId !== spot.baseCanonicalAssetId || derivative.canonicalProduct !== spot.canonicalProduct) {
      reasonCodes.push('SPOT_DERIVATIVE_IDENTITY_MISMATCH');
    }
  }
  const uniqueReasons = [...new Set(reasonCodes)].sort();
  return deepFreeze({
    schema: 'VenueIdentityComparisonV1',
    comparable: uniqueReasons.length === 0,
    sameTickerText: left.baseAssetCode === right.baseAssetCode,
    reasonCodes: uniqueReasons,
    leftIdentityId: left.identityId,
    rightIdentityId: right.identityId,
    authorityClass: 'NO_AUTHORITY',
  });
}

export function detectIdentityCollisions(identities) {
  arrayValue(identities, 'identities', { maximum: 10_000 });
  const byTicker = new Map();
  for (const identity of identities) {
    const key = identity.baseAssetCode;
    const rows = byTicker.get(key) ?? [];
    rows.push(identity);
    byTicker.set(key, rows);
  }
  const collisions = [];
  for (const [ticker, rows] of byTicker.entries()) {
    const knownIds = [...new Set(rows.map((row) => row.baseCanonicalAssetId).filter(Boolean))].sort();
    const unknownCount = rows.filter((row) => row.baseCanonicalAssetId === null).length;
    if (knownIds.length > 1 || (knownIds.length > 0 && unknownCount > 0)) {
      collisions.push({
        ticker,
        identityIds: rows.map((row) => row.identityId).sort(),
        canonicalAssetIds: knownIds,
        unknownCount,
        state: 'COLLISION',
        reasonCode: 'SAME_TICKER_DIFFERENT_OR_UNKNOWN_ASSET',
      });
    }
  }
  return deepFreeze(stableSort(collisions, (row) => row.ticker));
}

export function createInstrumentDescriptor(input) {
  const record = {
    ...input,
    schema: 'VenueInstrumentV1',
    version: 1,
    authorityClass: 'NO_AUTHORITY',
    canonical: false,
    networkMode: 'FIXTURE_ONLY',
  };
  validateInstrumentDescriptor(record);
  return deepFreeze(record);
}
