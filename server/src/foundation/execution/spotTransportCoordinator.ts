/**
 * Direct-import-only coordinator for one owner-authorized Binance Spot M0.
 *
 * This module owns no credential, signer, network client, environment read,
 * timer, persistence engine, route, or live mount. All effects are injected,
 * and every returned result grants no further execution authority.
 */
import { types as nodeUtilTypes } from 'node:util';

import {
  addSpotDecimals,
  compareSpotDecimals,
  multiplySpotDecimals,
  normalizeSpotDecimal,
  subtractSpotDecimals,
  type BinanceSpotVenueEvidence,
} from '../exchange/binanceSpot/filters.js';
import {
  buildSpotLedgerAppendIntent,
  classifySpotLedgerDiscrepancy,
  type SpotClock,
  type SpotLedgerAppendIntent,
  type SpotLedgerProjectionState,
  type SpotReconciliationStatus,
} from '../reconciliation/spotLedgerBridge.js';
import {
  decideSpotRecoveryFlatten,
  decideSpotLiveSend,
  deriveFlattenLeg,
  prepareSpotCore,
  type DeriveFlattenLegInput,
  type DerivedFlattenLeg,
  type SpotFlattenAttemptFillSet,
  type SpotCurrentM0Readiness,
  type SpotFilterSnapshot,
  type SpotOwnerSendAuthority,
  type SpotRiskEvidence,
  type SpotSignedTestEvidence,
} from './spotCore.js';
import {
  calculateM0SpotIntentDigest,
  M0_SPOT_MAXIMUM_FLATTEN_SUBMISSIONS,
} from './m0SpotLifecycleCard.js';
import {
  reduceSpotLifecycle,
  spotResidualQuantity,
  type SpotLifecycleEvent,
  type SpotLifecycleState,
} from './spotLifecycle.js';
import type {
  BinanceSpotExecutionPort,
  SpotCancelIntent,
  SpotFillObservation,
  SpotFlattenIntent,
  SpotLiveSubmitIntent,
  SpotMutationOutcome,
  SpotQueryOutcome,
  SpotSignedTestOrderIntent,
} from './spotPort.js';
import {
  reconstructCanonicalSpotExecutionTicket,
  type SpotExecutionTicket,
} from './spotTicket.js';

export const SPOT_TRANSPORT_COORDINATOR_SCHEMA =
  'COSMOS_SPOT_TRANSPORT_COORDINATOR_V1' as const;

export const SPOT_TRANSPORT_COORDINATOR_POSTURE = Object.freeze({
  liveMounted: false,
  liveExportReachable: false,
  sharedBarrelExported: false,
  automaticMutationRetry: false,
} as const);

export type SpotTransportAction = 'ENTRY' | 'FLATTEN';

export interface SpotTransportAdmission {
  readonly revision: string;
  readonly sourceEnabled: boolean;
  /** Exact false is the sole clear value. */
  readonly killSwitchEngaged: boolean | null;
  readonly allowedSymbols: readonly string[];
  readonly blockedSymbols: readonly string[];
  /**
   * Exact durable lifecycle covenant. It never permits another entry; it keeps
   * only query/cancel/exact residual flatten recovery available until flat.
   */
  readonly recoveryAuthorizedUntilFlat?: boolean;
}

export interface SpotTransportLegInput {
  readonly ticket: Readonly<SpotExecutionTicket>;
  readonly filterSnapshot: Readonly<SpotFilterSnapshot>;
  /** Caller time is documentary only; the injected clock is authoritative. */
  readonly nowMs?: number;
  readonly riskEvidence: Readonly<SpotRiskEvidence> | null;
  readonly venueEvidence: Readonly<BinanceSpotVenueEvidence> | null;
  readonly readiness: Readonly<SpotCurrentM0Readiness>;
  /**
   * Evidence is not trusted on shape alone. The coordinator first performs
   * the injected signed test and accepts this evidence only when the port
   * proves the test created no venue order and filled zero.
   */
  readonly signedTestEvidence: Readonly<SpotSignedTestEvidence> | null;
  readonly ownerAuthority: Readonly<SpotOwnerSendAuthority> | null;
}

export interface SpotTransportCoordinatorInput {
  readonly entry: Readonly<SpotTransportLegInput>;
  /**
   * RECOVERY_ONLY reconstructs the exact source order by query and can never
   * consume entry test/send authority.
   */
  readonly mode?: 'ENTRY' | 'RECOVERY_ONLY';
  readonly sourceVenueOrderId?: string | null;
  readonly baseAsset: string;
  readonly quoteAsset: 'USDT';
  readonly maximumGrossLifecycleTurnoverQuote: string;
  readonly totalFeeReserveQuote: string;
  /**
   * Explicit economic value ceiling for any non-sellable remainder. The core
   * additionally requires this to be no more than 1% of the entry canary.
   */
  readonly maximumResidualDustNotionalQuote: string;
  readonly exchangeBaseTolerance: string;
  readonly baseBalanceBaseline: Readonly<{
    readonly revision: string;
    readonly quantity: string;
    readonly observedAtMs: number;
  }>;
  readonly quoteBalanceBaseline: Readonly<{
    readonly revision: string;
    readonly quantity: string;
    readonly tolerance: string;
    readonly observedAtMs: number;
  }>;
  /**
   * Compatibility-only documentary input. Recovery never trusts this
   * precomputed ticket; every leg comes from the injected derivation port after
   * exact source fills have been queried.
   */
  readonly flatten: Readonly<SpotTransportLegInput> | null;
  /**
   * Exact append-only recovery history loaded at boot. These attempts are
   * never resent or reused; recovery starts at the next fresh attempt number.
   */
  readonly priorFlattenAttempts?:
    readonly Readonly<SpotFlattenAttemptRecord>[];
}

export interface SpotFlattenAttemptRecord {
  readonly attempt: number;
  readonly ticket: Readonly<SpotExecutionTicket>;
  readonly venueOrderId: string | null;
  /** Exact query proved this consumed client identity never created an order. */
  readonly authoritativelyAbsent: boolean;
  readonly terminal: true;
  readonly fillsComplete: true;
  readonly fills: readonly Readonly<SpotFillObservation>[];
}

export interface SpotDeriveFlattenLegRequest {
  readonly sourceTicket: Readonly<SpotExecutionTicket>;
  readonly sourceVenueOrderId: string;
  readonly sourceFills: readonly Readonly<SpotFillObservation>[];
  readonly previousFlattenAttempts:
    readonly Readonly<SpotFlattenAttemptRecord>[];
  readonly baseAsset: string;
  readonly exchangeBaseTolerance: string;
  readonly maximumResidualDustNotionalQuote: string;
  readonly maximumGrossLifecycleTurnoverQuote: string;
  readonly totalFeeReserveQuote: string;
  readonly attempt: number;
}

export interface SpotDeriveFlattenLegPort {
  /**
   * Pure synchronous hydration only. The coordinator re-derives the returned
   * ticket from exact fills and rejects any quantity, identity, FOK, or
   * turnover mismatch.
   */
  (
    request: Readonly<SpotDeriveFlattenLegRequest>,
  ): Readonly<SpotTransportLegInput> | null;
}

export interface SpotMutationReservationReceipt {
  readonly schema: 'cosmos.foundation.spot-mutation-reservation.v1';
  readonly action: 'ENTRY' | 'FLATTEN';
  readonly ticketId: string;
  readonly termsDigest: string;
  readonly clientOrderId: string;
  readonly intentDigest: `sha256:${string}`;
  readonly durableAuthorityConsumed: true;
  readonly canonicalOrderRequestAppended: true;
  readonly dispatchClaimAvailable: true;
  readonly replay: false;
}

export interface SpotMutationReservationPort {
  /**
   * Must be one atomic sole-Ledger transition: consume the exact authority,
   * close the lifecycle entry fence, and append the canonical order_request
   * before returning a fresh dispatch claim. Replay returns null.
   */
  (
    authority: Readonly<SpotOwnerSendAuthority>,
    intent: Readonly<SpotLiveSubmitIntent | SpotFlattenIntent>,
  ): Promise<Readonly<SpotMutationReservationReceipt> | null>;
}

export interface SpotCancelReservationReceipt {
  readonly schema: 'cosmos.foundation.spot-cancel-reservation.v1';
  readonly action: 'ENTRY_CANCEL' | 'FLATTEN_CANCEL';
  readonly ticketId: string;
  readonly termsDigest: string;
  readonly clientOrderId: string;
  readonly intentDigest: `sha256:${string}`;
  readonly durableAuthorityConsumed: true;
  readonly canonicalCancelAttemptAppended: true;
  readonly dispatchClaimAvailable: true;
  /** True only when recovering the same never-claimed durable reservation. */
  readonly replay: boolean;
}

export interface SpotCancelReservationPort {
  (
    action: 'ENTRY_CANCEL' | 'FLATTEN_CANCEL',
    ticket: Readonly<SpotExecutionTicket>,
    intent: Readonly<SpotCancelIntent>,
  ): Promise<Readonly<SpotCancelReservationReceipt> | null>;
}

export interface SpotSignedQuoteAmount {
  readonly direction: 'CREDIT' | 'DEBIT' | 'ZERO';
  readonly quantity: string;
}

export interface SpotCommissionTotal {
  readonly leg: 'ENTRY' | 'FLATTEN';
  readonly asset: string;
  readonly quantity: string;
}

export type SpotQuoteEconomicsStatus =
  | 'EXACT'
  | 'UNMEASURED_THIRD_ASSET_QUOTE_VALUE';

export interface SpotAuthoritativeFlatEvidence {
  readonly revision: string;
  readonly sourceTicketId: string;
  readonly sourceClientOrderId: string;
  readonly sourceVenueOrderId: string | null;
  readonly sourceOrderAuthoritativelyAbsent: boolean;
  readonly sourceOpenOrderAbsent: boolean;
  readonly sourceOrderTerminal: boolean;
  readonly sourceFillsComplete: boolean;
  readonly sourceCumulativeFilledQuantity: string;
  readonly flattenTicketId: string | null;
  readonly flattenClientOrderId: string | null;
  readonly flattenVenueOrderId: string | null;
  readonly flattenOrderTerminal: boolean;
  readonly flattenFillsComplete: boolean;
  readonly flattenCumulativeFilledQuantity: string;
  readonly baseAsset: string;
  readonly baselineRevision: string;
  readonly baselineBaseQuantity: string;
  readonly observedBaseQuantity: string;
  readonly exchangeBaseTolerance: string;
  readonly maximumResidualDustNotionalQuote: string;
  readonly residualDustNotionalQuote: string;
  readonly sourceBaseCommissionQuantity: string;
  readonly flattenBaseCommissionQuantity: string;
  readonly canaryAttributableBaseDeltaQuantity: string;
  readonly flattenAttemptCount: number;
  readonly allFlattenOrdersTerminal: boolean;
  readonly allFlattenFillsComplete: boolean;
  readonly flattenOpenOrdersAbsent: boolean;
  readonly authoritativelyAbsentFlattenClientOrderIds: readonly string[];
  readonly canonicalStatus: SpotReconciliationStatus;
  readonly ledgerState: SpotLedgerProjectionState;
  readonly quoteAsset: 'USDT';
  readonly baselineQuoteQuantity: string;
  readonly observedQuoteQuantity: string;
  readonly quoteQuantityTolerance: string;
  readonly observedQuoteDelta: Readonly<SpotSignedQuoteAmount>;
  readonly sourceGrossQuoteDebit: string;
  readonly flattenGrossQuoteCredit: string;
  readonly observedGrossLifecycleTurnoverQuote: string;
  readonly authorizedFilledLifecycleTurnoverQuote: string;
  readonly favorableSellPriceImprovementQuote: string;
  readonly referencePnlQuote: Readonly<SpotSignedQuoteAmount>;
  readonly signedSlippageCostQuote: Readonly<SpotSignedQuoteAmount>;
  readonly quoteCommissionDebit: string;
  readonly fillDerivedQuoteCashflow: Readonly<SpotSignedQuoteAmount>;
  readonly realizedPnlAfterQuoteFees: Readonly<SpotSignedQuoteAmount>;
  readonly quoteEquationResidual: Readonly<SpotSignedQuoteAmount>;
  readonly commissionTotals:
    readonly Readonly<SpotCommissionTotal>[];
  readonly quoteCashflowStatus: 'EXACT_WITHIN_TOLERANCE';
  readonly quoteEconomicsStatus: SpotQuoteEconomicsStatus;
  readonly thirdAssetCommissionQuoteValueStatus:
    | 'NOT_APPLICABLE'
    | 'UNMEASURED_NO_DIGEST_BOUND_VALUATION';
  readonly thirdAssetCommissionQuoteValue: null;
  readonly thirdAssetValuationDigest: null;
  readonly occurredAtMs: number;
}

export interface SpotFlatEvidenceRequest {
  readonly sourceTicket: Readonly<SpotExecutionTicket>;
  readonly flattenTicket: Readonly<SpotExecutionTicket> | null;
  readonly lifecycle: Readonly<SpotLifecycleState>;
  readonly sourceOrderAuthoritativelyAbsent: boolean;
  readonly sourceFills: readonly Readonly<SpotFillObservation>[];
  readonly flattenFills: readonly Readonly<SpotFillObservation>[];
  readonly flattenAttempts: readonly Readonly<SpotFlattenAttemptRecord>[];
  readonly authoritativelyAbsentFlattenClientOrderIds: readonly string[];
  readonly baseAsset: string;
  readonly baselineRevision: string;
  readonly baselineBaseQuantity: string;
  readonly baselineObservedAtMs: number;
  readonly quoteAsset: 'USDT';
  readonly baselineQuoteQuantity: string;
  readonly quoteQuantityTolerance: string;
  readonly exchangeBaseTolerance: string;
  readonly maximumResidualDustNotionalQuote: string;
  readonly expectedResidualDustNotionalQuote: string;
  readonly sourceGrossFilledBaseQuantity: string;
  readonly sourceBaseCommissionQuantity: string;
  readonly sourceAttributableBaseQuantity: string;
  readonly cumulativeFilledSellQuantity: string;
  readonly flattenBaseCommissionQuantity: string;
  readonly expectedCanaryAttributableBaseDeltaQuantity: string;
  readonly observedGrossLifecycleTurnoverQuote: string;
  readonly authorizedFilledLifecycleTurnoverQuote: string;
  readonly maximumAuthorizedLifecycleTurnoverQuote: string;
  readonly favorableSellPriceImprovementQuote: string;
  readonly sourceGrossQuoteDebit: string;
  readonly flattenGrossQuoteCredit: string;
  readonly referencePnlQuote: Readonly<SpotSignedQuoteAmount>;
  readonly signedSlippageCostQuote: Readonly<SpotSignedQuoteAmount>;
  readonly quoteCommissionDebit: string;
  readonly fillDerivedQuoteCashflow: Readonly<SpotSignedQuoteAmount>;
  readonly realizedPnlAfterQuoteFees: Readonly<SpotSignedQuoteAmount>;
  readonly commissionTotals:
    readonly Readonly<SpotCommissionTotal>[];
  readonly quoteEconomicsStatus: SpotQuoteEconomicsStatus;
  readonly thirdAssetCommissionQuoteValueStatus:
    | 'NOT_APPLICABLE'
    | 'UNMEASURED_NO_DIGEST_BOUND_VALUATION';
}

