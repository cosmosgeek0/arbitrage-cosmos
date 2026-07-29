/**
 * Closed authority contract for one M0 Binance Spot test-order preparation.
 *
 * This module validates authority supplied by a separate canonical owner. It
 * cannot issue authority, persist consumption, sign, dispatch, call Binance,
 * or authorize a live order. Production does not configure an authority
 * consumer in M0-I2.
 */
import { types as nodeUtilTypes } from 'node:util';

import { canonicalJson } from '../contracts/identity.js';
import {
  compareSpotDecimals,
} from '../exchange/binanceSpot/filters.js';
import {
  OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE,
} from '../risk/spotRiskPolicy.js';
import {
  createSpotExecutionTicket,
  type SpotExecutionTicket,
} from './spotTicket.js';

export const M0_SPOT_TEST_ORDER_AUTHORITY_SCHEMA =
  'cosmos.foundation.m0-spot-test-order-authority.v1' as const;
export const M0_SPOT_TEST_ORDER_CONSUMPTION_SCHEMA =
  'cosmos.foundation.m0-spot-test-order-consumption.v1' as const;
export const M0_SPOT_TEST_ORDER_SCOPE =
  'BINANCE_SPOT_TEST_ORDER_ONLY' as const;
export const M0_SPOT_TEST_ORDER_NOTIONAL_ASSET = 'USDT' as const;

const AUTHORITY_KEYS = Object.freeze([
  'schema',
  'authorizationId',
  'verification',
  'scope',
  'requestId',
  'ticketId',
  'termsDigest',
  'clientOrderId',
  'symbol',
  'notionalAsset',
  'filterSnapshotRevision',
  'maximumOrderNotionalQuote',
  'confirmedAtMs',
  'expiresAtMs',
  'clockFenceId',
  'issuedMonotonicMs',
  'expiresMonotonicMs',
  'singleUse',
] as const);
const RECEIPT_KEYS = Object.freeze([
  'schema',
  'authorizationId',
  'scope',
  'requestId',
  'ticketId',
  'termsDigest',
  'clientOrderId',
  'notionalAsset',
  'filterSnapshotRevision',
  'consumedAtMs',
  'clockFenceId',
  'consumedMonotonicMs',
  'state',
  'authorizationReuseAllowed',
] as const);
const REQUEST_ID = /^m0_req_[0-9a-f]{32}$/u;
const AUTHORIZATION_ID = /^m0_test_auth_[A-Za-z0-9_.:-]{16,192}$/u;
const CLOCK_FENCE_ID = /^m0_clock_fence_[A-Za-z0-9_.:-]{16,192}$/u;
const AUTHORITY_VALIDATION_INPUT_KEYS = Object.freeze([
  'requestId',
  'ticket',
  'authority',
  'evaluatedAtMs',
  'clockFenceId',
  'evaluatedMonotonicMs',
] as const);
const RECEIPT_VALIDATION_INPUT_KEYS = Object.freeze([
  'requestId',
  'ticket',
  'authority',
  'receipt',
  'evaluatedAtMs',
  'clockFenceId',
  'minimumMonotonicMs',
  'evaluatedMonotonicMs',
] as const);
const TICKET_KEYS = Object.freeze([
  'schema',
  'ticketId',
  'termsDigest',
  'legId',
  'correlationId',
  'planId',
  'accountId',
  'venue',
  'symbol',
  'side',
  'type',
  'timeInForce',
  'quantity',
  'price',
  'riskReferencePrice',
  'notionalPrice',
  'orderNotionalQuote',
  'estimatedMaxLossQuote',
  'purpose',
  'riskEffect',
  'attempt',
  'clientOrderId',
  'createdAtMs',
  'expiresAtMs',
] as const);

type PlainRecord = Readonly<Record<string, unknown>>;

