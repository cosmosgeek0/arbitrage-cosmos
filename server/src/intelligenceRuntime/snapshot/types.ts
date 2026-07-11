import type {
  StableFailure,
  TopologyEdgeType,
  TopologySnapshot,
} from '../../intelligenceFoundation/contracts/index.js';
import type {
  RuntimeLifecycleState,
  RuntimeRateBudgetState,
  RuntimeSourceSnapshot,
} from '../contracts/index.js';
import type {
  BoundedQueueSnapshot,
  ProcessingLagSnapshot,
} from '../lifecycle/index.js';
import type { FuturesRuntimeSnapshot } from '../futures/index.js';
import type { SpotRuntimeSnapshot } from '../spot/index.js';
import type { RuntimeUniverseSnapshot } from '../universe/index.js';
import type { BaselineSchedulerSnapshot } from '../baseline/index.js';
import type { LocalBookSnapshot } from '../books/index.js';
import type { IntelligenceBridgeSnapshot } from '../bridge/index.js';
import type { CaptureCoordinatorSnapshot } from '../capture/index.js';
import type { DerivativesSnapshot } from '../derivatives/index.js';
import type { FocusAllocatorSnapshot } from '../focus/index.js';

export const RUNTIME_COMPONENT_KEYS = Object.freeze([
  'UNIVERSE',
  'SPOT_BROAD',
  'FUTURES_BROAD',
  'LIFECYCLE',
  'FOCUS',
  'BOOKS',
  'BASELINE',
  'DERIVATIVES',
  'BRIDGE',
  'CAPTURE',
  'SNAPSHOT',
] as const);

export type RuntimeComponentKey = (typeof RUNTIME_COMPONENT_KEYS)[number];
export type RuntimeCriticality = 'CORE' | 'PROTECTED' | 'FOCUSED' | 'OPTIONAL';
export type RuntimeAggregateDesiredState = 'RUNNING' | 'STOPPED';
export type RuntimeAggregateObservedState = 'STOPPED' | 'WARMING' | 'HEALTHY' | 'DEGRADED' | 'BLOCKED';
export type RuntimeReasonImpact = 'WARMING' | 'DEGRADED' | 'BLOCKED';

export const RUNTIME_SNAPSHOT_HARD_LIMITS = Object.freeze({
  maximumSources: 1_024,
  maximumReasons: 4_096,
  maximumTopologyNodes: 4_096,
  maximumTopologyEdges: 32_768,
  maximumTopologyBindings: 4_096,
  maximumUniverseNodes: 16_384,
  maximumSpotSymbols: 16_384,
  maximumFuturesSymbols: 16_384,
  maximumFocusRequirements: 16_384,
  maximumBooks: 8_192,
  maximumStringLength: 1_024,
  maximumSequenceGapStormThreshold: 1_000_000,
  maximumProcessingLagWarningMs: 24 * 60 * 60_000,
} as const);

export interface RuntimeSnapshotBounds {
  maximumSources: number;
  maximumReasons: number;
  maximumTopologyNodes: number;
  maximumTopologyEdges: number;
  maximumTopologyBindings: number;
  maximumStringLength: number;
}

export const DEFAULT_RUNTIME_SNAPSHOT_BOUNDS: Readonly<RuntimeSnapshotBounds> = Object.freeze({
  maximumSources: 128,
  maximumReasons: 256,
  maximumTopologyNodes: 256,
  maximumTopologyEdges: 1_024,
  maximumTopologyBindings: 256,
  maximumStringLength: 256,
});

export interface RuntimeSnapshotPolicyInput {
  bounds?: Partial<RuntimeSnapshotBounds>;
  requiredComponents?: readonly RuntimeComponentKey[];
  sequenceGapStormThreshold?: number;
  queueWarningFillRatio?: number;
  processingLagWarningMs?: number;
}

export interface RuntimeSourceOperationalInput {
  component: RuntimeComponentKey;
  capability: string;
  criticality: RuntimeCriticality;
  source: RuntimeSourceSnapshot;
  queue?: Readonly<BoundedQueueSnapshot> | null;
  lag?: Readonly<ProcessingLagSnapshot> | null;
}

export interface FocusRequirementInput {
  id: string;
  symbol: string;
  evidenceKind: string;
  protected: boolean;
  state: 'REUSED_BROAD' | 'REST_INTENT' | 'DESIRED' | 'SUBSCRIBING' | 'WARMING' | 'READY' | 'UNFULFILLED';
  reasonCodes: readonly string[];
}