export interface SpotTransportCoordinatorPorts {
  readonly clock: Readonly<SpotClock>;
  readonly executionPort: Readonly<BinanceSpotExecutionPort>;
  readonly readAdmission: (
    symbol: string,
    action: SpotTransportAction,
  ) =>
    | Readonly<SpotTransportAdmission>
    | Promise<Readonly<SpotTransportAdmission>>;
  readonly reserveMutation: SpotMutationReservationPort;
  readonly reserveCancel: SpotCancelReservationPort;
  readonly deriveFlattenLeg: SpotDeriveFlattenLegPort;
  readonly verifySignedTestEvidence: (
    intent: Readonly<SpotSignedTestOrderIntent>,
    outcome: Readonly<SpotMutationOutcome>,
    evidence: Readonly<SpotSignedTestEvidence> | null,
  ) => boolean | Promise<boolean>;
  readonly appendLedger: (
    intent: Readonly<SpotLedgerAppendIntent>,
  ) => 'APPENDED' | 'DUPLICATE' | 'CONFLICT' | Promise<
    'APPENDED' | 'DUPLICATE' | 'CONFLICT'
  >;
  readonly readFlatEvidence: (
    request: Readonly<SpotFlatEvidenceRequest>,
  ) =>
    | Readonly<SpotAuthoritativeFlatEvidence>
    | null
    | Promise<Readonly<SpotAuthoritativeFlatEvidence> | null>;
}

export interface SpotTransportCallCounts {
  readonly admissions: number;
  readonly signedTests: number;
  readonly authorityConsumptions: number;
  readonly submits: number;
  readonly orderQueries: number;
  readonly fillQueries: number;
  readonly cancels: number;
  readonly flattens: number;
  readonly ledgerAppends: number;
}

export type SpotTransportCoordinatorStatus =
  | 'BLOCKED'
  | 'RECOVERY_REQUIRED'
  | 'FLAT_RECONCILED';

export interface SpotTransportCoordinatorResult {
  readonly schema: typeof SPOT_TRANSPORT_COORDINATOR_SCHEMA;
  readonly version: 1;
  readonly status: SpotTransportCoordinatorStatus;
  readonly symbol: string;
  readonly lifecycle: Readonly<SpotLifecycleState> | null;
  readonly reasonCodes: readonly string[];
  readonly calls: Readonly<SpotTransportCallCounts>;
  readonly liveExportReachable: false;
  readonly automaticMutationRetry: false;
  readonly executionAuthority: 'NONE';
  readonly externalActionAuthorization: 'NONE';
}

interface MutableCounts {
  admissions: number;
  signedTests: number;
  authorityConsumptions: number;
  submits: number;
  orderQueries: number;
  fillQueries: number;
  cancels: number;
  flattens: number;
  ledgerAppends: number;
}

type DataRecord = Readonly<Record<string, unknown>>;

const SYMBOL = /^[A-Z0-9]{1,64}$/u;
const CONTROL_ID = /^[A-Za-z0-9_.:-]{1,256}$/u;
const NO_REASONS = Object.freeze([]) as readonly string[];
const NO_FILLS = Object.freeze(
  [],
) as readonly Readonly<SpotFillObservation>[];

export interface SpotQuoteAccounting {
  readonly sourceGrossQuoteDebit: string;
  readonly flattenGrossQuoteCredit: string;
  readonly observedGrossLifecycleTurnoverQuote: string;
  readonly authorizedFilledLifecycleTurnoverQuote: string;
  readonly favorableSellPriceImprovementQuote: string;
  readonly referencePnlQuote: Readonly<SpotSignedQuoteAmount>;
  readonly signedSlippageCostQuote: Readonly<SpotSignedQuoteAmount>;
  readonly quoteCommissionDebit: string;
  readonly fillDerivedQuoteCashflow: Readonly<SpotSignedQuoteAmount>;
  readonly realizedPnlAfterQuoteFees: Readonly<SpotSignedQuoteAmount>;
  readonly commissionTotals:
    readonly Readonly<SpotCommissionTotal>[];
  readonly quoteEconomicsStatus: SpotQuoteEconomicsStatus;
  readonly thirdAssetCommissionQuoteValueStatus:
    | 'NOT_APPLICABLE'
    | 'UNMEASURED_NO_DIGEST_BOUND_VALUATION';
}

export function createSpotSignedQuoteAmount(
  credit: string,
  debit: string,
): Readonly<SpotSignedQuoteAmount> {
  const normalizedCredit = normalizeSpotDecimal(
    credit,
    'signed quote credit',
  );
  const normalizedDebit = normalizeSpotDecimal(
    debit,
    'signed quote debit',
  );
  const comparison = compareSpotDecimals(
    normalizedCredit,
    normalizedDebit,
  );
  return comparison === 0
    ? Object.freeze({ direction: 'ZERO' as const, quantity: '0' })
    : comparison > 0
      ? Object.freeze({
          direction: 'CREDIT' as const,
          quantity: subtractSpotDecimals(
            normalizedCredit,
            normalizedDebit,
          ),
        })
      : Object.freeze({
          direction: 'DEBIT' as const,
          quantity: subtractSpotDecimals(
            normalizedDebit,
            normalizedCredit,
          ),
        });
}

function signedQuoteSides(
  value: Readonly<SpotSignedQuoteAmount>,
): Readonly<{ credit: string; debit: string }> {
  const quantity = normalizeSpotDecimal(
    value?.quantity,
    'signed quote quantity',
  );
  if (
    (value.direction === 'ZERO') !== (quantity === '0')
    || (
      value.direction !== 'ZERO'
      && value.direction !== 'CREDIT'
      && value.direction !== 'DEBIT'
    )
  ) throw new TypeError('signed quote amount is not canonical');
  return value.direction === 'CREDIT'
    ? Object.freeze({ credit: quantity, debit: '0' })
    : value.direction === 'DEBIT'
      ? Object.freeze({ credit: '0', debit: quantity })
      : Object.freeze({ credit: '0', debit: '0' });
}

export function subtractSpotSignedQuoteAmounts(
  left: Readonly<SpotSignedQuoteAmount>,
  right: Readonly<SpotSignedQuoteAmount>,
): Readonly<SpotSignedQuoteAmount> {
  const leftSides = signedQuoteSides(left);
  const rightSides = signedQuoteSides(right);
  return createSpotSignedQuoteAmount(
    addSpotDecimals(leftSides.credit, rightSides.debit),
    addSpotDecimals(leftSides.debit, rightSides.credit),
  );
}

export function spotSignedQuoteAmountsEqual(
  left: Readonly<SpotSignedQuoteAmount>,
  right: Readonly<SpotSignedQuoteAmount>,
): boolean {
  try {
    const a = signedQuoteSides(left);
    const b = signedQuoteSides(right);
    return createSpotSignedQuoteAmount(a.credit, a.debit).direction
      === createSpotSignedQuoteAmount(b.credit, b.debit).direction
      && createSpotSignedQuoteAmount(a.credit, a.debit).quantity
        === createSpotSignedQuoteAmount(b.credit, b.debit).quantity;
  } catch {
    return false;
  }
}

function signedQuoteMinusDebit(
  value: Readonly<SpotSignedQuoteAmount>,
  debit: string,
): Readonly<SpotSignedQuoteAmount> {
  const sides = signedQuoteSides(value);
  return createSpotSignedQuoteAmount(
    sides.credit,
    addSpotDecimals(
      sides.debit,
      normalizeSpotDecimal(debit, 'signed quote debit component'),
    ),
  );
}

function exactQuoteFill(
  fill: Readonly<SpotFillObservation>,
  venueOrderId: string,
  ticket: Readonly<SpotExecutionTicket>,
): Readonly<{
  quantity: string;
  quoteQuantity: string;
  referenceQuoteQuantity: string;
  commission: string;
  commissionAsset: string;
}> {
  if (
    fill.venueOrderId !== venueOrderId
    || typeof fill.fillId !== 'string'
    || !CONTROL_ID.test(fill.fillId)
    || typeof fill.commissionAsset !== 'string'
    || !/^[A-Z0-9]{1,16}$/u.test(fill.commissionAsset)
    || !Number.isSafeInteger(fill.occurredAtMs)
    || fill.occurredAtMs < ticket.createdAtMs
    || ticket.price === null
  ) throw new TypeError('quote fill binding is invalid');
  const price = normalizeSpotDecimal(fill.price, 'quote fill price');
  const quantity = normalizeSpotDecimal(
    fill.quantity,
    'quote fill quantity',
  );
  const quoteQuantity = normalizeSpotDecimal(
    fill.quoteQuantity,
    'quote fill quoteQuantity',
  );
  const commission = normalizeSpotDecimal(
    fill.commission,
    'quote fill commission',
  );
  if (
    price === '0'
    || quantity === '0'
    || quoteQuantity !== multiplySpotDecimals(price, quantity)
    || (
      ticket.side === 'BUY'
        ? compareSpotDecimals(price, ticket.price) > 0
        : compareSpotDecimals(price, ticket.price) < 0
    )
  ) throw new TypeError('quote fill arithmetic is invalid');
  return Object.freeze({
    quantity,
    quoteQuantity,
    referenceQuoteQuantity: multiplySpotDecimals(
      quantity,
      ticket.price,
    ),
    commission,
    commissionAsset: fill.commissionAsset,
  });
}

/**
 * Deterministic fill-derived quote cashflow and economic measurement. The
 * result never values a commission paid in a third asset.
 */
export function deriveSpotQuoteAccounting(input: Readonly<{
  sourceTicket: Readonly<SpotExecutionTicket>;
  sourceVenueOrderId: string | null;
  sourceFills: readonly Readonly<SpotFillObservation>[];
  flattenAttempts: readonly Readonly<SpotFlattenAttemptRecord>[];
  baseAsset: string;
  quoteAsset: 'USDT';
}>): Readonly<SpotQuoteAccounting> {
  const sourceTicket = reconstructCanonicalSpotExecutionTicket(
    input.sourceTicket,
  );
  if (
    sourceTicket === null
    || sourceTicket.purpose !== 'ENTRY'
    || sourceTicket.side !== 'BUY'
    || sourceTicket.type !== 'LIMIT'
    || sourceTicket.timeInForce !== 'FOK'
    || sourceTicket.symbol !== `${input.baseAsset}${input.quoteAsset}`
    || (
      input.sourceVenueOrderId === null
        ? input.sourceFills.length !== 0
        : !CONTROL_ID.test(input.sourceVenueOrderId)
    )
    || !Array.isArray(input.flattenAttempts)
  ) throw new TypeError('quote accounting source is invalid');

  let sourceGrossQuoteDebit = '0';
  let flattenGrossQuoteCredit = '0';
  let referenceEntryQuote = '0';
  let referenceFlattenQuote = '0';
  const fillIds = new Set<string>();
  const commissions = new Map<string, string>();
  const addCommission = (
    leg: 'ENTRY' | 'FLATTEN',
    asset: string,
    quantity: string,
  ): void => {
    if (quantity === '0') return;
    const key = `${leg}|${asset}`;
    commissions.set(
      key,
      addSpotDecimals(commissions.get(key) ?? '0', quantity),
    );
  };

  for (const fill of input.sourceFills) {
    if (fillIds.has(fill.fillId) || input.sourceVenueOrderId === null) {
      throw new TypeError('quote accounting fill identity is not unique');
    }
    fillIds.add(fill.fillId);
    const exact = exactQuoteFill(
      fill,
      input.sourceVenueOrderId,
      sourceTicket,
    );
    sourceGrossQuoteDebit = addSpotDecimals(
      sourceGrossQuoteDebit,
      exact.quoteQuantity,
    );
    referenceEntryQuote = addSpotDecimals(
      referenceEntryQuote,
      exact.referenceQuoteQuantity,
    );
    addCommission('ENTRY', exact.commissionAsset, exact.commission);
  }

  const seenTickets = new Set([sourceTicket.ticketId]);
  const seenClients = new Set([sourceTicket.clientOrderId]);
  const seenOrders = new Set(
    input.sourceVenueOrderId === null
      ? []
      : [input.sourceVenueOrderId],
  );
  for (
    let index = 0;
    index < input.flattenAttempts.length;
    index += 1
  ) {
    const attempt = input.flattenAttempts[index]!;
    const ticket = reconstructCanonicalSpotExecutionTicket(attempt.ticket);
    if (
      ticket === null
      || attempt.attempt !== index + 1
      || ticket.attempt !== index + 1
      || ticket.purpose !== 'FLATTEN'
      || ticket.side !== 'SELL'
      || ticket.type !== 'LIMIT'
      || ticket.timeInForce !== 'FOK'
      || ticket.accountId !== sourceTicket.accountId
      || ticket.symbol !== sourceTicket.symbol
      || ticket.planId !== sourceTicket.planId
      || ticket.correlationId !== sourceTicket.correlationId
      || seenTickets.has(ticket.ticketId)
      || seenClients.has(ticket.clientOrderId)
      || (
        attempt.authoritativelyAbsent
          ? attempt.venueOrderId !== null || attempt.fills.length !== 0
          : (
            attempt.venueOrderId === null
            || !CONTROL_ID.test(attempt.venueOrderId)
            || seenOrders.has(attempt.venueOrderId)
          )
      )
    ) throw new TypeError('quote accounting flatten history is invalid');
    seenTickets.add(ticket.ticketId);
    seenClients.add(ticket.clientOrderId);
    if (attempt.venueOrderId !== null) {
      seenOrders.add(attempt.venueOrderId);
    }
    for (const fill of attempt.fills) {
      if (fillIds.has(fill.fillId) || attempt.venueOrderId === null) {
        throw new TypeError('quote accounting fill identity is not unique');
      }
      fillIds.add(fill.fillId);
      const exact = exactQuoteFill(fill, attempt.venueOrderId, ticket);
      flattenGrossQuoteCredit = addSpotDecimals(
        flattenGrossQuoteCredit,
        exact.quoteQuantity,
      );
      referenceFlattenQuote = addSpotDecimals(
        referenceFlattenQuote,
        exact.referenceQuoteQuantity,
      );
      addCommission('FLATTEN', exact.commissionAsset, exact.commission);
    }
  }

  const commissionTotals = Object.freeze(
    [...commissions.entries()]
      .map(([key, quantity]): Readonly<SpotCommissionTotal> => {
        const [leg, asset] = key.split('|');
        return Object.freeze({
          leg: leg as 'ENTRY' | 'FLATTEN',
          asset: asset!,
          quantity,
        });
      })
      .sort((left, right) => {
        const leftLeg = left.leg === 'ENTRY' ? 0 : 1;
        const rightLeg = right.leg === 'ENTRY' ? 0 : 1;
        return leftLeg - rightLeg
          || (left.asset < right.asset
            ? -1
            : left.asset > right.asset
              ? 1
              : 0);
      }),
  );
  const quoteCommissionDebit = commissionTotals
    .filter((row) => row.asset === input.quoteAsset)
    .reduce(
      (sum, row) => addSpotDecimals(sum, row.quantity),
      '0',
    );
  const grossObservedPnl = createSpotSignedQuoteAmount(
    flattenGrossQuoteCredit,
    sourceGrossQuoteDebit,
  );
  const referencePnlQuote = createSpotSignedQuoteAmount(
    referenceFlattenQuote,
    referenceEntryQuote,
  );
  const signedSlippageCostQuote = subtractSpotSignedQuoteAmounts(
    referencePnlQuote,
    grossObservedPnl,
  );
  const fillDerivedQuoteCashflow = signedQuoteMinusDebit(
    grossObservedPnl,
    quoteCommissionDebit,
  );
  const decomposedCashflow = signedQuoteMinusDebit(
    subtractSpotSignedQuoteAmounts(
      referencePnlQuote,
      signedSlippageCostQuote,
    ),
    quoteCommissionDebit,
  );
  if (!spotSignedQuoteAmountsEqual(
    fillDerivedQuoteCashflow,
    decomposedCashflow,
  )) {
    throw new TypeError('quote accounting decomposition does not balance');
  }
  const thirdAssetCommissionPresent = commissionTotals.some((row) =>
    row.asset !== input.baseAsset
    && row.asset !== input.quoteAsset
    && row.quantity !== '0',
  );
  return Object.freeze({
    sourceGrossQuoteDebit,
    flattenGrossQuoteCredit,
    observedGrossLifecycleTurnoverQuote: addSpotDecimals(
      sourceGrossQuoteDebit,
      flattenGrossQuoteCredit,
    ),
    authorizedFilledLifecycleTurnoverQuote: addSpotDecimals(
      sourceGrossQuoteDebit,
      referenceFlattenQuote,
    ),
    favorableSellPriceImprovementQuote: subtractSpotDecimals(
      flattenGrossQuoteCredit,
      referenceFlattenQuote,
    ),
    referencePnlQuote,
    signedSlippageCostQuote,
    quoteCommissionDebit,
    fillDerivedQuoteCashflow,
    realizedPnlAfterQuoteFees: fillDerivedQuoteCashflow,
    commissionTotals,
    quoteEconomicsStatus: thirdAssetCommissionPresent
      ? 'UNMEASURED_THIRD_ASSET_QUOTE_VALUE' as const
      : 'EXACT' as const,
    thirdAssetCommissionQuoteValueStatus: thirdAssetCommissionPresent
      ? 'UNMEASURED_NO_DIGEST_BOUND_VALUATION' as const
      : 'NOT_APPLICABLE' as const,
  });
}

