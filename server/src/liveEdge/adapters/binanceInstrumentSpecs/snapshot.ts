import { types as utilTypes } from 'node:util';

import { canonicalJson, stableId } from '../../../intelligenceFoundation/contracts/index.js';
import {
  normalizeInstrumentCapabilities,
  requiredInstrumentLossCodes,
} from './capabilities.js';
import { resolveInstrumentContract } from './contract.js';
import {
  instrumentFilterDefinitions,
  validateActiveNormalizedFilter,
} from './filterSchemas.js';
import {
  BINANCE_INSTRUMENT_REGISTRY_SCHEMA,
  type BinanceInstrumentRegistrySnapshot,
  type BinanceInstrumentSpec,
  type NormalizedInstrumentFilter,
} from './types.js';

const SNAPSHOT_FIELDS = Object.freeze([
  'schema', 'product', 'environment', 'contractId', 'matrixSha256',
  'evaluatedAtMs', 'maximumAgeMs', 'registryRevision', 'snapshotRevision', 'instruments',
  'documentaryAuthority', 'externalActionAuthorization', 'actionAuthority',
] as const);

const INSTRUMENT_FIELDS = Object.freeze([
  'schema', 'product', 'environment', 'contractId', 'symbol', 'pair', 'baseAsset',
  'quoteAsset', 'status', 'tradingAllowed', 'contractType', 'contractSize',
  'advertisedOrderTypes', 'staticOrderTypes', 'allowedTimeInForce',
  'permissionSets', 'filters', 'sourceMetadataId', 'sourceAuthorityId',
  'sourceDataset', 'sourceFingerprint',
  'sourceHashSha256', 'sourceReceivedAtMs', 'sourceMaximumAgeMs', 'sourceValidUntilMs',
  'sourceEvidenceRevision',
  'normalizationState', 'lossCodes', 'instrumentRevision',
  'documentaryAuthority', 'externalActionAuthorization', 'actionAuthority',
] as const);

const FILTER_FIELDS = Object.freeze([
  'filterType', 'state', 'reasonCodes', 'values', 'sourceContentSha256',
  'privateTruthRequired', 'dynamicReferenceRequired',
] as const);

const FILTER_STATES = Object.freeze([
  'ACTIVE', 'BLOCKED_DISABLED', 'BLOCKED_MALFORMED', 'BLOCKED_UNSUPPORTED',
  'BLOCKED_CONTRADICTORY', 'BLOCKED_DUPLICATE',
] as const);

const NORMALIZATION_STATES = Object.freeze([
  'READY_STATIC_ONLY', 'BLOCKED_SOURCE', 'BLOCKED_OWNER_TRUTH',
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

type PlainRecord = Readonly<Record<string, unknown>>;

type InstrumentRevisionProjection = Pick<BinanceInstrumentSpec,
  'contractId' | 'product' | 'environment' | 'symbol' | 'pair' | 'baseAsset'
  | 'quoteAsset' | 'status' | 'tradingAllowed' | 'contractType' | 'contractSize'
  | 'advertisedOrderTypes' | 'staticOrderTypes' | 'allowedTimeInForce'
  | 'permissionSets' | 'filters' | 'sourceMetadataId' | 'sourceAuthorityId'
  | 'sourceDataset' | 'sourceFingerprint' | 'sourceHashSha256'
  | 'sourceMaximumAgeMs' | 'normalizationState' | 'lossCodes'>;

function record(value: unknown, fields: readonly string[], label: string): PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || utilTypes.isProxy(value)) {
    throw new TypeError(`${label} must be a plain record`);
  }
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.some((key) => typeof key !== 'string')
    || keys.length !== fields.length
    || keys.some((key) => !fields.includes(key as string))
    || Object.values(descriptors).some((descriptor) => !descriptor.enumerable
      || !Object.hasOwn(descriptor, 'value'))) {
    throw new TypeError(`${label} must use exact enumerable own data fields`);
  }
  return value as PlainRecord;
}

function text(value: unknown, label: string, maximum = 256): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum
    || value.trim() !== value
    || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value)) {
    throw new TypeError(`${label} must be bounded safe text`);
  }
  return value;
}

