import type {
  AttentionTier,
  CompletenessState,
  EvidenceKind,
  EvidencePolarity,
  FailureCode,
  ForensicVerdict,
  FreshnessBasis,
  FreshnessState,
  HypothesisClass,
  MarketStage,
  ProductFamily,
  SourceAuthorityKind,
  SourceEndpointClass,
  TopologyEdgeType,
} from './constants.js';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface SourceAuthority {
  kind: SourceAuthorityKind;
  sourceId: string;
  dataset: string;
  endpointClass: SourceEndpointClass;
}

export interface Provenance {
  sourceRecordIds: string[];
  sourceSet: string[];
  transforms: string[];
}

export interface SequenceRange {
  first: string;
  last: string;
  previous: string | null;
}

export interface TemporalMetadata {
  sourceEventTimeMs: number | null;
  sourceTransactionTimeMs: number | null;
  receivedTimeMs: number;
  sequence: SequenceRange | null;
}

export interface Freshness {
  basis: FreshnessBasis;
  evaluatedAtMs: number;
  ageMs: number | null;
  maxAgeMs: number | null;
  state: FreshnessState;
}

export interface Completeness {
  state: CompletenessState;
  observedFields: string[];
  missingFields: string[];
  reasonCodes: string[];
}

export interface TruthMetadata {
  schemaVersion: string;
  producerVersion: string;
  configurationVersion: string;
  featureVersion: string | null;
  authority: SourceAuthority;
  provenance: Provenance;
  temporal: TemporalMetadata;
  freshness: Freshness;
  completeness: Completeness;
}

export interface InstrumentIdentity {
  instrumentId: string;
  venue: 'BINANCE' | 'OTHER' | 'UNKNOWN';
  productFamily: ProductFamily;
  symbol: string;
  pair: string | null;
  baseAsset: string;
  quoteAsset: string | null;
  contractType: string | null;
  sourceMarketType: 1 | 2 | null;
}

export interface EvidenceBase {
  id: string;
  kind: EvidenceKind;
  instrument: InstrumentIdentity;
  truth: TruthMetadata;
}

export interface NormalizedTrade extends EvidenceBase {
  kind: 'TRADE';
  aggregateTradeId: string | null;
  firstTradeId: string | null;
  lastTradeId: string | null;
  price: number;
  baseQuantity: number;
  quoteQuantity: number;
  normalBaseQuantityExcludingRpi: number | null;
  aggressorSide: 'BUY' | 'SELL' | 'UNKNOWN';
}

export interface NormalizedBookTicker extends EvidenceBase {
  kind: 'BOOK_TICKER';
  updateId: string | null;
  bidPrice: number;
  bidQuantity: number;
  askPrice: number;
  askQuantity: number;
}

export interface DepthLevel {
  price: number;
  baseQuantity: number;
}

export type BookScope = 'STANDARD_NO_RPI' | 'RPI_INCLUDED' | 'UNKNOWN';

export interface NormalizedDepth extends EvidenceBase {
  kind: 'DEPTH_SNAPSHOT' | 'DEPTH_DELTA';
  bids: DepthLevel[];
  asks: DepthLevel[];
  bookScope: BookScope;
  maximumLevelsKnown: number | null;
}

export interface NormalizedMarkPrice extends EvidenceBase {
  kind: 'MARK_PRICE';
  markPrice: number;
  indexPrice: number | null;
  estimatedSettlementPrice: number | null;
  movingAverageMarkPrice: number | null;
}

export interface NormalizedFunding extends EvidenceBase {
  kind: 'FUNDING';
  fundingRate: number;
  fundingIntervalHours: number | null;
  nextFundingTimeMs: number | null;
  adjustedRateCap: number | null;
  adjustedRateFloor: number | null;
}

export interface NormalizedOpenInterest extends EvidenceBase {
  kind: 'OPEN_INTEREST';
  openInterestBase: number | null;
  openInterestQuoteValue: number | null;
  changeBase: number | null;
  changeQuoteValue: number | null;
  comparisonWindowMs: number | null;
}

