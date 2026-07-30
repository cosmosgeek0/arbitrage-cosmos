/**
 * Pure canonical preparation and current M0 live-send gate for Binance Spot.
 *
 * Returned intents are inert data. This module has no adapter implementation,
 * credentials, signing, network, persistence, clock, or mutation capability.
 */
import {
  addSpotDecimals,
  compareSpotDecimals,
  multiplySpotDecimals,
  normalizeSpotDecimal,
  subtractSpotDecimals,
  validateBinanceSpotOrderFilters,
  type BinanceSpotFilterValidation,
  type BinanceSpotVenueEvidence,
} from '../exchange/binanceSpot/filters.js';
import {
  evaluateSpotRiskPolicy,
  OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE,
  type SpotRiskPolicy,
  type SpotRiskVerdict,
} from '../risk/spotRiskPolicy.js';
import {
  spotCorrelationKeys,
  type SpotAttemptKind,
  type SpotCorrelation,
} from '../reconciliation/spotLedgerBridge.js';
import type {
  SpotFillObservation,
  SpotFlattenIntent,
  SpotLiveSubmitIntent,
  SpotSignedTestOrderIntent,
} from './spotPort.js';
import {
  createSpotExecutionTicket,
  reconstructCanonicalSpotExecutionTicket,
  type SpotExecutionTicket,
} from './spotTicket.js';

export const SPOT_CORE_PREPARATION_SCHEMA =
  'cosmos.foundation.spot-core-preparation.v1' as const;
export const SPOT_SIGNED_TEST_EVIDENCE_SCHEMA =
  'cosmos.foundation.spot-signed-test-evidence.v1' as const;
export const SPOT_OWNER_SEND_AUTHORITY_SCHEMA =
  'cosmos.foundation.spot-owner-send-authority.v1' as const;
export const SPOT_RISK_EVIDENCE_SCHEMA =
  'cosmos.foundation.spot-risk-evidence.v1' as const;

export const SPOT_CORE_BLOCKING_CODES = Object.freeze([
  'TICKET_NOT_CANONICAL',
  'FILTER_SNAPSHOT_INVALID',
  'VENUE_EVIDENCE_INVALID',
  'FILTER_VALIDATION_FAILED',
  'ENTRY_LIMIT_FOK_REQUIRED',
  'FLATTEN_LIMIT_FOK_REQUIRED',
  'TICKET_FILTER_NOTIONAL_MISMATCH',
  'RISK_EVIDENCE_MISSING',
  'RISK_EVIDENCE_BINDING_MISMATCH',
  'RISK_EVIDENCE_TIME_INVALID',
  'RISK_REDUCTION_UNPROVEN',
  'RISK_POLICY_BLOCKED',
  'BACKUP_NOT_READY',
  'PRIVATE_READ_NOT_READY',
  'KILL_SWITCH_ENGAGED',
  'SIGNED_TEST_MISSING',
  'SIGNED_TEST_NOT_ACCEPTED',
  'SIGNED_TEST_BINDING_MISMATCH',
  'SIGNED_TEST_TIME_INVALID',
  'OWNER_AUTHORITY_MISSING',
  'OWNER_AUTHORITY_NOT_VERIFIED',
  'OWNER_AUTHORITY_BINDING_MISMATCH',
  'OWNER_AUTHORITY_TIME_INVALID',
  'OWNER_AUTHORITY_NOT_SINGLE_USE',
  'OWNER_AUTHORITY_CEILING_INVALID',
  'FEE_RESERVE_INVALID',
] as const);

export type SpotCoreBlockingCode =
  (typeof SPOT_CORE_BLOCKING_CODES)[number];

export interface SpotFilterSnapshot {
  readonly revision: string;
  readonly observedAtMs: number;
  readonly filters: readonly unknown[];
}

export interface PrepareSpotCoreInput {
  readonly ticket: Readonly<SpotExecutionTicket>;
  readonly filterSnapshot: Readonly<SpotFilterSnapshot>;
  readonly nowMs: number;
  readonly riskEvidence: Readonly<SpotRiskEvidence> | null;
  /**
   * Execution-time venue evidence carried through to filter validation
   * unchanged. It is separate from the exchangeInfo projection because its
   * reference prices move independently of the snapshot, and the core never
   * substitutes the ticket's own risk price for it.
   */
  readonly venueEvidence: Readonly<BinanceSpotVenueEvidence> | null;
}

export interface SpotRiskReductionEvidence {
  readonly basis: 'RECONCILED_SPOT_BASE_REDUCTION';
  readonly positionSnapshotRevision: string;
  readonly reconciliationStatus: 'EXACT';
  readonly side: 'SELL';
  readonly availableBaseQuantity: string;
  readonly attributableBaseQuantity: string;
  readonly cumulativeFilledSellQuantity: string;
  readonly cumulativeAuthorizedLifecycleTurnoverQuote: string;
  readonly maximumAuthorizedLifecycleTurnoverQuote: string;
  readonly quantityStepSize: string;
}

export interface SpotFlattenAttemptFillSet {
  readonly ticket: Readonly<SpotExecutionTicket>;
  readonly venueOrderId: string | null;
  readonly authoritativelyAbsent: boolean;
  readonly fills: readonly Readonly<SpotFillObservation>[];
}

export interface DeriveFlattenLegInput {
  readonly sourceTicket: Readonly<SpotExecutionTicket>;
  readonly sourceVenueOrderId: string;
  readonly sourceFills: readonly Readonly<SpotFillObservation>[];
  readonly previousFlattenAttempts: readonly Readonly<
    SpotFlattenAttemptFillSet
  >[];
  readonly baseAsset: string;
  readonly exchangeBaseTolerance: string;
  readonly maximumResidualDustNotionalQuote: string;
  readonly maximumGrossLifecycleTurnoverQuote: string;
  readonly totalFeeReserveQuote: string;
  readonly quantityStepSize: string;
  readonly attempt: number;
  readonly price: string;
  readonly riskReferencePrice: string;
  readonly estimatedMaxLossQuote: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}

