import { types as utilTypes } from 'node:util';

import { stableId } from '../../../intelligenceFoundation/contracts/index.js';
import {
  compareDecimal,
  decimalScale,
  divideDecimalDown,
  floorToGrid,
  isGridAligned,
  minimumDecimal,
  multiplyDecimal,
  normalizeSizingDecimal,
} from './exact.js';
import { validateInstrumentRegistrySnapshot } from './snapshot.js';
import {
  BINANCE_FILTER_REFERENCE_SCHEMA,
  type BinanceFilterReferenceEvidence,
  type BinanceInstrumentSpec,
  type InstrumentSizingResult,
  type InstrumentSizingTransformation,
  type NormalizedInstrumentFilter,
} from './types.js';

const RESULT_SCHEMA = 'BINANCE_STATIC_FILTER_PREFLIGHT_V1' as const;
const CANARY_MAXIMUM_NOTIONAL = '10' as const;
const FUTURE_SKEW_MS = 2_000;
const MAXIMUM_REFERENCE_VALIDITY_MS = 5_000;

const REQUEST_FIELDS = Object.freeze([
  'symbol', 'instrumentRevision', 'side', 'orderType', 'timeInForce',
  'requestedPrice', 'referencePrice', 'requestedQuantity', 'approvedNotional',
  'intendedExposure', 'notionalAsset', 'evaluatedAtMs',
] as const);

const REFERENCE_FIELDS = Object.freeze([
  'schema', 'producer', 'product', 'symbol', 'instrumentRevision', 'kind',
  'averagingWindowMins', 'price', 'observedAtMs', 'validUntilMs',
  'sourceTruthId', 'evidenceRevision', 'documentaryAuthority',
  'externalActionAuthorization', 'actionAuthority',
] as const);

type PlainRecord = Readonly<Record<string, unknown>>;

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function closedRecord(value: unknown, fields: readonly string[], label: string): PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || utilTypes.isProxy(value)) {
    throw new TypeError(`${label} must be a plain record`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must use a plain prototype`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== 'string')
    || keys.length !== fields.length
    || keys.some((key) => !fields.includes(key as string))) {
    throw new TypeError(`${label} must use exact fields`);
  }
  for (const descriptor of Object.values(descriptors)) {
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${label} must use enumerable own data fields`);
    }
  }
  return value as PlainRecord;
}

function safeText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256
    || value.trim() !== value
    || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value)) {
    throw new TypeError(`${label} must be bounded safe text`);
  }
  return value;
}

function safeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function exactDecimal(filter: NormalizedInstrumentFilter, field: string): string {
  const value = filter.values[field];
  if (typeof value !== 'object' || value === null
    || !Object.hasOwn(value, 'canonical')
    || typeof (value as { canonical?: unknown }).canonical !== 'string') {
    throw new TypeError(`${filter.filterType}.${field} is not an exact decimal`);
  }
  return normalizeSizingDecimal((value as { canonical: string }).canonical);
}

function booleanValue(filter: NormalizedInstrumentFilter, field: string): boolean {
  const value = filter.values[field];
  if (typeof value !== 'boolean') throw new TypeError(`${filter.filterType}.${field} is not boolean`);
  return value;
}

