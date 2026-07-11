import {
  canonicalJson,
  stableId,
} from '../../intelligenceFoundation/contracts/index.js';
import type { StableFailure } from '../../intelligenceFoundation/contracts/index.js';
import type {
  RuntimeLifecycleState,
  RuntimeRateBudgetState,
  RuntimeSourceSnapshot,
} from '../contracts/index.js';
import { boundedJsonByteLength } from '../contracts/index.js';
import type { BoundedQueueSnapshot } from '../lifecycle/index.js';
import { buildRuntimeTopology, runtimeComponentId } from './topology.js';
import {
  DEFAULT_RUNTIME_SNAPSHOT_BOUNDS,
  RUNTIME_COMPONENT_KEYS,
  RUNTIME_SNAPSHOT_HARD_LIMITS,
} from './types.js';
import type {
  BaselineRuntimeState,
  RuntimeAggregateDesiredState,
  RuntimeAggregateObservedState,
  RuntimeBaselineSummary,
  RuntimeBookSummary,
  RuntimeCaptureSummary,
  RuntimeComponentKey,
  RuntimeComponentView,
  RuntimeCriticality,
  RuntimeDerivativesFactsSummary,
  RuntimeFocusCoverageSummary,
  RuntimeHealthReason,
  RuntimeIntelligenceSnapshot,
  RuntimeLastErrorView,
  RuntimeMarketCoverageSummary,
  RuntimeOperationsSummary,
  RuntimeReasonImpact,
  RuntimeSnapshotBounds,
  RuntimeSnapshotInput,
  RuntimeSourceOperationalInput,
  RuntimeSourceView,
  RuntimeTopologyView,
  RuntimeUniverseCoverageSummary,
} from './types.js';

const SOURCE_STATES = Object.freeze([
  'STOPPED',
  'CONNECTING',
  'WARMING',
  'LIVE',
  'SILENT',
  'STALE',
  'DEGRADED',
  'BACKING_OFF',
  'RATE_LIMITED',
  'FAILED',
] as const);

const DEFAULT_REQUIRED_COMPONENTS = Object.freeze([
  'UNIVERSE',
  'SPOT_BROAD',
  'FUTURES_BROAD',
] as const satisfies readonly RuntimeComponentKey[]);

const COMPONENT_NAMES: Readonly<Record<RuntimeComponentKey, string>> = Object.freeze({
  UNIVERSE: 'Public universe',
  SPOT_BROAD: 'Broad Spot market data',
  FUTURES_BROAD: 'Broad USD-M market data',
  LIFECYCLE: 'Source lifecycle and backpressure',
  FOCUS: 'Focused evidence allocation',
  BOOKS: 'Focused local books',
  BASELINE: 'Historical baseline bootstrap',
  DERIVATIVES: 'Public derivatives context',
  BRIDGE: 'Intelligence evidence bridge',
  CAPTURE: 'Trigger capture coordinator',
  SNAPSHOT: 'Runtime snapshot adapter',
});

const COMPONENT_CRITICALITY: Readonly<Record<RuntimeComponentKey, RuntimeCriticality>> = Object.freeze({
  UNIVERSE: 'CORE',
  SPOT_BROAD: 'CORE',
  FUTURES_BROAD: 'CORE',
  LIFECYCLE: 'CORE',
  FOCUS: 'PROTECTED',
  BOOKS: 'FOCUSED',
  BASELINE: 'OPTIONAL',
  DERIVATIVES: 'OPTIONAL',
  BRIDGE: 'CORE',
  CAPTURE: 'OPTIONAL',
  SNAPSHOT: 'CORE',
});

const CRITICALITY_RANK: Readonly<Record<RuntimeCriticality, number>> = Object.freeze({
  OPTIONAL: 0,
  FOCUSED: 1,
  PROTECTED: 2,
  CORE: 3,
});

function effectiveCriticality(
  component: RuntimeComponentKey,
  supplied: RuntimeCriticality,
  required: ReadonlySet<RuntimeComponentKey>,
): RuntimeCriticality {
  const canonical = required.has(component) ? 'CORE' : COMPONENT_CRITICALITY[component];
  return CRITICALITY_RANK[supplied] > CRITICALITY_RANK[canonical] ? supplied : canonical;
}

interface NormalizedPolicy {
  bounds: RuntimeSnapshotBounds;
  requiredComponents: readonly RuntimeComponentKey[];
  sequenceGapStormThreshold: number;
  queueWarningFillRatio: number;
  processingLagWarningMs: number;
}

interface MutableReason {
  id: string;
  severity: RuntimeHealthReason['severity'];
  impact: RuntimeReasonImpact;
  code: string;
  component: RuntimeComponentKey;
  sourceId: string | null;
  message: string;
  recommendedAction: string;
  observedAtMs: number | null;
}

interface ErrorCandidate extends RuntimeLastErrorView {
  identity: string;
}

function snapshotObservedAt(value: { observedAtMs?: number; snapshotTimeMs?: number } | null | undefined): number | null {
  return value?.observedAtMs ?? value?.snapshotTimeMs ?? null;
}

function projectionFailure(value: unknown): StableFailure | null {
  if (!object(value) || !('lastError' in value)) return null;
  const failure = value.lastError;
  return object(failure) ? failure as unknown as StableFailure : null;
}

function projectionLastSuccess(value: unknown): number | null {
  if (!object(value) || !('lastSuccessTimeMs' in value)) return null;
  return value.lastSuccessTimeMs === null || typeof value.lastSuccessTimeMs === 'number'
    ? value.lastSuccessTimeMs
    : null;
}

function bridgeFailureCount(value: RuntimeSnapshotInput['bridge']): number {
  if (value === undefined || value === null) return 0;
  if ('failureCount' in value) return value.failureCount;
  return value.failures.reduce((total, entry) => safeAdd(total, entry.count, 'bridge failure count'), 0);
}

function bridgeLastSuccess(value: RuntimeSnapshotInput['bridge']): number | null {
  if (value === undefined || value === null) return null;
  if ('lastSuccessTimeMs' in value) return value.lastSuccessTimeMs;
  return value.artifacts.reduce<number | null>(
    (latest, artifact) => maximumNullable(latest, artifact.evaluatedAtMs),
    null,
  );
}

function baselineLastSuccess(value: RuntimeSnapshotInput['baseline']): number | null {
  const supplied = projectionLastSuccess(value);
  if (supplied !== null) return supplied;
  if (value === undefined || value === null || !('items' in value)) return null;
  return value.items.reduce<number | null>(
    (latest, item) => maximumNullable(latest, item.lastCompletedCloseTimeMs),
    null,
  );
}

function captureLastSuccess(value: RuntimeSnapshotInput['capture']): number | null {
  const supplied = projectionLastSuccess(value);
  if (supplied !== null) return supplied;
  if (value === undefined || value === null || !('captures' in value)) return null;
  return value.captures.reduce<number | null>((latest, capture) => maximumNullable(latest, capture.finishedAtMs), null);
}

function sourceSnapshotSuccess(source: RuntimeSourceSnapshot): number | null {
  if (source.observedState !== 'LIVE' || source.authority === 'UNAVAILABLE' || source.completeness === 'MISSING') return null;
  return source.lastProcessedTimeMs ?? (source.messageCount > 0 ? source.lastMessageReceiveTimeMs : null);
}

function universeLastSuccess(input: RuntimeSnapshotInput): number | null {
  if (input.universe === null) return null;
  return Object.values(input.universe.sources).reduce<number | null>(
    (latest, source) => maximumNullable(latest, source.lastCompleteResponseTimeMs),
    null,
  );
}

function spotLastSuccess(input: RuntimeSnapshotInput): number | null {
  const spot = input.spot;
  if (spot === null || spot.observedState !== 'LIVE') return null;
  if (!spot.symbols.some((symbol) => (
    symbol.tickerFreshness === 'FRESH' || symbol.bookFreshness === 'FRESH' || symbol.tradeFreshness === 'FRESH'
  ))) return null;
  return spot.lastProcessedTimeMs;
}

function futuresLastSuccess(input: RuntimeSnapshotInput): number | null {
  if (input.futures === null) return null;
  return input.futures.sources.reduce<number | null>(
    (latest, source) => maximumNullable(latest, sourceSnapshotSuccess(source)),
    null,
  );
}

