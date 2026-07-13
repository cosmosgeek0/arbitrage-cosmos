import type {
  BinanceInstrumentRegistrySnapshot,
  BindBinanceSpotOrderTifCapabilityResult,
  InstrumentSizingRequest,
  InstrumentSizingResult,
} from '../binanceInstrumentSpecs/types.js';
import type {
  BinanceRateBudgetState,
  BinanceRateReservationDecision,
} from '../binanceSignedKernel/rateBudget.js';
import type {
  MutationJournalSnapshot,
  SyntheticSubmissionBoundaryDecision,
} from '../durableMutationJournal/types.js';

export const EXCHANGE_TWIN_SCHEMA = 'LIVE_EDGE_EXCHANGE_TWIN_V1' as const;
export const EXCHANGE_TWIN_CHECKPOINT_SCHEMA = 'LIVE_EDGE_EXCHANGE_TWIN_CHECKPOINT_V1' as const;

export type TwinProduct = 'SPOT' | 'USD_M_PERPETUAL';
export type TwinSide = 'BUY' | 'SELL';
export type TwinOrderType = 'LIMIT' | 'MARKET';
export type TwinTimeInForce = 'GTC' | 'IOC' | 'FOK' | null;
export type TwinSymbolStatus = 'TRADING' | 'CANCEL_ONLY' | 'HALT' | 'BREAK' | 'END_OF_DAY' | 'UNKNOWN';
export type TwinBookTruth = 'AVAILABLE' | 'UNAVAILABLE' | 'GAPPED';
export type TwinLiquidityRole = 'MAKER' | 'TAKER';
export type TwinQueueTruth = 'ESTIMATED' | 'UNKNOWN';
export type TwinLocalTruth =
  | 'NOT_DISPATCHED'
  | 'DISPATCHED'
  | 'ACKNOWLEDGED'
  | 'UNKNOWN'
  | 'OBSERVED'
  | 'RECOVERY_REQUIRED';
export type TwinVenueStatus =
  | 'NOT_ARRIVED'
  | 'BLOCKED'
  | 'NEW'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELED'
  | 'EXPIRED';

export interface TwinLatencyProfile {
  readonly dispatchToVenueMs: number;
  readonly venueToHttpMs: number;
  readonly venueToPrivateMs: number;
}

export interface TwinCancelFixture {
  readonly schema: 'TWIN_CANCEL_FIXTURE_V1';
  readonly cancelFixtureId: string;
  readonly targetFixtureId: string;
  readonly l06Snapshot: MutationJournalSnapshot;
  readonly l06Boundary: SyntheticSubmissionBoundaryDecision;
  readonly rateOwnerEvidenceSha256: string;
  readonly dispatchToVenueMs: number;
  readonly venueToLocalMs: number;
  readonly simulationAuthority: 'SYNTHETIC_FIXTURE';
  readonly actionAuthority: 'NONE_RECORD_ONLY';
  readonly externalActionAuthorization: 'NONE';
}

export interface TwinOrderFixture {
  readonly schema: 'TWIN_ORDER_FIXTURE_V1';
  readonly fixtureId: string;
  readonly l06Snapshot: MutationJournalSnapshot;
  readonly l06Boundary: SyntheticSubmissionBoundaryDecision;
  readonly product: TwinProduct;
  readonly symbol: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly side: TwinSide;
  readonly orderType: TwinOrderType;
  readonly timeInForce: TwinTimeInForce;
  readonly price: string | null;
  readonly quantity: string;
  readonly instrumentRevision: string;
  readonly sourceEvidenceRevision: string;
  readonly rateOwnerEvidenceSha256: string;
  readonly latency: TwinLatencyProfile;
  readonly queueAheadQuantity: string | null;
  readonly queueTruth: TwinQueueTruth;
  readonly simulationAuthority: 'SYNTHETIC_FIXTURE';
  readonly actionAuthority: 'NONE_RECORD_ONLY';
  readonly externalActionAuthorization: 'NONE';
}

export interface TwinBookLevel {
  readonly price: string;
  readonly quantity: string;
}

export interface TwinFeeEvidence {
  readonly schema: 'TWIN_FEE_EVIDENCE_V1';
  readonly evidenceRevision: string;
  readonly makerRate: string;
  readonly takerRate: string;
  readonly feeAsset: string;
  readonly chargeBasis: 'QUOTE_NOTIONAL' | 'BASE_QUANTITY';
  readonly rateUnit: 'FEE_ASSET_PER_QUOTE_NOTIONAL' | 'FEE_ASSET_PER_BASE_QUANTITY';
  readonly quoteConversionRate: string | null;
  readonly quoteConversionEvidenceRevision: string | null;
  readonly quoteConversionBaseAsset: string | null;
  readonly quoteConversionQuoteAsset: string | null;
  readonly quoteConversionUnit: 'QUOTE_ASSET_PER_FEE_ASSET' | null;
  readonly observedAtMs: number;
  readonly validUntilMs: number;
}