function blocked(
  reasonCodes: readonly string[],
  details: Partial<Pick<InstrumentSizingResult,
  'instrumentRevision' | 'sourceEvidenceRevision' | 'registryRevision'
  | 'snapshotRevision' | 'referenceEvidenceRevision' | 'evaluatedAtMs'
  | 'instrumentValidUntilMs' | 'referenceValidUntilMs'
  | 'referenceObservedAtMs'
  | 'notionalAsset' | 'requestedPrice' | 'validationPrice' | 'requestedQuantity'
  | 'resultQuantity' | 'resultNotional' | 'effectiveNotionalCeiling'>> = {},
  transformations: readonly InstrumentSizingTransformation[] = [],
  externalRequirements: readonly string[] = [],
): Readonly<InstrumentSizingResult> {
  return deepFreeze({
    schema: RESULT_SCHEMA,
    staticState: 'BLOCKED' as const,
    reasonCodes: [...new Set(reasonCodes)].sort(),
    instrumentRevision: details.instrumentRevision ?? null,
    sourceEvidenceRevision: details.sourceEvidenceRevision ?? null,
    registryRevision: details.registryRevision ?? null,
    snapshotRevision: details.snapshotRevision ?? null,
    referenceEvidenceRevision: details.referenceEvidenceRevision ?? null,
    evaluatedAtMs: details.evaluatedAtMs ?? null,
    instrumentValidUntilMs: details.instrumentValidUntilMs ?? null,
    referenceObservedAtMs: details.referenceObservedAtMs ?? null,
    referenceValidUntilMs: details.referenceValidUntilMs ?? null,
    notionalAsset: details.notionalAsset ?? null,
    requestedPrice: details.requestedPrice ?? null,
    validationPrice: details.validationPrice ?? null,
    requestedQuantity: details.requestedQuantity ?? null,
    resultQuantity: details.resultQuantity ?? null,
    resultNotional: details.resultNotional ?? null,
    effectiveNotionalCeiling: details.effectiveNotionalCeiling ?? null,
    transformations: [...transformations],
    externalRequirements: [...new Set(externalRequirements)].sort(),
    canaryMaximumNotional: CANARY_MAXIMUM_NOTIONAL,
    sendEligible: false as const,
    documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY' as const,
    externalActionAuthorization: 'NONE' as const,
    actionAuthority: 'NONE_RECORD_ONLY' as const,
  });
}

export function deriveFilterReferenceEvidenceRevision(
  evidence: Omit<BinanceFilterReferenceEvidence, 'evidenceRevision'>,
): string {
  return stableId('l04-filter-reference', evidence);
}

export function validateFilterReferenceEvidence(
  value: unknown,
  spec: BinanceInstrumentSpec,
): Readonly<BinanceFilterReferenceEvidence> | null {
  if (value === null) return null;
  const record = closedRecord(value, REFERENCE_FIELDS, 'filter reference evidence');
  if (record.schema !== BINANCE_FILTER_REFERENCE_SCHEMA
    || record.producer !== 'INTELLIGENCE_RUNTIME'
    || record.product !== spec.product
    || record.symbol !== spec.symbol
    || record.instrumentRevision !== spec.instrumentRevision
    || record.documentaryAuthority !== 'DOCUMENTARY_EVIDENCE_ONLY'
    || record.externalActionAuthorization !== 'NONE'
    || record.actionAuthority !== 'NONE_RECORD_ONLY') {
    throw new TypeError('filter reference identity or authority is invalid');
  }
  const kind = record.kind;
  if (kind !== 'MARK_PRICE' && kind !== 'WEIGHTED_AVERAGE' && kind !== 'LAST_PRICE') {
    throw new TypeError('filter reference kind is invalid');
  }
  let averagingWindowMins: number | null;
  if (kind === 'MARK_PRICE') {
    if (record.averagingWindowMins !== null) throw new TypeError('mark price cannot claim an averaging window');
    averagingWindowMins = null;
  } else {
    averagingWindowMins = safeInteger(record.averagingWindowMins, 'reference.averagingWindowMins');
    if ((kind === 'LAST_PRICE' && averagingWindowMins !== 0)
      || (kind === 'WEIGHTED_AVERAGE' && averagingWindowMins < 1)) {
      throw new TypeError('filter reference averaging window conflicts with its kind');
    }
  }
  const price = normalizeSizingDecimal(record.price, true);
  const observedAtMs = safeInteger(record.observedAtMs, 'reference.observedAtMs');
  const validUntilMs = safeInteger(record.validUntilMs, 'reference.validUntilMs');
  const sourceTruthId = safeText(record.sourceTruthId, 'reference.sourceTruthId');
  const evidenceRevision = safeText(record.evidenceRevision, 'reference.evidenceRevision');
  if (validUntilMs < observedAtMs
    || validUntilMs - observedAtMs > MAXIMUM_REFERENCE_VALIDITY_MS) {
    throw new RangeError('filter reference evidence is outside its validity interval');
  }
  const projection: Omit<BinanceFilterReferenceEvidence, 'evidenceRevision'> = {
    schema: BINANCE_FILTER_REFERENCE_SCHEMA,
    producer: 'INTELLIGENCE_RUNTIME',
    product: spec.product,
    symbol: spec.symbol,
    instrumentRevision: spec.instrumentRevision,
    kind,
    averagingWindowMins,
    price,
    observedAtMs,
    validUntilMs,
    sourceTruthId,
    documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY',
    externalActionAuthorization: 'NONE',
    actionAuthority: 'NONE_RECORD_ONLY',
  };
  if (deriveFilterReferenceEvidenceRevision(projection) !== evidenceRevision) {
    throw new TypeError('filter reference evidence revision mismatch');
  }
  return Object.freeze({ ...projection, evidenceRevision });
}

