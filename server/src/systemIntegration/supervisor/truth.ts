import {
  evaluateFreshness,
  weakestAuthority,
  type Completeness,
  type DataAuthority,
  type FreshnessReport,
} from '../../foundation/contracts/index.js';
import {
  SYSTEM_COMPONENT_IDS,
  type SystemComponentId,
  type SystemReadinessState,
  type SystemReleaseStatus,
  type SystemTruthLabel,
} from '../contracts/constants.js';
import type { SystemComponentSnapshot } from '../contracts/types.js';
import { dependenciesFor, SYSTEM_TOPOLOGY_NODES } from './topology.js';

const DRY_RUN_COMPONENTS = new Set<SystemComponentId>([
  'multileg-risk',
  'execution-coordinator-validate-only',
  'reconciliation',
]);

const BLOCKED_RELEASE_STATUSES = new Set<string>([
  'BLOCKED',
  'NOT_CONFIGURED',
  'MISSING',
]);

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function normalizedReleaseStatuses(
  statuses: readonly SystemReleaseStatus[],
  truthLabel: SystemTruthLabel,
): readonly SystemReleaseStatus[] {
  const current = truthLabel === 'LIVE_PUBLIC'
    ? statuses
    : statuses.filter((status) => status !== 'LIVE_PUBLIC');
  return Object.freeze([...current]);
}

function releaseUnavailable(component: SystemComponentSnapshot): boolean {
  return component.releaseStatuses.some((status) => BLOCKED_RELEASE_STATUSES.has(status));
}

function deriveTruthLabel(
  component: SystemComponentSnapshot,
  freshness: Readonly<FreshnessReport> | null,
  requiresFreshSource: boolean,
): SystemTruthLabel {
  if (
    component.authority === 'UNAVAILABLE'
    || component.completeness === 'UNAVAILABLE'
    || releaseUnavailable(component)
  ) return 'UNAVAILABLE';
  if (requiresFreshSource && freshness === null) return 'UNAVAILABLE';

  const synthetic = component.authority === 'SYNTHETIC_TEST'
    || component.releaseStatuses.includes('SYNTHETIC_ONLY');
  if (component.authority === 'RECORDED_REPLAY' || component.truthLabel === 'RECORDED_REPLAY') {
    return 'RECORDED_REPLAY';
  }
  if (DRY_RUN_COMPONENTS.has(component.componentId)) return 'DRY_RUN';
  if (synthetic) return 'SYNTHETIC_ONLY';

  if (freshness && freshness.state !== 'FRESH') return 'UNAVAILABLE';
  if (
    component.releaseStatuses.includes('LIVE_PUBLIC')
    && (component.authority === 'LIVE_PUBLIC' || component.authority === 'DERIVED_LIVE')
  ) return 'LIVE_PUBLIC';

  return 'UNKNOWN';
}

function normalizedReadiness(
  component: SystemComponentSnapshot,
  truthLabel: SystemTruthLabel,
  freshness: Readonly<FreshnessReport> | null,
  requiresFreshSource: boolean,
): SystemReadinessState {
  if (component.readiness === 'FAILED') return 'FAILED';
  if (component.desiredState === 'STOPPED' && component.phase === 'STOPPED') return 'STOPPED';
  if (component.readiness === 'STOPPED' || component.readiness === 'WARMING') return component.readiness;
  if (component.readiness === 'BLOCKED') return 'BLOCKED';

  if (releaseUnavailable(component) || truthLabel === 'UNAVAILABLE') {
    return component.desiredState === 'STOPPED' ? 'STOPPED' : 'BLOCKED';
  }
  if (requiresFreshSource && freshness === null) return 'BLOCKED';
  if (freshness?.state === 'UNAVAILABLE' || freshness?.state === 'CLOCK_SKEWED') return 'BLOCKED';
  if (freshness?.state === 'STALE') return 'DEGRADED';
  if (component.completeness === 'PARTIAL') return 'DEGRADED';
  if (component.queue && (component.queue.dropped > 0 || component.queue.depth >= component.queue.capacity)) {
    return 'DEGRADED';
  }
  if (truthLabel === 'UNKNOWN') return 'DEGRADED';
  return component.readiness;
}

function truthBlockerCodes(
  component: SystemComponentSnapshot,
  truthLabel: SystemTruthLabel,
  freshness: Readonly<FreshnessReport> | null,
  readiness: SystemReadinessState,
  requiresFreshSource: boolean,
): readonly string[] {
  const codes = [...component.blockerCodes];
  if (releaseUnavailable(component)) codes.push('RELEASE_NOT_AVAILABLE');
  if (truthLabel === 'UNAVAILABLE') codes.push('TRUTH_UNAVAILABLE');
  if (truthLabel === 'UNKNOWN') codes.push('TRUTH_UNKNOWN');
  if (requiresFreshSource && freshness === null) codes.push('FRESHNESS_NOT_REPORTED');
  if (freshness?.state === 'STALE') codes.push('SOURCE_STALE');
  if (freshness?.state === 'CLOCK_SKEWED') codes.push('SOURCE_CLOCK_SKEWED');
  if (freshness?.state === 'UNAVAILABLE') codes.push('SOURCE_FRESHNESS_UNAVAILABLE');
  if (component.completeness === 'PARTIAL') codes.push('SOURCE_PARTIAL');
  if (component.queue?.dropped) codes.push('QUEUE_DROPPED');
  if (component.queue && component.queue.depth >= component.queue.capacity) codes.push('QUEUE_AT_CAPACITY');
  if (readiness === 'FAILED' && component.lastFailure) codes.push(component.lastFailure.code);
  return sortedUnique(codes);
}