export type TwinEvent =
  | TwinSymbolStatusEvent
  | TwinBookSnapshotEvent
  | TwinBookDeltaEvent
  | TwinBookUnavailableEvent
  | TwinPreflightEvent
  | TwinSpotOrderTifPreflightEvent
  | TwinRateDecisionEvent
  | TwinPlaceDispatchEvent
  | TwinVenueArrivalEvent
  | TwinHttpDeliveryEvent
  | TwinPrivateDeliveryEvent
  | TwinTradeEvidenceEvent
  | TwinCostObservationEvent
  | TwinCancelDispatchEvent
  | TwinCancelArrivalEvent
  | TwinCancelDeliveryEvent
  | TwinCrashEvent
  | TwinRestartEvent
  | TwinReconciliationEvent;

export interface TwinEventEnvelope<K extends string, P> {
  readonly schema: 'TWIN_EVENT_V1';
  readonly eventId: string;
  readonly sequence: number;
  readonly sourceSequence: number | null;
  readonly occurredAtMs: number;
  readonly kind: K;
  readonly payload: P;
}

export type TwinSymbolStatusEvent = TwinEventEnvelope<'SYMBOL_STATUS', {
  readonly product: TwinProduct;
  readonly symbol: string;
  readonly status: TwinSymbolStatus;
  readonly evidenceRevision: string;
  readonly observedAtMs: number;
  readonly validUntilMs: number;
}>;

export type TwinBookSnapshotEvent = TwinEventEnvelope<'BOOK_SNAPSHOT', {
  readonly product: TwinProduct;
  readonly symbol: string;
  readonly bookRevision: string;
  readonly sourceSequence: number;
  readonly observedAtMs: number;
  readonly validUntilMs: number;
  readonly bids: readonly TwinBookLevel[];
  readonly asks: readonly TwinBookLevel[];
}>;

export type TwinBookDeltaEvent = TwinEventEnvelope<'BOOK_DELTA', {
  readonly product: TwinProduct;
  readonly symbol: string;
  readonly bookRevision: string;
  readonly previousBookRevision: string;
  readonly sourceSequence: number;
  readonly observedAtMs: number;
  readonly validUntilMs: number;
  readonly bidUpdates: readonly TwinBookLevel[];
  readonly askUpdates: readonly TwinBookLevel[];
}>;

export type TwinBookUnavailableEvent = TwinEventEnvelope<'BOOK_UNAVAILABLE', {
  readonly product: TwinProduct;
  readonly symbol: string;
  readonly state: Exclude<TwinBookTruth, 'AVAILABLE'>;
  readonly evidenceRevision: string;
}>;

export type TwinPreflightEvent = TwinEventEnvelope<'PREFLIGHT_EVIDENCE', {
  readonly fixtureId: string;
  readonly registrySnapshot: BinanceInstrumentRegistrySnapshot;
  readonly sizingRequest: InstrumentSizingRequest;
}>;

export type TwinSpotOrderTifPreflightEvent = TwinEventEnvelope<'SPOT_ORDER_TIF_PREFLIGHT_EVIDENCE', {
  readonly fixtureId: string;
  readonly registrySnapshot: BinanceInstrumentRegistrySnapshot;
  readonly sizingRequest: InstrumentSizingRequest;
  readonly expectedCapabilityRevision: string;
}>;

export type TwinRateDecisionEvent = TwinEventEnvelope<'RATE_DECISION', {
  readonly fixtureId: string;
  readonly rateState: BinanceRateBudgetState;
  readonly reservationInput: unknown;
  readonly ownerEvidenceSha256: string;
}>;

export type TwinPlaceDispatchEvent = TwinEventEnvelope<'PLACE_DISPATCH', {
  readonly fixtureId: string;
}>;

export type TwinVenueArrivalEvent = TwinEventEnvelope<'VENUE_ARRIVAL', {
  readonly fixtureId: string;
  readonly feeEvidence: TwinFeeEvidence | null;
}>;

export type TwinHttpDeliveryEvent = TwinEventEnvelope<'HTTP_DELIVERY', {
  readonly fixtureId: string;
  readonly outcome: 'ACK' | 'HTTP_5XX' | 'TIMEOUT' | 'DISCONNECT';
}>;

export type TwinPrivateDeliveryEvent = TwinEventEnvelope<'PRIVATE_DELIVERY', {
  readonly fixtureId: string;
  readonly venueRevision: string;
}>;

export type TwinTradeEvidenceEvent = TwinEventEnvelope<'TRADE_EVIDENCE', {
  readonly product: TwinProduct;
  readonly symbol: string;
  readonly tradeRevision: string;
  readonly price: string;
  readonly quantity: string;
  readonly aggressorSide: TwinSide;
  readonly feeEvidence: TwinFeeEvidence | null;
}>;