export interface FocusRuntimeSnapshotInput {
  planId: string | null;
  observedAtMs: number;
  requirements: readonly FocusRequirementInput[];
  counts: Readonly<{
    requirements: number;
    readyRequirements: number;
    warmingRequirements: number;
    unfulfilledRequirements: number;
    pendingControlMessages: number;
    retainedByHysteresis: number;
  }>;
}

export type BaselineRuntimeState =
  | 'PENDING'
  | 'FETCHING'
  | 'RATE_LIMITED'
  | 'RETRY_WAIT'
  | 'INSUFFICIENT_HISTORY'
  | 'PARTIAL'
  | 'STALE'
  | 'COMPLETE'
  | 'UNAVAILABLE';

export interface BaselineRuntimeSnapshotInput {
  planId: string | null;
  observedAtMs?: number;
  snapshotTimeMs?: number;
  stateCounts: Readonly<Partial<Record<BaselineRuntimeState, number>>>;
  totals: Readonly<{
    items: number;
    records?: number;
    acceptedRecords?: number;
    batches: number;
    estimatedWeight: number;
    actualWeight: number;
  }>;
  restored: boolean;
  integrationGap: string | null;
  lastSuccessTimeMs?: number | null;
  lastError?: StableFailure | null;
}

export interface RuntimeBookInput {
  criticality?: RuntimeCriticality;
  sourceId: string;
  productFamily: 'SPOT' | 'USD_M_PERPETUAL';
  symbol: string;
  observedState: 'STOPPED' | 'BUFFERING' | 'WAITING_BRIDGE' | 'LIVE' | 'DEGRADED' | 'STALE';
  freshnessState: 'FRESH' | 'STALE' | 'UNAVAILABLE';
  snapshotTimeMs: number;
  temporal: Readonly<{
    knowledgeTimeMs: number | null;
    receiveAgeMs: number | null;
    sourceAgeMs: number | null;
    processingLagMs: number | null;
  }>;
  completeness: Readonly<{
    state: 'COMPLETE' | 'PARTIAL' | 'MISSING';
    sequenceComplete: boolean;
    bothSidesPresent: boolean;
    retentionTruncated: boolean;
    reasonCodes: readonly string[];
  }>;
  counters: Readonly<{
    sequenceGapCount: number;
    resyncCount: number;
    droppedCount: number;
    duplicateCount: number;
    outOfOrderCount: number;
    invalidCount: number;
  }>;
  pendingResyncRequest: Readonly<{ id: string; reason: string }> | null;
  lastFailure: StableFailure | null;
}

export interface DerivativesRuntimeSnapshotInput {
  observedAtMs: number;
  facts: Readonly<{
    total: number;
    fresh: number;
    stale: number;
    unavailable: number;
    optionalUnavailable: number;
    lastSuccessTimeMs: number | null;
  }>;
  rateBudgets: readonly Readonly<{ sourceId: string; budget: RuntimeRateBudgetState }>[];
  lastError: StableFailure | null;
}

export interface RuntimeDerivativesFactsSummary {
  total: number;
  fresh: number;
  stale: number;
  unavailable: number;
  optionalUnavailable: number;
  lastSuccessTimeMs: number | null;
}

export interface CaptureRuntimeSnapshotInput {
  observedAtMs: number;
  activeCaptures: number;
  completedCaptures: number;
  incompleteCaptures: number;
  truncatedCaptures: number;
  evictedCaptures: number;
  checkpointState: 'UNAVAILABLE' | 'LOADED' | 'SAVED' | 'FAILED';
  lastSuccessTimeMs: number | null;
  lastError: StableFailure | null;
}

export interface BridgeAttentionAllocationInput {
  symbol: string;
  protected: boolean;
  requestedEvidence: readonly string[];
}

export interface BridgeRuntimeSnapshotInput {
  snapshotTimeMs: number;
  universeNodeCount: number;
  publicAttention: Readonly<{
    allocations: readonly BridgeAttentionAllocationInput[];
    excludedPrivateEvidenceCount: number;
  }> | null;
  evidenceIndex: Readonly<{
    size: number;
    capacity: number;
    duplicateCount: number;
    evictedCount: number;
  }>;
  failureCount: number;
  lastSuccessTimeMs: number | null;
  lastError: StableFailure | null;
}

