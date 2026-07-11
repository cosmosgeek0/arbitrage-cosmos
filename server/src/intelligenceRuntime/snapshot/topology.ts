import { stableId } from '../../intelligenceFoundation/contracts/index.js';
import { intelligenceComponentId } from '../../intelligenceFoundation/topology/index.js';
import type {
  RuntimeComponentKey,
  RuntimeComponentView,
  RuntimeFoundationBinding,
  RuntimeHealthReason,
  RuntimeSnapshotBounds,
  RuntimeSourceView,
  RuntimeTopologyEdge,
  RuntimeTopologyNode,
  RuntimeTopologyView,
} from './types.js';
import type { TopologySnapshot } from '../../intelligenceFoundation/contracts/index.js';

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function runtimeComponentId(key: RuntimeComponentKey): string {
  return stableId('runtime-component', { scope: 'intelligence_runtime', key });
}

function runtimeSourceNodeId(sourceId: string): string {
  return stableId('runtime-component', { scope: 'intelligence_runtime_source', sourceId });
}

function runtimeEdge(
  from: string,
  to: string,
  type: RuntimeTopologyEdge['type'],
  label: string,
): RuntimeTopologyEdge {
  return Object.freeze({
    id: stableId('runtime-topology-edge', { from, to, type, label }),
    from,
    to,
    type,
    label,
  });
}

function sourceObservedState(source: RuntimeSourceView): RuntimeTopologyNode['observedState'] {
  if (source.desiredState === 'STOPPED' && source.observedState === 'STOPPED') return 'STOPPED';
  if (source.observedState === 'CONNECTING' || source.observedState === 'WARMING') return 'WARMING';
  if (source.observedState === 'LIVE') return 'HEALTHY';
  if (
    (source.observedState === 'FAILED' || source.observedState === 'SILENT' || source.observedState === 'STALE')
    && (source.criticality === 'CORE' || source.criticality === 'PROTECTED')
  ) return 'BLOCKED';
  return 'DEGRADED';
}

const FOUNDATION_BINDINGS: Readonly<Record<RuntimeComponentKey, readonly string[]>> = Object.freeze({
  UNIVERSE: Object.freeze(['universe']),
  SPOT_BROAD: Object.freeze(['evidence']),
  FUTURES_BROAD: Object.freeze(['evidence']),
  LIFECYCLE: Object.freeze([]),
  FOCUS: Object.freeze(['attention']),
  BOOKS: Object.freeze(['evidence']),
  BASELINE: Object.freeze(['features']),
  DERIVATIVES: Object.freeze(['evidence']),
  BRIDGE: Object.freeze(['evidence', 'features', 'attention', 'thesis', 'forensics']),
  CAPTURE: Object.freeze(['outcomes']),
  SNAPSHOT: Object.freeze(['topology']),
});

const STATIC_EDGES: readonly Readonly<{
  from: RuntimeComponentKey;
  to: RuntimeComponentKey;
  type: RuntimeTopologyEdge['type'];
  label: string;
}>[] = Object.freeze([
  Object.freeze({ from: 'UNIVERSE', to: 'BRIDGE', type: 'DATA', label: 'joined universe identity' }),
  Object.freeze({ from: 'SPOT_BROAD', to: 'BRIDGE', type: 'EVIDENCE', label: 'normalized Spot evidence' }),
  Object.freeze({ from: 'FUTURES_BROAD', to: 'BRIDGE', type: 'EVIDENCE', label: 'normalized Futures evidence' }),
  Object.freeze({ from: 'FOCUS', to: 'BOOKS', type: 'ATTENTION', label: 'focused book requirements' }),
  Object.freeze({ from: 'FOCUS', to: 'DERIVATIVES', type: 'ATTENTION', label: 'focused context requirements' }),
  Object.freeze({ from: 'BOOKS', to: 'BRIDGE', type: 'EVIDENCE', label: 'focused depth evidence' }),
  Object.freeze({ from: 'BASELINE', to: 'BRIDGE', type: 'DATA', label: 'completed historical baseline' }),
  Object.freeze({ from: 'DERIVATIVES', to: 'BRIDGE', type: 'EVIDENCE', label: 'public derivatives context' }),
  Object.freeze({ from: 'BRIDGE', to: 'CAPTURE', type: 'EVIDENCE', label: 'outcome capture requests' }),
]);

