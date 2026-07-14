import { createHash } from 'node:crypto';

import { canonicalJson } from '../../../intelligenceFoundation/contracts/index.js';
import { compareDecimal, normalizeFilterDecimal } from './exact.js';
import type {
  BinanceInstrumentProduct,
  NormalizedFilterValue,
  NormalizedInstrumentFilter,
} from './types.js';

export type InstrumentFilterFieldKind =
  | 'DECIMAL'
  | 'POSITIVE_DECIMAL'
  | 'INTEGER'
  | 'POSITIVE_INTEGER'
  | 'INTEGER_FLEXIBLE'
  | 'BOOLEAN';

export interface InstrumentFilterDefinition {
  readonly fields: Readonly<Record<string, InstrumentFilterFieldKind>>;
  readonly privateTruthRequired: boolean;
  readonly dynamicReferenceRequired: boolean;
}

const COMMON_PRICE: InstrumentFilterDefinition = Object.freeze({
  fields: Object.freeze({ minPrice: 'DECIMAL', maxPrice: 'DECIMAL', tickSize: 'DECIMAL' }),
  privateTruthRequired: false,
  dynamicReferenceRequired: false,
});

const COMMON_LOT: InstrumentFilterDefinition = Object.freeze({
  fields: Object.freeze({ minQty: 'DECIMAL', maxQty: 'POSITIVE_DECIMAL', stepSize: 'DECIMAL' }),
  privateTruthRequired: false,
  dynamicReferenceRequired: false,
});

export const SPOT_FILTER_DEFINITIONS: Readonly<Record<string, InstrumentFilterDefinition>> = Object.freeze({
  PRICE_FILTER: COMMON_PRICE,
  PERCENT_PRICE: Object.freeze({
    fields: Object.freeze({ multiplierUp: 'POSITIVE_DECIMAL', multiplierDown: 'POSITIVE_DECIMAL', avgPriceMins: 'INTEGER' }),
    privateTruthRequired: false, dynamicReferenceRequired: true,
  }),
  PERCENT_PRICE_BY_SIDE: Object.freeze({
    fields: Object.freeze({
      bidMultiplierUp: 'POSITIVE_DECIMAL', bidMultiplierDown: 'POSITIVE_DECIMAL',
      askMultiplierUp: 'POSITIVE_DECIMAL', askMultiplierDown: 'POSITIVE_DECIMAL',
      avgPriceMins: 'INTEGER',
    }),
    privateTruthRequired: false, dynamicReferenceRequired: true,
  }),
  LOT_SIZE: COMMON_LOT,
  MIN_NOTIONAL: Object.freeze({
    fields: Object.freeze({ minNotional: 'POSITIVE_DECIMAL', applyToMarket: 'BOOLEAN', avgPriceMins: 'INTEGER' }),
    privateTruthRequired: false, dynamicReferenceRequired: true,
  }),
  NOTIONAL: Object.freeze({
    fields: Object.freeze({
      minNotional: 'POSITIVE_DECIMAL', applyMinToMarket: 'BOOLEAN',
      maxNotional: 'POSITIVE_DECIMAL', applyMaxToMarket: 'BOOLEAN', avgPriceMins: 'INTEGER',
    }),
    privateTruthRequired: false, dynamicReferenceRequired: true,
  }),
  ICEBERG_PARTS: Object.freeze({
    fields: Object.freeze({ limit: 'POSITIVE_INTEGER' }),
    privateTruthRequired: false, dynamicReferenceRequired: false,
  }),
  MARKET_LOT_SIZE: COMMON_LOT,
  MAX_NUM_ORDERS: Object.freeze({
    fields: Object.freeze({ maxNumOrders: 'POSITIVE_INTEGER' }),
    privateTruthRequired: true, dynamicReferenceRequired: false,
  }),
  MAX_NUM_ALGO_ORDERS: Object.freeze({
    fields: Object.freeze({ maxNumAlgoOrders: 'POSITIVE_INTEGER' }),
    privateTruthRequired: true, dynamicReferenceRequired: false,
  }),
  MAX_NUM_ICEBERG_ORDERS: Object.freeze({
    fields: Object.freeze({ maxNumIcebergOrders: 'POSITIVE_INTEGER' }),
    privateTruthRequired: true, dynamicReferenceRequired: false,
  }),
  MAX_POSITION: Object.freeze({
    fields: Object.freeze({ maxPosition: 'POSITIVE_DECIMAL' }),
    privateTruthRequired: true, dynamicReferenceRequired: false,
  }),
  TRAILING_DELTA: Object.freeze({
    fields: Object.freeze({
      minTrailingAboveDelta: 'INTEGER', maxTrailingAboveDelta: 'POSITIVE_INTEGER',
      minTrailingBelowDelta: 'INTEGER', maxTrailingBelowDelta: 'POSITIVE_INTEGER',
    }),
    privateTruthRequired: false, dynamicReferenceRequired: false,
  }),
  MAX_NUM_ORDER_AMENDS: Object.freeze({
    fields: Object.freeze({ maxNumOrderAmends: 'POSITIVE_INTEGER' }),
    privateTruthRequired: true, dynamicReferenceRequired: false,
  }),
  MAX_NUM_ORDER_LISTS: Object.freeze({
    fields: Object.freeze({ maxNumOrderLists: 'POSITIVE_INTEGER' }),
    privateTruthRequired: true, dynamicReferenceRequired: false,
  }),
});

