import { isValidUtcMillis } from '../../foundation/contracts/index.js';
import {
  assertProductComponentEvidence,
  assertProductSupervisorProjection,
  snapshotProductComponentEvidence,
  type ProductComponentEvidence,
  type ProductComponentProjection,
  type ProductDependencyProjection,
  type ProductLivenessState,
  type ProductOperatorAttentionItem,
  type ProductReadinessState,
  type ProductRevisionSet,
  type ProductSeverity,
  type ProductSupervisorProjection,
  type ProductTradeReadinessState,
} from '../contracts/index.js';

const BLOCKING_READINESS = new Set<ProductReadinessState>(['BLOCKED', 'FAILED', 'STOPPED', 'UNKNOWN']);
const UNREADY_CAPABILITIES = new Set(['NOT_CONFIGURED', 'UNAVAILABLE', 'UNKNOWN']);
const TRADE_CAPABLE = new Set(['LIVE_MANUAL_CAPPED']);

interface LocalProjection {
  readonly liveness: ProductLivenessState;
  readonly readiness: ProductReadinessState;
  readonly ages: ProductComponentProjection['ages'];
  readonly reasons: readonly string[];
  readonly localProblem: boolean;
}

function age(value: number | null, nowMs: number): number | null {
  if (value === null || value > nowMs) return null;
  return nowMs - value;
}

function stableUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)]);
}

function topologicalOrder(components: readonly ProductComponentEvidence[]): readonly string[] {
  const byId = new Map<string, ProductComponentEvidence>();
  const position = new Map<string, number>();
  components.forEach((component, index) => {
    assertProductComponentEvidence(component);
    if (byId.has(component.componentId)) throw new TypeError(`duplicate product component '${component.componentId}'`);
    byId.set(component.componentId, component);
    position.set(component.componentId, index);
  });
  for (const component of components) {
    for (const dependency of [...component.requiredDependencies, ...component.optionalDependencies]) {
      if (dependency === component.componentId) throw new TypeError(`component '${component.componentId}' depends on itself`);
      if (!byId.has(dependency)) throw new TypeError(`component '${component.componentId}' depends on unknown '${dependency}'`);
    }
  }
  const indegree = new Map(components.map((component) => [component.componentId, component.requiredDependencies.length + component.optionalDependencies.length]));
  const dependents = new Map<string, string[]>();
  for (const component of components) {
    for (const dependency of [...component.requiredDependencies, ...component.optionalDependencies]) {
      const list = dependents.get(dependency) ?? [];
      list.push(component.componentId);
      dependents.set(dependency, list);
    }
  }
  const ready = components.filter((component) => indegree.get(component.componentId) === 0).map((component) => component.componentId);
  const ordered: string[] = [];
  while (ready.length > 0) {
    ready.sort((left, right) => (position.get(left) as number) - (position.get(right) as number));
    const componentId = ready.shift() as string;
    ordered.push(componentId);
    for (const dependent of dependents.get(componentId) ?? []) {
      const remaining = (indegree.get(dependent) as number) - 1;
      indegree.set(dependent, remaining);
      if (remaining === 0) ready.push(dependent);
    }
  }
  if (ordered.length !== components.length) throw new TypeError('product component graph contains a dependency cycle');
  return Object.freeze(ordered);
}