function snapshotRecord(value: unknown): DataRecord | null {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      nodeUtilTypes.isProxy(value)
    ) {
      return null;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const snapshot: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') return null;
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ) {
        return null;
      }
      snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

function exactStringArray(value: unknown): readonly string[] | null {
  try {
    if (
      !Array.isArray(value) ||
      nodeUtilTypes.isProxy(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > 500
    ) {
      return null;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const output: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        descriptor === undefined ||
        !Object.prototype.hasOwnProperty.call(descriptor, 'value') ||
        typeof descriptor.value !== 'string' ||
        !SYMBOL.test(descriptor.value)
      ) {
        return null;
      }
      output.push(descriptor.value);
    }
    return Object.freeze(output);
  } catch {
    return null;
  }
}

function counts(value: MutableCounts): Readonly<SpotTransportCallCounts> {
  return Object.freeze({ ...value });
}

function result(
  status: SpotTransportCoordinatorStatus,
  symbol: string,
  lifecycle: Readonly<SpotLifecycleState> | null,
  reasonCodes: readonly string[],
  callCounts: MutableCounts,
): Readonly<SpotTransportCoordinatorResult> {
  return Object.freeze({
    schema: SPOT_TRANSPORT_COORDINATOR_SCHEMA,
    version: 1 as const,
    status,
    symbol,
    lifecycle,
    reasonCodes: Object.freeze([...new Set(reasonCodes)]),
    calls: counts(callCounts),
    liveExportReachable: false as const,
    automaticMutationRetry: false as const,
    executionAuthority: 'NONE' as const,
    externalActionAuthorization: 'NONE' as const,
  });
}

function admissionBlockCode(
  value: unknown,
  symbol: string,
  action: SpotTransportAction,
): string | null {
  const admission = snapshotRecord(value);
  if (admission === null) return 'ADMISSION_INVALID';
  if (
    action === 'ENTRY'
    && admission.killSwitchEngaged !== false
  ) return 'KILL_SWITCH_ENGAGED_OR_UNKNOWN';
  if (action === 'ENTRY' && admission.sourceEnabled !== true) {
    return 'SOURCE_DISABLED';
  }
  if (
    typeof admission.revision !== 'string' ||
    !CONTROL_ID.test(admission.revision)
  ) {
    return 'ADMISSION_INVALID';
  }
  const allowed = exactStringArray(admission.allowedSymbols);
  if (allowed === null) return 'ADMISSION_INVALID';
  const blocked = exactStringArray(admission.blockedSymbols);
  if (blocked === null) return 'ADMISSION_INVALID';
  if (action === 'FLATTEN') {
    return admission.recoveryAuthorizedUntilFlat === true
      ? null
      : 'RECOVERY_COVENANT_NOT_ACTIVE';
  }
  if (allowed.length === 0) return 'EMPTY_ALLOWLIST';
  if (allowed.length !== 1) return 'M0_ALLOWLIST_NOT_EXACTLY_ONE_SYMBOL';
  if (!allowed.includes(symbol)) return 'SYMBOL_NOT_ALLOWLISTED';
  if (blocked.includes(symbol)) return 'SYMBOL_BLOCKED';
  return null;
}

export function evaluateSpotTransportAdmission(
  value: unknown,
  symbol: string,
  action: SpotTransportAction,
): string | null {
  return admissionBlockCode(value, symbol, action);
}

async function preflight(
  symbol: string,
  action: SpotTransportAction,
  ports: Readonly<SpotTransportCoordinatorPorts>,
  callCounts: MutableCounts,
): Promise<string | null> {
  try {
    callCounts.admissions += 1;
    return admissionBlockCode(
      await ports.readAdmission(symbol, action),
      symbol,
      action,
    );
  } catch {
    return 'ADMISSION_UNAVAILABLE';
  }
}

function applied(
  state: Readonly<SpotLifecycleState> | null,
  event: SpotLifecycleEvent,
): Readonly<SpotLifecycleState> {
  const reduced = reduceSpotLifecycle(state, event);
  if (!reduced.applied) {
    throw new TypeError(`lifecycle rejected ${reduced.reason}`);
  }
  return reduced.state;
}

function eventEnvelope(
  state: Readonly<SpotLifecycleState> | null,
  ticketId: string,
): Readonly<{ eventId: string; sequence: number }> {
  const sequence = (state?.lastSequence ?? 0) + 1;
  return Object.freeze({
    eventId: `spot-coord-${ticketId}-${sequence}`,
    sequence,
  });
}

function sumFills(values: readonly Readonly<SpotFillObservation>[]): string {
  return values.reduce(
    (sum, fill) => addSpotDecimals(sum, fill.quantity),
    '0',
  );
}

function observeQuery(
  state: Readonly<SpotLifecycleState>,
  ticketId: string,
  observation: Extract<SpotQueryOutcome, { readonly kind: 'FOUND' }>,
): Readonly<{
  state: Readonly<SpotLifecycleState>;
  terminal: boolean;
}> {
  const terminal =
    observation.status === 'FILLED' ||
    observation.status === 'CANCELED' ||
    observation.status === 'REJECTED' ||
    observation.status === 'EXPIRED' ||
    observation.status === 'EXPIRED_IN_MATCH';
  if (
    observation.status === 'CANCELED' ||
    observation.status === 'REJECTED' ||
    observation.status === 'EXPIRED' ||
    observation.status === 'EXPIRED_IN_MATCH'
  ) {
    if (state.lifecycle === 'FILLED') {
      return Object.freeze({ state, terminal: true });
    }
    const next = applied(state, {
      ...eventEnvelope(state, ticketId),
      type: 'ORDER_CANCELLED',
      venueOrderId: observation.venueOrderId,
      cumulativeFilledQuantity: observation.cumulativeFilledQuantity,
    });
    return Object.freeze({ state: next, terminal });
  }
  const next = applied(state, {
    ...eventEnvelope(state, ticketId),
    type: 'FILL_OBSERVED',
    venueOrderId: observation.venueOrderId,
    cumulativeFilledQuantity: observation.cumulativeFilledQuantity,
  });
  return Object.freeze({ state: next, terminal });
}

function acceptedSignedTest(
  outcome: Readonly<SpotMutationOutcome>,
): boolean {
  if (
    outcome.kind !== 'ACKNOWLEDGED' ||
    outcome.venueOrderId !== null
  ) {
    return false;
  }
  try {
    return normalizeSpotDecimal(
      outcome.cumulativeFilledQuantity,
      'signed test fill',
    ) === '0';
  } catch {
    return false;
  }
}

function exactMutationReservation(
  value: Readonly<SpotMutationReservationReceipt> | null,
  action: 'ENTRY' | 'FLATTEN',
  ticket: Readonly<SpotExecutionTicket>,
  intent: Readonly<SpotLiveSubmitIntent | SpotFlattenIntent>,
): boolean {
  return (
    value !== null
    && value.schema === 'cosmos.foundation.spot-mutation-reservation.v1'
    && value.action === action
    && value.ticketId === ticket.ticketId
    && value.termsDigest === ticket.termsDigest
    && value.clientOrderId === ticket.clientOrderId
    && value.intentDigest === calculateM0SpotIntentDigest(intent)
    && value.durableAuthorityConsumed === true
    && value.canonicalOrderRequestAppended === true
    && value.dispatchClaimAvailable === true
    && value.replay === false
  );
}

function exactCancelReservation(
  value: Readonly<SpotCancelReservationReceipt> | null,
  action: 'ENTRY_CANCEL' | 'FLATTEN_CANCEL',
  ticket: Readonly<SpotExecutionTicket>,
  intent: Readonly<SpotCancelIntent>,
): boolean {
  return (
    value !== null
    && value.schema === 'cosmos.foundation.spot-cancel-reservation.v1'
    && value.action === action
    && value.ticketId === ticket.ticketId
    && value.termsDigest === ticket.termsDigest
    && value.clientOrderId === ticket.clientOrderId
    && value.intentDigest === calculateM0SpotIntentDigest(intent)
    && value.durableAuthorityConsumed === true
    && value.canonicalCancelAttemptAppended === true
    && value.dispatchClaimAvailable === true
    && typeof value.replay === 'boolean'
  );
}

async function queryOrder(
  ticket: Readonly<SpotExecutionTicket>,
  ports: Readonly<SpotTransportCoordinatorPorts>,
  callCounts: MutableCounts,
): Promise<Readonly<SpotQueryOutcome>> {
  callCounts.orderQueries += 1;
  return ports.executionPort.queryByOriginalClientOrderId(
    Object.freeze({
      kind: 'QUERY_BY_ORIGINAL_CLIENT_ORDER_ID' as const,
      ticketId: ticket.ticketId,
      symbol: ticket.symbol,
      originalClientOrderId: ticket.clientOrderId,
      readOnly: true as const,
    }),
  );
}

async function appendMutationAttempt(
  ticket: Readonly<SpotExecutionTicket>,
  attemptKind: 'ORDER' | 'CANCEL' | 'FLATTEN',
  ports: Readonly<SpotTransportCoordinatorPorts>,
  callCounts: MutableCounts,
): Promise<'FRESH' | 'DUPLICATE' | 'FAILED'> {
  const cancelId =
    attemptKind === 'CANCEL' ? `cancel-${ticket.ticketId}` : null;
  const flattenId =
    attemptKind === 'FLATTEN' ? ticket.ticketId : null;
  const fact =
    attemptKind === 'CANCEL'
      ? {
          eventKind: 'ATTEMPT' as const,
          eventRevision: `attempt-${attemptKind}-${ticket.ticketId}`,
          symbol: ticket.symbol,
          correlation: Object.freeze({
            ticketId: ticket.ticketId,
            clientOrderId: ticket.clientOrderId,
            orderId: null,
            fillId: null,
            cancelId,
            flattenId,
            attemptKind,
          }),
          occurredAtMs: ports.clock.nowMs(),
          status: 'SUBMITTING',
        }
      : {
          eventKind: 'ATTEMPT' as const,
          eventRevision: `attempt-${attemptKind}-${ticket.ticketId}`,
          symbol: ticket.symbol,
          correlation: Object.freeze({
            ticketId: ticket.ticketId,
            clientOrderId: ticket.clientOrderId,
            orderId: null,
            fillId: null,
            cancelId,
            flattenId,
            attemptKind,
          }),
          side: ticket.side,
          baseQuantity: ticket.quantity,
          quoteQuantity: ticket.orderNotionalQuote,
          occurredAtMs: ports.clock.nowMs(),
          status: 'SUBMITTING',
        };
  let intent: Readonly<SpotLedgerAppendIntent>;
  try {
    intent = buildSpotLedgerAppendIntent(fact, ports.clock);
  } catch {
    return 'FAILED';
  }
  callCounts.ledgerAppends += 1;
  try {
    const outcome = await ports.appendLedger(intent);
    if (outcome === 'APPENDED') return 'FRESH';
    if (outcome === 'DUPLICATE') return 'DUPLICATE';
    return 'FAILED';
  } catch {
    return 'FAILED';
  }
}

function fillSetMatchesOrder(
  fills: readonly Readonly<SpotFillObservation>[],
  venueOrderId: string | null,
): boolean {
  if (venueOrderId === null) return fills.length === 0;
  const fillIds = new Set<string>();
  for (const fill of fills) {
    if (
      fill.venueOrderId !== venueOrderId ||
      fillIds.has(fill.fillId)
    ) {
      return false;
    }
    fillIds.add(fill.fillId);
  }
  return true;
}

function exactDerivedFlattenLeg(
  request: Readonly<SpotDeriveFlattenLegRequest>,
  leg: Readonly<SpotTransportLegInput>,
): Readonly<DerivedFlattenLeg> | null {
  try {
    const ticket = leg.ticket;
    const quantityStepSize = lotSizeStep(leg.filterSnapshot);
    if (
      quantityStepSize === null
      || ticket.price === null
      || ticket.purpose !== 'FLATTEN'
      || ticket.side !== 'SELL'
      || ticket.type !== 'LIMIT'
      || ticket.timeInForce !== 'FOK'
      || ticket.attempt !== request.attempt
    ) return null;
    const derivationInput: DeriveFlattenLegInput = {
      sourceTicket: request.sourceTicket,
      sourceVenueOrderId: request.sourceVenueOrderId,
      sourceFills: request.sourceFills,
      previousFlattenAttempts: request.previousFlattenAttempts.map(
        (attempt): Readonly<SpotFlattenAttemptFillSet> => Object.freeze({
          ticket: attempt.ticket,
          venueOrderId: attempt.venueOrderId,
          authoritativelyAbsent: attempt.authoritativelyAbsent,
          fills: attempt.fills,
        }),
      ),
      baseAsset: request.baseAsset,
      exchangeBaseTolerance: request.exchangeBaseTolerance,
      maximumResidualDustNotionalQuote:
        request.maximumResidualDustNotionalQuote,
      maximumGrossLifecycleTurnoverQuote:
        request.maximumGrossLifecycleTurnoverQuote,
      totalFeeReserveQuote: request.totalFeeReserveQuote,
      quantityStepSize,
      attempt: request.attempt,
      price: ticket.price,
      riskReferencePrice: ticket.riskReferencePrice,
      estimatedMaxLossQuote: ticket.estimatedMaxLossQuote,
      createdAtMs: ticket.createdAtMs,
      expiresAtMs: ticket.expiresAtMs,
    };
    const derived = deriveFlattenLeg(derivationInput);
    return derived.ticket !== null
      && derived.ticket.ticketId === ticket.ticketId
      && derived.ticket.termsDigest === ticket.termsDigest
      && derived.ticket.clientOrderId === ticket.clientOrderId
      ? derived
      : null;
  } catch {
    return null;
  }
}

function lotSizeStep(
  snapshot: Readonly<SpotFilterSnapshot>,
): string | null {
  try {
    const rows = snapshot.filters
      .map((filter) => snapshotRecord(filter))
      .filter((filter): filter is DataRecord => filter !== null)
      .filter((filter) => filter.filterType === 'LOT_SIZE');
    if (rows.length !== 1 || typeof rows[0].stepSize !== 'string') return null;
    const step = normalizeSpotDecimal(rows[0].stepSize, 'LOT_SIZE stepSize');
    return step === '0' ? null : step;
  } catch {
    return null;
  }
}

function exactSourceFills(
  fills: readonly Readonly<SpotFillObservation>[],
  venueOrderId: string,
  cumulativeFilledQuantity: string,
): boolean {
  try {
    return fillSetMatchesOrder(fills, venueOrderId)
      && sumFills(fills) === normalizeSpotDecimal(
        cumulativeFilledQuantity,
        'source cumulative fill',
      );
  } catch {
    return false;
  }
}

function absoluteDifference(left: string, right: string): string {
  return compareSpotDecimals(left, right) >= 0
    ? subtractSpotDecimals(left, right)
    : subtractSpotDecimals(right, left);
}

