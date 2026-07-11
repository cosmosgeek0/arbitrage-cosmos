import {
  COMPLETENESS_STATES,
  EVIDENCE_KINDS,
  EVIDENCE_POLARITIES,
  FAILURE_CODES,
  FORENSIC_VERDICTS,
  FRESHNESS_BASES,
  FRESHNESS_STATES,
  HYPOTHESIS_CLASSES,
  MARKET_STAGES,
  PRODUCT_FAMILIES,
  SOURCE_AUTHORITIES,
  SOURCE_ENDPOINT_CLASSES,
} from './constants.js';
import { sortedUnique, stableId } from './ids.js';
import type {
  FrozenPreEventRecord,
  InstrumentIdentity,
  NormalizedEvidence,
  StableFailure,
  TruthMetadata,
  ValidationResult,
} from './types.js';

const FORBIDDEN_SECRET_KEY = /(?:^|[_-])(?:api[_-]?(?:key|secret)|secret|signature|authorization|password|passphrase|private[_-]?key|cookie|credentials?|auth[_-]?token|access[_-]?token|refresh[_-]?token|session[_-]?token|aws[_-]?(?:secret|access[_-]?key))(?:$|[_-])/i;

function isForbiddenSecretKey(key: string): boolean {
  if (FORBIDDEN_SECRET_KEY.test(key)) return true;
  const compact = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return [
    'apikey', 'apisecret', 'authorization', 'authtoken', 'accesstoken', 'refreshtoken',
    'sessiontoken', 'privatekey', 'password', 'passphrase', 'signature', 'credentials',
    'awssecretaccesskey',
  ].some((fragment) => compact.includes(fragment));
}

const has = <T extends readonly string[]>(values: T, value: unknown): value is T[number] =>
  typeof value === 'string' && (values as readonly string[]).includes(value);

export function makeStableFailure(
  code: StableFailure['code'],
  component: string,
  message: string,
  field: string | null,
  evidenceIds: string[] = [],
): StableFailure {
  const boundedComponent = component.slice(0, 96);
  const boundedMessage = message.slice(0, 256);
  const boundedField = field === null ? null : field.slice(0, 256);
  const semantic = { code, component: boundedComponent, message: boundedMessage, field: boundedField, evidenceIds: sortedUnique(evidenceIds).slice(0, 256) };
  return {
    id: stableId('failure', semantic),
    code,
    component: boundedComponent,
    message: boundedMessage,
    retryable: ['MISSING_SOURCE', 'STALE_SOURCE', 'WRONG_ENDPOINT_CLASS', 'SEQUENCE_GAP', 'BUDGET_EXHAUSTED', 'UNAVAILABLE'].includes(code),
    field: boundedField,
    evidenceIds: semantic.evidenceIds,
  };
}

