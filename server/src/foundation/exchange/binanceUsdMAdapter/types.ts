export const BINANCE_USDM_BASIS_ADAPTER_SCHEMA =
  'cosmos.foundation.binance-usdm-basis-adapter.v1' as const;
export const BINANCE_USDM_BASIS_WIRE_INTENT_SCHEMA =
  'cosmos.foundation.binance-usdm-basis-wire-intent.v1' as const;
export const BINANCE_USDM_BASIS_QUERY_DESCRIPTOR_SCHEMA =
  'cosmos.foundation.binance-usdm-basis-query-descriptor.v1' as const;
export const BINANCE_USDM_BASIS_QUERY_RESOLUTION_SCHEMA =
  'cosmos.foundation.binance-usdm-basis-query-resolution.v1' as const;

export type BinanceUsdMBasisLeg = 'PERP_OPEN' | 'PERP_CLOSE';
export type BinanceUsdMBasisOrderType = 'LIMIT' | 'MARKET';
export type BinanceUsdMBasisOrderSide = 'BUY' | 'SELL';
export type BinanceUsdMBasisPositionMode =
  | 'ONE_WAY'
  | 'HEDGE'
  | 'UNKNOWN';
export type BinanceUsdMBasisPositionSide = 'BOTH';

export type BinanceUsdMBasisAdapterBlockingCode =
  | 'CONFIG_INVALID'
  | 'ADAPTER_DISABLED'
  | 'SOURCE_DISABLED'
  | 'KILL_SWITCH_ENGAGED_OR_UNKNOWN'
  | 'AUTHORITY_INVALID'
  | 'INPUT_INVALID'
  | 'SYMBOL_INVALID'
  | 'SYMBOL_NOT_ALLOWLISTED'
  | 'CLIENT_ORDER_ID_INVALID'
  | 'LEG_INVALID'
  | 'EVALUATION_TIME_INVALID'
  | 'POSITION_MODE_EVIDENCE_INVALID'
  | 'POSITION_MODE_EVIDENCE_STALE'
  | 'POSITION_MODE_EVIDENCE_FUTURE'
  | 'POSITION_MODE_AUTHORITY_INVALID'
  | 'POSITION_MODE_UNKNOWN'
  | 'POSITION_MODE_UNSUPPORTED'
  | 'POSITION_SIDE_INVALID'
  | 'ORDER_TYPE_INVALID'
  | 'QUANTITY_INVALID'
  | 'PRICE_INVALID'
  | 'PUBLIC_VALIDATION_INVALID'
  | 'PUBLIC_VALIDATION_BLOCKED'
  | 'PUBLIC_SYMBOL_MISMATCH'
  | 'PUBLIC_CAPABILITY_UNKNOWN'
  | 'PUBLIC_FILTER_UNAVAILABLE'
  | 'PUBLIC_FILTER_MALFORMED'
  | 'QUANTITY_OUT_OF_RANGE'
  | 'QUANTITY_STEP_MISMATCH'
  | 'PRICE_OUT_OF_RANGE'
  | 'PRICE_TICK_MISMATCH'
  | 'NOTIONAL_BELOW_MIN'
  | 'PERCENT_PRICE_OUT_OF_RANGE'
  | 'INTENT_NOT_ADAPTER_PRODUCED'
  | 'QUERY_EVIDENCE_INVALID'
  | 'QUERY_EVIDENCE_STALE'
  | 'QUERY_EVIDENCE_FUTURE'
  | 'QUERY_AUTHORITY_INVALID'
  | 'QUERY_OUTCOME_UNRESOLVED'
  | 'QUERY_IDENTITY_MISMATCH'
  | 'QUERY_STATUS_UNKNOWN'
  | 'QUERY_STATUS_FILL_INCOHERENT';