export interface ReferenceRequirement {
  readonly kind: BinanceFilterReferenceEvidence['kind'];
  readonly averagingWindowMins: number | null;
}

function integerFilterValue(filter: NormalizedInstrumentFilter, field: string): number {
  const value = filter.values[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${filter.filterType}.${field} is not a non-negative integer`);
  }
  return value;
}

function spotWindowRequirement(windowMins: number): Readonly<ReferenceRequirement> {
  return Object.freeze(windowMins === 0
    ? { kind: 'LAST_PRICE' as const, averagingWindowMins: 0 }
    : { kind: 'WEIGHTED_AVERAGE' as const, averagingWindowMins: windowMins });
}

export function requiredFilterReferenceEvidence(
  spec: BinanceInstrumentSpec,
  orderType: string,
): Readonly<ReferenceRequirement> | 'CONFLICT' | null {
  const requirements: ReferenceRequirement[] = [];
  if (orderType === 'MARKET') {
    if (spec.product === 'USD_M_PERPETUAL') {
      requirements.push({ kind: 'MARK_PRICE', averagingWindowMins: null });
    } else {
      for (const filter of spec.filters) {
        if (filter.filterType === 'MIN_NOTIONAL' && booleanValue(filter, 'applyToMarket')) {
          requirements.push(spotWindowRequirement(integerFilterValue(filter, 'avgPriceMins')));
        }
        if (filter.filterType === 'NOTIONAL'
          && (booleanValue(filter, 'applyMinToMarket') || booleanValue(filter, 'applyMaxToMarket'))) {
          requirements.push(spotWindowRequirement(integerFilterValue(filter, 'avgPriceMins')));
        }
      }
      if (requirements.length === 0) requirements.push(spotWindowRequirement(0));
    }
  } else {
    for (const filter of spec.filters) {
      if (filter.filterType !== 'PERCENT_PRICE' && filter.filterType !== 'PERCENT_PRICE_BY_SIDE') continue;
      requirements.push(spec.product === 'USD_M_PERPETUAL'
        ? { kind: 'MARK_PRICE', averagingWindowMins: null }
        : spotWindowRequirement(integerFilterValue(filter, 'avgPriceMins')));
    }
  }
  if (requirements.length === 0) return null;
  const first = requirements[0];
  if (requirements.some((requirement) => requirement.kind !== first.kind
    || requirement.averagingWindowMins !== first.averagingWindowMins)) return 'CONFLICT';
  return Object.freeze(first);
}

function findFilter(spec: BinanceInstrumentSpec, type: string): NormalizedInstrumentFilter | undefined {
  return spec.filters.find((filter) => filter.filterType === type);
}

function applicableLotFilters(spec: BinanceInstrumentSpec, orderType: string): readonly NormalizedInstrumentFilter[] {
  const lot = findFilter(spec, 'LOT_SIZE');
  if (lot === undefined) throw new TypeError('LOT_SIZE is unavailable');
  const filters = [lot];
  if (orderType === 'MARKET') {
    const market = findFilter(spec, 'MARKET_LOT_SIZE');
    if (market !== undefined) filters.push(market);
  }
  return filters;
}

function gridOrigin(spec: BinanceInstrumentSpec, filter: NormalizedInstrumentFilter, minimumField: string): string {
  return spec.product === 'USD_M_PERPETUAL' ? exactDecimal(filter, minimumField) : '0';
}

function activeMinimumNotionals(
  spec: BinanceInstrumentSpec,
  orderType: string,
): readonly Readonly<{ filterType: string; value: string }>[] {
  const output: Array<Readonly<{ filterType: string; value: string }>> = [];
  for (const filter of spec.filters) {
    if (filter.filterType === 'MIN_NOTIONAL') {
      if (spec.product === 'USD_M_PERPETUAL') {
        output.push(Object.freeze({ filterType: filter.filterType, value: exactDecimal(filter, 'notional') }));
      } else if (orderType !== 'MARKET' || booleanValue(filter, 'applyToMarket')) {
        output.push(Object.freeze({ filterType: filter.filterType, value: exactDecimal(filter, 'minNotional') }));
      }
    }
    if (filter.filterType === 'NOTIONAL'
      && (orderType !== 'MARKET' || booleanValue(filter, 'applyMinToMarket'))) {
      output.push(Object.freeze({ filterType: filter.filterType, value: exactDecimal(filter, 'minNotional') }));
    }
  }
  return output;
}

function activeMaximumNotionals(
  spec: BinanceInstrumentSpec,
  orderType: string,
): readonly Readonly<{ filterType: string; value: string }>[] {
  const output: Array<Readonly<{ filterType: string; value: string }>> = [];
  for (const filter of spec.filters) {
    if (filter.filterType === 'NOTIONAL'
      && (orderType !== 'MARKET' || booleanValue(filter, 'applyMaxToMarket'))) {
      output.push(Object.freeze({ filterType: filter.filterType, value: exactDecimal(filter, 'maxNotional') }));
    }
  }
  return output;
}

function validatePriceFilter(spec: BinanceInstrumentSpec, price: string): readonly string[] {
  const filter = findFilter(spec, 'PRICE_FILTER');
  if (filter === undefined) return ['PRICE_FILTER_MISSING'];
  const minimum = exactDecimal(filter, 'minPrice');
  const maximum = exactDecimal(filter, 'maxPrice');
  const tick = exactDecimal(filter, 'tickSize');
  const reasons: string[] = [];
  if (minimum !== '0' && compareDecimal(price, minimum) < 0) reasons.push('PRICE_BELOW_MINIMUM');
  if (maximum !== '0' && compareDecimal(price, maximum) > 0) reasons.push('PRICE_ABOVE_MAXIMUM');
  if (tick !== '0' && !isGridAligned(price, tick, spec.product === 'USD_M_PERPETUAL' ? minimum : '0')) {
    reasons.push('PRICE_TICK_MISALIGNED');
  }
  return reasons;
}

function validatePercentPrice(
  spec: BinanceInstrumentSpec,
  side: 'BUY' | 'SELL',
  orderType: string,
  price: string,
  referencePrice: string | null,
): readonly string[] {
  if (orderType === 'MARKET') return [];
  const relevant = spec.filters.filter((filter) => filter.filterType === 'PERCENT_PRICE'
    || filter.filterType === 'PERCENT_PRICE_BY_SIDE');
  if (relevant.length === 0) return [];
  if (referencePrice === null) return ['PERCENT_REFERENCE_PRICE_REQUIRED'];
  const reasons: string[] = [];
  for (const filter of relevant) {
    if (filter.filterType === 'PERCENT_PRICE_BY_SIDE') {
      const prefix = side === 'BUY' ? 'bid' : 'ask';
      const lower = multiplyDecimal(referencePrice, exactDecimal(filter, `${prefix}MultiplierDown`));
      const upper = multiplyDecimal(referencePrice, exactDecimal(filter, `${prefix}MultiplierUp`));
      if (compareDecimal(price, lower) < 0) reasons.push('PRICE_BELOW_PERCENT_BOUND');
      if (compareDecimal(price, upper) > 0) reasons.push('PRICE_ABOVE_PERCENT_BOUND');
    } else if (spec.product === 'USD_M_PERPETUAL') {
      if (side === 'BUY') {
        const upper = multiplyDecimal(referencePrice, exactDecimal(filter, 'multiplierUp'));
        if (compareDecimal(price, upper) > 0) reasons.push('PRICE_ABOVE_PERCENT_BOUND');
      } else {
        const lower = multiplyDecimal(referencePrice, exactDecimal(filter, 'multiplierDown'));
        if (compareDecimal(price, lower) < 0) reasons.push('PRICE_BELOW_PERCENT_BOUND');
      }
    } else {
      const lower = multiplyDecimal(referencePrice, exactDecimal(filter, 'multiplierDown'));
      const upper = multiplyDecimal(referencePrice, exactDecimal(filter, 'multiplierUp'));
      if (compareDecimal(price, lower) < 0) reasons.push('PRICE_BELOW_PERCENT_BOUND');
      if (compareDecimal(price, upper) > 0) reasons.push('PRICE_ABOVE_PERCENT_BOUND');
    }
  }
  return reasons;
}

function validateQuantity(
  spec: BinanceInstrumentSpec,
  quantity: string,
  filters: readonly NormalizedInstrumentFilter[],
): readonly string[] {
  const reasons: string[] = [];
  for (const filter of filters) {
    const minimum = exactDecimal(filter, 'minQty');
    const maximum = exactDecimal(filter, 'maxQty');
    const step = exactDecimal(filter, 'stepSize');
    if (compareDecimal(quantity, minimum) < 0) reasons.push(`${filter.filterType}_QUANTITY_BELOW_MINIMUM`);
    if (compareDecimal(quantity, maximum) > 0) reasons.push(`${filter.filterType}_QUANTITY_ABOVE_MAXIMUM`);
    if (!isGridAligned(quantity, step, gridOrigin(spec, filter, 'minQty'))) {
      reasons.push(`${filter.filterType}_GRID_MISALIGNED`);
    }
  }
  return reasons;
}

function externalRequirements(spec: BinanceInstrumentSpec, orderType: string): readonly string[] {
  const requirements = [...spec.lossCodes];
  if (orderType === 'MARKET') requirements.push('MARKET_EXECUTION_PRICE_UNPROVED');
  for (const filter of spec.filters) {
    if (filter.privateTruthRequired) requirements.push(`${filter.filterType}_PRIVATE_OWNER_TRUTH_REQUIRED`);
  }
  return [...new Set(requirements)].sort();
}

/**
 * Proves only deterministic public/static filter arithmetic. A PASS remains
 * non-sendable and retains every unavailable owner requirement.
 */
export function preflightInstrumentSizing(
  snapshotValue: unknown,
  requestValue: unknown,
): Readonly<InstrumentSizingResult> {
  let details: Partial<Pick<InstrumentSizingResult,
  'instrumentRevision' | 'sourceEvidenceRevision' | 'registryRevision'
  | 'snapshotRevision' | 'referenceEvidenceRevision' | 'evaluatedAtMs'
  | 'instrumentValidUntilMs' | 'referenceValidUntilMs'
  | 'referenceObservedAtMs'
  | 'notionalAsset' | 'requestedPrice' | 'validationPrice' | 'requestedQuantity'
  | 'resultQuantity' | 'resultNotional' | 'effectiveNotionalCeiling'>> = {};
  const transformations: InstrumentSizingTransformation[] = [];
  let requirements: readonly string[] = [];
  try {
    const snapshot = validateInstrumentRegistrySnapshot(snapshotValue);
    const request = closedRecord(requestValue, REQUEST_FIELDS, 'sizing request');
    const symbol = safeText(request.symbol, 'request.symbol');
    const requestedRevision = safeText(request.instrumentRevision, 'request.instrumentRevision');
    const side = request.side;
    if (side !== 'BUY' && side !== 'SELL') throw new TypeError('side must be BUY or SELL');
    const orderType = safeText(request.orderType, 'request.orderType');
    const evaluatedAtMs = safeInteger(request.evaluatedAtMs, 'request.evaluatedAtMs');
    const spec = snapshot.instruments.find((candidate) => candidate.symbol === symbol);
    if (spec === undefined) return blocked(['SYMBOL_NOT_FOUND']);
    details = {
      instrumentRevision: spec.instrumentRevision,
      sourceEvidenceRevision: spec.sourceEvidenceRevision,
      registryRevision: snapshot.registryRevision,
      snapshotRevision: snapshot.snapshotRevision,
      evaluatedAtMs,
      instrumentValidUntilMs: spec.sourceValidUntilMs,
    };
    requirements = externalRequirements(spec, orderType);
    if (spec.instrumentRevision !== requestedRevision) {
      return blocked(['INSTRUMENT_REVISION_MISMATCH'], details, transformations, requirements);
    }
    if (spec.documentaryAuthority !== 'DOCUMENTARY_EVIDENCE_ONLY'
      || spec.externalActionAuthorization !== 'NONE'
      || spec.actionAuthority !== 'NONE_RECORD_ONLY') {
      return blocked(['INSTRUMENT_AUTHORITY_INVALID'], details);
    }
    const sourceReasons: string[] = [];
    if (spec.status !== 'TRADING') sourceReasons.push('SYMBOL_NOT_TRADING');
    if (spec.normalizationState !== 'READY_STATIC_ONLY') sourceReasons.push(spec.normalizationState);
    if (evaluatedAtMs < spec.sourceReceivedAtMs - FUTURE_SKEW_MS) sourceReasons.push('SOURCE_CLOCK_SKEWED');
    if (evaluatedAtMs > spec.sourceValidUntilMs) sourceReasons.push('SOURCE_STALE');
    if (sourceReasons.length > 0) return blocked(sourceReasons, details, transformations, requirements);
    if (spec.quoteAsset !== 'USDT') {
      return blocked(['CANARY_QUOTE_ASSET_NOT_USDT'], details, transformations, requirements);
    }
    if (request.notionalAsset !== 'USDT') {
      return blocked(['NOTIONAL_ASSET_NOT_USDT'], details, transformations, requirements);
    }
    details = { ...details, notionalAsset: 'USDT' };
    if (spec.filters.some((filter) => filter.state !== 'ACTIVE')) {
      return blocked(['FILTER_STATE_NOT_ACTIVE'], details, transformations, requirements);
    }
    if (!spec.staticOrderTypes.includes(orderType)) {
      return blocked(['ORDER_TYPE_NOT_ADVERTISED_FOR_STATIC_PREFLIGHT'], details, transformations, requirements);
    }
    if (orderType !== 'LIMIT' && orderType !== 'MARKET') {
      return blocked(['ORDER_TYPE_STATIC_PREFLIGHT_UNSUPPORTED'], details, transformations, requirements);
    }
    if (orderType === 'LIMIT') {
      const timeInForce = safeText(request.timeInForce, 'request.timeInForce');
      if (!spec.allowedTimeInForce.includes(timeInForce)) {
        return blocked(['TIME_IN_FORCE_NOT_ADVERTISED'], details, transformations, requirements);
      }
    } else if (request.timeInForce !== null) {
      return blocked(['MARKET_TIME_IN_FORCE_MUST_BE_NULL'], details, transformations, requirements);
    }

    const requestedQuantity = normalizeSizingDecimal(request.requestedQuantity, true);
    const approvedNotional = normalizeSizingDecimal(request.approvedNotional, true);
    const intendedExposure = normalizeSizingDecimal(request.intendedExposure, true);
    const requiredReference = requiredFilterReferenceEvidence(spec, orderType);
    if (requiredReference === 'CONFLICT') {
      return blocked(['FILTER_REFERENCE_REQUIREMENTS_CONFLICT'], details, transformations, requirements);
    }
    let referenceEvidence: Readonly<BinanceFilterReferenceEvidence> | null;
    try {
      referenceEvidence = validateFilterReferenceEvidence(request.referencePrice, spec);
    } catch {
      return blocked(['FILTER_REFERENCE_EVIDENCE_REJECTED'], details, transformations, requirements);
    }
    if (requiredReference === null && referenceEvidence !== null) {
      return blocked(['FILTER_REFERENCE_EVIDENCE_NOT_APPLICABLE'], details, transformations, requirements);
    }
    if (requiredReference !== null && referenceEvidence === null) {
      return blocked(['FILTER_REFERENCE_EVIDENCE_REQUIRED'], details, transformations, requirements);
    }
    if (requiredReference !== null && referenceEvidence !== null
      && (referenceEvidence.kind !== requiredReference.kind
        || referenceEvidence.averagingWindowMins !== requiredReference.averagingWindowMins)) {
      return blocked(['FILTER_REFERENCE_KIND_OR_WINDOW_MISMATCH'], details, transformations, requirements);
    }
    if (referenceEvidence !== null
      && (evaluatedAtMs < referenceEvidence.observedAtMs - FUTURE_SKEW_MS
        || evaluatedAtMs > referenceEvidence.validUntilMs)) {
      return blocked(['FILTER_REFERENCE_EVIDENCE_REJECTED'], details, transformations, requirements);
    }
    const referencePrice = referenceEvidence?.price ?? null;
    details = {
      ...details,
      referenceEvidenceRevision: referenceEvidence?.evidenceRevision ?? null,
      referenceObservedAtMs: referenceEvidence?.observedAtMs ?? null,
      referenceValidUntilMs: referenceEvidence?.validUntilMs ?? null,
      notionalAsset: 'USDT' as const,
    };
    let requestedPrice: string | null = null;
    let validationPrice: string;
    if (orderType === 'MARKET') {
      if (request.requestedPrice !== null) {
        return blocked(['MARKET_REQUESTED_PRICE_MUST_BE_NULL'], details, transformations, requirements);
      }
      if (referencePrice === null) {
        return blocked(['MARKET_REFERENCE_PRICE_REQUIRED'], details, transformations, requirements);
      }
      validationPrice = referencePrice;
    } else {
      requestedPrice = normalizeSizingDecimal(request.requestedPrice, true);
      validationPrice = requestedPrice;
    }
    details = { ...details, requestedPrice, validationPrice, requestedQuantity };

    const priceReasons = orderType === 'MARKET'
      ? []
      : [...validatePriceFilter(spec, validationPrice),
        ...validatePercentPrice(spec, side, orderType, validationPrice, referencePrice)];
    if (priceReasons.length > 0) return blocked(priceReasons, details, transformations, requirements);

    const lots = applicableLotFilters(spec, orderType);
    let quantity = requestedQuantity;
    let currentNotional = multiplyDecimal(validationPrice, quantity);
    const setQuantity = (
      next: string,
      kind: InstrumentSizingTransformation['kind'],
      filterType: string | null,
    ): void => {
      if (compareDecimal(next, quantity) > 0) throw new RangeError('quantity transformation increased size');
      if (compareDecimal(next, quantity) < 0) {
        transformations.push(Object.freeze({ kind, from: quantity, to: next, filterType }));
        quantity = next;
        currentNotional = multiplyDecimal(validationPrice, quantity);
      }
    };

    for (const filter of lots) {
      const maximum = exactDecimal(filter, 'maxQty');
      if (compareDecimal(quantity, maximum) > 0) {
        setQuantity(maximum, 'MAX_QUANTITY_REDUCTION', filter.filterType);
      }
    }
    for (const filter of lots) {
      const step = exactDecimal(filter, 'stepSize');
      const aligned = floorToGrid(quantity, step, gridOrigin(spec, filter, 'minQty'));
      if (aligned === null) {
        return blocked(['QUANTITY_BELOW_GRID_ORIGIN'], { ...details, resultQuantity: quantity,
          resultNotional: currentNotional }, transformations, requirements);
      }
      setQuantity(aligned, 'GRID_REDUCTION', filter.filterType);
    }
    const firstGridReasons = validateQuantity(spec, quantity, lots);
    if (firstGridReasons.some((reason) => reason.endsWith('_GRID_MISALIGNED'))) {
      return blocked(['FILTER_GRID_INTERSECTION_UNRESOLVED', ...firstGridReasons], {
        ...details, resultQuantity: quantity, resultNotional: currentNotional,
      }, transformations, requirements);
    }
    if (firstGridReasons.length > 0) {
      return blocked(firstGridReasons, { ...details, resultQuantity: quantity,
        resultNotional: currentNotional }, transformations, requirements);
    }

    let effectiveCeiling = minimumDecimal(approvedNotional, intendedExposure);
    effectiveCeiling = minimumDecimal(effectiveCeiling, CANARY_MAXIMUM_NOTIONAL);
    for (const maximum of activeMaximumNotionals(spec, orderType)) {
      effectiveCeiling = minimumDecimal(effectiveCeiling, maximum.value);
    }
    details = { ...details, effectiveNotionalCeiling: effectiveCeiling };
    if (compareDecimal(currentNotional, effectiveCeiling) > 0) {
      if (lots.some((filter) => decimalScale(exactDecimal(filter, 'stepSize')) > 24)
        || decimalScale(quantity) > 24) {
        return blocked(['FILTER_SCALE_UNSUPPORTED'], {
          ...details, resultQuantity: quantity, resultNotional: currentNotional,
        }, transformations, requirements);
      }
      const ceilingQuantity = divideDecimalDown(effectiveCeiling, validationPrice);
      setQuantity(minimumDecimal(quantity, ceilingQuantity), 'NOTIONAL_CEILING_REDUCTION', null);
      for (const filter of lots) {
        const aligned = floorToGrid(
          quantity,
          exactDecimal(filter, 'stepSize'),
          gridOrigin(spec, filter, 'minQty'),
        );
        if (aligned === null) {
          return blocked(['QUANTITY_BELOW_GRID_ORIGIN'], {
            ...details, resultQuantity: quantity, resultNotional: currentNotional,
          }, transformations, requirements);
        }
        setQuantity(aligned, 'GRID_REDUCTION', filter.filterType);
      }
    }

    const finalReasons = [...validateQuantity(spec, quantity, lots)];
    if (finalReasons.some((reason) => reason.endsWith('_GRID_MISALIGNED'))) {
      finalReasons.push('FILTER_GRID_INTERSECTION_UNRESOLVED');
    }
    if (quantity === '0') finalReasons.push('RESULT_QUANTITY_ZERO');
    currentNotional = multiplyDecimal(validationPrice, quantity);
    for (const minimum of activeMinimumNotionals(spec, orderType)) {
      if (compareDecimal(currentNotional, minimum.value) < 0) {
        finalReasons.push(`${minimum.filterType}_BELOW_MINIMUM`);
      }
    }
    for (const maximum of activeMaximumNotionals(spec, orderType)) {
      if (compareDecimal(currentNotional, maximum.value) > 0) {
        finalReasons.push(`${maximum.filterType}_ABOVE_MAXIMUM`);
      }
    }
    if (compareDecimal(quantity, requestedQuantity) > 0) finalReasons.push('QUANTITY_INCREASE_INVARIANT_FAILED');
    if (compareDecimal(currentNotional, approvedNotional) > 0) finalReasons.push('APPROVED_NOTIONAL_INVARIANT_FAILED');
    if (compareDecimal(currentNotional, intendedExposure) > 0) finalReasons.push('INTENDED_EXPOSURE_INVARIANT_FAILED');
    if (compareDecimal(currentNotional, CANARY_MAXIMUM_NOTIONAL) > 0) finalReasons.push('CANARY_INVARIANT_FAILED');
    if (compareDecimal(currentNotional, effectiveCeiling) > 0) finalReasons.push('EFFECTIVE_CEILING_INVARIANT_FAILED');
    details = { ...details, resultQuantity: quantity, resultNotional: currentNotional };
    if (finalReasons.length > 0) return blocked(finalReasons, details, transformations, requirements);

    return deepFreeze({
      schema: RESULT_SCHEMA,
      staticState: 'PASS' as const,
      reasonCodes: [] as const,
      instrumentRevision: spec.instrumentRevision,
      sourceEvidenceRevision: spec.sourceEvidenceRevision,
      registryRevision: snapshot.registryRevision,
      snapshotRevision: snapshot.snapshotRevision,
      referenceEvidenceRevision: referenceEvidence?.evidenceRevision ?? null,
      evaluatedAtMs,
      instrumentValidUntilMs: spec.sourceValidUntilMs,
      referenceObservedAtMs: referenceEvidence?.observedAtMs ?? null,
      referenceValidUntilMs: referenceEvidence?.validUntilMs ?? null,
      notionalAsset: 'USDT' as const,
      requestedPrice,
      validationPrice,
      requestedQuantity,
      resultQuantity: quantity,
      resultNotional: currentNotional,
      effectiveNotionalCeiling: effectiveCeiling,
      transformations: [...transformations],
      externalRequirements: [...requirements],
      canaryMaximumNotional: CANARY_MAXIMUM_NOTIONAL,
      sendEligible: false as const,
      documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY' as const,
      externalActionAuthorization: 'NONE' as const,
      actionAuthority: 'NONE_RECORD_ONLY' as const,
    });
  } catch {
    return blocked(['STATIC_PREFLIGHT_INPUT_REJECTED'], details, transformations, requirements);
  }
}