function projectLocal(component: ProductComponentEvidence, nowMs: number): LocalProjection {
  const ages = Object.freeze({
    heartbeatAgeMs: age(component.timing.heartbeatAtMs, nowMs),
    sourceEventAgeMs: age(component.timing.lastInputEventAtMs, nowMs),
    receiveAgeMs: age(component.timing.lastReceiveAtMs, nowMs),
    processingAgeMs: age(component.timing.lastProcessedAtMs, nowMs),
    meaningfulAdvanceAgeMs: age(component.timing.lastMeaningfulAdvanceAtMs, nowMs),
  });
  const reasons = [...component.blockerCodes];
  if (component.lastFailure) reasons.push(component.lastFailure.code);
  for (const [label, value] of [
    ['HEARTBEAT', component.timing.heartbeatAtMs],
    ['SOURCE_EVENT', component.timing.lastInputEventAtMs],
    ['RECEIVE', component.timing.lastReceiveAtMs],
    ['PROCESSING', component.timing.lastProcessedAtMs],
    ['MEANINGFUL_ADVANCE', component.timing.lastMeaningfulAdvanceAtMs],
  ] as const) {
    if (value !== null && value > nowMs) reasons.push(`${label}_CLOCK_SKEWED`);
  }

  let liveness: ProductLivenessState;
  if (component.observedLifecycle === 'STOPPED') liveness = 'STOPPED';
  else if (ages.heartbeatAgeMs === null) liveness = 'UNKNOWN';
  else if (ages.heartbeatAgeMs <= component.timing.heartbeatMaxAgeMs) liveness = 'ALIVE';
  else liveness = 'STALE';

  let readiness: ProductReadinessState;
  if (component.observedLifecycle === 'FAILED') readiness = 'FAILED';
  else if (component.observedLifecycle === 'BLOCKED') readiness = 'BLOCKED';
  else if (component.observedLifecycle === 'RECOVERY_REQUIRED') readiness = 'RECOVERY_REQUIRED';
  else if (component.observedLifecycle === 'STOPPED' || component.desiredState === 'STOPPED') readiness = 'STOPPED';
  else if (component.observedLifecycle === 'START_REQUESTED'
      || component.observedLifecycle === 'STARTING'
      || component.observedLifecycle === 'WARMING'
      || component.observedLifecycle === 'RECONCILING'
      || component.observedLifecycle === 'STOPPING'
      || component.observedLifecycle === 'DRAINING') readiness = 'WARMING';
  else if (liveness !== 'ALIVE') readiness = liveness === 'UNKNOWN' ? 'UNKNOWN' : 'DEGRADED';
  else readiness = component.observedLifecycle === 'READY' ? 'READY' : 'DEGRADED';

  if (readiness === 'READY') {
    if (UNREADY_CAPABILITIES.has(component.capability)) reasons.push(`CAPABILITY_${component.capability}`);
    if (component.authority === 'UNAVAILABLE') reasons.push('AUTHORITY_UNAVAILABLE');
    if (component.completeness !== 'COMPLETE') reasons.push(`COMPLETENESS_${component.completeness}`);
    if (component.timing.sourceMaxAgeMs !== null
        && (ages.sourceEventAgeMs === null || ages.sourceEventAgeMs > component.timing.sourceMaxAgeMs)) reasons.push('SOURCE_STALE_OR_UNKNOWN');
    if (component.timing.processingMaxAgeMs !== null
        && (ages.processingAgeMs === null || ages.processingAgeMs > component.timing.processingMaxAgeMs)) reasons.push('PROCESSING_STALE_OR_UNKNOWN');
    if (component.timing.meaningfulAdvanceMaxAgeMs !== null
        && (ages.meaningfulAdvanceAgeMs === null || ages.meaningfulAdvanceAgeMs > component.timing.meaningfulAdvanceMaxAgeMs)) reasons.push('MEANINGFUL_ADVANCE_STALE_OR_UNKNOWN');
    if (component.queue?.backpressure === 'SATURATED') reasons.push('QUEUE_SATURATED');
    if (component.queue?.backpressure === 'UNKNOWN') reasons.push('QUEUE_BACKPRESSURE_UNKNOWN');
    if ((component.queue?.dropped ?? 0) > 0) reasons.push('QUEUE_DROPS_OBSERVED');
    if (component.queueRequired && component.queue === null) reasons.push('QUEUE_EVIDENCE_UNKNOWN');
    if (component.queueRequired && component.queue !== null
        && [component.queue.depth, component.queue.capacity, component.queue.dropped, component.queue.coalesced].some((value) => value === null)) reasons.push('QUEUE_METRICS_UNKNOWN');
    if (component.queue !== null && component.queue.depth !== null && component.queue.capacity !== null
        && component.queue.depth >= component.queue.capacity) reasons.push('QUEUE_AT_CAPACITY');
    if (component.queue !== null
        && (component.queue.observedAtMs === null
          || component.queue.observedAtMs > nowMs
          || nowMs - component.queue.observedAtMs > component.queue.maxAgeMs)) reasons.push('QUEUE_EVIDENCE_STALE_OR_UNKNOWN');
    if (component.roles.includes('SOURCE')) {
      if (component.timing.sourceMaxAgeMs === null) reasons.push('SOURCE_MAX_AGE_UNAVAILABLE');
      if (component.timing.processingMaxAgeMs === null) reasons.push('PROCESSING_MAX_AGE_UNAVAILABLE');
      if (component.timing.meaningfulAdvanceMaxAgeMs === null) reasons.push('MEANINGFUL_ADVANCE_MAX_AGE_UNAVAILABLE');
      if (component.timing.sourceMaxAgeMs !== null
          && (ages.receiveAgeMs === null || ages.receiveAgeMs > component.timing.sourceMaxAgeMs)) reasons.push('RECEIVE_STALE_OR_UNKNOWN');
    }
    const capabilityAuthorityCompatible = (component.capability === 'LIVE_PUBLIC' && ['LIVE_PUBLIC', 'DERIVED_LIVE'].includes(component.authority))
      || (['LIVE_PRIVATE_READ', 'LIVE_SIGNED_VALIDATE', 'LIVE_MANUAL_CAPPED'].includes(component.capability) && component.authority === 'LIVE_PRIVATE')
      || (component.capability === 'SYNTHETIC' && component.authority === 'SYNTHETIC_TEST')
      || (component.capability === 'REPLAY' && component.authority === 'RECORDED_REPLAY')
      || !['LIVE_PUBLIC', 'LIVE_PRIVATE_READ', 'LIVE_SIGNED_VALIDATE', 'LIVE_MANUAL_CAPPED', 'SYNTHETIC', 'REPLAY'].includes(component.capability);
    if (!capabilityAuthorityCompatible) reasons.push('CAPABILITY_AUTHORITY_MISMATCH');
    if (reasons.length > 0) readiness = component.tradeCritical && UNREADY_CAPABILITIES.has(component.capability) ? 'BLOCKED' : 'DEGRADED';
  }
  return Object.freeze({
    liveness,
    readiness,
    ages,
    reasons: stableUnique(reasons),
    localProblem: reasons.length > 0 || readiness !== 'READY',
  });
}

