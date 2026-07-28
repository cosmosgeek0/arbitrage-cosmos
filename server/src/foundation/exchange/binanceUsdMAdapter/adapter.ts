import { isProxy } from 'node:util/types';

import {
  compareDecimalStrings,
  isDecimalOffsetMultiple,
  multiplyDecimalStrings,
  normalizeDecimalString,
} from '../binanceUsdM/decimal.js';
import {
  BINANCE_USDM_PUBLIC_GROUNDWORK_SCHEMA,
  DEFAULT_BINANCE_USDM_PUBLIC_GROUNDWORK_CONFIG,
} from '../binanceUsdM/validation.js';
import {
  BINANCE_USDM_BASIS_ADAPTER_SCHEMA,
  BINANCE_USDM_BASIS_QUERY_DESCRIPTOR_SCHEMA,
  BINANCE_USDM_BASIS_QUERY_RESOLUTION_SCHEMA,
  BINANCE_USDM_BASIS_WIRE_INTENT_SCHEMA,
  type BinanceUsdMBasisAdapterBlockingCode,
  type BinanceUsdMBasisAdapterConfig,
  type BinanceUsdMBasisConfirmedOrder,
  type BinanceUsdMBasisIntentInput,
  type BinanceUsdMBasisIntentResult,
  type BinanceUsdMBasisOrderType,
  type BinanceUsdMBasisQueryDescriptor,
  type BinanceUsdMBasisQueryDescriptorResult,
  type BinanceUsdMBasisQueryEvidence,
  type BinanceUsdMBasisQueryResolution,
  type BinanceUsdMBasisValidateOnlyAdapter,
  type BinanceUsdMBasisWireIntent,
} from './types.js';

const SYMBOL_PATTERN = /^[A-Z0-9._-]{1,40}$/;
const CLIENT_ORDER_ID_PATTERN = /^[.A-Z:/a-z0-9_-]{1,36}$/;
const CAPABILITY_PATTERN = /^[A-Z0-9_]{1,64}$/;
const PROVENANCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const PUBLIC_AUTHORITIES = new Set([
  'LIVE_PUBLIC',
  'RECORDED_REPLAY',
  'SYNTHETIC_TEST',
]);
const MAX_DATA_RECORD_KEYS = 64;
const QUERY_STATUSES = new Set([
  'NEW',
  'PARTIALLY_FILLED',
  'FILLED',
  'CANCELED',
  'EXPIRED',
  'EXPIRED_IN_MATCH',
  'REJECTED',
]);
const TERMINAL_QUERY_STATUSES = new Set([
  'FILLED',
  'CANCELED',
  'EXPIRED',
  'EXPIRED_IN_MATCH',
  'REJECTED',
]);
const LIMITATIONS = Object.freeze([
  'PRIVATE_MAX_NUM_ORDERS_UNEVALUATED',
  'MATCHING_ENGINE_ACCEPTANCE_UNPROVEN',
] as const);
const NO_CODES = Object.freeze(
  [] as BinanceUsdMBasisAdapterBlockingCode[],
);

const PRODUCED_INTENT_RESULTS = new WeakSet<object>();
const PRODUCED_WIRE_INTENTS = new WeakSet<object>();
const PRODUCED_QUERY_RESULTS = new WeakSet<object>();
const PRODUCED_QUERY_DESCRIPTORS = new WeakSet<object>();
const PRODUCED_QUERY_RESOLUTIONS = new WeakSet<object>();

type SafeRecord = Readonly<Record<string, unknown>>;

interface TimestampIdentity {
  readonly sourceTimeMs: number | null;
  readonly receivedAtMs: number;
  readonly maxAgeMs: number;
  readonly authority: 'LIVE_PUBLIC' | 'RECORDED_REPLAY' | 'SYNTHETIC_TEST';
  readonly completeness: 'COMPLETE';
  readonly sourceId: string;
}

interface DecimalRange {
  readonly min: string;
  readonly max: string;
  readonly increment: string;
}

interface PublicContext {
  readonly sourceId: string;
  readonly sourceTimeMs: number | null;
  readonly receivedAtMs: number;
  readonly maxAgeMs: number;
  readonly authority: TimestampIdentity['authority'];
  readonly referenceMarkPrice: string;
  readonly referenceMarkPriceRevision: string;
  readonly referenceMarkPriceObservedAt: TimestampIdentity & {
    readonly sourceTimeMs: number;
  };
  readonly price: DecimalRange;
  readonly lotSize: DecimalRange;
  readonly marketLotSize: DecimalRange;
  readonly minNotional: string;
  readonly multiplierUp: string;
  readonly multiplierDown: string;
  readonly publicMaxNumOrders: number | null;
  readonly orderTypes: readonly string[];
  readonly timeInForce: readonly string[];
}

interface FreshEvidenceTiming {
  readonly evaluatedAtMs: number;
  readonly observedAtMs: number;
  readonly receivedAtMs: number;
  readonly maxAgeMs: number;
  readonly authority: 'SYNTHETIC_TEST' | 'RECORDED_REPLAY';
}

interface PositionModeEvidence extends FreshEvidenceTiming {
  readonly mode: 'ONE_WAY';
  readonly scope: 'ACCOUNT';
  readonly symbol: null;
  readonly sourceId: string;
  readonly revision: string;
}

interface ConfigSnapshot {
  readonly valid: boolean;
  readonly enabled: boolean;
  readonly sourceEnabled: boolean;
  readonly killSwitchEngaged: boolean | null;
  readonly authority: 'NONE';
  readonly allowedSymbols: readonly string[];
}

const MAX_INJECTED_EVIDENCE_AGE_MS = 300_000;
const MAX_PUBLIC_FILTER_AGE_MS =
  DEFAULT_BINANCE_USDM_PUBLIC_GROUNDWORK_CONFIG.maximumFilterAgeMs;
const MAX_PUBLIC_FORECAST_AGE_MS =
  DEFAULT_BINANCE_USDM_PUBLIC_GROUNDWORK_CONFIG.maximumForecastAgeMs;

export const DEFAULT_BINANCE_USDM_BASIS_ADAPTER_CONFIG:
  Readonly<BinanceUsdMBasisAdapterConfig> = Object.freeze({
    enabled: false,
    sourceEnabled: false,
    killSwitchEngaged: true,
    authority: 'NONE',
    allowedSymbols: Object.freeze([]),
  });

