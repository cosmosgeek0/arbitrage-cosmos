import type { ProcessingLagSnapshot } from '../lifecycle/index.js';
import type { FuturesRuntimeSnapshot } from '../futures/index.js';
import type { SpotRuntimeSnapshot } from '../spot/index.js';

export const CAPACITY_CHANNELS = Object.freeze([
  'SPOT_MINI_TICKER',
  'USD_M_BOOK_TICKER',
  'USD_M_MARK_FUNDING',
  'SPOT_AGG_TRADE',
  'SPOT_DEPTH_DELTA',
  'OPTIONAL_LIQUIDATION',
] as const);

export type CapacityChannel = (typeof CAPACITY_CHANNELS)[number];

export const CAPACITY_QUEUE_CLASSES = Object.freeze([
  'CORE_BROAD',
  'PROTECTED_FOCUS',
  'FOCUS',
  'OPTIONAL',
] as const);

export type CapacityQueueClass = (typeof CAPACITY_QUEUE_CLASSES)[number];

export const CAPACITY_OVERLOAD_STATES = Object.freeze([
  'NOMINAL',
  'PRESSURED',
  'OPTIONAL_SHED',
  'CORE_DEGRADED',
] as const);

export type CapacityOverloadState = (typeof CAPACITY_OVERLOAD_STATES)[number];

export const CAPACITY_MODEL_LIMITS = Object.freeze({
  symbolCount: 452,
  maximumDurationMs: 300_000,
  maximumTicks: 100_000,
  maximumRatePerSecond: 50_000,
  maximumSyntheticMessages: 1_000_000,
  maximumBurstWindows: 32,
  maximumBurstMultiplierBps: 200_000,
  maximumQueueCapacity: 16_384,
  maximumAggregateQueueCapacity: 65_536,
  maximumLagSamplesPerSource: 16_384,
  maximumFocusRequests: 128,
  maximumProtectedSymbols: 25,
  maximumMemoryRoots: 32,
  maximumMemoryNodes: 1_000_000,
  maximumMemoryDepth: 64,
  maximumMeasuredStringCodeUnitsPerValue: 16_777_216,
  maximumMeasuredStringCodeUnitsTotal: 67_108_864,
  maximumMeasuredBinaryBytes: 67_108_864,
  maximumTransitions: 512,
} as const);

export const CAPACITY_ATTENTION_CEILINGS = Object.freeze({
  WATCH: 452,
  CANDIDATE: 128,
  FOCUS: 25,
  DEEP_FOCUS: 10,
} as const);

export interface CapacityBurstWindow {
  channels: readonly CapacityChannel[];
  startOffsetMs: number;
  durationMs: number;
  /** 10,000 = 1x. Integer basis points avoid floating-point scheduling drift. */
  multiplierBps: number;
}

export interface CapacityFocusPlan {
  watchCount: number;
  candidateCount: number;
  focusRequestCount: number;
  deepFocusCount: number;
  focusCapacity: number;
  deepFocusCapacity: number;
  protectedSymbols: readonly string[];
}

export interface CapacityOverloadPolicy {
  pressureQueueBps: number;
  shedQueueBps: number;
  criticalQueueBps: number;
  recoveryQueueBps: number;
  pressureLagMs: number;
  shedLagMs: number;
  criticalLagMs: number;
  recoveryLagMs: number;
  recoveryTicks: number;
}

export interface CapacityWorkloadPlan {
  id: string;
  configurationVersion: 'capacity-model-1';
  symbolCount: 452;
  startTimeMs: number;
  durationMs: number;
  tickMs: number;
  ratesPerSecond: Readonly<Record<CapacityChannel, number>>;
  bursts: readonly CapacityBurstWindow[];
  queueCapacities: Readonly<Record<CapacityQueueClass, number>>;
  drainPerTick: Readonly<Record<CapacityQueueClass, number>>;
  focus: CapacityFocusPlan;
  lagSamplesPerSource: number;
  overload: CapacityOverloadPolicy;
}