function exactCoordinatorAccountingBasis(
  input: Readonly<SpotTransportCoordinatorInput>,
  entryTicket: Readonly<SpotExecutionTicket>,
): boolean {
  try {
    const feeReserve = normalizeSpotDecimal(
      input.totalFeeReserveQuote,
      'coordinator total fee reserve',
    );
    const maximumTurnover = normalizeSpotDecimal(
      input.maximumGrossLifecycleTurnoverQuote,
      'coordinator maximum lifecycle turnover',
    );
    const maximumDust = normalizeSpotDecimal(
      input.maximumResidualDustNotionalQuote,
      'coordinator maximum residual dust',
    );
    const baseTolerance = normalizeSpotDecimal(
      input.exchangeBaseTolerance,
      'coordinator base tolerance',
    );
    const baselineBase = normalizeSpotDecimal(
      input.baseBalanceBaseline.quantity,
      'coordinator baseline base quantity',
    );
    const baselineQuote = normalizeSpotDecimal(
      input.quoteBalanceBaseline.quantity,
      'coordinator baseline quote quantity',
    );
    const quoteTolerance = normalizeSpotDecimal(
      input.quoteBalanceBaseline.tolerance,
      'coordinator quote tolerance',
    );
    return (
      input.baseAsset.length >= 1
      && input.baseAsset.length <= 16
      && SYMBOL.test(input.baseAsset)
      && input.quoteAsset === 'USDT'
      && entryTicket.symbol === `${input.baseAsset}${input.quoteAsset}`
      && feeReserve === input.totalFeeReserveQuote
      && feeReserve === input.entry.readiness.totalFeeReserveQuote
      && compareSpotDecimals(
        feeReserve,
        entryTicket.estimatedMaxLossQuote,
      ) <= 0
      && maximumTurnover === input.maximumGrossLifecycleTurnoverQuote
      && maximumDust === input.maximumResidualDustNotionalQuote
      && baseTolerance === input.exchangeBaseTolerance
      && baselineBase === input.baseBalanceBaseline.quantity
      && baselineQuote === input.quoteBalanceBaseline.quantity
      && quoteTolerance === input.quoteBalanceBaseline.tolerance
      && CONTROL_ID.test(input.baseBalanceBaseline.revision)
      && input.quoteBalanceBaseline.revision
        === input.baseBalanceBaseline.revision
      && Number.isSafeInteger(input.baseBalanceBaseline.observedAtMs)
      && input.baseBalanceBaseline.observedAtMs >= 0
      && input.quoteBalanceBaseline.observedAtMs
        === input.baseBalanceBaseline.observedAtMs
      && input.baseBalanceBaseline.observedAtMs <= entryTicket.createdAtMs
    );
  } catch {
    return false;
  }
}

function exactPriorFlattenAttempts(
  attempts: readonly Readonly<SpotFlattenAttemptRecord>[] | undefined,
  entryTicket: Readonly<SpotExecutionTicket>,
  sourceVenueOrderId: string,
): readonly Readonly<SpotFlattenAttemptRecord>[] | null {
  if (attempts === undefined) return Object.freeze([]);
  if (
    !Array.isArray(attempts)
    || attempts.length > M0_SPOT_MAXIMUM_FLATTEN_SUBMISSIONS
  ) return null;
  const ticketIds = new Set([entryTicket.ticketId]);
  const clientOrderIds = new Set([entryTicket.clientOrderId]);
  const venueOrderIds = new Set([sourceVenueOrderId]);
  const fillIds = new Set<string>();
  const exact: Readonly<SpotFlattenAttemptRecord>[] = [];
  try {
    if (
      reconstructCanonicalSpotExecutionTicket(entryTicket) === null
    ) return null;
    for (let index = 0; index < attempts.length; index += 1) {
      const row = attempts[index];
      const expectedAttempt = index + 1;
      const ticket = reconstructCanonicalSpotExecutionTicket(
        row?.ticket,
      );
      if (
        ticket === null
        ||
        row?.attempt !== expectedAttempt
        || row.terminal !== true
        || row.fillsComplete !== true
        || ticket.purpose !== 'FLATTEN'
        || ticket.side !== 'SELL'
        || ticket.type !== 'LIMIT'
        || ticket.timeInForce !== 'FOK'
        || ticket.attempt !== expectedAttempt
        || ticket.accountId !== entryTicket.accountId
        || ticket.symbol !== entryTicket.symbol
        || ticket.planId !== entryTicket.planId
        || ticket.correlationId !== entryTicket.correlationId
        || typeof row.authoritativelyAbsent !== 'boolean'
        || (
          row.authoritativelyAbsent
            ? row.venueOrderId !== null || row.fills.length !== 0
            : (
              typeof row.venueOrderId !== 'string'
              || !CONTROL_ID.test(row.venueOrderId)
            )
        )
        || ticketIds.has(ticket.ticketId)
        || clientOrderIds.has(ticket.clientOrderId)
        || (
          row.venueOrderId !== null
          && venueOrderIds.has(row.venueOrderId)
        )
        || !fillSetMatchesOrder(row.fills, row.venueOrderId)
        || compareSpotDecimals(sumFills(row.fills), ticket.quantity) > 0
      ) return null;
      for (const fill of row.fills) {
        if (fillIds.has(fill.fillId)) return null;
        fillIds.add(fill.fillId);
      }
      ticketIds.add(ticket.ticketId);
      clientOrderIds.add(ticket.clientOrderId);
      if (row.venueOrderId !== null) {
        venueOrderIds.add(row.venueOrderId);
      }
      exact.push(Object.freeze({
        attempt: row.attempt,
        ticket,
        venueOrderId: row.venueOrderId,
        authoritativelyAbsent: row.authoritativelyAbsent,
        terminal: true,
        fillsComplete: true,
        fills: Object.freeze([...row.fills]),
      }));
    }
  } catch {
    return null;
  }
  return Object.freeze(exact);
}

