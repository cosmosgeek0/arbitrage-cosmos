import { FOCUS_ROUTES } from './types.js';
import type {
  FocusAllocatorConfig,
  FocusAllocatorConfigInput,
  FocusRoute,
  FocusRouteLimits,
} from './types.js';

const MAXIMUM_CONNECTIONS_PER_ROUTE = 32;
const MAXIMUM_STREAMS_PER_CONNECTION = 1_024;
const MAXIMUM_CONTROL_MESSAGES_PER_INTERVAL = 1_000;
const MAXIMUM_DURATION_MS = 24 * 60 * 60_000;
const CONFIG_FIELDS = Object.freeze([
  'maximumAttentionAllocations', 'maximumCapabilities', 'maximumProtectedSymbols', 'maximumRequirements',
  'maximumRequirementsPerAllocation', 'maximumTotalStreams', 'maximumPendingControlMessages',
  'maximumStreamsPerControlMessage', 'controlIntervalMs', 'minimumLeaseMs', 'resubscribeCooldownMs',
  'controlAcknowledgementTimeoutMs', 'maximumControlRetries', 'routes',
]);
const ROUTE_LIMIT_FIELDS = Object.freeze([
  'maximumConnections', 'maximumStreamsPerConnection', 'maximumControlMessagesPerInterval',
]);

export const FOCUS_ALLOCATOR_DEFAULTS: FocusAllocatorConfig = Object.freeze({
  maximumAttentionAllocations: 5_000,
  maximumCapabilities: 5_000,
  maximumProtectedSymbols: 512,
  maximumRequirements: 50_000,
  maximumRequirementsPerAllocation: 32,
  maximumTotalStreams: 4_096,
  maximumPendingControlMessages: 1_024,
  maximumStreamsPerControlMessage: 200,
  controlIntervalMs: 1_000,
  minimumLeaseMs: 5_000,
  resubscribeCooldownMs: 2_000,
  controlAcknowledgementTimeoutMs: 5_000,
  maximumControlRetries: 3,
  routes: Object.freeze({
    SPOT_MARKET: Object.freeze({
      maximumConnections: 2,
      maximumStreamsPerConnection: 800,
      maximumControlMessagesPerInterval: 4,
    }),
    USD_M_PUBLIC: Object.freeze({
      maximumConnections: 2,
      maximumStreamsPerConnection: 800,
      maximumControlMessagesPerInterval: 9,
    }),
    USD_M_MARKET: Object.freeze({
      maximumConnections: 2,
      maximumStreamsPerConnection: 800,
      maximumControlMessagesPerInterval: 9,
    }),
  }),
});