export interface CapacityWorkloadPlanInput {
  startTimeMs?: number;
  durationMs?: number;
  tickMs?: number;
  ratesPerSecond?: Partial<Record<CapacityChannel, number>>;
  bursts?: readonly CapacityBurstWindow[];
  queueCapacities?: Partial<Record<CapacityQueueClass, number>>;
  drainPerTick?: Partial<Record<CapacityQueueClass, number>>;
  focus?: Partial<Omit<CapacityFocusPlan, 'protectedSymbols'>> & { protectedSymbols?: readonly string[] };
  lagSamplesPerSource?: number;
  overload?: Partial<CapacityOverloadPolicy>;
}

export interface CapacityChannelStats {
  generated: number;
  offered: number;
  shed: number;
  processed: number;
  processingFailures: number;
}

export interface CapacityQueueStats {
  queueClass: CapacityQueueClass;
  capacity: number;
  depthBeforeAudit: number;
  highWatermark: number;
  enqueued: number;
  dequeuedBeforeAudit: number;
  dropped: number;
  coalesced: number;
  overflow: number;
  resyncRequired: boolean;
  evictedReplaceable: number;
  ignoredOlder: number;
}

export interface CapacityFocusAllocation {
  symbol: string;
  tier: 'UNIVERSE' | 'WATCH' | 'CANDIDATE' | 'FOCUS' | 'DEEP_FOCUS';
  protected: boolean;
  focusRequested: boolean;
  focusDelivered: boolean;
  reasonCodes: readonly string[];
}

export interface CapacityFocusSnapshot {
  allocations: readonly CapacityFocusAllocation[];
  tierCounts: Readonly<Record<CapacityFocusAllocation['tier'], number>>;
  focusCapacity: number;
  deepFocusCapacity: number;
  rejectedFocusRequests: number;
  protectedCount: number;
  protectedPreserved: boolean;
}

export interface CapacityTransition {
  atMs: number;
  from: CapacityOverloadState;
  to: CapacityOverloadState;
  reasonCodes: readonly string[];
}

export interface CapacityMemoryRootEstimate {
  label: string;
  nodeCount: number;
  canonicalUtf8Bytes: number | null;
  modeledLowerBytes: number;
  modeledUpperBytes: number;
}

export interface CapacityMemoryEstimate {
  model: 'CAPACITY_RETAINED_GRAPH_V1';
  method: 'IDENTITY_DEDUPLICATED_GRAPH_WALK';
  roots: readonly CapacityMemoryRootEstimate[];
  nodeCount: number;
  sharedReferenceCount: number;
  stringUtf8Bytes: number;
  stringCodeUnits: number;
  modeledLowerBytes: number;
  modeledUpperBytes: number;
  lagRetainedSampleBytes: number;
  queueAuditDestructive: boolean;
  caveat: string;
}

export interface CapacityBroadStateSummary {
  requestedSymbols: 452;
  spotSymbols: number;
  futuresSymbols: number;
  quietSpotSymbolsRetained: number;
  spotRecentTrades: number;
  futuresLiquidations: number;
  depthSymbols: number;
  depthSequenceGaps: number;
}

export interface DeterministicCapacityReport {
  id: string;
  planId: string;
  scope: 'SYNTHETIC_DETERMINISTIC_LOCAL_MODEL';
  productionCapacityClaim: null;
  hostTiming: null;
  assumptions: readonly string[];
  generatedMessages: number;
  processedMessages: number;
  channelStats: Readonly<Record<CapacityChannel, CapacityChannelStats>>;
  queues: Readonly<Record<CapacityQueueClass, CapacityQueueStats>>;
  overloadState: CapacityOverloadState;
  transitions: readonly CapacityTransition[];
  transitionOverflowCount: number;
  optionalShedCount: number;
  nonProtectedFocusShedCount: number;
  lag: ProcessingLagSnapshot;
  percentileAlgorithm: 'NEAREST_RANK_CEIL_NQ_ON_BOUNDED_RECENT_RING';
  broadState: CapacityBroadStateSummary;
  focus: CapacityFocusSnapshot;
  memory: CapacityMemoryEstimate;
  spot: SpotRuntimeSnapshot;
  futures: FuturesRuntimeSnapshot;
  upstreamBoundNotes: readonly string[];
  liveMoneyAuthority: 'NONE';
}
