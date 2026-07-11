import { makeStableFailure } from '../contracts/index.js';
import type {
  ComponentDescriptor,
  TopologyEdge,
  TruthMetadata,
} from '../contracts/index.js';
import { createTopologyRegistry, topologyComponentId, topologyEdgeId } from './registry.js';
import type {
  IntelligenceTopologyCatalogOptions,
  LibraryComponentSpec,
  TopologyRegistryResult,
} from './types.js';

export const INTELLIGENCE_COMPONENT_KEYS = [
  'contracts',
  'evidence',
  'universe',
  'features',
  'attention',
  'thesis',
  'forensics',
  'outcomes',
  'topology',
] as const;

export type IntelligenceComponentKey = (typeof INTELLIGENCE_COMPONENT_KEYS)[number];

const COMPONENTS: readonly LibraryComponentSpec[] = [
  {
    key: 'contracts',
    name: 'Intelligence contract kernel',
    responsibility: 'Own deterministic intelligence data contracts, stable identities, validation, provenance, freshness, and missingness semantics.',
    authoritativeOwner: 'intelligenceFoundation/contracts',
    dependencies: [],
    inputs: ['injected source-shaped records', 'configuration and feature versions'],
    outputs: ['validated intelligence contracts', 'stable structured failures'],
    uiSurface: 'SYSTEM_MAP',
  },
  {
    key: 'evidence',
    name: 'Market evidence envelope',
    responsibility: 'Normalize and validate supplied Spot, Perpetual, derivatives, borrow, and contextual evidence without replacing source time.',
    authoritativeOwner: 'intelligenceFoundation/evidence',
    dependencies: [
      { key: 'contracts', type: 'DATA', label: 'contract and validation vocabulary' },
    ],
    inputs: ['official-shaped injected market records'],
    outputs: ['normalized evidence', 'data-quality failures'],
    uiSurface: 'DATA_QUALITY',
  },
  {
    key: 'universe',
    name: 'Full-universe coverage graph',
    responsibility: 'Join Spot, USD-M Perpetual, margin, borrow, eligibility, and coverage truth while retaining dormant symbols.',
    authoritativeOwner: 'intelligenceFoundation/universe',
    dependencies: [
      { key: 'contracts', type: 'DATA', label: 'instrument and truth contracts' },
    ],
    inputs: ['supplied instrument records', 'coverage observations'],
    outputs: ['deterministic universe graph', 'coverage and ineligibility reasons'],
    uiSurface: 'MARKETS',
  },
  {
    key: 'features',
    name: 'Multi-horizon feature bank',
    responsibility: 'Compute bounded per-symbol baselines and versioned multi-horizon market features from validated evidence.',
    authoritativeOwner: 'intelligenceFoundation/features',
    dependencies: [
      { key: 'contracts', type: 'DATA', label: 'feature and baseline contracts' },
      { key: 'evidence', type: 'EVIDENCE', label: 'validated normalized evidence' },
      { key: 'universe', type: 'DATA', label: 'instrument and coverage identity' },
    ],
    inputs: ['normalized evidence', 'universe instruments', 'injected evaluation time'],
    outputs: ['baseline states', 'versioned feature values'],
    uiSurface: 'VOLUME',
  },
  {
    key: 'attention',
    name: 'Attention budget planner',
    responsibility: 'Allocate bounded monitoring tiers deterministically without making strategy decisions or creating proposals.',
    authoritativeOwner: 'intelligenceFoundation/attention',
    dependencies: [
      { key: 'contracts', type: 'DATA', label: 'candidate and focus contracts' },
      { key: 'universe', type: 'ATTENTION', label: 'visible instruments and source quality' },
      { key: 'features', type: 'ATTENTION', label: 'candidate evidence and priority facts' },
    ],
    inputs: ['universe visibility', 'candidate hints', 'source quality', 'previous allocations'],
    outputs: ['focus allocations', 'enrichment requests', 'release reasons'],
    uiSurface: 'OPPORTUNITIES',
  },
  {
    key: 'thesis',
    name: 'Evidence thesis builder',
    responsibility: 'Build explainable hypotheses, market stage, supporting and conflicting evidence, and explicit unavailable facts.',
    authoritativeOwner: 'intelligenceFoundation/thesis',
    dependencies: [
      { key: 'contracts', type: 'DATA', label: 'thesis and market-stage contracts' },
      { key: 'evidence', type: 'EVIDENCE', label: 'normalized source evidence' },
      { key: 'universe', type: 'DATA', label: 'joined market identity' },
      { key: 'features', type: 'EVIDENCE', label: 'versioned feature facts' },
      { key: 'attention', type: 'ATTENTION', label: 'focused enrichment scope' },
    ],
    inputs: ['focused evidence', 'feature values', 'historical analogue IDs'],
    outputs: ['thesis packets', 'tradeability evidence'],
    uiSurface: 'OPPORTUNITIES',
  },
  {
    key: 'forensics',
    name: 'False-positive forensics',
    responsibility: 'Evaluate deterministic blocking and warning checks for manipulative, exhausted, market-wide, stale, or incomplete anomalies.',
    authoritativeOwner: 'intelligenceFoundation/forensics',
    dependencies: [
      { key: 'contracts', type: 'DATA', label: 'forensic verdict contracts' },
      { key: 'evidence', type: 'EVIDENCE', label: 'source evidence under review' },
      { key: 'features', type: 'EVIDENCE', label: 'response, persistence, and quality features' },
      { key: 'thesis', type: 'EVIDENCE', label: 'hypothesis being challenged' },
    ],
    inputs: ['thesis packet', 'normalized evidence', 'feature values'],
    outputs: ['PASS FAIL UNKNOWN checks', 'blocking and warning reasons'],
    uiSurface: 'FORENSICS',
  },
  {
    key: 'outcomes',
    name: 'Pre-event and outcome attribution',
    responsibility: 'Freeze trigger-time evidence without look-ahead and attach versioned later outcomes only after configured horizons.',
    authoritativeOwner: 'intelligenceFoundation/outcomes',
    dependencies: [
      { key: 'contracts', type: 'DATA', label: 'frozen-record and outcome contracts' },
      { key: 'evidence', type: 'EVIDENCE', label: 'trigger-time and later observations' },
      { key: 'features', type: 'EVIDENCE', label: 'trigger-time feature record' },
      { key: 'thesis', type: 'EVIDENCE', label: 'trigger-time thesis' },
      { key: 'forensics', type: 'EVIDENCE', label: 'trigger-time forensic checks' },
    ],
    inputs: ['trigger-time packet', 'later observations', 'configured horizons'],
    outputs: ['frozen pre-event records', 'outcome labels and metrics'],
    uiSurface: 'OUTCOMES',
  },
  {
    key: 'topology',
    name: 'Intelligence topology read model',
    responsibility: 'Produce a bounded render-ready catalog, typed dependency graph, deterministic traversals, cycles, and blocking reports.',
    authoritativeOwner: 'intelligenceFoundation/topology',
    dependencies: [
      { key: 'contracts', type: 'DATA', label: 'component and topology contracts' },
      { key: 'evidence', type: 'DATA', label: 'evidence component descriptor' },
      { key: 'universe', type: 'DATA', label: 'universe component descriptor' },
      { key: 'features', type: 'DATA', label: 'feature component descriptor' },
      { key: 'attention', type: 'DATA', label: 'attention component descriptor' },
      { key: 'thesis', type: 'DATA', label: 'thesis component descriptor' },
      { key: 'forensics', type: 'DATA', label: 'forensics component descriptor' },
      { key: 'outcomes', type: 'DATA', label: 'outcomes component descriptor' },
    ],
    inputs: ['component descriptors', 'typed topology edges'],
    outputs: ['topology snapshot', 'catalog queries', 'cycle and blocking reports'],
    uiSurface: 'SYSTEM_MAP',
  },
];

