import {
  PRODUCT_FAMILIES,
  SOURCE_ENDPOINT_CLASSES,
  stableId,
} from '../../intelligenceFoundation/contracts/index.js';
import type { ProductFamily, SourceEndpointClass } from '../../intelligenceFoundation/contracts/index.js';
import type { RuntimeSourceDefinition, RuntimeTransportKind } from './types.js';

export interface RuntimeEndpointDefinition {
  id: string;
  transportKind: RuntimeTransportKind;
  endpointClass: SourceEndpointClass;
  productFamily: ProductFamily | 'ANY';
  baseUrl: string;
  routeClass: 'SPOT_MARKET' | 'USD_M_PUBLIC' | 'USD_M_MARKET' | 'PUBLIC_REST';
  credentials: 'NONE';
  notes: readonly string[];
}

export const RUNTIME_SOURCE_LIMITS = Object.freeze({
  maximumSilentAfterMs: 7 * 24 * 60 * 60_000,
  maximumStaleAfterMs: 30 * 24 * 60 * 60_000,
  maximumFutureSkewMs: 60_000,
  maximumRetryCeiling: 1_000,
} as const);

const RUNTIME_TRANSPORT_KINDS = new Set(['REST', 'WEBSOCKET', 'INJECTED']);
const RUNTIME_AUTHORITIES = new Set(['COMPLETE', 'PARTIAL', 'SAMPLED', 'UNAVAILABLE', 'UNKNOWN']);

export const RUNTIME_ENDPOINTS = Object.freeze({
  SPOT_WEBSOCKET: Object.freeze({
    id: 'binance.spot.websocket.market',
    transportKind: 'WEBSOCKET',
    endpointClass: 'PUBLIC',
    productFamily: 'SPOT',
    baseUrl: 'wss://stream.binance.com:9443',
    routeClass: 'SPOT_MARKET',
    credentials: 'NONE',
    notes: Object.freeze([
      'Raw streams use /ws; combined streams use /stream?streams=.',
      'Spot bookTicker has no exchange event timestamp.',
    ]),
  }),
  SPOT_PUBLIC_REST: Object.freeze({
    id: 'binance.spot.rest.public',
    transportKind: 'REST',
    endpointClass: 'REST',
    productFamily: 'SPOT',
    baseUrl: 'https://data-api.binance.vision',
    routeClass: 'PUBLIC_REST',
    credentials: 'NONE',
    notes: Object.freeze(['Market-data-only Spot REST host.']),
  }),
  USD_M_PUBLIC_WEBSOCKET: Object.freeze({
    id: 'binance.usdm.websocket.public',
    transportKind: 'WEBSOCKET',
    endpointClass: 'PUBLIC',
    productFamily: 'USD_M_PERPETUAL',
    baseUrl: 'wss://fstream.binance.com/public',
    routeClass: 'USD_M_PUBLIC',
    credentials: 'NONE',
    notes: Object.freeze([
      'Book ticker and depth only.',
      'Merged UM/CM payloads require st=1 for USD-M.',
    ]),
  }),
  USD_M_MARKET_WEBSOCKET: Object.freeze({
    id: 'binance.usdm.websocket.market',
    transportKind: 'WEBSOCKET',
    endpointClass: 'MARKET',
    productFamily: 'USD_M_PERPETUAL',
    baseUrl: 'wss://fstream.binance.com/market',
    routeClass: 'USD_M_MARKET',
    credentials: 'NONE',
    notes: Object.freeze([
      'Aggregate trades, mark/funding, ticker, and liquidation streams.',
      'Merged UM/CM payloads require st=1 for USD-M.',
    ]),
  }),
  USD_M_PUBLIC_REST: Object.freeze({
    id: 'binance.usdm.rest.public',
    transportKind: 'REST',
    endpointClass: 'REST',
    productFamily: 'USD_M_PERPETUAL',
    baseUrl: 'https://fapi.binance.com',
    routeClass: 'PUBLIC_REST',
    credentials: 'NONE',
    notes: Object.freeze(['Only endpoints whose security type permits no key belong here.']),
  }),
} as const satisfies Record<string, RuntimeEndpointDefinition>);

export function createRuntimeSourceId(input: {
  capability: string;
  endpointClass: SourceEndpointClass;
  productFamily: ProductFamily | 'ANY';
  streamOrPath: string;
}): string {
  if (!/^[a-z][a-z0-9._-]{1,63}$/i.test(input.capability)) {
    throw new TypeError('invalid runtime source capability');
  }
  if (!SOURCE_ENDPOINT_CLASSES.includes(input.endpointClass)) throw new TypeError('invalid runtime source endpointClass');
  if (input.productFamily !== 'ANY' && !PRODUCT_FAMILIES.includes(input.productFamily)) {
    throw new TypeError('invalid runtime source productFamily');
  }
  if (typeof input.streamOrPath !== 'string' || input.streamOrPath.length === 0 || input.streamOrPath.length > 2_048) {
    throw new TypeError('invalid runtime source streamOrPath');
  }
  return stableId('runtime-source', input);
}

export function sourceDefinition(
  input: Omit<RuntimeSourceDefinition, 'sourceId'> & {
    capability: string;
    streamOrPath: string;
  },
): RuntimeSourceDefinition {
  for (const [name, value] of [
    ['silentAfterMs', input.silentAfterMs],
    ['staleAfterMs', input.staleAfterMs],
    ['maximumFutureSkewMs', input.maximumFutureSkewMs],
    ['retryCeiling', input.retryCeiling],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  if (!RUNTIME_TRANSPORT_KINDS.has(input.transportKind)) throw new TypeError('invalid runtime source transportKind');
  if (!RUNTIME_AUTHORITIES.has(input.authority)) throw new TypeError('invalid runtime source authority');
  if (input.silentAfterMs === 0 || input.staleAfterMs < input.silentAfterMs) {
    throw new TypeError('source freshness thresholds are invalid');
  }
  if (
    input.silentAfterMs > RUNTIME_SOURCE_LIMITS.maximumSilentAfterMs
    || input.staleAfterMs > RUNTIME_SOURCE_LIMITS.maximumStaleAfterMs
    || input.maximumFutureSkewMs > RUNTIME_SOURCE_LIMITS.maximumFutureSkewMs
    || input.retryCeiling > RUNTIME_SOURCE_LIMITS.maximumRetryCeiling
  ) {
    throw new RangeError('source lifecycle policy exceeds its hard safety bound');
  }
  return Object.freeze({
    sourceId: createRuntimeSourceId({
      capability: input.capability,
      endpointClass: input.endpointClass,
      productFamily: input.productFamily,
      streamOrPath: input.streamOrPath,
    }),
    transportKind: input.transportKind,
    endpointClass: input.endpointClass,
    productFamily: input.productFamily,
    silentAfterMs: input.silentAfterMs,
    staleAfterMs: input.staleAfterMs,
    maximumFutureSkewMs: input.maximumFutureSkewMs,
    retryCeiling: input.retryCeiling,
    authority: input.authority,
  });
}
