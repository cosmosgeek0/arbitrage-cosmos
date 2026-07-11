import type {
  Completeness,
  DataAuthority,
  FreshnessState,
  LegLifecycle,
  PlanId,
  ReconciliationRecommendation,
  ReconciliationStatus,
  Venue,
} from '../contracts/index.js';

export const OBSERVED_ORDER_STATUSES = [
  'NEW',
  'PARTIALLY_FILLED',
  'FILLED',
  'CANCELED',
  'REJECTED',
  'EXPIRED',
  'UNKNOWN',
] as const;
export type ObservedOrderStatus = (typeof OBSERVED_ORDER_STATUSES)[number];

export const OBSERVED_POSITION_SIDES = ['NET', 'BOTH', 'LONG', 'SHORT'] as const;
export type ObservedPositionSide = (typeof OBSERVED_POSITION_SIDES)[number];

/**
 * Metadata supplied by an injected private-data adapter. History coverage is
 * explicit because venue APIs can retain/query only a bounded time window.
 * `null` coverage is valid for point-in-time position snapshots, but it can
 * never prove a complete order/fill history window.
 */
export interface EvidenceSourceMetadata {
  sourceId: string;
  authority: DataAuthority;
  completeness: Completeness;
  sourceTimeMs: number | null;
  receivedAtMs: number;
  maxAgeMs: number;
  coverageStartMs: number | null;
  coverageEndMs: number | null;
}

export interface EvidenceCollection<T> {
  metadata: EvidenceSourceMetadata;
  /** `null` means unavailable. An authoritative empty result is `[]`. */
  records: readonly T[] | null;
}

/**
 * Exchange-normalized order evidence. Venue identifiers are strings on
 * purpose: coercing a 64-bit exchange ID through JavaScript number can lose
 * identity precision.
 */
export interface ObservedOrderEvidence {
  venue: Venue;
  symbol: string;
  clientOrderId: string;
  venueOrderId: string;
  side: 'BUY' | 'SELL';
  originalQuantity: number;
  cumulativeFilledQuantity: number;
  status: ObservedOrderStatus;
  reduceOnly: boolean | null;
  updatedAtMs: number;
}

/** A single trade/fill, identified by (venue, symbol, tradeId). */
export interface ObservedFillEvidence {
  venue: Venue;
  symbol: string;
  tradeId: string;
  /** Some venue trade-history responses omit the client order ID. */
  clientOrderId: string | null;
  venueOrderId: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  /** Unknown is null, never zero. */
  price: number | null;
  occurredAtMs: number;
}

/**
 * Point-in-time account position with a plan-start baseline. The reconciler
 * compares the observed delta; it never assumes a missing baseline is zero.
 */
export interface ObservedPositionEvidence {
  venue: Venue;
  symbol: string;
  positionSide: ObservedPositionSide;
  quantity: number;
  baselineQuantity: number | null;
  observedAtMs: number;
}

export interface ObservedEvidenceInput {
  orders: EvidenceCollection<ObservedOrderEvidence>;
  fills: EvidenceCollection<ObservedFillEvidence>;
  positions: EvidenceCollection<ObservedPositionEvidence>;
}

export type EvidenceKind = 'ORDERS' | 'FILLS' | 'POSITIONS';

export const NORMALIZATION_ISSUE_CODES = [
  'DUPLICATE_CLIENT_ORDER_ID',
  'DUPLICATE_VENUE_ORDER_ID',
  'CONFLICTING_FILL_IDENTITY',
  'CONFLICTING_POSITION_IDENTITY',
] as const;
export type NormalizationIssueCode = (typeof NORMALIZATION_ISSUE_CODES)[number];

/** A conflict is retained as explicit ambiguity; exact duplicates are only counted. */
export interface NormalizationIssue {
  code: NormalizationIssueCode;
  evidenceKind: EvidenceKind;
  identity: string;
  clientOrderIds: readonly string[];
  venueOrderIds: readonly string[];
  venues: readonly Venue[];
  symbols: readonly string[];
  detail: string;
}

export interface NormalizationStats {
  exactDuplicateOrdersDropped: number;
  exactDuplicateFillsDropped: number;
  exactDuplicatePositionsDropped: number;
  /** Number of adjacent input pairs whose canonical fill order was reversed. */
  outOfOrderFillPairs: number;
}

export interface NormalizedEvidenceCollection<T> {
  metadata: Readonly<EvidenceSourceMetadata>;
  freshness: FreshnessState;
  records: readonly Readonly<T>[] | null;
}

export interface NormalizedObservedEvidence {
  evaluatedAtMs: number;
  orders: NormalizedEvidenceCollection<ObservedOrderEvidence>;
  fills: NormalizedEvidenceCollection<ObservedFillEvidence>;
  positions: NormalizedEvidenceCollection<ObservedPositionEvidence>;
  issues: readonly Readonly<NormalizationIssue>[];
  stats: Readonly<NormalizationStats>;
}

export interface ReconciliationPolicy {
  /** Absolute per-venue quantity tolerance (e.g. exchange step rounding). */
  quantityTolerance: number;
  /** Difference allowed between normalized spot/perp exposure ratios. */
  normalizedHedgeTolerance: number;
}

export interface ReconciliationReason {
  code: string;
  status: ReconciliationStatus;
  detail: string;
  evidenceKind: EvidenceKind | null;
  phase: 'OPEN' | 'CLOSE' | null;
  legKey: 'SPOT' | 'PERP' | null;
}

export interface ReconciledLeg {
  phase: 'OPEN' | 'CLOSE';
  legKey: 'SPOT' | 'PERP';
  clientOrderId: string;
  venueOrderId: string | null;
  expectedLifecycle: LegLifecycle;
  expectedSubmittedQuantity: number;
  expectedFilledQuantity: number;
  observedOrderStatus: ObservedOrderStatus | null;
  observedOrderFilledQuantity: number | null;
  observedTradeFilledQuantity: number | null;
  observedFilledQuantity: number | null;
  observedRemainderQuantity: number | null;
  status: ReconciliationStatus;
  reasonCodes: readonly string[];
}

export interface VenuePositionComparison {
  venue: Venue;
  expectedDeltaQuantity: number;
  observedDeltaQuantity: number | null;
  differenceQuantity: number | null;
  status: ReconciliationStatus;
  reasonCodes: readonly string[];
}

export interface ReconciliationSourceReport {
  sourceId: string;
  sourceTimeMs: number | null;
  receivedAtMs: number;
  maxAgeMs: number;
  freshness: FreshnessState;
  authority: DataAuthority;
  completeness: Completeness;
  coverageStartMs: number | null;
  coverageEndMs: number | null;
  status: ReconciliationStatus;
  reasonCodes: readonly string[];
}

export interface ReconciliationResult {
  planId: PlanId;
  correlationId: string;
  evaluatedAtMs: number;
  status: ReconciliationStatus;
  recommendation: ReconciliationRecommendation;
  /** Hard proof that this return value carries no execution authority. */
  executionAuthority: 'NONE';
  reasons: readonly Readonly<ReconciliationReason>[];
  legs: readonly Readonly<ReconciledLeg>[];
  positions: readonly Readonly<VenuePositionComparison>[];
  sources: Readonly<{
    orders: ReconciliationSourceReport;
    fills: ReconciliationSourceReport;
    positions: ReconciliationSourceReport;
  }>;
  normalization: Readonly<NormalizationStats>;
}