const failure = makeStableFailure;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nonNegativeTime(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function positive(value: unknown): value is number {
  return finite(value) && value > 0;
}

function nullablePositive(value: unknown): boolean {
  return value === null || positive(value);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function findForbiddenSecretField(value: unknown): string | null {
  const seen = new Set<object>();
  let visited = 0;
  const walk = (entry: unknown, path: string, depth: number): string | null => {
    if (depth > 32 || ++visited > 50_000) throw new TypeError(`contract structure exceeds validation limits at ${path}`);
    if (entry === null || typeof entry !== 'object') return null;
    if (seen.has(entry)) throw new TypeError(`cyclic contract structure at ${path}`);
    seen.add(entry);
    if (Array.isArray(entry)) {
      for (let index = 0; index < entry.length; index += 1) {
        const found = walk(entry[index], `${path}[${index}]`, depth + 1);
        if (found) return found;
      }
      seen.delete(entry);
      return null;
    }
    for (const [key, child] of Object.entries(entry as Record<string, unknown>)) {
      const next = `${path}.${key}`;
      if (isForbiddenSecretKey(key)) return next;
      const found = walk(child, next, depth + 1);
      if (found) return found;
    }
    seen.delete(entry);
    return null;
  };
  return walk(value, '$', 0);
}

export function validateNoSecretFields(value: unknown, component = 'contracts'): ValidationResult<unknown> {
  let field: string | null;
  try {
    field = findForbiddenSecretField(value);
  } catch {
    return { ok: false, failure: failure('INVALID_VALUE', component, 'contract structure could not be completely inspected', null) };
  }
  if (field) {
    return { ok: false, failure: failure('SECRET_FIELD_REJECTED', component, 'forbidden secret-bearing field rejected', field) };
  }
  return { ok: true, value };
}

export function validateTruthMetadata(value: unknown): ValidationResult<TruthMetadata> {
  const secret = validateNoSecretFields(value, 'truth_metadata');
  if (!secret.ok) return secret as ValidationResult<TruthMetadata>;
  if (!object(value)) return { ok: false, failure: failure('INVALID_VALUE', 'truth_metadata', 'truth metadata must be an object', null) };
  const authority = value.authority;
  const provenance = value.provenance;
  const temporal = value.temporal;
  const freshness = value.freshness;
  const completeness = value.completeness;
  if (
    !nonEmptyString(value.schemaVersion) ||
    !nonEmptyString(value.producerVersion) ||
    !nonEmptyString(value.configurationVersion) ||
    !(value.featureVersion === null || nonEmptyString(value.featureVersion)) ||
    !object(authority) ||
    !has(SOURCE_AUTHORITIES, authority.kind) ||
    !nonEmptyString(authority.sourceId) ||
    !nonEmptyString(authority.dataset) ||
    !has(SOURCE_ENDPOINT_CLASSES, authority.endpointClass)
  ) return { ok: false, failure: failure('INVALID_VALUE', 'truth_metadata', 'invalid authority or version metadata', 'authority') };
  if (!object(provenance) || !stringArray(provenance.sourceRecordIds) || !stringArray(provenance.sourceSet) || !stringArray(provenance.transforms)) {
    return { ok: false, failure: failure('INVALID_VALUE', 'truth_metadata', 'invalid provenance', 'provenance') };
  }
  if (provenance.sourceSet.length === 0 || [...provenance.sourceRecordIds, ...provenance.sourceSet, ...provenance.transforms].some((entry) => entry.trim().length === 0)) {
    return { ok: false, failure: failure('INVALID_VALUE', 'truth_metadata', 'provenance values must be non-empty and sourceSet cannot be empty', 'provenance') };
  }
  if (!object(temporal) || !nonNegativeTime(temporal.receivedTimeMs)) {
    return { ok: false, failure: failure('INVALID_VALUE', 'truth_metadata', 'received time must be a non-negative safe integer', 'temporal.receivedTimeMs') };
  }
  for (const key of ['sourceEventTimeMs', 'sourceTransactionTimeMs'] as const) {
    if (!(temporal[key] === null || nonNegativeTime(temporal[key]))) {
      return { ok: false, failure: failure('INVALID_VALUE', 'truth_metadata', 'source timestamps must be null or non-negative safe integers', `temporal.${key}`) };
    }
  }
  if (temporal.sequence !== null) {
    if (!object(temporal.sequence) || typeof temporal.sequence.first !== 'string' || typeof temporal.sequence.last !== 'string' || !(temporal.sequence.previous === null || typeof temporal.sequence.previous === 'string')) {
      return { ok: false, failure: failure('INVALID_VALUE', 'truth_metadata', 'sequence identifiers must be decimal strings', 'temporal.sequence') };
    }
    const sequence = temporal.sequence as { first: string; last: string; previous: string | null };
    for (const key of ['first', 'last'] as const) {
      if (!/^\d+$/.test(sequence[key])) return { ok: false, failure: failure('INVALID_VALUE', 'truth_metadata', 'sequence identifiers must be decimal strings', `temporal.sequence.${key}`) };
    }
    if (sequence.previous !== null && !/^\d+$/.test(sequence.previous)) {
      return { ok: false, failure: failure('INVALID_VALUE', 'truth_metadata', 'previous sequence must be a decimal string', 'temporal.sequence.previous') };
    }
    if (BigInt(sequence.first) > BigInt(sequence.last)) {
      return { ok: false, failure: failure('INVALID_VALUE', 'truth_metadata', 'sequence first must not exceed last', 'temporal.sequence') };
    }
  }
  if (
    !object(freshness) || !has(FRESHNESS_BASES, freshness.basis) || !has(FRESHNESS_STATES, freshness.state) ||
    !nonNegativeTime(freshness.evaluatedAtMs) || !(freshness.ageMs === null || finite(freshness.ageMs) && freshness.ageMs >= 0) ||
    !(freshness.maxAgeMs === null || finite(freshness.maxAgeMs) && freshness.maxAgeMs >= 0)
  ) return { ok: false, failure: failure('INVALID_VALUE', 'truth_metadata', 'invalid freshness metadata', 'freshness') };
  if (freshness.evaluatedAtMs < temporal.receivedTimeMs) {
    return { ok: false, failure: failure('INVALID_VALUE', 'truth_metadata', 'freshness evaluation cannot precede receipt', 'freshness.evaluatedAtMs') };
  }
  const sourceEventTimeMs = temporal.sourceEventTimeMs as number | null;
  const sourceTransactionTimeMs = temporal.sourceTransactionTimeMs as number | null;
  const receivedTimeMs = temporal.receivedTimeMs as number;
  const basisTime = freshness.basis === 'SOURCE_EVENT_TIME'
    ? sourceEventTimeMs
    : freshness.basis === 'SOURCE_TRANSACTION_TIME'
      ? sourceTransactionTimeMs
      : freshness.basis === 'RECEIVE_TIME'
        ? receivedTimeMs
        : null;
  if (freshness.state === 'FRESH' || freshness.state === 'STALE') {
    if (basisTime === null || freshness.ageMs === null || freshness.maxAgeMs === null || freshness.basis === 'UNAVAILABLE') {
      return { ok: false, failure: failure('INVALID_VALUE', 'truth_metadata', 'fresh or stale truth requires a timestamp basis and age threshold', 'freshness') };
    }
    if (freshness.ageMs !== freshness.evaluatedAtMs - basisTime) {
      return { ok: false, failure: failure('INVALID_VALUE', 'truth_metadata', 'freshness age must match its declared time basis', 'freshness.ageMs') };
    }
    if (freshness.state === 'FRESH' && freshness.ageMs > freshness.maxAgeMs) {
      return { ok: false, failure: failure('INVALID_VALUE', 'truth_metadata', 'fresh truth exceeds its maximum age', 'freshness.state') };
    }
    if (freshness.state === 'STALE' && freshness.ageMs <= freshness.maxAgeMs) {
      return { ok: false, failure: failure('INVALID_VALUE', 'truth_metadata', 'stale truth has not exceeded its maximum age', 'freshness.state') };
    }
  }
  if (freshness.state === 'UNAVAILABLE' && freshness.ageMs !== null) {
    return { ok: false, failure: failure('INVALID_VALUE', 'truth_metadata', 'unavailable truth cannot claim an age', 'freshness.ageMs') };
  }
  if (
    !object(completeness) || !has(COMPLETENESS_STATES, completeness.state) ||
    !stringArray(completeness.observedFields) || !stringArray(completeness.missingFields) || !stringArray(completeness.reasonCodes)
  ) return { ok: false, failure: failure('INVALID_VALUE', 'truth_metadata', 'invalid completeness metadata', 'completeness') };
  if (completeness.state === 'COMPLETE' && completeness.missingFields.length > 0) {
    return { ok: false, failure: failure('INVALID_VALUE', 'truth_metadata', 'complete truth cannot list missing fields', 'completeness.missingFields') };
  }
  if (completeness.state === 'MISSING' && completeness.missingFields.length === 0) {
    return { ok: false, failure: failure('INVALID_VALUE', 'truth_metadata', 'missing truth must name missing fields', 'completeness.missingFields') };
  }
  if ((completeness.state === 'PARTIAL' || completeness.state === 'MISSING') && (completeness.missingFields.length === 0 || completeness.reasonCodes.length === 0)) {
    return { ok: false, failure: failure('INVALID_VALUE', 'truth_metadata', 'partial or missing truth must name missing fields and reasons', 'completeness') };
  }
  const observedFields = sortedUnique(completeness.observedFields);
  const missingFields = sortedUnique(completeness.missingFields);
  if (observedFields.some((field) => missingFields.includes(field))) {
    return { ok: false, failure: failure('INVALID_VALUE', 'truth_metadata', 'a field cannot be both observed and missing', 'completeness') };
  }
  const normalized: TruthMetadata = {
    schemaVersion: value.schemaVersion,
    producerVersion: value.producerVersion,
    configurationVersion: value.configurationVersion,
    featureVersion: value.featureVersion,
    authority: {
      kind: authority.kind,
      sourceId: authority.sourceId,
      dataset: authority.dataset,
      endpointClass: authority.endpointClass,
    },
    provenance: {
      sourceRecordIds: sortedUnique(provenance.sourceRecordIds),
      sourceSet: sortedUnique(provenance.sourceSet),
      transforms: sortedUnique(provenance.transforms),
    },
    temporal: {
      sourceEventTimeMs,
      sourceTransactionTimeMs,
      receivedTimeMs,
      sequence: temporal.sequence as TruthMetadata['temporal']['sequence'],
    },
    freshness: {
      basis: freshness.basis,
      evaluatedAtMs: freshness.evaluatedAtMs,
      ageMs: freshness.ageMs as number | null,
      maxAgeMs: freshness.maxAgeMs as number | null,
      state: freshness.state,
    },
    completeness: {
      state: completeness.state,
      observedFields,
      missingFields,
      reasonCodes: sortedUnique(completeness.reasonCodes),
    },
  };
  return { ok: true, value: normalized };
}

export function validateInstrumentIdentity(value: unknown): ValidationResult<InstrumentIdentity> {
  const secret = validateNoSecretFields(value, 'instrument_identity');
  if (!secret.ok) return secret as ValidationResult<InstrumentIdentity>;
  if (!object(value)) return { ok: false, failure: failure('INVALID_VALUE', 'instrument_identity', 'instrument identity must be an object', null) };
  if (
    !nonEmptyString(value.instrumentId) || !['BINANCE', 'OTHER', 'UNKNOWN'].includes(String(value.venue)) ||
    !has(PRODUCT_FAMILIES, value.productFamily) || !nonEmptyString(value.symbol) ||
    !(value.pair === null || nonEmptyString(value.pair)) || !nonEmptyString(value.baseAsset) ||
    !(value.quoteAsset === null || nonEmptyString(value.quoteAsset)) || !(value.contractType === null || nonEmptyString(value.contractType)) ||
    !(value.sourceMarketType === null || value.sourceMarketType === 1 || value.sourceMarketType === 2)
  ) return { ok: false, failure: failure('INVALID_VALUE', 'instrument_identity', 'invalid instrument identity', null) };
  if (
    (value.productFamily === 'USD_M_PERPETUAL' && value.sourceMarketType !== 1) ||
    (value.productFamily === 'COIN_M_PERPETUAL' && value.sourceMarketType !== 2) ||
    (!['USD_M_PERPETUAL', 'COIN_M_PERPETUAL'].includes(value.productFamily) && value.sourceMarketType !== null)
  ) return { ok: false, failure: failure('INVALID_VALUE', 'instrument_identity', 'product family conflicts with source market type', 'sourceMarketType') };
  if (value.productFamily !== 'BORROW' && value.quoteAsset === null) {
    return { ok: false, failure: failure('INVALID_VALUE', 'instrument_identity', 'non-borrow instruments require a quote asset', 'quoteAsset') };
  }
  return {
    ok: true,
    value: {
      instrumentId: value.instrumentId,
      venue: value.venue as InstrumentIdentity['venue'],
      productFamily: value.productFamily,
      symbol: value.symbol,
      pair: value.pair as string | null,
      baseAsset: value.baseAsset,
      quoteAsset: value.quoteAsset as string | null,
      contractType: value.contractType as string | null,
      sourceMarketType: value.sourceMarketType as 1 | 2 | null,
    },
  };
}

function decimalStringOrNull(value: unknown): boolean {
  return value === null || typeof value === 'string' && /^\d+$/.test(value);
}

function nullableFinite(value: unknown): boolean {
  return value === null || finite(value);
}

function nullableNonNegative(value: unknown): boolean {
  return value === null || finite(value) && value >= 0;
}

function validateLevels(value: unknown, allowZero: boolean, descending: boolean): boolean {
  if (!Array.isArray(value)) return false;
  let previous: number | null = null;
  for (const level of value) {
    if (!object(level) || !positive(level.price) || !finite(level.baseQuantity) || (allowZero ? level.baseQuantity < 0 : level.baseQuantity <= 0)) return false;
    if (previous !== null && (descending ? level.price >= previous : level.price <= previous)) return false;
    previous = level.price;
  }
  return true;
}

function contextValues(value: unknown): value is Record<string, string | number | boolean | null> {
  return object(value) && Object.values(value).every((entry) =>
    entry === null || typeof entry === 'string' || typeof entry === 'boolean' || finite(entry));
}

export function validateNormalizedEvidence(value: unknown): ValidationResult<NormalizedEvidence> {
  const secret = validateNoSecretFields(value, 'normalized_evidence');
  if (!secret.ok) return secret as ValidationResult<NormalizedEvidence>;
  if (!object(value) || !has(EVIDENCE_KINDS, value.kind)) {
    return { ok: false, failure: failure('INVALID_VARIANT', 'normalized_evidence', 'unknown evidence variant', 'kind') };
  }
  if (!nonEmptyString(value.id)) return { ok: false, failure: failure('INVALID_VALUE', 'normalized_evidence', 'evidence id is required', 'id') };
  const instrument = validateInstrumentIdentity(value.instrument);
  if (!instrument.ok) return instrument as ValidationResult<NormalizedEvidence>;
  const truth = validateTruthMetadata(value.truth);
  if (!truth.ok) return truth as ValidationResult<NormalizedEvidence>;
  const common = { id: value.id, instrument: instrument.value, truth: truth.value };
  switch (value.kind) {
    case 'TRADE': {
      if (
        !decimalStringOrNull(value.aggregateTradeId) || !decimalStringOrNull(value.firstTradeId) || !decimalStringOrNull(value.lastTradeId) ||
        !positive(value.price) || !positive(value.baseQuantity) || !positive(value.quoteQuantity) ||
        !nullableNonNegative(value.normalBaseQuantityExcludingRpi) || !['BUY', 'SELL', 'UNKNOWN'].includes(String(value.aggressorSide))
      ) {
        return { ok: false, failure: failure('INVALID_VALUE', 'normalized_evidence', 'invalid trade values', null) };
      }
      if (value.firstTradeId !== null && value.lastTradeId !== null && BigInt(value.firstTradeId as string) > BigInt(value.lastTradeId as string)) {
        return { ok: false, failure: failure('INVALID_VALUE', 'normalized_evidence', 'trade ID range is reversed', 'firstTradeId') };
      }
      const expectedQuote = value.price * value.baseQuantity;
      if (Math.abs(value.quoteQuantity - expectedQuote) > Math.max(1e-9, expectedQuote * 1e-9)) {
        return { ok: false, failure: failure('INVALID_VALUE', 'normalized_evidence', 'quote quantity must equal price times base quantity', 'quoteQuantity') };
      }
      const normalBaseQuantityExcludingRpi = value.normalBaseQuantityExcludingRpi as number | null;
      if (normalBaseQuantityExcludingRpi !== null && normalBaseQuantityExcludingRpi > value.baseQuantity) {
        return { ok: false, failure: failure('INVALID_VALUE', 'normalized_evidence', 'normal base quantity cannot exceed total base quantity', 'normalBaseQuantityExcludingRpi') };
      }
      return { ok: true, value: { ...common, kind: 'TRADE', aggregateTradeId: value.aggregateTradeId as string | null, firstTradeId: value.firstTradeId as string | null, lastTradeId: value.lastTradeId as string | null, price: value.price, baseQuantity: value.baseQuantity, quoteQuantity: value.quoteQuantity, normalBaseQuantityExcludingRpi, aggressorSide: value.aggressorSide as 'BUY' | 'SELL' | 'UNKNOWN' } };
    }
    case 'BOOK_TICKER': {
      if (!decimalStringOrNull(value.updateId) || !positive(value.bidPrice) || !positive(value.askPrice) || !positive(value.bidQuantity) || !positive(value.askQuantity)) {
        return { ok: false, failure: failure('INVALID_VALUE', 'normalized_evidence', 'invalid book ticker values', null) };
      }
      if (value.bidPrice >= value.askPrice) return { ok: false, failure: failure('CROSSED_BOOK', 'normalized_evidence', 'best bid must be below best ask', null, [value.id]) };
      return { ok: true, value: { ...common, kind: 'BOOK_TICKER', updateId: value.updateId as string | null, bidPrice: value.bidPrice, bidQuantity: value.bidQuantity, askPrice: value.askPrice, askQuantity: value.askQuantity } };
    }
    case 'DEPTH_SNAPSHOT':
    case 'DEPTH_DELTA': {
      const allowZero = value.kind === 'DEPTH_DELTA';
      if (
        !validateLevels(value.bids, allowZero, true) || !validateLevels(value.asks, allowZero, false) ||
        !['STANDARD_NO_RPI', 'RPI_INCLUDED', 'UNKNOWN'].includes(String(value.bookScope)) ||
        !(value.maximumLevelsKnown === null || positiveSafeInteger(value.maximumLevelsKnown)) ||
        truth.value.temporal.sequence === null
      ) {
        return { ok: false, failure: failure('INVALID_VALUE', 'normalized_evidence', 'invalid depth values', null) };
      }
      const bids = value.bids as { price: number; baseQuantity: number }[];
      const asks = value.asks as { price: number; baseQuantity: number }[];
      if (value.kind === 'DEPTH_SNAPSHOT' && bids.length > 0 && asks.length > 0 && bids[0].price >= asks[0].price) {
        return { ok: false, failure: failure('CROSSED_BOOK', 'normalized_evidence', 'depth best bid must be below best ask', null, [value.id]) };
      }
      return { ok: true, value: { ...common, kind: value.kind, bids: bids.map((level) => ({ ...level })), asks: asks.map((level) => ({ ...level })), bookScope: value.bookScope as 'STANDARD_NO_RPI' | 'RPI_INCLUDED' | 'UNKNOWN', maximumLevelsKnown: value.maximumLevelsKnown as number | null } };
    }
    case 'MARK_PRICE': {
      if (!positive(value.markPrice) || !nullablePositive(value.indexPrice) || !nullablePositive(value.estimatedSettlementPrice) || !nullablePositive(value.movingAverageMarkPrice)) {
        return { ok: false, failure: failure('INVALID_VALUE', 'normalized_evidence', 'invalid mark-price values', null) };
      }
      return { ok: true, value: { ...common, kind: 'MARK_PRICE', markPrice: value.markPrice, indexPrice: value.indexPrice as number | null, estimatedSettlementPrice: value.estimatedSettlementPrice as number | null, movingAverageMarkPrice: value.movingAverageMarkPrice as number | null } };
    }
    case 'FUNDING': {
      if (
        !finite(value.fundingRate) || !(value.fundingIntervalHours === null || positive(value.fundingIntervalHours)) ||
        !(value.nextFundingTimeMs === null || nonNegativeTime(value.nextFundingTimeMs)) ||
        !nullableFinite(value.adjustedRateCap) || !nullableFinite(value.adjustedRateFloor) ||
        (finite(value.adjustedRateCap) && finite(value.adjustedRateFloor) && value.adjustedRateFloor > value.adjustedRateCap)
      ) {
        return { ok: false, failure: failure('INVALID_VALUE', 'normalized_evidence', 'invalid funding values', null) };
      }
      return { ok: true, value: { ...common, kind: 'FUNDING', fundingRate: value.fundingRate, fundingIntervalHours: value.fundingIntervalHours as number | null, nextFundingTimeMs: value.nextFundingTimeMs as number | null, adjustedRateCap: value.adjustedRateCap as number | null, adjustedRateFloor: value.adjustedRateFloor as number | null } };
    }
    case 'OPEN_INTEREST': {
      if (
        !nullableNonNegative(value.openInterestBase) || !nullableNonNegative(value.openInterestQuoteValue) ||
        !nullableFinite(value.changeBase) || !nullableFinite(value.changeQuoteValue) ||
        !(value.comparisonWindowMs === null || positiveSafeInteger(value.comparisonWindowMs)) ||
        value.openInterestBase === null && value.openInterestQuoteValue === null
      ) {
        return { ok: false, failure: failure('INVALID_VALUE', 'normalized_evidence', 'invalid open-interest values', null) };
      }
      return { ok: true, value: { ...common, kind: 'OPEN_INTEREST', openInterestBase: value.openInterestBase as number | null, openInterestQuoteValue: value.openInterestQuoteValue as number | null, changeBase: value.changeBase as number | null, changeQuoteValue: value.changeQuoteValue as number | null, comparisonWindowMs: value.comparisonWindowMs as number | null } };
    }
    case 'LIQUIDATION': {
      if (
        !['BUY', 'SELL'].includes(String(value.orderSide)) || !['LONG', 'SHORT'].includes(String(value.liquidatedPositionSide)) ||
        !nonEmptyString(value.orderType) || !nonEmptyString(value.timeInForce) || !positive(value.originalQuantity) ||
        !finite(value.filledQuantity) || value.filledQuantity < 0 || value.filledQuantity > value.originalQuantity ||
        !nullablePositive(value.averagePrice) || typeof value.sampledPerWindow !== 'boolean' ||
        !['LARGEST_PER_SYMBOL', 'LATEST_PER_SYMBOL', 'UNKNOWN'].includes(String(value.samplingSelection)) ||
        !(value.sampleWindowMs === null || positiveSafeInteger(value.sampleWindowMs)) ||
        (value.sampledPerWindow && value.sampleWindowMs === null) ||
        (!value.sampledPerWindow && value.samplingSelection !== 'UNKNOWN')
      ) {
        return { ok: false, failure: failure('INVALID_VALUE', 'normalized_evidence', 'invalid liquidation values', null) };
      }
      if ((value.orderSide === 'BUY' && value.liquidatedPositionSide !== 'SHORT') || (value.orderSide === 'SELL' && value.liquidatedPositionSide !== 'LONG')) {
        return { ok: false, failure: failure('INVALID_VALUE', 'normalized_evidence', 'liquidation order side conflicts with liquidated position side', 'liquidatedPositionSide') };
      }
      return { ok: true, value: { ...common, kind: 'LIQUIDATION', orderSide: value.orderSide as 'BUY' | 'SELL', liquidatedPositionSide: value.liquidatedPositionSide as 'LONG' | 'SHORT', orderType: value.orderType, timeInForce: value.timeInForce, originalQuantity: value.originalQuantity, filledQuantity: value.filledQuantity, averagePrice: value.averagePrice as number | null, sampledPerWindow: value.sampledPerWindow, samplingSelection: value.samplingSelection as 'LARGEST_PER_SYMBOL' | 'LATEST_PER_SYMBOL' | 'UNKNOWN', sampleWindowMs: value.sampleWindowMs as number | null } };
    }
    case 'BORROW': {
      if (
        !nonEmptyString(value.asset) || !['ELIGIBLE', 'INELIGIBLE', 'UNKNOWN'].includes(String(value.eligibility)) ||
        !['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN'].includes(String(value.availability)) ||
        !nullableNonNegative(value.systemAvailableAmount) || !nullableNonNegative(value.accountBorrowLimit) ||
        !nullableNonNegative(value.hourlyInterestRateDecimal) || !nullableNonNegative(value.inventoryAmount) ||
        (value.availability === 'AVAILABLE' && !positive(value.systemAvailableAmount)) ||
        (value.availability === 'UNKNOWN' && value.systemAvailableAmount !== null) ||
        (value.eligibility === 'INELIGIBLE' && value.availability === 'AVAILABLE')
      ) {
        return { ok: false, failure: failure('INVALID_VALUE', 'normalized_evidence', 'invalid borrow values', null) };
      }
      return { ok: true, value: { ...common, kind: 'BORROW', asset: value.asset, eligibility: value.eligibility as 'ELIGIBLE' | 'INELIGIBLE' | 'UNKNOWN', availability: value.availability as 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN', systemAvailableAmount: value.systemAvailableAmount as number | null, accountBorrowLimit: value.accountBorrowLimit as number | null, hourlyInterestRateDecimal: value.hourlyInterestRateDecimal as number | null, inventoryAmount: value.inventoryAmount as number | null } };
    }
    case 'CONTEXT': {
      if (!nonEmptyString(value.contextType) || !['SYMBOL', 'SECTOR', 'MARKET', 'VENUE'].includes(String(value.scope)) || !contextValues(value.values)) {
        return { ok: false, failure: failure('INVALID_VALUE', 'normalized_evidence', 'invalid context values', null) };
      }
      return { ok: true, value: { ...common, kind: 'CONTEXT', contextType: value.contextType, scope: value.scope as 'SYMBOL' | 'SECTOR' | 'MARKET' | 'VENUE', values: { ...value.values } } };
    }
    default: {
      const exhaustive: never = value.kind;
      return { ok: false, failure: failure('INVALID_VARIANT', 'normalized_evidence', `unknown evidence variant ${String(exhaustive)}`, 'kind') };
    }
  }
}

function truthCutoffFailure(value: unknown, cutoffTimeMs: number, field: string, evidenceId: string): StableFailure | null {
  const validated = validateTruthMetadata(value);
  if (!validated.ok) return validated.failure;
  const temporal = validated.value.temporal;
  const timestamps = [
    ['receivedTimeMs', temporal.receivedTimeMs],
    ['sourceEventTimeMs', temporal.sourceEventTimeMs],
    ['sourceTransactionTimeMs', temporal.sourceTransactionTimeMs],
    ['freshness.evaluatedAtMs', validated.value.freshness.evaluatedAtMs],
  ] as const;
  for (const [name, timestamp] of timestamps) {
    if (timestamp !== null && timestamp > cutoffTimeMs) {
      return failure('NO_LOOK_AHEAD_VIOLATION', 'frozen_pre_event', 'epistemic timestamp exceeds the frozen evidence cutoff', `${field}.${name}`, [evidenceId]);
    }
  }
  return null;
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function relatedFrozenInstrument(primary: InstrumentIdentity, candidate: InstrumentIdentity): boolean {
  if (candidate.instrumentId === primary.instrumentId) return true;
  if (candidate.venue !== primary.venue || candidate.baseAsset !== primary.baseAsset) return false;
  if (candidate.productFamily === 'BORROW') return candidate.quoteAsset === null && candidate.pair === null;
  return candidate.symbol === primary.symbol
    && candidate.pair === primary.pair
    && candidate.quoteAsset === primary.quoteAsset;
}

export function validateFrozenPreEventRecord(value: unknown): ValidationResult<FrozenPreEventRecord> {
  const secret = validateNoSecretFields(value, 'frozen_pre_event');
  if (!secret.ok) return secret as ValidationResult<FrozenPreEventRecord>;
  if (!object(value) || !nonEmptyString(value.id) || !nonNegativeTime(value.triggerTimeMs) || !nonNegativeTime(value.evidenceCutoffTimeMs)) {
    return { ok: false, failure: failure('INVALID_VALUE', 'frozen_pre_event', 'invalid frozen-record identity or time', null) };
  }
  if (value.evidenceCutoffTimeMs > value.triggerTimeMs) {
    return { ok: false, failure: failure('NO_LOOK_AHEAD_VIOLATION', 'frozen_pre_event', 'evidence cutoff cannot follow the trigger', 'evidenceCutoffTimeMs', [value.id]) };
  }
  if (!['ACCEPTED', 'REJECTED', 'OBSERVED'].includes(String(value.candidateDisposition)) || !nonEmptyString(value.configurationVersion) || !nonEmptyString(value.featureVersion)) {
    return { ok: false, failure: failure('INVALID_VALUE', 'frozen_pre_event', 'invalid disposition or version', null, [value.id]) };
  }
  if (!Array.isArray(value.evidence) || !Array.isArray(value.features) || !Array.isArray(value.forensics) || !object(value.thesis)) {
    return { ok: false, failure: failure('INVALID_VALUE', 'frozen_pre_event', 'frozen evidence, features, forensics, and thesis are required', null, [value.id]) };
  }
  const recordTruth = validateTruthMetadata(value.truth);
  if (!recordTruth.ok) return recordTruth as ValidationResult<FrozenPreEventRecord>;
  const topCutoff = truthCutoffFailure(value.truth, value.evidenceCutoffTimeMs, 'truth', value.id);
  if (topCutoff) return { ok: false, failure: topCutoff };
  if (recordTruth.value.configurationVersion !== value.configurationVersion || recordTruth.value.featureVersion !== value.featureVersion) {
    return { ok: false, failure: failure('INVALID_VALUE', 'frozen_pre_event', 'record truth versions do not match the frozen record', 'truth', [value.id]) };
  }

  const thesis = value.thesis;
  if (
    !nonEmptyString(thesis.id) || !nonEmptyString(thesis.instrumentId) ||
    !has(HYPOTHESIS_CLASSES, thesis.hypothesis) || !has(MARKET_STAGES, thesis.stage) ||
    !['SPOT', 'PERPETUAL', 'NEITHER', 'UNKNOWN'].includes(String(thesis.leadMarket)) ||
    !(thesis.changedFirst === null || nonEmptyString(thesis.changedFirst)) ||
    !(thesis.changedAtMs === null || nonNegativeTime(thesis.changedAtMs)) ||
    !stringArray(thesis.analogueIds) || !stringArray(thesis.reasonCodes) || !object(thesis.tradeability) ||
    !['SUPPORTED', 'BLOCKED', 'UNKNOWN'].includes(String(thesis.tradeability.state)) ||
    !stringArray(thesis.tradeability.reasonCodes) || !stringArray(thesis.tradeability.requiredEvidenceIds) ||
    !Array.isArray(thesis.tradeability.missingEvidenceKinds) || !thesis.tradeability.missingEvidenceKinds.every((kind) => has(EVIDENCE_KINDS, kind))
  ) {
    return { ok: false, failure: failure('INVALID_VALUE', 'frozen_pre_event', 'invalid thesis identity or change time', 'thesis', [value.id]) };
  }
  if (thesis.changedAtMs !== null && thesis.changedAtMs > value.evidenceCutoffTimeMs) {
    return { ok: false, failure: failure('NO_LOOK_AHEAD_VIOLATION', 'frozen_pre_event', 'thesis change time exceeds the frozen evidence cutoff', 'thesis.changedAtMs', [thesis.id]) };
  }
  const thesisCutoff = truthCutoffFailure(thesis.truth, value.evidenceCutoffTimeMs, 'thesis.truth', thesis.id);
  if (thesisCutoff) return { ok: false, failure: thesisCutoff };

  const evidenceIds = new Set<string>();
  const validatedEvidence: NormalizedEvidence[] = [];
  for (let index = 0; index < value.evidence.length; index += 1) {
    const validated = validateNormalizedEvidence(value.evidence[index]);
    if (!validated.ok) return validated as ValidationResult<FrozenPreEventRecord>;
    if (evidenceIds.has(validated.value.id)) return { ok: false, failure: failure('INVALID_VALUE', 'frozen_pre_event', 'duplicate evidence ID', `evidence[${index}].id`, [validated.value.id]) };
    evidenceIds.add(validated.value.id);
    validatedEvidence.push(validated.value);
    const cutoff = truthCutoffFailure(validated.value.truth, value.evidenceCutoffTimeMs, `evidence[${index}].truth`, validated.value.id);
    if (cutoff) return { ok: false, failure: cutoff };
  }
  const primaryInstrument = validatedEvidence.find((evidence) => evidence.instrument.instrumentId === thesis.instrumentId)?.instrument ?? null;
  for (let index = 0; index < validatedEvidence.length; index += 1) {
    const evidence = validatedEvidence[index];
    if (evidence.instrument.instrumentId === thesis.instrumentId) continue;
    if (primaryInstrument === null || !relatedFrozenInstrument(primaryInstrument, evidence.instrument)) {
      return { ok: false, failure: failure('INVALID_VALUE', 'frozen_pre_event', 'evidence is outside the frozen thesis market scope', `evidence[${index}].instrument`, [evidence.id]) };
    }
  }

  const featureIds = new Set<string>();
  for (let index = 0; index < value.features.length; index += 1) {
    const feature = value.features[index];
    if (
      !object(feature) || !nonEmptyString(feature.id) || featureIds.has(feature.id) ||
      feature.instrumentId !== thesis.instrumentId || !nonEmptyString(feature.feature) ||
      feature.featureVersion !== value.featureVersion ||
      !(feature.value === null || typeof feature.value === 'string' || typeof feature.value === 'boolean' || finite(feature.value)) ||
      !(feature.windowMs === null || positiveSafeInteger(feature.windowMs)) ||
      !(feature.observationStartMs === null || nonNegativeTime(feature.observationStartMs)) ||
      !(feature.observationEndMs === null || nonNegativeTime(feature.observationEndMs)) ||
      (feature.observationStartMs !== null && feature.observationEndMs !== null && feature.observationStartMs > feature.observationEndMs)
    ) return { ok: false, failure: failure('INVALID_VALUE', 'frozen_pre_event', 'invalid or duplicate feature', `features[${index}]`, object(feature) && typeof feature.id === 'string' ? [feature.id] : []) };
    featureIds.add(feature.id);
    if ((feature.observationStartMs !== null && feature.observationStartMs > value.evidenceCutoffTimeMs) || (feature.observationEndMs !== null && feature.observationEndMs > value.evidenceCutoffTimeMs)) {
      return { ok: false, failure: failure('NO_LOOK_AHEAD_VIOLATION', 'frozen_pre_event', 'feature observation exceeds the frozen evidence cutoff', `features[${index}].observationRange`, [feature.id]) };
    }
    const featureTruth = validateTruthMetadata(feature.truth);
    if (!featureTruth.ok) return featureTruth as ValidationResult<FrozenPreEventRecord>;
    if (featureTruth.value.featureVersion !== value.featureVersion) {
      return { ok: false, failure: failure('INVALID_VALUE', 'frozen_pre_event', 'feature truth version mismatch', `features[${index}].truth.featureVersion`, [feature.id]) };
    }
    const cutoff = truthCutoffFailure(feature.truth, value.evidenceCutoffTimeMs, `features[${index}].truth`, feature.id);
    if (cutoff) return { ok: false, failure: cutoff };
  }

  const factGroups = [
    ['supporting', 'SUPPORTING'],
    ['conflicting', 'CONFLICTING'],
    ['neutral', 'NEUTRAL'],
    ['unavailable', 'UNAVAILABLE'],
  ] as const;
  for (const [group, expectedPolarity] of factGroups) {
    const facts = thesis[group];
    if (!Array.isArray(facts)) return { ok: false, failure: failure('INVALID_VALUE', 'frozen_pre_event', 'thesis evidence group must be an array', `thesis.${group}`, [thesis.id]) };
    for (let index = 0; index < facts.length; index += 1) {
      const fact = facts[index];
      if (
        !object(fact) || !nonEmptyString(fact.id) || fact.polarity !== expectedPolarity ||
        !nonEmptyString(fact.fact) || !nonEmptyString(fact.reasonCode) ||
        !stringArray(fact.featureIds) || !stringArray(fact.evidenceIds) ||
        !(fact.observationStartMs === null || nonNegativeTime(fact.observationStartMs)) ||
        !(fact.observationEndMs === null || nonNegativeTime(fact.observationEndMs)) ||
        (fact.observationStartMs !== null && fact.observationEndMs !== null && fact.observationStartMs > fact.observationEndMs)
      ) {
        return { ok: false, failure: failure('INVALID_VALUE', 'frozen_pre_event', 'invalid thesis evidence fact', `thesis.${group}[${index}]`, [thesis.id]) };
      }
      if ((fact.observationStartMs !== null && fact.observationStartMs > value.evidenceCutoffTimeMs) || (fact.observationEndMs !== null && fact.observationEndMs > value.evidenceCutoffTimeMs)) {
        return { ok: false, failure: failure('NO_LOOK_AHEAD_VIOLATION', 'frozen_pre_event', 'thesis evidence exceeds the frozen evidence cutoff', `thesis.${group}[${index}].observationRange`, [fact.id]) };
      }
      if (fact.featureIds.some((id) => !featureIds.has(id)) || fact.evidenceIds.some((id) => !evidenceIds.has(id))) {
        return { ok: false, failure: failure('INVALID_VALUE', 'frozen_pre_event', 'thesis evidence references an unknown dependency', `thesis.${group}[${index}]`, [fact.id]) };
      }
      const cutoff = truthCutoffFailure(fact.truth, value.evidenceCutoffTimeMs, `thesis.${group}[${index}].truth`, fact.id);
      if (cutoff) return { ok: false, failure: cutoff };
    }
  }

  const forensicIds = new Set<string>();
  for (let index = 0; index < value.forensics.length; index += 1) {
    const check = value.forensics[index];
    if (
      !object(check) || !nonEmptyString(check.id) || forensicIds.has(check.id) || !nonEmptyString(check.check) ||
      !has(FORENSIC_VERDICTS, check.verdict) || !['BLOCK', 'WARN'].includes(String(check.severity)) ||
      !stringArray(check.reasonCodes) || !stringArray(check.evidenceIds) ||
      !(check.observationStartMs === null || nonNegativeTime(check.observationStartMs)) ||
      !(check.observationEndMs === null || nonNegativeTime(check.observationEndMs)) ||
      (check.observationStartMs !== null && check.observationEndMs !== null && check.observationStartMs > check.observationEndMs) ||
      check.evidenceIds.some((id) => !evidenceIds.has(id))
    ) {
      return { ok: false, failure: failure('INVALID_VALUE', 'frozen_pre_event', 'invalid or duplicate forensic check', `forensics[${index}]`, object(check) && typeof check.id === 'string' ? [check.id] : []) };
    }
    forensicIds.add(check.id);
    if ((check.observationStartMs !== null && check.observationStartMs > value.evidenceCutoffTimeMs) || (check.observationEndMs !== null && check.observationEndMs > value.evidenceCutoffTimeMs)) {
      return { ok: false, failure: failure('NO_LOOK_AHEAD_VIOLATION', 'frozen_pre_event', 'forensic observation exceeds the frozen evidence cutoff', `forensics[${index}].observationRange`, [check.id]) };
    }
    const cutoff = truthCutoffFailure(check.truth, value.evidenceCutoffTimeMs, `forensics[${index}].truth`, check.id);
    if (cutoff) return { ok: false, failure: cutoff };
  }
  if (thesis.tradeability.requiredEvidenceIds.some((id) => !evidenceIds.has(id))) {
    return { ok: false, failure: failure('INVALID_VALUE', 'frozen_pre_event', 'tradeability references unknown evidence', 'thesis.tradeability.requiredEvidenceIds', [thesis.id]) };
  }
  const normalized = structuredClone({
    id: value.id,
    triggerTimeMs: value.triggerTimeMs,
    evidenceCutoffTimeMs: value.evidenceCutoffTimeMs,
    candidateDisposition: value.candidateDisposition,
    thesis,
    forensics: value.forensics,
    evidence: value.evidence,
    features: value.features,
    configurationVersion: value.configurationVersion,
    featureVersion: value.featureVersion,
    truth: recordTruth.value,
  }) as unknown as FrozenPreEventRecord;
  return { ok: true, value: deepFreeze(normalized) };
}

export function isMarketStage(value: unknown): boolean {
  return has(MARKET_STAGES, value);
}

export function isEvidencePolarity(value: unknown): boolean {
  return has(EVIDENCE_POLARITIES, value);
}

export function isFailureCode(value: unknown): boolean {
  return has(FAILURE_CODES, value);
}
