import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';

import {
  canonicalJson,
  sortedUnique,
  stableId,
  validateTruthMetadata,
} from '../../../intelligenceFoundation/contracts/index.js';
import {
  normalizeInstrumentCapabilities,
  requiredInstrumentLossCodes,
} from './capabilities.js';
import { resolveInstrumentContract, L04_BINANCE_MATRIX_SHA256 } from './contract.js';
import { normalizeFilterDecimal } from './exact.js';
import {
  instrumentFilterDefinitions,
  normalizedFilterSemanticReasonCodes,
  type InstrumentFilterDefinition,
  type InstrumentFilterFieldKind,
} from './filterSchemas.js';
import {
  deriveInstrumentEvidenceRevision,
  deriveInstrumentRevision,
  deriveRegistryRevision,
  deriveSnapshotRevision,
} from './snapshot.js';
import {
  BINANCE_INSTRUMENT_REGISTRY_SCHEMA,
  type BinanceInstrumentProduct,
  type BinanceInstrumentRegistrySnapshot,
  type BinanceInstrumentSpec,
  type InstrumentNormalizationState,
  type NormalizeRuntimeInstrumentRegistryResult,
  type NormalizedInstrumentFilterState,
  type NormalizedFilterValue,
  type NormalizedInstrumentFilter,
} from './types.js';

type PlainRecord = Readonly<Record<string, unknown>>;

const INPUT_FIELDS = Object.freeze([
  'matrixSha256', 'contractId', 'product', 'environment', 'evaluatedAtMs',
  'maximumAgeMs', 'metadata',
] as const);

const METADATA_FIELDS = Object.freeze([
  'id', 'fingerprint', 'source', 'symbol', 'pair', 'baseAsset', 'quoteAsset',
  'status', 'tradingAllowed', 'contractType', 'onboardDateMs', 'deliveryDateMs',
  'marginAsset', 'underlyingType', 'underlyingSubType', 'orderTypes',
  'timeInForce', 'permissionSets', 'precisions', 'filters', 'includedInUniverse',
  'exclusionReasonCodes', 'receivedTimeMs', 'truth',
] as const);

const MAXIMUM_METADATA = 10_000;
const MAXIMUM_FILTERS = 128;
const MAXIMUM_DEPTH = 12;
const MAXIMUM_NODES = 2_000_000;
const MAXIMUM_STRING = 8_192;
const MAXIMUM_TOTAL_STRING_UNITS = 32 * 1_024 * 1_024;
const FUTURE_SKEW_MS = 2_000;
const PRECISION_FIELDS = Object.freeze([
  'baseAssetPrecision', 'quotePrecision', 'quoteAssetPrecision',
  'baseCommissionPrecision', 'quoteCommissionPrecision', 'pricePrecision',
  'quantityPrecision',
] as const);

const RUNTIME_OWNER_TRUTH = Object.freeze({
  SPOT: Object.freeze({
    sourceId: 'runtime-source:025063ab92e41c3c6bf3cf25',
    dataset: 'spot.exchange_info',
  }),
  USD_M_PERPETUAL: Object.freeze({
    sourceId: 'runtime-source:92ed4acdf571bccac7c0cf5f',
    dataset: 'usd_m.exchange_info',
  }),
} as const);

function codePointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safeSnapshot(value: unknown): unknown {
  const budget = { nodes: 0, stringUnits: 0 };
  const visit = (candidate: unknown, depth: number): unknown => {
    budget.nodes += 1;
    if (budget.nodes > MAXIMUM_NODES || depth > MAXIMUM_DEPTH) {
      throw new RangeError('instrument input exceeds the bounded data graph');
    }
    if (candidate === null || typeof candidate === 'boolean') return candidate;
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) throw new TypeError('instrument input contains a non-finite number');
      return Object.is(candidate, -0) ? 0 : candidate;
    }
    if (typeof candidate === 'string') {
      if (candidate.length > MAXIMUM_STRING) throw new RangeError('instrument input string exceeds the bound');
      budget.stringUnits += candidate.length;
      if (budget.stringUnits > MAXIMUM_TOTAL_STRING_UNITS) {
        throw new RangeError('instrument input strings exceed the aggregate bound');
      }
      return candidate;
    }
    if (typeof candidate !== 'object' || utilTypes.isProxy(candidate)) {
      throw new TypeError('instrument input must contain JSON-like plain data');
    }
    const prototype = Object.getPrototypeOf(candidate);
    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== 'string')) throw new TypeError('instrument input contains a symbol key');
    if (!Array.isArray(candidate) && keys.length > 4_096) {
      throw new RangeError('instrument input object exceeds the key-count bound');
    }
    for (const key of keys as string[]) {
      if (key.length > 256) throw new RangeError('instrument input key exceeds the bound');
      budget.stringUnits += key.length;
      if (budget.stringUnits > MAXIMUM_TOTAL_STRING_UNITS) {
        throw new RangeError('instrument input strings exceed the aggregate bound');
      }
    }
    if (Array.isArray(candidate)) {
      if (prototype !== Array.prototype || candidate.length > MAXIMUM_METADATA * MAXIMUM_FILTERS) {
        throw new TypeError('instrument input array is invalid or overbound');
      }
      const output: unknown[] = [];
      for (let index = 0; index < candidate.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
          throw new TypeError('instrument input arrays must be dense own data');
        }
        output.push(visit(descriptor.value, depth + 1));
      }
      if (keys.length !== candidate.length + 1
        || keys.some((key) => key !== 'length'
          && (!/^(?:0|[1-9]\d*)$/.test(key as string)
            || Number(key) >= candidate.length))) {
        throw new TypeError('instrument input array contains a named property');
      }
      return output;
    }
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('instrument input must use plain objects');
    }
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('instrument input must use enumerable data properties');
      }
      output[key] = visit(descriptor.value, depth + 1);
    }
    return output;
  };
  return visit(value, 0);
}

function record(value: unknown, fields: readonly string[], label: string): PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a record`);
  }
  const keys = Object.keys(value);
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
    throw new TypeError(`${label} must use exact fields`);
  }
  return value as PlainRecord;
}

function stringValue(value: unknown, label: string, maximum = 256): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum
    || value.trim() !== value || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value)) {
    throw new TypeError(`${label} must be bounded safe text`);
  }
  return value;
}

function instrumentToken(value: unknown, label: string): string {
  const token = stringValue(value, label);
  if (token !== token.normalize('NFC').toUpperCase()
    || !/^[\p{L}\p{N}._-]+$/u.test(token)) {
    throw new TypeError(`${label} must already use canonical Runtime instrument-token form`);
  }
  return token;
}

function filterTypeValue(value: unknown, label: string): string {
  const normalized = stringValue(value, label, 128);
  if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(normalized)) {
    throw new TypeError(`${label} must use the official filter token grammar`);
  }
  return normalized;
}

function safeInteger(value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be a bounded safe integer`);
  }
  return value;
}

function nullableSafeInteger(value: unknown, label: string): number | null {
  return value === null ? null : safeInteger(value, label);
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : stringValue(value, label);
}

function stringArray(value: unknown, label: string, maximum = 128): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) throw new TypeError(`${label} must be a bounded array`);
  return Object.freeze(value.map((entry, index) => stringValue(entry, `${label}[${index}]`)));
}

function assertSortedUniqueStrings(values: readonly string[], label: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (codePointCompare(values[index - 1], values[index]) >= 0) {
      throw new TypeError(`${label} must use canonical sorted unique owner order`);
    }
  }
}

function precisionRecord(value: unknown): Readonly<Record<string, number>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('precisions must be a record');
  }
  const keys = Object.keys(value);
  if (keys.length > PRECISION_FIELDS.length || keys.some((key) => !PRECISION_FIELDS.includes(key as (typeof PRECISION_FIELDS)[number]))) {
    throw new TypeError('precisions contains an unsupported owner field');
  }
  const output: Record<string, number> = {};
  for (const key of keys) output[key] = safeInteger((value as PlainRecord)[key], `precisions.${key}`, 0, 1_000);
  return Object.freeze(output);
}

function permissionSets(value: unknown): readonly (readonly string[])[] {
  if (!Array.isArray(value) || value.length > 128) throw new TypeError('permissionSets must be bounded');
  let total = 0;
  const output = value.map((entry, index) => {
    const values = [...stringArray(entry, `permissionSets[${index}]`, 512)];
    if (values.length === 0) throw new TypeError('permissionSets cannot retain an empty set');
    assertSortedUniqueStrings(values, `permissionSets[${index}]`);
    total += values.length;
    if (total > 4_096) throw new TypeError('permissionSets exceeds the owner total bound');
    return Object.freeze(values);
  });
  for (let index = 1; index < output.length; index += 1) {
    if (codePointCompare(canonicalJson(output[index - 1]), canonicalJson(output[index])) >= 0) {
      throw new TypeError('permissionSets must use canonical sorted unique owner order');
    }
  }
  return Object.freeze(output);
}