export const USD_M_FILTER_DEFINITIONS: Readonly<Record<string, InstrumentFilterDefinition>> = Object.freeze({
  PRICE_FILTER: COMMON_PRICE,
  LOT_SIZE: COMMON_LOT,
  MARKET_LOT_SIZE: COMMON_LOT,
  MAX_NUM_ORDERS: Object.freeze({
    fields: Object.freeze({ limit: 'POSITIVE_INTEGER' }),
    privateTruthRequired: true, dynamicReferenceRequired: false,
  }),
  PERCENT_PRICE: Object.freeze({
    fields: Object.freeze({
      multiplierUp: 'POSITIVE_DECIMAL', multiplierDown: 'POSITIVE_DECIMAL',
      multiplierDecimal: 'INTEGER_FLEXIBLE',
    }),
    privateTruthRequired: false, dynamicReferenceRequired: true,
  }),
  MIN_NOTIONAL: Object.freeze({
    fields: Object.freeze({ notional: 'POSITIVE_DECIMAL' }),
    privateTruthRequired: false, dynamicReferenceRequired: true,
  }),
});

export function instrumentFilterDefinitions(
  product: BinanceInstrumentProduct,
): Readonly<Record<string, InstrumentFilterDefinition>> {
  return product === 'USD_M_PERPETUAL' ? USD_M_FILTER_DEFINITIONS : SPOT_FILTER_DEFINITIONS;
}

function exactCanonical(filter: NormalizedInstrumentFilter, field: string): string {
  const value = filter.values[field];
  if (typeof value !== 'object' || value === null
    || Object.keys(value).length !== 2
    || !Object.hasOwn(value, 'raw') || !Object.hasOwn(value, 'canonical')
    || typeof (value as { raw?: unknown }).raw !== 'string'
    || typeof (value as { canonical?: unknown }).canonical !== 'string') {
    throw new TypeError(`${filter.filterType}.${field} exact decimal shape invalid`);
  }
  return (value as { canonical: string }).canonical;
}

