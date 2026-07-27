/**
 * Pure canonical preparation and current M0 live-send gate for Binance Spot.
 *
 * Returned intents are inert data. This module has no adapter implementation,
 * credentials, signing, network, persistence, clock, or mutation capability.
 */
import {
  compareSpotDecimals,
  normalizeSpotDecimal,
  validateBinanceSpotOrderFilters,
  type BinanceSpotFilterValidation,
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
  SpotLiveSubmitIntent,
  SpotSignedTestOrderIntent,
} from './spotPort.js';
import type { SpotExecutionTicket } from './spotTicket.js';

export const SPOT_CORE_PREPARATION_SCHEMA =
  'cosmos.foundation.spot-core-preparation.v1' as const;
export const SPOT_SIGNED_TEST_EVIDENCE_SCHEMA =
  'cosmos.foundation.spot-signed-test-evidence.v1' as const;
export const SPOT_OWNER_SEND_AUTHORITY_SCHEMA =
  'cosmos.foundation.spot-owner-send-authority.v1' as const;
export const SPOT_RISK_EVIDENCE_SCHEMA =
  'cosmos.foundation.spot-risk-evidence.v1' as const;

export const SPOT_CORE_BLOCKING_CODES = Object.freeze([
  'FILTER_SNAPSHOT_INVALID',
  'FILTER_VALIDATION_FAILED',
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
}

export interface SpotRiskReductionEvidence {
  readonly basis: 'RECONCILED_SPOT_BASE_REDUCTION';
  readonly positionSnapshotRevision: string;
  readonly reconciliationStatus: 'EXACT';
  readonly side: 'SELL';
  readonly availableBaseQuantity: string;
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
    failures: Object.freeze([]),
  });
}

function uniqueBlockingCodes(
  values: readonly SpotCoreBlockingCode[],
): readonly SpotCoreBlockingCode[] {
  return Object.freeze([...new Set(values)]);
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
  const riskEvidenceCodes = riskEvidenceBlockingCodes(
    input.riskEvidence,
    input.ticket,
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

  const filterValidation = snapshotValid
    ? validateBinanceSpotOrderFilters(
        {
          type: input.ticket.type,
          quantity: input.ticket.quantity,
          price: input.ticket.price,
          marketReferencePrice:
            input.ticket.type === 'MARKET'
              ? input.ticket.riskReferencePrice
              : null,
        },
        input.filterSnapshot.filters,
      )
    : emptyFilterValidation();
  if (!filterValidation.ok) blockingCodes.push('FILTER_VALIDATION_FAILED');
  if (
    filterValidation.notional !== null &&
    compareSpotDecimals(
      filterValidation.notional,
      input.ticket.orderNotionalQuote,
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
      purpose: input.ticket.purpose,
      riskEffect:
        input.ticket.purpose === 'FLATTEN' &&
        riskEvidenceCodes.length === 0
          ? 'RECONCILED_RISK_REDUCTION'
          : input.ticket.riskEffect,
      quantity: input.ticket.quantity,
      price: input.ticket.price,
      riskReferencePrice: input.ticket.riskReferencePrice,
      estimatedMaxLossQuote: input.ticket.estimatedMaxLossQuote,
      expiresAtMs: input.ticket.expiresAtMs,
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
    ticket: input.ticket,
    filterSnapshotRevision,
    filterValidation,
    riskVerdict,
    blockingCodes: frozenBlockingCodes,
    signedTestRequired: true as const,
    signedTestIntent:
      readyForSignedTest && filterSnapshotRevision !== null
        ? signedTestIntent(input.ticket, filterSnapshotRevision)
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
          ticketId: input.ticket.ticketId,
          termsDigest: input.ticket.termsDigest,
          clientOrderId: input.ticket.clientOrderId,
          symbol: input.ticket.symbol,
          side: input.ticket.side,
          type: input.ticket.type,
          timeInForce: input.ticket.timeInForce,
          quantity: input.ticket.quantity,
          price: input.ticket.price,
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