function semanticMetadata(metadata: PlainRecord): Readonly<Record<string, unknown>> {
  return Object.freeze({
    source: metadata.source,
    symbol: metadata.symbol,
    pair: metadata.pair,
    baseAsset: metadata.baseAsset,
    quoteAsset: metadata.quoteAsset,
    status: metadata.status,
    tradingAllowed: metadata.tradingAllowed,
    contractType: metadata.contractType,
    onboardDateMs: metadata.onboardDateMs,
    deliveryDateMs: metadata.deliveryDateMs,
    marginAsset: metadata.marginAsset,
    underlyingType: metadata.underlyingType,
    underlyingSubType: metadata.underlyingSubType,
    orderTypes: metadata.orderTypes,
    timeInForce: metadata.timeInForce,
    permissionSets: metadata.permissionSets,
    precisions: metadata.precisions,
    filters: metadata.filters,
    includedInUniverse: metadata.includedInUniverse,
    exclusionReasonCodes: metadata.exclusionReasonCodes,
  });
}

function normalizedInteger(value: unknown, positive: boolean, flexible: boolean, label: string): number {
  let parsed: number;
  if (flexible && typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value)) parsed = Number(value);
  else parsed = value as number;
  return safeInteger(parsed, label, positive ? 1 : 0, 1_000_000_000);
}

