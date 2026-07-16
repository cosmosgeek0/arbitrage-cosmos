import {
  SYSTEM_COMPONENT_IDS,
  type SystemComponentId,
} from '../contracts/constants.js';

export interface SystemTopologyNode {
  readonly componentId: SystemComponentId;
  readonly requiresFreshSource: boolean;
  readonly shellCritical: boolean;
}

export interface SystemTopologyEdge {
  /** Dependency. */
  readonly from: SystemComponentId;
  /** Dependent capability. */
  readonly to: SystemComponentId;
  readonly required: boolean;
}

const FRESH_SOURCE_COMPONENTS = new Set<SystemComponentId>([
  'public-spot-source',
  'public-usdm-source',
  'market-universe',
  'intelligence-runtime',
  'market-intelligence',
  'q-inference',
  'basis-engine',
  'volume-engine',
]);

const SHELL_CRITICAL_COMPONENTS = new Set<SystemComponentId>([
  'ledger-persistence',
  'engine-supervisor',
]);

export const SYSTEM_TOPOLOGY_NODES: readonly Readonly<SystemTopologyNode>[] = Object.freeze(
  SYSTEM_COMPONENT_IDS.map((componentId) => Object.freeze({
    componentId,
    requiresFreshSource: FRESH_SOURCE_COMPONENTS.has(componentId),
    shellCritical: SHELL_CRITICAL_COMPONENTS.has(componentId),
  })),
);

/**
 * Canonical convergence graph. Edges point dependency -> dependent.
 * Optional edges retain degradation evidence without erasing an independent
 * engine or turning one unavailable public family into total app failure.
 */
export const SYSTEM_TOPOLOGY_EDGES: readonly Readonly<SystemTopologyEdge>[] = Object.freeze(([
  { from: 'ledger-persistence', to: 'public-spot-source', required: true },
  { from: 'ledger-persistence', to: 'public-usdm-source', required: true },
  { from: 'ledger-persistence', to: 'engine-supervisor', required: true },
  { from: 'public-spot-source', to: 'market-universe', required: true },
  { from: 'public-usdm-source', to: 'market-universe', required: false },
  { from: 'market-universe', to: 'intelligence-runtime', required: true },
  { from: 'public-spot-source', to: 'intelligence-runtime', required: true },
  { from: 'public-usdm-source', to: 'intelligence-runtime', required: false },
  { from: 'intelligence-runtime', to: 'market-intelligence', required: true },
  { from: 'market-intelligence', to: 'q-inference', required: true },
  { from: 'q-inference', to: 'basis-engine', required: false },
  { from: 'market-intelligence', to: 'basis-engine', required: true },
  { from: 'public-spot-source', to: 'basis-engine', required: true },
  { from: 'public-usdm-source', to: 'basis-engine', required: true },
  { from: 'q-inference', to: 'volume-engine', required: false },
  { from: 'market-intelligence', to: 'volume-engine', required: true },
  { from: 'public-spot-source', to: 'volume-engine', required: true },
  { from: 'market-intelligence', to: 'capital-supervision', required: true },
  { from: 'basis-engine', to: 'capital-supervision', required: false },
  { from: 'volume-engine', to: 'capital-supervision', required: false },
  { from: 'capital-supervision', to: 'multileg-risk', required: true },
  { from: 'multileg-risk', to: 'execution-coordinator-validate-only', required: true },
  { from: 'ledger-persistence', to: 'execution-coordinator-validate-only', required: true },
  { from: 'execution-coordinator-validate-only', to: 'reconciliation', required: true },
  { from: 'ledger-persistence', to: 'reconciliation', required: true },
] as const).map((edge) => Object.freeze(edge)));

export const SYSTEM_COMPONENT_ORDER: Readonly<Record<SystemComponentId, number>> = Object.freeze(
  Object.fromEntries(SYSTEM_COMPONENT_IDS.map((componentId, index) => [componentId, index])) as Record<SystemComponentId, number>,
);

export function dependenciesFor(componentId: SystemComponentId): readonly SystemComponentId[] {
  return Object.freeze(
    SYSTEM_TOPOLOGY_EDGES
      .filter((edge) => edge.to === componentId)
      .map((edge) => edge.from),
  );
}

export function dependentsFor(componentId: SystemComponentId): readonly SystemComponentId[] {
  return Object.freeze(
    SYSTEM_TOPOLOGY_EDGES
      .filter((edge) => edge.from === componentId)
      .map((edge) => edge.to),
  );
}