export function buildRuntimeTopology(input: {
  components: readonly RuntimeComponentView[];
  sources: readonly RuntimeSourceView[];
  blockers: readonly RuntimeHealthReason[];
  warnings: readonly RuntimeHealthReason[];
  foundationTopology: TopologySnapshot | null;
  bounds: RuntimeSnapshotBounds;
}): RuntimeTopologyView {
  const foundationNodes = input.foundationTopology === null
    ? []
    : [...input.foundationTopology.nodes]
      .sort((left, right) => compareCodePoints(left.id, right.id))
      .slice(0, input.bounds.maximumTopologyNodes);
  const retainedFoundationNodeIds = new Set(foundationNodes.map((node) => node.id));
  const foundationEdges = input.foundationTopology === null
    ? []
    : [...input.foundationTopology.edges]
      .filter((edge) => retainedFoundationNodeIds.has(edge.from) && retainedFoundationNodeIds.has(edge.to))
      .sort((left, right) => compareCodePoints(left.from, right.from)
        || compareCodePoints(left.to, right.to)
        || compareCodePoints(left.type, right.type)
        || compareCodePoints(left.id, right.id))
      .slice(0, input.bounds.maximumTopologyEdges);
  const componentMap = new Map(input.components.map((component) => [component.key, component]));
  const blockersByComponent = new Map<RuntimeComponentKey, string[]>();
  const warningsByComponent = new Map<RuntimeComponentKey, string[]>();
  for (const reason of input.blockers) {
    const values = blockersByComponent.get(reason.component) ?? [];
    values.push(reason.id);
    blockersByComponent.set(reason.component, values);
  }
  for (const reason of input.warnings) {
    const values = warningsByComponent.get(reason.component) ?? [];
    values.push(reason.id);
    warningsByComponent.set(reason.component, values);
  }

  const componentNodes: RuntimeTopologyNode[] = input.components.map((component) => Object.freeze({
    id: component.id,
    kind: 'COMPONENT' as const,
    key: component.key,
    label: component.name,
    component: component.key,
    desiredState: component.desiredState,
    observedState: component.observedState,
    blockerIds: Object.freeze([...(blockersByComponent.get(component.key) ?? [])].sort(compareCodePoints)),
    warningIds: Object.freeze([...(warningsByComponent.get(component.key) ?? [])].sort(compareCodePoints)),
  }));

  const sourceNodes: RuntimeTopologyNode[] = input.sources.map((source) => Object.freeze({
    id: runtimeSourceNodeId(source.sourceId),
    kind: 'SOURCE' as const,
    key: source.sourceId,
    label: source.capability,
    component: source.component,
    desiredState: source.desiredState,
    observedState: sourceObservedState(source),
    blockerIds: Object.freeze(input.blockers
      .filter((reason) => reason.sourceId === source.sourceId)
      .map((reason) => reason.id)
      .sort(compareCodePoints)),
    warningIds: Object.freeze(input.warnings
      .filter((reason) => reason.sourceId === source.sourceId)
      .map((reason) => reason.id)
      .sort(compareCodePoints)),
  }));

  const allNodes = [...componentNodes, ...sourceNodes]
    .sort((left, right) => compareCodePoints(left.id, right.id));
  const retainedNodes = Object.freeze(allNodes.slice(0, input.bounds.maximumTopologyNodes));
  const retainedNodeIds = new Set(retainedNodes.map((node) => node.id));

  const edges: RuntimeTopologyEdge[] = [];
  for (const source of input.sources) {
    const from = runtimeSourceNodeId(source.sourceId);
    const to = runtimeComponentId(source.component);
    if (retainedNodeIds.has(from) && retainedNodeIds.has(to)) {
      edges.push(runtimeEdge(from, to, 'DATA', `${source.capability} source state`));
    }
  }
  for (const semantic of STATIC_EDGES) {
    const from = runtimeComponentId(semantic.from);
    const to = runtimeComponentId(semantic.to);
    if (componentMap.has(semantic.from) && componentMap.has(semantic.to) && retainedNodeIds.has(from) && retainedNodeIds.has(to)) {
      edges.push(runtimeEdge(from, to, semantic.type, semantic.label));
    }
  }
  const snapshotNode = runtimeComponentId('SNAPSHOT');
  for (const component of input.components) {
    if (component.key === 'SNAPSHOT') continue;
    const from = runtimeComponentId(component.key);
    if (retainedNodeIds.has(from) && retainedNodeIds.has(snapshotNode)) {
      edges.push(runtimeEdge(from, snapshotNode, 'DATA', 'read-only runtime status projection'));
    }
  }
  edges.sort((left, right) => compareCodePoints(left.from, right.from)
    || compareCodePoints(left.to, right.to)
    || compareCodePoints(left.type, right.type)
    || compareCodePoints(left.label, right.label)
    || compareCodePoints(left.id, right.id));
  const retainedEdges = Object.freeze(edges.slice(0, input.bounds.maximumTopologyEdges));

  const bindings: RuntimeFoundationBinding[] = [];
  let potentialBindingCount = 0;
  for (const component of input.components) {
    for (const foundationKey of FOUNDATION_BINDINGS[component.key]) {
      potentialBindingCount += 1;
      const foundationNodeId = intelligenceComponentId(foundationKey as Parameters<typeof intelligenceComponentId>[0]);
      if (!retainedNodeIds.has(component.id)) continue;
      if (input.foundationTopology !== null && !retainedFoundationNodeIds.has(foundationNodeId)) continue;
      bindings.push(Object.freeze({
        id: stableId('runtime-foundation-binding', {
          runtimeNodeId: component.id,
          foundationNodeId,
          relation: 'RUNTIME_INPUT_TO_STATIC_LIBRARY',
        }),
        runtimeNodeId: component.id,
        foundationNodeId,
        relation: 'RUNTIME_INPUT_TO_STATIC_LIBRARY' as const,
        foundationNodePresent: retainedFoundationNodeIds.has(foundationNodeId),
      }));
    }
  }
  bindings.sort((left, right) => compareCodePoints(left.runtimeNodeId, right.runtimeNodeId)
    || compareCodePoints(left.foundationNodeId, right.foundationNodeId));
  const retainedBindings = Object.freeze(bindings.slice(0, input.bounds.maximumTopologyBindings));

  return Object.freeze({
    nodes: retainedNodes,
    edges: retainedEdges,
    bindings: retainedBindings,
    foundationCatalog: Object.freeze({
      snapshotId: input.foundationTopology?.id ?? null,
      supplied: input.foundationTopology !== null,
      nodeCount: input.foundationTopology?.nodes.length ?? 0,
      edgeCount: input.foundationTopology?.edges.length ?? 0,
      retainedNodeCount: foundationNodes.length,
      retainedEdgeCount: foundationEdges.length,
      truncatedNodes: (input.foundationTopology?.nodes.length ?? 0) - foundationNodes.length,
      truncatedEdges: (input.foundationTopology?.edges.length ?? 0) - foundationEdges.length,
      staticObservedStatesPreserved: true as const,
    }),
    truncatedNodes: allNodes.length - retainedNodes.length,
    truncatedEdges: edges.length - retainedEdges.length,
    truncatedBindings: potentialBindingCount - retainedBindings.length,
    referentialIntegrity: true as const,
  });
}
