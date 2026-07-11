import type {
  ComponentDescriptor,
  TopologyEdge,
  TopologyEdgeType,
  TopologySnapshot,
  TruthMetadata,
  ValidationResult,
} from '../contracts/index.js';
import type { TopologyBounds } from './config.js';

export const TOPOLOGY_DESIRED_STATES = ['LIBRARY_AVAILABLE', 'RUNTIME_WIRED'] as const;
export type TopologyDesiredState = (typeof TOPOLOGY_DESIRED_STATES)[number];

/**
 * This lane has no runtime observer. These states deliberately cannot claim
 * RUNNING, HEALTHY, CONNECTED, or any other live condition.
 */
export const TOPOLOGY_OBSERVED_STATES = ['LIBRARY_AVAILABLE', 'NOT_WIRED', 'UNAVAILABLE'] as const;
export type TopologyObservedState = (typeof TOPOLOGY_OBSERVED_STATES)[number];

export const TOPOLOGY_BLOCKING_REASONS = ['NOT_WIRED', 'UNAVAILABLE'] as const;

export interface TopologyBuildInput {
  nodes: readonly ComponentDescriptor[];
  edges: readonly TopologyEdge[];
  truth: TruthMetadata;
}

export type TopologyTraversalDirection = 'UPSTREAM' | 'DOWNSTREAM';

export interface TopologyTraversalQuery {
  startId: string;
  direction: TopologyTraversalDirection;
  edgeTypes?: readonly TopologyEdgeType[];
  maxDepth?: number;
}

export interface TopologyTraversalLevel {
  depth: number;
  nodeIds: string[];
  edgeIds: string[];
}

export interface TopologyTraversal {
  id: string;
  startId: string;
  direction: TopologyTraversalDirection;
  edgeTypes: TopologyEdgeType[];
  maxDepth: number;
  nodeIds: string[];
  edgeIds: string[];
  levels: TopologyTraversalLevel[];
  truncated: boolean;
  truth: TruthMetadata;
}

export type TopologyCycleScope = 'DEPENDENCIES' | 'TYPED_EDGES';

export interface TopologyCycleQuery {
  scope: TopologyCycleScope;
  edgeTypes?: readonly TopologyEdgeType[];
}

export interface TopologyCycle {
  id: string;
  scope: TopologyCycleScope;
  nodeIds: string[];
  edgeIds: string[];
  edgeTypes: TopologyEdgeType[];
  truth: TruthMetadata;
}

export interface TopologyCycleReport {
  id: string;
  scope: TopologyCycleScope;
  edgeTypes: TopologyEdgeType[];
  cycles: TopologyCycle[];
  truth: TruthMetadata;
}

export interface TopologyBlocker {
  id: string;
  targetId: string;
  blockedById: string;
  direct: boolean;
  reasonCodes: string[];
  path: string[];
  truth: TruthMetadata;
}

export interface TopologyBlockingReport {
  id: string;
  targetId: string;
  blocked: boolean;
  blockers: TopologyBlocker[];
  dependencyCycleIds: string[];
  truth: TruthMetadata;
}

export interface TopologyReadModel {
  snapshot(): TopologySnapshot;
  node(id: string): ComponentDescriptor | null;
  edge(id: string): TopologyEdge | null;
  nodes(): ComponentDescriptor[];
  edges(): TopologyEdge[];
  nodesByOwner(authoritativeOwner: string): ComponentDescriptor[];
  nodesByUiSurface(uiSurface: string): ComponentDescriptor[];
  nodesByObservedState(observedState: TopologyObservedState): ComponentDescriptor[];
  incomingEdges(nodeId: string, edgeTypes?: readonly TopologyEdgeType[]): ValidationResult<TopologyEdge[]>;
  outgoingEdges(nodeId: string, edgeTypes?: readonly TopologyEdgeType[]): ValidationResult<TopologyEdge[]>;
  directDependencies(nodeId: string): ValidationResult<ComponentDescriptor[]>;
  directDependents(nodeId: string): ValidationResult<ComponentDescriptor[]>;
  traverse(query: TopologyTraversalQuery): ValidationResult<TopologyTraversal>;
  cycles(query: TopologyCycleQuery): ValidationResult<TopologyCycleReport>;
  blocking(nodeId: string): ValidationResult<TopologyBlockingReport>;
  bounds(): TopologyBounds;
}

export type TopologyRegistryResult = ValidationResult<TopologyReadModel>;

export interface LibraryComponentSpec {
  key: string;
  name: string;
  responsibility: string;
  authoritativeOwner: string;
  dependencies: readonly LibraryComponentDependency[];
  inputs: readonly string[];
  outputs: readonly string[];
  uiSurface: string;
  safeControlsSupportedLater?: readonly string[];
}

export interface LibraryComponentDependency {
  key: string;
  type: TopologyEdgeType;
  label: string;
}

export interface IntelligenceTopologyCatalogOptions {
  observedAtMs: number;
  schemaVersion?: string;
  producerVersion?: string;
  configurationVersion?: string;
}
