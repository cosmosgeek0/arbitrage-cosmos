import type {
  SystemComponentId,
  SystemReadinessState,
} from '../contracts/constants.js';
import type {
  SystemComponentSnapshot,
  SystemDependencyEdge,
} from '../contracts/types.js';
import {
  SYSTEM_COMPONENT_ORDER,
  SYSTEM_TOPOLOGY_EDGES,
  SYSTEM_TOPOLOGY_NODES,
} from './topology.js';
import type {
  SystemAttentionItem,
  SystemRootCause,
  SystemRootCauseProjection,
  SystemRootCauseSeverity,
  SystemServiceReadinessComponentProjection,
} from './types.js';

const SEVERITY_RANK: Readonly<Record<SystemRootCauseSeverity, number>> = Object.freeze({
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
});

function componentProblem(component: SystemComponentSnapshot): boolean {
  if (component.desiredState === 'STOPPED'
      && component.phase === 'STOPPED'
      && component.readiness === 'STOPPED') return false;
  return component.readiness !== 'READY';
}

function hardUnavailable(component: SystemComponentSnapshot): boolean {
  return component.readiness === 'FAILED'
    || component.readiness === 'BLOCKED'
    || component.readiness === 'STOPPED'
    || component.truthLabel === 'UNAVAILABLE';
}

function degraded(component: SystemServiceReadinessComponentProjection): boolean {
  const lifecycleTruthIsNonAuthorizing = component.readiness === 'READY'
    && (component.serviceReadiness.basis === 'MANAGED_LIFECYCLE'
      || component.serviceReadiness.basis === 'VALIDATE_ONLY_EXECUTOR');
  return component.readiness === 'DEGRADED'
    || component.readiness === 'WARMING'
    || (!lifecycleTruthIsNonAuthorizing && component.truthLabel === 'UNKNOWN')
    || component.completeness === 'PARTIAL'
    || (component.freshness !== null && component.freshness.state !== 'FRESH');
}

function reasonCodes(component: SystemComponentSnapshot): readonly string[] {
  const values = [...component.blockerCodes];
  if (component.lastFailure) values.push(component.lastFailure.code);
  if (values.length === 0) {
    values.push(component.operatorAttentionRequired ? 'OPERATOR_ATTENTION_REQUIRED' : `READINESS_${component.readiness}`);
  }
  return Object.freeze([...new Set(values)].sort());
}

function severityFor(
  component: SystemComponentSnapshot,
  affected: readonly SystemComponentSnapshot[],
): SystemRootCauseSeverity {
  if (component.capitalExposed || affected.some((candidate) => candidate.capitalExposed)) return 'CRITICAL';
  const topology = SYSTEM_TOPOLOGY_NODES.find((node) => node.componentId === component.componentId);
  if (topology?.shellCritical && (component.readiness === 'FAILED' || component.readiness === 'BLOCKED')) return 'CRITICAL';
  if (component.readiness === 'FAILED' || component.readiness === 'BLOCKED' || component.truthLabel === 'UNAVAILABLE') return 'HIGH';
  if (component.readiness === 'DEGRADED' || component.truthLabel === 'UNKNOWN') return 'MEDIUM';
  return 'LOW';
}

function compareRootCause(left: SystemRootCause, right: SystemRootCause): number {
  return Number(right.capitalExposed) - Number(left.capitalExposed)
    || SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity]
    || SYSTEM_COMPONENT_ORDER[left.componentId] - SYSTEM_COMPONENT_ORDER[right.componentId]
    || left.componentId.localeCompare(right.componentId);
}

function compareAttention(left: SystemAttentionItem, right: SystemAttentionItem): number {
  return Number(right.capitalExposed) - Number(left.capitalExposed)
    || SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity]
    || SYSTEM_COMPONENT_ORDER[left.rootComponentId] - SYSTEM_COMPONENT_ORDER[right.rootComponentId]
    || SYSTEM_COMPONENT_ORDER[left.componentId] - SYSTEM_COMPONENT_ORDER[right.componentId];
}

