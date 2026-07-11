import {
  canonicalJson,
  isRuntimePhase,
  isStructuredFailure,
  isValidUtcMillis,
} from '../../foundation/contracts/index.js';
import {
  DIALECT_LOSS_CODES,
  SYSTEM_RELEASE_STATUSES,
  SYSTEM_TRACE_EVENT_KINDS,
  SYSTEM_TRUTH_LABELS,
  type SystemComponentId,
  type SystemTruthLabel,
} from '../contracts/constants.js';
import type {
  SystemTraceEvent,
  SystemTraceSnapshot,
} from '../contracts/types.js';
import { validateSystemTraceEvent } from '../contracts/validation.js';
import { SYSTEM_COMPONENT_ORDER } from './topology.js';
import { isCanonicalComponentId } from './truth.js';
import type {
  SystemRecentCorrelatedDecision,
  SystemTraceIndex,
  SystemTraceIndexEntry,
} from './types.js';

export const MAX_TRACE_INPUT_EVENTS = 10_000;
export const MAX_TRACE_CORRELATIONS = 500;
export const MAX_TRACE_EVENTS_PER_CORRELATION = 250;
export const MAX_RECENT_CORRELATED_DECISIONS = 100;

const MATERIAL_DECISION_KINDS = new Set<SystemTraceEvent['kind']>([
  'CONTROL',
  'STRATEGY',
  'INTELLIGENCE',
  'CAPITAL',
  'RISK',
  'EXECUTION',
  'RECONCILIATION',
]);

const DRY_RUN_COMPONENTS = new Set<SystemComponentId>([
  'multileg-risk',
  'execution-coordinator-validate-only',
  'reconciliation',
]);

function boundedText(name: string, value: unknown, maximum: number): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    throw new TypeError(`${name} must be a non-empty string (<=${maximum} chars)`);
  }
}

function optionalBoundedText(name: string, value: unknown, maximum: number): void {
  if (value !== null) boundedText(name, value, maximum);
}

function normalizeEventTruth(event: SystemTraceEvent): SystemTruthLabel {
  if (event.releaseStatuses.some((status) => status === 'MISSING' || status === 'BLOCKED' || status === 'NOT_CONFIGURED')) {
    return 'UNAVAILABLE';
  }
  if (event.truthLabel === 'RECORDED_REPLAY') return 'RECORDED_REPLAY';
  if (DRY_RUN_COMPONENTS.has(event.componentId)) {
    return event.truthLabel === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'DRY_RUN';
  }
  if (event.releaseStatuses.includes('SYNTHETIC_ONLY') && event.truthLabel === 'LIVE_PUBLIC') {
    return 'SYNTHETIC_ONLY';
  }
  return event.truthLabel;
}