export function normalizedFilterSemanticReasonCodes(
  filter: NormalizedInstrumentFilter,
): readonly string[] {
  const reasons: string[] = [];
  if (filter.filterType === 'PRICE_FILTER') {
    const min = exactCanonical(filter, 'minPrice');
    const max = exactCanonical(filter, 'maxPrice');
    if (min !== '0' && max !== '0' && compareDecimal(min, max) > 0) {
      reasons.push('PRICE_FILTER_MINIMUM_EXCEEDS_MAXIMUM');
    }
    if (exactCanonical(filter, 'tickSize') === '0') reasons.push('PRICE_FILTER_TICK_DISABLED');
  }
  if (filter.filterType === 'LOT_SIZE' || filter.filterType === 'MARKET_LOT_SIZE') {
    const min = exactCanonical(filter, 'minQty');
    const max = exactCanonical(filter, 'maxQty');
    if (compareDecimal(min, max) > 0) reasons.push(`${filter.filterType}_MINIMUM_EXCEEDS_MAXIMUM`);
    if (exactCanonical(filter, 'stepSize') === '0') reasons.push(`${filter.filterType}_STEP_DISABLED`);
  }
  if (filter.filterType === 'NOTIONAL'
    && compareDecimal(exactCanonical(filter, 'minNotional'), exactCanonical(filter, 'maxNotional')) > 0) {
    reasons.push('NOTIONAL_MINIMUM_EXCEEDS_MAXIMUM');
  }
  if (filter.filterType === 'PERCENT_PRICE'
    && compareDecimal(exactCanonical(filter, 'multiplierDown'), exactCanonical(filter, 'multiplierUp')) > 0) {
    reasons.push('PERCENT_PRICE_MULTIPLIER_DOWN_EXCEEDS_UP');
  }
  if (filter.filterType === 'PERCENT_PRICE_BY_SIDE') {
    if (compareDecimal(exactCanonical(filter, 'bidMultiplierDown'), exactCanonical(filter, 'bidMultiplierUp')) > 0) {
      reasons.push('PERCENT_PRICE_BY_SIDE_BID_DOWN_EXCEEDS_UP');
    }
    if (compareDecimal(exactCanonical(filter, 'askMultiplierDown'), exactCanonical(filter, 'askMultiplierUp')) > 0) {
      reasons.push('PERCENT_PRICE_BY_SIDE_ASK_DOWN_EXCEEDS_UP');
    }
  }
  if (filter.filterType === 'TRAILING_DELTA') {
    const values = filter.values;
    if ((values.minTrailingAboveDelta as number) > (values.maxTrailingAboveDelta as number)
      || (values.minTrailingBelowDelta as number) > (values.maxTrailingBelowDelta as number)) {
      reasons.push('TRAILING_DELTA_MINIMUM_EXCEEDS_MAXIMUM');
    }
  }
  return Object.freeze(reasons);
}

function rawValue(kind: InstrumentFilterFieldKind, value: NormalizedFilterValue, label: string): unknown {
  if (kind === 'DECIMAL' || kind === 'POSITIVE_DECIMAL') {
    if (typeof value !== 'object' || value === null
      || Object.keys(value).length !== 2
      || !Object.hasOwn(value, 'raw') || !Object.hasOwn(value, 'canonical')) {
      throw new TypeError(`${label} exact decimal shape invalid`);
    }
    const raw = (value as { raw?: unknown }).raw;
    const canonical = (value as { canonical?: unknown }).canonical;
    const normalized = normalizeFilterDecimal(raw, kind === 'POSITIVE_DECIMAL');
    if (canonical !== normalized.canonical) throw new TypeError(`${label} canonical decimal mismatch`);
    return raw;
  }
  if (kind === 'BOOLEAN') {
    if (typeof value !== 'boolean') throw new TypeError(`${label} boolean invalid`);
    return value;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value)
    || value < (kind === 'POSITIVE_INTEGER' ? 1 : 0) || value > 1_000_000_000) {
    throw new TypeError(`${label} integer invalid`);
  }
  return value;
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function validateActiveNormalizedFilter(
  product: BinanceInstrumentProduct,
  filter: NormalizedInstrumentFilter,
): void {
  const definition = instrumentFilterDefinitions(product)[filter.filterType];
  if (definition === undefined || filter.state !== 'ACTIVE' || filter.reasonCodes.length !== 0) {
    throw new TypeError('active filter identity invalid');
  }
  if (filter.privateTruthRequired !== definition.privateTruthRequired
    || filter.dynamicReferenceRequired !== definition.dynamicReferenceRequired) {
    throw new TypeError(`${filter.filterType} truth flags mismatch`);
  }
  const keys = Object.keys(filter.values);
  const expected = Object.keys(definition.fields);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    throw new TypeError(`${filter.filterType} normalized fields mismatch`);
  }
  const wireValues: Record<string, unknown> = { filterType: filter.filterType };
  let flexibleField: string | null = null;
  for (const [field, kind] of Object.entries(definition.fields)) {
    wireValues[field] = rawValue(kind, filter.values[field], `${filter.filterType}.${field}`);
    if (kind === 'INTEGER_FLEXIBLE') flexibleField = field;
  }
  const candidates = [digest({ filterType: filter.filterType, values: wireValues })];
  if (flexibleField !== null) {
    candidates.push(digest({
      filterType: filter.filterType,
      values: { ...wireValues, [flexibleField]: String(wireValues[flexibleField]) },
    }));
  }
  if (!candidates.includes(filter.sourceContentSha256)) {
    throw new TypeError(`${filter.filterType} source content digest mismatch`);
  }
  if (normalizedFilterSemanticReasonCodes(filter).length !== 0) {
    throw new TypeError(`${filter.filterType} active state conflicts with semantics`);
  }
}
