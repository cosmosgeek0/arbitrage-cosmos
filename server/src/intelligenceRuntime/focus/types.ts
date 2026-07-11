import type {
  AttentionTier,
  EvidenceKind,
  InstrumentIdentity,
  ProductFamily,
} from '../../intelligenceFoundation/contracts/index.js';
import type { AttentionPlan } from '../../intelligenceFoundation/attention/index.js';
import type { RuntimeClock, ProtectedSymbolPort } from '../contracts/index.js';
import type { ControlThrottleSnapshot } from '../lifecycle/index.js';

export const FOCUS_ROUTES = ['SPOT_MARKET', 'USD_M_PUBLIC', 'USD_M_MARKET'] as const;
export type FocusRoute = (typeof FOCUS_ROUTES)[number];

export const FOCUS_CONNECTION_STATES = ['UNAVAILABLE', 'AVAILABLE'] as const;
export type FocusConnectionState = (typeof FOCUS_CONNECTION_STATES)[number];

export const FOCUS_STREAM_STATES = [
  'DESIRED',
  'SUBSCRIBING',
  'WARMING',
  'READY',
  'UNSUBSCRIBING',
] as const;
export type FocusStreamState = (typeof FOCUS_STREAM_STATES)[number];

export const FOCUS_REQUIREMENT_STATES = [
  'REUSED_BROAD',
  'REST_INTENT',
  'DESIRED',
  'SUBSCRIBING',
  'WARMING',
  'READY',
  'UNFULFILLED',
] as const;
export type FocusRequirementState = (typeof FOCUS_REQUIREMENT_STATES)[number];

export const FOCUS_REASON_CODES = [
  'REUSED_BROAD_SOURCE',
  'PUBLIC_REST_ENRICHMENT_REQUIRED',
  'WEBSOCKET_ALLOCATED',
  'WAITING_FOR_SUBSCRIBE_ACK',
  'WARMING_FIRST_MESSAGE',
  'PRIVATE_ENDPOINT_FORBIDDEN',
  'NO_ELIGIBLE_PRODUCT_LEG',
  'SOURCE_UNAVAILABLE',
  'STREAM_BUDGET_EXHAUSTED',
  'CONNECTION_BUDGET_EXHAUSTED',
  'CONTROL_RATE_DEFERRED',
  'CONTROL_ACK_TIMEOUT',
  'CONTROL_RETRY_EXHAUSTED',
  'PENDING_CONTROL_QUEUE_FULL',
  'LEASE_HYSTERESIS_ACTIVE',
  'PROTECTED_SYMBOL_NOT_IN_ATTENTION_PLAN',
  'PROTECTED_SYMBOL_UNRESOLVED',
  'ATTENTION_PLAN_UNAVAILABLE',
  'CAPABILITY_UNAVAILABLE',
  'INVALID_CAPABILITY',
] as const;
export type FocusReasonCode = (typeof FOCUS_REASON_CODES)[number];

export type FocusResourceTransport = 'WEBSOCKET' | 'REST' | 'REUSED_BROAD' | 'UNAVAILABLE';

/** Narrow bridge to the already-authoritative attention planner. */
export interface AttentionPlanPort {
  readAttentionPlan(observedAtMs: number): AttentionPlan | null;
}

export interface FocusInstrumentCapability {
  attentionInstrumentId: string;
  symbol: string;
  spot: InstrumentIdentity | null;
  usdMPerpetual: InstrumentIdentity | null;
}

/** Runtime-universe adapters implement this port; the allocator owns no instrument discovery. */
export interface FocusCapabilityPort {
  readCapabilities(observedAtMs: number): readonly FocusInstrumentCapability[];
}

export interface FocusDeliveredEvidence {
  attentionInstrumentId: string;
  productFamily: Extract<ProductFamily, 'SPOT' | 'USD_M_PERPETUAL'>;
  evidenceKind: EvidenceKind;
  sourceId: string;
  state: 'FRESH' | 'WARMING' | 'STALE' | 'UNAVAILABLE';
  observedAtMs: number;
}

/** Lets broad adapters satisfy focus requirements without duplicate subscriptions. */
export interface FocusDeliveryPort {
  readDeliveredEvidence(observedAtMs: number): readonly FocusDeliveredEvidence[];
}

export interface FocusRouteLimits {
  maximumConnections: number;
  maximumStreamsPerConnection: number;
  maximumControlMessagesPerInterval: number;
}