function boundedVersion(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
}

function makeTruth(input: {
  observedAtMs: number;
  schemaVersion: string;
  producerVersion: string;
  configurationVersion: string;
  dataset: string;
  sourceRecordIds: string[];
  transform: string;
}): TruthMetadata {
  return {
    schemaVersion: input.schemaVersion,
    producerVersion: input.producerVersion,
    configurationVersion: input.configurationVersion,
    featureVersion: null,
    authority: {
      kind: 'ENGINE_DERIVED',
      sourceId: 'intelligence-topology-library',
      dataset: input.dataset,
      endpointClass: 'INJECTED',
    },
    provenance: {
      sourceRecordIds: [...input.sourceRecordIds],
      sourceSet: ['intelligence-foundation-static-catalog'],
      transforms: [input.transform],
    },
    temporal: {
      sourceEventTimeMs: null,
      sourceTransactionTimeMs: null,
      receivedTimeMs: input.observedAtMs,
      sequence: null,
    },
    freshness: {
      basis: 'UNAVAILABLE',
      evaluatedAtMs: input.observedAtMs,
      ageMs: null,
      maxAgeMs: null,
      state: 'UNAVAILABLE',
    },
    completeness: {
      state: 'COMPLETE',
      observedFields: ['authority', 'dependencies', 'inputs', 'outputs', 'ownership', 'state', 'uiSurface'],
      missingFields: [],
      reasonCodes: ['STATIC_LIBRARY_CATALOG'],
    },
  };
}