function tradeReadiness(component: ProductComponentEvidence, readiness: ProductReadinessState): ProductTradeReadinessState {
  if (!component.tradeCritical) return 'NOT_APPLICABLE';
  if (readiness !== 'READY') return 'BLOCKED';
  return TRADE_CAPABLE.has(component.capability) ? 'READY' : 'BLOCKED';
}

function severity(readiness: ProductReadinessState, capitalExposed: boolean, attention: boolean): ProductSeverity {
  if (capitalExposed && readiness !== 'READY') return 'CRITICAL';
  if (readiness === 'FAILED' || readiness === 'BLOCKED' || readiness === 'RECOVERY_REQUIRED') return 'HIGH';
  if (readiness === 'DEGRADED' || readiness === 'UNKNOWN') return 'MEDIUM';
  if (readiness === 'WARMING' || readiness === 'STOPPED' || attention) return 'LOW';
  return 'NONE';
}

function dependencyProblemRank(component: ProductComponentProjection): number {
  const readinessRank: Record<ProductReadinessState, number> = {
    FAILED: 8, BLOCKED: 7, STOPPED: 7, RECOVERY_REQUIRED: 6, UNKNOWN: 5, DEGRADED: 4, WARMING: 3, READY: 1,
  };
  return (component.capitalExposed ? 100 : 0) + readinessRank[component.readiness];
}

function overallReadiness(components: readonly ProductComponentProjection[]): ProductReadinessState {
  const required = components.filter((component) => component.requiredForProductReadiness);
  const considered = required.length > 0 ? required : components;
  if (considered.some((component) => component.readiness === 'FAILED')) return 'FAILED';
  if (considered.some((component) => component.readiness === 'BLOCKED')) return 'BLOCKED';
  if (considered.some((component) => component.readiness === 'RECOVERY_REQUIRED')) return 'RECOVERY_REQUIRED';
  if (considered.some((component) => component.readiness === 'DEGRADED' || component.readiness === 'UNKNOWN')) return 'DEGRADED';
  if (considered.some((component) => component.readiness === 'WARMING')) return 'WARMING';
  if (considered.every((component) => component.readiness === 'STOPPED')) return 'STOPPED';
  if (considered.some((component) => component.readiness === 'STOPPED')) return 'BLOCKED';
  return 'READY';
}

export interface BuildProductSupervisorInput {
  readonly nowMs: number;
  readonly revision: number;
  readonly components: readonly Readonly<ProductComponentEvidence>[];
}

/**
 * Pure read projection. It does not own lifecycle, health evidence, controls,
 * persistence, or any domain verdict.
 */