function weakestCompleteness(left: Completeness, right: Completeness): Completeness {
  if (left === 'UNAVAILABLE' || right === 'UNAVAILABLE') return 'UNAVAILABLE';
  if (left === 'PARTIAL' || right === 'PARTIAL') return 'PARTIAL';
  return 'COMPLETE';
}

function effectiveAuthority(
  component: Readonly<SystemComponentSnapshot>,
  freshness: Readonly<FreshnessReport> | null,
): DataAuthority {
  if (freshness === null) return component.authority;
  if (freshness.state !== 'FRESH') return 'UNAVAILABLE';
  return weakestAuthority(component.authority, freshness.effectiveAuthority);
}

/**
 * Enforce supervisor truth laws without upgrading any owner fact. Freshness is
 * recomputed only from the supplied canonical SourcedTimestamp and injected
 * clock; a missing timestamp remains missing.
 */
export function normalizeComponentTruth(
  component: Readonly<SystemComponentSnapshot>,
  nowMs: number,
): Readonly<SystemComponentSnapshot> {
  const topology = SYSTEM_TOPOLOGY_NODES.find((node) => node.componentId === component.componentId);
  if (!topology) throw new TypeError(`normalizeComponentTruth: unknown component ${component.componentId}`);
  // A previously computed freshness report is not timeless evidence. Without
  // the canonical timestamp there is nothing the injected clock can safely
  // re-evaluate, so freshness remains unavailable.
  const freshness = component.sourceTimestamp
    ? evaluateFreshness(component.sourceTimestamp, nowMs)
    : null;
  const authority = effectiveAuthority(component, freshness);
  const completeness = component.sourceTimestamp
    ? weakestCompleteness(component.completeness, component.sourceTimestamp.completeness)
    : component.completeness;
  const normalized = { ...component, authority, completeness };
  const truthLabel = deriveTruthLabel(normalized, freshness, topology.requiresFreshSource);
  const readiness = normalizedReadiness(normalized, truthLabel, freshness, topology.requiresFreshSource);
  const blockerCodes = truthBlockerCodes(
    normalized,
    truthLabel,
    freshness,
    readiness,
    topology.requiresFreshSource,
  );

  return Object.freeze({
    ...component,
    releaseStatuses: normalizedReleaseStatuses(component.releaseStatuses, truthLabel),
    truthLabel,
    readiness,
    authority,
    completeness,
    sourceTimestamp: component.sourceTimestamp ? Object.freeze({ ...component.sourceTimestamp }) : null,
    freshness,
    dependencies: dependenciesFor(component.componentId),
    queue: component.queue ? Object.freeze({ ...component.queue }) : null,
    lastFailure: component.lastFailure ? Object.freeze({ ...component.lastFailure }) : null,
    blockerCodes,
    supportedControls: Object.freeze([...component.supportedControls]),
  });
}

export function strictSummaryTruthLabel(
  claimed: SystemTruthLabel,
  supportingComponentIds: readonly SystemComponentId[],
  components: ReadonlyMap<SystemComponentId, Readonly<SystemComponentSnapshot>>,
): SystemTruthLabel {
  const labels = supportingComponentIds.map((componentId) => components.get(componentId)?.truthLabel ?? 'UNAVAILABLE');
  if (claimed === 'UNAVAILABLE') return 'UNAVAILABLE';
  if (labels.length === 0 || labels.every((label) => label === 'UNAVAILABLE')) return 'UNAVAILABLE';
  if (claimed === 'UNKNOWN') return 'UNKNOWN';
  if (labels.includes('DRY_RUN')) return 'DRY_RUN';
  if (labels.length > 0 && labels.every((label) => label === 'SYNTHETIC_ONLY')) return 'SYNTHETIC_ONLY';
  if (claimed === 'LIVE_PUBLIC' && labels.some((label) => label !== 'LIVE_PUBLIC')) return 'UNKNOWN';
  if (claimed === 'LIVE_PUBLIC' || claimed === 'DRY_RUN' || claimed === 'SYNTHETIC_ONLY' || claimed === 'RECORDED_REPLAY') {
    return claimed;
  }
  return labels.includes('SYNTHETIC_ONLY') ? 'SYNTHETIC_ONLY' : claimed;
}

export function isCanonicalComponentId(value: unknown): value is SystemComponentId {
  return typeof value === 'string' && (SYSTEM_COMPONENT_IDS as readonly string[]).includes(value);
}