function exactCommissionTotals(
  value: readonly Readonly<SpotCommissionTotal>[],
  expected: readonly Readonly<SpotCommissionTotal>[],
): boolean {
  if (!Array.isArray(value) || value.length !== expected.length) return false;
  try {
    for (let index = 0; index < expected.length; index += 1) {
      const row = value[index];
      const exact = expected[index]!;
      if (
        row === undefined
        || row.leg !== exact.leg
        || row.asset !== exact.asset
        || !/^[A-Z0-9]{1,16}$/u.test(row.asset)
        || normalizeSpotDecimal(
          row.quantity,
          'commission total quantity',
        ) !== exact.quantity
        || row.quantity !== exact.quantity
      ) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function exactFlatEvidence(
  evidence: Readonly<SpotAuthoritativeFlatEvidence> | null,
  entryTicket: Readonly<SpotExecutionTicket>,
  flattenTicket: Readonly<SpotExecutionTicket> | null,
  flattenVenueOrderId: string | null,
  lifecycle: Readonly<SpotLifecycleState>,
  sourceFills: readonly Readonly<SpotFillObservation>[],
  flattenFills: readonly Readonly<SpotFillObservation>[],
  request: Readonly<SpotFlatEvidenceRequest>,
): boolean {
  if (evidence === null) return false;
  const discrepancy = classifySpotLedgerDiscrepancy({
    canonicalStatus: evidence.canonicalStatus,
    ledgerState: evidence.ledgerState,
  });
  if (
    discrepancy.classification !== 'EXACT' ||
    evidence.sourceTicketId !== entryTicket.ticketId ||
    evidence.sourceClientOrderId !== entryTicket.clientOrderId ||
    evidence.sourceVenueOrderId !== lifecycle.venueOrderId ||
    evidence.sourceOrderAuthoritativelyAbsent
      !== request.sourceOrderAuthoritativelyAbsent ||
    evidence.sourceOpenOrderAbsent !== true ||
    evidence.sourceOrderTerminal !== true ||
    evidence.sourceFillsComplete !== true ||
    evidence.flattenTicketId !== (flattenTicket?.ticketId ?? null) ||
    evidence.flattenClientOrderId !==
      (flattenTicket?.clientOrderId ?? null) ||
    evidence.flattenVenueOrderId !== flattenVenueOrderId ||
    evidence.flattenOrderTerminal !== true ||
    evidence.flattenFillsComplete !== true ||
    evidence.baseAsset !== request.baseAsset ||
    evidence.baselineRevision !== request.baselineRevision ||
    evidence.baselineBaseQuantity !== request.baselineBaseQuantity ||
    evidence.exchangeBaseTolerance !== request.exchangeBaseTolerance ||
    evidence.maximumResidualDustNotionalQuote
      !== request.maximumResidualDustNotionalQuote ||
    evidence.residualDustNotionalQuote
      !== request.expectedResidualDustNotionalQuote ||
    evidence.sourceBaseCommissionQuantity
      !== request.sourceBaseCommissionQuantity ||
    evidence.flattenBaseCommissionQuantity
      !== request.flattenBaseCommissionQuantity ||
    evidence.canaryAttributableBaseDeltaQuantity
      !== request.expectedCanaryAttributableBaseDeltaQuantity ||
    evidence.flattenAttemptCount !== request.flattenAttempts.length ||
    evidence.allFlattenOrdersTerminal !== true ||
    evidence.allFlattenFillsComplete !== true ||
    evidence.flattenOpenOrdersAbsent !== true ||
    !Array.isArray(evidence.authoritativelyAbsentFlattenClientOrderIds) ||
    evidence.authoritativelyAbsentFlattenClientOrderIds.length
      !== request.authoritativelyAbsentFlattenClientOrderIds.length ||
    evidence.authoritativelyAbsentFlattenClientOrderIds.some(
      (clientOrderId, index) =>
        clientOrderId
          !== request.authoritativelyAbsentFlattenClientOrderIds[index],
    ) ||
    evidence.quoteAsset !== request.quoteAsset ||
    evidence.baselineQuoteQuantity !== request.baselineQuoteQuantity ||
    evidence.quoteQuantityTolerance !== request.quoteQuantityTolerance ||
    evidence.sourceGrossQuoteDebit !== request.sourceGrossQuoteDebit ||
    evidence.flattenGrossQuoteCredit !== request.flattenGrossQuoteCredit ||
    evidence.observedGrossLifecycleTurnoverQuote
      !== request.observedGrossLifecycleTurnoverQuote ||
    evidence.authorizedFilledLifecycleTurnoverQuote
      !== request.authorizedFilledLifecycleTurnoverQuote ||
    evidence.favorableSellPriceImprovementQuote
      !== request.favorableSellPriceImprovementQuote ||
    !spotSignedQuoteAmountsEqual(
      evidence.referencePnlQuote,
      request.referencePnlQuote,
    ) ||
    !spotSignedQuoteAmountsEqual(
      evidence.signedSlippageCostQuote,
      request.signedSlippageCostQuote,
    ) ||
    evidence.quoteCommissionDebit !== request.quoteCommissionDebit ||
    !spotSignedQuoteAmountsEqual(
      evidence.fillDerivedQuoteCashflow,
      request.fillDerivedQuoteCashflow,
    ) ||
    !spotSignedQuoteAmountsEqual(
      evidence.realizedPnlAfterQuoteFees,
      request.realizedPnlAfterQuoteFees,
    ) ||
    !exactCommissionTotals(
      evidence.commissionTotals,
      request.commissionTotals,
    ) ||
    evidence.quoteCashflowStatus !== 'EXACT_WITHIN_TOLERANCE' ||
    evidence.quoteEconomicsStatus !== request.quoteEconomicsStatus ||
    evidence.thirdAssetCommissionQuoteValueStatus
      !== request.thirdAssetCommissionQuoteValueStatus ||
    evidence.thirdAssetCommissionQuoteValue !== null ||
    evidence.thirdAssetValuationDigest !== null
  ) {
    return false;
  }
  if (
    !fillSetMatchesOrder(sourceFills, evidence.sourceVenueOrderId) ||
    !request.flattenAttempts.every((attempt) =>
      fillSetMatchesOrder(attempt.fills, attempt.venueOrderId))
  ) {
    return false;
  }
  const allFillIds = new Set(
    [...sourceFills, ...flattenFills].map((fill) => fill.fillId),
  );
  if (allFillIds.size !== sourceFills.length + flattenFills.length) {
    return false;
  }
  try {
    const quoteAccounting = deriveSpotQuoteAccounting({
      sourceTicket: entryTicket,
      sourceVenueOrderId: lifecycle.venueOrderId,
      sourceFills,
      flattenAttempts: request.flattenAttempts,
      baseAsset: request.baseAsset,
      quoteAsset: request.quoteAsset,
    });
    if (
      quoteAccounting.sourceGrossQuoteDebit
        !== request.sourceGrossQuoteDebit
      || quoteAccounting.flattenGrossQuoteCredit
        !== request.flattenGrossQuoteCredit
      || quoteAccounting.observedGrossLifecycleTurnoverQuote
        !== request.observedGrossLifecycleTurnoverQuote
      || quoteAccounting.authorizedFilledLifecycleTurnoverQuote
        !== request.authorizedFilledLifecycleTurnoverQuote
      || quoteAccounting.favorableSellPriceImprovementQuote
        !== request.favorableSellPriceImprovementQuote
      || !spotSignedQuoteAmountsEqual(
        quoteAccounting.referencePnlQuote,
        request.referencePnlQuote,
      )
      || !spotSignedQuoteAmountsEqual(
        quoteAccounting.signedSlippageCostQuote,
        request.signedSlippageCostQuote,
      )
      || quoteAccounting.quoteCommissionDebit
        !== request.quoteCommissionDebit
      || !spotSignedQuoteAmountsEqual(
        quoteAccounting.fillDerivedQuoteCashflow,
        request.fillDerivedQuoteCashflow,
      )
      || !spotSignedQuoteAmountsEqual(
        quoteAccounting.realizedPnlAfterQuoteFees,
        request.realizedPnlAfterQuoteFees,
      )
      || !exactCommissionTotals(
        request.commissionTotals,
        quoteAccounting.commissionTotals,
      )
      || quoteAccounting.quoteEconomicsStatus
        !== request.quoteEconomicsStatus
      || quoteAccounting.thirdAssetCommissionQuoteValueStatus
        !== request.thirdAssetCommissionQuoteValueStatus
    ) return false;
    const baselineQuote = normalizeSpotDecimal(
      request.baselineQuoteQuantity,
      'baseline quote quantity',
    );
    const observedQuote = normalizeSpotDecimal(
      evidence.observedQuoteQuantity,
      'observed quote quantity',
    );
    const quoteTolerance = normalizeSpotDecimal(
      request.quoteQuantityTolerance,
      'quote quantity tolerance',
    );
    const observedQuoteDelta = createSpotSignedQuoteAmount(
      observedQuote,
      baselineQuote,
    );
    const quoteEquationResidual = subtractSpotSignedQuoteAmounts(
      observedQuoteDelta,
      request.fillDerivedQuoteCashflow,
    );
    const latestFillOccurredAtMs = [...sourceFills, ...flattenFills]
      .reduce(
        (latest, fill) => Math.max(latest, fill.occurredAtMs),
        request.baselineObservedAtMs,
      );
    return (
      normalizeSpotDecimal(
        evidence.sourceCumulativeFilledQuantity,
        'source cumulative fill',
      ) === lifecycle.cumulativeFilledQuantity &&
      normalizeSpotDecimal(
        evidence.flattenCumulativeFilledQuantity,
        'flatten cumulative fill',
      ) === lifecycle.cumulativeFlattenedQuantity &&
      sumFills(sourceFills) === lifecycle.cumulativeFilledQuantity &&
      sumFills(flattenFills) === request.cumulativeFilledSellQuantity &&
      baselineQuote === request.baselineQuoteQuantity &&
      observedQuote === evidence.observedQuoteQuantity &&
      quoteTolerance === request.quoteQuantityTolerance &&
      spotSignedQuoteAmountsEqual(
        evidence.observedQuoteDelta,
        observedQuoteDelta,
      ) &&
      spotSignedQuoteAmountsEqual(
        evidence.quoteEquationResidual,
        quoteEquationResidual,
      ) &&
      compareSpotDecimals(
        quoteEquationResidual.quantity,
        quoteTolerance,
      ) <= 0 &&
      Number.isSafeInteger(evidence.occurredAtMs) &&
      evidence.occurredAtMs >= latestFillOccurredAtMs &&
      compareSpotDecimals(
        request.expectedCanaryAttributableBaseDeltaQuantity,
        request.exchangeBaseTolerance,
      ) <= 0 &&
      compareSpotDecimals(
        request.expectedResidualDustNotionalQuote,
        request.maximumResidualDustNotionalQuote,
      ) <= 0 &&
      compareSpotDecimals(
        multiplySpotDecimals(
          absoluteDifference(
            evidence.observedBaseQuantity,
            evidence.baselineBaseQuantity,
          ),
          entryTicket.riskReferencePrice,
        ),
        request.maximumResidualDustNotionalQuote,
      ) <= 0 &&
      compareSpotDecimals(
        absoluteDifference(
          evidence.observedBaseQuantity,
          evidence.baselineBaseQuantity,
        ),
        request.exchangeBaseTolerance,
      ) <= 0
    );
  } catch {
    return false;
  }
}

async function reconcileAuthoritativelyAbsentSource(
  symbol: string,
  input: Readonly<SpotTransportCoordinatorInput>,
  ports: Readonly<SpotTransportCoordinatorPorts>,
  callCounts: MutableCounts,
  entryTicket: Readonly<SpotExecutionTicket>,
  lifecycle: Readonly<SpotLifecycleState>,
): Promise<Readonly<SpotTransportCoordinatorResult>> {
  const baseline = input.baseBalanceBaseline;
  const quoteBaseline = input.quoteBalanceBaseline;
  let flatRequest: Readonly<SpotFlatEvidenceRequest>;
  try {
    const step = lotSizeStep(input.entry.filterSnapshot);
    const tolerance = normalizeSpotDecimal(
      input.exchangeBaseTolerance,
      'exchange base tolerance',
    );
    const maximumDust = normalizeSpotDecimal(
      input.maximumResidualDustNotionalQuote,
      'maximum residual dust notional quote',
    );
    const quoteAccounting = deriveSpotQuoteAccounting({
      sourceTicket: entryTicket,
      sourceVenueOrderId: null,
      sourceFills: NO_FILLS,
      flattenAttempts: Object.freeze([]),
      baseAsset: input.baseAsset,
      quoteAsset: input.quoteAsset,
    });
    if (
      step === null
      || maximumDust === '0'
      || compareSpotDecimals(tolerance, step) >= 0
      || compareSpotDecimals(
        multiplySpotDecimals(maximumDust, '100'),
        entryTicket.orderNotionalQuote,
      ) > 0
    ) throw new TypeError();
    flatRequest = Object.freeze({
      sourceTicket: entryTicket,
      flattenTicket: null,
      lifecycle,
      sourceOrderAuthoritativelyAbsent: true,
      sourceFills: NO_FILLS,
      flattenFills: NO_FILLS,
      flattenAttempts: Object.freeze([]),
      authoritativelyAbsentFlattenClientOrderIds: Object.freeze([]),
      baseAsset: input.baseAsset,
      baselineRevision: baseline.revision,
      baselineBaseQuantity: normalizeSpotDecimal(
        baseline.quantity,
        'baseline base quantity',
      ),
      baselineObservedAtMs: baseline.observedAtMs,
      quoteAsset: input.quoteAsset,
      baselineQuoteQuantity: normalizeSpotDecimal(
        quoteBaseline.quantity,
        'baseline quote quantity',
      ),
      quoteQuantityTolerance: normalizeSpotDecimal(
        quoteBaseline.tolerance,
        'quote quantity tolerance',
      ),
      exchangeBaseTolerance: tolerance,
      maximumResidualDustNotionalQuote: maximumDust,
      expectedResidualDustNotionalQuote: '0',
      sourceGrossFilledBaseQuantity: '0',
      sourceBaseCommissionQuantity: '0',
      sourceAttributableBaseQuantity: '0',
      cumulativeFilledSellQuantity: '0',
      flattenBaseCommissionQuantity: '0',
      expectedCanaryAttributableBaseDeltaQuantity: '0',
      observedGrossLifecycleTurnoverQuote:
        quoteAccounting.observedGrossLifecycleTurnoverQuote,
      authorizedFilledLifecycleTurnoverQuote:
        quoteAccounting.authorizedFilledLifecycleTurnoverQuote,
      maximumAuthorizedLifecycleTurnoverQuote: normalizeSpotDecimal(
        input.maximumGrossLifecycleTurnoverQuote,
        'maximum gross lifecycle turnover quote',
      ),
      favorableSellPriceImprovementQuote:
        quoteAccounting.favorableSellPriceImprovementQuote,
      sourceGrossQuoteDebit: quoteAccounting.sourceGrossQuoteDebit,
      flattenGrossQuoteCredit:
        quoteAccounting.flattenGrossQuoteCredit,
      referencePnlQuote: quoteAccounting.referencePnlQuote,
      signedSlippageCostQuote:
        quoteAccounting.signedSlippageCostQuote,
      quoteCommissionDebit: quoteAccounting.quoteCommissionDebit,
      fillDerivedQuoteCashflow:
        quoteAccounting.fillDerivedQuoteCashflow,
      realizedPnlAfterQuoteFees:
        quoteAccounting.realizedPnlAfterQuoteFees,
      commissionTotals: quoteAccounting.commissionTotals,
      quoteEconomicsStatus: quoteAccounting.quoteEconomicsStatus,
      thirdAssetCommissionQuoteValueStatus:
        quoteAccounting.thirdAssetCommissionQuoteValueStatus,
    });
    if (
      !CONTROL_ID.test(flatRequest.baselineRevision)
      || quoteBaseline.revision !== flatRequest.baselineRevision
      || !Number.isSafeInteger(flatRequest.baselineObservedAtMs)
      || flatRequest.baselineObservedAtMs < 0
      || flatRequest.baselineObservedAtMs > entryTicket.createdAtMs
      || quoteBaseline.observedAtMs !== flatRequest.baselineObservedAtMs
    ) throw new TypeError();
  } catch {
    return result(
      'RECOVERY_REQUIRED',
      symbol,
      lifecycle,
      ['SOURCE_ABSENT_BASELINE_CONTRACT_INVALID'],
      callCounts,
    );
  }
  let evidence: Readonly<SpotAuthoritativeFlatEvidence> | null;
  try {
    evidence = await ports.readFlatEvidence(flatRequest);
  } catch {
    evidence = null;
  }
  if (
    !exactFlatEvidence(
      evidence,
      entryTicket,
      null,
      null,
      lifecycle,
      NO_FILLS,
      NO_FILLS,
      flatRequest,
    )
    || evidence === null
  ) {
    return result(
      'RECOVERY_REQUIRED',
      symbol,
      lifecycle,
      ['SOURCE_ABSENT_ACCOUNT_OR_OPEN_ORDER_EVIDENCE_INCOMPLETE'],
      callCounts,
    );
  }
  const correlation = Object.freeze({
    ticketId: entryTicket.ticketId,
    clientOrderId: entryTicket.clientOrderId,
    orderId: null,
    fillId: null,
    cancelId: null,
    flattenId: null,
    attemptKind: 'ORDER' as const,
  });
  const intent = buildSpotLedgerAppendIntent(
    {
      eventKind: 'RECONCILIATION',
      eventRevision: evidence.revision,
      symbol,
      correlation,
      side: entryTicket.side,
      baseQuantity: '0',
      quoteQuantity: evidence.observedGrossLifecycleTurnoverQuote,
      feeQuantity: evidence.quoteCommissionDebit,
      feeAsset: evidence.quoteAsset,
      occurredAtMs: evidence.occurredAtMs,
      status: 'EXACT',
    },
    ports.clock,
  );
  callCounts.ledgerAppends += 1;
  try {
    const append = await ports.appendLedger(intent);
    if (append !== 'APPENDED' && append !== 'DUPLICATE') {
      throw new TypeError();
    }
  } catch {
    return result(
      'RECOVERY_REQUIRED',
      symbol,
      lifecycle,
      ['SOURCE_ABSENT_RECONCILIATION_APPEND_FAILED'],
      callCounts,
    );
  }
  return result(
    'FLAT_RECONCILED',
    symbol,
    lifecycle,
    NO_REASONS,
    callCounts,
  );
}

async function recoverAndReconcile(
  symbol: string,
  input: Readonly<SpotTransportCoordinatorInput>,
  ports: Readonly<SpotTransportCoordinatorPorts>,
  callCounts: MutableCounts,
  entryTicket: Readonly<SpotExecutionTicket>,
  startingLifecycle: Readonly<SpotLifecycleState>,
  sourceTerminal: boolean,
): Promise<Readonly<SpotTransportCoordinatorResult>> {
  let lifecycle = startingLifecycle;
  if (!sourceTerminal) {
    return result(
      'RECOVERY_REQUIRED',
      symbol,
      lifecycle,
      ['SOURCE_ORDER_NOT_TERMINAL'],
      callCounts,
    );
  }
  const sourceVenueOrderId = lifecycle.venueOrderId;
  if (sourceVenueOrderId === null) {
    return result(
      'RECOVERY_REQUIRED',
      symbol,
      lifecycle,
      ['SOURCE_ORDER_ID_MISSING'],
      callCounts,
    );
  }
  let sourceFills: readonly Readonly<SpotFillObservation>[];
  try {
    callCounts.fillQueries += 1;
    sourceFills = await ports.executionPort.queryFills(
      Object.freeze({
        kind: 'QUERY_FILLS' as const,
        ticketId: entryTicket.ticketId,
        symbol,
        originalClientOrderId: entryTicket.clientOrderId,
        venueOrderId: sourceVenueOrderId,
        readOnly: true as const,
      }),
    );
  } catch {
    return result(
      'RECOVERY_REQUIRED',
      symbol,
      lifecycle,
      ['SOURCE_FILL_QUERY_UNRESOLVED'],
      callCounts,
    );
  }
  if (
    !exactSourceFills(
      sourceFills,
      sourceVenueOrderId,
      lifecycle.cumulativeFilledQuantity,
    )
  ) {
    return result(
      'RECOVERY_REQUIRED',
      symbol,
      lifecycle,
      ['SOURCE_FILLS_NOT_EXACT'],
      callCounts,
    );
  }
  const sourceQuantityStep = lotSizeStep(input.entry.filterSnapshot);
  if (sourceQuantityStep === null) {
    return result(
      'RECOVERY_REQUIRED',
      symbol,
      lifecycle,
      ['LOT_SIZE_STEP_UNAVAILABLE'],
      callCounts,
    );
  }

  if (compareSpotDecimals(lifecycle.cumulativeFilledQuantity, '0') > 0) {
    lifecycle = applied(lifecycle, {
      ...eventEnvelope(lifecycle, entryTicket.ticketId),
      type: 'FLATTEN_REQUIRED',
      sourceOrderTerminal: true,
    });
  }

  const exactPriorAttempts = exactPriorFlattenAttempts(
    input.priorFlattenAttempts,
    entryTicket,
    sourceVenueOrderId,
  );
  if (exactPriorAttempts === null) {
    return result(
      'RECOVERY_REQUIRED',
      symbol,
      lifecycle,
      ['PRIOR_FLATTEN_HISTORY_INVALID'],
      callCounts,
    );
  }
  const flattenAttempts: Readonly<SpotFlattenAttemptRecord>[] = [
    ...exactPriorAttempts,
  ];
  let latestDerivation: Readonly<DerivedFlattenLeg> | null = null;
  let flattenTicket: Readonly<SpotExecutionTicket> | null =
    flattenAttempts.at(-1)?.ticket ?? null;
  let flattenVenueOrderId: string | null =
    flattenAttempts.at(-1)?.venueOrderId ?? null;
  let flattenFills: readonly Readonly<SpotFillObservation>[] = Object.freeze(
    flattenAttempts.flatMap((row) => row.fills),
  );
  const entryFokBreach =
    lifecycle.cumulativeFilledQuantity !== '0'
    && lifecycle.cumulativeFilledQuantity !== entryTicket.quantity;
  let flattenFokBreach = flattenAttempts.some((row) => {
    const filled = sumFills(row.fills);
    return filled !== '0' && filled !== row.ticket.quantity;
  });
  if (flattenAttempts.length > 0) {
    lifecycle = applied(lifecycle, {
      ...eventEnvelope(lifecycle, entryTicket.ticketId),
      type: 'FLATTEN_STARTED',
    });
    lifecycle = applied(lifecycle, {
      ...eventEnvelope(lifecycle, entryTicket.ticketId),
      type: 'FLATTEN_FILL_OBSERVED',
      cumulativeFlattenedQuantity: sumFills(flattenFills),
    });
  }

  for (
    let attempt = flattenAttempts.length + 1;
    attempt <= M0_SPOT_MAXIMUM_FLATTEN_SUBMISSIONS;
    attempt += 1
  ) {
    const derivationRequest = Object.freeze({
      sourceTicket: entryTicket,
      sourceVenueOrderId,
      sourceFills,
      previousFlattenAttempts: Object.freeze([...flattenAttempts]),
      baseAsset: input.baseAsset,
      exchangeBaseTolerance: input.exchangeBaseTolerance,
      maximumResidualDustNotionalQuote:
        input.maximumResidualDustNotionalQuote,
      maximumGrossLifecycleTurnoverQuote:
        input.maximumGrossLifecycleTurnoverQuote,
      totalFeeReserveQuote: input.totalFeeReserveQuote,
      attempt,
    });
    let flatten: Readonly<SpotTransportLegInput> | null;
    try {
      flatten = ports.deriveFlattenLeg(derivationRequest);
    } catch {
      flatten = null;
    }
    if (flatten === null) {
      try {
        const sourcePrice = entryTicket.price;
        if (sourcePrice === null) throw new TypeError();
        latestDerivation = deriveFlattenLeg({
          sourceTicket: entryTicket,
          sourceVenueOrderId,
          sourceFills,
          previousFlattenAttempts: flattenAttempts.map(
            (row): Readonly<SpotFlattenAttemptFillSet> => Object.freeze({
              ticket: row.ticket,
              venueOrderId: row.venueOrderId,
              authoritativelyAbsent: row.authoritativelyAbsent,
              fills: row.fills,
            }),
          ),
          baseAsset: input.baseAsset,
          exchangeBaseTolerance: input.exchangeBaseTolerance,
          maximumResidualDustNotionalQuote:
            input.maximumResidualDustNotionalQuote,
          maximumGrossLifecycleTurnoverQuote:
            input.maximumGrossLifecycleTurnoverQuote,
          totalFeeReserveQuote: input.totalFeeReserveQuote,
          quantityStepSize: sourceQuantityStep,
          attempt,
          price: sourcePrice,
          riskReferencePrice: entryTicket.riskReferencePrice,
          estimatedMaxLossQuote: entryTicket.estimatedMaxLossQuote,
          createdAtMs: ports.clock.nowMs(),
          expiresAtMs: Math.max(
            ports.clock.nowMs() + 1,
            entryTicket.expiresAtMs,
          ),
        });
      } catch {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['FLATTEN_DERIVATION_FAILED'],
          callCounts,
        );
      }
      if (latestDerivation.ticket === null) break;
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        ['FRESH_DERIVED_FLATTEN_LEG_MISSING'],
        callCounts,
      );
    }

    latestDerivation = exactDerivedFlattenLeg(derivationRequest, flatten);
    if (latestDerivation === null || latestDerivation.ticket === null) {
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        ['FLATTEN_DERIVATION_BINDING_INVALID'],
        callCounts,
      );
    }
    const reduction = flatten.riskEvidence?.riskReduction;
    if (
      reduction === null
      || reduction === undefined
      || reduction.availableBaseQuantity
        !== latestDerivation.sellQuantity
      || reduction.attributableBaseQuantity
        !== latestDerivation.attributableBaseQuantity
      || reduction.cumulativeFilledSellQuantity
        !== latestDerivation.cumulativeFilledSellQuantity
      || reduction.cumulativeAuthorizedLifecycleTurnoverQuote
        !== latestDerivation.authorizedFilledLifecycleTurnoverQuote
      || reduction.maximumAuthorizedLifecycleTurnoverQuote
        !== latestDerivation.maximumAuthorizedLifecycleTurnoverQuote
      || reduction.quantityStepSize
        !== latestDerivation.quantityStepSize
    ) {
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        ['FLATTEN_RISK_EVIDENCE_DERIVATION_MISMATCH'],
        callCounts,
      );
    }
    flattenTicket = latestDerivation.ticket;
    const flattenAdmission = await preflight(
      symbol,
      'FLATTEN',
      ports,
      callCounts,
    );
    if (flattenAdmission !== null) {
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        [flattenAdmission, 'FLATTEN_BLOCKED_WITH_RESIDUAL'],
        callCounts,
      );
    }
    const flattenDecision = decideSpotRecoveryFlatten({
      ticket: flattenTicket,
      sourceTicket: entryTicket,
      residualQuantity:
        latestDerivation.remainingAttributableBaseQuantity,
      residualRemainderQuantity:
        latestDerivation.roundingRemainderBaseQuantity,
      exchangeBaseTolerance: latestDerivation.exchangeBaseTolerance,
      maximumResidualDustNotionalQuote:
        latestDerivation.maximumResidualDustNotionalQuote,
      projectedLifecycleQuoteShortfall:
        latestDerivation.projectedLifecycleQuoteShortfall,
      filterSnapshot: flatten.filterSnapshot,
      nowMs: ports.clock.nowMs(),
      riskEvidence: flatten.riskEvidence,
      venueEvidence: flatten.venueEvidence,
      readiness: flatten.readiness,
      ownerAuthority: flatten.ownerAuthority,
    });
    const finalFlattenAdmission = await preflight(
      symbol,
      'FLATTEN',
      ports,
      callCounts,
    );
    if (finalFlattenAdmission !== null) {
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        [finalFlattenAdmission, 'FLATTEN_BLOCKED_WITH_RESIDUAL'],
        callCounts,
      );
    }
    if (
      !flattenDecision.allowed
      || flattenDecision.intent === null
      || flatten.ownerAuthority === null
    ) {
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        ['FLATTEN_SEND_BLOCKED', ...flattenDecision.blockingCodes],
        callCounts,
      );
    }
    callCounts.authorityConsumptions += 1;
    let flattenReserved = false;
    try {
      flattenReserved = exactMutationReservation(
        await ports.reserveMutation(
          flatten.ownerAuthority,
          flattenDecision.intent,
        ),
        'FLATTEN',
        flattenTicket,
        flattenDecision.intent,
      );
    } catch {
      flattenReserved = false;
    }
    if (!flattenReserved) {
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        ['FLATTEN_MUTATION_NOT_ATOMICALLY_RESERVED'],
        callCounts,
      );
    }
    const flattenAttemptFence = await appendMutationAttempt(
      flattenTicket,
      'FLATTEN',
      ports,
      callCounts,
    );
    if (flattenAttemptFence !== 'FRESH') {
      try {
        await queryOrder(flattenTicket, ports, callCounts);
      } catch {
        // The exact prior identity remains fenced.
      }
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        [
          flattenAttemptFence === 'DUPLICATE'
            ? 'FLATTEN_ATTEMPT_ALREADY_EXISTS_NO_RESEND'
            : 'FLATTEN_ATTEMPT_LEDGER_NOT_DURABLE',
        ],
        callCounts,
      );
    }
    const immediateFlattenAdmission = await preflight(
      symbol,
      'FLATTEN',
      ports,
      callCounts,
    );
    if (immediateFlattenAdmission !== null) {
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        [
          immediateFlattenAdmission,
          'FLATTEN_AUTHORITY_CONSUMED_SEND_NOW_BLOCKED',
        ],
        callCounts,
      );
    }
    if (flattenAttempts.length === 0) {
      lifecycle = applied(lifecycle, {
        ...eventEnvelope(lifecycle, entryTicket.ticketId),
        type: 'FLATTEN_STARTED',
      });
    }
    callCounts.flattens += 1;
    let flattenOutcome: Readonly<SpotMutationOutcome>;
    try {
      flattenOutcome = await ports.executionPort.flatten(
        flattenDecision.intent,
      );
    } catch {
      flattenOutcome = Object.freeze({
        kind: 'AMBIGUOUS' as const,
        reasonCode: 'FLATTEN_TRANSPORT_THROW',
        queryOriginalClientOrderId: flattenTicket.clientOrderId,
        automaticRetry: false as const,
      });
    }
    if (
      flattenOutcome.kind === 'AMBIGUOUS'
      && (
        flattenOutcome.automaticRetry !== false
        || flattenOutcome.queryOriginalClientOrderId
          !== flattenTicket.clientOrderId
      )
    ) {
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        ['FLATTEN_AMBIGUITY_BINDING_INVALID'],
        callCounts,
      );
    }
    flattenVenueOrderId =
      flattenOutcome.kind === 'ACKNOWLEDGED'
        ? flattenOutcome.venueOrderId
        : null;
    let flattenObservation: Readonly<SpotQueryOutcome>;
    try {
      flattenObservation = await queryOrder(
        flattenTicket,
        ports,
        callCounts,
      );
    } catch {
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        ['FLATTEN_QUERY_FAILED'],
        callCounts,
      );
    }
    if (
      flattenObservation.kind !== 'FOUND'
      || flattenObservation.venueOrderId === null
    ) {
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        ['FLATTEN_QUERY_UNRESOLVED_NO_RESUBMIT'],
        callCounts,
      );
    }
    if (
      flattenVenueOrderId !== null
      && flattenVenueOrderId !== flattenObservation.venueOrderId
    ) {
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        ['FLATTEN_ORDER_IDENTITY_CONFLICT'],
        callCounts,
      );
    }
    flattenVenueOrderId = flattenObservation.venueOrderId;
    let flattenTerminal =
      flattenObservation.status === 'FILLED'
      || flattenObservation.status === 'CANCELED'
      || flattenObservation.status === 'REJECTED'
      || flattenObservation.status === 'EXPIRED'
      || flattenObservation.status === 'EXPIRED_IN_MATCH';
    if (!flattenTerminal) {
      const flattenCancelAttemptFence = await appendMutationAttempt(
        flattenTicket,
        'CANCEL',
        ports,
        callCounts,
      );
      if (flattenCancelAttemptFence === 'FAILED') {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['FLATTEN_CANCEL_ATTEMPT_LEDGER_NOT_DURABLE'],
          callCounts,
        );
      }
      const flattenCancelIntent = Object.freeze({
        kind: 'CANCEL_BY_ORIGINAL_CLIENT_ORDER_ID' as const,
        ticketId: flattenTicket.ticketId,
        symbol,
        originalClientOrderId: flattenTicket.clientOrderId,
        automaticRetry: false as const,
      });
      let flattenCancelReservation:
        Readonly<SpotCancelReservationReceipt> | null = null;
      try {
        flattenCancelReservation = await ports.reserveCancel(
          'FLATTEN_CANCEL',
          flattenTicket,
          flattenCancelIntent,
        );
      } catch {
        flattenCancelReservation = null;
      }
      if (!exactCancelReservation(
        flattenCancelReservation,
        'FLATTEN_CANCEL',
        flattenTicket,
        flattenCancelIntent,
      )) {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['FLATTEN_CANCEL_NOT_DURABLY_RESERVED_NO_RETRY'],
          callCounts,
        );
      }
      if (flattenCancelReservation!.replay === false) {
        callCounts.authorityConsumptions += 1;
      }
      callCounts.cancels += 1;
      let flattenCancelOutcome: Readonly<SpotMutationOutcome>;
      try {
        flattenCancelOutcome = await ports.executionPort.cancel(
          flattenCancelIntent,
        );
      } catch {
        flattenCancelOutcome = Object.freeze({
          kind: 'AMBIGUOUS' as const,
          reasonCode: 'FLATTEN_CANCEL_TRANSPORT_THROW',
          queryOriginalClientOrderId: flattenTicket.clientOrderId,
          automaticRetry: false as const,
        });
      }
      if (
        flattenCancelOutcome.kind === 'AMBIGUOUS'
        && (
          flattenCancelOutcome.automaticRetry !== false
          || flattenCancelOutcome.queryOriginalClientOrderId
            !== flattenTicket.clientOrderId
        )
      ) {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['FLATTEN_CANCEL_AMBIGUITY_BINDING_INVALID'],
          callCounts,
        );
      }
      try {
        flattenObservation = await queryOrder(
          flattenTicket,
          ports,
          callCounts,
        );
      } catch {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['FLATTEN_CANCEL_QUERY_FAILED'],
          callCounts,
        );
      }
      if (
        flattenObservation.kind !== 'FOUND'
        || flattenObservation.venueOrderId !== flattenVenueOrderId
      ) {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['FLATTEN_CANCEL_ORDER_IDENTITY_CONFLICT'],
          callCounts,
        );
      }
      flattenTerminal =
        flattenObservation.status === 'FILLED'
        || flattenObservation.status === 'CANCELED'
        || flattenObservation.status === 'REJECTED'
        || flattenObservation.status === 'EXPIRED'
        || flattenObservation.status === 'EXPIRED_IN_MATCH';
    }
    if (!flattenTerminal) {
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        ['FLATTEN_NOT_TERMINAL'],
        callCounts,
      );
    }
    let attemptFills: readonly Readonly<SpotFillObservation>[];
    try {
      callCounts.fillQueries += 1;
      attemptFills = await ports.executionPort.queryFills(
        Object.freeze({
          kind: 'QUERY_FILLS' as const,
          ticketId: flattenTicket.ticketId,
          symbol,
          originalClientOrderId: flattenTicket.clientOrderId,
          venueOrderId: flattenVenueOrderId,
          readOnly: true as const,
        }),
      );
    } catch {
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        ['FLATTEN_FILL_QUERY_UNRESOLVED'],
        callCounts,
      );
    }
    if (
      !exactSourceFills(
        attemptFills,
        flattenVenueOrderId,
        flattenObservation.cumulativeFilledQuantity,
      )
    ) {
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        ['FLATTEN_FILLS_NOT_EXACT'],
        callCounts,
      );
    }
    const cumulativeForTicket = sumFills(attemptFills);
    if (
      cumulativeForTicket !== '0'
      && cumulativeForTicket !== flattenTicket.quantity
    ) flattenFokBreach = true;
    const record = Object.freeze({
      attempt,
      ticket: flattenTicket,
      venueOrderId: flattenVenueOrderId,
      authoritativelyAbsent: false,
      terminal: true as const,
      fillsComplete: true as const,
      fills: Object.freeze([...attemptFills]),
    });
    flattenAttempts.push(record);
    flattenFills = Object.freeze(
      flattenAttempts.flatMap((row) => row.fills),
    );
    lifecycle = applied(lifecycle, {
      ...eventEnvelope(lifecycle, entryTicket.ticketId),
      type: 'FLATTEN_FILL_OBSERVED',
      cumulativeFlattenedQuantity: sumFills(flattenFills),
    });
  }

  if (latestDerivation === null) {
    try {
      const sourcePrice = entryTicket.price;
      if (sourcePrice === null) throw new TypeError();
      latestDerivation = deriveFlattenLeg({
        sourceTicket: entryTicket,
        sourceVenueOrderId,
        sourceFills,
        previousFlattenAttempts: flattenAttempts.map(
          (row): Readonly<SpotFlattenAttemptFillSet> => Object.freeze({
            ticket: row.ticket,
            venueOrderId: row.venueOrderId,
            authoritativelyAbsent: row.authoritativelyAbsent,
            fills: row.fills,
          }),
        ),
        baseAsset: input.baseAsset,
        exchangeBaseTolerance: input.exchangeBaseTolerance,
        maximumResidualDustNotionalQuote:
          input.maximumResidualDustNotionalQuote,
        maximumGrossLifecycleTurnoverQuote:
          input.maximumGrossLifecycleTurnoverQuote,
        totalFeeReserveQuote: input.totalFeeReserveQuote,
        quantityStepSize: sourceQuantityStep,
        attempt: Math.min(
          M0_SPOT_MAXIMUM_FLATTEN_SUBMISSIONS,
          flattenAttempts.length + 1,
        ),
        price: sourcePrice,
        riskReferencePrice: entryTicket.riskReferencePrice,
        estimatedMaxLossQuote: entryTicket.estimatedMaxLossQuote,
        createdAtMs: ports.clock.nowMs(),
        expiresAtMs: Math.max(
          ports.clock.nowMs() + 1,
          entryTicket.expiresAtMs,
        ),
      });
    } catch {
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        ['RECOVERY_ACCOUNTING_DERIVATION_FAILED'],
        callCounts,
      );
    }
  } else if (flattenAttempts.length > 0) {
    const last = flattenAttempts.at(-1);
    try {
      if (last === undefined || last.ticket.price === null) throw new TypeError();
      latestDerivation = deriveFlattenLeg({
        sourceTicket: entryTicket,
        sourceVenueOrderId,
        sourceFills,
        previousFlattenAttempts: flattenAttempts.map(
          (row): Readonly<SpotFlattenAttemptFillSet> => Object.freeze({
            ticket: row.ticket,
            venueOrderId: row.venueOrderId,
            authoritativelyAbsent: row.authoritativelyAbsent,
            fills: row.fills,
          }),
        ),
        baseAsset: input.baseAsset,
        exchangeBaseTolerance: input.exchangeBaseTolerance,
        maximumResidualDustNotionalQuote:
          input.maximumResidualDustNotionalQuote,
        maximumGrossLifecycleTurnoverQuote:
          input.maximumGrossLifecycleTurnoverQuote,
        totalFeeReserveQuote: input.totalFeeReserveQuote,
        quantityStepSize: sourceQuantityStep,
        attempt: Math.min(
          M0_SPOT_MAXIMUM_FLATTEN_SUBMISSIONS,
          flattenAttempts.length + 1,
        ),
        price: last.ticket.price,
        riskReferencePrice: last.ticket.riskReferencePrice,
        estimatedMaxLossQuote: last.ticket.estimatedMaxLossQuote,
        createdAtMs: last.ticket.createdAtMs,
        expiresAtMs: last.ticket.expiresAtMs,
      });
    } catch {
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        ['RECOVERY_ACCOUNTING_DERIVATION_FAILED'],
        callCounts,
      );
    }
  }
  if (
    compareSpotDecimals(
      latestDerivation.remainingAttributableBaseQuantity,
      latestDerivation.exchangeBaseTolerance,
    ) > 0
  ) {
    return result(
      'RECOVERY_REQUIRED',
      symbol,
      lifecycle,
      ['FLATTEN_ATTEMPT_CAP_EXHAUSTED_WITH_RESIDUAL'],
      callCounts,
    );
  }

  const baseline = input.baseBalanceBaseline;
  const quoteBaseline = input.quoteBalanceBaseline;
  let flatRequest: Readonly<SpotFlatEvidenceRequest>;
  try {
    const quoteAccounting = deriveSpotQuoteAccounting({
      sourceTicket: entryTicket,
      sourceVenueOrderId,
      sourceFills,
      flattenAttempts,
      baseAsset: input.baseAsset,
      quoteAsset: input.quoteAsset,
    });
    flatRequest = Object.freeze({
      sourceTicket: entryTicket,
      flattenTicket,
      lifecycle,
      sourceOrderAuthoritativelyAbsent: false,
      sourceFills,
      flattenFills,
      flattenAttempts: Object.freeze([...flattenAttempts]),
      authoritativelyAbsentFlattenClientOrderIds: Object.freeze(
        flattenAttempts
          .filter((attempt) => attempt.authoritativelyAbsent)
          .map((attempt) => attempt.ticket.clientOrderId),
      ),
      baseAsset: input.baseAsset,
      baselineRevision: baseline.revision,
      baselineBaseQuantity: normalizeSpotDecimal(
        baseline.quantity,
        'baseline base quantity',
      ),
      baselineObservedAtMs: baseline.observedAtMs,
      quoteAsset: input.quoteAsset,
      baselineQuoteQuantity: normalizeSpotDecimal(
        quoteBaseline.quantity,
        'baseline quote quantity',
      ),
      quoteQuantityTolerance: normalizeSpotDecimal(
        quoteBaseline.tolerance,
        'quote quantity tolerance',
      ),
      exchangeBaseTolerance: latestDerivation.exchangeBaseTolerance,
      maximumResidualDustNotionalQuote:
        latestDerivation.maximumResidualDustNotionalQuote,
      expectedResidualDustNotionalQuote:
        latestDerivation.residualDustNotionalQuote,
      sourceGrossFilledBaseQuantity:
        latestDerivation.sourceGrossFilledBaseQuantity,
      sourceBaseCommissionQuantity:
        latestDerivation.sourceBaseCommissionQuantity,
      sourceAttributableBaseQuantity:
        latestDerivation.attributableBaseQuantity,
      cumulativeFilledSellQuantity:
        latestDerivation.cumulativeFilledSellQuantity,
      flattenBaseCommissionQuantity:
        latestDerivation.flattenBaseCommissionQuantity,
      expectedCanaryAttributableBaseDeltaQuantity:
        latestDerivation.remainingAttributableBaseQuantity,
      observedGrossLifecycleTurnoverQuote:
        latestDerivation.observedGrossLifecycleTurnoverQuote,
      authorizedFilledLifecycleTurnoverQuote:
        latestDerivation.authorizedFilledLifecycleTurnoverQuote,
      maximumAuthorizedLifecycleTurnoverQuote:
        latestDerivation.maximumAuthorizedLifecycleTurnoverQuote,
      favorableSellPriceImprovementQuote:
        latestDerivation.favorableSellPriceImprovementQuote,
      sourceGrossQuoteDebit: quoteAccounting.sourceGrossQuoteDebit,
      flattenGrossQuoteCredit:
        quoteAccounting.flattenGrossQuoteCredit,
      referencePnlQuote: quoteAccounting.referencePnlQuote,
      signedSlippageCostQuote:
        quoteAccounting.signedSlippageCostQuote,
      quoteCommissionDebit: quoteAccounting.quoteCommissionDebit,
      fillDerivedQuoteCashflow:
        quoteAccounting.fillDerivedQuoteCashflow,
      realizedPnlAfterQuoteFees:
        quoteAccounting.realizedPnlAfterQuoteFees,
      commissionTotals: quoteAccounting.commissionTotals,
      quoteEconomicsStatus: quoteAccounting.quoteEconomicsStatus,
      thirdAssetCommissionQuoteValueStatus:
        quoteAccounting.thirdAssetCommissionQuoteValueStatus,
    });
    if (
      !CONTROL_ID.test(flatRequest.baselineRevision)
      || quoteBaseline.revision !== flatRequest.baselineRevision
      || !Number.isSafeInteger(flatRequest.baselineObservedAtMs)
      || flatRequest.baselineObservedAtMs < 0
      || flatRequest.baselineObservedAtMs > entryTicket.createdAtMs
      || quoteBaseline.observedAtMs !== flatRequest.baselineObservedAtMs
      || quoteAccounting.observedGrossLifecycleTurnoverQuote
        !== latestDerivation.observedGrossLifecycleTurnoverQuote
      || quoteAccounting.authorizedFilledLifecycleTurnoverQuote
        !== latestDerivation.authorizedFilledLifecycleTurnoverQuote
      || quoteAccounting.favorableSellPriceImprovementQuote
        !== latestDerivation.favorableSellPriceImprovementQuote
    ) throw new TypeError();
  } catch {
    return result(
      'RECOVERY_REQUIRED',
      symbol,
      lifecycle,
      ['BASE_BALANCE_BASELINE_INVALID'],
      callCounts,
    );
  }
  let flatEvidence: Readonly<SpotAuthoritativeFlatEvidence> | null;
  try {
    flatEvidence = await ports.readFlatEvidence(flatRequest);
  } catch {
    flatEvidence = null;
  }
  if (
    !exactFlatEvidence(
      flatEvidence,
      entryTicket,
      flattenTicket,
      flattenVenueOrderId,
      lifecycle,
      sourceFills,
      flattenFills,
      flatRequest,
    )
    || flatEvidence === null
  ) {
    return result(
      'RECOVERY_REQUIRED',
      symbol,
      lifecycle,
      ['AUTHORITATIVE_FLAT_EVIDENCE_INCOMPLETE'],
      callCounts,
    );
  }
  if (entryFokBreach || flattenFokBreach) {
    return result(
      'RECOVERY_REQUIRED',
      symbol,
      lifecycle,
      [
        entryFokBreach
          ? 'ENTRY_FOK_PARTIAL_FILL_BREACH'
          : 'FLATTEN_FOK_PARTIAL_FILL_BREACH',
      ],
      callCounts,
    );
  }

  const correlation = Object.freeze({
    ticketId: entryTicket.ticketId,
    clientOrderId: entryTicket.clientOrderId,
    orderId: sourceVenueOrderId,
    fillId: null,
    cancelId: null,
    flattenId: flattenTicket?.ticketId ?? null,
    attemptKind:
      flattenTicket === null ? ('ORDER' as const) : ('FLATTEN' as const),
  });
  const ledgerIntent = buildSpotLedgerAppendIntent(
    {
      eventKind: 'RECONCILIATION',
      eventRevision: flatEvidence.revision,
      symbol,
      correlation,
      side: entryTicket.side,
      baseQuantity: latestDerivation.attributableBaseQuantity,
      quoteQuantity: flatEvidence.observedGrossLifecycleTurnoverQuote,
      feeQuantity: flatEvidence.quoteCommissionDebit,
      feeAsset: flatEvidence.quoteAsset,
      occurredAtMs: flatEvidence.occurredAtMs,
      status: 'EXACT',
    },
    ports.clock,
  );
  callCounts.ledgerAppends += 1;
  try {
    const appendOutcome = await ports.appendLedger(ledgerIntent);
    if (appendOutcome !== 'APPENDED' && appendOutcome !== 'DUPLICATE') {
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        ['LEDGER_APPEND_CONFLICT'],
        callCounts,
      );
    }
  } catch {
    return result(
      'RECOVERY_REQUIRED',
      symbol,
      lifecycle,
      ['LEDGER_APPEND_FAILED'],
      callCounts,
    );
  }
  if (
    lifecycle.lifecycle !== 'FLAT'
    && spotResidualQuantity(lifecycle) === '0'
  ) {
    lifecycle = applied(lifecycle, {
      ...eventEnvelope(lifecycle, entryTicket.ticketId),
      type: 'FLAT_CONFIRMED',
    });
  }
  return result(
    'FLAT_RECONCILED',
    symbol,
    lifecycle,
    NO_REASONS,
    callCounts,
  );
}