export function buildProductSupervisorProjection(input: BuildProductSupervisorInput): Readonly<ProductSupervisorProjection> {
  if (!isValidUtcMillis(input.nowMs)) throw new TypeError('nowMs must be injected valid UTC ms');
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) throw new TypeError('revision must be a non-negative safe integer');
  if (!Array.isArray(input.components) || input.components.length === 0 || input.components.length > 128) throw new TypeError('components must contain 1..128 owner snapshots');
  input.components.forEach((component) => assertProductComponentEvidence(component));
  const components = input.components.map((component) => snapshotProductComponentEvidence(component)) as ProductComponentEvidence[];
  const order = topologicalOrder(components);
  const byId = new Map(components.map((component) => [component.componentId, component] as const));
  const local = new Map(order.map((id) => [id, projectLocal(byId.get(id) as ProductComponentEvidence, input.nowMs)] as const));
  const projections = new Map<string, ProductComponentProjection>();

  for (const componentId of order) {
    const component = byId.get(componentId) as ProductComponentEvidence;
    const own = local.get(componentId) as LocalProjection;
    let readiness = own.readiness;
    const reasons = [...own.reasons];
    let rootBlockerComponentId: string | null = own.localProblem ? componentId : null;
    let dependencyPath: readonly string[] = own.localProblem ? [componentId] : [];

    const localAuthoritative = component.lastFailure !== null || ['FAILED', 'BLOCKED', 'RECOVERY_REQUIRED'].includes(own.readiness);
    if (!localAuthoritative) {
      const blockedRequired = component.requiredDependencies
        .map((id) => projections.get(id) as ProductComponentProjection)
        .filter((dependency) => dependency.readiness !== 'READY')
        .sort((left, right) => dependencyProblemRank(right) - dependencyProblemRank(left))[0];
      if (blockedRequired && (readiness === 'READY' || dependencyProblemRank(blockedRequired) > dependencyProblemRank({ ...blockedRequired, readiness }))) {
        readiness = BLOCKING_READINESS.has(blockedRequired.readiness) ? 'BLOCKED' : 'DEGRADED';
        rootBlockerComponentId = blockedRequired.rootBlockerComponentId ?? blockedRequired.componentId;
        dependencyPath = Object.freeze([componentId, ...blockedRequired.dependencyPath]);
        reasons.push(`REQUIRED_DEPENDENCY_${blockedRequired.componentId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`);
      } else if (readiness === 'READY') {
        const degradedOptional = component.optionalDependencies
          .map((id) => projections.get(id) as ProductComponentProjection)
          .find((dependency) => dependency.readiness !== 'READY');
        if (degradedOptional) {
          readiness = 'DEGRADED';
          rootBlockerComponentId = degradedOptional.rootBlockerComponentId ?? degradedOptional.componentId;
          dependencyPath = Object.freeze([componentId, ...degradedOptional.dependencyPath]);
          reasons.push(`OPTIONAL_DEPENDENCY_${degradedOptional.componentId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`);
        }
      }
    }
    const projected: ProductComponentProjection = Object.freeze({
      ...component,
      roles: Object.freeze([...component.roles]),
      requiredDependencies: Object.freeze([...component.requiredDependencies]),
      optionalDependencies: Object.freeze([...component.optionalDependencies]),
      blockerCodes: Object.freeze([...component.blockerCodes]),
      supportedCommandIds: Object.freeze([...component.supportedCommandIds]),
      timing: Object.freeze({ ...component.timing }),
      queue: component.queue ? Object.freeze({ ...component.queue }) : null,
      revisions: Object.freeze({ ...component.revisions }),
      lastFailure: component.lastFailure ? Object.freeze({ ...component.lastFailure }) : null,
      liveness: own.liveness,
      readiness,
      tradeReadiness: tradeReadiness(component, readiness),
      ages: own.ages,
      rootBlockerComponentId,
      dependencyPath: Object.freeze([...dependencyPath]),
      affectedComponentIds: Object.freeze([]),
      affectedCapitalExposed: component.capitalExposed,
      severity: 'NONE',
      projectionReasonCodes: stableUnique(reasons),
    });
    projections.set(componentId, projected);
  }

  const affected = new Map<string, string[]>();
  for (const component of projections.values()) {
    if (component.rootBlockerComponentId) {
      const list = affected.get(component.rootBlockerComponentId) ?? [];
      list.push(component.componentId);
      affected.set(component.rootBlockerComponentId, list);
    }
  }
  const finalized = order.map((componentId) => {
    const component = projections.get(componentId) as ProductComponentProjection;
    const affectedIds = affected.get(componentId) ?? [];
    const exposed = component.capitalExposed || affectedIds.some((id) => (projections.get(id) as ProductComponentProjection).capitalExposed);
    return Object.freeze({
      ...component,
      affectedComponentIds: Object.freeze([...affectedIds]),
      affectedCapitalExposed: exposed,
      severity: severity(component.readiness, exposed, component.operatorAttentionRequired),
    });
  });
  const finalizedById = new Map(finalized.map((component) => [component.componentId, component] as const));
  const dependencies: ProductDependencyProjection[] = [];
  for (const component of finalized) {
    for (const [dependencyId, required] of [
      ...component.requiredDependencies.map((id) => [id, true] as const),
      ...component.optionalDependencies.map((id) => [id, false] as const),
    ]) {
      const dependency = finalizedById.get(dependencyId) as ProductComponentProjection;
      const state: ProductDependencyProjection['state'] = dependency.readiness === 'READY'
        ? 'AVAILABLE'
        : BLOCKING_READINESS.has(dependency.readiness) && required
          ? 'BLOCKED'
          : dependency.readiness === 'UNKNOWN'
            ? 'UNKNOWN'
            : 'DEGRADED';
      dependencies.push(Object.freeze({
        from: dependencyId,
        to: component.componentId,
        required,
        state,
        rootBlockerComponentId: state === 'AVAILABLE' ? null : dependency.rootBlockerComponentId ?? dependencyId,
      }));
    }
  }
  const roots = finalized.filter((component) => component.rootBlockerComponentId === component.componentId && component.readiness !== 'READY');
  const severityRank: Record<ProductSeverity, number> = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, NONE: 1 };
  roots.sort((left, right) => severityRank[right.severity] - severityRank[left.severity] || order.indexOf(left.componentId) - order.indexOf(right.componentId));
  const operatorAttention: ProductOperatorAttentionItem[] = finalized
    .filter((component) => component.readiness !== 'READY' || component.operatorAttentionRequired)
    .map((component) => {
      const root = finalizedById.get(component.rootBlockerComponentId ?? component.componentId) ?? component;
      return Object.freeze({
        componentId: component.componentId,
        rootBlockerComponentId: root.componentId,
        severity: root.severity,
        reasonCodes: root.projectionReasonCodes,
        capitalExposed: root.affectedCapitalExposed || component.capitalExposed,
        recommendedOperatorAction: root.lastFailure?.recommendedOperatorAction ?? null,
      });
    })
    .sort((left, right) => severityRank[right.severity] - severityRank[left.severity] || order.indexOf(left.componentId) - order.indexOf(right.componentId));
  const tradeCritical = finalized.filter((component) => component.tradeCritical);
  const projectedTradeReadiness: ProductTradeReadinessState = tradeCritical.length === 0
    ? 'NOT_APPLICABLE'
    : tradeCritical.some((component) => component.tradeReadiness === 'BLOCKED')
      ? 'BLOCKED'
      : tradeCritical.some((component) => component.tradeReadiness === 'DEGRADED')
        ? 'DEGRADED'
        : 'READY';
  const revisionValue = (field: keyof ProductRevisionSet): string | null => {
    const values = stableUnique(finalized.map((component) => component.revisions[field]).filter((value): value is string => value !== null));
    return values.length === 1 ? values[0] as string : null;
  };
  const projection: Readonly<ProductSupervisorProjection> = Object.freeze({
    schemaVersion: 1,
    revision: input.revision,
    evaluatedAtMs: input.nowMs,
    overallReadiness: overallReadiness(finalized),
    tradeReadiness: projectedTradeReadiness,
    components: Object.freeze(finalized),
    dependencies: Object.freeze(dependencies),
    rootBlockerComponentIds: Object.freeze(roots.map((component) => component.componentId)),
    operatorAttention: Object.freeze(operatorAttention.slice(0, 128)),
    revisions: Object.freeze({
      build: revisionValue('build'),
      config: revisionValue('config'),
      schema: revisionValue('schema'),
      model: revisionValue('model'),
    }),
  });
  assertProductSupervisorProjection(projection);
  return projection;
}
