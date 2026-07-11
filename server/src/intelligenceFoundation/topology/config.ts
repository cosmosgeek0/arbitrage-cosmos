export interface TopologyBounds {
  maxNodes: number;
  maxEdges: number;
  maxStringLength: number;
  maxListEntries: number;
  maxMetricsPerNode: number;
  maxTraversalDepth: number;
  maxTraversalResults: number;
  maxCycles: number;
}

export const DEFAULT_TOPOLOGY_BOUNDS: Readonly<TopologyBounds> = Object.freeze({
  maxNodes: 256,
  maxEdges: 2_048,
  maxStringLength: 256,
  maxListEntries: 256,
  maxMetricsPerNode: 128,
  maxTraversalDepth: 64,
  maxTraversalResults: 2_048,
  maxCycles: 256,
});

const BOUND_LIMITS: Readonly<TopologyBounds> = Object.freeze({
  maxNodes: 4_096,
  maxEdges: 32_768,
  maxStringLength: 4_096,
  maxListEntries: 4_096,
  maxMetricsPerNode: 1_024,
  maxTraversalDepth: 4_096,
  maxTraversalResults: 32_768,
  maxCycles: 4_096,
});

export function normalizeTopologyBounds(value: Partial<TopologyBounds> = {}): TopologyBounds | null {
  const merged: TopologyBounds = { ...DEFAULT_TOPOLOGY_BOUNDS, ...value };
  for (const key of Object.keys(DEFAULT_TOPOLOGY_BOUNDS) as Array<keyof TopologyBounds>) {
    const entry = merged[key];
    if (!Number.isSafeInteger(entry) || entry <= 0 || entry > BOUND_LIMITS[key]) return null;
  }
  return merged;
}