export interface M0SpotTestOrderAuthority {
  readonly schema: typeof M0_SPOT_TEST_ORDER_AUTHORITY_SCHEMA;
  readonly authorizationId: string;
  readonly verification: 'VERIFIED_BY_CANONICAL_TEST_ORDER_OWNER';
  readonly scope: typeof M0_SPOT_TEST_ORDER_SCOPE;
  readonly requestId: `m0_req_${string}`;
  readonly ticketId: string;
  readonly termsDigest: string;
  readonly clientOrderId: string;
  readonly symbol: string;
  readonly notionalAsset: typeof M0_SPOT_TEST_ORDER_NOTIONAL_ASSET;
  readonly filterSnapshotRevision: string;
  readonly maximumOrderNotionalQuote:
    typeof OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE;
  readonly confirmedAtMs: number;
  readonly expiresAtMs: number;
  /**
   * Rollback-resistant age fence minted with the authority. A fence belongs to
   * one monotonic-clock epoch; restart or unknown epoch identity must reject.
   */
  readonly clockFenceId: `m0_clock_fence_${string}`;
  readonly issuedMonotonicMs: number;
  readonly expiresMonotonicMs: number;
  /** One atomic authorization consumption/signer admission, not wire replay. */
  readonly singleUse: true;
}

export interface M0SpotTestOrderConsumptionReceipt {
  readonly schema: typeof M0_SPOT_TEST_ORDER_CONSUMPTION_SCHEMA;
  readonly authorizationId: string;
  readonly scope: typeof M0_SPOT_TEST_ORDER_SCOPE;
  readonly requestId: `m0_req_${string}`;
  readonly ticketId: string;
  readonly termsDigest: string;
  readonly clientOrderId: string;
  readonly notionalAsset: typeof M0_SPOT_TEST_ORDER_NOTIONAL_ASSET;
  readonly filterSnapshotRevision: string;
  readonly consumedAtMs: number;
  readonly clockFenceId: `m0_clock_fence_${string}`;
  readonly consumedMonotonicMs: number;
  readonly state: 'CONSUMED_ONCE';
  /** Applies to authorization consumption, not Binance wire-byte replay. */
  readonly authorizationReuseAllowed: false;
}

export interface M0SpotTestOrderAuthorityConsumptionInput {
  readonly requestId: `m0_req_${string}`;
  readonly ticket: Readonly<SpotExecutionTicket>;
  readonly authority: Readonly<M0SpotTestOrderAuthority>;
  readonly evaluatedAtMs: number;
  readonly clockFenceId: `m0_clock_fence_${string}`;
  readonly evaluatedMonotonicMs: number;
}

/**
 * A future canonical implementation must atomically and durably reject
 * authorization reuse, independently read the same rollback-resistant clock
 * fence, and reject an expired, restarted, unknown, or mismatched fence. It
 * must not trust the caller's evaluation fields as its clock. Null means not
 * consumed; callers must stop.
 */
export interface M0SpotTestOrderAuthorityConsumer {
  consume(
    input: Readonly<M0SpotTestOrderAuthorityConsumptionInput>,
  ): Promise<Readonly<M0SpotTestOrderConsumptionReceipt> | null>;
}

export type M0SpotTestOrderAuthorityFailureCode =
  | 'VALIDATION_INPUT_INVALID'
  | 'REQUEST_ID_INVALID'
  | 'EVALUATION_TIME_INVALID'
  | 'TICKET_INVALID'
  | 'TICKET_SCOPE_INVALID'
  | 'ORDER_NOTIONAL_CEILING_EXCEEDED'
  | 'AUTHORITY_INVALID'
  | 'AUTHORITY_BINDING_MISMATCH'
  | 'AUTHORITY_CLOCK_FENCE_INVALID'
  | 'AUTHORITY_TIME_INVALID'
  | 'CONSUMPTION_RECEIPT_INVALID'
  | 'CONSUMPTION_RECEIPT_BINDING_MISMATCH'
  | 'CONSUMPTION_RECEIPT_TIME_INVALID';

export type M0SpotTestOrderAuthorityValidation =
  | {
      readonly ok: true;
      readonly ticket: Readonly<SpotExecutionTicket>;
      readonly authority: Readonly<M0SpotTestOrderAuthority>;
    }
  | {
      readonly ok: false;
      readonly code: M0SpotTestOrderAuthorityFailureCode;
    };

export type M0SpotTestOrderConsumptionValidation =
  | {
      readonly ok: true;
      readonly receipt: Readonly<M0SpotTestOrderConsumptionReceipt>;
    }
  | {
      readonly ok: false;
      readonly code: M0SpotTestOrderAuthorityFailureCode;
    };