function plainDataRecord(value: unknown): SafeRecord | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  try {
    if (isProxy(value) || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length > MAX_DATA_RECORD_KEYS ||
      keys.some((key) => typeof key !== 'string')
    ) {
      return null;
    }
    const descriptors = Object.getOwnPropertyDescriptors(
      value,
    ) as Record<string, PropertyDescriptor>;
    if (keys.length !== Object.keys(descriptors).length) {
      return null;
    }
    const copy: Record<string, unknown> = Object.create(null);
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        !Object.hasOwn(descriptor, 'value') ||
        descriptor.get !== undefined ||
        descriptor.set !== undefined
      ) {
        return null;
      }
      copy[key] = descriptor.value;
    }
    return Object.freeze(copy);
  } catch {
    return null;
  }
}

function plainDataArray(value: unknown, maximum = 256): readonly unknown[] | null {
  try {
    if (isProxy(value) || !Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Array.prototype) return null;
    const length = value.length;
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > maximum
    ) {
      return null;
    }
    const keys = Reflect.ownKeys(value);
    if (
      keys.some((key) => typeof key !== 'string') ||
      keys.length !== length + 1
    ) {
      return null;
    }
    const descriptors = Object.getOwnPropertyDescriptors(
      value,
    ) as Record<string, PropertyDescriptor>;
    const lengthDescriptor = descriptors.length;
    if (
      lengthDescriptor === undefined ||
      !Object.hasOwn(lengthDescriptor, 'value') ||
      typeof lengthDescriptor.value !== 'number' ||
      lengthDescriptor.value !== length
    ) {
      return null;
    }
    const copy: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        descriptor === undefined ||
        !Object.hasOwn(descriptor, 'value') ||
        descriptor.get !== undefined ||
        descriptor.set !== undefined
      ) {
        return null;
      }
      copy.push(descriptor.value);
    }
    return Object.freeze(copy);
  } catch {
    return null;
  }
}

function exactStringArray(
  value: unknown,
  maximum = 64,
): readonly string[] | null {
  const values = plainDataArray(value, maximum);
  if (
    values === null ||
    !values.every(
      (item) =>
        typeof item === 'string' && CAPABILITY_PATTERN.test(item),
    ) ||
    new Set(values).size !== values.length
  ) {
    return null;
  }
  return Object.freeze([...values] as string[]);
}