export type TwinCostObservationEvent = TwinEventEnvelope<'COST_OBSERVATION', {
  readonly fixtureId: string;
  readonly evidenceRevision: string;
  readonly kind: 'LATENCY_MOVEMENT_QUOTE' | 'ADVERSE_SELECTION_QUOTE';
  readonly amount: string | null;
}>;

export type TwinCancelDispatchEvent = TwinEventEnvelope<'CANCEL_DISPATCH', {
  readonly fixtureId: string;
  readonly cancelFixture: TwinCancelFixture;
}>;

export type TwinCancelArrivalEvent = TwinEventEnvelope<'CANCEL_ARRIVAL', {
  readonly fixtureId: string;
  readonly cancelFixtureId: string;
  readonly rateState: BinanceRateBudgetState;
  readonly reservationInput: unknown;
  readonly ownerEvidenceSha256: string;
}>;

export type TwinCancelDeliveryEvent = TwinEventEnvelope<'CANCEL_DELIVERY', {
  readonly fixtureId: string;
  readonly cancelFixtureId: string;
  readonly outcome: 'ACK' | 'HTTP_5XX' | 'TIMEOUT' | 'DISCONNECT' | 'DROPPED';
}>;

export type TwinCrashEvent = TwinEventEnvelope<'CRASH', {
  readonly crashId: string;
  readonly dropLocalDeliveries: boolean;
  readonly dropPendingCommands: boolean;
}>;

export type TwinRestartEvent = TwinEventEnvelope<'RESTART', {
  readonly crashId: string;
}>;

export type TwinReconciliationEvent = TwinEventEnvelope<'RECONCILIATION_OBSERVATION', {
  readonly fixtureId: string;
  readonly ownerObservationRevision: string;
  readonly observedVenueRevision: string;
  readonly observedStatus: TwinVenueStatus;
  readonly observedFilledQuantity: string;
}>;

export interface TwinFill {
  readonly fillId: string;
  readonly fixtureId: string;
  readonly eventId: string;
  readonly bookRevision: string | null;
  readonly price: string;
  readonly quantity: string;
  readonly quoteNotional: string;
  readonly liquidityRole: TwinLiquidityRole;
  readonly feeEvidenceRevision: string | null;
  readonly feeAmount: string | null;
  readonly feeAsset: string | null;
  readonly quoteEquivalentFee: string | null;
  readonly occurredAtMs: number;
}

export interface TwinVwapEvidence {
  readonly numeratorQuoteNotional: string;
  readonly denominatorBaseQuantity: string;
  readonly decimalScale24: string;
  readonly decimalPolicy: 'TRUNCATED_SCALE_24';
}

export interface TwinOrderState {
  readonly fixture: TwinOrderFixture;
  readonly venueStatus: TwinVenueStatus;
  readonly localTruth: TwinLocalTruth;
  readonly localObservedVenueStatus: TwinVenueStatus | null;
  readonly filledQuantity: string;
  readonly remainingQuantity: string;
  readonly expiredQuantity: string;
  readonly vwap: TwinVwapEvidence | null;
  readonly spreadDepthImpactQuote: string | null;
  readonly latencyMovementQuote: string | null;
  readonly latencyMovementEvidenceRevision: string | null;
  readonly adverseSelectionQuote: string | null;
  readonly adverseSelectionEvidenceRevision: string | null;
  readonly queueAheadRemaining: string | null;
  readonly fills: readonly TwinFill[];
  readonly dispatchAtMs: number | null;
  readonly venueArrivalAtMs: number | null;
  readonly venueArrivalSequence: number | null;
  readonly lastVenueEffectAtMs: number | null;
  readonly lastLocalObservationAtMs: number | null;
  readonly cancelFixture: TwinCancelFixture | null;
  readonly cancelDispatchAtMs: number | null;
  readonly cancelArrivalAtMs: number | null;
  readonly recoveryRequired: boolean;
  readonly blockedReasonCodes: readonly string[];
  readonly venueRevision: string;
}

export interface TwinBookState {
  readonly truth: TwinBookTruth;
  readonly product: TwinProduct;
  readonly symbol: string;
  readonly bookRevision: string | null;
  readonly sourceSequence: number | null;
  readonly observedAtMs: number | null;
  readonly validUntilMs: number | null;
  readonly bids: readonly TwinBookLevel[];
  readonly asks: readonly TwinBookLevel[];
}

export interface TwinStaticPreflightEvidence {
  readonly fixtureId: string;
  readonly registrySnapshot: BinanceInstrumentRegistrySnapshot;
  readonly sizingRequest: InstrumentSizingRequest;
  readonly result: InstrumentSizingResult;
}