/**
 * Run one bounded Spot attempt. No mutation is automatically retried.
 * Query and cancellation reconciliation remain available after a kill flip;
 * every new order action, including flatten, requires a fresh admission.
 */
export async function runSpotTransportCoordinator(
  symbol: string,
  input: Readonly<SpotTransportCoordinatorInput>,
  ports: Readonly<SpotTransportCoordinatorPorts>,
): Promise<Readonly<SpotTransportCoordinatorResult>> {
  const callCounts: MutableCounts = {
    admissions: 0,
    signedTests: 0,
    authorityConsumptions: 0,
    submits: 0,
    orderQueries: 0,
    fillQueries: 0,
    cancels: 0,
    flattens: 0,
    ledgerAppends: 0,
  };
  let lifecycle: Readonly<SpotLifecycleState> | null = null;
  let entryTicket: Readonly<SpotExecutionTicket> | null = null;

  if (typeof symbol !== 'string' || !SYMBOL.test(symbol)) {
    return result('BLOCKED', '', null, ['SYMBOL_INVALID'], callCounts);
  }
  if (snapshotRecord(input)?.mode === 'RECOVERY_ONLY') {
    return runSpotRecoveryTransportCoordinator(symbol, input, ports);
  }
  if (
    typeof ports?.readAdmission !== 'function' ||
    typeof ports?.clock?.nowMs !== 'function' ||
    typeof ports?.executionPort?.signedTestOrder !== 'function' ||
    typeof ports?.reserveMutation !== 'function' ||
    typeof ports?.reserveCancel !== 'function' ||
    typeof ports?.deriveFlattenLeg !== 'function' ||
    typeof ports?.verifySignedTestEvidence !== 'function' ||
    typeof ports?.appendLedger !== 'function' ||
    typeof ports?.readFlatEvidence !== 'function'
  ) {
    return result('BLOCKED', symbol, null, ['PORTS_INVALID'], callCounts);
  }
  const initialAdmission = await preflight(
    symbol,
    'ENTRY',
    ports,
    callCounts,
  );
  if (initialAdmission !== null) {
    return result('BLOCKED', symbol, null, [initialAdmission], callCounts);
  }
  const canonicalEntryTicket = reconstructCanonicalSpotExecutionTicket(
    input?.entry?.ticket,
  );
  if (
    canonicalEntryTicket === null
    || canonicalEntryTicket.symbol !== symbol
    || canonicalEntryTicket.purpose !== 'ENTRY'
    || canonicalEntryTicket.side !== 'BUY'
    || canonicalEntryTicket.type !== 'LIMIT'
    || canonicalEntryTicket.timeInForce !== 'FOK'
  ) {
    return result(
      'BLOCKED',
      symbol,
      null,
      ['ENTRY_TICKET_NOT_CANONICAL'],
      callCounts,
    );
  }
  if (!exactCoordinatorAccountingBasis(input, canonicalEntryTicket)) {
    return result(
      'BLOCKED',
      symbol,
      null,
      ['ENTRY_ACCOUNTING_BASIS_INVALID'],
      callCounts,
    );
  }

  try {
    const entry = input.entry;
    entryTicket = canonicalEntryTicket;
    if (
      entryTicket.symbol !== symbol ||
      entryTicket.purpose !== 'ENTRY' ||
      entryTicket.side !== 'BUY' ||
      entryTicket.type !== 'LIMIT' ||
      entryTicket.timeInForce !== 'FOK'
    ) {
      return result(
        'BLOCKED',
        symbol,
        null,
        ['ENTRY_TICKET_BINDING_INVALID'],
        callCounts,
      );
    }
    const nowMs = ports.clock.nowMs();
    const preparation = prepareSpotCore({
      ticket: entryTicket,
      filterSnapshot: entry.filterSnapshot,
      nowMs,
      riskEvidence: entry.riskEvidence,
      venueEvidence: entry.venueEvidence,
    });
    if (!preparation.readyForSignedTest || preparation.signedTestIntent === null) {
      return result(
        'BLOCKED',
        symbol,
        null,
        ['ENTRY_CORE_BLOCKED', ...preparation.blockingCodes],
        callCounts,
      );
    }
    lifecycle = applied(null, {
      ...eventEnvelope(null, entryTicket.ticketId),
      type: 'PREPARED',
      originalClientOrderId: entryTicket.clientOrderId,
      targetQuantity: entryTicket.quantity,
    });

    callCounts.signedTests += 1;
    let signedTestOutcome: Readonly<SpotMutationOutcome>;
    try {
      signedTestOutcome = await ports.executionPort.signedTestOrder(
        preparation.signedTestIntent,
      );
    } catch {
      return result(
        'BLOCKED',
        symbol,
        lifecycle,
        ['SIGNED_TEST_TRANSPORT_FAILED'],
        callCounts,
      );
    }
    if (!acceptedSignedTest(signedTestOutcome)) {
      return result(
        'BLOCKED',
        symbol,
        lifecycle,
        ['SIGNED_TEST_NOT_ZERO_ORDER_ACK'],
        callCounts,
      );
    }
    let entryTestEvidenceVerified = false;
    try {
      entryTestEvidenceVerified =
        (await ports.verifySignedTestEvidence(
          preparation.signedTestIntent,
          signedTestOutcome,
          entry.signedTestEvidence,
        )) === true;
    } catch {
      entryTestEvidenceVerified = false;
    }
    if (!entryTestEvidenceVerified) {
      return result(
        'BLOCKED',
        symbol,
        lifecycle,
        ['SIGNED_TEST_EVIDENCE_NOT_VERIFIED'],
        callCounts,
      );
    }

    const finalEntryAdmission = await preflight(
      symbol,
      'ENTRY',
      ports,
      callCounts,
    );
    if (finalEntryAdmission !== null) {
      return result(
        'BLOCKED',
        symbol,
        lifecycle,
        [finalEntryAdmission],
        callCounts,
      );
    }

    const sendDecision = decideSpotLiveSend({
      ticket: entryTicket,
      filterSnapshot: entry.filterSnapshot,
      nowMs: ports.clock.nowMs(),
      riskEvidence: entry.riskEvidence,
      venueEvidence: entry.venueEvidence,
      readiness: entry.readiness,
      signedTestEvidence: entry.signedTestEvidence,
      ownerAuthority: entry.ownerAuthority,
    });
    if (
      !sendDecision.allowed ||
      sendDecision.intent === null ||
      entry.ownerAuthority === null
    ) {
      return result(
        'BLOCKED',
        symbol,
        lifecycle,
        ['ENTRY_SEND_BLOCKED', ...sendDecision.blockingCodes],
        callCounts,
      );
    }

    callCounts.authorityConsumptions += 1;
    let reserved = false;
    try {
      reserved = exactMutationReservation(
        await ports.reserveMutation(
          entry.ownerAuthority,
          sendDecision.intent,
        ),
        'ENTRY',
        entryTicket,
        sendDecision.intent,
      );
    } catch {
      reserved = false;
    }
    if (!reserved) {
      return result(
        'BLOCKED',
        symbol,
        lifecycle,
        ['ENTRY_MUTATION_NOT_ATOMICALLY_RESERVED'],
        callCounts,
      );
    }
    const entryAttemptFence = await appendMutationAttempt(
      entryTicket,
      'ORDER',
      ports,
      callCounts,
    );
    if (entryAttemptFence === 'DUPLICATE') {
      try {
        await queryOrder(entryTicket, ports, callCounts);
      } catch {
        // The prior mutation identity remains fenced even when readback fails.
      }
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        ['ENTRY_ATTEMPT_ALREADY_EXISTS_NO_RESEND'],
        callCounts,
      );
    }
    if (entryAttemptFence !== 'FRESH') {
      return result(
        'BLOCKED',
        symbol,
        lifecycle,
        ['ENTRY_ATTEMPT_LEDGER_NOT_DURABLE'],
        callCounts,
      );
    }
    const immediateEntryAdmission = await preflight(
      symbol,
      'ENTRY',
      ports,
      callCounts,
    );
    if (immediateEntryAdmission !== null) {
      return result(
        'BLOCKED',
        symbol,
        lifecycle,
        [
          immediateEntryAdmission,
          'ENTRY_AUTHORITY_CONSUMED_SEND_NOW_BLOCKED',
        ],
        callCounts,
      );
    }

    lifecycle = applied(lifecycle, {
      ...eventEnvelope(lifecycle, entryTicket.ticketId),
      type: 'SUBMIT_STARTED',
    });
    callCounts.submits += 1;
    let submitOutcome: Readonly<SpotMutationOutcome>;
    try {
      submitOutcome = await ports.executionPort.submitLiveOrder(
        sendDecision.intent,
      );
    } catch {
      submitOutcome = Object.freeze({
        kind: 'AMBIGUOUS' as const,
        reasonCode: 'SUBMIT_TRANSPORT_THROW',
        queryOriginalClientOrderId: entryTicket.clientOrderId,
        automaticRetry: false as const,
      });
    }

    if (submitOutcome.kind === 'REJECTED') {
      lifecycle = applied(lifecycle, {
        ...eventEnvelope(lifecycle, entryTicket.ticketId),
        type: 'OUTCOME_AMBIGUOUS',
        cause: 'CANONICAL_ATTEMPT_UNKNOWN',
      });
    } else if (submitOutcome.kind === 'AMBIGUOUS') {
      if (
        submitOutcome.automaticRetry !== false ||
        submitOutcome.queryOriginalClientOrderId !==
          entryTicket.clientOrderId
      ) {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['SUBMIT_AMBIGUITY_BINDING_INVALID'],
          callCounts,
        );
      }
      lifecycle = applied(lifecycle, {
        ...eventEnvelope(lifecycle, entryTicket.ticketId),
        type: 'OUTCOME_AMBIGUOUS',
        cause: 'CANONICAL_ATTEMPT_UNKNOWN',
      });
    } else {
      lifecycle = applied(lifecycle, {
        ...eventEnvelope(lifecycle, entryTicket.ticketId),
        type: 'ORDER_ACKNOWLEDGED',
        venueOrderId: submitOutcome.venueOrderId,
        cumulativeFilledQuantity:
          submitOutcome.cumulativeFilledQuantity,
      });
    }

    let sourceObservation: Readonly<SpotQueryOutcome>;
    try {
      sourceObservation = await queryOrder(
        entryTicket,
        ports,
        callCounts,
      );
    } catch {
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        ['SOURCE_QUERY_FAILED'],
        callCounts,
      );
    }
    if (sourceObservation.kind === 'UNRESOLVED') {
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        ['SOURCE_QUERY_UNRESOLVED'],
        callCounts,
      );
    }
    if (sourceObservation.kind === 'AUTHORITATIVE_NOT_FOUND') {
      if (
        lifecycle.lifecycle === 'UNKNOWN' &&
        lifecycle.ambiguityOperation === 'SUBMIT'
      ) {
        lifecycle = applied(lifecycle, {
          ...eventEnvelope(lifecycle, entryTicket.ticketId),
          type: 'ORDER_PROVEN_ABSENT',
        });
      }
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        ['SUBMIT_AUTHORITY_CONSUMED_ORDER_PROVEN_ABSENT'],
        callCounts,
      );
    }
    let observed = observeQuery(
      lifecycle,
      entryTicket.ticketId,
      sourceObservation,
    );
    lifecycle = observed.state;
    let sourceTerminal = observed.terminal;

    if (!sourceTerminal) {
      const cancelAttemptFence = await appendMutationAttempt(
        entryTicket,
        'CANCEL',
        ports,
        callCounts,
      );
      if (cancelAttemptFence === 'FAILED') {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['CANCEL_ATTEMPT_LEDGER_NOT_DURABLE'],
          callCounts,
        );
      }
      const cancelIntent = Object.freeze({
        kind: 'CANCEL_BY_ORIGINAL_CLIENT_ORDER_ID' as const,
        ticketId: entryTicket.ticketId,
        symbol,
        originalClientOrderId: entryTicket.clientOrderId,
        automaticRetry: false as const,
      });
      let cancelReservation:
        Readonly<SpotCancelReservationReceipt> | null = null;
      try {
        cancelReservation = await ports.reserveCancel(
          'ENTRY_CANCEL',
          entryTicket,
          cancelIntent,
        );
      } catch {
        cancelReservation = null;
      }
      if (!exactCancelReservation(
        cancelReservation,
        'ENTRY_CANCEL',
        entryTicket,
        cancelIntent,
      )) {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['CANCEL_NOT_DURABLY_RESERVED_NO_RETRY'],
          callCounts,
        );
      }
      if (cancelReservation!.replay === false) {
        callCounts.authorityConsumptions += 1;
      }
      lifecycle = applied(lifecycle, {
        ...eventEnvelope(lifecycle, entryTicket.ticketId),
        type: 'CANCEL_REQUESTED',
      });
      callCounts.cancels += 1;
      let cancelOutcome: Readonly<SpotMutationOutcome>;
      try {
        cancelOutcome = await ports.executionPort.cancel(cancelIntent);
      } catch {
        cancelOutcome = Object.freeze({
          kind: 'AMBIGUOUS' as const,
          reasonCode: 'CANCEL_TRANSPORT_THROW',
          queryOriginalClientOrderId: entryTicket.clientOrderId,
          automaticRetry: false as const,
        });
      }
      if (cancelOutcome.kind === 'AMBIGUOUS') {
        if (
          cancelOutcome.automaticRetry !== false ||
          cancelOutcome.queryOriginalClientOrderId !==
            entryTicket.clientOrderId
        ) {
          return result(
            'RECOVERY_REQUIRED',
            symbol,
            lifecycle,
            ['CANCEL_AMBIGUITY_BINDING_INVALID'],
            callCounts,
          );
        }
        lifecycle = applied(lifecycle, {
          ...eventEnvelope(lifecycle, entryTicket.ticketId),
          type: 'OUTCOME_AMBIGUOUS',
          cause: 'CANONICAL_ATTEMPT_UNKNOWN',
        });
      }
      let cancelObservation: Readonly<SpotQueryOutcome>;
      try {
        cancelObservation = await queryOrder(
          entryTicket,
          ports,
          callCounts,
        );
      } catch {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['CANCEL_QUERY_FAILED'],
          callCounts,
        );
      }
      if (cancelObservation.kind !== 'FOUND') {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['CANCEL_QUERY_UNRESOLVED'],
          callCounts,
        );
      }
      observed = observeQuery(
        lifecycle,
        entryTicket.ticketId,
        cancelObservation,
      );
      lifecycle = observed.state;
      sourceTerminal = observed.terminal;
      if (!sourceTerminal) {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['CANCEL_NOT_TERMINAL_NO_RETRY'],
          callCounts,
        );
      }
    }

    return recoverAndReconcile(
      symbol,
      input,
      ports,
      callCounts,
      entryTicket,
      lifecycle,
      sourceTerminal,
    );

  } catch {
    return result(
      callCounts.submits > 0 ? 'RECOVERY_REQUIRED' : 'BLOCKED',
      symbol,
      lifecycle,
      [
        callCounts.submits > 0
          ? 'COORDINATOR_FAILED_AFTER_SUBMIT'
          : 'COORDINATOR_INPUT_OR_GATE_INVALID',
      ],
      callCounts,
    );
  }
}