export interface RuntimeSnapshotInput {
  snapshotTimeMs: number;
  configurationVersion: string;
  sources: readonly RuntimeSourceOperationalInput[];
  universe: RuntimeUniverseSnapshot | null;
  spot: SpotRuntimeSnapshot | null;
  futures: FuturesRuntimeSnapshot | null;
  focus?: FocusRuntimeSnapshotInput | FocusAllocatorSnapshot | null;
  books?: readonly (RuntimeBookInput | LocalBookSnapshot)[];
  baseline?: BaselineRuntimeSnapshotInput | BaselineSchedulerSnapshot | null;
  derivatives?: DerivativesRuntimeSnapshotInput | DerivativesSnapshot | null;
  bridge?: BridgeRuntimeSnapshotInput | IntelligenceBridgeSnapshot | null;
  capture?: CaptureRuntimeSnapshotInput | CaptureCoordinatorSnapshot | null;
  foundationTopology?: TopologySnapshot | null;
  policy?: RuntimeSnapshotPolicyInput;
}

export interface RuntimeHealthReason {
  id: string;
  severity: 'BLOCKING' | 'WARNING';
  impact: RuntimeReasonImpact;
  code: string;
  component: RuntimeComponentKey;
  sourceId: string | null;
  message: string;
  recommendedAction: string;
  observedAtMs: number | null;
}

export interface RuntimeSourceView {
  sourceId: string;
  component: RuntimeComponentKey;
  capability: string;
  criticality: RuntimeCriticality;
  transportKind: RuntimeSourceSnapshot['transportKind'];
  productFamily: RuntimeSourceSnapshot['productFamily'];
  endpointClass: RuntimeSourceSnapshot['endpointClass'];
  desiredState: RuntimeSourceSnapshot['desiredState'];
  observedState: RuntimeLifecycleState;
  authority: RuntimeSourceSnapshot['authority'];
  completeness: RuntimeSourceSnapshot['completeness'];
  connectionGeneration: number;
  messageAgeMs: number | null;
  processingLagMs: number | null;
  lastSuccessTimeMs: number | null;
  lastError: RuntimeSourceSnapshot['lastError'];
  recommendedAction: string;
  counters: Readonly<{
    invalid: number;
    duplicate: number;
    outOfOrder: number;
    sequenceGap: number;
    dropped: number;
    coalesced: number;
    reconnect: number;
  }>;
  queue: Readonly<BoundedQueueSnapshot> | null;
  rateBudget: RuntimeRateBudgetState;
}

export interface RuntimeUniverseCoverageSummary {
  total: number;
  visible: number;
  withSpot: number;
  withFutures: number;
  paired: number;
  focusEligible: number;
  focusIneligible: number;
  focusUnknown: number;
  publicAvailable: number;
  publicPartial: number;
  publicUnavailable: number;
  publicUnknown: number;
  spotSourceState: string;
  futuresSourceState: string;
}

export interface RuntimeMarketCoverageSummary {
  universeExpected: number;
  retainedSymbols: number;
  freshTicker: number;
  freshBook: number;
  freshTrade: number;
  freshMark: number;
  fundingKnown: number;
  fundingIntervalKnown: number;
  contractKnown: number;
  staleOrPriorGeneration: number;
}

export interface RuntimeFocusCoverageSummary {
  focusedSymbols: number;
  allocations: number;
  requestedEvidence: number;
  deliveredEvidence: number;
  requirements: number;
  ready: number;
  warming: number;
  unfulfilled: number;
  protectedUnfulfilled: number;
  pendingControlMessages: number;
}

export interface RuntimeBaselineSummary {
  total: number;
  complete: number;
  pending: number;
  fetching: number;
  partial: number;
  stale: number;
  insufficientHistory: number;
  unavailable: number;
  rateLimited: number;
  retryWaiting: number;
  completionRatio: number | null;
  records: number;
  actualWeight: number;
}

export interface RuntimeBookSummary {
  total: number;
  live: number;
  warming: number;
  degraded: number;
  stale: number;
  complete: number;
  pendingResync: number;
  sequenceGaps: number;
  resyncs: number;
  drops: number;
}