export interface NormalizedLiquidation extends EvidenceBase {
  kind: 'LIQUIDATION';
  orderSide: 'BUY' | 'SELL';
  liquidatedPositionSide: 'LONG' | 'SHORT';
  orderType: string;
  timeInForce: string;
  originalQuantity: number;
  filledQuantity: number;
  averagePrice: number | null;
  /** True when the source publishes a lossy per-window selection rather than every liquidation. */
  sampledPerWindow: boolean;
  /** Selection semantics declared by the authoritative source for each sampling window. */
  samplingSelection: 'LARGEST_PER_SYMBOL' | 'LATEST_PER_SYMBOL' | 'UNKNOWN';
  sampleWindowMs: number | null;
}

export interface NormalizedBorrow extends EvidenceBase {
  kind: 'BORROW';
  asset: string;
  eligibility: 'ELIGIBLE' | 'INELIGIBLE' | 'UNKNOWN';
  availability: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';
  systemAvailableAmount: number | null;
  accountBorrowLimit: number | null;
  /** Decimal rate per hour: 0.00002 means 0.002% per hour. */
  hourlyInterestRateDecimal: number | null;
  inventoryAmount: number | null;
}

export interface NormalizedContext extends EvidenceBase {
  kind: 'CONTEXT';
  contextType: string;
  scope: 'SYMBOL' | 'SECTOR' | 'MARKET' | 'VENUE';
  values: Record<string, JsonPrimitive>;
}

export type NormalizedEvidence =
  | NormalizedTrade
  | NormalizedBookTicker
  | NormalizedDepth
  | NormalizedMarkPrice
  | NormalizedFunding
  | NormalizedOpenInterest
  | NormalizedLiquidation
  | NormalizedBorrow
  | NormalizedContext;

export interface FeatureValue {
  id: string;
  instrumentId: string;
  feature: string;
  featureVersion: string;
  value: number | string | boolean | null;
  unit: string;
  windowMs: number | null;
  observationStartMs: number | null;
  observationEndMs: number | null;
  truth: TruthMetadata;
}

export interface BaselineState {
  id: string;
  instrumentId: string;
  state: 'COLD_START' | 'INSUFFICIENT_HISTORY' | 'READY' | 'STALE';
  sampleCount: number;
  capacity: number;
  sessionBucket: string | null;
  normalActivity: FeatureValue[];
  deadActivity: FeatureValue[];
  truth: TruthMetadata;
}

export interface StrategyCandidateHint {
  id: string;
  strategy: 'basis' | 'volume_spike' | 'other';
  instrumentId: string;
  symbol: string;
  sourceState: 'WATCHING' | 'FOCUS' | 'PROPOSED' | 'ACTIVE' | 'COOLDOWN' | 'UNKNOWN';
  engineObservedAtMs: number;
  priority: number | null;
  reasonCodes: string[];
  protected: boolean;
  upstreamCorrelationId: string | null;
  truth: TruthMetadata;
}

export interface CandidateState {
  id: string;
  instrumentId: string;
  openedAtMs: number;
  updatedAtMs: number;
  reasonCodes: string[];
  score: number | null;
  hintIds: string[];
  truth: TruthMetadata;
}

export interface FocusState {
  id: string;
  instrumentId: string;
  tier: AttentionTier;
  enteredAtMs: number;
  lastChangedAtMs: number;
  protected: boolean;
  promotionReasons: string[];
  demotionReasons: string[];
  requestedEvidence: EvidenceKind[];
  requestedFeatures: string[];
  truth: TruthMetadata;
}

export interface AttentionRequest {
  id: string;
  instrumentId: string;
  fromTier: AttentionTier;
  toTier: AttentionTier;
  requestedEvidence: EvidenceKind[];
  requestedFeatures: string[];
  priority: number;
  reasonCodes: string[];
  createdAtMs: number;
  truth: TruthMetadata;
}