export interface TwinSpotOrderTifPreflightEvidence {
  readonly ownerEvidenceKind: 'L081_SPOT_LIMIT_TIF';
  readonly fixtureId: string;
  readonly registrySnapshot: BinanceInstrumentRegistrySnapshot;
  readonly sizingRequest: InstrumentSizingRequest;
  readonly expectedCapabilityRevision: string;
  readonly result: BindBinanceSpotOrderTifCapabilityResult;
}

export type TwinInstrumentPreflightEvidence =
  | TwinStaticPreflightEvidence
  | TwinSpotOrderTifPreflightEvidence;

export interface TwinScenarioState {
  readonly schema: typeof EXCHANGE_TWIN_SCHEMA;
  readonly scenarioId: string;
  readonly modelRevision: string;
  readonly seed: string;
  readonly product: TwinProduct;
  readonly symbol: string;
  readonly symbolStatus: TwinSymbolStatus;
  readonly symbolStatusRevision: string | null;
  readonly symbolStatusObservedAtMs: number | null;
  readonly symbolStatusValidUntilMs: number | null;
  readonly book: TwinBookState;
  readonly bookRevisions: readonly string[];
  readonly orders: readonly TwinOrderState[];
  readonly preflights: readonly TwinInstrumentPreflightEvidence[];
  readonly rateDecisions: readonly {
    readonly fixtureId: string;
    readonly ownerEvidenceSha256: string;
    readonly rateState: BinanceRateBudgetState;
    readonly reservationInput: unknown;
    readonly decision: BinanceRateReservationDecision;
  }[];
  readonly processedEvents: readonly {
    readonly event: TwinEvent;
    readonly eventId: string;
    readonly sequence: number;
    readonly occurredAtMs: number;
    readonly kind: TwinEvent['kind'];
    readonly eventPriority: number;
    readonly orderingDomain: string;
    readonly sourceSequence: number | null;
    readonly contentRevision: string;
  }[];
  readonly tradeEvidence: readonly {
    readonly tradeRevision: string;
    readonly contentRevision: string;
  }[];
  readonly feeEvidence: readonly TwinFeeEvidence[];
  readonly crashed: boolean;
  readonly activeCrashId: string | null;
  readonly dropLocalDeliveries: boolean;
  readonly dropPendingCommands: boolean;
  readonly orderingTruth: 'PROVED' | 'AMBIGUOUS';
  readonly ambiguousDomains: readonly string[];
  readonly outcomeRevision: string;
  readonly stateRevision: string;
  readonly simulationAuthority: 'SYNTHETIC_FIXTURE';
  readonly actionAuthority: 'NONE_RECORD_ONLY';
  readonly externalActionAuthorization: 'NONE';
}

export interface TwinScenarioInput {
  readonly schema: 'TWIN_SCENARIO_INPUT_V1';
  readonly scenarioId: string;
  readonly modelRevision: string;
  readonly seed: string;
  readonly product: TwinProduct;
  readonly symbol: string;
  readonly fixtures: readonly TwinOrderFixture[];
  readonly events: readonly TwinEvent[];
}

export interface TwinCheckpoint {
  readonly schema: typeof EXCHANGE_TWIN_CHECKPOINT_SCHEMA;
  readonly state: TwinScenarioState;
  readonly checkpointRevision: string;
  readonly simulationAuthority: 'SYNTHETIC_FIXTURE';
  readonly actionAuthority: 'NONE_RECORD_ONLY';
  readonly externalActionAuthorization: 'NONE';
}

export interface TwinCalibrationEvidence {
  readonly schema: 'TWIN_CALIBRATION_EVIDENCE_V1';
  readonly calibrationRevision: string;
  readonly modelRevision: string;
  readonly predictedOutcomeRevision: string;
  readonly product: TwinProduct;
  readonly symbol: string;
  readonly quantityAsset: string;
  readonly recordedOutcomeRevision: string;
  readonly recordedContentRevision: string;
  readonly predictedFilledQuantity: string;
  readonly recordedFilledQuantity: string;
  readonly sampleCount: number;
  readonly observedAtMs: number;
  readonly validUntilMs: number;
}

export interface TwinCalibrationComparison {
  readonly schema: 'TWIN_CALIBRATION_COMPARISON_V1';
  readonly state: 'AVAILABLE' | 'UNAVAILABLE';
  readonly reasonCodes: readonly string[];
  readonly calibrationRevision: string | null;
  readonly modelRevision: string;
  readonly predictedOutcomeRevision: string;
  readonly recordedOutcomeRevision: string | null;
  readonly quantityResidual: string | null;
  readonly probability: null;
  readonly confidence: null;
  readonly simulationAuthority: 'SYNTHETIC_FIXTURE';
  readonly actionAuthority: 'NONE_RECORD_ONLY';
  readonly externalActionAuthorization: 'NONE';
}