/**
 * Boot/restart recovery path. It queries the already-consumed entry identity
 * and can mint only bounded recovery authorities; it contains no entry test,
 * reservation, or submission call.
 */
export async function runSpotRecoveryTransportCoordinator(
  symbol: string,
  input: Readonly<SpotTransportCoordinatorInput>,
  ports: Readonly<SpotTransportCoordinatorPorts>,
): Promise<Readonly<SpotTransportCoordinatorResult>> {
  const callCounts: MutableCounts = {
    admissions: 0,
    signedTests: 0,
    authorityConsumptions: 0,
    submits: 0,
    orderQueries: 0,
    fillQueries: 0,
    cancels: 0,
    flattens: 0,
    ledgerAppends: 0,
  };
  let lifecycle: Readonly<SpotLifecycleState> | null = null;
  if (typeof symbol !== 'string' || !SYMBOL.test(symbol)) {
    return result('BLOCKED', '', null, ['SYMBOL_INVALID'], callCounts);
  }
  if (
    typeof ports?.readAdmission !== 'function'
    || typeof ports?.clock?.nowMs !== 'function'
    || typeof ports?.executionPort?.queryByOriginalClientOrderId !== 'function'
    || typeof ports?.executionPort?.queryFills !== 'function'
    || typeof ports?.executionPort?.cancel !== 'function'
    || typeof ports?.executionPort?.flatten !== 'function'
    || typeof ports?.reserveMutation !== 'function'
    || typeof ports?.reserveCancel !== 'function'
    || typeof ports?.deriveFlattenLeg !== 'function'
    || typeof ports?.appendLedger !== 'function'
    || typeof ports?.readFlatEvidence !== 'function'
  ) {
    return result('BLOCKED', symbol, null, ['PORTS_INVALID'], callCounts);
  }
  const canonicalEntryTicket = reconstructCanonicalSpotExecutionTicket(
    input?.entry?.ticket,
  );
  if (
    canonicalEntryTicket === null
    || canonicalEntryTicket.symbol !== symbol
    || canonicalEntryTicket.purpose !== 'ENTRY'
    || canonicalEntryTicket.side !== 'BUY'
    || canonicalEntryTicket.type !== 'LIMIT'
    || canonicalEntryTicket.timeInForce !== 'FOK'
    || (
      input.priorFlattenAttempts !== undefined
      && (
        !Array.isArray(input.priorFlattenAttempts)
        || input.priorFlattenAttempts.some((attempt) =>
          reconstructCanonicalSpotExecutionTicket(attempt.ticket) === null,
        )
      )
    )
  ) {
    return result(
      'RECOVERY_REQUIRED',
      symbol,
      null,
      ['RECOVERY_TICKET_NOT_CANONICAL'],
      callCounts,
    );
  }
  if (!exactCoordinatorAccountingBasis(input, canonicalEntryTicket)) {
    return result(
      'RECOVERY_REQUIRED',
      symbol,
      null,
      ['RECOVERY_ACCOUNTING_BASIS_INVALID'],
      callCounts,
    );
  }
  const admission = await preflight(
    symbol,
    'FLATTEN',
    ports,
    callCounts,
  );
  if (admission !== null) {
    return result('RECOVERY_REQUIRED', symbol, null, [admission], callCounts);
  }
  try {
    const entryTicket = canonicalEntryTicket;
    const expectedVenueOrderId = input.sourceVenueOrderId;
    if (
      entryTicket.symbol !== symbol
      || entryTicket.purpose !== 'ENTRY'
      || entryTicket.side !== 'BUY'
      || entryTicket.type !== 'LIMIT'
      || entryTicket.timeInForce !== 'FOK'
      || (
        expectedVenueOrderId !== null
        && (
          typeof expectedVenueOrderId !== 'string'
          || !CONTROL_ID.test(expectedVenueOrderId)
        )
      )
    ) {
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        null,
        ['RECOVERY_SOURCE_BINDING_INVALID'],
        callCounts,
      );
    }
    lifecycle = applied(null, {
      ...eventEnvelope(null, entryTicket.ticketId),
      type: 'PREPARED',
      originalClientOrderId: entryTicket.clientOrderId,
      targetQuantity: entryTicket.quantity,
    });
    lifecycle = applied(lifecycle, {
      ...eventEnvelope(lifecycle, entryTicket.ticketId),
      type: 'SUBMIT_STARTED',
    });
    lifecycle = applied(lifecycle, {
      ...eventEnvelope(lifecycle, entryTicket.ticketId),
      type: 'OUTCOME_AMBIGUOUS',
      cause: 'CANONICAL_ATTEMPT_UNKNOWN',
    });
    let observation = await queryOrder(entryTicket, ports, callCounts);
    if (
      observation.kind === 'AUTHORITATIVE_NOT_FOUND'
      && expectedVenueOrderId === null
      && (input.priorFlattenAttempts?.length ?? 0) === 0
    ) {
      lifecycle = applied(lifecycle, {
        ...eventEnvelope(lifecycle, entryTicket.ticketId),
        type: 'ORDER_PROVEN_ABSENT',
      });
      return reconcileAuthoritativelyAbsentSource(
        symbol,
        input,
        ports,
        callCounts,
        entryTicket,
        lifecycle,
      );
    }
    if (
      observation.kind !== 'FOUND'
      || observation.venueOrderId === null
      || (
        expectedVenueOrderId !== null
        && observation.venueOrderId !== expectedVenueOrderId
      )
    ) {
      return result(
        'RECOVERY_REQUIRED',
        symbol,
        lifecycle,
        ['RECOVERY_SOURCE_QUERY_IDENTITY_UNRESOLVED'],
        callCounts,
      );
    }
    const adoptedVenueOrderId = observation.venueOrderId;
    let observed = observeQuery(
      lifecycle,
      entryTicket.ticketId,
      observation,
    );
    lifecycle = observed.state;
    let terminal = observed.terminal;
    if (!terminal) {
      const cancelFence = await appendMutationAttempt(
        entryTicket,
        'CANCEL',
        ports,
        callCounts,
      );
      if (cancelFence === 'FAILED') {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['RECOVERY_CANCEL_ATTEMPT_LEDGER_NOT_DURABLE'],
          callCounts,
        );
      }
      const cancelIntent = Object.freeze({
        kind: 'CANCEL_BY_ORIGINAL_CLIENT_ORDER_ID' as const,
        ticketId: entryTicket.ticketId,
        symbol,
        originalClientOrderId: entryTicket.clientOrderId,
        automaticRetry: false as const,
      });
      let cancelReservation:
        Readonly<SpotCancelReservationReceipt> | null = null;
      try {
        cancelReservation = await ports.reserveCancel(
          'ENTRY_CANCEL',
          entryTicket,
          cancelIntent,
        );
      } catch {
        cancelReservation = null;
      }
      const cancelReserved = exactCancelReservation(
        cancelReservation,
        'ENTRY_CANCEL',
        entryTicket,
        cancelIntent,
      );
      if (
        !cancelReserved
        && (cancelFence === 'FRESH' || cancelReservation !== null)
      ) {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['RECOVERY_CANCEL_NOT_DURABLY_RESERVED_NO_RETRY'],
          callCounts,
        );
      }
      if (cancelReserved) {
        if (cancelReservation!.replay === false) {
          callCounts.authorityConsumptions += 1;
        }
        lifecycle = applied(lifecycle, {
          ...eventEnvelope(lifecycle, entryTicket.ticketId),
          type: 'CANCEL_REQUESTED',
        });
        callCounts.cancels += 1;
        try {
          const cancelOutcome = await ports.executionPort.cancel(
            cancelIntent,
          );
          if (
            cancelOutcome.kind === 'AMBIGUOUS'
            && (
              cancelOutcome.automaticRetry !== false
              || cancelOutcome.queryOriginalClientOrderId
                !== entryTicket.clientOrderId
            )
          ) {
            return result(
              'RECOVERY_REQUIRED',
              symbol,
              lifecycle,
              ['RECOVERY_CANCEL_AMBIGUITY_BINDING_INVALID'],
              callCounts,
            );
          }
        } catch {
          // Query below is authoritative; cancellation is never blindly retried.
        }
      }
      observation = await queryOrder(entryTicket, ports, callCounts);
      if (
        observation.kind !== 'FOUND'
        || observation.venueOrderId !== adoptedVenueOrderId
      ) {
        return result(
          'RECOVERY_REQUIRED',
          symbol,
          lifecycle,
          ['RECOVERY_CANCEL_QUERY_IDENTITY_UNRESOLVED'],
          callCounts,
        );
      }
      observed = observeQuery(
        lifecycle,
        entryTicket.ticketId,
        observation,
      );
      lifecycle = observed.state;
      terminal = observed.terminal;
    }
    return recoverAndReconcile(
      symbol,
      input,
      ports,
      callCounts,
      entryTicket,
      lifecycle,
      terminal,
    );
  } catch {
    return result(
      'RECOVERY_REQUIRED',
      symbol,
      lifecycle,
      ['RECOVERY_COORDINATOR_FAILED'],
      callCounts,
    );
  }
}