function failure(
  code: M0SpotTestOrderAuthorityFailureCode,
): M0SpotTestOrderAuthorityValidation {
  return Object.freeze({ ok: false as const, code });
}

function receiptFailure(
  code: M0SpotTestOrderAuthorityFailureCode,
): M0SpotTestOrderConsumptionValidation {
  return Object.freeze({ ok: false as const, code });
}

function closedRecord(
  value: unknown,
  expectedKeys: readonly string[],
): PlainRecord | null {
  try {
    if (
      value === null
      || typeof value !== 'object'
      || Array.isArray(value)
      || nodeUtilTypes.isProxy(value)
      || Object.getPrototypeOf(value) !== Object.prototype
    ) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(descriptors).length !== expectedKeys.length
      || expectedKeys.some((key) => {
        const descriptor = descriptors[key];
        return (
          descriptor === undefined
          || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
          || descriptor.enumerable !== true
        );
      })
    ) return null;
    return Object.freeze(Object.fromEntries(
      expectedKeys.map((key) => [key, descriptors[key].value]),
    ));
  } catch {
    return null;
  }
}

function validUtcMs(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function canonicalTicket(value: unknown): Readonly<SpotExecutionTicket> | null {
  try {
    const row = closedRecord(value, TICKET_KEYS);
    if (row === null) return null;
    const candidate = row as unknown as Readonly<SpotExecutionTicket>;
    const rebuilt = createSpotExecutionTicket({
      correlationId: candidate.correlationId,
      planId: candidate.planId,
      accountId: candidate.accountId,
      symbol: candidate.symbol,
      side: candidate.side,
      type: candidate.type,
      timeInForce: candidate.timeInForce,
      quantity: candidate.quantity,
      price: candidate.price,
      riskReferencePrice: candidate.riskReferencePrice,
      estimatedMaxLossQuote: candidate.estimatedMaxLossQuote,
      purpose: candidate.purpose,
      attempt: candidate.attempt,
      createdAtMs: candidate.createdAtMs,
      expiresAtMs: candidate.expiresAtMs,
    });
    return canonicalJson(row) === canonicalJson(rebuilt) ? rebuilt : null;
  } catch {
    return null;
  }
}

/**
 * Validate one server-resolved TEST_ORDER_ONLY authority before any atomic
 * consumption or signing attempt.
 */
export function validateM0SpotTestOrderAuthority(
  inputValue: unknown,
): M0SpotTestOrderAuthorityValidation {
  const input = closedRecord(
    inputValue,
    AUTHORITY_VALIDATION_INPUT_KEYS,
  );
  if (input === null) return failure('VALIDATION_INPUT_INVALID');
  if (typeof input.requestId !== 'string' || !REQUEST_ID.test(input.requestId)) {
    return failure('REQUEST_ID_INVALID');
  }
  if (!validUtcMs(input.evaluatedAtMs)) {
    return failure('EVALUATION_TIME_INVALID');
  }
  if (
    typeof input.clockFenceId !== 'string'
    || !CLOCK_FENCE_ID.test(input.clockFenceId)
    || !validUtcMs(input.evaluatedMonotonicMs)
  ) {
    return failure('EVALUATION_TIME_INVALID');
  }
  const ticket = canonicalTicket(input.ticket);
  if (ticket === null) return failure('TICKET_INVALID');
  if (
    ticket.purpose !== 'ENTRY'
    || ticket.venue !== 'BINANCE_SPOT'
    || ticket.type !== 'LIMIT'
    || ticket.timeInForce === null
    || ticket.price === null
    || ticket.notionalPrice !== ticket.price
    || !ticket.symbol.endsWith(M0_SPOT_TEST_ORDER_NOTIONAL_ASSET)
    || ticket.symbol.length <= M0_SPOT_TEST_ORDER_NOTIONAL_ASSET.length
  ) {
    return failure('TICKET_SCOPE_INVALID');
  }
  try {
    if (
      compareSpotDecimals(ticket.orderNotionalQuote, '0') <= 0
      || compareSpotDecimals(
        ticket.orderNotionalQuote,
        OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE,
      ) > 0
    ) return failure('ORDER_NOTIONAL_CEILING_EXCEEDED');
  } catch {
    return failure('TICKET_INVALID');
  }

  const row = closedRecord(input.authority, AUTHORITY_KEYS);
  if (
    row === null
    || row.schema !== M0_SPOT_TEST_ORDER_AUTHORITY_SCHEMA
    || typeof row.authorizationId !== 'string'
    || !AUTHORIZATION_ID.test(row.authorizationId)
    || row.verification !== 'VERIFIED_BY_CANONICAL_TEST_ORDER_OWNER'
    || row.scope !== M0_SPOT_TEST_ORDER_SCOPE
    || row.notionalAsset !== M0_SPOT_TEST_ORDER_NOTIONAL_ASSET
    || typeof row.filterSnapshotRevision !== 'string'
    || row.filterSnapshotRevision.length === 0
    || row.filterSnapshotRevision.length > 256
    || row.maximumOrderNotionalQuote
      !== OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE
    || typeof row.clockFenceId !== 'string'
    || !CLOCK_FENCE_ID.test(row.clockFenceId)
    || !validUtcMs(row.issuedMonotonicMs)
    || !validUtcMs(row.expiresMonotonicMs)
    || (row.expiresMonotonicMs as number)
      <= (row.issuedMonotonicMs as number)
    || row.singleUse !== true
  ) return failure('AUTHORITY_INVALID');

  if (
    row.requestId !== input.requestId
    || row.ticketId !== ticket.ticketId
    || row.termsDigest !== ticket.termsDigest
    || row.clientOrderId !== ticket.clientOrderId
    || row.symbol !== ticket.symbol
  ) return failure('AUTHORITY_BINDING_MISMATCH');
  if (row.clockFenceId !== input.clockFenceId) {
    return failure('AUTHORITY_CLOCK_FENCE_INVALID');
  }

  if (
    !validUtcMs(row.confirmedAtMs)
    || !validUtcMs(row.expiresAtMs)
    || row.confirmedAtMs < ticket.createdAtMs
    || row.confirmedAtMs > input.evaluatedAtMs
    || row.expiresAtMs <= input.evaluatedAtMs
    || row.expiresAtMs > ticket.expiresAtMs
    || (row.issuedMonotonicMs as number)
      > (input.evaluatedMonotonicMs as number)
    || (row.expiresMonotonicMs as number)
      <= (input.evaluatedMonotonicMs as number)
  ) return failure('AUTHORITY_TIME_INVALID');
  const utcLifetimeMs = (row.expiresAtMs as number)
    - (row.confirmedAtMs as number);
  const monotonicLifetimeMs = (row.expiresMonotonicMs as number)
    - (row.issuedMonotonicMs as number);
  if (
    !Number.isSafeInteger(utcLifetimeMs)
    || !Number.isSafeInteger(monotonicLifetimeMs)
    || utcLifetimeMs !== monotonicLifetimeMs
  ) return failure('AUTHORITY_TIME_INVALID');

  return Object.freeze({
    ok: true as const,
    ticket,
    authority: Object.freeze({
      schema: M0_SPOT_TEST_ORDER_AUTHORITY_SCHEMA,
      authorizationId: row.authorizationId,
      verification: 'VERIFIED_BY_CANONICAL_TEST_ORDER_OWNER' as const,
      scope: M0_SPOT_TEST_ORDER_SCOPE,
      requestId: input.requestId as `m0_req_${string}`,
      ticketId: ticket.ticketId,
      termsDigest: ticket.termsDigest,
      clientOrderId: ticket.clientOrderId,
      symbol: ticket.symbol,
      notionalAsset: M0_SPOT_TEST_ORDER_NOTIONAL_ASSET,
      filterSnapshotRevision: row.filterSnapshotRevision,
      maximumOrderNotionalQuote:
        OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE,
      confirmedAtMs: row.confirmedAtMs as number,
      expiresAtMs: row.expiresAtMs as number,
      clockFenceId:
        row.clockFenceId as `m0_clock_fence_${string}`,
      issuedMonotonicMs: row.issuedMonotonicMs as number,
      expiresMonotonicMs: row.expiresMonotonicMs as number,
      singleUse: true as const,
    }),
  });
}

/**
 * Validate the durable owner's returned one-use consumption receipt before the
 * signer is touched.
 */
export function validateM0SpotTestOrderConsumptionReceipt(
  inputValue: unknown,
): M0SpotTestOrderConsumptionValidation {
  const input = closedRecord(
    inputValue,
    RECEIPT_VALIDATION_INPUT_KEYS,
  );
  if (input === null) return receiptFailure('VALIDATION_INPUT_INVALID');
  if (
    typeof input.clockFenceId !== 'string'
    || !CLOCK_FENCE_ID.test(input.clockFenceId)
    || !validUtcMs(input.minimumMonotonicMs)
    || !validUtcMs(input.evaluatedMonotonicMs)
    || (input.evaluatedMonotonicMs as number)
      < (input.minimumMonotonicMs as number)
  ) return receiptFailure('CONSUMPTION_RECEIPT_TIME_INVALID');
  const validated = validateM0SpotTestOrderAuthority(Object.freeze({
    requestId: input.requestId,
    ticket: input.ticket,
    authority: input.authority,
    evaluatedAtMs: input.evaluatedAtMs,
    clockFenceId: input.clockFenceId,
    evaluatedMonotonicMs: input.evaluatedMonotonicMs,
  }));
  if (!validated.ok) return receiptFailure(validated.code);
  const row = closedRecord(input.receipt, RECEIPT_KEYS);
  if (
    row === null
    || row.schema !== M0_SPOT_TEST_ORDER_CONSUMPTION_SCHEMA
    || row.scope !== M0_SPOT_TEST_ORDER_SCOPE
    || row.state !== 'CONSUMED_ONCE'
    || row.authorizationReuseAllowed !== false
    || typeof row.clockFenceId !== 'string'
    || !CLOCK_FENCE_ID.test(row.clockFenceId)
  ) return receiptFailure('CONSUMPTION_RECEIPT_INVALID');
  if (
    row.authorizationId !== validated.authority.authorizationId
    || row.requestId !== validated.authority.requestId
    || row.ticketId !== validated.ticket.ticketId
    || row.termsDigest !== validated.ticket.termsDigest
    || row.clientOrderId !== validated.ticket.clientOrderId
    || row.notionalAsset !== M0_SPOT_TEST_ORDER_NOTIONAL_ASSET
    || row.filterSnapshotRevision
      !== validated.authority.filterSnapshotRevision
    || input.clockFenceId !== validated.authority.clockFenceId
    || row.clockFenceId !== validated.authority.clockFenceId
  ) return receiptFailure('CONSUMPTION_RECEIPT_BINDING_MISMATCH');
  if (
    !validUtcMs(row.consumedAtMs)
    || row.consumedAtMs < validated.authority.confirmedAtMs
    || row.consumedAtMs > (input.evaluatedAtMs as number)
    || row.consumedAtMs >= validated.authority.expiresAtMs
    || !validUtcMs(row.consumedMonotonicMs)
    || (row.consumedMonotonicMs as number)
      < (input.minimumMonotonicMs as number)
    || (row.consumedMonotonicMs as number)
      > (input.evaluatedMonotonicMs as number)
    || (row.consumedMonotonicMs as number)
      < validated.authority.issuedMonotonicMs
    || (row.consumedMonotonicMs as number)
      >= validated.authority.expiresMonotonicMs
  ) return receiptFailure('CONSUMPTION_RECEIPT_TIME_INVALID');

  return Object.freeze({
    ok: true as const,
    receipt: Object.freeze({
      schema: M0_SPOT_TEST_ORDER_CONSUMPTION_SCHEMA,
      authorizationId: validated.authority.authorizationId,
      scope: M0_SPOT_TEST_ORDER_SCOPE,
      requestId: validated.authority.requestId,
      ticketId: validated.ticket.ticketId,
      termsDigest: validated.ticket.termsDigest,
      clientOrderId: validated.ticket.clientOrderId,
      notionalAsset: M0_SPOT_TEST_ORDER_NOTIONAL_ASSET,
      filterSnapshotRevision:
        validated.authority.filterSnapshotRevision,
      consumedAtMs: row.consumedAtMs as number,
      clockFenceId: validated.authority.clockFenceId,
      consumedMonotonicMs: row.consumedMonotonicMs as number,
      state: 'CONSUMED_ONCE' as const,
      authorizationReuseAllowed: false as const,
    }),
  });
}