export interface BinanceUsdMBasisAdapterConfig {
  /** Exact true is required. Default is false. */
  readonly enabled: boolean;
  /** Exact true is required. Default is false. */
  readonly sourceEnabled: boolean;
  /** Exact false is required. Default is true. */
  readonly killSwitchEngaged: boolean | null;
  /** This source-only adapter accepts no action authority. */
  readonly authority: 'NONE';
  /** Empty by default; symbols are never inferred. */
  readonly allowedSymbols: readonly string[];
}

export interface BinanceUsdMBasisPublicEvidence {
  /** Already-injected result produced by the accepted N-11 public seam. */
  readonly groundwork: unknown;
  /**
   * Capabilities copied from the same exchangeInfo symbol snapshot. N-11's
   * result guarantees MARKET but does not project the complete capability
   * arrays, so LIMIT remains blocked unless bounded `revision`, `observedAt`,
   * `orderTypes`, and `timeInForce` facts are supplied.
   */
  readonly orderCapabilities: unknown;
}

export interface BinanceUsdMBasisIntentInput {
  /** Injected evaluation time. This adapter never reads a clock. */
  readonly nowMs: number;
  readonly leg: BinanceUsdMBasisLeg;
  readonly symbol: string;
  /** Existing deterministic lifecycle identity. This adapter never mints IDs. */
  readonly existingClientOrderId: string;
  readonly type: BinanceUsdMBasisOrderType;
  readonly quantity: string;
  /** Required for LIMIT and forbidden for MARKET. */
  readonly price?: string;
  /**
   * Injected, fresh synthetic/replay evidence. Public USD-M facts cannot prove
   * account position mode, and this authority-NONE candidate rejects live
   * private evidence.
   */
  readonly positionModeEvidence: unknown;
  /** ONE_WAY orders must explicitly use BOTH. */
  readonly positionSide: BinanceUsdMBasisPositionSide;
  readonly publicEvidence: Readonly<BinanceUsdMBasisPublicEvidence>;
}

export interface BinanceUsdMBasisWireIntent {
  readonly schema: typeof BINANCE_USDM_BASIS_WIRE_INTENT_SCHEMA;
  readonly version: 1;
  readonly mode: 'VALIDATE_ONLY';
  readonly callable: false;
  readonly endpoint: '/fapi/v1/order';
  readonly method: 'POST';
  readonly security: 'SIGNED_DESCRIPTOR_ONLY';
  readonly leg: BinanceUsdMBasisLeg;
  readonly symbol: string;
  readonly existingClientOrderId: string;
  readonly side: BinanceUsdMBasisOrderSide;
  readonly type: BinanceUsdMBasisOrderType;
  readonly timeInForce: 'GTC' | null;
  readonly quantity: string;
  readonly price: string | null;
  readonly positionMode: 'ONE_WAY';
  readonly positionSide: 'BOTH';
  readonly reduceOnly: boolean;
  readonly closePosition: false;
  readonly requestFields: Readonly<{
    readonly symbol: string;
    readonly side: BinanceUsdMBasisOrderSide;
    readonly type: BinanceUsdMBasisOrderType;
    readonly positionSide: 'BOTH';
    readonly reduceOnly: boolean;
    readonly closePosition: false;
    readonly quantity: string;
    readonly price: string | null;
    readonly timeInForce: 'GTC' | null;
    readonly newClientOrderId: string;
  }>;
  readonly localValidation: Readonly<{
    readonly publicFilterSubsetPassed: true;
    readonly publicEvidenceSchema:
      'cosmos.foundation.binance-usdm-public-groundwork.v1';
    readonly publicEvidenceSourceId: string;
    readonly publicEvidenceSourceTimeMs: number | null;
    readonly publicEvidenceReceivedAtMs: number;
    readonly publicEvidenceMaxAgeMs: number;
    readonly publicEvidenceAuthority:
      | 'LIVE_PUBLIC'
      | 'SYNTHETIC_TEST'
      | 'RECORDED_REPLAY';
    readonly referenceMarkPrice: string;
    readonly referenceMarkPriceRevision: string;
    readonly referenceMarkPriceSourceId: string;
    readonly referenceMarkPriceSourceTimeMs: number;
    readonly referenceMarkPriceReceivedAtMs: number;
    readonly referenceMarkPriceMaxAgeMs: number;
    readonly referenceMarkPriceAuthority:
      | 'LIVE_PUBLIC'
      | 'SYNTHETIC_TEST'
      | 'RECORDED_REPLAY';
    readonly publicMaxNumOrders: number | null;
    readonly privateOpenOrderCountEvaluated: false;
    readonly matchingEngineAcceptanceProven: false;
    readonly positionModeAuthority:
      | 'SYNTHETIC_TEST'
      | 'RECORDED_REPLAY';
    readonly positionModeScope: 'ACCOUNT';
    readonly positionModeSymbol: null;
    readonly positionModeSourceId: string;
    readonly positionModeRevision: string;
    readonly positionModeObservedAtMs: number;
    readonly positionModeReceivedAtMs: number;
    readonly positionModeMaxAgeMs: number;
  }>;
  readonly limitations: readonly [
    'PRIVATE_MAX_NUM_ORDERS_UNEVALUATED',
    'MATCHING_ENGINE_ACCEPTANCE_UNPROVEN',
  ];
  readonly queryFirstOnUnknown: true;
  readonly blindResubmitAllowed: false;
  readonly sendEligible: false;
  readonly authority: 'NONE';
  readonly networkRequestsPerformed: 0;
  readonly privateRequestsPerformed: 0;
  readonly signedRequestsPerformed: 0;
  readonly testOrdersPerformed: 0;
  readonly ordersPerformed: 0;
  readonly sideEffectsPerformed: 0;
}