export interface ThesisEvidence {
  id: string;
  fact: string;
  polarity: EvidencePolarity;
  reasonCode: string;
  featureIds: string[];
  evidenceIds: string[];
  observationStartMs: number | null;
  observationEndMs: number | null;
  truth: TruthMetadata;
}

export interface TradeabilityEvidence {
  state: 'SUPPORTED' | 'BLOCKED' | 'UNKNOWN';
  reasonCodes: string[];
  requiredEvidenceIds: string[];
  missingEvidenceKinds: EvidenceKind[];
}

export interface ThesisPacket {
  id: string;
  instrumentId: string;
  hypothesis: HypothesisClass;
  stage: MarketStage;
  changedFirst: string | null;
  changedAtMs: number | null;
  leadMarket: 'SPOT' | 'PERPETUAL' | 'NEITHER' | 'UNKNOWN';
  supporting: ThesisEvidence[];
  conflicting: ThesisEvidence[];
  neutral: ThesisEvidence[];
  unavailable: ThesisEvidence[];
  tradeability: TradeabilityEvidence;
  analogueIds: string[];
  reasonCodes: string[];
  truth: TruthMetadata;
}

export interface ForensicCheck {
  id: string;
  check: string;
  verdict: ForensicVerdict;
  severity: 'BLOCK' | 'WARN';
  reasonCodes: string[];
  evidenceIds: string[];
  observationStartMs: number | null;
  observationEndMs: number | null;
  truth: TruthMetadata;
}

export interface FrozenPreEventRecord {
  readonly id: string;
  readonly triggerTimeMs: number;
  readonly evidenceCutoffTimeMs: number;
  readonly candidateDisposition: 'ACCEPTED' | 'REJECTED' | 'OBSERVED';
  readonly thesis: ThesisPacket;
  readonly forensics: readonly ForensicCheck[];
  readonly evidence: readonly NormalizedEvidence[];
  readonly features: readonly FeatureValue[];
  readonly configurationVersion: string;
  readonly featureVersion: string;
  readonly truth: TruthMetadata;
}

export interface OutcomeMetrics {
  forwardReturnPct: number | null;
  maximumFavorableExcursionPct: number | null;
  maximumAdverseExcursionPct: number | null;
  fadeFromPeakPct: number | null;
  timeToPeakMs: number | null;
  liquiditySurvivalRatio: number | null;
  depthSurvivalRatio: number | null;
  theoreticalExecutionFeasible: boolean | null;
}

export interface OutcomeLabel {
  id: string;
  frozenRecordId: string;
  horizonMs: number;
  observationTimeMs: number;
  state: 'COMPLETE' | 'INCOMPLETE';
  laterMoved: boolean | null;
  metrics: OutcomeMetrics;
  missingFields: string[];
  configurationVersion: string;
  featureVersion: string;
  truth: TruthMetadata;
}

export interface ComponentMetric {
  name: string;
  value: number | string | boolean | null;
  unit: string;
}

export interface ComponentDescriptor {
  id: string;
  name: string;
  responsibility: string;
  authoritativeOwner: string;
  dependencyIds: string[];
  inputs: string[];
  outputs: string[];
  desiredState: string;
  observedState: string;
  authority: SourceAuthority;
  freshness: Freshness;
  lastSuccessTimeMs: number | null;
  lastError: StableFailure | null;
  blockingReason: string | null;
  metrics: ComponentMetric[];
  safeControlsSupportedLater: string[];
  uiSurface: string;
  truth: TruthMetadata;
}

export interface TopologyEdge {
  id: string;
  from: string;
  to: string;
  type: TopologyEdgeType;
  label: string;
  truth: TruthMetadata;
}

export interface TopologySnapshot {
  id: string;
  nodes: ComponentDescriptor[];
  edges: TopologyEdge[];
  truth: TruthMetadata;
}

export interface StableFailure {
  id: string;
  code: FailureCode;
  component: string;
  message: string;
  retryable: boolean;
  field: string | null;
  evidenceIds: string[];
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: StableFailure };
