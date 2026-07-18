import { types as utilTypes } from 'node:util';
/**
 * Side-effect-free structural probes for production-owned component caches.
 * Ports expose reads only; no lifecycle, refresh, socket, or mutation method
 * is reachable from this module.
 */
import {
  createSourcedTimestamp,
  createStructuredFailure,
  evaluateFreshness,
  isDataAuthority,
  isValidUtcMillis,
  weakestAuthority,
  type Completeness,
  type DataAuthority,
  type DesiredRuntimeState,
  type FreshnessReport,
  type RuntimePhase,
  type SourcedTimestamp,
  type StructuredFailure,
} from '../../foundation/contracts/index.js';
import type {
  RuntimeSourceSnapshot,
} from '../../intelligenceRuntime/contracts/index.js';
import {
  projectRuntimeLifecycleEvidence,
  translateRuntimeCoverage,
  translateRuntimeErrorToStructuredFailure,
} from '../contracts/dialects.js';
import type {
  DialectLoss,
  DialectTranslation,
  SafeModeContext,
  StructuredFailureProjection,
  SystemComponentSnapshot,
  SystemQueueSnapshot,
} from '../contracts/types.js';
import type {
  SystemComponentId,
  SystemControlCommand,
  SystemOwnerKind,
  SystemReadinessState,
  SystemReleaseStatus,
  SystemTruthLabel,
} from '../contracts/constants.js';
import { validateSystemComponentSnapshot } from '../contracts/validation.js';

const MAX_CAPTURE_DEPTH = 24;
const MAX_CAPTURE_FIELDS = 20_000;

/** Capture hostile owner data exactly once before any semantic projection. */
function captureOwnerData<T>(value: T, name: string): Readonly<T> {
  const copies = new Map<object, object>();
  const visiting = new Set<object>();
  let fields = 0;
  const capture = (candidate: unknown, depth: number): unknown => {
    if (depth > MAX_CAPTURE_DEPTH) throw new RangeError(`${name} exceeds the capture depth`);
    if (candidate === null || candidate === undefined
        || typeof candidate === 'string' || typeof candidate === 'number'
        || typeof candidate === 'boolean') return candidate;
    if (typeof candidate !== 'object' || utilTypes.isProxy(candidate)) {
      throw new TypeError(`${name} must contain non-Proxy plain data only`);
    }
    if (visiting.has(candidate)) throw new TypeError(`${name} must not contain cycles`);
    const prior = copies.get(candidate);
    if (prior !== undefined) return prior;
    const prototype = Object.getPrototypeOf(candidate);
    const array = Array.isArray(candidate);
    if ((array && prototype !== Array.prototype)
        || (!array && prototype !== Object.prototype && prototype !== null)
        || Object.getOwnPropertySymbols(candidate).length > 0) {
      throw new TypeError(`${name} must contain ordinary string-keyed data only`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    const keys = Object.keys(descriptors).filter((key) => !array || key !== 'length');
    fields += keys.length;
    if (fields > MAX_CAPTURE_FIELDS) throw new RangeError(`${name} exceeds the capture field bound`);
    if (array && (keys.length !== candidate.length
        || keys.some((key, index) => key !== String(index)))) {
      throw new TypeError(`${name} arrays must be dense and contain no extra fields`);
    }
    const copy: Record<string, unknown> | unknown[] = array
      ? []
      : Object.create(prototype) as Record<string, unknown>;
    copies.set(candidate, copy);
    visiting.add(candidate);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
        throw new TypeError(`${name} forbids accessors and hidden fields`);
      }
      (copy as Record<string, unknown>)[key] = capture(descriptor.value, depth + 1);
    }
    visiting.delete(candidate);
    return Object.freeze(copy);
  };
  return capture(value, 0) as Readonly<T>;
}

const COMPONENT = 'systemIntegration.adapters.probes';
const MAX_OBSERVATION_ROWS = 16_384;
const MAX_TEXT = 256;

export interface SourceQueueProbeReading {
  readonly depth: number;
  readonly capacity: number;
  readonly dropped: number;
  readonly coalesced: number;
  readonly observedAtMs: number;
  readonly resyncRequired: boolean;
}

