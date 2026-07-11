import { stableId } from '../../intelligenceFoundation/contracts/index.js';
import {
  RUNTIME_ENDPOINTS,
  createRuntimeSourceId,
} from '../contracts/index.js';
import type {
  PublicSmokeConfig,
  PublicSmokeWebSocketDescriptor,
} from './types.js';

const DEFAULT_CONFIG = Object.freeze({
  defaultDurationMs: 15_000,
  maximumDurationMs: 60_000,
  shutdownGraceMs: 1_000,
  requestTimeoutMs: 10_000,
  maximumRestResponseBytes: 32 * 1024 * 1024,
  maximumWebSocketMessageBytes: 2 * 1024 * 1024,
  maximumMessagesPerSource: 10_000,
  maximumAcceptedMessageAgeMs: 30_000,
  maximumUniverseInstruments: 8_192,
  maximumNormalizedEvidenceIds: 512,
  maximumSteps: 32,
  maximumErrorLength: 512,
});

const CONFIG_FIELDS = Object.freeze([
  'defaultDurationMs',
  'maximumDurationMs',
  'shutdownGraceMs',
  'requestTimeoutMs',
  'maximumRestResponseBytes',
  'maximumWebSocketMessageBytes',
  'maximumMessagesPerSource',
  'maximumAcceptedMessageAgeMs',
  'maximumUniverseInstruments',
  'maximumNormalizedEvidenceIds',
  'maximumSteps',
  'maximumErrorLength',
] as const);

function boundedInteger(value: number, name: string, minimum: number, maximum: number): number {
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

export function createPublicSmokeConfig(
  supplied: Partial<Omit<PublicSmokeConfig, 'configurationVersion'>> = {},
): Readonly<PublicSmokeConfig> {
  const input = exactDataObject(supplied, CONFIG_FIELDS, 'public smoke config');
  const raw = Object.fromEntries(CONFIG_FIELDS.map((field) => [
    field,
    input[field] ?? DEFAULT_CONFIG[field],
  ])) as unknown as Omit<PublicSmokeConfig, 'configurationVersion'>;
  boundedInteger(raw.defaultDurationMs, 'defaultDurationMs', 100, 60_000);
  boundedInteger(raw.maximumDurationMs, 'maximumDurationMs', raw.defaultDurationMs, 5 * 60_000);
  boundedInteger(raw.shutdownGraceMs, 'shutdownGraceMs', 0, 30_000);
  boundedInteger(raw.requestTimeoutMs, 'requestTimeoutMs', 100, 60_000);
  boundedInteger(raw.maximumRestResponseBytes, 'maximumRestResponseBytes', 1_024, 64 * 1024 * 1024);
  boundedInteger(raw.maximumWebSocketMessageBytes, 'maximumWebSocketMessageBytes', 1_024, 16 * 1024 * 1024);
  boundedInteger(raw.maximumMessagesPerSource, 'maximumMessagesPerSource', 1, 100_000);
  boundedInteger(raw.maximumAcceptedMessageAgeMs, 'maximumAcceptedMessageAgeMs', 100, 5 * 60_000);
  boundedInteger(raw.maximumUniverseInstruments, 'maximumUniverseInstruments', 1, 16_384);
  boundedInteger(raw.maximumNormalizedEvidenceIds, 'maximumNormalizedEvidenceIds', 1, 16_384);
  boundedInteger(raw.maximumSteps, 'maximumSteps', 12, 128);
  boundedInteger(raw.maximumErrorLength, 'maximumErrorLength', 64, 4_096);
  return Object.freeze({
    ...raw,
    configurationVersion: stableId('public-no-key-smoke-config', raw),
  });
}

export function validateSmokeSymbol(value: string): string {
  if (typeof value !== 'string' || value.length < 2 || value.length > 64 || !/^[A-Z0-9][A-Z0-9._-]*$/.test(value)) {
    throw new TypeError('focus symbol must be a bounded authoritative uppercase exchange symbol');
  }
  return value;
}

export function publicSmokeWebSocketDescriptors(symbol: string): readonly PublicSmokeWebSocketDescriptor[] {
  const validated = validateSmokeSymbol(symbol);
  const lower = validated.toLowerCase();
  const spotBroadStream = '!miniTicker@arr';
  const usdMBookStream = '!bookTicker';
  const usdMMarkStream = '!markPrice@arr@1s';
  const focusStreams = `${lower}@aggTrade/${lower}@bookTicker/${lower}@depth@100ms`;
  return Object.freeze([
    Object.freeze({
      key: 'SPOT_BROAD',
      sourceId: createRuntimeSourceId({
        capability: 'smoke-spot-broad-mini-ticker',
        endpointClass: 'PUBLIC',
        productFamily: 'SPOT',
        streamOrPath: spotBroadStream,
      }),
      endpointClass: 'PUBLIC',
      productFamily: 'SPOT',
      url: `${RUNTIME_ENDPOINTS.SPOT_WEBSOCKET.baseUrl}/ws/${spotBroadStream}`,
      required: true,
    }),
    Object.freeze({
      key: 'USD_M_BOOK',
      sourceId: createRuntimeSourceId({
        capability: 'smoke-usdm-broad-book-ticker',
        endpointClass: 'PUBLIC',
        productFamily: 'USD_M_PERPETUAL',
        streamOrPath: usdMBookStream,
      }),
      endpointClass: 'PUBLIC',
      productFamily: 'USD_M_PERPETUAL',
      url: `${RUNTIME_ENDPOINTS.USD_M_PUBLIC_WEBSOCKET.baseUrl}/ws/${usdMBookStream}`,
      required: true,
    }),
    Object.freeze({
      key: 'USD_M_MARK_FUNDING',
      sourceId: createRuntimeSourceId({
        capability: 'smoke-usdm-mark-funding',
        endpointClass: 'MARKET',
        productFamily: 'USD_M_PERPETUAL',
        streamOrPath: usdMMarkStream,
      }),
      endpointClass: 'MARKET',
      productFamily: 'USD_M_PERPETUAL',
      url: `${RUNTIME_ENDPOINTS.USD_M_MARKET_WEBSOCKET.baseUrl}/ws/${usdMMarkStream}`,
      required: true,
    }),
    Object.freeze({
      key: 'SPOT_FOCUS',
      sourceId: createRuntimeSourceId({
        capability: 'smoke-spot-temporary-focus',
        endpointClass: 'PUBLIC',
        productFamily: 'SPOT',
        streamOrPath: focusStreams,
      }),
      endpointClass: 'PUBLIC',
      productFamily: 'SPOT',
      url: `${RUNTIME_ENDPOINTS.SPOT_WEBSOCKET.baseUrl}/stream?streams=${focusStreams}`,
      required: false,
    }),
  ]);
}