export interface FocusAllocatorConfig {
  maximumAttentionAllocations: number;
  maximumCapabilities: number;
  maximumProtectedSymbols: number;
  maximumRequirements: number;
  maximumRequirementsPerAllocation: number;
  maximumTotalStreams: number;
  maximumPendingControlMessages: number;
  maximumStreamsPerControlMessage: number;
  controlIntervalMs: number;
  minimumLeaseMs: number;
  resubscribeCooldownMs: number;
  controlAcknowledgementTimeoutMs: number;
  maximumControlRetries: number;
  routes: Readonly<Record<FocusRoute, Readonly<FocusRouteLimits>>>;
}

export type FocusAllocatorConfigInput = Partial<Omit<FocusAllocatorConfig, 'routes'>> & {
  routes?: Partial<Record<FocusRoute, Partial<FocusRouteLimits>>>;
};

export interface FocusAllocatorPorts {
  clock: RuntimeClock;
  attentionPlans: AttentionPlanPort;
  capabilities: FocusCapabilityPort;
  deliveries: FocusDeliveryPort;
  protectedSymbols: ProtectedSymbolPort;
}

export interface FocusConnectionUpdate {
  route: FocusRoute;
  connectionId: string;
  generation: number;
  state: FocusConnectionState;
}

export interface FocusControlAcknowledgement {
  route: FocusRoute;
  connectionId: string;
  generation: number;
  id: number;
  accepted: boolean;
  observedAtMs: number;
}

export interface FocusStreamObservation {
  route: FocusRoute;
  connectionId: string;
  generation: number;
  stream: string;
  observedAtMs: number;
}

export interface FocusControlBatch {
  id: number;
  route: FocusRoute;
  connectionId: string;
  generation: number;
  method: 'SUBSCRIBE' | 'UNSUBSCRIBE';
  params: readonly string[];
  createdAtMs: number;
}

export interface FocusRequirementSnapshot {
  id: string;
  attentionInstrumentId: string;
  symbol: string;
  productFamily: Extract<ProductFamily, 'SPOT' | 'USD_M_PERPETUAL'> | null;
  evidenceKind: EvidenceKind;
  tier: AttentionTier;
  priority: number | null;
  protected: boolean;
  transport: FocusResourceTransport;
  route: FocusRoute | null;
  streamOrPath: string | null;
  sourceId: string | null;
  state: FocusRequirementState;
  reasonCodes: readonly FocusReasonCode[];
  connectionId: string | null;
}

export interface FocusStreamSnapshot {
  resourceKey: string;
  route: FocusRoute;
  stream: string;
  sourceId: string;
  connectionId: string;
  generation: number;
  state: FocusStreamState;
  protected: boolean;
  ownerRequirementIds: readonly string[];
  leaseUntilMs: number;
  lastObservedAtMs: number | null;
}

export interface FocusConnectionSnapshot {
  route: FocusRoute;
  connectionId: string;
  generation: number;
  state: FocusConnectionState;
  allocatedStreams: number;
  maximumStreams: number;
  throttle: Readonly<ControlThrottleSnapshot>;
}

export interface FocusProtectedSymbolSnapshot {
  symbol: string;
  state: 'ALLOCATED' | 'PRESERVED' | 'UNRESOLVED';
  reasonCodes: readonly FocusReasonCode[];
}

export interface FocusAllocatorCounts {
  allocationsRead: number;
  requirements: number;
  reusedBroad: number;
  restIntents: number;
  websocketStreams: number;
  readyRequirements: number;
  warmingRequirements: number;
  unfulfilledRequirements: number;
  pendingControlMessages: number;
  retainedByHysteresis: number;
  cooldownDeferredRequirements: number;
}

export interface FocusAllocatorSnapshot {
  planId: string | null;
  lastAppliedPlanId: string | null;
  observedAtMs: number;
  reasonCodes: readonly FocusReasonCode[];
  protectedSymbols: readonly FocusProtectedSymbolSnapshot[];
  requirements: readonly FocusRequirementSnapshot[];
  streams: readonly FocusStreamSnapshot[];
  connections: readonly FocusConnectionSnapshot[];
  pendingControlMessages: readonly FocusControlBatch[];
  counts: Readonly<FocusAllocatorCounts>;
}

export interface FocusReconcileResult {
  snapshot: FocusAllocatorSnapshot;
  commands: readonly FocusControlBatch[];
}