export interface RetainedSymbolProbeReading {
  readonly symbol: string;
  readonly lastActivityAtMs: number | null;
}

export interface FocusProbeReading {
  readonly capacity: number;
  readonly requestedSymbols: readonly string[];
  readonly readySymbols: readonly string[];
  readonly promotionCorrelationIds: readonly string[];
}

export interface FocusedBookProbeReading {
  readonly sourceId: string;
  readonly symbol: string;
  readonly sequenceComplete: boolean;
  readonly pendingResyncRequestId: string | null;
  readonly reasonCode: string | null;
}

export interface RejectedSignalProbeReading {
  readonly correlationId: string;
  readonly symbol: string;
  readonly code: string;
}

/** Exact read facts from existing Runtime/MI snapshots; no scores are recomputed. */
export interface SourceObservationProbeReading {
  readonly quietSymbolsRetained: boolean | null;
  readonly retainedSymbols: readonly Readonly<RetainedSymbolProbeReading>[];
  readonly focus: Readonly<FocusProbeReading> | null;
  readonly focusedBooks: readonly Readonly<FocusedBookProbeReading>[];
  readonly rejectedSignals: readonly Readonly<RejectedSignalProbeReading>[];
  readonly proposalIds: readonly string[];
}

export interface RuntimeSourceProbeReading {
  readonly source: Readonly<RuntimeSourceSnapshot>;
  readonly queue: Readonly<SourceQueueProbeReading> | null;
  readonly observation: Readonly<SourceObservationProbeReading> | null;
}

export interface RuntimeSourceProbePort {
  readonly readRuntimeSourceProbe: () => Readonly<RuntimeSourceProbeReading> | null;
}

export interface RuntimeSourceProbeDescriptor extends SafeModeContext {
  readonly componentId: Extract<SystemComponentId, 'public-spot-source' | 'public-usdm-source'>;
  readonly expectedSourceId: string;
  readonly owner: Extract<SystemOwnerKind, 'AUDITED_APP' | 'INTELLIGENCE_RUNTIME'>;
  readonly ownerPath: string;
  readonly acquisitionAuthority: Exclude<DataAuthority, 'LIVE_PRIVATE'>;
  readonly maxAgeMs: number;
  readonly dependencies: readonly SystemComponentId[];
  readonly releaseStatuses: readonly SystemReleaseStatus[];
  readonly supportedControls: readonly SystemControlCommand[];
  readonly port: RuntimeSourceProbePort;
}

export interface RuntimeSourceProbeProjection {
  readonly component: Readonly<SystemComponentSnapshot>;
  readonly observation: Readonly<SourceObservationProbeReading> | null;
  readonly resyncRequired: boolean;
  readonly lastFailureOrigin: Readonly<StructuredFailureProjection> | null;
}

export interface StructuralComponentProbeReading {
  readonly desiredState: DesiredRuntimeState;
  readonly phase: RuntimePhase;
  readonly domainObservedState: string | null;
  readonly readiness: SystemReadinessState;
  readonly authority: DataAuthority;
  readonly completeness: Completeness;
  readonly sourceTimestamp: Readonly<SourcedTimestamp> | null;
  readonly lastReceiveAtMs: number | null;
  readonly lastProcessAtMs: number | null;
  readonly lastSuccessAtMs: number | null;
  readonly processingLagMs?: number | null;
  readonly retry?: NonNullable<SystemComponentSnapshot['retry']>;
  readonly dataQuality?: NonNullable<SystemComponentSnapshot['dataQuality']>;
  readonly checkpoint?: NonNullable<SystemComponentSnapshot['checkpoint']>;
  readonly queue: Readonly<SystemQueueSnapshot> | null;
  readonly lastFailure: Readonly<StructuredFailure> | null;
  readonly blockerCodes: readonly string[];
  readonly generation: number;
  readonly restartCount: number;
  readonly capitalExposed: boolean;
  readonly operatorAttentionRequired: boolean;
  readonly truthLabel: SystemTruthLabel;
}

export interface StructuralComponentProbePort {
  readonly readComponentProbe: () => Readonly<StructuralComponentProbeReading> | null;
}