function bookCriticality(input: RuntimeSnapshotInput, symbol: string, supplied?: RuntimeCriticality): RuntimeCriticality {
  if (supplied !== undefined) return supplied;
  return input.focus?.requirements.some((entry) => entry.symbol === symbol && entry.protected)
    ? 'PROTECTED'
    : 'FOCUSED';
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNullableString(left: string | null, right: string | null): number {
  return compareCodePoints(left ?? '', right ?? '');
}

function compareReasons(left: RuntimeHealthReason, right: RuntimeHealthReason): number {
  return compareCodePoints(left.component, right.component)
    || compareCodePoints(left.code, right.code)
    || compareNullableString(left.sourceId, right.sourceId)
    || compareCodePoints(left.id, right.id);
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  return value as number;
}

function positiveSafeInteger(value: unknown, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  if ((value as number) > maximum) throw new RangeError(`${name} exceeds its hard safety bound`);
  return value as number;
}

function finiteRatio(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${name} must be a finite ratio in [0, 1]`);
  }
  return value;
}

function boundedString(value: unknown, name: string, maximum: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    throw new TypeError(`${name} must be a bounded non-empty string`);
  }
  return value;
}

function copyText(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  if (maximum <= 1) return value.slice(0, maximum);
  return `${value.slice(0, maximum - 1)}…`;
}

function safeAdd(left: number, right: number, name: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < 0) throw new RangeError(`${name} exceeds safe integer capacity`);
  return result;
}

function maximumNullable(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}

function validatePastTime(value: number | null, snapshotTimeMs: number, name: string): void {
  if (value === null) return;
  nonNegativeSafeInteger(value, name);
  if (value > snapshotTimeMs) throw new RangeError(`${name} cannot be later than snapshotTimeMs`);
}

function nullableNonNegativeSafeInteger(value: unknown, name: string): number | null {
  if (value === null) return null;
  return nonNegativeSafeInteger(value, name);
}

function exactRateBudget(value: RuntimeRateBudgetState, cutMs: number, name: string): RuntimeRateBudgetState {
  boundedJsonByteLength(value, 64 * 1024);
  if (!object(value)) throw new TypeError(`${name} must be a bounded object`);
  if (!['AVAILABLE', 'NEAR_LIMIT', 'EXHAUSTED', 'COOLDOWN', 'UNKNOWN'].includes(value.state)) {
    throw new TypeError(`${name}.state is invalid`);
  }
  const usedWeight = nullableNonNegativeSafeInteger(value.usedWeight, `${name}.usedWeight`);
  const limit = nullableNonNegativeSafeInteger(value.limit, `${name}.limit`);
  const intervalMs = nullableNonNegativeSafeInteger(value.intervalMs, `${name}.intervalMs`);
  const resetsAtMs = nullableNonNegativeSafeInteger(value.resetsAtMs, `${name}.resetsAtMs`);
  const retryAfterMs = nullableNonNegativeSafeInteger(value.retryAfterMs, `${name}.retryAfterMs`);
  const observedAtMs = nullableNonNegativeSafeInteger(value.observedAtMs, `${name}.observedAtMs`);
  if (limit !== null && limit < 1) throw new TypeError(`${name}.limit must be positive when known`);
  if (intervalMs !== null && intervalMs < 1) throw new TypeError(`${name}.intervalMs must be positive when known`);
  validatePastTime(observedAtMs, cutMs, `${name}.observedAtMs`);
  if ((value.state === 'COOLDOWN') !== (retryAfterMs !== null)) {
    throw new TypeError(`${name} cooldown state and retryAfterMs must agree`);
  }
  return Object.freeze({
    state: value.state,
    usedWeight,
    limit,
    intervalMs,
    resetsAtMs,
    retryAfterMs,
    observedAtMs,
  });
}

function exactRuntimeError(
  value: RuntimeSourceSnapshot['lastError'],
  cutMs: number,
  bounds: RuntimeSnapshotBounds,
  name: string,
): RuntimeSourceSnapshot['lastError'] {
  if (value === null) return null;
  boundedJsonByteLength(value, 64 * 1024);
  if (!object(value)) throw new TypeError(`${name} must be a bounded object`);
  if (typeof value.code !== 'string' || value.code.trim().length === 0) throw new TypeError(`${name}.code is invalid`);
  if (typeof value.message !== 'string' || value.message.trim().length === 0) throw new TypeError(`${name}.message is invalid`);
  if (typeof value.retryable !== 'boolean') throw new TypeError(`${name}.retryable must be boolean`);
  if (typeof value.recommendedAction !== 'string' || value.recommendedAction.trim().length === 0) {
    throw new TypeError(`${name}.recommendedAction is invalid`);
  }
  validatePastTime(value.observedAtMs, cutMs, `${name}.observedAtMs`);
  return Object.freeze({
    code: copyText(value.code, bounds.maximumStringLength),
    message: copyText(value.message, bounds.maximumStringLength),
    retryable: value.retryable,
    observedAtMs: value.observedAtMs,
    recommendedAction: copyText(value.recommendedAction, bounds.maximumStringLength),
  });
}

function exactQueue(value: Readonly<BoundedQueueSnapshot>, name: string): Readonly<BoundedQueueSnapshot> {
  boundedJsonByteLength(value, 64 * 1024);
  const capacity = positiveSafeInteger(value.capacity, `${name}.capacity`, 1_000_000);
  const maximumEntryBytes = positiveSafeInteger(value.maximumEntryBytes, `${name}.maximumEntryBytes`, 64 * 1024 * 1024 + 64 * 1024);
  const maximumRetainedBytes = positiveSafeInteger(value.maximumRetainedBytes, `${name}.maximumRetainedBytes`, 512 * 1024 * 1024);
  const retainedBytes = nonNegativeSafeInteger(value.retainedBytes, `${name}.retainedBytes`);
  const highWatermarkRetainedBytes = nonNegativeSafeInteger(value.highWatermarkRetainedBytes, `${name}.highWatermarkRetainedBytes`);
  const depth = nonNegativeSafeInteger(value.depth, `${name}.depth`);
  const highWatermark = nonNegativeSafeInteger(value.highWatermark, `${name}.highWatermark`);
  if (depth > capacity || highWatermark < depth || highWatermark > capacity) throw new RangeError(`${name} count geometry is invalid`);
  if (retainedBytes > maximumRetainedBytes
    || highWatermarkRetainedBytes < retainedBytes
    || highWatermarkRetainedBytes > maximumRetainedBytes) throw new RangeError(`${name} byte geometry is invalid`);
  if (typeof value.resyncRequired !== 'boolean') throw new TypeError(`${name}.resyncRequired must be boolean`);
  return Object.freeze({
    capacity,
    maximumEntryBytes,
    maximumRetainedBytes,
    retainedBytes,
    highWatermarkRetainedBytes,
    depth,
    highWatermark,
    enqueuedCount: nonNegativeSafeInteger(value.enqueuedCount, `${name}.enqueuedCount`),
    dequeuedCount: nonNegativeSafeInteger(value.dequeuedCount, `${name}.dequeuedCount`),
    droppedCount: nonNegativeSafeInteger(value.droppedCount, `${name}.droppedCount`),
    coalescedCount: nonNegativeSafeInteger(value.coalescedCount, `${name}.coalescedCount`),
    overflowCount: nonNegativeSafeInteger(value.overflowCount, `${name}.overflowCount`),
    oversizeDropCount: nonNegativeSafeInteger(value.oversizeDropCount, `${name}.oversizeDropCount`),
    resyncRequired: value.resyncRequired,
  });
}

function validateRuntimeSourceTimes(source: RuntimeSourceSnapshot, parentCutMs: number, name: string): void {
  validatePastTime(source.snapshotTimeMs, parentCutMs, `${name}.snapshotTimeMs`);
  const cutMs = source.snapshotTimeMs;
  validatePastTime(source.connectedAtMs, cutMs, `${name}.connectedAtMs`);
  validatePastTime(source.lastMessageReceiveTimeMs, cutMs, `${name}.lastMessageReceiveTimeMs`);
  validatePastTime(source.lastProcessedTimeMs, cutMs, `${name}.lastProcessedTimeMs`);
  validatePastTime(source.lastError?.observedAtMs ?? null, cutMs, `${name}.lastError.observedAtMs`);
  validatePastTime(source.rateBudget.observedAtMs, cutMs, `${name}.rateBudget.observedAtMs`);
}

function normalizePolicy(input: RuntimeSnapshotInput): NormalizedPolicy {
  const suppliedBounds = input.policy?.bounds ?? {};
  const bounds: RuntimeSnapshotBounds = {
    maximumSources: positiveSafeInteger(
      suppliedBounds.maximumSources ?? DEFAULT_RUNTIME_SNAPSHOT_BOUNDS.maximumSources,
      'policy.bounds.maximumSources',
      RUNTIME_SNAPSHOT_HARD_LIMITS.maximumSources,
    ),
    maximumReasons: positiveSafeInteger(
      suppliedBounds.maximumReasons ?? DEFAULT_RUNTIME_SNAPSHOT_BOUNDS.maximumReasons,
      'policy.bounds.maximumReasons',
      RUNTIME_SNAPSHOT_HARD_LIMITS.maximumReasons,
    ),
    maximumTopologyNodes: positiveSafeInteger(
      suppliedBounds.maximumTopologyNodes ?? DEFAULT_RUNTIME_SNAPSHOT_BOUNDS.maximumTopologyNodes,
      'policy.bounds.maximumTopologyNodes',
      RUNTIME_SNAPSHOT_HARD_LIMITS.maximumTopologyNodes,
    ),
    maximumTopologyEdges: positiveSafeInteger(
      suppliedBounds.maximumTopologyEdges ?? DEFAULT_RUNTIME_SNAPSHOT_BOUNDS.maximumTopologyEdges,
      'policy.bounds.maximumTopologyEdges',
      RUNTIME_SNAPSHOT_HARD_LIMITS.maximumTopologyEdges,
    ),
    maximumTopologyBindings: positiveSafeInteger(
      suppliedBounds.maximumTopologyBindings ?? DEFAULT_RUNTIME_SNAPSHOT_BOUNDS.maximumTopologyBindings,
      'policy.bounds.maximumTopologyBindings',
      RUNTIME_SNAPSHOT_HARD_LIMITS.maximumTopologyBindings,
    ),
    maximumStringLength: positiveSafeInteger(
      suppliedBounds.maximumStringLength ?? DEFAULT_RUNTIME_SNAPSHOT_BOUNDS.maximumStringLength,
      'policy.bounds.maximumStringLength',
      RUNTIME_SNAPSHOT_HARD_LIMITS.maximumStringLength,
    ),
  };

  const required = input.policy?.requiredComponents ?? DEFAULT_REQUIRED_COMPONENTS;
  const requiredSet = new Set<RuntimeComponentKey>();
  for (const component of required) {
    if (!(RUNTIME_COMPONENT_KEYS as readonly string[]).includes(component)) {
      throw new TypeError('policy.requiredComponents contains an unknown runtime component');
    }
    requiredSet.add(component);
  }

  return Object.freeze({
    bounds: Object.freeze(bounds),
    requiredComponents: Object.freeze([...requiredSet].sort(compareCodePoints)),
    sequenceGapStormThreshold: positiveSafeInteger(
      input.policy?.sequenceGapStormThreshold ?? 10,
      'policy.sequenceGapStormThreshold',
      RUNTIME_SNAPSHOT_HARD_LIMITS.maximumSequenceGapStormThreshold,
    ),
    queueWarningFillRatio: finiteRatio(input.policy?.queueWarningFillRatio ?? 0.8, 'policy.queueWarningFillRatio'),
    processingLagWarningMs: positiveSafeInteger(
      input.policy?.processingLagWarningMs ?? 1_000,
      'policy.processingLagWarningMs',
      RUNTIME_SNAPSHOT_HARD_LIMITS.maximumProcessingLagWarningMs,
    ),
  });
}

function validateInput(input: RuntimeSnapshotInput, policy: NormalizedPolicy): void {
  if (!object(input)) throw new TypeError('runtime snapshot input must be an object');
  nonNegativeSafeInteger(input.snapshotTimeMs, 'snapshotTimeMs');
  boundedString(input.configurationVersion, 'configurationVersion', policy.bounds.maximumStringLength);
  if (!Array.isArray(input.sources)) throw new TypeError('sources must be an array');
  if (input.sources.length > RUNTIME_SNAPSHOT_HARD_LIMITS.maximumSources) {
    throw new RangeError('sources exceed the runtime snapshot hard safety bound');
  }
  if ((input.universe?.nodes.length ?? 0) > RUNTIME_SNAPSHOT_HARD_LIMITS.maximumUniverseNodes) {
    throw new RangeError('universe nodes exceed the runtime snapshot hard safety bound');
  }
  if ((input.universe?.graph.nodes.length ?? 0) > RUNTIME_SNAPSHOT_HARD_LIMITS.maximumUniverseNodes) {
    throw new RangeError('universe graph nodes exceed the runtime snapshot hard safety bound');
  }
  if ((input.spot?.symbols.length ?? 0) > RUNTIME_SNAPSHOT_HARD_LIMITS.maximumSpotSymbols) {
    throw new RangeError('Spot symbols exceed the runtime snapshot hard safety bound');
  }
  if ((input.futures?.symbols.length ?? 0) > RUNTIME_SNAPSHOT_HARD_LIMITS.maximumFuturesSymbols) {
    throw new RangeError('Futures symbols exceed the runtime snapshot hard safety bound');
  }
  if ((input.focus?.requirements.length ?? 0) > RUNTIME_SNAPSHOT_HARD_LIMITS.maximumFocusRequirements) {
    throw new RangeError('focus requirements exceed the runtime snapshot hard safety bound');
  }
  if ((input.books?.length ?? 0) > RUNTIME_SNAPSHOT_HARD_LIMITS.maximumBooks) {
    throw new RangeError('books exceed the runtime snapshot hard safety bound');
  }
  if ((input.foundationTopology?.nodes.length ?? 0) > RUNTIME_SNAPSHOT_HARD_LIMITS.maximumTopologyNodes) {
    throw new RangeError('Foundation topology nodes exceed the runtime snapshot hard safety bound');
  }
  if ((input.foundationTopology?.edges.length ?? 0) > RUNTIME_SNAPSHOT_HARD_LIMITS.maximumTopologyEdges) {
    throw new RangeError('Foundation topology edges exceed the runtime snapshot hard safety bound');
  }
  for (const [name, value] of [
    ['baseline', input.baseline],
    ['derivatives', input.derivatives],
    ['capture', input.capture],
  ] as const) {
    if (value !== undefined && value !== null && snapshotObservedAt(value) === null) {
      throw new TypeError(`${name} captured snapshot requires an injected observation time`);
    }
  }

  const inputTimes: readonly [string, number | null][] = [
    ['universe.observedAtMs', input.universe?.observedAtMs ?? null],
    ['spot.snapshotTimeMs', input.spot?.snapshotTimeMs ?? null],
    ['futures.snapshotTimeMs', input.futures?.snapshotTimeMs ?? null],
    ['focus.observedAtMs', input.focus?.observedAtMs ?? null],
    ['baseline.snapshotTimeMs', snapshotObservedAt(input.baseline)],
    ['derivatives.snapshotTimeMs', snapshotObservedAt(input.derivatives)],
    ['bridge.snapshotTimeMs', input.bridge?.snapshotTimeMs ?? null],
    ['capture.snapshotTimeMs', snapshotObservedAt(input.capture)],
  ];
  for (const [name, value] of inputTimes) validatePastTime(value, input.snapshotTimeMs, name);
  if (input.universe !== null) {
    for (const [sourceName, source] of Object.entries(input.universe.sources)) {
      validatePastTime(
        source.lastCompleteResponseTimeMs,
        input.universe.observedAtMs,
        `universe.sources.${sourceName}.lastCompleteResponseTimeMs`,
      );
    }
  }
  if (input.spot !== null) {
    for (const [name, value] of Object.entries({
      connectedAtMs: input.spot.connectedAtMs,
      lastTransportReceiveTimeMs: input.spot.lastTransportReceiveTimeMs,
      lastUsefulReceiveTimeMs: input.spot.lastUsefulReceiveTimeMs,
      lastProcessedTimeMs: input.spot.lastProcessedTimeMs,
    })) validatePastTime(value, input.spot.snapshotTimeMs, `spot.${name}`);
    for (const [index, source] of input.spot.sources.entries()) {
      validateRuntimeSourceTimes(source, input.spot.snapshotTimeMs, `spot.sources[${index}]`);
    }
  }
  if (input.futures !== null) {
    for (const [index, source] of input.futures.sources.entries()) {
      validateRuntimeSourceTimes(source, input.futures.snapshotTimeMs, `futures.sources[${index}]`);
    }
    for (const [index, symbol] of input.futures.symbols.entries()) {
      validatePastTime(symbol.lastUsefulReceiveTimeMs, input.futures.snapshotTimeMs, `futures.symbols[${index}].lastUsefulReceiveTimeMs`);
    }
  }
  if (input.baseline !== undefined && input.baseline !== null) {
    const cutMs = snapshotObservedAt(input.baseline) as number;
    validatePastTime(projectionLastSuccess(input.baseline), cutMs, 'baseline.lastSuccessTimeMs');
    if ('items' in input.baseline) {
      for (const [index, item] of input.baseline.items.entries()) {
        validatePastTime(item.lastCompletedCloseTimeMs, cutMs, `baseline.items[${index}].lastCompletedCloseTimeMs`);
      }
    }
  }
  if (input.derivatives !== undefined && input.derivatives !== null) {
    const cutMs = snapshotObservedAt(input.derivatives) as number;
    validatePastTime(projectionLastSuccess(input.derivatives), cutMs, 'derivatives.lastSuccessTimeMs');
    if ('coverage' in input.derivatives) {
      for (const [index, fact] of input.derivatives.facts.entries()) {
        validatePastTime(fact.receiveTimeMs, cutMs, `derivatives.facts[${index}].receiveTimeMs`);
        validatePastTime(fact.evaluatedAtMs ?? null, cutMs, `derivatives.facts[${index}].evaluatedAtMs`);
        validatePastTime(fact.lastError?.observedAtMs ?? null, cutMs, `derivatives.facts[${index}].lastError.observedAtMs`);
      }
      validatePastTime(input.derivatives.budget.observedAtMs, cutMs, 'derivatives.budget.observedAtMs');
    } else {
      for (const [index, entry] of input.derivatives.rateBudgets.entries()) {
        validatePastTime(entry.budget.observedAtMs, cutMs, `derivatives.rateBudgets[${index}].observedAtMs`);
      }
    }
  }
  if (input.bridge !== undefined && input.bridge !== null) {
    const cutMs = input.bridge.snapshotTimeMs;
    validatePastTime(projectionLastSuccess(input.bridge), cutMs, 'bridge.lastSuccessTimeMs');
    if ('artifacts' in input.bridge) {
      validatePastTime(input.bridge.attentionPlan?.atMs ?? null, cutMs, 'bridge.attentionPlan.atMs');
      validatePastTime(input.bridge.publicAttention?.atMs ?? null, cutMs, 'bridge.publicAttention.atMs');
      for (const [index, artifact] of input.bridge.artifacts.entries()) {
        validatePastTime(artifact.evaluatedAtMs, cutMs, `bridge.artifacts[${index}].evaluatedAtMs`);
      }
      for (const [index, link] of (input.bridge.correlationIndex.links ?? []).entries()) {
        validatePastTime(link.observedAtMs, cutMs, `bridge.correlationIndex.links[${index}].observedAtMs`);
      }
      for (const [index, pending] of (input.bridge.pendingCandidateTriggers ?? []).entries()) {
        validatePastTime(pending.transitionAtMs, cutMs, `bridge.pendingCandidateTriggers[${index}].transitionAtMs`);
      }
      for (const [index, failure] of input.bridge.failures.entries()) {
        validatePastTime(failure.firstObservedAtMs, cutMs, `bridge.failures[${index}].firstObservedAtMs`);
        validatePastTime(failure.lastObservedAtMs, cutMs, `bridge.failures[${index}].lastObservedAtMs`);
      }
    }
  }
  if (input.capture !== undefined && input.capture !== null) {
    const cutMs = snapshotObservedAt(input.capture) as number;
    validatePastTime(projectionLastSuccess(input.capture), cutMs, 'capture.lastSuccessTimeMs');
    if ('captures' in input.capture) {
      for (const [index, capture] of input.capture.captures.entries()) {
        validatePastTime(capture.createdAtMs ?? null, cutMs, `capture.captures[${index}].createdAtMs`);
        validatePastTime(capture.finishedAtMs, cutMs, `capture.captures[${index}].finishedAtMs`);
        for (const [evidenceIndex, evidence] of [
          ...(capture.preEvidence ?? []),
          ...(capture.postEvidence ?? []),
        ].entries()) {
          validatePastTime(evidence.ingestedAtMs, cutMs, `capture.captures[${index}].evidence[${evidenceIndex}].ingestedAtMs`);
        }
      }
      for (const [index, failure] of input.capture.failures.entries()) {
        validatePastTime(failure.firstObservedAtMs, cutMs, `capture.failures[${index}].firstObservedAtMs`);
        validatePastTime(failure.lastObservedAtMs, cutMs, `capture.failures[${index}].lastObservedAtMs`);
      }
    }
  }
  for (const [index, book] of (input.books ?? []).entries()) {
    validatePastTime(book.snapshotTimeMs, input.snapshotTimeMs, `books[${index}].snapshotTimeMs`);
  }
}

function sourceView(
  input: RuntimeSourceOperationalInput,
  snapshotTimeMs: number,
  bounds: RuntimeSnapshotBounds,
  required: ReadonlySet<RuntimeComponentKey>,
): RuntimeSourceView {
  const source = input.source;
  boundedString(source.sourceId, 'source.sourceId', bounds.maximumStringLength);
  boundedString(input.capability, 'source.capability', bounds.maximumStringLength);
  validateRuntimeSourceTimes(source, snapshotTimeMs, source.sourceId);
  for (const [name, value] of Object.entries({
    connectionGeneration: source.connectionGeneration,
    invalidCount: source.invalidCount,
    duplicateCount: source.duplicateCount,
    outOfOrderCount: source.outOfOrderCount,
    sequenceGapCount: source.sequenceGapCount,
    droppedCount: source.droppedCount,
    coalescedCount: source.coalescedCount,
    reconnectCount: source.reconnectCount,
  })) nonNegativeSafeInteger(value, `${source.sourceId}.${name}`);

  const lastSuccessTimeMs = source.lastProcessedTimeMs ?? source.lastMessageReceiveTimeMs;
  return Object.freeze({
    sourceId: source.sourceId,
    component: input.component,
    capability: input.capability,
    criticality: effectiveCriticality(input.component, input.criticality, required),
    transportKind: source.transportKind,
    productFamily: source.productFamily,
    endpointClass: source.endpointClass,
    desiredState: source.desiredState,
    observedState: source.observedState,
    authority: source.authority,
    completeness: source.completeness,
    connectionGeneration: source.connectionGeneration,
    messageAgeMs: source.messageAgeMs,
    processingLagMs: source.processingLagMs,
    lastSuccessTimeMs,
    lastError: exactRuntimeError(source.lastError, source.snapshotTimeMs, bounds, `${source.sourceId}.lastError`),
    recommendedAction: copyText(source.recommendedAction, bounds.maximumStringLength),
    counters: Object.freeze({
      invalid: source.invalidCount,
      duplicate: source.duplicateCount,
      outOfOrder: source.outOfOrderCount,
      sequenceGap: source.sequenceGapCount,
      dropped: source.droppedCount,
      coalesced: source.coalescedCount,
      reconnect: source.reconnectCount,
    }),
    queue: input.queue === undefined || input.queue === null ? null : exactQueue(input.queue, `${source.sourceId}.queue`),
    rateBudget: exactRateBudget(source.rateBudget, source.snapshotTimeMs, `${source.sourceId}.rateBudget`),
  });
}

function universeSummary(input: RuntimeSnapshotInput): RuntimeUniverseCoverageSummary {
  if (input.universe === null) {
    return Object.freeze({
      total: 0, visible: 0, withSpot: 0, withFutures: 0, paired: 0,
      focusEligible: 0, focusIneligible: 0, focusUnknown: 0,
      publicAvailable: 0, publicPartial: 0, publicUnavailable: 0, publicUnknown: 0,
      spotSourceState: 'UNAVAILABLE', futuresSourceState: 'UNAVAILABLE',
    });
  }
  const graphNodes = input.universe.graph.nodes;
  let withSpot = 0;
  let withFutures = 0;
  let paired = 0;
  let focusEligible = 0;
  let focusIneligible = 0;
  let focusUnknown = 0;
  let publicAvailable = 0;
  let publicPartial = 0;
  let publicUnavailable = 0;
  let publicUnknown = 0;
  for (const node of graphNodes) {
    if (node.spot !== null) withSpot += 1;
    if (node.usdMPerpetual !== null) withFutures += 1;
    if (node.spot !== null && node.usdMPerpetual !== null) paired += 1;
  }
  for (const node of input.universe.nodes) {
    if (node.focusEligibility.state === 'ELIGIBLE') focusEligible += 1;
    else if (node.focusEligibility.state === 'INELIGIBLE') focusIneligible += 1;
    else focusUnknown += 1;
    const state = node.coverage.publicData.state;
    if (state === 'AVAILABLE') publicAvailable += 1;
    else if (state === 'PARTIAL') publicPartial += 1;
    else if (state === 'UNAVAILABLE' || state === 'STALE') publicUnavailable += 1;
    else publicUnknown += 1;
  }
  return Object.freeze({
    total: input.universe.nodes.length,
    visible: input.universe.nodes.length,
    withSpot,
    withFutures,
    paired,
    focusEligible,
    focusIneligible,
    focusUnknown,
    publicAvailable,
    publicPartial,
    publicUnavailable,
    publicUnknown,
    spotSourceState: input.universe.sources.SPOT.state,
    futuresSourceState: input.universe.sources.USD_M_PERPETUAL.state,
  });
}

function spotSummary(input: RuntimeSnapshotInput, universe: RuntimeUniverseCoverageSummary): RuntimeMarketCoverageSummary {
  const symbols = input.spot?.symbols ?? [];
  let freshTicker = 0;
  let freshBook = 0;
  let freshTrade = 0;
  let staleOrPriorGeneration = 0;
  for (const symbol of symbols) {
    if (symbol.tickerFreshness === 'FRESH') freshTicker += 1;
    else staleOrPriorGeneration += 1;
    if (symbol.bookFreshness === 'FRESH') freshBook += 1;
    if (symbol.tradeFreshness === 'FRESH') freshTrade += 1;
  }
  return Object.freeze({
    universeExpected: universe.withSpot,
    retainedSymbols: symbols.length,
    freshTicker,
    freshBook,
    freshTrade,
    freshMark: 0,
    fundingKnown: 0,
    fundingIntervalKnown: 0,
    contractKnown: 0,
    staleOrPriorGeneration,
  });
}

function futuresSummary(input: RuntimeSnapshotInput, universe: RuntimeUniverseCoverageSummary): RuntimeMarketCoverageSummary {
  const symbols = input.futures?.symbols ?? [];
  let freshBook = 0;
  let freshMark = 0;
  let fundingKnown = 0;
  let fundingIntervalKnown = 0;
  let contractKnown = 0;
  let staleOrPriorGeneration = 0;
  for (const symbol of symbols) {
    if (symbol.book?.freshness === 'FRESH') freshBook += 1;
    if (symbol.markFunding?.freshness === 'FRESH') freshMark += 1;
    if (symbol.fundingRate !== null) fundingKnown += 1;
    if (symbol.fundingIntervalHours !== null) fundingIntervalKnown += 1;
    if (symbol.contract !== null) contractKnown += 1;
    if (
      symbol.book === null || symbol.markFunding === null
      || symbol.book.freshness !== 'FRESH' || symbol.markFunding.freshness !== 'FRESH'
    ) staleOrPriorGeneration += 1;
  }
  return Object.freeze({
    universeExpected: universe.withFutures,
    retainedSymbols: symbols.length,
    freshTicker: 0,
    freshBook,
    freshTrade: 0,
    freshMark,
    fundingKnown,
    fundingIntervalKnown,
    contractKnown,
    staleOrPriorGeneration,
  });
}

function focusSummary(input: RuntimeSnapshotInput): RuntimeFocusCoverageSummary {
  const allocations = input.bridge?.publicAttention?.allocations ?? [];
  const requirements = input.focus?.requirements ?? [];
  const symbols = new Set<string>();
  let requestedEvidence = 0;
  for (const allocation of allocations) {
    symbols.add(allocation.symbol);
    requestedEvidence = safeAdd(requestedEvidence, allocation.requestedEvidence.length, 'requested evidence count');
  }
  for (const requirement of requirements) symbols.add(requirement.symbol);
  requestedEvidence = Math.max(requestedEvidence, requirements.length);
  const ready = requirements.filter((entry) => entry.state === 'READY' || entry.state === 'REUSED_BROAD').length;
  const warming = requirements.filter((entry) => (
    entry.state === 'REST_INTENT' || entry.state === 'DESIRED'
    || entry.state === 'SUBSCRIBING' || entry.state === 'WARMING'
  )).length;
  const unfulfilled = requirements.filter((entry) => entry.state === 'UNFULFILLED').length;
  const protectedUnfulfilled = requirements.filter((entry) => entry.protected && entry.state === 'UNFULFILLED').length;
  return Object.freeze({
    focusedSymbols: symbols.size,
    allocations: allocations.length,
    requestedEvidence,
    deliveredEvidence: ready,
    requirements: requirements.length,
    ready,
    warming,
    unfulfilled,
    protectedUnfulfilled,
    pendingControlMessages: input.focus?.counts.pendingControlMessages ?? 0,
  });
}

function stateCount(input: RuntimeSnapshotInput, state: BaselineRuntimeState): number {
  return input.baseline?.stateCounts[state] ?? 0;
}

function baselineSummary(input: RuntimeSnapshotInput): RuntimeBaselineSummary {
  if (input.baseline === undefined || input.baseline === null) {
    return Object.freeze({
      total: 0, complete: 0, pending: 0, fetching: 0, partial: 0, stale: 0,
      insufficientHistory: 0, unavailable: 0, rateLimited: 0, retryWaiting: 0,
      completionRatio: null, records: 0, actualWeight: 0,
    });
  }
  const complete = stateCount(input, 'COMPLETE');
  const total = input.baseline.totals.items;
  return Object.freeze({
    total,
    complete,
    pending: stateCount(input, 'PENDING'),
    fetching: stateCount(input, 'FETCHING'),
    partial: stateCount(input, 'PARTIAL'),
    stale: stateCount(input, 'STALE'),
    insufficientHistory: stateCount(input, 'INSUFFICIENT_HISTORY'),
    unavailable: stateCount(input, 'UNAVAILABLE'),
    rateLimited: stateCount(input, 'RATE_LIMITED'),
    retryWaiting: stateCount(input, 'RETRY_WAIT'),
    completionRatio: total === 0 ? null : complete / total,
    records: 'records' in input.baseline.totals
      ? input.baseline.totals.records ?? input.baseline.totals.acceptedRecords ?? 0
      : input.baseline.totals.acceptedRecords ?? 0,
    actualWeight: input.baseline.totals.actualWeight,
  });
}

function bookSummary(input: RuntimeSnapshotInput): RuntimeBookSummary {
  const books = input.books ?? [];
  return Object.freeze({
    total: books.length,
    live: books.filter((entry) => entry.observedState === 'LIVE').length,
    warming: books.filter((entry) => entry.observedState === 'BUFFERING' || entry.observedState === 'WAITING_BRIDGE').length,
    degraded: books.filter((entry) => entry.observedState === 'DEGRADED').length,
    stale: books.filter((entry) => entry.observedState === 'STALE' || entry.freshnessState === 'STALE').length,
    complete: books.filter((entry) => entry.completeness.state === 'COMPLETE').length,
    pendingResync: books.filter((entry) => entry.pendingResyncRequest !== null).length,
    sequenceGaps: books.reduce((total, entry) => safeAdd(total, entry.counters.sequenceGapCount, 'book sequence gaps'), 0),
    resyncs: books.reduce((total, entry) => safeAdd(total, entry.counters.resyncCount, 'book resyncs'), 0),
    drops: books.reduce((total, entry) => safeAdd(total, entry.counters.droppedCount, 'book drops'), 0),
  });
}

function captureSummary(input: RuntimeSnapshotInput): RuntimeCaptureSummary {
  const capture = input.capture;
  if (capture === undefined || capture === null) {
    return Object.freeze({
      state: 'UNAVAILABLE', active: 0, complete: 0, incomplete: 0, truncated: 0, evicted: 0,
      checkpointState: 'UNAVAILABLE',
    });
  }
  if ('captures' in capture) {
    const incomplete = capture.captures.filter((entry) => entry.completeness.state === 'INCOMPLETE').length;
    const truncated = capture.captures.filter((entry) => (
      entry.completeness.state === 'TRUNCATED' || entry.truncation.preTrigger || entry.truncation.postTrigger
    )).length;
    const degraded = incomplete > 0 || truncated > 0 || capture.evictedCaptureCount > 0 || capture.failures.length > 0;
    return Object.freeze({
      state: degraded ? 'DEGRADED' : capture.activeCaptureCount > 0 ? 'ACTIVE' : 'IDLE',
      active: capture.activeCaptureCount,
      complete: capture.completedCaptureCount,
      incomplete,
      truncated,
      evicted: capture.evictedCaptureCount,
      checkpointState: 'LOADED',
    });
  }
  const degraded = capture.truncatedCaptures > 0 || capture.incompleteCaptures > 0
    || capture.evictedCaptures > 0 || capture.checkpointState === 'FAILED' || capture.lastError !== null;
  return Object.freeze({
    state: degraded ? 'DEGRADED' : capture.activeCaptures > 0 ? 'ACTIVE' : 'IDLE',
    active: capture.activeCaptures,
    complete: capture.completedCaptures,
    incomplete: capture.incompleteCaptures,
    truncated: capture.truncatedCaptures,
    evicted: capture.evictedCaptures,
    checkpointState: capture.checkpointState,
  });
}

function emptyDerivativesFacts(): RuntimeDerivativesFactsSummary {
  return Object.freeze({
    total: 0,
    fresh: 0,
    stale: 0,
    unavailable: 0,
    optionalUnavailable: 0,
    lastSuccessTimeMs: null,
  });
}

function derivativesFacts(input: RuntimeSnapshotInput): RuntimeDerivativesFactsSummary {
  const derivatives = input.derivatives;
  if (derivatives === undefined || derivatives === null) return emptyDerivativesFacts();
  if (!('coverage' in derivatives)) {
    const total = nonNegativeSafeInteger(derivatives.facts.total, 'derivatives.facts.total');
    const fresh = nonNegativeSafeInteger(derivatives.facts.fresh, 'derivatives.facts.fresh');
    const stale = nonNegativeSafeInteger(derivatives.facts.stale, 'derivatives.facts.stale');
    const unavailable = nonNegativeSafeInteger(derivatives.facts.unavailable, 'derivatives.facts.unavailable');
    const optionalUnavailable = nonNegativeSafeInteger(
      derivatives.facts.optionalUnavailable,
      'derivatives.facts.optionalUnavailable',
    );
    if (optionalUnavailable > unavailable || safeAdd(safeAdd(fresh, stale, 'derivatives fact count'), unavailable, 'derivatives fact count') > total) {
      throw new RangeError('derivatives fact summary counts are inconsistent');
    }
    validatePastTime(derivatives.facts.lastSuccessTimeMs, derivatives.observedAtMs, 'derivatives.facts.lastSuccessTimeMs');
    return Object.freeze({ total, fresh, stale, unavailable, optionalUnavailable, lastSuccessTimeMs: derivatives.facts.lastSuccessTimeMs });
  }
  let fresh = 0;
  let stale = 0;
  let unavailable = 0;
  let optionalUnavailable = 0;
  let lastSuccessTimeMs: number | null = null;
  for (const fact of derivatives.facts) {
    const keyRequired = fact.source.access === 'API_KEY_REQUIRED'
      || fact.kind === 'TOP_TRADER_ACCOUNT'
      || fact.kind === 'TOP_TRADER_POSITION';
    if (keyRequired) {
      unavailable += 1;
      optionalUnavailable += 1;
    } else if (fact.availability === 'AVAILABLE' && fact.value !== null) {
      fresh += 1;
      lastSuccessTimeMs = maximumNullable(lastSuccessTimeMs, fact.receiveTimeMs);
    } else if (fact.availability === 'STALE' && fact.value !== null) {
      stale += 1;
    } else {
      unavailable += 1;
    }
  }
  return Object.freeze({
    total: derivatives.facts.length,
    fresh,
    stale,
    unavailable,
    optionalUnavailable,
    lastSuccessTimeMs,
  });
}

function derivativesRateBudgets(input: RuntimeSnapshotInput): readonly Readonly<{ sourceId: string; budget: RuntimeRateBudgetState }>[] {
  const derivatives = input.derivatives;
  if (derivatives === undefined || derivatives === null) return Object.freeze([]);
  const cutMs = snapshotObservedAt(derivatives) as number;
  if ('rateBudgets' in derivatives) return Object.freeze(derivatives.rateBudgets.map((entry, index) => Object.freeze({
    sourceId: boundedString(entry.sourceId, `derivatives.rateBudgets[${index}].sourceId`, RUNTIME_SNAPSHOT_HARD_LIMITS.maximumStringLength),
    budget: exactRateBudget(entry.budget, cutMs, `derivatives.rateBudgets[${index}].budget`),
  })));
  return Object.freeze([Object.freeze({
    sourceId: 'binance-usdm-public-derivatives-rest',
    budget: exactRateBudget(derivatives.budget, cutMs, 'derivatives.budget'),
  })]);
}

function operationsSummary(
  input: RuntimeSnapshotInput,
  operationalSources: readonly RuntimeSourceOperationalInput[],
  sources: readonly RuntimeSourceView[],
  books: RuntimeBookSummary,
): RuntimeOperationsSummary {
  const stateCounts = Object.fromEntries(SOURCE_STATES.map((state) => [state, 0])) as Record<RuntimeLifecycleState, number>;
  let sourceSequenceGaps = 0;
  for (const source of sources) {
    stateCounts[source.observedState] += 1;
    sourceSequenceGaps = safeAdd(sourceSequenceGaps, source.counters.sequenceGap, 'source sequence gaps');
  }

  let queueDepth = 0;
  let queueCapacity = 0;
  let queueHighWatermark = 0;
  let queueDrops = 0;
  let queueCoalesces = 0;
  let queueOverflows = 0;
  let queuesRequiringResync = 0;
  let p95: number | null = null;
  let p99: number | null = null;
  for (const source of operationalSources) {
    const queue = source.queue;
    if (queue !== undefined && queue !== null) {
      queueDepth = safeAdd(queueDepth, queue.depth, 'queue depth');
      queueCapacity = safeAdd(queueCapacity, queue.capacity, 'queue capacity');
      queueHighWatermark = safeAdd(queueHighWatermark, queue.highWatermark, 'queue high watermark');
      queueDrops = safeAdd(queueDrops, queue.droppedCount, 'queue drops');
      queueCoalesces = safeAdd(queueCoalesces, queue.coalescedCount, 'queue coalesces');
      queueOverflows = safeAdd(queueOverflows, queue.overflowCount, 'queue overflows');
      if (queue.resyncRequired) queuesRequiringResync += 1;
    }
    p95 = maximumNullable(p95, source.lag?.global.p95LagMs ?? null);
    p99 = maximumNullable(p99, source.lag?.global.p99LagMs ?? null);
  }
  const spotQueueSupplied = operationalSources.some((source) => source.component === 'SPOT_BROAD' && source.queue != null);
  if (!spotQueueSupplied && input.spot !== null) {
    const queue = input.spot.backpressure;
    queueDepth = safeAdd(queueDepth, queue.depth, 'queue depth');
    queueCapacity = safeAdd(queueCapacity, queue.capacity, 'queue capacity');
    queueHighWatermark = safeAdd(queueHighWatermark, queue.depth, 'queue high watermark');
    queueDrops = safeAdd(queueDrops, queue.droppedCount, 'queue drops');
    queueCoalesces = safeAdd(queueCoalesces, queue.coalescedCount, 'queue coalesces');
    queueOverflows = safeAdd(queueOverflows, queue.capacityDropCount, 'queue overflows');
  }

  const budgetEntries: readonly RuntimeRateBudgetState[] = [
    ...operationalSources
      .filter((source) => source.source.transportKind === 'REST')
      .map((source) => source.source.rateBudget),
    ...derivativesRateBudgets(input).map((entry) => entry.budget),
  ];
  const budgets = { available: 0, nearLimit: 0, exhausted: 0, cooldown: 0, unknown: 0, worstUtilization: null as number | null };
  for (const budget of budgetEntries) {
    if (budget.state === 'AVAILABLE') budgets.available += 1;
    else if (budget.state === 'NEAR_LIMIT') budgets.nearLimit += 1;
    else if (budget.state === 'EXHAUSTED') budgets.exhausted += 1;
    else if (budget.state === 'COOLDOWN') budgets.cooldown += 1;
    else budgets.unknown += 1;
    if (budget.usedWeight !== null && budget.limit !== null && budget.limit > 0) {
      budgets.worstUtilization = Math.max(budgets.worstUtilization ?? 0, budget.usedWeight / budget.limit);
    }
  }

  return Object.freeze({
    sources: sources.length,
    sourceStates: Object.freeze(stateCounts),
    queueDepth,
    queueCapacity,
    queueHighWatermark,
    queueDrops,
    queueCoalesces,
    queueOverflows,
    queuesRequiringResync,
    sourceSequenceGaps,
    bookSequenceGaps: books.sequenceGaps,
    processingLagWorstP95Ms: p95,
    processingLagWorstP99Ms: p99,
    restBudgets: Object.freeze(budgets),
  });
}

function reason(
  bounds: RuntimeSnapshotBounds,
  spec: Omit<MutableReason, 'id'> & { discriminator?: string },
): RuntimeHealthReason {
  const id = stableId('runtime-health-reason', {
    code: spec.code,
    component: spec.component,
    sourceId: spec.sourceId,
    discriminator: spec.discriminator ?? null,
    observedAtMs: spec.observedAtMs,
  });
  return Object.freeze({
    id,
    severity: spec.severity,
    impact: spec.impact,
    code: spec.code,
    component: spec.component,
    sourceId: spec.sourceId,
    message: copyText(spec.message, bounds.maximumStringLength),
    recommendedAction: copyText(spec.recommendedAction, bounds.maximumStringLength),
    observedAtMs: spec.observedAtMs,
  });
}

function severityFor(criticality: RuntimeCriticality): RuntimeHealthReason['severity'] {
  return criticality === 'CORE' || criticality === 'PROTECTED' ? 'BLOCKING' : 'WARNING';
}

function impactFor(criticality: RuntimeCriticality): RuntimeReasonImpact {
  return criticality === 'CORE' || criticality === 'PROTECTED' ? 'BLOCKED' : 'DEGRADED';
}

function addSourceReasons(
  reasons: RuntimeHealthReason[],
  input: RuntimeSnapshotInput,
  operational: RuntimeSourceOperationalInput,
  view: RuntimeSourceView,
  policy: NormalizedPolicy,
): void {
  const add = (spec: Omit<MutableReason, 'id' | 'component' | 'sourceId' | 'observedAtMs'> & { discriminator?: string }): void => {
    reasons.push(reason(policy.bounds, {
      ...spec,
      component: view.component,
      sourceId: view.sourceId,
      observedAtMs: input.snapshotTimeMs,
    }));
  };
  if (policy.requiredComponents.includes(view.component) && view.desiredState === 'STOPPED') {
    add({
      severity: 'BLOCKING', impact: 'BLOCKED', code: 'REQUIRED_SOURCE_STOPPED',
      message: `${view.sourceId} is supplied to a required component but its desired state is stopped.`,
      recommendedAction: 'Either start the owning source explicitly or remove the component from required runtime policy.',
    });
  }
  if (view.desiredState === 'RUNNING' && view.observedState === 'STOPPED') {
    add({
      severity: severityFor(view.criticality), impact: impactFor(view.criticality), code: 'SOURCE_STOPPED_UNEXPECTEDLY',
      message: `${view.sourceId} is stopped while its desired state is running.`,
      recommendedAction: view.recommendedAction || 'Inspect the source lifecycle without mutating it from this read model.',
    });
  } else if (view.observedState === 'CONNECTING' || view.observedState === 'WARMING') {
    add({
      severity: 'WARNING', impact: 'WARMING', code: `SOURCE_${view.observedState}`,
      message: `${view.sourceId} has not reached live evidence yet.`,
      recommendedAction: view.recommendedAction || 'Wait for the source lifecycle to advance or inspect its owner.',
    });
  } else if (view.observedState === 'SILENT' || view.observedState === 'STALE' || view.observedState === 'FAILED') {
    add({
      severity: severityFor(view.criticality), impact: impactFor(view.criticality), code: `SOURCE_${view.observedState}`,
      message: `${view.sourceId} is ${view.observedState.toLowerCase()} and cannot be represented as healthy.`,
      recommendedAction: view.recommendedAction || 'Inspect source age, transport state, and retry evidence.',
    });
  } else if (
    view.observedState === 'DEGRADED' || view.observedState === 'BACKING_OFF'
    || view.observedState === 'RATE_LIMITED'
  ) {
    add({
      severity: 'WARNING', impact: 'DEGRADED', code: `SOURCE_${view.observedState}`,
      message: `${view.sourceId} is ${view.observedState.toLowerCase().replace('_', ' ')}.`,
      recommendedAction: view.recommendedAction || 'Inspect the owning source and its bounded recovery state.',
    });
  }

  if (view.authority === 'UNAVAILABLE' || view.completeness === 'MISSING') {
    add({
      severity: severityFor(view.criticality), impact: impactFor(view.criticality), code: 'SOURCE_EVIDENCE_UNAVAILABLE',
      message: `${view.sourceId} exposes unavailable or missing evidence.`,
      recommendedAction: 'Treat the affected evidence as unavailable until the source advances.',
    });
  } else if (view.completeness === 'PARTIAL') {
    add({
      severity: 'WARNING', impact: 'DEGRADED', code: 'SOURCE_EVIDENCE_PARTIAL',
      message: `${view.sourceId} exposes partial evidence.`,
      recommendedAction: 'Keep missing facts explicit and inspect source coverage.',
    });
  }

  if (view.rateBudget.state !== 'AVAILABLE' && view.rateBudget.state !== 'UNKNOWN') {
    add({
      severity: 'WARNING', impact: 'DEGRADED', code: `REST_BUDGET_${view.rateBudget.state}`,
      message: `${view.sourceId} REST budget is ${view.rateBudget.state.toLowerCase().replace('_', ' ')}.`,
      recommendedAction: 'Honor retry and reset timing; do not bypass the public request budget.',
    });
  }

  const queue = operational.queue;
  if (queue !== undefined && queue !== null) {
    if (queue.resyncRequired) {
      add({
        severity: severityFor(view.criticality), impact: impactFor(view.criticality), code: 'QUEUE_REQUIRES_RESYNC',
        message: `${view.sourceId} queue lost sequence continuity and requires resynchronization.`,
        recommendedAction: 'Use the owning reducer resync path before trusting sequence-sensitive evidence.',
      });
    }
    if (queue.overflowCount > 0 || queue.droppedCount > 0) {
      add({
        severity: 'WARNING', impact: 'DEGRADED', code: 'QUEUE_DATA_SHED',
        message: `${view.sourceId} queue has dropped or overflowed records.`,
        recommendedAction: 'Inspect bounded capacity, shedding counters, and evidence completeness.',
      });
    }
    if (queue.capacity > 0 && queue.depth / queue.capacity >= policy.queueWarningFillRatio) {
      add({
        severity: 'WARNING', impact: 'DEGRADED', code: 'QUEUE_NEAR_CAPACITY',
        message: `${view.sourceId} queue depth is at or above the configured warning ratio.`,
        recommendedAction: 'Inspect consumer lag and preserve bounded shedding semantics.',
      });
    }
  }
  if (view.counters.sequenceGap >= policy.sequenceGapStormThreshold) {
    add({
      severity: severityFor(view.criticality), impact: impactFor(view.criticality), code: 'SEQUENCE_GAP_STORM',
      message: `${view.sourceId} exceeded the configured sequence-gap storm threshold.`,
      recommendedAction: 'Treat sequence-sensitive evidence as incomplete and follow the owning resync procedure.',
    });
  } else if (view.counters.sequenceGap > 0) {
    add({
      severity: 'WARNING', impact: 'DEGRADED', code: 'SEQUENCE_GAPS_OBSERVED',
      message: `${view.sourceId} has observed sequence gaps.`,
      recommendedAction: 'Inspect gap counters and the corresponding resync evidence.',
    });
  }
  const lag = maximumNullable(view.processingLagMs, operational.lag?.global.p99LagMs ?? null);
  if (lag !== null && lag >= policy.processingLagWarningMs) {
    add({
      severity: 'WARNING', impact: 'DEGRADED', code: 'PROCESSING_LAG_HIGH',
      message: `${view.sourceId} processing lag exceeds the configured warning threshold.`,
      recommendedAction: 'Inspect queue depth and downstream processing before trusting freshness.',
    });
  }
}

function capturedComponentStopped(input: RuntimeSnapshotInput, key: RuntimeComponentKey): boolean {
  if (key === 'SPOT_BROAD') return input.spot?.observedState === 'STOPPED';
  if (key === 'FUTURES_BROAD') {
    const sources = input.futures?.sources ?? [];
    return sources.length > 0 && sources.every((source) => source.observedState === 'STOPPED');
  }
  if (key === 'BOOKS') {
    const books = input.books ?? [];
    return books.length > 0 && books.every((book) => book.observedState === 'STOPPED');
  }
  return false;
}

function componentPresent(input: RuntimeSnapshotInput, key: RuntimeComponentKey): boolean {
  if (key === 'UNIVERSE') return input.universe !== null;
  if (key === 'SPOT_BROAD') return input.spot !== null;
  if (key === 'FUTURES_BROAD') return input.futures !== null;
  if (key === 'LIFECYCLE') return input.sources.length > 0;
  if (key === 'FOCUS') return input.focus !== undefined && input.focus !== null;
  if (key === 'BOOKS') return input.books !== undefined;
  if (key === 'BASELINE') return input.baseline !== undefined && input.baseline !== null;
  if (key === 'DERIVATIVES') return input.derivatives !== undefined && input.derivatives !== null;
  if (key === 'BRIDGE') return input.bridge !== undefined && input.bridge !== null;
  if (key === 'CAPTURE') return input.capture !== undefined && input.capture !== null;
  return true;
}

function aggregateReasons(
  input: RuntimeSnapshotInput,
  policy: NormalizedPolicy,
  operationalSources: readonly RuntimeSourceOperationalInput[],
  sources: readonly RuntimeSourceView[],
  universe: RuntimeUniverseCoverageSummary,
  spot: RuntimeMarketCoverageSummary,
  futures: RuntimeMarketCoverageSummary,
  focus: RuntimeFocusCoverageSummary,
  baseline: RuntimeBaselineSummary,
  books: RuntimeBookSummary,
  capture: RuntimeCaptureSummary,
): readonly RuntimeHealthReason[] {
  const reasons: RuntimeHealthReason[] = [];
  const add = (spec: Omit<MutableReason, 'id'> & { discriminator?: string }): void => {
    reasons.push(reason(policy.bounds, spec));
  };

  for (const required of policy.requiredComponents) {
    if (!componentPresent(input, required)) {
      add({
        severity: 'BLOCKING', impact: 'BLOCKED', code: 'REQUIRED_COMPONENT_UNAVAILABLE', component: required,
        sourceId: null, observedAtMs: input.snapshotTimeMs, discriminator: required,
        message: `${COMPONENT_NAMES[required]} is required but no captured snapshot was supplied.`,
        recommendedAction: 'Supply a captured component snapshot; this adapter will not start or mutate the component.',
      });
    } else if (capturedComponentStopped(input, required)) {
      add({
        severity: 'BLOCKING', impact: 'BLOCKED', code: 'REQUIRED_COMPONENT_STOPPED', component: required,
        sourceId: null, observedAtMs: input.snapshotTimeMs, discriminator: required,
        message: `${COMPONENT_NAMES[required]} is required but its captured observed state is stopped.`,
        recommendedAction: 'Start the owning component explicitly or remove it from required runtime policy.',
      });
    }
  }
  for (let index = 0; index < sources.length; index += 1) {
    addSourceReasons(reasons, input, operationalSources[index] as RuntimeSourceOperationalInput, sources[index] as RuntimeSourceView, policy);
  }

  if (input.universe !== null) {
    for (const [sourceName, source] of Object.entries(input.universe.sources)) {
      if (source.state === 'UNAVAILABLE' || source.stale) {
        add({
          severity: 'BLOCKING', impact: 'BLOCKED', code: source.stale ? 'UNIVERSE_SOURCE_STALE' : 'UNIVERSE_SOURCE_UNAVAILABLE',
          component: 'UNIVERSE', sourceId: sourceName, observedAtMs: input.universe.observedAtMs, discriminator: sourceName,
          message: `${sourceName} universe evidence is ${source.stale ? 'stale' : 'unavailable'}.`,
          recommendedAction: 'Retain the last truthful universe and refresh through the owning public adapter.',
        });
      } else if (source.state === 'PARTIAL') {
        add({
          severity: 'WARNING', impact: 'DEGRADED', code: 'UNIVERSE_SOURCE_PARTIAL', component: 'UNIVERSE',
          sourceId: sourceName, observedAtMs: input.universe.observedAtMs, discriminator: sourceName,
          message: `${sourceName} universe refresh is partial.`,
          recommendedAction: 'Keep the retained universe visible and inspect the source failures.',
        });
      }
    }
  }
  if (input.spot !== null && spot.universeExpected > 0 && spot.retainedSymbols === 0) {
    add({
      severity: 'BLOCKING', impact: 'BLOCKED', code: 'SPOT_COVERAGE_EMPTY', component: 'SPOT_BROAD', sourceId: null,
      observedAtMs: input.spot.snapshotTimeMs, message: 'Spot universe coverage is expected but no symbols are retained.',
      recommendedAction: 'Inspect broad Spot adapter seeding and source generation.',
    });
  } else if (spot.retainedSymbols < spot.universeExpected) {
    add({
      severity: 'WARNING', impact: 'DEGRADED', code: 'SPOT_COVERAGE_PARTIAL', component: 'SPOT_BROAD', sourceId: null,
      observedAtMs: input.spot?.snapshotTimeMs ?? input.snapshotTimeMs,
      message: 'Broad Spot symbol coverage is smaller than the current Spot universe.',
      recommendedAction: 'Inspect universe seeding and keep missing symbols explicit.',
    });
  }
  if (input.futures !== null && futures.universeExpected > 0 && futures.retainedSymbols === 0) {
    add({
      severity: 'BLOCKING', impact: 'BLOCKED', code: 'FUTURES_COVERAGE_EMPTY', component: 'FUTURES_BROAD', sourceId: null,
      observedAtMs: input.futures.snapshotTimeMs, message: 'USD-M universe coverage is expected but no symbols are retained.',
      recommendedAction: 'Inspect broad Futures adapter seeding and source generation.',
    });
  } else if (futures.retainedSymbols < futures.universeExpected) {
    add({
      severity: 'WARNING', impact: 'DEGRADED', code: 'FUTURES_COVERAGE_PARTIAL', component: 'FUTURES_BROAD', sourceId: null,
      observedAtMs: input.futures?.snapshotTimeMs ?? input.snapshotTimeMs,
      message: 'Broad USD-M symbol coverage is smaller than the current Futures universe.',
      recommendedAction: 'Inspect universe seeding and keep missing symbols explicit.',
    });
  }

  if (focus.protectedUnfulfilled > 0) {
    add({
      severity: 'BLOCKING', impact: 'BLOCKED', code: 'PROTECTED_FOCUS_UNFULFILLED', component: 'FOCUS', sourceId: null,
      observedAtMs: input.focus?.observedAtMs ?? input.snapshotTimeMs,
      message: 'One or more protected-symbol focus requirements are unfulfilled.',
      recommendedAction: 'Preserve protected allocation and inspect source or budget constraints.',
    });
  }
  if (focus.unfulfilled > focus.protectedUnfulfilled) {
    add({
      severity: 'WARNING', impact: 'DEGRADED', code: 'FOCUSED_EVIDENCE_UNFULFILLED', component: 'FOCUS', sourceId: null,
      observedAtMs: input.focus?.observedAtMs ?? input.snapshotTimeMs,
      message: 'Some focused evidence requirements are unfulfilled.',
      recommendedAction: 'Expose the missing evidence and inspect focus capacity or source state.',
    });
  }
  if (focus.warming > 0) {
    add({
      severity: 'WARNING', impact: 'WARMING', code: 'FOCUSED_EVIDENCE_WARMING', component: 'FOCUS', sourceId: null,
      observedAtMs: input.focus?.observedAtMs ?? input.snapshotTimeMs,
      message: 'Focused evidence requirements are still warming.',
      recommendedAction: 'Wait for delivery or inspect the bounded focus plan.',
    });
  }

  if (books.sequenceGaps >= policy.sequenceGapStormThreshold || books.pendingResync > 0) {
    const protectedBookAffected = (input.books ?? []).some((entry) => (
      (bookCriticality(input, entry.symbol, 'criticality' in entry ? entry.criticality : undefined) === 'CORE'
        || bookCriticality(input, entry.symbol, 'criticality' in entry ? entry.criticality : undefined) === 'PROTECTED')
      && (entry.pendingResyncRequest !== null || entry.counters.sequenceGapCount >= policy.sequenceGapStormThreshold)
    ));
    add({
      severity: protectedBookAffected ? 'BLOCKING' : 'WARNING',
      impact: protectedBookAffected ? 'BLOCKED' : 'DEGRADED',
      code: books.pendingResync > 0 ? 'BOOK_RESYNC_REQUIRED' : 'BOOK_SEQUENCE_GAP_STORM',
      component: 'BOOKS', sourceId: null, observedAtMs: input.snapshotTimeMs,
      message: 'Focused local-book evidence has a sequence-gap storm or pending resynchronization.',
      recommendedAction: 'Treat affected books as incomplete until the owning reducer completes resynchronization.',
    });
  } else if (books.sequenceGaps > 0 || books.drops > 0 || books.degraded > 0 || books.stale > 0) {
    add({
      severity: 'WARNING', impact: 'DEGRADED', code: 'BOOK_EVIDENCE_DEGRADED', component: 'BOOKS', sourceId: null,
      observedAtMs: input.snapshotTimeMs, message: 'Focused local-book evidence has gaps, drops, stale, or degraded state.',
      recommendedAction: 'Inspect per-book completeness and resync counters.',
    });
  } else if (books.warming > 0) {
    add({
      severity: 'WARNING', impact: 'WARMING', code: 'BOOKS_WARMING', component: 'BOOKS', sourceId: null,
      observedAtMs: input.snapshotTimeMs, message: 'Focused local books are still buffering or waiting for their bridge.',
      recommendedAction: 'Wait for snapshot-plus-delta bootstrap to complete.',
    });
  }

  if (baseline.pending + baseline.fetching > 0) {
    add({
      severity: 'WARNING', impact: 'WARMING', code: 'BASELINE_WARMING', component: 'BASELINE', sourceId: null,
      observedAtMs: snapshotObservedAt(input.baseline) ?? input.snapshotTimeMs,
      message: 'Historical baseline items are pending or fetching.',
      recommendedAction: 'Allow the bounded bootstrap plan to advance within its public REST budget.',
    });
  }
  if (
    baseline.partial + baseline.stale + baseline.insufficientHistory + baseline.unavailable
    + baseline.rateLimited + baseline.retryWaiting > 0
  ) {
    add({
      severity: 'WARNING', impact: 'DEGRADED', code: 'BASELINE_INCOMPLETE', component: 'BASELINE', sourceId: null,
      observedAtMs: snapshotObservedAt(input.baseline) ?? input.snapshotTimeMs,
      message: 'Historical baseline coverage contains partial, stale, unavailable, rate-limited, or retrying items.',
      recommendedAction: 'Keep missing history explicit and inspect the resumable bootstrap plan.',
    });
  }
  if (typeof input.baseline?.integrationGap === 'string' && input.baseline.integrationGap.trim().length > 0) {
    add({
      severity: 'WARNING', impact: 'DEGRADED', code: 'BASELINE_INTEGRATION_GAP', component: 'BASELINE', sourceId: null,
      observedAtMs: snapshotObservedAt(input.baseline), message: input.baseline.integrationGap,
      recommendedAction: 'Resolve the stated integration gap in the owning lane; this adapter remains read-only.',
    });
  }

  if (input.derivatives !== undefined && input.derivatives !== null) {
    const facts = derivativesFacts(input);
    const rejectedPrivateFact = 'coverage' in input.derivatives
      && input.derivatives.facts.some((fact) => (
        fact.source.access === 'API_KEY_REQUIRED'
          || fact.kind === 'TOP_TRADER_ACCOUNT'
          || fact.kind === 'TOP_TRADER_POSITION'
      ) && (fact.availability === 'AVAILABLE' || fact.value !== null));
    if (rejectedPrivateFact) {
      add({
        severity: 'WARNING', impact: 'DEGRADED', code: 'DERIVATIVES_PRIVATE_ACCESS_REJECTED',
        component: 'DERIVATIVES', sourceId: null, observedAtMs: snapshotObservedAt(input.derivatives),
        message: 'API-key-required derivatives input was rejected from fresh public runtime evidence.',
        recommendedAction: 'Keep keyed datasets unavailable in the no-key runtime; do not substitute or promote their values.',
      });
    }
    if (facts.stale > 0 || facts.unavailable > facts.optionalUnavailable) {
      add({
        severity: 'WARNING', impact: 'DEGRADED', code: 'DERIVATIVES_CONTEXT_DEGRADED', component: 'DERIVATIVES', sourceId: null,
        observedAtMs: snapshotObservedAt(input.derivatives),
        message: 'Public derivatives context contains stale or required unavailable facts.',
        recommendedAction: 'Preserve explicit missingness and inspect TTL and public request-budget state.',
      });
    }
    for (const entry of derivativesRateBudgets(input)) {
      if (entry.budget.state !== 'AVAILABLE' && entry.budget.state !== 'UNKNOWN') {
        add({
          severity: 'WARNING', impact: 'DEGRADED', code: `REST_BUDGET_${entry.budget.state}`,
          component: 'DERIVATIVES', sourceId: entry.sourceId, observedAtMs: entry.budget.observedAtMs,
          discriminator: entry.sourceId,
          message: `${entry.sourceId} public REST budget is ${entry.budget.state.toLowerCase().replace('_', ' ')}.`,
          recommendedAction: 'Honor retry and reset timing; do not bypass the public request budget.',
        });
      }
    }
  }

  if (input.bridge !== undefined && input.bridge !== null && bridgeFailureCount(input.bridge) > 0) {
    add({
      severity: 'WARNING', impact: 'DEGRADED', code: 'BRIDGE_FAILURES_OBSERVED', component: 'BRIDGE', sourceId: null,
      observedAtMs: input.bridge.snapshotTimeMs, message: 'The evidence bridge reports rejected or failed inputs.',
      recommendedAction: 'Inspect bridge failure evidence and retain explicit missingness.',
    });
  }
  if (capture.truncated > 0 || capture.evicted > 0) {
    add({
      severity: 'WARNING', impact: 'DEGRADED', code: 'CAPTURE_TRUNCATED', component: 'CAPTURE', sourceId: null,
      observedAtMs: snapshotObservedAt(input.capture) ?? input.snapshotTimeMs,
      message: 'Trigger capture retention is truncated or evicted.',
      recommendedAction: 'Use capture completeness markers; do not infer omitted evidence.',
    });
  }
  if (capture.incomplete > 0 || capture.checkpointState === 'FAILED') {
    add({
      severity: 'WARNING', impact: 'DEGRADED', code: 'CAPTURE_INCOMPLETE', component: 'CAPTURE', sourceId: null,
      observedAtMs: snapshotObservedAt(input.capture) ?? input.snapshotTimeMs,
      message: 'Trigger capture contains incomplete horizons or a failed checkpoint.',
      recommendedAction: 'Inspect capture completeness and injected storage-port evidence.',
    });
  }
  if (capture.state === 'DEGRADED'
    && capture.truncated === 0 && capture.evicted === 0 && capture.incomplete === 0
    && capture.checkpointState !== 'FAILED') {
    add({
      severity: 'WARNING', impact: 'DEGRADED', code: 'CAPTURE_FAILURES_OBSERVED', component: 'CAPTURE', sourceId: null,
      observedAtMs: snapshotObservedAt(input.capture) ?? input.snapshotTimeMs,
      message: 'Trigger capture reports one or more coordinator failures.',
      recommendedAction: 'Inspect captured failure records and retain their explicit completeness semantics.',
    });
  }

  const deduplicated = new Map<string, RuntimeHealthReason>();
  for (const entry of reasons) deduplicated.set(entry.id, entry);
  return Object.freeze([...deduplicated.values()].sort(compareReasons));
}

function boundReasons(
  allReasons: readonly RuntimeHealthReason[],
  input: RuntimeSnapshotInput,
  policy: NormalizedPolicy,
): Readonly<{ reasons: readonly RuntimeHealthReason[]; truncated: number }> {
  const ordered = [
    ...allReasons.filter((entry) => entry.severity === 'BLOCKING').sort(compareReasons),
    ...allReasons.filter((entry) => entry.severity === 'WARNING').sort(compareReasons),
  ];
  if (ordered.length <= policy.bounds.maximumReasons) {
    return Object.freeze({ reasons: Object.freeze(ordered), truncated: 0 });
  }
  const capacityReason = reason(policy.bounds, {
    severity: 'BLOCKING', impact: 'BLOCKED', code: 'REASON_CAPACITY_EXCEEDED', component: 'SNAPSHOT', sourceId: null,
    observedAtMs: input.snapshotTimeMs,
    message: 'Runtime health reasons exceeded the configured render bound.',
    recommendedAction: 'Increase the bounded render capacity or reduce the upstream failure fan-out.',
  });
  const retainedOriginal = ordered.slice(0, Math.max(0, policy.bounds.maximumReasons - 1));
  return Object.freeze({
    reasons: Object.freeze([capacityReason, ...retainedOriginal].sort((left, right) => (
      left.severity === right.severity ? compareReasons(left, right) : left.severity === 'BLOCKING' ? -1 : 1
    ))),
    truncated: ordered.length - retainedOriginal.length,
  });
}

function topologyWasTruncated(topology: RuntimeTopologyView): boolean {
  return topology.truncatedNodes > 0 || topology.truncatedEdges > 0 || topology.truncatedBindings > 0
    || topology.foundationCatalog.truncatedNodes > 0 || topology.foundationCatalog.truncatedEdges > 0;
}

function aggregateState(
  desiredState: RuntimeAggregateDesiredState,
  reasons: readonly RuntimeHealthReason[],
): RuntimeAggregateObservedState {
  if (reasons.some((entry) => entry.severity === 'BLOCKING' || entry.impact === 'BLOCKED')) return 'BLOCKED';
  if (reasons.some((entry) => entry.impact === 'DEGRADED')) return 'DEGRADED';
  if (reasons.some((entry) => entry.impact === 'WARMING')) return 'WARMING';
  return desiredState === 'STOPPED' ? 'STOPPED' : 'HEALTHY';
}

function addErrorCandidate(
  candidates: ErrorCandidate[],
  component: RuntimeComponentKey,
  sourceId: string | null,
  failure: Pick<NonNullable<RuntimeSourceSnapshot['lastError']>, 'code' | 'message' | 'retryable'> | StableFailure | null,
  observedAtMs: number | null,
  bounds: RuntimeSnapshotBounds,
): void {
  if (failure === null) return;
  if (typeof failure.code !== 'string' || failure.code.trim().length === 0) throw new TypeError('last error code is invalid');
  if (typeof failure.message !== 'string' || failure.message.trim().length === 0) throw new TypeError('last error message is invalid');
  if (typeof failure.retryable !== 'boolean') throw new TypeError('last error retryable must be boolean');
  candidates.push({
    component,
    sourceId,
    code: copyText(failure.code, bounds.maximumStringLength),
    message: copyText(failure.message, bounds.maximumStringLength),
    retryable: failure.retryable,
    observedAtMs,
    identity: stableId('runtime-error', {
      component,
      sourceId,
      code: copyText(failure.code, bounds.maximumStringLength),
      message: copyText(failure.message, bounds.maximumStringLength),
      observedAtMs,
    }),
  });
}

function lastError(
  input: RuntimeSnapshotInput,
  sources: readonly RuntimeSourceView[],
  bounds: RuntimeSnapshotBounds,
): RuntimeLastErrorView | null {
  const candidates: ErrorCandidate[] = [];
  for (const source of sources) {
    addErrorCandidate(candidates, source.component, source.sourceId, source.lastError, source.lastError?.observedAtMs ?? null, bounds);
  }
  addErrorCandidate(candidates, 'BASELINE', null, projectionFailure(input.baseline), snapshotObservedAt(input.baseline), bounds);
  addErrorCandidate(candidates, 'DERIVATIVES', null, projectionFailure(input.derivatives), snapshotObservedAt(input.derivatives), bounds);
  addErrorCandidate(candidates, 'BRIDGE', null, projectionFailure(input.bridge), input.bridge?.snapshotTimeMs ?? null, bounds);
  addErrorCandidate(candidates, 'CAPTURE', null, projectionFailure(input.capture), snapshotObservedAt(input.capture), bounds);
  if (input.derivatives !== undefined && input.derivatives !== null && Array.isArray(input.derivatives.facts)) {
    for (const fact of input.derivatives.facts) {
      if (fact.lastError === null) continue;
      addErrorCandidate(
        candidates,
        'DERIVATIVES',
        fact.source.sourceId,
        fact.lastError,
        fact.lastError.observedAtMs,
        bounds,
      );
    }
  }
  if (input.bridge !== undefined && input.bridge !== null && 'failures' in input.bridge) {
    for (const entry of input.bridge.failures) {
      addErrorCandidate(candidates, 'BRIDGE', null, entry.failure, entry.lastObservedAtMs, bounds);
    }
  }
  if (input.capture !== undefined && input.capture !== null && 'failures' in input.capture) {
    for (const entry of input.capture.failures) {
      addErrorCandidate(candidates, 'CAPTURE', null, entry.failure, entry.lastObservedAtMs, bounds);
    }
  }
  candidates.sort((left, right) => (right.observedAtMs ?? -1) - (left.observedAtMs ?? -1)
    || compareCodePoints(left.identity, right.identity));
  const selected = candidates[0];
  if (selected === undefined) return null;
  return Object.freeze({
    component: selected.component,
    sourceId: selected.sourceId,
    code: selected.code,
    message: selected.message,
    retryable: selected.retryable,
    observedAtMs: selected.observedAtMs,
  });
}

function latestSuccess(input: RuntimeSnapshotInput, sources: readonly RuntimeSourceView[]): number | null {
  const times: Array<number | null> = sources.map((source) => (
    source.observedState === 'LIVE' && source.authority !== 'UNAVAILABLE' && source.completeness !== 'MISSING'
      ? source.lastSuccessTimeMs
      : null
  ));
  times.push(
    universeLastSuccess(input),
    spotLastSuccess(input),
    futuresLastSuccess(input),
    baselineLastSuccess(input.baseline),
    derivativesFacts(input).lastSuccessTimeMs,
    bridgeLastSuccess(input.bridge),
    captureLastSuccess(input.capture),
  );
  return times.reduce<number | null>((latest, value) => maximumNullable(latest, value), null);
}

function metric(name: string, value: number | string | boolean | null, unit: string): Readonly<{ name: string; value: number | string | boolean | null; unit: string }> {
  return Object.freeze({ name, value, unit });
}

function componentMetrics(
  key: RuntimeComponentKey,
  view: {
    universe: RuntimeUniverseCoverageSummary;
    spot: RuntimeMarketCoverageSummary;
    futures: RuntimeMarketCoverageSummary;
    focus: RuntimeFocusCoverageSummary;
    baseline: RuntimeBaselineSummary;
    books: RuntimeBookSummary;
    derivatives: RuntimeIntelligenceSnapshot['derivatives'];
    capture: RuntimeCaptureSummary;
    operations: RuntimeOperationsSummary;
    bridge: RuntimeSnapshotInput['bridge'];
    blockerCount: number;
    warningCount: number;
  },
): RuntimeComponentView['metrics'] {
  const values: Record<RuntimeComponentKey, RuntimeComponentView['metrics']> = {
    UNIVERSE: [metric('visible_symbols', view.universe.visible, 'symbols'), metric('paired_symbols', view.universe.paired, 'symbols')],
    SPOT_BROAD: [metric('retained_symbols', view.spot.retainedSymbols, 'symbols'), metric('fresh_ticker_symbols', view.spot.freshTicker, 'symbols')],
    FUTURES_BROAD: [metric('retained_symbols', view.futures.retainedSymbols, 'symbols'), metric('fresh_mark_symbols', view.futures.freshMark, 'symbols')],
    LIFECYCLE: [metric('sources', view.operations.sources, 'sources'), metric('queue_depth', view.operations.queueDepth, 'records'), metric('sequence_gaps', view.operations.sourceSequenceGaps, 'gaps')],
    FOCUS: [metric('focused_symbols', view.focus.focusedSymbols, 'symbols'), metric('requested_evidence', view.focus.requestedEvidence, 'requirements'), metric('delivered_evidence', view.focus.deliveredEvidence, 'requirements')],
    BOOKS: [metric('books', view.books.total, 'books'), metric('live_books', view.books.live, 'books'), metric('sequence_gaps', view.books.sequenceGaps, 'gaps')],
    BASELINE: [metric('items', view.baseline.total, 'items'), metric('complete_items', view.baseline.complete, 'items'), metric('completion_ratio', view.baseline.completionRatio, 'ratio')],
    DERIVATIVES: [metric('facts', view.derivatives.total, 'facts'), metric('fresh_facts', view.derivatives.fresh, 'facts')],
    BRIDGE: [metric('universe_nodes', view.bridge?.universeNodeCount ?? 0, 'symbols'), metric('evidence_index_size', view.bridge?.evidenceIndex.size ?? 0, 'records')],
    CAPTURE: [metric('active_captures', view.capture.active, 'captures'), metric('complete_captures', view.capture.complete, 'captures'), metric('truncated_captures', view.capture.truncated, 'captures')],
    SNAPSHOT: [metric('blocking_reasons', view.blockerCount, 'reasons'), metric('warning_reasons', view.warningCount, 'reasons')],
  };
  return Object.freeze([...values[key]].sort((left, right) => compareCodePoints(left.name, right.name)));
}

function componentDesiredState(input: RuntimeSnapshotInput, key: RuntimeComponentKey, required: ReadonlySet<RuntimeComponentKey>): RuntimeAggregateDesiredState {
  if (key === 'SNAPSHOT') return 'RUNNING';
  if (required.has(key)) return 'RUNNING';
  const sources = input.sources.filter((entry) => entry.component === key);
  if (sources.length > 0) return sources.some((entry) => entry.source.desiredState === 'RUNNING') ? 'RUNNING' : 'STOPPED';
  if (key === 'SPOT_BROAD') return input.spot !== null && input.spot.observedState !== 'STOPPED' ? 'RUNNING' : 'STOPPED';
  if (key === 'FUTURES_BROAD') return input.futures?.sources.some((source) => source.desiredState === 'RUNNING') ? 'RUNNING' : 'STOPPED';
  if (key === 'BOOKS') return input.books?.some((book) => book.observedState !== 'STOPPED') ? 'RUNNING' : 'STOPPED';
  if (key === 'FOCUS') return (input.focus?.counts.pendingControlMessages ?? 0) > 0
    || (input.focus?.requirements.some((entry) => entry.state !== 'READY' && entry.state !== 'REUSED_BROAD') ?? false)
    ? 'RUNNING' : 'STOPPED';
  if (key === 'BASELINE') return input.baseline !== undefined && input.baseline !== null
    && (('activeFetchCount' in input.baseline && input.baseline.activeFetchCount > 0)
      || (input.baseline.stateCounts.PENDING ?? 0) > 0 || (input.baseline.stateCounts.FETCHING ?? 0) > 0)
    ? 'RUNNING' : 'STOPPED';
  if (key === 'CAPTURE') return input.capture !== undefined && input.capture !== null
    && (('activeCaptureCount' in input.capture ? input.capture.activeCaptureCount : input.capture.activeCaptures) > 0)
    ? 'RUNNING' : 'STOPPED';
  return 'STOPPED';
}

function aggregateDesiredState(
  input: RuntimeSnapshotInput,
  sources: readonly RuntimeSourceView[],
  policy: NormalizedPolicy,
): RuntimeAggregateDesiredState {
  if (policy.requiredComponents.length > 0) return 'RUNNING';
  if (sources.some((source) => source.desiredState === 'RUNNING')) return 'RUNNING';
  const noRequired = new Set<RuntimeComponentKey>();
  return RUNTIME_COMPONENT_KEYS.some((key) => key !== 'SNAPSHOT'
    && componentDesiredState(input, key, noRequired) === 'RUNNING')
    ? 'RUNNING'
    : 'STOPPED';
}

function componentLastSuccess(input: RuntimeSnapshotInput, sources: readonly RuntimeSourceView[], key: RuntimeComponentKey): number | null {
  const sourceTime = sources
    .filter((source) => source.component === key && source.observedState === 'LIVE'
      && source.authority !== 'UNAVAILABLE' && source.completeness !== 'MISSING')
    .reduce<number | null>((latest, source) => maximumNullable(latest, source.lastSuccessTimeMs), null);
  if (sourceTime !== null) return sourceTime;
  if (key === 'UNIVERSE') return universeLastSuccess(input);
  if (key === 'SPOT_BROAD') return spotLastSuccess(input);
  if (key === 'FUTURES_BROAD') return futuresLastSuccess(input);
  if (key === 'FOCUS') return null;
  if (key === 'BASELINE') return baselineLastSuccess(input.baseline);
  if (key === 'DERIVATIVES') return derivativesFacts(input).lastSuccessTimeMs;
  if (key === 'BRIDGE') return bridgeLastSuccess(input.bridge);
  if (key === 'CAPTURE') return captureLastSuccess(input.capture);
  if (key === 'SNAPSHOT') return input.snapshotTimeMs;
  return null;
}

function components(
  input: RuntimeSnapshotInput,
  sources: readonly RuntimeSourceView[],
  reasons: readonly RuntimeHealthReason[],
  summary: Parameters<typeof componentMetrics>[1],
  policy: NormalizedPolicy,
): readonly RuntimeComponentView[] {
  const required = new Set(policy.requiredComponents);
  const result: RuntimeComponentView[] = [];
  for (const key of RUNTIME_COMPONENT_KEYS) {
    const blockers = reasons.filter((entry) => entry.component === key && entry.severity === 'BLOCKING');
    const warnings = reasons.filter((entry) => entry.component === key && entry.severity === 'WARNING');
    const desiredState = componentDesiredState(input, key, required);
    const observedState = aggregateState(desiredState, [...blockers, ...warnings]);
    const sourceErrors = sources
      .filter((source) => source.component === key && source.lastError !== null)
      .sort((left, right) => (right.lastError?.observedAtMs ?? -1) - (left.lastError?.observedAtMs ?? -1)
        || compareCodePoints(left.sourceId, right.sourceId));
    let lastErrorCode = sourceErrors[0]?.lastError?.code ?? null;
    if (lastErrorCode === null && key === 'BASELINE') lastErrorCode = projectionFailure(input.baseline)?.code ?? null;
    if (lastErrorCode === null && key === 'DERIVATIVES') lastErrorCode = projectionFailure(input.derivatives)?.code ?? null;
    if (lastErrorCode === null && key === 'BRIDGE') lastErrorCode = projectionFailure(input.bridge)?.code ?? null;
    if (lastErrorCode === null && key === 'CAPTURE') lastErrorCode = projectionFailure(input.capture)?.code ?? null;
    result.push(Object.freeze({
      id: runtimeComponentId(key),
      key,
      name: COMPONENT_NAMES[key],
      desiredState,
      observedState,
      criticality: required.has(key) ? 'CORE' : COMPONENT_CRITICALITY[key],
      lastSuccessTimeMs: componentLastSuccess(input, sources, key),
      lastErrorCode,
      blockerIds: Object.freeze(blockers.map((entry) => entry.id).sort(compareCodePoints)),
      warningIds: Object.freeze(warnings.map((entry) => entry.id).sort(compareCodePoints)),
      metrics: componentMetrics(key, summary),
    }));
  }
  return Object.freeze(result.sort((left, right) => compareCodePoints(left.id, right.id)));
}

/**
 * Projects already-captured runtime facts into one bounded render model.
 * This function deliberately accepts data snapshots only: it cannot start,
 * stop, poll, retry, resync, capture, or otherwise mutate an owning component.
 */
export function buildRuntimeIntelligenceSnapshot(input: RuntimeSnapshotInput): RuntimeIntelligenceSnapshot {
  if (!object(input)) throw new TypeError('runtime snapshot input must be an object');
  const policy = normalizePolicy(input);
  validateInput(input, policy);

  const operationalSources = [...input.sources].sort((left, right) => (
    compareCodePoints(left.source.sourceId, right.source.sourceId)
    || compareCodePoints(left.component, right.component)
    || compareCodePoints(left.capability, right.capability)
  ));
  const identities = new Set<string>();
  for (const source of operationalSources) {
    if (identities.has(source.source.sourceId)) throw new TypeError(`duplicate runtime sourceId: ${source.source.sourceId}`);
    identities.add(source.source.sourceId);
  }
  const requiredComponents = new Set(policy.requiredComponents);
  const allSources = Object.freeze(operationalSources.map((source) => (
    sourceView(source, input.snapshotTimeMs, policy.bounds, requiredComponents)
  )));
  const retainedSources = Object.freeze(allSources.slice(0, policy.bounds.maximumSources));

  const universe = universeSummary(input);
  const spot = spotSummary(input, universe);
  const futures = futuresSummary(input, universe);
  const focus = focusSummary(input);
  const baseline = baselineSummary(input);
  const books = bookSummary(input);
  const derivatives = derivativesFacts(input);
  const capture = captureSummary(input);
  const operations = operationsSummary(input, operationalSources, allSources, books);

  const allReasons = aggregateReasons(
    input, policy, operationalSources, allSources, universe, spot, futures, focus, baseline, books, capture,
  );
  const desiredState = aggregateDesiredState(input, allSources, policy);
  let boundedReasons = boundReasons(allReasons, input, policy);
  let blockers = Object.freeze(boundedReasons.reasons.filter((entry) => entry.severity === 'BLOCKING').sort(compareReasons));
  let warnings = Object.freeze(boundedReasons.reasons.filter((entry) => entry.severity === 'WARNING').sort(compareReasons));
  let observedState = aggregateState(desiredState, boundedReasons.reasons);
  let componentSummary = {
    universe, spot, futures, focus, baseline, books, derivatives, capture, operations,
    bridge: input.bridge,
    blockerCount: blockers.length,
    warningCount: warnings.length,
  };
  let componentViews = components(input, allSources, boundedReasons.reasons, componentSummary, policy);
  let topology = buildRuntimeTopology({
    components: componentViews,
    sources: retainedSources,
    blockers,
    warnings,
    foundationTopology: input.foundationTopology ?? null,
    bounds: policy.bounds,
  });
  if (topologyWasTruncated(topology)) {
    const topologyReason = reason(policy.bounds, {
      severity: 'WARNING', impact: 'DEGRADED', code: 'TOPOLOGY_TRUNCATED', component: 'SNAPSHOT', sourceId: null,
      observedAtMs: input.snapshotTimeMs,
      message: 'Runtime or Foundation topology exceeded a configured render bound; all retained references remain closed.',
      recommendedAction: 'Inspect topology truncation counters before relying on the rendered graph as complete.',
    });
    boundedReasons = boundReasons(Object.freeze([...allReasons, topologyReason]), input, policy);
    blockers = Object.freeze(boundedReasons.reasons.filter((entry) => entry.severity === 'BLOCKING').sort(compareReasons));
    warnings = Object.freeze(boundedReasons.reasons.filter((entry) => entry.severity === 'WARNING').sort(compareReasons));
    observedState = aggregateState(desiredState, boundedReasons.reasons);
    componentSummary = {
      universe, spot, futures, focus, baseline, books, derivatives, capture, operations,
      bridge: input.bridge,
      blockerCount: blockers.length,
      warningCount: warnings.length,
    };
    componentViews = components(input, allSources, boundedReasons.reasons, componentSummary, policy);
    topology = buildRuntimeTopology({
      components: componentViews,
      sources: retainedSources,
      blockers,
      warnings,
      foundationTopology: input.foundationTopology ?? null,
      bounds: policy.bounds,
    });
  }
  const currentLastError = lastError(input, allSources, policy.bounds);
  const lastSuccessTimeMs = latestSuccess(input, allSources);
  const snapshotIdentity = {
    schemaVersion: '1',
    configurationVersion: input.configurationVersion,
    snapshotTimeMs: input.snapshotTimeMs,
    desiredState,
    observedState,
    blockers,
    warnings,
    truncatedReasons: boundedReasons.truncated,
    sources: retainedSources,
    truncatedSources: allSources.length - retainedSources.length,
    universe,
    spot,
    futures,
    focus,
    baseline,
    books,
    derivatives,
    capture,
    operations,
    topology,
  };

  return Object.freeze({
    id: stableId('runtime-intelligence-snapshot', snapshotIdentity),
    schemaVersion: '1' as const,
    configurationVersion: input.configurationVersion,
    snapshotTimeMs: input.snapshotTimeMs,
    authority: 'READ_ONLY_DERIVED' as const,
    mutationAuthority: 'NONE' as const,
    desiredState,
    observedState,
    lastSuccessTimeMs,
    lastError: currentLastError,
    blockers,
    warnings,
    blockerCount: blockers.length,
    warningCount: warnings.length,
    truncatedReasons: boundedReasons.truncated,
    sources: retainedSources,
    truncatedSources: allSources.length - retainedSources.length,
    universe,
    spot,
    futures,
    focus,
    baseline,
    books,
    derivatives,
    capture,
    operations,
    components: componentViews,
    topology,
  });
}

export const createRuntimeIntelligenceSnapshot = buildRuntimeIntelligenceSnapshot;
export const buildRuntimeSnapshot = buildRuntimeIntelligenceSnapshot;

export function serializeRuntimeIntelligenceSnapshot(snapshot: RuntimeIntelligenceSnapshot): string {
  return canonicalJson(snapshot);
}