function canonicalDecimal(
  value: unknown,
  rule: 'NON_NEGATIVE' | 'POSITIVE',
): string | null {
  if (typeof value !== 'string') return null;
  try {
    const normalized = normalizeDecimalString(value);
    if (normalized !== value) return null;
    const compared = compareDecimalStrings(normalized, '0');
    if (
      (rule === 'POSITIVE' && compared <= 0) ||
      (rule === 'NON_NEGATIVE' && compared < 0)
    ) {
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}

/**
 * Binance query responses commonly right-pad exact decimal strings. Preserve
 * exact arithmetic while accepting that wire representation and rejecting
 * exponent syntax, signs on positive values, and negative zero.
 */
function normalizedResponseDecimal(
  value: unknown,
  rule: 'NON_NEGATIVE' | 'POSITIVE',
): string | null {
  if (
    typeof value !== 'string' ||
    value.startsWith('+') ||
    value.startsWith('-')
  ) {
    return null;
  }
  try {
    const normalized = normalizeDecimalString(value);
    const compared = compareDecimalStrings(normalized, '0');
    if (
      (rule === 'POSITIVE' && compared <= 0) ||
      (rule === 'NON_NEGATIVE' && compared < 0)
    ) {
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}

function parseTimestampIdentity(
  value: unknown,
  nowMs: number,
  maximumAgeMs: number,
  sourceTimeRequirement: 'ANY' | 'REQUIRED',
): TimestampIdentity | null {
  const record = plainDataRecord(value);
  if (record === null) return null;
  const sourceTimeMs = record.sourceTimeMs;
  const receivedAtMs = record.receivedAtMs;
  const maxAgeMs = record.maxAgeMs;
  const authority = record.authority;
  const completeness = record.completeness;
  const sourceId = record.sourceId;
  if (
    !(
      sourceTimeMs === null ||
      (typeof sourceTimeMs === 'number' &&
        Number.isSafeInteger(sourceTimeMs) &&
        sourceTimeMs >= 0)
    ) ||
    typeof receivedAtMs !== 'number' ||
    !Number.isSafeInteger(receivedAtMs) ||
    receivedAtMs < 0 ||
    typeof maxAgeMs !== 'number' ||
    !Number.isSafeInteger(maxAgeMs) ||
    maxAgeMs <= 0 ||
    maxAgeMs > maximumAgeMs ||
    typeof authority !== 'string' ||
    !PUBLIC_AUTHORITIES.has(authority) ||
    completeness !== 'COMPLETE' ||
    typeof sourceId !== 'string' ||
    !PROVENANCE_PATTERN.test(sourceId) ||
    (sourceTimeRequirement === 'REQUIRED' && sourceTimeMs === null) ||
    receivedAtMs > nowMs ||
    (sourceTimeMs !== null &&
      (sourceTimeMs > receivedAtMs || sourceTimeMs > nowMs)) ||
    nowMs - (sourceTimeMs ?? receivedAtMs) > maxAgeMs
  ) {
    return null;
  }
  return Object.freeze({
    sourceTimeMs,
    receivedAtMs,
    maxAgeMs,
    authority:
      authority as
        | 'LIVE_PUBLIC'
        | 'RECORDED_REPLAY'
        | 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceId,
  });
}

function sameTimestamp(
  left: TimestampIdentity,
  right: TimestampIdentity,
): boolean {
  return (
    left.sourceTimeMs === right.sourceTimeMs &&
    left.receivedAtMs === right.receivedAtMs &&
    left.maxAgeMs === right.maxAgeMs &&
    left.authority === right.authority &&
    left.completeness === right.completeness &&
    left.sourceId === right.sourceId
  );
}

function validUtcMillis(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function parseFreshEvidenceTiming(
  record: SafeRecord,
  nowMs: number,
):
  | { readonly ok: true; readonly value: FreshEvidenceTiming }
  | {
      readonly ok: false;
      readonly reason: 'INVALID' | 'AUTHORITY' | 'FUTURE' | 'STALE';
    } {
  const observedAtMs = record.observedAtMs;
  const receivedAtMs = record.receivedAtMs;
  const maxAgeMs = record.maxAgeMs;
  const authority = record.authority;
  if (
    !validUtcMillis(nowMs) ||
    !validUtcMillis(observedAtMs) ||
    !validUtcMillis(receivedAtMs) ||
    typeof maxAgeMs !== 'number' ||
    !Number.isSafeInteger(maxAgeMs) ||
    maxAgeMs <= 0 ||
    maxAgeMs > MAX_INJECTED_EVIDENCE_AGE_MS
  ) {
    return Object.freeze({ ok: false, reason: 'INVALID' });
  }
  if (
    authority !== 'SYNTHETIC_TEST' &&
    authority !== 'RECORDED_REPLAY'
  ) {
    return Object.freeze({ ok: false, reason: 'AUTHORITY' });
  }
  if (
    observedAtMs > receivedAtMs ||
    receivedAtMs > nowMs ||
    observedAtMs > nowMs
  ) {
    return Object.freeze({ ok: false, reason: 'FUTURE' });
  }
  if (
    nowMs - receivedAtMs > maxAgeMs ||
    nowMs - observedAtMs > maxAgeMs
  ) {
    return Object.freeze({ ok: false, reason: 'STALE' });
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      evaluatedAtMs: nowMs,
      observedAtMs,
      receivedAtMs,
      maxAgeMs,
      authority,
    }),
  });
}

function parsePositionModeEvidence(
  value: unknown,
  nowMs: number,
  codes: BinanceUsdMBasisAdapterBlockingCode[],
): PositionModeEvidence | null {
  const record = plainDataRecord(value);
  if (record === null) {
    codes.push('POSITION_MODE_EVIDENCE_INVALID');
    return null;
  }
  const timing = parseFreshEvidenceTiming(record, nowMs);
  if (!timing.ok) {
    codes.push(
      timing.reason === 'AUTHORITY'
        ? 'POSITION_MODE_AUTHORITY_INVALID'
        : timing.reason === 'FUTURE'
          ? 'POSITION_MODE_EVIDENCE_FUTURE'
          : timing.reason === 'STALE'
            ? 'POSITION_MODE_EVIDENCE_STALE'
            : 'POSITION_MODE_EVIDENCE_INVALID',
    );
    return null;
  }
  if (
    record.scope !== 'ACCOUNT' ||
    record.symbol !== null ||
    typeof record.sourceId !== 'string' ||
    !PROVENANCE_PATTERN.test(record.sourceId) ||
    typeof record.revision !== 'string' ||
    !PROVENANCE_PATTERN.test(record.revision) ||
    (record.mode !== 'ONE_WAY' &&
      record.mode !== 'HEDGE' &&
      record.mode !== 'UNKNOWN')
  ) {
    codes.push('POSITION_MODE_EVIDENCE_INVALID');
    return null;
  }
  if (record.mode === 'UNKNOWN') {
    codes.push('POSITION_MODE_UNKNOWN');
    return null;
  }
  if (record.mode !== 'ONE_WAY') {
    codes.push('POSITION_MODE_UNSUPPORTED');
    return null;
  }
  return Object.freeze({
    ...timing.value,
    mode: 'ONE_WAY',
    scope: 'ACCOUNT',
    symbol: null,
    sourceId: record.sourceId,
    revision: record.revision,
  });
}

function parseRange(
  value: unknown,
  fieldNames: readonly [string, string, string],
  minimumRule: 'NON_NEGATIVE' | 'POSITIVE',
): DecimalRange | null {
  const record = plainDataRecord(value);
  if (record === null) return null;
  const min = canonicalDecimal(record[fieldNames[0]], minimumRule);
  const max = canonicalDecimal(record[fieldNames[1]], 'POSITIVE');
  const increment = canonicalDecimal(record[fieldNames[2]], 'POSITIVE');
  if (
    min === null ||
    max === null ||
    increment === null ||
    compareDecimalStrings(min, max) > 0
  ) {
    return null;
  }
  return Object.freeze({ min, max, increment });
}

function parseConfig(value: unknown): ConfigSnapshot {
  const fallback = Object.freeze({
    valid: false,
    enabled: false,
    sourceEnabled: false,
    killSwitchEngaged: true,
    authority: 'NONE' as const,
    allowedSymbols: Object.freeze([] as string[]),
  });
  const record = plainDataRecord(value);
  if (record === null) return fallback;
  const symbols = exactStringArray(record.allowedSymbols, 500);
  if (
    typeof record.enabled !== 'boolean' ||
    typeof record.sourceEnabled !== 'boolean' ||
    !(
      typeof record.killSwitchEngaged === 'boolean' ||
      record.killSwitchEngaged === null
    ) ||
    record.authority !== 'NONE' ||
    symbols === null ||
    !symbols.every((symbol) => SYMBOL_PATTERN.test(symbol))
  ) {
    return fallback;
  }
  return Object.freeze({
    valid: true,
    enabled: record.enabled,
    sourceEnabled: record.sourceEnabled,
    killSwitchEngaged: record.killSwitchEngaged,
    authority: 'NONE' as const,
    allowedSymbols: symbols,
  });
}

function controlBlockingCodes(
  config: ConfigSnapshot,
  symbol: unknown,
): BinanceUsdMBasisAdapterBlockingCode[] {
  const codes: BinanceUsdMBasisAdapterBlockingCode[] = [];
  if (!config.valid) codes.push('CONFIG_INVALID');
  if (!config.enabled) codes.push('ADAPTER_DISABLED');
  if (!config.sourceEnabled) codes.push('SOURCE_DISABLED');
  if (config.killSwitchEngaged !== false) {
    codes.push('KILL_SWITCH_ENGAGED_OR_UNKNOWN');
  }
  if (config.authority !== 'NONE') codes.push('AUTHORITY_INVALID');
  if (typeof symbol !== 'string' || !SYMBOL_PATTERN.test(symbol)) {
    codes.push('SYMBOL_INVALID');
  } else if (!config.allowedSymbols.includes(symbol)) {
    codes.push('SYMBOL_NOT_ALLOWLISTED');
  }
  return codes;
}

function parsePublicContext(
  value: unknown,
  symbol: string,
  type: BinanceUsdMBasisOrderType,
  nowMs: number,
  codes: BinanceUsdMBasisAdapterBlockingCode[],
): PublicContext | null {
  const evidence = plainDataRecord(value);
  if (evidence === null) {
    codes.push('PUBLIC_VALIDATION_INVALID');
    return null;
  }
  const groundwork = plainDataRecord(evidence.groundwork);
  const orderCapabilities = plainDataRecord(evidence.orderCapabilities);
  if (groundwork === null || orderCapabilities === null) {
    codes.push('PUBLIC_VALIDATION_INVALID');
    return null;
  }
  const blockingCodes = plainDataArray(groundwork.blockingCodes, 64);
  const permittedActions = plainDataArray(
    groundwork.permittedExternalActions,
    0,
  );
  if (
    groundwork.schema !== BINANCE_USDM_PUBLIC_GROUNDWORK_SCHEMA ||
    groundwork.version !== 1 ||
    groundwork.mode !== 'VALIDATE_ONLY' ||
    groundwork.authority !== 'NONE' ||
    groundwork.externalActionAuthorization !== 'NONE' ||
    groundwork.evaluatedAtMs !== nowMs ||
    groundwork.networkRequestsPerformed !== 0 ||
    groundwork.privateRequestsPerformed !== 0 ||
    groundwork.signedRequestsPerformed !== 0 ||
    groundwork.ordersPerformed !== 0 ||
    groundwork.sideEffectsPerformed !== 0 ||
    blockingCodes === null ||
    permittedActions === null
  ) {
    codes.push('PUBLIC_VALIDATION_INVALID');
    return null;
  }
  if (groundwork.validationPassed !== true || blockingCodes.length !== 0) {
    codes.push('PUBLIC_VALIDATION_BLOCKED');
    return null;
  }
  if (groundwork.symbol !== symbol) {
    codes.push('PUBLIC_SYMBOL_MISMATCH');
    return null;
  }

  const filters = plainDataRecord(groundwork.filters);
  const forecast = plainDataRecord(groundwork.fundingForecast);
  if (filters === null || forecast === null) {
    codes.push('PUBLIC_FILTER_UNAVAILABLE');
    return null;
  }
  const filterTimestamp = parseTimestampIdentity(
    filters.observedAt,
    nowMs,
    MAX_PUBLIC_FILTER_AGE_MS,
    'ANY',
  );
  const capabilityTimestamp = parseTimestampIdentity(
    orderCapabilities.observedAt,
    nowMs,
    MAX_PUBLIC_FILTER_AGE_MS,
    'ANY',
  );
  const capabilityRevision = orderCapabilities.revision;
  const orderTypes = exactStringArray(orderCapabilities.orderTypes, 64);
  const timeInForce = exactStringArray(
    orderCapabilities.timeInForce,
    64,
  );
  if (
    filterTimestamp === null ||
    capabilityTimestamp === null ||
    !sameTimestamp(filterTimestamp, capabilityTimestamp) ||
    typeof capabilityRevision !== 'string' ||
    !PROVENANCE_PATTERN.test(capabilityRevision) ||
    orderTypes === null ||
    timeInForce === null ||
    !orderTypes.includes(type) ||
    (type === 'LIMIT' && !timeInForce.includes('GTC'))
  ) {
    codes.push('PUBLIC_CAPABILITY_UNKNOWN');
    return null;
  }
  const price = parseRange(
    filters.price,
    ['minPrice', 'maxPrice', 'tickSize'],
    'NON_NEGATIVE',
  );
  const lotSize = parseRange(
    filters.lotSize,
    ['minQty', 'maxQty', 'stepSize'],
    'POSITIVE',
  );
  const marketLotSize = parseRange(
    filters.marketLotSize,
    ['minQty', 'maxQty', 'stepSize'],
    'POSITIVE',
  );
  const minNotional = canonicalDecimal(
    filters.minNotional,
    'POSITIVE',
  );
  const percent = plainDataRecord(filters.percentPrice);
  const multiplierUp =
    percent === null
      ? null
      : canonicalDecimal(percent.multiplierUp, 'POSITIVE');
  const multiplierDown =
    percent === null
      ? null
      : canonicalDecimal(percent.multiplierDown, 'POSITIVE');
  const unsupported = exactStringArray(
    filters.unsupportedFilterTypes,
    32,
  );
  const maxNumOrders = filters.maxNumOrders;
  if (
    price === null ||
    lotSize === null ||
    marketLotSize === null ||
    minNotional === null ||
    multiplierUp === null ||
    multiplierDown === null ||
    compareDecimalStrings(multiplierDown, multiplierUp) > 0 ||
    percent?.multiplierDecimal === undefined ||
    typeof percent.multiplierDecimal !== 'number' ||
    !Number.isSafeInteger(percent.multiplierDecimal) ||
    percent.multiplierDecimal < 0 ||
    unsupported === null ||
    unsupported.length !== 0 ||
    filters.maxNumOrdersEvaluation !==
      'NOT_EVALUATED_PRIVATE_OPEN_ORDER_TRUTH_UNAVAILABLE' ||
    !(
      maxNumOrders === null ||
      (typeof maxNumOrders === 'number' &&
        Number.isSafeInteger(maxNumOrders) &&
        maxNumOrders > 0)
    )
  ) {
    codes.push('PUBLIC_FILTER_MALFORMED');
    return null;
  }
  const forecastValue = plainDataRecord(forecast.value);
  const forecastTimestamp = parseTimestampIdentity(
    forecast.observedAt,
    nowMs,
    MAX_PUBLIC_FORECAST_AGE_MS,
    'REQUIRED',
  );
  const forecastRevision = forecast.evidenceRevision;
  const referenceMarkPrice =
    forecastValue === null
      ? null
      : canonicalDecimal(forecastValue.markPrice, 'POSITIVE');
  if (
    forecast.kind !== 'FORECAST_ONLY' ||
    forecast.capturedAsSettlement !== false ||
    typeof forecastRevision !== 'string' ||
    !PROVENANCE_PATTERN.test(forecastRevision) ||
    forecastTimestamp === null ||
    forecastTimestamp.sourceTimeMs === null ||
    forecastValue?.symbol !== symbol ||
    forecastValue.sourceTimeMs !== forecastTimestamp.sourceTimeMs ||
    referenceMarkPrice === null
  ) {
    codes.push('PUBLIC_VALIDATION_INVALID');
    return null;
  }
  return Object.freeze({
    sourceId: filterTimestamp.sourceId,
    sourceTimeMs: filterTimestamp.sourceTimeMs,
    receivedAtMs: filterTimestamp.receivedAtMs,
    maxAgeMs: filterTimestamp.maxAgeMs,
    authority: filterTimestamp.authority,
    referenceMarkPrice,
    referenceMarkPriceRevision: forecastRevision,
    referenceMarkPriceObservedAt: Object.freeze({
      ...forecastTimestamp,
      sourceTimeMs: forecastTimestamp.sourceTimeMs,
    }),
    price,
    lotSize,
    marketLotSize,
    minNotional,
    multiplierUp,
    multiplierDown,
    publicMaxNumOrders:
      typeof maxNumOrders === 'number' ? maxNumOrders : null,
    orderTypes,
    timeInForce,
  });
}

function validateRange(
  value: string,
  range: DecimalRange,
  outOfRangeCode:
    | 'QUANTITY_OUT_OF_RANGE'
    | 'PRICE_OUT_OF_RANGE',
  misalignedCode:
    | 'QUANTITY_STEP_MISMATCH'
    | 'PRICE_TICK_MISMATCH',
  codes: BinanceUsdMBasisAdapterBlockingCode[],
): void {
  if (
    compareDecimalStrings(value, range.min) < 0 ||
    compareDecimalStrings(value, range.max) > 0
  ) {
    codes.push(outOfRangeCode);
  }
  if (!isDecimalOffsetMultiple(value, range.min, range.increment)) {
    codes.push(misalignedCode);
  }
}

function validateFilters(
  quantity: string,
  price: string | null,
  type: BinanceUsdMBasisOrderType,
  side: 'BUY' | 'SELL',
  context: PublicContext,
  codes: BinanceUsdMBasisAdapterBlockingCode[],
): void {
  validateRange(
    quantity,
    context.lotSize,
    'QUANTITY_OUT_OF_RANGE',
    'QUANTITY_STEP_MISMATCH',
    codes,
  );
  if (type === 'MARKET') {
    validateRange(
      quantity,
      context.marketLotSize,
      'QUANTITY_OUT_OF_RANGE',
      'QUANTITY_STEP_MISMATCH',
      codes,
    );
  }
  if (price !== null) {
    validateRange(
      price,
      context.price,
      'PRICE_OUT_OF_RANGE',
      'PRICE_TICK_MISMATCH',
      codes,
    );
    const lower = multiplyDecimalStrings(
      context.referenceMarkPrice,
      context.multiplierDown,
    );
    const upper = multiplyDecimalStrings(
      context.referenceMarkPrice,
      context.multiplierUp,
    );
    if (
      (side === 'BUY' && compareDecimalStrings(price, upper) > 0) ||
      (side === 'SELL' && compareDecimalStrings(price, lower) < 0)
    ) {
      codes.push('PERCENT_PRICE_OUT_OF_RANGE');
    }
  }
  const valuationPrice = price ?? context.referenceMarkPrice;
  if (
    compareDecimalStrings(
      multiplyDecimalStrings(quantity, valuationPrice),
      context.minNotional,
    ) < 0
  ) {
    codes.push('NOTIONAL_BELOW_MIN');
  }
}

function brandIntentResult(
  result: BinanceUsdMBasisIntentResult,
): Readonly<BinanceUsdMBasisIntentResult> {
  const frozen = Object.freeze(result);
  PRODUCED_INTENT_RESULTS.add(frozen);
  return frozen;
}

function blockedIntent(
  codes: readonly BinanceUsdMBasisAdapterBlockingCode[],
): Readonly<BinanceUsdMBasisIntentResult> {
  return brandIntentResult({
    schema: BINANCE_USDM_BASIS_ADAPTER_SCHEMA,
    version: 1,
    mode: 'VALIDATE_ONLY',
    ok: false,
    intent: null,
    blockingCodes: Object.freeze([...new Set(codes)]),
    sendEligible: false,
    authority: 'NONE',
    networkRequestsPerformed: 0,
    privateRequestsPerformed: 0,
    signedRequestsPerformed: 0,
    testOrdersPerformed: 0,
    ordersPerformed: 0,
    sideEffectsPerformed: 0,
  });
}

function brandQueryResult(
  result: BinanceUsdMBasisQueryDescriptorResult,
): Readonly<BinanceUsdMBasisQueryDescriptorResult> {
  const frozen = Object.freeze(result);
  PRODUCED_QUERY_RESULTS.add(frozen);
  return frozen;
}

function blockedQueryDescriptor(
  codes: readonly BinanceUsdMBasisAdapterBlockingCode[],
): Readonly<BinanceUsdMBasisQueryDescriptorResult> {
  return brandQueryResult({
    schema: BINANCE_USDM_BASIS_ADAPTER_SCHEMA,
    version: 1,
    mode: 'VALIDATE_ONLY',
    ok: false,
    descriptor: null,
    blockingCodes: Object.freeze([...new Set(codes)]),
    authority: 'NONE',
    networkRequestsPerformed: 0,
    privateRequestsPerformed: 0,
    signedRequestsPerformed: 0,
    sideEffectsPerformed: 0,
  });
}

function brandResolution(
  resolution: BinanceUsdMBasisQueryResolution,
): Readonly<BinanceUsdMBasisQueryResolution> {
  const frozen = Object.freeze(resolution);
  PRODUCED_QUERY_RESOLUTIONS.add(frozen);
  return frozen;
}

function unresolvedQuery(
  codes: readonly BinanceUsdMBasisAdapterBlockingCode[],
  timing: FreshEvidenceTiming | null = null,
): Readonly<BinanceUsdMBasisQueryResolution> {
  return brandResolution({
    schema: BINANCE_USDM_BASIS_QUERY_RESOLUTION_SCHEMA,
    version: 1,
    mode: 'VALIDATE_ONLY',
    state: 'UNRESOLVED',
    order: null,
    blockingCodes: Object.freeze([...new Set(codes)]),
    queryFirstRequired: true,
    blindResubmitAllowed: false,
    replacementClientOrderId: null,
    evaluatedAtMs: timing?.evaluatedAtMs ?? null,
    observedAtMs: timing?.observedAtMs ?? null,
    receivedAtMs: timing?.receivedAtMs ?? null,
    maxAgeMs: timing?.maxAgeMs ?? null,
    evidenceAuthority: timing?.authority ?? null,
    authority: 'NONE',
    networkRequestsPerformed: 0,
    privateRequestsPerformed: 0,
    signedRequestsPerformed: 0,
    ordersPerformed: 0,
    sideEffectsPerformed: 0,
  });
}

function parseFoundOrder(
  value: unknown,
  intent: Readonly<BinanceUsdMBasisWireIntent>,
  codes: BinanceUsdMBasisAdapterBlockingCode[],
): Readonly<BinanceUsdMBasisConfirmedOrder> | null {
  const order = plainDataRecord(value);
  if (order === null) {
    codes.push('QUERY_EVIDENCE_INVALID');
    return null;
  }
  const origQty = normalizedResponseDecimal(order.origQty, 'POSITIVE');
  const executedQty = normalizedResponseDecimal(
    order.executedQty,
    'NON_NEGATIVE',
  );
  const price = normalizedResponseDecimal(
    order.price,
    'NON_NEGATIVE',
  );
  if (
    typeof order.status !== 'string' ||
    !QUERY_STATUSES.has(order.status)
  ) {
    codes.push('QUERY_STATUS_UNKNOWN');
  }
  if (origQty === null || executedQty === null || price === null) {
    codes.push('QUERY_EVIDENCE_INVALID');
    return null;
  }
  if (typeof order.status === 'string' && QUERY_STATUSES.has(order.status)) {
    const fillComparedWithZero = compareDecimalStrings(executedQty, '0');
    const fillComparedWithOriginal = compareDecimalStrings(
      executedQty,
      origQty,
    );
    const fillCoherent =
      (order.status === 'FILLED' && fillComparedWithOriginal === 0) ||
      ((order.status === 'NEW' || order.status === 'REJECTED') &&
        fillComparedWithZero === 0) ||
      (order.status === 'PARTIALLY_FILLED' &&
        fillComparedWithZero > 0 &&
        fillComparedWithOriginal < 0) ||
      ((order.status === 'CANCELED' ||
        order.status === 'EXPIRED' ||
        order.status === 'EXPIRED_IN_MATCH') &&
        fillComparedWithZero >= 0 &&
        fillComparedWithOriginal < 0);
    if (!fillCoherent) codes.push('QUERY_STATUS_FILL_INCOHERENT');
  }
  if (
    order.symbol !== intent.symbol ||
    order.clientOrderId !== intent.existingClientOrderId ||
    order.side !== intent.side ||
    order.type !== intent.type ||
    origQty !== intent.quantity ||
    order.timeInForce !== 'GTC' ||
    order.positionSide !== intent.positionSide ||
    order.reduceOnly !== intent.reduceOnly ||
    order.closePosition !== false ||
    (intent.type === 'LIMIT' && price !== intent.price) ||
    (intent.type === 'MARKET' && price !== '0') ||
    compareDecimalStrings(executedQty, origQty) > 0
  ) {
    codes.push('QUERY_IDENTITY_MISMATCH');
  }
  if (codes.length > 0) return null;
  const status =
    order.status as BinanceUsdMBasisConfirmedOrder['status'];
  return Object.freeze({
    symbol: intent.symbol,
    clientOrderId: intent.existingClientOrderId,
    side: intent.side,
    type: intent.type,
    origQty,
    executedQty,
    price,
    timeInForce: intent.timeInForce,
    venueTimeInForce: 'GTC',
    positionSide: 'BOTH',
    reduceOnly: intent.reduceOnly,
    closePosition: false,
    status,
    terminal: TERMINAL_QUERY_STATUSES.has(status),
  });
}

export function isBinanceUsdMBasisIntentResult(
  value: unknown,
): value is Readonly<BinanceUsdMBasisIntentResult> {
  return (
    value !== null &&
    typeof value === 'object' &&
    PRODUCED_INTENT_RESULTS.has(value)
  );
}

export function isBinanceUsdMBasisWireIntent(
  value: unknown,
): value is Readonly<BinanceUsdMBasisWireIntent> {
  return (
    value !== null &&
    typeof value === 'object' &&
    PRODUCED_WIRE_INTENTS.has(value)
  );
}

export function isBinanceUsdMBasisQueryDescriptorResult(
  value: unknown,
): value is Readonly<BinanceUsdMBasisQueryDescriptorResult> {
  return (
    value !== null &&
    typeof value === 'object' &&
    PRODUCED_QUERY_RESULTS.has(value)
  );
}

export function isBinanceUsdMBasisQueryDescriptor(
  value: unknown,
): value is Readonly<BinanceUsdMBasisQueryDescriptor> {
  return (
    value !== null &&
    typeof value === 'object' &&
    PRODUCED_QUERY_DESCRIPTORS.has(value)
  );
}

export function isBinanceUsdMBasisQueryResolution(
  value: unknown,
): value is Readonly<BinanceUsdMBasisQueryResolution> {
  return (
    value !== null &&
    typeof value === 'object' &&
    PRODUCED_QUERY_RESOLUTIONS.has(value)
  );
}

export function createBinanceUsdMBasisValidateOnlyAdapter(
  config: Readonly<BinanceUsdMBasisAdapterConfig> =
    DEFAULT_BINANCE_USDM_BASIS_ADAPTER_CONFIG,
): Readonly<BinanceUsdMBasisValidateOnlyAdapter> {
  const snapshot = parseConfig(config);
  return Object.freeze({
    schema: BINANCE_USDM_BASIS_ADAPTER_SCHEMA,
    version: 1,
    mode: 'VALIDATE_ONLY',
    enabled: snapshot.enabled,
    sourceEnabled: snapshot.sourceEnabled,
    killSwitchEngaged: snapshot.killSwitchEngaged,
    authority: 'NONE',
    buildOrderIntent(
      input: Readonly<BinanceUsdMBasisIntentInput>,
    ): Readonly<BinanceUsdMBasisIntentResult> {
      const value = plainDataRecord(input);
      if (value === null) return blockedIntent(['INPUT_INVALID']);
      const codes = controlBlockingCodes(snapshot, value.symbol);
      const nowMs = value.nowMs;
      if (!validUtcMillis(nowMs)) {
        codes.push('EVALUATION_TIME_INVALID');
      }
      if (
        typeof value.existingClientOrderId !== 'string' ||
        !CLIENT_ORDER_ID_PATTERN.test(value.existingClientOrderId)
      ) {
        codes.push('CLIENT_ORDER_ID_INVALID');
      }
      if (value.leg !== 'PERP_OPEN' && value.leg !== 'PERP_CLOSE') {
        codes.push('LEG_INVALID');
      }
      if (value.positionSide !== 'BOTH') {
        codes.push('POSITION_SIDE_INVALID');
      }
      if (value.type !== 'LIMIT' && value.type !== 'MARKET') {
        codes.push('ORDER_TYPE_INVALID');
      }
      const quantity = canonicalDecimal(value.quantity, 'POSITIVE');
      if (quantity === null) codes.push('QUANTITY_INVALID');
      let price: string | null = null;
      if (value.type === 'LIMIT') {
        price = canonicalDecimal(value.price, 'POSITIVE');
        if (price === null) codes.push('PRICE_INVALID');
      } else if (value.type === 'MARKET' && value.price !== undefined) {
        codes.push('PRICE_INVALID');
      }
      const positionModeEvidence =
        typeof value.symbol === 'string' && validUtcMillis(nowMs)
          ? parsePositionModeEvidence(
              value.positionModeEvidence,
              nowMs,
              codes,
            )
          : null;
      const context =
        typeof value.symbol === 'string' &&
        validUtcMillis(nowMs) &&
        (value.type === 'LIMIT' || value.type === 'MARKET')
          ? parsePublicContext(
              value.publicEvidence,
              value.symbol,
              value.type,
              nowMs,
              codes,
            )
          : null;
      if (
        quantity !== null &&
        context !== null &&
        (value.type === 'LIMIT' || value.type === 'MARKET') &&
        (value.leg === 'PERP_OPEN' || value.leg === 'PERP_CLOSE')
      ) {
        try {
          validateFilters(
            quantity,
            price,
            value.type,
            value.leg === 'PERP_OPEN' ? 'SELL' : 'BUY',
            context,
            codes,
          );
        } catch {
          codes.push('PUBLIC_FILTER_MALFORMED');
        }
      }
      if (
        codes.length > 0 ||
        quantity === null ||
        context === null ||
        positionModeEvidence === null
      ) {
        return blockedIntent(codes);
      }

      const leg = value.leg as 'PERP_OPEN' | 'PERP_CLOSE';
      const side = leg === 'PERP_OPEN' ? 'SELL' : 'BUY';
      const reduceOnly = leg === 'PERP_CLOSE';
      const type = value.type as BinanceUsdMBasisOrderType;
      const symbol = value.symbol as string;
      const existingClientOrderId = value.existingClientOrderId as string;
      const timeInForce = type === 'LIMIT' ? 'GTC' : null;
      const requestFields = Object.freeze({
        symbol,
        side,
        type,
        positionSide: 'BOTH' as const,
        reduceOnly,
        closePosition: false as const,
        quantity,
        price,
        timeInForce,
        newClientOrderId: existingClientOrderId,
      });
      const intent: Readonly<BinanceUsdMBasisWireIntent> = Object.freeze({
        schema: BINANCE_USDM_BASIS_WIRE_INTENT_SCHEMA,
        version: 1,
        mode: 'VALIDATE_ONLY',
        callable: false,
        endpoint: '/fapi/v1/order',
        method: 'POST',
        security: 'SIGNED_DESCRIPTOR_ONLY',
        leg,
        symbol,
        existingClientOrderId,
        side,
        type,
        timeInForce,
        quantity,
        price,
        positionMode: 'ONE_WAY',
        positionSide: 'BOTH',
        reduceOnly,
        closePosition: false,
        requestFields,
        localValidation: Object.freeze({
          publicFilterSubsetPassed: true,
          publicEvidenceSchema: BINANCE_USDM_PUBLIC_GROUNDWORK_SCHEMA,
          publicEvidenceSourceId: context.sourceId,
          publicEvidenceSourceTimeMs: context.sourceTimeMs,
          publicEvidenceReceivedAtMs: context.receivedAtMs,
          publicEvidenceMaxAgeMs: context.maxAgeMs,
          publicEvidenceAuthority: context.authority,
          referenceMarkPrice: context.referenceMarkPrice,
          referenceMarkPriceRevision:
            context.referenceMarkPriceRevision,
          referenceMarkPriceSourceId:
            context.referenceMarkPriceObservedAt.sourceId,
          referenceMarkPriceSourceTimeMs:
            context.referenceMarkPriceObservedAt.sourceTimeMs,
          referenceMarkPriceReceivedAtMs:
            context.referenceMarkPriceObservedAt.receivedAtMs,
          referenceMarkPriceMaxAgeMs:
            context.referenceMarkPriceObservedAt.maxAgeMs,
          referenceMarkPriceAuthority:
            context.referenceMarkPriceObservedAt.authority,
          publicMaxNumOrders: context.publicMaxNumOrders,
          privateOpenOrderCountEvaluated: false,
          matchingEngineAcceptanceProven: false,
          positionModeAuthority: positionModeEvidence.authority,
          positionModeScope: positionModeEvidence.scope,
          positionModeSymbol: positionModeEvidence.symbol,
          positionModeSourceId: positionModeEvidence.sourceId,
          positionModeRevision: positionModeEvidence.revision,
          positionModeObservedAtMs:
            positionModeEvidence.observedAtMs,
          positionModeReceivedAtMs:
            positionModeEvidence.receivedAtMs,
          positionModeMaxAgeMs: positionModeEvidence.maxAgeMs,
        }),
        limitations: LIMITATIONS,
        queryFirstOnUnknown: true,
        blindResubmitAllowed: false,
        sendEligible: false,
        authority: 'NONE',
        networkRequestsPerformed: 0,
        privateRequestsPerformed: 0,
        signedRequestsPerformed: 0,
        testOrdersPerformed: 0,
        ordersPerformed: 0,
        sideEffectsPerformed: 0,
      });
      PRODUCED_WIRE_INTENTS.add(intent);
      return brandIntentResult({
        schema: BINANCE_USDM_BASIS_ADAPTER_SCHEMA,
        version: 1,
        mode: 'VALIDATE_ONLY',
        ok: true,
        intent,
        blockingCodes: NO_CODES,
        sendEligible: false,
        authority: 'NONE',
        networkRequestsPerformed: 0,
        privateRequestsPerformed: 0,
        signedRequestsPerformed: 0,
        testOrdersPerformed: 0,
        ordersPerformed: 0,
        sideEffectsPerformed: 0,
      });
    },
    buildOrderQueryDescriptor(
      intent: Readonly<BinanceUsdMBasisWireIntent>,
    ): Readonly<BinanceUsdMBasisQueryDescriptorResult> {
      if (!isBinanceUsdMBasisWireIntent(intent)) {
        return blockedQueryDescriptor(['INTENT_NOT_ADAPTER_PRODUCED']);
      }
      const codes = controlBlockingCodes(snapshot, intent.symbol);
      if (codes.length > 0) return blockedQueryDescriptor(codes);
      const descriptor: Readonly<BinanceUsdMBasisQueryDescriptor> =
        Object.freeze({
          schema: BINANCE_USDM_BASIS_QUERY_DESCRIPTOR_SCHEMA,
          version: 1,
          mode: 'VALIDATE_ONLY',
          callable: false,
          endpoint: '/fapi/v1/order',
          method: 'GET',
          security: 'SIGNED_DESCRIPTOR_ONLY',
          symbol: intent.symbol,
          origClientOrderId: intent.existingClientOrderId,
          queryFields: Object.freeze({
            symbol: intent.symbol,
            origClientOrderId: intent.existingClientOrderId,
          }),
          queryFirstRequired: true,
          blindResubmitAllowed: false,
          authority: 'NONE',
          networkRequestsPerformed: 0,
          privateRequestsPerformed: 0,
          signedRequestsPerformed: 0,
          sideEffectsPerformed: 0,
        });
      PRODUCED_QUERY_DESCRIPTORS.add(descriptor);
      return brandQueryResult({
        schema: BINANCE_USDM_BASIS_ADAPTER_SCHEMA,
        version: 1,
        mode: 'VALIDATE_ONLY',
        ok: true,
        descriptor,
        blockingCodes: NO_CODES,
        authority: 'NONE',
        networkRequestsPerformed: 0,
        privateRequestsPerformed: 0,
        signedRequestsPerformed: 0,
        sideEffectsPerformed: 0,
      });
    },
    normalizeOrderQueryEvidence(
      intent: Readonly<BinanceUsdMBasisWireIntent>,
      evidence: Readonly<BinanceUsdMBasisQueryEvidence>,
    ): Readonly<BinanceUsdMBasisQueryResolution> {
      if (!isBinanceUsdMBasisWireIntent(intent)) {
        return unresolvedQuery(['INTENT_NOT_ADAPTER_PRODUCED']);
      }
      const controlCodes = controlBlockingCodes(snapshot, intent.symbol);
      if (controlCodes.length > 0) return unresolvedQuery(controlCodes);
      const value = plainDataRecord(evidence);
      if (value === null) return unresolvedQuery(['QUERY_EVIDENCE_INVALID']);
      if (!validUtcMillis(value.nowMs)) {
        return unresolvedQuery(['EVALUATION_TIME_INVALID']);
      }
      const timing = parseFreshEvidenceTiming(value, value.nowMs);
      if (!timing.ok) {
        return unresolvedQuery([
          timing.reason === 'AUTHORITY'
            ? 'QUERY_AUTHORITY_INVALID'
            : timing.reason === 'FUTURE'
              ? 'QUERY_EVIDENCE_FUTURE'
              : timing.reason === 'STALE'
                ? 'QUERY_EVIDENCE_STALE'
                : 'QUERY_EVIDENCE_INVALID',
        ]);
      }
      if (
        value.outcome !== 'FOUND' &&
        value.outcome !== 'NOT_FOUND' &&
        value.outcome !== 'TIMEOUT' &&
        value.outcome !== 'AMBIGUOUS' &&
        value.outcome !== 'RETENTION_EXPIRED'
      ) {
        return unresolvedQuery(['QUERY_EVIDENCE_INVALID'], timing.value);
      }
      if (value.outcome !== 'FOUND') {
        if (value.order !== undefined) {
          return unresolvedQuery(
            ['QUERY_EVIDENCE_INVALID'],
            timing.value,
          );
        }
        return unresolvedQuery([
          'QUERY_OUTCOME_UNRESOLVED',
        ], timing.value);
      }
      const codes: BinanceUsdMBasisAdapterBlockingCode[] = [];
      const order = parseFoundOrder(value.order, intent, codes);
      if (order === null) return unresolvedQuery(codes, timing.value);
      return brandResolution({
        schema: BINANCE_USDM_BASIS_QUERY_RESOLUTION_SCHEMA,
        version: 1,
        mode: 'VALIDATE_ONLY',
        state: 'CONFIRMED',
        order,
        blockingCodes: NO_CODES,
        queryFirstRequired: true,
        blindResubmitAllowed: false,
        replacementClientOrderId: null,
        evaluatedAtMs: timing.value.evaluatedAtMs,
        observedAtMs: timing.value.observedAtMs,
        receivedAtMs: timing.value.receivedAtMs,
        maxAgeMs: timing.value.maxAgeMs,
        evidenceAuthority: timing.value.authority,
        authority: 'NONE',
        networkRequestsPerformed: 0,
        privateRequestsPerformed: 0,
        signedRequestsPerformed: 0,
        ordersPerformed: 0,
        sideEffectsPerformed: 0,
      });
    },
  });
}