export interface BinanceUsdMBasisIntentResult {
  readonly schema: typeof BINANCE_USDM_BASIS_ADAPTER_SCHEMA;
  readonly version: 1;
  readonly mode: 'VALIDATE_ONLY';
  readonly ok: boolean;
  readonly intent: Readonly<BinanceUsdMBasisWireIntent> | null;
  readonly blockingCodes: readonly BinanceUsdMBasisAdapterBlockingCode[];
  readonly sendEligible: false;
  readonly authority: 'NONE';
  readonly networkRequestsPerformed: 0;
  readonly privateRequestsPerformed: 0;
  readonly signedRequestsPerformed: 0;
  readonly testOrdersPerformed: 0;
  readonly ordersPerformed: 0;
  readonly sideEffectsPerformed: 0;
}

export interface BinanceUsdMBasisQueryDescriptor {
  readonly schema: typeof BINANCE_USDM_BASIS_QUERY_DESCRIPTOR_SCHEMA;
  readonly version: 1;
  readonly mode: 'VALIDATE_ONLY';
  readonly callable: false;
  readonly endpoint: '/fapi/v1/order';
  readonly method: 'GET';
  readonly security: 'SIGNED_DESCRIPTOR_ONLY';
  readonly symbol: string;
  readonly origClientOrderId: string;
  readonly queryFields: Readonly<{
    readonly symbol: string;
    readonly origClientOrderId: string;
  }>;
  readonly queryFirstRequired: true;
  readonly blindResubmitAllowed: false;
  readonly authority: 'NONE';
  readonly networkRequestsPerformed: 0;
  readonly privateRequestsPerformed: 0;
  readonly signedRequestsPerformed: 0;
  readonly sideEffectsPerformed: 0;
}

export interface BinanceUsdMBasisQueryDescriptorResult {
  readonly schema: typeof BINANCE_USDM_BASIS_ADAPTER_SCHEMA;
  readonly version: 1;
  readonly mode: 'VALIDATE_ONLY';
  readonly ok: boolean;
  readonly descriptor: Readonly<BinanceUsdMBasisQueryDescriptor> | null;
  readonly blockingCodes: readonly BinanceUsdMBasisAdapterBlockingCode[];
  readonly authority: 'NONE';
  readonly networkRequestsPerformed: 0;
  readonly privateRequestsPerformed: 0;
  readonly signedRequestsPerformed: 0;
  readonly sideEffectsPerformed: 0;
}