function validateTraceEvent(event: SystemTraceEvent, index: number): void {
  const contractIssues = validateSystemTraceEvent(event);
  if (contractIssues.length > 0) {
    throw new TypeError(`traceEvents[${index}] violates the integration contract: ${contractIssues.map((issue) => `${issue.path}:${issue.code}`).join(', ')}`);
  }
  boundedText(`traceEvents[${index}].id`, event.id, 160);
  boundedText(`traceEvents[${index}].correlationId`, event.correlationId, 128);
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 0) throw new TypeError(`traceEvents[${index}].sequence must be a non-negative safe integer`);
  if (!isCanonicalComponentId(event.componentId)) throw new TypeError(`traceEvents[${index}].componentId is not canonical`);
  if (!(SYSTEM_TRACE_EVENT_KINDS as readonly string[]).includes(event.kind)) throw new TypeError(`traceEvents[${index}].kind is invalid`);
  if (!(SYSTEM_TRUTH_LABELS as readonly string[]).includes(event.truthLabel)) throw new TypeError(`traceEvents[${index}].truthLabel is invalid`);
  if (DRY_RUN_COMPONENTS.has(event.componentId)
      && (event.truthLabel === 'LIVE_PUBLIC' || event.releaseStatuses.includes('LIVE_PUBLIC'))) {
    throw new TypeError(`traceEvents[${index}] cannot claim LIVE_PUBLIC for ${event.componentId}`);
  }
  if (!isValidUtcMillis(event.occurredAtMs)) throw new TypeError(`traceEvents[${index}].occurredAtMs is invalid`);
  if (event.persistedAtMs !== null && !isValidUtcMillis(event.persistedAtMs)) throw new TypeError(`traceEvents[${index}].persistedAtMs is invalid`);
  if (!Array.isArray(event.releaseStatuses) || event.releaseStatuses.length === 0 || event.releaseStatuses.length > SYSTEM_RELEASE_STATUSES.length) throw new TypeError(`traceEvents[${index}].releaseStatuses is unbounded`);
  if (event.releaseStatuses.some((status) => !(SYSTEM_RELEASE_STATUSES as readonly string[]).includes(status))) throw new TypeError(`traceEvents[${index}].releaseStatuses is invalid`);
  if (new Set(event.releaseStatuses).size !== event.releaseStatuses.length) throw new TypeError(`traceEvents[${index}].releaseStatuses contains duplicates`);
  optionalBoundedText(`traceEvents[${index}].ownerId`, event.ownerId, 256);
  optionalBoundedText(`traceEvents[${index}].canonicalProjectionId`, event.canonicalProjectionId, 256);
  optionalBoundedText(`traceEvents[${index}].revisionDigest`, event.revisionDigest, 256);
  optionalBoundedText(`traceEvents[${index}].domainLifecycle`, event.domainLifecycle, 256);
  if (event.machinePhase !== null && !isRuntimePhase(event.machinePhase)) throw new TypeError(`traceEvents[${index}].machinePhase is invalid`);
  if (event.failure !== null && !isStructuredFailure(event.failure)) throw new TypeError(`traceEvents[${index}].failure is invalid`);
  if (!Array.isArray(event.referenceIds) || event.referenceIds.length > 64) throw new TypeError(`traceEvents[${index}].referenceIds exceeds 64`);
  if (new Set(event.referenceIds).size !== event.referenceIds.length) throw new TypeError(`traceEvents[${index}].referenceIds contains duplicates`);
  if (!Array.isArray(event.lossCodes) || event.lossCodes.length > 32) throw new TypeError(`traceEvents[${index}].lossCodes exceeds 32`);
  if (event.lossCodes.some((code) => !(DIALECT_LOSS_CODES as readonly string[]).includes(code))) throw new TypeError(`traceEvents[${index}].lossCodes is invalid`);
  if (new Set(event.lossCodes).size !== event.lossCodes.length) throw new TypeError(`traceEvents[${index}].lossCodes contains duplicates`);
  for (const referenceId of event.referenceIds) boundedText(`traceEvents[${index}].referenceId`, referenceId, 256);
}

function cloneEvent(event: SystemTraceEvent): Readonly<SystemTraceEvent> {
  return Object.freeze({
    ...event,
    truthLabel: normalizeEventTruth(event),
    releaseStatuses: Object.freeze([...event.releaseStatuses]),
    failure: event.failure ? Object.freeze({ ...event.failure }) : null,
    referenceIds: Object.freeze([...event.referenceIds]),
    lossCodes: Object.freeze([...event.lossCodes]),
  });
}

function compareEventAscending(left: SystemTraceEvent, right: SystemTraceEvent): number {
  return left.sequence - right.sequence
    || left.occurredAtMs - right.occurredAtMs
    || left.id.localeCompare(right.id);
}

function compareEventRecent(left: SystemTraceEvent, right: SystemTraceEvent): number {
  return right.occurredAtMs - left.occurredAtMs
    || right.sequence - left.sequence
    || left.id.localeCompare(right.id);
}

function sortedComponents(events: readonly SystemTraceEvent[]): readonly SystemComponentId[] {
  return Object.freeze(
    [...new Set(events.map((event) => event.componentId))]
      .sort((left, right) => SYSTEM_COMPONENT_ORDER[left] - SYSTEM_COMPONENT_ORDER[right]),
  );
}

function sortedTruthLabels(events: readonly SystemTraceEvent[]): readonly SystemTruthLabel[] {
  return Object.freeze(
    [...new Set(events.map((event) => event.truthLabel))]
      .sort((left, right) => left.localeCompare(right)),
  );
}