export interface DerivedFlattenLeg {
  readonly ticket: Readonly<SpotExecutionTicket> | null;
  readonly sourceGrossFilledBaseQuantity: string;
  readonly sourceBaseCommissionQuantity: string;
  readonly attributableBaseQuantity: string;
  readonly cumulativeFilledSellQuantity: string;
  readonly flattenBaseCommissionQuantity: string;
  readonly remainingAttributableBaseQuantity: string;
  readonly sellQuantity: string;
  readonly roundingRemainderBaseQuantity: string;
  readonly sourceGrossTurnoverQuote: string;
  readonly flattenGrossTurnoverQuote: string;
  readonly observedGrossLifecycleTurnoverQuote: string;
  readonly authorizedFlattenTurnoverQuote: string;
  readonly authorizedFilledLifecycleTurnoverQuote: string;
  readonly projectedAuthorizedLifecycleTurnoverQuote: string;
  readonly maximumAuthorizedLifecycleTurnoverQuote: string;
  readonly favorableSellPriceImprovementQuote: string;
  readonly exchangeBaseTolerance: string;
  readonly quantityStepSize: string;
  readonly maximumResidualDustNotionalQuote: string;
  readonly residualDustNotionalQuote: string;
  readonly projectedLifecycleQuoteShortfall: string;
  readonly totalFeeReserveQuote: string;
  readonly projectedLifecycleLossWithFeeReserveQuote: string;
}

/**
 * Canonical risk/control evidence is identity-bound to the exact ticket.
 * Structural ticket fields are never accepted as a substitute for reconciled
 * account evidence.
 */
export interface SpotRiskEvidence {
  readonly schema: typeof SPOT_RISK_EVIDENCE_SCHEMA;
  readonly verification: 'VERIFIED_BY_CANONICAL_RISK_OWNER';
  readonly evidenceRevision: string;
  readonly policyRevision: string;
  readonly policy: Readonly<SpotRiskPolicy>;
  readonly ticketId: string;
  readonly termsDigest: string;
  readonly accountId: string;
  readonly symbol: string;
  readonly observedAtMs: number;
  readonly validUntilMs: number;
  readonly killSwitchEngaged: boolean;
  readonly realizedDailyLossQuote: string;
  readonly riskReduction: Readonly<SpotRiskReductionEvidence> | null;
}

export interface SpotCorePreparation {
  readonly schema: typeof SPOT_CORE_PREPARATION_SCHEMA;
  readonly version: 1;
  readonly readyForSignedTest: boolean;
  readonly ticket: Readonly<SpotExecutionTicket>;
  readonly filterSnapshotRevision: string | null;
  readonly filterValidation: Readonly<BinanceSpotFilterValidation>;
  readonly riskVerdict: Readonly<SpotRiskVerdict>;
  readonly blockingCodes: readonly SpotCoreBlockingCode[];
  readonly signedTestRequired: true;
  readonly signedTestIntent: Readonly<SpotSignedTestOrderIntent> | null;
  readonly liveSendAuthorized: false;
  readonly sendsPerformed: 0;
  readonly externalActionAuthorization: 'NONE';
}

export interface SpotSignedTestEvidence {
  readonly schema: typeof SPOT_SIGNED_TEST_EVIDENCE_SCHEMA;
  readonly evidenceId: string;
  readonly status: 'ACCEPTED' | 'REJECTED' | 'AMBIGUOUS';
  readonly ticketId: string;
  readonly termsDigest: string;
  readonly clientOrderId: string;
  readonly filterSnapshotRevision: string;
  readonly observedAtMs: number;
  readonly createsVenueOrder: false;
}

export interface SpotOwnerSendAuthority {
  readonly schema: typeof SPOT_OWNER_SEND_AUTHORITY_SCHEMA;
  readonly authorizationId: string;
  readonly verification: 'VERIFIED_BY_CANONICAL_OWNER_AUTHORITY';
  readonly ticketId: string;
  readonly termsDigest: string;
  readonly clientOrderId: string;
  readonly maxOrderNotionalQuote: string;
  readonly confirmedAtMs: number;
  readonly expiresAtMs: number;
  readonly singleUse: true;
}

export interface SpotCurrentM0Readiness {
  readonly backupReady: boolean;
  readonly privateReadReady: boolean;
  readonly totalFeeReserveQuote: string;
}

export interface DecideSpotLiveSendInput extends PrepareSpotCoreInput {
  readonly readiness: Readonly<SpotCurrentM0Readiness>;
  readonly signedTestEvidence: Readonly<SpotSignedTestEvidence> | null;
  readonly ownerAuthority: Readonly<SpotOwnerSendAuthority> | null;
}

export interface SpotLiveSendDecision {
  readonly allowed: boolean;
  readonly blockingCodes: readonly SpotCoreBlockingCode[];
  readonly preparation: Readonly<SpotCorePreparation>;
  readonly intent: Readonly<SpotLiveSubmitIntent> | null;
  readonly automaticRetry: false;
  readonly sendsPerformed: 0;
}

export interface DecideSpotRecoveryFlattenInput
extends PrepareSpotCoreInput {
  readonly sourceTicket: Readonly<SpotExecutionTicket>;
  /** Exact attributable remainder before step flooring. */
  readonly residualQuantity: string;
  readonly residualRemainderQuantity: string;
  readonly exchangeBaseTolerance: string;
  readonly maximumResidualDustNotionalQuote: string;
  readonly projectedLifecycleQuoteShortfall: string;
  readonly readiness: Readonly<SpotCurrentM0Readiness>;
  readonly ownerAuthority: Readonly<SpotOwnerSendAuthority> | null;
}

export interface SpotRecoveryFlattenDecision {
  readonly allowed: boolean;
  readonly blockingCodes: readonly SpotCoreBlockingCode[];
  readonly preparation: Readonly<SpotCorePreparation>;
  readonly intent: Readonly<SpotFlattenIntent> | null;
  readonly signedTestRequired: false;
  readonly automaticRetry: false;
  readonly sendsPerformed: 0;
}

export interface SpotCorrelationObservation {
  readonly orderId: string | null;
  readonly fillId: string | null;
  readonly cancelId: string | null;
  readonly flattenId: string | null;
  readonly attemptKind: SpotAttemptKind;
}

