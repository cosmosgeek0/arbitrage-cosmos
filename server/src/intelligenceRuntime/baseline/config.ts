import { stableId } from '../../intelligenceFoundation/contracts/index.js';
import {
  RUNTIME_ENDPOINTS,
  createRuntimeSourceId,
} from '../contracts/index.js';
import type {
  BaselineBootstrapConfig,
  BaselineFixedInterval,
  BaselineProductFamily,
} from './types.js';

export const BASELINE_HISTORY_INTEGRATION_GAP =
  'intelligenceFoundation exposes no completed-kline or historical activity-bucket seed contract; BaselineSink is the narrow idempotent integration seam and must not fabricate trades or call FeatureBank.ingest';

export const BASELINE_INTERVAL_MS: Readonly<Record<BaselineFixedInterval, number>> = Object.freeze({
  '1m': 60_000,
  '3m': 3 * 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '2h': 2 * 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '8h': 8 * 60 * 60_000,
  '12h': 12 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
  '3d': 3 * 24 * 60 * 60_000,
  '1w': 7 * 24 * 60 * 60_000,
});

/** Binance weekly klines open Monday 00:00 UTC; Unix epoch began Thursday. */
const BASELINE_INTERVAL_ANCHOR_MS: Readonly<Record<BaselineFixedInterval, number>> = Object.freeze({
  '1m': 0,
  '3m': 0,
  '5m': 0,
  '15m': 0,
  '30m': 0,
  '1h': 0,
  '2h': 0,
  '4h': 0,
  '6h': 0,
  '8h': 0,
  '12h': 0,
  '1d': 0,
  '3d': 0,
  '1w': 4 * 24 * 60 * 60_000,
});

const DEFAULT_CONFIG = Object.freeze({
  maximumPlanItems: 10_000,
  maximumParallelism: 4,
  pageLimit: 1_000,
  maximumPagesPerItem: 1_000,
  maximumRecordsPerItem: 100_000,
  focusedBurstLimit: 3,
  retryCeiling: 5,
  retryBaseDelayMs: 1_000,
  retryMaximumDelayMs: 60_000,
  staleAfterMs: 15 * 60_000,
  maximumSymbolLength: 64,
  maximumIdentityLength: 256,
  maximumMessageLength: 512,
});
const CONFIG_FIELDS = Object.freeze(Object.keys(DEFAULT_CONFIG));

export interface BaselineHistorySourceDefinition {
  readonly sourceId: string;
  readonly baseUrl: string;
  readonly path: '/api/v3/klines' | '/fapi/v1/klines';
  readonly credentials: 'NONE';
}

export const BASELINE_HISTORY_SOURCES: Readonly<Record<BaselineProductFamily, BaselineHistorySourceDefinition>> = Object.freeze({
  SPOT: Object.freeze({
    sourceId: createRuntimeSourceId({
      capability: 'baseline-spot-klines',
      endpointClass: 'REST',
      productFamily: 'SPOT',
      streamOrPath: '/api/v3/klines',
    }),
    baseUrl: RUNTIME_ENDPOINTS.SPOT_PUBLIC_REST.baseUrl,
    path: '/api/v3/klines',
    credentials: 'NONE',
  }),
  USD_M_PERPETUAL: Object.freeze({
    sourceId: createRuntimeSourceId({
      capability: 'baseline-usdm-klines',
      endpointClass: 'REST',
      productFamily: 'USD_M_PERPETUAL',
      streamOrPath: '/fapi/v1/klines',
    }),
    baseUrl: RUNTIME_ENDPOINTS.USD_M_PUBLIC_REST.baseUrl,
    path: '/fapi/v1/klines',
    credentials: 'NONE',
  }),
});