export interface RuntimeCaptureSummary {
  state: 'UNAVAILABLE' | 'IDLE' | 'ACTIVE' | 'DEGRADED';
  active: number;
  complete: number;
  incomplete: number;
  truncated: number;
  evicted: number;
  checkpointState: CaptureRuntimeSnapshotInput['checkpointState'];
}

export interface RuntimeOperationsSummary {
  sources: number;
  sourceStates: Readonly<Record<RuntimeLifecycleState, number>>;
  queueDepth: number;
  queueCapacity: number;
  queueHighWatermark: number;
  queueDrops: number;
  queueCoalesces: number;
  queueOverflows: number;
  queuesRequiringResync: number;
  sourceSequenceGaps: number;
  bookSequenceGaps: number;
  processingLagWorstP95Ms: number | null;
  processingLagWorstP99Ms: number | null;
  restBudgets: Readonly<{
    available: number;
    nearLimit: number;
    exhausted: number;
    cooldown: number;
    unknown: number;
    worstUtilization: number | null;
  }>;
}

export interface RuntimeComponentView {
  id: string;
  key: RuntimeComponentKey;
  name: string;
  desiredState: RuntimeAggregateDesiredState;
  observedState: RuntimeAggregateObservedState;
  criticality: RuntimeCriticality;
  lastSuccessTimeMs: number | null;
  lastErrorCode: string | null;
  blockerIds: readonly string[];
  warningIds: readonly string[];
  metrics: readonly Readonly<{ name: string; value: number | string | boolean | null; unit: string }>[];
}

export interface RuntimeTopologyNode {
  id: string;
  kind: 'COMPONENT' | 'SOURCE';
  key: string;
  label: string;
  component: RuntimeComponentKey;
  desiredState: RuntimeAggregateDesiredState;
  observedState: RuntimeAggregateObservedState;
  blockerIds: readonly string[];
  warningIds: readonly string[];
}

export interface RuntimeTopologyEdge {
  id: string;
  from: string;
  to: string;
  type: TopologyEdgeType;
  label: string;
}

export interface RuntimeFoundationBinding {
  id: string;
  runtimeNodeId: string;
  foundationNodeId: string;
  relation: 'RUNTIME_INPUT_TO_STATIC_LIBRARY';
  foundationNodePresent: boolean;
}

export interface RuntimeTopologyView {
  nodes: readonly RuntimeTopologyNode[];
  edges: readonly RuntimeTopologyEdge[];
  bindings: readonly RuntimeFoundationBinding[];
  foundationCatalog: Readonly<{
    snapshotId: string | null;
    supplied: boolean;
    nodeCount: number;
    edgeCount: number;
    retainedNodeCount: number;
    retainedEdgeCount: number;
    truncatedNodes: number;
    truncatedEdges: number;
    staticObservedStatesPreserved: true;
  }>;
  truncatedNodes: number;
  truncatedEdges: number;
  truncatedBindings: number;
  referentialIntegrity: true;
}

export interface RuntimeLastErrorView {
  component: RuntimeComponentKey;
  sourceId: string | null;
  code: string;
  message: string;
  retryable: boolean;
  observedAtMs: number | null;
}

export interface RuntimeIntelligenceSnapshot {
  id: string;
  schemaVersion: '1';
  configurationVersion: string;
  snapshotTimeMs: number;
  authority: 'READ_ONLY_DERIVED';
  mutationAuthority: 'NONE';
  desiredState: RuntimeAggregateDesiredState;
  observedState: RuntimeAggregateObservedState;
  lastSuccessTimeMs: number | null;
  lastError: RuntimeLastErrorView | null;
  blockers: readonly RuntimeHealthReason[];
  warnings: readonly RuntimeHealthReason[];
  blockerCount: number;
  warningCount: number;
  truncatedReasons: number;
  sources: readonly RuntimeSourceView[];
  truncatedSources: number;
  universe: RuntimeUniverseCoverageSummary;
  spot: RuntimeMarketCoverageSummary;
  futures: RuntimeMarketCoverageSummary;
  focus: RuntimeFocusCoverageSummary;
  baseline: RuntimeBaselineSummary;
  books: RuntimeBookSummary;
  derivatives: RuntimeDerivativesFactsSummary;
  capture: RuntimeCaptureSummary;
  operations: RuntimeOperationsSummary;
  components: readonly RuntimeComponentView[];
  topology: RuntimeTopologyView;
}