export type BinanceUsdMBasisQueryOutcome =
  | 'FOUND'
  | 'NOT_FOUND'
  | 'TIMEOUT'
  | 'AMBIGUOUS'
  | 'RETENTION_EXPIRED';

export type BinanceUsdMBasisObservedOrderStatus =
  | 'NEW'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELED'
  | 'EXPIRED'
  | 'EXPIRED_IN_MATCH'
  | 'REJECTED';

export interface BinanceUsdMBasisQueryEvidence {
  /** Injected evaluation time. This adapter never reads a clock. */
  readonly nowMs: number;
  readonly observedAtMs: number;
  readonly receivedAtMs: number;
  readonly maxAgeMs: number;
  /** Authority NONE accepts only sealed test/replay observations. */
  readonly authority: 'SYNTHETIC_TEST' | 'RECORDED_REPLAY';
  readonly outcome: BinanceUsdMBasisQueryOutcome;
  readonly order?: unknown;
}

export interface BinanceUsdMBasisConfirmedOrder {
  readonly symbol: string;
  readonly clientOrderId: string;
  readonly side: BinanceUsdMBasisOrderSide;
  readonly type: BinanceUsdMBasisOrderType;
  readonly origQty: string;
  readonly executedQty: string;
  readonly price: string;
  /** Normalized request semantics; MARKET omits timeInForce. */
  readonly timeInForce: 'GTC' | null;
  /** Raw venue response enum retained after equivalence validation. */
  readonly venueTimeInForce: 'GTC';
  readonly positionSide: 'BOTH';
  readonly reduceOnly: boolean;
  readonly closePosition: false;
  readonly status: BinanceUsdMBasisObservedOrderStatus;
  readonly terminal: boolean;
}

export interface BinanceUsdMBasisQueryResolution {
  readonly schema: typeof BINANCE_USDM_BASIS_QUERY_RESOLUTION_SCHEMA;
  readonly version: 1;
  readonly mode: 'VALIDATE_ONLY';
  readonly state: 'CONFIRMED' | 'UNRESOLVED';
  readonly order: Readonly<BinanceUsdMBasisConfirmedOrder> | null;
  readonly blockingCodes: readonly BinanceUsdMBasisAdapterBlockingCode[];
  readonly queryFirstRequired: true;
  readonly blindResubmitAllowed: false;
  readonly replacementClientOrderId: null;
  readonly evaluatedAtMs: number | null;
  readonly observedAtMs: number | null;
  readonly receivedAtMs: number | null;
  readonly maxAgeMs: number | null;
  readonly evidenceAuthority:
    | 'SYNTHETIC_TEST'
    | 'RECORDED_REPLAY'
    | null;
  readonly authority: 'NONE';
  readonly networkRequestsPerformed: 0;
  readonly privateRequestsPerformed: 0;
  readonly signedRequestsPerformed: 0;
  readonly ordersPerformed: 0;
  readonly sideEffectsPerformed: 0;
}

export interface BinanceUsdMBasisValidateOnlyAdapter {
  readonly schema: typeof BINANCE_USDM_BASIS_ADAPTER_SCHEMA;
  readonly version: 1;
  readonly mode: 'VALIDATE_ONLY';
  readonly enabled: boolean;
  readonly sourceEnabled: boolean;
  readonly killSwitchEngaged: boolean | null;
  readonly authority: 'NONE';
  readonly buildOrderIntent: (
    input: Readonly<BinanceUsdMBasisIntentInput>,
  ) => Readonly<BinanceUsdMBasisIntentResult>;
  readonly buildOrderQueryDescriptor: (
    intent: Readonly<BinanceUsdMBasisWireIntent>,
  ) => Readonly<BinanceUsdMBasisQueryDescriptorResult>;
  readonly normalizeOrderQueryEvidence: (
    intent: Readonly<BinanceUsdMBasisWireIntent>,
    evidence: Readonly<BinanceUsdMBasisQueryEvidence>,
  ) => Readonly<BinanceUsdMBasisQueryResolution>;
}