function positiveBounded(name: string, value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${name} must be a positive safe integer no greater than ${maximum}`);
  }
  return value;
}

function nonNegativeDuration(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAXIMUM_DURATION_MS) {
    throw new RangeError(`${name} must be a safe duration between 0 and ${MAXIMUM_DURATION_MS}ms`);
  }
  return value;
}

function exactDataObject(value: unknown, allowed: readonly string[], name: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a plain object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain object`);
  if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError(`${name} cannot contain symbol keys`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!allowed.includes(key)) throw new TypeError(`${name} contains unknown field ${key}`);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${name}.${key} must be an enumerable data property`);
    }
    output[key] = descriptor.value;
  }
  return output;
}

function routeLimits(route: FocusRoute, partial: Partial<FocusRouteLimits> | undefined): FocusRouteLimits {
  const value = partial === undefined ? {} : exactDataObject(partial, ROUTE_LIMIT_FIELDS, `routes.${route}`);
  const defaults = FOCUS_ALLOCATOR_DEFAULTS.routes[route];
  return Object.freeze({
    maximumConnections: positiveBounded(
      `routes.${route}.maximumConnections`, (value.maximumConnections ?? defaults.maximumConnections) as number, MAXIMUM_CONNECTIONS_PER_ROUTE,
    ),
    maximumStreamsPerConnection: positiveBounded(
      `routes.${route}.maximumStreamsPerConnection`, (value.maximumStreamsPerConnection ?? defaults.maximumStreamsPerConnection) as number, MAXIMUM_STREAMS_PER_CONNECTION,
    ),
    maximumControlMessagesPerInterval: positiveBounded(
      `routes.${route}.maximumControlMessagesPerInterval`, (value.maximumControlMessagesPerInterval ?? defaults.maximumControlMessagesPerInterval) as number, MAXIMUM_CONTROL_MESSAGES_PER_INTERVAL,
    ),
  });
}

export function focusAllocatorConfig(partial: FocusAllocatorConfigInput = {}): FocusAllocatorConfig {
  const supplied = exactDataObject(partial, CONFIG_FIELDS, 'focus allocator config');
  const suppliedRoutes = supplied.routes === undefined
    ? {}
    : exactDataObject(supplied.routes, FOCUS_ROUTES, 'focus allocator config.routes');
  const config: FocusAllocatorConfig = {
    maximumAttentionAllocations: (supplied.maximumAttentionAllocations ?? FOCUS_ALLOCATOR_DEFAULTS.maximumAttentionAllocations) as number,
    maximumCapabilities: (supplied.maximumCapabilities ?? FOCUS_ALLOCATOR_DEFAULTS.maximumCapabilities) as number,
    maximumProtectedSymbols: (supplied.maximumProtectedSymbols ?? FOCUS_ALLOCATOR_DEFAULTS.maximumProtectedSymbols) as number,
    maximumRequirements: (supplied.maximumRequirements ?? FOCUS_ALLOCATOR_DEFAULTS.maximumRequirements) as number,
    maximumRequirementsPerAllocation: (supplied.maximumRequirementsPerAllocation ?? FOCUS_ALLOCATOR_DEFAULTS.maximumRequirementsPerAllocation) as number,
    maximumTotalStreams: (supplied.maximumTotalStreams ?? FOCUS_ALLOCATOR_DEFAULTS.maximumTotalStreams) as number,
    maximumPendingControlMessages: (supplied.maximumPendingControlMessages ?? FOCUS_ALLOCATOR_DEFAULTS.maximumPendingControlMessages) as number,
    maximumStreamsPerControlMessage: (supplied.maximumStreamsPerControlMessage ?? FOCUS_ALLOCATOR_DEFAULTS.maximumStreamsPerControlMessage) as number,
    controlIntervalMs: (supplied.controlIntervalMs ?? FOCUS_ALLOCATOR_DEFAULTS.controlIntervalMs) as number,
    minimumLeaseMs: (supplied.minimumLeaseMs ?? FOCUS_ALLOCATOR_DEFAULTS.minimumLeaseMs) as number,
    resubscribeCooldownMs: (supplied.resubscribeCooldownMs ?? FOCUS_ALLOCATOR_DEFAULTS.resubscribeCooldownMs) as number,
    controlAcknowledgementTimeoutMs: (supplied.controlAcknowledgementTimeoutMs ?? FOCUS_ALLOCATOR_DEFAULTS.controlAcknowledgementTimeoutMs) as number,
    maximumControlRetries: (supplied.maximumControlRetries ?? FOCUS_ALLOCATOR_DEFAULTS.maximumControlRetries) as number,
    routes: Object.freeze(Object.fromEntries(FOCUS_ROUTES.map((route) => [
      route,
      routeLimits(route, suppliedRoutes[route] as Partial<FocusRouteLimits> | undefined),
    ])) as Record<FocusRoute, FocusRouteLimits>),
  };

  positiveBounded('maximumAttentionAllocations', config.maximumAttentionAllocations, 50_000);
  positiveBounded('maximumCapabilities', config.maximumCapabilities, 50_000);
  positiveBounded('maximumProtectedSymbols', config.maximumProtectedSymbols, 10_000);
  positiveBounded('maximumRequirements', config.maximumRequirements, 100_000);
  positiveBounded('maximumRequirementsPerAllocation', config.maximumRequirementsPerAllocation, 128);
  positiveBounded('maximumTotalStreams', config.maximumTotalStreams, 32_768);
  positiveBounded('maximumPendingControlMessages', config.maximumPendingControlMessages, 100_000);
  positiveBounded('maximumStreamsPerControlMessage', config.maximumStreamsPerControlMessage, 1_024);
  positiveBounded('controlIntervalMs', config.controlIntervalMs, MAXIMUM_DURATION_MS);
  nonNegativeDuration('minimumLeaseMs', config.minimumLeaseMs);
  nonNegativeDuration('resubscribeCooldownMs', config.resubscribeCooldownMs);
  positiveBounded('controlAcknowledgementTimeoutMs', config.controlAcknowledgementTimeoutMs, MAXIMUM_DURATION_MS);
  positiveBounded('maximumControlRetries', config.maximumControlRetries, 100);

  if (config.maximumRequirementsPerAllocation > config.maximumRequirements) {
    throw new RangeError('maximumRequirementsPerAllocation exceeds maximumRequirements');
  }
  const physicalCapacity = FOCUS_ROUTES.reduce(
    (total, route) => total + config.routes[route].maximumConnections * config.routes[route].maximumStreamsPerConnection,
    0,
  );
  if (config.maximumTotalStreams > physicalCapacity) {
    throw new RangeError('maximumTotalStreams exceeds configured physical connection capacity');
  }

  return Object.freeze(config);
}