export function createIntelligenceTopologyCatalog(
  options: IntelligenceTopologyCatalogOptions,
): TopologyRegistryResult {
  if (!options || !Number.isSafeInteger(options.observedAtMs) || options.observedAtMs < 0) {
    return {
      ok: false,
      failure: makeStableFailure(
        'INVALID_VALUE',
        'intelligence_topology',
        'catalog observation time must be an injected non-negative safe integer',
        'observedAtMs',
      ),
    };
  }
  const schemaVersion = options.schemaVersion ?? '1';
  const producerVersion = options.producerVersion ?? 'topology-library-1';
  const configurationVersion = options.configurationVersion ?? 'market-intelligence-topology-1';
  if (![schemaVersion, producerVersion, configurationVersion].every(boundedVersion)) {
    return {
      ok: false,
      failure: makeStableFailure(
        'INVALID_VALUE',
        'intelligence_topology',
        'catalog versions must be bounded non-empty strings',
        'versions',
      ),
    };
  }

  const componentIds = new Map(COMPONENTS.map((component) => [component.key, topologyComponentId(component.key)]));
  const nodes: ComponentDescriptor[] = COMPONENTS.map((component) => {
    const id = componentIds.get(component.key)!;
    const truth = makeTruth({
      observedAtMs: options.observedAtMs,
      schemaVersion,
      producerVersion,
      configurationVersion,
      dataset: `component-descriptor:${component.key}`,
      sourceRecordIds: [id],
      transform: 'render-ready-library-component-v1',
    });
    return {
      id,
      name: component.name,
      responsibility: component.responsibility,
      authoritativeOwner: component.authoritativeOwner,
      dependencyIds: component.dependencies.map((dependency) => componentIds.get(dependency.key)!).sort(),
      inputs: [...component.inputs],
      outputs: [...component.outputs],
      desiredState: 'RUNTIME_WIRED',
      observedState: 'LIBRARY_AVAILABLE',
      authority: { ...truth.authority },
      freshness: { ...truth.freshness },
      lastSuccessTimeMs: null,
      lastError: null,
      blockingReason: 'NOT_WIRED',
      metrics: [
        { name: 'library_available', value: true, unit: 'boolean' },
        { name: 'live_authority', value: 'NONE', unit: 'state' },
        { name: 'runtime_wired', value: false, unit: 'boolean' },
      ],
      safeControlsSupportedLater: [...(component.safeControlsSupportedLater ?? [])],
      uiSurface: component.uiSurface,
      truth,
    };
  });

  const edges: TopologyEdge[] = [];
  for (const component of COMPONENTS) {
    const to = componentIds.get(component.key)!;
    for (const dependency of component.dependencies) {
      const from = componentIds.get(dependency.key)!;
      const semantic = { from, to, type: dependency.type, label: dependency.label };
      const id = topologyEdgeId(semantic);
      edges.push({
        id,
        ...semantic,
        truth: makeTruth({
          observedAtMs: options.observedAtMs,
          schemaVersion,
          producerVersion,
          configurationVersion,
          dataset: 'topology-edge',
          sourceRecordIds: [id],
          transform: 'typed-library-edge-v1',
        }),
      });
    }
  }

  const snapshotTruth = makeTruth({
    observedAtMs: options.observedAtMs,
    schemaVersion,
    producerVersion,
    configurationVersion,
    dataset: 'topology-snapshot',
    sourceRecordIds: [...nodes.map((node) => node.id), ...edges.map((edge) => edge.id)],
    transform: 'bounded-topology-snapshot-v1',
  });
  return createTopologyRegistry({ nodes, edges, truth: snapshotTruth });
}

export function intelligenceComponentId(key: IntelligenceComponentKey): string {
  return topologyComponentId(key);
}