function instrumentToken(value: unknown, label: string): string {
  const token = text(value, label);
  if (token !== token.normalize('NFC').toUpperCase()
    || !/^[\p{L}\p{N}._-]+$/u.test(token)) {
    throw new TypeError(`${label} instrument token invalid`);
  }
  return token;
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${label} must be a bounded safe integer`);
  }
  return value;
}

function strings(value: unknown, label: string, maximum = 512): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) throw new TypeError(`${label} must be bounded`);
  return value.map((entry, index) => text(entry, `${label}[${index}]`));
}

function sortedUniqueStrings(value: unknown, label: string, maximum = 512): readonly string[] {
  const output = strings(value, label, maximum);
  for (let index = 1; index < output.length; index += 1) {
    if (output[index - 1] >= output[index]) throw new TypeError(`${label} must be sorted and unique`);
  }
  return output;
}

function assertFrozenPlainGraph(value: unknown): void {
  const seen = new Set<object>();
  let nodes = 0;
  let stringUnits = 0;
  const visit = (candidate: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > 4_000_000 || depth > 12) throw new RangeError('snapshot graph exceeds its bound');
    if (candidate === null || typeof candidate === 'boolean') return;
    if (typeof candidate === 'string') {
      if (candidate.length > 8_192) throw new RangeError('snapshot string exceeds its bound');
      stringUnits += candidate.length;
      if (stringUnits > 32 * 1_024 * 1_024) throw new RangeError('snapshot strings exceed the aggregate bound');
      return;
    }
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) throw new TypeError('snapshot contains a non-finite number');
      return;
    }
    if (typeof candidate !== 'object' || utilTypes.isProxy(candidate)) throw new TypeError('snapshot must be plain data');
    if (seen.has(candidate)) throw new TypeError('snapshot cannot contain cycles or aliases');
    seen.add(candidate);
    if (!Object.isFrozen(candidate)) throw new TypeError('snapshot must be deeply immutable');
    const prototype = Object.getPrototypeOf(candidate);
    if (Array.isArray(candidate)) {
      if (prototype !== Array.prototype || candidate.length > 131_072) throw new TypeError('snapshot array invalid');
    } else if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('snapshot object invalid');
    }
    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== 'string')) throw new TypeError('snapshot symbol key rejected');
    if (!Array.isArray(candidate) && keys.length > 4_096) throw new RangeError('snapshot object key count exceeds its bound');
    for (const key of keys as string[]) {
      if (key.length > 256) throw new RangeError('snapshot key exceeds its bound');
      stringUnits += key.length;
      if (stringUnits > 32 * 1_024 * 1_024) throw new RangeError('snapshot strings exceed the aggregate bound');
    }
    if (Array.isArray(candidate)
      && (keys.length !== candidate.length + 1
        || keys.some((key) => key !== 'length'
          && (!/^(?:0|[1-9]\d*)$/.test(key as string)
            || Number(key) >= candidate.length)))) {
      throw new TypeError('snapshot arrays must be dense without named properties');
    }
    for (const key of keys as string[]) {
      if (Array.isArray(candidate) && key === 'length') continue;
      const descriptor = descriptors[key];
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('snapshot accessors and hidden fields rejected');
      }
      visit(descriptor.value, depth + 1);
    }
  };
  visit(value, 0);
}

export function deriveInstrumentRevision(
  matrixSha256: string,
  instrument: InstrumentRevisionProjection,
): string {
  return stableId('l04-instrument-spec', {
    schema: BINANCE_INSTRUMENT_REGISTRY_SCHEMA,
    matrixSha256,
    contractId: instrument.contractId,
    product: instrument.product,
    environment: instrument.environment,
    symbol: instrument.symbol,
    pair: instrument.pair,
    baseAsset: instrument.baseAsset,
    quoteAsset: instrument.quoteAsset,
    status: instrument.status,
    tradingAllowed: instrument.tradingAllowed,
    contractType: instrument.contractType,
    contractSize: instrument.contractSize,
    advertisedOrderTypes: instrument.advertisedOrderTypes,
    staticOrderTypes: instrument.staticOrderTypes,
    allowedTimeInForce: instrument.allowedTimeInForce,
    permissionSets: instrument.permissionSets,
    filters: instrument.filters,
    sourceMetadataId: instrument.sourceMetadataId,
    sourceAuthorityId: instrument.sourceAuthorityId,
    sourceDataset: instrument.sourceDataset,
    sourceFingerprint: instrument.sourceFingerprint,
    sourceHashSha256: instrument.sourceHashSha256,
    sourceMaximumAgeMs: instrument.sourceMaximumAgeMs,
    normalizationState: instrument.normalizationState,
    lossCodes: instrument.lossCodes,
  });
}

export function deriveRegistryRevision(input: Pick<BinanceInstrumentRegistrySnapshot,
  'matrixSha256' | 'contractId' | 'product' | 'environment' | 'instruments'>): string {
  return stableId('l04-instrument-registry', {
    schema: BINANCE_INSTRUMENT_REGISTRY_SCHEMA,
    matrixSha256: input.matrixSha256,
    contractId: input.contractId,
    product: input.product,
    environment: input.environment,
    instrumentRevisions: input.instruments.map((instrument) => instrument.instrumentRevision),
  });
}

export function deriveInstrumentEvidenceRevision(instrument: Pick<BinanceInstrumentSpec,
  'instrumentRevision' | 'sourceMetadataId' | 'sourceAuthorityId' | 'sourceDataset'
  | 'sourceFingerprint' | 'sourceHashSha256' | 'sourceReceivedAtMs'
  | 'sourceMaximumAgeMs' | 'sourceValidUntilMs'>): string {
  return stableId('l04-instrument-source-evidence', {
    instrumentRevision: instrument.instrumentRevision,
    sourceMetadataId: instrument.sourceMetadataId,
    sourceAuthorityId: instrument.sourceAuthorityId,
    sourceDataset: instrument.sourceDataset,
    sourceFingerprint: instrument.sourceFingerprint,
    sourceHashSha256: instrument.sourceHashSha256,
    sourceReceivedAtMs: instrument.sourceReceivedAtMs,
    sourceMaximumAgeMs: instrument.sourceMaximumAgeMs,
    sourceValidUntilMs: instrument.sourceValidUntilMs,
  });
}

export function deriveSnapshotRevision(input: Pick<BinanceInstrumentRegistrySnapshot,
  'registryRevision' | 'evaluatedAtMs' | 'maximumAgeMs' | 'instruments'>): string {
  return stableId('l04-instrument-registry-snapshot', {
    registryRevision: input.registryRevision,
    evaluatedAtMs: input.evaluatedAtMs,
    maximumAgeMs: input.maximumAgeMs,
    sourceEvidenceRevisions: input.instruments.map((instrument) => instrument.sourceEvidenceRevision),
  });
}

function validateFilter(value: unknown, label: string): NormalizedInstrumentFilter {
  const filter = record(value, FILTER_FIELDS, label);
  text(filter.filterType, `${label}.filterType`, 128);
  if (!FILTER_STATES.includes(filter.state as (typeof FILTER_STATES)[number])) {
    throw new TypeError(`${label}.state invalid`);
  }
  const reasonCodes = strings(filter.reasonCodes, `${label}.reasonCodes`);
  if (typeof filter.values !== 'object' || filter.values === null || Array.isArray(filter.values)) {
    throw new TypeError(`${label}.values invalid`);
  }
  if (filter.state !== 'ACTIVE' && Object.keys(filter.values).length !== 0) {
    throw new TypeError(`${label} blocked values must remain an empty non-actionable projection`);
  }
  if (typeof filter.sourceContentSha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(filter.sourceContentSha256)) {
    throw new TypeError(`${label}.sourceContentSha256 invalid`);
  }
  if (typeof filter.privateTruthRequired !== 'boolean'
    || typeof filter.dynamicReferenceRequired !== 'boolean') {
    throw new TypeError(`${label} truth flags invalid`);
  }
  if ((filter.state === 'ACTIVE' && reasonCodes.length !== 0)
    || (filter.state !== 'ACTIVE' && reasonCodes.length === 0)) {
    throw new TypeError(`${label} state and reasons conflict`);
  }
  return value as NormalizedInstrumentFilter;
}

function validateInstrument(
  value: unknown,
  snapshot: PlainRecord,
  index: number,
): BinanceInstrumentSpec {
  const label = `snapshot.instruments[${index}]`;
  const instrument = record(value, INSTRUMENT_FIELDS, label);
  if (instrument.schema !== BINANCE_INSTRUMENT_REGISTRY_SCHEMA
    || instrument.product !== snapshot.product
    || instrument.environment !== snapshot.environment
    || instrument.contractId !== snapshot.contractId
    || instrument.documentaryAuthority !== 'DOCUMENTARY_EVIDENCE_ONLY'
    || instrument.externalActionAuthorization !== 'NONE'
    || instrument.actionAuthority !== 'NONE_RECORD_ONLY'
    || instrument.contractSize !== null) {
    throw new TypeError(`${label} identity or authority invalid`);
  }
  for (const field of [
    'status', 'sourceMetadataId',
    'sourceAuthorityId', 'sourceDataset', 'sourceFingerprint', 'instrumentRevision',
    'sourceEvidenceRevision',
  ] as const) text(instrument[field], `${label}.${field}`);
  for (const field of ['symbol', 'pair', 'baseAsset', 'quoteAsset'] as const) {
    instrumentToken(instrument[field], `${label}.${field}`);
  }
  if (instrument.contractType !== null) text(instrument.contractType, `${label}.contractType`);
  if (instrument.tradingAllowed !== null && typeof instrument.tradingAllowed !== 'boolean') {
    throw new TypeError(`${label}.tradingAllowed invalid`);
  }
  const advertised = sortedUniqueStrings(instrument.advertisedOrderTypes, `${label}.advertisedOrderTypes`);
  const staticTypes = sortedUniqueStrings(instrument.staticOrderTypes, `${label}.staticOrderTypes`);
  if (staticTypes.some((orderType) => !advertised.includes(orderType))) {
    throw new TypeError(`${label}.staticOrderTypes not advertised`);
  }
  sortedUniqueStrings(instrument.allowedTimeInForce, `${label}.allowedTimeInForce`);
  sortedUniqueStrings(instrument.lossCodes, `${label}.lossCodes`);
  if (!Array.isArray(instrument.permissionSets) || instrument.permissionSets.length > 128) {
    throw new TypeError(`${label}.permissionSets invalid`);
  }
  instrument.permissionSets.forEach((permissionSet, setIndex) => {
    strings(permissionSet, `${label}.permissionSets[${setIndex}]`);
  });
  if (!Array.isArray(instrument.filters) || instrument.filters.length > 128) {
    throw new TypeError(`${label}.filters invalid`);
  }
  const filters = instrument.filters.map((filter, filterIndex) => validateFilter(filter, `${label}.filters[${filterIndex}]`));
  if (typeof instrument.sourceHashSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(instrument.sourceHashSha256)) {
    throw new TypeError(`${label}.sourceHashSha256 invalid`);
  }
  const received = integer(instrument.sourceReceivedAtMs, `${label}.sourceReceivedAtMs`);
  const maximumAge = integer(instrument.sourceMaximumAgeMs, `${label}.sourceMaximumAgeMs`, 1);
  const validUntil = integer(instrument.sourceValidUntilMs, `${label}.sourceValidUntilMs`);
  if (maximumAge > (snapshot.maximumAgeMs as number)
    || maximumAge > 300_000
    || validUntil !== received + maximumAge
    || !Number.isSafeInteger(received + maximumAge)) {
    throw new TypeError(`${label} source validity invalid`);
  }
  if (!NORMALIZATION_STATES.includes(instrument.normalizationState as (typeof NORMALIZATION_STATES)[number])) {
    throw new TypeError(`${label}.normalizationState invalid`);
  }
  const allowedFilterTypes = Object.keys(instrumentFilterDefinitions(instrument.product as BinanceInstrumentSpec['product']));
  const filterCounts = new Map<string, number>();
  for (const filter of filters) {
    filterCounts.set(filter.filterType, (filterCounts.get(filter.filterType) ?? 0) + 1);
    if (!allowedFilterTypes.includes(filter.filterType) && filter.state !== 'BLOCKED_UNSUPPORTED') {
      throw new TypeError(`${label} unknown filter cannot claim a supported state`);
    }
  }
  if (instrument.normalizationState === 'READY_STATIC_ONLY') {
    if (filters.some((filter) => filter.state !== 'ACTIVE')
      || [...filterCounts.values()].some((count) => count !== 1)
      || !filterCounts.has('PRICE_FILTER')
      || !filterCounts.has('LOT_SIZE')
      || (instrument.product === 'USD_M_PERPETUAL' && !filterCounts.has('MIN_NOTIONAL'))
      || (instrument.product !== 'USD_M_PERPETUAL'
        && !filterCounts.has('MIN_NOTIONAL') && !filterCounts.has('NOTIONAL'))) {
      throw new TypeError(`${label} ready state conflicts with filter posture`);
    }
  }
  const typed = value as BinanceInstrumentSpec;
  const runtimeSource = typed.product === 'USD_M_PERPETUAL' ? 'USD_M_PERPETUAL' : 'SPOT';
  const ownerTruth = RUNTIME_OWNER_TRUTH[runtimeSource];
  const capabilities = normalizeInstrumentCapabilities(
    typed.product,
    typed.advertisedOrderTypes,
    typed.allowedTimeInForce,
  );
  const mandatoryLosses = requiredInstrumentLossCodes(
    typed.product,
    capabilities.advertised,
    capabilities.timeInForce,
  );
  const expectedMetadataId = stableId('runtime-listing-record', {
    source: runtimeSource,
    symbol: typed.symbol,
  });
  if (typed.sourceAuthorityId !== ownerTruth.sourceId
    || typed.sourceDataset !== ownerTruth.dataset
    || typed.sourceMetadataId !== expectedMetadataId
    || typed.symbol !== typed.pair
    || typed.pair !== `${typed.baseAsset}${typed.quoteAsset}`
    || canonicalJson(typed.staticOrderTypes) !== canonicalJson(capabilities.staticTypes)
    || mandatoryLosses.some((loss) => !typed.lossCodes.includes(loss))
    || (typed.product !== 'USD_M_PERPETUAL' && typed.contractType !== null)
    || (typed.product === 'USD_M_PERPETUAL'
      && (typed.contractType !== 'PERPETUAL' || typed.tradingAllowed !== null))
    || (typed.product === 'MARGIN'
      && (typed.tradingAllowed !== null || typed.normalizationState !== 'BLOCKED_OWNER_TRUTH'))
    || (typed.normalizationState === 'READY_STATIC_ONLY'
      && (typed.status !== 'TRADING'
        || canonicalJson(typed.lossCodes) !== canonicalJson(mandatoryLosses)
        || (typed.product === 'SPOT' && typed.tradingAllowed !== true)
        || (snapshot.evaluatedAtMs as number) < typed.sourceReceivedAtMs - 2_000
        || (snapshot.evaluatedAtMs as number) > typed.sourceValidUntilMs))) {
    throw new TypeError(`${label} product or source-owner posture invalid`);
  }
  for (let filterIndex = 1; filterIndex < filters.length; filterIndex += 1) {
    const previous = filters[filterIndex - 1];
    const current = filters[filterIndex];
    if (previous.filterType > current.filterType
      || (previous.filterType === current.filterType
        && previous.sourceContentSha256 > current.sourceContentSha256)) {
      throw new TypeError(`${label}.filters must use canonical order`);
    }
  }
  for (const filter of filters) {
    if (filter.state === 'ACTIVE') validateActiveNormalizedFilter(typed.product, filter);
  }
  if (deriveInstrumentRevision(snapshot.matrixSha256 as string, typed) !== typed.instrumentRevision) {
    throw new TypeError(`${label}.instrumentRevision mismatch`);
  }
  if (deriveInstrumentEvidenceRevision(typed) !== typed.sourceEvidenceRevision) {
    throw new TypeError(`${label}.sourceEvidenceRevision mismatch`);
  }
  return typed;
}

export function validateInstrumentRegistrySnapshot(value: unknown): BinanceInstrumentRegistrySnapshot {
  assertFrozenPlainGraph(value);
  const snapshot = record(value, SNAPSHOT_FIELDS, 'registry snapshot');
  if (snapshot.schema !== BINANCE_INSTRUMENT_REGISTRY_SCHEMA
    || snapshot.environment !== 'PRODUCTION'
    || snapshot.documentaryAuthority !== 'DOCUMENTARY_EVIDENCE_ONLY'
    || snapshot.externalActionAuthorization !== 'NONE'
    || snapshot.actionAuthority !== 'NONE_RECORD_ONLY'
    || !Array.isArray(snapshot.instruments)
    || snapshot.instruments.length === 0
    || snapshot.instruments.length > 10_000) {
    throw new TypeError('registry snapshot identity or authority invalid');
  }
  text(snapshot.contractId, 'snapshot.contractId');
  text(snapshot.matrixSha256, 'snapshot.matrixSha256');
  text(snapshot.registryRevision, 'snapshot.registryRevision');
  text(snapshot.snapshotRevision, 'snapshot.snapshotRevision');
  integer(snapshot.evaluatedAtMs, 'snapshot.evaluatedAtMs');
  const maximumAgeMs = integer(snapshot.maximumAgeMs, 'snapshot.maximumAgeMs', 1);
  if (maximumAgeMs > 300_000) throw new TypeError('snapshot.maximumAgeMs exceeds the L04 bound');
  const contract = resolveInstrumentContract(
    snapshot.matrixSha256,
    snapshot.contractId,
    snapshot.product,
    snapshot.environment,
  );
  if (!contract.ok) throw new TypeError('registry snapshot contract invalid');
  const instruments = snapshot.instruments.map((instrument, index) => validateInstrument(instrument, snapshot, index));
  for (let index = 1; index < instruments.length; index += 1) {
    if (instruments[index - 1].symbol >= instruments[index].symbol) {
      throw new TypeError('registry instruments must be sorted with unique symbols');
    }
  }
  const typed = value as BinanceInstrumentRegistrySnapshot;
  if (deriveRegistryRevision(typed) !== typed.registryRevision) {
    throw new TypeError('registry revision mismatch');
  }
  if (deriveSnapshotRevision(typed) !== typed.snapshotRevision) {
    throw new TypeError('snapshot revision mismatch');
  }
  return typed;
}