function validIdentity(value: unknown, maximumLength = 256): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function validUtcMs(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function emptyFilterValidation(): Readonly<BinanceSpotFilterValidation> {
  return Object.freeze({
    ok: false,
    notional: null,
    priceRange: null,
    failures: Object.freeze([]),
  });
}

function uniqueBlockingCodes(
  values: readonly SpotCoreBlockingCode[],
): readonly SpotCoreBlockingCode[] {
  return Object.freeze([...new Set(values)]);
}

function fillTotals(
  fills: readonly Readonly<SpotFillObservation>[],
  venueOrderId: string,
  baseAsset: string,
  ticket: Readonly<SpotExecutionTicket>,
  seenFillIds: Set<string>,
): Readonly<{
  grossBase: string;
  baseCommission: string;
  grossQuote: string;
  authorizedQuote: string;
  favorableSellPriceImprovement: string;
}> {
  if (
    !Array.isArray(fills)
    || !validIdentity(venueOrderId)
    || ticket.type !== 'LIMIT'
    || ticket.price === null
  ) {
    throw new TypeError('fill set identity is malformed');
  }
  let grossBase = '0';
  let baseCommission = '0';
  let grossQuote = '0';
  let authorizedQuote = '0';
  let favorableSellPriceImprovement = '0';
  for (const fill of fills) {
    if (
      !validIdentity(fill?.fillId)
      || fill.venueOrderId !== venueOrderId
      || seenFillIds.has(fill.fillId)
      || !validIdentity(fill.commissionAsset, 16)
      || !validUtcMs(fill.occurredAtMs)
    ) {
      throw new TypeError('fill set is not exact');
    }
    const quantity = normalizeSpotDecimal(fill.quantity, 'fill quantity');
    const price = normalizeSpotDecimal(fill.price, 'fill price');
    const quoteQuantity = normalizeSpotDecimal(
      fill.quoteQuantity,
      'fill quote quantity',
    );
    const commission = normalizeSpotDecimal(
      fill.commission,
      'fill commission',
    );
    const calculatedQuote = multiplySpotDecimals(quantity, price);
    if (
      quantity === '0'
      || price === '0'
      || quoteQuantity !== calculatedQuote
      || (
        ticket.side === 'BUY'
          ? compareSpotDecimals(price, ticket.price) > 0
          : compareSpotDecimals(price, ticket.price) < 0
      )
    ) {
      throw new TypeError(
        'fill price, quantity, quote quantity, or LIMIT bound is invalid',
      );
    }
    seenFillIds.add(fill.fillId);
    grossBase = addSpotDecimals(grossBase, quantity);
    grossQuote = addSpotDecimals(grossQuote, quoteQuantity);
    const fillAuthorizedQuote = multiplySpotDecimals(
      quantity,
      ticket.price,
    );
    authorizedQuote = addSpotDecimals(
      authorizedQuote,
      fillAuthorizedQuote,
    );
    if (ticket.side === 'SELL') {
      favorableSellPriceImprovement = addSpotDecimals(
        favorableSellPriceImprovement,
        subtractSpotDecimals(quoteQuantity, fillAuthorizedQuote),
      );
    }
    if (fill.commissionAsset === baseAsset) {
      baseCommission = addSpotDecimals(baseCommission, commission);
    }
  }
  if (compareSpotDecimals(grossBase, ticket.quantity) > 0) {
    throw new TypeError('fill quantity exceeds canonical ticket quantity');
  }
  return Object.freeze({
    grossBase,
    baseCommission,
    grossQuote,
    authorizedQuote,
    favorableSellPriceImprovement,
  });
}

function floorSpotDecimalToStep(value: string, step: string): Readonly<{
  quantity: string;
  remainder: string;
}> {
  const normalizedValue = normalizeSpotDecimal(value, 'quantity');
  const normalizedStep = normalizeSpotDecimal(step, 'quantity step');
  if (normalizedStep === '0') throw new TypeError('quantity step is disabled');
  const scale = Math.max(
    normalizedValue.split('.')[1]?.length ?? 0,
    normalizedStep.split('.')[1]?.length ?? 0,
  );
  const units = (decimal: string): bigint => {
    const [whole = '0', fraction = ''] = decimal.split('.');
    return BigInt(`${whole}${fraction.padEnd(scale, '0')}`);
  };
  const render = (amount: bigint): string => {
    const digits = amount.toString().padStart(scale + 1, '0');
    if (scale === 0) return digits;
    const whole = digits.slice(0, -scale);
    const fraction = digits.slice(-scale).replace(/0+$/u, '');
    return fraction.length === 0 ? whole : `${whole}.${fraction}`;
  };
  const valueUnits = units(normalizedValue);
  const stepUnits = units(normalizedStep);
  const quantityUnits = (valueUnits / stepUnits) * stepUnits;
  return Object.freeze({
    quantity: render(quantityUnits),
    remainder: render(valueUnits - quantityUnits),
  });
}

/**
 * Pure canonical derivation of each fresh recovery leg. Source trades are read
 * first, BUY commission charged in base is removed, every prior SELL fill is
 * accumulated, and neither account inventory nor the lifecycle turnover cap
 * can be exceeded. A residual at or below explicit exchange tolerance returns
 * no new ticket.
 */
export function deriveFlattenLeg(
  input: Readonly<DeriveFlattenLegInput>,
): Readonly<DerivedFlattenLeg> {
  const sourceTicket = reconstructCanonicalSpotExecutionTicket(
    input.sourceTicket,
  );
  if (
    sourceTicket === null
    || sourceTicket.purpose !== 'ENTRY'
    || sourceTicket.side !== 'BUY'
    || sourceTicket.type !== 'LIMIT'
    || sourceTicket.timeInForce !== 'FOK'
    || !validIdentity(input.sourceVenueOrderId)
    || !validIdentity(input.baseAsset, 16)
    || sourceTicket.symbol !== `${input.baseAsset}USDT`
    || !Number.isSafeInteger(input.attempt)
    || input.attempt < 1
    || input.attempt > 3
    || !Array.isArray(input.previousFlattenAttempts)
    || input.previousFlattenAttempts.length !== input.attempt - 1
  ) {
    throw new TypeError('source or recovery attempt binding is invalid');
  }
  const exchangeBaseTolerance = normalizeSpotDecimal(
    input.exchangeBaseTolerance,
    'exchangeBaseTolerance',
  );
  const quantityStepSize = normalizeSpotDecimal(
    input.quantityStepSize,
    'quantityStepSize',
  );
  const maximumResidualDustNotionalQuote = normalizeSpotDecimal(
    input.maximumResidualDustNotionalQuote,
    'maximumResidualDustNotionalQuote',
  );
  const maximumGrossLifecycleTurnoverQuote = normalizeSpotDecimal(
    input.maximumGrossLifecycleTurnoverQuote,
    'maximumGrossLifecycleTurnoverQuote',
  );
  const totalFeeReserveQuote = normalizeSpotDecimal(
    input.totalFeeReserveQuote,
    'totalFeeReserveQuote',
  );
  if (
    quantityStepSize === '0'
    || maximumResidualDustNotionalQuote === '0'
    || maximumGrossLifecycleTurnoverQuote === '0'
    || compareSpotDecimals(exchangeBaseTolerance, quantityStepSize) >= 0
    || compareSpotDecimals(
      multiplySpotDecimals(maximumResidualDustNotionalQuote, '100'),
      sourceTicket.orderNotionalQuote,
    ) > 0
    || compareSpotDecimals(
      sourceTicket.orderNotionalQuote,
      OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE,
    ) > 0
  ) {
    throw new TypeError(
      'recovery tolerances or lifecycle ceilings are unsafe',
    );
  }
  if (
    normalizeSpotDecimal(
      input.estimatedMaxLossQuote,
      'estimatedMaxLossQuote',
    ) !== sourceTicket.estimatedMaxLossQuote
  ) {
    throw new TypeError(
      'flatten loss authority must equal the source lifecycle ceiling',
    );
  }
  const seenFillIds = new Set<string>();
  const source = fillTotals(
    input.sourceFills,
    input.sourceVenueOrderId,
    input.baseAsset,
    sourceTicket,
    seenFillIds,
  );
  if (
    compareSpotDecimals(
      source.baseCommission,
      source.grossBase,
    ) > 0
  ) throw new TypeError('source base commission exceeds BUY fills');
  const attributableBaseQuantity = subtractSpotDecimals(
    source.grossBase,
    source.baseCommission,
  );

  let cumulativeFilledSellQuantity = '0';
  let flattenBaseCommissionQuantity = '0';
  let flattenGrossTurnoverQuote = '0';
  let authorizedFlattenTurnoverQuote = '0';
  let favorableSellPriceImprovementQuote = '0';
  const seenAttemptTickets = new Set<string>();
  const seenAttemptClients = new Set<string>();
  const seenAttemptOrders = new Set<string>();
  for (
    let attemptIndex = 0;
    attemptIndex < input.previousFlattenAttempts.length;
    attemptIndex += 1
  ) {
    const attempt = input.previousFlattenAttempts[attemptIndex]!;
    const attemptTicket = reconstructCanonicalSpotExecutionTicket(
      attempt?.ticket,
    );
    if (
      attemptTicket === null
      || attemptTicket.purpose !== 'FLATTEN'
      || attemptTicket.side !== 'SELL'
      || attemptTicket.type !== 'LIMIT'
      || attemptTicket.timeInForce !== 'FOK'
      || attemptTicket.attempt !== attemptIndex + 1
      || attemptTicket.accountId !== sourceTicket.accountId
      || attemptTicket.symbol !== sourceTicket.symbol
      || attemptTicket.planId !== sourceTicket.planId
      || attemptTicket.correlationId !== sourceTicket.correlationId
      || compareSpotDecimals(
        attemptTicket.orderNotionalQuote,
        OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE,
      ) > 0
      || typeof attempt.authoritativelyAbsent !== 'boolean'
      || (
        attempt.authoritativelyAbsent
          ? attempt.venueOrderId !== null || attempt.fills.length !== 0
          : !validIdentity(attempt.venueOrderId)
      )
      || seenAttemptTickets.has(attemptTicket.ticketId)
      || seenAttemptClients.has(attemptTicket.clientOrderId)
      || (
        attempt.venueOrderId !== null
        && seenAttemptOrders.has(attempt.venueOrderId)
      )
    ) throw new TypeError('flatten attempt history is not exact');
    seenAttemptTickets.add(attemptTicket.ticketId);
    seenAttemptClients.add(attemptTicket.clientOrderId);
    if (attempt.venueOrderId !== null) {
      seenAttemptOrders.add(attempt.venueOrderId);
    }
    const totals = attempt.authoritativelyAbsent
      ? Object.freeze({
          grossBase: '0',
          baseCommission: '0',
          grossQuote: '0',
          authorizedQuote: '0',
          favorableSellPriceImprovement: '0',
        })
      : fillTotals(
          attempt.fills,
          attempt.venueOrderId as string,
          input.baseAsset,
          attemptTicket,
          seenFillIds,
        );
    cumulativeFilledSellQuantity = addSpotDecimals(
      cumulativeFilledSellQuantity,
      totals.grossBase,
    );
    flattenBaseCommissionQuantity = addSpotDecimals(
      flattenBaseCommissionQuantity,
      totals.baseCommission,
    );
    flattenGrossTurnoverQuote = addSpotDecimals(
      flattenGrossTurnoverQuote,
      totals.grossQuote,
    );
    authorizedFlattenTurnoverQuote = addSpotDecimals(
      authorizedFlattenTurnoverQuote,
      totals.authorizedQuote,
    );
    favorableSellPriceImprovementQuote = addSpotDecimals(
      favorableSellPriceImprovementQuote,
      totals.favorableSellPriceImprovement,
    );
  }
  const totalBaseDebited = addSpotDecimals(
    cumulativeFilledSellQuantity,
    flattenBaseCommissionQuantity,
  );
  if (
    compareSpotDecimals(totalBaseDebited, attributableBaseQuantity) > 0
  ) throw new TypeError('recovery SELL exceeds canary-attributable base');
  const remainingAttributableBaseQuantity = subtractSpotDecimals(
    attributableBaseQuantity,
    totalBaseDebited,
  );
  const observedGrossLifecycleTurnoverQuote = addSpotDecimals(
    source.grossQuote,
    flattenGrossTurnoverQuote,
  );
  const authorizedFilledLifecycleTurnoverQuote = addSpotDecimals(
    source.grossQuote,
    authorizedFlattenTurnoverQuote,
  );
  if (
    compareSpotDecimals(
      authorizedFilledLifecycleTurnoverQuote,
      maximumGrossLifecycleTurnoverQuote,
    ) > 0
  ) throw new TypeError('authorized lifecycle turnover exceeds the cap');
  const stepped = floorSpotDecimalToStep(
    remainingAttributableBaseQuantity,
    quantityStepSize,
  );
  const residualDustNotionalQuote = multiplySpotDecimals(
    stepped.remainder,
    sourceTicket.riskReferencePrice,
  );
  if (
    compareSpotDecimals(
      stepped.remainder,
      exchangeBaseTolerance,
    ) > 0
    || compareSpotDecimals(
      residualDustNotionalQuote,
      maximumResidualDustNotionalQuote,
    ) > 0
  ) {
    throw new TypeError(
      'non-step residual exceeds explicit base or quote dust ceiling',
    );
  }

  let ticket: Readonly<SpotExecutionTicket> | null = null;
  if (
    stepped.quantity !== '0'
  ) {
    ticket = createSpotExecutionTicket({
      correlationId: sourceTicket.correlationId,
      planId: sourceTicket.planId,
      accountId: sourceTicket.accountId,
      symbol: sourceTicket.symbol,
      side: 'SELL',
      type: 'LIMIT',
      timeInForce: 'FOK',
      quantity: stepped.quantity,
      price: input.price,
      riskReferencePrice: input.riskReferencePrice,
      estimatedMaxLossQuote: input.estimatedMaxLossQuote,
      purpose: 'FLATTEN',
      attempt: input.attempt,
      createdAtMs: input.createdAtMs,
      expiresAtMs: input.expiresAtMs,
    });
    if (
      compareSpotDecimals(
        ticket.orderNotionalQuote,
        OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE,
      ) > 0
      ||
      compareSpotDecimals(
        addSpotDecimals(
          authorizedFilledLifecycleTurnoverQuote,
          ticket.orderNotionalQuote,
        ),
        maximumGrossLifecycleTurnoverQuote,
      ) > 0
    ) throw new TypeError('candidate flatten exceeds lifecycle turnover cap');
  }
  const projectedFlattenTurnoverQuote = addSpotDecimals(
    flattenGrossTurnoverQuote,
    ticket?.orderNotionalQuote ?? '0',
  );
  const projectedAuthorizedLifecycleTurnoverQuote = addSpotDecimals(
    authorizedFilledLifecycleTurnoverQuote,
    ticket?.orderNotionalQuote ?? '0',
  );
  const projectedLifecycleQuoteShortfall = compareSpotDecimals(
    source.grossQuote,
    projectedFlattenTurnoverQuote,
  ) > 0
    ? subtractSpotDecimals(
        source.grossQuote,
        projectedFlattenTurnoverQuote,
      )
    : '0';
  const projectedLifecycleLossWithFeeReserveQuote = addSpotDecimals(
    projectedLifecycleQuoteShortfall,
    totalFeeReserveQuote,
  );
  if (
    compareSpotDecimals(
      projectedLifecycleLossWithFeeReserveQuote,
      sourceTicket.estimatedMaxLossQuote,
    ) > 0
  ) {
    throw new TypeError(
      'candidate flatten plus fee reserve exceeds lifecycle loss ceiling',
    );
  }
  return Object.freeze({
    ticket,
    sourceGrossFilledBaseQuantity: source.grossBase,
    sourceBaseCommissionQuantity: source.baseCommission,
    attributableBaseQuantity,
    cumulativeFilledSellQuantity,
    flattenBaseCommissionQuantity,
    remainingAttributableBaseQuantity,
    sellQuantity: stepped.quantity,
    roundingRemainderBaseQuantity: stepped.remainder,
    sourceGrossTurnoverQuote: source.grossQuote,
    flattenGrossTurnoverQuote,
    observedGrossLifecycleTurnoverQuote,
    authorizedFlattenTurnoverQuote,
    authorizedFilledLifecycleTurnoverQuote,
    projectedAuthorizedLifecycleTurnoverQuote,
    maximumAuthorizedLifecycleTurnoverQuote:
      maximumGrossLifecycleTurnoverQuote,
    favorableSellPriceImprovementQuote,
    exchangeBaseTolerance,
    quantityStepSize,
    maximumResidualDustNotionalQuote,
    residualDustNotionalQuote,
    projectedLifecycleQuoteShortfall,
    totalFeeReserveQuote,
    projectedLifecycleLossWithFeeReserveQuote,
  });
}

/**
 * Bind every ledger/recovery correlation to the immutable ticket identity.
 * Callers cannot substitute a different client order ID.
 */
export function correlateSpotTicket(
  ticket: Readonly<SpotExecutionTicket>,
  observation: Readonly<SpotCorrelationObservation>,
): Readonly<SpotCorrelation> {
  const correlation = Object.freeze({
    ticketId: ticket.ticketId,
    clientOrderId: ticket.clientOrderId,
    orderId: observation.orderId,
    fillId: observation.fillId,
    cancelId: observation.cancelId,
    flattenId: observation.flattenId,
    attemptKind: observation.attemptKind,
  });
  // Reuse the reconciliation owner's closed validation contract.
  spotCorrelationKeys(correlation);
  return correlation;
}

function signedTestIntent(
  ticket: Readonly<SpotExecutionTicket>,
  filterSnapshotRevision: string,
): Readonly<SpotSignedTestOrderIntent> {
  return Object.freeze({
    kind: 'SIGNED_TEST_ORDER' as const,
    ticketId: ticket.ticketId,
    termsDigest: ticket.termsDigest,
    clientOrderId: ticket.clientOrderId,
    symbol: ticket.symbol,
    side: ticket.side,
    type: ticket.type,
    timeInForce: ticket.timeInForce,
    quantity: ticket.quantity,
    price: ticket.price,
    filterSnapshotRevision,
    createsVenueOrder: false as const,
    liveSendAuthorized: false as const,
  });
}

function riskEvidenceBlockingCodes(
  evidence: Readonly<SpotRiskEvidence> | null,
  ticket: Readonly<SpotExecutionTicket>,
  nowMs: number,
): SpotCoreBlockingCode[] {
  if (evidence === null) return ['RISK_EVIDENCE_MISSING'];
  const codes: SpotCoreBlockingCode[] = [];
  if (
    evidence.schema !== SPOT_RISK_EVIDENCE_SCHEMA ||
    evidence.verification !== 'VERIFIED_BY_CANONICAL_RISK_OWNER' ||
    !validIdentity(evidence.evidenceRevision) ||
    !validIdentity(evidence.policyRevision) ||
    evidence.ticketId !== ticket.ticketId ||
    evidence.termsDigest !== ticket.termsDigest ||
    evidence.accountId !== ticket.accountId ||
    evidence.symbol !== ticket.symbol ||
    typeof evidence.killSwitchEngaged !== 'boolean'
  ) {
    codes.push('RISK_EVIDENCE_BINDING_MISMATCH');
  }
  try {
    normalizeSpotDecimal(
      evidence.realizedDailyLossQuote,
      'riskEvidence.realizedDailyLossQuote',
    );
  } catch {
    codes.push('RISK_EVIDENCE_BINDING_MISMATCH');
  }
  if (
    !validUtcMs(evidence.observedAtMs) ||
    !validUtcMs(evidence.validUntilMs) ||
    evidence.observedAtMs < ticket.createdAtMs ||
    evidence.observedAtMs > nowMs ||
    evidence.validUntilMs <= nowMs ||
    evidence.validUntilMs > ticket.expiresAtMs
  ) {
    codes.push('RISK_EVIDENCE_TIME_INVALID');
  }
  if (ticket.purpose === 'FLATTEN') {
    const reduction = evidence.riskReduction;
    let exactReduction = false;
    try {
      exactReduction =
        ticket.riskEffect === 'UNPROVEN_RISK_REDUCTION' &&
        reduction !== null &&
        reduction.basis === 'RECONCILED_SPOT_BASE_REDUCTION' &&
        validIdentity(reduction.positionSnapshotRevision) &&
        reduction.reconciliationStatus === 'EXACT' &&
        reduction.side === 'SELL' &&
        ticket.side === 'SELL' &&
        normalizeSpotDecimal(
          reduction.quantityStepSize,
          'riskReduction.quantityStepSize',
        ) !== '0' &&
        normalizeSpotDecimal(
          reduction.availableBaseQuantity,
          'riskReduction.availableBaseQuantity',
        ) === ticket.quantity &&
        normalizeSpotDecimal(
          reduction.attributableBaseQuantity,
          'riskReduction.attributableBaseQuantity',
        ) !== '0' &&
        compareSpotDecimals(
          addSpotDecimals(
            reduction.cumulativeFilledSellQuantity,
            ticket.quantity,
          ),
          reduction.attributableBaseQuantity,
        ) <= 0 &&
        compareSpotDecimals(
          addSpotDecimals(
            reduction.cumulativeAuthorizedLifecycleTurnoverQuote,
            ticket.orderNotionalQuote,
          ),
          reduction.maximumAuthorizedLifecycleTurnoverQuote,
        ) <= 0 &&
        compareSpotDecimals(
          reduction.availableBaseQuantity,
          ticket.quantity,
        ) >= 0;
    } catch {
      exactReduction = false;
    }
    if (!exactReduction) codes.push('RISK_REDUCTION_UNPROVEN');
  }
  return codes;
}

/**
 * Validate the ticket against exact risk arithmetic and a versioned execution
 * projection of exchangeInfo. The signed test remains mandatory because local
 * supported-filter validation is not venue acceptance.
 */
export function prepareSpotCore(
  input: Readonly<PrepareSpotCoreInput>,
): Readonly<SpotCorePreparation> {
  const blockingCodes: SpotCoreBlockingCode[] = [];
  const canonicalTicket = reconstructCanonicalSpotExecutionTicket(
    input?.ticket,
  );
  const ticket = canonicalTicket ?? input.ticket;
  if (canonicalTicket === null) {
    blockingCodes.push('TICKET_NOT_CANONICAL');
  }
  if (
    ticket.purpose === 'ENTRY'
    && (
      ticket.side !== 'BUY'
      || ticket.type !== 'LIMIT'
      || ticket.timeInForce !== 'FOK'
    )
  ) blockingCodes.push('ENTRY_LIMIT_FOK_REQUIRED');
  if (
    ticket.purpose === 'FLATTEN'
    && (
      ticket.side !== 'SELL'
      || ticket.type !== 'LIMIT'
      || ticket.timeInForce !== 'FOK'
    )
  ) blockingCodes.push('FLATTEN_LIMIT_FOK_REQUIRED');
  const riskEvidenceCodes = riskEvidenceBlockingCodes(
    input.riskEvidence,
    ticket,
    input.nowMs,
  );
  blockingCodes.push(...riskEvidenceCodes);
  const snapshotValid =
    typeof input?.filterSnapshot === 'object' &&
    input.filterSnapshot !== null &&
    validIdentity(input.filterSnapshot.revision) &&
    validUtcMs(input.filterSnapshot.observedAtMs) &&
    input.filterSnapshot.observedAtMs <= input.nowMs &&
    Array.isArray(input.filterSnapshot.filters);
  if (!snapshotValid) blockingCodes.push('FILTER_SNAPSHOT_INVALID');
  const venueEvidencePresent =
    typeof input?.venueEvidence === 'object' &&
    input.venueEvidence !== null &&
    !Array.isArray(input.venueEvidence);
  if (!venueEvidencePresent) blockingCodes.push('VENUE_EVIDENCE_INVALID');

  const filterValidation = snapshotValid
    ? validateBinanceSpotOrderFilters(
        {
          type: ticket.type,
          side: ticket.side,
          quantity: ticket.quantity,
          price: ticket.price,
        },
        input.filterSnapshot.filters,
        venueEvidencePresent ? input.venueEvidence : null,
      )
    : emptyFilterValidation();
  if (!filterValidation.ok) blockingCodes.push('FILTER_VALIDATION_FAILED');
  if (
    filterValidation.notional !== null &&
    compareSpotDecimals(
      filterValidation.notional,
      ticket.orderNotionalQuote,
    ) !== 0
  ) {
    blockingCodes.push('TICKET_FILTER_NOTIONAL_MISMATCH');
  }

  const riskVerdict = evaluateSpotRiskPolicy({
    nowMs: input.nowMs,
    policy:
      input.riskEvidence?.policy ??
      ({
        minOrderNotionalQuote: '0',
        maxOrderNotionalQuote: '0',
        maxLossPerOrderQuote: '0',
        maxDailyLossQuote: '0',
      } as const),
    subject: {
      purpose: ticket.purpose,
      riskEffect:
        ticket.purpose === 'FLATTEN' &&
        riskEvidenceCodes.length === 0
          ? 'RECONCILED_RISK_REDUCTION'
          : ticket.riskEffect,
      quantity: ticket.quantity,
      price: ticket.price,
      riskReferencePrice: ticket.riskReferencePrice,
      estimatedMaxLossQuote: ticket.estimatedMaxLossQuote,
      expiresAtMs: ticket.expiresAtMs,
      recovery:
        ticket.purpose === 'FLATTEN'
        && input.riskEvidence?.riskReduction !== null
        && input.riskEvidence?.riskReduction !== undefined
          ? {
              attributableBaseQuantity:
                input.riskEvidence.riskReduction.attributableBaseQuantity,
              cumulativeFilledSellQuantity:
                input.riskEvidence.riskReduction.cumulativeFilledSellQuantity,
              cumulativeAuthorizedLifecycleTurnoverQuote:
                input.riskEvidence.riskReduction
                  .cumulativeAuthorizedLifecycleTurnoverQuote,
              maximumAuthorizedLifecycleTurnoverQuote:
                input.riskEvidence.riskReduction
                  .maximumAuthorizedLifecycleTurnoverQuote,
            }
          : undefined,
    },
    killSwitch:
      input.riskEvidence === null
        ? null
        : { engaged: input.riskEvidence.killSwitchEngaged },
    realizedDailyLossQuote:
      input.riskEvidence?.realizedDailyLossQuote ?? null,
  });
  if (!riskVerdict.allowed) blockingCodes.push('RISK_POLICY_BLOCKED');
  const frozenBlockingCodes = uniqueBlockingCodes(blockingCodes);
  const readyForSignedTest = frozenBlockingCodes.length === 0;
  const filterSnapshotRevision = snapshotValid
    ? input.filterSnapshot.revision
    : null;

  return Object.freeze({
    schema: SPOT_CORE_PREPARATION_SCHEMA,
    version: 1 as const,
    readyForSignedTest,
    ticket,
    filterSnapshotRevision,
    filterValidation,
    riskVerdict,
    blockingCodes: frozenBlockingCodes,
    signedTestRequired: true as const,
    signedTestIntent:
      readyForSignedTest && filterSnapshotRevision !== null
        ? signedTestIntent(ticket, filterSnapshotRevision)
        : null,
    liveSendAuthorized: false as const,
    sendsPerformed: 0 as const,
    externalActionAuthorization: 'NONE' as const,
  });
}

function signedTestBlockingCodes(
  evidence: Readonly<SpotSignedTestEvidence> | null,
  preparation: Readonly<SpotCorePreparation>,
  nowMs: number,
): SpotCoreBlockingCode[] {
  if (evidence === null) return ['SIGNED_TEST_MISSING'];
  const codes: SpotCoreBlockingCode[] = [];
  if (evidence.status !== 'ACCEPTED') {
    codes.push('SIGNED_TEST_NOT_ACCEPTED');
  }
  if (
    evidence.schema !== SPOT_SIGNED_TEST_EVIDENCE_SCHEMA ||
    !validIdentity(evidence.evidenceId) ||
    evidence.createsVenueOrder !== false ||
    evidence.ticketId !== preparation.ticket.ticketId ||
    evidence.termsDigest !== preparation.ticket.termsDigest ||
    evidence.clientOrderId !== preparation.ticket.clientOrderId ||
    evidence.filterSnapshotRevision !== preparation.filterSnapshotRevision
  ) {
    codes.push('SIGNED_TEST_BINDING_MISMATCH');
  }
  if (
    !validUtcMs(evidence.observedAtMs) ||
    evidence.observedAtMs < preparation.ticket.createdAtMs ||
    evidence.observedAtMs > nowMs ||
    evidence.observedAtMs >= preparation.ticket.expiresAtMs
  ) {
    codes.push('SIGNED_TEST_TIME_INVALID');
  }
  return codes;
}

function ownerAuthorityBlockingCodes(
  authority: Readonly<SpotOwnerSendAuthority> | null,
  preparation: Readonly<SpotCorePreparation>,
  evidence: Readonly<SpotSignedTestEvidence> | null,
  nowMs: number,
): SpotCoreBlockingCode[] {
  if (authority === null) return ['OWNER_AUTHORITY_MISSING'];
  const codes: SpotCoreBlockingCode[] = [];
  if (
    authority.schema !== SPOT_OWNER_SEND_AUTHORITY_SCHEMA ||
    authority.verification !== 'VERIFIED_BY_CANONICAL_OWNER_AUTHORITY'
  ) {
    codes.push('OWNER_AUTHORITY_NOT_VERIFIED');
  }
  if (
    !validIdentity(authority.authorizationId) ||
    authority.ticketId !== preparation.ticket.ticketId ||
    authority.termsDigest !== preparation.ticket.termsDigest ||
    authority.clientOrderId !== preparation.ticket.clientOrderId
  ) {
    codes.push('OWNER_AUTHORITY_BINDING_MISMATCH');
  }
  if (
    !validUtcMs(authority.confirmedAtMs) ||
    !validUtcMs(authority.expiresAtMs) ||
    authority.confirmedAtMs > nowMs ||
    authority.expiresAtMs <= nowMs ||
    authority.expiresAtMs > preparation.ticket.expiresAtMs ||
    (evidence !== null && authority.confirmedAtMs < evidence.observedAtMs)
  ) {
    codes.push('OWNER_AUTHORITY_TIME_INVALID');
  }
  if (authority.singleUse !== true) {
    codes.push('OWNER_AUTHORITY_NOT_SINGLE_USE');
  }
  try {
    if (
      compareSpotDecimals(
        authority.maxOrderNotionalQuote,
        OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE,
      ) > 0 ||
      compareSpotDecimals(
        preparation.ticket.orderNotionalQuote,
        authority.maxOrderNotionalQuote,
      ) > 0
    ) {
      codes.push('OWNER_AUTHORITY_CEILING_INVALID');
    }
  } catch {
    codes.push('OWNER_AUTHORITY_CEILING_INVALID');
  }
  return codes;
}

function feeReserveBlockingCodes(
  readiness: Readonly<SpotCurrentM0Readiness>,
  ticket: Readonly<SpotExecutionTicket>,
  projectedQuoteShortfall = '0',
): SpotCoreBlockingCode[] {
  try {
    const reserve = normalizeSpotDecimal(
      readiness?.totalFeeReserveQuote,
      'readiness.totalFeeReserveQuote',
    );
    const shortfall = normalizeSpotDecimal(
      projectedQuoteShortfall,
      'projectedLifecycleQuoteShortfall',
    );
    if (
      reserve !== readiness.totalFeeReserveQuote
      || shortfall !== projectedQuoteShortfall
      || compareSpotDecimals(
        addSpotDecimals(shortfall, reserve),
        ticket.estimatedMaxLossQuote,
      ) > 0
    ) return ['FEE_RESERVE_INVALID'];
    return [];
  } catch {
    return ['FEE_RESERVE_INVALID'];
  }
}

/**
 * Re-evaluate every current gate at the send seam. Success returns one inert,
 * single-use submit intent; this function still performs zero sends.
 */
export function decideSpotLiveSend(
  input: Readonly<DecideSpotLiveSendInput>,
): Readonly<SpotLiveSendDecision> {
  const preparation = prepareSpotCore(input);
  const blockingCodes: SpotCoreBlockingCode[] = [...preparation.blockingCodes];
  if (input.readiness?.backupReady !== true) {
    blockingCodes.push('BACKUP_NOT_READY');
  }
  if (input.readiness?.privateReadReady !== true) {
    blockingCodes.push('PRIVATE_READ_NOT_READY');
  }
  if (input.riskEvidence?.killSwitchEngaged !== false) {
    blockingCodes.push('KILL_SWITCH_ENGAGED');
  }
  blockingCodes.push(
    ...feeReserveBlockingCodes(input.readiness, preparation.ticket),
    ...signedTestBlockingCodes(
      input.signedTestEvidence,
      preparation,
      input.nowMs,
    ),
    ...ownerAuthorityBlockingCodes(
      input.ownerAuthority,
      preparation,
      input.signedTestEvidence,
      input.nowMs,
    ),
  );
  const frozenBlockingCodes = uniqueBlockingCodes(blockingCodes);
  const allowed = frozenBlockingCodes.length === 0;
  const evidence = input.signedTestEvidence;
  const authority = input.ownerAuthority;
  const intent =
    allowed && evidence !== null && authority !== null
      ? Object.freeze({
          kind: 'SUBMIT_LIVE_ORDER' as const,
          ticketId: preparation.ticket.ticketId,
          termsDigest: preparation.ticket.termsDigest,
          clientOrderId: preparation.ticket.clientOrderId,
          symbol: preparation.ticket.symbol,
          side: preparation.ticket.side,
          type: preparation.ticket.type,
          timeInForce: preparation.ticket.timeInForce,
          quantity: preparation.ticket.quantity,
          price: preparation.ticket.price,
          ownerAuthorizationId: authority.authorizationId,
          signedTestEvidenceId: evidence.evidenceId,
          filterSnapshotRevision: input.filterSnapshot.revision,
          singleUse: true as const,
          automaticRetry: false as const,
        })
      : null;
  return Object.freeze({
    allowed,
    blockingCodes: frozenBlockingCodes,
    preparation,
    intent,
    automaticRetry: false as const,
    sendsPerformed: 0 as const,
  });
}

/**
 * Recovery-only SELL gate. One accepted entry test is the complete M0 test
 * budget; a restart must not consume a second test authority before removing
 * exact canary-attributable exposure. Current filters, venue evidence, risk
 * reduction, private readiness, admission, and one-use owner authority remain
 * mandatory.
 */
export function decideSpotRecoveryFlatten(
  input: Readonly<DecideSpotRecoveryFlattenInput>,
): Readonly<SpotRecoveryFlattenDecision> {
  const preparation = prepareSpotCore(input);
  const blockingCodes: SpotCoreBlockingCode[] = [
    ...preparation.blockingCodes,
  ];
  if (input.readiness?.backupReady !== true) {
    blockingCodes.push('BACKUP_NOT_READY');
  }
  if (input.readiness?.privateReadReady !== true) {
    blockingCodes.push('PRIVATE_READ_NOT_READY');
  }
  blockingCodes.push(
    ...feeReserveBlockingCodes(
      input.readiness,
      preparation.ticket,
      input.projectedLifecycleQuoteShortfall,
    ),
  );
  blockingCodes.push(
    ...ownerAuthorityBlockingCodes(
      input.ownerAuthority,
      preparation,
      null,
      input.nowMs,
    ),
  );
  let bindingValid = true;
  try {
    const canonicalSource = reconstructCanonicalSpotExecutionTicket(
      input.sourceTicket,
    );
    const canonicalFlatten = reconstructCanonicalSpotExecutionTicket(
      input.ticket,
    );
    bindingValid =
      canonicalSource !== null
      && canonicalFlatten !== null
      && canonicalFlatten.purpose === 'FLATTEN'
      && canonicalFlatten.side === 'SELL'
      && canonicalFlatten.type === 'LIMIT'
      && canonicalFlatten.timeInForce === 'FOK'
      && canonicalSource.purpose === 'ENTRY'
      && canonicalSource.side === 'BUY'
      && canonicalSource.type === 'LIMIT'
      && canonicalSource.timeInForce === 'FOK'
      && canonicalSource.accountId === canonicalFlatten.accountId
      && canonicalSource.symbol === canonicalFlatten.symbol
      && canonicalSource.planId === canonicalFlatten.planId
      && canonicalSource.correlationId === canonicalFlatten.correlationId
      && compareSpotDecimals(
        normalizeSpotDecimal(
        input.residualQuantity,
        'recovery residual quantity',
        ),
        canonicalFlatten.quantity,
      ) >= 0
      && normalizeSpotDecimal(
        input.residualRemainderQuantity,
        'recovery residual remainder quantity',
      ) === subtractSpotDecimals(
        input.residualQuantity,
        canonicalFlatten.quantity,
      )
      && compareSpotDecimals(
        input.residualRemainderQuantity,
        input.exchangeBaseTolerance,
      ) <= 0
      && compareSpotDecimals(
        multiplySpotDecimals(
          input.residualRemainderQuantity,
          canonicalFlatten.riskReferencePrice,
        ),
        input.maximumResidualDustNotionalQuote,
      ) <= 0;
  } catch {
    bindingValid = false;
  }
  if (!bindingValid) blockingCodes.push('RISK_REDUCTION_UNPROVEN');
  const frozenBlockingCodes = uniqueBlockingCodes(blockingCodes);
  const allowed = frozenBlockingCodes.length === 0;
  return Object.freeze({
    allowed,
    blockingCodes: frozenBlockingCodes,
    preparation,
    intent:
      allowed && input.ownerAuthority !== null
        ? Object.freeze({
            kind: 'FLATTEN' as const,
            sourceTicketId: input.sourceTicket.ticketId,
            flattenTicket: preparation.ticket,
            residualQuantity: preparation.ticket.quantity,
            automaticRetry: false as const,
          })
        : null,
    signedTestRequired: false as const,
    automaticRetry: false as const,
    sendsPerformed: 0 as const,
  });
}