/** Resolve a dependency cascade to the first upstream component with facts. */
function rootFor(
  componentId: SystemComponentId,
  components: ReadonlyMap<SystemComponentId, Readonly<SystemServiceReadinessComponentProjection>>,
  path: readonly SystemComponentId[] = [],
): { root: SystemComponentId; path: readonly SystemComponentId[] } {
  if (path.includes(componentId)) return { root: componentId, path: Object.freeze([...path, componentId]) };
  const component = components.get(componentId);
  if (!component) return { root: componentId, path: Object.freeze([...path, componentId]) };
  // A concrete local failure is authoritative and must not be overwritten by
  // a coincidentally unhealthy dependency.
  if (component.lastFailure) return { root: componentId, path: Object.freeze([...path, componentId]) };

  const blockedDependencies = SYSTEM_TOPOLOGY_EDGES
    .filter((edge) => edge.to === componentId && edge.required)
    .map((edge) => components.get(edge.from))
    .filter((candidate): candidate is Readonly<SystemServiceReadinessComponentProjection> => Boolean(candidate))
    .filter((candidate) => hardUnavailable(candidate) || degraded(candidate))
    .sort((left, right) => SYSTEM_COMPONENT_ORDER[left.componentId] - SYSTEM_COMPONENT_ORDER[right.componentId]);
  const first = blockedDependencies[0];
  if (first) return rootFor(first.componentId, components, [...path, componentId]);
  return { root: componentId, path: Object.freeze([...path, componentId]) };
}

function edgeState(
  edge: { readonly from: SystemComponentId; readonly to: SystemComponentId; readonly required: boolean },
  dependency: SystemServiceReadinessComponentProjection,
): SystemDependencyEdge['state'] {
  if (hardUnavailable(dependency)) return edge.required ? 'BLOCKED' : 'DEGRADED';
  if (degraded(dependency)) return 'DEGRADED';
  return dependency.readiness === 'READY' ? 'AVAILABLE' : 'UNKNOWN';
}