export function buildSystemTraceIndex(
  inputEvents: readonly Readonly<SystemTraceEvent>[],
  evaluatedAtMs: number,
): Readonly<SystemTraceIndex> {
  if (!isValidUtcMillis(evaluatedAtMs)) throw new TypeError('buildSystemTraceIndex: evaluatedAtMs is invalid');
  if (!Array.isArray(inputEvents) || inputEvents.length > MAX_TRACE_INPUT_EVENTS) {
    throw new TypeError(`buildSystemTraceIndex: traceEvents exceeds ${MAX_TRACE_INPUT_EVENTS}`);
  }

  const byId = new Map<string, { canonical: string; event: Readonly<SystemTraceEvent> }>();
  let duplicateEventCount = 0;
  inputEvents.forEach((sourceEvent, index) => {
    validateTraceEvent(sourceEvent, index);
    const event = cloneEvent(sourceEvent);
    const canonical = canonicalJson(event);
    const existing = byId.get(event.id);
    if (existing) {
      if (existing.canonical !== canonical) throw new TypeError(`buildSystemTraceIndex: duplicate event ${event.id} conflicts`);
      duplicateEventCount += 1;
      return;
    }
    byId.set(event.id, { canonical, event });
  });

  const groups = new Map<string, Readonly<SystemTraceEvent>[]>();
  for (const { event } of byId.values()) {
    const group = groups.get(event.correlationId) ?? [];
    group.push(event);
    groups.set(event.correlationId, group);
  }

  let truncated = false;
  const entries: SystemTraceIndexEntry[] = [];
  for (const [correlationId, unsorted] of groups) {
    const ordered = [...unsorted].sort(compareEventAscending);
    const clipped = ordered.length > MAX_TRACE_EVENTS_PER_CORRELATION
      ? ordered.slice(ordered.length - MAX_TRACE_EVENTS_PER_CORRELATION)
      : ordered;
    const traceTruncated = clipped.length !== ordered.length;
    truncated ||= traceTruncated;
    const snapshot: SystemTraceSnapshot = Object.freeze({
      correlationId,
      evaluatedAtMs,
      events: Object.freeze(clipped),
      truncated: traceTruncated,
    });
    entries.push(Object.freeze({
      correlationId,
      firstOccurredAtMs: ordered[0].occurredAtMs,
      lastOccurredAtMs: ordered[ordered.length - 1].occurredAtMs,
      componentIds: sortedComponents(ordered),
      truthLabels: sortedTruthLabels(ordered),
      eventCount: ordered.length,
      failureCount: ordered.filter((event) => event.failure !== null).length,
      snapshot,
    }));
  }
  entries.sort((left, right) => right.lastOccurredAtMs - left.lastOccurredAtMs || left.correlationId.localeCompare(right.correlationId));
  if (entries.length > MAX_TRACE_CORRELATIONS) {
    entries.splice(MAX_TRACE_CORRELATIONS);
    truncated = true;
  }

  return Object.freeze({
    evaluatedAtMs,
    entries: Object.freeze(entries),
    totalInputEvents: inputEvents.length,
    uniqueEventCount: byId.size,
    duplicateEventCount,
    truncated,
  });
}

export function traceByCorrelationId(
  index: Readonly<SystemTraceIndex>,
  correlationId: string,
): Readonly<SystemTraceSnapshot> | null {
  boundedText('correlationId', correlationId, 128);
  return index.entries.find((entry) => entry.correlationId === correlationId)?.snapshot ?? null;
}

export function recentCorrelatedDecisions(
  index: Readonly<SystemTraceIndex>,
  maximum = MAX_RECENT_CORRELATED_DECISIONS,
): readonly Readonly<SystemRecentCorrelatedDecision>[] {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > MAX_RECENT_CORRELATED_DECISIONS) {
    throw new TypeError(`recentCorrelatedDecisions: maximum must be 1-${MAX_RECENT_CORRELATED_DECISIONS}`);
  }
  const events = index.entries
    .flatMap((entry) => entry.snapshot.events)
    .filter((event) => MATERIAL_DECISION_KINDS.has(event.kind))
    .sort(compareEventRecent)
    .slice(0, maximum);
  return Object.freeze(events.map((event) => Object.freeze({
    eventId: event.id,
    correlationId: event.correlationId,
    componentId: event.componentId,
    kind: event.kind,
    occurredAtMs: event.occurredAtMs,
    truthLabel: event.truthLabel,
    ownerId: event.ownerId,
    canonicalProjectionId: event.canonicalProjectionId,
    revisionDigest: event.revisionDigest,
    failureCode: event.failure?.code ?? null,
    referenceIds: Object.freeze([...event.referenceIds]),
  })));
}