function boundedInteger(
  value: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be a safe integer in [${minimum}, ${maximum}]`);
  }
  return value;
}

function exactDataObject(value: unknown, allowed: readonly string[], name: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a plain object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain object`);
  if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError(`${name} cannot contain symbol keys`);
  const output: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!allowed.includes(key)) throw new TypeError(`${name} contains unknown field ${key}`);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${name}.${key} must be an enumerable data property`);
    }
    if (descriptor.value === undefined) throw new TypeError(`${name}.${key} cannot be undefined`);
    output[key] = descriptor.value;
  }
  return output;
}

export function createBaselineBootstrapConfig(
  supplied: Partial<Omit<BaselineBootstrapConfig, 'configurationVersion'>> = {},
): Readonly<BaselineBootstrapConfig> {
  const input = exactDataObject(supplied, CONFIG_FIELDS, 'baseline bootstrap config');
  const raw = Object.fromEntries(CONFIG_FIELDS.map((field) => [
    field,
    input[field] ?? DEFAULT_CONFIG[field as keyof typeof DEFAULT_CONFIG],
  ])) as unknown as Omit<BaselineBootstrapConfig, 'configurationVersion'>;
  boundedInteger(raw.maximumPlanItems, 'maximumPlanItems', 1, 50_000);
  boundedInteger(raw.maximumParallelism, 'maximumParallelism', 1, 128);
  boundedInteger(raw.pageLimit, 'pageLimit', 1, 1_000);
  boundedInteger(raw.maximumPagesPerItem, 'maximumPagesPerItem', 1, 100_000);
  boundedInteger(raw.maximumRecordsPerItem, 'maximumRecordsPerItem', 1, 10_000_000);
  boundedInteger(raw.focusedBurstLimit, 'focusedBurstLimit', 1, 10_000);
  boundedInteger(raw.retryCeiling, 'retryCeiling', 0, 100);
  boundedInteger(raw.retryBaseDelayMs, 'retryBaseDelayMs', 1, 24 * 60 * 60_000);
  boundedInteger(raw.retryMaximumDelayMs, 'retryMaximumDelayMs', 1, 7 * 24 * 60 * 60_000);
  boundedInteger(raw.staleAfterMs, 'staleAfterMs', 1, 365 * 24 * 60 * 60_000);
  boundedInteger(raw.maximumSymbolLength, 'maximumSymbolLength', 2, 256);
  boundedInteger(raw.maximumIdentityLength, 'maximumIdentityLength', 64, 4_096);
  boundedInteger(raw.maximumMessageLength, 'maximumMessageLength', 128, 4_096);
  if (raw.retryMaximumDelayMs < raw.retryBaseDelayMs) {
    throw new RangeError('retryMaximumDelayMs must be >= retryBaseDelayMs');
  }
  if (raw.maximumRecordsPerItem < raw.pageLimit) {
    throw new RangeError('maximumRecordsPerItem must be >= pageLimit');
  }
  const configurationVersion = stableId('baseline-bootstrap-config', raw);
  return Object.freeze({ ...raw, configurationVersion });
}

/**
 * Current official public kline request costs. Spot klines cost 2. USD-M uses
 * limit tiers: [1,100)=1, [100,500)=2, [500,1000]=5, and >1000=10.
 */
export function estimateKlineRequestWeight(
  productFamily: BaselineProductFamily,
  limit: number,
): number {
  const maximum = productFamily === 'SPOT' ? 1_000 : 1_500;
  boundedInteger(limit, 'kline limit', 1, maximum);
  if (productFamily === 'SPOT') return 2;
  if (limit < 100) return 1;
  if (limit < 500) return 2;
  if (limit <= 1_000) return 5;
  return 10;
}

export function intervalMilliseconds(interval: BaselineFixedInterval): number {
  const value = BASELINE_INTERVAL_MS[interval];
  if (value === undefined) throw new TypeError(`unsupported fixed baseline interval: ${String(interval)}`);
  return value;
}

function intervalRemainder(timeMs: number, interval: BaselineFixedInterval): number {
  if (!Number.isSafeInteger(timeMs) || timeMs < 0) throw new TypeError('interval timestamp must be a non-negative safe integer');
  const intervalMs = intervalMilliseconds(interval);
  const anchorMs = BASELINE_INTERVAL_ANCHOR_MS[interval];
  return ((timeMs - anchorMs) % intervalMs + intervalMs) % intervalMs;
}

export function isBaselineIntervalBoundary(timeMs: number, interval: BaselineFixedInterval): boolean {
  return intervalRemainder(timeMs, interval) === 0;
}

export function alignBaselineIntervalDown(timeMs: number, interval: BaselineFixedInterval): number {
  return timeMs - intervalRemainder(timeMs, interval);
}

export function alignBaselineIntervalUp(timeMs: number, interval: BaselineFixedInterval): number {
  const remainder = intervalRemainder(timeMs, interval);
  if (remainder === 0) return timeMs;
  const result = timeMs + intervalMilliseconds(interval) - remainder;
  if (!Number.isSafeInteger(result)) throw new RangeError('aligned baseline timestamp overflow');
  return result;
}