function normalizeField(kind: InstrumentFilterFieldKind, value: unknown, label: string): NormalizedFilterValue {
  if (kind === 'DECIMAL') return normalizeFilterDecimal(value, false);
  if (kind === 'POSITIVE_DECIMAL') return normalizeFilterDecimal(value, true);
  if (kind === 'BOOLEAN') {
    if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean`);
    return value;
  }
  if (kind === 'INTEGER_FLEXIBLE') return normalizedInteger(value, false, true, label);
  return normalizedInteger(value, kind === 'POSITIVE_INTEGER', false, label);
}

function validateFilterSemantics(filter: NormalizedInstrumentFilter): readonly string[] {
  return normalizedFilterSemanticReasonCodes(filter);
}

interface NormalizedFiltersResult {
  readonly filters: readonly NormalizedInstrumentFilter[];
  readonly reasonCodes: readonly string[];
}

function blockedFilter(
  filterType: string,
  sourceContentSha256: string,
  state: Exclude<NormalizedInstrumentFilterState, 'ACTIVE'>,
  reasonCodes: readonly string[],
  definition: InstrumentFilterDefinition | undefined,
): Readonly<NormalizedInstrumentFilter> {
  return Object.freeze({
    filterType,
    state,
    reasonCodes: Object.freeze([...reasonCodes]),
    values: Object.freeze({}),
    sourceContentSha256,
    privateTruthRequired: definition?.privateTruthRequired ?? false,
    dynamicReferenceRequired: definition?.dynamicReferenceRequired ?? false,
  });
}

function normalizeFilters(product: BinanceInstrumentProduct, value: unknown): Readonly<NormalizedFiltersResult> {
  if (!Array.isArray(value) || value.length > MAXIMUM_FILTERS) {
    throw new TypeError('filters must be a bounded array');
  }
  const definitions = instrumentFilterDefinitions(product);
  const output: NormalizedInstrumentFilter[] = [];
  const outer = value.map((entry, index) => record(entry, ['filterType', 'values'], `filters[${index}]`));
  const filterTypes = outer.map((item, index) => filterTypeValue(item.filterType, `filters[${index}].filterType`));
  for (let index = 1; index < outer.length; index += 1) {
    const typeOrder = codePointCompare(filterTypes[index - 1], filterTypes[index]);
    const valueOrder = codePointCompare(canonicalJson(outer[index - 1].values), canonicalJson(outer[index].values));
    if (typeOrder > 0 || (typeOrder === 0 && valueOrder > 0)) {
      throw new TypeError('filters must use canonical Runtime owner order');
    }
  }
  const counts = new Map<string, number>();
  for (const filterType of filterTypes) counts.set(filterType, (counts.get(filterType) ?? 0) + 1);
  const globalReasons: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = outer[index];
    const filterType = filterTypes[index];
    const sourceContentSha256 = createHash('sha256').update(canonicalJson(item)).digest('hex');
    const definition = definitions[filterType];
    if ((counts.get(filterType) ?? 0) > 1) {
      const reason = `DUPLICATE_FILTER_${filterType}`;
      globalReasons.push(reason);
      output.push(blockedFilter(filterType, sourceContentSha256, 'BLOCKED_DUPLICATE', [reason], definition));
      continue;
    }
    if (definition === undefined) {
      const reason = `UNSUPPORTED_CURRENT_${product}_FILTER_${filterType}`;
      globalReasons.push(reason);
      output.push(blockedFilter(filterType, sourceContentSha256, 'BLOCKED_UNSUPPORTED', [reason], undefined));
      continue;
    }
    const expectedKeys = ['filterType', ...Object.keys(definition.fields)];
    try {
      const valuesRecord = record(item.values, expectedKeys, `${filterType}.values`);
      if (valuesRecord.filterType !== filterType) throw new TypeError(`${filterType} value discriminator conflicts`);
      const normalized: Record<string, NormalizedFilterValue> = Object.create(null) as Record<string, NormalizedFilterValue>;
      for (const [field, kind] of Object.entries(definition.fields)) {
        normalized[field] = normalizeField(kind, valuesRecord[field], `${filterType}.${field}`);
      }
      const provisional: NormalizedInstrumentFilter = {
        filterType,
        state: 'ACTIVE',
        reasonCodes: Object.freeze([]),
        values: Object.freeze(normalized),
        sourceContentSha256,
        privateTruthRequired: definition.privateTruthRequired,
        dynamicReferenceRequired: definition.dynamicReferenceRequired,
      };
      const semanticReasons = validateFilterSemantics(provisional);
      const disabled = semanticReasons.some((reason) => reason.endsWith('_DISABLED'));
      const contradictory = semanticReasons.some((reason) => reason.includes('_EXCEEDS_'));
      const state: NormalizedInstrumentFilterState = disabled
        ? 'BLOCKED_DISABLED'
        : contradictory
          ? 'BLOCKED_CONTRADICTORY'
          : 'ACTIVE';
      if (semanticReasons.length > 0) globalReasons.push(...semanticReasons);
      output.push(Object.freeze({
        ...provisional,
        state,
        reasonCodes: semanticReasons,
      }));
    } catch {
      const reason = `MALFORMED_FILTER_${filterType}`;
      globalReasons.push(reason);
      output.push(blockedFilter(filterType, sourceContentSha256, 'BLOCKED_MALFORMED', [reason], definition));
    }
  }
  const required = product === 'USD_M_PERPETUAL'
    ? ['PRICE_FILTER', 'LOT_SIZE', 'MIN_NOTIONAL']
    : ['PRICE_FILTER', 'LOT_SIZE'];
  for (const filterType of required) {
    if (!counts.has(filterType)) globalReasons.push(`REQUIRED_FILTER_${filterType}_MISSING`);
  }
  if (product !== 'USD_M_PERPETUAL' && !counts.has('MIN_NOTIONAL') && !counts.has('NOTIONAL')) {
    globalReasons.push('REQUIRED_SPOT_FAMILY_NOTIONAL_FILTER_MISSING');
  }
  output.sort((left, right) => codePointCompare(left.filterType, right.filterType)
    || codePointCompare(left.sourceContentSha256, right.sourceContentSha256));
  return Object.freeze({
    filters: Object.freeze(output),
    reasonCodes: sortedUnique(globalReasons),
  });
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function normalizeOne(
  product: BinanceInstrumentProduct,
  contractId: string,
  metadataValue: unknown,
  evaluatedAtMs: number,
  maximumAgeMs: number,
): Readonly<BinanceInstrumentSpec> {
  const metadata = record(metadataValue, METADATA_FIELDS, 'RuntimeListingMetadata');
  const source = stringValue(metadata.source, 'metadata.source');
  const expectedSource = product === 'USD_M_PERPETUAL' ? 'USD_M_PERPETUAL' : 'SPOT';
  if (source !== expectedSource) throw new TypeError('Runtime metadata source does not match product adapter');
  const symbol = instrumentToken(metadata.symbol, 'metadata.symbol');
  const pair = instrumentToken(metadata.pair, 'metadata.pair');
  const baseAsset = instrumentToken(metadata.baseAsset, 'metadata.baseAsset');
  const quoteAsset = instrumentToken(metadata.quoteAsset, 'metadata.quoteAsset');
  const status = stringValue(metadata.status, 'metadata.status');
  if (metadata.tradingAllowed !== null && typeof metadata.tradingAllowed !== 'boolean') {
    throw new TypeError('metadata.tradingAllowed must be boolean or null');
  }
  if (metadata.contractType !== null && typeof metadata.contractType !== 'string') {
    throw new TypeError('metadata.contractType must be string or null');
  }
  if (pair !== `${baseAsset}${quoteAsset}` || symbol !== pair
    || (expectedSource === 'SPOT' && metadata.contractType !== null)
    || (expectedSource === 'USD_M_PERPETUAL'
      && (metadata.contractType !== 'PERPETUAL' || metadata.tradingAllowed !== null))) {
    throw new TypeError('Runtime metadata product identity is internally inconsistent');
  }
  nullableSafeInteger(metadata.onboardDateMs, 'metadata.onboardDateMs');
  nullableSafeInteger(metadata.deliveryDateMs, 'metadata.deliveryDateMs');
  nullableString(metadata.marginAsset, 'metadata.marginAsset');
  nullableString(metadata.underlyingType, 'metadata.underlyingType');
  const normalizedUnderlyingSubType = stringArray(metadata.underlyingSubType, 'underlyingSubType');
  assertSortedUniqueStrings(normalizedUnderlyingSubType, 'underlyingSubType');
  const normalizedExclusionReasons = stringArray(metadata.exclusionReasonCodes, 'exclusionReasonCodes');
  assertSortedUniqueStrings(normalizedExclusionReasons, 'exclusionReasonCodes');
  precisionRecord(metadata.precisions);
  if (typeof metadata.includedInUniverse !== 'boolean') throw new TypeError('includedInUniverse must be boolean');
  const receivedTimeMs = safeInteger(metadata.receivedTimeMs, 'metadata.receivedTimeMs');
  const semantic = semanticMetadata(metadata);
  const expectedId = stableId('runtime-listing-record', { source, symbol });
  const expectedFingerprint = stableId('runtime-listing-metadata', semantic);
  if (metadata.id !== expectedId || metadata.fingerprint !== expectedFingerprint) {
    throw new TypeError('Runtime metadata owner identity or fingerprint mismatch');
  }
  const truth = validateTruthMetadata(metadata.truth);
  const ownerTruth = RUNTIME_OWNER_TRUTH[expectedSource];
  const expectedSourceRecordId = stableId('runtime-exchange-info-row', {
    source,
    fingerprint: expectedFingerprint,
  });
  const requiredObservedFields = [
    'baseAsset', 'contractMetadata', 'filters', 'pair', 'quoteAsset', 'status', 'symbol',
  ];
  if (!truth.ok || truth.value.temporal.receivedTimeMs !== receivedTimeMs
    || truth.value.authority.kind !== 'EXCHANGE_PRIMARY'
    || truth.value.authority.endpointClass !== 'REST'
    || truth.value.schemaVersion !== '1'
    || truth.value.producerVersion !== 'live-intelligence-universe-1'
    || truth.value.featureVersion !== null
    || truth.value.authority.sourceId !== ownerTruth.sourceId
    || truth.value.authority.dataset !== ownerTruth.dataset
    || truth.value.freshness.basis !== 'RECEIVE_TIME'
    || !Number.isSafeInteger(truth.value.freshness.evaluatedAtMs)
    || !Number.isSafeInteger(truth.value.freshness.ageMs)
    || !Number.isSafeInteger(truth.value.freshness.maxAgeMs)
    || (truth.value.freshness.maxAgeMs as number) < 1
    || truth.value.freshness.ageMs !== truth.value.freshness.evaluatedAtMs - receivedTimeMs
    || truth.value.freshness.state
      !== ((truth.value.freshness.ageMs as number) > (truth.value.freshness.maxAgeMs as number)
        ? 'STALE' : 'FRESH')
    || truth.value.temporal.sourceEventTimeMs !== null
    || truth.value.temporal.sourceTransactionTimeMs !== null
    || truth.value.temporal.sequence !== null
    || truth.value.provenance.sourceRecordIds.length !== 1
    || truth.value.provenance.sourceRecordIds[0] !== expectedSourceRecordId
    || truth.value.provenance.sourceSet.length !== 1
    || truth.value.provenance.sourceSet[0] !== ownerTruth.sourceId
    || truth.value.provenance.transforms.length !== 1
    || truth.value.provenance.transforms[0] !== 'normalize-public-exchange-info-v1'
    || requiredObservedFields.some((field) => !truth.value.completeness.observedFields.includes(field))) {
    throw new TypeError('Runtime metadata truth is invalid or not exchange-primary REST evidence');
  }
  const normalizedFilters = normalizeFilters(product, metadata.filters);
  const filters = normalizedFilters.filters;
  const capabilities = normalizeInstrumentCapabilities(product, metadata.orderTypes, metadata.timeInForce);
  const normalizedPermissionSets = permissionSets(metadata.permissionSets);
  const effectiveMaximumAgeMs = Math.min(maximumAgeMs, truth.value.freshness.maxAgeMs as number);
  const ageMs = evaluatedAtMs - receivedTimeMs;
  const validUntil = receivedTimeMs + effectiveMaximumAgeMs;
  if (!Number.isSafeInteger(validUntil)) throw new RangeError('source validity boundary overflow');
  let normalizationState: InstrumentNormalizationState = 'READY_STATIC_ONLY';
  const losses = [...requiredInstrumentLossCodes(product, capabilities.advertised, capabilities.timeInForce)];
  if (normalizedFilters.reasonCodes.length > 0) {
    normalizationState = 'BLOCKED_SOURCE';
    losses.push(...normalizedFilters.reasonCodes);
  }
  if (ageMs < -FUTURE_SKEW_MS) {
    normalizationState = 'BLOCKED_SOURCE';
    losses.push('SOURCE_CLOCK_SKEWED');
  } else if (ageMs > effectiveMaximumAgeMs || truth.value.freshness.state !== 'FRESH') {
    normalizationState = 'BLOCKED_SOURCE';
    losses.push('SOURCE_STALE_OR_UNAVAILABLE');
  }
  if (truth.value.completeness.state !== 'COMPLETE') {
    normalizationState = 'BLOCKED_SOURCE';
    losses.push('SOURCE_INCOMPLETE');
  }
  if (metadata.includedInUniverse !== true) {
    normalizationState = 'BLOCKED_SOURCE';
    losses.push('SOURCE_EXCLUDED_FROM_OWNER_UNIVERSE');
  }
  if (status !== 'TRADING') {
    normalizationState = 'BLOCKED_SOURCE';
    losses.push('SYMBOL_NOT_TRADING');
  }
  if (product === 'SPOT' && metadata.tradingAllowed !== true) {
    normalizationState = 'BLOCKED_SOURCE';
    losses.push('SPOT_TRADING_NOT_PROVED');
  }
  if (product === 'MARGIN') normalizationState = 'BLOCKED_OWNER_TRUTH';
  const sourceHashSha256 = createHash('sha256').update(canonicalJson(semantic)).digest('hex');
  const normalizedLosses = sortedUnique(losses);
  const revisionMaterial = {
    contractId,
    product,
    environment: 'PRODUCTION' as const,
    symbol,
    pair,
    baseAsset,
    quoteAsset,
    status,
    tradingAllowed: product === 'MARGIN' ? null : metadata.tradingAllowed as boolean | null,
    contractType: metadata.contractType as string | null,
    contractSize: null,
    advertisedOrderTypes: capabilities.advertised,
    staticOrderTypes: capabilities.staticTypes,
    allowedTimeInForce: capabilities.timeInForce,
    permissionSets: normalizedPermissionSets,
    filters,
    sourceMetadataId: expectedId,
    sourceAuthorityId: truth.value.authority.sourceId,
    sourceDataset: truth.value.authority.dataset,
    sourceFingerprint: expectedFingerprint,
    sourceHashSha256,
    sourceMaximumAgeMs: effectiveMaximumAgeMs,
    normalizationState,
    lossCodes: normalizedLosses,
  };
  const instrumentRevision = deriveInstrumentRevision(L04_BINANCE_MATRIX_SHA256, revisionMaterial);
  const sourceEvidenceRevision = deriveInstrumentEvidenceRevision({
    instrumentRevision,
    sourceMetadataId: expectedId,
    sourceAuthorityId: truth.value.authority.sourceId,
    sourceDataset: truth.value.authority.dataset,
    sourceFingerprint: expectedFingerprint,
    sourceHashSha256,
    sourceReceivedAtMs: receivedTimeMs,
    sourceMaximumAgeMs: effectiveMaximumAgeMs,
    sourceValidUntilMs: validUntil,
  });
  return deepFreeze({
    schema: BINANCE_INSTRUMENT_REGISTRY_SCHEMA,
    product,
    environment: 'PRODUCTION' as const,
    contractId,
    symbol,
    pair,
    baseAsset,
    quoteAsset,
    status,
    tradingAllowed: product === 'MARGIN' ? null : metadata.tradingAllowed as boolean | null,
    contractType: metadata.contractType as string | null,
    contractSize: null,
    advertisedOrderTypes: capabilities.advertised,
    staticOrderTypes: capabilities.staticTypes,
    allowedTimeInForce: capabilities.timeInForce,
    permissionSets: normalizedPermissionSets,
    filters,
    sourceMetadataId: expectedId,
    sourceAuthorityId: truth.value.authority.sourceId,
    sourceDataset: truth.value.authority.dataset,
    sourceFingerprint: expectedFingerprint,
    sourceHashSha256,
    sourceReceivedAtMs: receivedTimeMs,
    sourceMaximumAgeMs: effectiveMaximumAgeMs,
    sourceValidUntilMs: validUntil,
    sourceEvidenceRevision,
    normalizationState,
    lossCodes: normalizedLosses,
    instrumentRevision,
    documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY' as const,
    externalActionAuthorization: 'NONE' as const,
    actionAuthority: 'NONE_RECORD_ONLY' as const,
  });
}

export function normalizeRuntimeInstrumentRegistry(inputValue: unknown): NormalizeRuntimeInstrumentRegistryResult {
  try {
    const snapshot = safeSnapshot(inputValue);
    const input = record(snapshot, INPUT_FIELDS, 'instrument registry input');
    const resolved = resolveInstrumentContract(input.matrixSha256, input.contractId, input.product, input.environment);
    if (!resolved.ok) return deepFreeze({ ok: false as const, reasonCodes: [resolved.code] });
    const evaluatedAtMs = safeInteger(input.evaluatedAtMs, 'evaluatedAtMs');
    const maximumAgeMs = safeInteger(input.maximumAgeMs, 'maximumAgeMs', 1, 300_000);
    if (!Array.isArray(input.metadata) || input.metadata.length === 0 || input.metadata.length > MAXIMUM_METADATA) {
      return deepFreeze({ ok: false as const, reasonCodes: ['METADATA_COUNT_INVALID'] });
    }
    const instruments = input.metadata.map((metadata) => normalizeOne(
      resolved.contract.product,
      resolved.contract.contractId,
      metadata,
      evaluatedAtMs,
      maximumAgeMs,
    )).sort((left, right) => codePointCompare(left.symbol, right.symbol));
    const seen = new Set<string>();
    for (const instrument of instruments) {
      if (seen.has(instrument.symbol)) return deepFreeze({ ok: false as const, reasonCodes: ['DUPLICATE_SYMBOL'] });
      seen.add(instrument.symbol);
    }
    const registryRevision = deriveRegistryRevision({
      matrixSha256: L04_BINANCE_MATRIX_SHA256,
      contractId: resolved.contract.contractId,
      product: resolved.contract.product,
      environment: resolved.contract.environment,
      instruments,
    });
    const snapshotRevision = deriveSnapshotRevision({
      registryRevision,
      evaluatedAtMs,
      maximumAgeMs,
      instruments,
    });
    const registry: BinanceInstrumentRegistrySnapshot = {
      schema: BINANCE_INSTRUMENT_REGISTRY_SCHEMA,
      product: resolved.contract.product,
      environment: 'PRODUCTION',
      contractId: resolved.contract.contractId,
      matrixSha256: L04_BINANCE_MATRIX_SHA256,
      evaluatedAtMs,
      maximumAgeMs,
      registryRevision,
      snapshotRevision,
      instruments,
      documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY',
      externalActionAuthorization: 'NONE',
      actionAuthority: 'NONE_RECORD_ONLY',
    };
    return deepFreeze({ ok: true as const, snapshot: registry });
  } catch {
    return deepFreeze({ ok: false as const, reasonCodes: ['INSTRUMENT_METADATA_REJECTED'] });
  }
}