export function projectRootCauses(
  inputComponents: readonly Readonly<SystemServiceReadinessComponentProjection>[],
): Readonly<SystemRootCauseProjection> {
  const components = new Map(inputComponents.map((component) => [component.componentId, component]));
  const rootByComponent = new Map<SystemComponentId, { root: SystemComponentId; path: readonly SystemComponentId[] }>();
  for (const component of inputComponents) {
    if (componentProblem(component)) rootByComponent.set(component.componentId, rootFor(component.componentId, components));
  }

  const edges: SystemDependencyEdge[] = SYSTEM_TOPOLOGY_EDGES.map((edge) => {
    const dependency = components.get(edge.from);
    if (!dependency) {
      return Object.freeze({
        ...edge,
        state: 'UNKNOWN' as const,
        rootBlockerComponentId: edge.from,
        reasonCodes: Object.freeze(['DEPENDENCY_SNAPSHOT_MISSING']),
      });
    }
    const state = edgeState(edge, dependency);
    const root = state === 'AVAILABLE' ? null : rootFor(edge.from, components).root;
    return Object.freeze({
      ...edge,
      state,
      rootBlockerComponentId: root,
      reasonCodes: state === 'AVAILABLE' ? Object.freeze([]) : reasonCodes(dependency),
    });
  });

  const grouped = new Map<SystemComponentId, { paths: SystemComponentId[][]; affected: Set<SystemComponentId> }>();
  for (const [componentId, resolved] of rootByComponent) {
    const current = grouped.get(resolved.root) ?? { paths: [], affected: new Set<SystemComponentId>() };
    current.paths.push([...resolved.path].reverse());
    current.affected.add(componentId);
    grouped.set(resolved.root, current);
  }

  const rootCauses: SystemRootCause[] = [];
  for (const [rootId, groupedRoot] of grouped) {
    const root = components.get(rootId);
    if (!root) continue;
    // Only components whose own resolved dependency path ends at this root are
    // affected. Traversing every optional edge would let an unrelated failure
    // inherit exposed-capital severity from another branch.
    const affected = [...new Set([rootId, ...groupedRoot.affected])]
      .map((componentId) => components.get(componentId))
      .filter((component): component is Readonly<SystemServiceReadinessComponentProjection> => component !== undefined)
      .filter(componentProblem)
      .sort((left, right) => SYSTEM_COMPONENT_ORDER[left.componentId] - SYSTEM_COMPONENT_ORDER[right.componentId]);
    const path = groupedRoot.paths.sort((left, right) => left.length - right.length || left.join('|').localeCompare(right.join('|')))[0] ?? [rootId];
    rootCauses.push(Object.freeze({
      componentId: rootId,
      severity: severityFor(root, affected),
      reasonCodes: reasonCodes(root),
      failure: root.lastFailure ? Object.freeze({ ...root.lastFailure }) : null,
      dependencyPath: Object.freeze(path),
      affectedComponentIds: Object.freeze(affected.map((component) => component.componentId)),
      capitalExposed: root.capitalExposed || affected.some((component) => component.capitalExposed),
    }));
  }
  rootCauses.sort(compareRootCause);

  const rootMap = new Map(rootCauses.map((root) => [root.componentId, root]));
  const attentionQueue: SystemAttentionItem[] = [];
  for (const component of inputComponents) {
    if (!componentProblem(component) && !component.operatorAttentionRequired) continue;
    const resolved = rootByComponent.get(component.componentId) ?? { root: component.componentId, path: [component.componentId] };
    const root = rootMap.get(resolved.root);
    const severity = root?.severity ?? severityFor(component, [component]);
    attentionQueue.push(Object.freeze({
      componentId: component.componentId,
      rootComponentId: resolved.root,
      severity,
      reasonCodes: root?.reasonCodes ?? reasonCodes(component),
      capitalExposed: root?.capitalExposed ?? component.capitalExposed,
      recommendedOperatorAction: root?.failure?.recommendedOperatorAction ?? component.lastFailure?.recommendedOperatorAction ?? null,
    }));
  }
  attentionQueue.sort(compareAttention);

  const firstRequiredRoot = rootCauses.find((root) => (
    root.affectedComponentIds.some((componentId) => (
      components.get(componentId)?.serviceReadiness.requiredForServiceReadiness === true
    ))
  ));
  const excluded = new Set(inputComponents
    .filter((component) => component.serviceReadiness.excludedFromServiceReadiness)
    .map((component) => component.componentId));
  const firstRequiredEdgeBlocker = edges.find((edge) => (
    edge.required
    && edge.state !== 'AVAILABLE'
    && !excluded.has(edge.from)
    && !excluded.has(edge.to)
  ));
  const firstRequiredComponentBlocker = inputComponents.find((component) => (
    component.serviceReadiness.requiredForServiceReadiness
    && component.readiness !== 'READY'
  ));
  // Full root causes intentionally omit desired STOPPED components. Service
  // readiness still needs a causal blocker identity whenever a RUNNING shell
  // has a required non-READY component or dependency edge.
  const firstRequiredReadinessBlockerComponentId = firstRequiredRoot?.componentId
    ?? firstRequiredEdgeBlocker?.rootBlockerComponentId
    ?? firstRequiredComponentBlocker?.componentId
    ?? null;

  return Object.freeze({
    components: Object.freeze([...inputComponents]),
    edges: Object.freeze(edges),
    rootCauses: Object.freeze(rootCauses),
    attentionQueue: Object.freeze(attentionQueue.slice(0, 100)),
    firstRootBlockerComponentId: rootCauses[0]?.componentId ?? null,
    firstRequiredReadinessBlockerComponentId,
  });
}

export function readinessSeverity(readiness: SystemReadinessState): SystemRootCauseSeverity | null {
  if (readiness === 'FAILED') return 'HIGH';
  if (readiness === 'BLOCKED') return 'HIGH';
  if (readiness === 'DEGRADED') return 'MEDIUM';
  if (readiness === 'WARMING' || readiness === 'STOPPED') return 'LOW';
  return null;
}
