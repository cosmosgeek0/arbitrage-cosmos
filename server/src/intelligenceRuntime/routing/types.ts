import type {
  NormalizedEvidence,
  SourceEndpointClass,
  StableFailure,
} from '../../intelligenceFoundation/contracts/index.js';
import type {
  BridgeEvidenceIngestReceipt,
  BridgeEvidenceScope,
  CorrelatedEvidenceBatch,
} from '../bridge/index.js';
import type {
  RuntimeAuthority,
  RuntimeClock,
  RuntimeLifecycleState,
  RuntimeRateBudgetState,
} from '../contracts/index.js';

export const VOLUME_EVIDENCE_CAPABILITIES = Object.freeze([
  'ROLLING_ACTIVITY_FLOW',
  'SPREAD_DEPTH_BOOK',
  'CROSS_MARKET_LEADERSHIP',
  'OPEN_INTEREST',
  'FUNDING',
  'VOLATILITY',
  'LIQUIDATION',
  'CONTEXT',
  'SOURCE_QUALITY',
] as const);

export type VolumeEvidenceCapability = (typeof VOLUME_EVIDENCE_CAPABILITIES)[number];

export type EvidenceRouteContinuity = 'CONTIGUOUS' | 'GAP' | 'UNKNOWN';

/**
 * One immutable cut from an already registered physical producer. The router
 * owns no transport and cannot spend this budget; it only refuses evidence
 * whose producer reports an exhausted public REST budget.
 */
export interface RegisteredEvidenceSourceCut {
  readonly sourceId: string;
  readonly dataset: string;
  readonly endpointClass: SourceEndpointClass;
  readonly lifecycle: RuntimeLifecycleState;
  readonly authority: RuntimeAuthority;
  readonly continuity: EvidenceRouteContinuity;
  readonly rateBudget: Readonly<RuntimeRateBudgetState>;
  readonly observedAtMs: number;
}

export interface RegisteredEvidenceBatch {
  readonly correlationId: string;
  readonly scope: BridgeEvidenceScope;
  readonly source: Readonly<RegisteredEvidenceSourceCut>;
  readonly evidence: readonly Readonly<NormalizedEvidence>[];
  readonly qualityFailures?: readonly Readonly<StableFailure>[];
}

export interface RegisteredEvidenceSink {
  ingest(batch: CorrelatedEvidenceBatch): Readonly<BridgeEvidenceIngestReceipt>;
}

export interface VolumeEvidenceRouterOptions {
  readonly clock: RuntimeClock;
  readonly sink: RegisteredEvidenceSink;
  readonly maximumBatch?: number;
  readonly maximumSeries?: number;
  readonly maximumFailureRecords?: number;
}

export type EvidenceRouteState =
  | 'FRESH'
  | 'STALE'
  | 'SAMPLED'
  | 'MISSING'
  | 'REJECTED'
  | 'RATE_LIMITED'
  | 'SEQUENCE_GAP'
  | 'OUT_OF_ORDER';

export interface RegisteredEvidenceRouteReceipt {
  readonly correlationId: string;
  readonly state: EvidenceRouteState;
  readonly received: number;
  readonly routed: number;
  readonly duplicate: number;
  readonly rejected: number;
  readonly failures: readonly Readonly<StableFailure>[];
}

export interface VolumeEvidenceCapabilityTruth {
  readonly capability: VolumeEvidenceCapability;
  readonly freshness: 'FRESH' | 'STALE' | 'MISSING';
  readonly completeness: 'COMPLETE' | 'PARTIAL' | 'SAMPLED' | 'MISSING';
  readonly lastEvidenceTimeMs: number | null;
  readonly sourceIds: readonly string[];
  readonly reasonCodes: readonly string[];
}

export interface VolumeEvidenceRoutingSnapshot {
  readonly observedAtMs: number;
  readonly capabilities: readonly Readonly<VolumeEvidenceCapabilityTruth>[];
  readonly series: number;
  readonly maximumSeries: number;
  readonly routed: number;
  readonly duplicate: number;
  readonly rejected: number;
  readonly stale: number;
  readonly sampled: number;
  readonly rateLimited: number;
  readonly outOfOrder: number;
  readonly sequenceGaps: number;
  readonly failures: readonly Readonly<StableFailure>[];
  readonly authority: 'EVIDENCE_ONLY';
  readonly liveMoneyAuthority: 'NONE';
}