export interface StructuralComponentProbeDescriptor extends SafeModeContext {
  readonly componentId: SystemComponentId;
  readonly owner: SystemOwnerKind;
  readonly ownerPath: string;
  readonly dependencies: readonly SystemComponentId[];
  readonly releaseStatuses: readonly SystemReleaseStatus[];
  readonly supportedControls: readonly SystemControlCommand[];
  readonly port: StructuralComponentProbePort;
}

function boundedText(value: unknown, name: string, maximum = MAX_TEXT): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum
      || value.trim() !== value || /[\r\n\0]/.test(value)) {
    throw new TypeError(`${name} must be a bounded non-empty string`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  return value as number;
}

function freezeLosses(values: readonly Readonly<DialectLoss>[]): readonly Readonly<DialectLoss>[] {
  return Object.freeze([...values]);
}

function reject<T>(
  input: SafeModeContext,
  code: string,
  message: string,
  found: readonly Readonly<DialectLoss>[] = [],
): DialectTranslation<T> {
  return Object.freeze({
    ok: false,
    failure: createStructuredFailure({
      component: COMPONENT,
      stage: 'probe',
      code,
      message,
      occurredAt: input.nowMs,
      retryable: false,
      safeCurrentState: input.safeCurrentState,
      recommendedOperatorAction: 'Inspect the existing owner snapshot; probes never refresh or repair source state.',
      correlationId: input.correlationId,
    }),
    losses: freezeLosses(found),
  });
}

function phaseForSource(
  lifecycle: RuntimeSourceSnapshot['observedState'],
  readiness: SystemReadinessState,
): RuntimePhase {
  if (lifecycle === 'STOPPED') return 'STOPPED';
  if (lifecycle === 'CONNECTING' || lifecycle === 'WARMING') return 'STARTING';
  if (lifecycle === 'FAILED') return 'FAILED';
  if (readiness === 'BLOCKED') return 'BLOCKED';
  if (readiness === 'DEGRADED') return 'DEGRADED';
  return 'RUNNING';
}

function truthLabel(authority: DataAuthority, readiness: SystemReadinessState): SystemTruthLabel {
  if (readiness !== 'READY') return 'UNAVAILABLE';
  if (authority === 'LIVE_PUBLIC' || authority === 'DERIVED_LIVE') return 'LIVE_PUBLIC';
  if (authority === 'RECORDED_REPLAY') return 'RECORDED_REPLAY';
  if (authority === 'SYNTHETIC_TEST') return 'SYNTHETIC_ONLY';
  return 'UNAVAILABLE';
}

function dynamicReleaseStatuses(
  input: readonly SystemReleaseStatus[],
  label: SystemTruthLabel,
): readonly SystemReleaseStatus[] {
  const statuses: SystemReleaseStatus[] = input.filter((entry) => entry !== 'LIVE_PUBLIC');
  if (label === 'LIVE_PUBLIC') statuses.push('LIVE_PUBLIC');
  return Object.freeze([...new Set(statuses)]);
}

function cloneStringList(values: readonly string[], name: string): readonly string[] {
  if (!Array.isArray(values) || values.length > MAX_OBSERVATION_ROWS) throw new RangeError(`${name} exceeds its bound`);
  const cloned = values.map((value, index) => boundedText(value, `${name}[${index}]`));
  if (new Set(cloned).size !== cloned.length) throw new TypeError(`${name} must not contain duplicates`);
  return Object.freeze(cloned);
}

function cloneObservation(
  value: Readonly<SourceObservationProbeReading> | null,
): Readonly<SourceObservationProbeReading> | null {
  if (value === null) return null;
  if (typeof value.quietSymbolsRetained !== 'boolean' && value.quietSymbolsRetained !== null) {
    throw new TypeError('quietSymbolsRetained must be boolean or null');
  }
  if (!Array.isArray(value.retainedSymbols) || value.retainedSymbols.length > MAX_OBSERVATION_ROWS
      || !Array.isArray(value.focusedBooks) || value.focusedBooks.length > MAX_OBSERVATION_ROWS
      || !Array.isArray(value.rejectedSignals) || value.rejectedSignals.length > MAX_OBSERVATION_ROWS) {
    throw new RangeError('observation rows exceed their hard bound');
  }
  const retainedSymbols = value.retainedSymbols.map((entry, index) => Object.freeze({
    symbol: boundedText(entry.symbol, `retainedSymbols[${index}].symbol`),
    lastActivityAtMs: entry.lastActivityAtMs === null
      ? null
      : nonNegativeInteger(entry.lastActivityAtMs, `retainedSymbols[${index}].lastActivityAtMs`),
  }));
  const focusedBooks = value.focusedBooks.map((entry, index) => Object.freeze({
    sourceId: boundedText(entry.sourceId, `focusedBooks[${index}].sourceId`),
    symbol: boundedText(entry.symbol, `focusedBooks[${index}].symbol`),
    sequenceComplete: (() => {
      if (typeof entry.sequenceComplete !== 'boolean') {
        throw new TypeError(`focusedBooks[${index}].sequenceComplete must be boolean`);
      }
      return entry.sequenceComplete;
    })(),
    pendingResyncRequestId: entry.pendingResyncRequestId === null
      ? null
      : boundedText(entry.pendingResyncRequestId, `focusedBooks[${index}].pendingResyncRequestId`),
    reasonCode: entry.reasonCode === null
      ? null
      : boundedText(entry.reasonCode, `focusedBooks[${index}].reasonCode`),
  }));
  const rejectedSignals = value.rejectedSignals.map((entry, index) => Object.freeze({
    correlationId: boundedText(entry.correlationId, `rejectedSignals[${index}].correlationId`, 128),
    symbol: boundedText(entry.symbol, `rejectedSignals[${index}].symbol`),
    code: boundedText(entry.code, `rejectedSignals[${index}].code`, 100),
  }));
  let focus: Readonly<FocusProbeReading> | null = null;
  if (value.focus !== null) {
    const capacity = nonNegativeInteger(value.focus.capacity, 'focus.capacity');
    const requestedSymbols = cloneStringList(value.focus.requestedSymbols, 'focus.requestedSymbols');
    const readySymbols = cloneStringList(value.focus.readySymbols, 'focus.readySymbols');
    const promotionCorrelationIds = cloneStringList(value.focus.promotionCorrelationIds, 'focus.promotionCorrelationIds');
    focus = Object.freeze({ capacity, requestedSymbols, readySymbols, promotionCorrelationIds });
  }
  return Object.freeze({
    quietSymbolsRetained: value.quietSymbolsRetained,
    retainedSymbols: Object.freeze(retainedSymbols),
    focus,
    focusedBooks: Object.freeze(focusedBooks),
    rejectedSignals: Object.freeze(rejectedSignals),
    proposalIds: cloneStringList(value.proposalIds, 'proposalIds'),
  });
}

function sourceCompleteness(snapshot: RuntimeSourceSnapshot): Completeness {
  const coverage = translateRuntimeCoverage(snapshot.authority).foundationCompleteness;
  if (coverage === 'UNAVAILABLE') return coverage;
  if (snapshot.completeness === 'PARTIAL') return 'PARTIAL';
  if (snapshot.completeness === 'MISSING' || snapshot.completeness === 'UNKNOWN') return 'UNAVAILABLE';
  return coverage;
}

function sourceTimestamp(
  snapshot: RuntimeSourceSnapshot,
  input: RuntimeSourceProbeDescriptor,
  completeness: Completeness,
): { timestamp: Readonly<SourcedTimestamp> | null; freshness: Readonly<FreshnessReport> | null } {
  if (snapshot.lastMessageReceiveTimeMs === null) return { timestamp: null, freshness: null };
  const timestamp = createSourcedTimestamp({
    sourceTimeMs: snapshot.lastMessageSourceTimeMs,
    receivedAtMs: snapshot.lastMessageReceiveTimeMs,
    maxAgeMs: input.maxAgeMs,
    authority: completeness === 'UNAVAILABLE' ? 'UNAVAILABLE' : input.acquisitionAuthority,
    completeness,
    sourceId: snapshot.sourceId,
  });
  return { timestamp, freshness: evaluateFreshness(timestamp, input.nowMs) };
}

function sourceQueue(value: Readonly<SourceQueueProbeReading> | null): Readonly<SystemQueueSnapshot> | null {
  if (value === null) return null;
  const capacity = nonNegativeInteger(value.capacity, 'queue.capacity');
  const depth = nonNegativeInteger(value.depth, 'queue.depth');
  if (depth > capacity) throw new RangeError('queue.depth exceeds queue.capacity');
  if (!isValidUtcMillis(value.observedAtMs)) throw new TypeError('queue.observedAtMs must be Foundation UTC ms');
  return Object.freeze({
    depth,
    capacity,
    dropped: nonNegativeInteger(value.dropped, 'queue.dropped'),
    coalesced: nonNegativeInteger(value.coalesced, 'queue.coalesced'),
    observedAtMs: value.observedAtMs,
  });
}

function sourceRetry(snapshot: Readonly<RuntimeSourceSnapshot>): NonNullable<SystemComponentSnapshot['retry']> {
  const state = snapshot.backoff.cooldownUntilMs !== null
    ? 'COOLDOWN'
    : snapshot.observedState === 'BACKING_OFF'
      ? 'BACKING_OFF'
      : snapshot.backoff.attempt > 0 && snapshot.backoff.retryAtMs !== null
        ? 'RETRYING'
        : 'IDLE';
  return Object.freeze({ state, ...snapshot.backoff });
}

function sourceDataQuality(snapshot: Readonly<RuntimeSourceSnapshot>): NonNullable<SystemComponentSnapshot['dataQuality']> {
  const degraded = snapshot.completeness !== 'COMPLETE'
    || snapshot.invalidCount > 0
    || snapshot.duplicateCount > 0
    || snapshot.outOfOrderCount > 0
    || snapshot.sequenceGapCount > 0;
  return Object.freeze({
    state: degraded ? 'DEGRADED' : 'GOOD',
    invalidCount: snapshot.invalidCount,
    duplicateCount: snapshot.duplicateCount,
    outOfOrderCount: snapshot.outOfOrderCount,
    sequenceGapCount: snapshot.sequenceGapCount,
    observedAtMs: snapshot.snapshotTimeMs,
  });
}

const UNAVAILABLE_RETRY = Object.freeze({
  state: 'UNAVAILABLE' as const,
  attempt: null,
  ceiling: null,
  delayMs: null,
  retryAtMs: null,
  cooldownUntilMs: null,
});

const UNAVAILABLE_DATA_QUALITY = Object.freeze({
  state: 'UNAVAILABLE' as const,
  invalidCount: null,
  duplicateCount: null,
  outOfOrderCount: null,
  sequenceGapCount: null,
  observedAtMs: null,
});

const UNAVAILABLE_CHECKPOINT = Object.freeze({
  state: 'UNAVAILABLE' as const,
  revision: null,
  persistedAtMs: null,
});

export function probeRuntimeSource(
  input: RuntimeSourceProbeDescriptor,
): DialectTranslation<Readonly<RuntimeSourceProbeProjection>> {
  if (!isDataAuthority(input.acquisitionAuthority)
      || (input.acquisitionAuthority as DataAuthority) === 'LIVE_PRIVATE') {
    return reject(input, 'PRIVATE_SOURCE_AUTHORITY_FORBIDDEN', 'Public source probes cannot claim private authority.');
  }
  let reading: Readonly<RuntimeSourceProbeReading> | null;
  try {
    const ownerReading = input.port.readRuntimeSourceProbe();
    reading = ownerReading === null ? null : captureOwnerData(ownerReading, 'runtime source probe');
  } catch {
    return reject(input, 'SOURCE_PROBE_READ_FAILED', 'Source probe read failed; owner detail remains at the source boundary.');
  }

  if (reading === null) {
    const component: SystemComponentSnapshot = Object.freeze({
      componentId: input.componentId,
      owner: input.owner,
      ownerPath: input.ownerPath,
      releaseStatuses: dynamicReleaseStatuses(input.releaseStatuses, 'UNAVAILABLE'),
      truthLabel: 'UNAVAILABLE',
      desiredState: 'RUNNING',
      phase: 'BLOCKED',
      domainObservedState: null,
      sourceLifecycle: null,
      readiness: 'BLOCKED',
      authority: 'UNAVAILABLE',
      completeness: 'UNAVAILABLE',
      sourceTimestamp: null,
      freshness: null,
      lastReceiveAtMs: null,
      lastProcessAtMs: null,
      lastSuccessAtMs: null,
      processingLagMs: null,
      retry: UNAVAILABLE_RETRY,
      dataQuality: UNAVAILABLE_DATA_QUALITY,
      checkpoint: UNAVAILABLE_CHECKPOINT,
      dependencies: Object.freeze([...input.dependencies]),
      queue: null,
      lastFailure: null,
      blockerCodes: Object.freeze(['SOURCE_SNAPSHOT_UNAVAILABLE']),
      generation: 0,
      restartCount: 0,
      supportedControls: Object.freeze([...input.supportedControls]),
      capitalExposed: false,
      operatorAttentionRequired: true,
    });
    const issues = validateSystemComponentSnapshot(component);
    if (issues.length > 0) return reject(input, 'SOURCE_COMPONENT_INVALID', issues.map((entry) => `${entry.path}:${entry.code}`).join(', '));
    return Object.freeze({
      ok: true,
      value: Object.freeze({ component, observation: null, resyncRequired: false, lastFailureOrigin: null }),
      losses: Object.freeze([]),
    });
  }

  try {
    const snapshot = reading.source;
    if (snapshot.sourceId !== input.expectedSourceId) {
      return reject(input, 'SOURCE_ID_MISMATCH', `Expected ${input.expectedSourceId} but probe returned ${snapshot.sourceId}.`);
    }
    const coverage = translateRuntimeCoverage(snapshot.authority);
    const lifecycle = projectRuntimeLifecycleEvidence(snapshot.observedState);
    const completeness = sourceCompleteness(snapshot);
    const temporal = sourceTimestamp(snapshot, input, completeness);
    const observation = cloneObservation(reading.observation);
    const resyncRequired = reading.queue?.resyncRequired === true
      || snapshot.sequenceGapCount > 0
      || observation?.focusedBooks.some((book) => !book.sequenceComplete || book.pendingResyncRequestId !== null) === true;
    const blockers = new Set<string>();
    if (snapshot.observedState !== 'LIVE') blockers.add(`SOURCE_${snapshot.observedState}`);
    if (completeness === 'UNAVAILABLE') blockers.add('SOURCE_TRUTH_UNAVAILABLE');
    if (temporal.freshness !== null && temporal.freshness.state !== 'FRESH') blockers.add(`SOURCE_${temporal.freshness.state}`);
    if (resyncRequired) blockers.add('SEQUENCE_GAP');
    if (observation?.quietSymbolsRetained === false) blockers.add('QUIET_SYMBOL_RETENTION_UNPROVEN');
    if (observation?.focus !== null && observation?.focus !== undefined
        && (observation.focus.requestedSymbols.length > observation.focus.capacity
          || observation.focus.readySymbols.length > observation.focus.capacity)) {
      blockers.add('FOCUS_CAPACITY_EXCEEDED');
    }

    let readiness = lifecycle.readinessEvidence;
    if (readiness === 'READY' && completeness === 'UNAVAILABLE') readiness = 'BLOCKED';
    else if (readiness === 'READY' && (completeness === 'PARTIAL' || blockers.size > 0)) readiness = 'DEGRADED';
    let effectiveAuthority = temporal.freshness === null
      ? 'UNAVAILABLE'
      : weakestAuthority(input.acquisitionAuthority, temporal.freshness.effectiveAuthority);
    if (['STOPPED', 'CONNECTING', 'WARMING', 'SILENT', 'STALE', 'BACKING_OFF', 'FAILED']
      .includes(snapshot.observedState)) {
      effectiveAuthority = 'UNAVAILABLE';
    }
    const label = truthLabel(effectiveAuthority, readiness);
    const queue = sourceQueue(reading.queue);
    let failureOrigin: Readonly<StructuredFailureProjection> | null = null;
    if (snapshot.lastError !== null) {
      failureOrigin = translateRuntimeErrorToStructuredFailure(snapshot.lastError, {
        nowMs: input.nowMs,
        correlationId: input.correlationId,
        safeCurrentState: input.safeCurrentState,
        stage: 'source-probe',
        recommendedOperatorAction: snapshot.recommendedAction,
        sourceId: snapshot.sourceId,
      });
    }
    const phase = phaseForSource(snapshot.observedState, readiness);
    const component: SystemComponentSnapshot = Object.freeze({
      componentId: input.componentId,
      owner: input.owner,
      ownerPath: input.ownerPath,
      releaseStatuses: dynamicReleaseStatuses(input.releaseStatuses, label),
      truthLabel: label,
      desiredState: snapshot.desiredState,
      phase,
      domainObservedState: snapshot.observedState,
      sourceLifecycle: snapshot.observedState,
      readiness,
      authority: effectiveAuthority,
      completeness,
      sourceTimestamp: temporal.timestamp,
      freshness: temporal.freshness,
      lastReceiveAtMs: snapshot.lastMessageReceiveTimeMs,
      lastProcessAtMs: snapshot.lastProcessedTimeMs,
      lastSuccessAtMs: snapshot.observedState === 'LIVE' && effectiveAuthority !== 'UNAVAILABLE'
        ? snapshot.lastProcessedTimeMs
        : null,
      processingLagMs: snapshot.processingLagMs,
      retry: sourceRetry(snapshot),
      dataQuality: sourceDataQuality(snapshot),
      checkpoint: UNAVAILABLE_CHECKPOINT,
      dependencies: Object.freeze([...input.dependencies]),
      queue,
      lastFailure: failureOrigin?.failure ?? null,
      blockerCodes: Object.freeze([...blockers].sort()),
      generation: snapshot.connectionGeneration,
      restartCount: snapshot.reconnectCount,
      supportedControls: Object.freeze([...input.supportedControls]),
      capitalExposed: false,
      operatorAttentionRequired: readiness === 'DEGRADED' || readiness === 'BLOCKED' || readiness === 'FAILED',
    });
    const issues = validateSystemComponentSnapshot(component);
    if (issues.length > 0) {
      return reject(input, 'SOURCE_COMPONENT_INVALID', issues.map((entry) => `${entry.path}:${entry.code}`).join(', '));
    }
    return Object.freeze({
      ok: true,
      value: Object.freeze({ component, observation, resyncRequired, lastFailureOrigin: failureOrigin }),
      losses: freezeLosses([
        ...coverage.losses,
        ...(failureOrigin?.losses ?? []),
      ]),
    });
  } catch (error) {
    return reject(input, 'SOURCE_PROBE_INVALID', error instanceof Error ? error.message : 'Source probe projection failed.');
  }
}

function unavailableComponent(input: StructuralComponentProbeDescriptor): Readonly<SystemComponentSnapshot> {
  return Object.freeze({
    componentId: input.componentId,
    owner: input.owner,
    ownerPath: input.ownerPath,
    releaseStatuses: dynamicReleaseStatuses(input.releaseStatuses, 'UNAVAILABLE'),
    truthLabel: 'UNAVAILABLE',
    desiredState: 'RUNNING',
    phase: 'BLOCKED',
    domainObservedState: null,
    sourceLifecycle: null,
    readiness: 'BLOCKED',
    authority: 'UNAVAILABLE',
    completeness: 'UNAVAILABLE',
    sourceTimestamp: null,
    freshness: null,
    lastReceiveAtMs: null,
    lastProcessAtMs: null,
    lastSuccessAtMs: null,
    processingLagMs: null,
    retry: UNAVAILABLE_RETRY,
    dataQuality: UNAVAILABLE_DATA_QUALITY,
    checkpoint: UNAVAILABLE_CHECKPOINT,
    dependencies: Object.freeze([...input.dependencies]),
    queue: null,
    lastFailure: null,
    blockerCodes: Object.freeze(['COMPONENT_SNAPSHOT_UNAVAILABLE']),
    generation: 0,
    restartCount: 0,
    supportedControls: Object.freeze([...input.supportedControls]),
    capitalExposed: false,
    operatorAttentionRequired: true,
  });
}

export function probeSystemComponent(
  input: StructuralComponentProbeDescriptor,
): DialectTranslation<Readonly<SystemComponentSnapshot>> {
  let reading: Readonly<StructuralComponentProbeReading> | null;
  try {
    const ownerReading = input.port.readComponentProbe();
    reading = ownerReading === null ? null : captureOwnerData(ownerReading, 'component probe');
  } catch {
    return reject(input, 'COMPONENT_PROBE_READ_FAILED', 'Component probe read failed; owner detail remains at the component boundary.');
  }
  try {
    if (reading === null) {
      const unavailable = unavailableComponent(input);
      const issues = validateSystemComponentSnapshot(unavailable);
      return issues.length === 0
        ? Object.freeze({ ok: true, value: unavailable, losses: Object.freeze([]) })
        : reject(input, 'COMPONENT_PROBE_INVALID', issues.map((entry) => `${entry.path}:${entry.code}`).join(', '));
    }
    const freshness = reading.sourceTimestamp === null
      ? null
      : evaluateFreshness(reading.sourceTimestamp, input.nowMs);
    const authority = freshness === null
      ? reading.authority
      : weakestAuthority(reading.authority, freshness.effectiveAuthority);
    const blockers = new Set(reading.blockerCodes);
    let readiness = reading.readiness;
    let phase = reading.phase;
    let label = reading.truthLabel;
    if (freshness !== null && freshness.state !== 'FRESH') {
      blockers.add(`SOURCE_${freshness.state}`);
      if (readiness === 'READY') readiness = 'DEGRADED';
      if (phase === 'RUNNING') phase = 'DEGRADED';
      if (label === 'LIVE_PUBLIC') label = 'UNAVAILABLE';
    }
    if (authority === 'UNAVAILABLE' || reading.completeness === 'UNAVAILABLE') {
      blockers.add('COMPONENT_TRUTH_UNAVAILABLE');
      if (readiness === 'READY') readiness = 'DEGRADED';
      if (phase === 'RUNNING') phase = 'DEGRADED';
      if (label === 'LIVE_PUBLIC') label = 'UNAVAILABLE';
    }
    const component: SystemComponentSnapshot = Object.freeze({
      componentId: input.componentId,
      owner: input.owner,
      ownerPath: input.ownerPath,
      releaseStatuses: dynamicReleaseStatuses(input.releaseStatuses, label),
      truthLabel: label,
      desiredState: reading.desiredState,
      phase,
      domainObservedState: reading.domainObservedState,
      sourceLifecycle: null,
      readiness,
      authority,
      completeness: reading.completeness,
      sourceTimestamp: reading.sourceTimestamp,
      freshness,
      lastReceiveAtMs: reading.lastReceiveAtMs,
      lastProcessAtMs: reading.lastProcessAtMs,
      lastSuccessAtMs: reading.lastSuccessAtMs,
      processingLagMs: reading.processingLagMs ?? null,
      retry: reading.retry ?? UNAVAILABLE_RETRY,
      dataQuality: reading.dataQuality ?? UNAVAILABLE_DATA_QUALITY,
      checkpoint: reading.checkpoint ?? UNAVAILABLE_CHECKPOINT,
      dependencies: Object.freeze([...input.dependencies]),
      queue: reading.queue,
      lastFailure: reading.lastFailure,
      blockerCodes: Object.freeze([...blockers].sort()),
      generation: reading.generation,
      restartCount: reading.restartCount,
      supportedControls: Object.freeze([...input.supportedControls]),
      capitalExposed: reading.capitalExposed,
      operatorAttentionRequired: reading.operatorAttentionRequired,
    });
    const issues = validateSystemComponentSnapshot(component);
    if (issues.length > 0) return reject(input, 'COMPONENT_PROBE_INVALID', issues.map((entry) => `${entry.path}:${entry.code}`).join(', '));
    return Object.freeze({ ok: true, value: component, losses: Object.freeze([]) });
  } catch (error) {
    return reject(input, 'COMPONENT_PROBE_INVALID', error instanceof Error ? error.message : 'Component probe projection failed.');
  }
}
